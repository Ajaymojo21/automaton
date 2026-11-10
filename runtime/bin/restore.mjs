#!/usr/bin/env node
/**
 * Conway Automaton restore (explicit target only).
 *
 * Verifies manifest hashes and database integrity before copying anything.
 * Refuses to write into the live ~/.automaton directory unless
 * --allow-live is passed; the intended use is a disposable directory.
 *
 * Usage:
 *   node runtime/bin/restore.mjs --from <backupDir> --to <targetDir> [--allow-live]
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertPlainArchiveName, isWalletFile, safeLabel } from "../lib/wallet-material.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const liveDir = path.resolve(path.join(home, ".automaton"));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const from = arg("--from");
const to = arg("--to");
const allowLive = process.argv.includes("--allow-live");

if (!from || !to) {
  console.error("Usage: node runtime/bin/restore.mjs --from <backupDir> --to <targetDir> [--allow-live]");
  process.exit(2);
}

const backupDir = path.resolve(from);
const targetDir = path.resolve(to);
const manifestPath = path.join(backupDir, "manifest.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** A regular file, not a link: an archive is unpacked, never followed. */
function assertRegularFile(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new Error(`missing backup file: ${safeLabel(label)}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`refusing linked backup file: ${safeLabel(label)}`);
  if (!stat.isFile()) throw new Error(`refusing non-regular backup file: ${safeLabel(label)}`);
}

/**
 * Refuses an archive that carries wallet material in `skills/` (or any other unmanifested
 * corner). The manifest alone is not enough: a hand-assembled archive can leave a key file
 * outside the manifest and still smuggle it through a recursive copy.
 */
function assertTreeHasNoWalletMaterial(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`refusing linked entry in backup: ${safeLabel(rel)}`);
    if (isWalletFile(rel)) throw new Error(`refusing wallet/key material in backup: ${safeLabel(rel)}`);
    if (stat.isDirectory()) assertTreeHasNoWalletMaterial(full, base);
  }
}

function copyTreeSafely(srcDir, destDir, base = srcDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const rel = path.relative(base, src).split(path.sep).join("/");
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) throw new Error(`refusing linked entry in backup: ${safeLabel(rel)}`);
    if (isWalletFile(rel)) throw new Error(`refusing wallet/key material in backup: ${safeLabel(rel)}`);
    const dest = path.join(destDir, entry.name);
    if (stat.isDirectory()) copyTreeSafely(src, dest, base);
    else if (stat.isFile()) fs.copyFileSync(src, dest);
    else throw new Error(`refusing non-regular entry in backup: ${safeLabel(rel)}`);
  }
}

try {
  if (!fs.existsSync(manifestPath)) throw new Error("manifest not found in the backup directory");
  assertRegularFile(manifestPath, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!manifest || typeof manifest !== "object" || !manifest.files || typeof manifest.files !== "object") {
    throw new Error("manifest.json has no files section");
  }

  if (targetDir === liveDir && !allowLive) {
    throw new Error("refusing to restore into the live config directory without --allow-live");
  }

  // Validate every name before anything is read or written. A name that escapes the archive or
  // names wallet material invalidates the whole archive; it is not skipped and not warned about.
  const entries = Object.entries(manifest.files).map(([rawName, meta]) => {
    const name = assertPlainArchiveName(rawName);
    if (isWalletFile(name)) throw new Error(`refusing to restore wallet/key material: ${safeLabel(name)}`);
    if (!meta || typeof meta.sha256 !== "string") throw new Error(`manifest entry has no hash: ${safeLabel(name)}`);
    return { name, meta };
  });

  for (const { name, meta } of entries) {
    const src = path.join(backupDir, name);
    assertRegularFile(src, name);
    const actual = sha256(src);
    if (actual !== meta.sha256) throw new Error(`hash mismatch for ${safeLabel(name)}`);
  }

  const backupDb = path.join(backupDir, "state.db");
  if (fs.existsSync(backupDb)) {
    assertRegularFile(backupDb, "state.db");
    const db = new Database(backupDb, { readonly: true, fileMustExist: true });
    const result = db.pragma("integrity_check");
    db.close();
    if (result?.[0]?.integrity_check !== "ok") throw new Error("backup database failed integrity_check");
  }

  const skillsSrc = path.join(backupDir, "skills");
  if (fs.existsSync(skillsSrc)) {
    if (fs.lstatSync(skillsSrc).isSymbolicLink()) throw new Error("refusing linked skills/ directory in backup");
    assertTreeHasNoWalletMaterial(skillsSrc);
  }

  if (fs.existsSync(targetDir) && fs.lstatSync(targetDir).isSymbolicLink()) {
    throw new Error("refusing to restore into a symbolic link");
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const { name } of entries) {
    const src = path.join(backupDir, name);
    const destName = name === "automaton.redacted.json" ? "automaton.json" : name;
    const dest = path.join(targetDir, destName);
    if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) {
      throw new Error(`refusing to write through a symbolic link: ${safeLabel(destName)}`);
    }
    fs.copyFileSync(src, dest);
    console.log(`[PASS] restored ${destName}`);
  }

  if (fs.existsSync(skillsSrc)) {
    copyTreeSafely(skillsSrc, path.join(targetDir, "skills"));
    console.log("[PASS] restored skills/");
  }

  console.log(`\nRestore complete: ${targetDir}`);
  if (Object.keys(manifest.files).includes("automaton.redacted.json")) {
    console.log("WARNING: credentials were redacted in the backup — re-enter API keys before use.");
  }
} catch (err) {
  console.error(`[FAIL] ${err.message}`);
  process.exit(1);
}
