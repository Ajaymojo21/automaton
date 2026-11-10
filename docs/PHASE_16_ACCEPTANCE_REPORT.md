# Phase 16 — Acceptance Report

**Install:** `<repo-root>` — existing installation, upstream v0.2.1 at
`d8f816881fd24b6f5e3d616e59edec387a447667`. Not reinstalled, no second install created.
**Reported:** 2026-11-01.
**Classification required by §31:** **Phase 16 = PARTIALLY VERIFIED.**
**Status letter required by §10:** **B — partially complete, residual risks documented, activation gates closed.**

This report is an acceptance matrix, not a summary. Each §-requirement is stated, the action
taken is stated, and the verdict is one of
**VERIFIED / PARTIALLY VERIFIED / NOT VERIFIED-BLOCKED / NOT APPLICABLE**, with the command or
artifact that produced the verdict. Where a check did not run, it is named and its blocker is
given. **No requirement below is marked VERIFIED on the strength of a configuration file.**

---

## 1. Verdicts against the mandate, requirement by requirement

| § | Requirement (as given) | Verdict | How it was established |
|---|---|---|---|
| §1 | Continue the existing install; do not reinstall, replace or duplicate | **VERIFIED** | No `npm install`/`git clone` was run against the repo; dependency tree untouched; `runtime/home/.automaton/` contains the same six entries as before the phase, and `state.db` hash is unchanged |
| §2 | Inspect → back up → record SHA-256 → implement → test → verify rollback; delete no existing backup/DB/report | **VERIFIED** | Every modified source/script file has a `backups/phase16/*.pre-*.bak` with its pre-hash recorded in `reports/PHASE_16_PROGRESS.md:949+`. The `dist/` rebuild added a manifest-verified rollback copy (`backups/phase16/pre-16E-dist/`, digest `5a5109f8…` proven identical to the baseline) before touching anything. The superseded 14:09 regression JSON was **kept**, not overwritten |
| §3 | `HOME` isolation: every command uses `runtime\home`; never fall back to `C:\root` or the user profile; prove the guard is non-vacuous; abort on failure with no new state dir | **VERIFIED** | 19 tests in `src/__tests__/runtime/home-guard.test.ts`, including profile-root and non-existence refusals; `resolveHome()` throws `HOME_UNSET` where 12 `HOME \|\| "/root"` fallbacks used to be (R-10 closed); `ls /c/root` → **does not exist**; the guard's own line is the first output of the rebuilt `dist/index.js` |
| §5 / A.1 | No sensitive tool executes without authorization; fail closed when policy context is missing; direct **and** indirect bypass tests | **VERIFIED** | `POLICY_ENGINE_MISSING` hard denial at dispatch; two real production sites found passing no engine (one fixed centrally in `createHarness()`), 13 tests incl. indirect bypass; the two full-suite failures this produced are documented with their root causes rather than softened |
| §5 / A.2 | Prepare live-model security; do not enter real credentials; do not activate without approval | **VERIFIED as preparation** | 18-check gate + CLI; **no credential exists and none was entered**; both approval env flags verified unset; `verdict=READY` reached only with a **fake** key and a token set inside a child process for one assertion |
| §5 / A.3 | Evaluate stronger isolation; do not claim app-level == OS-level; do not install privileged components | **VERIFIED** | `reports/PHASE_16_ISOLATION_EVALUATION.md` — 8 options, token state measured, tier (iii) recorded as **impossible** on Home SL; nothing installed; §3 of `docs/PHASE_16_OVERVIEW.md` carries the honest wording |
| §5 / A.4 | Self-healing stays disabled by default; mechanic must never alter wallet credentials, treasury limits, security policy, activation approvals, tool permissions | **VERIFIED** | 28 tests; absent config key ⇒ disabled; deny-by-default repair registry; pattern net extended to refuse approval/allowlist files after a probe found it did not (16A.4-DEFECT-3) |
| §5 / A.5 | Investigate R-6, R-7, R-8, R-10 | **PARTIALLY VERIFIED** | R-6 partly closed (the *audit-chain* compensation was not real and is now); R-10 closed; R-8 **measured** (2.8 s isolated) not assumed; **R-7 NOT VERIFIED-BLOCKED** — no POSIX runner exists and mocking `isWindows` on Windows proves nothing. 3 new risks found (R-11, R-12, R-13) |
| §6 / B | Read-only Windows verification; never read BitLocker protectors/recovery keys; never change BitLocker/TPM/Secure Boot/Defender/Firewall; if elevation is unavailable record UNVERIFIED, generate the operator instruction, continue | **PARTIALLY VERIFIED** | 10 items VERIFIED, 5 **UNVERIFIED-BLOCKED** with the exact elevated read-only block prepared (`reports/PHASE_16_WINDOWS_VERIFICATION.md` §3). `manage-bde -protectors -get` **never executed**. One inherited factual error corrected: the account is a UAC-filtered Administrators member, not a standard user |
| §7 / C | Real-data backup/restore against the actual live DB; never overwrite the active DB; if there is no genuine user data record `REAL_DATA_RESTORE = NOT YET PROVABLE`; do not fabricate data | **PARTIALLY VERIFIED** | Backup and restore mechanics VERIFIED against the real live file with the active file provably unchanged; `REAL_DATA_RESTORE = NOT YET PROVABLE` on measured grounds (**37 tables, 1 non-empty, 10 rows**, all migration bookkeeping). **No rows fabricated.** R-20 recorded from the same investigation |
| §8 / D | Isolated model-testing environment: no wallet, no financial permission, no publishing, no replication, no unrestricted shell/FS; synthetic data only; if no credentials record `LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL` | **PARTIALLY VERIFIED** | `runtime/model-test-home/` built to that spec (config only, 13 treasury fields = 0, no DB, no wallet) and verified to contain only `automaton.json`; isolated tier passes **18/18**; four-tier run captured verbatim. Verdict stands: **PENDING CREDENTIAL APPROVAL** — the call itself was not made |
| §9 / E | Full regression reporting Passed / Failed / Skipped / Blocked / Not applicable; never hide failures; never claim zero vulnerabilities | **VERIFIED** | `reports/PHASE_16_REGRESSION_RESULTS.md`: **2057 passed, 0 failed, 0 skipped** (skips verified by grep, not by the counter), **5 Blocked**, **4 Not applicable**. Includes three failures I caused or found earlier with root causes, the 100.8 s `loop.test.ts` variance, and the §9 "does not prove" list. R-1…R-23 stay open |
| §10 | `docs/PHASE_16_OVERVIEW.md`, `docs/PHASE_16_ACCEPTANCE_REPORT.md`, `reports/PHASE_16_PROGRESS.md`; A/B/C/D status; do not claim A while admin verification, real-data recovery or live-model testing is unverified; keep gates closed | **VERIFIED** | All three exist. **Status B**, with the §10 disqualifiers listed as unmet in §4 of the overview. Gates re-measured (§5 below) |
| §29 | 14 actions prohibited without approval | **VERIFIED — none performed** | Activation flag, wallet creation flag, wallet, funding, transaction, credit purchase, financial tool, replication, network exposure, Windows service, Windows security change, unrestricted autonomy: each re-checked; §31 classification below |
| §30 | Admin-blocked → prepare exact read-only command + record limitation + continue; credential-blocked → prepare integration, leave credentials empty; data-unavailable → record pending; do not fabricate evidence; persistent progress file; resume from last verified checkpoint | **VERIFIED** | All three fallback patterns were exercised literally: the elevated command block (§6), the empty-credential integration with the gate tested to `READY` using a fake key (§8), and `NOT YET PROVABLE` for real data (§7). `reports/PHASE_16_PROGRESS.md` is the persistent log (1 172 lines) |
| §11–§28 Phase 17 | Dashboard | **NOT STARTED at this checkpoint** | The §19 data-source inventory is complete (`reports/PHASE_16_DATASOURCE_INVENTORY.md`) and port `127.0.0.1:8787` was verified free; two prerequisites are operator items: **R-17** (`npm install` writes to `%LocalAppData%`) and **R-15** |

