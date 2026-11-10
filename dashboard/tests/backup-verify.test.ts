import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBackupDirs, verifyBackupDir } from "../server/verify.js";
import { PROJECT_BACKUPS_DIR, REPO_ROOT } from "../server/paths.js";

/** The two manifest conventions in backups/ mean different claims. A verification that cannot
 *  tell them apart reported 6 false MISSING entries before this behaviour was pinned down, so
 *  both conventions and the distinction are tested here. */

const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), "conway-verify-"));

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function write(dir: string, rel: string, text: string): string {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf-8");
  return target;
}

beforeAll(() => {
  const archive = path.join(FIXTURE, "archive-relative");
  write(archive, "a.txt", "alpha");
  write(archive, "nested/b.txt", "beta");
  fs.writeFileSync(
    path.join(archive, "manifest.json"),
    JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      files: {
        "a.txt": { sha256: sha256("alpha") },
        "nested/b.txt": { sha256: sha256("beta") },
        "gone.txt": { sha256: sha256("never written") },
        "../../escape.txt": { sha256: sha256("nope") },
        // resolves nowhere in the archive, but does resolve at the repo root
        "package.json": { sha256: sha256(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) },
      },
    }),
    "utf-8",
  );

  const tampered = path.join(FIXTURE, "tampered");
  write(tampered, "c.txt", "mutated after the backup");
  fs.writeFileSync(
    path.join(tampered, "manifest.json"),
    JSON.stringify({ files: { "c.txt": { sha256: sha256("original content") } } }),
    "utf-8",
  );

  const lineManifest = path.join(FIXTURE, "line-manifest");
  write(lineManifest, "src/index.ts", "console.log(1);\n");
  fs.writeFileSync(
    path.join(lineManifest, "MANIFEST.sha256"),
    [`${sha256("console.log(1);\n")} *./src/index.ts`, "not-a-hash  junk line", `${"0".repeat(64)}  src/absent.ts`].join("\n"),
    "utf-8",
  );

  fs.mkdirSync(path.join(FIXTURE, "no-manifest"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
});

describe("manifest.json (archive-relative)", () => {
  it("labels archive hits and repo hits differently", () => {
    const check = verifyBackupDir(path.join(FIXTURE, "archive-relative"));
    expect(check.kind).toBe("manifest.json");
    expect(check.createdAt).toBe("2026-01-01T00:00:00.000Z");
    const byName = new Map(check.checks.map((entry) => [entry.rel, entry]));
    expect(byName.get("a.txt")?.base).toBe("archive");
    expect(byName.get("a.txt")?.verdict).toBe("MATCH");
    expect(byName.get("nested/b.txt")?.base).toBe("archive");
    expect(byName.get(path.join("nested", "b.txt"))?.verdict ?? byName.get("nested/b.txt")?.verdict).toBe("MATCH");
    expect(byName.get("package.json")?.base).toBe("repo");
    expect(byName.get("gone.txt")?.verdict).toBe("MISSING");
    expect(byName.get("gone.txt")?.base).toBe("none");
  });

  it("refuses a manifest entry that escapes its archive", () => {
    const check = verifyBackupDir(path.join(FIXTURE, "archive-relative"));
    const escape = check.checks.find((entry) => entry.rel.includes("escape"));
    expect(escape?.verdict).toBe("MISSING");
    expect(fs.existsSync(path.join(FIXTURE, "escape.txt"))).toBe(false);
  });

  it("reports a changed archived file as MISMATCH, never as MATCH", () => {
    const check = verifyBackupDir(path.join(FIXTURE, "tampered"));
    expect(check.checks).toHaveLength(1);
    expect(check.checks[0]?.verdict).toBe("MISMATCH");
    expect(check.checks[0]?.base).toBe("archive");
  });
});

describe("MANIFEST.sha256 (repo-relative source snapshots)", () => {
  it("parses the hash-line format and ignores malformed lines", () => {
    const check = verifyBackupDir(path.join(FIXTURE, "line-manifest"));
    expect(check.kind).toBe("manifest.sha256");
    expect(check.checks).toHaveLength(2);
    const present = check.checks.find((entry) => entry.verdict === "MATCH");
    expect(present?.base).toBe("archive");
    expect(check.checks.some((entry) => entry.verdict === "MISSING")).toBe(true);
  });
});

describe("unusable directories", () => {
  it("returns kind none instead of throwing when there is no manifest", () => {
    const check = verifyBackupDir(path.join(FIXTURE, "no-manifest"));
    expect(check.kind).toBe("none");
    expect(check.error).toContain("no manifest");
  });

  it("returns kind none for a path that does not exist", () => {
    expect(verifyBackupDir(path.join(FIXTURE, "does-not-exist")).kind).toBe("none");
  });
});

describe("the real backups/", () => {
  it("lists the archives the operator can actually choose", () => {
    const dirs = listBackupDirs(PROJECT_BACKUPS_DIR);
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    expect(dirs.some((dir) => fs.existsSync(path.join(dir, "manifest.json")))).toBe(true);
  });

  it("verifies every manifested archive without a single non-MATCH entry", () => {
    const problems: string[] = [];
    let manifested = 0;
    for (const dir of listBackupDirs(PROJECT_BACKUPS_DIR)) {
      const check = verifyBackupDir(dir);
      if (check.kind === "none") continue;
      manifested += 1;
      for (const file of check.checks) {
        if (file.verdict !== "MATCH") problems.push(`${path.basename(dir)}/${file.rel}=${file.verdict}`);
      }
    }
    expect(manifested).toBeGreaterThanOrEqual(9);
    expect(problems).toEqual([]);
  });

  it("keeps the only manifest-less directory out of the restore surface", () => {
    // backups/phase16 is a flat pile of .ts.bak working files, not a presented archive. The
    // safety property is that nothing without a manifest can be offered as a restore source.
    const manifestless = listBackupDirs(PROJECT_BACKUPS_DIR).filter((dir) => verifyBackupDir(dir).kind === "none");
    for (const dir of manifestless) {
      expect(fs.existsSync(path.join(dir, "state.db")), path.basename(dir)).toBe(false);
      expect(fs.existsSync(path.join(dir, "manifest.sha256")), path.basename(dir)).toBe(false);
    }
    for (const name of ["2026-11-01_08-24-20", "2026-10-31_10-27-31"]) {
      expect(manifestless.map((dir) => path.basename(dir))).not.toContain(name);
    }
  });
});
