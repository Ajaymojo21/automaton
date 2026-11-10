/**
 * Central Tool Authorizer (Phase 15D)
 *
 * Deny-by-default authorization for every tool dispatch, independent of the
 * policy engine and of model prompts. A tool runs only when:
 *
 *   1. it is classified into at least one capability class;
 *   2. it is not revoked;
 *   3. its name is allowlisted, or *all* of its capabilities are granted
 *      (explicitly or through a legacy capability flag).
 *
 * The authorizer also supplies the dispatch timeout and output cap, and records
 * an audit event for every decision.
 */

import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type {
  AutomatonConfig,
  AutomatonTool,
  SecurityConfig,
  ToolCapability,
} from "../types.js";
import { DEFAULT_SECURITY_CONFIG } from "../types.js";
import { tryAppendSecurityEvent } from "./audit-chain.js";

type DatabaseType = BetterSqlite3.Database;

/** Explicit classification for every built-in tool. */
const TOOL_CAPABILITIES: Record<string, ToolCapability[]> = {
  exec: ["shell_execution"],
  write_file: ["filesystem_write"],
  read_file: ["filesystem_read"],
  expose_port: ["network_access", "publishing"],
  remove_port: ["network_access", "publishing"],
  check_credits: ["read_only", "external_api"],
  check_usdc_balance: ["read_only", "external_api"],
  topup_credits: ["financial", "wallet_signing", "network_access"],
  create_sandbox: ["administrative", "external_api"],
  delete_sandbox: ["administrative"],
  list_sandboxes: ["read_only"],
  edit_own_file: ["administrative", "filesystem_write"],
  revert_last_edit: ["administrative", "filesystem_write"],
  reset_to_upstream: ["administrative", "filesystem_write", "shell_execution"],
  install_npm_package: ["administrative", "filesystem_write", "shell_execution", "network_access"],
  review_upstream_changes: ["read_only", "shell_execution"],
  pull_upstream: ["administrative", "filesystem_write", "shell_execution", "network_access"],
  modify_heartbeat: ["administrative"],
  sleep: ["administrative"],
  enter_low_compute: ["administrative"],
  system_synopsis: ["read_only"],
  heartbeat_ping: ["read_only"],
  distress_signal: ["read_only", "external_api"],
  update_genesis_prompt: ["administrative", "filesystem_write"],
  install_mcp_server: ["administrative", "network_access", "shell_execution"],
  transfer_credits: ["financial", "wallet_signing", "network_access"],
  install_skill: ["administrative", "filesystem_write", "network_access"],
  list_skills: ["read_only"],
  create_skill: ["administrative", "filesystem_write"],
  remove_skill: ["administrative", "filesystem_write"],
  git_status: ["read_only", "shell_execution"],
  git_diff: ["read_only", "shell_execution"],
  git_commit: ["shell_execution", "filesystem_write"],
  git_log: ["read_only", "shell_execution"],
  git_push: ["shell_execution", "network_access"],
  git_branch: ["shell_execution", "filesystem_write"],
  git_clone: ["shell_execution", "filesystem_write", "network_access"],
  register_erc8004: ["financial", "wallet_signing", "network_access", "publishing"],
  update_agent_card: ["publishing", "network_access"],
  discover_agents: ["read_only", "network_access"],
  give_feedback: ["wallet_signing", "network_access"],
  check_reputation: ["read_only", "network_access"],
  spawn_child: ["agent_spawning", "administrative"],
  list_children: ["read_only"],
  fund_child: ["financial", "wallet_signing", "network_access"],
  check_child_status: ["read_only"],
  start_child: ["agent_spawning", "administrative"],
  message_child: ["agent_spawning", "network_access"],
  verify_child_constitution: ["read_only"],
  prune_dead_children: ["agent_spawning", "administrative"],
  send_message: ["network_access", "external_api"],
  list_models: ["read_only"],
  switch_model: ["administrative"],
  check_inference_spending: ["read_only"],
  search_domains: ["read_only", "network_access"],
  register_domain: ["publishing", "network_access", "financial"],
  manage_dns: ["publishing", "network_access"],
  update_soul: ["administrative", "filesystem_write"],
  reflect_on_soul: ["read_only"],
  view_soul: ["read_only"],
  view_soul_history: ["read_only"],
  remember_fact: ["administrative"],
  recall_facts: ["read_only"],
  set_goal: ["administrative"],
  complete_goal: ["administrative"],
  cancel_goal: ["administrative"],
  save_procedure: ["administrative"],
  recall_procedure: ["read_only"],
  note_about_agent: ["administrative"],
  review_memory: ["administrative"],
  forget: ["administrative"],
  x402_fetch: ["financial", "network_access", "wallet_signing"],
  create_goal: ["administrative", "agent_spawning"],
  list_goals: ["read_only"],
  get_plan: ["read_only"],
  complete_task: ["administrative"],
  orchestrator_status: ["read_only"],
};

