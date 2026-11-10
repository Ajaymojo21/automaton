/**
 * Phase 16A.2 / 16D — live-model pre-flight gate (residual risk R-9).
 *
 * These tests pin the gate itself: the isolated profile passes, each of the fourteen
 * prohibited-without-approval actions has a check that fails when it is present, and no
 * output path ever carries credential material.
 */

import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ENV_VARS,
  runLiveModelPreflight,
  summarizePreflight,
  TREASURY_ZERO_FIELDS,
  type LiveModelPreflightInput,
} from "../../security/live-model-preflight.js";
import type { AutomatonConfig, SecurityConfig, TreasuryPolicy } from "../../types.js";

const ZERO_TREASURY: TreasuryPolicy = {
  maxSingleTransferCents: 0,
  maxHourlyTransferCents: 0,
  maxDailyTransferCents: 0,
  maxMonthlyTransferCents: 0,
  minimumReserveCents: 0,
  maxX402PaymentCents: 0,
  x402AllowedDomains: [],
  transferCooldownMs: 0,
  maxTransfersPerTurn: 0,
  maxInferenceDailyCents: 0,
  requireConfirmationAboveCents: 0,
  agentBudgetCents: 0,
  childBudgetCents: 0,
};

/** A config that satisfies every safety check: nothing spendable, grantable or exposed. */
function isolatedConfig(overrides: Partial<AutomatonConfig> = {}): AutomatonConfig {
  return {
    name: "live-model-test",
    genesisPrompt: "synthetic only",
    creatorAddress: "0x0000000000000000000000000000000000000000",
    registeredWithConway: false,
    sandboxId: "",
    conwayApiUrl: "",
    conwayApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    inferenceModel: "gpt-test",
    maxTokensPerTurn: 256,
    heartbeatConfigPath: "heartbeat.yml",
    dbPath: "state.db",
    logLevel: "error",
    walletAddress: "",
    version: "0.2.1",
    skillsDir: "skills",
    maxChildren: 0,
    treasuryPolicy: { ...ZERO_TREASURY },
    security: {
      lockdown: true,
      activationApproved: false,
      allowedTools: [],
      allowFinancialTools: false,
      allowHostShell: false,
      allowSelfModification: false,
      allowReplication: false,
      allowExternalExposure: false,
      allowedCapabilities: [],
      revokedTools: [],
      maxToolDurationMs: 60000,
      maxToolOutputBytes: 65536,
      sandboxEnabled: true,
      selfHealingEnabled: false,
    },
    ...overrides,
  } as AutomatonConfig;
}

function isolatedInput(overrides: Partial<LiveModelPreflightInput> = {}): LiveModelPreflightInput {
  return {
    config: isolatedConfig(),
    env: {},
    walletMaterialPresent: false,
    homeGuardOk: true,
    homeIsIsolatedTestHome: true,
    emergencyStopEngaged: false,
    ...overrides,
  };
}

function failedIds(input: LiveModelPreflightInput): string[] {
  return runLiveModelPreflight(input).failedCheckIds;
}

function securityOverride(security: Partial<SecurityConfig>): Partial<AutomatonConfig> {
  const base = isolatedConfig();
  return { security: { ...base.security!, ...security } as SecurityConfig };
}

