# Phase 15C — Centralized Treasury Enforcement (Operator Guide)

**Control:** one code layer decides whether any money-moving operation may proceed, and it
cannot be bypassed by the policy engine, by a prompt, or by a caller that forgets to ask.
**Status:** implemented, 39 tests executed (35 original + 4 from the F1 fix).
**Evidence:** [`../../reports/PHASE_15_TREASURY_ENFORCEMENT.md`](../../reports/PHASE_15_TREASURY_ENFORCEMENT.md)
**Code:** [`src/security/treasury-guard.ts`](../src/security/treasury-guard.ts),
[`src/security/audit-chain.ts`](../src/security/audit-chain.ts),
migration V12 in [`src/state/schema.ts`](../src/state/schema.ts), dispatch integration in
[`src/agent/tools.ts`](../src/agent/tools.ts)

> **Live posture:** every numeric limit in `treasuryPolicy` is `0`, `x402AllowedDomains` is
> `[]`, `allowFinancialTools` is `false`, and no wallet exists. With
> `maxSingleTransferCents = 0` every operation resolves to `OPERATION_DISABLED`. This document
> explains the mechanism; it is not an invitation to raise a limit.

---

## 1. Why "centralized" is the point

Before Phase 15 the limits were split: policy rules that a missing `policyEngine` could skip,
plus per-tool checks that only some call sites made. The Phase 15 gap audit recorded the
concrete holes — a reserve that was declared but never enforced (G-02), a cooldown that was
never read outside the schema (G-03), credit top-ups and the replication auto-top-up that
bypassed treasury entirely (G-04), no monthly window (G-10), no per-agent or per-child budget
(G-11), a check-then-spend race (G-12), no replay detection (G-13), x402 booked as 0 cents
(G-14), and policy evaluation skipped when the engine was absent (G-16).

Now `executeTool` runs the guard on **every** financial tool call regardless of whether a
policy engine exists, and the two out-of-band credit purchases (startup bootstrap,
spawn-child auto-top-up) go through the same guard.

## 2. Enforcement order — first failure wins

1. amount is a positive integer number of cents;
2. the idempotency key has not been seen before (replay/duplicate);
3. this operation's per-transaction cap is greater than zero (zero means disabled);
4. amount ≤ per-transaction cap (`maxX402PaymentCents` for x402, `maxSingleTransferCents` for the rest);
5. the domain is on `x402AllowedDomains` — x402 only, and this is fail-closed: an empty
   allowlist disables x402, a missing or unparseable host is `DOMAIN_NOT_ALLOWED`, and a
   subdomain match counts only against a listed entry;
6. transfers require a current balance; child funding requires a child id;
7. the transfer cooldown has elapsed since the last authorized transfer (x402 is exempt);
8. balance, minus every other in-flight reservation, covers the amount **and** leaves
   `minimumReserveCents`;
9. rolling hourly cap;
10. UTC-daily cap;
11. UTC-monthly cap;
12. agent lifetime budget;
13. per-child lifetime budget.

Step 5 was not there originally. Phase 15I's penetration test found the domain allowlist lived
only in a policy rule the guard never consulted (finding **F1**), which meant any caller
reaching `TreasuryGuard.authorize` without the engine could pay an arbitrary host. The guard
now owns that decision inside the same transaction.

A reservation counts toward every window from the moment it is authorized. Released
reservations stop counting. Denied decisions never count.

## 3. Why there is no time-of-check window

`authorize()` is synchronous. The limit queries and the reservation `INSERT` happen inside one
SQLite `IMMEDIATE` transaction. The caller reads the balance *before* calling, and the guard
subtracts in-flight reservations from it, so an interleaved second call sees the first call's
row. `better-sqlite3` serialises writers and the process is single-threaded, so there is no
`await` between check and reserve.

The race was tested, not argued: five concurrent 500-cent transfers against a 10 000-cent
balance produced **3 allowed, 2 denied, final balance 8 500** — exactly the reserve floor
behaving.

## 4. Fail-closed behaviour

| Situation | What happens |
|---|---|
| No balance available for a transfer | `BALANCE_UNAVAILABLE`, denied |
| Guard construction or DB failure | `executeTool` returns `Treasury denied: TREASURY_UNAVAILABLE — authorization failed, operation blocked` |
| Tool body throws | reservation released |
| Tool returns a known failure string (`Blocked:`, `Insufficient`, `x402 fetch failed`, `Child …`) | reservation released |
| Tool returns an *unknown* textual failure | **committed** — over-counts budget, errs toward less future spend |
| Authorization callback throws during a credit purchase | the purchase is not attempted |
| A tool times out | its financial reservation is released |

The "commit on unknown failure" rule is intentional. The alternative — release — would hand
spend capacity back to an agent whose call may actually have moved money.

## 5. Schema and what it gives you forensically

Migration V12 added two tables, both additive; nothing existing was altered.

