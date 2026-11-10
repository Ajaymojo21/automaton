# Phase 16E — Full security regression results

**Section 9 deliverable.** Every number below was produced by a command that actually ran in
this session. Where a check could not be executed, it is recorded in the category it belongs
to — Blocked or Not applicable — with the exact reason. **Nothing in this phase is claimed to
be vulnerability-free.**

| | |
|---|---|
| Install | `<repo-root>` (v0.2.1, commit `d8f8168`) — the existing install, not reinstalled |
| Runtime | `runtime\node-v22.23.4-win-x64\node.exe` (ABI 127), project-local |
| `HOME` for every command | `<repo-root>\runtime\home` (§3) |
| Test framework | vitest (project-local, `vitest.config.ts`, `include: src/__tests__/**/*.test.ts`, `testTimeout: 30 000`) |
| Run window | 2026-11-01 08:53:23Z → 08:55:05Z (span measured from the vitest JSON: **104.1 s**) |
| Raw evidence | `reports/PHASE_16_16E_FULL_RUN_FINAL.json` (584 078 B), `reports/PHASE_16_16E_FULL_RUN_FINAL.log`, `reports/PHASE_16_16E_SUMMARY.txt` |

---

## 1. Headline verdicts

| Category | Count | Evidence |
|---|---|---|
| **Passed** | **2057 tests / 529 suites / 82 files** | vitest JSON `numPassedTests: 2057`, exit code **0** |
| **Failed** | **0** | `numFailedTests: 0`; no file reported a failure |
| **Skipped** | **0** | `numPendingTests: 0`, and a source scan found no `.skip`, `.only`, `.todo`, `xit(` or `xdescribe(` anywhere under `src/__tests__/` — so "nothing was skipped" is verified, not inferred |
| **Blocked** | **5 checks** (coverage, POSIX, elevated Windows, live-model execution, real-data restore) | §4 below |
| **Not applicable** | **4 checks** (container/Docker, WSL, LAN exposure, second OS) | §5 below |

Totals line, verbatim from `reports/PHASE_16_16E_SUMMARY.txt:62`:

```
totals: files 82 suites 529 tests 2057 passed 2057 failed 0 pending 0
```

### The first run of this regression was not the one I report

The initial full run at 14:09 local reported **81 files / 526 suites / 2049 passed / 0 failed**
in an 83.4 s span (`reports/PHASE_16_16E_FULL_RUN.json`, kept, not overwritten). It was taken
**before** the 16D CLI test file `phase16-live-model-tier.test.ts` was saved, so it could not
contain it — `grep -c "live-model-tier" reports/PHASE_16_16E_FULL_RUN.json` returned **0**. That
figure is therefore not the Phase 16 closing number; the suite was re-run in full and the
delta is exactly the 10th Phase 16 file: 82−81 files, 529−526 suites, 2057−2049 tests.

---

## 2. Phase 16 test surface (what this phase actually added)

143 tests across 10 files, all green. Verbatim from `reports/PHASE_16_16E_SUMMARY.txt:1-11`:

```
  19   ok        -  home-guard.test.ts
  10   ok        -  phase16-audit-visibility.test.ts
   8   ok        -  phase16-backup-roundtrip.test.ts
   6   ok        -  phase16-emergency-stop-isolation.test.ts
  23   ok        -  phase16-live-model-preflight.test.ts
   8   ok        -  phase16-live-model-tier.test.ts
  15   ok        -  phase16-package-name-hardening.test.ts
  13   ok        -  phase16-policy-enforcement.test.ts
  28   ok        -  phase16-self-healing-safety.test.ts
  13   ok        -  phase16-win-shell-quoting.test.ts
phase16+home-guard tests passed: 143
```

Gap by area (`src/__tests__/security` is 9 files / 124 tests; `home-guard.test.ts` lives in
`src/__tests__/runtime`, 19 tests; 124 + 19 = 143 ✓):

```
    280 passed   0 failed   0 other   11 files  src/__tests__/orchestration
    133 passed   0 failed   0 other    6 files  src/__tests__/memory
    124 passed   0 failed   0 other    9 files  src/__tests__/security
    102 passed   0 failed   0 other    1 files  src/__tests__/command-injection.test.ts
     72 passed   0 failed   0 other    5 files  src/__tests__/integration
     71 passed   0 failed   0 other    1 files  src/__tests__/tools-security.test.ts
     54 passed   0 failed   0 other    1 files  src/__tests__/phase15-penetration.test.ts
     46 passed   0 failed   0 other    1 files  src/__tests__/phase15-sandbox.test.ts
     31 passed   0 failed   0 other    8 files  src/__tests__/agent
     19 passed   0 failed   0 other    1 files  src/__tests__/runtime
```