describe("runLiveModelPreflight — the isolated profile", () => {
  it("passes every safety check", () => {
    const result = runLiveModelPreflight(isolatedInput());
    expect(result.safetyPassed).toBe(true);
    expect(result.failedCheckIds).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(15);
  });

  it("reports PENDING_CREDENTIAL_APPROVAL with no credential and no approval token", () => {
    const result = runLiveModelPreflight(isolatedInput({ env: {} }));
    expect(result.verdict).toBe("PENDING_CREDENTIAL_APPROVAL");
    expect(result.credentialPresent).toBe(false);
    expect(result.approvalPresent).toBe(false);
    expect(result.safetyPassed).toBe(true);
  });

  it("is READY only when a credential and the human approval token are both present", () => {
    const result = runLiveModelPreflight(
      isolatedInput({ env: { OPENAI_API_KEY: "preset-by-operator", CONWAY_LIVE_MODEL_APPROVED: "APPROVED" } }),
    );
    expect(result.verdict).toBe("READY");
    expect(result.credentialPresent).toBe(true);
    expect(result.approvalPresent).toBe(true);
  });

  it("does not treat a blank credential as a credential", () => {
    const result = runLiveModelPreflight(
      isolatedInput({ env: { OPENAI_API_KEY: "   ", CONWAY_LIVE_MODEL_APPROVED: "APPROVED" } }),
    );
    expect(result.credentialPresent).toBe(false);
    expect(result.verdict).toBe("PENDING_CREDENTIAL_APPROVAL");
  });

  it("does not treat any approval token value other than APPROVED as approval", () => {
    const result = runLiveModelPreflight(
      isolatedInput({ env: { OPENAI_API_KEY: "k", CONWAY_LIVE_MODEL_APPROVED: "approved" } }),
    );
    expect(result.approvalPresent).toBe(false);
  });
});

describe("runLiveModelPreflight — one failing check per prohibited action", () => {
  it("activation approved", () => {
    expect(failedIds(isolatedInput({ config: isolatedConfig(securityOverride({ activationApproved: true })) })))
      .toContain("agent.activation_closed");
  });

  it("CONWAY_ACTIVATION set in the environment", () => {
    expect(failedIds(isolatedInput({ env: { CONWAY_ACTIVATION: "APPROVED" } })))
      .toContain("env.activation_flags_unset");
  });

  it("CONWAY_ALLOW_WALLET_CREATION set in the environment", () => {
    expect(failedIds(isolatedInput({ env: { CONWAY_ALLOW_WALLET_CREATION: "APPROVED" } })))
      .toContain("env.activation_flags_unset");
  });

  it("wallet material present", () => {
    expect(failedIds(isolatedInput({ walletMaterialPresent: true }))).toContain("wallet.no_material");
  });

  it("a credential stored in the config file", () => {
    const input = isolatedInput({
      config: isolatedConfig({ openaiApiKey: "sk-SECRET-DO-NOT-ECHO" }),
    });
    const result = runLiveModelPreflight(input);
    expect(result.failedCheckIds).toContain("credential.not_in_config");
    expect(result.checks.find((c) => c.id === "credential.not_in_config")?.detail)
      .toContain("openaiApiKey");
  });

  it("a treasury limit left non-zero", () => {
    const config = isolatedConfig();
    config.treasuryPolicy = { ...ZERO_TREASURY, maxSingleTransferCents: 1000 };
    const result = runLiveModelPreflight(isolatedInput({ config }));
    expect(result.failedCheckIds).toContain("treasury.all_zero");
    expect(result.checks.find((c) => c.id === "treasury.all_zero")?.detail)
      .toContain("maxSingleTransferCents");
  });

  it("a treasury policy that is absent entirely — defaults are not zero", () => {
    const config = isolatedConfig();
    delete config.treasuryPolicy;
    expect(failedIds(isolatedInput({ config }))).toContain("treasury.all_zero");
  });

  it("an x402 payment domain allowlisted", () => {
    const config = isolatedConfig();
    config.treasuryPolicy = { ...ZERO_TREASURY, x402AllowedDomains: ["pay.example"] };
    expect(failedIds(isolatedInput({ config }))).toContain("treasury.x402_domains_empty");
  });

  it("a tool explicitly allowed", () => {
    expect(failedIds(isolatedInput({ config: isolatedConfig(securityOverride({ allowedTools: ["exec"] })) })))
      .toContain("tools.allowlist_empty");
  });

  it("a privileged capability granted", () => {
    const result = runLiveModelPreflight(
      isolatedInput({
        config: isolatedConfig(securityOverride({ allowedCapabilities: ["financial", "read_only"] })),
      }),
    );
    expect(result.failedCheckIds).toContain("capabilities.no_privileged_grant");
    expect(result.checks.find((c) => c.id === "capabilities.no_privileged_grant")?.detail)
      .toContain("financial");
  });

  it("host shell, replication, exposure, self-modification, self-healing, sandbox-off and lockdown-off each fail", () => {
    const cases: Array<[Partial<SecurityConfig>, string]> = [
      [{ allowHostShell: true }, "shell.disabled"],
      [{ allowReplication: true }, "replication.disabled"],
      [{ allowExternalExposure: true }, "publishing.disabled"],
      [{ allowSelfModification: true }, "self_modification.disabled"],
      [{ allowFinancialTools: true }, "financial.disabled"],
      [{ selfHealingEnabled: true }, "self_healing.disabled"],
      [{ sandboxEnabled: false }, "sandbox.enabled"],
      [{ lockdown: false }, "lockdown.engaged"],
    ];
    for (const [security, expected] of cases) {
      expect(failedIds(isolatedInput({ config: isolatedConfig(securityOverride(security)) }))
        .filter((id) => id.startsWith(expected.split(".")[0]))).toContain(expected);
    }
  });

  it("maxChildren above zero fails replication even when the flag is off", () => {
    expect(failedIds(isolatedInput({ config: isolatedConfig({ maxChildren: 1 }) })))
      .toContain("replication.disabled");
  });

  it("an engaged emergency stop blocks the run", () => {
    expect(failedIds(isolatedInput({ emergencyStopEngaged: true })))
      .toContain("emergency_stop.not_engaged");
  });

  it("a non-isolated or unresolved home fails before anything else can", () => {
    expect(failedIds(isolatedInput({ homeGuardOk: false }))).toContain("home.isolated_test_tree");
    expect(failedIds(isolatedInput({ homeIsIsolatedTestHome: false })))
      .toContain("home.isolated_test_tree");
  });

  it("any safety failure makes the verdict SAFETY_GATE_FAILED even with credentials in hand", () => {
    const result = runLiveModelPreflight(
      isolatedInput({
        env: { OPENAI_API_KEY: "k", CONWAY_LIVE_MODEL_APPROVED: "APPROVED" },
        walletMaterialPresent: true,
      }),
    );
    expect(result.verdict).toBe("SAFETY_GATE_FAILED");
  });
});

