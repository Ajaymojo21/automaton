#!/usr/bin/env node
/**
 * Conway Automaton backup (consistent SQLite snapshot + redacted config).
 *
 * - Uses better-sqlite3's online backup API for state.db.
 * - Copies heartbeat.yml, skills/, constitution.md, SOUL.md if present.
 * - Copies automaton.json with credential-shaped fields REDACTED.
 * - NEVER copies wallet.json (the private key must be backed up separately
 *   by the human operator using encrypted storage).
 * - Writes manifest.json with SHA-256 hashes and verifies the backup DB.
 *
 * Usage: node runtime/bin/backup.mjs [--out <dir>]
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isWalletFile, safeLabel } from "../lib/wallet-material.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const automatonDir = path.join(home, ".automaton");

const outArgIndex = process.argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const outDir =
  outArgIndex > -1 && process.argv[outArgIndex + 1]
    ? path.resolve(process.argv[outArgIndex + 1])
    : path.join(root, "backups", stamp);

const SECRET_KEY =
  /(api[-_]?key|apikey|private[-_]?key|secret|token|password|passphrase|seed[-_]?phrase|mnemonic|credential|keystore|authorization|cookie)/i;

/** Non-empty means "carries a value worth replacing": an empty string is not a secret. */
function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) && isPresent(child) ? "<REDACTED>" : redact(child);
    }
    return out;
  }
  return value;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** A symlink is how a benign-looking name starts pointing at wallet bytes. */
function assertNotSymlink(target, name) {
  if (fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`refusing to archive ${safeLabel(name)}: it is a symbolic link`);
  }
}

/** Copies a top-level config file. Refuses to follow a link out of the config directory. */
function copyIfExists(src, dest, name) {
  if (!fs.existsSync(src)) return false;
  assertNotSymlink(src, name);
  const stat = fs.lstatSync(src);
  if (!stat.isFile()) {
    throw new Error(`refusing to archive ${safeLabel(name)}: it is not a regular file`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Copies `skills/` without following links and without carrying wallet material. Entries that
 * are skipped are recorded in the manifest so the omission is visible to the operator.
 */
function copySkillsSafely(srcDir, destDir, excluded) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const rel = path.relative(automatonDir, src).split(path.sep).join("/");
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) {
      excluded.push(`${safeLabel(rel)} (symbolic link not followed)`);
      continue;
    }
    if (isWalletFile(rel)) {
      excluded.push(`${safeLabel(rel)} (wallet/key material)`);
      continue;
    }
    const dest = path.join(destDir, entry.name);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copySkillsSafely(src, dest, excluded);
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dest);
    } else {
      excluded.push(`${safeLabel(rel)} (not a regular file)`);
    }
  }
}

/**
 * The filter above is expected to be sufficient; this check proves it after the fact. A file
 * that slipped through fails the whole run rather than being quietly reported as a backup.
 */
function assertArchiveHasNoWalletMaterial(dir, base = dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      found.push(`${rel} (symbolic link)`);
    } else if (stat.isDirectory()) {
      assertArchiveHasNoWalletMaterial(full, base, found);
    } else if (isWalletFile(rel)) {
      found.push(rel);
    }
  }
  if (found.length > 0) {
    throw new Error(
      `refusing to continue: output contains wallet/key material or links (${found.map(safeLabel).join(", ")})`,
    );
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  // Pre-existing wallet material or links in the target would be inherited by the archive.
  assertArchiveHasNoWalletMaterial(outDir);

  const manifest = { createdAt: new Date().toISOString(), root, files: {}, excluded: [] };

  const dbPath = path.join(automatonDir, "state.db");
  if (fs.existsSync(dbPath)) {
    assertNotSymlink(dbPath, "state.db");
    const dest = path.join(outDir, "state.db");
    const db = new Database(dbPath, { fileMustExist: true });
    await db.backup(dest);
    db.close();

    const verify = new Database(dest, { readonly: true, fileMustExist: true });
    const integrity = verify.pragma("integrity_check");
    verify.close();
    for (const suffix of ["-shm", "-wal"]) {
      fs.rmSync(dest + suffix, { force: true });
    }
    const ok = integrity?.[0]?.integrity_check === "ok";
    if (!ok) throw new Error(`backup integrity check failed: ${JSON.stringify(integrity)}`);
    manifest.files["state.db"] = { sha256: sha256(dest), bytes: fs.statSync(dest).size, integrity: "ok" };
    console.log(`[PASS] state.db backed up and verified (${manifest.files["state.db"].bytes} bytes)`);
  } else {
    console.log("[WARN] state.db not found; skipped");
  }

  const configSrc = path.join(automatonDir, "automaton.json");
  if (fs.existsSync(configSrc)) {
    assertNotSymlink(configSrc, "automaton.json");
    const redacted = redact(JSON.parse(fs.readFileSync(configSrc, "utf-8")));
    const dest = path.join(outDir, "automaton.redacted.json");
    fs.writeFileSync(dest, JSON.stringify(redacted, null, 2));
    manifest.files["automaton.redacted.json"] = { sha256: sha256(dest), bytes: fs.statSync(dest).size, redacted: true };
    console.log("[PASS] automaton.json backed up with credentials redacted");
  }

  for (const name of ["heartbeat.yml", "constitution.md", "SOUL.md"]) {
    const src = path.join(automatonDir, name);
    const dest = path.join(outDir, name);
    if (copyIfExists(src, dest, name)) {
      manifest.files[name] = { sha256: sha256(dest), bytes: fs.statSync(dest).size };
      console.log(`[PASS] ${name}`);
    }
  }

  const skillsSrc = path.join(automatonDir, "skills");
  if (fs.existsSync(skillsSrc)) {
    assertNotSymlink(skillsSrc, "skills/");
    copySkillsSafely(skillsSrc, path.join(outDir, "skills"), manifest.excluded);
    console.log("[PASS] skills/");
  }

  manifest.excluded.push("wallet.json (holds private key; back up manually with encryption)");
  manifest.excluded.push("credential values inside automaton.json (re-enter after restore)");
  assertArchiveHasNoWalletMaterial(outDir);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nBackup complete: ${outDir}`);
  console.log("NOTE: wallet.json and API keys are NOT included. Store them separately.");
}

main().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
});
