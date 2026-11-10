import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import { isWalletFile } from "../../runtime/lib/wallet-material.mjs";

// The wallet-material policy is owned by runtime/lib so backup.mjs, restore.mjs and this
// verifier cannot drift apart about which files must never be archived or restored.
export { isWalletFile };


export interface FileCheck {
  file: string;
  rel: string;
  /** Which root the manifest path was interpreted against. The two conventions coexist in
   *  `backups/`: backup.mjs lists names relative to its own directory, while the Phase 15
   *  source snapshots list repo-root-relative paths of the files they protected. */
  base: "archive" | "repo" | "none";
  expected: string;
  actual: string | null;
  verdict: "MATCH" | "MISMATCH" | "MISSING";
  bytes: number | null;
}

export interface BackupCheck {
  dir: string;
  manifest: string | null;
  kind: "manifest.json" | "manifest.sha256" | "none";
  createdAt: string | null;
  checks: FileCheck[];
  excluded: string[];
  error: string | null;
}

function sha256(file: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

/**
 * Resolve one manifest entry. An archive-relative hit proves the archived bytes are intact;
 * a repo-relative hit proves the *live* file still equals the snapshot, which is a different
 * claim and is labelled as such. Nothing is reported as MATCH when only the other file
 * happens to agree.
 */
function compare(expected: string, rel: string, archiveDir: string, repoRoot: string): FileCheck {
  const bases: Array<{ name: FileCheck["base"]; root: string }> = [
    { name: "archive", root: archiveDir },
    { name: "repo", root: repoRoot },
  ];
  const missing: FileCheck = { file: path.basename(rel), rel, base: "none", expected, actual: null, verdict: "MISSING", bytes: null };
  for (const candidate of bases) {
    const target = safeJoin(candidate.root, rel);
    if (!target) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const actual = sha256(target);
    return {
      file: path.basename(rel),
      rel,
      base: candidate.name,
      expected,
      actual,
      bytes: stat.size,
      verdict: actual === expected ? "MATCH" : "MISMATCH",
    };
  }
  return missing;
}

/** True when `rel` stays inside `root` after normalisation. A manifest written by another
 *  tool is still untrusted input: `../`, absolute paths and drive letters are rejected. */
function safeJoin(root: string, rel: string): string | null {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 512) return null;
  if (/[\0]/.test(rel)) return null;
  const candidate = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) return null;
  return candidate;
}

interface ManifestJson {
  createdAt?: string;
  files?: Record<string, { sha256?: string }>;
}

/**
 * Read-only re-hashing. It never opens a backup database: a WAL backup copy still carries
 * `-wal`/`-shm` siblings, and opening it read-only would write a fresh `-shm` into the
 * archive. Integrity of the live database is checked separately on the live, read-only
 * handle; for an archive, hash equality against its own manifest is the claim being made.
 */
export function verifyBackupDir(dir: string): BackupCheck {
  const resolved = path.resolve(dir);
  const jsonPath = path.join(resolved, "manifest.json");
  const shaCandidates = ["manifest.sha256", "MANIFEST.sha256"]
    .map((name) => path.join(resolved, name))
    .filter((candidate) => fs.existsSync(candidate));
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return { dir: resolved, manifest: null, kind: "none", createdAt: null, checks: [], excluded: [], error: "not a directory" };
    }
    if (fs.existsSync(jsonPath)) {
      const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as ManifestJson;
      const files = manifest.files ?? {};
      const excluded: string[] = [];
      const checks = Object.entries(files)
        .filter(([name]) => {
          if (isWalletFile(name)) { excluded.push(name); return false; }
          return true;
        })
        .filter(([, entry]) => typeof entry?.sha256 === "string")
        .map(([name, entry]) => compare(String(entry.sha256), name, resolved, REPO_ROOT));
      return { dir: resolved, manifest: jsonPath, kind: "manifest.json", createdAt: manifest.createdAt ?? null, checks, excluded, error: null };
    }
    if (shaCandidates.length > 0) {
      const manifest = shaCandidates[0];
      const lines = fs.readFileSync(manifest, "utf-8").split(/\r?\n/).filter((line) => line.trim().length > 0);
      const checks: FileCheck[] = [];
      const excluded: string[] = [];
      for (const line of lines) {
        const parsed = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
        if (!parsed) continue;
        const rel = parsed[2].trim().replace(/^\.?[\\/]/, "");
        if (rel.length === 0) continue;
        if (isWalletFile(rel)) { excluded.push(rel); continue; }
        checks.push(compare(parsed[1], rel, resolved, REPO_ROOT));
      }
      return { dir: resolved, manifest, kind: "manifest.sha256", createdAt: null, checks, excluded, error: null };
    }
    return { dir: resolved, manifest: null, kind: "none", createdAt: null, checks: [], excluded: [], error: "no manifest in this directory" };
  } catch (cause) {
    return {
      dir: resolved,
      manifest: null,
      kind: "none",
      createdAt: null,
      checks: [],
      excluded: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function listBackupDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((full) => {
        try {
          return fs.statSync(full).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}
