/**
 * Phase 19 A3 — the explicit, gated schema-migration command (mandate §5.B).
 *
 * Before this module, the only way a Conway database ever migrated was as a side effect
 * of *opening it to write*, which every command does — including `--status`. Migration
 * therefore could not be reviewed, gated, or dated, and the runner could record a version
 * it had not verified (F-18-01, F-18-02). A2 fixed the runner; this file moves the
 * decision to run it behind its own approval token.
 *
 * Two gates, deliberately separate from every other gate in the product:
 *   CONWAY_MIGRATION_APPROVAL=APPROVED          — required to migrate anything
 *   CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED   — additionally required to touch the
 *                                                 live runtime home
 * Neither reads nor writes the agent-activation variable, and nothing here imports the
 * activation check: a migration approval is not an activation approval, and an activation
 * approval is not a migration approval.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import {
  applyMigrations,
  assertSchemaIsCurrent,
  getSchemaVersion,
  openDatabaseReadOnly,
} from "./database.js";
import { SCHEMA_VERSION } from "./schema.js";
import { canonicalHome, conwayRoot, inspectConwayHome } from "../runtime/home-guard.js";
import { createLogger } from "../observability/logger.js";

type Raw = BetterSqlite3.Database;

const logger = createLogger("migrate-schema");

export const MIGRATION_APPROVAL_ENV = "CONWAY_MIGRATION_APPROVAL";
export const MIGRATION_APPROVAL_VALUE = "APPROVED";
export const CANONICAL_OVERRIDE_ENV = "CONWAY_MIGRATION_ALLOW_CANONICAL";
export const CANONICAL_OVERRIDE_VALUE = "APPROVED";

/** The state database of the canonical runtime home — the file A9 has not approved touching. */
export function canonicalLiveDatabasePath(): string {
  return path.join(canonicalHome(), ".automaton", "state.db");
}

export type MigrationStage = "gate" | "home" | "target" | "integrity" | "migration" | "success";

export interface GateDecision {
  approved: boolean;
  reason: string;
}

/**
 * Does the environment carry migration approval?
 *
 * Compared against one exact value. A truthy-ish token ("1", "true", "yes") is not
 * approval: the failure mode this guards against is an operator setting a variable in a
 * wrapper .bat and believing they approved something they did not.
 */
export function evaluateMigrationGate(env: NodeJS.ProcessEnv = process.env): GateDecision {
  const supplied = env[MIGRATION_APPROVAL_ENV];
  if (supplied === undefined || !supplied.trim()) {
    return {
      approved: false,
      reason: `${MIGRATION_APPROVAL_ENV} is not set. Set it to ${MIGRATION_APPROVAL_VALUE} to authorise a schema migration.`,
    };
  }
  if (supplied !== MIGRATION_APPROVAL_VALUE) {
    return {
      approved: false,
      reason: `${MIGRATION_APPROVAL_ENV} is set but is not ${MIGRATION_APPROVAL_VALUE}; migration needs the exact value.`,
    };
  }
  return { approved: true, reason: `${MIGRATION_APPROVAL_ENV} granted.` };
}

export interface MigrationReport {
  command: "migrate-schema";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dbPath: string;
  homeMode: string;
  targetVersion: number;
  integrity: string;
  approval: {
    environmentVariable: string;
    granted: boolean;
    canonicalOverride: "not-required" | "granted" | "refused";
  };
  before: { version: number; objectCount: number };
  after: { version: number; objectCount: number };
  created: {
    tables: string[];
    indexes: string[];
    triggers: string[];
    views: string[];
    columns: string[];
  };
  result: "success" | "failed";
  error?: { stage: MigrationStage; message: string };
}

export interface MigrationRequest {
  dbPath: string;
  env?: NodeJS.ProcessEnv;
  /** Where the JSON report is written. Defaults to the repository's reports/ directory. */
  reportDir?: string;
  now?: () => Date;
}

export interface MigrationResult {
  ok: boolean;
  exitCode: number;
  stage: MigrationStage;
  message: string;
  reportPath?: string;
  report?: MigrationReport;
}

function refuse(stage: MigrationStage, message: string): MigrationResult {
  return { ok: false, exitCode: 1, stage, message };
}

type MasterRow = { type: string; name: string };

function masterObjects(db: Raw): MasterRow[] {
  return db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as MasterRow[];
}

function tableColumns(db: Raw): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  const out: string[] = [];
  for (const { name } of tables) {
    for (const column of db.prepare("SELECT name FROM pragma_table_info(?)").all(name) as { name: string }[]) {
      out.push(`${name}.${column.name}`);
    }
  }
  return out;
}

function diff(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter((entry) => !seen.has(entry));
}

