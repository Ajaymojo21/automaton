/**
 * Tamper-evident security audit chain (Phase 15).
 *
 * Every security-relevant event is appended to `security_events` with a hash
 * that covers the previous row's hash, forming a chain. SQLite triggers reject
 * UPDATE and DELETE on the table; `verifySecurityChain` detects edits made by
 * an attacker with direct database access (e.g. by dropping the triggers).
 *
 * This module never throws for audit-writing failures when used with
 * `tryAppendSecurityEvent`; security decisions must not depend on logging. A dropped
 * write is logged, though — an unrecorded event must not be mistaken for an intact chain.
 */

import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

type DatabaseType = BetterSqlite3.Database;

const logger = createLogger("security.audit-chain");

export type SecuritySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SecurityEventInput {
  severity: SecuritySeverity;
  category: string;
  eventType: string;
  actor?: string | null;
  details?: Record<string, unknown>;
}

export interface SecurityEventRow {
  id: string;
  sequence: number;
  timestamp: string;
  severity: SecuritySeverity;
  category: string;
  eventType: string;
  actor: string | null;
  details: string;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

/**
 * Deterministic JSON: object keys are sorted recursively so the same logical
 * event always produces the same hash input.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function computeHash(input: {
  sequence: number;
  timestamp: string;
  severity: string;
  category: string;
  eventType: string;
  actor: string | null;
  details: string;
  prevHash: string;
}): string {
  const material = [
    input.sequence,
    input.timestamp,
    input.severity,
    input.category,
    input.eventType,
    input.actor ?? "",
    input.details,
    input.prevHash,
  ].join("|");
  return createHash("sha256").update(material, "utf-8").digest("hex");
}

/**
 * Append an event. Runs in an IMMEDIATE transaction so the sequence and the
 * previous hash cannot be read by two writers concurrently.
 */
export function appendSecurityEvent(
  db: DatabaseType,
  input: SecurityEventInput,
  now: Date = new Date(),
): SecurityEventRow {
  const timestamp = now.toISOString();
  const details = canonicalJson(input.details ?? {});
  const actor = input.actor ?? null;

  const write = db.transaction((): SecurityEventRow => {
    const last = db
      .prepare(
        "SELECT sequence, hash FROM security_events ORDER BY sequence DESC LIMIT 1",
      )
      .get() as { sequence: number; hash: string } | undefined;

    const sequence = (last?.sequence ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const hash = computeHash({
      sequence,
      timestamp,
      severity: input.severity,
      category: input.category,
      eventType: input.eventType,
      actor,
      details,
      prevHash,
    });

    const row: SecurityEventRow = {
      id: ulid(),
      sequence,
      timestamp,
      severity: input.severity,
      category: input.category,
      eventType: input.eventType,
      actor,
      details,
      prevHash,
      hash,
    };

    db.prepare(
      `INSERT INTO security_events
         (id, sequence, timestamp, severity, category, event_type, actor, details, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.sequence,
      row.timestamp,
      row.severity,
      row.category,
      row.eventType,
      row.actor,
      row.details,
      row.prevHash,
      row.hash,
    );

    return row;
  });

  return write.immediate();
}

/**
 * Best-effort append for paths that must keep working when auditing fails.
 * Returns null instead of throwing; the caller decides how to degrade.
 *
 * The failure is logged. Swallowing it silently made the audit chain look like a
 * compensating control when the `security_events` table was simply absent — which is the
 * state of a schema V11 database, i.e. the live install until V12/V13 are applied.
 */
export function tryAppendSecurityEvent(
  db: DatabaseType,
  input: SecurityEventInput,
  now: Date = new Date(),
): SecurityEventRow | null {
  try {
    return appendSecurityEvent(db, input, now);
  } catch (error) {
    logger.error(
      "Security audit append failed; the event was not recorded",
      error instanceof Error ? error : undefined,
      {
        severity: input.severity,
        category: input.category,
        eventType: input.eventType,
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      },
    );
    return null;
  }
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  reason?: string;
  brokenAtSequence?: number;
}

/** Recompute the digest of a stored row from its fields, ignoring the stored hash. */
function recomputeRowHash(row: SecurityEventRow): string {
  return computeHash({
    sequence: row.sequence,
    timestamp: row.timestamp,
    severity: row.severity,
    category: row.category,
    eventType: row.eventType,
    actor: row.actor,
    details: row.details,
    prevHash: row.prevHash,
  });
}

/**
 * Recompute the chain from the database. Detects deleted rows (sequence gap),
 * edited fields, and a rewritten hash.
 */
export function verifySecurityChain(db: DatabaseType): ChainVerification {
  const rows = db
    .prepare(
      `SELECT id, sequence, timestamp, severity, category, event_type as eventType,
              actor, details, prev_hash as prevHash, hash
         FROM security_events ORDER BY sequence ASC`,
    )
    .all() as SecurityEventRow[];

  let prevHash = GENESIS_HASH;
  let expectedSequence = 1;

  for (const row of rows) {
    if (row.sequence !== expectedSequence) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        reason: `sequence gap: expected ${expectedSequence}, found ${row.sequence}`,
        brokenAtSequence: row.sequence,
      };
    }
    if (row.prevHash !== prevHash) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        reason: `previous-hash mismatch at sequence ${row.sequence}`,
        brokenAtSequence: row.sequence,
      };
    }
    if (recomputeRowHash(row) !== row.hash) {
      return {
        valid: false,
        checked: expectedSequence - 1,
        reason: `hash mismatch at sequence ${row.sequence}`,
        brokenAtSequence: row.sequence,
      };
    }
    prevHash = row.hash;
    expectedSequence += 1;
  }

  return { valid: true, checked: rows.length };
}

export interface SecuritySeal {
  id: string;
  sequence: number;
  headHash: string;
  createdMs: number;
  createdAt: string;
  reason: string;
  actor: string | null;
}

/**
 * Anchor the current chain head in an append-only seal row. Seals give a later
 * verifier a second, independent copy of the hash at a known sequence: if the
 * chain is rewritten, the seal no longer matches.
 */
export function appendSecuritySeal(
  db: DatabaseType,
  options: { reason?: string; actor?: string | null; now?: Date } = {},
): SecuritySeal {
  const now = options.now ?? new Date();
  const write = db.transaction(() => {
    const head = db
      .prepare("SELECT sequence, hash FROM security_events ORDER BY sequence DESC LIMIT 1")
      .get() as { sequence: number; hash: string } | undefined;
    if (!head) {
      throw new Error("Cannot seal an empty audit chain");
    }
    // The seal is keyed by the chain sequence it anchors, so verifySeals() can
    // compare it against the recomputed hash at that position. Sealing an
    // unchanged head is a no-op: there is nothing new to anchor.
    const existing = db
      .prepare(
        `SELECT id, sequence, head_hash AS headHash, created_ms AS createdMs,
                created_at AS createdAt, reason, actor
         FROM security_seals WHERE sequence = ?`,
      )
      .get(head.sequence) as SecuritySeal | undefined;
    if (existing) {
      return existing;
    }
    const seal: SecuritySeal = {
      id: ulid(),
      sequence: head.sequence,
      headHash: head.hash,
      createdMs: now.getTime(),
      createdAt: now.toISOString(),
      reason: options.reason ?? "",
      actor: options.actor ?? null,
    };
    db.prepare(
      `INSERT INTO security_seals (id, sequence, head_hash, created_ms, created_at, reason, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      seal.id,
      seal.sequence,
      seal.headHash,
      seal.createdMs,
      seal.createdAt,
      seal.reason,
      seal.actor,
    );
    return seal;
  });
  return write.immediate();
}

/** Best-effort seal for callers that must not fail when sealing is unavailable. */
export function tryAppendSecuritySeal(
  db: DatabaseType,
  options: { reason?: string; actor?: string | null; now?: Date } = {},
): SecuritySeal | null {
  try {
    return appendSecuritySeal(db, options);
  } catch (error) {
    logger.error(
      "Security seal append failed; the chain head was not anchored",
      error instanceof Error ? error : undefined,
      { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
    );
    return null;
  }
}

/**
 * Verify every seal against the chain. A seal whose head hash does not match
 * the recomputed hash at that sequence proves the chain was rewritten after the
 * seal was taken. The recomputation ignores the stored `hash` column: an editor
 * can leave it intact while changing the fields it covers.
 */
export function verifySeals(db: DatabaseType): {
  valid: boolean;
  checked: number;
  reason?: string;
} {
  let seals: Array<{ sequence: number; headHash: string }>;
  try {
    seals = db
      .prepare("SELECT sequence, head_hash AS headHash FROM security_seals ORDER BY sequence")
      .all() as Array<{ sequence: number; headHash: string }>;
  } catch {
    return { valid: false, checked: 0, reason: "security_seals table is unavailable" };
  }
  const rows = db
    .prepare(
      `SELECT id, sequence, timestamp, severity, category, event_type as eventType,
              actor, details, prev_hash as prevHash, hash
       FROM security_events ORDER BY sequence`,
    )
    .all() as SecurityEventRow[];
  const bySequence = new Map(rows.map((row) => [row.sequence, row]));
  for (const seal of seals) {
    const row = bySequence.get(seal.sequence);
    if (!row) {
      return {
        valid: false,
        checked: seals.length,
        reason: `seal references missing sequence ${seal.sequence}`,
      };
    }
    if (recomputeRowHash(row) !== seal.headHash) {
      return {
        valid: false,
        checked: seals.length,
        reason: `seal hash mismatch at sequence ${seal.sequence}`,
      };
    }
  }
  return { valid: true, checked: seals.length };
}
