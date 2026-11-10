# Phase 18 — Security Findings With Severity

Scope: the live installation at `<repo-root>`, assessed 2026-11-01T11:32Z–12:20Z.
**Mode: read-only throughout.** No migration executed, no row written, no gate changed, no wallet
created, no credential entered, no service installed, no Windows setting touched, self-healing not
enabled.

Companion deliverables:
[`PHASE_18_AUDIT.md`](PHASE_18_AUDIT.md) ·
[`PHASE_18_MIGRATION_READINESS.md`](PHASE_18_MIGRATION_READINESS.md) ·
[`PHASE_18_REMEDIATION_PLAN.md`](PHASE_18_REMEDIATION_PLAN.md) ·
[`PHASE_18_APPROVAL_LIST.md`](PHASE_18_APPROVAL_LIST.md)

---

## 1. Severity model

| Level | Meaning in this register |
|---|---|
| **Critical** | A §29 invariant is currently violated, or funds/keys are exposed, or the agent can act without approval **today**. |
| **High** | A control that is *claimed* does not exist or does not run, so a future activation would be operating on a false assurance. Activation-blocking. |
| **Medium** | Real weakness with a contained blast radius today, or a defect that degrades the operator's ability to see the truth. |
| **Low** | Correctness/hygiene defect; no security consequence in the current configuration. |
| **Info** | Observation that affects interpretation, not security. |

No finding in this register is rated Critical. That is a measured statement, not an all-clear: the
checks that would be needed to rule out Critical are the administrator-level ones this unprivileged
session cannot run (§7), and this report does not claim zero vulnerabilities.

## 2. Summary

| ID | Finding | Severity | Blocks activation? | Needs human approval to fix? |
|---|---|---|---|---|
| F-18-01 | Three ungated CLI paths open a read-write handle on the live DB; `--status` permanently migrates the schema as a side effect of a command named "status" | High | **Yes** | Yes |
| F-18-02 | A failed migration can be stamped as applied (swallow-then-stamp), and no test covers the runner | High (latent) | **Yes** | Yes |
| F-18-03 | The tamper-evident audit chain is inert while every consumer still treats it as present; one branch is explicitly fail-open | High | **Yes** | Yes |
| F-18-13 | `--configure` / `--pick-model` are not activation-gated yet can write credentials, treasury limits, `maxChildren` and RPC/relay URLs into `automaton.json` | High | **Yes** | Yes |
| F-18-04 | Permanent `critical` health feeds a `shouldWake:true` loop | Medium | Yes (until 01/03 close) | Yes |
| F-18-08 | The entire security layer is untracked in git — no review trail, no rollback, no integrity baseline for the code that enforces the gates | Medium | **Yes** | Yes |
| F-18-14 | Credential-at-rest protection rests on an NTFS ACL that remains unverified | Medium (unverified) | Assessment only | No (read-only check needs elevation) |
| F-18-05 | Two invariant-board rows are structurally unsatisfiable — permanently red on a healthy system | Medium | No | Yes (code) |
| F-18-06 | Health reclassification keys off another module's error prose | Medium | No | Yes (code) |
| F-18-07 | `EMPTY` verdict used for absent sources, contradicting the project's own rule; a test now asserts the wrong value | Low/Medium | No | Yes (code + test) |
| F-18-10 | `rotate_audit_seal` is declared but never dispatched; the real seal write bypasses `classifyRepair` | Low | No | Yes (code) |
| F-18-09 | The wallet-creation approval gate exists only in the launcher, not in `src/` | Low | No | Yes (code) |
| F-18-11 | `MIGRATION_V10` lacks `IF NOT EXISTS` — a re-run after a lost version row fails hard instead of converging | Low | No | Yes (code) |
| F-18-12 | `PRAGMA user_version` is 0 while the version lives in a table; read-only WAL readers touch `state.db-shm` | Info/Low | No | No |

## 3. The invariants held — re-measured, not quoted

