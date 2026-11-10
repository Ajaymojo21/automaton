# Phase 21 — B-1 Database Migration Readiness

## 1. Migration implementation

- `SCHEMA_VERSION = 13` (`src/state/schema.ts`).
- `MIGRATION_STEPS` array covers V2 through V13 (12 steps).
- V12: creates `treasury_authorizations` + `security_events` (append-only triggers).
- V13: creates `security_incidents` + `security_seals` (append-only triggers).
- `applyMigrations()` is idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- `assertSchemaIsCurrent()` verifies recorded version equals `SCHEMA_VERSION`.

## 2. Migration gating

- `CONWAY_MIGRATION_APPROVAL=APPROVED` (exact value, not truthy).
- `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED` additionally required for live home.
- Containment check (`isPathInside`) — strict separator, case-insensitive on Windows.
- Path resolution (`resolveExistingAncestor`) — refuses unresolvable paths.
- Integrity preflight — read-only `integrity_check`, refuses if not `ok`.
- No DB creation — refuses if file does not exist.
- No startup migration — `--status` uses `readStatusSnapshot` (read-only, no migration).

## 3. Disposable verification

- Copied `state.db` to isolated home.
- Ran `--migrate-schema` with both env vars.
- Result: V11 → V13, 4 tables, 12 indexes, 6 triggers, 50 columns. Integrity `ok`.
- Production DB hash unchanged: `2A8AEB34…EFBBA`.

## 4. Rollback

**Not supported.** No down-migration exists. The migration report records before/after object counts
for manual recovery. Operator must take a backup before migrating.

## 5. Acceptance

**READY FOR SEPARATE OPERATOR APPROVAL.** Both migrations inspected, disposable test passed,
production untouched. Operator must take a backup and set both env vars to execute.
