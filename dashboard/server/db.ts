import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { assertHome } from "./home.js";
import { DB_PATH } from "./paths.js";
import { describe } from "./values.js";

export type Db = Database.Database;

export interface DbHandle {
  db: Db;
  file: string;
  identity: string;
}

let handle: DbHandle | null = null;
let lastError: string | null = null;

function fileIdentity(file: string): string {
  const st = fs.statSync(file);
  return `${st.size}:${st.mtimeMs.toFixed(0)}`;
}

function open(file: string): DbHandle {
  // readonly + fileMustExist are the whole guarantee: SQLite will not create the file,
  // will not write, and therefore cannot run the V12/V13 migrations that
  // src/state/database.ts:createDatabase() applies on every open. That function is on
  // the Phase 16 DANGER LIST and is never imported by the dashboard.
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 1000");
  return { db, file, identity: fileIdentity(file) };
}

/**
 * Returns the live read-only handle, or an error string. Never throws and never falls
 * back to another path: if `DB_PATH` is not there, the caller reports UNKNOWN.
 */
export function getDb(): { ok: true; handle: DbHandle } | { ok: false; error: string } {
  try {
    assertHome();
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
  if (!fs.existsSync(DB_PATH)) {
    return { ok: false, error: `no database at ${DB_PATH}` };
  }
  let identity: string;
  try {
    identity = fileIdentity(DB_PATH);
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
  if (handle && handle.identity === identity && handle.file === path.resolve(DB_PATH)) {
    return { ok: true, handle };
  }
  if (handle) {
    try {
      handle.db.close();
    } catch {
      /* the replacement below is authoritative; a stuck handle is not reported as state */
    }
  }
  try {
    handle = open(DB_PATH);
    lastError = null;
    return { ok: true, handle };
  } catch (cause) {
    handle = null;
    lastError = describe(cause);
    return { ok: false, error: lastError };
  }
}

export function lastDbError(): string | null {
  return lastError;
}

export function closeDb(): void {
  if (!handle) return;
  try {
    handle.db.close();
  } catch {
    /* closing on shutdown is best-effort */
  }
  handle = null;
}

export function tableNames(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function countRows(db: Db, table: string): number {
  // `table` only ever comes from tableNames() or a literal, so the interpolation below
  // cannot receive browser input; the double-quote escape is belt-and-braces.
  const safe = table.replace(/"/g, '""');
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${safe}"`).get() as { n: number };
  return row.n;
}

export function integrityCheck(db: Db): string {
  const row = db.prepare("PRAGMA integrity_check").get() as Record<string, string>;
  return Object.values(row)[0] ?? "unknown";
}

export function schemaVersion(db: Db): { live: number | null; code: number } {
  const names = tableNames(db);
  let live: number | null = null;
  if (names.has("schema_version")) {
    const row = db
      .prepare("SELECT MAX(version) AS v FROM schema_version")
      .get() as { v: number | null };
    live = row.v ?? null;
  }
  return { live, code: CODE_SCHEMA_VERSION };
}

/** Mirrors src/state/database.ts migrations V1..V14; kept as a literal so the dashboard
 *  never has to open a write handle to learn what the code expects. */
export const CODE_SCHEMA_VERSION = 14;

/** Tables the Phase 16 inventory found ABSENT in the live (V11) database. */
export const KNOWN_ABSENT_TABLES = [
  "treasury_authorizations",
  "security_events",
  "security_incidents",
  "security_seals",
  "repair_approvals",
  "repair_approval_events",
];
