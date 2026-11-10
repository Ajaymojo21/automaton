/**
 * Phase 16A.4 — self-healing safety (Section 5 A.4).
 *
 * Requirement: the mechanic must stay disabled by default, and a repair must never
 * touch wallet credentials, treasury limits, security policies, activation approvals
 * or tool permissions.
 *
 * Every run passes an explicit `automatonDir` inside a temp directory, so nothing here
 * can reach the live state tree or the user profile.
 */

import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyRepair, runMechanic } from "../../reliability/mechanic.js";
import type { HealthReport } from "../../reliability/health-guardian.js";
import type { AutomatonConfig, SecurityConfig } from "../../types.js";
import { DEFAULT_SECURITY_CONFIG } from "../../types.js";
import { createTestDb, createTestConfig, createTestIdentity } from "../mocks.js";

const NOW = new Date("2026-01-05T12:00:00.000Z");
const tempDirs: string[] = [];
const dbs: Array<{ close: () => void }> = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function config(security: Partial<SecurityConfig>): AutomatonConfig {
  return createTestConfig({
    security: { ...DEFAULT_SECURITY_CONFIG, ...security },
  }) as AutomatonConfig;
}

/** A report with one failing check, so the mechanic has something to consider. */
function report(failingCheckIds: string[], automatonDir: string): HealthReport {
  return {
    generatedAt: NOW.toISOString(),
    overall: failingCheckIds.length ? "critical" : "ok",
    emergencyStop: false,
    checks: failingCheckIds.map((id) => ({
      id,
      title: `synthetic ${id}`,
      status: "fail" as const,
      message: "synthetic degradation",
      evidence: {},
    })),
  };
}

