/**
 * Lockdown Policy Rules
 *
 * Deny-by-default controls for a supervised installation. When lockdown is
 * enabled, only explicitly allow-listed tools may execute, and high-impact
 * capability classes (financial, host shell, self-modification, replication,
 * external exposure) must be individually enabled.
 *
 * These rules are additive: they run before the existing rules so that a
 * denied capability never reaches a later check that could allow it.
 */

import type { PolicyRule, PolicyRequest, PolicyRuleResult, SecurityConfig } from "../../types.js";

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

function isLockedDown(security: SecurityConfig): boolean {
  return security.lockdown === true;
}

/**
 * Deny any tool that is not explicitly allow-listed while in lockdown.
 */
function createToolAllowlistRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.tool_allowlist",
    description: "Deny all tools that are not explicitly allow-listed in lockdown",
    priority: 10,
    appliesTo: { by: "all" },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      const allowed = security.allowedTools ?? [];
      if (allowed.includes(request.tool.name)) return null;

      return deny(
        "lockdown.tool_allowlist",
        "TOOL_NOT_ALLOWED",
        `Tool "${request.tool.name}" is not in the lockdown allowlist`,
      );
    },
  };
}

/**
 * Deny financial tools unless financial operations are explicitly enabled.
 */
function createFinancialLockdownRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.financial",
    description: "Deny financial tool execution unless enabled",
    priority: 11,
    appliesTo: { by: "category", categories: ["financial"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      if (security.allowFinancialTools === true) return null;

      return deny(
        "lockdown.financial",
        "FINANCIAL_DISABLED",
        `Financial tool "${request.tool.name}" is disabled in lockdown`,
      );
    },
  };
}

/**
 * Deny host shell and host file mutation unless explicitly enabled.
 *
 * `write_file`/`edit_own_file` are included because in local (non-sandbox)
 * mode they operate on the host filesystem; the allowlist is the primary
 * control and this rule is defence in depth.
 */
function createHostShellRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.host_shell",
    description: "Deny host shell and host file mutation unless enabled",
    priority: 11,
    appliesTo: {
      by: "name",
      names: ["exec", "write_file"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      if (security.allowHostShell === true) return null;

      return deny(
        "lockdown.host_shell",
        "HOST_SHELL_DISABLED",
        `Host shell/file tool "${request.tool.name}" is disabled in lockdown`,
      );
    },
  };
}

/**
 * Deny self-modification of the agent's own source.
 */
function createSelfModificationRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.self_modification",
    description: "Deny self-modification tools unless enabled",
    priority: 11,
    appliesTo: { by: "category", categories: ["self_mod"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      if (security.allowSelfModification === true) return null;

      return deny(
        "lockdown.self_modification",
        "SELF_MODIFICATION_DISABLED",
        `Self-modification tool "${request.tool.name}" is disabled in lockdown`,
      );
    },
  };
}

/**
 * Deny replication tools unless explicitly enabled.
 */
function createReplicationRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.replication",
    description: "Deny replication tools unless enabled",
    priority: 11,
    appliesTo: { by: "category", categories: ["replication"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      if (security.allowReplication === true) return null;

      return deny(
        "lockdown.replication",
        "REPLICATION_DISABLED",
        `Replication tool "${request.tool.name}" is disabled in lockdown`,
      );
    },
  };
}

/**
 * Deny tools that publish ports or register domains unless external
 * exposure is explicitly enabled.
 */
function createExternalExposureRule(security: SecurityConfig): PolicyRule {
  return {
    id: "lockdown.external_exposure",
    description: "Deny external exposure tools unless enabled",
    priority: 11,
    appliesTo: {
      by: "name",
      names: ["expose_port", "remove_port", "register_domain"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      if (!isLockedDown(security)) return null;
      if (security.allowExternalExposure === true) return null;

      return deny(
        "lockdown.external_exposure",
        "EXTERNAL_EXPOSURE_DISABLED",
        `External exposure tool "${request.tool.name}" is disabled in lockdown`,
      );
    },
  };
}

export function createLockdownRules(security: SecurityConfig): PolicyRule[] {
  return [
    createToolAllowlistRule(security),
    createFinancialLockdownRule(security),
    createHostShellRule(security),
    createSelfModificationRule(security),
    createReplicationRule(security),
    createExternalExposureRule(security),
  ];
}