`treasury_authorizations`: `id`, `idempotency_key UNIQUE`, `tool_name`, `operation`,
`amount_cents`, `requested_amount_cents`, `recipient`, `domain`, `child_id`, `actor`,
`decision` (`allow|deny`), `status` (`reserved|committed|released|denied`), `reason_code`,
`reason_message`, `balance_cents`, `created_ms`, `created_at`, `committed_ms`.
A `DELETE` trigger rejects removals, so the ledger is append-only in practice.

`security_events`: `id`, `sequence UNIQUE`, `timestamp`, `severity`, `category`, `event_type`,
`actor`, `details`, `prev_hash`, `hash` — with `UPDATE` and `DELETE` triggers and a hash chain,
so an attacker who drops the triggers still leaves a detectable break
(`verifySecurityChain()`).

Overruns: `commit()` with an executed amount above the reserved ceiling updates the row to the
actual amount **and writes a `HIGH` `treasury.overrun` security event**.

## 6. Audit queries an operator can run

Against a **copy** of the database — never the live file while the agent runs:

```sql
-- what was denied, and why
SELECT created_at, tool_name, operation, amount_cents, reason_code, actor
  FROM treasury_authorizations WHERE decision = 'deny' ORDER BY id DESC LIMIT 50;

-- reservations stuck in 'reserved' (see residual 5 below)
SELECT id, tool_name, amount_cents, created_ms
  FROM treasury_authorizations
 WHERE status = 'reserved' AND created_ms < (strftime('%s','now')*1000 - 600000);

-- spend per window, straight from the authoritative ledger
SELECT SUM(amount_cents) FROM treasury_authorizations
 WHERE status IN ('reserved','committed')
   AND created_ms >= strftime('%s','now')*1000 - 3600000;

-- is the audit trail intact?
--   verifySecurityChain() in code; seals verified by verifySeals()
```

## 7. Changing a policy

There is **no UI and no CLI** for limits. The only supported path:

1. stop the runtime;
2. edit `security.treasuryPolicy` in `runtime/home/.automaton/automaton.json`;
3. restart — the guard reads policy at construction.

Rules of thumb: a `0` cap is a *disabled operation*, not an unlimited one; `minimumReserveCents`
is checked against (balance − in-flight reservations); and per-child budgets are per child id,
so raising `maxChildren` without setting `childLifetimeBudgetCents` keeps children unfunded.
Raising any of these is a change of the install's security posture and needs your deliberate
decision — the activation gates in
[`WALLET_SECURITY.md`](WALLET_SECURITY.md) and [`TREASURY_SECURITY.md`](TREASURY_SECURITY.md)
still apply.

## 8. Verifying the control yourself

```bash
cd <repo-root>
./runtime/node-v22.23.4-win-x64/node.exe node_modules/vitest/vitest.mjs run \
  src/__tests__/phase15-treasury.test.ts
# recorded: Test Files 1 passed (1), Tests 35 passed (35), ~1.4 s, exit 0
# (39 passed after the Phase 15I F1 fix added four domain cases)
node node_modules/typescript/bin/tsc --noEmit          # recorded: exit 0
```

The V12 migration was additionally proven against a **copy** of the live database:
`version_after=12`, tables `security_events` + `treasury_authorizations`, all three triggers
present, `PRAGMA integrity_check` → `ok`, copy removed afterwards. The live database was
never opened by that check.

## 9. Residual risks

1. **x402 records the ceiling, not the price paid.** The guard authorizes the configured
   ceiling and commits the ceiling. `x402Fetch` independently refuses to sign above the same
   ceiling, so the spend is bounded — but the audit row does not hold the true amount. Closing
   this needs `x402Fetch` to return what it paid.
2. **Credit purchases reuse `maxSingleTransferCents`** as their per-transaction cap. Correct
   behaviour, wrong field name; a dedicated `maxCreditPurchaseCents` belongs in a schema change.
3. **`maxTransfersPerTurn` is still policy-only.** The guard bounds amounts, not call counts.
   Exact repeats in one turn are caught by the idempotency key; *distinct* transfers in one
   turn are not counted.
4. **Two spend ledgers exist.** `spend_tracking` serves the policy engine and inference
   budgeting; `treasury_authorizations` is authoritative for money. x402 still writes 0 into
   `spend_tracking`.
5. **A crash between reserve and commit leaves a `reserved` row** that keeps consuming budget.
   This over-counts (fail closed) and has **no automatic expiry** — reconcile it manually using
   the §6 query. Releasing a stale reservation is classified `requires_approval` for the
   mechanic (see [PHASE_15_SELF_HEALING.md](PHASE_15_SELF_HEALING.md)), so the agent will not
   do it for you.
6. **Result classification is by known failure prefixes.** A future financial tool with a new
   failure string will be committed, not released.
7. **Duplicate detection keys on `sha256(toolName + args + turnId)`.** Same-turn repeats are
   rejected; the same transfer in a later turn is allowed subject to cooldown.
