# Database and Migration Readiness

- Date: 2026-11-10
- Live database: `runtime/home/.automaton/state.db`
- Live schema version: 11
- Live SHA-256: `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`
- Integrity: `ok`
- Size: 512000 bytes; mtime `2026-10-31T10:25:59.744Z` (unchanged by this mission)
- Rows in `turns`: 0
- Table count: 38 including `sqlite_sequence` (37 application tables)

## 1. Production state (B-1, B-7)

The production database was opened read-only for inspection and was never migrated, modified or
replaced. The before/after hashes are identical. A read-only probe also confirmed that opening it
does not change its bytes or mtime.

Read-only inventory (`runtime/tmp/b7-inventory.json`):

- 37 application tables, 39 indexes, 0 triggers
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: 0 violations
- All row-bearing tables are empty except `schema_version`, which records the latest applied
  migration index (`10` in the V11 file).

Compared with the V14 DDL, six tables are absent from the live database, as expected for V11:
`security_events`, `security_incidents`, `security_seals`, `treasury_authorizations`,
`repair_approvals`, `repair_approval_events`. No unexpected table exists.

## 2. Migration package verified on disposable copies (B-1)

Harness: `runtime/tmp/b1-migration-package.mjs`; log: `runtime/tmp/b1-final.log`; result `B-1 RESULT: PASS`.

| Step | Observation |
|---|---|
| Live snapshot copied to an isolated HOME | Copy hash equal to live hash; version 11; integrity `ok` |
| Run `--migrate-schema` with no token | exit 1, message "Migration refused: CONWAY_MIGRATION_APPROVAL is not set"; database unchanged, still V11 |
| Run with a truthy but incorrect token (`yes`) | exit 1, message "…is not APPROVED; migration needs the exact value"; database unchanged |
| Run with `CONWAY_MIGRATION_APPROVAL=APPROVED` | exit 0; "Schema migrated from 11 to 14; 6 tables, 17 indexes, 8 triggers, 81 columns created."; `PRAGMA user_version` 14; integrity `ok`; 107 schema objects |
| Data preservation | 37 tables before and after; none missing; no changed row counts |
| Schema-version bookkeeping | `schema_version` row 10 -> 13; `PRAGMA user_version` 11 -> 14 (both deliberate) |
| Startup path (`createDatabase()` on an un-migrated copy) | auto-applies pending migrations, 11 -> 14, integrity `ok` |
| Startup against a schema that claims V14 but is incomplete | throws `MigrationVerificationError`: "schema version 14 is missing 1 object(s) its own DDL declares: index idx_repair_approvals_status" |
| Rollback | restore the pre-migration copy: hash equals live, version 11, integrity `ok` |
| Archived production backup `backups/2026-11-01_08-24-20` | 11 -> 14 via the same runner, integrity `ok`, 43 tables after |
| Live database after all work | same SHA-256, version 11 |

V14 objects created: `security_events`, `security_incidents`, `security_seals`,
`treasury_authorizations`, `repair_approvals`, `repair_approval_events`, plus indexes and
append-only triggers for the approval event log (`src/state/schema.ts:817-890`).

## 3. Gates and containment

- The CLI requires the exact value `APPROVED` in `CONWAY_MIGRATION_APPROVAL`; there is no default.
- Migrating the canonical HOME additionally requires `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED`.
- Path containment resolves junction/symlink redirection and rejects case/separator variants that
  escape the allowed home (covered by `migration-path-containment.test.ts` and
  `migration-path-redirection.test.ts`).
- The isolated-home check is what the verification harness used for every disposable run.
- Startup auto-migration is intentional, but it means the agent must not be launched against the
  live V11 database before an approved migration. This is recorded as an operational constraint, not
  a defect.

## 4. Rollback and recovery readiness

- Pre-migration copies are byte-identical to the live database, so rollback is a copy restore.
- The archived production backup also migrates cleanly, which proves the migration package is
  reproducible against a real historical snapshot, not only against a synthetic fixture.
- The backup/restore system never restores into the active database; see
  `B10_BACKUP_RESTORE_VERIFICATION.md`.

## 5. Production migration is not approved by this mission

The live database remains V11. Running the migration changes persistent state and is therefore an
operator decision. Exact command, preconditions, verification and rollback are in
`REMAINING_OPERATOR_APPROVALS.md`. Until then, the dashboard will continue to report three guardian
checks as `blocked` (no source), which is the semantically correct reading of a V11 database.
