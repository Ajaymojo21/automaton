# Phase 15C — Centralized Treasury Enforcement

**Status:** IMPLEMENTED AND TESTED
**Date:** 2026-10-31
**Code:** `src/security/treasury-guard.ts`, `src/security/audit-chain.ts`,
`src/state/schema.ts` (migration V12), `src/agent/tools.ts` (dispatch integration),
`src/conway/topup.ts`, `src/index.ts`, `src/agent/loop.ts`

---

## 1. What changed

Before Phase 15, financial limits were split between policy rules that could be
bypassed, and per-tool checks:

| Gap | Before |
|---|---|
| G-02 | `minimumReserveCents` was declared but the rule always returned `null` |
| G-03 | `transferCooldownMs` was never read outside the config schema |
| G-04 | `topup_credits` and the replication auto-top-up bypassed treasury entirely |
| G-10 | no monthly window |
| G-11 | no per-agent or per-child budget |
| G-12 | check-then-spend race between balance read and transfer |
| G-13 | no duplicate/replay detection |
| G-14 | x402 spend recorded as 0 cents |
| G-16 | policy evaluation was skipped when no `policyEngine`/`turnContext` was supplied |

After Phase 15, **every** financial tool call passes through `TreasuryGuard` inside
`executeTool`, whether or not a policy engine exists. The guard is also used by the
two out-of-band credit purchases (startup bootstrap, spawn auto-top-up).

### Enforcement order (first failure wins)

1. Amount is a positive integer number of cents.
2. Idempotency key has not been seen before (duplicate/replay).
3. The operation's per-transaction cap is greater than zero (zero = disabled).
4. Amount ≤ per-transaction cap (x402 uses `maxX402PaymentCents`, the rest use
   `maxSingleTransferCents`).
5. Transfers require a current balance; child funding requires a child id.
6. Transfer cooldown (last authorized transfer).
7. Balance minus other in-flight reservations must cover the amount and leave
   `minimumReserveCents`.
8. Rolling hourly cap.
9. UTC-daily cap.
10. UTC-monthly cap.
11. Agent lifetime budget.
12. Per-child lifetime budget.

A reservation row counts toward all windows from the moment it is authorized, so a
second call — including a concurrent one — cannot spend the same budget. Released
reservations stop counting; denied decisions never count.

### Why there is no TOCTOU window

`authorize` is a synchronous method that performs the limit queries and the
reservation insert inside a single SQLite `IMMEDIATE` transaction. The balance is
fetched by the caller *before* calling it, and in-flight reservations are subtracted
from that balance, so an interleaved second call sees the first call's reservation.
`better-sqlite3` serialises writers, and the process is single-threaded, so there is
no await between check and reserve.

### Fail-closed behaviour

- Missing balance for a transfer → `BALANCE_UNAVAILABLE` (deny).
- Guard construction/DB failure → `executeTool` returns
  `Treasury denied: TREASURY_UNAVAILABLE — authorization failed, operation blocked`.
- Tool execution throws → reservation released.
- Tool returns a failure string (`Blocked:`, `Insufficient`, `x402 fetch failed`,
  `Child …`, etc.) → reservation released.
- Unknown textual failures are committed, which **over-counts** budget (fails
  closed rather than permitting overspend).
- A credit purchase is not attempted if its authorization callback throws.

### Commit and overrun

`commit()` moves a reservation to `committed`. If the executed amount exceeds the
reserved ceiling, the row is updated to the actual amount and a `HIGH`
`treasury.overrun` security event is written. Today x402 only knows the ceiling at
authorization time, so the ceiling is committed; the actual signed amount is bounded
by the same value inside `x402Fetch`.

---

## 2. Schema (migration V12)

New tables (additive; no existing table altered):

```
treasury_authorizations(
  id, idempotency_key UNIQUE, tool_name, operation,
  amount_cents, requested_amount_cents, recipient, domain, child_id, actor,
  decision CHECK(allow|deny), status CHECK(reserved|committed|released|denied),
  reason_code, reason_message, balance_cents, created_ms, created_at, committed_ms
)

security_events(
  id, sequence UNIQUE, timestamp, severity, category, event_type,
  actor, details, prev_hash, hash
)
```

Integrity:

- `security_events` has triggers that reject `UPDATE` and `DELETE`.
- `treasury_authorizations` rejects `DELETE`.
- Every security event hash covers the previous hash, so edits made by an attacker
  who drops the triggers are detectable by `verifySecurityChain()`.

The audit chain is shared infrastructure for Phase 15G (incident monitoring).

---

## 3. Integration points

