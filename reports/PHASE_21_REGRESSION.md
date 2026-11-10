# Phase 21 — Regression

## 1. Test results

| Run | Files | Tests | Passed | Failed | Skipped | Exit | Duration |
|---|---|---|---|---|---|---|---|
| Run 1 | 90 | 2,238 | 2,237 | 1 | 0 | 1 | 149.4 s |
| Run 2 | 90 | 2,238 | 2,238 | 0 | 0 | 0 | 116.9 s |

## 2. Run 1 failure

`general-harness.test.ts` — "sanitizes hostile web_fetch output" expected `[chatml-removed]` but got
`Error: Treasury denied: MONTHLY_LIMIT…`.

**Root cause:** Intermediate state of F-1 remediation zeroed `DEFAULT_TREASURY_POLICY`'s three extra
keys, causing `resolveTreasuryPolicy` (non-locked-down test path) to return `maxMonthlyTransferCents: 0`,
triggering `MONTHLY_LIMIT_EXCEEDED` before the tool body executed.

**Fix:** Restored DEFAULT's three keys to original non-zero values (100000/200000/50000). Under
lockdown, `loadConfig` and `resolveTreasuryPolicy` still produce all zeros via `LOCKDOWN_TREASURY_POLICY`.
Run 2: 2238/2238 pass.

## 3. TypeScript

| Target | Exit | Duration |
|---|---|---|
| Repository root | 0 | 60.4 s |
| Dashboard | 0 | 16.4 s |

## 4. New test files

| File | Tests | Passed |
|---|---|---|
| `src/__tests__/security/f1-treasury-fail-closed.test.ts` | 9 | 9 |
| `src/__tests__/reliability/repair-approval.test.ts` | 15 | 15 |
| `src/__tests__/inference/failover-classifier.test.ts` | 28 | 28 |
| **Total new** | **52** | **52** |

## 5. Conclusion

Run 2 is clean. All new tests pass. TypeScript compiles. No test weakening occurred.
