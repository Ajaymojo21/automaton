import fs from "node:fs";
import Database from "better-sqlite3";
import { MIGRATION_V14 } from "../../src/state/schema.js";
import { RepairApprovalStore } from "../../src/reliability/repair-approval.js";
import { REPAIR_APPROVALS_DB_PATH } from "./paths.js";
import { assertHome } from "./home.js";
import { describe } from "./values.js";

/**
 * Durable approval storage (B-8).
 *
 * The dashboard's read handle on state.db is `readonly: true` and must stay that way: opening
 * it for write is what runs the V12+ migrations, and that is an operator-gated action. So the
 * approval lifecycle lives in its own SQLite file, created on first write with the V14 DDL.
 *
 * Reads never create the file. A missing file means "no approval has ever been recorded",
 * which the panel reports as UNKNOWN rather than as an empty-but-healthy store.
 */

let writer: RepairApprovalStore | null = null;
let lastError: string | null = null;

export interface StoreUnavailable {
  ok: false;
  error: string;
  /** True when the store exists but simply holds no records yet. */
  absent: boolean;
}

export function readRepairApprovals():
  | { ok: true; store: RepairApprovalStore }
  | StoreUnavailable {
  if (writer) return { ok: true, store: writer };
  if (!fs.existsSync(REPAIR_APPROVALS_DB_PATH)) {
    return { ok: false, error: `no approval store at ${REPAIR_APPROVALS_DB_PATH}`, absent: true };
  }
  try {
    assertHome();
    const db = new Database(REPAIR_APPROVALS_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    return { ok: true, store: new RepairApprovalStore({ db }) };
  } catch (cause) {
    lastError = describe(cause);
    return { ok: false, error: lastError, absent: false };
  }
}

/**
 * Open the writable store, applying the V14 DDL to the dedicated approvals file on first use.
 * Only POST actions reach this path; a failed open is reported, never silently downgraded to
 * an in-memory store (which would lose the approval on restart).
 */
export function writableRepairApprovals():
  | { ok: true; store: RepairApprovalStore }
  | StoreUnavailable {
  if (writer) return { ok: true, store: writer };
  try {
    assertHome();
    const db = new Database(REPAIR_APPROVALS_DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 2000");
    db.exec(MIGRATION_V14);
    writer = new RepairApprovalStore({ db });
    lastError = null;
    return { ok: true, store: writer };
  } catch (cause) {
    lastError = describe(cause);
    return { ok: false, error: lastError, absent: false };
  }
}

export function lastApprovalError(): string | null {
  return lastError;
}

export function closeRepairApprovals(): void {
  writer = null;
}
