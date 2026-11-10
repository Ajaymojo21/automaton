/**
 * Phase 15F — Health guardian and bounded autonomous mechanic
 *
 * The guardian is read-only. The mechanic may only run the small registry of
 * pre-approved maintenance repairs, and only when self-healing is explicitly
 * enabled and no emergency stop is engaged.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import type { AutomatonDatabase, SecurityConfig } from "../types.js";
import { DEFAULT_SECURITY_CONFIG } from "../types.js";
import {
  appendSecurityEvent,
  appendSecuritySeal,
  verifySeals,
  verifySecurityChain,
} from "../security/audit-chain.js";
import {
  clearEmergencyStop,
  engageEmergencyStop,
  getEmergencyStopPath,
  isEmergencyStopEngaged,
  readEmergencyStop,
} from "../security/emergency-stop.js";
import {
  classifyRepair,
  runMechanic,
} from "../reliability/mechanic.js";
import {
  runHealthChecks,
  type HealthReport,
} from "../reliability/health-guardian.js";
import { createTestConfig } from "./mocks.js";
import { conwayRoot } from "../runtime/home-guard.js";

const NOW = new Date(Date.UTC(2026, 0, 5, 12, 0, 0));

let db: AutomatonDatabase;
let tempDirs: string[] = [];
let backupsDir: string;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function config(security: Partial<SecurityConfig> = {}) {
  return createTestConfig({
    security: { ...DEFAULT_SECURITY_CONFIG, ...security },
  });
}

/** The guardian defaults to `<repo>/backups`; a unit test must not read the real archive. */
function health(dir: string, security: Partial<SecurityConfig> = {}): HealthReport {
  return runHealthChecks({
    db: db.raw,
    config: config(security),
    automatonDir: dir,
    backupsDir,
    now: NOW,
  });
}

beforeEach(() => {
  db = createDatabase(path.join(tempDir("conway-guard-db-"), "state.db"));
  backupsDir = tempDir("conway-guard-backups-");
  fs.mkdirSync(path.join(backupsDir, "2026-01-05_12-00-00"), { recursive: true });
  fs.writeFileSync(path.join(backupsDir, "2026-01-05_12-00-00", "manifest.json"), "{}");
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  tempDirs = [];
});

function statusOf(report: HealthReport, id: string) {
  return report.checks.find((check) => check.id === id);
}

