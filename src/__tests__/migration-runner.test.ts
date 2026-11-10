/**
 * Phase 19 A2 — Migration runner hardening tests (mandate §4.E).
 *
 * Closes F-18-02 (the runner could record a version it never verified), F-18-11
 * (V10 — and by the same defect V9 — were not idempotent) and F-19-02 (seven
 * unbounded try/catch sites that swallowed every error, not just duplicate-column).
 *
 * Fixtures are disposable databases in the OS temp directory; the live state.db
 * is never opened here. The V11 fixture was measured schema-identical to the live
 * V11 install (38 tables / 80 indexes / 0 triggers, identical sqlite_master name
 * sets in both directions, versions 2..11), so it exercises the same shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import * as database from "../state/database.js";
import { createDatabase } from "../state/database.js";
import {
  declaredObjects,
  MIGRATION_V3,
  MIGRATION_V4,
  MIGRATION_V5,
  MIGRATION_V6,
  MIGRATION_V7,
  MIGRATION_V8,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V11,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V14,
  SCHEMA_VERSION,
} from "../state/schema.js";

type Raw = BetterSqlite3.Database;

const V12_V13_TABLES = ["treasury_authorizations", "security_events", "security_incidents", "security_seals"];

const V14_TABLES = ["repair_approvals", "repair_approval_events"];
const V14_TRIGGERS = ["repair_approval_events_no_update", "repair_approval_events_no_delete"];
const V14_INDEXES = [
  "idx_repair_approvals_status",
  "idx_repair_approvals_finding",
  "idx_repair_approvals_live",
  "idx_repair_approvals_decision_key",
  "idx_repair_approval_events_proposal",
];

// Enumerated by name, never by count: F-19-01 corrected the Phase 18 "seven triggers" figure to six.
const V12_V13_TRIGGERS = [
  "treasury_authorizations_no_delete",
  "security_events_no_update",
  "security_events_no_delete",
  "security_incidents_no_delete",
  "security_seals_no_update",
  "security_seals_no_delete",
];

const V12_V13_INDEXES = [
  "idx_treasury_created",
  "idx_treasury_status",
  "idx_treasury_child",
  "idx_treasury_decision",
  "idx_security_events_time",
  "idx_security_events_severity",
  "idx_security_events_category",
  "idx_incidents_status",
  "idx_incidents_type",
  "idx_incidents_created",
  // CREATE UNIQUE INDEX — found only by the derived manifest, after a grep for
  // "CREATE INDEX" missed it and briefly made the expected total look like eleven.
  "idx_incidents_dedupe",
  "idx_seals_sequence",
];

const INBOX_V4_COLUMNS = ["to_address", "raw_content", "status", "retry_count", "max_retries"];

function exists(db: Raw, type: string, name: string): boolean {
  return !!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
}

function columnExists(db: Raw, table: string, column: string): boolean {
  return !!db.prepare("SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ?").get(table, column);
}

function versionRows(db: Raw): number[] {
  return db.prepare("SELECT version FROM schema_version ORDER BY version").all().map((r) => r.version);
}

/** Migrate a fresh temp database to the current schema, then hand back a raw handle. */
function buildCurrent(file: string): Raw {
  const wrapper = createDatabase(file);
  const raw = wrapper.raw;
  wrapper.close();
  return new Database(file);
}

/**
 * Downgrade a migrated database to V11 by removing exactly what V12 and V13 add.
 * Dropping the four tables takes their indexes and triggers with them.
 */
