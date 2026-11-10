# Phase 18 — Post-Phase-17 Read-Only Audit of the Live Installation

Audit executed 2026-11-01, 11:32Z–11:53Z. **Mode: read-only. No migration was executed, no
database row was written, no gate was changed, no wallet was created, the agent was not activated
and self-healing was not enabled.**

Companion deliverables:
[`PHASE_18_MIGRATION_READINESS.md`](PHASE_18_MIGRATION_READINESS.md) ·
[`PHASE_18_SECURITY_FINDINGS.md`](PHASE_18_SECURITY_FINDINGS.md) ·
[`PHASE_18_REMEDIATION_PLAN.md`](PHASE_18_REMEDIATION_PLAN.md) ·
[`PHASE_18_APPROVAL_LIST.md`](PHASE_18_APPROVAL_LIST.md)

---

## 1. Verdict

| Question | Answer |
|---|---|
| Is the installation in the state the dashboard claims? | **Yes** — every §29 invariant and the loopback binding were re-measured and match. |
| Are the dashboard's UNKNOWN / CRITICAL / NOT VERIFIED findings real defects? | **Mostly no.** 34 of 34 non-VERIFIED verdicts were traced. All are correct renderings of absent data **except** five display/reclassification bugs (§6). |
| Is the schema drift (11 vs 13) the root cause of the CRITICAL? | **Yes, and it is not cosmetic.** It disables the tamper-evident audit chain, and it makes the health guardian permanently "critical" — which is a wake-loop trigger if the guardian is ever scheduled (§5, F-18-03, F-18-04). |
| **GO / NO-GO for agent activation** | **NO-GO.** Six items must close first. See §8. |
| **GO / NO-GO for continuing to run the dashboard** | **GO.** Read-only, loopback-only, gate-enforced, and it does not depend on the schema gap. |
| Production-ready? | **No**, and this report does not claim it is. Three blockers are structural (V12/V13 unapplied, security layer untracked in git, audit writes silently dropped) and two are outstanding operator verifications inherited from Phase 16 (elevated Windows posture, real-data restore). |

## 2. What was actually run, and what it returned

Every number below came from a command executed in this session. Nothing is inferred from
documentation.

| Command | Result |
|---|---|
| `PRAGMA integrity_check` (read-only handle) | `ok` |
| `PRAGMA foreign_key_check` | `[]` |
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA user_version` | `0` (the project versions via the `schema_version` table, not this pragma) |
| `SELECT * FROM schema_version` | 10 rows, versions **2…11**, `applied_at` all `2026-10-31 10:25:59` |
| `sqlite_master` object census | 118 objects; 38 tables + `schema_version` |
| Row count over all 39 tables | **1 table non-empty (`schema_version`, 10 rows); 38 tables contain zero rows** |
| `PRAGMA table_info(children)` | 13 columns, **`chain_type` present** → V11's effect really exists |
| Conway root suite (`vitest run`) | **82 files, 2057 tests, 0 failed**, 88.52 s |
| Dashboard suite (`vitest run`) | **10 files, 97 tests, 0 failed**, 3.71 s |
| `sha256sum runtime/home/.automaton/automaton.json` | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` — **unchanged** |
| `state.db` size / mtime | 512 000 B / `2026-10-31T10:25:59.744Z` — **unchanged**, so this audit wrote nothing |
| Live HTTP read of all 12 panels + `/api/system` | **73 verdict-bearing cells**: 39 VERIFIED, 12 EMPTY, 11 UNKNOWN, 7 NOT VERIFIED, 4 NOT APPLICABLE |
| `/dev/tcp/<host-lan-ip>/8787` | **Connection refused** — not reachable on the Wi-Fi interface |
| `/dev/tcp/127.0.0.1/8787` | open — as designed |
| `Get-Service` / `Get-ScheduledTask` filtered on conway/automaton | **empty** — no service, no scheduled task |
| `Get-CimInstance Win32_Process` filtered on `Conway-Automaton` | **exactly two**: pid 22824 (`tsx cli.mjs server/index.ts`) → child pid 22936 (`--require …/preflight.cjs --import …/loader.mjs server/index.ts`). Both on the pinned runtime. **No `src/index.ts` process exists — the agent is not running.** |
| `git ls-files src/security src/runtime` | **empty — the whole security layer is untracked** |
| `git log -1` / `git status --porcelain` | `d8f8168` (2026-08-26, "it's beautiful") / 40 modified + 35 untracked |