const CATEGORY_CAPABILITIES: Record<string, ToolCapability[]> = {
  vm: ["shell_execution"],
  conway: ["external_api"],
  self_mod: ["administrative", "filesystem_write"],
  financial: ["financial", "network_access"],
  survival: ["administrative"],
  skills: ["administrative", "filesystem_write"],
  git: ["shell_execution"],
  registry: ["publishing", "network_access"],
  replication: ["agent_spawning"],
  memory: ["administrative"],
};

/** Legacy boolean flags grant these capabilities. */
const LEGACY_CAPABILITY_FLAGS: Partial<Record<keyof SecurityConfig, ToolCapability[]>> = {
  allowHostShell: ["shell_execution", "filesystem_write"],
  allowFinancialTools: ["financial", "wallet_signing"],
  allowSelfModification: ["administrative"],
  allowReplication: ["agent_spawning"],
  allowExternalExposure: ["publishing", "network_access"],
};

export interface ToolAuthorizationOptions {
  actor?: string;
  args?: Record<string, unknown>;
  db?: DatabaseType;
  now?: Date;
}

export interface ToolAuthorization {
  allowed: boolean;
  reasonCode: string;
  message: string;
  capabilities: ToolCapability[];
  timeoutMs: number;
  maxOutputBytes: number;
}

/** True when the tool name appears in the explicit builtin classification map. */
export function isExplicitlyClassified(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, toolName);
}

export function capabilitiesForTool(tool: Pick<AutomatonTool, "name" | "category">): ToolCapability[] {
  const explicit = TOOL_CAPABILITIES[tool.name];
  if (explicit) return explicit;
  return CATEGORY_CAPABILITIES[tool.category] ?? [];
}

function hashArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "none";
  const stable = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(stable, "utf-8").digest("hex").slice(0, 32);
}

function effectiveCapabilities(security: SecurityConfig): Set<ToolCapability> {
  const granted = new Set<ToolCapability>(security.allowedCapabilities ?? []);
  for (const [flag, caps] of Object.entries(LEGACY_CAPABILITY_FLAGS)) {
    if ((security as unknown as Record<string, unknown>)[flag] === true) {
      for (const cap of caps!) granted.add(cap);
    }
  }
  return granted;
}

export function authorizeToolCall(
  tool: Pick<AutomatonTool, "name" | "category">,
  config: AutomatonConfig,
  options: ToolAuthorizationOptions = {},
): ToolAuthorization {
  const security = config.security ?? DEFAULT_SECURITY_CONFIG;
  const capabilities = capabilitiesForTool(tool);
  const timeoutMs = security.maxToolDurationMs ?? 60000;
  const maxOutputBytes = security.maxToolOutputBytes ?? 65536;

  const decide = (
    allowed: boolean,
    reasonCode: string,
    message: string,
  ): ToolAuthorization => {
    if (options.db) {
      tryAppendSecurityEvent(
        options.db,
        {
          severity: allowed ? "INFO" : "MEDIUM",
          category: "tool",
          eventType: allowed ? "tool.authorized" : "tool.denied",
          actor: options.actor ?? null,
          details: {
            tool: tool.name,
            capabilities,
            reasonCode,
            argsHash: hashArgs(options.args),
          },
        },
        options.now ?? new Date(),
      );
    }
    return { allowed, reasonCode, message, capabilities, timeoutMs, maxOutputBytes };
  };

  if ((security.revokedTools ?? []).includes(tool.name)) {
    return decide(false, "TOOL_REVOKED", `Tool "${tool.name}" is revoked`);
  }

  if (capabilities.length === 0) {
    return decide(
      false,
      "UNCLASSIFIED_TOOL",
      `Tool "${tool.name}" has no capability classification and is denied`,
    );
  }

  if ((security.allowedTools ?? []).includes(tool.name)) {
    return decide(true, "ALLOWED_BY_NAME", `Tool "${tool.name}" is allowlisted by name`);
  }

  const granted = effectiveCapabilities(security);
  const missing = capabilities.filter((cap) => !granted.has(cap));
  if (missing.length === 0) {
    return decide(
      true,
      "ALLOWED_BY_CAPABILITY",
      `Tool "${tool.name}" granted via capabilities: ${capabilities.join(", ")}`,
    );
  }

  return decide(
    false,
    "NOT_ALLOWLISTED",
    `Tool "${tool.name}" requires capabilities not granted: ${missing.join(", ")}`,
  );
}

/** Tool name allowlisted for reporting, independent of execution. */
export function describeToolClassification(tool: Pick<AutomatonTool, "name" | "category">): {
  name: string;
  capabilities: ToolCapability[];
} {
  return { name: tool.name, capabilities: capabilitiesForTool(tool) };
}
