/**
 * B-1 — disposable V11 → V14 migration package.
 *
 * Every fixture here is a throw-away database in the OS temp directory. The live
 * state.db is never opened by this suite. The V11 fixture is produced by migrating a
 * fresh database and then removing exactly what V12, V13 and V14 add, which keeps the
 * fixture in lock-step with the real plan instead of a hand-copied schema dump.
 */

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, getSchemaVersion } from "../../state/database.js";

type Raw = BetterSqlite3.Database;

const V12_V14_TABLES = [
  "treasury_authorizations",
  "security_events",
  "security_incidents",
  "security_seals",
  "repair_approvals",
  "repair_approval_events",
];

const V14_INDEXES = [
  "idx_repair_approvals_status",
  "idx_repair_approvals_finding",
  "idx_repair_approvals_live",
  "idx_repair_approvals_decision_key",
  "idx_repair_approval_events_proposal",
];

const V14_TRIGGERS = [
  "repair_approval_events_no_update",
  "repair_approval_events_no_delete",
];

const tempDirs: string[] = [];
const openHandles: Raw[] = [];

function tempDb(name = "state.db"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-b1-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

function track(db: Raw): Raw {
  openHandles.push(db);
  return db;
}

function buildCurrent(file: string): Raw {
  const wrapper = createDatabase(file);
  wrapper.close();
  return track(new Database(file));
}

function buildV11Fixture(file: string): Raw {
  const db = buildCurrent(file);
  for (const table of [...V12_V14_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.prepare("DELETE FROM schema_version WHERE version >= 12").run();
  expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return db;
}

function versionRows(db: Raw): number[] {
  return db
    .prepare("SELECT version FROM schema_version ORDER BY version")
    .all()
    .map((row: { version: number }) => row.version);
}

function exists(db: Raw, type: string, name: string): boolean {
  return !!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
}

/** Content digest of every table that existed before the migration ran. */
function digestPreviousTables(db: Raw): Record<string, string> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_version' ORDER BY name",
    )
    .all()
    .map((row: { name: string }) => row.name)
    .filter((name) => !V12_V14_TABLES.includes(name));

  const out: Record<string, string> = {};
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => JSON.stringify(row));
    rows.sort();
    out[table] = crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
  }
  return out;
}

afterEach(() => {
  for (const db of openHandles.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed by the test */
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* Windows may still hold a handle from a createDatabase() that threw */
    }
  }
});

