# Dashboard security — Conway Automaton AI Command Center

What `dashboard/` is allowed to touch, how it is kept inside that box, and — the part worth
reading — what is **not** protected, because a console that overstates its own guarantees is the
failure mode this project has already documented twice.

## Threat model

| Adversary / accident | Covered? | Mechanism |
|---|---|---|
| A malicious web page making the operator's browser act on the console | Yes | same-origin + `X-Conway-request: 1` opt-in on every mutation; `SameSite=Strict` `HttpOnly` cookie; CSP `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'` |
| A browser-side string becoming executable | Yes | `script-src 'self'`, no `unsafe-inline`, no `unsafe-eval`; React escapes by default; no `dangerouslySetInnerHTML` anywhere in `src/` |
| Someone pointing the console at another Conway state tree | Yes | `lockHomeOrThrow()` at import; refuses unset HOME, the Windows user profile, `C:\`, a non-directory, and any directory that is not `runtime/home` |
| The console mutating Conway state by accident (migrations, WAL side effects) | Yes | `new Database(file, {readonly: true, fileMustExist: true})`; `src/state/database.ts:createDatabase()` is never imported |
| A future edit quietly importing a wallet/activation/migration function | Yes | `tests/danger-imports.test.ts` parses every import statement in the server tree against a 12-symbol deny list, with a positive control proving the matcher works |
| A crafted archive name escaping `backups/` | Yes | single-path-segment rule, per-entry `confine()` resolution before any write, target pinned under `dashboard/restore-targets/` |
| Operator credentials leaking into logs, error bodies or the browser | Yes | structural redaction by key name and value shape; the token is never printed by the server, never sent to the client, never in browser storage |
| LAN or internet reachability | Yes | binds `127.0.0.1` only, refuses any other host and port 3001; proven behaviourally (see below) |
| An attacker who already runs code as this Windows user | **No** | they can read `state/dashboard.token`, the SQLite file and every config value. This is a per-user-trust boundary, not a sandbox |
| OS-level containment of the Conway agent | **No** | the console adds no isolation. Home SL has no Device Guard/AppLocker/WDAC; see `PHASE_16_ISOLATION_EVALUATION.md` |

## Read-only by construction

`dashboard/server/db.ts` opens the live database with `readonly: true, fileMustExist: true`.
`tests/readonly-db.test.ts` proves the claim rather than restating it: it asserts
`db.readonly === true`, attempts `CREATE TABLE probe(...)` and requires SQLite to refuse it,
then confirms no `probe` table exists afterwards. It also pins the schema gap the console must
never paper over — live `schema_version` 11 against code 13, and the four tables V12/V13 would
add (`treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`)
still absent.

An absent table is reported as **NOT VERIFIED**, never as a failure and never as a zero. The
Security Center's seal tile is the worked example: the table is missing, so the tile says the
seal chain cannot be read — it does not say the seals failed, and a test asserts that the
payload contains neither phrase.

The only subprocess in the entire console is `spawnSync("tasklist", ["/FO","CSV","/NH"], {shell:false})`
— a fixed argv array, no shell, no operator input. Its output is reported honestly:
`29 node.exe process(es) visible; tasklist reports image names only, so none can be identified
as the Conway runtime`. The tile is **UNKNOWN**, because the observation does not support a
conclusion.

## HOME isolation

Every entry point — server, launcher, health check — sets
`HOME=<repo-root>\runtime\home` before resolving a path, and the server
calls `lockHomeOrThrow()` at import. `tests/home-guard.test.ts` (11 tests) is written to fail if
the guard is vacuous: it accepts the canonical spelling and the Git Bash posix spelling, and
rejects `HOME_UNSET`, `HOME_IS_USER_PROFILE`, `HOME_IS_FILESYSTEM_ROOT` (`C:\`),
`HOME_NOT_A_DIRECTORY` and `HOME_NOT_RUNTIME`, each with the remediation text it must surface.

## Authentication, sessions, CSRF, rate limiting

- Token: 32 random bytes, base64url (43 characters), `dashboard/state/dashboard.token`, written
  `wx` with mode `0600`, never overwritten, never printed by the server, never returned to a
  client. Both sides are hashed to a fixed width and compared with `crypto.timingSafeEqual`, so
  even a wrong-length candidate does not reveal the credential's length by returning early.
- Session: 8-hour `HttpOnly; SameSite=Strict` cookie, at most 32 live sessions, each bound to
  the peer address that created it. The store is in memory, so restarting the console logs every
  browser out — verified during the UI walk. Logout deletes the server-side session before
  clearing the cookie, so a copied cookie stops authenticating at once and any stream that
  session had open is closed; expiry, eviction and peer rebinding end sessions the same way.
- CSRF: mutations require `X-Conway-request: 1` **and** an `Origin` equal to the console's own.
  `Origin: null`, a foreign origin, a malformed value, a duplicated header and a prefix-spoofed
  `Referer` are refused; a `Referer`, when present, must parse to the same origin. A
  cross-site form post cannot set a custom header, so blind posts are refused with 403. This
  defence caught a real bug in this console's own client: the first browser login failed with
  `cross-origin request refused` because `login()` omitted the opt-in header. The server was not
  relaxed; the client was fixed.
- Pre-auth surface: `GET /api/session` returns only the caller's own `authenticated` boolean —
  no token length, no session count, and no detail that would describe the credential.
- Rate limit: token bucket, 40/min, keyed `ip:class` with separate `read` and `action` classes.
  `tests/security.test.ts` proves the boundary (40 allowed, 429 with `retry-after`, refill after
  61 s) and that the two classes do not share a budget.
- Bodies: 8 KiB cap, `application/json` required, malformed JSON → 400, unknown endpoint → 404
  with a message that contains no stack trace and no internal path.

## Loopback-only, proven behaviourally

`HEALTH_CHECK_DASHBOARD.bat` does not trust a socket table — `netstat -ano` and
`Get-NetTCPConnection` both return unusable rows on this machine — it performs handshakes:
`127.0.0.1:8787` must accept, and every routable interface address must refuse.

```
[PASS] loopback_bind: 127.0.0.1:8787 accepts connections
[PASS] not_exposed: no connection established to any of 3 routable address(es) — localhost only
```

To prove those two lines are not always-green, a canary listener was bound to `0.0.0.0:8791` and
the same health check was pointed at it. It reported the truth:

```
[PASS] loopback_bind: 127.0.0.1:8791 accepts connections
[FAIL] not_exposed: the console answered on non-loopback address(es): Wi-Fi <host-lan-ip>
[FAIL] server_identity: pid 23800 is not the dashboard server: …
```

`server_identity` is the third check in that chain: whatever answers on the port must be provable
as the dashboard server by its live command line, so a different program that grabbed 8787 first
cannot masquerade as the console.

## Restore: two stages, and the confirmed path is the written path

Stage 1 verifies hashes and returns the exact target directory and file list. Stage 2 refuses to
run without a held, unexpired plan, re-verifies the bytes, refuses if the target already exists,
and consumes the plan so it cannot be replayed. `executeRestore` will not accept a source outside
`backups/`, and every manifest entry is resolved with `confine()` **before** any directory is
created, so an escaping entry cannot leave a half-built restore behind.

This is where the UI walk earned its keep: the first end-to-end restore showed step 2 writing to
`…--10-11-30-542Z` while the operator had confirmed `…--10-11-27-537Z` — the HTTP layer had been
re-planning at execute time. `executeConfirmedRestore` replaced that, and
`tests/http-contract.test.ts` now asserts `executed.data.target === planned.target`. The same run
showed `RESTORE-NOTE.txt` recording a status sentence where the source archive path belongs, and
the plan tile rendering a file **array** where a count belongs; both are fixed, both have
regression assertions.

## Redaction

`server/redact.ts` is structural, not schema-specific: key names matching
`api[_-]?key|token|secret|passphrase|password|private[_-]?key|seed|authorization|cookie|credential|session[_-]?id|access[_-]?key|client[_-]?secret`
are replaced wholesale, and values are scrubbed by shape (key-like strings, PEM blocks,
32-byte hex, JWTs). Private keys, seed phrases, passwords and recovery secrets are never
rendered by any panel: the Wallet area reports `NO WALLET CONFIGURED` because no wallet exists,
and the Models area reports credential **presence** only.

The anchoring bug here was found by a test, not by reading: the original key pattern ended in
`$`, so `privateKeyPem` — a name that is obviously a secret — passed through unredacted.
`tests/redact.test.ts` now pins that case among five.

## Audit trail

Append-only JSONL at `dashboard/logs/audit-<date>.jsonl`, one line per auth attempt, denial,
startup, shutdown, action and restore stage, with `detail` passed through `redact()`. 121 events
were recorded on 2026-11-01 during the build and UI walk. A failed audit write never takes the
console down, and `auditLogState()` reports whether the sink is writable instead of assuming it.

The console's audit trail is **not** the Conway agent's audit chain, and the Health panel keeps
them apart: the agent chain is `NOT VERIFIED` because `security_events` does not exist in the
live V11 database.

## Invariants the console cannot change

`activationApproved=false`, `lockdown=true`, `allowedTools=[]`, `maxChildren=0`,
`selfHealingEnabled=false` (code default), no wallet, no credentials. The console has no write
path to any of them: `saveConfig`, `createConfig`, `engageEmergencyStop`, `clearEmergencyStop`,
`runMechanic`, `syncHeartbeatToDb`, `getWallet`, `generateSolanaKeypair`,
`writeEncryptedWalletFile`, `migratePlaintextWallet`, `loadWalletAccount` and `createDatabase`
are on the deny list that `danger-imports.test.ts` enforces on every server file.

`HEALTH_CHECK_DASHBOARD.bat` re-reads the live config after the console has been used and prints
each gate separately:

```
[PASS] gate:security.activationApproved: holds (must not be true)
[PASS] gate:security.lockdown: holds (must stay true)
… 7 more
```

A config file it cannot read is reported **NOT VERIFIED** — never as a pass, and never as an
accusation. The first version of this check printed `activationApproved=TRUE` when its own path
was wrong; that mislabelling is gone, and the three-way outcome is the point of the fix.

## Known limitations — read these before trusting a green tile

1. **Same-user attacker is out of scope.** Anyone running as this Windows user can read the
   token file, the database and every config value. File ACLs are the operator's action (R-15),
   not this console's.
2. **No OS isolation is claimed.** The console is an application-level reader. It cannot contain
   the agent, and it does not try to.
3. **`style-src 'unsafe-inline'`** is required by the bundled SPA. Script execution is not
   relaxed.
4. **Sessions are memory-only.** A restart logs everyone out; there is no revocation list on
   disk to protect either.
5. **The console reports, it does not monitor.** Values are read per request and pushed every
   15 s while a browser is attached. Nothing accumulates a history, so nothing here can prove a
   trend — the Overview chart counts cells produced by one read and says so.
6. **Four security tables are absent** (`security_events`, `security_incidents`,
   `security_seals`, `treasury_authorizations`). Their tiles are NOT VERIFIED until the operator
   applies migrations V12/V13 (R-14) — a write action this console deliberately cannot perform.
7. **`REAL_DATA_RESTORE` remains NOT YET PROVABLE** (Phase 16C): the live database contains only
   `schema_version` rows. The restore path is proven against real archives; it cannot be proven
   against real user data that does not exist yet.
