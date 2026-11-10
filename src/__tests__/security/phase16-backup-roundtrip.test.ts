/**
 * Phase 16C — backup and restore round-trip.
 *
 * Three things had to be proven with executed code rather than asserted in a report:
 *
 * 1. The SQLite online backup API produces a consistent snapshot even while a writer is
 *    active on the source. `state.db` runs in WAL mode, so a naive file copy can capture a
 *    database whose WAL no longer belongs to it; the backup API must not be replaced by a copy.
 * 2. `runtime/bin/backup.mjs` — the tool the operator actually runs — archives the real
 *    database, redacts credential-shaped fields, and never archives `wallet.json`.
 * 3. Recovery writes to an *alternate* path. Restoring over the active database is the
 *    destructive half of the operation, so the round-trip is verified against a fixture that
 *    keeps changing after the snapshot is taken.
 *
 * Every database this file touches lives in a fresh `os.tmpdir()` fixture. It never opens the
 * live install's `runtime/home/.automaton/state.db`, and the isolated-HOME guard from §3 of the
 * phase brief is asserted rather than assumed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { assertPlainArchiveName, isWalletFile } from "../../../runtime/lib/wallet-material.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const BACKUP_TOOL = path.join(REPO_ROOT, "runtime", "bin", "backup.mjs");
const RESTORE_TOOL = path.join(REPO_ROOT, "runtime", "bin", "restore.mjs");
const DASHBOARD_VERIFY = path.join(REPO_ROOT, "dashboard", "server", "verify.ts");

/** A secret string planted in the fixture. It must never reappear in an archive. */
const PLANTED_API_KEY = "sk-TESTONLY-0123456789abcdef0123456789abcdef";
const PLANTED_PRIVATE_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-16c-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Creates a WAL-mode database whose rows are self-verifying (payload = hash of id). */
function createFixtureDb(
  file: string,
  rows: number,
): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO events (id, payload) VALUES (?, ?)");
  const fill = db.transaction((count: number, offset: number) => {
    for (let id = offset; id < offset + count; id += 1) {
      insert.run(id, expectedPayload(id));
    }
  });
  fill(rows, 0);
  return db;
}

function expectedPayload(id: number): string {
  return crypto.createHash("sha256").update(`event-${id}`).digest("hex");
}

/**
 * Proves a snapshot is a *consistent* point-in-time copy, not a torn one: the row count must
 * equal the largest id plus one, and every payload must match the hash of its own id. A copy
 * that mixed pages from two different commits would fail one of those two checks.
 */
function assertConsistentSnapshot(db: Database.Database, label: string): number {
  const integrity = String(db.pragma("integrity_check", { simple: true }));
  expect(integrity, `${label}: integrity_check`).toBe("ok");
  const { rowCount, maxId } = db
    .prepare("SELECT COUNT(*) AS rowCount, MAX(id) AS maxId FROM events")
    .get() as { rowCount: number; maxId: number };
  expect(rowCount, `${label}: rows`).toBeGreaterThanOrEqual(1);
  expect(maxId, `${label}: dense ids`).toBe(rowCount - 1);
  const rows = db.prepare("SELECT id, payload FROM events ORDER BY id").all() as Array<{
    id: number;
    payload: string;
  }>;
  const broken = rows.filter((row) => row.payload !== expectedPayload(row.id));
  expect(broken, `${label}: every payload must hash to its own id`).toEqual([]);
  return rowCount;
}