describe("B-1 · a V11 production copy migrates to V14", () => {
  it("advances the recorded plan from 11 to 14 with no gap", () => {
    const file = tempDb();
    buildV11Fixture(file).close();

    const wrapper = createDatabase(file);
    expect(getSchemaVersion(wrapper.raw)).toBe(14);
    wrapper.close();

    const db = track(new Database(file, { readonly: true }));
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("creates every V14 object by name", () => {
    const file = tempDb();
    buildV11Fixture(file).close();

    const wrapper = createDatabase(file);
    const db = wrapper.raw;
    for (const table of ["repair_approvals", "repair_approval_events"]) {
      expect(exists(db, "table", table), `missing table ${table}`).toBe(true);
    }
    for (const index of V14_INDEXES) {
      expect(exists(db, "index", index), `missing index ${index}`).toBe(true);
    }
    for (const trigger of V14_TRIGGERS) {
      expect(exists(db, "trigger", trigger), `missing trigger ${trigger}`).toBe(true);
    }
    wrapper.close();
  });

  it("preserves every pre-existing row and leaves integrity_check ok", () => {
    const file = tempDb();
    const fixture = buildV11Fixture(file);
    fixture
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?), (?, ?), (?, ?)")
      .run("agent_state", "setup", "chain_type", "evm", "identity.name", "conway");
    const before = digestPreviousTables(fixture);
    expect(Object.keys(before).length).toBeGreaterThan(30);
    fixture.close();

    const wrapper = createDatabase(file);
    expect(wrapper.raw.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(digestPreviousTables(wrapper.raw)).toEqual(before);
    expect(
      wrapper.raw.prepare("SELECT value FROM kv WHERE key = 'agent_state'").get(),
    ).toEqual({ value: "setup" });
    expect(
      wrapper.raw.prepare("SELECT COUNT(*) AS c FROM repair_approvals").get(),
    ).toEqual({ c: 0 });
    wrapper.close();
  });

  it("makes the new history table append-only", () => {
    const file = tempDb();
    buildV11Fixture(file).close();
    const wrapper = createDatabase(file);
    const db = wrapper.raw;
    db.prepare(
      `INSERT INTO repair_approval_events
         (id, proposal_id, sequence, at_ms, at_iso, event, actor, detail, prev_hash, hash)
       VALUES ('e1', 'p1', 1, 1, '1970-01-01T00:00:00.001Z', 'created', 'system', '{}', 'GENESIS', 'h1')`,
    ).run();

    expect(() =>
      db.prepare("UPDATE repair_approval_events SET event = 'tampered' WHERE id = 'e1'").run(),
    ).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM repair_approval_events WHERE id = 'e1'").run()).toThrow(
      /append-only/,
    );
    expect(db.prepare("SELECT COUNT(*) AS c FROM repair_approval_events").get()).toEqual({ c: 1 });
    wrapper.close();
  });

  it("is idempotent: opening an already-migrated database changes no row", () => {
    const file = tempDb();
    buildV11Fixture(file).close();

    const first = createDatabase(file);
    first.raw.prepare(
      `INSERT INTO repair_approvals
         (id, finding_id, component, root_cause, proposed_action, expected_benefit,
          potential_side_effects, risk_classification, created_ms, expires_ms, status, action_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p1", "f1", "heartbeat", "timeout", "fix", "stability", "none", "low", 1, 2, "awaiting_approval", "abc");
    const before = digestPreviousTables(first.raw);
    first.close();

    const second = createDatabase(file);
    expect(versionRows(second.raw)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(digestPreviousTables(second.raw)).toEqual(before);
    expect(second.raw.prepare("SELECT COUNT(*) AS c FROM repair_approvals").get()).toEqual({ c: 1 });
    second.close();
  });
});

describe("B-1 · rollback and recovery on disposable copies", () => {
  it("a whole-file backup restores the exact V11 state and data", () => {
    const file = tempDb();
    const fixture = buildV11Fixture(file);
    fixture.prepare("INSERT INTO kv (key, value) VALUES ('k', 'v')").run();
    fixture.close();

    const backup = `${file}.v11.bak`;
    fs.copyFileSync(file, backup);
    expect(fs.readFileSync(backup)).toEqual(fs.readFileSync(file));

    const migrated = createDatabase(file);
    expect(getSchemaVersion(migrated.raw)).toBe(14);
    migrated.close();

    fs.copyFileSync(backup, file);
    const restored = track(new Database(file, { readonly: true }));
    expect(getSchemaVersion(restored)).toBe(11);
    expect(restored.prepare("SELECT value FROM kv WHERE key = 'k'").get()).toEqual({ value: "v" });
    expect(exists(restored, "table", "repair_approvals")).toBe(false);
  });

  it("a failing V14 step records no version and leaves no V14 object behind", () => {
    const file = tempDb();
    const fixture = buildV11Fixture(file);
    // A table occupying the index name makes the CREATE INDEX ... IF NOT EXISTS a no-op.
    // Verification then reports the missing index and the whole version-transaction rolls back.
    fixture.exec("CREATE TABLE idx_repair_approvals_status (planted INTEGER)");
    fixture.close();

    expect(() => createDatabase(file)).toThrow(/missing .*object|idx_repair_approvals_status/i);

    const db = track(new Database(file, { readonly: true }));
    expect(getSchemaVersion(db)).toBe(13);
    expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(exists(db, "table", "repair_approvals")).toBe(false);
    expect(exists(db, "table", "repair_approval_events")).toBe(false);
    expect(exists(db, "table", "repair_approval_events_no_update")).toBe(false);
  });

  it("refuses a database that is newer than this build instead of downgrading it", () => {
    const file = tempDb();
    buildV11Fixture(file).close();

    const prepare = createDatabase(file);
    prepare.close();
    const raw = track(new Database(file));
    raw.prepare("INSERT INTO schema_version (version) VALUES (15)").run();
    raw.close();

    expect(() => createDatabase(file)).toThrow(/records 15 but this build declares 14/);

    const verify = track(new Database(file, { readonly: true }));
    expect(getSchemaVersion(verify)).toBe(15);
  });
});