One caveat about the environment, restated because it changes how exposure is proved:
**`netstat -an -p tcp` does not list the live 8787 listener at all** on this machine, and
`Get-NetTCPConnection -State Listen` also returns nothing for it. Netstat output must never be used
as evidence of non-exposure here. The `/dev/tcp` connect probe above is the evidence, and it is a
positive test (it attempts the connection) rather than an absence of a listing.

`process.env.HOME` was asserted inside every Node invocation that touches Conway and was
`<repo-root>\runtime\home` each time. Note that the shell's own `$HOME` is
`<user-home>`, so a command that forgets the prefix would silently operate on the
wrong state tree — which is why it is asserted per process rather than assumed.

## 3. A. Database audit — findings

Live schema **11**, code `SCHEMA_VERSION = 13` ([src/state/schema.ts:8](file:///<repo-root>/src/state/schema.ts#L8)).

The four absent tables are created **only** by the two unapplied migrations — they are not in
`CREATE_TABLES` ([src/state/schema.ts:10](file:///<repo-root>/src/state/schema.ts#L10)) — so no code path can materialise them except `applyMigrations`:

| Missing table | Introduced by | What depends on it | Behaviour today |
|---|---|---|---|
| `treasury_authorizations` | V12 [schema.ts:692](file:///<repo-root>/src/state/schema.ts#L692) | `getTreasuryGuard()` — the reservation/commit ledger that makes double-spend detection possible | throws `no such table` |
| `security_events` | V12 [schema.ts:724](file:///<repo-root>/src/state/schema.ts#L724) | the hash-chained audit log; `verifySecurityChain()`; `isEmergencyStopEngagedInDb()` | throws → guardian `audit_chain` **fail** |
| `security_incidents` | V13 [schema.ts:758](file:///<repo-root>/src/state/schema.ts#L758) | `listIncidents`, `incidentSummary`, `checkTamper`, `scanSecurityEvents` | throws |
| `security_seals` | V13 [schema.ts:789](file:///<repo-root>/src/state/schema.ts#L789) | `verifySeals`, `tryAppendSecuritySeal` | throws, swallowed to `null` |

Migration state is tracked in a table, not in `PRAGMA user_version` (which is 0). That is internally
consistent but means any external tool that inspects the file sees an unversioned database — recorded
as F-18-12.

**The single most consequential fact for this audit: the live database contains no application data
at all.** Every table except `schema_version` is empty, and there is no `wallet.json`, no `SOUL.md`,
no `logs/*` file and no `automaton.pid`. This is what makes the dashboard's twelve EMPTY cells and
its zero-entry activity log *correct* rather than broken, and it is the same fact that made Phase 16
record `REAL_DATA_RESTORE = NOT YET PROVABLE`.

Readiness analysis, ordering, dependency and rollback assessment of V12/V13 is in
[`PHASE_18_MIGRATION_READINESS.md`](PHASE_18_MIGRATION_READINESS.md). Headline: **both migrations are
purely additive and backward-compatible, there is no down-migration mechanism anywhere in
`src/state/`, and the only in-tree way to apply them is a command that also happens not to be
activation-gated** (F-18-01).

## 4. B. Security audit — gates held

All §29 invariants re-read from the live config and the live process, not from a report:

`lockdown=true` · `activationApproved=false` · `allowedTools=[]` · `allowFinancialTools=false` ·
`allowHostShell=false` · `allowSelfModification=false` · `allowReplication=false` ·
`allowExternalExposure=false` · `maxChildren=0` · `selfHealingEnabled` **absent** (effective false
via `DEFAULT_SECURITY_CONFIG`, which the console correctly labels a code default rather than an
operator choice).

Dashboard authentication behaves as documented (peer-bound in-memory sessions, HttpOnly
SameSite=Strict cookie, CSRF via `isTrustedRequest`, token-bucket rate limits, 8 KiB body cap). The
audit performed one `POST /api/auth` to read the panels; **the token was read inside the Node
process and never printed, copied or stored** — only its length (43) appears in the transcript. The
side effect is one `auth.success` line in the console's own JSONL audit log; Conway's state tree was
untouched, which the unchanged `state.db` mtime proves.

Findings F-18-01, F-18-03, F-18-08, F-18-09 are the security items. Full severity table in
[`PHASE_18_SECURITY_FINDINGS.md`](PHASE_18_SECURITY_FINDINGS.md).

## 5. D. Self-healing review — architecture is sound, but it is not wired, and its audit trail is inert

The mechanic's design is good where it matters:
`classifyRepair` ([src/reliability/mechanic.ts:75-98](file:///<repo-root>/src/reliability/mechanic.ts#L75))
is **default-deny** — an unknown repair id falls through to `forbidden` at `:94-97`, so the 15
forbidden-text regexes are defence-in-depth rather than the primary control. Execution is gated on
`selfHealingEnabled === true || allowRepairs === true` (`:139-140`) with an emergency-stop triple
check (`:141-144`) and early returns (`:153-160`). `runMechanic` is never imported by the dashboard,
enforced by import ([dashboard/tests/danger-imports.test.ts:24](file:///<repo-root>/dashboard/tests/danger-imports.test.ts#L24)).

Three real gaps, none of which require enabling anything to see:

1. **The guardian and the security monitor are not scheduled.** `runtime/home/.automaton/heartbeat.yml`
   lists six entries (`heartbeat_ping`, `check_credits`, `health_check`, and three disabled ones).
   Neither `health_guardian` [src/heartbeat/tasks.ts:716](file:///<repo-root>/src/heartbeat/tasks.ts#L716)
   nor `security_monitor` [src/heartbeat/tasks.ts:751](file:///<repo-root>/src/heartbeat/tasks.ts#L751)
   is among them, and the `heartbeat_schedule` table has **0 rows** while the scheduler gates on
   `row.enabled` ([src/heartbeat/scheduler.ts:126](file:///<repo-root>/src/heartbeat/scheduler.ts#L126)).
   So Phase 15F/15G is unreachable in this install. That is why nothing has gone wrong yet — and it is
   also why none of it has ever been exercised against live state.
2. **Its own bookkeeping is silently dropped.** `tryAppendSecurityEvent`
   ([src/security/audit-chain.ts:165-185](file:///<repo-root>/src/security/audit-chain.ts#L165))
   returns `null` on failure and `runMechanic` ignores the result, so on a V11 database the mechanic
   would report repairs "applied" with **no** durable record of having applied them. Its own comment
   says this previously made the chain "look like a compensating control when the `security_events`
   table was simply absent". The condition it describes is the current production state.
3. **The seal write bypasses the classifier.** `rotate_audit_seal` is declared automatic at
   [mechanic.ts:44](file:///<repo-root>/src/reliability/mechanic.ts#L44) but is
   never dispatched; the real seal append at
   [mechanic.ts:244](file:///<repo-root>/src/reliability/mechanic.ts#L244) calls
   `tryAppendSecuritySeal` directly, outside `runRepair` → `classifyRepair` → `confirm`. The one
   security-surface mutation the mechanic performs is the one that skips the gate.

Self-healing was **not** enabled and no repair was executed during this audit.

## 6. C. Dashboard accuracy — every non-VERIFIED verdict, classified

73 cells measured. 34 were non-VERIFIED. Each was traced to the code that produced it and to the
live datum behind it.

**Correct-by-design (29 cells)** — the source is genuinely absent or genuinely zero, and the console
says so instead of inventing a result:

| Group | Cells | Why it is right |
|---|---|---|
| Agent state / turn count / process identity | 4 | No agent process exists and `getAgentState()` would return the *code default* `'setup'`; [core.ts:118](file:///<repo-root>/dashboard/server/panels/core.ts#L118) refuses to display a default as an observation. 32 `node.exe` are visible but tasklist yields image names only, so none can be attributed. |
| EMPTY across 24 tables + `kv` + activity logs | 12 | Proven by the row census: the tables exist and contain 0 rows. `EMPTY` ≠ `UNKNOWN` is doing real work here. |
| Wallet address / balance / chain type | 3 | No `wallet.json`; `getWalletChainType()` returns `"evm"` as a default with no wallet, so it is not called ([sources.ts:171](file:///<repo-root>/dashboard/server/sources.ts#L171)). |
| Declared model / latency / token cost | 3 | `"gpt-5.2"` is declared and never invoked; no inference has run, so there is no latency to report. |
| V12/V13 table readers (ledger, seals, incidents, corroboration) | 4 | [types.ts:36](file:///<repo-root>/dashboard/server/panels/types.ts#L36) "absent → NOT VERIFIED, never a FAIL and never a zero" — implemented exactly. |
| ACLs, backup hashing, contract pinning, config-as-behaviour | 4 | The console does not shell out for ACLs; hashing every archive per poll would be slow; the git claim is true (§2); a file at rest does not prove a process read it. |

**Defects (5)** — all in code written by this project's own phases; none is a security hole, three
degrade the operator's ability to read the board:

1. **Two gate-board rows can never be VERIFIED.** [ops.ts:154](file:///<repo-root>/dashboard/server/panels/ops.ts#L154) compares required `"127.0.0.1"` against observed `"127.0.0.1:8787"`; [ops.ts:155](file:///<repo-root>/dashboard/server/panels/ops.ts#L155) compares required `"disabled"` against `String(false)` = `"false"`. Both print NOT VERIFIED *on a healthy system*, and the identical bind fact prints VERIFIED five lines of code away at [ops.ts:183](file:///<repo-root>/dashboard/server/panels/ops.ts#L183). The board is the thing an operator glances at; two permanently-red rows train them to ignore it.
2. **Reclassification keys off another module's error prose.** [safety.ts:112](file:///<repo-root>/dashboard/server/panels/safety.ts#L112) matches `/no such table:\s*([a-z_]+)/i` against `check.message`. For `audit_chain` it works. For `treasury_reservations` — same missing-table root cause, different catch message `"treasury table unavailable"` ([health-guardian.ts:210](file:///<repo-root>/src/reliability/health-guardian.ts#L210)) — it does not match, so the check stays in the headline. Result: recomputed overall is `"degraded"` when the honest answer is `"ok, two controls have no source yet"`.
3. **`EMPTY` used for absence.** [ops.ts:32](file:///<repo-root>/dashboard/server/panels/ops.ts#L32) labels a **non-existent** PID file `EMPTY`, and [core.ts:211](file:///<repo-root>/dashboard/server/panels/core.ts#L211) does the same for a missing `SOUL.md`. Both contradict `types.ts:36`. A test now asserts the wrong value (`panel-verdicts.test.ts` checks Soul `value === false`), so the suite would resist the correct fix.
4. **Health "CRITICAL" is faithfully displayed, which is the right call — but the reason is undocumented in the panel.** Raw overall = `critical`, source = `audit_chain` failing on an absent table, *not* a security finding. The panel does say this in the reclassified row; the finding is that the guardian itself should distinguish `not_verified` from `fail` at the source rather than leaning on the console's regex (defect 2).
5. **`VERIFIED` ≠ `HEALTHY` is honoured, with one weak edge.** No cell renders VERIFIED over the literal value "UNKNOWN" (invariant re-checked across all 73). The weak edge: `wallet_storage` reports guardian `pass` with message "no wallet on disk". True, but a pass that means "there is nothing here to protect" is close to reading as "wallet storage is healthy".

**Answer to "does missing data ever appear as success?"** In the console: **no** — this audit found
no instance of absence being rendered as a good result. In the *runtime*: **yes**, and that is the
most serious finding of the audit — F-18-03, where `isEmergencyStopEngagedInDb`
([emergency-stop.ts:85-90](file:///<repo-root>/src/security/emergency-stop.ts#L85))
returns `false` when `security_events` is absent, i.e. *absence of the audit trail is reported as
"the emergency stop is not engaged"*. Note the asymmetry: its `catch` branch returns `true`
(fail-closed) but the deliberate missing-table branch returns `false` (fail-open) — and the
missing-table branch is the one the live V11 database takes.

## 7. Specialist review

Mandate `m-mvxr6xgc-rut3` required two independent specialists; both were invoked once and their
findings are incorporated above and in the security document. Two of their corrections changed my
drafts and are reflected here:

- I had written that `database.ts:110` reads the version *before* migrations run. It does not —
  `applyMigrations` is called at `:107` and `MAX(version)` is read after. The masking hazard is
  still real, the mechanism is as stated in the migration readiness document.
- The claim that `CONWAY_ALLOW_WALLET_CREATION` is enforced nowhere was **wrong**: it is enforced in
  `runtime/bin/preflight.mjs:84`, invoked from `START_CONWAY.bat:42`. The accurate finding is that
  the enforcement is *launcher-only* and absent from `src/`, so a direct `node src/index.ts --init`
  skips that layer while still being stopped by two others (F-18-09).

## 8. GO / NO-GO for the next phase

**NO-GO for agent activation.** **GO for applying V12/V13 under explicit approval**, sequenced first.

Before `activationApproved` is ever set true, these must be closed, in order:

1. Apply V12/V13 and verify all four tables **and their append-only triggers** exist (F-18-03, F-18-04 all become unreachable once the tables exist).
2. Fix the swallow-then-stamp pattern at [database.ts:627](file:///<repo-root>/src/state/database.ts#L627) and add the test that currently does not exist (F-18-02).
3. Make absent-table fail **closed** in `isEmergencyStopEngagedInDb`, and make a dropped audit append a hard failure on HIGH/CRITICAL events (F-18-03).
4. Commit `src/security/**`, `src/runtime/**`, `config/`, the `.bat` wrappers and `dashboard/` under review, then tag (F-18-08).
5. Correct the five dashboard display defects so the invariant board can be trusted (F-18-05/06/07).
6. Keep `health_guardian` unscheduled until 1–3 are done, then schedule it and *observe* one cycle before trusting `shouldWake`.

Everything in that list is a code or configuration change to a running system and therefore requires
human approval — see [`PHASE_18_APPROVAL_LIST.md`](PHASE_18_APPROVAL_LIST.md).

**This audit performed none of them.** Its writes were: one console audit line, the Phase 18 report
files (five deliverables plus `PHASE_18_PROGRESS.md`, all hashed in that record), and one documentation
**append** to `docs/README.md` — a new Phase 18 section, with no existing row or claim rewritten.

## 9. What this audit did not and cannot cover

- No elevated Windows verification (R-15 `icacls`, Defender/firewall/BitLocker posture) — still
  **UNVERIFIED**, carried from Phase 16, not re-attempted because this session is unprivileged and
  because the mandate forbids touching Windows security settings.
- No real-data restore — still **NOT YET PROVABLE**; the row census in §2 explains why exactly:
  there is no data to restore.
- No live-model testing — still **PENDING CREDENTIAL APPROVAL**; no credential was read, entered or
  printed.
- No coverage measurement (`@vitest/coverage-v8` is not installed) and no browser E2E harness.
- No penetration re-run against the running console beyond the two connection probes above.
- Absence of evidence is treated throughout as absence of proof, never as proof of absence.
  Nothing in this report is described as "zero vulnerabilities", and no risk is marked resolved
  without a fresh measurement.

## 10. Amendment — written after §1–§9, same session, still read-only

A citation-verification pass done while assembling
[`PHASE_18_SECURITY_FINDINGS.md`](PHASE_18_SECURITY_FINDINGS.md) re-checked every line reference above
and found three things this report got incomplete or wrong. They are recorded here rather than edited
into §1–§9 so the earlier pass stays retrievable; the findings register §10 lists them in full.

1. **§3 and §8 named only `--status` as the ungated path that migrates.** Widened: `--pick-model`
   ([src/index.ts:166](file:///<repo-root>/src/index.ts#L166) →
   [src/setup/model-picker.ts:34](file:///<repo-root>/src/setup/model-picker.ts#L34))
   and `--configure`
   ([src/index.ts:172](file:///<repo-root>/src/index.ts#L172) →
   [src/setup/configure.ts:220](file:///<repo-root>/src/setup/configure.ts#L220))
   reach `createDatabase` too. The conclusion is unchanged; the enumeration was short.
2. **Two new findings.** F-18-13: `--configure` can write API keys, treasury limits, `maxChildren` and
   RPC/relay URLs into `automaton.json` with no activation gate — §29 items 6/9/10/11 — while the
   equivalent wizard (`--setup`) is gated. F-18-14: credential-at-rest protection rests on an NTFS ACL
   this unprivileged session cannot read (`icacls` remains UNVERIFIED from Phase 16 R-15).
3. **The docs encourage the F-18-01 accident.**
   [docs/WINDOWS_OPERATIONS_GUIDE.md:62](file:///<repo-root>/docs/WINDOWS_OPERATIONS_GUIDE.md#L62)
   describes `node dist/index.js --status` as a "read-only snapshot, exit 0". §6 defect 3 of this report
   also has a third instance: `logs/` is rendered EMPTY at
   [dashboard/server/panels/core.ts:79-80](file:///<repo-root>/dashboard/server/panels/core.ts#L79)
   although the directory does not exist at all.

Nothing in this amendment wrote to live state: `automaton.json` still hashes to
`1c10ecc5…4c966d` with mtime `2026-10-31T10:56:18.616Z`, and `state.db` is still 512 000 B at mtime
`2026-10-31T10:25:59.744Z`.
