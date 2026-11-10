/**
 * Phase 16A.5 (R-6) — audit and spend-tracking visibility.
 *
 * Two silent-failure paths were investigated and closed:
 *
 * 1. `tryAppendSecurityEvent` caught every error and returned null without a trace. On a
 *    schema V11 database — which is what the live install still is — `security_events`
 *    does not exist, so *every* audit append was a no-op that looked like a working
 *    chain. R-6 was recorded as "compensated by the audit chain"; it was not.
 * 2. A failed `recordSpend` after a committed transfer was logged only to the logger, so
 *    the under-counted hourly/daily aggregate had no security-relevant trace either.
 *
 * Both must now leave an observable trace, and the under-count itself must be pinned by a
 * test so the residual risk is measured rather than described.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createDatabase } from "../../state/database.js";
import type { AutomatonDatabase, LogEntry, TreasuryPolicy } from "../../types.js";
import { StructuredLogger } from "../../observability/logger.js";
import { tryAppendSecurityEvent, tryAppendSecuritySeal } from "../../security/audit-chain.js";
import { executeTool } from "../../agent/tools.js";
import { makePolicyEngine, makeTurnContext } from "../helpers/dispatch.js";

const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const BASE_POLICY: TreasuryPolicy = {
  maxSingleTransferCents: 1000,
  maxHourlyTransferCents: 10000,
  maxDailyTransferCents: 10000,
  minimumReserveCents: 0,
  maxX402PaymentCents: 100,
  x402AllowedDomains: ["conway.tech"],
  transferCooldownMs: 0,
  maxTransfersPerTurn: 100,
  maxInferenceDailyCents: 100000,
  requireConfirmationAboveCents: 100000,
  maxMonthlyTransferCents: 100000,
  agentBudgetCents: 100000,
  childBudgetCents: 10000,
};

let entries: LogEntry[];

beforeEach(() => {
  entries = [];
  StructuredLogger.setSink((entry) => entries.push(entry));
});

afterEach(() => {
  StructuredLogger.resetSink();
});

function errorEntriesFor(moduleFragment: string): LogEntry[] {
  return entries.filter((e) => e.level === "error" && e.module.includes(moduleFragment));
}

describe("tryAppendSecurityEvent — a dropped audit write must be visible", () => {
  it("logs when the security_events table does not exist", () => {
    const bare = new Database(":memory:");
    bare.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)");

    const row = tryAppendSecurityEvent(bare, {
      severity: "HIGH",
      category: "tool",
      eventType: "tool.denied",
      details: { tool: "exec", reasonCode: "POLICY_ENGINE_MISSING" },
    });

    expect(row).toBeNull();
    const logged = errorEntriesFor("audit-chain");
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toContain("not recorded");
    expect(logged[0].context?.eventType).toBe("tool.denied");
    expect(String(logged[0].context?.reason)).toContain("security_events");
    bare.close();
  });

  it("logs nothing when the append succeeds", () => {
    const db = createDatabase(":memory:");
    try {
      const row = tryAppendSecurityEvent(db.raw, {
        severity: "HIGH",
        category: "tool",
        eventType: "tool.denied",
        details: { tool: "exec" },
      });
      expect(row).not.toBeNull();
      expect(errorEntriesFor("audit-chain")).toHaveLength(0);
      const count = db.raw
        .prepare("SELECT COUNT(*) AS c FROM security_events")
        .get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("still returns null without throwing when sealing an empty chain", () => {
    const db = createDatabase(":memory:");
    try {
      expect(tryAppendSecuritySeal(db.raw)).toBeNull();
      const logged = errorEntriesFor("audit-chain");
      expect(logged).toHaveLength(1);
      expect(logged[0].message).toContain("seal");
    } finally {
      db.close();
    }
  });
});

describe("spend tracking failure — R-6 fail-open made observable", () => {
  let db: AutomatonDatabase;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function makeContext() {
    return {
      identity: { name: "test", address: RECIPIENT, sandboxId: "" },
      config: {
        treasuryPolicy: BASE_POLICY,
        // Explicit tool grant: this suite exercises treasury accounting, not
        // authorization, which phase15-tool-security.test.ts covers.
        security: {
          lockdown: false,
          allowedTools: [],
          allowedCapabilities: ["financial", "wallet_signing", "network_access"],
        },
      },
      db,
      conway: { getCreditsBalance: async () => 100_000 },
      inference: {},
    } as any;
  }

  const transferTool = {
    name: "transfer_credits",
    description: "test",
    category: "financial" as const,
    riskLevel: "dangerous" as const,
    parameters: { type: "object", properties: {} },
    execute: async () => "Credit transfer submitted: $1.00",
  };

  function turnWithFailingTracker(turnId: string) {
    const turn = makeTurnContext(db, turnId) as any;
    turn.sessionSpend = {
      recordSpend: () => {
        throw new Error("SQLITE_BUSY: database is locked");
      },
      getHourlySpend: () => 0,
      getDailySpend: () => 0,
      getTotalSpend: () => 0,
      checkLimit: () => ({
        allowed: true,
        currentHourlySpend: 0,
        currentDailySpend: 0,
        limitHourly: 10000,
        limitDaily: 10000,
      }),
      pruneOldRecords: () => 0,
    };
    return turn;
  }

  function auditRows(eventType: string): Array<{ severity: string; details: string }> {
    return db.raw
      .prepare("SELECT severity, details FROM security_events WHERE event_type = ?")
      .all(eventType) as Array<{ severity: string; details: string }>;
  }

  it("records a CRITICAL audit event when the transfer committed but the spend row did not", async () => {
    const context = makeContext();
    const result = await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [transferTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      turnWithFailingTracker("turn-tracking-failed"),
    );

    expect(result.error).toBeUndefined();
    const rows = auditRows("spend.tracking_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("CRITICAL");
    expect(JSON.parse(rows[0].details)).toMatchObject({
      tool: "transfer_credits",
      amountCents: 100,
    });
    expect(JSON.parse(rows[0].details).reason).toContain("SQLITE_BUSY");
  });

  it("leaves the committed treasury row intact — the failure is visibility, not rollback", async () => {
    const context = makeContext();
    await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [transferTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      turnWithFailingTracker("turn-commit-kept"),
    );

    const treasury = db.raw
      .prepare("SELECT status, amount_cents FROM treasury_authorizations")
      .get() as { status: string; amount_cents: number };
    expect(treasury.status).toBe("committed");
    expect(treasury.amount_cents).toBe(100);
  });

  it("pins the residual under-count: spend_tracking stays empty while treasury_authorizations is not", async () => {
    const context = makeContext();
    await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [transferTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      turnWithFailingTracker("turn-undercount"),
    );

    const spend = db.raw
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM spend_tracking")
      .get() as { total: number };
    expect(spend.total).toBe(0);
    const treasury = db.raw
      .prepare("SELECT SUM(amount_cents) AS total FROM treasury_authorizations WHERE status = 'committed'")
      .get() as { total: number | null };
    expect(treasury.total).toBe(100);
  });

  it("records the spend row and no failure event when tracking works", async () => {
    const context = makeContext();
    await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [transferTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      makeTurnContext(db, "turn-healthy"),
    );

    const spend = db.raw
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM spend_tracking WHERE category = 'transfer'")
      .get() as { total: number };
    expect(spend.total).toBe(100);
    expect(auditRows("spend.tracking_failed")).toHaveLength(0);
  });

  it("does not invent an audit event when no turn context ran the spend path", async () => {
    const context = makeContext();
    // A blocked tool never reaches spend recording, so there is nothing to report.
    const blockedTool = { ...transferTool, execute: async () => "Blocked: policy" };
    const result = await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [blockedTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      turnWithFailingTracker("turn-blocked"),
    );
    expect(result.result ?? result.error).toContain("Blocked");
    expect(auditRows("spend.tracking_failed")).toHaveLength(0);
  });
});

describe("R-6 wiring gap: no code path records 'inference' spend", () => {
  let db: AutomatonDatabase;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("the inference daily cap rule does fire once such a row exists — so only the writer is missing", async () => {
    const { SpendTracker } = await import("../../agent/spend-tracker.js");
    const tracker = new SpendTracker(db.raw);
    tracker.recordSpend({ toolName: "inference", amountCents: 5000, category: "inference" });

    const { PolicyEngine } = await import("../../agent/policy-engine.js");
    const { createDefaultRules } = await import("../../agent/policy-rules/index.js");
    const context = {
      identity: { name: "test", address: RECIPIENT, sandboxId: "" },
      config: {
        treasuryPolicy: BASE_POLICY,
        security: {
          lockdown: false,
          allowedTools: [],
          // "inference" maps to the external_api capability in the authorizer, so a
          // context without that grant is denied before the policy layer even runs.
          allowedCapabilities: ["financial", "network_access", "external_api"],
        },
      },
      db,
      conway: { getCreditsBalance: async () => 100_000 },
      inference: {},
    } as any;

    const inferenceTool = {
      name: "inference",
      description: "test",
      category: "conway" as const,
      riskLevel: "safe" as const,
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    };

    const lowBudget = { ...BASE_POLICY, maxInferenceDailyCents: 1000 };
    const engine = new PolicyEngine(
      db.raw,
      createDefaultRules(lowBudget, { ...context.config.security }),
    );
    const result = await executeTool(
      "inference",
      {},
      [inferenceTool],
      context,
      engine,
      { inputSource: "agent", turnToolCallCount: 0, sessionSpend: tracker, turnId: "turn-infer" } as any,
    );
    expect(result.error).toContain("INFERENCE_BUDGET_EXCEEDED");
  });

  it("but a healthy dispatch of the two recording tools writes no inference row", async () => {
    const context = {
      identity: { name: "test", address: RECIPIENT, sandboxId: "" },
      config: {
        treasuryPolicy: BASE_POLICY,
        security: {
          lockdown: false,
          allowedTools: [],
          allowedCapabilities: ["financial", "wallet_signing", "network_access"],
        },
      },
      db,
      conway: { getCreditsBalance: async () => 100_000 },
      inference: {},
    } as any;
    const transferTool = {
      name: "transfer_credits",
      description: "test",
      category: "financial" as const,
      riskLevel: "dangerous" as const,
      parameters: { type: "object", properties: {} },
      execute: async () => "Credit transfer submitted: $1.00",
    };
    await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [transferTool],
      context,
      makePolicyEngine(db, context, BASE_POLICY),
      makeTurnContext(db, "turn-no-inference"),
    );

    const categories = db.raw
      .prepare("SELECT DISTINCT category FROM spend_tracking")
      .all() as Array<{ category: string }>;
    expect(categories.map((c) => c.category)).toEqual(["transfer"]);
  });
});
