/**
 * Security Monitoring & Incident Response (Phase 15G)
 *
 * Converts the hash-chained security event stream into deduplicated incidents
 * with severities INFO/LOW/MEDIUM/HIGH/CRITICAL. Incidents are append-only and
 * are resolved (never deleted). A tamper check verifies both the chain and the
 * seals and recommends the emergency stop when integrity fails.
 */

import { ulid } from "ulid";
import type BetterSqlite3 from "better-sqlite3";
import type { SecuritySeverity } from "./audit-chain.js";
import { verifySecurityChain, verifySeals } from "./audit-chain.js";

type DatabaseType = BetterSqlite3.Database;

export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface SecurityIncident {
  id: string;
  createdMs: number;
  createdAt: string;
  severity: SecuritySeverity;
  category: string;
  incidentType: string;
  title: string;
  description: string;
  sourceSequence: number | null;
  status: IncidentStatus;
  acknowledgedBy: string | null;
  acknowledgedMs: number | null;
  resolvedBy: string | null;
  resolvedMs: number | null;
  resolution: string | null;
}

interface IncidentRow {
  id: string;
  created_ms: number;
  created_at: string;
  severity: SecuritySeverity;
  category: string;
  incident_type: string;
  title: string;
  description: string;
  source_sequence: number | null;
  status: IncidentStatus;
  acknowledged_by: string | null;
  acknowledged_ms: number | null;
  resolved_by: string | null;
  resolved_ms: number | null;
  resolution: string | null;
}

function toIncident(row: IncidentRow): SecurityIncident {
  return {
    id: row.id,
    createdMs: row.created_ms,
    createdAt: row.created_at,
    severity: row.severity,
    category: row.category,
    incidentType: row.incident_type,
    title: row.title,
    description: row.description,
    sourceSequence: row.source_sequence,
    status: row.status,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedMs: row.acknowledged_ms,
    resolvedBy: row.resolved_by,
    resolvedMs: row.resolved_ms,
    resolution: row.resolution,
  };
}

export interface RaiseIncidentInput {
  severity: SecuritySeverity;
  category: string;
  incidentType: string;
  title: string;
  description?: string;
  sourceSequence?: number | null;
  now?: Date;
}

/**
 * Insert an incident. (incident_type, source_sequence) is unique, so repeated
 * scans cannot duplicate the same underlying event.
 */