The full 48-row area table is in `reports/PHASE_16_16E_SUMMARY.txt:13-60`.

### Static checks

| Check | Command | Result |
|---|---|---|
| Production typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit **0** |
| Phase 16 surface + its tests | `tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --resolveJsonModule src/__tests__/security/phase16-*.test.ts src/__tests__/runtime/home-guard.test.ts src/security/live-model-preflight.ts scripts/phase16-live-model-preflight.ts` | exit **0** |

The second command exists because **vitest strips types without checking them** — a green
suite does not prove a test file compiles. Three Phase 16 defects (e.g. `TS2304: Cannot find
name 'count'` in the 16C file) were caught only by this separate typecheck.

---

## 3. Finding of this section: the runnable artifact did not contain Phase 16

Discovered while asking a question the test suite cannot answer — *what does the launcher
actually execute?* `START_CONWAY.bat:56` starts
`%NODE% %ROOT%dist\index.js --run`. `dist/` was measured, not assumed:

| Measurement | Before | After |
|---|---|---|
| Newest `.js` under `dist/` | **2026-10-31 18:39** — predates every Phase 16 change (all dated 2026-11-01) | 2026-11-01 14:29 |
| Files under `dist/` | 500 | 540 |
| Files matching `POLICY_ENGINE_MISSING` (the 16A.1 fail-closed reason code) | **0** | 2 (`dist/security/policy-enforcement.js`, its `.d.ts`) |
| `dist/security/live-model-preflight.js` | **absent** | present, 8 829 B |
| Tree digest (`dist` + `packages/cli/dist`) | `5a5109f83cebee291b745e3d6ba8f7f5337626f1e77410f69bef3c15af24cacc` | `deb086df6f8051c8f2a34fcde1cdd68a4a2f6b065417bcd8553ff525211d7ec3` |

So until 14:29 today, **every control verified by the 143 Phase 16 tests was absent from the
binary the operator launches.** The tests import `src/`, and the launcher runs `dist/`. This is
recorded as **R-23** and is now closed:

1. Baseline captured: `reports/PHASE_16_16E_DIST_PRE.manifest` (520 files, 2 625 512 B, digest `5a5109f8…`).
2. Rollback copy taken to `backups/phase16/pre-16E-dist/{dist,cli-dist}` and **manifest-verified identical** — `reports/PHASE_16_16E_DIST_BACKUP.manifest` reports the same 520 files, 2 625 512 B, digest `5a5109f8…`. That copy **is** the un-hardened build, so it now carries `DO-NOT-EXECUTE.txt` stating what it is, what it lacks, and the rollback procedure; nothing references it, and it is retained because §2 forbids deleting existing backups.
3. Rebuilt with the project-local compiler only — root `tsc` exit **0**, `tsc -p packages/cli` exit **0**. Deliberately **not** `npm run build`: that script is `tsc && pnpm -r build`, and pnpm resolves its cache from `%LocalAppData%` (**R-17**), which would write outside the isolated `HOME`. Running the two `tsc` invocations directly reproduces the build without that side effect.
4. Orphan scan (`reports/PHASE_16_16E_DIST_ORPHANS.cjs`): **135** dist `.js` files, **0** without a matching `src/*.ts` — `tsc` does not delete stale output, so this was checked rather than assumed.
5. Behaviour re-verified against the *rebuilt artifact* — see §3.1.

### 3.1 Post-rebuild runtime verification (the artifact itself, not the source)

`node dist/index.js --run` with `CONWAY_ACTIVATION` and `CONWAY_ALLOW_WALLET_CREATION` both
confirmed unset in the environment, `HOME` set to the runtime home. Output verbatim:

```
{"timestamp":"2026-11-01T09:00:23.450Z","level":"info","module":"main","message":"HOME verified against the canonical Conway runtime home: <repo-root>\\runtime\\home"}
14:30:23 INFO  main         [2026-11-01T09:00:23.452Z] Conway Automaton v0.2.1 starting...
14:30:23 ERROR main         Blocked "--run": runtime activation is not approved.
14:30:23 ERROR main         Reason: security.activationApproved is not true in automaton.json
14:30:23 ERROR main         To approve: set security.activationApproved=true in automaton.json and run with CONWAY_ACTIVATION=APPROVED.
run_exit=2
```

| Assertion | Result |
|---|---|
| §3 `HOME` guard runs **in the shipped artifact**, before anything else | PASS — first line of output |
| Activation still refused, exit code 2 | PASS |
| `runtime/home/.automaton/state.db` SHA-256 unchanged across the run | PASS — `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba` before **and** after |
| No wallet material created | PASS — `runtime/home/.automaton/` still holds only `automaton.json`, `heartbeat.yml`, `skills/`, `state.db`, `state.db-shm`, `state.db-wal` |
| No second state directory / no `C:\root` fallback | PASS — `ls /c/root` → *does not exist* (the `C:\root` string seen in `loop.test.ts` output is an in-memory fixture sandbox root; nothing was written there) |

