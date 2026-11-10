# Phase 16 — Gap Analysis (Final Security Closure)

Date: 2026-11-01 (IST). Install: `<repo-root>` v0.2.1 — the existing
installation, continued from Phase 15; not reinstalled, not duplicated.
Runtime home used for every command in this phase: `<repo-root>\runtime\home`
(verified before each operation; see `reports/PHASE_16_PROGRESS.md`, "Standing invariants").

Companion documents: `reports/PHASE_16_CODE_SECURITY.md` (code-level findings and fixes),
`reports/PHASE_16_PROGRESS.md` (running evidence log), `reports/PHASE_15_GAP_ANALYSIS.md`
(the register this phase closes against), `docs/PHASE_15_OVERVIEW.md:66-123` (residual-risk
source).

Verdict vocabulary, per the master prompt's §9/§30:

| Status | Meaning |
|---|---|
| CLOSED | Fix implemented **and** proved by an executed test in this phase |
| PARTIALLY CLOSED | One layer fixed; a named remainder is still open |
| OPEN | Gap confirmed, deliberately not fixed in this phase, with a designed remediation |
| BLOCKED | Cannot be verified or fixed without an operator action (elevation, a new component, a credential) — the exact blocked command and the reason are recorded |
| NOT YET PROVABLE | Mechanism works structurally; the real-data condition cannot be demonstrated yet |

---

## 1. Gap register entering Phase 16, and where each one stands

| ID | Gap (as inherited) | Phase 16 status | Evidence |
|---|---|---|---|
| R-1 | BitLocker, TPM and Secure Boot unverified (`Get-BitLockerVolume` → Access denied) | **BLOCKED → re-examined in 16B.** The inherited framing "no administrator rights" is wrong: the account **is** a member of BUILTIN\Administrators, and the token is UAC-filtered to Medium IL. That changes the remedy (one elevated run, not a different account) and is recorded as such. | `reports/PHASE_16_WINDOWS_VERIFICATION.md`, `reports/PHASE_16_WINDOWS_POSTURE_RAW.txt` (18 982 B) |
| R-2 | Restore proved structurally, not against real user data | **NOT YET PROVABLE — measured, 16C.** Live `runtime/home/.automaton/state.db` = 512 000 B, schema **V11**, **37** tables, **36 empty**, 10 rows total and all 10 are `schema_version` migration bookkeeping (V2..V11). Backup + restore mechanics VERIFIED against that real file (10/10 harness verdicts, active DB hash unchanged throughout); there is simply no user data to recover. No rows were fabricated. | `reports/PHASE_16_BACKUP_RESTORE.md`, `reports/PHASE_16_16C_EVIDENCE.json` |
| R-3 | `policyEngine` optional in `executeTool` → the policy layer could be skipped silently | **CLOSED** (16A.1). A capability-bearing dispatch without an engine or turn context is now a hard denial (`POLICY_ENGINE_MISSING` / `POLICY_TURN_CONTEXT_MISSING`) **before** the treasury guard; direct and indirect bypass tests both fail closed with zero treasury rows. | `src/security/policy-enforcement.ts`, `src/__tests__/security/phase16-policy-enforcement.test.ts` (13 tests) |
| R-4 | Application-level sandbox is not OS isolation | **OPEN by design, wording corrected.** Confirmed: no job object, no syscall restriction, no capability drop. Phase 16 corrects one inherited *inaccuracy* (Job Objects do **not** need administrator rights for the standard limits — measured) and keeps the honest label. All real isolation options need elevation, a new native dependency, or an edition this host does not have. | `reports/PHASE_16_ISOLATION_EVALUATION.md` (8 options, executed probes) |
| R-5 | Self-healing inert by design | **CLOSED as a safety property** (16A.4). Absent key ⇒ `=== true` ⇒ disabled; deny-by-default registry; the pattern net now refuses activation approvals, tool allowlists, permission grants and security-control disabling **by name**, and its coverage is pinned by reason string rather than by an unknown-id accident. | `src/reliability/mechanic.ts`, `reports/PHASE_16_PATTERN_PROBE.cjs`, `src/__tests__/security/phase16-self-healing-safety.test.ts` (28) + `phase15-self-healing.test.ts` (40) = 68 passed |
| R-6 | Spend tracking can fail open after commit | **PARTIALLY CLOSED.** The transfer-cap compensation is real (`treasury_authorizations`, checked at reserve); the *audit-chain* compensation was **not** real and is now fixed; the tracking failure now raises a CRITICAL event. Two derived vacuous controls found and recorded as R-11/R-12-adjacent findings. | 16A.5 in `reports/PHASE_16_PROGRESS.md`; `src/__tests__/security/phase16-audit-visibility.test.ts` (10) |
| R-7 | 15L fixes unverified on POSIX | **BLOCKED.** `isWindows` is a module-level constant and `normalizeForCompare` uses `path.resolve`, so a mocked platform on a Windows host proves nothing; `wsl -l -q` returns no distro and the WSL component is disabled. Operator instruction recorded; no component installed. | 16A.5 / R-7 section |
| R-8 | Load-dependent test timeout | **MEASURED, not a defect.** `heartbeat.test.ts` = 2.815 s / 2.775 s in isolation (two runs), both green. Full-suite failures are host saturation; `testTimeout` deliberately stays at the default so real hangs still trip. | Test-run log 13:05–13:06 |
| R-9 | Nothing has ever run against a live model | **PREPARED, STILL BLOCKED ON CREDENTIAL APPROVAL.** The gate exists, is tested and was executed against the live install: `verdict=SAFETY_GATE_FAILED`, `credentialPresent=false`, `approvalPresent=false`. No credential entered, no agent activated. | `src/security/live-model-preflight.ts`, `scripts/phase16-live-model-preflight.ts`, `src/__tests__/security/phase16-live-model-preflight.test.ts` (23) |
| R-10 | `~` resolves through `HOME`, falling back to `/root` | **CLOSED.** `resolvePath` → `joinTilde` → `resolveHome`, which throws `HOME_UNSET`; 12 scattered `HOME \|\| "/root"` fallbacks replaced by one guard module with a non-vacuity test. | `src/runtime/home-guard.ts`, `src/__tests__/runtime/home-guard.test.ts` (19) |