## 2. §31 deliverables

The ten artifacts this phase was required to hand over, in the order they were produced, each
with its own verdict. (The lettering is mine for traceability; the set is what §31 enumerates.)

| | Deliverable | Artifact | Verdict |
|---|---|---|---|
| A | Gap analysis against the Phase 15 register | `reports/PHASE_16_GAP_ANALYSIS.md` (R-1…R-23) | **VERIFIED** |
| B | Code-level security findings and fixes | `reports/PHASE_16_CODE_SECURITY.md` | **VERIFIED** |
| C | Windows host verification | `reports/PHASE_16_WINDOWS_VERIFICATION.md` + `…_POSTURE_RAW.txt` | **PARTIALLY VERIFIED** (5 blocked) |
| D | Isolation evaluation | `reports/PHASE_16_ISOLATION_EVALUATION.md` | **VERIFIED** (evaluation deliverable) |
| E | Backup / restore validation | `reports/PHASE_16_BACKUP_RESTORE.md` + `PHASE_16_16C_EVIDENCE.json` | **PARTIALLY VERIFIED** |
| F | Live-model testing preparation | `reports/PHASE_16_LIVE_MODEL_TESTING.md` + `…_PREFLIGHT_RAW.txt` | **PARTIALLY VERIFIED** — preparation verified, execution **BLOCKED** on credential approval |
| G | Full regression results | `reports/PHASE_16_REGRESSION_RESULTS.md` + `PHASE_16_16E_FULL_RUN_FINAL.json` | **VERIFIED** |
| H | Persistent progress log | `reports/PHASE_16_PROGRESS.md` | **VERIFIED** |
| I | Overview document | `docs/PHASE_16_OVERVIEW.md` | **VERIFIED** |
| J | Acceptance report | this file | **VERIFIED** |

**Overall Phase 16 classification (§31): PARTIALLY VERIFIED.**
**Overall Phase 17 classification (§31): not yet assessed — the dashboard is the next task.**

## 3. Blocked items, with their exact blockers

