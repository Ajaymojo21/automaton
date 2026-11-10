import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertRegularArchiveEntry, executeConfirmedRestore, executeRestore, planRestore } from "../server/commands.js";
import { listBackupDirs, verifyBackupDir } from "../server/verify.js";
import { DASHBOARD_ROOT, PROJECT_BACKUPS_DIR, STATE_DIR } from "../server/paths.js";

/** Mandate §17: "Restore must require explicit confirmation. Never overwrite active state
 *  automatically." Every refusal below is the attack, not a description of the attack. */

function realArchiveWithBytes(): string | null {
  for (const dir of listBackupDirs(PROJECT_BACKUPS_DIR)) {
    const check = verifyBackupDir(dir);
    if (check.checks.some((file) => file.base === "archive" && file.verdict === "MATCH")) {
      return path.basename(dir);
    }
  }
  return null;
}

describe("planRestore refusals", () => {
  it("rejects an empty, oversized or non-string name", () => {
    expect(planRestore("", "").ok).toBe(false);
    expect(planRestore("x".repeat(201), "x".repeat(201)).ok).toBe(false);
    expect(planRestore(undefined as unknown as string, "x").ok).toBe(false);
  });

  it("rejects path traversal in the archive name", () => {
    for (const name of ["..", "../..", "..\\..", "a/b", "a\\b", "/etc", "C:\\Windows"]) {
      const plan = planRestore(name, name);
      expect(plan.ok, name).toBe(false);
      expect(plan.summary, name).toContain("single path segment");
    }
  });

  it("rejects a confirmation that does not equal the archive name", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive — cannot test the confirmation gate");
    expect(planRestore(name, "").ok).toBe(false);
    expect(planRestore(name, `${name} `).ok).toBe(false);
    expect(planRestore(name, `${name}x`).ok).toBe(false);
    const approved = planRestore(name, name);
    expect(approved.ok).toBe(true);
  });

  it("refuses an archive with no manifest", () => {
    const plan = planRestore("definitely-not-an-archive", "definitely-not-an-archive");
    expect(plan.ok).toBe(false);
    expect(plan.summary).toContain("no manifest");
  });

  it("never plans a target inside the live state directory", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const plan = planRestore(name, name);
    expect(plan.ok).toBe(true);
    const target = plan.target ?? "";
    expect(target.startsWith(path.resolve(STATE_DIR))).toBe(false);
    expect(target.startsWith(path.resolve(DASHBOARD_ROOT, "restore-targets"))).toBe(true);
  });

  it("excludes working-tree references from the restorable file list", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const plan = planRestore(name, name);
    const check = verifyBackupDir(path.join(PROJECT_BACKUPS_DIR, name));
    const archived = check.checks.filter((file) => file.base === "archive").length;
    expect(plan.files ?? []).toHaveLength(archived);
  });
});

