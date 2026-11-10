/**
 * Phase 15D — Centralized tool authorization
 *
 * Verifies deny-by-default tool dispatch, least-privilege capability grants,
 * revocation, unclassified-tool rejection, direct and indirect invocation,
 * dispatch timeout, output bounds, and audit evidence.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import {
  authorizeToolCall,
  isExplicitlyClassified,
} from "../security/tool-authorizer.js";
import { verifySecurityChain } from "../security/audit-chain.js";
import type {
  AutomatonDatabase,
  AutomatonTool,
  SecurityConfig,
  ToolContext,
  TreasuryPolicy,
} from "../types.js";
import { DEFAULT_SECURITY_CONFIG } from "../types.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
} from "./mocks.js";
import { makePolicyEngine, makeTurnContext } from "./helpers/dispatch.js";

let db: AutomatonDatabase | undefined;

// A syntactically valid destination: dispatch now runs through the policy engine,
// whose argument-validation rule rejects malformed addresses such as "0xabc".
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

afterEach(() => {
  db?.close();
  db = undefined;
});

function strict(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return { ...DEFAULT_SECURITY_CONFIG, ...overrides };
}

function makeTool(
  name: string,
  execute: AutomatonTool["execute"],
  category: AutomatonTool["category"] = "vm",
): AutomatonTool {
  return {
    name,
    description: `test tool ${name}`,
    category,
    riskLevel: "safe",
    parameters: { type: "object", properties: {} },
    execute,
  };
}

function makeContext(security: SecurityConfig, dbOverride?: AutomatonDatabase, configExtra: Record<string, unknown> = {}): ToolContext {
  db = dbOverride ?? createTestDb();
  return {
    identity: createTestIdentity(),
    config: { ...createTestConfig(), security, ...configExtra },
    db,
    conway: new MockConwayClient(),
    inference: new MockInferenceClient([]),
  } as ToolContext;
}

describe("authorizeToolCall — deny by default", () => {
  const config = createTestConfig({ security: strict() });

  it("denies a classified tool when no capability is granted", () => {
    const decision = authorizeToolCall(makeTool("read_file", async () => ""), config);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("NOT_ALLOWLISTED");
    expect(decision.message).toContain("filesystem_read");
  });

  it("denies every builtin when the lockdown defaults are in force", () => {
    const names = ["exec", "write_file", "read_file", "check_credits", "spawn_child"];
    for (const name of names) {
      const decision = authorizeToolCall(makeTool(name, async () => ""), config);
      expect(decision.allowed, `${name} must be denied`).toBe(false);
    }
  });

  it("rejects a tool with no capability classification", () => {
    const unknown = makeTool("mystery_tool", async () => "", "unknown" as AutomatonTool["category"]);
    const decision = authorizeToolCall(unknown, config);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("UNCLASSIFIED_TOOL");
  });
});

describe("capability classification coverage", () => {
  it("classifies every builtin tool explicitly (no category fallback)", () => {
    const builtins = createBuiltinTools("test-sandbox-id");
    expect(builtins.length).toBeGreaterThan(0);
    const unclassified = builtins
      .filter((tool) => !isExplicitlyClassified(tool.name))
      .map((tool) => tool.name);
    expect(unclassified).toEqual([]);
  });
});

describe("authorizeToolCall — explicit grants", () => {
  it("allows a tool allowlisted by exact name", () => {
    const config = createTestConfig({ security: strict({ allowedTools: ["read_file"] }) });
    const decision = authorizeToolCall(makeTool("read_file", async () => ""), config);
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED_BY_NAME");
  });

  it("requires *all* capabilities for multi-capability tools", () => {
    const partial = createTestConfig({ security: strict({ allowedCapabilities: ["network_access"] }) });
    const denied = authorizeToolCall(makeTool("expose_port", async () => ""), partial);
    expect(denied.allowed).toBe(false);
    expect(denied.message).toContain("publishing");

    const full = createTestConfig({
      security: strict({ allowedCapabilities: ["network_access", "publishing"] }),
    });
    const allowed = authorizeToolCall(makeTool("expose_port", async () => ""), full);
    expect(allowed.allowed).toBe(true);
    expect(allowed.reasonCode).toBe("ALLOWED_BY_CAPABILITY");
  });

  it("maps legacy capability flags onto capabilities", () => {
    const config = createTestConfig({ security: strict({ allowHostShell: true }) });
    expect(authorizeToolCall(makeTool("exec", async () => ""), config).allowed).toBe(true);
    // The same flag also grants filesystem_write through the legacy mapping.
    expect(authorizeToolCall(makeTool("write_file", async () => ""), config).allowed).toBe(true);
    // ...but not financial capability.
    expect(authorizeToolCall(makeTool("transfer_credits", async () => ""), config).allowed).toBe(false);
  });

  it("denies a revoked tool even when its capabilities are granted", () => {
    const config = createTestConfig({
      security: strict({
        allowedCapabilities: ["filesystem_read"],
        revokedTools: ["read_file"],
      }),
    });
    const decision = authorizeToolCall(makeTool("read_file", async () => ""), config);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("TOOL_REVOKED");
  });

  it("surfaces the configured dispatch timeout and output cap", () => {
    const config = createTestConfig({
      security: strict({ maxToolDurationMs: 1234, maxToolOutputBytes: 4096 }),
    });
    const decision = authorizeToolCall(makeTool("read_file", async () => ""), config);
    expect(decision.timeoutMs).toBe(1234);
    expect(decision.maxOutputBytes).toBe(4096);
  });
});

describe("executeTool — enforcement", () => {
  it("denies by default and never runs the tool body", async () => {
    let runs = 0;
    const tool = makeTool("read_file", async () => {
      runs += 1;
      return "secret";
    });
    const context = makeContext(strict());

    const result = await executeTool("read_file", { path: "notes.txt" }, [tool], context);

    expect(runs).toBe(0);
    expect(result.result).toBe("");
    expect(result.error).toContain("Tool denied: NOT_ALLOWLISTED");
  });

  it("runs an allowlisted tool and records an audit event without raw arguments", async () => {
    const tool = makeTool("read_file", async () => "harmless");
    const context = makeContext(
      strict({ allowedTools: ["read_file"] }),
    );

    const result = await executeTool(
      "read_file",
      { path: "notes.txt", secret: "s3cr3t-value" },
      [tool],
      context,
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe("harmless");

    // The newest row is now `policy.skipped` (this dispatch deliberately omits the
    // policy engine, which 16A.1 records). Select the authorization event itself —
    // the assertion is about what that event stores, not about event count.
    const row = context.db.raw
      .prepare(
        "SELECT event_type, severity, details FROM security_events WHERE event_type = 'tool.authorized' ORDER BY sequence DESC",
      )
      .get() as { event_type: string; severity: string; details: string };
    expect(row.event_type).toBe("tool.authorized");
    expect(row.severity).toBe("INFO");
    expect(row.details).not.toContain("s3cr3t-value");
    expect(row.details).toContain("argsHash");
  });

  it("denies a nested (indirect) dispatch from an allowed wrapper tool", async () => {
    const exec = makeTool("exec", async () => "executed");
    const wrapper = makeTool(
      "wrapper_tool",
      async (_args, ctx) => {
        const inner = await executeTool("exec", { command: "echo hi" }, [exec, wrapper], ctx);
        return inner.error ? `inner:${inner.error}` : `inner:${inner.result}`;
      },
      "conway",
    );
    const context = makeContext(strict({ allowedTools: ["wrapper_tool"] }));

    const result = await executeTool("wrapper_tool", {}, [exec, wrapper], context);

    expect(result.error).toBeUndefined();
    expect(result.result).toContain("Tool denied: NOT_ALLOWLISTED");
    expect(result.result).not.toContain("executed");
  });

  it("enforces the dispatch timeout", async () => {
    const slow = makeTool(
      "read_file",
      () => new Promise((resolve) => setTimeout(() => resolve("late"), 2000)),
    );
    const context = makeContext(
      strict({ allowedTools: ["read_file"], maxToolDurationMs: 25 }),
    );

    const result = await executeTool("read_file", {}, [slow], context);

    expect(result.result).toBe("");
    expect(result.error).toContain("dispatch timeout");
  });

  it("truncates oversized tool output", async () => {
    const big = "x".repeat(5000);
    const tool = makeTool("read_file", async () => big);
    const context = makeContext(
      strict({ allowedTools: ["read_file"], maxToolOutputBytes: 256 }),
    );

    const result = await executeTool("read_file", {}, [tool], context);

    expect(result.result).toContain("[truncated:");
    expect(Buffer.byteLength(result.result, "utf-8")).toBeLessThanOrEqual(256);
  });

  it("releases a treasury reservation when execution times out", async () => {
    const policy: TreasuryPolicy = {
      maxSingleTransferCents: 1000,
      maxHourlyTransferCents: 5000,
      maxDailyTransferCents: 5000,
      minimumReserveCents: 0,
      maxX402PaymentCents: 100,
      x402AllowedDomains: ["conway.tech"],
      transferCooldownMs: 0,
      maxTransfersPerTurn: 10,
      maxInferenceDailyCents: 100000,
      requireConfirmationAboveCents: 100000,
      maxMonthlyTransferCents: 100000,
      agentBudgetCents: 100000,
      childBudgetCents: 10000,
    };
    const tool = makeTool(
      "transfer_credits",
      () => new Promise((resolve) => setTimeout(() => resolve("sent"), 2000)),
      "financial",
    );
    const context = makeContext(
      strict({
        // lockdown:false — the engine now runs at dispatch and its lockdown rule
        // would deny before the tool body could time out. This test targets the
        // reservation release on timeout, so it needs a non-locked-down config.
        lockdown: false,
        allowedCapabilities: ["financial", "wallet_signing", "network_access"],
        maxToolDurationMs: 25,
      }),
      undefined,
      { treasuryPolicy: policy },
    );

    // transfer_credits is capability-bearing, so the policy layer is mandatory
    // since 16A.1; supply the engine to reach the dispatch timeout under test.
    const result = await executeTool(
      "transfer_credits",
      { to_address: RECIPIENT, amount_cents: 100 },
      [tool],
      context,
      makePolicyEngine(context.db, context),
      makeTurnContext(context.db, "turn-timeout"),
    );

    expect(result.error).toContain("dispatch timeout");
    const row = context.db.raw
      .prepare("SELECT status FROM treasury_authorizations")
      .get() as { status: string };
    expect(row.status).toBe("released");
  });

  it("produces a verifiable hash-chained audit trail", async () => {
    const readTool = makeTool("read_file", async () => "ok");
    const writeTool = makeTool("write_file", async () => "written");
    const context = makeContext(
      strict({ allowedTools: ["read_file", "write_file"] }),
    );

    await executeTool("read_file", { path: "a" }, [readTool, writeTool], context);
    await executeTool(
      "write_file",
      { path: "b", content: "c" },
      [readTool, writeTool],
      context,
    );

    const chain = verifySecurityChain(context.db.raw);
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBeGreaterThanOrEqual(2);
  });
});
