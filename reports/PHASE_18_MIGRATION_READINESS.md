# Phase 18 — Database Migration Readiness Report

Scope: V12 and V13 against the live database at
`<repo-root>\runtime\home\.automaton\state.db`.
Measured 2026-11-01T11:35Z–11:53Z. **No migration was executed; no write handle was opened on the
live database.**

---

## 1. State of the two versions

| | Value | Evidence |
|---|---|---|
| Live schema version | **11** | `SELECT MAX(version) FROM schema_version` over a read-only handle |
| Code expects | **13** | [src/state/schema.ts:8](file:///<repo-root>/src/state/schema.ts#L8) `export const SCHEMA_VERSION = 13;` |
| Migration history rows | 2,3,4,5,6,7,8,9,10,11 — **no row for 1**, none for 12/13 | `SELECT * FROM schema_version`; all `applied_at = 2026-10-31 10:25:59` |
| `PRAGMA user_version` | **0** — unused by this project | versioning lives in the `schema_version` table only |
| Physical integrity | `integrity_check` = `ok`, `foreign_key_check` = `[]`, `journal_mode` = `wal` | read-only pragmas |
| Size / mtime | 512 000 B / `2026-10-31T10:25:59.744Z`, unchanged since before Phase 17 | `fs.statSync` |
| Sidecars | `state.db-wal` 0 B (mtime 2026-11-01T08:24Z), `state.db-shm` 32 768 B (mtime 2026-11-01T11:32Z) | the `-shm` timestamp is live: the console's read-only WAL connections touch it |
| Data volume | **0 rows in all 38 application tables**; only `schema_version` has rows | full table census |

Because the content is empty, **the data-loss risk of these migrations is effectively nil** — the
risk that matters is *structural*, not volumetric. That also means this is the cheapest moment
it will ever be to fix the schema.

## 2. What each migration does

### V12 — [src/state/schema.ts:688-752](file:///<repo-root>/src/state/schema.ts#L688)

`treasury_authorizations` (idempotency-keyed financial decision ledger, `decision` and `status` both
`CHECK`-constrained) + 3 indexes + `BEFORE DELETE` trigger; `security_events` (hash chain with
`sequence INTEGER NOT NULL UNIQUE`, `prev_hash`, `hash`) + 3 indexes + `BEFORE UPDATE` and
`BEFORE DELETE` triggers.

### V13 — [src/state/schema.ts:754-812](file:///<repo-root>/src/state/schema.ts#L754)

`security_incidents` (severity/status `CHECK`-constrained, partial unique index
`idx_incidents_dedupe ON (incident_type, source_sequence) WHERE source_sequence IS NOT NULL`) + 3
indexes + `BEFORE DELETE` trigger; `security_seals` (`sequence UNIQUE`, `head_hash`) + index +
`BEFORE UPDATE`/`BEFORE DELETE` triggers.

### Compatibility assessment

**Additive and backward-compatible.** Every statement is `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`.
There is **no `ALTER`, no `DROP`, no `UPDATE`, no backfill and no rewrite** in either migration, and
they touch no existing table. Existing code that does not reference the four tables is unaffected.
The new tables are append-only by trigger, which cannot break an existing writer because no existing
writer targets them.

**Ordering and dependency.** V12 before V13 is the correct order and the runner enforces it
(the list is literal and ascending, [database.ts:577-638](file:///<repo-root>/src/state/database.ts#L577),
and `if (currentVersion < m.version)` at `:641` applies every pending version in sequence).
V13 does **not** hard-depend on V12 — there is no foreign key — but `security_incidents.source_sequence`
references `security_events.sequence` logically, so applying V13 without V12 would create an incident
table whose dedupe column can never be populated. They should always be applied together, which is
what the runner does.

**Rollback: there is none.** `grep` over `src/state/*.ts` for `ROLLBACK`, `downMigration`,
`MIGRATION_V*_DOWN` and `DROP TABLE` returns **nothing**. The migrations are one-way. Rollback is
therefore a **file-restore operation**, not a schema operation: restore `state.db` from a verified
backup. Two consequences worth stating plainly:

1. The append-only triggers make the new tables non-shrinkable by design — if a bad row is ever
   written, it cannot be deleted, only superseded. That is the intent, but it removes "delete the
   bad record" from the recovery options.
2. Because rollback is restore-based, **a backup must be taken immediately before applying, and it
   must be verified after taking it** — not assumed. `BACKUP_CONWAY.bat` exists; its output should be
   re-hashed against its manifest before the migration is attempted.

## 3. How they would be applied — and the trap in that

`applyMigrations` is called only from `createDatabase`, i.e. from a **read-write** open
([database.ts:101-118](file:///<repo-root>/src/state/database.ts#L101)). The
dashboard deliberately never imports that module — enforced by import in
[dashboard/tests/danger-imports.test.ts](file:///<repo-root>/dashboard/tests/danger-imports.test.ts),
and its own source comment names the reason:
[src/index.ts `--status` "opens a write handle and migrates"](file:///<repo-root>/dashboard/server/sources.ts#L39).

### F-18-01 — `--status` migrates, and is not activation-gated

[src/index.ts:154-157](file:///<repo-root>/src/index.ts#L154) dispatches
`--status` to `showStatus()`, which at
[:199](file:///<repo-root>/src/index.ts#L199) calls `createDatabase(dbPath)`.
`requireActivation()` is applied only at `:121` (`--init`), `:143` (`--provision`) and `:160`
(`--setup`). **A command whose name means "just tell me the state" performs an irreversible schema
change as a side effect, with no approval gate.**

Mitigating facts, verified rather than assumed:
- `requireConwayHome()` is called at [src/index.ts:87](file:///<repo-root>/src/index.ts#L87) —
  the *first* statement of `main()`, before any dispatch — so `--status` **is** HOME-guarded and
  cannot migrate a stray tree. (`CONWAY_HOME_MODE=isolated` is a documented opt-out for harnesses.)
- It writes only schema; `showStatus()` issues reads afterwards.
- The `integrity_check` at [database.ts:95-98](file:///<repo-root>/src/state/database.ts#L95)
  runs before any DDL and throws on failure, so a corrupt file is not migrated.

Still: **the practical route to applying V12/V13 is a command that looks read-only and is not
approval-gated.** Anyone who runs it to "check on things" will permanently change the schema. That
is the correct thing to have happening *deliberately* and the wrong thing to have happening by
accident.

## 4. F-18-02 — a failed migration can be recorded as applied

[database.ts:640-647](file:///<repo-root>/src/state/database.ts#L640) wraps each
migration in `db.transaction(() => { m.apply(); INSERT INTO schema_version })`. Transactional
version stamping is the right pattern: if `apply()` throws, the insert rolls back with it and the
next boot retries.

**V11 is the one exception, and it defeats the pattern.**
[database.ts:625-629](file:///<repo-root>/src/state/database.ts#L625):

```ts
{ version: 11,
  apply: () => { try { db.exec(MIGRATION_V11); } catch { /* column may already exist */ } } },
```

The catch swallows **every** error, not just `duplicate column name`, and then `:644` stamps version
11 anyway. The intent is legitimate — `MIGRATION_V11` is a bare
`ALTER TABLE children ADD COLUMN chain_type …` ([schema.ts:655-659](file:///<repo-root>/src/state/schema.ts#L655)),
which throws on a database that already has the column — but the implementation is untyped. A lock
violation, a disk error or a typo in the DDL would be recorded as a successful migration and
**never retried**, leaving `schema_version` asserting a schema the file does not have.

Two calibrations, so this is not over- or under-stated:

- **It is not currently lying.** `PRAGMA table_info(children)` returns `chain_type` as the 13th
  column, so V11's effect genuinely exists in the live file. The defect is **latent**, not active.
- **No test covers it.** `grep -rl "applyMigrations\|MIGRATION_V11" src/__tests__ dashboard/tests`
  returns **nothing**. Nothing in 2 057 passing tests would notice the failure mode.

Related, same family: `MIGRATION_V10` uses `CREATE TABLE knowledge_store` **without** `IF NOT EXISTS`
([schema.ts:665](file:///<repo-root>/src/state/schema.ts#L665)), so if a
`schema_version` row were ever lost while the table remained, the re-run would throw and
`createDatabase` would fail hard rather than converge.

And the post-hoc stamp at [database.ts:110-118](file:///<repo-root>/src/state/database.ts#L110)
reads `MAX(version)` **after** `applyMigrations` (called at `:107`) and then issues
`INSERT OR REPLACE … VALUES (13, datetime('now'))` whenever that maximum is below 13. No rows are
lost (one row per integer PK), but it will assert version 13 without checking that any of its tables
exist, and `OR REPLACE` discards the original `applied_at` of the row it overwrites. Both are the
same design error: **the version row is treated as the source of truth instead of the schema.**

### Readiness conclusion

| Criterion | Verdict |
|---|---|
| DDL correctness | **READY** — additive, idempotent (`IF NOT EXISTS` throughout), `CHECK`-constrained |
| Ordering / dependencies | **READY** — ascending, per-migration transaction, V13 logically but not physically dependent on V12 |
| Backward compatibility | **READY** — no existing table touched |
| Data-loss risk | **READY** — zero application rows in the live file |
| Rollback | **NOT READY** — no down-migration exists; rollback = verified file restore, and no backup has been re-verified since `2026-11-01T08:24:49Z` |
| Migration runner trustworthiness | **NOT READY** — F-18-02 (swallow-then-stamp, untested) should be fixed *before* the runner is used on the live file, since V12/V13 are its first real use here |
| Approval gating of the apply path | **NOT READY** — F-18-01 (`--status` migrates ungated) |
| Post-apply verification tooling | **READY** — the console's read-only `dbInventory()` already reports `liveVersion`, `codeVersion`, table list and integrity, so success is observable without a second write |

**Overall: MIGRATIONS ARE SAFE TO APPLY, BUT NOT YET VIA THE CURRENT PATH.** The blocking pair is
F-18-02 then F-18-01: repair the runner's error handling and add the missing test first (a code
change, no live data involved), then apply deliberately with a verified backup in hand, then verify
with the read-only console.

## 5. Evidence that applying them actually fixes the observed failures

The CRITICAL and the two NOT VERIFIED health rows are consequences of the absent tables, so they are
predictably cleared by the migration. The chain is:

`security_events` absent → `verifySecurityChain()` throws → `checkAuditChain` catch returns
`status:"fail"` ([health-guardian.ts:172-179](file:///<repo-root>/src/reliability/health-guardian.ts#L172))
→ `report.overall = "critical"` → heartbeat `health_guardian` returns `shouldWake:true`
([tasks.ts:735-742](file:///<repo-root>/src/heartbeat/tasks.ts#L735)).

Measured live in this audit, health panel raw row: `audit_chain | fail | no such table:
security_events`, alongside `schema_version | warn | schema 11 is older than 13; migrations run on
next open`. After a successful V12+V13 both rows change, `getTreasuryGuard()` stops throwing, and
the four `NOT VERIFIED` cells on the Security and Treasury panels become real readings.

**This must not be asserted as a prediction that has been tested.** It is an inference from the code
paths above; the confirmation is to be captured after the approved apply, at which point
`runHealthChecks` should report `audit_chain pass` and the console's reclassified headline should
become `ok`. Until then it is a hypothesis, and F-18-04 remains open.

## 6. The procedure an operator should run (not executed here)

Recorded so the approval decision is informed. Nothing in this section was performed.

1. `BACKUP_CONWAY.bat`, then re-hash the new archive against its own manifest and confirm every
   entry matches before relying on it as the rollback.
2. Confirm the target: `HOME` must be `<repo-root>\runtime\home` in the same
   process that opens the database — not exported in a shell and hoped for.
3. Open the database once through the migration path, with activation **still false** — the schema
   apply does not require `CONWAY_ACTIVATION` and must not be used as a reason to set it.
4. Verify, read-only: four tables present; **all seven append-only triggers present**; `integrity_check`
   = `ok`; `SELECT MAX(version) FROM schema_version` = 13; `children.chain_type` still present.
5. Check that `schema_version` row 13's `applied_at` is the real apply time — if it was written by
   the `INSERT OR REPLACE` fallback rather than by the transactional loop, that is F-18-02 firing
   and the apply must be re-examined rather than trusted.
6. Re-run `HEALTH_CHECK.bat` and read the console Health Monitor; expect `audit_chain pass` and
   `schema_version pass`.
7. Only then consider scheduling `health_guardian` / `security_monitor`, and observe one cycle
   before trusting `shouldWake`.

Steps 1–7 all modify live state or configuration and are therefore on the approval list.
