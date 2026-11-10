# Pre-Activation Readiness Audit — Treasury Security

## 1. F-1 finding (original)

`automaton.json` declares all ten `treasuryPolicy` keys as `0`. But `loadConfig()` merged
`DEFAULT_TREASURY_POLICY` (which contains three *additional* keys with non-zero values) as the base:

```ts
const treasuryPolicy = {
  ...DEFAULT_TREASURY_POLICY,   // includes maxMonthlyTransferCents: 100000,
                                // agentBudgetCents: 200000, childBudgetCents: 50000
  ...(raw.treasuryPolicy ?? {}), // declares the 10 standard keys as 0
};
```

The three extra keys (`maxMonthlyTransferCents`, `agentBudgetCents`, `childBudgetCents`) are
**optional** in the `TreasuryPolicy` interface and are **not** declared in `automaton.json` or prompted
in the setup wizard/configure flow. They therefore inherit non-zero defaults even though the operator
believed all limits were zero.

Additionally, `resolveTreasuryPolicy()` returned `config.treasuryPolicy` directly when it existed
(always, after `loadConfig`), bypassing the lockdown check entirely. The lockdown branch
(`config.security?.lockdown ? LOCKDOWN_TREASURY_POLICY : ...`) was dead code.

## 2. Exploitability analysis

| Scenario | Exploitable? | Reason |
|---|---|---|
| Current deployment (lockdown=true, allowedTools=[], no wallet) | **No** | Four independent gates block: lockdown, empty allowlist, financial tools off, no wallet. `singleCap` (maxSingleTransferCents=0) denies before monthly/agent/child checks are reached. |
| After financial tools enabled, singleCap still 0 | **No** | `singleCap <= 0` → `OPERATION_DISABLED` |
| After financial tools enabled AND singleCap raised to non-zero | **Yes (latent)** | monthly (100k), agent (200k), child (50k) caps would permit more than the operator's declared zero-spend policy |
| live-model-preflight `treasury.all_zero` | **Fails** (pre-fix) | Reports non-zero fields — caught by the preflight gate |

## 3. Remediation implemented

### 3.1 `src/config.ts` — `loadConfig()`

- Parse security **first** (`normalizeSecurityConfig`), then choose the treasury base:
  `security.lockdown ? LOCKDOWN_TREASURY_POLICY : DEFAULT_TREASURY_POLICY`.
- Merge base + `raw.treasuryPolicy`.
- Validate every numeric field fail-closed: non-number, non-finite, negative, non-integer, or
  overflow (`> MAX_SAFE_INTEGER`) → reset to base value (0 under lockdown).

### 3.2 `src/security/treasury-guard.ts` — `resolveTreasuryPolicy()`

- Under lockdown → return `{ ...LOCKDOWN_TREASURY_POLICY }` (all 12 fields zero, ignores config).
- Otherwise → merge DEFAULT + config.treasuryPolicy.

### 3.3 `src/agent/loop.ts`

- Policy engine now uses `resolveTreasuryPolicy(config)` instead of
  `config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY`.

### 3.4 `src/agent/tools.ts`

- `x402_fetch` max payment now uses `resolveTreasuryPolicy(ctx.config).maxX402PaymentCents`.

### 3.5 `src/setup/wizard.ts` and `src/setup/configure.ts`

- Wizard: the 3 missing keys default to 0 (fail-closed).
- Configure: the 3 missing keys default to 0 unless explicitly set by the operator.

### 3.6 `src/types.ts`

- `DEFAULT_TREASURY_POLICY` retains non-zero defaults for the 3 keys (non-locked-down baseline).
- `LOCKDOWN_TREASURY_POLICY` zeroes all 12 keys.

## 4. Test evidence

- New file: `src/__tests__/security/f1-treasury-fail-closed.test.ts` — **9 tests, all passing**.
- Tests cover: missing policy, empty policy, invalid values (NaN/Infinity/negative/string/overflow/non-integer),
  resolveTreasuryPolicy under lockdown (all 12 zero), LOCKDOWN policy all-zero, DEFAULT retention,
  non-lockdown merge, preflight pass under lockdown.
- Existing tests: `phase15-treasury.test.ts` (treasury guard), `financial.test.ts`, `phase16-live-model-preflight.test.ts`
  — all passing (192 tests in the treasury/preflight group).
- Full suite Run 2: **90 files / 2,238 tests / 0 failures**.

## 5. Verification

After the fix, `loadConfig()` on the production config produces all 12 treasury fields at 0, and
`resolveTreasuryPolicy()` returns all zeros under lockdown. The live-model-preflight `treasury.all_zero`
check now passes for a lockdown `loadConfig()` result.

## 6. Remaining risk

- Non-locked-down configs (manually constructed, e.g. in tests) still use DEFAULT's non-zero
  defaults for the 3 extra keys. This is by design: non-locked-down configs are operator-opt-in
  production setups where reasonable defaults are appropriate. The operator must explicitly set
  lockdown=false, which `normalizeSecurityConfig` does not permit via the config file (lockdown
  defaults to true), so the only path is programmatic construction.
- The 3 extra keys remain optional in the `TreasuryPolicy` interface. Code consistently uses
  `?? 0`, so absence is safe.