describe("health guardian", () => {
  it("reports a clean runtime as ok", () => {
    const report = health(tempDir("conway-guard-"));

    expect(report.overall).toBe("ok");
    expect(report.summary).toBe("healthy");
    expect(report.emergencyStop).toBe(false);
    expect(statusOf(report, "database_integrity")?.status).toBe("pass");
    expect(statusOf(report, "schema_version")?.status).toBe("pass");
    expect(statusOf(report, "audit_chain")?.status).toBe("pass");
    expect(statusOf(report, "wallet_storage")?.status).toBe("pass");
  });

  it("flags an engaged emergency stop as critical", () => {
    const dir = tempDir("conway-guard-");
    engageEmergencyStop({ reason: "synthetic drill", requestedBy: "tester", dir, db: db.raw, now: NOW });

    const report = health(dir);

    expect(report.overall).toBe("critical");
    expect(report.summary).toBe("failed");
    expect(report.emergencyStop).toBe(true);
    expect(statusOf(report, "emergency_stop")?.status).toBe("fail");
  });

  it("warns on a stuck treasury reservation", () => {
    db.raw
      .prepare(
        `INSERT INTO treasury_authorizations
           (id, idempotency_key, tool_name, operation, amount_cents, requested_amount_cents,
            decision, status, created_ms, created_at)
         VALUES ('t1','k1','transfer_credits','transfer_out',100,100,'allow','reserved',?,'2026-01-01T00:00:00.000Z')`,
      )
      .run(NOW.getTime() - 60 * 60_000);

    const report = health(tempDir("conway-guard-"));

    expect(statusOf(report, "treasury_reservations")?.status).toBe("warn");
    expect(report.overall).toBe("degraded");
  });

  it("warns on an expired scheduler lease", () => {
    db.raw
      .prepare(
        `INSERT INTO heartbeat_schedule (task_name, cron_expression, lease_owner, lease_expires_at)
         VALUES ('synthetic_task','* * * * *','stale-owner','2020-01-01 00:00:00')`,
      )
      .run();

    const report = health(tempDir("conway-guard-"));

    expect(statusOf(report, "scheduler_leases")?.status).toBe("warn");
  });

  it("detects a plaintext wallet and never echoes the key material", () => {
    const dir = tempDir("conway-guard-");
    const syntheticKey = "0x" + "a".repeat(64);
    fs.writeFileSync(
      path.join(dir, "wallet.json"),
      JSON.stringify({ privateKey: syntheticKey, createdAt: NOW.toISOString() }),
    );

    const report = health(dir);

    expect(statusOf(report, "wallet_storage")?.status).toBe("fail");
    expect(report.overall).toBe("critical");
    expect(JSON.stringify(report)).not.toContain(syntheticKey);
  });

  it("accepts an encrypted envelope format", () => {
    const dir = tempDir("conway-guard-");
    fs.writeFileSync(
      path.join(dir, "wallet.json"),
      JSON.stringify({
        version: 1,
        algorithm: "aes-256-gcm",
        ciphertext: "synthetic",
        iv: "synthetic",
        tag: "synthetic",
        salt: "synthetic",
      }),
    );

    const report = health(dir);

    expect(statusOf(report, "wallet_storage")?.status).toBe("pass");
  });

  it("requires a human when the audit chain has been rewritten", () => {
    const dir = tempDir("conway-guard-");
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);
    appendSecurityEvent(db.raw, { severity: "MEDIUM", category: "tool", eventType: "tool.denied" }, NOW);

    db.raw.exec("DROP TRIGGER security_events_no_update");
    db.raw.prepare("UPDATE security_events SET details = '{\"forged\":true}' WHERE sequence = 1").run();

    expect(verifySecurityChain(db.raw).valid).toBe(false);
    const report = health(dir);
    // Tamper on a table that exists is not "the runtime failed" — the runtime observed it and
    // a human has to investigate. That is the requires_operator state, and it still rolls up
    // to the headline.
    expect(statusOf(report, "audit_chain")?.status).toBe("requires_operator");
    expect(report.summary).toBe("requires_operator");
    expect(report.overall).toBe("requires_operator");
  });
});

describe("repair classification", () => {
  it.each([
    "prune_expired_leases",
    "prune_dedup_keys",
    "rotate_audit_seal",
  ])("pre-approves %s as automatic", (id) => {
    expect(classifyRepair(id).classification).toBe("automatic");
  });

  it.each([
    "release_stale_treasury_reservations",
    "vacuum_database",
    "reencrypt_wallet",
    "investigate_audit_tamper",
  ])("queues %s for human approval", (id) => {
    expect(classifyRepair(id).classification).toBe("requires_approval");
  });

  it.each([
    ["rotate_wallet_keys", "replace the wallet private key"],
    ["raise_financial_limit", "increase the daily transfer cap"],
    ["authorize_pending_transfer", "sign and send the queued transaction"],
    ["disable_audit_chain", "stop writing security events"],
    ["grant_capability", "grant financial capability to all tools"],
    ["enable_replication", "allow spawn_child again"],
    ["expose_port_8080", "publish a public URL"],
    ["configure_defender", "turn off realtime monitoring"],
    ["set_firewall_rule", "allow inbound"],
    ["relax_acl", "change directory permissions"],
    ["read_api_key", "print the stored API key"],
    ["unknown_repair_id", "does something unspecified"],
  ])("forbids %s", (id, description) => {
    expect(classifyRepair(id, description).classification).toBe("forbidden");
  });
});