function buildV11Fixture(file: string): Raw {
  const db = buildCurrent(file);
  for (const table of [...V12_V13_TABLES, ...V14_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.prepare("DELETE FROM schema_version WHERE version >= 12").run();
  expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return db;
}

/** Capture the file handle so afterEach can close it before the temp dir is removed. */
function track(holder: { db: Raw | null }, db: Raw): Raw {
  holder.db = db;
  return db;
}

function removeDir(dir: string): void {
  // A createDatabase() that throws leaves its connection handle unreachable, so on
  // Windows the file can still be locked when cleanup runs. Do not fail the test for it.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* left in the OS temp directory for manual inspection */
  }
}

describe("A2 · the runner is observable", () => {
  it("exposes applyMigrations — F-18-02: no test could reach this code before now", () => {
    expect(database.applyMigrations).toBeTypeOf("function");
  });

  it("exposes the schema-verified ALTER helper and the duplicate-column predicate", () => {
    expect(database.applyAlterToleratingExistingColumn).toBeTypeOf("function");
    expect(database.isDuplicateColumnError).toBeTypeOf("function");
  });

  it("exposes per-version object verification", () => {
    expect(database.assertVersionObjectsExist).toBeTypeOf("function");
  });

  it("the migration plan covers every version from 2 to SCHEMA_VERSION with no gap", () => {
    expect(database.MIGRATION_VERSIONS).toEqual(
      Array.from({ length: SCHEMA_VERSION - 1 }, (_, i) => i + 2),
    );
  });
});

describe("A2 · declaredObjects parses the DDL it is given", () => {
  it("reads tables, indexes and triggers from V12 and V13", () => {
    const v12 = declaredObjects(MIGRATION_V12);
    const v13 = declaredObjects(MIGRATION_V13);
    expect(v12.tables.sort()).toEqual(["security_events", "treasury_authorizations"]);
    expect(v12.triggers.sort()).toEqual(["security_events_no_delete", "security_events_no_update", "treasury_authorizations_no_delete"]);
    expect(v13.tables.sort()).toEqual(["security_incidents", "security_seals"]);
    expect(v13.triggers.sort()).toEqual(["security_incidents_no_delete", "security_seals_no_delete", "security_seals_no_update"]);
  });

  it("reads ALTER ADD COLUMN pairs and ignores SQL comments", () => {
    const v10 = declaredObjects(MIGRATION_V10);
    expect(v10.tables).toEqual(["knowledge_store"]);
    expect(v10.indexes.sort()).toEqual(["idx_knowledge_category", "idx_knowledge_key"]);
    const withComment = declaredObjects("-- SQLite ALTER TABLE ADD COLUMN cannot include CHECK\nALTER TABLE children ADD COLUMN chain_type TEXT;");
    expect(withComment.columns).toEqual([{ table: "children", column: "chain_type" }]);
  });
});

describe("A2 · migrating a V11 database records and builds every object", () => {
  const holder: { db: Raw | null } = { db: null };
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a2-"));
    holder.db = null;
  });

  afterEach(() => {
    try { holder.db?.close(); } catch { /* already closed */ }
    removeDir(dir);
  });

  it("§4.E.1: advances a V11 fixture to 14", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "v11.db")));
    database.applyMigrations(db);
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("§4.E.2: creates all four V12/V13 tables, by name", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "tables.db")));
    database.applyMigrations(db);
    for (const table of V12_V13_TABLES) expect(exists(db, "table", table)).toBe(true);
  });

  it("§4.E.3: creates exactly the six V12/V13 and two V14 triggers, by name", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "triggers.db")));
    database.applyMigrations(db);
    const actual = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(actual).toEqual([...V12_V13_TRIGGERS, ...V14_TRIGGERS].sort());
  });

  it("§4.E.3: creates the twelve V12/V13 indexes and five V14 indexes, by name", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "indexes.db")));
    database.applyMigrations(db);
    for (const index of V12_V13_INDEXES) expect(exists(db, "index", index)).toBe(true);
    for (const index of V14_INDEXES) expect(exists(db, "index", index)).toBe(true);
  });

  it("records 12, 13 and 14 as rows written by their own migrations", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "rows.db")));
    database.applyMigrations(db);
    const rows = db.prepare("SELECT version, applied_at FROM schema_version WHERE version >= 12 ORDER BY version").all();
    expect(rows.map((r) => r.version)).toEqual([12, 13, 14]);
    for (const row of rows) expect(row.applied_at).toBeTruthy();
  });

  it("createDatabase on a V11 fixture reaches 14 with every named object", () => {
    const file = path.join(dir, "e2e.db");
    const downgraded = buildV11Fixture(file);
    downgraded.close();
    const wrapper = createDatabase(file);
    expect(wrapper.raw.prepare("SELECT MAX(version) AS v FROM schema_version").get().v).toBe(SCHEMA_VERSION);
    for (const table of [...V12_V13_TABLES, ...V14_TABLES]) expect(exists(wrapper.raw, "table", table)).toBe(true);
    for (const trigger of [...V12_V13_TRIGGERS, ...V14_TRIGGERS]) expect(exists(wrapper.raw, "trigger", trigger)).toBe(true);
    wrapper.close();
  });
});

