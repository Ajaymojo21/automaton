# Phase 20 — Final FreeLLMAPI Regression Test Report

Project root: `<repo-root>` · Pinned runtime: `runtime/node-v22.23.4-win-x64/node.exe` (v22.23.4) · vitest 2.1.9

## 1. Objective

Establish, by fresh execution rather than by citation of old logs, whether the A13.1 provider
configuration and this phase's added tests leave the shipped suite green, and to quantify exactly what
the unapproved P-6 behaviour costs in failing tests (§12 A–K).

## 2. Scope

Every §12 item A through K. Itemised vitest runs `2026-11-04T05:06:53Z → 05:07:11Z`, TypeScript and full
suite `2026-11-04T04:44:45Z → 04:48Z`. No source file, configuration file or state file was changed to
obtain these results.

## 3. Approval reference

No approval is needed to run tests (§3 lists "mock-based tests … test reports" as work allowed without
new approval). Item A needed none either: the P-6 RED file lives in `runtime/tmp/` and is **not** part of
the shipped include pattern (`vitest.config.ts:7` = `src/__tests__/**/*.test.ts`), so running it changes
nothing and cannot turn the shipped suite red.

## 4. Files inspected

`vitest.config.ts`, `package.json` (scripts `test`, `typecheck`, `build`), the eleven test files invoked
below, `src/inference/provider-registry.ts`, `src/inference/inference-client.ts`, and the capture logs
`runtime/tmp/p20-{regression,full-regression,regression-items,tsc-noemit,tsc-build,focused-inference,fallback-tests}.log`.

## 5. Files modified

Only this report plus the runner script `runtime/tmp/p20-run-items.sh`
(`b56d17a830f5b53a1688bb5bcf17fa0028715ecc021c30230b439a6ee028eacb`) and its output
`runtime/tmp/p20-regression-items.log`. **No source, test, config or state file was modified by this
report's work.**

## 6. Files not modified

All of `src/**` except the §8 test file added earlier in this phase, `config/**`,
`runtime/home/.automaton/**`, `dashboard/**`, `vitest.config.ts`, `package.json`, and the entire
FreeLLMAPI tree. Verified by hash in `FINAL_FREELLMAPI_SECURITY_AUDIT.md` §7 and by
`find src -type f -newermt 2026-11-04` → one path (the new test file).

## 7. Before / after hashes

| Item | Before this phase | After all runs | Same |
|---|---|---|---|
| `src/inference/provider-registry.ts` | `b5542260fbce0a7f4cdc933d5ca6287f7554ed6e8422add5f01b064259f20718` | identical | yes |
| `src/inference/inference-client.ts` | `ca0616619fdc3cacea56643123ea968c47c6dd133644e71c01c9fac79c28863c` | identical | yes |
| `src/__tests__/inference/freellmapi-fallback.test.ts` | `4aa1eb079a5dbb914841b0ba30645c34980d397cdeef4a747df5f3aac7fb82d2` | identical | yes |
| `runtime/tmp/p20-p6-red.test.ts` | `72112967b3cf8b8a96a0473588bc1653bfa6d1a8ae8bc8d4abc1bae06114b0de` | identical | yes |
| `config/inference-providers.template.json` / deployed `inference-providers.json` | `a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` (both) | identical | yes |
| `runtime/home/.automaton/state.db` | `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba` | identical | yes |

The regression runs are therefore non-mutating: every hash above is identical after 1 300+ tests executed.

## 8. RED test evidence

Item **A** is the only RED in this phase, and it is RED by design because the behaviour it requires is
unapproved. `runtime/tmp/p20-regression-items.log`:

```
=== A: P-6 focused tests (RED by design, outside shipped include) ===
2026-11-04T05:06:53Z
 Test Files  1 failed (1)
      Tests  13 failed | 9 passed (22)
VITEST_EXIT=1
```

The 13 failures are obligations 5, 6, 7, 8, 9, 10, 11, 12, 12b, 13, 14, 14b and 18 — every hostile-URL,
redirect-constraint and fail-closed case. The 9 passes are 1, 2, 3, 4, 4b, 14c, 15, 16, 17 — every
accept-case and compatibility-case. Neither number is adjusted: nothing was skipped, nothing was marked
`todo`, nothing was deleted to obtain a green shipped suite, and the failures are published in full in
§11 of `FINAL_FREELLMAPI_SECURITY_AUDIT.md`.

## 9. GREEN test evidence

Fresh, itemised, each with its own exit code (`runtime/tmp/p20-regression-items.log`):

| §12 item | Files run | Files | Tests | Exit |
|---|---|---|---|---|
| B provider registry | `inference/provider-registry.test.ts` | 1 | **31 passed** | 0 |
| C inference client | `inference/inference-client.test.ts` | 1 | **23 passed** | 0 |
| D inference routing | `inference-router.test.ts` | 1 | **64 passed** | 0 |
| E inference failover | `integration/inference-failover.test.ts` | 1 | **17 passed** | 0 |
| F authentication handling | `inference/freellmapi-provider.test.ts`, `http-client.test.ts`, `security/phase16-live-model-preflight.test.ts`, `siws.test.ts` | 4 | **70 passed** | 0 |
| G configuration validation | `security-lockdown.test.ts`, `runtime/home-guard.test.ts`, `security/phase16-live-model-tier.test.ts`, `inference/freellmapi-fallback.test.ts` | 4 | **60 passed** | 0 |
| H no-network provider resolution | `inference/freellmapi-fallback.test.ts`, `inference/provider-registry.test.ts` | 2 | **48 passed** | 0 |