describe("mechanic", () => {
  function degradedReport(dir: string): HealthReport {
    db.raw
      .prepare(
        `INSERT INTO heartbeat_schedule (task_name, cron_expression, lease_owner, lease_expires_at)
         VALUES ('synthetic_task','* * * * *','stale-owner','2020-01-01 00:00:00')`,
      )
      .run();
    db.raw
      .prepare(
        `INSERT INTO treasury_authorizations
           (id, idempotency_key, tool_name, operation, amount_cents, requested_amount_cents,
            decision, status, created_ms, created_at)
         VALUES ('t1','k1','transfer_credits','transfer_out',100,100,'allow','reserved',?,'2026-01-01T00:00:00.000Z')`,
      )
      .run(NOW.getTime() - 60 * 60_000);
    return health(dir);
  }

  it("does nothing while self-healing is disabled", () => {
    const dir = tempDir("conway-mech-");
    const report = degradedReport(dir);

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: false }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.enabled).toBe(false);
    expect(outcome.actions).toHaveLength(0);
    expect(outcome.skippedReason).toContain("self-healing");
    const lease = db.raw
      .prepare("SELECT lease_owner FROM heartbeat_schedule WHERE task_name = 'synthetic_task'")
      .get() as { lease_owner: string | null };
    expect(lease.lease_owner).toBe("stale-owner");
  });

  it("runs only pre-approved repairs when enabled", () => {
    const dir = tempDir("conway-mech-");
    const report = degradedReport(dir);

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.enabled).toBe(true);
    expect(outcome.actions.map((action) => action.repairId)).toContain("prune_expired_leases");
    const lease = db.raw
      .prepare("SELECT lease_owner FROM heartbeat_schedule WHERE task_name = 'synthetic_task'")
      .get() as { lease_owner: string | null };
    expect(lease.lease_owner).toBeNull();

    // Financial state is never repaired automatically.
    expect(outcome.actions.map((action) => action.repairId)).not.toContain(
      "release_stale_treasury_reservations",
    );
    expect(outcome.pendingApproval.map((entry) => entry.repairId)).toContain(
      "release_stale_treasury_reservations",
    );
    const reservation = db.raw
      .prepare("SELECT status FROM treasury_authorizations WHERE id = 't1'")
      .get() as { status: string };
    expect(reservation.status).toBe("reserved");
  });

  it("seals the audit chain as routine maintenance", () => {
    const dir = tempDir("conway-mech-");
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);
    const report = health(dir);

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.seal).toBeDefined();
    expect(verifySeals(db.raw).valid).toBe(true);
  });

  it("records every repair in the audit chain", () => {
    const dir = tempDir("conway-mech-");
    const report = degradedReport(dir);

    runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    const rows = db.raw
      .prepare("SELECT event_type FROM security_events WHERE category = 'maintenance'")
      .all() as Array<{ event_type: string }>;
    expect(rows.map((row) => row.event_type)).toContain("maintenance.repair");
  });

  it("refuses to act while the emergency stop is engaged", () => {
    const dir = tempDir("conway-mech-");
    engageEmergencyStop({ reason: "drill", requestedBy: "tester", dir, db: db.raw, now: NOW });
    const report = degradedReport(dir);

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.emergencyStop).toBe(true);
    expect(outcome.actions).toHaveLength(0);
    expect(outcome.skippedReason).toBe("emergency stop engaged");
  });

  it("queues investigation instead of sealing when the chain is broken", () => {
    const dir = tempDir("conway-mech-");
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);
    db.raw.exec("DROP TRIGGER security_events_no_update");
    db.raw
      .prepare("UPDATE security_events SET details = '{\"forged\":true}' WHERE sequence = 1")
      .run();

    const report = health(dir);
    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.pendingApproval.map((entry) => entry.repairId)).toContain(
      "investigate_audit_tamper",
    );
    expect(outcome.seal).toBeUndefined();
  });

  it("honours the confirmation hook", () => {
    const dir = tempDir("conway-mech-");
    const report = degradedReport(dir);

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
      confirm: () => false,
    });

    expect(outcome.actions.every((action) => action.status === "skipped")).toBe(true);
  });

  it("repairs nothing when the source table is absent instead of failing", () => {
    const dir = tempDir("conway-mech-");
    // A live V11 database has no security_events or treasury_authorizations table. The
    // guardian reports those checks blocked, and the mechanic must read that as "nothing to
    // repair" rather than as a repair trigger.
    db.raw.exec("DROP TABLE security_events");
    db.raw.exec("DROP TABLE treasury_authorizations");

    const report = health(dir);
    expect(statusOf(report, "audit_chain")?.status).toBe("blocked");
    expect(report.overall).toBe("blocked");

    const outcome = runMechanic(report, {
      db: db.raw,
      config: config({ selfHealingEnabled: true }),
      automatonDir: dir,
      now: NOW,
    });

    expect(outcome.enabled).toBe(true);
    expect(outcome.actions.every((action) => action.status === "skipped")).toBe(true);
    expect(outcome.actions.map((action) => action.repairId)).not.toContain("prune_dedup_keys");
    expect(outcome.pendingApproval).toHaveLength(0);
    expect(outcome.seal).toBeUndefined();
  });

  it("never executes a recorded approval, because it never reads the approval store", () => {
    // The boundary that matters for B-2: approval is a durable decision, not a trigger. The
    // executor has no dependency on the approval module at all, so approving cannot run it.
    const source = fs.readFileSync(
      path.join(conwayRoot(), "src", "reliability", "mechanic.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/repair-approval/i);
    expect(source).not.toMatch(/RepairApprovalStore/);
    expect(source).not.toMatch(/ready_for_execution/);
  });
});

