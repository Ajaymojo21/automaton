/**
 * Phase 16A.1 — shared helpers for dispatching through the mandatory policy layer.
 *
 * `executeTool` now denies any capability-bearing call that omits the policy engine
 * or the turn context. Tests that exercise the layers behind that gate (sandbox,
 * treasury, revocation, tool bodies) therefore have to assemble the engine the way
 * src/index.ts does, so it is defined once here instead of per suite.
 */

import { PolicyEngine } from "../../agent/policy-engine.js";
import { createDefaultRules } from "../../agent/policy-rules/index.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import type { AutomatonDatabase, InputSource, ToolContext, TreasuryPolicy } from "../../types.js";

export interface TestTurnContext {
  inputSource: InputSource | undefined;
  turnToolCallCount: number;
  sessionSpend: SpendTracker;
  turnId?: string;
}

/** The engine a production dispatch runs, built from this context's own config. */
export function makePolicyEngine(
  db: AutomatonDatabase,
  context: ToolContext,
  treasuryPolicy?: TreasuryPolicy,
): PolicyEngine {
  return new PolicyEngine(
    db.raw,
    createDefaultRules(treasuryPolicy ?? context.config.treasuryPolicy, context.config.security),
  );
}

export function makeTurnContext(
  db: AutomatonDatabase,
  turnId: string,
  inputSource: InputSource | undefined = "agent",
): TestTurnContext {
  return {
    inputSource,
    turnToolCallCount: 0,
    sessionSpend: new SpendTracker(db.raw),
    turnId,
  };
}
