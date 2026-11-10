/**
 * Live-model security pre-flight (Phase 16A.2 / 16D, residual risk R-9).
 *
 * Every control in this repository has so far been exercised only through mocks, because
 * no provider credential exists. Before any real model call, this gate proves that the
 * environment the call would run in cannot spend, sign, publish, replicate, expose or
 * self-modify — and that it is not pointed at the live state tree.
 *
 * It checks; it never changes. Nothing here writes a credential, sets an approval flag,
 * or activates the agent: a failing safety check is a refusal, and a missing credential
 * or missing human approval token is a `PENDING_CREDENTIAL_APPROVAL` verdict.
 *
 * The result object and `summarizePreflight()` carry only presence flags and reason
 * codes, never credential material.
 */

import type { AutomatonConfig, SecurityConfig, TreasuryPolicy } from "../types.js";
import { DEFAULT_SECURITY_CONFIG } from "../types.js";
import { POLICY_REQUIRED_CAPABILITIES } from "./policy-enforcement.js";

/** Every treasury field must be zero for a live-model test run. */
export const TREASURY_ZERO_FIELDS: readonly (keyof TreasuryPolicy)[] = [
  "maxSingleTransferCents",
  "maxHourlyTransferCents",
  "maxDailyTransferCents",
  "maxMonthlyTransferCents",
  "minimumReserveCents",
  "maxX402PaymentCents",
  "transferCooldownMs",
  "maxTransfersPerTurn",
  "maxInferenceDailyCents",
  "requireConfirmationAboveCents",
  "agentBudgetCents",
  "childBudgetCents",
];

/** Provider keys a real call would need; presence only is ever reported. */
export const CREDENTIAL_ENV_VARS: readonly string[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CONWAY_API_KEY",
];

/** The only env token that lets a credential be used at all, and its exact value. */
export const APPROVAL_ENV_VAR = "CONWAY_LIVE_MODEL_APPROVED";
export const APPROVAL_ENV_VALUE = "APPROVED";

/** Activation and wallet-creation env flags that must stay unset (§29 items 2 and 3). */
const PROHIBITED_ENV_FLAGS = ["CONWAY_ACTIVATION", "CONWAY_ALLOW_WALLET_CREATION"] as const;

export interface PreflightCheck {
  id: string;
  requirement: string;
  passed: boolean;
  detail: string;
}

export interface LiveModelPreflightInput {
  config: AutomatonConfig;
  env?: NodeJS.ProcessEnv;
  /** True when any wallet material (wallet.json or a keystore) exists in this home. */
  walletMaterialPresent: boolean;
  /** HOME resolves to the Conway runtime home rather than a fallback location. */
  homeGuardOk: boolean;
  /** That runtime home is a dedicated test home, not the live install's state tree. */
  homeIsIsolatedTestHome: boolean;
  emergencyStopEngaged: boolean;
}

export type LiveModelVerdict = "READY" | "PENDING_CREDENTIAL_APPROVAL" | "SAFETY_GATE_FAILED";

export interface LiveModelPreflightResult {
  verdict: LiveModelVerdict;
  safetyPassed: boolean;
  credentialPresent: boolean;
  approvalPresent: boolean;
  checks: PreflightCheck[];
  failedCheckIds: string[];
}

function securityOf(config: AutomatonConfig): SecurityConfig {
  return { ...DEFAULT_SECURITY_CONFIG, ...(config.security ?? {}) };
}

function check(id: string, requirement: string, passed: boolean, detail: string): PreflightCheck {
  return { id, requirement, passed, detail };
}

function zeroedTreasuryFields(policy: TreasuryPolicy | undefined): string[] {
  if (!policy) return TREASURY_ZERO_FIELDS.map(String);
  return TREASURY_ZERO_FIELDS.filter(
    (field) => typeof policy[field] === "number" && policy[field] !== 0,
  ).map(String);
}

/** Config fields that must be blank on disk; presence alone is reported. */
const CREDENTIAL_CONFIG_FIELDS: readonly (keyof AutomatonConfig)[] = [
  "openaiApiKey",
  "anthropicApiKey",
  "conwayApiKey",
  "walletAddress",
];