describe("the five guardian states", () => {
  it("reports blocked, not failed, when a source is missing", () => {
    const dir = tempDir("conway-guard-");
    db.raw.exec("DROP TABLE security_events");
    db.raw.exec("DROP TABLE treasury_authorizations");

    const report = health(dir);

    expect(report.summary).toBe("blocked");
    expect(report.overall).toBe("blocked");
    expect(statusOf(report, "audit_chain")?.status).toBe("blocked");
    expect(statusOf(report, "treasury_reservations")?.status).toBe("blocked");
    expect(statusOf(report, "runtime_errors")?.status).toBe("blocked");
    // Nothing failed: no check claimed a fault it could not observe.
    expect(report.checks.some((check) => check.status === "fail")).toBe(false);
  });

  it("requires an operator when lockdown and a dangerous capability disagree", () => {
    const report = health(tempDir("conway-guard-"), {
      lockdown: true,
      allowFinancialTools: true,
    });

    expect(statusOf(report, "security_invariants")?.status).toBe("requires_operator");
    expect(report.summary).toBe("requires_operator");
    expect(report.overall).toBe("requires_operator");
  });

  it("lets a real failure outrank an operator-action state", () => {
    const dir = tempDir("conway-guard-");
    engageEmergencyStop({ reason: "drill", requestedBy: "tester", dir, db: db.raw, now: NOW });

    const report = health(dir, { lockdown: true, allowHostShell: true });

    expect(statusOf(report, "security_invariants")?.status).toBe("requires_operator");
    expect(report.summary).toBe("failed");
    expect(report.overall).toBe("critical");
  });

  it("warns rather than fails when it cannot read free space", () => {
    const report = health(path.join(tempDir("conway-guard-"), "absent-subdir"));
    expect(statusOf(report, "disk_space")?.status).toBe("warn");
  });
});