Read from the live file and the live process during this audit, not from an earlier report:

| Invariant | Required | Measured | Evidence |
|---|---|---|---|
| `security.lockdown` | true | **true** | `automaton.json` read over a verified `HOME` |
| `security.activationApproved` | false | **false** | same |
| `security.allowedTools` | `[]` | **`[]`** | same |
| `allowFinancialTools` / `allowHostShell` / `allowSelfModification` / `allowReplication` / `allowExternalExposure` | false | **all false** | same |
| `maxChildren` | 0 | **0** | same |
| `selfHealingEnabled` | false | **key absent** → effective false via `DEFAULT_SECURITY_CONFIG` | [src/config.ts:192](file:///<repo-root>/src/config.ts#L192); the console labels it a code default, not an operator choice |
| Treasury limits | 0 | **every field 0** (`maxSingleTransferCents` … `requireConfirmationAboveCents`) | same |
| Credentials | none entered | `openaiApiKey`, `anthropicApiKey`, `conwayApiKey` present as **zero-length strings** — no value, no secret | same; consistent with Phase 16 A.2 `PENDING CREDENTIAL APPROVAL` |
| Wallet | none created | **no `wallet.json`** on disk | §2 of the audit report |
| Config integrity | unchanged by this audit | sha256 `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d`, mtime `2026-10-31T10:56:18.616Z` — **identical before and after** | `sha256sum` |
| Database integrity | unchanged by this audit | 512 000 B, mtime `2026-10-31T10:25:59.744Z` — **identical before and after**; `integrity_check` = `ok` | `fs.statSync` + read-only pragma |
| Agent process | not running | **no `src/index.ts` process**; the only two Conway `node.exe` are the dashboard tsx parent (22824) and its server child (22936) | `Get-CimInstance Win32_Process` |
| Network exposure | loopback only | `127.0.0.1:8787` open; **`<host-lan-ip>:8787` connection refused**; server refuses to boot if `HOST !== "127.0.0.1"` ([dashboard/server/index.ts:65-72](file:///<repo-root>/dashboard/server/index.ts#L65)) | positive `/dev/tcp` probes + code |
| Persistence on the host | none | no Windows service, no scheduled task matching conway/automaton | `Get-Service`, `Get-ScheduledTask` |

The activation gate itself is a genuine dual control
([src/security/activation.ts:31-51](file:///<repo-root>/src/security/activation.ts#L31)):
`config.security.activationApproved !== true` refuses **and** `env[ACTIVATION_ENV_VAR] !== ACTIVATION_ENV_VALUE`
refuses, so neither the file alone nor the environment alone can start the runtime.

## 4. High findings in detail

### F-18-01 — Ungated CLI paths migrate the live database (High, activation-blocking)

Four call sites open a **read-write** handle, and `createDatabase` runs `applyMigrations` inside every
one of them ([src/state/database.ts:101-107](file:///<repo-root>/src/state/database.ts#L101)):

| Path | Gate | Reaches `createDatabase` at |
|---|---|---|
| `--init` | `requireActivation` [src/index.ts:121](file:///<repo-root>/src/index.ts#L121) | — |
| `--provision` | `requireActivation` [src/index.ts:143](file:///<repo-root>/src/index.ts#L143) | — |
| `--setup` | `requireActivation` [src/index.ts:160](file:///<repo-root>/src/index.ts#L160) | via wizard |
| `--run` | `checkActivation` [src/index.ts:232](file:///<repo-root>/src/index.ts#L232), before `getWallet()` at `:257` | [src/index.ts:267](file:///<repo-root>/src/index.ts#L267) |
| **`--status`** | **none** [src/index.ts:154](file:///<repo-root>/src/index.ts#L154) | [src/index.ts:199](file:///<repo-root>/src/index.ts#L199) |
| **`--pick-model`** | **none** [src/index.ts:166](file:///<repo-root>/src/index.ts#L166) | [src/setup/model-picker.ts:34](file:///<repo-root>/src/setup/model-picker.ts#L34) |
| **`--configure`** | **none** [src/index.ts:172](file:///<repo-root>/src/index.ts#L172) | [src/setup/configure.ts:220](file:///<repo-root>/src/setup/configure.ts#L220) |

**Impact.** An operator who runs `--status` to "just check" applies V12 and V13 to the live file
irreversibly — there is no down-migration anywhere in `src/state/` (migration readiness §2). **The
documentation actively encourages this**: [docs/WINDOWS_OPERATIONS_GUIDE.md:62](file:///<repo-root>/docs/WINDOWS_OPERATIONS_GUIDE.md#L62)
lists `node dist/index.js --status    # read-only snapshot, exit 0`, and `:102` repeats the command. The
one property the comment asserts is the one the implementation does not have. The dashboard's own source
comment already names the hazard
([dashboard/server/sources.ts:39](file:///<repo-root>/dashboard/server/sources.ts#L39)),
which is why the console uses a reader-only handle.

**Containment, verified rather than assumed.** `requireConwayHome()` is the *first* statement of
`main()` ([src/index.ts:87](file:///<repo-root>/src/index.ts#L87)), before any dispatch,
so an ungated path cannot migrate a stray state tree — the canonical-HOME rule (§3) holds on all
three. `integrity_check` runs before any DDL
([src/state/database.ts:95-98](file:///<repo-root>/src/state/database.ts#L95)), so a
corrupt file is not migrated. `--pick-model` and `--configure` additionally require an existing config
([src/setup/model-picker.ts:28](file:///<repo-root>/src/setup/model-picker.ts#L28),
[src/setup/configure.ts:314-318](file:///<repo-root>/src/setup/configure.ts#L314)).
`--status` itself issues only reads after the open.

**Not a claim of intent.** Nobody designed "status" to be a migration trigger; it is an artifact of
`createDatabase` doing both jobs. That is exactly why it is rated High: the dangerous side effect is
invisible from the command name.

### F-18-02 — A failed migration can be recorded as applied (High, latent)

[src/state/database.ts:625-629](file:///<repo-root>/src/state/database.ts#L625):

```ts
{ version: 11,
  apply: () => { try { db.exec(MIGRATION_V11); } catch { /* column may already exist */ } } },
```

followed by the transactional stamp at
[database.ts:640-647](file:///<repo-root>/src/state/database.ts#L640). The catch is
unbounded: it swallows lock violations and disk errors, not only `duplicate column name`, and version 11
is then written as if applied. The row, not the schema, becomes the source of truth — the same design
error as the `INSERT OR REPLACE … VALUES (13, …)` fallback at
[database.ts:110-118](file:///<repo-root>/src/state/database.ts#L110), which asserts
version 13 without checking that any V13 table exists and discards the original `applied_at`.

**Calibration.** It is **not currently lying**: `PRAGMA table_info(children)` returns `chain_type` as
the 13th column, so V11's effect genuinely exists. The defect is latent. **No test covers it** —
`grep -rl "applyMigrations\|MIGRATION_V11" src/__tests__ dashboard/tests` returns nothing, so none of
the 2 057 passing tests would notice the failure mode. V12/V13 would be this runner's first real use
on the live file, which is why the fix belongs *before* the apply, not after.

### F-18-03 — The audit chain is inert while every consumer treats it as present (High)

The chain's tables (`security_events`, `security_seals`) do not exist in the live file, yet the code
that depends on them does not distinguish "no trail" from "trail is clean".

| Site | Behaviour today | Why it matters |
|---|---|---|
| [src/security/emergency-stop.ts:84-90](file:///<repo-root>/src/security/emergency-stop.ts#L84) | `if (!hasEvents) return false;` — **absence of the audit trail is reported as "the emergency stop is not engaged"** | fail-**open** on the branch the live V11 database actually takes |
| [emergency-stop.ts:98](file:///<repo-root>/src/security/emergency-stop.ts#L98) | `catch { return true; }` — fail-**closed** | the *deliberate* missing-table branch is weaker than the *accidental* one |
| [src/security/audit-chain.ts:165-185](file:///<repo-root>/src/security/audit-chain.ts#L165) | `tryAppendSecurityEvent` swallows, logs, returns `null` | every durable security record is silently dropped |
| [src/security/tool-authorizer.ts:191](file:///<repo-root>/src/security/tool-authorizer.ts#L191) | `decide()` calls it and **ignores the `null`** for every allow/deny | authorization decisions are made with no durable record that they were made |
| [src/reliability/mechanic.ts:244](file:///<repo-root>/src/reliability/mechanic.ts#L244) | seal append result unchecked | repairs would be reported "applied" with no record of having been applied |

The project's own comment in `audit-chain.ts` says the swallow previously made the chain "look like a
compensating control when the `security_events` table was simply absent — which is the state of a
schema V11 database". **That condition is the current production state.** This is the single most
consequential finding of the audit, because it is the case the mandate calls out explicitly: absence
of data being represented as a successful result. The console never does this (§6); the runtime does.

Two measured facts raise the stakes rather than lower them. First, the stop is enforced at the real
choke point: tool dispatch consults `isEmergencyStopActive(context.db?.raw)` under a comment saying
"Emergency stop halts all tool execution, regardless of permissions or policy… checked here so a denial
cannot be bypassed by an in-process dispatch that skips the heartbeat daemon"
([src/agent/tools.ts:3434-3437](file:///<repo-root>/src/agent/tools.ts#L3434)), and the
daemon checks it before every tick ([src/heartbeat/daemon.ts:121,140](file:///<repo-root>/src/heartbeat/daemon.ts#L121)).
Second, the denial that choke point tries to record — a HIGH `tool.denied` event with
`reasonCode: EMERGENCY_STOP` — is handed to `tryAppendSecurityEvent` at
[tools.ts:3439-3446](file:///<repo-root>/src/agent/tools.ts#L3439), the call that
silently returns `null` on this database. **The system can halt itself and keep no record that it did.**

### F-18-13 — The config surface can change §29 invariants without passing the activation gate (High)

`--configure` ([src/index.ts:172](file:///<repo-root>/src/index.ts#L172)) and
`--pick-model` (`:166`) are the only *mutating* CLI commands with **no** `requireActivation` call, while
the wizard that does the same job (`--setup`, `:160`) is gated. What `--configure` can write, and where
each lands in the §29 prohibition list:

| Prompt | Source | §29 item it touches |
|---|---|---|
| OpenAI / Anthropic API key | [src/setup/configure.ts:206-207](file:///<repo-root>/src/setup/configure.ts#L206) | **6 — entering real API credentials** |
| Ollama base URL | `:208` | 11 (endpoint reachability) |
| Hourly / session / per-call budget ceilings | [`:245-257`](file:///<repo-root>/src/setup/configure.ts#L245) | 9 — financial limits |
| Max single/hourly/daily transfer, minimum reserve, max x402 payment, confirmation threshold | [`:278-284`](file:///<repo-root>/src/setup/configure.ts#L278) | 9 — financial tools |
| `maxChildren` | [`:304`](file:///<repo-root>/src/setup/configure.ts#L304) | 10 — replication |
| `socialRelayUrl`, `rpcUrl` | [`:305-306`](file:///<repo-root>/src/setup/configure.ts#L305) | 11 — external exposure |

Every menu choice then calls `saveConfig(config)`
([configure.ts:329-344](file:///<repo-root>/src/setup/configure.ts#L329)), which
rewrites `automaton.json` in full ([src/config.ts:180-197](file:///<repo-root>/src/config.ts#L180)).
`--pick-model` writes `config.inferenceModel` and saves
([src/setup/model-picker.ts:76-80](file:///<repo-root>/src/setup/model-picker.ts#L76)).

**Honest scoping — what this is and is not.** It is *not* "the agent altered its own gates": every one
of these paths needs a human typing at a TTY, so it does not violate "do not alter these invariants
automatically", and the measured file still shows all invariants intact (§3). It **is** a governance
asymmetry: the approval gate the mandate treats as the human control over the whole runtime does not
cover the commands that can set credentials, spend limits, replication fan-out and endpoints. The
`lockdown` / `activationApproved` / `allowedTools` fields themselves are **not** editable here
(`grep` over `src/setup/*` finds no assignment to them; `maxChildren` is the only invariant with a
prompt), so the gate cannot be flipped through this surface — only loosened around it.

Two secondary side effects on the same ungated paths: both open the write handle (F-18-01), and both
contact Ollama over HTTP when `OLLAMA_BASE_URL`/`config.ollamaBaseUrl` is set
([model-picker.ts:43](file:///<repo-root>/src/setup/model-picker.ts#L43),
[configure.ts:224-228](file:///<repo-root>/src/setup/configure.ts#L224) →
[src/ollama/discover.ts:46](file:///<repo-root>/src/ollama/discover.ts#L46)). That
contact is a read of a local endpoint with a 5 s timeout; the mandate's "do not modify Ollama"
constraint is not breached, but the audit records that an unapproved command reaches out to another
runtime.

## 5. Medium findings

**F-18-04 — permanent critical feeding a wake loop.** The chain is: `security_events` absent →
`verifySecurityChain()` throws → `checkAuditChain` catch returns `status:"fail"`
([src/reliability/health-guardian.ts:172-179](file:///<repo-root>/src/reliability/health-guardian.ts#L172))
→ `report.overall === "critical"` → `health_guardian` returns `{shouldWake:true}`
([src/heartbeat/tasks.ts:735-742](file:///<repo-root>/src/heartbeat/tasks.ts#L735)).
On a V11 database this is unsatisfiable, so the wake condition is permanently true. **Contained today
by two independent facts**: `health_guardian` and `security_monitor` are not in
`runtime/home/.automaton/heartbeat.yml` (six entries, neither of them), and `heartbeat_schedule` has
**0 rows** while the scheduler gates on `row.enabled`
([src/heartbeat/scheduler.ts:126](file:///<repo-root>/src/heartbeat/scheduler.ts#L126)).
Activating the agent *and* scheduling the guardian without closing F-18-01/03 would produce a
self-waking loop that never converges.

**F-18-05 — the invariant board can never go green.** [dashboard/server/panels/ops.ts:154](file:///<repo-root>/dashboard/server/panels/ops.ts#L154) compares required `"127.0.0.1"`
against observed `"127.0.0.1:8787"`; `:155` compares required `"disabled"` against `String(false)` =
`"false"`. `value()` returns VERIFIED only on a case-insensitive exact match
([ops.ts:141-145](file:///<repo-root>/dashboard/server/panels/ops.ts#L141)), so both
print NOT VERIFIED *on a healthy system*, while the same bind fact prints VERIFIED at
[ops.ts:183](file:///<repo-root>/dashboard/server/panels/ops.ts#L183). Two
permanently-red rows on the board an operator glances at train them to ignore the board — which is
how a real red row gets missed.

**F-18-06 — reclassification keyed to another module's prose.** [dashboard/server/panels/safety.ts:112](file:///<repo-root>/dashboard/server/panels/safety.ts#L112)
matches `/no such table:\s*([a-z_]+)/i` against `check.message`. It works for `audit_chain` and fails
for `treasury_reservations`, whose catch message is the paraphrase `"treasury table unavailable"`
([src/reliability/health-guardian.ts:210](file:///<repo-root>/src/reliability/health-guardian.ts#L210))
— same root cause, different wording, so it stays in the headline. Measured result: recomputed overall
`"degraded"` where the honest answer is "ok, two controls have no source yet". The fix belongs in the
guardian (a `not_verified` status at the source), not in a longer regex.

**F-18-08 — the security layer is untracked.** `git ls-files src/security src/runtime` returns
**empty**; HEAD is `d8f8168` (2026-08-26, "it's beautiful"); `git status --porcelain` shows 40 modified
+ 35 untracked, including all 11 `.bat` wrappers, `config/` and `dashboard/`. The activation gate, the
wallet crypto, the emergency stop and the tool authorizer therefore have no review history, no diff to
audit against, no rollback target and no integrity baseline. Phase 17's own console flags this on the
Safety panel ([safety.ts:66](file:///<repo-root>/dashboard/server/panels/safety.ts#L66),
"CONTRACT UNPINNED — these files are untracked in git"), so the dashboard is telling the truth about
its own weakest point. For a system whose security model is "the code enforces the gates", unversioned
gate code is a Medium finding in its own right.

**F-18-14 — credential-at-rest rests on an unverified ACL.** `saveConfig` requests `mode: 0o600` for
the file and `0o700` for the directory
([src/config.ts:183-196](file:///<repo-root>/src/config.ts#L183)), and keys would be
stored **as plaintext JSON fields** — there is no encryption for `openaiApiKey` / `anthropicApiKey`
anywhere in `src/config.ts` (Phase 15B encrypted the *wallet*, not the config). Measured: the live
`automaton.json` reports mode `666`. **That measurement proves nothing about NTFS permissions** —
libuv synthesises Windows file modes from the read-only attribute, so `666` is not evidence of a
world-writable ACL, just as `600` would not be evidence of a private one. The effective protection is
the directory ACL, and reading it requires `icacls`, which this unprivileged session cannot run: the
Phase 16 R-15 item stays **UNVERIFIED**. Recorded as an assessment gap, not as a proven weakness. No
secret was exposed by this audit: the three credential fields measured zero-length strings, and a
pattern scan over `reports/`, `docs/` and `runtime/home/.automaton` for
`sk-…`/`sk-ant-…`/`BEGIN PRIVATE KEY` returned **no matching files**.

## 6. Low, informational, and the dashboard-accuracy set

**F-18-07 — `EMPTY` used for absence (three instances).** [ops.ts:32](file:///<repo-root>/dashboard/server/panels/ops.ts#L32)
labels a **non-existent** PID file `EMPTY`;
[core.ts:79-80](file:///<repo-root>/dashboard/server/panels/core.ts#L79) labels
`logs/` `EMPTY` with the note "NO DATA — the runtime has never been launched" when the directory
**does not exist at all** (measured: `ls: cannot access 'runtime/home/.automaton/logs/'`); and
[core.ts:211-212](file:///<repo-root>/dashboard/server/panels/core.ts#L211)
returns `empty(false, …)` when neither SOUL.md path exists **and** `soul_history` has 0 rows — a
composite of one legitimate counted zero and one absence, rendered as the weaker of the two. The
project's own rule says an absent source is NOT VERIFIED
([types.ts:36-38](file:///<repo-root>/dashboard/server/panels/types.ts#L36)). Tests now
assert the wrong values ([dashboard/tests/panel-verdicts.test.ts:149-152](file:///<repo-root>/dashboard/tests/panel-verdicts.test.ts#L149):
`Activity logs` → EMPTY, `Soul / persona` → `false`), so the suite would resist the correct fix — the
tests must change with the code rather than be left to defend the bug.

**F-18-09 — wallet-creation approval is launcher-layered.** `CONWAY_ALLOW_WALLET_CREATION=APPROVED` is
enforced at [runtime/bin/preflight.mjs:82-91](file:///<repo-root>/runtime/bin/preflight.mjs#L82),
invoked only from [START_CONWAY.bat:42](file:///<repo-root>/START_CONWAY.bat#L42)
(the variable is set at `:39` after a human types `CREATE-WALLET`). A direct
`node src/index.ts --init` therefore skips that layer. It remains stopped by two layers that *are* in
`src/`: `requireActivation("--init")` ([index.ts:121](file:///<repo-root>/src/index.ts#L121))
and — because no passphrase is available outside the launcher — [src/security/wallet-crypto.ts:318-342](file:///<repo-root>/src/security/wallet-crypto.ts#L318),
which throws `WalletLockedError` unless `CONWAY_WALLET_PASSPHRASE` or `CONWAY_WALLET_PASSPHRASE_FILE`
is set, ahead of the create-when-absent path at [src/identity/wallet.ts:163](file:///<repo-root>/src/identity/wallet.ts#L163).
This corrects an earlier draft of this audit that claimed the variable was enforced nowhere; the
accurate finding is **two real gates plus one launcher gate, not three equal gates**. Rating Low,
because the two `src/` gates hold — but a control that exists only in a `.bat` file is a control an
operator can bypass by remembering the wrong command.

**F-18-10 — one declared repair never runs, and one real write skips the gate.** `rotate_audit_seal` is
in `AUTOMATIC_REPAIRS` ([mechanic.ts:44](file:///<repo-root>/src/reliability/mechanic.ts#L44))
but is never dispatched through `runRepair`; the actual seal append at
[mechanic.ts:244](file:///<repo-root>/src/reliability/mechanic.ts#L244) calls
`tryAppendSecuritySeal` directly, outside `classifyRepair` and outside the `confirm` hook. The one
security-surface mutation the mechanic performs is the one that bypasses the gate that exists to guard
it.

**F-18-11 — V10 is not idempotent.** `MIGRATION_V10` uses `CREATE TABLE knowledge_store` **without**
`IF NOT EXISTS` ([src/state/schema.ts:665](file:///<repo-root>/src/state/schema.ts#L665)).
If a `schema_version` row were ever lost while the table survived, the re-run throws and
`createDatabase` fails hard instead of converging. V12/V13 do not share this flaw (every statement is
`IF NOT EXISTS`).

**F-18-12 — versioning is invisible to external tooling, and "read-only" is not write-free.**
`PRAGMA user_version` is 0 while the version lives only in `schema_version`. Any external tool
inspecting the file sees an unversioned database. Separately, the console's read-only WAL connections
do update `state.db-shm` (32 768 B, mtime moved to the audit window) — expected SQLite behaviour, but
it means "the dashboard never writes" is true of the *database content* and false of the *sidecar
files*; worth stating so nobody treats an `-shm` mtime as evidence of a state change.

## 7. Controls that were verified working

Listed because a findings register that only records failures is misleading.

| Control | Verification |
|---|---|
| Loopback-only binding | Code refuses any other `HOST` and checks FORBIDDEN_PORTS ([dashboard/server/index.ts:65-72](file:///<repo-root>/dashboard/server/index.ts#L65)); positive Wi-Fi-interface probe refused |
| Dashboard authentication | Peer-bound in-memory sessions, HttpOnly + SameSite=Strict cookie, CSRF via `isTrustedRequest`, token-bucket rate limits, 8 KiB body cap ([routes.ts:105-122](file:///<repo-root>/dashboard/server/routes.ts#L105), `:18`) |
| Secret redaction | Settings panel renders credential fields as `configured / not configured` only and never serialises a value ([ops.ts:173,194-200](file:///<repo-root>/dashboard/server/panels/ops.ts#L173)); word-based redaction layer exists ([dashboard/server/redact.ts:1](file:///<repo-root>/dashboard/server/redact.ts#L1)); console audit writer redacts structurally before write |
| No dashboard write surface | `saveConfig`, `syncHeartbeatToDb` and `applyMigrations` are declared NOT APPLICABLE by design ([ops.ts:212-218](file:///<repo-root>/dashboard/server/panels/ops.ts#L212)) and the dashboard never imports `src/state/database.ts` — enforced by import ([dashboard/tests/danger-imports.test.ts:24](file:///<repo-root>/dashboard/tests/danger-imports.test.ts#L24)) |
| Canonical HOME | `requireConwayHome()` is the first statement of `main()`; this audit asserted `process.env.HOME` inside every Conway Node process |
| Mechanic default-deny | Unknown repair ids fall through to `forbidden` ([mechanic.ts:94-97](file:///<repo-root>/src/reliability/mechanic.ts#L94)); 15 forbidden patterns are defence-in-depth, not the primary control; execution requires `selfHealingEnabled === true \|\| allowRepairs === true` with a triple emergency-stop check |
| Dual activation | Both the config flag and the environment value are required (§3) |
| Pre-DDL integrity gate | `integrity_check` before any DDL ([database.ts:95-98](file:///<repo-root>/src/state/database.ts#L95)) |
| Test suite | Root: 82 files / 2 057 tests / **0 failed** (88.52 s). Dashboard: 10 files / 97 tests / **0 failed** (3.71 s) |

## 8. "Does missing data ever appear as success?" — the direct answer

**In the dashboard: no.** All 73 verdict-bearing cells were walked; the 34 non-VERIFIED ones were each
traced to the code that produced them and the live datum behind them. No cell renders VERIFIED over an
absent source, and the absent-source rule is implemented as written
([types.ts:36-38](file:///<repo-root>/dashboard/server/panels/types.ts#L36)). The
weakest edge is honest-but-ambiguous: `wallet_storage` reports guardian `pass` with the message "no
wallet on disk" — true, but a pass meaning "there is nothing here to protect" reads close to "wallet
storage is healthy".

**In the runtime: yes — F-18-03.** `isEmergencyStopEngagedInDb` returning `false` for an absent
`security_events` table is precisely "missing data represented as a good result", and it is the control
that is supposed to be the last line of defence.

## 9. What this register does not cover

- Elevated Windows posture (`icacls`, Defender, firewall, BitLocker protection state) — **UNVERIFIED**,
  carried from Phase 16; not re-attempted because this session is unprivileged and the mandate forbids
  touching Windows security settings. The exact read-only commands are prepared in the remediation plan.
- Real-data restore — **NOT YET PROVABLE**; the row census (38 of 39 tables empty) explains why exactly.
- Live-model testing — **PENDING CREDENTIAL APPROVAL**; no credential was read, entered or printed.
- Coverage measurement (`@vitest/coverage-v8` not installed) and browser E2E — not run.
- No penetration re-run beyond the two connection probes.
- Nothing here is described as "zero vulnerabilities", and no risk is marked resolved without a fresh
  measurement taken in this session.

## 10. Amendments to `PHASE_18_AUDIT.md`

Recorded rather than silently folded in, so the earlier pass stays retrievable:

1. §3 and §8 of the audit report describe `--status` as *the* ungated path that migrates. **Widened**:
   `--pick-model` and `--configure` reach `createDatabase` too (F-18-01 table above). The audit's
   conclusion is unchanged — the practical apply path is ungated — the enumeration was incomplete.
2. New finding **F-18-13** (config surface not activation-gated) and **F-18-14** (credential at-rest
   ACL unverified) were established after that report was written, by the re-verification pass done for
   this register.
3. **F-18-07 has a third instance.** The audit report §6 names two (`ops.ts:32` PID file, `core.ts:211`
   SOUL.md). Re-verification for this register found `logs/` treated the same way at
   [core.ts:79-80](file:///<repo-root>/dashboard/server/panels/core.ts#L79), and measured
   that the directory does not exist.
4. **`--status` is documented as read-only.** [docs/WINDOWS_OPERATIONS_GUIDE.md:62](file:///<repo-root>/docs/WINDOWS_OPERATIONS_GUIDE.md#L62)
   presents it as "read-only snapshot, exit 0". The audit report did not check the doc against the
   behavior; this register does, and the doc is wrong.
5. The measured `automaton.json` sha256 and mtime and the measured `state.db` mtime are unchanged from
   the audit report, so none of the new work wrote to live state either.