describe("A2 · tolerance is confirmed against the schema, not the error text", () => {
  const holder: { db: Raw | null } = { db: null };
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a2-alter-"));
    holder.db = null;
  });

  afterEach(() => {
    try { holder.db?.close(); } catch { /* already closed */ }
    removeDir(dir);
  });

  function captureSqliteError(sql: string): unknown {
    const mem = new Database(":memory:");
    let caught: unknown;
    try { mem.exec(sql); } catch (error) { caught = error; } finally { mem.close(); }
    expect(caught).toBeDefined();
    return caught;
  }

  it("accepts a real duplicate-column SqliteError", () => {
    const error = captureSqliteError("CREATE TABLE t (a TEXT); ALTER TABLE t ADD COLUMN a TEXT;");
    expect(error.code).toBe("SQLITE_ERROR");
    expect(database.isDuplicateColumnError(error)).toBe(true);
  });

  it("rejects the same SQLITE_ERROR code carrying a different message — the code cannot discriminate", () => {
    const missing = captureSqliteError("ALTER TABLE nope ADD COLUMN b TEXT;");
    const syntax = captureSqliteError("THIs IS NOT SQL;");
    expect(missing.code).toBe("SQLITE_ERROR");
    expect(syntax.code).toBe("SQLITE_ERROR");
    expect(database.isDuplicateColumnError(missing)).toBe(false);
    expect(database.isDuplicateColumnError(syntax)).toBe(false);
  });

  it("rejects a non-Error object and a plain Error that merely carry the magic message", () => {
    expect(database.isDuplicateColumnError({ code: "SQLITE_ERROR", message: "duplicate column name: x" })).toBe(false);
    expect(database.isDuplicateColumnError(new Error("duplicate column name: x"))).toBe(false);
    expect(database.isDuplicateColumnError(undefined)).toBe(false);
  });

  it("§4.E.7: tolerates an ALTER whose column is genuinely present", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "toler.db")));
    expect(columnExists(db, "children", "chain_type")).toBe(true);
    expect(() =>
      database.applyAlterToleratingExistingColumn(db, MIGRATION_V11, "children", "chain_type"),
    ).not.toThrow();
  });

  it("rethrows a genuine failure instead of swallowing it", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "rethrow.db")));
    let caught;
    try {
      database.applyAlterToleratingExistingColumn(db, "ALTER TABLE children ADD COLUMN", "children", "role");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.name).toBe("SqliteError");
    expect(database.isDuplicateColumnError(caught)).toBe(false);
    // the original error is rethrown unchanged, so its code survives for the caller
    expect(caught.code).toBe("SQLITE_ERROR");
  });

  it("spoof: a duplicate-column error for one column cannot certify a different, absent column", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "spoof.db")));
    expect(() =>
      database.applyAlterToleratingExistingColumn(db, MIGRATION_V11, "children", "not_a_real_column"),
    ).toThrow(/children\.not_a_real_column/);
  });

  it("§4.E.4: a lock-shaped failure propagates out of the tolerance helper", () => {
    const file = path.join(dir, "locked.db");
    const db = track(holder, buildV11Fixture(file));
    const holder2 = new Database(file);
    holder2.exec("BEGIN EXCLUSIVE");
    let caught;
    try {
      database.applyAlterToleratingExistingColumn(
        db,
        "ALTER TABLE children ADD COLUMN brand_new_col TEXT;",
        "children",
        "brand_new_col",
      );
    } catch (error) {
      caught = error;
    } finally {
      holder2.exec("ROLLBACK");
      holder2.close();
    }
    expect(caught).toBeDefined();
    expect(caught.code).toMatch(/SQLITE_BUSY|SQLITE_LOCKED/);
    expect(database.isDuplicateColumnError(caught)).toBe(false);
  });

  it.each<[string, string, string]>([
    ["children", "role", "ALTER TABLE children ADD COLUMN role TEXT DEFAULT 'generalist';"],
    ...INBOX_V4_COLUMNS.map((c) => ["inbox_messages", c, `ALTER TABLE inbox_messages ADD COLUMN ${c} TEXT;`] as [string, string, string]),
    ["children", "chain_type", MIGRATION_V11],
  ])("helper covers the %s.%s site (A2-full: 7 of 7 against F-19-02)", (table, column, sql) => {
    const db = track(holder, buildV11Fixture(path.join(dir, `site-${table}-${column}.db`)));
    expect(columnExists(db, table, column)).toBe(true);
    expect(() => database.applyAlterToleratingExistingColumn(db, sql, table, column)).not.toThrow();
  });
});