function namesOf(rows: MasterRow[], type: string): string[] {
  return rows.filter((row) => row.type === type).map((row) => row.name);
}

/**
 * Is `candidate` the same directory as, or underneath, `root`?
 *
 * Both migration containment checks use this instead of `path.resolve(...)` +
 * `startsWith`, because the home guard they sit behind
 * (`samePath` in src/runtime/home-guard.ts) compares Windows paths
 * case-insensitively and normalises Git-Bash spelling. A case-sensitive comparison on
 * the far side of a case-insensitive guard is not a defence: `HOME` set to
 * `<repo-root>\runtime\home` passes the guard, and the live
 * database would then read as "not canonical" while still reading as "inside the state
 * directory" — so the second, separate override token would never be demanded.
 *
 * Containment is strict at the separator, so a sibling that merely shares a prefix
 * (`…\homekeeper`) is not treated as inside `…\home`.
 *
 * This compares *spellings*. A Windows junction or a symlink is a spelling that names a
 * different place, so both call sites feed it paths that have already been through
 * `resolveExistingAncestor`.
 */
export function isPathInside(
  candidate: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const impl = platform === "win32" ? path.win32 : path.posix;
  const child = impl.resolve(candidate);
  const parent = impl.resolve(root);
  const [a, b] = platform === "win32" ? [child.toLowerCase(), parent.toLowerCase()] : [child, parent];
  return a === b || a.startsWith(b + impl.sep);
}

/**
 * Where does `candidate` actually point, without requiring its last components to exist?
 *
 * The migration gate decides *where a write may land*, so it has to reason about the file
 * the operating system will open, not the string the operator typed. A directory junction
 * inside the verified state directory aimed anywhere on the volume would otherwise read as
 * "inside", and a junction aimed at the live runtime home would read as "not canonical" —
 * one token instead of two to advance the live schema.
 *
 * Returns `null` when the path cannot be resolved: only a genuinely absent tail is walked
 * past, so an error such as `EPERM` or a broken reparse target means "unknown location",
 * and unknown means refused.
 */
