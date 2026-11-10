# Phase 17 — Acceptance Report

**Deliverable:** CONWAY AUTOMATON / AI COMMAND CENTER — `<repo-root>\dashboard`.
**Classification (§31): DASHBOARD COMPLETE.**
**Conway agent classification: NOT ACTIVATED — and this phase did not activate it.** All Phase 16
open items (R-1…R-23) remain in exactly the state `docs/PHASE_16_ACCEPTANCE_REPORT.md` records them;
nothing here closes a Phase 16 risk, and no risk is marked resolved without a new verification
result.

The word "complete" is defined here before it is used, because a dashboard can be finished and still
show gaps. It means: **every element the mandate asked for exists, is wired to a real verified
source rather than a mock, and passed an executed check in this session.** It does **not** mean every
Conway subsystem has data to display. Where the underlying system has produced nothing yet, the
console says `UNKNOWN` / `NOT VERIFIED` with the reason, and §3 lists those items individually.

Every figure below comes from a command run in this session. Nothing is inferred from reading code.

---

## 1. Verdict against the mandate, requirement by requirement

| Mandate requirement | Verdict | Evidence (executed, not inspected) |
|---|---|---|
| Continue the **existing** v0.2.1 install; no reinstall, no replacement, no second Conway installation (§1) | **VERIFIED** | Work landed in `<repo-root>\dashboard` only; `automaton.json` hash unchanged (`1c10ecc5…4c966d`); Conway root suite still 82 files / 2057 tests, 0 failed. |
| Do not touch OmniRoute/FreeLLMAPI/Ollama/OpenCode/Qoder config/MCP/TradingAgents/ADRE-RN/Paperclip/services/security settings; inspect → back up → record SHA-256 → implement → test → verify rollback (§2) | **VERIFIED** | No file outside `dashboard/`, four root `.bat` launchers, one new `.lnk`, `docs/README.md` and one line of `PHASE_16_DATASOURCE_INVENTORY.md` was modified. Existing `Conway Automaton.lnk` untouched. No Windows setting changed. |
| All Conway-touching processes use `runtime\home`; never fall back to `C:\root.automaton` or the user profile (§3) | **VERIFIED** | `status.mjs`: `[PASS] home_isolated`; `home-guard.test.ts` 11 tests including rejection of the user profile, `/root`, a bare drive root and a second install directory; guard is non-vacuous. |
| Dashboard is **independent of the agent**; starting it must never activate the agent (§17) | **VERIFIED** | `index.ts` never spawns Conway; health check asserts `CONWAY_ACTIVATION is unset`; `danger-imports.test.ts` proves no write-side Conway import exists in the dashboard; the console ran for hours with the agent never started. |
| Connect to **actual** Conway data; do not create fake information (§17) | **VERIFIED** | `panel-verdicts.test.ts`: "names a source for every single value"; live DB reads through a `readonly: true` SQLite handle; config parsed from the real file. No fixture data ships in a response path. |
| React + TypeScript + Tailwind + Recharts frontend; Node + TS REST backend with a live stream, using dependencies compatible with the existing install | **VERIFIED** | `dashboard/package.json` (React 18.3, Tailwind 4, Recharts 2.15, TS 5.9, Vite 5.4, tsx 4.21); `vite build` → 532.87 kB JS / 17.85 kB CSS; SSE at `/api/stream`; `better-sqlite3@11.10.0` resolves from the repo store so there is one ABI-127 native build, not two. |
| Named "CONWAY AUTOMATON / AI COMMAND CENTER"; premium dark theme | **VERIFIED** | Banner string in `index.ts` and the page title; dark-navy theme in `src/index.css`; visually confirmed in a real browser. |
| **12 navigation areas** (Overview, AI Agent, AI Models, Wallet, Treasury, Security Center, Health Monitor, Self-Healing, Activity Logs, Backup & Recovery, System Controls, Settings) | **VERIFIED** | `PANEL_ORDER` is exactly those twelve; `panel-verdicts.test.ts` "renders every mandated area, in the mandated order"; all twelve walked in the browser. |
| Every value from verified data; otherwise show `UNKNOWN` / `NOT VERIFIED` | **VERIFIED** | Five-value vocabulary (`VERIFIED · EMPTY · UNKNOWN · NOT VERIFIED · NOT APPLICABLE`) enforced centrally; `panel-verdicts.test.ts` forbids a `VERIFIED` badge on a value that literally reads `UNKNOWN`. |
| Never display private keys, seed phrases, passwords, recovery secrets | **VERIFIED** | `redact.ts` (key-name match anywhere + PEM/hex/JWT/key-shaped value scrubbing), 5 tests; audit-log grep returned **0** secret-shaped strings and **0** occurrences of the live operator token; the three Conway API keys are never read into a panel. |
| Do not create or fund wallets; show "NO WALLET CONFIGURED" when absent | **VERIFIED** | `getWallet()` is never called (it would generate a key); the Wallet panel shows existence=false as a verified fact and `NO WALLET CONFIGURED`; no funding path exists. |
| Never mark a risk resolved without a new verification result | **VERIFIED** | No Phase 16 register item was closed by this phase; §3 lists the still-open ones with their verbatim blockers. |
| Keep `selfHealingEnabled = false`; mechanic stays unreachable | **VERIFIED** | Config has no `selfHealingEnabled` key — the console labels the resulting `false` as **a code default, not an operator decision**; `runMechanic` is never imported. |
| Activation must remain disabled; never silently change `activationApproved` | **VERIFIED** | `activationApproved: false` before and after, same 1382-byte file, same SHA-256. |
| Restore requires explicit confirmation; never overwrite active state automatically | **VERIFIED** | Two-stage plan→confirm→execute with a server-held one-shot plan; target is always a new directory; refuses an existing target; never plans inside the live state directory (14 restore tests + the HTTP-level test). |
| Never execute arbitrary shell commands from browser input | **VERIFIED** | No endpoint takes a command; three named actions only; `routes.ts` dispatches on literal path equality. |
| START must preserve all existing activation and approval gates | **VERIFIED** | `start.mjs` sets `HOME` and the port only; after a full stop/start cycle the health check's nine gate checks all PASS and the config hash is unchanged. |
| §25 — loopback binding, auth, authz, CSRF, input validation, safe process execution, rate limiting, session protection, secret redaction, audit logging | **VERIFIED** | Each control mapped to code and to an executed check in `DASHBOARD_SECURITY_REPORT.md` §2; audit log holds **141** events for 2026-11-01 including 33 `request.unauthenticated` and 12 `request.rejected`. |
| §25 — no LAN/public exposure; no arbitrary-command endpoint | **VERIFIED** | `HOST` is `127.0.0.1` and a non-loopback host makes the process refuse to start (exit 4); canary at `0.0.0.0:8791` made the probe fail correctly, proving the check is not vacuous. |
| §26 — four launchers + desktop shortcut; dedicated port; localhost; **no Windows service, no autostart** | **VERIFIED** | `START/STOP/RESTART/HEALTH_CHECK` batch files present at the repo root; port 8787 (8788 dev only, proxying to 8787); `Conway Automaton Control Center.lnk` created and read back; no service registered, no startup folder entry, no scheduled task added. |
| §28 — four docs + four reports + documentation index updated | **VERIFIED** | `docs/DASHBOARD_{USER_GUIDE,SECURITY,API,OPERATIONS}.md`; `reports/DASHBOARD_{IMPLEMENTATION,SECURITY,TEST_RESULTS,ACCEPTANCE}_REPORT.md` (this file is one of them); `reports/PHASE_17_PROGRESS.md`; Phase 17 section added to `docs/README.md`. |
| §29 — none of the fourteen approval-gated actions taken | **VERIFIED** | Activation env unset; no wallet created or funded; no credentials entered; no credits purchased; no blockchain transaction; no financial tool or replication enabled; no network exposure; no service install; no Windows security change; no unrestricted autonomy. |
| §30 — blocked items recorded with their exact blockers; persistent progress files maintained | **VERIFIED** | §3 below and `PHASE_17_PROGRESS.md`. |
| §31 — Phase 17 classified with an honest label | **VERIFIED** | **DASHBOARD COMPLETE**, qualified by §3. |

