# Reliability and Self-Healing Completion

- Date: 2026-11-10
- Components: health guardian, mechanic, heartbeat scheduler/context, failover, observability
- Runtime posture: self-healing disabled; agent never started

## 1. Health Guardian (Section 4)

`src/reliability/health-guardian.ts` implements five checkpoint states and five summary states:

```
HealthStatus  = pass | warn | fail | blocked | requires_operator
HealthSummary = healthy | degraded | failed | blocked | requires_operator
```

Severity order is `fail (4) > requires_operator (3) > blocked (2) > warn (1) > pass (0)`
(`src/reliability/health-guardian.ts:786-816`). The guard runs 16 checks:

1. `emergency_stop`
2. `process`
3. `database_integrity`
4. `schema_version`
5. `audit_chain`
6. `treasury_reservations`
7. `scheduler_leases`
8. `runtime_errors`
9. `security_invariants`
10. `treasury_limits`
11. `provider_config`
12. `dependencies`
13. `backup`
14. `disk_space`
15. `wallet_storage`
16. `dashboard`

Each check returns `id`, `title`, `status`, `message` and evidence. A check whose source table is
absent returns `blocked` with "the guardian had no source to assess", rather than inventing a pass
or a failure. Live run on the V11 database: 16 checks, overall `blocked` (three checks lack
`security_events` / `treasury_authorizations`); the dashboard additionally shows an informational
summary of the 13 checks that did have a source (`degraded`: 3 blocked, 0 operator, 2 warn, 0 fail).

## 2. Autonomous Mechanic (Section 4)

`src/reliability/mechanic.ts` classifies repairs as `automatic`, `requires_approval` or `forbidden`
(`:37`, `:78`). Execution is gated on `security.selfHealingEnabled === true` or an explicit
`allowRepairs` option (`:143`); otherwise the outcome is `skippedReason: "self-healing is disabled
(security.selfHealingEnabled=false)"` (`:161`). Privileged repairs are classified
`requires_approval` and are handed to the repair-approval lifecycle, which does not execute them.

In this deployment `selfHealingEnabled` is false, so the mechanic is non-executing. The dashboard
reports it as `VERIFIED / NOT REACHABLE`. No repair was executed.

## 3. Heartbeat `check_usdc_balance` timeout (Section 7)

Root cause: the task could perform a real top-up network call inside a heartbeat tick, and the test
exercised that path against a live endpoint. The test therefore depended on network timing and timed
out intermittently.

Fix (no test deleted or weakened):

- `src/heartbeat/tasks.ts:148-156`: the task returns immediately when `lockdown === true` and
  `allowFinancialTools !== true`, so the production posture performs no balance lookup and no top-up.
- `src/heartbeat/tasks.ts:176-181`: the top-up function is injectable (`taskCtx.topup ?? bootstrapTopup`)
  so tests can run deterministically without touching the network.
- `src/heartbeat/tick-context.ts:52-63`: the tick context fetches the credit balance once and the
  USDC balance once (only when a wallet is configured), each wrapped in its own try/catch, and
  derives the survival tier from that single reading.
- Tests strengthened: `heartbeat.test.ts` now asserts the stub is used and that a successful top-up
  is reported without waking twice; a new test asserts that under lockdown no top-up is attempted
  (`called === false`). `heartbeat-scheduler.test.ts` retains the task-timeout and tick-context tests
  (2 files, 41 tests, all passing).

Related timeouts: the x402 transport is configured with a 10-second timeout
(`src/conway/x402.ts:264`). The Solana USDC balance helper has no explicit timeout; it is
unreachable while no wallet is configured and is recorded as a known limitation.

## 4. Failover (B-5)

`src/inference/failover-classifier.ts` classifies provider failures and decides abort vs retry vs
failover. Tests (24 total in `failover-classifier.test.ts` and `freellmapi-fallback.test.ts`) cover:

- connection failure, timeout, 401 and invalid response abort the tier without trying cloud providers
  (so a local-only choice is not silently overridden);
- 429 retries three times, then moves to the next provider in tier order;
- a full tier of rate-limited providers fails with the provider names;
- five consecutive failures open the circuit and the next call fails over;
- ordering per tier: reasoning `freellmapi -> openai -> groq`, fast `freellmapi -> groq -> openai`,
  cheap `freellmapi -> groq -> openai`;
- disabled providers never appear as candidates and runtime disablement drops a provider immediately;
- reason strings never contain credential material;
- no real network I/O is performed by these tests.

No duplicate side effects: paid x402 requests are not retried (`x402-paid-request-no-retry.test.ts`),
and the failover path only re-issues inference requests, which are non-financial in this posture.

## 5. Observability (B-6)

- `src/__tests__/security/log-redaction.test.ts` (5 tests): credential-shaped values never reach logs.
- `src/__tests__/security/phase16-audit-visibility.test.ts` (10 tests): the audit trail is readable
  and reports its own integrity.
- The dashboard reports the source and age of every value, including the staleness of
  `reports/health-latest.json` (14087 minutes at the last observation). Staleness is reported, not
  silently repaired.
- Failure messages in dashboard responses are generic ("internal error") and carry no stack trace or
  internal path (`dashboard/server/index.ts`).

## 6. Remaining reliability limitations

1. No live execution of the heartbeat daemon or scheduler was performed, so their long-running
   behaviour is covered by tests and code inspection, not by a production observation.
2. The guardian's persisted health file is stale until `HEALTH_CHECK.bat` runs; the dashboard says so.
3. Dashboard health is not agent health; the dashboard states this explicitly and the agent state is
   `UNKNOWN — never started`.
