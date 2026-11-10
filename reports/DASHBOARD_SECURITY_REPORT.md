# Phase 17 — DASHBOARD SECURITY REPORT

**Scope:** the security properties of CONWAY AUTOMATON / AI COMMAND CENTER
(`<repo-root>\dashboard`) as it runs on this machine.
**Method:** every control below was located in code **and** exercised — by a test, by a live HTTP
request, or by a browser action. Where a control could not be exercised, it is recorded as a
limitation rather than claimed.
**Explicit non-claim:** this report does **not** state that the dashboard has zero vulnerabilities.
Phase 16 reached the same position for Conway itself, and it holds here.

---

## 1. Threat model

| Adversary / scenario | Defended? | What actually provides the defence |
|---|---|---|
| Any process on the LAN or internet reaching the console | **Yes** | `HOST` is `127.0.0.1`; a non-loopback host makes the process **refuse to start** with exit 4 (`server/index.ts`). Verified by handshake probe and by the negative control in §4. |
| A malicious page in the operator's browser calling the console | **Yes** | `Sec-Fetch-Site`/`Origin`/`Referer` checks plus a required `X-Conway-request: 1` on every mutation (`security.ts:133`). Blind cross-site POST is refused; 12 `request.rejected` events with `reason:"origin"` are in the audit log. |
| An unauthenticated local process reading Conway state through the console | **Yes** | Every data endpoint sits behind the operator token (`routes.ts` → 401 + `request.unauthenticated`, 33 events). |
| Stolen session cookie replayed from another peer | **Yes** | Sessions are bound to the issuing `remoteAddress` and **deleted on mismatch** (`security.ts:111`). Covered by the test "serves a session issued for one peer to that peer only". |
| Response bodies or audit rows copying a secret out | **Yes** | `redact.ts` — key-name pattern plus four value-shaped patterns (PEM, 32-byte hex, JWT, key-shaped strings), depth- and length-bounded. The three Conway API keys in `automaton.json` never reach a response. |
| Brute-forcing the operator token | **Yes** | 43-char base64url (256 bits) from `crypto.randomBytes(32)`, compared with `timingSafeEqual` on equal-length buffers; token bucket 40/min per `ip:class` returns 429 with `retry-after`. |
| Browser input causing a shell command to run | **Yes** | There is no command parameter anywhere. The three actions are named, typed functions in `commands.ts`; nothing reaches `child_process` with operator-supplied text. |
| Console activating the agent, funding or creating a wallet, or purchasing credits | **Yes** | Not reachable: those code paths are never imported or called (§3). All nine gate checks in the health probe pass, and the config hash is unchanged after the full walk. |
| A restore overwriting the live database | **Yes** | Restore writes only to a fresh directory under `dashboard/restore-targets`, refuses an existing target, re-verifies archive bytes at execute time, and cannot proceed without a plan the same operator confirmed minutes earlier. |
| Path traversal through the static file server | **Yes** | `serveStatic` resolves and then requires the target to be `SPA_DIST_DIR` or inside it ([dashboard/server/http.ts:61](file:///<repo-root>/dashboard/server/http.ts#L61)), returning 400 otherwise — and that 400 now carries the same security headers as everything else. |
| **An attacker who already controls the operator's Windows account** | **No** | They read `dashboard/state/dashboard.token` (0600, but same-user readable in practice), the config file and the DB directly. File permissions are the only barrier, and R-15 (ACL hardening) is still open. A loopback HTTP console is not a security boundary against its own user. |
| **OS-level isolation of the Conway agent** | **No** | Application-level sandboxing is not equivalent to OS isolation, and this report does not claim it. See `PHASE_16_ISOLATION_EVALUATION.md`; Home SL remains the operator's decision. |
| **A compromised `runtime/home` write path** | **No** | If something can write `automaton.json` or `state.db`, the console faithfully reports the tampered state. It is an instrument, not an IDS. |

## 2. Mandate §25 controls, item by item

| Control | Implementation | Evidence it works |
|---|---|---|
| Bind to `127.0.0.1` only | `paths.ts` `HOST`; `index.ts` refuses any other host (exit 4); `FORBIDDEN_PORTS` blocks port 3001 belonging to another project | `status.mjs` `loopback_bind` PASS + `not_exposed` PASS ("no connection established to any of 3 routable address(es)") |
| Authentication | Operator token, created `wx` 0600, never printed at startup, never overwritten; cookie session or `Bearer` | `security.test.ts` (15 tests); live 401→200 exchange in `http-contract.test.ts`; 10 `auth.success` / 6 `auth.failed` events |
| Authorisation | Every `/api/*` except `auth`, `logout`, `session`, `health` requires auth; `/api/stream` requires it before the SSE client is registered | [dashboard/server/routes.ts:74](file:///<repo-root>/dashboard/server/routes.ts#L74) gate; `status.mjs` `auth_wall` PASS ("GET /api/panels without a session is refused with 401") |
| CSRF | `isTrustedRequest`: `Sec-Fetch-Site` must be `same-origin`/`none`, `Origin` must equal the console origin, `Referer` must be same-origin for non-GET, and `X-Conway-request: 1` is mandatory for mutations | [dashboard/server/security.ts:133](file:///<repo-root>/dashboard/server/security.ts#L133); 12 logged rejections; [dashboard/tests/http-contract.test.ts:97](file:///<repo-root>/dashboard/tests/http-contract.test.ts#L97) "refuses a blind form post with no opt-in header" |
| Input validation | Body capped at 8 KiB and destroyed beyond it; JSON must parse; `isPanelId()` whitelist before any builder runs; restore `confirm` compared server-side to the archive name | [dashboard/server/routes.ts:18](file:///<repo-root>/dashboard/server/routes.ts#L18), [dashboard/server/panels/index.ts:46](file:///<repo-root>/dashboard/server/panels/index.ts#L46); four malformed restore bodies each returned 400 `NOT VERIFIED`; restore guard tests |
| Safe process execution | No shell is spawned from a request. `processes.ts` reads command lines by PID for identity only; `stop.mjs` kills **only** a PID it recorded and whose command line matches the Conway runtime + `server/index.ts` | Live restart: `server_identity` PASS names `server/index.ts under tsx`; a recycled PID is refused, not killed |
| Rate limiting | Token bucket, capacity 40, refill 40/60 000 ms, keyed `ip:read` and `ip:action` separately so reading cannot starve actions and probing cannot starve the UI | `security.test.ts`; 429 with `retry-after` header in the code path |
| Session protection | Random 24-byte session id (the token itself is not in the cookie), `HttpOnly`, `SameSite=Strict`, 8 h `Max-Age`, ≤32 sessions with oldest evicted, expiry + peer rebind enforced on every use | `security.ts:60-116`; the peer-binding test |
| Secret redaction | `isSecretKey` matches a credential word **anywhere** in the key name (`privateKeyPem`, `anthropicApiKey`, `db_password_env`); value patterns for PEM blocks, `0x`+64 hex, JWTs, key-shaped strings; depth ≤6 and 512-char string cap | `redact.test.ts` (5 tests); and a live grep of `dashboard/logs/` on 2026-11-01 returned **0** secret-shaped strings (`sk-`, `api_key:`, PEM blocks, `0x`+64 hex, JWTs) and **0** occurrences of the current operator token across the audit JSONL and both launcher logs |
| Audit logging | Append-only `dashboard/logs/audit-<YYYY-MM-DD>.jsonl`; one event per auth, rejection, action and startup decision; `redactJson` applied to every detail | **141 events on 2026-11-01**: 33 `request.unauthenticated`, 29 `action.restore.plan`, 26 `action.restore`, 12 `request.rejected`, 10 `auth.success`, 8 `startup.listening`, 7 `action.restore.execute`, 6 `auth.failed`, 4 `action.verify-backups`, 3 `startup.refused`, 2 `action.health-check`, 1 `token.created` |
| Security headers | `BASE_HEADERS` (`http.ts`) — CSP below, `nosniff`, `no-referrer` — spread into **every** response path: JSON, the SPA page and hashed assets, the traversal 400, the not-built fallback, and the router's 404. `cache-control: no-store` on every JSON response | `response-headers.test.ts` (4 tests); live probe after the final restart: `/`, `/index.html`, `/api/health`, a traversal-shaped path, an unknown dotted path and `/api/panels` all returned **3/3** headers (200/200/200/404/404/401). This was **not** true before that run — the static and plain-text paths lacked `referrer-policy`, which is why the check is now a test rather than a reading of the code. |

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
form-action 'self'
```

`'unsafe-inline'` for styles is the one relaxed directive; it is required by Tailwind's injected
styles. `script-src` stays `'self'`, so inline script execution is not permitted.

## 3. Read-only by construction

The Phase 16 datasource inventory listed the Conway operations that mutate live state
(`PHASE_16_DATASOURCE_INVENTORY.md`, "DANGER LIST"). **None is imported by the dashboard.** The
static check `tests/danger-imports.test.ts` (5 tests) asserts this against the import graph rather
than trusting discipline: it scans the server files, finds no write-side Conway import, carries a
**positive control** proving it flags a denied import when one really is present, and fails if the
deny-list goes stale — if a forbidden symbol no longer exists in Conway source, the test says so
instead of passing vacuously.

| Forbidden operation | Why it is dangerous | Dashboard status |
|---|---|---|
| `createDatabase()` | Opens read-write, sets WAL, runs `CREATE_TABLES` and migrations V2…V13, inserts `schema_version` rows | never called; `db.ts:29` opens `new Database(file, { readonly: true, fileMustExist: true })` and `readonly-db.test.ts:22` asserts `handle.db.readonly === true` on the live handle |
| `automaton --status` | Looks read-only, is not — it calls `createDatabase()` | never spawned |
| `--run` / `CONWAY_ACTIVATION=APPROVED` | activates the agent, executes tools, writes logs and DB | never set; `status.mjs` asserts `CONWAY_ACTIVATION is unset for this run` |
| `getWallet()` | generates a private key and writes an encrypted wallet file when `wallet.json` is absent and a passphrase env var exists | never called; only `walletExists()` / `getWalletAddress()` |
| `saveConfig()` / `createConfig()` | overwrites the file that holds the activation gates | never imported |
| `syncHeartbeatToDb()`, `saveHeartbeatConfig()` | writes `heartbeat.yml` and the live DB | never called |
| `scanSecurityEvents()`, `checkTamper()`, `raiseIncident*` | read-only names that INSERT incidents | never called |
| `engage/clearEmergencyStop()` | writes or unlinks a sticky marker, and follows ambient `HOME` | read paths only |
| `runMechanic()` | performs repairs | never called; `selfHealingEnabled` stays false |

**Three actions exist, and no more:** `POST /api/action/health-check` (writes a report under
`dashboard/state`), `POST /api/action/verify-backups` (re-hashes archives, read-only), and
`POST /api/action/restore` (two-stage, into a new directory). There is no agent start, no wallet
action, no model call, no config write, and no endpoint that accepts a command line.

## 4. Loopback exposure — proven, including the negative control

`status.mjs` no longer trusts `netstat`/`Get-NetTCPConnection`, which are unreliable on this machine
(they mis-render LISTENING rows and return nothing for a live loopback listener). It performs TCP
handshakes instead.

Fresh run at **2026-11-01T10:26Z**:

```
[PASS] home_isolated: Conway state resolves to <repo-root>\runtime\home
[PASS] process: console running as pid 29292
[PASS] loopback_bind: 127.0.0.1:8787 accepts connections
[PASS] not_exposed: no connection established to any of 3 routable address(es) — localhost only
[PASS] operator_token: present and 43 characters (value not printed)
[PASS] api_liveness: GET /api/health -> 200, pid 31952
[PASS] server_identity: pid 31952 is the dashboard server (command line names server/index.ts under tsx)
[PASS] auth_wall: GET /api/panels without a session is refused with 401
[PASS] spa_bundle: dashboard/dist/index.html is built
[PASS] gate:security.activationApproved … gate:maxChildren  (9 gate checks, all PASS)
[PASS] activation_env: CONWAY_ACTIVATION is unset for this run

19 pass, 0 fail, 0 not verified, 0 warn — dashboard\state\dashboard-health-2026-11-01T10-26-39-578Z.json
```

Because a passing check can be a vacuous one, the same probe was run against a **canary** bound to
`0.0.0.0:8791`. It correctly failed and exited 1:

```
[FAIL] not_exposed: … Wi-Fi <host-lan-ip>
[FAIL] server_identity: …
[FAIL] auth_wall: …
```

So `not_exposed` distinguishes a loopback-only server from an exposed one; it does not pass by
accident.

## 5. HOME isolation

Mandate §3 requires every Conway-touching process to resolve state to
`<repo-root>\runtime\home`. `server/home.ts` (`lockHomeOrThrow`) checks this at
startup and the process **refuses to start** (exit 3) rather than falling back to `C:\root.automaton`
or the user's default `.automaton` directory. `tests/home-guard.test.ts` (11 tests) proves the guard
is non-vacuous: it passes under the canonical `HOME` and throws under a redirected one, so a passing
run is not an artifact of the test environment. All launchers set `HOME` explicitly; the health
check reports `home_isolated` PASS every run.

## 6. The restore path, and the defect that was fixed there

Restore is the one action that writes, so it got the strictest design — and the one design flaw
that mattered was found by **reading the output**, not by reviewing the code.

**The defect:** step 1 (`plan`) and step 2 (`execute`) each called `planRestore()`, which computes a
fresh timestamped target directory. The operator confirmed a path, then step 2 wrote to a
*different* path generated milliseconds later. The confirmation was not a confirmation of what was
written.

**The fix** (`commands.ts`, `routes.ts`): a successful plan is held server-side
(`heldPlans`, 10-minute TTL); `executeConfirmedRestore()` consumes it **one-shot**, re-checks the
confirmation string, re-verifies the archive bytes, re-checks that every planned file is still
present, refuses an existing target directory, and writes exactly the held plan's `target`.

Observed after the fix, in the real browser:

```
Planned: 3 verified file(s) → …--2026-11-01T10-18-51-787Z
copied 3 file(s) to …--2026-11-01T10-18-51-787Z. The live database was not touched.
```

Identical paths, and `dashboard/state/dashboard.token` / live `state.db` unchanged. Pinned twice:
`restore-guard.test.ts` asserts `result.data.target === plan.target`, that the note names the source
archive rather than a sentence, that a second execute is refused, and that the live DB's size and
mtime are untouched; `http-contract.test.ts` asserts the same through the wire, including 400 on the
repeat.

## 7. Invariants preserved

Mandate §29. The console reads these and can change none of them. After the complete verification
walk — 12-area browsing, restore, verify, health check, restarts — `runtime/home/.automaton/automaton.json`
still hashes to:

```
1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d   (1382 bytes, mtime 2026-10-31T10:56:18Z)
```

`security.lockdown = true` · `activationApproved = false` · `allowedTools = []` ·
`allowFinancialTools = false` · `allowHostShell = false` · `allowSelfModification = false` ·
`allowReplication = false` · `allowExternalExposure = false` · `maxChildren = 0` ·
`selfHealingEnabled` unset (reported as a code default, never as an operator choice) ·
`CONWAY_ACTIVATION` unset.

No action was taken on the 14 prohibited-without-approval list. No Windows service was installed, no
autostart entry created, no security setting changed, no existing backup or report deleted.

## 8. Known limitations — stated, not smoothed over

1. **Same-user attacker is not modelled.** Anyone with this Windows account reads the token file and
   the DB directly. ACL hardening on the state files (**R-15**) is still an open operator decision.
2. **Sessions are in memory.** A restart logs every client out. Observed twice during this work; it
   is a deliberate trade against persisting a credential to disk.
3. **No TLS.** Loopback HTTP only; `Secure` on the cookie would break the page. If the console were
   ever exposed beyond the operator's machine, this design would have to change — and it is not
   permitted to be.
4. **The dashboard trusts Conway's own modules.** It imports `src/**` through `tsx`. If that source
   is modified, the console reports the modified semantics; `danger-imports.test.ts` checks the
   import graph but not the intent behind it.
5. **Four tables are absent** (`security_events`, `security_incidents`, `security_seals`,
   `treasury_authorizations`) — migrations V12/V13 were never applied to the live DB (**R-14**). The
   Security and Treasury panels therefore render `NOT VERIFIED` for everything those tables would
   prove, including audit-chain integrity. Seals are labelled `NOT VERIFIED — cannot verify`, never
   "seals failed".
6. **`REAL_DATA_RESTORE = NOT YET PROVABLE`.** There is no genuine user data to restore yet, and no
   test data was fabricated to make the drill look complete. The mechanism is verified against real
   archive bytes; the end-to-end "recover a populated agent" claim remains open.
7. **Live-model testing is `PENDING CREDENTIAL APPROVAL`.** No credentials were entered, no credits
   purchased, and no model was called from the console.
8. **Not an IDS.** The console reports state; it does not detect a hostile process on this machine.
9. **Health-check coverage is what §4 lists.** It cannot prove the absence of a listener on an
   interface that reports no routable address; the wording of that check says exactly that when it
   happens (`NOT VERIFIED` blocks the exit code — an unproven check is treated as a failure).

## 9. What must be verified before any activation decision

Read-only, in order, none of which the dashboard can do by itself:

1. Apply migrations V12/V13 to a **copy** of the live DB, then re-run the dashboard so the audit
   trail and incident panels have a real source (**R-14**).
2. `icacls` on `automaton.json`, `state.db`, `dashboard.token` (**R-15**).
3. The elevated read-only Windows posture run already prepared in
   `PHASE_16_WINDOWS_VERIFICATION.md`.
4. A deliberate decision on OS isolation tier (Home SL and what it makes impossible:
   `PHASE_16_ISOLATION_EVALUATION.md`).
5. Only then the §29 approval list, item by item, with a fresh verification run after each.