---

## 4. Blocked — checks that could not be executed, and why

| # | Blocked check | Exact blocker | What would unblock it |
|---|---|---|---|
| B1 | **Test coverage** against the thresholds in `vitest.config.ts` (statements 60 / branches 50 / functions 55 / lines 60) | `vitest run --coverage` → `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`, exit 1. `@vitest/coverage-v8` is not in `devDependencies` (`@types/node`, `tsx`, `typescript`, `vitest`). Installing it adds a dependency to the user's existing install, which needs approval. | `pnpm add -D @vitest/coverage-v8` (operator decision). **Note the consequence: the coverage gate configured in this repo has never run and is inert.** |
| B2 | **POSIX / Linux verification** of the platform-conditional fixes (**R-7**) | `isWindows` is a module-level constant and `normalizeForCompare` uses `path.resolve`, so mocking the platform on a Windows host proves nothing; `wsl -l -q` reports no installed distributions and no Docker/WSL runner exists. | A Linux or WSL runner; then `pnpm test` there. |
| B3 | **Elevated Windows host verification** — BitLocker, TPM, Secure Boot, Defender/firewall state (**R-1**, 16B) | The account is in local Administrators but the token is UAC-filtered Medium-IL (`BUILTIN\Administrators` = "Group used for deny only"); `Get-BitLockerVolume` → Access denied. Per §6 no setting was changed and no protector was read. | An elevated read-only run of the exact command block prepared in `reports/PHASE_16_WINDOWS_VERIFICATION.md`. |
| B4 | **Any real live-model call** (**R-9**, 16D) | No credential exists in the environment and no human approval token is set. `LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`. The *preparation* is verified (18/18 safety checks pass in the isolated test home); the call itself is not made. | Operator supplies a credential **and** sets `CONWAY_LIVE_MODEL_APPROVED=APPROVED`. |
| B5 | **Real-data restore** (**R-2**, 16C) | Measured, not assumed: the live DB holds **10 rows**, all migration bookkeeping, in 1 of 37 tables. `REAL_DATA_RESTORE = NOT YET PROVABLE`. Test rows were **not** fabricated to make the claim succeed. | Run the agent once so genuine user data exists, then re-run the 16C drill. |

## 5. Not applicable to this installation

| Item | Why not applicable |
|---|---|
| Container / Docker hardening tests | No Docker on this host; the install is a bare Windows process. |
| WSL / POSIX deployment path | No WSL distribution installed (B2). |
| LAN / public exposure tests | The install binds nothing; §11 keeps the dashboard on `127.0.0.1` only, so there is no external surface to probe. |
| Multi-OS regression (macOS) | Not a target platform for this install. |

---

## 6. Slow tests and the flake history — stated honestly

```
slowest files:
   100.8 s  loop.test.ts
    20.0 s  social.test.ts
     6.9 s  phase16-live-model-tier.test.ts
     3.8 s  context-manager.test.ts
```

`loop.test.ts` is **the reason this suite has ever been red at all**, and it is not fixed here:

- It costs ~60 s on its own and **100.8 s in this run** (80.1 s in the 14:09 run) — pure host-load
  variance, ~25 % swing between two runs of identical code.
- In the earlier 12:15 full run, `loop.test.ts > Agent Loop > discover_agents turns are retained
  in context` failed with `Test timed out in 180000ms`. That was root-caused by swapping
  `src/agent/loop.ts` between the 16A version and `backups/phase16/loop.ts.pre-16A.bak` and
  running the single test: **62.01 s** baseline vs **63.37 s** with 16A changes — a 2 % difference,
  i.e. noise, not a regression. Full detail in `reports/PHASE_16_PROGRESS.md:879-899`.
- In **this** run all 24 tests in `loop.test.ts` passed; the flake did not reproduce.
- `src/agent/loop.ts` re-verified this session at SHA-256 `e97c188715655413…`, matching the hash
  recorded after that experiment — the file is still the version that was tested.

`testTimeout` was **not** raised and the timing assertions were **not** loosened. Raising a
timeout to manufacture green would hide the very saturation signal that made this test worth
investigating; that is recorded as known suite-quality risk rather than silently "fixed".

## 7. Secret scan of everything this phase wrote

Scan of `src/security`, `src/runtime`, `src/__tests__/security`, `scripts/phase16*`,
`reports/PHASE_16_*.md`, `runtime/model-test-home`, `src/config.ts`, `src/types.ts` for
`sk-…`, long hex keys, PEM headers, `password = "…"` and 20+-char API-key assignments:

