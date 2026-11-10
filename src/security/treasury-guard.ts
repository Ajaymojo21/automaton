/**
 * Centralized Treasury Authorization (Phase 15C)
 *
 * Every financial action must pass through `TreasuryGuard.authorize()` before
 * the tool executes and `commit()`/`release()` afterwards. The guard:
 *
 *   - reserves budget atomically so concurrent calls cannot double-spend;
 *   - enforces per-transaction, hourly, daily, monthly, reserve, cooldown,
 *     agent-lifetime and child-lifetime limits;
 *   - rejects duplicate/replayed idempotency keys;
 *   - writes an immutable authorization row and a hash-chained security event;
 *   - fails closed: an unavailable guard blocks the operation.
 *
 * All checks and the reservation insert happen inside one IMMEDIATE SQLite
 * transaction, and the API is synchronous, so there is no await between the
 * limit check and the reservation.
 */

import { ulid } from "ulid";
import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonConfig, TreasuryPolicy } from "../types.js";
import { DEFAULT_TREASURY_POLICY, LOCKDOWN_TREASURY_POLICY } from "../types.js";
import { tryAppendSecurityEvent } from "./audit-chain.js";

type DatabaseType = BetterSqlite3.Database;

export type TreasuryOperation =
  | "transfer_out"
  | "child_funding"
  | "credit_purchase"
  | "x402_payment";

export interface TreasuryRequest {
  operation: TreasuryOperation;
  toolName: string;
  amountCents: number;
  recipient?: string;
  domain?: string;
  childId?: string;
  /** Current Conway credit balance; required for transfers and child funding. */
  balanceCents?: number;
  /** Stable key used to reject duplicate submissions of the same call. */
  idempotencyKey?: string;
  actor?: string;
  nowMs?: number;
}

export interface TreasuryDecision {
  allowed: boolean;
  authorizationId: string | null;
  idempotencyKey: string;
  reasonCode?: string;
  message?: string;
}

export interface TreasuryCommitResult {
  ok: boolean;
  reason?: string;
  overrun?: boolean;
}

export const TRANSFER_OPERATIONS: TreasuryOperation[] = [
  "transfer_out",
  "child_funding",
];

const ACTIVE = "decision = 'allow' AND status IN ('reserved','committed')";

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function resolveTreasuryPolicy(config: AutomatonConfig): TreasuryPolicy {
  // Under lockdown every monetary limit is zero regardless of what the persisted
  // config claims (F-1 remediation). A missing/undefined policy also resolves to
  // the lockdown policy when lockdown is engaged.
  if (config.security?.lockdown) {
    return { ...LOCKDOWN_TREASURY_POLICY };
  }
  if (config.treasuryPolicy) {
    return { ...DEFAULT_TREASURY_POLICY, ...config.treasuryPolicy };
  }
  return DEFAULT_TREASURY_POLICY;
}

export interface TreasuryIntent {
  operation: TreasuryOperation;
  amountCents: number;
  recipient?: string;
  domain?: string;
  childId?: string;
}

export type IntentResolution =
  | { kind: "none" }
  | { kind: "invalid"; reasonCode: string; message: string }
  | { kind: "financial"; intent: TreasuryIntent };

/**
 * Map a tool call to its treasury intent. Non-financial tools return "none".
 * Malformed amounts for financial tools return "invalid" so the central layer
 * rejects them even if the tool's own validation would have run later.
 */
export function resolveTreasuryIntent(
  toolName: string,
  args: Record<string, unknown>,
  policy: TreasuryPolicy,
): IntentResolution {
  const invalid = (message: string): IntentResolution => ({
    kind: "invalid",
    reasonCode: "INVALID_AMOUNT",
    message,
  });
  const positive = (value: unknown): number | null => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
    return n;
  };

  switch (toolName) {
    case "transfer_credits": {
      const amount = positive(args.amount_cents);
      if (amount === null) return invalid("amount_cents must be a positive integer");
      return {
        kind: "financial",
        intent: {
          operation: "transfer_out",
          amountCents: amount,
          recipient: typeof args.to_address === "string" ? args.to_address : undefined,
        },
      };
    }
    case "fund_child": {
      const amount = positive(args.amount_cents);
      if (amount === null) return invalid("amount_cents must be a positive integer");
      if (typeof args.child_id !== "string" || args.child_id.length === 0) {
        return invalid("child_id is required for child funding");
      }
      return {
        kind: "financial",
        intent: {
          operation: "child_funding",
          amountCents: amount,
          childId: args.child_id,
        },
      };
    }
    case "topup_credits": {
      const usd = typeof args.amount_usd === "number" ? args.amount_usd : Number(args.amount_usd);
      if (!Number.isFinite(usd) || usd <= 0) return invalid("amount_usd must be a positive number");
      const cents = Math.round(usd * 100);
      if (!Number.isInteger(cents) || cents <= 0) return invalid("amount_usd is out of range");
      return {
        kind: "financial",
        intent: { operation: "credit_purchase", amountCents: cents },
      };
    }
    case "x402_fetch": {
      // The server decides the price after a 402 response. Authorization is for
      // the configured ceiling; x402Fetch refuses to sign above the same value.
      return {
        kind: "financial",
        intent: {
          operation: "x402_payment",
          amountCents: policy.maxX402PaymentCents,
          domain: (() => {
            try {
              return new URL(args.url as string).hostname;
            } catch {
              return undefined;
            }
          })(),
        },
      };
    }
    default:
      return { kind: "none" };
  }
}