function sha256Of(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("classifyRepair — the A.4 protected categories", () => {
  const forbidden = [
    ["export_private_key", "wallet credentials"],
    ["rotate_wallet_seed", "wallet credentials"],
    ["read_mnemonic", "wallet credentials"],
    ["raise_treasury_limit", "treasury limits"],
    ["update_spend_budget", "treasury limits"],
    ["change_transfer_cap", "treasury limits"],
    ["disable_lockdown", "security policy"],
    ["disable_sandbox", "security policy"],
    ["disable_audit", "security policy"],
    ["set_activation_approved", "activation approval"],
    ["enable_activation", "activation approval"],
    ["grant_capability", "tool permissions"],
    ["elevate_privilege", "tool permissions"],
    ["add_allowed_tool", "tool permissions"],
    ["sign_transaction", "transaction authorization"],
    ["approve_payment", "transaction authorization"],
    ["spawn_child_agent", "replication"],
    ["expose_port_publicly", "network exposure"],
    ["enable_defender_rule", "Windows security"],
    ["icacls_grant_modify", "filesystem permission"],
    ["rotate_api_key", "credential handling"],
  ];

  for (const [repairId, category] of forbidden) {
    it(`refuses "${repairId}" (${category})`, () => {
      const result = classifyRepair(repairId);
      expect(result.classification).toBe("forbidden");
      expect(result.reason).toContain("Refused");
    });
  }

  it("refuses an unknown repair id rather than defaulting to allow", () => {
    // Deny-by-default is what makes the pattern list an enhancement rather than the
    // only thing standing between the mechanic and a new destructive repair id.
    expect(classifyRepair("do_the_thing").classification).toBe("forbidden");
    expect(classifyRepair("do_the_thing").reason).toMatch(/not in the approved registry/);
  });

  it("names the A.4 categories in the pattern net, not only the registry", () => {
    // These all refused correctly before Phase 16A.4 as well — but only because no
    // approved id matched them. If a maintainer adds such an id to the registry, the
    // pattern net has to catch it by name. Pinning the reason is what proves which
    // mechanism refused.
    const byName: Array<[string, string]> = [
      ["set_activation_approved", "activation approval"],
      ["enable_activation", "activation approval"],
      ["activation gate override", "activation approval"],
      ["grant_capability", "permission grant"],
      ["elevate_privilege", "permission grant"],
      ["add_allowed_tool", "tool permission allowlist"],
      ["allowed capabilities edit", "tool permission allowlist"],
      ["disable_sandbox", "security control"],
      ["disable_lockdown", "security control"],
    ];
    for (const [repairId, category] of byName) {
      const result = classifyRepair(repairId);
      expect(result.classification, repairId).toBe("forbidden");
      expect(result.reason, repairId).toContain(category);
    }
  });

  it("still pre-approves the maintenance repairs after widening the patterns", () => {
    // The patterns must not swallow the legitimate registry, or self-healing silently
    // degrades into doing nothing at all.
    for (const id of ["prune_expired_leases", "prune_dedup_keys", "rotate_audit_seal"]) {
      expect(classifyRepair(id).classification, id).toBe("automatic");
    }
    for (const id of [
      "release_stale_treasury_reservations",
      "vacuum_database",
      "reencrypt_wallet",
      "refresh_wallet_backup",
      "investigate_audit_tamper",
    ]) {
      expect(classifyRepair(id).classification, id).toBe("requires_approval");
    }
  });

  it("pre-approves only the three maintenance repairs", () => {
    for (const id of ["prune_expired_leases", "prune_dedup_keys", "rotate_audit_seal"]) {
      expect(classifyRepair(id).classification, id).toBe("automatic");
    }
  });
});

describe("runMechanic — enabled by default is not possible", () => {
  it("stays disabled when the operator config omits the flag", () => {
    const dir = tempDir("p16-mech-");
    const db = createTestDb();
    dbs.push(db);

    const outcome = runMechanic(report(["scheduler_leases"], dir), {
      db: db.raw,
      // DEFAULT_SECURITY_CONFIG.selfHealingEnabled is false; nothing is set here.
      config: config({}),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.enabled).toBe(false);
    expect(outcome.actions).toHaveLength(0);
  });
});

describe("runMechanic — allowRepairs cannot widen what executes", () => {
  it("applies only repairs the classifier marks automatic", () => {
    const dir = tempDir("p16-mech-");
    const db = createTestDb();
    dbs.push(db);

    const failing = [
      "scheduler_leases",
      "treasury_reservations",
      "runtime_hygiene",
      "wallet_plaintext",
      "audit_chain",
    ];

    for (const run of [
      { label: "selfHealingEnabled", options: { config: config({ selfHealingEnabled: true }) } },
      { label: "allowRepairs", options: { config: config({ selfHealingEnabled: false }), allowRepairs: true } },
    ]) {
      const outcome = runMechanic(report(failing, dir), {
        db: db.raw,
        automatonDir: dir,
        now: NOW,
        ...run.options,
      });

      expect(outcome.enabled, run.label).toBe(true);
      for (const action of outcome.actions) {
        expect(classifyRepair(action.repairId).classification, `${run.label}:${action.repairId}`).toBe(
          "automatic",
        );
      }
      // Protected state is queued for a human, never repaired in place.
      for (const pending of outcome.pendingApproval) {
        expect(["requires_approval", "forbidden"], `${run.label}:${pending.repairId}`).toContain(
          classifyRepair(pending.repairId).classification,
        );
      }
    }
  });

  it("never writes to the operator config or wallet material", () => {
    const dir = tempDir("p16-mech-");
    const db = createTestDb();
    dbs.push(db);

    const configPath = path.join(dir, "automaton.json");
    const walletPath = path.join(dir, "wallet.json");
    fs.writeFileSync(configPath, JSON.stringify({ security: { selfHealingEnabled: false } }));
    fs.writeFileSync(walletPath, JSON.stringify({ privateKey: "synthetic-never-read" }));
    const configBefore = sha256Of(configPath);
    const walletBefore = sha256Of(walletPath);

    runMechanic(report(["scheduler_leases", "runtime_hygiene", "wallet_plaintext"], dir), {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(sha256Of(configPath)).toBe(configBefore);
    expect(sha256Of(walletPath)).toBe(walletBefore);
    expect(fs.existsSync(path.join(dir, "EMERGENCY_STOP"))).toBe(false);
  });
});
