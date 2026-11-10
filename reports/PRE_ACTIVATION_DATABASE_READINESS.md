# Pre-Activation Readiness Audit — Database Readiness

## 1. Current state

| Field | Value |
|---|---|
| Live schema version | **V11** (10 rows in `schema_version`, V2–V11) |
| Code schema version | **V13** (`SCHEMA_VERSION = 13`) |
| Journal mode | WAL |
| Integrity check | `ok` |
| Table count | 38 |
| Populated tables | 1 (`schema_version`) |
| Empty tables | 37 |
| DB size | 512,000 B |
| DB SHA-256 | `2A8AEB3494F1507A352F591C5EF40B7320813E18796B077B01448582619EFBBA` |

## 2. V12 migration

Creates: `treasury_authorizations`, `security_events`.

- `treasury_authorizations`: append-only (trigger prevents DELETE), stores authorization rows with
  decision/status/reason, idempotency key (UNIQUE), indexes on created_ms, (operation,status),
  (child_id,status), (decision,status).
- `security_events`: hash-chained audit log (sequence, timestamp, severity, category, event_type,
  actor, details, prev_hash, hash). Append-only (triggers prevent UPDATE and DELETE). Indexes on
  timestamp, (severity,timestamp), (category,timestamp).

## 3. V13 migration

Creates: `security_incidents`, `security_seals`.

- `security_incidents`: incident tracking with severity CHECK, status CHECK (open/acknowledged/resolved),
  dedup unique index on (incident_type, source_sequence). Append-only (trigger prevents DELETE).
- `security_seals`: hash-chain seal records. Append-only (triggers prevent UPDATE and DELETE).

## 4. Migration safety

| Property | Evidence |
|---|---|
| Gated by env var | `CONWAY_MIGRATION_APPROVAL=APPROVED` (exact value, not truthy) |
| Canonical override | `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED` required for live home |
| Containment check | `isPathInside()` — strict separator, case-insensitive on Windows |
| Path resolution | `resolveExistingAncestor()` — refuses unresolvable paths, junctions |
| Integrity preflight | Read-only `integrity_check` before any DDL; refuses if not `ok` |
| No DB creation | Refuses if file does not exist |
| Report written | JSON report per run, with before/after object counts and created objects |
| Idempotency | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ON CONFLICT DO NOTHING` for schema_version rows |
| Transaction | `applyMigrations` wraps in transaction (from database.ts) |
| Rollback | **Not supported.** No down-migration exists. The report records before/after for manual recovery. |

## 5. Disposable-copy test

- Copied `state.db` to an isolated home.
- Set `CONWAY_HOME_MODE=isolated`, `CONWAY_MIGRATION_APPROVAL=APPROVED`.
- Ran `--migrate-schema`.
- Result: **V11 → V13**, 4 tables, 12 indexes, 6 triggers, 50 columns created. Integrity `ok`.
- Production DB hash unchanged (`2A8AEB34…EFBBA`).
- Migration report written and then removed (test artifact).

## 6. Backup/restore

- 10 backup entries, 2 DB backups exist.
- `verifyBackupsAction` verifies manifest integrity.
- `planRestore` requires a verified manifest; bogus plan refused with 400.
- `executeConfirmedRestore` restores verified bytes only.
- **Not tested live** — only the bogus-plan refusal was exercised. Structural inspection only.

## 7. Verdict

Migration code is well-gated, tested on a disposable copy (V11→V13, integrity ok), and the production
database was not touched. **Production migration NOT executed.** Rollback is not supported — the
operator must take a backup before migrating. Recommended: take a backup, run `--migrate-schema` with
both env vars, verify the audit chain passes, then re-run the health guardian.
