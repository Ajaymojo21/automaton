# Phase 16 — Final Security Closure: Overview and Residual Risks

**Scope:** close the residual risks Phase 15 left open, and prove each closure by executing
something — never by reading a config file and inferring behaviour.
**Install:** `<repo-root>`, upstream v0.2.1 at commit
`d8f816881fd24b6f5e3d616e59edec387a447667` — the **existing** installation, continued from
Phase 15. Not reinstalled, not replaced, no second Conway created.
**Runtime home for every command:** `<repo-root>\runtime\home`.
**Executed:** 2026-11-01.
**Final status:** **B — PHASE 16 PARTIALLY COMPLETE, RESIDUAL RISKS DOCUMENTED, ALL ACTIVATION
GATES CLOSED.**

> Status **A is not claimed and cannot be claimed on this host yet.** §10 forbids it while
> (a) administrator-only Windows verification, (b) real-data recovery, and (c) live-model
> testing remain unverified. All three are unverified for measured reasons — see
> [Why not A](#why-this-is-status-b-not-a). Nothing in this phase activated the agent.

Read this first, then the control document for the specific area. Every claim links to executed
evidence in [`../reports/`](../reports).

---

## 1. What Phase 16 delivered

| Sub-phase | Requirement | Result | Control / evidence document |
|---|---|---|---|
| §5 / 16A.1 | Mandatory policy enforcement (R-3), fail closed, bypass tests | **CLOSED** — a capability-bearing dispatch with no engine or turn context is a hard denial (`POLICY_ENGINE_MISSING`); two production call sites were found assembling contexts without the layer and fixed centrally | `reports/PHASE_16_CODE_SECURITY.md`, `src/__tests__/security/phase16-policy-enforcement.test.ts` (13 tests) |
| §5 / 16A.2 · §8 / 16D | Live-model security preparation (R-9) without entering credentials or activating | **DONE as preparation** — 18-check gate written, executed, and its permanently-refusing defect (R-22) closed; isolated test home built; verdict `PENDING CREDENTIAL APPROVAL` | `reports/PHASE_16_LIVE_MODEL_TESTING.md` + `PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt`, `src/security/live-model-preflight.ts`, 23 + 8 tests |
| §5 / 16A.3 | Stronger isolation evaluation (R-4) | **Evaluation only** — 8 options assessed against the real token state; nothing installed, no privileged component added; R-4's inherited wording corrected | `reports/PHASE_16_ISOLATION_EVALUATION.md` |
| §5 / 16A.4 | Self-healing safety (R-5), must never touch money/approvals | **CLOSED as a safety property** — disabled by construction (absent key ⇒ `!== true`), deny-by-default repair registry, pattern net extended to refuse activation approvals and tool allowlists | `src/__tests__/security/phase16-self-healing-safety.test.ts` (28 tests), `reports/PHASE_16_PATTERN_PROBE.cjs` |
| §5 / 16A.5 | Investigate R-6, R-7, R-8, R-10 | **2 fixed, 1 blocked, 1 measured, 1 closed** — and 3 new spending risks surfaced (R-11, R-12, R-13) | `reports/PHASE_16_PROGRESS.md:297-399`, 10 + 23 tests |
| §5 / 16A.6 | npm package-name flag confusion (R-16) | **CLOSED** — one validator shared by 4 call sites; leading-dash tokens rejected; 15 red-first tests; new risk **R-17** recorded | `src/__tests__/security/phase16-package-name-hardening.test.ts` |
| §5 / 16A.7 | POSIX quoting inert under `cmd.exe` (R-18) | **CLOSED** — injection reproduced by probe, reachability traced, `quoteShellArg` refuses cmd.exe metacharacters on win32; 13 red-first tests | `src/__tests__/security/phase16-win-shell-quoting.test.ts`, `reports/PHASE_16_WINQUOTING_PROBE.cjs` |
| §3 | Centralized `HOME` isolation with non-vacuous tests | **CLOSED** — guard with `runtime` / `isolated` tiers, 12 scattered `HOME \|\| "/root"` fallbacks replaced by one throwing resolver | `src/runtime/home-guard.ts`, `src/__tests__/runtime/home-guard.test.ts` (19 tests) |
| §6 / 16B | Read-only Windows host verification | **DONE to the limit of a filtered token** — 10 items VERIFIED, 5 UNVERIFIED-BLOCKED with the exact elevated read-only command block prepared; one inherited framing error corrected (R-1) | `reports/PHASE_16_WINDOWS_VERIFICATION.md` + `PHASE_16_WINDOWS_POSTURE_RAW.txt` |
| §7 / 16C | Real-data backup and restore | **PARTIALLY VERIFIED** — backup + restore mechanics verified against the real live file; `REAL_DATA_RESTORE = NOT YET PROVABLE` on measured grounds; **R-20** recorded | `reports/PHASE_16_BACKUP_RESTORE.md` + `PHASE_16_16C_EVIDENCE.json`, `phase16-backup-roundtrip.test.ts` (8 tests) |
| §9 / 16E | Full regression with honest categories | **DONE** — 2057 passed / 0 failed / 0 skipped; 5 Blocked, 4 Not applicable; **found and closed R-23** | `reports/PHASE_16_REGRESSION_RESULTS.md` + `PHASE_16_16E_FULL_RUN_FINAL.json` |
| §10 | Documentation and acceptance | this file + [`PHASE_16_ACCEPTANCE_REPORT.md`](PHASE_16_ACCEPTANCE_REPORT.md) | `reports/PHASE_16_PROGRESS.md` (continuous log) |

Phase 16 added **10 test files / 143 tests**, all executed green, plus the R-1…R-23 register in
[`../reports/PHASE_16_GAP_ANALYSIS.md`](../reports/PHASE_16_GAP_ANALYSIS.md).

---

## 2. The four things this phase learned that reading the code could not teach

These are the findings I would otherwise have reported as "verified" at the end of Phase 15.

### 2.1 R-23 — the launcher was running pre-Phase-16 code

The strongest finding. `START_CONWAY.bat:56` executes `dist\index.js --run`, but `dist/` had been
built on **2026-10-31 18:39** — before every Phase 16 change. Measured: 0 of its 500 files
mentioned `POLICY_ENGINE_MISSING`, and `dist/security/live-model-preflight.js` did not exist.
Meanwhile the suite imported `src/` and reported all green.

So for most of the phase, **the controls being verified were not the controls that would run.**
A 2057-test suite cannot see this class of defect, because it never asks what the artifact is.
Closed by a backup-with-manifest (`backups/phase16/pre-16E-dist/`, tree digest `5a5109f8…`
re-verified identical), a rebuild using only the project-local compiler, an orphan scan (135 `.js`,
0 stale), and a re-run of the safety smoke **against the built artifact** — which now prints the
`HOME` guard line as its first output and exits 2 on `--run`.

### 2.2 R-22 — a gate that can never answer "yes" is not a control

The 16D live-model gate validated `HOME` in the guard's `runtime` mode (requires the live home)
and then asserted the `isolated` property (requires the opposite). Its 23 unit tests all passed;
executing the script showed it could only ever refuse. Fixed behind `--test-home`, which reuses
the guard's existing `isolated` tier, so the isolation policy is enforced in exactly one place.

### 2.3 R-21 — the lockdown config silently inherited non-zero money caps

`src/config.ts:45-48` deep-merges `{...DEFAULT_TREASURY_POLICY, ...raw.treasuryPolicy}`. The live
`automaton.json` predates three fields added to that default, so the *resolved* policy carries
`maxMonthlyTransferCents=100000`, `agentBudgetCents=200000`, `childBudgetCents=50000` while the
file itself says nothing about them. Not a live exposure — `lockdown=true`, `allowedTools=[]`,
`activationApproved=false`, `maxChildren=0`, no wallet, both activation flags unset, all re-read
through the application's own loader — but it is a defence-in-depth hole and a standing trap for
every future treasury field. **Recorded, remedy written, deliberately not auto-fixed**: tightening
it means editing the operator's live config. Remedy: `reports/PHASE_16_LIVE_MODEL_TESTING.md` §5.

### 2.4 A backup that hashes differently from its source is *correct*

The SQLite online backup API rewrites the database header, so `state.db`'s archive hash
(`2cc9d26c…`) differs from the live file (`2a8aeb34…`) while the content is row-for-row identical.
**Any acceptance test comparing live-vs-backup hashes fails every good backup.** Hashes belong to
archive-vs-manifest tamper detection; `integrity_check` plus content equality belong to restore
verification. Corollary, measured: with a writer holding uncheckpointed WAL frames, `cp` of the
main file restored **5** rows while the backup API restored **6** — which is why `cp` is not a
backup mechanism, and why `scripts/backup-restore.sh`'s `cp`-based restore is recorded as R-20.

---

## 3. Isolation: what the sandbox is and what it is not

Tier language from `reports/PHASE_16_ISOLATION_EVALUATION.md`, kept honest because the marketing
version of "sandbox" is how autonomous agents end up owning hosts.

- **What exists:** application-level guards inside one trust domain — path confinement with
  realpath/junction checks, a 36-pattern shell deny list, environment scrubbing, capability-gated
  tool dispatch, fail-closed policy enforcement, `HOME` guard. It stops accidents, sloppy models
  and casual misuse.
- **What it does not do:** no job object, no syscall restriction, no capability drop, no separate
  credentials. Anything with code execution in the Node process inherits this user's full rights.
  **Application-level sandboxing is not OS-level isolation, and is not described as such anywhere
  in this install.**
- **Aggravating fact measured this phase:** the account `<windows-user>` **is** a member of local
  Administrators (UAC-filtered Medium-IL token, `BUILTIN\Administrators` = "Group used for deny
  only", no `SeDebug`/`SeTcb`/`SeBackup`/`SeRestore`/`SeSecurity`). The honest label is therefore
  *"no isolation from an administrator"*. Phase 15's framing "the operator has no administrator
  rights" was wrong in the other direction and is corrected in R-1.
- **Best available fix, not executed:** drop the `Authenticated Users:(M)` grant on the project tree
  (**R-15**, owner-rights, no elevation) — an ACL change is a state change and §2 forbids unapproved
  host modification. Then a dedicated standard account. Tier (iii) options (Windows Sandbox, WDAG,
  Hyper-V role) are **impossible on Windows 11 Home Single Language**, and their feature state cannot
  even be read without elevation.

---

## 4. Why this is status B, not A

| §10 condition for A | State | Blocking evidence |
|---|---|---|
| Administrator-only Windows verification complete | **Not met** | BitLocker, TPM ownership, UEFI Secure Boot variables, Defender **exclusions** are `UNVERIFIED — BLOCKED`. No hidden admin-only exclusion can be ruled out from a filtered token, which is the item whose "no finding" means least. R-1 |
| Real-data recovery proved | **Not met** | The live DB has **10 rows**, all migration bookkeeping, 1 non-empty table of 37. `REAL_DATA_RESTORE = NOT YET PROVABLE`. Test rows were not fabricated to earn the label. R-2 |
| Live-model testing performed | **Not met** | No credential exists; none was entered; `LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`. The *preparation* is now proven reachable (isolated tier passes 18/18 and `verdict=READY` is reachable with a fake key + approval token), the call itself never happened. R-9 |
| Coverage measured | **Not met** | `vitest run --coverage` → `MISSING DEPENDENCY '@vitest/coverage-v8'`. The thresholds configured in `vitest.config.ts` (60/50/55/60) have **never run**. |
| POSIX path verified | **Not met** | No WSL distribution, no Docker; `isWindows` is a module-level constant so mocking it proves nothing. R-7 |
| Code-level controls implemented and executed | **Met** | 143 Phase 16 tests + 2057-test suite green, exit 0; typecheck exit 0; built artifact re-smoked |

Classification required by §31: **Phase 16 = PARTIALLY VERIFIED.** The gates that would let
this thing spend, publish, replicate or self-modify are all still shut.

---

## 5. Invariants — unchanged, and re-measured at every checkpoint

| Invariant | Required | Verified |
|---|---|---|
| `security.activationApproved` | `false` | yes — `--run` refuses citing it |
| `security.lockdown` | `true` | yes |
| `security.allowedTools` | `[]` | yes |
| `maxChildren` | `0` | yes |
| `security.selfHealingEnabled` | `false` | yes |
| `CONWAY_ACTIVATION` / `CONWAY_ALLOW_WALLET_CREATION` | unset | yes |
| Wallet material | none | no `wallet.json`, no keystore anywhere in the runtime home |
| Live `state.db` | untouched | `2a8aeb34…efbba`, 512 000 B, identical before and after 16C, 16D and 16E |
| `HOME` | runtime home only | guard verified in every command's own output; `C:\root` does not exist on this host |

Prohibited-without-approval actions (§29, all 14) — **none performed.** No credential entered, no
wallet created or funded, no transaction, no AI credits purchased, no financial tool, no
replication, no network exposure, no Windows service, no Windows security setting changed, no
autonomous execution enabled.

---

## 6. Open risks carried out of Phase 16

Read the full R-1…R-23 register in
[`../reports/PHASE_16_GAP_ANALYSIS.md`](../reports/PHASE_16_GAP_ANALYSIS.md). The ones that should
decide whether you activate:

| ID | One line |
|---|---|
| R-15 | Project root grants `Authenticated Users:(M)` — any local account can edit the source that implements every control. **Highest-value unblocked fix.** |
| R-11 / R-12 / R-13 | Three spending controls that are configured but unenforced: the daily inference cap can never select a tool, `resolveSandboxRoot()` falls back to `process.cwd()`, and x402 spend is recorded as `0`, making the envelope a sum of zeros |
| R-21 | Live config inherits non-zero money caps from code defaults |
| R-20 | `scripts/backup-restore.sh` restores by overwriting whatever path an operator types, and copies WAL side files blindly |
| R-19 | The shell deny list omits `del /f /s /q`, `certutil`, `bitsadmin`, `mshta`, `rundll32`, `wmic`, `curl` POST — currently unreachable because `shell_execution` is denied, but it must be revisited before any grant |
| R-4 | Application-level sandbox ≠ OS isolation, on an Administrators-member account |
| R-17 | `HOME` isolation does not extend to toolchains Conway shells out to — npm wrote to `%LocalAppData%` while `runtime/home/npm-cache` stayed absent. Directly relevant to Phase 17, which needs `npm install` |
| R-14 | Live DB is schema **V11**, code is **V13**; five security tables (`security_events`, `treasury_authorizations`, `security_incidents`, `security_seals`) do not exist in the live tree. Migrating means opening it through `createDatabase()`, which rewrites the active file — operator decision, fresh archive first |

## 7. Operator decisions this phase is waiting on

1. Elevated **read-only** Windows run — the exact command block is prepared in
   `reports/PHASE_16_WINDOWS_VERIFICATION.md` §3. Nothing changes on the host.
2. `icacls /inheritance:r` + explicit owner/SYSTEM grants on the project tree (closes R-15).
3. Treasury remedy for R-21 (three lines), or accept the gate's loud refusal.
4. `pnpm add -D @vitest/coverage-v8` if measured coverage is wanted (unblocks B1).
5. A live-model credential **plus** `CONWAY_LIVE_MODEL_APPROVED=APPROVED` (unblocks 16D execution).
6. The V11→V13 migration decision (R-14), after a fresh archive.
7. Activation itself — two independent signals, config and env, deliberately not touched here.

## 8. Reproduce anything in this document

```bash
cd "<repo-root>"
export HOME="<repo-root>\\runtime\\home"
NODE="./runtime/node-v22.23.4-win-x64/node.exe"

$NODE node_modules/vitest/vitest.mjs run                        # 2057 passed / 0 failed
$NODE node_modules/typescript/bin/tsc --noEmit                  # exit 0
$NODE reports/PHASE_16_16E_SUMMARIZE.cjs PHASE_16_16E_FULL_RUN_FINAL.json
$NODE reports/PHASE_16_16E_TREE_MANIFEST.cjs dist packages/cli/dist
$NODE dist/index.js --run                                       # exit 2, HOME guard first line

# 16D gate — runtime tier (refuses) and isolated tier (18/18, pending credential)
$NODE node_modules/tsx/dist/cli.mjs scripts/phase16-live-model-preflight.ts
$NODE node_modules/tsx/dist/cli.mjs scripts/phase16-live-model-preflight.ts \
  --test-home "<repo-root>\\runtime\\model-test-home"
```

Next phase: the local AI Command Center dashboard (`docs/` Phase 17 documents) — read-only over
the same live state, bound to `127.0.0.1`, and it must never activate the agent.