## 2. §31 deliverables

The ten artifacts this phase had to hand over. (The lettering is mine for traceability; the set is
what §31 enumerates.)

| | Deliverable | Artifact | Verdict |
|---|---|---|---|
| A | Working, independently startable console on a dedicated loopback port | `dashboard/` + the four `.bat` launchers | **VERIFIED** — 19/19 health checks, exit 0, serving on pid 22824 while the agent stayed inactive |
| B | React + TS + Tailwind + Recharts SPA, 12 areas, real data only | `dashboard/src/`, `dashboard/dist/` | **VERIFIED** — both typechecks exit 0; build 532.87 kB JS |
| C | Node + TS REST + SSE backend reading verified sources | `dashboard/server/` (26 files) | **VERIFIED** — `http-contract.test.ts` 14 tests over the live routes |
| D | Security controls per §25 | `dashboard/server/{security,http,redact,audit,routes}.ts` | **VERIFIED** — `reports/DASHBOARD_SECURITY_REPORT.md`, threat model with explicit **No** rows |
| E | Read-only access to the live Conway database | `dashboard/server/db.ts` | **VERIFIED** — `readonly-db.test.ts` proves SQLite itself refuses a write |
| F | Non-destructive backup verification + confirmed restore | `dashboard/server/{commands,verify}.ts` | **VERIFIED for the mechanism**; **NOT YET PROVABLE for real user data** (§3) |
| G | Test results | `reports/DASHBOARD_TEST_RESULTS.md` + `dashboard/tests/` | **VERIFIED** — 10 files / 97 tests / 0 failed |
| H | User-facing documentation | `docs/DASHBOARD_USER_GUIDE.md`, `DASHBOARD_API.md` | **VERIFIED** |
| I | Security and operations documentation | `docs/DASHBOARD_SECURITY.md`, `DASHBOARD_OPERATIONS.md` | **VERIFIED** |
| J | Persistent progress log with timestamps, hashes and retractions | `reports/PHASE_17_PROGRESS.md` | **VERIFIED** |