describe("A2 · re-running the seven guarded sites onto an already-migrated database", () => {
  const holder: { db: Raw | null } = { db: null };
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a2-rerun-"));
    holder.db = null;
  });

  afterEach(() => {
    try { holder.db?.close(); } catch { /* already closed */ }
    removeDir(dir);
  });

  it("§4.E.7: V11 re-applies onto an existing chain_type and records 11 again", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "v11again.db")));
    db.prepare("DELETE FROM schema_version WHERE version >= 11").run();
    expect(columnExists(db, "children", "chain_type")).toBe(true);
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (const column of INBOX_V4_COLUMNS) expect(columnExists(db, "inbox_messages", column)).toBe(true);
  });

  it("F-18-11: re-running V10 onto a database that already has knowledge_store converges", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "v10again.db")));
    db.prepare("DELETE FROM schema_version WHERE version >= 10").run();
    expect(exists(db, "table", "knowledge_store")).toBe(true);
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("F-18-11: a database whose objects are ahead of its version rows converges from V9 upward", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "ahead9.db")));
    db.prepare("DELETE FROM schema_version WHERE version >= 9").run();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(exists(db, "table", "goals")).toBe(true);
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(exists(db, "table", "goals")).toBe(true);
  });

  it("A2-full: resetting every version from V4 re-runs all seven guarded sites and converges", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "ahead4.db")));
    db.prepare("DELETE FROM schema_version WHERE version >= 4").run();
    expect(versionRows(db)).toEqual([2, 3]);
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(columnExists(db, "children", "role")).toBe(true);
    expect(columnExists(db, "children", "chain_type")).toBe(true);
    for (const column of INBOX_V4_COLUMNS) expect(columnExists(db, "inbox_messages", column)).toBe(true);
  });
});