export function raiseIncident(db: DatabaseType, input: RaiseIncidentInput): SecurityIncident {
  const now = input.now ?? new Date();
  const id = ulid();
  db.prepare(
    `INSERT OR IGNORE INTO security_incidents
       (id, created_ms, created_at, severity, category, incident_type, title, description,
        source_sequence, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  ).run(
    id,
    now.getTime(),
    now.toISOString(),
    input.severity,
    input.category,
    input.incidentType,
    input.title,
    input.description ?? "",
    input.sourceSequence ?? null,
  );

  if (input.sourceSequence !== null && input.sourceSequence !== undefined) {
    const existing = db
      .prepare(
        "SELECT * FROM security_incidents WHERE incident_type = ? AND source_sequence = ?",
      )
      .get(input.incidentType, input.sourceSequence) as IncidentRow | undefined;
    if (existing) return toIncident(existing);
  }
  const row = db.prepare("SELECT * FROM security_incidents WHERE id = ?").get(id) as
    | IncidentRow
    | undefined;
  if (!row) {
    throw new Error("Incident insert did not persist");
  }
  return toIncident(row);
}

export interface IncidentFilter {
  status?: IncidentStatus;
  severity?: SecuritySeverity;
  limit?: number;
}

export function listIncidents(db: DatabaseType, filter: IncidentFilter = {}): SecurityIncident[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.severity) {
    clauses.push("severity = ?");
    params.push(filter.severity);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const rows = db
    .prepare(
      `SELECT * FROM security_incidents ${where} ORDER BY created_ms DESC LIMIT ${limit}`,
    )
    .all(...params) as IncidentRow[];
  return rows.map(toIncident);
}

export function acknowledgeIncident(
  db: DatabaseType,
  id: string,
  actor: string,
  now: Date = new Date(),
): boolean {
  if (!actor || actor.trim().length === 0) return false;
  const result = db
    .prepare(
      "UPDATE security_incidents SET status = 'acknowledged', acknowledged_by = ?, acknowledged_ms = ? WHERE id = ? AND status = 'open'",
    )
    .run(actor, now.getTime(), id);
  return result.changes > 0;
}

export function resolveIncident(
  db: DatabaseType,
  id: string,
  actor: string,
  resolution: string,
  now: Date = new Date(),
): boolean {
  if (!actor || actor.trim().length === 0) return false;
  if (!resolution || resolution.trim().length === 0) return false;
  const result = db
    .prepare(
      "UPDATE security_incidents SET status = 'resolved', resolved_by = ?, resolved_ms = ?, resolution = ? WHERE id = ? AND status IN ('open','acknowledged')",
    )
    .run(actor, now.getTime(), resolution, id);
  return result.changes > 0;
}

export interface IncidentSummary {
  open: number;
  acknowledged: number;
  resolved: number;
  bySeverity: Record<SecuritySeverity, number>;
}

export function incidentSummary(db: DatabaseType): IncidentSummary {
  const rows = db
    .prepare(
      "SELECT status, severity, COUNT(*) AS n FROM security_incidents GROUP BY status, severity",
    )
    .all() as Array<{ status: IncidentStatus; severity: SecuritySeverity; n: number }>;
  const summary: IncidentSummary = {
    open: 0,
    acknowledged: 0,
    resolved: 0,
    bySeverity: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  };
  for (const row of rows) {
    summary[row.status] += row.n;
    summary.bySeverity[row.severity] += row.n;
  }
  return summary;
}

interface EventRow {
  sequence: number;
  timestamp: string;
  severity: SecuritySeverity;
  category: string;
  eventType: string;
  details: string;
}

export interface ScanOptions {
  windowMs?: number;
  now?: Date;
}

/**
 * Scan recent security events and raise incidents. Heuristics:
 *   - CRITICAL events, emergency stops                     → CRITICAL
 *   - wallet access, config change, network exposure       → HIGH
 *   - replay / revoked-tool denials                        → HIGH
 *   - auth failure bursts (>=3 in window)                  → HIGH
 *   - tool denial bursts (>=5 in window)                   → MEDIUM
 *   - treasury denial bursts (>=3 in window)               → MEDIUM
 *   - process spawn events                                 → MEDIUM
 */
export function scanSecurityEvents(
  db: DatabaseType,
  options: ScanOptions = {},
): SecurityIncident[] {
  const now = options.now ?? new Date();
  const windowMs = options.windowMs ?? 10 * 60_000;
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const events = db
    .prepare(
      `SELECT sequence, timestamp, severity, category, event_type AS eventType, details
       FROM security_events WHERE timestamp >= ? ORDER BY sequence`,
    )
    .all(cutoff) as EventRow[];

  const raised: SecurityIncident[] = [];
  const count = (predicate: (event: EventRow) => boolean): number =>
    events.filter(predicate).length;

  for (const event of events) {
    const type = event.eventType;
    if (event.severity === "CRITICAL") {
      raised.push(
        raiseIncident(db, {
          severity: "CRITICAL",
          category: event.category,
          incidentType: "critical_event",
          title: `Critical security event: ${type}`,
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (type === "system.emergency_stop") {
      raised.push(
        raiseIncident(db, {
          severity: "CRITICAL",
          category: "system",
          incidentType: "emergency_stop",
          title: "Emergency stop engaged",
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (event.category === "wallet" || type.startsWith("wallet.")) {
      raised.push(
        raiseIncident(db, {
          severity: "HIGH",
          category: "wallet",
          incidentType: "wallet_access",
          title: `Wallet access: ${type}`,
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (type.startsWith("config.") || type === "security.config_changed") {
      raised.push(
        raiseIncident(db, {
          severity: "HIGH",
          category: "config",
          incidentType: "config_change",
          title: `Security-relevant config change: ${type}`,
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (type === "network.exposure" || type === "network.public_endpoint") {
      raised.push(
        raiseIncident(db, {
          severity: "HIGH",
          category: "network",
          incidentType: "network_exposure",
          title: "Network exposure requested",
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (type === "treasury.denied" && /DUPLICATE_TRANSACTION|REPLAY/i.test(event.details)) {
      raised.push(
        raiseIncident(db, {
          severity: "HIGH",
          category: "financial",
          incidentType: "replay_attempt",
          title: "Replay or duplicate financial attempt blocked",
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
      continue;
    }
    if (type.startsWith("process.spawn")) {
      raised.push(
        raiseIncident(db, {
          severity: "MEDIUM",
          category: "process",
          incidentType: "process_spawn",
          title: `Process spawn: ${type}`,
          description: summarize(event),
          sourceSequence: event.sequence,
          now,
        }),
      );
    }
  }

  const authFailures = count((event) => event.eventType === "auth.failed");
  if (authFailures >= 3) {
    const latest = events.filter((event) => event.eventType === "auth.failed").at(-1)!;
    raised.push(
      raiseIncident(db, {
        severity: "HIGH",
        category: "auth",
        incidentType: "auth_failure_burst",
        title: `${authFailures} authentication failures in ${Math.round(windowMs / 60000)} minutes`,
        description: "Possible credential guessing or token misuse",
        sourceSequence: latest.sequence,
        now,
      }),
    );
  }

  const toolDenials = count((event) => event.eventType === "tool.denied");
  if (toolDenials >= 5) {
    const latest = events.filter((event) => event.eventType === "tool.denied").at(-1)!;
    raised.push(
      raiseIncident(db, {
        severity: "MEDIUM",
        category: "tool",
        incidentType: "tool_denial_burst",
        title: `${toolDenials} tool denials in ${Math.round(windowMs / 60000)} minutes`,
        description: "Repeated attempts to use unpermitted tools",
        sourceSequence: latest.sequence,
        now,
      }),
    );
  }

  const treasuryDenials = count((event) => event.eventType === "treasury.denied");
  if (treasuryDenials >= 3) {
    const latest = events.filter((event) => event.eventType === "treasury.denied").at(-1)!;
    raised.push(
      raiseIncident(db, {
        severity: "MEDIUM",
        category: "financial",
        incidentType: "treasury_denial_burst",
        title: `${treasuryDenials} treasury denials in ${Math.round(windowMs / 60000)} minutes`,
        description: "Repeated attempts to move funds outside policy",
        sourceSequence: latest.sequence,
        now,
      }),
    );
  }

  // Deduplicate the returned list by id (INSERT OR IGNORE may return existing).
  const seen = new Set<string>();
  return raised.filter((incident) => {
    if (seen.has(incident.id)) return false;
    seen.add(incident.id);
    return true;
  });
}

function summarize(event: EventRow): string {
  let details = event.details;
  if (details.length > 500) details = `${details.slice(0, 500)}…`;
  return `${event.eventType} at ${event.timestamp} (sequence ${event.sequence}): ${details}`;
}

export interface TamperCheck {
  chainValid: boolean;
  sealsValid: boolean;
  reason?: string;
  recommendEmergencyStop: boolean;
  incident: SecurityIncident | null;
}

/**
 * Verify chain + seals. A failure is recorded as a CRITICAL incident and the
 * caller is told to engage the emergency stop. This function never clears or
 * rewrites anything.
 */
export function checkTamper(db: DatabaseType, now: Date = new Date()): TamperCheck {
  const chain = verifySecurityChain(db);
  const seals = verifySeals(db);
  const valid = chain.valid && seals.valid;
  if (valid) {
    return {
      chainValid: true,
      sealsValid: true,
      recommendEmergencyStop: false,
      incident: null,
    };
  }
  const reason = !chain.valid
    ? chain.reason ?? "audit chain verification failed"
    : seals.reason ?? "seal verification failed";
  const incident = raiseIncident(db, {
    severity: "CRITICAL",
    category: "integrity",
    incidentType: "audit_tamper",
    title: "Audit trail integrity failure",
    description: reason,
    sourceSequence: -1,
    now,
  });
  return {
    chainValid: chain.valid,
    sealsValid: seals.valid,
    reason,
    recommendEmergencyStop: true,
    incident,
  };
}