| Item | Verbatim blocker | Unblocks on |
|---|---|---|
| Coverage measurement | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` (exit 1). `vitest.config.ts` nevertheless sets thresholds 60/50/55/60 — that gate has never run | Operator approves `pnpm add -D @vitest/coverage-v8` |
| POSIX verification (R-7) | `wsl -l -q` reports no distributions; no Docker; `isWindows` is a module-level constant so a mocked platform on a Windows host proves nothing | Any Linux/WSL runner |
| BitLocker, TPM ownership, UEFI Secure Boot variables, Defender exclusions (R-1) | `ERROR: An attempt to access a required resource was denied`; `Administrator privilege is required`; `Unable to set proper privileges` (needs `SeTcbPrivilege`); `{N/A: Must be an administrator to view exclusions}` | One elevated **read-only** run of the prepared block |
| Live model call (R-9) | No credential present; no approval token set — by design | Credential **+** `CONWAY_LIVE_MODEL_APPROVED=APPROVED` |
| Real-data restore (R-2) | Live DB holds 10 rows, all `schema_version` bookkeeping; zero user data | First genuine agent run, then re-drill |
| Source-tree ACL (R-15) | `Authenticated Users:(M)` on the project root; owner-rights but still a host state change | Operator approval for `icacls` |
| V11→V13 live migration (R-14) | `createDatabase()` migrates on open, i.e. it **rewrites the active file** | Operator decision, fresh archive first |

## 4. Failures and self-corrections disclosed, not hidden

Reporting these is part of the acceptance, because the alternative is a report that reads better
than it is.

1. **A permanently-refusing gate shipped as "verified"** (R-22) — 23 passing unit tests coexisted
   with a script that could never print `READY`. Only executing it found that.
2. **An un-hardened artifact stayed green for the whole phase** (R-23) — the suite tests `src/`,
   the launcher runs `dist/`.
3. **A first regression number that was 2049, not 2057** — taken before the 16D test file existed;
   detected by `grep -c live-model-tier` on the JSON, then re-run.
4. **An invented assertion** — `expect(sidecars.length).toBeGreaterThan(0)` after `db.close()`;
   SQLite checkpoints and *deletes* `-wal`/`-shm` on a clean close, so the suite refused my
   assumption and it was replaced with a measured hazard test (`cp` → 5 rows, backup API → 6).
5. **A `TS2304` the green suite could not see** — vitest strips types without checking them. Third
   occurrence in this phase of the separate typecheck earning its keep.
6. **Draft defects caught before execution** in `phase16-backup-roundtrip.test.ts` (nonsense SQL
   subquery, a garbage line, un-awaited `.backup()` promises, an id that would have broken the
   density assertion).
7. **Two documentation errors of my own making** — an invented byte/line count for the isolated
   fixture (replaced with measured 1 547 B / 50 lines + SHA), and a gap-register edit that glued
   R-21 and R-22 onto one row (caught by counting `^\| R-\d+ \|` matches: 21, then 21 again,
   then 22). Register now verified at 23 contiguous rows.
8. **One Edit-tool anchor destruction** that deleted the R-16 bullet's first line; found by
   inspection and repaired.

## 5. Activation posture at sign-off

`activationApproved=false`, `lockdown=true`, `allowedTools=[]`, `maxChildren=0`,
`selfHealingEnabled=false`, `allowFinancialTools=false`, `allowHostShell=false`,
`allowSelfModification=false`, `CONWAY_ACTIVATION` unset, `CONWAY_ALLOW_WALLET_CREATION` unset,
no wallet material, no live-model credential. Re-read through the application's own `loadConfig()`
and re-demonstrated by the rebuilt artifact refusing `--run` with exit code 2.

**Do not read this report as clearance to activate.** Two independent §7 preconditions are still
`NOT VERIFIED` — disk encryption/TPM state (R-1) and real-data recoverability (R-2) — and three
spending controls are configured but unenforced (R-11, R-12, R-13). The gates are shut because
they have not been proven necessary-and-sufficient to open, not because opening them is pending
paperwork.

## 6. Where the evidence is

| Claim type | Look in |
|---|---|
| Running log with commands, hashes, times, retractions | `reports/PHASE_16_PROGRESS.md` |
| Risk register R-1…R-23 with status per row | `reports/PHASE_16_GAP_ANALYSIS.md` |
| Machine-readable regression output | `reports/PHASE_16_16E_FULL_RUN_FINAL.json`, `…_SUMMARY.txt` |
| Machine-readable backup evidence | `reports/PHASE_16_16C_EVIDENCE.json`, `PHASE_16_16C_RESTORE_RAW.json` |
| Preflight verdicts, four tiers, verbatim | `reports/PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt` |
| Host posture, verbatim command output | `reports/PHASE_16_WINDOWS_POSTURE_RAW.txt` |
| Build-artifact manifests (pre / backup / post) | `reports/PHASE_16_16E_DIST_*.manifest`, `…_DIST_ORPHANS.cjs` |
| Reproduce commands | `reports/PHASE_16_REGRESSION_RESULTS.md` §10, `docs/PHASE_16_OVERVIEW.md` §8 |
| Rollback copies | `backups/phase16/` (pre-change sources + `pre-16E-dist/`) |
