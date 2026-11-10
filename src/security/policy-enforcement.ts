/**
 * Mandatory policy enforcement (Phase 16A.1, closes R-3).
 *
 * Phase 15 made the tool authorizer, the treasury guard and the sandbox unavoidable inside
 * `executeTool`, but the rule-based policy engine stayed optional: a caller that omitted
 * `policyEngine` or `turnContext` simply skipped that layer and nothing said so. Every
 * call site in the repository does pass them, so the exposure was a hypothetical in-process
 * caller — which is exactly the kind of path a prompt-driven agent can reach by accident.
 *
 * The boundary is drawn at capability, because that is what the policy rules act on:
 * money, shell, replication, publishing and administration cannot execute with the policy
 * layer absent, and the denial is written to the audit chain. Read-only classes may still
 * run without an engine — the authorizer, treasury and sandbox do not depend on one — but
 * the omission is now *recorded* rather than silent, which was the actual defect.
 */
import type { ToolCapability } from "../types.js";

/**
 * Capabilities for which the policy layer is not optional. `filesystem_write` and
 * `network_access` are deliberately excluded: their controls are the sandbox and the
 * domain allowlist, both of which run unconditionally in `executeTool`, and no policy rule
 * reads the turn context they would need.
 */
export const POLICY_REQUIRED_CAPABILITIES: readonly ToolCapability[] = [
  "financial",
  "wallet_signing",
  "shell_execution",
  "agent_spawning",
  "publishing",
  "administrative",
];

export interface PolicyPresence {
  hasEngine: boolean;
  hasTurnContext: boolean;
}

export type PolicyEnforcementReason =
  | "OK"
  | "POLICY_ENGINE_MISSING"
  | "POLICY_TURN_CONTEXT_MISSING";

export interface PolicyEnforcementCheck {
  /** True when the tool carries at least one policy-required capability. */
  required: boolean;
  /**
   * True when the call may proceed as far as the policy layer is concerned: either the
   * layer will evaluate it, or nothing about this tool requires it to. Deliberately not the
   * same as `policyRan` — a read-only call without an engine is permitted, and the first
   * draft of this module conflated the two, which denied every benign read in the suite.
   */
  enforced: boolean;
  /** True only when both the engine and the turn context are actually supplied. */
  policyRan: boolean;
  reasonCode: PolicyEnforcementReason;
  /** The policy-required capabilities this tool carries. */
  triggers: ToolCapability[];
  message: string;
}

function missingPieces(presence: PolicyPresence): PolicyEnforcementReason | "OK" {
  if (!presence.hasEngine) return "POLICY_ENGINE_MISSING";
  if (!presence.hasTurnContext) return "POLICY_TURN_CONTEXT_MISSING";
  return "OK";
}

export function checkPolicyEnforcement(
  capabilities: readonly ToolCapability[],
  presence: PolicyPresence,
): PolicyEnforcementCheck {
  const policyRan = presence.hasEngine && presence.hasTurnContext;
  const triggers = capabilities.filter((c) => POLICY_REQUIRED_CAPABILITIES.includes(c));
  if (triggers.length === 0) {
    return {
      required: false,
      enforced: true,
      policyRan,
      reasonCode: "OK",
      triggers,
      message: "No policy-required capability; policy layer is advisory for this call",
    };
  }

  const missing = missingPieces(presence);
  if (missing !== "OK") {
    return {
      required: true,
      enforced: false,
      policyRan,
      reasonCode: missing,
      triggers,
      message:
        missing === "POLICY_ENGINE_MISSING"
          ? `Tool carries [${triggers.join(", ")}] but no policy engine was supplied; the policy layer cannot be skipped by omitting an argument`
          : `Tool carries [${triggers.join(", ")}] but no turn context was supplied; policy rules on input source, turn budget and session spend cannot be evaluated`,
    };
  }

  return {
    required: true,
    enforced: true,
    policyRan,
    reasonCode: "OK",
    triggers,
    message: "Policy layer is mandatory and present",
  };
}

/** True when a call ran with the policy layer absent — used to make the skip observable. */
export function policyLayerSkipped(presence: PolicyPresence): boolean {
  return !presence.hasEngine || !presence.hasTurnContext;
}
