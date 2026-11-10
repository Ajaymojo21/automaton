# Phase 19 — Test Results

Rule applied throughout: a test is reported as passed **only if it was executed in this phase and its
output was captured**. Historical figures are labelled as inherited and are not claimed as fresh.

---

## 1. Executed during Phase 19 so far

| # | Check | Command actually run | Result |
|---|---|---|---|
| 1 | Canonical HOME guard | node probe asserting `process.env.HOME === "<repo-root>\runtime\home"` before any file access | **PASS** — `HOME VERIFIED` |
| 2 | Live config hash | SHA-256 of `runtime/home/.automaton/automaton.json` | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` — **identical to the Phase 18 baseline** |
| 3 | Live DB stats | `fs.statSync` on `state.db` | `512 000 B`, mtime `2026-10-31T10:25:59.744Z` — unchanged |
| 4 | Read-only schema probe | `new Database(db, {readonly:true, fileMustExist:true})`, `MAX(version)`, table list, `integrity_check` | **11**, 38 tables, `integrity_check = ok`, four V12/V13 tables absent |
| 5 | Read-only open does not mutate | size + mtime compared before/after the probe | **unchanged: true** |
| 6 | Dashboard loopback probe | `exec 3<>/dev/tcp/127.0.0.1/8787` | **OPEN** in every trial |
| 7 | Dashboard HTTP | `Invoke-WebRequest http://127.0.0.1:8787/` | **200**, 792 bytes (token gate page) |
| 8 | LAN exposure probe | `exec 3<>/dev/tcp/<host-lan-ip>/8787` | **Connection refused** |
| 9 | Socket-table reliability | 26 `netstat` captures + `Get-NetTCPConnection -State Listen` against the live listener | LISTENING row present in **2** captures, absent in **24**; port accepted connections in all trials → recorded as F-19-03 |
| 10 | Conway service / scheduled task | `Get-Service` + `Get-ScheduledTask` name filters | **none** |
| 11 | Agent runtime process | `Get-CimInstance Win32_Process` name + command line | **no Conway agent process**; the look-alike `node dist/index.js` (PID 12652) attributed to FreeLLMAPI via its parent `freellmapi-service.ps1` |
| 12 | Security invariants | field reads from live `automaton.json` | `lockdown true`, `activationApproved false`, `allowedTools []`, all five `allow*=false`, `maxChildren 0`, all ten `treasuryPolicy` limits `0`, `x402AllowedDomains []` — **see 1a: the "ten limits" wording in this row is imprecise and was corrected later in the phase** |
| 13 | Credential emptiness | **length only**, values never read into output | `conwayApiKey`, `openaiApiKey`, `anthropicApiKey`, `sandboxId` = zero-length; no `wallet.json`; `walletAddress` zero-length |
| 14 | Activation env vars | `process.env` presence check | `CONWAY_ACTIVATION` unset; `CONWAY_ALLOW_WALLET_CREATION` unset |
| 15 | **H — dashboard regression suite** | `node dashboard/node_modules/vitest/vitest.mjs run --reporter=basic` with HOME pinned, cwd `dashboard/` | **PASS — Test Files 10 passed (10), Tests 97 passed (97), 0 failed**, duration 3.37 s, start 18:28:30 local. Per-file: redact 5, danger-imports 5, response-headers 3, security 15, home-guard 11, readonly-db 5, backup-verify 9, restore-guard 14, panel-verdicts 15, http-contract 14 |
| 16 | Migration source inventory | `grep -n "CREATE TRIGGER"` over `src/state/schema.ts` (whole file) and over the V12/V13 ranges | **6** append-only triggers, 4 tables, 12 indexes → the Phase 18 "seven triggers" figure is wrong (F-19-01) |
| 17 | A1 non-mutation proof | re-hash config + re-stat DB after the three doc edits | `MATCHES BASELINE: true` |
| 18 | A1 residual-claim search | `grep` over the three edited files for the retired strings | only the two **quoted-as-retired** occurrences remain (README lines 198/233 quote the old wording inside the correction note); no live incorrect claim |
| 19 | Gitignore enforcement | `git check-ignore -v` on `state.db` and `automaton.json` | both resolve to `.gitignore:15 runtime/home/` → **excluded** |
| 20 | Secret-scanner availability | `command -v gitleaks / trufflehog / detect-secrets` | **none installed** → A8 must use a project-local staged-blob scanner |

Rows 1–20 are the pre-approval measurements. Rows 21–34 below are the post-approval execution of
**A2 and A3 only**; nothing after row 20 existed before the operator answered.

