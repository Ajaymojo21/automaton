/**
 * Phase 15K — backup and recovery validation.
 *
 * Three jobs, all read-only against the live install:
 *   1. verify the archived backup's manifest hashes and SQLite integrity;
 *   2. scan every archive artifact for plaintext key material;
 *   3. restore the archive into a disposable temp directory, confirm the
 *      migration path and audit chain work on the copy, and prove that no live
 *      path (active database, config, home state) was written to.
 *
 * It never restores over an active database. Usage (pinned runtime is required
 * for the better-sqlite3 ABI):
 *   ./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
 *     scripts/phase15-backup-validate.ts --archive backups/2026-10-31_10-27-31
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDatabase } from "../src/state/database.js";
import { appendSecurityEvent, verifySecurityChain } from "../src/security/audit-chain.js";

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "key_field_value", pattern: /"(?:privateKey|private_key|secretKey|secret_key|seedPhrase|mnemonic|recoveryPhrase)"\s*:\s*"[^"]{16,}"/ },
  { id: "pem_private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "hex_key_context", pattern: /(?:privatekey|secretkey|seed|mnemonic|recovery)[^\n]{0,24}(?:0x)?[0-9a-f]{32,}/i },
  { id: "openai_key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { id: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9-]{20,}/ },
  { id: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/ },
];

const TEXT_SUFFIXES = new Set([".json", ".yml", ".yaml", ".txt", ".md", ".db", ".cfg", ".ini"]);

/**
 * The live paths this run must not write to.
 *
 * `dbPath` in the config is `~/.automaton/state.db` and the app resolves `~` against
 * `process.env.HOME` (resolvePath in src/config.ts), while the .bat wrappers point HOME at
 * runtime/home. `os.homedir()` follows USERPROFILE and ignores HOME, so a guard list built from
 * it alone resolves to a file that does not exist, and `livePathsUntouched` then reported PASS
 * while signing nothing at the location the live database actually occupies.
 */
function liveGuardPaths(): string[] {
  const homes = [process.env.HOME, os.homedir()].filter((h): h is string => Boolean(h));
  const dbPaths = homes.map((home) => path.join(home, ".automaton", "state.db"));
  return Array.from(new Set(["data", "config", ...dbPaths]));
}

const LIVE_GUARD_PATHS = liveGuardPaths();

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = argv[i + 1] ?? "true";
  }
  return out;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Signature of the live paths, so the run can prove it did not touch them. */
function snapshotLivePaths(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const target of LIVE_GUARD_PATHS) {
    if (!fs.existsSync(target)) {
      out[target] = "absent";
      continue;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(target).sort().map((name) => {
        const full = path.join(target, name);
        return fs.statSync(full).isDirectory() ? `${name}/` : `${name}:${sha256File(full)}`;
      });
      out[target] = entries.join("|");
    } else {
      out[target] = sha256File(target);
    }
  }
  return out;
}

function listArchiveFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listArchiveFiles(full));
    else out.push(full);
  }
  return out;
}

function verifyManifest(dir: string): Record<string, unknown> {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { present: false, mismatches: [], missing: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    files?: Record<string, { sha256?: string; bytes?: number }>;
  };
  const mismatches: string[] = [];
  const missing: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files ?? {})) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      missing.push(name);
      continue;
    }
    if (expected.sha256 && sha256File(file) !== expected.sha256) mismatches.push(name);
  }
  return { present: true, entries: Object.keys(manifest.files ?? {}).length, mismatches, missing };
}

/**
 * Returns file plus pattern id plus count only. The matched text is never
 * returned: a secret scanner must not become a second disclosure channel.
 */
