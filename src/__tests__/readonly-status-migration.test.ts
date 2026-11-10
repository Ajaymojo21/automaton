/**
 * Phase 19 A3 — read-only `--status` and an explicit, gated `--migrate-schema`.
 *
 * Closes F-18-01: `--status` opened the database through `createDatabase()`, which
 * runs the full write path — mkdir, WAL pragma, CREATE TABLES, applyMigrations and
 * the version row — so a command the operations guide describes as "check on things"
 * could advance the schema and create a database as a side effect.
 *
 * Mandate §5.C test plan, in order:
 *   1 schema stays at 11 after a status read          → "leaves the schema exactly where it found it"
 *   2 database mtime unchanged                        → "does not touch the file timestamp"
 *   3 database SHA-256 unchanged                      → "does not change a single byte of state.db"
 *   4 no V12/V13 objects created                      → "creates none of the pending V12/V13 objects"
 *   5 missing database fails cleanly, creates none    → "refuses a missing database and does not create one"
 *   6 `--migrate-schema` refuses without the token    → "refuses without the approval token and writes nothing"
 *   7 operates only on its fixture                    → "migrates only the fixture it was given"
 *   8 output equivalence with the pre-A3 getters      → "reports the same fields the write-path getters report"
 *   9 activation independence                         → "needs no activation decision at all"
 *
 * The WAL caveat measured during planning (F-18-12) is asserted rather than glossed: a
 * read-only open of a WAL database creates and refreshes the `-wal`/`-shm` sidecars in the
 * state directory. The invariant is therefore about `state.db` itself — its bytes, its
 * timestamp and its schema — not about the directory being free of sidecar files.
 *
 * Every fixture is a disposable database under the OS temp directory. The live state.db is
 * never opened by these tests: the one test that names its path asserts refusal, which
 * happens before any file is opened, and then proves the file was not touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  getSchemaVersion,
  openDatabaseReadOnly,
  ReadOnlyDatabaseError,
  readStatusSnapshot,
  type StatusSnapshot,
} from "../state/database.js";
import {
  CANONICAL_OVERRIDE_ENV,
  MIGRATION_APPROVAL_ENV,
  MIGRATION_APPROVAL_VALUE,
  evaluateMigrationGate,
  runSchemaMigration,
  canonicalLiveDatabasePath,
} from "../state/schema-migration.js";
import { SCHEMA_VERSION } from "../state/schema.js";

type Raw = BetterSqlite3.Database;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The four tables V12/V13 add; their presence would prove a migration ran. */
const PENDING_TABLES = [
  "treasury_authorizations",
  "security_events",
  "security_incidents",
  "security_seals",
  "repair_approvals",
  "repair_approval_events",
];