describe("A2 · a failed migration records nothing, and the version cannot be claimed", () => {
  const holder: { db: Raw | null } = { db: null };
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a2-fail-"));
    holder.db = null;
  });

  afterEach(() => {
    try { holder.db?.close(); } catch { /* already closed */ }
    removeDir(dir);
  });

  function blockV12(db: Raw): void {
    // A same-named table with the wrong shape: V12's IF NOT EXISTS skips it, then
    // its index on security_events(timestamp) fails for a reason that is not a
    // duplicate column. This is also why F-19-06 is filed — name-only checks cannot
    // catch the shape, only the objects that reference the missing columns do.
    db.exec("DROP TABLE IF EXISTS security_events");
    db.prepare("DELETE FROM schema_version WHERE version >= 12").run();
    db.exec("CREATE TABLE security_events (id TEXT PRIMARY KEY)");
  }

  it("§4.E.4/5: a non-duplicate error inside V12 propagates and writes no version row", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "blocked.db")));
    blockV12(db);
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    let caught;
    try {
      database.applyMigrations(db);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(database.isDuplicateColumnError(caught)).toBe(false);
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // objects created earlier in the same transaction were rolled back with it
    expect(exists(db, "table", "treasury_authorizations")).toBe(false);
    expect(exists(db, "index", "idx_treasury_created")).toBe(false);
    expect(exists(db, "trigger", "treasury_authorizations_no_delete")).toBe(false);
  });

  it("§4.E.6: once the blocker is gone the next attempt converges", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "converge.db")));
    blockV12(db);
    let threw = false;
    try {
      database.applyMigrations(db);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    db.exec("DROP TABLE security_events");
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (const table of V12_V13_TABLES) expect(exists(db, "table", table)).toBe(true);
    for (const trigger of V12_V13_TRIGGERS) expect(exists(db, "trigger", trigger)).toBe(true);
  });

  it("a V9 re-run onto an existing goals table converges rather than clashing", () => {
    const db = track(holder, buildV11Fixture(path.join(dir, "v9again.db")));
    expect(exists(db, "table", "goals")).toBe(true);
    db.prepare("DELETE FROM schema_version WHERE version >= 9").run();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(() => database.applyMigrations(db)).not.toThrow();
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("F-18-02: refuses a database that claims the current version without its objects", () => {
    const file = path.join(dir, "lying.db");
    const lying = buildCurrent(file);
    for (const table of [...V12_V13_TABLES].reverse()) lying.exec(`DROP TABLE IF EXISTS ${table}`);
    lying.close();

    expect(() => createDatabase(file)).toThrow(/security_seals|treasury_authorizations/);
    const after = new Database(file, { readonly: true });
    expect(versionRows(after)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(exists(after, "table", "security_seals")).toBe(false);
    after.close();
  });

  it("pins V12+V13 by name in both directions — the criterion is names, not counts", () => {
    type Objects = ReturnType<typeof declaredObjects>;
    const union = (pick: (objects: Objects) => string[]): string[] => [
      ...pick(declaredObjects(MIGRATION_V12)),
      ...pick(declaredObjects(MIGRATION_V13)),
    ].sort();
    expect(union((o) => o.tables)).toEqual([...V12_V13_TABLES].sort());
    expect(union((o) => o.triggers)).toEqual([...V12_V13_TRIGGERS].sort());
    expect(union((o) => o.indexes)).toEqual([...V12_V13_INDEXES].sort());
    expect(union((o) => o.columns)).toEqual([]);
  });

  it("§4.E.8: refuses when one required trigger has been removed", () => {
    const file = path.join(dir, "droppedtrigger.db");
    const full = buildCurrent(file);
    full.exec("DROP TRIGGER IF EXISTS security_seals_no_update");
    full.close();

    expect(() => createDatabase(file)).toThrow(/security_seals_no_update/);
    const after = new Database(file, { readonly: true });
    expect(versionRows(after)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    after.close();
  });

  it("§4.E.8: refuses when a required column is missing from a table that exists", () => {
    const file = path.join(dir, "nocolum.db");
    const full = buildCurrent(file);
    expect(columnExists(full, "children", "chain_type")).toBe(true);
    full.exec("ALTER TABLE children DROP COLUMN chain_type");
    expect(columnExists(full, "children", "chain_type")).toBe(false);
    full.close();

    expect(() => createDatabase(file)).toThrow(/children\.chain_type/);
  });

  it("the runner no longer stamps schema_version from MAX(version)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "state", "database.ts"), "utf8");
    expect(source).not.toMatch(/INSERT\s+OR\s+REPLACE\s+INTO\s+schema_version/i);
    expect(source).toMatch(/ON\s+CONFLICT\s*\(\s*version\s*\)\s+DO\s+NOTHING/i);
  });

  it("the seven unbounded migration catches are gone", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "state", "database.ts"), "utf8");
    const runner = source.slice(source.indexOf("function applyMigrations"));
    expect(runner).not.toMatch(/catch\s*\{/);
    expect(runner).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*(\/\*[^*]*\*\/\s*)?\}/);
  });

  it("every migration creates its objects conditionally, so a re-run cannot clash", () => {
    const sources: Record<string, string> = {
      v3: MIGRATION_V3,
      v4: MIGRATION_V4,
      v5: MIGRATION_V5,
      v6: MIGRATION_V6,
      v7: MIGRATION_V7,
      v8: MIGRATION_V8,
      v9: MIGRATION_V9,
      v10: MIGRATION_V10,
      v12: MIGRATION_V12,
      v13: MIGRATION_V13,
      v14: MIGRATION_V14,
    };
    const bare: string[] = [];
    for (const [name, sql] of Object.entries(sources)) {
      for (const match of sql.matchAll(/CREATE\s+(?:TABLE|INDEX|TRIGGER)\s+(?!IF\s+NOT\s+EXISTS)[A-Za-z0-9_]+/gi)) {
        bare.push(`${name}: ${match[0]}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
