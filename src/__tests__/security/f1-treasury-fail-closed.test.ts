import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config.js";
import { resolveTreasuryPolicy } from "../../security/treasury-guard.js";
import { LOCKDOWN_TREASURY_POLICY, DEFAULT_TREASURY_POLICY } from "../../types.js";

/**
 * F-1 regression: treasury limits must never inherit non-zero defaults under
 * lockdown, and invalid values must reset to the (lockdown-aware) base.
 */
describe("F-1 treasury fail-closed", () => {
  let home: string;
  let automatonDir: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "f1-home-"));
    automatonDir = path.join(home, ".automaton");
    fs.mkdirSync(automatonDir, { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function writeConfig(treasuryPolicy: unknown, security?: unknown): void {
    const cfg = {
      name: "f1-test",
      genesisPrompt: "test",
      creatorAddress: "0x0000000000000000000000000000000000000000",
      registeredWithConway: false,
      sandboxId: "",
      conwayApiUrl: "https://api.conway.tech",
      conwayApiKey: "",
      inferenceModel: "gpt-5.2",
      maxTokensPerTurn: 4096,
      heartbeatConfigPath: "~/.automaton/heartbeat.yml",
      dbPath: "~/.automaton/state.db",
      logLevel: "info",
      walletAddress: "",
      version: "0.2.1",
      skillsDir: "~/.automaton/skills",
      maxChildren: 0,
      maxTurnsPerCycle: 25,
      childSandboxMemoryMb: 1024,
      chainType: "evm",
      treasuryPolicy,
      security: security ?? { lockdown: true, activationApproved: false, allowedTools: [] },
    };
    fs.writeFileSync(path.join(automatonDir, "automaton.json"), JSON.stringify(cfg, null, 2));
  }

  it("under lockdown, missing treasuryPolicy resolves to all zeros", () => {
    writeConfig(undefined);
    const cfg = loadConfig();
    expect(cfg).not.toBeNull();
    const policy = cfg!.treasuryPolicy;
    for (const key of [
      "maxSingleTransferCents",
      "maxHourlyTransferCents",
      "maxDailyTransferCents",
      "minimumReserveCents",
      "maxX402PaymentCents",
      "transferCooldownMs",
      "maxTransfersPerTurn",
      "maxInferenceDailyCents",
      "requireConfirmationAboveCents",
      "maxMonthlyTransferCents",
      "agentBudgetCents",
      "childBudgetCents",
    ]) {
      expect((policy as any)[key]).toBe(0);
    }
    expect(policy.x402AllowedDomains).toEqual([]);
  });

  it("under lockdown, an empty treasuryPolicy object resolves to all zeros", () => {
    writeConfig({});
    const cfg = loadConfig()!;
    expect(cfg.treasuryPolicy.maxSingleTransferCents).toBe(0);
    expect(cfg.treasuryPolicy.maxMonthlyTransferCents).toBe(0);
    expect(cfg.treasuryPolicy.agentBudgetCents).toBe(0);
    expect(cfg.treasuryPolicy.childBudgetCents).toBe(0);
  });

  it("under lockdown, non-zero declared values are preserved (operator opt-in)", () => {
    writeConfig({ maxSingleTransferCents: 500, maxMonthlyTransferCents: 1000 });
    const cfg = loadConfig()!;
    // Under lockdown, loadConfig uses LOCKDOWN base but still merges raw values.
    // However resolveTreasuryPolicy overrides to all-zero under lockdown.
    expect(cfg.treasuryPolicy.maxSingleTransferCents).toBe(500);
    const resolved = resolveTreasuryPolicy(cfg);
    expect(resolved.maxSingleTransferCents).toBe(0);
    expect(resolved.maxMonthlyTransferCents).toBe(0);
  });

  it("under lockdown, NaN/Infinity/negative/string/overflow reset to 0", () => {
    writeConfig({
      maxSingleTransferCents: NaN,
      maxHourlyTransferCents: Infinity,
      maxDailyTransferCents: -5,
      minimumReserveCents: "100",
      maxX402PaymentCents: 1e309,
      transferCooldownMs: 1.5,
    });
    const cfg = loadConfig()!;
    expect(cfg.treasuryPolicy.maxSingleTransferCents).toBe(0);
    expect(cfg.treasuryPolicy.maxHourlyTransferCents).toBe(0);
    expect(cfg.treasuryPolicy.maxDailyTransferCents).toBe(0);
    expect(cfg.treasuryPolicy.minimumReserveCents).toBe(0);
    expect(cfg.treasuryPolicy.maxX402PaymentCents).toBe(0);
    expect(cfg.treasuryPolicy.transferCooldownMs).toBe(0);
  });

  it("resolveTreasuryPolicy under lockdown returns all 12 zeros", () => {
    writeConfig({ maxSingleTransferCents: 9999 });
    const cfg = loadConfig()!;
    const resolved = resolveTreasuryPolicy(cfg);
    for (const key of [
      "maxSingleTransferCents",
      "maxHourlyTransferCents",
      "maxDailyTransferCents",
      "minimumReserveCents",
      "maxX402PaymentCents",
      "transferCooldownMs",
      "maxTransfersPerTurn",
      "maxInferenceDailyCents",
      "requireConfirmationAboveCents",
      "maxMonthlyTransferCents",
      "agentBudgetCents",
      "childBudgetCents",
    ]) {
      expect((resolved as any)[key]).toBe(0);
    }
    expect(resolved.x402AllowedDomains).toEqual([]);
  });

  it("LOCKDOWN_TREASURY_POLICY has all 12 fields at zero", () => {
    for (const key of [
      "maxSingleTransferCents",
      "maxHourlyTransferCents",
      "maxDailyTransferCents",
      "minimumReserveCents",
      "maxX402PaymentCents",
      "transferCooldownMs",
      "maxTransfersPerTurn",
      "maxInferenceDailyCents",
      "requireConfirmationAboveCents",
      "maxMonthlyTransferCents",
      "agentBudgetCents",
      "childBudgetCents",
    ]) {
      expect((LOCKDOWN_TREASURY_POLICY as any)[key]).toBe(0);
    }
    expect(LOCKDOWN_TREASURY_POLICY.x402AllowedDomains).toEqual([]);
  });

  it("DEFAULT_TREASURY_POLICY retains non-zero defaults for non-locked-down configs; LOCKDOWN zeroes them", () => {
    // DEFAULT is the non-locked-down baseline; its 3 extra keys carry reasonable
    // defaults. Under lockdown, loadConfig/resolveTreasuryPolicy override to 0.
    expect(DEFAULT_TREASURY_POLICY.maxMonthlyTransferCents).toBe(100000);
    expect(DEFAULT_TREASURY_POLICY.agentBudgetCents).toBe(200000);
    expect(DEFAULT_TREASURY_POLICY.childBudgetCents).toBe(50000);
    expect(LOCKDOWN_TREASURY_POLICY.maxMonthlyTransferCents).toBe(0);
    expect(LOCKDOWN_TREASURY_POLICY.agentBudgetCents).toBe(0);
    expect(LOCKDOWN_TREASURY_POLICY.childBudgetCents).toBe(0);
  });

  it("under non-lockdown, resolveTreasuryPolicy merges config with DEFAULT", () => {
    const cfg = {
      security: { lockdown: false, activationApproved: false, allowedTools: [] },
      treasuryPolicy: { maxSingleTransferCents: 500 },
    } as any;
    const resolved = resolveTreasuryPolicy(cfg);
    expect(resolved.maxSingleTransferCents).toBe(500);
    // Other fields inherit from DEFAULT (non-zero for the standard 10)
    expect(resolved.maxHourlyTransferCents).toBe(DEFAULT_TREASURY_POLICY.maxHourlyTransferCents);
  });

  it("live-model-preflight treasury.all_zero would pass for a lockdown loadConfig result", () => {
    writeConfig({});
    const cfg = loadConfig()!;
    // Simulate what preflight does: check all 12 fields are zero
    const fields = [
      "maxSingleTransferCents",
      "maxHourlyTransferCents",
      "maxDailyTransferCents",
      "minimumReserveCents",
      "maxX402PaymentCents",
      "transferCooldownMs",
      "maxTransfersPerTurn",
      "maxInferenceDailyCents",
      "requireConfirmationAboveCents",
      "maxMonthlyTransferCents",
      "agentBudgetCents",
      "childBudgetCents",
    ];
    const nonzero = fields.filter((f) => typeof (cfg.treasuryPolicy as any)[f] === "number" && (cfg.treasuryPolicy as any)[f] !== 0);
    expect(nonzero).toEqual([]);
  });
});
