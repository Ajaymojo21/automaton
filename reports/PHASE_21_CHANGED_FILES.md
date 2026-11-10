# Phase 21 — Changed Files

## 1. Source files modified

| File | Change |
|---|---|
| `src/config.ts` | Treasury base lockdown-aware; validation fail-closed |
| `src/security/treasury-guard.ts` | `resolveTreasuryPolicy` lockdown-aware |
| `src/agent/loop.ts` | Uses `resolveTreasuryPolicy` |
| `src/agent/tools.ts` | x402 uses `resolveTreasuryPolicy` |
| `src/setup/wizard.ts` | 3 missing keys default to 0 |
| `src/setup/configure.ts` | 3 missing keys default to 0 if absent |
| `src/types.ts` | DEFAULT retains non-zero; LOCKDOWN zeroes all 12 |

## 2. Source files added

| File | Purpose |
|---|---|
| `src/reliability/repair-approval.ts` | Repair approval lifecycle (B-2) |
| `src/inference/failover-classifier.ts` | Failover classification (B-5) |
| `src/__tests__/security/f1-treasury-fail-closed.test.ts` | 9 F-1 regression tests |
| `src/__tests__/reliability/repair-approval.test.ts` | 15 approval lifecycle tests |
| `src/__tests__/inference/failover-classifier.test.ts` | 28 classification tests |

## 3. Files NOT modified

- No tracked file other than the 7 listed in §1 was modified.
- `src/index.ts`, `src/state/database.ts`, `src/state/schema.ts`, `src/identity/wallet.ts`,
  `src/inference/*` (except new failover-classifier.ts) — not touched.

## 4. Production state

- `state.db` hash unchanged: `2A8AEB34…EFBBA`.
- `automaton.json` hash unchanged.
- No migration executed.
- No wallet created.
- No global config changed.
