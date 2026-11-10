# Pre-Activation Readiness Audit — Regression

## 1. Run 1

| Field | Value |
|---|---|
| Files | 90 |
| Tests | 2,238 |
| Passed | 2,237 |
| Failed | 1 |
| Skipped | 0 |
| Duration | 149.4 s |
| Exit code | 1 |
| Success | false |

**Failure:** `general-harness.test.ts` — "sanitizes hostile web_fetch output" expected
`[chatml-removed]` but got `Error: Treasury denied: MONTHLY_LIMIT…`.

**Root cause:** An intermediate state of the F-1 remediation zeroed `DEFAULT_TREASURY_POLICY`'s three
extra keys. This caused `resolveTreasuryPolicy` (non-locked-down test path) to return
`maxMonthlyTransferCents: 0`, triggering `MONTHLY_LIMIT_EXCEEDED` before the tool body executed.

**Fix:** Restored DEFAULT's three keys to their original non-zero values (100000/200000/50000).
Under lockdown, `loadConfig` and `resolveTreasuryPolicy` still produce all zeros via the
`LOCKDOWN_TREASURY_POLICY` base. This is a legitimate remediation iteration, not a test weakening.

## 2. Run 2

| Field | Value |
|---|---|
| Files | 90 |
| Tests | 2,238 |
| Passed | 2,238 |
| Failed | 0 |
| Skipped | 0 |
| Duration | 116.9 s |
| Exit code | 0 |
| Success | true |

**No failing files.**

## 3. TypeScript

| Target | Exit | Duration |
|---|---|---|
| Repository root (`tsc --noEmit`) | 0 | 60.4 s |
| Dashboard (`tsc --noEmit -p tsconfig.json`) | 0 | 16.4 s |

## 4. Comparison

| Metric | Run 1 | Run 2 | Delta |
|---|---|---|---|
| Files | 90 | 90 | 0 |
| Tests | 2,238 | 2,238 | 0 |
| Passed | 2,237 | 2,238 | +1 |
| Failed | 1 | 0 | -1 |
| Skipped | 0 | 0 | 0 |

Run 2 is clean. The single Run 1 failure was caused by an intermediate remediation state and was
resolved without weakening any test.
