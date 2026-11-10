# TREASURY SECURITY — Phase 7

**Treasury policy:** all limits `0`, x402 allowlist empty
**Financial tools enabled:** **NO**
**Real money spent:** **$0.00**
**Blockchain transactions executed:** **NONE**

---

## 1. Current policy

```json
"treasuryPolicy": {
  "maxSingleTransferCents": 0,
  "maxHourlyTransferCents": 0,
  "maxDailyTransferCents": 0,
  "minimumReserveCents": 0,
  "maxX402PaymentCents": 0,
  "x402AllowedDomains": [],
  "transferCooldownMs": 0,
  "maxTransfersPerTurn": 0,
  "maxInferenceDailyCents": 0,
  "requireConfirmationAboveCents": 0
}
```

A zeroed policy is **fail-closed for the rules that are actually implemented**, but it
is not uniformly meaningful. The table below separates what the code enforces from
what it merely declares. This distinction is the core of this phase: a zero value in
a field that no code reads proves nothing.

---

## 2. Enforcement matrix (verified against source)

| Field | Enforced? | Mechanism | Behaviour at `0` | Notes |
|---|---|---|---|---|
| `maxSingleTransferCents` | **Yes** | `financial.transfer_max_single` rule on `transfer_credits` | Any positive amount denied (`amount > 0`) | Amount must be a finite number; tool re-validates |
| `maxHourlyTransferCents` | **Yes** | `financial.transfer_hourly_cap` via `SpendTracker.checkLimit` | Any positive transfer denied at 0 | Spend recorded after a successful transfer |
| `maxDailyTransferCents` | **Yes** | `financial.transfer_daily_cap` via `SpendTracker.checkLimit` | Any positive transfer denied at 0 | Same |
| `maxTransfersPerTurn` | **Yes** | `financial.turn_transfer_limit` | First transfer denied | Counts per tool-call turn |
| `maxInferenceDailyCents` | **Yes** | `financial.inference_daily_cap` on `chat`/`inference` tools | **All inference denied**, because `0 >= 0` is true | Fail-closed, but means activation with defaults cannot run inference at all |
| `maxX402PaymentCents` | **Yes** (per payment) | Passed into `x402Fetch(url, …, maxPaymentCents)` and checked **before signing** | Any positive payment rejected | Not a policy rule; enforcement is inside `src/conway/x402.ts` |
| `x402AllowedDomains` | **Yes** | `financial.x402_domain_allowlist` | Empty list denies **all** `x402_fetch` calls | Exact host or subdomain match |
| `requireConfirmationAboveCents` | **Effectively yes** | Rule returns `quarantine`; `tools.ts` treats any non-`allow` as a denial | Any positive transfer blocked | **There is no interactive approval channel.** `quarantine` is recorded in the DB but surfaces to the model as `Policy denied: CONFIRMATION_REQUIRED`. Do not rely on it as a "human approves" flow. |
| `minimumReserveCents` | **NO — NO-OP** | `financial.minimum_reserve` returns `null` unconditionally | No effect | The comment in source states actual balance checking would require an async call. The only related guard is "cannot transfer more than half the balance", which is not a reserve floor. |
| `transferCooldownMs` | **NO — UNUSED** | No code path reads it outside the type and setup wizard | No effect | Do not assume a cooldown exists. |

### 2.1 Tools outside the treasury policy

| Tool | Spending capability | Covered by `TreasuryPolicy`? | Current blocker |
|---|---|---|---|
| `topup_credits` | Buys Conway credits with USDC; tiers `$5…$2500` | **No** | `lockdown.financial` denies the entire `financial` category |
| `transfer_credits` | Transfers Conway credits | Yes | `lockdown.financial` + zero limits |
| `x402_fetch` | Pays x402 invoices | Per-payment cap yes; hourly/daily envelope ineffective | `lockdown.financial` |
| `spawn_child` auto-top-up | Buys credits on HTTP 402 during replication | **No** | `lockdown.replication` |
| Bootstrap top-up on start | Buys `$5` of credits | **No** (guarded separately) | Disabled by the lockdown guard added in `src/index.ts` |
| Heartbeat `check_usdc_balance` | Automatic top-ups | **No** (guarded separately) | Returns `shouldWake:false` under lockdown |

**Residual risk R-T1:** if lockdown is lifted and `allowFinancialTools` is set while
treasury limits remain at their defaults, `topup_credits` is bounded only by the
fixed tier list (up to `$2,500` per call) and available USDC — not by
`maxSingleTransferCents` or any daily cap. The lockdown financial rule is currently
the only thing preventing this.

**Residual risk R-T2:** the replication path's automatic top-up on a 402 response
(`src/agent/tools.ts`, `spawn_child` catch block) is subject to a 60-second cooldown
only, not to `TreasuryPolicy`. `lockdown.replication` currently blocks it.

**Residual risk R-T3:** x402 hourly/daily envelopes derived from
`maxX402PaymentCents` are computed in `SpendTracker`, but x402 spend is recorded as
`0` cents in the tracking table, so those envelopes cannot accumulate. The
per-payment cap is the only effective x402 limit.

---

## 3. Defence in depth actually in force

| Layer | Control | State |
|---|---|---|
| Tool allowlist | `lockdown.tool_allowlist` denies every tool not explicitly listed | Allowlist is empty → all tools denied |
| Financial category | `lockdown.financial` denies all `financial` tools | Active |
| Startup top-up | Code guard skips bootstrap `$5` purchase under lockdown | Active |
| Heartbeat top-up | Skips under lockdown | Active |
| Treasury rules | Zero limits deny positive transfers | Active (for covered tools) |
| Activation | `--run` refuses without two signals | Verified: exit 2 |
| Wallet | No wallet exists | Verified |
| Credentials | No provider keys | Verified |

This is why the practical spending capability is **$0**, even though two policy
fields (`minimumReserveCents`, `transferCooldownMs`) are decorative.

---

## 4. What must be true before enabling any financial capability

1. A human explicitly approves financial operations and names a maximum loss.
2. A **new experimental wallet** is created (never the primary wallet) — see
   [WALLET_SECURITY.md](WALLET_SECURITY.md).
3. Treasury limits are set to values the code actually enforces:
   `maxSingleTransferCents`, `maxHourlyTransferCents`, `maxDailyTransferCents`,
   `maxTransfersPerTurn`, `maxX402PaymentCents`, `maxInferenceDailyCents`.
4. `x402AllowedDomains` is populated with an explicit, reviewed list.
5. `lockdown` and `allowFinancialTools` are changed together and deliberately.
6. Accept that `minimumReserveCents` and `transferCooldownMs` will **not** protect
   you; compensate with low balances and monitoring.
7. Keep `allowReplication` off, or accept R-T2.
8. Verify enforcement after any upstream update — these findings are tied to commit
   `d8f816881fd24b6f5e3d616e59edec387a447667`.

**Never interpret installation permission as permission to spend.** No such
permission has been granted or exercised.

---

## 5. Phase verdict

**COMPLETE — FINANCIALLY INERT.** All financial tools are denied, the startup and
heartbeat top-ups are disabled, no wallet or credentials exist, and no money was
spent. The treasury audit also documented which upstream limits are advisory rather
than enforced, so future activation is not based on a false assumption of safety.