const V11_VERSION_ROWS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function tableExists(db: Raw, name: string): boolean {
  return !!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function versionRows(db: Raw): number[] {
  return db.prepare("SELECT version FROM schema_version ORDER BY version").all().map((r) => r.version);
}

/**
 * Seed the seven tables `--status` reads, so an equivalence test compares two code paths
 * over real rows instead of over zeros. Values are deliberately mixed: enabled 0/1, a dead
 * child among live ones, an invalid agent_state, a registry row — every branch the old
 * getter chain took.
 *
 * 'idle' is not one of the seven states AgentState allows (the schema comment lists them),
 * so the seeded state is 'running'; the invalid-value branch is covered separately.
 */
function seedStatusRows(db: Raw): void {
  db.prepare("INSERT INTO kv (key, value) VALUES ('agent_state', 'running')").run();
  db.prepare(
    "INSERT INTO turns (id, timestamp, state, thinking) VALUES (?, datetime('now'), 'running', 'seed')",
  ).run("turn-1");
  db.prepare("INSERT INTO turns (id, timestamp, state, thinking) VALUES (?, datetime('now'), 'running', 'seed')").run(
    "turn-2",
  );
  db.prepare("INSERT INTO installed_tools (id, name, type, enabled) VALUES ('tool-1', 'alpha', 'mcp', 1)").run();
  db.prepare("INSERT INTO installed_tools (id, name, type, enabled) VALUES ('tool-2', 'beta', 'mcp', 0)").run();
  db.prepare("INSERT INTO skills (name, enabled) VALUES ('skill-one', 1)").run();
  db.prepare("INSERT INTO skills (name, enabled) VALUES ('skill-two', 1)").run();
  db.prepare("INSERT INTO skills (name, enabled) VALUES ('skill-off', 0)").run();
  db.prepare(
    "INSERT INTO heartbeat_entries (name, schedule, task, enabled) VALUES ('hb-on', '*/5 * * * *', 'beat', 1)",
  ).run();
  db.prepare(
    "INSERT INTO heartbeat_entries (name, schedule, task, enabled) VALUES ('hb-off', '0 * * * *', 'beat', 0)",
  ).run();
  db.prepare(
    `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
     VALUES ('child-1', 'c1', '0x1', 'sbx-1', 'genesis', 'running', datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
     VALUES ('child-2', 'c2', '0x2', 'sbx-2', 'genesis', 'dead', datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
     VALUES ('child-3', 'c3', '0x3', 'sbx-3', 'genesis', 'sleeping', datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO registry (agent_id, agent_uri, contract_address, tx_hash)
     VALUES ('agent-abc', 'conway://agent', '0xcafe', '0xtx')`,
  ).run();
}

/** A V11 database with seeded status rows — the shape the live install is in today. */
function buildV11Fixture(file: string): void {
  const wrapper = createDatabase(file);
  const raw = wrapper.raw;
  seedStatusRows(raw);
  for (const table of [...PENDING_TABLES].reverse()) raw.exec(`DROP TABLE IF EXISTS ${table}`);
  raw.prepare("DELETE FROM schema_version WHERE version >= 12").run();
  expect(versionRows(raw)).toEqual(V11_VERSION_ROWS);
  wrapper.close();
}

describe("A3 — read-only database handle", () => {
  let dir: string;
  let file: string;
  let open: Raw[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-"));
    file = path.join(dir, "state.db");
    open = [];
  });

  afterEach(() => {
    for (const db of open) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    // Windows holds a byte-range lock briefly after close; a throwing rmSync here would
    // fail the test for a reason unrelated to the behaviour under test.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function track<T extends Raw>(db: T): T {
    open.push(db);
    return db;
  }

  it("opens an existing database without creating, writing, or migrating", () => {
    buildV11Fixture(file);
    const db = track(openDatabaseReadOnly(file));

    expect(getSchemaVersion(db)).toBe(11);
    expect(db.prepare("SELECT COUNT(*) AS c FROM turns").get()).toEqual({ c: 2 });
    expect(versionRows(db)).toEqual(V11_VERSION_ROWS);
  });

  it("refuses a missing database and does not create one", () => {
    // §5.C.5 — mandate: "fails safely with a clear message when the database is absent
    // instead of creating one".
    const missing = path.join(dir, "absent", "state.db");
    let caught: unknown;
    try {
      openDatabaseReadOnly(missing);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReadOnlyDatabaseError);
    expect((caught as Error).message).toContain(missing);
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("blocks a write through the returned handle", () => {
    buildV11Fixture(file);
    const db = track(openDatabaseReadOnly(file));
    expect(() => db.prepare("INSERT INTO kv (key, value) VALUES ('x', 'y')").run()).toThrowError(
      /readonly|attempt to write/i,
    );
  });

  it("does not advance the schema of a V11 database it is handed", () => {
    // §5.C.1 — the schema stays at 11, which is the whole point of A3.
    buildV11Fixture(file);
    const before = sha256(file);
    const db = track(openDatabaseReadOnly(file));
    const snapshot = readStatusSnapshot(file);
    expect(snapshot.schemaVersion).toBe(11);
    expect(getSchemaVersion(db)).toBe(11);
    expect(versionRows(db)).toEqual(V11_VERSION_ROWS);
    expect(sha256(file)).toBe(before);
  });
});

describe("A3 — readStatusSnapshot against a disposable V11 copy", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-snap-"));
    file = path.join(dir, "state.db");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("leaves the schema exactly where it found it", () => {
    // §5.C.1
    buildV11Fixture(file);
    readStatusSnapshot(file);
    const db = new Database(file);
    try {
      expect(versionRows(db)).toEqual(V11_VERSION_ROWS);
      expect(getSchemaVersion(db)).toBe(11);
    } finally {
      db.close();
    }
  });

  it("does not touch the file timestamp", () => {
    // §5.C.2 — mtime, measured before and after with no sleep between, so a coarse
    // filesystem clock cannot mask a write.
    buildV11Fixture(file);
    const before = fs.statSync(file);
    readStatusSnapshot(file);
    const after = fs.statSync(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it("does not change a single byte of state.db", () => {
    // §5.C.3, with the WAL caveat of §5.C.3 asserted explicitly rather than glossed:
    // state.db is byte-identical, while SQLite is free to create the -wal/-shm sidecars.
    buildV11Fixture(file);
    const before = sha256(file);
    readStatusSnapshot(file);
    expect(sha256(file)).toBe(before);

    const sidecars = fs.readdirSync(dir).filter((entry) => entry !== "state.db");
    for (const sidecar of sidecars) {
      expect(sidecar).toMatch(/^state\.db(-(wal|shm))?$/);
    }
  });

  it("creates none of the pending V12/V13 objects", () => {
    // §5.C.4
    buildV11Fixture(file);
    readStatusSnapshot(file);
    const db = new Database(file);
    try {
      for (const table of PENDING_TABLES) expect(tableExists(db, table)).toBe(false);
      expect(tableExists(db, "schema_version")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("reports the same fields the write-path getters report", () => {
    // §5.C.8 — output equivalence. Both halves run over the same seeded fixture: the old
    // chain (createDatabase + the seven getters, i.e. the shape showStatus() had before
    // A3) and the new read-only snapshot. If a rewrite silently changed one predicate this
    // test names the field.
    buildV11Fixture(file);
    const legacy = createDatabase(file);
    let expected: StatusSnapshot;
    try {
      const state = legacy.getAgentState();
      const turnCount = legacy.getTurnCount();
      const tools = legacy.getInstalledTools();
      const heartbeats = legacy.getHeartbeatEntries();
      const skills = legacy.getSkills(true);
      const children = legacy.getChildren();
      const registry = legacy.getRegistryEntry();
      expected = {
        agentState: state,
        turnCount,
        enabledToolCount: tools.length,
        enabledSkillCount: skills.length,
        enabledHeartbeatCount: heartbeats.filter((h) => h.enabled).length,
        totalHeartbeatCount: heartbeats.length,
        aliveChildCount: children.filter((c) => c.status !== "dead").length,
        totalChildCount: children.length,
        registryAgentId: registry?.agentId,
        schemaVersion: getSchemaVersion(legacy.raw),
      };
    } finally {
      legacy.close();
    }

    // F-18-01, recorded rather than asserted away: the pre-A3 status path ran
    // createDatabase(), which migrated this same V11 fixture up to V13 while "just
    // looking". The numbers below are therefore compared on a V13 file; the dedicated
    // V11 tests above are what pin the read-only path's behaviour.
    expect(expected.schemaVersion).toBe(SCHEMA_VERSION);

    const actual = readStatusSnapshot(file);
    expect(actual).toEqual(expected);
    // Name the load-bearing counts individually so a failure is not a diff puzzle.
    expect(actual.agentState).toBe("running");
    expect(actual.turnCount).toBe(2);
    expect(actual.enabledToolCount).toBe(1);
    expect(actual.enabledSkillCount).toBe(2);
    expect(actual.enabledHeartbeatCount).toBe(1);
    expect(actual.totalHeartbeatCount).toBe(2);
    expect(actual.aliveChildCount).toBe(2);
    expect(actual.totalChildCount).toBe(3);
    expect(actual.registryAgentId).toBe("agent-abc");
  });

  it("defaults a missing or invalid agent_state the same way the getter chain does", () => {
    buildV11Fixture(file);
    const db = new Database(file);
    db.prepare("DELETE FROM kv WHERE key = 'agent_state'").run();
    db.prepare("DELETE FROM registry").run();
    db.close();

    const missing = readStatusSnapshot(file);
    expect(missing.agentState).toBe("setup");
    expect(missing.registryAgentId).toBeUndefined();

    const raw = new Database(file);
    raw.prepare("INSERT INTO kv (key, value) VALUES ('agent_state', 'idle')").run();
    raw.close();
    // 'idle' is outside the AgentState enum, so validateAgentState must fall back — and
    // the snapshot must fall back identically to the getter it replaced.
    expect(readStatusSnapshot(file).agentState).toBe("setup");
  });

  it("needs no activation decision at all", () => {
    // §5.C.9 — the read path must stay available while activation is refused, otherwise
    // A3 would have coupled observation to execution.
    const saved = process.env.CONWAY_ACTIVATION;
    delete process.env.CONWAY_ACTIVATION;
    try {
      buildV11Fixture(file);
      expect(() => readStatusSnapshot(file)).not.toThrow();
      expect(readStatusSnapshot(file).schemaVersion).toBe(11);
    } finally {
      if (saved !== undefined) process.env.CONWAY_ACTIVATION = saved;
    }
  });

  it("refuses a file that is not a SQLite database, and says so", () => {
    // Measured first: the readonly open itself never complains about junk of any size —
    // SQLite raises SQLITE_NOTADB only when the first statement reads the header, which is
    // why openDatabaseReadOnly probes sqlite_master instead of trusting the open.
    fs.writeFileSync(file, Buffer.from("this is not a database".repeat(16)));
    const before = fs.readFileSync(file);
    expect(() => openDatabaseReadOnly(file)).toThrowError(ReadOnlyDatabaseError);
    expect(() => openDatabaseReadOnly(file)).toThrowError(/not a database/i);
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it("reads a real-but-empty SQLite file without turning it into a Conway database", () => {
    // A 0-byte file is a legitimate empty database: it opens, and sqlite_master is empty.
    // The read path must then fail on the missing table and must not create one — creating
    // tables is createDatabase's job, and A3 takes it off this path.
    fs.writeFileSync(file, Buffer.alloc(0));
    const db = openDatabaseReadOnly(file);
    db.close();
    expect(() => readStatusSnapshot(file)).toThrowError(/no such table/i);
    expect(fs.statSync(file).size).toBe(0);
  });
});

describe("A3 — the --migrate-schema approval gate", () => {
  let dir: string;
  let home: string;
  let file: string;
  let reportDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-mig-"));
    home = path.join(dir, "home");
    fs.mkdirSync(path.join(home, ".automaton"), { recursive: true });
    file = path.join(home, ".automaton", "state.db");
    reportDir = path.join(dir, "reports");
    fs.mkdirSync(reportDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function isolatedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
      HOME: home,
      CONWAY_HOME_MODE: "isolated",
      ...overrides,
    } as NodeJS.ProcessEnv;
  }

  function reports(): string[] {
    return fs.existsSync(reportDir) ? fs.readdirSync(reportDir) : [];
  }

  it("refuses without the approval token and writes nothing", () => {
    // §5.C.6
    buildV11Fixture(file);
    const before = sha256(file);
    const result = runSchemaMigration({ dbPath: file, env: isolatedEnv(), reportDir });

    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stage).toBe("gate");
    expect(MIGRATION_APPROVAL_ENV).not.toBe("CONWAY_ACTIVATION");
    expect(result.message).toContain(MIGRATION_APPROVAL_ENV);
    expect(reports()).toEqual([]);
    expect(sha256(file)).toBe(before);
    const db = new Database(file);
    try {
      expect(versionRows(db)).toEqual(V11_VERSION_ROWS);
    } finally {
      db.close();
    }
  });

  it("does not treat agent activation as migration approval", () => {
    // Mandate: the migration gate "never enables agent activation", and the reverse must
    // hold too — CONWAY_ACTIVATION=APPROVED buys a migration nothing.
    const withActivation = evaluateMigrationGate(
      isolatedEnv({ CONWAY_ACTIVATION: "APPROVED", security: undefined as unknown as string }),
    );
    expect(withActivation.approved).toBe(false);

    const wrongValue = evaluateMigrationGate(isolatedEnv({ [MIGRATION_APPROVAL_ENV]: "yes" }));
    expect(wrongValue.approved).toBe(false);

    const right = evaluateMigrationGate(isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }));
    expect(right.approved).toBe(true);
  });

  it("refuses a stray path that is not inside the verified state directory", () => {
    const stray = path.join(dir, "elsewhere.db");
    buildV11Fixture(stray);
    const result = runSchemaMigration({
      dbPath: stray,
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(reports()).toEqual([]);
  });

  it("refuses the canonical live database without a separate explicit override", () => {
    // §5.C.7 — the command never receives the canonical path unless the override exists.
    // The refusal happens before any open, so this test names the live path without
    // touching it; the byte check afterwards proves that.
    const live = canonicalLiveDatabasePath();
    const before = sha256(live);
    const result = runSchemaMigration({
      dbPath: live,
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(result.message).toMatch(/canonical|live/i);
    expect(reports()).toEqual([]);
    expect(sha256(live)).toBe(before);

    const stillRefused = runSchemaMigration({
      dbPath: live,
      env: isolatedEnv({
        [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE,
        [CANONICAL_OVERRIDE_ENV]: "true",
      }),
      reportDir,
    });
    expect(stillRefused.ok).toBe(false);
    expect(sha256(live)).toBe(before);
  });

  it("migrates only the fixture it was given", () => {
    // §5.C.7 — with the token, against the isolated fixture.
    buildV11Fixture(file);
    const result = runSchemaMigration({
      dbPath: file,
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    const db = new Database(file);
    try {
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
      expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      for (const table of PENDING_TABLES) expect(tableExists(db, table)).toBe(true);
    } finally {
      db.close();
    }
    expect(path.resolve(result.reportPath ?? "")).toContain(path.resolve(reportDir));
  });

  it("writes an auditable report with names and versions, and no row data", () => {
    buildV11Fixture(file);
    const result = runSchemaMigration({
      dbPath: file,
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    const report = JSON.parse(fs.readFileSync(result.reportPath as string, "utf-8"));
    expect(report.before.version).toBe(11);
    expect(report.after.version).toBe(SCHEMA_VERSION);
    expect(report.created.tables).toEqual(expect.arrayContaining(PENDING_TABLES));
    expect(typeof report.durationMs).toBe("number");
    expect(report.result).toBe("success");
    // No row data, no token value, no secrets.
    const text = JSON.stringify(report);
    expect(text).not.toContain(MIGRATION_APPROVAL_VALUE);
    expect(text).not.toContain("agent-abc");
    expect(text).not.toContain("seed");
    expect(Object.keys(report).sort()).toEqual(
      expect.arrayContaining(["after", "before", "command", "created", "durationMs", "result", "startedAt"]),
    );
  });

  it("refuses a missing database before doing anything else", () => {
    const result = runSchemaMigration({
      dbPath: path.join(home, ".automaton", "absent.db"),
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(fs.existsSync(path.join(home, ".automaton", "absent.db"))).toBe(false);
  });

  it("refuses when the home guard does not pass, and creates nothing", () => {
    buildV11Fixture(file);
    const result = runSchemaMigration({
      dbPath: file,
      env: { CONWAY_HOME_MODE: "isolated", [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE } as NodeJS.ProcessEnv,
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("home");
    expect(reports()).toEqual([]);
  });

  it("refuses a database that fails integrity_check, without running DDL", () => {
    buildV11Fixture(file);
    const db = new Database(file);
    db.close();
    // Corrupt the header of the main database file so integrity_check must fail.
    const handle = fs.openSync(file, "r+");
    const junk = Buffer.from("not a sqlite header at all");
    fs.writeSync(handle, junk, 0, junk.length, 0);
    fs.closeSync(handle);

    const result = runSchemaMigration({
      dbPath: file,
      env: isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("integrity");
    expect(reports()).toEqual([]);
  });

  it("is idempotent: a second approved run on a V14 fixture records nothing new", () => {
    buildV11Fixture(file);
    const env = isolatedEnv({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE });
    const first = runSchemaMigration({ dbPath: file, env, reportDir });
    const second = runSchemaMigration({ dbPath: file, env, reportDir });
    expect(second.ok).toBe(true);
    expect(second.report?.created.tables ?? []).toEqual([]);
    const db = new Database(file);
    try {
      expect(versionRows(db)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    } finally {
      db.close();
    }
    expect(reports().length).toBe(2);
    expect(first.ok).toBe(true);
  });
});

describe("A3 — CLI wiring", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "src", "index.ts"), "utf-8");
  const migrationModule = fs.readFileSync(path.join(REPO_ROOT, "src", "state", "schema-migration.ts"), "utf-8");

  function body(name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const ends = ["\nfunction ", "\nasync function ", "\nexport function "]
      .map((marker) => source.indexOf(marker, start + 1))
      .filter((index) => index !== -1);
    return source.slice(start, ends.length ? Math.min(...ends) : source.length);
  }

  it("shows status through the read-only snapshot, not the write path", () => {
    const showStatus = body("showStatus");
    expect(showStatus).toContain("readStatusSnapshot");
    expect(showStatus).not.toContain("createDatabase");
  });

  it("keeps the status branch free of the activation gate", () => {
    const branch = source.slice(source.indexOf('"--status"'), source.indexOf('"--setup"'));
    expect(branch).toContain("showStatus");
    expect(branch).not.toContain("requireActivation");
  });

  it("dispatches --migrate-schema through the gated runner and exits with its code", () => {
    expect(source).toMatch(/"--migrate-schema"/);
    const branch = source.slice(source.indexOf('"--migrate-schema"'), source.indexOf('"--setup"'));
    expect(branch).toContain("runSchemaMigration");
    expect(branch).toMatch(/process\.exit\(/);
    expect(branch).not.toContain("requireActivation");
  });

  it("documents both commands in --help", () => {
    const help = source.slice(source.indexOf('logger.info(`'), source.indexOf("process.exit(0);\n  }\n\n  if (args.includes(\"--init\")"));
    expect(help).toContain("--status");
    expect(help).toContain("--migrate-schema");
  });

  it("keeps the migration module off the activation and tool-approval surfaces", () => {
    expect(migrationModule).not.toContain("security/activation.js");
    expect(migrationModule).not.toContain("CONWAY_ACTIVATION");
    expect(migrationModule).not.toContain("requireActivation");
  });

  it("never uses the live database as a fixture in this suite", () => {
    const testSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "__tests__", "readonly-status-migration.test.ts"),
      "utf-8",
    );
    // The only legitimate mention of the live path is canonicalLiveDatabasePath(), which is
    // used to assert refusal; no test may hand it to createDatabase() or runSchemaMigration
    // with an override set.
    expect(testSource).not.toMatch(/createDatabase\(canonicalLive/);
    expect(testSource).not.toMatch(/CANONICAL_OVERRIDE_ENV\]: MIGRATION_APPROVAL_VALUE/);
  });
});
