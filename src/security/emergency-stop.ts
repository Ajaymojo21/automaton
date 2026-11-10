/**
 * Emergency stop (Phase 15G)
 *
 * A fail-safe marker that halts agent activity. Engagement writes a marker file
 * and a CRITICAL audit event; the heartbeat tick refuses to run tasks while the
 * marker exists. Clearing requires an explicit human approver — nothing in the
 * agent, mechanic or incident subsystem clears it automatically.
 */

import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { tryAppendSecurityEvent } from "./audit-chain.js";
import { candidateStateDirs, stateDir } from "../runtime/home-guard.js";

type DatabaseType = BetterSqlite3.Database;

export const EMERGENCY_STOP_FILENAME = "EMERGENCY_STOP";

export interface EmergencyStopState {
  engaged: boolean;
  reason?: string;
  engagedAt?: string;
  engagedBy?: string;
  /** Which candidate location held the marker, when one was found. */
  markerPath?: string;
}

function automatonDirs(dir?: string): string[] {
  if (dir) return [path.resolve(dir)];
  // Every location the marker could legitimately be, not just the one this process
  // happens to have in HOME. Reading a single path made the stop fail *open* when the
  // launcher and the reader disagreed about HOME: the marker existed, the check looked
  // somewhere else, and dispatch continued.
  //
  // The process state dir comes first because it is the write target. It used to be
  // last-of-none, which meant an engagement aimed at the real install.
  const primary = [stateDir()];
  return Array.from(new Set([...primary, ...candidateStateDirs()]));
}

export function getEmergencyStopPaths(dir?: string): string[] {
  return automatonDirs(dir).map((d) => path.join(d, EMERGENCY_STOP_FILENAME));
}

export function getEmergencyStopPath(dir?: string): string {
  return getEmergencyStopPaths(dir)[0];
}

/** Read the marker. Any unreadable marker counts as engaged (fail closed). */
export function readEmergencyStop(dir?: string): EmergencyStopState {
  const markerPaths = getEmergencyStopPaths(dir);
  let sawUnreadable: string | null = null;
  for (const markerPath of markerPaths) {
    if (!fs.existsSync(markerPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
      return {
        engaged: true,
        reason: typeof raw.reason === "string" ? raw.reason : "unspecified",
        engagedAt: typeof raw.engagedAt === "string" ? raw.engagedAt : undefined,
        engagedBy: typeof raw.engagedBy === "string" ? raw.engagedBy : undefined,
        markerPath,
      };
    } catch {
      sawUnreadable = markerPath;
    }
  }
  if (sawUnreadable) {
    return { engaged: true, reason: "marker unreadable", markerPath: sawUnreadable };
  }
  return { engaged: false };
}

export function isEmergencyStopEngaged(dir?: string): boolean {
  return readEmergencyStop(dir).engaged;
}

/**
 * The marker lives under the process HOME, so a daemon started with a different
 * HOME would miss it. The audit trail records the same decision durably and is
 * tamper-evident, so it is a second, independent source of truth.
 */
export function isEmergencyStopEngagedInDb(db: DatabaseType): boolean {
  try {
    const hasEvents = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'security_events'")
      .get();
    if (!hasEvents) return false;
    const row = db
      .prepare(
        `SELECT event_type AS eventType FROM security_events
         WHERE event_type IN ('system.emergency_stop', 'system.emergency_stop_cleared')
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get() as { eventType: string } | undefined;
    return row?.eventType === "system.emergency_stop";
  } catch {
    return true;
  }
}

/** Engaged if either the marker file or the audit trail says so. */
export function isEmergencyStopActive(db?: DatabaseType): boolean {
  if (isEmergencyStopEngaged()) return true;
  return db ? isEmergencyStopEngagedInDb(db) : false;
}

export interface EngageOptions {
  reason: string;
  requestedBy?: string;
  dir?: string;
  db?: DatabaseType;
  now?: Date;
  /** Called after the marker is durable; used for in-process shutdown hooks. */
  onStop?: () => void;
}

/**
 * Engage the stop. Idempotent: re-engaging keeps the original reason/time and
 * only records another audit event.
 */
export function engageEmergencyStop(options: EngageOptions): EmergencyStopState {
  if (!options.reason || options.reason.trim().length === 0) {
    throw new Error("Emergency stop requires a non-empty reason");
  }
  const now = options.now ?? new Date();
  const markerPath = getEmergencyStopPath(options.dir);
  const existing = readEmergencyStop(options.dir);

  if (!existing.engaged) {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
    const payload = {
      reason: options.reason,
      engagedAt: now.toISOString(),
      engagedBy: options.requestedBy ?? "automaton",
    };
    const tmp = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, markerPath);
  }

  if (options.db) {
    tryAppendSecurityEvent(
      options.db,
      {
        severity: "CRITICAL",
        category: "system",
        eventType: "system.emergency_stop",
        actor: options.requestedBy ?? null,
        details: {
          reason: options.reason,
          reengaged: existing.engaged,
          marker: path.basename(markerPath),
        },
      },
      now,
    );
  }

  try {
    options.onStop?.();
  } catch {
    // Shutdown hook failure must not un-engage the stop.
  }

  return readEmergencyStop(options.dir);
}

export interface ClearOptions {
  /** Required: identifies the human who approved clearing. */
  confirmedBy: string;
  reason: string;
  dir?: string;
  db?: DatabaseType;
  now?: Date;
}

/**
 * Clear the marker. Requires a named human approver and a reason; both are
 * audited. Returns an error instead of throwing so callers can surface it.
 */
export function clearEmergencyStop(options: ClearOptions): {
  cleared: boolean;
  error?: string;
} {
  if (!options.confirmedBy || options.confirmedBy.trim().length === 0) {
    return {
      cleared: false,
      error: "Clearing the emergency stop requires an explicit human approver",
    };
  }
  if (!options.reason || options.reason.trim().length === 0) {
    return { cleared: false, error: "Clearing the emergency stop requires a reason" };
  }
  const engagedPaths = getEmergencyStopPaths(options.dir).filter((p) => fs.existsSync(p));
  if (engagedPaths.length === 0) {
    return { cleared: false, error: "Emergency stop is not engaged" };
  }
  // Removal covers every location the read side scans. Clearing only the first would
  // leave the stop engaged right after reporting a successful clear.
  for (const markerPath of engagedPaths) fs.unlinkSync(markerPath);

  if (options.db) {
    tryAppendSecurityEvent(
      options.db,
      {
        severity: "MEDIUM",
        category: "system",
        eventType: "system.emergency_stop_cleared",
        actor: options.confirmedBy,
        details: { reason: options.reason, markersRemoved: engagedPaths.length },
      },
      options.now ?? new Date(),
    );
  }
  return { cleared: true };
}