describe("executeConfirmedRestore", () => {
  it("refuses when no plan was confirmed first", () => {
    const result = executeConfirmedRestore("nothing-was-planned-here", "nothing-was-planned-here");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("no confirmed plan");
  });

  it("copies exactly the directory the operator confirmed, then consumes the plan", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive — cannot test the confirmed-plan path");
    const liveBefore = fs.statSync(path.join(STATE_DIR, "state.db"));
    const plan = planRestore(name, name);
    expect(plan.ok).toBe(true);
    const confirmed = plan.target ?? "";
    const result = executeConfirmedRestore(name, name);
    try {
      expect(result.ok, result.summary).toBe(true);
      // Regression: step 2 used to re-plan, stamping a NEW target and writing somewhere other
      // than the path the operator had just approved.
      expect((result.data as { target?: string } | undefined)?.target).toBe(confirmed);
      expect(result.summary).toContain(confirmed);
      // The artifact must carry its own provenance: the source archive, not a status sentence.
      const note = fs.readFileSync(path.join(confirmed, "RESTORE-NOTE.txt"), "utf-8");
      expect(note).toContain(path.join(PROJECT_BACKUPS_DIR, name));
      expect(note).not.toContain("will be copied to a new directory");
      const second = executeConfirmedRestore(name, name);
      expect(second.ok).toBe(false);
      expect(second.summary).toContain("no confirmed plan");
    } finally {
      if (confirmed) fs.rmSync(confirmed, { recursive: true, force: true });
    }
    const liveAfter = fs.statSync(path.join(STATE_DIR, "state.db"));
    expect(liveAfter.size).toBe(liveBefore.size);
    expect(liveAfter.mtimeMs).toBe(liveBefore.mtimeMs);
  });

  it("re-checks the confirmation at execute time, not only in the browser", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const plan = planRestore(name, name);
    const target = plan.target ?? "";
    const result = executeConfirmedRestore(name, `${name} `);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("does not equal");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses to write over a directory that already exists", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const plan = planRestore(name, name);
    const target = plan.target ?? "";
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    try {
      const result = executeConfirmedRestore(name, name);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("refusing to write over an existing directory");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

describe("executeRestore", () => {
  it("refuses a plan that did not pass its own gates", () => {
    const rejected = planRestore("..", "..");
    const result = executeRestore(rejected);
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(rejected.summary);
  });

  it("refuses a source outside the backups tree even when the plan object is hand-built", () => {
    const forged = {
      ok: true,
      verdict: "VERIFIED",
      summary: "forged",
      sourceDir: STATE_DIR,
      target: path.join(DASHBOARD_ROOT, "restore-targets", "forged-probe"),
      files: ["state.db"],
    };
    const result = executeRestore(forged);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("not inside the backups tree");
    expect(fs.existsSync(forged.target ?? "")).toBe(false);
  });

  it("refuses a manifest entry that escapes its archive", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const plan = planRestore(name, name);
    const target = path.join(DASHBOARD_ROOT, "restore-targets", "escape-probe");
    fs.rmSync(target, { recursive: true, force: true });
    const result = executeRestore({ ...plan, target, files: ["../escaped-probe.txt"] });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("escaped its archive");
    expect(fs.existsSync(path.join(DASHBOARD_ROOT, "escaped-probe.txt"))).toBe(false);
    fs.rmSync(target, { recursive: true, force: true });
  });

  it("copies verified bytes to a NEW directory and leaves the live database alone", () => {
    const name = realArchiveWithBytes();
    if (!name) throw new Error("no verifiable archive");
    const liveBefore = fs.statSync(path.join(STATE_DIR, "state.db"));
    const plan = planRestore(name, name);
    const result = executeRestore(plan);
    try {
      expect(result.ok).toBe(true);
      expect(plan.target).toBeTruthy();
      expect(fs.existsSync(path.join(plan.target ?? "", "RESTORE-NOTE.txt"))).toBe(true);
      for (const rel of plan.files ?? []) {
        expect(fs.existsSync(path.join(plan.target ?? "", rel)), rel).toBe(true);
      }
      const liveAfter = fs.statSync(path.join(STATE_DIR, "state.db"));
      expect(liveAfter.size).toBe(liveBefore.size);
      expect(liveAfter.mtimeMs).toBe(liveBefore.mtimeMs);
    } finally {
      if (plan.target) fs.rmSync(plan.target, { recursive: true, force: true });
    }
  });
});

describe("archive entries must be the regular files the manifest promises", () => {
  it("accepts a regular file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-entry-"));
    try {
      const file = path.join(dir, "state.db");
      fs.writeFileSync(file, "bytes", "utf-8");
      expect(() => assertRegularArchiveEntry(file, "state.db")).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a link, because copying it would take whatever it points at", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-entry-"));
    try {
      const outside = path.join(dir, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "wallet.json"), "planted", "utf-8");
      const link = path.join(dir, "state.db");
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      expect(() => assertRegularArchiveEntry(link, "state.db")).toThrow(/linked archive entry/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a directory where a file is promised", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-entry-"));
    try {
      const nested = path.join(dir, "state.db");
      fs.mkdirSync(nested);
      expect(() => assertRegularArchiveEntry(nested, "state.db")).toThrow(/non-regular archive entry/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
