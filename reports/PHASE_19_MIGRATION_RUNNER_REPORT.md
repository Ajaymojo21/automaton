# Phase 19 — Migration Runner Report (A2 + A3 runner half)

Scope executed: **A2 (migration runner hardening, approved, scope D-1 = A2-full)** and the
**`--migrate-schema` half of A3** (approved). A4–A8 are **not approved** and were not implemented.
**A9 (applying V12/V13 to the live database) is outside Phase 19 and was not performed.**

All times UTC (`Z`). Local = UTC+05:30. Every number below was captured by a command that ran in
Phase 19; logs are in `runtime/tmp/` (gitignored) and named in each row. Per mandate §12, nothing here
is reported as passed unless it executed and its output was captured.

---

## 1. What the runner was, and what it is now

| Behaviour | Pre-A2 | Post-A2 | Evidence |
|---|---|---|---|
| ALTER failure handling | `catch { /* swallow */ }` at seven sites (V4 ×5, V9, V11) — a lock, disk, syntax or constraint error was discarded and the version still recorded | one helper, `applyAlterToleratingExistingColumn` ([src/state/database.ts:781](../src/state/database.ts#L781)); tolerance requires `error.name === "SqliteError"` **and** `/^duplicate column name: /i` **and** `pragma_table_info` confirming the column really exists | `isDuplicateColumnError` [:763](../src/state/database.ts#L763), `hasColumn` [:769](../src/state/database.ts#L769); tests `A2 · tolerance is confirmed against the schema, not the error text` |
| Which errors may be swallowed | any | none but duplicate-column; everything else rethrows and rolls back the enclosing transaction | test `§4.E.4: a lock-shaped failure propagates out of the tolerance helper`, `rethrows a genuine failure instead of swallowing it` |
| Version recording | blind `INSERT OR REPLACE … VALUES (13, datetime('now'))` derived from `MAX(version)` | `assertVersionObjectsExist` before `recordSchemaVersion`; `INSERT … ON CONFLICT(version) DO NOTHING` so a genuine `applied_at` is never overwritten | [:825](../src/state/database.ts#L825), [:863](../src/state/database.ts#L863); tests `the runner no longer stamps schema_version from MAX(version)`, `records 12 and 13 as two rows written by their own migrations` |
| Gap in the plan | a version with no migration could still be stamped | `assertMigrationPlanIsComplete()` fails at startup unless the plan covers 2..`SCHEMA_VERSION` with no gap | [:848](../src/state/database.ts#L848); test `the migration plan covers every version from 2 to SCHEMA_VERSION with no gap` |
| Per-version atomicity | DDL + version row, verification absent | DDL + verification + version row inside **one transaction per version** — a migration that applied DDL but fails verification records nothing | [:886](../src/state/database.ts#L886); tests `§4.E.4/5: a non-duplicate error inside V12 propagates and writes no version row`, `§4.E.6: once the blocker is gone the next attempt converges` |
| Idempotency | `CREATE TABLE knowledge_store` (V10) clashed on re-run | `CREATE TABLE IF NOT EXISTS knowledge_store` ([src/state/schema.ts:665](../src/state/schema.ts#L665)); every step's objects are created conditionally | tests `F-18-11: re-running V10 onto a database that already has knowledge_store converges`, `every migration creates its objects conditionally, so a re-run cannot clash` |
| Startup posture | open succeeded on a database claiming a version it did not have | `assertSchemaIsCurrent` fails closed when the recorded version ≠ declared version or any step's declared objects are missing | [:899](../src/state/database.ts#L899); tests `F-18-02: refuses a database that claims the current version without its objects`, both `§4.E.8` cases |
| Testability | `applyMigrations` was module-private; `grep -rl "applyMigrations\|MIGRATION_V11" src/__tests__ dashboard/tests` → nothing (F-18-02: **no test could reach this code**) | exported, plus `MIGRATION_VERSIONS` [:738](../src/state/database.ts#L738) and `declaredObjects` in schema.ts [:829](../src/state/schema.ts#L829) | test `exposes applyMigrations — F-18-02: no test could reach this code before now`; F-18-02 closed |

The expected-object manifest is **derived from the DDL itself**
(`declaredObjects()` [src/state/schema.ts:829](../src/state/schema.ts#L829)) rather than hand-maintained,
so a new migration is verified by the objects it actually declares. F-18-11's V10 fix and the
manifest together mean a re-run converges instead of clashing.

## 2. The corrected acceptance criterion (F-19-01), now pinned by name

Phase 18 asserted "seven triggers"; measured against the DDL, V12+V13 declare **6 triggers, 4 tables,
12 indexes**. The tests therefore assert **names, not counts**, in both directions:

| Set | Names |
|---|---|
| V12/V13 tables (4) | `treasury_authorizations`, `security_events`, `security_incidents`, `security_seals` |
| V12/V13 triggers (6) | `treasury_authorizations_no_delete`, `security_events_no_update`, `security_events_no_delete`, `security_incidents_no_delete`, `security_seals_no_update`, `security_seals_no_delete` |
| V12/V13 indexes (12) | `idx_treasury_created`, `idx_treasury_status`, `idx_treasury_child`, `idx_treasury_decision`, `idx_security_events_time`, `idx_security_events_severity`, `idx_security_events_category`, `idx_incidents_status`, `idx_incidents_type`, `idx_incidents_created`, `idx_incidents_dedupe` (**UNIQUE**), `idx_seals_sequence` |

`idx_incidents_dedupe` is a `CREATE UNIQUE INDEX`. A first grep for `CREATE INDEX` missed it and made
the total look like 11; the derived manifest finds it. This session also caught the stale test title
that still said "eleven V12/V13 indexes" while asserting all twelve by name — the title is corrected
to "twelve"; the assertion was always right, and the suite count is unchanged at 40
(`migration-runner.test.ts` `00b1dac4…`, superseding `4ddd0ccf…`).

Test `pins V12+V13 by name in both directions — the criterion is names, not counts` asserts the union
of the derived manifest equals the sorted name list exactly, so a future object that appears in the DDL
but not in the expected list — or vice versa — fails loudly.

## 3. `--migrate-schema`: migration is now an explicit, gated command

New module [src/state/schema-migration.ts](../src/state/schema-migration.ts) (entry
`runSchemaMigration` [:260](../src/state/schema-migration.ts#L260) — was `:193` before the F-19-08 and
F-19-09 gate fixes landed in the same approved item), CLI dispatch
[src/index.ts:165](../src/index.ts#L165). Refusal order, each stage proven by a test and each refusal
writing **no** report:

| Stage | Refuses when | Exit |
|---|---|---|
| `gate` | `CONWAY_MIGRATION_APPROVAL` absent, whitespace-only, or not exactly `APPROVED` | non-zero |
| `home` | `inspectConwayHome` does not pass for the resolved mode/env | non-zero |
| `target` (resolve) | the operator-supplied path cannot be resolved to an existing location — `resolveExistingAncestor` returns `null` | 1 |
| `target` (canonical) | the **resolved** path is inside the canonical runtime home without `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED` | 1 |
| `target` (containment) | the **resolved** path is not inside the verified state directory — including the case where the typed path *is* inside but a link or junction moves it; **or** the resolved path *is* the state directory itself; **or** the file does not exist | 1 |
| `integrity` | read-only `integrity_check` ≠ `ok`, or the read-only open itself fails | non-zero |
| `migration` | any DDL/verification error while applying steps | 1, and a report **is** written with `error.stage = "migration"` |

The three `target` rows were added after this section was first written: F-19-08 made containment
case- and separator-correct, and F-19-09 made it resolve reparse points first. Both are recorded with
RED/GREEN evidence in `PHASE_19_SECURITY_VERIFICATION.md` §2. The write now opens the **resolved**
path and `report.dbPath` names it, so the audit trail identifies the file that was actually written
rather than the spelling that was typed.

Only after every refusal above clears does the runner open the target read-write. The write is minimal on
purpose: `busy_timeout` and `foreign_keys` pragmas only — **no `journal_mode` write**, because the
preflight already proved the file is a WAL database and setting it again would be an unrequested
mutation.

The gate is a schema-only authority. It never reads or writes the agent-activation variable, the wallet
variable, or any `security.*` config flag; module-level and CLI-level guards assert that in
`readonly-status-migration.test.ts` (describe `A3 — the --migrate-schema approval gate`, 10 tests) —
including that the exact-value comparison rejects `approved`, `APPROVED `, `YES` and empty strings, and
that the canonical override is **not** accepted at a value other than `APPROVED`.

Reports go to `reports/migration-<timestamp>.json` and contain: `command`, `startedAt`, `finishedAt`,
`durationMs`, `dbPath`, `homeMode`, `targetVersion`, `integrity`, `approval{environmentVariable,
granted, canonicalOverride}`, `before{version, objectCount}`, `after{version, objectCount}`,
`created{tables, indexes, triggers, views, columns}`, `result`, optional `error{stage, message}`.
No token values, no row data, no secrets — `approval.granted` is a boolean and
`approval.environmentVariable` is the **name** of the variable.

## 4. Executed evidence

| # | Check | Command | Result |
|---|---|---|---|
| 1 | A2 RED | `vitest run src/__tests__/migration-runner.test.ts` before the runner change | **37 failed / 1 passed (38)**, 1 file failed — `runtime/tmp/a2-red.log` |
| 2 | A2 GREEN | same target after the change | **39 passed (39)** — `a2-green.log`; **40 passed (40)** after the eighth test was added — `a2-green2.log` |
| 3 | A2 §4.E coverage | tests named `§4.E.1` … `§4.E.8` | all eight mandated cases present and executed, incl. E.3 corrected to the six named triggers |
| 4 | A2 typecheck / build | `tsc --noEmit`, `tsc` | exit **0** both, 0-byte logs (`a2-typecheck.log`, `a2-build.log`) |
| 5 | A2 full root suite | `vitest run --reporter=basic` | **83 files / 2 096 tests / 0 failed** — `a2-fullsuite.log` (recorded while the A2 file held 39 tests) |
| 6 | A2 live-database non-impact | read-only schema probe of `state.db` | still **V11**, 38 tables, `integrity_check ok`, four V12/V13 tables absent |
| 7 | A3 combined focused run | `vitest run src/__tests__/migration-runner.test.ts src/__tests__/readonly-status-migration.test.ts` | **2 files / 69 tests passed / 0 failed**, exit 0 — `p19-a3-final-focused.log` (started 15:37:37Z), re-run after the test-title fix — `p19-a3-focused2.log` (started 16:00:41Z) |
| 8 | Migration of a V11 fixture | `buildV11Fixture` → `applyMigrations` | version rows `[2…13]`, all named objects present, rows 12 and 13 written by their own migrations with non-null `applied_at` |
| 9 | Runner refuses a damaged schema | drop one trigger / remove a required column from a fixture | throws `MigrationVerificationError`, version does **not** advance (`§4.E.8` ×2) |
| 10 | **F-19-08** containment case-defect RED → GREEN | `vitest run` on the containment file, then the three focused files | **8 failed \| 1 passed (9)** → **3 files / 79 passed**; `tsc --noEmit` and `tsc` exit 0; CLI 16:11:21Z demands `CONWAY_MIGRATION_ALLOW_CANONICAL` for a re-cased live path |
| 11 | **F-19-09** junction-redirection RED → GREEN | `vitest run` on the redirection file, then the four migration files | **6 failed \| 1 passed (7)** — pre-fix the gate returned `ok: true` and migrated a V11 database outside the state directory → **4 files / 86 passed**; CLI escape **exit 1** (victim byte-identical) with **exit 0** control at 16:24:07Z / 16:24:45Z |
| 12 | Final full root regression | `vitest run` | **86 files / 2 143 tests / 0 failed**, exit 0, 88.90 s (`p19-jx-final-fullsuite.log`, 21:55:34 local) |

## 5. Live-state proof for this report

Measured again while writing this file (`runtime/tmp/p19-a3-final-invariants.log`, completed 15:36:22Z):

- `automaton.json` `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` — unchanged
  against the Phase 18 and Phase 19 baselines.
- `state.db` `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`, 512 000 B,
  mtime `2026-10-31T10:25:59.744Z` — **identical before and after every probe in this phase**;
  schema still **11**; the four V12/V13 tables still absent; `integrity_check ok`.
- `reports/migration-*.json`: **0**. No migration has ever been run against the canonical database.
  One report *was* written here by the F-19-09 CLI **control** run — that run had no `reportDir`
  override (the CLI exposes none, F-19-12), so it defaulted to `reports/`; the file
  `migration-2026-11-01T16-24-45-361Z.json` described a sandbox database, not the live one, and was
  moved to `runtime/tmp/p19-a3-jx-e2e-report.json` so the audit directory holds only real events.
- `CONWAY_ACTIVATION` unset, `CONWAY_MIGRATION_APPROVAL` unset in the measuring shell.
- Re-measured at 16:25Z on the rebuilt bundle, after every run in §4 rows 10–12: the same two hashes,
  the same size and mtime, schema still **11**, four V12/V13 tables still absent,
  `2a8aeb34…` **unchanged** (`runtime/tmp/p19-jx-final-fullsuite.log` run included).

**Consequence for operators:** because `--status` no longer migrates (A3) and the explicit command
refuses the canonical path without a second, separate token (A9), the live database cannot advance to
V12/V13 by accident or by habit. It will stay at V11 until a human approves A9 and runs
`CONWAY_MIGRATION_APPROVAL=APPROVED CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED`. That is the intended
posture, not an oversight.

## 6. Known gaps in the runner, stated plainly

- **F-19-06 — verification is by object name, not object shape.** `assertVersionObjectsExist` confirms
  that a table/index/trigger *exists under the declared name* and that ALTER-declared *columns* exist;
  it does not compare column lists, types, index column sets, or trigger bodies. A migration that
  created `security_events` with the wrong columns would pass. Closing this needs a column-level
  manifest (`pragma_table_info` per table, `EXPLAIN QUERY PLAN` or `sqlite_stat1`-free definition
  comparison), which is a new change and would need its own approval.
- **The A2 diff cannot be isolated with git.** A7 (baseline commit) is **not approved**, so `git diff`
  against HEAD mixes Phase 16–19 work, and the pre-A2 content hash of `src/state/schema.ts` was never
  recorded. A2's one-line schema.ts change is evidenced by content
  (`CREATE TABLE IF NOT EXISTS knowledge_store` at :665) plus tests 8/9 in §4, not by a before-hash.
  Consequently the TDD workflow's git checkpoint commits could not be created this phase; the RED/GREEN
  evidence lives in this file and in `PHASE_19_TEST_RESULTS.md` instead.
- **No subprocess-level E2E test in the suite.** The gate is tested in-process with injected env and
  `reportDir`; the CLI wiring is guarded by source-level assertions plus the manual E2E recorded in
  `PHASE_19_TEST_RESULTS.md`. A vitest case that spawns `dist/index.js` would require a fresh build per
  run; it was not added rather than being added as a conditionally-skipped test (mandate §12 forbids
  converting a gap into a skip).