## 2. New gaps found *during* Phase 16 (all confirmed by execution, not inference)

| ID | Finding | Severity | Status |
|---|---|---|---|
| 16A-DEFECT-1 | Emergency-stop read used a single path, so a launcher and a reader that disagreed about `HOME` left the stop **failing open** | High | CLOSED + tests (`phase16-emergency-stop-isolation.test.ts`, 6) |
| 16A-DEFECT-2 | The fix for 16A-DEFECT-1 made `engageEmergencyStop()` write into the **live** state tree during tests | High (self-inflicted, caught by test fallout) | CLOSED — write target is now `stateDir()` first, and clearing removes every scanned marker; the stray marker was quarantined, not deleted, with its hash preserved |
| 16A-DEFECT-3 | `FORBIDDEN_PATTERNS` had **no pattern at all** for activation approvals or tool allowlists, and used `\s+` where repair ids use `_` | Medium (defence-in-depth: today those ids are refused only for being unregistered) | CLOSED + reason-pinned tests and the re-runnable probe |
| R-11 | `maxInferenceDailyCents` is enforced nowhere: no code records `category:"inference"`, and no registered tool is named `chat`/`inference`, so the rule can never select a tool | Medium — spending control that reads as configured but cannot fire | OPEN, design recorded in `PHASE_16_CODE_SECURITY.md` §4 |
| R-12 | `resolveSandboxRoot()` falls back to `process.cwd()` when neither `sandboxRoot` nor `HOME` is set, silently widening the writable root | Medium | OPEN — route through `resolveHome()` so unset HOME fails closed |
| R-13 | `x402_fetch` records `amountCents: 0`, so the x402 hourly/daily envelope is a sum of zeros | Medium | OPEN — needs the real settled amount from the x402 response path |
| R-14 | **Live database is two migrations behind the code** (V11 vs V13): `security_events`, `treasury_authorizations`, `security_incidents`, `security_seals` and their triggers do not exist in the live state tree | **High** — every Phase 15 security control that writes those tables is inert on the live install until V12/V13 are applied; the emergency-stop DB source of truth silently reports "not engaged" | OPEN by necessity: applying them mutates the live DB, so it is sequenced after a validated backup (16C) and is an operator-visible step, not a silent one |
| R-15 | Project root grants `Authenticated Users:(M)`, so any local account can edit Conway's source — which undermines every in-process control | High | BLOCKED — ACL change needs elevation **and** operator approval; not executed |
| R-16 | The npm package-name validator (`/^[@a-zA-Z0-9._\/-]+$/`, duplicated in **4** places) admitted a leading `-`, so the value reaches `npm install -g …` as a switch. Measured on npm 10.9.9: unknown switches are not rejected, and with no positional package npm installs the **current working directory** — the probe linked the Conway project into the pinned runtime as a junction (since unlinked and verified reverted) | Medium — wrong-target install, not code execution. Value-bearing switches were never reachable (`=` and space were already rejected) | **CLOSED** in 16A.6: one exported `isValidPackageName()` shared by all four call sites, 15 red-first tests, 128 regression tests still green |
| R-17 | `HOME` isolation does not extend to toolchains Conway shells out to: npm resolves its cache from `%LocalAppData%` (`USERPROFILE`), so npm activity wrote `_cacache`, `_logs`, `_npx` under the Windows user profile while `runtime/home/npm-cache` stayed absent | Medium for §3's isolation claim — host-side writes outside the isolated tree, and `_logs` contains absolute host paths | OPEN, recorded — the fix (`npm_config_cache` / `LOCALAPPDATA` for child processes) changes host behaviour for every npm run as this user, so it is an approval item. Directly relevant to the Phase 17 dashboard's `npm install` |
| R-18 | **POSIX shell quoting is inert under `cmd.exe`.** `execSync` on Windows uses `%ComSpec%`; `escapeShellArg()` wrapped arguments in single quotes, which `cmd.exe` does not treat as quoting. Reproduced: `cat '…nope&echo INJECTED_AMP'` exited 0 and printed `INJECTED_AMP'`. Reachable from model input through `read_file` (confinement admits `&`, `readFile` throws on the missing file, the `catch` falls back to `exec(cat)`) and through the generic installed-tool wrapper | **High** — arbitrary second command on the host, i.e. RCE-grade, for any tool-enabled agent. **Not live today**: `lockdown = true` and `allowedTools = []`, so nothing dispatches. Latent behind the activation gate, which is exactly the gate Phase 17 precedes | **CLOSED** in 16A.7 — `src/security/shell-quote.ts` refuses cmd.exe parse-time metacharacters on win32 (`\0 & \| < > ^ " % ! CR LF`) and leaves the POSIX branch byte-identical; 13 red-first tests, 201 green across 4 suites, no existing test changed |
| R-19 | `validateShellCommand`'s deny-list (36 patterns, `src/security/sandbox.ts:206-248`) is more Windows-aware than expected — `format`, `diskpart`, `vssadmin`, `bcdedit`, `netsh advfirewall`, `Set-MpPreference`, `schtasks /create`, `takeown`, `icacls`, `manage-bde -protectors`, `powershell -enc` all present — but omits `del /f /s /q`, `certutil`, `bitsadmin`, `mshta`, `rundll32`, `wmic` and `curl` POST exfiltration (each verified absent by grep) | Medium **if** `exec` is ever reachable; today `shell_execution` is denied by `lockdown = true` + empty allowlist | OPEN by choice — extending a deny-list is whack-a-mole and the module's own header says the primary control is the callable tool set. Recorded instead of patched; must be revisited before any activation that grants shell execution |
| R-20 | `scripts/backup-restore.sh` `do_restore` copies the archive straight over its `<db_path>` argument (`cp "$backup_path" "$db_path"`, then `-wal`/`-shm` too). It verifies the **source** integrity but never refuses a live destination, and a WAL-aware restore that carries side files can resurrect frames whose salt no longer matches the main file | **Low** — operator-only tool: it runs only when a human types the target, it writes a timestamped `state.db.pre-restore.<epoch>` copy first, and `grep -rn "backup-restore" src/ runtime/bin/ dashboard/` returns **no automated caller** | OPEN by choice — recorded, not patched. The Phase 17 dashboard restore must instead target an alternate path behind explicit confirmation (§28). The validated non-destructive path is `scripts/phase15-backup-validate.ts` + `src/__tests__/security/phase16-backup-roundtrip.test.ts` |
| R-21 | The live lockdown config silently inherits **non-zero monetary caps** from code defaults. `src/config.ts:45-48` merges `{...DEFAULT_TREASURY_POLICY, ...raw.treasuryPolicy}`, and `automaton.json` predates three fields added to the default (`src/types.ts:604-606`), so the resolved live policy carries `maxMonthlyTransferCents=100000`, `agentBudgetCents=200000`, `childBudgetCents=50000` while the file itself says nothing about them. All three are read as enforcement caps by `src/security/treasury-guard.ts:404/414/424` | **Medium** — a defence-in-depth gap, not a live exposure: `lockdown=true`, `activationApproved=false`, `allowedTools=[]`, `allowFinancialTools=false`, `maxChildren=0`, no wallet material and both activation flags unset were all re-read through the app's own loader. Found by the 16D preflight, not by reading the config, which is exactly what made it visible | OPEN — recorded, **not** auto-fixed: tightening it means editing the operator's live config, which 16D does not require (the isolated fixture writes all 13 fields to 0 by construction). Three-line operator remedy in `reports/PHASE_16_LIVE_MODEL_TESTING.md` §5. The gate now fails loudly on it |
| R-22 | The 16D preparation gate could **never report READY**: `scripts/phase16-live-model-preflight.ts` validated HOME in `runtime` mode (which requires HOME = the live home) and then asserted `home.isolated_test_tree` (which requires the opposite). A permanently-refusing gate is not a control — it hides whether the rest of the preparation is correct | **High for the deliverable**, Low for runtime safety (fail-closed direction). Surfaced only by actually executing the script rather than trusting its 23 passing unit tests | **CLOSED** in 16D — `--test-home` re-validates through the guard's existing `isolated` mode (`home-guard.ts:251-270`) and refuses the runtime home itself (`HOME_NOT_ISOLATED`) and non-existent dirs; default behaviour unchanged. Isolated tier now passes **18/18** and stops at `credentialPresent=false approvalPresent=false`. 8 new CLI-level tests incl. "credential + approval do not outrank a safety failure" |
| R-23 | **The runnable artifact did not contain Phase 16.** `START_CONWAY.bat:56` launches `dist\index.js --run`, but `dist/` was last built 2026-10-31 18:39 — before every Phase 16 change. Measured: 0 of 500 `dist` files mentioned `POLICY_ENGINE_MISSING` (the 16A.1 fail-closed reason code) and `dist/security/live-model-preflight.js` did not exist. The 143 Phase 16 tests import `src/`, so they could never have caught this: green tests and a launcher running pre-hardening code, simultaneously | **High** — every code-level control this phase verified was inert in the thing the operator actually starts. Surfaced by asking what the launcher executes, not by any test | **CLOSED** in 16E — `dist` and `packages/cli/dist` backed up (`backups/phase16/pre-16E-dist/`, tree digest `5a5109f8…` verified byte-identical to the baseline manifest), rebuilt with the project-local `tsc` only (root + `packages/cli`, both exit 0; `npm run build` deliberately avoided because `pnpm -r build` writes to `%LocalAppData%` — **R-17**). Post: 540 files, digest `deb086df…`, marker present, 0 orphan `.js` without a matching `src/*.ts`. Rebuilt artifact re-run: `HOME` guard fires, `--run` exits **2** with `activationApproved is not true`, `state.db` hash unchanged. Evidence: `reports/PHASE_16_REGRESSION_RESULTS.md` §3 |