Mapping note, stated so the reader can audit it: the suite has no file literally named
"authentication" or "configuration validation". Items F and G were mapped onto the files that actually
exercise those behaviours — `resolveApiKey`/placeholder and 401/403 handling plus the live-model
preflight gate for F; `normalizeSecurityConfig`, the HOME guard, the isolated tier profile and provider
config parsing for G. The mapping is disclosed rather than implied by the file names.

An earlier aggregate capture of the same material is `runtime/tmp/p20-focused-inference.log`
(7 files, **195 passed**, exit 0, start `10:18:35` local).

## 10. Item I and J — TypeScript

| Item | Command | Result |
|---|---|---|
| I no-emit | `runtime/…/node.exe node_modules/typescript/bin/tsc --noEmit` | `TSC_NOEMIT_EXIT=0`, no diagnostics (`p20-tsc-noemit.log` is 0 bytes), UTC `2026-11-04T04:44:45Z` |
| J build | `… tsc` | `TSC_BUILD_EXIT=0`, no diagnostics (`p20-tsc-build.log` is 0 bytes), UTC `2026-11-04T04:45:45Z` |

**Labelling correction (recorded, not silently fixed).** The capture script wrote those two blocks under
the headers `=== J: tsc --noEmit ===` and `=== K: tsc build ===`, i.e. off by one letter against §12's
I/J/K. The operations performed are the correct ones and each carries its own exit code; only the
letters in that one log were wrong. §12's I = no-emit, J = build, K = full suite as used in this report.

## 11. Item K — full root regression, fresh counts

Two independent full-suite executions were captured, both to completion, both exit 0:

| Log | Start (local) | Files | Tests | Failed | Duration | Exit |
|---|---|---|---|---|---|---|
| `p20-regression.log` | 10:15:54 | **88 passed (88)** | **2 175 passed (2 175)** | 0 | 115.76 s | `VITEST_EXIT=0` |
| `p20-full-regression.log` | 10:16:19 | **88 passed (88)** | **2 175 passed (2 175)** | 0 | 89.60 s | exit 0 |

The two overlapped in wall-clock time (they were launched back-to-back while the first was still
running). They agree exactly, which is treated as agreement between runs rather than as two
independently scheduled verifications; the reproducible command is
`runtime/node-v22.23.4-win-x64/node.exe node_modules/vitest/vitest.mjs run`.

**Delta versus the historical A13 baseline (87 files / 2 158 tests / 0 failed).** The change is +1 file
and +17 tests, which is precisely
`src/__tests__/inference/freellmapi-fallback.test.ts`, the §8 suite added by this phase. No pre-existing
file changed its test count, and no test disappeared. The historical figure is quoted as history only;
the current figures are the two rows above.

## 12. Real inference status

No regression item performs network I/O. `REAL_INFERENCE = BLOCKED_NO_CREDENTIAL + BLOCKED_APPROVAL`
(`FINAL_FREELLMAPI_INFERENCE_TEST.md`), so the suite's green state says nothing about a live provider —
and item H exists specifically to assert that resolution opens no socket.

## 13. Fallback status

`MOCK_FALLBACK = VERIFIED` — items E (17) and G/H (the §8 suite, 17 tests) pass against the shipped
template with the transport mocked. `REAL_FALLBACK = NOT TESTED` — no OpenAI or Groq endpoint was
contacted by any run in this report. Not conflated anywhere.

## 14. Security invariant results

Unchanged by the regression activity: the close probe after all runs
(`runtime/tmp/p20-close-invariants.log`, and the §13 table in
`FINAL_FREELLMAPI_SECURITY_INVARIANTS.md`) still shows `automaton.json`
`1c10ecc5…4c966d`, `state.db` `2a8aeb34…efbba` @ 512 000 B, schema 11, 38 tables, `integrity_check ok`,
V12/V13 tables absent, no `wallet.json`, activation/migration env vars unset.
One side effect is recorded honestly: opening the database read-only advances the
`state.db-shm` mtime (size stays 32 768 B, `-wal` stays 0 B, the database hash is unchanged).

## 15. Residual findings

- **R-20-01** `dist/**` was regenerated by item J: **544 of 544** files carry an mtime at or after the
  build start `2026-11-04T04:45:51Z`. `dist` is gitignored (`.gitignore:2`), so this is generated output,
  not a source change — but §15's instruction applies: the "no source modified" claim does **not** mean
  "no build output changed". Both facts are recorded separately.
- **R-20-02** The shipped suite writes to `<user-home>\.automaton\workspace` during test
  runs (directory mtime `Nov 4 10:16`, i.e. during item K). Pre-existing behaviour of the suite, not
  introduced this phase, and not the canonical `runtime/home` — but any future claim that "tests touch
  only the isolated HOME" would be wrong. Recorded for the next phase to scope, if the operator wants it
  changed.
- **R-20-03** The §12 letter mislabelling described in §10 above. Corrected additively here; the log is
  left as generated.
- **R-20-04** Item A's 13 failures remain 13 failures until P-6 is approved. They are not counted in the
  shipped suite (different config, different include pattern), so "88/2 175 green" and "13 red" are both
  simultaneously true and both are published.

## 16. Rollback instructions

Nothing in this report needs rollback: it modified no source, config or state file, only test execution
and logs. To restore the pre-phase shipped suite exactly, delete the one additive test file
(`src/__tests__/inference/freellmapi-fallback.test.ts`) → 87 files / 2 158 tests, and re-run `tsc` from
the unchanged source to regenerate `dist`. Full per-category rollback is in
`FINAL_FREELLMAPI_SECURITY_INVARIANTS.md` §17.

## 17. Final GO / NO-GO

**GO** for the regression claim: the shipped suite is green, measured twice, with fresh counts and an
explained delta.
**NO-GO** for treating that green as evidence that the P-6 gap is closed — item A is red on purpose, and
the 13 failures are the measured size of the unapproved change.