export function resolveExistingAncestor(candidate: string): string | null {
  const absolute = path.resolve(candidate);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const existing = fs.realpathSync.native(current);
      if (current === absolute) return existing;
      // Re-joining a tail under something that is not a directory describes a path that
      // cannot exist; guessing a location for it would be the unsafe option.
      if (!fs.statSync(existing).isDirectory()) return null;
      return path.join(existing, ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Refuse to migrate the live tree unless the operator named it a second time.
 *
 * The check is containment under `canonicalHome()`, not equality with one filename, so a
 * differently-named database in the runtime home is refused too. Both sides are resolved
 * first, so a link cannot hide the live tree or expose it.
 */
function canonicalStatus(resolvedTarget: string, env: NodeJS.ProcessEnv): "not-required" | "granted" | "refused" {
  const root = resolveExistingAncestor(canonicalHome());
  if (root === null) return "refused";
  if (!isPathInside(resolvedTarget, root)) return "not-required";
  return env[CANONICAL_OVERRIDE_ENV] === CANONICAL_OVERRIDE_VALUE ? "granted" : "refused";
}

function reportFileName(started: Date): string {
  const stamp = started.toISOString().replace(/[:.]/g, "-");
  return `migration-${stamp}.json`;
}

function writeReport(reportDir: string, started: Date, report: MigrationReport): string {
  let file = path.join(reportDir, reportFileName(started));
  // Two runs inside the same millisecond must not overwrite each other's audit trail.
  for (let suffix = 2; fs.existsSync(file); suffix += 1) {
    file = path.join(reportDir, `migration-${started.toISOString().replace(/[:.]/g, "-")}-${suffix}.json`);
  }
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return file;
}

/**
 * Run the pending migrations against one database file, behind the approval gate.
 *
 * Every refusal happens before the file is opened for anything, and writes no report —
 * "the run did not happen" is not an auditable event, and half-written reports invite
 * exactly the invented-approval-record failure Phase 15 produced. A report is written
 * only once the gates passed and DDL was actually attempted, whether that attempt then
 * succeeded or failed.
 */
export function runSchemaMigration(request: MigrationRequest): MigrationResult {
  const env = request.env ?? process.env;
  const now = request.now ?? (() => new Date());
  const started = now();
  const startedAt = started.toISOString();
  const reportDir = request.reportDir ?? path.join(conwayRoot(), "reports");
  const mode = env.CONWAY_HOME_MODE === "isolated" ? "isolated" : "runtime";
  const approval = evaluateMigrationGate(env);

  if (!approval.approved) {
    return refuse("gate", `Migration refused: ${approval.reason}`);
  }

  const home = inspectConwayHome({ mode, env });
  if (!home.ok || !home.stateDir) {
    return refuse("home", `Migration refused: the Conway home guard did not pass — ${home.message}`);
  }

  const target = path.resolve(request.dbPath);
  const real = resolveExistingAncestor(target);
  if (real === null) {
    return refuse(
      "target",
      `Migration refused: ${target} cannot be resolved to a location that can be verified, so it is not approved. Nothing was opened.`,
    );
  }
  const canonical = canonicalStatus(real, env);
  if (canonical === "refused") {
    return refuse(
      "target",
      `Migration refused: ${target} resolves to ${real}, which is inside the canonical runtime home. Advancing the live schema needs ` +
        `${CANONICAL_OVERRIDE_ENV}=${CANONICAL_OVERRIDE_VALUE} as well, which is a separate decision (Phase 19 A9).`,
    );
  }
  // Containment is strict here: the state directory itself is a directory, not a
  // database, so it must be refused rather than opened. Both sides are the resolved
  // locations — a link inside the state directory is not a licence to write outside it.
  const stateDir = path.resolve(home.stateDir);
  const realStateDir = resolveExistingAncestor(stateDir);
  if (realStateDir === null) {
    return refuse("home", `Migration refused: the verified state directory ${stateDir} cannot be resolved. Nothing was opened.`);
  }
  if (real === realStateDir || !isPathInside(real, realStateDir)) {
    return refuse(
      "target",
      `Migration refused: ${target} resolves to ${real}, which is not inside the verified state directory ${home.stateDir}.`,
    );
  }
  if (!fs.existsSync(target)) {
    return refuse("target", `Migration refused: no database at ${target}. Nothing was created.`);
  }

  // Preflight: read-only, so a corrupt or non-Conway database is refused before any DDL.
  let integrity = "ok";
  try {
    const probe = openDatabaseReadOnly(real);
    try {
      const check = probe.pragma("integrity_check") as { integrity_check: string }[];
      integrity = check[0]?.integrity_check ?? "unknown";
    } finally {
      probe.close();
    }
  } catch (error) {
    return refuse("integrity", `Migration refused: the database could not be opened for preflight — ${(error as Error).message}`);
  }
  if (integrity !== "ok") {
    return refuse("integrity", `Migration refused: integrity_check reported "${integrity}". No DDL was run.`);
  }

  const db = new Database(real) as Raw;
  const report: MigrationReport = {
    command: "migrate-schema",
    startedAt,
    finishedAt: now().toISOString(),
    durationMs: 0,
    dbPath: real,
    homeMode: mode,
    targetVersion: SCHEMA_VERSION,
    integrity,
    approval: {
      environmentVariable: MIGRATION_APPROVAL_ENV,
      granted: true,
      canonicalOverride: canonical,
    },
    before: { version: 0, objectCount: 0 },
    after: { version: 0, objectCount: 0 },
    created: { tables: [], indexes: [], triggers: [], views: [], columns: [] },
    result: "failed",
  };

  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const beforeObjects = masterObjects(db);
    const beforeColumns = tableColumns(db);
    report.before = { version: getSchemaVersion(db), objectCount: beforeObjects.length };

    applyMigrations(db);
    assertSchemaIsCurrent(db);

    const afterObjects = masterObjects(db);
    const afterColumns = tableColumns(db);
    report.after = { version: getSchemaVersion(db), objectCount: afterObjects.length };
    report.created = {
      tables: diff(namesOf(beforeObjects, "table"), namesOf(afterObjects, "table")),
      indexes: diff(namesOf(beforeObjects, "index"), namesOf(afterObjects, "index")),
      triggers: diff(namesOf(beforeObjects, "trigger"), namesOf(afterObjects, "trigger")),
      views: diff(namesOf(beforeObjects, "view"), namesOf(afterObjects, "view")),
      columns: diff(beforeColumns, afterColumns),
    };
    report.result = "success";
  } catch (error) {
    report.error = { stage: "migration", message: (error as Error).message };
  } finally {
    try {
      db.close();
    } catch {
      /* a handle that will not close is reported by the failure that already happened */
    }
  }

  const finished = now();
  report.finishedAt = finished.toISOString();
  report.durationMs = Math.max(0, finished.getTime() - started.getTime());
  const reportPath = writeReport(reportDir, started, report);

  if (report.result === "failed") {
    logger.error("Schema migration failed", new Error(report.error?.message), { dbPath: target });
    return {
      ok: false,
      exitCode: 1,
      stage: "migration",
      message: `Migration failed: ${report.error?.message}`,
      reportPath,
      report,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    stage: "success",
    message: `Schema migrated from ${report.before.version} to ${report.after.version}; ${report.created.tables.length} tables, ${report.created.indexes.length} indexes, ${report.created.triggers.length} triggers, ${report.created.columns.length} columns created.`,
    reportPath,
    report,
  };
}
