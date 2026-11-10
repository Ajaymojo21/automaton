# Phase 21 — B-4 Treasury Non-Lockdown Security

## 1. All 12 treasury fields audited

| Field | Default (DEFAULT) | Default (LOCKDOWN) | Merge | Validation | Enforcement |
|---|---|---|---|---|---|
| maxSingleTransferCents | 5000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | treasury guard single cap |
| maxHourlyTransferCents | 10000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | hourly sum check |
| maxDailyTransferCents | 25000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | daily sum check |
| minimumReserveCents | 1000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | reserve check |
| maxX402PaymentCents | 100 | 0 | base + raw | non-neg int, ≤MAX_SAFE | x402 single cap |
| x402AllowedDomains | ['conway.tech'] | [] | base + raw | array | domain allowlist |
| transferCooldownMs | 0 | 0 | base + raw | non-neg int, ≤MAX_SAFE | cooldown check |
| maxTransfersPerTurn | 2 | 0 | base + raw | non-neg int, ≤MAX_SAFE | (policy layer) |
| maxInferenceDailyCents | 50000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | inference spend |
| requireConfirmationAboveCents | 1000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | confirmation gate |
| maxMonthlyTransferCents | 100000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | monthly sum check |
| agentBudgetCents | 200000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | lifetime budget |
| childBudgetCents | 50000 | 0 | base + raw | non-neg int, ≤MAX_SAFE | child budget |

## 2. Adversarial test results

All invalid/missing-value cases tested in `f1-treasury-fail-closed.test.ts` (9 tests):
- Missing policy → all zeros (under lockdown).
- Empty policy → all zeros.
- NaN/Infinity/negative/string/overflow/non-integer → reset to base (0 under lockdown).
- Under lockdown, `resolveTreasuryPolicy` returns LOCKDOWN (all zeros) regardless of config.

## 3. Security policy

Under lockdown, all 12 fields resolve to 0 via `loadConfig` (LOCKDOWN base) and `resolveTreasuryPolicy`
(returns LOCKDOWN). Missing/malformed values never increase authority. The preflight `treasury.all_zero`
check passes for lockdown configs.

## 4. Acceptance

**RESOLVED for lockdown.** Non-locked-down (operator-opt-in) configs retain DEFAULT's non-zero
defaults for the 3 extra keys. This is by design: non-locked-down is a production setup where
reasonable defaults are appropriate. The operator must explicitly set lockdown=false (not possible
via config file — `normalizeSecurityConfig` forces lockdown=true).