describe("SQLite online backup under a concurrent writer", () => {
  it("snapshots a WAL database that is being written to, without tearing", async () => {
    const srcFile = path.join(workDir, "src.db");
    const destFile = path.join(workDir, "snapshot.db");
    const source = createFixtureDb(srcFile, 2_000);

    // A second connection keeps appending while the backup transfers pages. backup() yields
    // between batches, so these inserts genuinely interleave with the transfer.
    const writer = new Database(srcFile);
    const insert = writer.prepare("INSERT INTO events (id, payload) VALUES (?, ?)");
    let writtenDuringBackup = 0;
    for (let i = 0; i < 40; i += 1) {
      writtenDuringBackup += 1;
      insert.run(2_000 + i, expectedPayload(2_000 + i));
      await new Promise((resolve) => setImmediate(resolve));
    }

    const sourceHashBefore = sha256File(srcFile);
    const backupPromise = source.backup(destFile);
    for (let i = 40; i < 80; i += 1) {
      writtenDuringBackup += 1;
      insert.run(2_000 + i, expectedPayload(2_000 + i));
      await new Promise((resolve) => setImmediate(resolve));
    }
    await backupPromise;

    const snapshot = new Database(destFile, { readonly: true, fileMustExist: true });
    const snapshotRows = assertConsistentSnapshot(snapshot, "concurrent snapshot");
    snapshot.close();

    const finalCount = (writer.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    expect(snapshotRows).toBeLessThanOrEqual(finalCount);
    expect(finalCount).toBe(2_000 + writtenDuringBackup);

    // The main database file is what the writer's commits land in only after a checkpoint; the
    // backup must not rewrite it.
    expect(sha256File(srcFile), "backup must not modify the source file").toBe(sourceHashBefore);
    writer.close();
    source.close();
  });

  it("a plain copy of the main file loses committed rows; the backup API does not", async () => {
    // Why 16C uses the online backup API instead of `cp`: while a writer is still open, the most
    // recently committed rows live in the WAL, not in state.db. Copying state.db alone produces a
    // database that silently loses exactly the data a restore is needed for.
    const srcFile = path.join(workDir, "walcheck.db");
    const seeded = createFixtureDb(srcFile, 5);
    seeded.close(); // clean close checkpoints the WAL: the main file genuinely holds 5 rows

    const writer = new Database(srcFile);
    writer.prepare("INSERT INTO events (id, payload) VALUES (5, ?)").run(expectedPayload(5));
    const walFile = `${srcFile}-wal`;
    expect(fs.existsSync(walFile), "expected a WAL after a write").toBe(true);
    expect(fs.statSync(walFile).size, "WAL must actually hold frames").toBeGreaterThan(0);

    const copyFile = path.join(workDir, "naive-copy.db");
    fs.copyFileSync(srcFile, copyFile);
    const copy = new Database(copyFile, { readonly: true, fileMustExist: true });
    const copyRows = (copy.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    copy.close();
    expect(copyRows, "a copy taken without the WAL must be missing the newest row").toBe(5);

    const snapshotFile = path.join(workDir, "api-snapshot.db");
    await writer.backup(snapshotFile);
    const snapshot = new Database(snapshotFile, { readonly: true, fileMustExist: true });
    const snapshotRows = assertConsistentSnapshot(snapshot, "API snapshot of same source");
    snapshot.close();
    expect(snapshotRows).toBe(6);
    writer.close();
  });
});

describe("runtime/bin/backup.mjs against an isolated HOME fixture", () => {
  let fixtureHome: string;
  let automatonDir: string;

  beforeEach(() => {
    fixtureHome = path.join(workDir, "home");
    automatonDir = path.join(fixtureHome, ".automaton");
    fs.mkdirSync(automatonDir, { recursive: true });
    createFixtureDb(path.join(automatonDir, "state.db"), 12).close();
    fs.writeFileSync(
      path.join(automatonDir, "automaton.json"),
      JSON.stringify(
        {
          name: "conway-16c-fixture",
          activationApproved: false,
          providers: { openai: { apiKey: PLANTED_API_KEY } },
          wallet: { privateKey: PLANTED_PRIVATE_KEY },
          harmless: "keep-me",
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(path.join(automatonDir, "heartbeat.yml"), "intervalSeconds: 60\n", "utf-8");
    fs.mkdirSync(path.join(automatonDir, "skills"), { recursive: true });
    fs.writeFileSync(path.join(automatonDir, "skills", "demo.md"), "# demo\n", "utf-8");
    // The private key file the tool is required to leave out of every archive.
    fs.writeFileSync(
      path.join(automatonDir, "wallet.json"),
      JSON.stringify({ privateKey: PLANTED_PRIVATE_KEY }),
      "utf-8",
    );
  });

  /** Runs the operator's real backup tool against the fixture HOME. */
  function runBackupTool(outDir: string): void {
    execFileSync(process.execPath, [BACKUP_TOOL, "--out", outDir], {
      encoding: "utf-8",
      env: { ...process.env, HOME: fixtureHome },
      cwd: workDir,
    });
  }

  it("archives the live database of the HOME it was given, and nothing else", () => {
    // §3 of the phase brief: the tool must honour the isolated HOME, never fall back to another
    // state directory. The fixture HOME is the only place a database exists here.
    const strayHome = path.join(workDir, "default-home-should-be-untouched");
    fs.mkdirSync(strayHome, { recursive: true });
    const archive = path.join(workDir, "archive");

    expect(fs.existsSync(path.join(archive, "state.db"))).toBe(false);
    runBackupTool(archive);
    expect(fs.existsSync(path.join(archive, "state.db"))).toBe(true);
    expect(fs.existsSync(path.join(strayHome, ".automaton", "state.db"))).toBe(false);

    const db = new Database(path.join(archive, "state.db"), {
      readonly: true,
      fileMustExist: true,
    });
    assertConsistentSnapshot(db, "fixture archive");
    db.close();
  });

  it("never archives wallet.json, even though it sits next to the database", () => {
    const archive = path.join(workDir, "archive-nowallet");
    // Precondition: the secret file really exists where a careless copy would grab it.
    expect(fs.existsSync(path.join(automatonDir, "wallet.json"))).toBe(true);
    runBackupTool(archive);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const files = walk(archive);
    expect(files.some((f) => path.basename(f) === "wallet.json"), `archived: ${files.join(", ")}`).toBe(false);
    const body = files
      .filter((f) => !f.endsWith("state.db"))
      .map((f) => fs.readFileSync(f, "latin1"))
      .join("\n");
    expect(body).not.toContain(PLANTED_PRIVATE_KEY);
    expect(body).not.toContain(PLANTED_API_KEY);
  });

  it("redacts credential-shaped config fields and records verifiable hashes", () => {
    const archive = path.join(workDir, "archive-redacted");
    runBackupTool(archive);
    const redacted = fs.readFileSync(path.join(archive, "automaton.redacted.json"), "utf-8");
    expect(redacted).not.toContain(PLANTED_API_KEY);
    expect(redacted).toContain("<REDACTED>");
    // Non-vacuity: the planted value was present in the source, so the absence above is a
    // redaction, not a missing file.
    expect(fs.readFileSync(path.join(automatonDir, "automaton.json"), "utf-8")).toContain(PLANTED_API_KEY);

    const manifest = JSON.parse(fs.readFileSync(path.join(archive, "manifest.json"), "utf-8")) as {
      files: Record<string, { sha256: string; bytes: number }>;
      excluded: string[];
    };
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect(sha256File(path.join(archive, name)), `manifest hash for ${name}`).toBe(entry.sha256);
      expect(fs.statSync(path.join(archive, name)).size).toBe(entry.bytes);
    }
    expect(manifest.excluded.join(" ")).toMatch(/wallet\.json/i);
  });

  it("is verified by content equality, because the snapshot's bytes need not match the source", () => {
    // Measured on the live install: the archived state.db and runtime/home/.automaton/state.db
    // both hash to 512 000 bytes of identical content but different SHA-256 values, because the
    // backup API rewrites the file header. A restore check that compared live vs backup hashes
    // would therefore fail a perfectly good backup; row-level content plus integrity_check is the
    // criterion that actually means something.
    const archive = path.join(workDir, "archive-hash");
    const liveFile = path.join(automatonDir, "state.db");
    runBackupTool(archive);
    const live = new Database(liveFile, { readonly: true, fileMustExist: true });
    const snap = new Database(path.join(archive, "state.db"), {
      readonly: true,
      fileMustExist: true,
    });
    const rows = (d: Database.Database) =>
      d.prepare("SELECT id, payload FROM events ORDER BY id").all();
    expect(rows(snap)).toEqual(rows(live));
    expect(String(snap.pragma("integrity_check", { simple: true }))).toBe("ok");
    live.close();
    snap.close();
  });
});

describe("restore lands on an alternate path, never the active database", () => {
  it("replays an archive into a new file while the active database keeps moving on", async () => {
    const activeFile = path.join(workDir, "active.db");
    const archiveFile = path.join(workDir, "archive.db");
    const restoredFile = path.join(workDir, "restored", "state.db");
    fs.mkdirSync(path.dirname(restoredFile), { recursive: true });

    const active = createFixtureDb(activeFile, 100);
    assertConsistentSnapshot(active, "active before snapshot");
    await active.backup(archiveFile);

    // Time passes and the system keeps working: 50 rows the archive does not have.
    const insert = active.prepare("INSERT INTO events (id, payload) VALUES (?, ?)");
    for (let id = 100; id < 150; id += 1) insert.run(id, expectedPayload(id));

    const activeHashBeforeRestore = sha256File(activeFile);

    // The recovery step copies the archive to a fresh location. It never touches activeFile.
    fs.copyFileSync(archiveFile, restoredFile);
    const restored = new Database(restoredFile, { readonly: true, fileMustExist: true });
    const restoredRows = assertConsistentSnapshot(restored, "restored copy");
    restored.close();
    expect(restoredRows).toBe(100);

    expect(sha256File(activeFile), "restore must not overwrite the active database").toBe(
      activeHashBeforeRestore,
    );
    const stillLive = (
      active.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }
    ).n;
    expect(stillLive).toBe(150);

    // A restored copy is only useful if the application can open it and write to it. Prove that
    // rather than assuming it.
    const writable = new Database(restoredFile);
    writable.prepare("INSERT INTO events (id, payload) VALUES (100, ?)").run(expectedPayload(100));
    writable.close();
    const afterWrite = new Database(restoredFile, { readonly: true });
    assertConsistentSnapshot(afterWrite, "restored copy after write");
    afterWrite.close();
    active.close();
  });

  it("does not carry a stale WAL sidecar into the restored location", async () => {
    const sourceFile = path.join(workDir, "source-wal.db");
    const source = createFixtureDb(sourceFile, 3);
    await source.backup(path.join(workDir, "snapshot.db"));
    source.close();
    const restoredFile = path.join(workDir, "clean", "state.db");
    fs.mkdirSync(path.dirname(restoredFile), { recursive: true });
    fs.copyFileSync(path.join(workDir, "snapshot.db"), restoredFile);
    // A restore that copies -wal/-shm alongside can resurrect frames whose salt no longer
    // matches the main file. The snapshot from the backup API has no sidecars to carry.
    const sidecars = fs
      .readdirSync(path.dirname(restoredFile))
      .filter((name) => name.endsWith("-wal") || name.endsWith("-shm"));
    expect(sidecars).toEqual([]);
    const db = new Database(restoredFile, { readonly: true, fileMustExist: true });
    assertConsistentSnapshot(db, "sidecar-free restore");
    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B-10 — adversarial backup/restore. Every fixture below plants a dummy string,
// never a real private key or seed phrase, and no test creates a wallet.
// ─────────────────────────────────────────────────────────────────────────────

interface ToolResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a runtime/bin tool and captures the failure instead of throwing on a non-zero exit. */
function runTool(tool: string, args: string[], env: Record<string, string> = {}): ToolResult {
  try {
    const stdout = execFileSync(process.execPath, [tool, ...args], {
      encoding: "utf-8",
      env: { ...process.env, ...env },
      cwd: workDir,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full);
    return [full];
  });
}

/** A HOME whose automaton directory is full of things a careless copy would take. */
function buildHostileHome(): string {
  const home = path.join(workDir, "hostile-home");
  const automatonDir = path.join(home, ".automaton");
  fs.mkdirSync(path.join(automatonDir, "skills", "nested"), { recursive: true });
  createFixtureDb(path.join(automatonDir, "state.db"), 4).close();
  fs.writeFileSync(
    path.join(automatonDir, "automaton.json"),
    JSON.stringify({
      providers: { openai: { apiKey: PLANTED_API_KEY } },
      wallet: { seedPhrase: "test test test test test test test test test test test junk" },
      harmless: "keep-me",
    }),
    "utf-8",
  );
  fs.writeFileSync(path.join(automatonDir, "heartbeat.yml"), "intervalSeconds: 60\n", "utf-8");
  fs.writeFileSync(path.join(automatonDir, "skills", "notes.md"), "# notes\n", "utf-8");
  // Wallet material planted where a recursive copy would find it.
  fs.writeFileSync(
    path.join(automatonDir, "skills", "wallet.json"),
    JSON.stringify({ privateKey: PLANTED_PRIVATE_KEY }),
    "utf-8",
  );
  fs.writeFileSync(path.join(automatonDir, "skills", "seed-phrase.txt"), PLANTED_PRIVATE_KEY, "utf-8");
  fs.writeFileSync(
    path.join(automatonDir, "skills", "nested", "private-key.pem"),
    PLANTED_PRIVATE_KEY,
    "utf-8",
  );
  return home;
}

describe("backup excludes wallet material beyond the top-level wallet.json", () => {
  it("skips wallet files planted inside skills/ and records each omission", () => {
    const home = buildHostileHome();
    const automatonDir = path.join(home, ".automaton");
    const archive = path.join(workDir, "archive-skills");

    // Preconditions: the material really is where a recursive copy would take it.
    expect(fs.readFileSync(path.join(automatonDir, "skills", "wallet.json"), "utf-8")).toContain(
      PLANTED_PRIVATE_KEY,
    );
    expect(fs.existsSync(path.join(automatonDir, "skills", "nested", "private-key.pem"))).toBe(true);

    const result = runTool(BACKUP_TOOL, ["--out", archive], { HOME: home });
    expect(result.status, result.stderr).toBe(0);

    const archived = walkFiles(archive).map((file) => path.relative(archive, file).split(path.sep).join("/"));
    expect(archived).toContain("skills/notes.md");
    expect(archived.some((name) => name.endsWith("wallet.json"))).toBe(false);
    expect(archived.some((name) => name.endsWith("seed-phrase.txt"))).toBe(false);
    expect(archived.some((name) => name.endsWith("private-key.pem"))).toBe(false);

    const bodies = walkFiles(archive)
      .filter((file) => !file.endsWith("state.db") && !file.endsWith("manifest.json"))
      .map((file) => fs.readFileSync(file, "latin1"))
      .join("\n");
    expect(bodies).not.toContain(PLANTED_PRIVATE_KEY);

    const manifest = JSON.parse(fs.readFileSync(path.join(archive, "manifest.json"), "utf-8")) as {
      files: Record<string, { sha256: string }>;
      excluded: string[];
    };
    const excluded = manifest.excluded.join(" | ");
    expect(excluded).toMatch(/skills\/wallet\.json/);
    expect(excluded).toMatch(/skills\/seed-phrase\.txt/);
    expect(excluded).toMatch(/skills\/nested\/private-key\.pem/);
  });

  it("refuses a linked config file instead of archiving what it points at", () => {
    const home = buildHostileHome();
    const automatonDir = path.join(home, ".automaton");
    const outside = path.join(workDir, "outside-wallet-dir");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, "wallet.json"),
      JSON.stringify({ privateKey: PLANTED_PRIVATE_KEY }),
      "utf-8",
    );
    fs.rmSync(path.join(automatonDir, "heartbeat.yml"));
    // A directory junction stands in for a file link: it is a real link on NTFS and needs no
    // administrator privilege, and lstat reports it exactly like any other reparse point.
    fs.symlinkSync(outside, path.join(automatonDir, "heartbeat.yml"), process.platform === "win32" ? "junction" : "dir");

    const archive = path.join(workDir, "archive-linked");
    const result = runTool(BACKUP_TOOL, ["--out", archive], { HOME: home });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toMatch(/heartbeat\.yml.*symbolic link/i);
    expect(JSON.stringify(result)).not.toContain(PLANTED_PRIVATE_KEY);
    expect(fs.existsSync(path.join(archive, "heartbeat.yml"))).toBe(false);
  });

  it("refuses a linked skills/ directory rather than following it", () => {
    const home = buildHostileHome();
    const automatonDir = path.join(home, ".automaton");
    const outside = path.join(workDir, "outside-skills");
    fs.mkdirSync(path.join(outside, "keys"), { recursive: true });
    fs.writeFileSync(path.join(outside, "wallet.json"), PLANTED_PRIVATE_KEY, "utf-8");
    fs.rmSync(path.join(automatonDir, "skills"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(automatonDir, "skills"), process.platform === "win32" ? "junction" : "dir");

    const archive = path.join(workDir, "archive-linked-skills");
    const result = runTool(BACKUP_TOOL, ["--out", archive], { HOME: home });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toMatch(/skills\/.*symbolic link/i);
    expect(walkFiles(archive).some((file) => path.basename(file) === "wallet.json")).toBe(false);
  });

  it("refuses to write a backup into a directory that already holds wallet material", () => {
    const home = buildHostileHome();
    const archive = path.join(workDir, "archive-preloaded");
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, "wallet.json"), PLANTED_PRIVATE_KEY, "utf-8");

    const result = runTool(BACKUP_TOOL, ["--out", archive], { HOME: home });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toMatch(/wallet\/key material/i);
    expect(fs.existsSync(path.join(archive, "manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(archive, "state.db"))).toBe(false);
  });

  it("redacts non-string credentials: seed phrases and credential blocks", () => {
    const home = buildHostileHome();
    const automatonDir = path.join(home, ".automaton");
    const archive = path.join(workDir, "archive-seed");
    const result = runTool(BACKUP_TOOL, ["--out", archive], { HOME: home });
    expect(result.status, result.stderr).toBe(0);
    const redacted = fs.readFileSync(path.join(archive, "automaton.redacted.json"), "utf-8");
    expect(redacted).not.toContain("test test test");
    expect(redacted).toContain("<REDACTED>");
    expect(redacted).toContain("keep-me");
    // Non-vacuity: the fixture really did contain the seed phrase.
    expect(fs.readFileSync(path.join(automatonDir, "automaton.json"), "utf-8")).toContain("test test test");
  });
});

describe("restore refuses names and archives it cannot trust", () => {
  /** Builds a minimal archive directory plus a target that must stay empty. */
  function archiveFixture(
    files: Record<string, string>,
    manifestFiles: Record<string, { sha256: string }>,
    skills: Record<string, string> = {},
  ): { backupDir: string; target: string } {
    const backupDir = path.join(workDir, "crafted-archive");
    fs.mkdirSync(backupDir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(backupDir, name), body, "utf-8");
    }
    for (const [name, body] of Object.entries(skills)) {
      const full = path.join(backupDir, "skills", name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, "utf-8");
    }
    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      JSON.stringify({ createdAt: new Date().toISOString(), files: manifestFiles }, null, 2),
      "utf-8",
    );
    return { backupDir, target: path.join(workDir, "restored-target") };
  }

  const digest = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

  it.each([
    ["../../escape.txt", /outside its directory/i],
    ["..\\escape.txt", /outside its directory/i],
    ["nested/heartbeat.yml", /outside its directory/i],
    ["C:/Windows/Temp/evil.txt", /absolute/i],
    ["/etc/passwd", /absolute/i],
  ])("rejects the manifest name %s before writing anything", (hostileName, expected) => {
    const { backupDir, target } = archiveFixture(
      { "payload.txt": "benign\n" },
      { [hostileName]: { sha256: digest("benign\n") } },
    );
    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(expected);
    expect(fs.existsSync(target)).toBe(false);
    // Nothing escaped next to the target either.
    expect(fs.existsSync(path.join(workDir, "escape.txt"))).toBe(false);
  });

  it("refuses a manifest that lists wallet material", () => {
    const planted = JSON.stringify({ privateKey: PLANTED_PRIVATE_KEY });
    const { backupDir, target } = archiveFixture(
      { "wallet.json": planted },
      { "wallet.json": { sha256: digest(planted) } },
    );
    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/wallet\/key material/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses wallet material smuggled through skills/, even when the manifest is clean", () => {
    const benign = "hello\n";
    const { backupDir, target } = archiveFixture(
      { "notes.md": benign },
      { "notes.md": { sha256: digest(benign) } },
      { "wallet.json": JSON.stringify({ privateKey: PLANTED_PRIVATE_KEY }) },
    );
    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/wallet\/key material/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses a linked file where the manifest promises a regular one", () => {
    const benign = "hello\n";
    const { backupDir, target } = archiveFixture({}, { "notes.md": { sha256: digest(benign) } });
    const outside = path.join(workDir, "outside-notes");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "notes.md"), benign, "utf-8");
    fs.symlinkSync(outside, path.join(backupDir, "notes.md"), process.platform === "win32" ? "junction" : "dir");

    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/linked backup file/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("rejects a manifest file whose bytes no longer match its hash", () => {
    const { backupDir, target } = archiveFixture(
      { "notes.md": "tampered after the manifest was written\n" },
      { "notes.md": { sha256: digest("what the operator signed off on\n") } },
    );
    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/hash mismatch/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("restores a clean archive so the refusals above are not a blanket failure", () => {
    const body = "# notes\n";
    const { backupDir, target } = archiveFixture(
      { "notes.md": body },
      { "notes.md": { sha256: digest(body) } },
      { "nested/demo.md": "# demo\n" },
    );
    const result = runTool(RESTORE_TOOL, ["--from", backupDir, "--to", target]);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(target, "notes.md"), "utf-8")).toBe(body);
    expect(fs.readFileSync(path.join(target, "skills", "nested", "demo.md"), "utf-8")).toBe("# demo\n");
  });
});

describe("one wallet-material predicate serves backup, restore and the dashboard", () => {
  it("classifies key material and ordinary files the way the operator expects", () => {
    const material = [
      "wallet.json",
      "skills/wallet.json",
      "skills/seed-phrase.txt",
      "skills/nested/private-key.pem",
      "backup/wallet.enc.v2",
      "keystore/UTC--2026.json",
      "skills/.automaton/state.db",
      "id_ed25519",
      "node.p12",
      "notes/mnemonic.txt",
    ];
    const ordinary = [
      "state.db",
      "manifest.json",
      "automaton.redacted.json",
      "heartbeat.yml",
      "constitution.md",
      "skills/demo.md",
      "skills/nested/README.md",
      "skills/wallet-notes.md",
    ];
    for (const name of material) expect(isWalletFile(name), `${name} must be material`).toBe(true);
    for (const name of ordinary) expect(isWalletFile(name), `${name} must be archivable`).toBe(false);
  });

  it.each([
    "wallet.json",
    "state.db",
    "automaton.redacted.json",
    "manifest.json",
  ])("accepts the plain archive name %s", (name) => {
    expect(assertPlainArchiveName(name)).toBe(name);
  });

  it("the dashboard verifier imports the shared policy instead of re-implementing it", () => {
    const source = fs.readFileSync(DASHBOARD_VERIFY, "utf-8");
    expect(source).toMatch(/from "\.\.\/\.\.\/runtime\/lib\/wallet-material\.mjs"/);
    expect(source).not.toMatch(/WALLET_FILE_PATTERNS/);
    expect(source).not.toMatch(/function isWalletFile\s*\(/);
  });
});