describe("audit seals", () => {
  it("anchors the seal to the chain sequence it covers", () => {
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);
    appendSecurityEvent(db.raw, { severity: "LOW", category: "tool", eventType: "tool.denied" }, NOW);

    const seal = appendSecuritySeal(db.raw, { reason: "checkpoint", actor: "tester", now: NOW });

    expect(seal.sequence).toBe(2);
    const verification = verifySecurityChain(db.raw);
    expect(verification.valid).toBe(true);
    expect(verifySeals(db.raw)).toEqual({ valid: true, checked: 1 });
  });

  it("treats re-sealing an unchanged head as a no-op", () => {
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);

    const first = appendSecuritySeal(db.raw, { reason: "checkpoint", actor: "tester", now: NOW });
    const second = appendSecuritySeal(db.raw, { reason: "checkpoint", actor: "tester", now: NOW });

    expect(second).toEqual(first);
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS n FROM security_seals")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it("proves when sealed history was rewritten", () => {
    appendSecurityEvent(db.raw, { severity: "INFO", category: "tool", eventType: "tool.authorized" }, NOW);
    appendSecurityEvent(db.raw, { severity: "LOW", category: "tool", eventType: "tool.denied" }, NOW);
    appendSecuritySeal(db.raw, { reason: "checkpoint", actor: "tester", now: NOW });

    db.raw.exec("DROP TRIGGER security_events_no_update");
    db.raw
      .prepare("UPDATE security_events SET details = '{\"forged\":true}' WHERE sequence = 2")
      .run();

    const seals = verifySeals(db.raw);
    expect(seals.valid).toBe(false);
    expect(seals.reason).toContain("seal hash mismatch at sequence 2");
  });

  it("refuses to seal an empty chain", () => {
    expect(() => appendSecuritySeal(db.raw, { reason: "checkpoint", now: NOW })).toThrow(
      /empty audit chain/,
    );
  });
});

describe("emergency stop", () => {
  it("engages, fails closed on a corrupt marker, and requires a human to clear", () => {
    const dir = tempDir("conway-stop-");

    expect(isEmergencyStopEngaged(dir)).toBe(false);
    engageEmergencyStop({ reason: "tamper suspected", requestedBy: "tester", dir, db: db.raw, now: NOW });

    expect(isEmergencyStopEngaged(dir)).toBe(true);
    expect(readEmergencyStop(dir).reason).toBe("tamper suspected");

    fs.writeFileSync(getEmergencyStopPath(dir), "{ not json");
    expect(readEmergencyStop(dir).engaged).toBe(true);

    expect(clearEmergencyStop({ confirmedBy: "", reason: "x", dir }).cleared).toBe(false);
    expect(clearEmergencyStop({ confirmedBy: "human", reason: "  ", dir }).cleared).toBe(false);
    expect(isEmergencyStopEngaged(dir)).toBe(true);

    const cleared = clearEmergencyStop({
      confirmedBy: "creator",
      reason: "verified drill",
      dir,
      db: db.raw,
      now: NOW,
    });
    expect(cleared.cleared).toBe(true);
    expect(isEmergencyStopEngaged(dir)).toBe(false);

    const events = db.raw
      .prepare("SELECT event_type, severity FROM security_events ORDER BY sequence")
      .all() as Array<{ event_type: string; severity: string }>;
    expect(events).toContainEqual({ event_type: "system.emergency_stop", severity: "CRITICAL" });
    expect(events).toContainEqual({
      event_type: "system.emergency_stop_cleared",
      severity: "MEDIUM",
    });
  });

  it("requires a reason and calls the shutdown hook", () => {
    const dir = tempDir("conway-stop-");
    let stopped = 0;
    expect(() => engageEmergencyStop({ reason: "  ", dir })).toThrow(/non-empty reason/);

    engageEmergencyStop({
      reason: "drill",
      dir,
      now: NOW,
      onStop: () => {
        stopped += 1;
      },
    });
    expect(stopped).toBe(1);
  });

  it("is idempotent when re-engaged", () => {
    const dir = tempDir("conway-stop-");
    engageEmergencyStop({ reason: "first", dir, now: NOW });
    const second = engageEmergencyStop({ reason: "second", dir, now: NOW });
    expect(second.reason).toBe("first");
  });
});
