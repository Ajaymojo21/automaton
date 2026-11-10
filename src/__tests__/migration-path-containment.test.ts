/**
 * Phase 19 A3 follow-up — the migration gate's path containment must be able to
 * *recognise* the live tree, not merely match one spelling of it.
 *
 * Found while verifying A3, after A3 was written. `canonicalStatus()` compared
 * `path.resolve(target)` against `path.resolve(canonicalHome())` with `startsWith`.
 * On Windows that comparison is case-sensitive, while the home guard it sits behind
 * (`samePath` in src/runtime/home-guard.ts:103) is deliberately **case-insensitive**
 * and normalises Git-Bash-style `/c/...` spelling. The two therefore disagree exactly
 * where disagreement is dangerous: `HOME=<repo-root>\runtime\home`
 * passes the home guard, and a lower-cased live path then fails the `startsWith`
 * comparison, so the canonical override token would not be demanded — while the
 * state-directory containment, derived from the same lower-cased HOME, would still
 * pass. The runner would reach the live database with one token instead of two.
 *
 * Nothing was migrated: this was found before any run against the live file, and the
 * live `state.db` was re-hashed after every probe in this suite.
 *
 * Safety design of the gate-level tests below: every one of them points at a filename
 * that does **not exist**. So even if the containment checks were removed entirely, the
 * last line of defence — "no database at <path>" — still refuses, and no test in this
 * file can open, migrate or create the live database. The tests assert the *reason* for
 * refusal, which is what distinguishes "recognised as canonical" from "refused by
 * accident".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as migration from "../state/schema-migration.js";
import {
  canonicalLiveDatabasePath,
  CANONICAL_OVERRIDE_ENV,
  MIGRATION_APPROVAL_ENV,
  MIGRATION_APPROVAL_VALUE,
  runSchemaMigration,
} from "../state/schema-migration.js";

const sha256 = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("A3 — migration path containment recognises every spelling of the live tree", () => {
  it("the helper exists and is exported", () => {
    expect(typeof (migration as { isPathInside?: unknown }).isPathInside).toBe("function");
  });

  it("treats a differently-cased child as inside a Windows root", () => {
    const isPathInside = (migration as { isPathInside: (t: string, r: string, p?: string) => boolean }).isPathInside;
    expect(isPathInside("c:\\REPO\\runtime\\home\\.automaton\\state.db", "C:\\repo\\runtime\\home", "win32")).toBe(true);
    expect(isPathInside("C:\\repo\\runtime\\home\\.automaton\\state.db", "C:\\repo\\runtime\\home", "win32")).toBe(true);
  });

  it("treats the root itself as inside the root, whichever way it is spelled", () => {
    const isPathInside = (migration as { isPathInside: (t: string, r: string, p?: string) => boolean }).isPathInside;
    expect(isPathInside("C:\\REPO\\runtime\\home", "c:\\repo\\runtime\\home", "win32")).toBe(true);
  });

  it("does not treat a sibling with a shared prefix as inside the root", () => {
    const isPathInside = (migration as { isPathInside: (t: string, r: string, p?: string) => boolean }).isPathInside;
    expect(isPathInside("C:\\repo\\runtime\\homekeeper\\.automaton\\state.db", "C:\\repo\\runtime\\home", "win32")).toBe(false);
  });

  it("tolerates the separator style the other platform uses", () => {
    const isPathInside = (migration as { isPathInside: (t: string, r: string, p?: string) => boolean }).isPathInside;
    expect(isPathInside("C:/repo/runtime/home/.automaton/state.db", "C:\\repo\\runtime\\home", "win32")).toBe(true);
  });

  it("stays case-sensitive where the platform is", () => {
    const isPathInside = (migration as { isPathInside: (t: string, r: string, p?: string) => boolean }).isPathInside;
    expect(isPathInside("/home/conway/.automaton/state.db", "/home/Conway", "linux")).toBe(false);
    expect(isPathInside("/home/conway/.automaton/state.db", "/home/conway", "linux")).toBe(true);
    expect(isPathInside("/home/conway", "/home/conway", "linux")).toBe(true);
  });
});

describe("A3 — the canonical refusal survives a re-cased live path", () => {
  let dir: string;
  let home: string;
  let reportDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-case-"));
    home = path.join(dir, "home");
    fs.mkdirSync(path.join(home, ".automaton"), { recursive: true });
    reportDir = path.join(dir, "reports");
    fs.mkdirSync(reportDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  /** Isolated HOME (the sanctioned harness opt-in) + the migration token, nothing else. */
  function envWith(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { HOME: home, CONWAY_HOME_MODE: "isolated", ...overrides } as NodeJS.ProcessEnv;
  }

  it("names the canonical override when the live tree is spelled in lower case", () => {
    const live = canonicalLiveDatabasePath();
    const before = sha256(live);
    // Same directory, different casing on a directory segment rather than only the drive
    // letter — and a file that does not exist, so a total guard failure still refuses before
    // any open. Deriving it from `live` keeps the test meaningful on a renamed checkout.
    const segments = live.split(path.sep);
    segments[0] = segments[0].toLowerCase();
    const stateDir = segments.length - 2;
    segments[stateDir] = segments[stateDir].toUpperCase();
    const recased = [...segments.slice(0, -1), "a3-case-probe-does-not-exist.db"].join(path.sep);
    expect(fs.existsSync(recased)).toBe(false);

    const result = runSchemaMigration({
      dbPath: recased,
      env: envWith({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(result.message).toMatch(/canonical/i);
    expect(result.message).toContain(CANONICAL_OVERRIDE_ENV);
    expect(fs.readdirSync(reportDir)).toEqual([]);
    expect(sha256(live)).toBe(before);
  });

  it("refuses the state directory itself rather than trying to open a directory", () => {
    const result = runSchemaMigration({
      dbPath: path.join(home, ".automaton"),
      env: envWith({ [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(fs.readdirSync(reportDir)).toEqual([]);
  });

  it("still refuses the canonical override token set to a value that is not APPROVED", () => {
    const live = canonicalLiveDatabasePath();
    const before = sha256(live);
    const recased = live
      .replace(/^C:/, "c:")
      .replace("state.db", "a3-case-probe-does-not-exist.db");
    const result = runSchemaMigration({
      dbPath: recased,
      env: envWith({
        [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE,
        [CANONICAL_OVERRIDE_ENV]: "approved",
      }),
      reportDir,
    });
    expect(result.ok).toBe(false);
    expect(fs.readdirSync(reportDir)).toEqual([]);
    expect(sha256(live)).toBe(before);
  });

  it("derives both containment checks from the same comparison, not from startsWith", () => {
    // Source-level guard: the two decisions that decide whether a write is allowed must
    // share one path comparison. A raw `startsWith` on either side re-opens the defect.
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "state", "schema-migration.ts"),
      "utf8",
    );
    const gate = source.slice(source.indexOf("function canonicalStatus"));
    expect(gate).toContain("isPathInside");
    expect(gate).not.toMatch(/startsWith\(/);
  });
});
