/**
 * Repair Approval Lifecycle (Phase 21 B-2, Phase 23 B-8)
 *
 * A safe, auditable approval surface for `requires_approval` repairs.
 *
 * Lifecycle:
 *   DETECTED → DIAGNOSIS → REPAIR_PROPOSED → AWAITING_APPROVAL
 *     → APPROVED / REJECTED / EXPIRED
 *     → READY_FOR_EXECUTION → VERIFICATION → COMPLETED / FAILED
 *
 * Important boundary: approval moves a proposal to READY_FOR_EXECUTION but does
 * NOT execute the repair. Execution remains gated by selfHealingEnabled and the
 * mechanic's own classification. An approved proposal is never "completed" until
 * a separate, explicitly authorized execution step runs and verifies.
 *
 * Storage: when constructed with a better-sqlite3 handle the lifecycle is durable
 * (`repair_approvals` + append-only `repair_approval_events`, schema V14). Without a
 * handle it stays in memory, which is only appropriate for unit tests.
 *
 * Concurrency and replay:
 *   - `revision` increments on every transition; writers may pass `expectedRevision`
 *     and lose the race deterministically instead of overwriting.
 *   - A transition is a single SQL statement guarded by `status` and `revision`, so two
 *     approvers cannot both move AWAITING_APPROVAL to READY_FOR_EXECUTION.
 *   - `idempotencyKey` makes a repeated decision return the original outcome.
 */

import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { tryAppendSecurityEvent } from "../security/audit-chain.js";

type DatabaseType = BetterSqlite3.Database;

export type RepairProposalStatus =
  | "detected"
  | "diagnosis"
  | "repair_proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "ready_for_execution"
  | "verification"
  | "completed"
  | "failed";

export type RepairRisk = "low" | "medium" | "high" | "critical";

export interface RepairProposal {
  id: string;
  findingId: string;
  component: string;
  rootCause: string;
  proposedAction: string;
  expectedBenefit: string;
  potentialSideEffects: string;
  riskClassification: RepairRisk;
  requiredPermissions: string[];
  expectedDowntime: boolean;
  rollbackPossible: boolean;
  createdAt: string;
  expiresAt: string;
  status: RepairProposalStatus;
  approvalIdentity: string | null;
  decisionAt: string | null;
  decisionReason: string | null;
  auditReference: string | null;
  /** Binds an approval to the exact action that was reviewed. */
  actionHash: string;
  /** Monotonic per-proposal version; used for optimistic concurrency. */
  revision: number;
}

export interface ApprovalEvent {
  proposalId: string;
  sequence: number;
  at: string;
  event: string;
  actor: string | null;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface CreateProposalInput {
  findingId: string;
  component: string;
  rootCause: string;
  proposedAction: string;
  expectedBenefit: string;
  potentialSideEffects: string;
  riskClassification: RepairRisk;
  requiredPermissions: string[];
  expectedDowntime: boolean;
  rollbackPossible: boolean;
  ttlMs?: number;
}

export interface DecisionOptions {
  expectedRevision?: number;
  idempotencyKey?: string;
}

export interface ApprovalDecision {
  ok: boolean;
  reason?: string;
  proposal?: RepairProposal;
  /** True when the decision replayed an earlier one with the same idempotency key. */
  replay?: boolean;
}

export interface RepairApprovalStoreOptions {
  db?: DatabaseType;
  now?: () => Date;
  defaultTtlMs?: number;
}

export class DuplicateProposalError extends Error {
  constructor(public readonly existingId: string) {
    super(`a live proposal for this finding and action already exists (${existingId})`);
    this.name = "DuplicateProposalError";
  }
}

interface Row {
  id: string;
  finding_id: string;
  component: string;
  root_cause: string;
  proposed_action: string;
  expected_benefit: string;
  potential_side_effects: string;
  risk_classification: RepairRisk;
  required_permissions: string;
  expected_downtime: number;
  rollback_possible: number;
  created_ms: number;
  expires_ms: number;
  status: RepairProposalStatus;
  approval_identity: string | null;
  decision_ms: number | null;
  decision_reason: string | null;
  audit_reference: string | null;
  action_hash: string;
  revision: number;
  decision_key: string | null;
}

function toProposal(row: Row): RepairProposal {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(row.required_permissions) as unknown;
    if (Array.isArray(parsed)) permissions = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    permissions = [];
  }
  return {
    id: row.id,
    findingId: row.finding_id,
    component: row.component,
    rootCause: row.root_cause,
    proposedAction: row.proposed_action,
    expectedBenefit: row.expected_benefit,
    potentialSideEffects: row.potential_side_effects,
    riskClassification: row.risk_classification,
    requiredPermissions: permissions,
    expectedDowntime: row.expected_downtime === 1,
    rollbackPossible: row.rollback_possible === 1,
    createdAt: new Date(row.created_ms).toISOString(),
    expiresAt: new Date(row.expires_ms).toISOString(),
    status: row.status,
    approvalIdentity: row.approval_identity,
    decisionAt: row.decision_ms === null ? null : new Date(row.decision_ms).toISOString(),
    decisionReason: row.decision_reason,
    auditReference: row.audit_reference,
    actionHash: row.action_hash,
    revision: row.revision,
  };
}