| Call site | Operation | Balance source |
|---|---|---|
| `executeTool("transfer_credits")` | `transfer_out` | `conway.getCreditsBalance()` |
| `executeTool("fund_child")` | `child_funding` (with child id) | `conway.getCreditsBalance()` |
| `executeTool("topup_credits")` | `credit_purchase` (USD → cents) | n/a (USDC purchase) |
| `executeTool("x402_fetch")` | `x402_payment` (cap) | n/a (USDC payment) |
| spawn-child 402 auto-top-up | `credit_purchase` | n/a |
| startup bootstrap top-up | `credit_purchase` | n/a |

Duplicate detection uses `sha256(toolName + args + turnId)` when `turnId` is
available; the loop now passes `turn.id`. Identical calls in the same turn are
rejected; the same transfer in a later turn is allowed (subject to cooldown).

---

## 4. Evidence

All test commands were executed with the portable Node 22 runtime because the
`better-sqlite3` native module is built for ABI 127 (Node 22); the system Node 24
cannot load it.

### 4.1 Unit and integration tests

```
runtime/node-v22.23.4-win-x64/node.exe node_modules/vitest/vitest.mjs run src/__tests__/phase15-treasury.test.ts
  → Test Files 1 passed (1)
  → Tests 35 passed (35)
  → duration ~1.4 s, exit 0

node node_modules/typescript/bin/tsc --noEmit
  → exit 0
```

Coverage includes:

- equality and +1 boundaries for the per-transaction cap;
- zeroed policy denies everything;
- reserve equality allowed / one cent over denied;
- insufficient balance, missing balance (fail closed);
- cooldown blocked at +30 s, allowed at +60 s + 1 ms; x402 not subject to cooldown;
- rolling hourly, UTC-daily, UTC-monthly resets;
- agent lifetime budget and per-child budgets (two children isolated);
- replayed idempotency key;
- two in-flight authorizations against one balance (second denied);
- release returns budget; denied rows excluded from totals;
- commit, commit-of-unknown, overrun emits a `HIGH` event;
- x402 cap, zero-cap disable, credit-purchase cap;
- hash chain valid, edited row detected, deleted row detected, append-only triggers;
- `executeTool` authorizes and commits with no policy engine and no turn context;
- treasury denial blocks the tool;
- duplicate call in the same turn rejected;
- reservation released when the tool returns `Blocked: …`.

### 4.2 Migration verified against a copy of the live database

```
copied runtime/home/.automaton/state.db (+wal/+shm) to %TEMP%
createDatabase(copy)
  version_after=12
  tables=security_events,treasury_authorizations
  triggers=security_events_no_delete,security_events_no_update,treasury_authorizations_no_delete
  integrity=[{"integrity_check":"ok"}]
copy_removed=true
```

The live database was not opened or modified by the check.

### 4.3 Live installation remains disabled

```
activationApproved=false
lockdown=true
allowFinancialTools=false
maxChildren=0
treasuryPolicy: all numeric limits 0, x402AllowedDomains []
```

With `maxSingleTransferCents = 0`, every operation resolves to
`OPERATION_DISABLED`. No wallet exists, so no balance could be spent even if a limit
were raised.

---

## 5. Residual risks

1. **x402 actual amount.** The guard authorizes the configured ceiling and commits
   the ceiling. `x402Fetch` independently refuses to sign above the same ceiling, but
   the audit row does not contain the true price paid. Closing this requires
   `x402Fetch` to return the paid amount.
2. **Credit-purchase cap mapping.** Credit purchases use
   `maxSingleTransferCents` as their per-transaction cap. This is documented but is
   not a dedicated field; a future schema should add `maxCreditPurchaseCents`.
3. **Turn transfer count** (`maxTransfersPerTurn`) is still enforced only by the
   policy rule (which requires a policy engine). The guard enforces amount limits but
   not call counts. Duplicate detection covers exact repeats, not distinct transfers.
4. **Two spend ledgers.** `spend_tracking` remains for the policy engine and
   inference budgeting; `treasury_authorizations` is authoritative for money movement.
   x402 still records 0 in `spend_tracking`.
5. **Crash between reserve and commit** leaves a `reserved` row that consumes budget
   until manually reconciled. This over-counts (fails closed); there is no automatic
   expiry.
6. **`executeTool` result classification** uses known failure prefixes. A future
   financial tool with a new failure string would be committed rather than released.
7. **No operator UI** to raise limits. Editing `automaton.json` remains the only way
   to change policy, and the runtime must be restarted.

---

## 6. Verdict

**PASS.** Treasury limits are enforced in code at one central layer, with atomic
reservation, duplicate rejection, complete audit trail, and fail-closed integration
for every financial tool and both automatic credit purchases. Residual risks are
documented above.