| # | Check | Command actually run | Result |
|---|---|---|---|
| 21 | A2 RED (test-first) | `vitest run src/__tests__/migration-runner.test.ts` | **1 file failed — Tests 37 failed \| 1 passed (38)**, `runtime/tmp/a2-red.log` |
| 22 | A2 GREEN | same target after the runner change | **39 passed** (`a2-green.log`), then **40 passed** once the fourth index name was pinned (`a2-green2.log`) |
| 23 | A2 full root regression | `vitest run` | **83 files / 2 096 tests / 0 failed**, exit 0 (`a2-fullsuite.log`, 13:52Z) |
| 24 | A3 focused (read-only handle + snapshot + gate + CLI wiring) | `vitest run` on `readonly-status-migration.test.ts` + `migration-runner.test.ts` | **2 files / 69 tests passed**, exit 0 (`p19-a3-final-focused.log`, started 15:37:37Z) |
| 25 | Re-run after the stale-title correction | same target | **2 files / 69 tests passed** (`p19-a3-focused2.log`, started 16:00:41Z) |
| 26 | A3 full root regression | `vitest run` | **84 files / 2 126 tests / 0 failed**, exit 0 (`a3-fullsuite.log` and `p19-a3-final-fullsuite.log`) |
| 27 | **F-19-08** containment case-defect RED | `vitest run src/__tests__/migration-path-containment.test.ts` | **1 file failed — Tests 8 failed \| 1 passed (9)**, `p19-a3-case-red.log` started 21:39:11 local; decisive message: the re-cased live path refused with *"is not inside the verified state directory …"* instead of naming canonical |
| 28 | **F-19-08** GREEN + gates | `vitest run` (3 files), `tsc --noEmit`, `tsc` | **3 files / 79 passed** (`p19-a3-case-green.log`, 21:40:32 local); typecheck and build both **exit 0**, empty output; CLI at 16:11:21Z re-cased live path now demands `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED`, exit 1 |
| 29 | **F-19-09** junction-redirection RED | `vitest run src/__tests__/migration-path-redirection.test.ts` | **Tests 6 failed \| 1 passed (7)** (`p19-a3-jx-red2.log`, 21:49:43 local). The pre-fix gate returned **`ok: true`** and migrated a disposable V11 database located *outside* the verified state directory, reached through a junction |
| 30 | **F-19-09** GREEN | `vitest run` on the four migration files | **4 files / 86 tests passed**, exit 0 (`p19-a3-jx-green2.log`, 21:52:37 local). One intermediate run showed **1 failed \| 85 passed** and the cause was *this test's own expectation* (8.3 short name vs `realpath` long name), recorded in `PHASE_19_SECURITY_VERIFICATION.md` §2 |
| 31 | **F-19-09** CLI proof + control | `env HOME=<sandbox> CONWAY_HOME_MODE=isolated CONWAY_MIGRATION_APPROVAL=APPROVED node dist/index.js --migrate-schema --database …` | escaping path → **exit 1**, `resolves to …outside\victim.db, which is not inside the verified state directory` (16:24:07Z); victim stayed byte-identical to V11 (`2a8aeb34…`). Control inside the state directory → **exit 0**, `Schema migrated from 11 to 13; 4 tables, 12 indexes, 6 triggers, 50 columns created.` (16:24:45Z) |
| 32 | Final full root regression (all of A2+A3+F-19-08+F-19-09) | `vitest run` | **86 files / 2 143 tests / 0 failed**, exit 0, 88.90 s (`p19-jx-final-fullsuite.log`, started 21:55:34 local) |
| 33 | `--status` end-to-end | `node dist/index.js --status` with HOME pinned | **exit 0**, **13** fields printed, `state.db` byte-identical before/after (`p19-a3-e2e-status.log`). Earlier note of "12 fields" was wrong — see the correction below |
| 34 | Post-work invariant re-check | `runtime/tmp/p19-a3-final-invariants.mjs` on the current bundle | all §13 invariants hold; `state.db 2a8aeb34… 512 000 B mtime 2026-10-31T10:25:59.744Z`; schema 11; four V12/V13 tables absent; 0 migration reports against the live tree |
| 35 | Phase-close invariant re-check (after the last report edits) | `runtime/tmp/p19-close-invariants.cjs` with the pinned Node 22.23.4 and HOME pinned to the canonical runtime home; database opened `{readonly: true, fileMustExist: true}` | capture completed **16:49:10Z** (log mtime 22:19:10 local): `automaton.json 1c10ecc5…`, `state.db 2a8aeb34… 512000 2026-10-31T10:25:59.744Z`, `schema_version 11`, `tables 38`, `integrity_check ok`, `v12v13 present []`, `lockdown true / activationApproved false / allowedTools [] / maxChildren 0`, numeric treasury limits all `0`, `wallet exists false`, credential field **lengths** all `0`, all three gate/activation env vars unset, `migration reports 0`. Output in `p19-close-invariants.log`, quoted verbatim in `PHASE_19_PROGRESS.md` §5 |
| 36 | Close-out re-run of the four migration files, after the record-keeping edits | `vitest run` on the four files with HOME pinned and the pinned Node | **4 files / 86 tests passed / 0 failed**, exit 0, 12.38 s (`runtime/tmp/p19-close-focused.log`, capture completed **16:57:37Z** / 22:27:37 local). Run to confirm that nothing in the report-writing pass disturbed the tree that row 32 certified; no source file changed between the two runs (each hash re-compared against the `PHASE_19_PROGRESS.md` §5 register) |