export class TreasuryGuard {
  private db: DatabaseType;
  private policy: TreasuryPolicy;
  private now: () => number;

  constructor(db: DatabaseType, policy: TreasuryPolicy, now: () => number = Date.now) {
    this.db = db;
    this.policy = policy;
    this.now = now;
    this.assertSchema();
  }

  private assertSchema(): void {
    const row = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='treasury_authorizations'",
      )
      .get();
    if (!row) {
      throw new Error("treasury_authorizations table missing; schema migration 12 not applied");
    }
  }

  private sumActive(where: string, params: unknown[]): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) as total
           FROM treasury_authorizations
          WHERE ${ACTIVE}${where ? ` AND ${where}` : ""}`,
      )
      .get(...params) as { total: number };
    return row.total;
  }

  /**
   * Authorize and reserve budget for a financial operation.
   * Never throws for policy violations; throws only on database failure.
   */
  authorize(request: TreasuryRequest): TreasuryDecision {
    const nowMs = request.nowMs ?? this.now();
    const idempotencyKey = request.idempotencyKey ?? ulid();
    const createdAt = new Date(nowMs).toISOString();
    const amount = request.amountCents;
    const policy = this.policy;

    const run = this.db.transaction((): TreasuryDecision => {
      const id = ulid();

      const deny = (
        reasonCode: string,
        message: string,
        keyOverride?: string,
      ): TreasuryDecision => {
        this.db
          .prepare(
            `INSERT INTO treasury_authorizations
               (id, idempotency_key, tool_name, operation, amount_cents, requested_amount_cents,
                recipient, domain, child_id, actor, decision, status, reason_code, reason_message,
                balance_cents, created_ms, created_at, committed_ms)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'deny', 'denied', ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            id,
            keyOverride ?? idempotencyKey,
            request.toolName,
            request.operation,
            Number.isFinite(amount) ? amount : 0,
            request.recipient ?? null,
            request.domain ?? null,
            request.childId ?? null,
            request.actor ?? null,
            reasonCode,
            message,
            request.balanceCents ?? null,
            nowMs,
            createdAt,
          );
        tryAppendSecurityEvent(this.db, {
          severity: "MEDIUM",
          category: "treasury",
          eventType: "treasury.denied",
          actor: request.actor ?? null,
          details: {
            authorizationId: id,
            tool: request.toolName,
            operation: request.operation,
            amountCents: amount,
            reasonCode,
            recipient: request.recipient,
            domain: request.domain,
            childId: request.childId,
          },
        });
        return { allowed: false, authorizationId: null, idempotencyKey, reasonCode, message };
      };

      if (!Number.isInteger(amount) || amount <= 0) {
        return deny("INVALID_AMOUNT", "amount must be a positive integer number of cents");
      }

      const duplicate = this.db
        .prepare("SELECT id FROM treasury_authorizations WHERE idempotency_key = ?")
        .get(idempotencyKey) as { id: string } | undefined;
      if (duplicate) {
        return deny(
          "DUPLICATE_TRANSACTION",
          `Duplicate or replayed request (existing authorization ${duplicate.id})`,
          `replay:${idempotencyKey}:${id}`,
        );
      }

      // Per-operation single cap. Zero disables the operation entirely, which is
      // how the lockdown policy blocks all financial activity.
      const singleCap =
        request.operation === "x402_payment"
          ? policy.maxX402PaymentCents
          : policy.maxSingleTransferCents;
      if (singleCap <= 0) {
        return deny("OPERATION_DISABLED", "Financial operations are disabled by treasury policy");
      }
      if (amount > singleCap) {
        return deny(
          "SINGLE_LIMIT_EXCEEDED",
          `Amount ${amount} exceeds per-transaction cap ${singleCap} cents`,
        );
      }

      // The x402 domain allowlist is enforced here as well as in the policy
      // layer. The guard is the last authorization point before money moves, so
      // an in-process caller that bypasses the policy engine still cannot pay an
      // arbitrary domain, and a missing or unparseable host fails closed.
      if (request.operation === "x402_payment") {
        const allowedDomains = policy.x402AllowedDomains;
        if (allowedDomains.length === 0) {
          return deny(
            "DOMAIN_NOT_ALLOWED",
            "x402 payments are disabled (empty domain allowlist)",
          );
        }
        const domain = request.domain?.toLowerCase();
        if (!domain) {
          return deny(
            "DOMAIN_NOT_ALLOWED",
            "x402 payment requires a resolvable request domain",
          );
        }
        const isAllowed = allowedDomains.some((entry) => {
          const suffix = entry.toLowerCase();
          return domain === suffix || domain.endsWith(`.${suffix}`);
        });
        if (!isAllowed) {
          return deny(
            "DOMAIN_NOT_ALLOWED",
            `Domain "${domain}" is not in the x402 allowlist: [${allowedDomains.join(", ")}]`,
          );
        }
      }

      const isTransfer = TRANSFER_OPERATIONS.includes(request.operation);

      if (isTransfer) {
        if (request.operation === "child_funding" && !request.childId) {
          return deny("INVALID_REQUEST", "child_id is required for child funding");
        }
        if (request.balanceCents === undefined || !Number.isFinite(request.balanceCents)) {
          return deny(
            "BALANCE_UNAVAILABLE",
            "Current credit balance is required to authorize a transfer",
          );
        }
      }

      // Cooldown applies to outgoing transfers only.
      if (isTransfer && policy.transferCooldownMs > 0) {
        const last = this.db
          .prepare(
            `SELECT MAX(created_ms) as last_ms FROM treasury_authorizations
              WHERE ${ACTIVE} AND operation IN ('transfer_out','child_funding')`,
          )
          .get() as { last_ms: number | null };
        if (last.last_ms !== null && nowMs - last.last_ms < policy.transferCooldownMs) {
          const waitMs = policy.transferCooldownMs - (nowMs - last.last_ms);
          return deny(
            "TRANSFER_COOLDOWN",
            `Transfer cooldown active; retry in ${Math.ceil(waitMs / 1000)}s`,
          );
        }
      }

      // Balance and reserve. In-flight reservations are subtracted so two
      // concurrent calls cannot both spend the same balance.
      if (isTransfer && request.balanceCents !== undefined) {
        const reservedOut = this.sumActive("operation IN ('transfer_out','child_funding')", []);
        const available = request.balanceCents - reservedOut;
        if (amount > available) {
          return deny(
            "INSUFFICIENT_BALANCE",
            `Amount ${amount} exceeds available balance ${available} cents`,
          );
        }
        if (available - amount < policy.minimumReserveCents) {
          return deny(
            "RESERVE_VIOLATION",
            `Transfer would leave ${available - amount} cents, below the ${policy.minimumReserveCents}-cent reserve`,
          );
        }
      }

      const hourly = this.sumActive("created_ms >= ?", [nowMs - 3_600_000]);
      if (hourly + amount > policy.maxHourlyTransferCents) {
        return deny(
          "HOURLY_LIMIT_EXCEEDED",
          `Hourly cap: ${hourly} + ${amount} > ${policy.maxHourlyTransferCents} cents`,
        );
      }

      const dayStart = startOfUtcDay(nowMs);
      const daily = this.sumActive("created_ms >= ?", [dayStart]);
      if (daily + amount > policy.maxDailyTransferCents) {
        return deny(
          "DAILY_LIMIT_EXCEEDED",
          `Daily cap: ${daily} + ${amount} > ${policy.maxDailyTransferCents} cents`,
        );
      }

      const monthlyCap = policy.maxMonthlyTransferCents ?? 0;
      const monthStart = startOfUtcMonth(nowMs);
      const monthly = this.sumActive("created_ms >= ?", [monthStart]);
      if (monthly + amount > monthlyCap) {
        return deny(
          "MONTHLY_LIMIT_EXCEEDED",
          `Monthly cap: ${monthly} + ${amount} > ${monthlyCap} cents`,
        );
      }

      const agentBudget = policy.agentBudgetCents ?? 0;
      const lifetime = this.sumActive("", []);
      if (lifetime + amount > agentBudget) {
        return deny(
          "AGENT_BUDGET_EXCEEDED",
          `Agent budget: ${lifetime} + ${amount} > ${agentBudget} cents`,
        );
      }

      if (request.operation === "child_funding" && request.childId) {
        const childBudget = policy.childBudgetCents ?? 0;
        const childSpent = this.sumActive("child_id = ? AND operation = 'child_funding'", [
          request.childId,
        ]);
        if (childSpent + amount > childBudget) {
          return deny(
            "CHILD_BUDGET_EXCEEDED",
            `Child budget: ${childSpent} + ${amount} > ${childBudget} cents for ${request.childId}`,
          );
        }
      }

      this.db
        .prepare(
          `INSERT INTO treasury_authorizations
             (id, idempotency_key, tool_name, operation, amount_cents, requested_amount_cents,
              recipient, domain, child_id, actor, decision, status, reason_code, reason_message,
              balance_cents, created_ms, created_at, committed_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'allow', 'reserved', NULL, NULL, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          idempotencyKey,
          request.toolName,
          request.operation,
          amount,
          amount,
          request.recipient ?? null,
          request.domain ?? null,
          request.childId ?? null,
          request.actor ?? null,
          request.balanceCents ?? null,
          nowMs,
          createdAt,
        );

      tryAppendSecurityEvent(this.db, {
        severity: "LOW",
        category: "treasury",
        eventType: "treasury.authorized",
        actor: request.actor ?? null,
        details: {
          authorizationId: id,
          tool: request.toolName,
          operation: request.operation,
          amountCents: amount,
          balanceCents: request.balanceCents,
          recipient: request.recipient,
          domain: request.domain,
          childId: request.childId,
        },
      });

      return { allowed: true, authorizationId: id, idempotencyKey };
    });

    return run.immediate();
  }

  /**
   * Mark a reservation as executed. `actualCents` is optional because some
   * operations (x402) only know the ceiling; if the actual amount exceeds the
   * reserved amount an overrun is recorded as a HIGH security event.
   */
  commit(authorizationId: string, actualCents?: number): TreasuryCommitResult {
    const nowMs = this.now();
    const run = this.db.transaction((): TreasuryCommitResult => {
      const row = this.db
        .prepare(
          "SELECT id, amount_cents FROM treasury_authorizations WHERE id = ? AND status = 'reserved'",
        )
        .get(authorizationId) as { id: string; amount_cents: number } | undefined;
      if (!row) return { ok: false, reason: "NOT_RESERVED" };

      let finalAmount = row.amount_cents;
      let overrun = false;
      if (actualCents !== undefined) {
        if (!Number.isInteger(actualCents) || actualCents < 0) {
          return { ok: false, reason: "INVALID_AMOUNT" };
        }
        finalAmount = actualCents;
        overrun = actualCents > row.amount_cents;
      }

      this.db
        .prepare(
          "UPDATE treasury_authorizations SET status = 'committed', amount_cents = ?, committed_ms = ? WHERE id = ?",
        )
        .run(finalAmount, nowMs, authorizationId);

      if (overrun) {
        tryAppendSecurityEvent(this.db, {
          severity: "HIGH",
          category: "treasury",
          eventType: "treasury.overrun",
          actor: null,
          details: {
            authorizationId,
            reservedCents: row.amount_cents,
            actualCents: finalAmount,
          },
        });
      }

      return { ok: true, overrun };
    });
    return run.immediate();
  }

  /** Mark a reservation as not executed, returning its budget to the pool. */
  release(authorizationId: string, reason = "not_executed"): boolean {
    const result = this.db
      .prepare(
        "UPDATE treasury_authorizations SET status = 'released', reason_message = ? WHERE id = ? AND status = 'reserved'",
      )
      .run(reason, authorizationId);
    if (result.changes > 0) {
      tryAppendSecurityEvent(this.db, {
        severity: "LOW",
        category: "treasury",
        eventType: "treasury.released",
        actor: null,
        details: { authorizationId, reason },
      });
    }
    return result.changes > 0;
  }

  getAuthorization(authorizationId: string): Record<string, unknown> | undefined {
    return this.db
      .prepare("SELECT * FROM treasury_authorizations WHERE id = ?")
      .get(authorizationId) as Record<string, unknown> | undefined;
  }

  getRecent(limit = 50): Record<string, unknown>[] {
    return this.db
      .prepare("SELECT * FROM treasury_authorizations ORDER BY created_ms DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
  }
}

const guardCache = new WeakMap<DatabaseType, TreasuryGuard>();

/**
 * One guard per database, so reservations are visible across every tool call
 * in the process.
 */
export function getTreasuryGuard(context: {
  db: { raw: DatabaseType };
  config: AutomatonConfig;
}): TreasuryGuard {
  const existing = guardCache.get(context.db.raw);
  if (existing) return existing;
  const guard = new TreasuryGuard(context.db.raw, resolveTreasuryPolicy(context.config));
  guardCache.set(context.db.raw, guard);
  return guard;
}