## 3. Blocked / not-provable items, with verbatim blockers

These are **Conway-side data and approval gaps**, not dashboard gaps. The console renders each one
honestly instead of filling it in. None of them can be closed by writing more dashboard code, and
none was closed by fabrication.

| Item | Verbatim blocker | What unblocks it |
|---|---|---|
| Real-data restore drill | `REAL_DATA_RESTORE = NOT YET PROVABLE` — the live DB holds 10 rows, all `schema_version` bookkeeping; zero genuine user data | First genuine agent run, then re-drill. Fabricating data is prohibited (§7). |
| Audit trail, incidents, seals, treasury ledger panels | Tables `security_events`, `security_incidents`, `security_seals`, `treasury_authorizations` are **absent** from the live DB — migrations V12/V13 never applied (**R-14**) | Apply V12/V13 to a **copy** first, then re-open the panels. The console cannot do this; it opens read-only. |
| Live-model testing | `LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`; no credential present and no approval token set — by design | Credentials **+** `CONWAY_LIVE_MODEL_APPROVED=APPROVED`, both operator actions (§29.6). |
| Agent runtime state | `kv` table has 0 rows — the agent has never started | Running the agent, which this phase must not do. Displayed as `UNKNOWN`, never as the code default `'setup'`. |
| Wallet balance / chain state | No `wallet.json`; `getWalletChainType()` returns `"evm"` as a default when no wallet exists | Provisioning a wallet is prohibited (§29.4). Shows `NO WALLET CONFIGURED`; existence=false **is** verified. |
| CPU utilisation % | `os.loadavg()` returns `[0,0,0]` on Windows (measured); a single `Get-Counter` sample returned `0` | Closed in the dashboard: two `os.cpus()` samples differenced, and `Win32_Processor.LoadPercentage` as a cross-check. Never rendered as "0 %". |
| File ACLs on state files | `icacls` hardening is **R-15**, an open operator decision; nothing was changed | One elevated read-only run + an approved hardening step. |
| Elevated Windows posture | `Administrator privilege is required`; `Unable to set proper privileges` (needs `SeTcbPrivilege`) — Phase 16 §6 prepared the exact read-only block | Operator runs the prepared block elevated. BitLocker recovery keys were **never** retrieved. |
| Coverage percentage | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` | Operator approves installing it. No coverage number is claimed in this report. |
| Browser E2E / accessibility automation | No Playwright/axe harness installed in this workspace; verification was manual in real Chrome, plus chrome-devtools MCP which could not write screenshots outside configured workspace roots | Operator decision to add a test harness; UI changes since then were re-walked by hand. |

## 4. Failures and self-corrections disclosed, not hidden

Twelve defects, every one of them in code I had written for this phase — and none found by reading
the code. The full table with cause, fix and regression assertion is
`DASHBOARD_TEST_RESULTS.md` §4; the five that would have mattered most operationally:

1. **The confirmed path was not the written path.** Restore step 2 re-planned and generated a new
   timestamped target, so the operator's explicit confirmation did not describe what was written.
   Fixed by holding and consuming the plan server-side. This is the kind of defect that passes every
   code review and only shows up when you read the two strings side by side.
2. **A kill reported survival.** `stop.mjs` treated an empty `Get-CimInstance` result as "process
   alive", so `RESTART` refused to start a second console and earlier `EADDRINUSE` exit-5 refusals
   were misattributed to a stale port rather than to my own liveness check.
3. **The health check could not see a listening server.** It parsed `netstat`/`Get-NetTCPConnection`,
   both of which are unreliable on this machine, and announced that nothing was listening while the
   API was returning 200. Its `catch` then inferred "activation gates open" from "could not read the
   config" — the worst possible failure mode for a guard, because a missing file became a security
   alarm. Both are fixed, and an unreadable config is now `NOT VERIFIED`, which is neither claim.
4. **The client type mirror was invented.** `RestorePlan` in `src/types.ts` described fields the
   server never sends; the plan tile rendered an array as text. The mirror now matches the server and
   the wire contract is pinned in a test.
5. **Security headers were enforced in exactly one function.** `sendJson` set CSP/`nosniff`/
   `no-referrer`, so the SPA page, the traversal refusal and the not-built fallback served without
   `referrer-policy` — and one of them without CSP. Found by running `curl -D` against each path
   rather than by trusting the header code that existed. Now one `BASE_HEADERS` spread into all four
   response sites, with a 4-test suite and a six-path live probe (3/3 headers on every one).

Also disclosed: one earlier CSRF omission on the login request itself, one cell that could render
`VERIFIED` over the value `UNKNOWN`, a non-exclusive `mkdir` in the restore target, and a vitest glob
that executed `*.test.ts` files contained inside extracted backups — i.e. archived, unverified code
ran as if it were this project's test suite. Every one of these is now asserted against. So is the
process: while fixing #5 I introduced a temporal-dead-zone reference and a mis-typed test stub, which
the server typecheck reported before anything shipped — recorded because "the fix broke the build"
belongs in the record, not in a retracted footnote.

**Post-sign-off measurement.** After the #5 fix the console was stopped, restarted, and re-verified at
10:41Z: **19 pass, 0 fail, 0 not verified, 0 warn**
(`dashboard/state/dashboard-health-2026-11-01T10-41-10-623Z.json`), suite
**10 files / 97 tests / 0 failed**, both typechecks exit 0, `automaton.json` still
`1c10ecc5…4c966d`, live `state.db` still 512000 bytes with its 2026-10-31 mtime.

No test was disabled, no assertion weakened, no failing check re-labelled a pass, and no claim of
"zero vulnerabilities" is made anywhere in this phase's documentation.

## 5. Activation posture at sign-off

Measured at 2026-11-01T10:41Z, after the entire verification walk (12 areas browsed, restore
planned and executed, backups verified, health check run, console stopped and restarted) and after
the final header fix:

| Invariant | Value | Source |
|---|---|---|
| `security.lockdown` | `true` | live config, hashed |
| `security.activationApproved` | `false` | live config, hashed |
| `security.allowedTools` | `[]` | live config, hashed |
| `security.allowFinancialTools` | `false` | live config, hashed |
| `security.allowHostShell` | `false` | live config, hashed |
| `security.allowSelfModification` | `false` | live config, hashed |
| `security.allowReplication` | `false` | live config, hashed |
| `security.allowExternalExposure` | `false` | live config, hashed |
| `maxChildren` | `0` | live config, hashed |
| `selfHealingEnabled` | absent → `false` **as a code default, not an operator choice** | labelled as such in the UI |
| `CONWAY_ACTIVATION` | unset | `status.mjs` `[PASS] activation_env` |
| `automaton.json` | 1382 bytes, `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | before and after, identical |
| Live `state.db` | 512000 bytes, mtime 2026-10-31T10:25:59.744Z, `integrity_check` ok, journal `wal`, schema 11 | untouched by every restore executed in this phase |

