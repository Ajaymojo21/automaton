/**
 * Lockdown & Activation Tests
 *
 * Covers the supervised-installation controls added in Phase 8:
 * - activation gate (config flag + environment token)
 * - security config normalization (fail closed)
 * - deny-by-default tool allowlist
 * - per-capability lockdown rules (financial, host shell, self-mod,
 *   replication, external exposure)
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type {
  AutomatonTool,
  PolicyRequest,
  SpendTrackerInterface,
  SecurityConfig,
} from "../types.js";
import {
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_TREASURY_POLICY,
} from "../types.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { checkActivation, ACTIVATION_ENV_VAR } from "../security/activation.js";
import { normalizeSecurityConfig } from "../config.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.exec(`
    CREATE TABLE policy_decisions (
      id TEXT PRIMARY KEY,
      turn_id TEXT,
      tool_name TEXT NOT NULL,
      tool_args_hash TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      decision TEXT NOT NULL,
      rules_evaluated TEXT NOT NULL DEFAULT '[]',
      rules_triggered TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function createTool(overrides: Partial<AutomatonTool> = {}): AutomatonTool {
  return {
    name: "test_tool",
    description: "test",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
    riskLevel: "safe",
    category: "vm",
    ...overrides,
  };
}

function evaluate(tool: AutomatonTool, security: SecurityConfig) {
  const db = createDb();
  const engine = new PolicyEngine(
    db,
    createDefaultRules(DEFAULT_TREASURY_POLICY, security),
  );
  const request: PolicyRequest = {
    tool,
    args: {},
    context: {} as any,
    turnContext: {
      inputSource: "creator",
      turnToolCallCount: 0,
      sessionSpend: {} as SpendTrackerInterface,
    },
  };
  const decision = engine.evaluate(request);
  db.close();
  return decision;
}

function security(overrides: Partial<SecurityConfig>): SecurityConfig {
  return { ...DEFAULT_SECURITY_CONFIG, ...overrides };
}

describe("checkActivation", () => {
  it("denies when the config flag is absent", () => {
    expect(checkActivation({ security: undefined }, {}).approved).toBe(false);
  });

  it("denies when the config flag is true but the environment token is missing", () => {
    const status = checkActivation({ security: security({ activationApproved: true }) }, {});
    expect(status.approved).toBe(false);
    expect(status.reason).toContain(ACTIVATION_ENV_VAR);
  });

  it("denies when the environment token is present but the config flag is false", () => {
    const status = checkActivation(
      { security: security({ activationApproved: false }) },
      { [ACTIVATION_ENV_VAR]: "APPROVED" },
    );
    expect(status.approved).toBe(false);
  });

  it("approves only when both signals are present", () => {
    const status = checkActivation(
      { security: security({ activationApproved: true }) },
      { [ACTIVATION_ENV_VAR]: "APPROVED" },
    );
    expect(status.approved).toBe(true);
  });

  it("rejects look-alike environment values", () => {
    const status = checkActivation(
      { security: security({ activationApproved: true }) },
      { [ACTIVATION_ENV_VAR]: "approved" },
    );
    expect(status.approved).toBe(false);
  });
});

describe("normalizeSecurityConfig", () => {
  it("defaults to locked down with no allowed tools", () => {
    expect(normalizeSecurityConfig(undefined)).toEqual(DEFAULT_SECURITY_CONFIG);
  });

  it("fails closed on malformed values", () => {
    const normalized = normalizeSecurityConfig({
      lockdown: "false",
      activationApproved: "true",
      allowedTools: "read_file",
      allowFinancialTools: 1,
    });
    expect(normalized.lockdown).toBe(true);
    expect(normalized.activationApproved).toBe(false);
    expect(normalized.allowedTools).toEqual([]);
    expect(normalized.allowFinancialTools).toBe(false);
  });

  it("keeps a valid allowlist and drops non-string entries", () => {
    const normalized = normalizeSecurityConfig({
      allowedTools: ["read_file", 42, null, "memory_search"],
    });
    expect(normalized.allowedTools).toEqual(["read_file", "memory_search"]);
  });
});

describe("Lockdown rules", () => {
  it("denies every tool when the allowlist is empty", () => {
    const decision = evaluate(createTool({ name: "read_file" }), security({}));
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("TOOL_NOT_ALLOWED");
  });

  it("allows an explicitly allow-listed safe tool", () => {
    const decision = evaluate(
      createTool({ name: "read_file" }),
      security({ allowedTools: ["read_file"] }),
    );
    expect(decision.action).toBe("allow");
  });

  it("denies financial tools even when allow-listed, unless enabled", () => {
    const decision = evaluate(
      createTool({ name: "topup_credits", category: "financial", riskLevel: "caution" }),
      security({ allowedTools: ["topup_credits"] }),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("FINANCIAL_DISABLED");
  });

  it("denies host shell execution even when allow-listed", () => {
    const decision = evaluate(
      createTool({ name: "exec", category: "vm", riskLevel: "caution" }),
      security({ allowedTools: ["exec"] }),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("HOST_SHELL_DISABLED");
  });

  it("denies self-modification tools", () => {
    const decision = evaluate(
      createTool({ name: "edit_own_file", category: "self_mod", riskLevel: "dangerous" }),
      security({ allowedTools: ["edit_own_file"] }),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("SELF_MODIFICATION_DISABLED");
  });

  it("denies replication tools", () => {
    const decision = evaluate(
      createTool({ name: "spawn_child", category: "replication", riskLevel: "dangerous" }),
      security({ allowedTools: ["spawn_child"] }),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("REPLICATION_DISABLED");
  });

  it("denies external exposure tools", () => {
    const decision = evaluate(
      createTool({ name: "expose_port", category: "conway", riskLevel: "caution" }),
      security({ allowedTools: ["expose_port"] }),
    );
    expect(decision.action).toBe("deny");
    expect(decision.reasonCode).toBe("EXTERNAL_EXPOSURE_DISABLED");
  });

  it("does not restrict tools when lockdown is disabled", () => {
    const decision = evaluate(
      createTool({ name: "read_file" }),
      security({ lockdown: false }),
    );
    expect(decision.action).toBe("allow");
  });
});