| Location | Match | Classification |
|---|---|---|
| `phase16-backup-roundtrip.test.ts:38-39` | `sk-TESTONLY-0123456789abcdef…`, `0x0123…(64 hex)` | Synthetic fixtures planted *to prove redaction* — asserted absent from output |
| `phase16-live-model-preflight.test.ts:161,252` | `sk-SECRET-DO-NOT-ECHO`, `sk-proj-NEVER-PRINT-THIS` | Non-echo assertions |
| `phase16-live-model-tier.test.ts:36` | `sk-FAKE-never-used-0000000000000000` | Passed only into a child env to prove the gate reads presence, not value |
| `phase16-audit-visibility.test.ts:26`, `phase16-policy-enforcement.test.ts:32`, `phase16-win-shell-quoting.test.ts:89` | `0x…dEaD`, `0x…0001` | Dummy addresses (burn address / test recipient) |
| `phase16-live-model-preflight.test.ts:40`, `runtime/model-test-home/.automaton/automaton.json:4` | `0x000…0000` | Zero address placeholder |

**No real credential, key, passphrase or recovery secret is present in any Phase 16 artifact.**
`runtime/home/.automaton/wallet.json` does not exist and was not created.

## 8. Invariants re-verified at the end of this run

| Invariant | Required | Measured |
|---|---|---|
| `security.activationApproved` | `false` | `false` — `--run` refused with exactly that reason |
| `security.lockdown` | `true` | `true` |
| `security.allowedTools` | `[]` | `[]` |
| `maxChildren` | `0` | `0` |
| `security.selfHealingEnabled` | `false` | `false` |
| `CONWAY_ACTIVATION` / `CONWAY_ALLOW_WALLET_CREATION` | unset | both `unset` in the scanning shell |
| Live `state.db` | unchanged | `2a8aeb34…efbba`, 512 000 B, before and after every run |
| `HOME` used by every command | `<repo-root>\runtime\home` | yes; guard line appears in the artifact's own output |

**Caveat kept on the record:** `state.db-shm` (32 768 B) and a 0-byte `state.db-wal` exist in
the live state directory as a side effect of the **read-only** database opens used by the 16C
evidence scripts. SQLite recreates `-shm` on opening a WAL database even for a reader. The
main file is byte-identical, so no data changed — but the directory is not byte-pristine and
that is disclosed rather than glossed.

## 9. What this regression does **not** prove

- Not "zero vulnerabilities". The residual register **R-11 … R-23** in
  `reports/PHASE_16_GAP_ANALYSIS.md` stays open, including three spending controls that are
  configured but unenforced (R-11, R-12, R-13), the source tree's `Authenticated Users:(M)`
  grant that can defeat every in-process control (R-15), latent non-zero money caps inherited
  from code defaults (R-21) and the overwrite-on-restore script (R-20).
- Not OS-level isolation. Application-level sandboxing is not a job object, not a capability
  drop, not a syscall filter (**R-4**); see `reports/PHASE_16_ISOLATION_EVALUATION.md`.
- Not a live-model result. No model call has ever been made (**R-9**).
- Not real-data recovery (B5), not coverage (B1), not POSIX (B2), not the elevated host state (B3).
- Not proof that the *tests* are adequate beyond their own assertions — 2057 green tests is a
  statement about what those tests check, and coverage of the rest is unmeasurable while B1 stands.

## 10. Reproduce

```bash
cd "<repo-root>"
export HOME="<repo-root>\\runtime\\home"
NODE="./runtime/node-v22.23.4-win-x64/node.exe"

# full suite, as run
$NODE node_modules/vitest/vitest.mjs run --reporter=json \
  --outputFile=reports/PHASE_16_16E_FULL_RUN_FINAL.json > reports/PHASE_16_16E_FULL_RUN_FINAL.log 2>&1
$NODE reports/PHASE_16_16E_SUMMARIZE.cjs PHASE_16_16E_FULL_RUN_FINAL.json

# static checks
$NODE node_modules/typescript/bin/tsc --noEmit

# artifact state
$NODE reports/PHASE_16_16E_TREE_MANIFEST.cjs dist packages/cli/dist
$NODE reports/PHASE_16_16E_DIST_ORPHANS.cjs

# rebuilt-artifact safety smoke (expects exit 2, HOME guard line, unchanged state.db)
$NODE dist/index.js --run
```

Rebuild used to close R-23 (project-local compiler only; no pnpm, per R-17):

```bash
$NODE node_modules/typescript/bin/tsc
$NODE node_modules/typescript/bin/tsc -p packages/cli
```
