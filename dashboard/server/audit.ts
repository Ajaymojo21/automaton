import fs from "node:fs";
import path from "node:path";
import { DASHBOARD_LOGS_DIR } from "./paths.js";
import { redact, redactJson } from "./redact.js";

export interface AuditEvent {
  at: string;
  event: string;
  actor?: string;
  ip?: string;
  method?: string;
  route?: string;
  verdict?: string;
  detail?: unknown;
}

function fileFor(today: Date): string {
  const stamp = today.toISOString().slice(0, 10);
  return path.join(DASHBOARD_LOGS_DIR, `audit-${stamp}.jsonl`);
}

/** Append-only, best-effort. A failed audit write must not take down a read-only console,
 *  and must not be reported as a system state change. */
export function audit(event: AuditEvent): void {
  try {
    fs.mkdirSync(DASHBOARD_LOGS_DIR, { recursive: true });
    const line = JSON.stringify({ ...event, detail: redact(event.detail) });
    fs.appendFileSync(fileFor(new Date()), `${redactJson(line)}\n`, "utf-8");
  } catch {
    /* no sink is a reported condition, never a silent one; see /api/system audit state */
  }
}

export function auditLogState(): { dir: string; writable: boolean; files: number } {
  try {
    fs.mkdirSync(DASHBOARD_LOGS_DIR, { recursive: true });
    fs.accessSync(DASHBOARD_LOGS_DIR, fs.constants.W_OK);
    return { dir: DASHBOARD_LOGS_DIR, writable: true, files: fs.readdirSync(DASHBOARD_LOGS_DIR).length };
  } catch {
    return { dir: DASHBOARD_LOGS_DIR, writable: false, files: 0 };
  }
}
