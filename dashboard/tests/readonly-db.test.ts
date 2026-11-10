import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  CODE_SCHEMA_VERSION,
  KNOWN_ABSENT_TABLES,
  countRows,
  getDb,
  integrityCheck,
  schemaVersion,
  tableNames,
} from "../server/db.js";
import { DB_PATH } from "../server/paths.js";

/** Mandate §3 and §17: the console observes Conway state, it does not change it. */

describe("read-only database handle", () => {
  it("opens the canonical database and nothing else", () => {
    const opened = getDb();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.handle.file).toBe(path.resolve(DB_PATH));
    expect(opened.handle.db.readonly).toBe(true);
  });

  it("cannot write: the guard is SQLite refusing, not the dashboard asking politely", () => {
    const opened = getDb();
    if (!opened.ok) throw new Error(opened.error);
    opened.handle.db.exec("BEGIN");
    let refused = false;
    try {
      opened.handle.db.prepare("CREATE TABLE IF NOT EXISTS dashboard_probe (x INTEGER)").run();
    } catch (cause) {
      refused = true;
      expect(String(cause)).toContain("readonly");
    } finally {
      try {
        opened.handle.db.exec("ROLLBACK");
      } catch {
        /* already aborted by SQLite */
      }
    }
    expect(refused).toBe(true);
    const tables = tableNames(opened.handle.db);
    expect(tables.has("dashboard_probe")).toBe(false);
  });

  it("reports integrity and a schema version without migrating", () => {
    const opened = getDb();
    if (!opened.ok) throw new Error(opened.error);
    expect(integrityCheck(opened.handle.db)).toBe("ok");
    const version = schemaVersion(opened.handle.db);
    expect(version.code).toBe(CODE_SCHEMA_VERSION);
    expect(version.live).not.toBeNull();
    expect(version.live as number).toBeLessThanOrEqual(CODE_SCHEMA_VERSION);
    const counted = opened.handle.db.prepare("SELECT COUNT(*) AS n FROM schema_version").get() as { n: number };
    expect(counted.n).toBeGreaterThan(0);
    expect(counted.n).toBeLessThanOrEqual(CODE_SCHEMA_VERSION);
  });

  it("confirms the four absent tables are still absent, which is why they render NOT VERIFIED", () => {
    const opened = getDb();
    if (!opened.ok) throw new Error(opened.error);
    const tables = tableNames(opened.handle.db);
    for (const table of KNOWN_ABSENT_TABLES) {
      expect(tables.has(table), `${table} appeared — re-read the panel logic`).toBe(false);
    }
  });

  it("counts an existing table without inventing rows", () => {
    const opened = getDb();
    if (!opened.ok) throw new Error(opened.error);
    const tables = tableNames(opened.handle.db);
    expect(tables.has("kv")).toBe(true);
    expect(countRows(opened.handle.db, "kv")).toBe(0);
    expect(tables.size).toBeGreaterThan(30);
  });
});