describe("preflight output is secret-free", () => {
  it("neither the checks nor the summary echo a credential value", () => {
    const secret = "sk-proj-NEVER-PRINT-THIS";
    const result = runLiveModelPreflight(
      isolatedInput({
        config: isolatedConfig({ openaiApiKey: secret, conwayApiKey: secret }),
        env: { OPENAI_API_KEY: secret, CONWAY_LIVE_MODEL_APPROVED: "APPROVED" },
      }),
    );
    const summary = summarizePreflight(result);
    expect(summary).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.failedCheckIds).toContain("credential.not_in_config");
  });

  it("covers every treasury field that must be zero and every credential variable it reads", () => {
    expect(TREASURY_ZERO_FIELDS).toContain("maxSingleTransferCents");
    expect(TREASURY_ZERO_FIELDS.length).toBeGreaterThanOrEqual(12);
    expect(CREDENTIAL_ENV_VARS).toEqual(
      expect.arrayContaining(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CONWAY_API_KEY"]),
    );
  });

  it("the live config on disk is checked, not assumed: defaults do not satisfy the gate", () => {
    // A config with no treasuryPolicy is the realistic "operator never configured it"
    // case; the gate must refuse it rather than treat the shipped defaults as safe.
    const config = isolatedConfig();
    delete config.treasuryPolicy;
    const result = runLiveModelPreflight(isolatedInput({ config }));
    expect(result.safetyPassed).toBe(false);
    expect(result.checks.find((c) => c.id === "treasury.all_zero")?.detail)
      .toContain("defaults are not zero");
  });
});