**The console is operational. The Conway agent is inactive.** Those two facts are the point of
Phase 17, and both were measured rather than asserted.

## 6. Where the evidence is

| Question | Look at |
|---|---|
| What was built, with line counts and data flow | `reports/DASHBOARD_IMPLEMENTATION_REPORT.md` |
| What defends against whom, and what is explicitly *not* defended | `reports/DASHBOARD_SECURITY_REPORT.md` §1, §8 |
| Test output, per-suite purpose, non-vacuity proofs, defect history | `reports/DASHBOARD_TEST_RESULTS.md` §2–§6 |
| Timestamped commands, hashes, timings, retractions | `reports/PHASE_17_PROGRESS.md` |
| Live health output | `dashboard/state/dashboard-health-2026-11-01T10-26-39-578Z.json` |
| Request-level security decisions | `dashboard/logs/audit-2026-11-01.jsonl` (141 events) |
| Root suite confirmation | `dashboard/diagnostics/PHASE_17_ROOT_SUITE.log` |
| How to use it | `docs/DASHBOARD_USER_GUIDE.md` |
| Endpoints, envelopes, verdict vocabulary | `docs/DASHBOARD_API.md` |
| Threat model as documentation | `docs/DASHBOARD_SECURITY.md` |
| How to build, verify, and recover it | `docs/DASHBOARD_OPERATIONS.md` |
| Which data sources are real, and which are gaps | `reports/PHASE_16_DATASOURCE_INVENTORY.md` (gaps 1–21, gap 19 now closed) |
| What Phase 16 still does not prove | `docs/PHASE_16_OVERVIEW.md`, `reports/PHASE_16_GAP_ANALYSIS.md` (R-1…R-23) |

## 7. Operator decisions still outstanding

Nothing in this list was performed by me, and none of it can be:

1. Whether to run the agent at all — every §29 gate is still closed by design.
2. Elevated read-only Windows run (R-1); `icacls` hardening (R-15); V12/V13 migration on a copy
   (R-14); the three-line config remedy (R-21); host npm cache location (R-17).
3. OS isolation tier choice, with `PHASE_16_ISOLATION_EVALUATION.md` as the input — including what
   Home SL makes impossible.
4. Live-model credentials + `CONWAY_LIVE_MODEL_APPROVED=APPROVED`, if model testing is wanted.
5. Whether to install `@vitest/coverage-v8` so a coverage number can be reported at all.