**Additive corrections to rows above** (history is not rewritten): row 12's "all ten
`treasuryPolicy` limits" is really **9 numeric keys, all `0`**, plus `x402AllowedDomains = []`.
`maxChildren` is a **top-level** config key, not under `security`. The "`--status` prints twelve
fields" note in the A1 documentation pass is wrong — it prints **13**. The Phase 18 "eleven V12/V13
indexes" test *title* was wrong while its assertion list of twelve names was right.

*(Self-correction, recorded rather than hidden: inserting this row 36 overwrote the "## 2. Not
executed — and what each one is waiting on" heading and briefly parked row 36 inside the corrections
paragraph. The heading is restored below and the row moved into the table. No other content was lost,
and this file's own convention — never silently overwrite earlier evidence — is why the incident is
noted here instead of the text simply being tidied.)*

## 2. Not executed — and what each one is waiting on

| Mandate §12 slot | Status | Reason |
|---|---|---|
| **A — focused unit tests** for the changed modules | **RUN — 86 / 86 passed, 0 failed** (rows 24, 25, 28, 30) | A2 + A3, executed after approval |
| **B — migration runner tests** | **RUN — 40 passed / 0 failed** (`migration-runner.test.ts`) | RED 37-failed at row 21, GREEN at row 22 |
| **C — CLI approval-gate tests** | **RUN — 29 A3 tests + 10 containment + 7 redirection, and 5 executed CLI runs** (rows 28, 31, 33) | six of the A3 file's 29 are source-level wiring guards, not subprocess tests — stated so the mix is not mistaken for E2E |
| **D — emergency-stop tests** | **NOT RUN** | A5 unapproved. The 5 §7 cases stay specified in the approval record |
| **E — audit-chain tests** | **NOT RUN** | A6 unapproved |
| **F — tool-authorizer tests** | **NOT RUN** | A6 unapproved |
| **G — full root regression suite** | **RUN FOUR TIMES in this phase** — 83 / 2 096 (row 23), 84 / 2 126 (row 26), 85 / 2 136 (row 28 context), **86 / 2 143 final, 0 failed, exit 0** (row 32) | the Phase 18 `82 / 2 057` figure is now superseded by executed Phase 19 runs; accounting in §3 |
| **H — dashboard regression suite** | **RUN — 10 / 97 / 0 failed** (row 15 above) | fresh, this phase, before the code work; not re-run after it — recorded as a gap |
| **I — TypeScript typecheck** | **RUN — `tsc --noEmit` exit 0** four times (empty logs `a3-typecheck.log`, `p19-a3-final-typecheck.log`, `p19-a3-case-typecheck.log`, `p19-a3-jx-typecheck.log`); `tsc` build exit 0 four times | `src/__tests__` is **excluded** from tsconfig, so tests are transpiled by vitest but not typechecked — an inherited project property, not a Phase 19 change |
| **J — security-focused test suite** | **RUN — 25 files passed / 59 skipped, 178 tests passed / 1 948 skipped, exit 0** (`p19-a3-final-security.log`, 15:56:00Z) | executed as `vitest run --testNamePattern 'security\|injection\|policy'`. `npm run test:security` itself **fails** — the script passes `--grep`, which vitest 2.1.9 rejects (F-19-07). The script is in `package.json`, outside the A2/A3 approval, so it was **not** edited |

## 3. Test-count accounting

Every delta is explained; nothing was added silently and no failure was converted into a skip.

| Suite | Baseline (Phase 18, inherited) | Phase 19 measured | Delta | Explanation |
|---|---|---|---|---|
| Conway root | 82 files / 2 057 tests | **86 files / 2 143 tests / 0 failed** | **+4 files, +86 tests** | `migration-runner.test.ts` **+40**, `readonly-status-migration.test.ts` **+29**, `migration-path-containment.test.ts` **+10**, `migration-path-redirection.test.ts` **+7** = 86 |
| — intermediate runs | — | 83 / 2 096 → 84 / 2 126 → 85 / 2 136 → 86 / 2 143 | each +1 file | 2 057 + 39 = 2 096 (the A2 file had 39 tests when that suite ran; the 40th came later); 2 096 + 29 + 1 = 2 126; 2 126 + 10 = 2 136; 2 136 + 7 = 2 143. Verified from the per-file lines inside each captured log, not inferred |
| Dashboard | 10 files / 97 tests | **10 / 97 / 0 failed** | none | re-executed at 13:08Z; not re-executed after the A2/A3 source changes |
| Skipped/failed hidden | — | **none** | — | every failing run in this phase is recorded as a RED row with its log file |
| Coverage | — | **NOT MEASURED** | — | `@vitest/coverage-v8` is not installed (Phase 18 B4, still unapproved). "2 143 tests pass" is not a coverage figure and is not presented as one |

No failed test was hidden, converted to a skip, or deleted to reach a green count. Nothing in this
document asserts a pass that has no captured command behind it.