function scanForSecrets(files: string[]): Array<{ file: string; pattern: string; count: number }> {
  const hits: Array<{ file: string; pattern: string; count: number }> = [];
  for (const file of files) {
    if (!TEXT_SUFFIXES.has(path.extname(file).toLowerCase())) continue;
    const text = fs.readFileSync(file, "latin1");
    for (const { id, pattern } of SECRET_PATTERNS) {
      const count = [...text.matchAll(new RegExp(pattern, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].length;
      if (count > 0) hits.push({ file, pattern: id, count });
    }
  }
  return hits;
}

function tableCounts(db: Database.Database): Record<string, number> {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const out: Record<string, number> = {};
  for (const { name } of names) out[name] = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
  return out;
}

function integrityCheck(file: string): string {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return String(db.pragma("integrity_check", { simple: true }));
  } finally {
    db.close();
  }
}

/** Restores into `dest`, which the caller created inside the OS temp directory. */
function restoreIntoDisposable(archiveDb: string, dest: string): Record<string, unknown> {
  fs.copyFileSync(archiveDb, dest);
  const app = createDatabase(dest);
  try {
    const before = tableCounts(app.raw);
    appendSecurityEvent(app.raw, {
      severity: "INFO",
      category: "system",
      eventType: "restore.validation",
      details: { validatedAt: new Date().toISOString() },
    });
    const chain = verifySecurityChain(app.raw);
    const after = tableCounts(app.raw);
    const lost = Object.entries(before).filter(([t, n]) => (after[t] ?? 0) < n).map(([t]) => t);
    return {
      integrity: String(app.raw.pragma("integrity_check", { simple: true })),
      chainValid: chain.valid,
      chainReason: chain.reason ?? null,
      schemaVersion: (app.raw.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v,
      securityEventsTable: Boolean(after.security_events),
      securityEventsAfterWrite: after.security_events ?? 0,
      tablesLostOnMigration: lost,
      tablesBefore: Object.keys(before).length,
      tablesAfter: Object.keys(after).length,
    };
  } finally {
    app.close();
  }
}

function main(): { status: string; failed: string[] } {
  const args = parseArgs(process.argv.slice(2));
  const archive = path.resolve(args.archive ?? "backups/2026-10-31_10-27-31");
  if (!fs.existsSync(path.join(archive, "state.db"))) {
    throw new Error(`no archived state.db under ${archive}`);
  }
  const liveBefore = snapshotLivePaths();
  const files = listArchiveFiles(archive);
  const manifest = verifyManifest(archive);
  const secretHits = scanForSecrets(files);
  const archiveIntegrity = integrityCheck(path.join(archive, "state.db"));

  const archiveDb = path.join(archive, "state.db");
  const db = new Database(archiveDb, { readonly: true, fileMustExist: true });
  let archiveCounts: Record<string, number>;
  try {
    archiveCounts = tableCounts(db);
  } finally {
    db.close();
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "conway-15k-restore-"));
  const dest = path.join(work, "restored.db");
  let restore: Record<string, unknown>;
  try {
    restore = restoreIntoDisposable(archiveDb, dest);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const liveAfter = snapshotLivePaths();
  return writeReport({
    archive,
    files,
    manifest,
    secretHits,
    archiveIntegrity,
    nonEmptyArchiveTables: Object.entries(archiveCounts).filter(([, n]) => n > 0),
    restore,
    liveBefore,
    liveAfter,
    restoreDest: dest,
    outPath: args.out ?? path.join("reports", "PHASE_15_BACKUP_RAW.json"),
  });
}

function writeReport(parts: {
  archive: string;
  files: string[];
  manifest: Record<string, unknown>;
  secretHits: Array<{ file: string; pattern: string; count: number }>;
  archiveIntegrity: string;
  nonEmptyArchiveTables: Array<[string, number]>;
  restore: Record<string, unknown>;
  liveBefore: Record<string, string>;
  liveAfter: Record<string, string>;
  restoreDest: string;
  outPath: string;
}): { status: string; failed: string[] } {
  const { archive, restore } = parts;
  const mismatches = (parts.manifest.mismatches as string[]) ?? [];
  const missing = (parts.manifest.missing as string[]) ?? [];
  const verdicts = {
    manifestHashesMatch: parts.manifest.present === true && mismatches.length === 0 && missing.length === 0,
    archiveIntegrityOk: parts.archiveIntegrity === "ok",
    noPlaintextKeyMaterial: parts.secretHits.length === 0,
    restoreIntegrityOk: restore.integrity === "ok",
    restoredChainValid: restore.chainValid === true,
    restoreMigratedSchema: Boolean(restore.securityEventsTable),
    noRowsLostOnRestore: Array.isArray(restore.tablesLostOnMigration) && restore.tablesLostOnMigration.length === 0,
    livePathsUntouched: JSON.stringify(parts.liveBefore) === JSON.stringify(parts.liveAfter),
    // A guard list that resolves to nothing is a cosmetic PASS. If a database exists at any
    // candidate path, that path has to be one this run actually signed.
    liveDbGuardNonVacuous: Object.entries(parts.liveBefore)
      .filter(([target]) => target.endsWith(path.join(".automaton", "state.db")))
      .some(([, signature]) => signature !== "absent"),
    restoreWasDisposable: path
      .resolve(parts.restoreDest)
      .toLowerCase()
      .startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()),
  };
  const failed = Object.entries(verdicts).filter(([, ok]) => !ok).map(([name]) => name);
  const evidence = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    archive,
    archiveFiles: parts.files.map((f) => path.relative(archive, f)),
    manifest: parts.manifest,
    archiveIntegrity: parts.archiveIntegrity,
    nonEmptyArchiveTables: parts.nonEmptyArchiveTables,
    secretScan: { patterns: SECRET_PATTERNS.map((p) => p.id), hits: parts.secretHits },
    restore: { ...parts.restore, location: "<os temp>/conway-15k-restore-*" },
    livePaths: { before: parts.liveBefore, after: parts.liveAfter },
    verdicts,
    failedVerdicts: failed,
    status: failed.length === 0 ? "PASS" : "FAIL",
  };
  const outPath = parts.outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf-8");
  console.log(
    `15K: archive=${path.basename(archive)} manifest=${parts.manifest.present} ` +
      `secrets=${parts.secretHits.length} restore=${restore.integrity} chain=${restore.chainValid} ` +
      `status=${evidence.status}`,
  );
  if (failed.length) console.log(`failed verdicts: ${failed.join(", ")}`);
  return { status: evidence.status, failed };
}

const result = main();
process.exit(result.failed.length === 0 ? 0 : 1);
