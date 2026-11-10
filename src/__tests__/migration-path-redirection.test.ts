/**
 * Phase 19 A3 follow-up — a link or junction inside the state directory must not be able
 * to point the migration somewhere the gate did not approve.
 *
 * Found while working through the security checklist for A3, after F-19-08 was closed.
 * The containment checks compared *spellings*: `path.resolve()` on a string the operator
 * typed, then a prefix test. Windows directory junctions are reparse points — a path can
 * sit inside the verified state directory and still name a file anywhere on the volume.
 * The concrete bypass:
 *
 *   mklink /J  <sandbox>\.automaton\escape  <somewhere-else>
 *   Conway --migrate-schema --database <sandbox>\.automaton\escape\state.db
 *
 * The literal path is inside the state directory, so the gate approves it; the bytes
 * written are the ones under `somewhere-else`. Because the canonical check is literal too,
 * aiming the junction at the live runtime home also hides it from the second token — so a
 * single `CONWAY_MIGRATION_APPROVAL` would advance the live schema, which is decision A9
 * and has not been approved.
 *
 * Junctions are used rather than symlinks because a directory junction needs no elevation
 * on Windows (`fs.symlinkSync(target, link, "junction")` succeeds as an ordinary user,
 * measured in this phase), so the defence cannot assume the attacker has write access to
 * create a link somewhere else first — only inside the state directory it already shares
 * with Conway.
 *
 * The live database appears in exactly one test below, and only as a *read* of a path that
 * does not exist (`a3-junction-probe-does-not-exist.db`) reached through a junction. The
 * refusal the test expects happens before any open, and the byte hash of `state.db` is
 * asserted unchanged afterwards.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as migration from "../state/schema-migration.js";
import { createDatabase, getSchemaVersion } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import {
  canonicalLiveDatabasePath,
  CANONICAL_OVERRIDE_ENV,
  MIGRATION_APPROVAL_ENV,
  MIGRATION_APPROVAL_VALUE,
  runSchemaMigration,
} from "../state/schema-migration.js";
import { canonicalHome } from "../runtime/home-guard.js";

const V12_V13_TABLES = ["treasury_authorizations", "security_events", "security_incidents", "security_seals"];

const sha256 = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** A disposable V11 database — the same shape as the live install, in a temp directory. */
function buildV11Fixture(file: string): void {
  const wrapper = createDatabase(file);
  const db = wrapper.raw;
  try {
    for (const table of [...V12_V13_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.prepare("DELETE FROM schema_version WHERE version >= 12").run();
  } finally {
    wrapper.close();
  }
}

function schemaVersionOf(file: string): number {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return getSchemaVersion(db);
  } finally {
    db.close();
  }
}

describe("A3 — a reparse point cannot move the migration target", () => {
  it("the resolver is exported and follows a junction while keeping a missing tail", () => {
    const resolve = (migration as { resolveExistingAncestor?: unknown }).resolveExistingAncestor;
    expect(typeof resolve).toBe("function");
  });

  it("resolves an existing directory through a junction and re-joins a non-existent final component", () => {
    const resolve = migration.resolveExistingAncestor;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-jx-unit-"));
    const links: string[] = [];
    try {
      const real = path.join(dir, "real");
      const link = path.join(dir, "link");
      fs.mkdirSync(real);
      fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
      links.push(link);
      const answer = resolve(path.join(link, "missing.db"));
      expect(answer).not.toBeNull();
      // Compare against the resolved spelling of the target: realpath also expands the
      // 8.3 short name the OS temp directory is handed to us as (MEENAK~1 -> …).
      expect(answer!.toLowerCase()).toContain(
        path.join(fs.realpathSync.native(real), "missing.db").toLowerCase(),
      );
      expect(answer!.toLowerCase()).not.toContain(path.join(link, "missing.db").toLowerCase());
    } finally {
      for (const link of links) {
        try {
          fs.rmdirSync(link);
        } catch {
          /* already gone */
        }
      }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("refuses to resolve rather than guess: an unresolvable path returns null", () => {
    const resolve = migration.resolveExistingAncestor;
    // A component that is a *file* cannot contain a child. There is no existing ancestor
    // below it to join back on, so the only safe answer is "I do not know where this is".
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-jx-null-"));
    try {
      const file = path.join(dir, "plain.txt");
      fs.writeFileSync(file, "x", "utf-8");
      expect(resolve(path.join(file, "deeper", "x.db"))).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe("A3 — migration refuses a target that escapes the state directory through a junction", () => {
  let dir: string;
  let home: string;
  let stateDir: string;
  let outside: string;
  let reportDir: string;
  let links: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-a3-jx-"));
    home = path.join(dir, "home");
    stateDir = path.join(home, ".automaton");
    fs.mkdirSync(stateDir, { recursive: true });
    outside = path.join(dir, "outside");
    fs.mkdirSync(outside, { recursive: true });
    reportDir = path.join(dir, "reports");
    fs.mkdirSync(reportDir, { recursive: true });
    links = [];
  });

  afterEach(() => {
    // A junction must be removed as a reparse point, never recursed through: removing it
    // first is what keeps the cleanup from touching the target it points at.
    for (const link of links) {
      try {
        fs.rmdirSync(link);
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function env(): NodeJS.ProcessEnv {
    return {
      HOME: home,
      CONWAY_HOME_MODE: "isolated",
      [MIGRATION_APPROVAL_ENV]: MIGRATION_APPROVAL_VALUE,
    } as NodeJS.ProcessEnv;
  }

  it("names the redirection and leaves the escaped database untouched", () => {
    const victim = path.join(outside, "victim.db");
    buildV11Fixture(victim);
    const before = sha256(victim);

    const escape = path.join(stateDir, "escape");
    fs.symlinkSync(outside, escape, process.platform === "win32" ? "junction" : "dir");
    links.push(escape);

    const viaLink = path.join(escape, "victim.db");
    expect(fs.existsSync(viaLink)).toBe(true);
    // The literal spelling is inside the verified state directory. That is the whole attack.
    expect(viaLink.toLowerCase()).toContain(stateDir.toLowerCase());

    const result = runSchemaMigration({ dbPath: viaLink, env: env(), reportDir });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(result.message).toMatch(/resolv|junction|link/i);
    expect(fs.readdirSync(reportDir)).toEqual([]);
    expect(sha256(victim)).toBe(before);
    // F-18-02 semantics, proven on the escaped file: no DDL, so still V11.
    expect(schemaVersionOf(victim)).toBe(11);
  });

  it("refuses a junction that points at the live runtime home instead of hiding it", () => {
    // The second half of the same bypass: with literal containment, a link inside the
    // sandbox aimed at the live .automaton directory is not recognised as canonical, so
    // CONWAY_MIGRATION_ALLOW_CANONICAL would never be demanded. The filename does not
    // exist, so nothing can be opened whatever this test does; the live hash is asserted.
    const live = canonicalLiveDatabasePath();
    const before = sha256(live);

    const peek = path.join(stateDir, "live-peek");
    fs.symlinkSync(path.join(canonicalHome(), ".automaton"), peek, process.platform === "win32" ? "junction" : "dir");
    links.push(peek);

    const probe = path.join(peek, "a3-junction-probe-does-not-exist.db");
    expect(fs.existsSync(probe)).toBe(false);

    const result = runSchemaMigration({ dbPath: probe, env: env(), reportDir });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("target");
    expect(result.message).toMatch(/canonical/i);
    expect(result.message).toContain(CANONICAL_OVERRIDE_ENV);
    expect(fs.readdirSync(reportDir)).toEqual([]);
    expect(sha256(live)).toBe(before);
  });

  it("still migrates the ordinary database that really is inside the state directory", () => {
    // The fix must not break the one path A3 exists for.
    const file = path.join(stateDir, "work.db");
    buildV11Fixture(file);
    expect(schemaVersionOf(file)).toBe(11);

    const result = runSchemaMigration({ dbPath: file, env: env(), reportDir });

    expect(result.ok).toBe(true);
    expect(result.report?.after.version).toBe(SCHEMA_VERSION);
    expect(schemaVersionOf(file)).toBe(SCHEMA_VERSION);
    expect(fs.readdirSync(reportDir).length).toBe(1);
  });

  it("both containment decisions run on the resolved path, not on the typed one", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "state", "schema-migration.ts"),
      "utf8",
    );
    const body = source.slice(source.indexOf("export function runSchemaMigration"));
    expect(body).toContain("resolveExistingAncestor(target)");
    expect(body).toMatch(/canonicalStatus\(\s*real\b/);
    expect(body).toMatch(/isPathInside\(\s*real,\s*realStateDir\b/);
    // The literal path may appear in messages; it must not decide anything.
    expect(body).not.toMatch(/isPathInside\(\s*target,/);
  });
});
