# PHASE 15 — PROGRESS CHECKPOINT LOG

**Updated:** 2026-11-01 10:55 IST — closed out after 15M.
**Rule:** every checkpoint records executed evidence, not intent.
**Final status: B — PHASE 15 PARTIALLY COMPLETE, RESIDUAL RISKS DOCUMENTED.**
Entry point: [docs/PHASE_15_OVERVIEW.md](../docs/PHASE_15_OVERVIEW.md).

| Checkpoint | State | Evidence |
|---|---|---|
| 15-pre snapshot | DONE | `backups/phase15-pre-20261031-175152/` with SHA-256 manifest |
| 15A gap audit | DONE | `reports/PHASE_15_GAP_ANALYSIS.md` |
| 15B wallet encryption | DONE | AES-256-GCM envelope; 30/30 tests, tsc 0; migration CLI tested with synthetic key; `reports/PHASE_15_WALLET_ENCRYPTION.md` |
| 15C treasury enforcement | DONE | `TreasuryGuard` + hash-chained audit; 35/35 tests on Node 22; V12 migration verified on a DB copy; `reports/PHASE_15_TREASURY_ENFORCEMENT.md` |
| 15D tool permissions | DONE | `authorizeToolCall` wired first in `executeTool`; 77/77 builtins explicitly classified; 16/16 tests; `reports/PHASE_15_TOOL_SECURITY.md` |
| 15E sandboxing | DONE | `confineToRoot`/`isProtectedPath`/`validateShellCommand`/`scrubEnvironment` wired into read/write/exec + local child env; 46/46 tests; `reports/PHASE_15_SANDBOX_SECURITY.md` |
| 15F health guardian/mechanic | DONE | `health-guardian.ts` (8 read-only checks) + `mechanic.ts` (automatic/approval/forbidden classification, unknown ids forbidden); seal rotation only when chain verifies; `selfHealingEnabled` default false so the live install is inert; 40/40 tests; `reports/PHASE_15_SELF_HEALING.md` |
| 15G incident response | DONE | `incidents.ts` (dedupe, INFO–CRITICAL, ack/resolve, `scanSecurityEvents`, `checkTamper`) + `emergency-stop.ts`; stop blocks heartbeat ticks, tool dispatch and the mechanic, and needs a named human to clear; V13 tables append-only; 26/26 tests; `reports/PHASE_15_INCIDENT_RESPONSE.md` |
| 15H Windows security | DONE (with correction) | read-only posture audit: Defender, firewall, UAC, CFA and service state verified from captured output; BitLocker/TPM/Secure Boot **not verifiable without elevation** and recorded as UNVERIFIED rather than passed; zero recovery-key material in the tree. **Correction 2026-10-31 22:30 (withdrawn 22:55):** I first wrote that PID 15168, listening on `0.0.0.0:3001`/`[::]:3001`, was a stale Conway build and that the "no process, no port" claim was false. **That correction was itself wrong** and is retracted — see "Wrong-claim log" below. Re-verified by process parentage: PID 15168 is FreeLLMAPI (`node dist/index.js`), launched by `TradingProjects\freellmapi\scripts\freellmapi-service.ps1` (parent PID 9516), and the Phase 1 environment audit had already classified it PROTECTED at [reports/ENVIRONMENT_AUDIT.md:205](file:///<repo-root>/reports/ENVIRONMENT_AUDIT.md#L205). Conway contributes no process, port, scheduled task or autostart entry — the original claim stands. |
| 15I penetration tests | DONE | 7 attack classes / 54 cases through the real dispatch path and the security modules direct; 54/54, harness 6/6, adjacent suites 128/128 + 224/224, project tsc 0 and explicit test/script typecheck 0; 3 control defects found (F1 guard-level x402 domain enforcement — fixed; F2 five host-abuse deny patterns — fixed; F8 loop coupled policy evaluation to the spend tracker — fixed), F3 confirmed design, F5/F6 accepted with compensating controls, F7 documented; `reports/PHASE_15_PENETRATION_TEST.md` |
| 15J soak tests | DONE | bounded 3000-iteration soak of the real dispatch stack in an isolated temp HOME/db/sandbox, mocks only, no network: **10/10 verdicts PASS** — chain valid over 3 437 rows, 0 dangling reservations, sentinel never persisted, no wallet material, mechanic inert, 0 control violations in 353 direct control calls, RSS x1.428 (<2x), heap x0.778, state growth 1 139 B/iter (<16 384), 0 errors; 1 709 dispatches / 453 denied; `reports/PHASE_15_SOAK_TEST.md` + `reports/PHASE_15_SOAK_RAW.json` |
| 15K backup validation | DONE (corrected in 15M) | archive manifest SHA-256 verified, `PRAGMA integrity_check` ok, restore into `%TEMP%` migrated V10→V13 and produced a valid audit chain, no rows lost, live paths byte-identical before/after, 0 plaintext-key hits across all 5 backup dirs (33 files); `reports/PHASE_15_BACKUP_TEST.md` + `reports/PHASE_15_BACKUP_RAW.json`. **15M correction:** `livePathsUntouched` signed a path that does not exist, and the report's "there is no active database in this install" was false — a live DB exists at `runtime/home/.automaton/state.db` (512 000 B, schema V11, integrity ok). The guard list is now built from `HOME` as well as `os.homedir()`, a non-vacuity verdict was added, and the run was re-executed: **10/10 PASS** with the live DB signed identically before and after, plus a negative control (`env -u HOME`) that fails as designed. See the Wrong-claim log below. |
| 15L regression | DONE | full suite now **terminates**: 1 913 passed / 0 failed, 72/72 files, exit 0, 95.76 s (baseline 22:26 was 1 862/19 with one file excluded and the suite unable to finish). The 19 were not all test bugs: 17 were `new URL().pathname` reads that `ENOENT`ed before asserting; 1 was an **inert product control** (absolute `BLOCKED_DIRECTORY_PATTERNS` never matched on Windows — fixed by resolving both sides and reusing `isProtectedPath`); 1 was a **Windows isolation leak** (`HOME` override ignored by `os.homedir()`, plan artifacts written into the real user profile — fixed and verified closed). The suite hang was root-caused out of vitest: js-tiktoken is superlinear on repetitive text (1k 67ms → 4k 970ms → 50k never returned), fixed with a bounded 2 048-char estimation window keeping the `max(tokens, len/4)` conservative floor; 2 regression tests added. Run A showed 1 load-dependent timeout, passed 4/4 later executions — recorded, not hidden. Re-checks: soak 10/10 PASS identical, backup validator 9/9 PASS, both typecheck modes exit 0; `reports/PHASE_15_REGRESSION_ACCEPTANCE.md` |
| 15M documentation | DONE | 11 operator documents in `docs/PHASE_15_*.md` (overview + 10 control docs), each citing executed evidence and copy-pasteable verification commands against the pinned Node 22.23.4 runtime; `docs/README.md` gained the Phase 15 documentation map and a status-B callout; `docs/TROUBLESHOOTING.md` §11 extended with the evidence-corruption variant of the `HOME` trap. Claims were re-checked against source rather than against the reports, which found and fixed two: the health-guardian snippet in `PHASE_15_SELF_HEALING.md` cited a signature that does not exist, and `PHASE_15_BACKUP_VALIDATION.md` initially repeated the "no live database" error. That second one led to the 15K validator correction above. R-2 rewritten, R-10 (`~` resolves via `HOME`, not `USERPROFILE`) added. |

## Test-run log

| When | Scope | Result |
| --- | --- | --- |
| 2026-10-31 20:48 | Full suite, `--exclude **/context-hardening.test.ts`, portable Node 22.23.4 | 1804 passed / 19 failed (70 files) |
| 2026-10-31 20:47 | `phase15-tool-security`, `phase15-sandbox`, `phase15-treasury`, `tools-security` | 168 passed / 168 |
| 2026-10-31 20:46 | `phase15-self-healing`, `phase15-incident-response` | 66 passed / 66 |
| 2026-10-31 20:47 | `heartbeat`, `heartbeat-scheduler` | 39 passed / 39 |
| 2026-10-31 20:47 | `tsc --noEmit` | exit 0 |
| 2026-10-31 22:02:52 | `phase15-penetration`, `phase15-treasury`, `loop`, `agent/general-harness`, `tools-security` | 192 passed / 2 failed — both failures triaged, see 15I close-out |
| 2026-10-31 22:07:56 | `phase15-penetration` + `agent/general-harness` after fixes | **60 passed (60)** |
| 2026-10-31 22:08:07 | `phase15-tool-security`, `phase15-sandbox`, `phase15-incident-response`, `phase15-self-healing` | **128 passed (128)** |
| 2026-10-31 ≈22:08 | project `tsc --noEmit`, then explicit typecheck of pen test + harness test + mocks + soak script (tsconfig excludes `src/__tests__`) | both **exit 0** |
| 2026-10-31 ≈22:17 | `phase15-penetration` alone | **54 passed (54)** |
| 2026-10-31 22:09–22:24 | Full suite, no exclusion | **did not complete** — hung; killed after 15 min; see the context-hardening entry below |
| 2026-10-31 22:26:49 | Full suite, `--exclude **/context-hardening.test.ts`, pinned Node 22.23.4, 86.79 s | **1862 passed / 19 failed (71 files)**, exit 1 — same 19 env-specific failures as the 20:48 baseline, +58 tests, 0 new regressions |
| 2026-10-31 ≈22:24 and ≈22:29 | `context-hardening.test.ts` alone under `timeout 240`, with `--pool=threads` then `--pool=forks` | **rc=124 both times (timed out)** — `Error: Worker exited unexpectedly` from tinypool |
| 2026-10-31 ≈22:12–22:16 | 15J probe runs (50 then 200 iterations) | PASS — and they surfaced the 4 measurement defects corrected before the recorded run |
| 2026-10-31 22:31 | 15J soak, 3000 iterations | **PASS**, exit 0, 10/10 verdicts |
| 2026-10-31 ≈22:19 | 15K backup validator (first pass 22:18, re-run with the real disposability check 22:19) | **PASS**, exit 0, 9/9 verdicts |
| 2026-10-31 22:40 | 15L pre-edit snapshot (`backups/phase15L-pre-20261031-224048/`) | 5 test files captured with SHA-256 manifest |
| 2026-10-31 22:41 → 22:43 | `path-protection` before / after the `isProtectedFile` fix | 25 passed / **1 failed** → **27 passed (27)**, exit 0 |
| 2026-10-31 22:44 | `path-protection` + `tools-security` (blast radius of the shared import) | **98 passed (98)** — 27 + 71 |
| 2026-10-31 22:46 | `command-injection` + `skills-hardening` after `fileURLToPath` conversion (17 sites) | **132 passed (132)** — 102 + 30, exit 0 |
| 2026-10-31 22:46 → 22:49 | `orchestration/local-worker-harness` before / after the `USERPROFILE` fix | 4 passed / **1 failed** → **5 passed (5)**; `find ~/.automaton/workspace -newermt "22:47"` afterwards returns nothing, so the profile leak is closed |
| 2026-10-31 ≈22:52–22:58 | `context-hardening` bisected by group (10) then by test (5), plus a 12-line reproduction script outside vitest | crash isolated to 3 tests in `buildContextMessages token budget`; `estimateTokens` measured at 256 ms / 1 542 ms / 6 347 ms for 1k / 5k / 10k chars and **no return within 60 s at 50k** |
| 2026-10-31 ≈23:03 | counter after the bounded-window fix, same probe | flat: 4k 224 ms, 100k 231 ms, 250k 233 ms, 100k prose 0.5 ms; worst case now bounded |
| 2026-10-31 ≈23:04 | `context-hardening.test.ts` alone | **29 passed (29)**, 4.5 s, exit 0 — file now executes at all |
| 2026-10-31 ≈23:05 | `memory/context-manager` + `context-hardening` | **54 passed (54)**, exit 0 |
| 2026-10-31 23:06:47 | Full suite, **no exclusions** — run A | 1 910 passed / 1 failed, exit 1 — the one failure is a 30 s load timeout in `heartbeat.test.ts`, characterised below |
| 2026-10-31 ≈23:07–23:09 | `heartbeat.test.ts` isolated × 3 | **19/19 each**, exit 0 — synchronous test body, no timers |
| 2026-10-31 23:09:49 | Full suite, no exclusions — run B | **1 913 passed / 0 failed, 72/72 files**, exit 0, 95.76 s, zero worker errors |
| 2026-10-31 ≈23:12 | `tsc --noEmit` (project) and explicit typecheck of the 5 edited test files + 2 edited modules | both **exit 0** |
| 2026-10-31 ≈23:15 | 15J soak + 15K validator re-run after both product edits | soak **PASS** (identical: 1 709 dispatches / 453 denied, 0/353 violations, 0 errors); validator **PASS** |
| 2026-10-31 ≈23:29 | read-only inspection of `runtime/home/.automaton/state.db` (SQLite `PRAGMA integrity_check`, `schema_version`, table inventory) | `ok` · V11 · 38 tables · only `schema_version` non-empty · no `treasury_authorizations` / `security_events` (V12/V13) — **disproved** the 15K claim that no live database exists |
| 2026-10-31 23:33:44 | 15M pre-edit snapshot of the validator | `backups/phase15M-pre-20261031-233344/` — `ORIGINAL_CONTENT.txt` (both changed regions verbatim) + `MANIFEST.sha256` |
| 2026-10-31 ≈23:33 | explicit typecheck of the edited `scripts/phase15-backup-validate.ts` (tsconfig excludes `scripts/`) | **exit 0** |
| 2026-10-31 23:34:08 | 15K validator with the guard-path fix, `HOME` set as the `.bat` wrappers set it, `--archive backups/2026-10-31_10-27-31` | **PASS**, rc 0, **10/10 verdicts** — `runtime/home/.automaton/state.db` signed `2a8aeb3494f1507a…` identically before and after; `%USERPROFILE%\.automaton\state.db` correctly reported `absent`; `reports/PHASE_15_BACKUP_RAW.json` |
| 2026-10-31 ≈23:35 | negative control: same command with `HOME` unset (`env -u HOME`), output to a scratch report so official evidence was not overwritten | **rc 1, status FAIL, failed verdicts: `liveDbGuardNonVacuous`** — the original defect reproduced and detected, proving the new verdict is not tautological |
| 2026-10-31 ≈23:36 | full suite — **not re-run in 15M** | No product source changed in 15M (one script, docs and reports only), so the 1 913/1 913 result from run B at 23:09:49 still stands. Stated explicitly rather than carried forward as if re-measured. |

**Hang finding — root-caused and fixed in 15L.** Until 23:03 the full suite could not
complete while `src/__tests__/context-hardening.test.ts` was included: its worker never
returned, tinypool surfaced `Error: Worker exited unexpectedly`, and the run then never
terminated — with `--pool=threads` and with `--pool=forks` alike. It was **not** a vitest
or Windows problem: js-tiktoken's merge loop is superlinear on repetitive text and
`estimateTokens()` encodes every turn of every context build. Phase 14's
`docs/TROUBLESHOOTING.md` §6 had recorded it as "an upstream test file is not
Windows-compatible"; that entry is now corrected with the measurement and the fix.

**Correction to the paragraph that was here before 15L.** It asserted that all 19
failures were "environment-specific and pre-existing" and that "none of the modules under
test failed a security check". That was written before any of them had been
root-caused, and it was wrong in two ways: (a) 17 of the failures were `ENOENT` from
`new URL(...).pathname` on Windows, so the assertions never ran at all — not a benign
platform mismatch, a silent coverage hole; (b) one of them, `path-protection`, exposed a
genuinely **inert product control** — every absolute entry in
`BLOCKED_DIRECTORY_PATTERNS` failed to match on Windows, and the second was a real
filesystem leak into the user profile. Both are now fixed in `src/`, not papered over in
the tests. The 15L report itemises all 19.

## Change log (2026-10-31, 15F/15G)

| File | Change | Why |
| --- | --- | --- |
| `src/security/audit-chain.ts` | `appendSecuritySeal` anchors `sequence` to the **chain** sequence (was a seal counter) and is a no-op when the head is unchanged; `verifySeals` recomputes row hashes via a shared `recomputeRowHash` helper instead of trusting the stored `hash` column | A seal keyed to a counter could never be checked against the chain, and comparing the stored hash misses edits that leave that column intact — the seal was not an independent anchor |
| `src/security/emergency-stop.ts` | Added `isEmergencyStopEngagedInDb` and `isEmergencyStopActive` | The marker lives under the process HOME, so a daemon with a different HOME could miss it; the audit trail is the durable second source |
| `src/reliability/health-guardian.ts` | `emergency_stop` check and `HealthReport.emergencyStop` consult marker **or** audit trail | Same reason; report title simplified to "Emergency stop" |
| `src/reliability/mechanic.ts` | Stop gate now also checks the audit trail | A stale-marker/rewritten-DB mismatch must fail closed |
| `src/heartbeat/daemon.ts` | Tick guard uses `isEmergencyStopActive(rawDb)` | Prevents ticks when only the trail records the stop |
| `src/agent/tools.ts` | New first gate in `executeTool`: emergency stop denies any tool before authorization/policy and audits `tool.denied` with reasonCode `EMERGENCY_STOP` | Shutdown has to stop in-process dispatch too, not only the heartbeat |
| `src/heartbeat/tasks.ts` | New builtin task `security_monitor` (scan → incidents → KV summary → wake on CRITICAL/HIGH or integrity failure) | Phase 15G requires continuous monitoring, not on-demand only; it never engages or clears the stop |
| `src/__tests__/phase15-incident-response.test.ts` | New, 26 tests | Evidence for 15G |
| `src/__tests__/phase15-self-healing.test.ts` | New, 40 tests (incl. seal anchoring, no-op re-seal, forged sealed row, empty-chain refusal) | Evidence for 15F |

Backups: `backups/phase15-pre-20261031-202919/` (SHA-256 manifest) holds the
pre-edit copies of `audit-chain.ts`, `health-guardian.ts`, `mechanic.ts`,
`daemon.ts`, `emergency-stop.ts`, `phase15-self-healing.test.ts`. Tracked files
additionally remain recoverable from the repository history at `d8f8168`.

## Change log (2026-10-31, 15H)

No files in `src/` were modified. Read-only PowerShell probes were run and archived
as `reports/PHASE_15_WINDOWS_POSTURE_RAW.txt`; the interpreter written for them lived
in `%LOCALAPPDATA%\Temp`, not in the project. Elevated-only questions (BitLocker
protection state, TPM ownership, Secure Boot, ASR/SmartScreen) were left as
**UNVERIFIED** in `reports/PHASE_15_WINDOWS_SECURITY.md` instead of being guessed, and
no command that reveals a recovery key was executed at any point.

## Change log (2026-10-31, 15I)

| File | Change | Why |
| --- | --- | --- |
| `src/security/treasury-guard.ts` | `authorize` now enforces `x402AllowedDomains` for `x402_payment` inside the same `immediate()` transaction: empty list disables, missing/unresolvable host denies, subdomain match case-insensitive, reasonCode `DOMAIN_NOT_ALLOWED` | Finding F1: the allowlist existed only in the policy layer, so an in-process caller that reached the guard directly could pay any host. The guard is the layer that must not be bypassable |
| `src/security/sandbox.ts` | 5 added deny patterns: `New-Service`, `reg add …\CurrentVersion\Run`, `manage-bde -protectors`, `manage-bde -on\|-off\|…`, `Enable\|Disable\|Unlock\|Protect\|Unprotect-BitLocker` | Finding F2: service installation, startup persistence and BitLocker state changes were reachable; recovery-key retrieval is prohibited by the master prompt and is now blocked at the shell boundary |
| `src/__tests__/phase15-penetration.test.ts` | New, 54 tests across 7 attack classes | Evidence for 15I |
| `src/__tests__/phase15-treasury.test.ts` | +4 guard-domain tests; 2 pre-existing x402 tests now supply `domain: "conway.tech"` | The 2 edited tests assert cooldown exemption and the per-payment cap, not host freedom; their assertions are unchanged, so coverage did not move |
| `src/agent/spend-tracker.ts` | Added exported `NOOP_SPEND_TRACKER` (shared no-op implementation of the interface) | Turn context must always exist for policy evaluation; a caller with no tracker needs a inert recorder, not a missing context (F8) |
| `src/agent/loop.ts` | The dispatch now always passes a turn context, using `spendTracker ?? NOOP_SPEND_TRACKER`, instead of `spendTracker ? {…} : undefined` | Finding F8: an unwired spend tracker silently switched the whole policy layer off, because `executeTool` only evaluates policy when a turn context is present |
| `src/agent/harnesses/general-harness.ts` | Deleted its private duplicate `NOOP_SPEND_TRACKER` and imports the shared one | Two definitions of the same fallback drift apart; the harness call sites were already correct |
| `src/__tests__/agent/general-harness.test.ts` | The hostile-`x402_fetch` sanitization case now fetches `https://api.conway.tech/hostile` and additionally asserts `DOMAIN_NOT_ALLOWED` for `https://example.com` | F1's fix denied that test's off-allowlist host — the test had been relying on the hole. Sanitization is still asserted on a real tool result and the denial is now pinned (report: "F1 blast radius") |
| `src/__tests__/mocks.ts` | `createTestConfig` accepts `Partial<SecurityConfig>` and merges it onto the test defaults | The runtime merges the same way; the old signature only typechecked because `tsconfig.json` excludes `src/__tests__` |

Three penetration cases were re-based after they failed, because the assumption was
wrong and the control was sound: `allowedTools` semantics (F3, confirmed design and
documented as an operator consequence), the null-byte check being required to see raw
input before `path.join` erases it (F4), and the envelope guard being structural with
integrity enforced at open (F6). One fail-open was accepted rather than "fixed" because
the alternative is worse: session spend tracking after commit (F5), which the DB-side
caps and the audit chain already compensate for.

Two defects came from the same root cause and are recorded together: policy evaluation is
conditional on the caller supplying both a `PolicyEngine` and a turn context. The loop made
the turn context conditional on the spend tracker (F8, fixed); the engine itself is still an
optional parameter (F7, documented with a test that pins what survives without it, plus a
recommended follow-up to make it required). The typecheck gap mentioned above — `tsconfig.json`
excludes `src/__tests__` — hid 6 real type errors in test files, all fixed; the explicit
typecheck command is now part of the 15I evidence table.

Backups: `backups/phase15-pre-20261031-211345/` (SHA-256 manifest) holds the pre-edit
copies of `treasury-guard.ts`, `phase15-treasury.test.ts` and the first draft of
`phase15-penetration.test.ts`. `src/security/sandbox.ts` was edited before that snapshot;
its pre-edit state is recoverable from git at `d8f8168`.
`backups/phase15-pre-20261031-215500/` (SHA-256 manifest) holds the pre-edit copies of
`general-harness.ts`, `loop.ts`, `spend-tracker.ts`, `tools.ts` and `scripts/soak-test.sh`.

## Wrong-claim log (2026-10-31)

Recorded because an incorrect finding in a security report is itself a defect.

At 22:30 I added a "correction" to 15H asserting that the process listening on port
3001 (PID 15168) was a stale Conway build and that Conway therefore *did* own a port.
The claim was wrong on both halves. I checked `netstat`, `Get-NetTCPConnection` and the
command line, but not the **parent process**, and I did not re-read the Phase 1
environment audit — which had already classified PID 15168 as protected FreeLLMAPI and
listed "never bind 3001" as a standing constraint (risk R5).

Re-verification that overturned it (all read-only):

| Check | Output |
| --- | --- |
| `Get-CimInstance Win32_Process` PID 15168 | `"C:\Program Files\nodejs\node.exe" dist/index.js`, executable outside the Conway repo |
| parent PID 9516 | `powershell.exe -File <freellmapi-root>\scripts\freellmapi-service.ps1` |
| `Get-CimInstance Win32_Process` where CommandLine matches "Conway" | only the `bash.exe` probe itself; no Conway process |
| `schtasks /query`, `Get-Service`, `HKCU\…\Run`, Startup folder | no Conway task, service or autostart; Startup holds only `Ollama.lnk` + `desktop.ini` |

Lesson applied to the rest of Phase 15: process ownership is established by parentage
and working directory, not by the listening port or the filename in the command line.
15H's original conclusion is restored, and `reports/PHASE_15_WINDOWS_SECURITY.md` is
updated to match rather than silently left contradicting this log.

### 15K → 15M — "there is no active database in this install"

Written into `reports/PHASE_15_BACKUP_TEST.md` and carried into R-2 of the Phase 15
overview. It was false, and the way it was reached is the interesting part: the validator
tested three paths — `data/`, `config/` and `path.join(os.homedir(), ".automaton", "state.db")`
— found none of them, and I read that absence as a fact about the install instead of a fact
about the path expression.

`dbPath` is `~/.automaton/state.db`, and `resolvePath()` in [src/config.ts:201](file:///<repo-root>/src/config.ts#L201)
expands `~` from `process.env.HOME`. Every `.bat` wrapper sets `HOME=%ROOT%runtime\home`.
So the live state tree is `runtime/home/.automaton/`, while `os.homedir()` on Windows follows
`USERPROFILE` and ignores `HOME` entirely — the guard list hashed a file that has never existed.

Three things this invalidated, all corrected in 15M rather than left standing:

| What was published | Actual state |
| --- | --- |
| "no active database in this install" | `runtime/home/.automaton/state.db` exists: 512 000 B, schema V11, 38 tables, `PRAGMA integrity_check` = `ok`, only `schema_version` non-empty |
| `livePathsUntouched` = PASS, "live paths byte-identical" | **Cosmetic PASS** — the verdict compared two snapshots of a non-existent path, so it guaranteed nothing about the database that does exist. Now true as a measurement: the real file is signed `2a8aeb3494f1507a…` identically before and after |
| R-2: "backup is only half-proved because there is nothing to back up" | Still half-proved, but for the honest reason: the archive is thin (one non-empty table), not because no live DB exists. The live DB is pre-activation and carries no user data either — which is why the conclusion survived, not the premise |

Same root cause as the 15L isolation leak (`os.homedir()` ignoring a `HOME` override), this
time in the evidence layer instead of the product. The distinction matters: a leaked test
artifact costs disk space; a cosmetic PASS costs trust in every other verdict in the report.
Fixed by `liveGuardPaths()` (both `HOME` and `os.homedir()`) plus the `liveDbGuardNonVacuous`
verdict, which makes a guard list that resolves to nothing a **failure** rather than a silence.
Recorded as residual risk R-10 because the same trap will re-occur for anyone who inspects this
install from a shell that does not set `HOME` — including an operator told to "look at
`~\.automaton`".


## Out-of-scope observation: FreeLLMAPI is reachable beyond loopback

No action taken. FreeLLMAPI is on the master prompt's do-not-modify list, so this is
reported to the operator, not remediated. Evidence, all read-only:

- `netstat -ano -p tcp` → `TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING 15168`;
  `Get-NetTCPConnection` shows the same socket as `[::]:3001` (dual-stack wildcard). It
  is **not** loopback-bound, so it is addressed on the Wi-Fi interface (`<host-lan-ip>`).
- `Get-NetConnectionProfile` → Wi-Fi "mojo5G 2" `NetworkCategory: Public`.
- `netsh advfirewall show allprofiles state` → all three profiles ON;
  `…firewallpolicy` → `BlockInbound,AllowOutbound` on all three.
- **But** `Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime"` → two enabled
  rules, Direction Inbound, Action Allow, Profile Public, Protocol TCP and UDP,
  `LocalPort: Any`, `RemoteIP: Any`, Program `C:\program files\nodejs\node.exe`.

Inference, explicitly labelled: on the currently active Public profile, inbound TCP to
any port for `node.exe` is allowed for any remote address, so a host on the same LAN can
probably reach `<host-lan-ip>:3001`. **Not proven** — a connection from this machine to
its own LAN address does not traverse the firewall path, so it cannot validate the rule
from here; confirming it needs a second machine, which Phase 15 did not attempt.

Conway-side consequence, the only one in scope: Conway must never bind 3001, and any
future Conway listener must bind loopback explicitly. `src/registry/agent-card.ts:124`
generates a template containing `server.listen(port)` — no bind address, so all
interfaces — and sets `Access-Control-Allow-Origin: *` at line 98. It is dormant in this
install (`maxChildren = 0`, activation gates closed, nothing invoked the tool), and the
audit trail would record any use, so it is documented as residual risk rather than
patched under a closed gate.

## Change log (2026-10-31, 15J/15K)

| File | Change | Why |
| --- | --- | --- |
| `scripts/phase15-soak.ts` | New bounded soak runner: isolated temp `HOME`, temp DB, temp sandbox root, mock provider only, no network, no wallet | `scripts/soak-test.sh` needs an activated install and `dist/`; both would have meant opening a gate to measure reliability |
| `scripts/phase15-soak.ts` | `parseArgs` normalises `--budget-ms` → `budgetMs`; denial detection via `wasDenied()`; control branch asserts (`controlCalls`/`controlViolations`); `chainEvery` floor; `stateGrowthBounded` replaces `dbGrowthLinear`; `sandboxDirBytes` reported | Four measurement defects the 50- and 200-iteration probes surfaced: hyphenated flags silently took defaults, body-level refusals ("Blocked: …") were counted as successes, discarded control results made the control checks unfalsifiable, and a bare `dbBytes > 0` verdict passed regardless of growth |
| `reports/PHASE_15_SOAK_TEST.md` + `reports/PHASE_15_SOAK_RAW.json` | New: 3 000 iterations, 10/10 verdicts, full sample series | Evidence for 15J |
| `scripts/phase15-backup-validate.ts` | New validator: SHA-256 manifest verify, `PRAGMA integrity_check` on a read-only handle, secret scan reporting only file/pattern/count, restore into `%TEMP%` via `createDatabase`, chain verify, live-path hash snapshot before/after | 15K asked whether recovery actually works, not whether a backup directory exists |
| `scripts/phase15-backup-validate.ts` | `restoreWasDisposable` computed from `fs.realpathSync(os.tmpdir())` instead of hardcoded `true`; `main()` rewritten with try/finally and a `writeReport` that returns `{status, failed}` | A hardcoded verdict is a cosmetic PASS; the first draft also let a failed restore be swallowed and the exit code ignored |
| `reports/PHASE_15_BACKUP_TEST.md` + `reports/PHASE_15_BACKUP_RAW.json` | New: 9/9 verdicts, plus the disclosure that the archive is effectively empty and that no live database exists to back up | Evidence for 15K, with the limitation stated rather than smoothed over |

## Change log (2026-10-31, 15L)

| File | Change | Why |
| --- | --- | --- |
| `src/self-mod/code.ts` | Absolute entries in `BLOCKED_DIRECTORY_PATTERNS` are now compared after `path.resolve` on **both** sides, and `isProtectedFile` additionally consults the sandbox's `isProtectedPath` | The raw-literal comparison could never match a resolved Windows path, so `/etc/systemd`, `/etc/passwd`, `/etc/shadow`, `/proc` and `/sys` were all inert on this platform, and no Windows system directory was in the list at all. Reuse beats a second, POSIX-only protected list |
| `src/memory/context-manager.ts` | `countTokens` encodes a bounded 2 048-character window and scales the ratio (`max(1, ceil(ratio × length))`) | js-tiktoken's merge loop is superlinear on repetitive text (1k 67ms, 2k 220ms, 4k 970ms, 50k+ never returned). `estimateTokens` runs over every turn of every context build, so one large tool result stalled the agent and hung the whole suite. `estimateTokens` still returns `max(tokens, ceil(len/4))`, so the budget can only over-estimate — the fix cannot cause context overflow |
| `src/__tests__/memory/context-manager.test.ts` | +2 tests: bounded time on 250 000 characters, proportionality 4 000 vs 400 000 | The hang had no test pinning its absence; timing bound is 5 s against a pre-fix 60 s non-return |
| `src/__tests__/path-protection.test.ts` | +1 test asserting the protected locations of the platform under test (System32, `~\.ssh`, `~\Documents`, Chrome `User Data`, `~\.qoder`); `os` import added | The four POSIX assertions passing after the fix only proves the literal maps to the current drive; the Windows-native cases needed their own anchor |
| `src/__tests__/command-injection.test.ts`, `src/__tests__/skills-hardening.test.ts` | 17 read sites converted from `new URL(…).pathname.replace(…)` to `fileURLToPath(new URL(…))` | On Windows `.pathname` yields `/C:/…`, so `readFileSync` threw `ENOENT` **before any assertion executed** — 17 security-source checks were not running |
| `src/__tests__/orchestration/local-worker-harness.test.ts` | Overrides `USERPROFILE` alongside `HOME` on win32 and restores both in `finally` (deleting when previously unset) | `os.homedir()` ignores `HOME` on Windows, so the temp home was a fiction and plan artifacts were written into the real user profile |
| `docs/TROUBLESHOOTING.md` | §6 rewritten from "upstream file not Windows-compatible" to the measured root cause and fix; §7 rewritten to itemise the 19 and where each fix landed | A wrong cause in a troubleshooting doc sends the next reader down the same dead end I spent an evening on |

Backups: `backups/phase15L-pre-20261031-224048/` (SHA-256 manifest) holds the pre-edit
copies of the five test files. `src/self-mod/code.ts` and `src/memory/context-manager.ts`
are tracked and recoverable from git at `d8f8168`.

Two things deliberately left alone: the 28 directories of pre-fix test litter in
`~\.automaton\workspace\` (outside the project, so not deleted without approval) and the
suite-wide `testTimeout` (raising it would absorb the load-dependent heartbeat timeout by
hiding slow tests rather than explaining them).

## Change log (2026-10-31, 15M)

| File | Change | Why |
| --- | --- | --- |
| `docs/PHASE_15_OVERVIEW.md` | New entry point: what changed per sub-phase, gap-by-gap status, the ten residual risks, what was deliberately not touched, and why the status is B and not A | The reports are evidence logs; an operator needs one page that says what to do and what is still dangerous. R-2 was rewritten after the 15K correction, and R-10 (`~` resolves via `HOME`, not `USERPROFILE`) was added |
| `docs/PHASE_15_WALLET_ENCRYPTION.md` | New: envelope parameters, the two accepted passphrase sources and why DPAPI was rejected, migration CLI dry-run/apply with recorded synthetic-key output, verification command, 5 residuals | 15B's report proves the crypto works; an operator rotating a passphrase or recovering a wallet needs the exact procedure and the failure modes |
| `docs/PHASE_15_TREASURY_ENFORCEMENT.md` | New: the 13-step authorization order re-verified against source, no-TOCTOU explanation, fail-closed table, operator SQL (denials, stuck `reserved` rows, window sums), how to change a policy safely, 7 residuals | Treasury is where money moves. A doc written from the report would have inherited the report's approximations of the check order |
| `docs/PHASE_15_TOOL_PERMISSIONS.md` | New: 11 classes, decision order, legacy flag → capability mapping, audit shape (`argsHash`, never values), duration/output bounds, safe-grant JSONC example, 6 residuals | The F3 consequence — "a name in `allowedTools` is a full grant" — is an operator-facing landmine that only appears if you read the authorizer, not the test suite |
| `docs/PHASE_15_SANDBOX.md` | New: confinement mechanics, protected-location taxonomy, `CONWAY_PROTECTED_PATHS`, shell deny list including the five F2 additions, env scrubbing, an explicit "what this sandbox does not do" section, the inert-Windows-protection defect, 7 residuals | An application-level sandbox invites over-trust. The limits are the load-bearing content |
| `docs/PHASE_15_SELF_HEALING.md` | New: 8 checks, three repair buckets with "unknown identifier defaults to forbidden", three execution gates, `selfHealingEnabled` accepts only literal `true`, verification commands, 6 residuals. §5 **fixed after writing**: the first draft called `runHealthChecks({ db })`, which is not the real signature | A copy-pasteable command that does not run is worse than none — it teaches the reader the API is broken. Verified against `src/reliability/health-guardian.ts` and replaced with the `createDatabase()` + `loadConfig()` form plus the write-lock warning |
| `docs/PHASE_15_INCIDENT_RESPONSE.md` | New: monitored-event taxonomy, INFO–CRITICAL table, two-proof tamper detection, the emergency-stop runbook (marker path, effects, human-only clear, unreadable marker = engaged), 6-row operator playbook, 5 residuals | Severity classes are useless without "what do I do at 3 a.m." |
| `docs/PHASE_15_WINDOWS_SECURITY.md` | New: verified-good / verified-absent / **UNVERIFIED** tables, the elevated `manage-bde -status`-only runbook with `-protectors -get` prohibited, listener inventory, the FreeLLMAPI LAN inference labelled as inference, the retracted PID-15168 claim, control↔evidence mapping | BitLocker, TPM and Secure Boot could not be read from this account. Writing them as passed would be the single most consequential lie available in this document |
| `docs/PHASE_15_PENETRATION_TESTING.md` | New: rules of engagement, direct-vs-bypass method, 7-class matrix, F1–F8 with fixed/design/accepted labelled separately, F1 blast-radius lesson, verification commands including both typecheck modes, 6 residuals | The tsconfig-excludes-tests detail is why "tsc is green" had to be stated as two different commands |
| `docs/PHASE_15_SOAK_TESTING.md` | New: why not upstream `soak-test.sh`, bounds and isolation, workload mix, recorded results, the 10 verdicts, the two measurement subtleties, 7 uncovered items, when to re-run, 5 residuals | `dbGrowthLinear` was tautological; a reader who does not know that will over-weight the verdict |
| `docs/PHASE_15_BACKUP_VALIDATION.md` | New: path inventory proving a live DB exists and where tilde expansion actually points, 10-verdict table with the live-DB hash, the guard-path defect and its negative control, restore procedure and limits, 6 residuals. §1 **rewritten after writing**: the first draft repeated the "no live database" error | Drafted from the 15K report, which was the wrong source for a filesystem fact. Caught by checking the claim against the disk before finalizing |
| `scripts/phase15-backup-validate.ts` | `LIVE_GUARD_PATHS` now built by `liveGuardPaths()` from `process.env.HOME` **and** `os.homedir()`, deduplicated; new tenth verdict `liveDbGuardNonVacuous` | The original list hashed `%USERPROFILE%\.automaton\state.db`, which does not exist, so `livePathsUntouched` reported PASS while guaranteeing nothing about the real database. The new verdict makes a vacuous guard list fail the run |
| `reports/PHASE_15_BACKUP_TEST.md` | Verdict table extended to 10 with the corrected `livePathsUntouched` caveat; "Live-state inventory" carries the dated correction block; new "Guard-path defect found during 15M" section with both runs, the negative control, the typecheck, the snapshot path and the `-shm` side-effect note; overall line changed from 9/9 to 10/10 | The report published a guarantee the measurement did not support. Correcting the validator alone would leave the false statement as the durable artifact |
| `docs/README.md` | Phase 15 documentation map (11 rows, overview first), status-B callout, pointer to this progress log, TROUBLESHOOTING row reworded to "(now root-caused and fixed)" | Phase 15 is invisible from the docs index otherwise, and the index is where a new reader starts |
| `docs/TROUBLESHOOTING.md` | §11 extended: the same `HOME`/`os.homedir()` trap corrupts **evidence**, not only state — naming the cosmetic PASS and the verdict that now exits 1 when `HOME` is unset | §11 already documented the trap for the test harness; the backup validator hit it a second time from the other direction |

Pre-edit snapshot: `backups/phase15M-pre-20261031-233344/` — the validator's exact pre-edit
text for both changed regions (`ORIGINAL_CONTENT.txt`), the edited copy, and `MANIFEST.sha256`.
The 11 documents are new files; nothing was overwritten that had no copy elsewhere. No product
source (`src/`) changed in 15M, so no test result from 15L needed re-measurement.

Method note for the whole of 15M: every claim in a document was re-checked against the source
or the filesystem before it was written down, not against the Phase 15 reports. That produced
two corrections (the health-guardian signature, the live-database claim) and one product-adjacent
fix (the validator guard path). If the reports had been treated as the source of truth, all three
would have shipped.

## Invariants held throughout Phase 15

- `security.activationApproved` remains `false`.
- `CONWAY_ACTIVATION` and `CONWAY_ALLOW_WALLET_CREATION` remain unset.
- `maxChildren` remains `0`.
- No wallet file is created; synthetic keys only in tests/temp dirs.
- No credential entered, no money spent, no blockchain transaction.
- No protected AI environment touched.
- No Windows service, startup entry, firewall rule, or security setting changed.

Re-verified at closure, 2026-11-01 10:55 IST, by reading the live config and filesystem
rather than by restating the list above:

| Check | Command / source | Output |
| --- | --- | --- |
| activation gate | `grep activationApproved runtime/home/.automaton/automaton.json` | `"activationApproved": false` |
| lockdown + tool allowlist | same file | `"lockdown": true`, `"allowedTools": []` |
| replication | same file | `"maxChildren": 0` |
| env gates | `echo "${CONWAY_ACTIVATION:-UNSET}"`, `${CONWAY_ALLOW_WALLET_CREATION:-UNSET}` | both `UNSET` |
| self-healing opt-in | `grep selfHealingEnabled` in the live config | absent → defaults to `false`, mechanic inert |
| wallet material | `ls runtime/home/.automaton/` + repo-wide `find -iname "wallet*.json"` excluding `node_modules`/`backups` | config, heartbeat, skills, `state.db`(+`-shm`,`-wal`) only — **no wallet file** |
| live DB | `ls -la` | `state.db` 512 000 B, mtime 10-31 15:55 — unchanged by 15M; the only 15M side effect is `state.db-shm` (32 768 B, 23:29) from opening the database read-only |