## 3. What Phase 16 did *not* change

The §29 invariants were measured, not assumed, and remain as required:
`activationApproved=false`, `lockdown=true`, `allowedTools=[]`, `maxChildren=0`,
`allowFinancialTools=false`, `allowHostShell=false`, `allowSelfModification=false`,
`allowReplication=false`, `allowExternalExposure=false`, `selfHealingEnabled` **absent**
(⇒ default `false`), `CONWAY_ACTIVATION` and `CONWAY_ALLOW_WALLET_CREATION` unset,
no `wallet.json`, no API key in the config file, live DB SHA-256 unchanged
(`2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`, 512 000 B).

No wallet was created or funded; no transaction executed; no credential entered; no AI
credit purchased; no replication, network exposure or Windows service enabled; no Windows
security setting changed; no autonomous activation. Nothing in the protected list at §2
(OmniRoute/OmniRoad, FreeLLMAPI, Ollama, OpenCode, Qoder global config, existing MCP
servers, TradingAgents, ADRE-RN, Paperclip AI, Windows services, Windows security
settings) was modified; FreeLLMAPI's `0.0.0.0:3001` listener was observed and left alone.

## 4. Residual posture, stated plainly

Conway remains a **locked, inactive** agent whose controls are now mutually consistent at
the dispatch layer, but whose OS position is "same trust domain as the user": an
application-level guard rail on a UAC-filtered Administrator account, in a directory that
other local accounts can write to, with a state database two migrations behind the code.
The controls that were verified in this phase were verified against freshly-migrated
in-memory databases; the live install's own database cannot exercise them yet (R-14).
Zero vulnerabilities is not claimed, and "all tests pass" is not the same as "isolated":
the honest current labels are **R-3 CLOSED**, **R-4 OPEN**, **R-9 PENDING CREDENTIAL
APPROVAL**, **R-14/R-15/R-17 requiring operator action**, **R-16/R-18 CLOSED**.

The organising observation of 16A.6–16A.7 is that **the tool layer is POSIX-shaped while the
live install is Windows-local.** `conway.exec` with no sandbox id is `execSync` under
`cmd.exe`; every quoting rule, metacharacter list and package-name pattern written before
this phase was reasoned about `/bin/sh`, and the Phase 15 conclusion "injection closed" was
correct for the sandbox and wrong for this host. R-18 was the one High-severity finding of
Phase 16 and the only RCE-grade one; it was latent solely because `lockdown = true`. R-16 is
the same class of mistake in miniature. The remaining POSIX-only assumptions are itemised in
`reports/PHASE_16_CODE_SECURITY.md` §6 and are **not** closed here.
