# B-8 Repair Approval Persistence

- Date: 2026-11-10
- Implementation: `src/reliability/repair-approval.ts`
- Storage: schema V14 tables `repair_approvals` and `repair_approval_events`
  (`src/state/schema.ts:824-890`)
- Tests: `src/__tests__/reliability/repair-approval.test.ts` (16) and
  `src/__tests__/reliability/repair-approval-persistence.test.ts` (10), all passing.

## 1. Boundary statement

An approval moves a repair proposal to `ready_for_execution`. It does not execute the repair and
never marks it `completed`. Execution remains gated by `security.selfHealingEnabled` and by the
mechanic's own classification (`src/reliability/mechanic.ts:78,143`). In this deployment
self-healing is disabled, so an approved proposal cannot run.

## 2. Mission properties, mapped to evidence

| # | Required property | How it is implemented | Test evidence |
|---|---|---|---|
| 1 | Database-backed persistence | SQLite tables created by schema V14; store constructed with a `better-sqlite3` handle persists rows; without a handle it stays in memory for unit tests only. | `survives a restart` |
| 2 | Survives restart | A new store over a reopened database sees the same proposal, status and revision. | `survives a restart`; `persists an approval as ready_for_execution, never completed` |
| 3 | Atomic transitions | Every transition is a single `UPDATE ... WHERE id = ? AND status = ? AND revision = ?`; the in-memory store applies the same CAS. `SqlitePersistence.transaction()` wraps multi-row writes. | `settles a race exactly once across two handles`; `fails a stale revision instead of overwriting a newer decision` |
| 4 | Immutable audit history | `repair_approval_events` is append-only, enforced by `BEFORE UPDATE` / `BEFORE DELETE` triggers that raise `repair_approval_events is append-only`; each row carries `prev_hash` and `hash`. | `keeps an append-only, hash-chained history`; `writes decisions into the tamper-evident security chain` |
| 5 | Approval identity and authorization | `approve(id, identity, reason)` requires a non-empty identity and reason; the dashboard route additionally requires the operator session cookie and mutation headers. | `requires identity for approval`; `requires reason for approval`; live HTTP tests in the dashboard suite |
| 6 | Request expiry | `expires_ms` from a TTL at creation; reads and decisions lazily mark past-TTL proposals `expired`; approval after expiry is refused. | `expires proposals past TTL`; `persists expiry and refuses a late approval` |
| 7 | Revision conflict protection | Callers may pass `expectedRevision`; a mismatch returns `revision conflict: expected X, current Y` instead of overwriting. | `fails a stale revision instead of overwriting a newer decision` |
| 8 | Duplicate prevention | Partial unique index `idx_repair_approvals_live` on `(finding_id, action_hash)` where the status is live; a second live proposal for the same finding and action is refused. | `refuses a duplicate live proposal for the same finding and action`; `prevents duplicate approval`; `prevents duplicate rejection` |
| 9 | Replay protection | `actionHash` binds a decision to the exact reviewed action; replayed decisions are detected by `decision_key` and return the original outcome. | `action hash binds approval to exact action`; `replays an identical decision instead of applying it twice`; `rejects a reused idempotency key for a different proposal` |
| 10 | Idempotency | `idempotencyKey` stored as `decision_key` with a unique index; identical replay returns the stored outcome, a different proposal under the same key is rejected. | `replays an identical decision instead of applying it twice`; `rejects a reused idempotency key for a different proposal` |
| 11 | Approve/reject lifecycle | States: `detected -> diagnosis -> repair_proposed -> awaiting_approval -> approved/rejected/expired -> ready_for_execution -> verification -> completed/failed`. Approval and rejection are separate CAS transitions; completion requires `ready_for_execution`. | Lifecycle suite (16 tests) including `approves a pending proposal to ready_for_execution (not completed)`, `markCompleted requires ready_for_execution`, `markFailed works after approval` |
| 12 | Dashboard/API integration with persistent storage | `POST /api/action/repair-propose`, `GET /api/repair-approvals`, `GET /api/repair-approval/{id}`, `POST /api/repair-approval/{id}/approve|reject` (`dashboard/server/routes.ts:100-206`). The dashboard opens the store through `writableRepairApprovals`, so decisions persist to the same database the panel reads. | Dashboard HTTP contract tests; live 13-area browser run shows the Repair Approvals area |
| 13 | Error handling and recovery | Unknown id returns not found; expired proposal refuses approval; duplicate/replay produce structured refusals; the store rehydrates its idempotency index from the database on construction, so a restart cannot reuse a key. | `unknown proposal returns not found`; restart tests; `persists expiry and refuses a late approval` |
| 14 | Secure backup/restore compatibility | Approvals live in `state.db`, which the backup system snapshots with the SQLite online backup API; restore writes to an alternate path and never to the live database; wallet material is excluded by the shared predicate. No approval table is special-cased outside the database. | `phase16-backup-roundtrip.test.ts` (21 tests), including restore-to-alternate-path and manifest refusal tests |

## 3. Non-execution proof

- Approval does not call the mechanic. The transition only writes the proposal row and appends an
  event.
- `markCompleted` is a separate method that requires status `ready_for_execution` and a verification
  note; nothing calls it automatically.
- At runtime, the dashboard's mechanic panel reads `VERIFIED / NOT REACHABLE` because
  `security.selfHealingEnabled` is false.
- No repair execution endpoint exists; a probe of `POST /api/action/repair-execute` returned 404/405.

## 4. Operational consequences

- A V11 production database does not have these tables. The Repair Approvals panel and API are
  therefore only fully usable after an approved V14 migration. No proposal was written to the
  production database during this mission; the feature's persistence tests ran on disposable
  databases.
- The approval audit trail is inside the database, so it is captured by the same backup and
  tamper-evident security chain as the rest of the state.