function buildSafetyChecks(input: LiveModelPreflightInput): PreflightCheck[] {
  const env = input.env ?? process.env;
  const security = securityOf(input.config);
  const treasury = input.config.treasuryPolicy;
  const nonBlank = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";

  const grantedDangerous = (security.allowedCapabilities ?? []).filter((capability) =>
    POLICY_REQUIRED_CAPABILITIES.includes(capability),
  );
  const nonzeroTreasury = zeroedTreasuryFields(treasury);
  const credentialsOnDisk = CREDENTIAL_CONFIG_FIELDS.filter((field) =>
    nonBlank(input.config[field]),
  );

  return [
    check(
      "home.isolated_test_tree",
      "the test run must use a dedicated runtime home, never the live state tree",
      input.homeGuardOk && input.homeIsIsolatedTestHome,
      `homeGuardOk=${input.homeGuardOk} isolatedTestHome=${input.homeIsIsolatedTestHome}`,
    ),
    check(
      "agent.activation_closed",
      "security.activationApproved must stay false — a model test is not an activation",
      security.activationApproved === false,
      `activationApproved=${String(security.activationApproved)}`,
    ),
    check(
      "env.activation_flags_unset",
      "CONWAY_ACTIVATION and CONWAY_ALLOW_WALLET_CREATION must be unset",
      PROHIBITED_ENV_FLAGS.every((flag) => !nonBlank(env[flag])),
      PROHIBITED_ENV_FLAGS.map((flag) => `${flag}=${env[flag] === undefined ? "unset" : "set"}`).join(" "),
    ),
    check(
      "lockdown.engaged",
      "security.lockdown must be true",
      security.lockdown === true,
      `lockdown=${String(security.lockdown)}`,
    ),
    check(
      "tools.allowlist_empty",
      "no tool may be explicitly allowed for a live-model test",
      (security.allowedTools ?? []).length === 0,
      `allowedTools=${(security.allowedTools ?? []).length}`,
    ),
    check(
      "capabilities.no_privileged_grant",
      `no grant from ${POLICY_REQUIRED_CAPABILITIES.join(", ")}`,
      grantedDangerous.length === 0,
      grantedDangerous.length === 0 ? "none granted" : `granted: ${grantedDangerous.join(", ")}`,
    ),
    check(
      "wallet.no_material",
      "no wallet.json or keystore may exist in the test home",
      !input.walletMaterialPresent,
      `walletMaterialPresent=${String(input.walletMaterialPresent)}`,
    ),
    check(
      "treasury.all_zero",
      "every treasury limit must be zero, so nothing is spendable",
      treasury !== undefined && nonzeroTreasury.length === 0,
      treasury === undefined
        ? "config.treasuryPolicy is absent — defaults are not zero"
        : nonzeroTreasury.length === 0
          ? "all treasury limits are 0"
          : `non-zero: ${nonzeroTreasury.join(", ")}`,
    ),
    check(
      "credential.not_in_config",
      "no provider key or wallet address may be stored in the config file",
      credentialsOnDisk.length === 0,
      credentialsOnDisk.length === 0
        ? "config holds no credential material"
        : `non-empty in config: ${credentialsOnDisk.join(", ")}`,
    ),
    check(
      "treasury.x402_domains_empty",
      "no x402 payment domain may be allowlisted",
      (treasury?.x402AllowedDomains ?? []).length === 0,
      `x402AllowedDomains=${(treasury?.x402AllowedDomains ?? []).length}`,
    ),
    check(
      "financial.disabled",
      "security.allowFinancialTools must be false",
      security.allowFinancialTools === false,
      `allowFinancialTools=${String(security.allowFinancialTools)}`,
    ),
    check(
      "shell.disabled",
      "security.allowHostShell must be false — no unrestricted shell or host file write",
      security.allowHostShell === false,
      `allowHostShell=${String(security.allowHostShell)}`,
    ),
    check(
      "self_modification.disabled",
      "security.allowSelfModification must be false",
      security.allowSelfModification === false,
      `allowSelfModification=${String(security.allowSelfModification)}`,
    ),
    check(
      "replication.disabled",
      "allowReplication false and maxChildren 0 — the agent makes no children",
      security.allowReplication === false && input.config.maxChildren === 0,
      `allowReplication=${String(security.allowReplication)} maxChildren=${String(input.config.maxChildren)}`,
    ),
    check(
      "publishing.disabled",
      "security.allowExternalExposure must be false — no port, domain or public URL",
      security.allowExternalExposure === false,
      `allowExternalExposure=${String(security.allowExternalExposure)}`,
    ),
    check(
      "sandbox.enabled",
      "the application-level sandbox stays on (it is not OS isolation)",
      security.sandboxEnabled !== false,
      `sandboxEnabled=${String(security.sandboxEnabled)}`,
    ),
    check(
      "self_healing.disabled",
      "security.selfHealingEnabled must not be true",
      security.selfHealingEnabled !== true,
      `selfHealingEnabled=${String(security.selfHealingEnabled)}`,
    ),
    check(
      "emergency_stop.not_engaged",
      "an engaged stop halts the run",
      !input.emergencyStopEngaged,
      `engaged=${String(input.emergencyStopEngaged)}`,
    ),
  ];
}

/**
 * Evaluate the gate. Credential and approval presence are reported separately: a missing
 * credential is not a safety failure, it is work that has not been authorised yet.
 */
export function runLiveModelPreflight(input: LiveModelPreflightInput): LiveModelPreflightResult {
  const env = input.env ?? process.env;
  const checks = buildSafetyChecks(input);
  const failedCheckIds = checks.filter((c) => !c.passed).map((c) => c.id);
  const safetyPassed = failedCheckIds.length === 0;

  const credentialPresent = CREDENTIAL_ENV_VARS.some((name) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "";
  });
  const approvalPresent = env[APPROVAL_ENV_VAR] === APPROVAL_ENV_VALUE;

  const verdict: LiveModelVerdict = !safetyPassed
    ? "SAFETY_GATE_FAILED"
    : !credentialPresent || !approvalPresent
      ? "PENDING_CREDENTIAL_APPROVAL"
      : "READY";

  return { verdict, safetyPassed, credentialPresent, approvalPresent, checks, failedCheckIds };
}

/**
 * Line-per-check text for the console and reports. Values are never interpolated —
 * only booleans, counts and reason codes.
 */
export function summarizePreflight(result: LiveModelPreflightResult): string {
  const lines = result.checks.map(
    (c) => `${c.passed ? "PASS" : "FAIL"}  ${c.id.padEnd(30)} ${c.detail}`,
  );
  lines.push(
    "",
    `credentialPresent=${result.credentialPresent} approvalPresent=${result.approvalPresent}`,
    `verdict=${result.verdict}`,
  );
  if (result.failedCheckIds.length > 0) {
    lines.push(`failed: ${result.failedCheckIds.join(", ")}`);
  }
  return lines.join("\n");
}
