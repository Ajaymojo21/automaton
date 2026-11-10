# Pre-Activation Readiness Audit — Reliability Audit

## 1. Health Guardian (System Doctor)

- 8 checks: emergency_stop, database_integrity, schema_version, audit_chain, treasury_reservations,
  scheduler_leases, disk_space, wallet_storage.
- Read-only: never mutates state.
- Persisted report: `dashboard/state/health-*.json`.
- Dashboard reclassifies absent sources as `NOT VERIFIED` rather than `fail` or `pass`.
- Report staleness is reported, not hidden (12,942 min old at observation).

## 2. Autonomous Mechanic

- `classifyRepair()` is pure: returns `automatic`, `requires_approval`, or `forbidden`.
- `runMechanic()` returns immediately with `skippedReason` when `selfHealingEnabled === false`.
- 6 destructive repair identities all classified `forbidden`.
- **No approval surface exists** for `requires_approval` repairs — they can only sit unexecuted.
- No post-repair verification has ever run.
- No escalation/paging/notification channel exists.

## 3. Heartbeat & scheduler

- 6 declared, 3 enabled in YAML, 0 in DB. `syncHeartbeatToDb()` has never run.
- 0 scheduled, 0 executed, 0 history, 0 wake events.
- Heartbeat daemon is only created inside `run()` (gated by activation).
- No background process starts from a read-only command.

## 4. Verdict

Monitoring is operational and honest. Self-healing is disabled by policy and proven to refuse.
The gap is the missing approval surface and post-repair verification loop — these are design
features that do not exist yet, not bugs.