const INSERT_SQL = `
  INSERT INTO repair_approvals (
    id, finding_id, component, root_cause, proposed_action, expected_benefit,
    potential_side_effects, risk_classification, required_permissions,
    expected_downtime, rollback_possible, created_ms, expires_ms, status,
    approval_identity, decision_ms, decision_reason, audit_reference,
    action_hash, revision, decision_key
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_SQL = `
  UPDATE repair_approvals
     SET status = ?, approval_identity = ?, decision_ms = ?, decision_reason = ?,
         audit_reference = ?, revision = revision + 1, decision_key = ?
   WHERE id = ? AND status = ? AND revision = ?`;

/** In-memory persistence: unit tests only. Mirrors the SQL semantics. */
class MemoryPersistence {
  private rows = new Map<string, Row>();
  private events = new Map<string, ApprovalEvent[]>();
  private keys = new Map<string, string>();

  readonly durable = false;

  atomic<T>(fn: () => T): T {
    return fn();
  }

  findLiveDuplicate(findingId: string, actionHash: string): Row | undefined {
    return [...this.rows.values()].find(
      (row) =>
        row.finding_id === findingId &&
        row.action_hash === actionHash &&
        (row.status === "awaiting_approval" || row.status === "ready_for_execution"),
    );
  }

  insert(row: Row): void {
    if (row.decision_key) this.keys.set(row.decision_key, row.id);
    this.rows.set(row.id, row);
  }

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  list(status?: RepairProposalStatus): Row[] {
    const all = [...this.rows.values()].sort((a, b) => a.created_ms - b.created_ms);
    return status ? all.filter((row) => row.status === status) : all;
  }

  update(next: Row, expectedStatus: RepairProposalStatus, expectedRevision: number): boolean {
    const current = this.rows.get(next.id);
    if (!current || current.status !== expectedStatus || current.revision !== expectedRevision) {
      return false;
    }
    if (next.decision_key) this.keys.set(next.decision_key, next.id);
    this.rows.set(next.id, next);
    return true;
  }

  findByIdempotencyKey(key: string): Row | undefined {
    const id = this.keys.get(key);
    return id ? this.rows.get(id) : undefined;
  }

  appendEvent(event: ApprovalEvent): void {
    const list = this.events.get(event.proposalId) ?? [];
    list.push(event);
    this.events.set(event.proposalId, list);
  }

  listEvents(proposalId: string): ApprovalEvent[] {
    return [...(this.events.get(proposalId) ?? [])];
  }

  lastEvent(proposalId: string): ApprovalEvent | undefined {
    riskGuard(proposalId);
    const list = this.events.get(proposalId) ?? [];
    return list[list.length - 1];
  }
}

function riskGuard(_proposalId: string): void {
  /* keeps the shape of lastEvent without a side effect */
}

/** Durable persistence against the V14 tables. */
export class SqlitePersistence {
  readonly durable = true;

  constructor(private readonly db: DatabaseType) {}

  atomic<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  findLiveDuplicate(findingId: string, actionHash: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT * FROM repair_approvals
          WHERE finding_id = ? AND action_hash = ?
            AND status IN ('awaiting_approval','ready_for_execution')
          LIMIT 1`,
      )
      .get(findingId, actionHash) as Row | undefined;
  }

  insert(row: Row): void {
    this.db.prepare(INSERT_SQL).run(
      row.id,
      row.finding_id,
      row.component,
      row.root_cause,
      row.proposed_action,
      row.expected_benefit,
      row.potential_side_effects,
      row.risk_classification,
      row.required_permissions,
      row.expected_downtime,
      row.rollback_possible,
      row.created_ms,
      row.expires_ms,
      row.status,
      row.approval_identity,
      row.decision_ms,
      row.decision_reason,
      row.audit_reference,
      row.action_hash,
      row.revision,
      row.decision_key,
    );
  }

  get(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM repair_approvals WHERE id = ?").get(id) as Row | undefined;
  }

  list(status?: RepairProposalStatus): Row[] {
    const sql = status
      ? "SELECT * FROM repair_approvals WHERE status = ? ORDER BY created_ms ASC"
      : "SELECT * FROM repair_approvals ORDER BY created_ms ASC";
    return (status ? this.db.prepare(sql).all(status) : this.db.prepare(sql).all()) as Row[];
  }

  /** Single guarded statement: the transition either wins the version or does nothing. */
  update(next: Row, expectedStatus: RepairProposalStatus, expectedRevision: number): boolean {
    const result = this.db
      .prepare(UPDATE_SQL)
      .run(
        next.status,
        next.approval_identity,
        next.decision_ms,
        next.decision_reason,
        next.audit_reference,
        next.decision_key,
        next.id,
        expectedStatus,
        expectedRevision,
      );
    return result.changes === 1;
  }

  findByIdempotencyKey(key: string): Row | undefined {
    return this.db
      .prepare("SELECT * FROM repair_approvals WHERE decision_key = ?")
      .get(key) as Row | undefined;
  }

  appendEvent(event: ApprovalEvent): void {
    this.db
      .prepare(
        `INSERT INTO repair_approval_events
           (id, proposal_id, sequence, at_ms, at_iso, event, actor, detail, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        event.proposalId,
        event.sequence,
        new Date(event.at).getTime(),
        event.at,
        event.event,
        event.actor,
        JSON.stringify(event.detail),
        event.prevHash,
        event.hash,
      );
  }

  listEvents(proposalId: string): ApprovalEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM repair_approval_events WHERE proposal_id = ? ORDER BY sequence ASC")
      .all(proposalId) as Array<{
      proposal_id: string;
      sequence: number;
      at_iso: string;
      event: string;
      actor: string | null;
      detail: string;
      prev_hash: string;
      hash: string;
    }>;
    return rows.map((row) => ({
      proposalId: row.proposal_id,
      sequence: row.sequence,
      at: row.at_iso,
      event: row.event,
      actor: row.actor,
      detail: JSON.parse(row.detail) as Record<string, unknown>,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
  }

  lastEvent(proposalId: string): ApprovalEvent | undefined {
    const events = this.listEvents(proposalId);
    return events[events.length - 1];
  }
}

type Persistence = MemoryPersistence | SqlitePersistence;

const GENESIS_HASH = "0".repeat(64);

function eventHash(input: Omit<ApprovalEvent, "hash">): string {
  const canonical = JSON.stringify({
    proposalId: input.proposalId,
    sequence: input.sequence,
    at: input.at,
    event: input.event,
    actor: input.actor,
    detail: input.detail,
    prevHash: input.prevHash,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export class RepairApprovalStore {
  private persist: Persistence;
  private db: DatabaseType | null;
  private now: () => Date;
  private defaultTtlMs: number;

  constructor(options: RepairApprovalStoreOptions = {}) {
    this.db = options.db ?? null;
    this.persist = options.db ? new SqlitePersistence(options.db) : new MemoryPersistence();
    this.now = options.now ?? (() => new Date());
    this.defaultTtlMs = options.defaultTtlMs ?? 24 * 60 * 60 * 1000;
  }

  private hashAction(input: CreateProposalInput): string {
    const canonical = JSON.stringify({
      findingId: input.findingId,
      component: input.component,
      proposedAction: input.proposedAction,
      rootCause: input.rootCause,
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  createProposal(input: CreateProposalInput): RepairProposal {
    const now = this.now();
    const id = `rp-${crypto.randomUUID()}`;
    const ttl = input.ttlMs ?? this.defaultTtlMs;
    const actionHash = this.hashAction(input);

    const row: Row = {
      id,
      finding_id: input.findingId,
      component: input.component,
      root_cause: input.rootCause,
      proposed_action: input.proposedAction,
      expected_benefit: input.expectedBenefit,
      potential_side_effects: input.potentialSideEffects,
      risk_classification: input.riskClassification,
      required_permissions: JSON.stringify(input.requiredPermissions),
      expected_downtime: input.expectedDowntime ? 1 : 0,
      rollback_possible: input.rollbackPossible ? 1 : 0,
      created_ms: now.getTime(),
      expires_ms: now.getTime() + ttl,
      status: "awaiting_approval",
      approval_identity: null,
      decision_ms: null,
      decision_reason: null,
      audit_reference: null,
      action_hash: actionHash,
      revision: 1,
      decision_key: null,
    };

    const duplicate = this.persist.findLiveDuplicate(input.findingId, actionHash);
    if (duplicate) throw new DuplicateProposalError(duplicate.id);

    this.persist.atomic(() => {
      this.persist.insert(row);
      this.appendEvent(row, "repair.proposal.created", null, { status: "awaiting_approval" });
    });
    this.auditSecurityEvent("repair.proposal.created", row, { status: "awaiting_approval" });
    return toProposal(row);
  }

  getProposal(id: string): RepairProposal | undefined {
    const row = this.persist.get(id);
    return row ? toProposal(row) : undefined;
  }

  listProposals(filter?: { status?: RepairProposalStatus }): RepairProposal[] {
    return this.persist.list(filter?.status).map(toProposal);
  }

  listPending(): RepairProposal[] {
    return this.listProposals({ status: "awaiting_approval" });
  }

  listEvents(id: string): ApprovalEvent[] {
    return this.persist.listEvents(id);
  }

  private expireIfNeeded(row: Row): Row {
    if (row.status !== "awaiting_approval" || row.expires_ms > this.now().getTime()) return row;
    const next: Row = { ...row, status: "expired", revision: row.revision + 1 };
    const won = this.persist.update(next, row.status, row.revision);
    if (won) {
      this.appendEvent(next, "repair.proposal.expired", null, { status: "expired" });
      this.auditSecurityEvent("repair.proposal.expired", next, { status: "expired" });
      return next;
    }
    return this.persist.get(row.id) ?? next;
  }

  approve(id: string, identity: string, reason: string, options: DecisionOptions = {}): ApprovalDecision {
    return this.decide("approve", id, identity, reason, options);
  }

  reject(id: string, identity: string, reason: string, options: DecisionOptions = {}): ApprovalDecision {
    return this.decide("reject", id, identity, reason, options);
  }

  private decide(
    kind: "approve" | "reject",
    id: string,
    identity: string,
    reason: string,
    options: DecisionOptions,
  ): ApprovalDecision {
    const stored = this.persist.get(id);
    if (!stored) return { ok: false, reason: "proposal not found" };

    const replayed = this.replay(stored, kind, options.idempotencyKey);
    if (replayed) return replayed;

    const row = this.expireIfNeeded(stored);
    const guard = this.validateDecision(row, identity, reason, kind);
    if (guard) return guard;

    if (options.expectedRevision !== undefined && options.expectedRevision !== row.revision) {
      return {
        ok: false,
        reason: `revision conflict: expected ${options.expectedRevision}, current ${row.revision}`,
        proposal: toProposal(row),
      };
    }

    const next: Row = {
      ...row,
      status: kind === "approve" ? "ready_for_execution" : "rejected",
      approval_identity: identity.trim(),
      decision_ms: this.now().getTime(),
      decision_reason: reason.trim(),
      audit_reference: `audit-${row.id}`,
      revision: row.revision + 1,
      decision_key: options.idempotencyKey ?? null,
    };
    const won = this.persist.atomic(() => {
      if (!this.persist.update(next, "awaiting_approval", row.revision)) return false;
      this.appendEvent(next, `repair.proposal.${kind === "approve" ? "approved" : "rejected"}`, next.approval_identity, {
        reason: next.decision_reason,
      });
      return true;
    });
    if (!won) {
      return { ok: false, reason: "proposal changed during decision; re-read and retry", proposal: this.getProposal(id) };
    }
    this.auditSecurityEvent(`repair.proposal.${kind === "approve" ? "approved" : "rejected"}`, next, {
      identity: next.approval_identity,
      reason: next.decision_reason,
    });
    // Boundary: approval does NOT execute. Status is ready_for_execution, not completed.
    return { ok: true, proposal: toProposal(next) };
  }

  /** Replay an identical decision that already settled this proposal. */
  private replay(row: Row, kind: "approve" | "reject", key?: string): ApprovalDecision | null {
    if (!key) return null;
    const settled = this.persist.findByIdempotencyKey(key);
    if (!settled) return null;
    const expected = kind === "approve" ? "ready_for_execution" : "rejected";
    if (settled.id !== row.id || settled.status !== expected) {
      return { ok: false, reason: "idempotency key already used for a different decision" };
    }
    return { ok: true, proposal: toProposal(settled), replay: true };
  }

  private validateDecision(
    row: Row,
    identity: string,
    reason: string,
    kind: "approve" | "reject",
  ): ApprovalDecision | null {
    if (row.status === "expired") {
      return { ok: false, reason: "proposal has expired", proposal: toProposal(row) };
    }
    if (row.status !== "awaiting_approval") {
      return { ok: false, reason: `proposal is ${row.status}, not awaiting approval`, proposal: toProposal(row) };
    }
    if (!identity || !identity.trim()) {
      return { ok: false, reason: `${kind === "approve" ? "approval" : "rejection"} identity is required`, proposal: toProposal(row) };
    }
    if (!reason || !reason.trim()) {
      return { ok: false, reason: "decision reason is required", proposal: toProposal(row) };
    }
    return null;
  }

  /** Returns true if a proposal was approved for the given action hash. */
  isApprovedForAction(id: string, actionHash: string): boolean {
    const row = this.persist.get(id);
    if (!row) return false;
    if (row.status !== "ready_for_execution") return false;
    if (row.action_hash !== actionHash) return false;
    if (row.expires_ms <= this.now().getTime()) return false;
    return true;
  }

  /** Mark a proposal as completed only after a separate verified execution step. */
  markCompleted(id: string, verificationNote: string): ApprovalDecision {
    return this.terminate(id, "completed", verificationNote, "completed");
  }

  /** Mark a proposal as failed after a verified execution attempt. */
  markFailed(id: string, error: string): ApprovalDecision {
    return this.terminate(id, "failed", error, "failed");
  }

  private terminate(
    id: string,
    status: "completed" | "failed",
    note: string,
    event: string,
  ): ApprovalDecision {
    const row = this.persist.get(id);
    if (!row) return { ok: false, reason: "proposal not found" };
    if (row.status !== "ready_for_execution") {
      return { ok: false, reason: `proposal is ${row.status}, not ready_for_execution` };
    }
    const next: Row = {
      ...row,
      status,
      decision_reason: `${row.decision_reason ?? ""} | ${event}: ${note}`,
      revision: row.revision + 1,
    };
    const won = this.persist.atomic(() => {
      if (!this.persist.update(next, "ready_for_execution", row.revision)) return false;
      this.appendEvent(next, `repair.proposal.${event}`, next.approval_identity, { note });
      return true;
    });
    if (!won) return { ok: false, reason: "proposal changed during transition; re-read and retry" };
    this.auditSecurityEvent(`repair.proposal.${event}`, next, { note });
    return { ok: true, proposal: toProposal(next) };
  }

  private appendEvent(row: Row, event: string, actor: string | null, detail: Record<string, unknown>): void {
    const previous = this.persist.lastEvent(row.id);
    const base: Omit<ApprovalEvent, "hash"> = {
      proposalId: row.id,
      sequence: (previous?.sequence ?? 0) + 1,
      at: this.now().toISOString(),
      event,
      actor,
      detail,
      prevHash: previous?.hash ?? GENESIS_HASH,
    };
    this.persist.appendEvent({ ...base, hash: eventHash(base) });
  }

  private auditSecurityEvent(eventType: string, row: Row, detail: Record<string, unknown>): void {
    if (!this.db) return;
    tryAppendSecurityEvent(this.db, {
      severity: "LOW",
      category: "repair_approval",
      eventType,
      actor: "repair-approval",
      details: { proposalId: row.id, status: row.status, ...detail },
    }, this.now());
  }
}
