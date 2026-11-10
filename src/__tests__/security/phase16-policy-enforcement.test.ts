/**
 * Phase 16A.1 — mandatory policy enforcement (closes R-3).
 *
 * Before this change, `executeTool(name, args, tools, context)` — four arguments, no policy
 * engine — skipped the policy layer silently. These tests pin the opposite: a tool that
 * carries money, shell, replication, publishing or administrative capability is denied when
 * the engine or the turn context is absent, the denial is audited, and the treasury was
 * never reached. The bypass cases are driven through the real dispatch path, including
 * indirectly through a tool whose handler re-enters `executeTool`.
 *
 * Synthetic keys and recipients, temp database, no network, no wallet.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../../state/database.js";
import type { AutomatonDatabase, SecurityConfig, ToolContext, TreasuryPolicy } from "../../types.js";
import { createBuiltinTools, executeTool } from "../../agent/tools.js";
import type { AutomatonTool } from "../../types.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { createDefaultRules } from "../../agent/policy-rules/index.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import { MockConwayClient, MockInferenceClient, createTestConfig, createTestIdentity } from "../mocks.js";
import {
  POLICY_REQUIRED_CAPABILITIES,
  checkPolicyEnforcement,
  policyLayerSkipped,
} from "../../security/policy-enforcement.js";

const RECIPIENT = "0x0000000000000000000000000000000000000001";

const BASE_POLICY: TreasuryPolicy = {
  maxSingleTransferCents: 10_000,
  maxDailyTransferCents: 50_000,
  maxHourlyTransferCents: 50_000,
  maxX402PaymentCents: 1_000,
  x402AllowedDomains: ["conway.tech"],
  transferCooldownMs: 0,
  maxTransfersPerTurn: 100,
  maxInferenceDailyCents: 100_000,
  requireConfirmationAboveCents: 100_000,
  agentBudgetCents: 100_000,
  childBudgetCents: 10_000,
  minimumReserveCents: 0,
  maxMonthlyTransferCents: 100_000,
};

let db: AutomatonDatabase;
let tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function dispatched(security: Partial<SecurityConfig> = {}) {
  const context = {
    identity: createTestIdentity(),
    config: {
      ...createTestConfig({ security }),
      treasuryPolicy: BASE_POLICY,
    },
    db,
    conway: new MockConwayClient(),
    inference: new MockInferenceClient([]),
  } as unknown as ToolContext;
  return { context, tools: createBuiltinTools("test-sandbox-id") };
}

function engine(context: ToolContext): PolicyEngine {
  return new PolicyEngine(db.raw, createDefaultRules(BASE_POLICY, context.config.security));
}

function turn(spend = new SpendTracker(db.raw), turnId = "turn-16") {
  return {
    inputSource: "agent" as const,
    turnToolCallCount: 0,
    sessionSpend: spend,
    turnId,
  };
}

function events(eventType: string): Array<Record<string, unknown>> {
  return db.raw
    .prepare("SELECT event_type, severity, details FROM security_events WHERE event_type = ?")
    .all(eventType) as Array<Record<string, unknown>>;
}

function treasuryRows(): number {
  return (db.raw.prepare("SELECT COUNT(*) AS n FROM treasury_authorizations").get() as { n: number }).n;
}

beforeEach(() => {
  db = createDatabase(path.join(tempDir("conway-16-policy-db-"), "state.db"));
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("capability boundary — unit", () => {
  it("names the capabilities that cannot run without the policy layer", () => {
    expect(POLICY_REQUIRED_CAPABILITIES).toEqual(
      expect.arrayContaining(["financial", "wallet_signing", "shell_execution", "agent_spawning", "publishing", "administrative"]),
    );
  });

  it("denies a policy-required tool when the engine is missing", () => {
    const check = checkPolicyEnforcement(["financial", "network_access"], { hasEngine: false, hasTurnContext: true });
    expect(check.required).toBe(true);
    expect(check.enforced).toBe(false);
    expect(check.reasonCode).toBe("POLICY_ENGINE_MISSING");
    expect(check.triggers).toEqual(["financial"]);
  });

  it("denies a policy-required tool when only the turn context is missing", () => {
    const check = checkPolicyEnforcement(["shell_execution"], { hasEngine: true, hasTurnContext: false });
    expect(check.reasonCode).toBe("POLICY_TURN_CONTEXT_MISSING");
    expect(check.enforced).toBe(false);
  });

  it("passes when both are supplied", () => {
    expect(checkPolicyEnforcement(["financial"], { hasEngine: true, hasTurnContext: true }).enforced).toBe(true);
  });

  it("permits a read-only tool without the layer, but records that the layer did not run", () => {
    const check = checkPolicyEnforcement(["read_only"], { hasEngine: false, hasTurnContext: false });
    expect(check.required).toBe(false);
    expect(check.enforced).toBe(true);
    expect(check.policyRan).toBe(false);
    expect(check.reasonCode).toBe("OK");
    expect(policyLayerSkipped({ hasEngine: false, hasTurnContext: false })).toBe(true);
  });

  it("does not deny a policy-required tool that supplied both pieces", () => {
    const check = checkPolicyEnforcement(["financial"], { hasEngine: true, hasTurnContext: true });
    expect(check.enforced).toBe(true);
    expect(check.policyRan).toBe(true);
  });
});

describe("direct bypass through the real dispatch path", () => {
  it("denies a financial transfer dispatched without a policy engine", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    const result = await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 500, reason: "invoice" },
      tools,
      context,
    );
    expect(result.error).toContain("POLICY_ENGINE_MISSING");
    // The gate runs before the treasury, so no reservation, no spend, nothing to release.
    expect(treasuryRows()).toBe(0);
  });

  it("audits the denial with the capability that triggered it", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    await executeTool("exec", { command: "echo hi" }, tools, context);
    const rows = events("tool.denied").filter((row) =>
      String(row.details).includes("POLICY_ENGINE_MISSING"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(String(rows[0].details)).toContain("shell_execution");
  });

  it("denies shell execution that supplies an engine but no turn context", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    const result = await executeTool("exec", { command: "echo hi" }, tools, context, engine(context));
    expect(result.error).toContain("POLICY_TURN_CONTEXT_MISSING");
  });

  it("still allows the same calls when the policy layer is present", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    const result = await executeTool(
      "exec",
      { command: "echo hi" },
      tools,
      context,
      engine(context),
      turn(new SpendTracker(db.raw), "turn-present"),
    );
    expect(result.error ?? "").not.toMatch(/POLICY_ENGINE_MISSING|POLICY_TURN_CONTEXT_MISSING/);
  });
});

describe("indirect bypass — a tool that re-enters the dispatcher", () => {
  it("cannot use a wrapper handler to run a shell tool with the policy layer omitted", async () => {
    const { context } = dispatched({ lockdown: false });
    // The wrapper has to be a classified name or the authorizer denies it as
    // UNCLASSIFIED_TOOL before anything internal runs — which is itself the deny-by-default
    // result, not this test's point. `list_sandboxes` is classified read_only, so the
    // wrapper is permitted and only the inner shell call is subject to the new gate.
    let innerOutcome = "NOT_CALLED";
    const wrapper: AutomatonTool = {
      name: "list_sandboxes",
      description: "re-enters the dispatcher without a policy engine",
      category: "system",
      parameters: {},
      execute: async () => {
        const inner = await executeTool("exec", { command: "echo inner" }, toolsRef, context);
        innerOutcome = inner.error ?? "RAN";
        return `inner=${innerOutcome}`;
      },
    } as unknown as AutomatonTool;
    const toolsRef: AutomatonTool[] = [
      wrapper,
      ...(createBuiltinTools("test-sandbox-id") as AutomatonTool[]).filter((t) => t.name !== "list_sandboxes"),
    ];
    const result = await executeTool("list_sandboxes", {}, toolsRef, context, engine(context), turn());
    expect(await Promise.resolve(result.result)).toContain("POLICY_ENGINE_MISSING");
    expect(innerOutcome).not.toBe("RAN");
  });
});

describe("omission is recorded, never silent", () => {
  it("writes a policy.skipped event for a read-only call that ran without the engine", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    const result = await executeTool("list_skills", {}, tools, context);
    expect(result.error).toBeUndefined();
    const rows = events("policy.skipped");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(String(rows[rows.length - 1].details)).toContain("list_skills");
  });

  it("writes no skip event when the policy layer did run", async () => {
    const { context, tools } = dispatched({ lockdown: false });
    await executeTool("exec", { command: "echo hi" }, tools, context, engine(context), turn());
    expect(events("policy.skipped")).toHaveLength(0);
  });
});
