/**
 * Phase 15G — Security monitoring and incident response
 *
 * Covers deduplicated incident lifecycle, event-to-incident scanning,
 * tamper detection over the audit chain and seals, and the emergency stop:
 * a fail-safe that halts tool dispatch and heartbeat ticks and that only a
 * named human can clear.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import type {
  AutomatonDatabase,
  ToolContext,
} from "../types.js";
import type { SecuritySeverity } from "../security/audit-chain.js";
import { appendSecurityEvent, verifySecurityChain } from "../security/audit-chain.js";
import {
  acknowledgeIncident,
  checkTamper,
  incidentSummary,
  listIncidents,
  raiseIncident,
  resolveIncident,
  scanSecurityEvents,
} from "../security/incidents.js";
import {
  clearEmergencyStop,
  engageEmergencyStop,
  isEmergencyStopActive,
  isEmergencyStopEngaged,
  isEmergencyStopEngagedInDb,
} from "../security/emergency-stop.js";
import { createBuiltinTools, executeTool } from "../agent/tools.js";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import {
  MockConwayClient,
  MockInferenceClient,
  createTestConfig,
  createTestIdentity,
  createTestDb,
} from "./mocks.js";

const schedulerCalls = vi.hoisted(() => ({ ticks: 0 }));

vi.mock("../heartbeat/scheduler.js", () => ({
  DurableScheduler: class {
    async tick(): Promise<void> {
      schedulerCalls.ticks += 1;
    }
    async executeTask(): Promise<void> {}
  },
}));

const NOW = new Date(Date.UTC(2026, 0, 5, 12, 0, 0));

let db: AutomatonDatabase;
let tempDirs: string[] = [];
let toolDb: AutomatonDatabase | undefined;
let originalHome: string | undefined;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function event(
  severity: SecuritySeverity,
  category: string,
  eventType: string,
  details: Record<string, unknown> = {},
  at: Date = NOW,
): void {
  appendSecurityEvent(db.raw, { severity, category, eventType, details }, at);
}

beforeEach(() => {
  db = createDatabase(path.join(tempDir("conway-ir-db-"), "state.db"));
  originalHome = process.env.HOME;
});

afterEach(() => {
  db.close();
  toolDb?.close();
  toolDb = undefined;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("incident lifecycle", () => {
  it("raises, acknowledges and resolves without deleting", () => {
    const incident = raiseIncident(db.raw, {
      severity: "HIGH",
      category: "wallet",
      incidentType: "wallet_access",
      title: "Wallet access",
      description: "synthetic",
      sourceSequence: 1,
      now: NOW,
    });
    expect(incident.status).toBe("open");
    expect(listIncidents(db.raw, { status: "open" })).toHaveLength(1);

    expect(acknowledgeIncident(db.raw, incident.id, "analyst", NOW)).toBe(true);
    expect(listIncidents(db.raw, { status: "acknowledged" })[0].acknowledgedBy).toBe("analyst");

    expect(resolveIncident(db.raw, incident.id, "analyst", "false positive", NOW)).toBe(true);
    const resolved = listIncidents(db.raw, { status: "resolved" });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolution).toBe("false positive");
    expect(listIncidents(db.raw)).toHaveLength(1);
  });

  it("deduplicates on incident type and source sequence", () => {
    const first = raiseIncident(db.raw, {
      severity: "MEDIUM",
      category: "tool",
      incidentType: "tool_denial_burst",
      title: "burst",
      sourceSequence: 7,
      now: NOW,
    });
    const second = raiseIncident(db.raw, {
      severity: "MEDIUM",
      category: "tool",
      incidentType: "tool_denial_burst",
      title: "burst",
      sourceSequence: 7,
      now: NOW,
    });
    expect(second.id).toBe(first.id);
    expect(listIncidents(db.raw)).toHaveLength(1);
  });

  it("refuses anonymous acknowledgement and resolutions without a cause", () => {
    const incident = raiseIncident(db.raw, {
      severity: "LOW",
      category: "process",
      incidentType: "process_spawn",
      title: "spawn",
      sourceSequence: 2,
      now: NOW,
    });
    expect(acknowledgeIncident(db.raw, incident.id, "   ", NOW)).toBe(false);
    expect(resolveIncident(db.raw, incident.id, "analyst", "", NOW)).toBe(false);
    expect(resolveIncident(db.raw, incident.id, "", "done", NOW)).toBe(false);
    expect(incidentSummary(db.raw).open).toBe(1);
  });

  it("summarises by status and severity", () => {
    raiseIncident(db.raw, { severity: "CRITICAL", category: "integrity", incidentType: "a", title: "a", sourceSequence: 1, now: NOW });
    raiseIncident(db.raw, { severity: "HIGH", category: "wallet", incidentType: "b", title: "b", sourceSequence: 2, now: NOW });
    raiseIncident(db.raw, { severity: "HIGH", category: "wallet", incidentType: "c", title: "c", sourceSequence: 3, now: NOW });

    const summary = incidentSummary(db.raw);
    expect(summary.open).toBe(3);
    expect(summary.bySeverity.HIGH).toBe(2);
    expect(summary.bySeverity.CRITICAL).toBe(1);
  });

  it("keeps incidents append-only", () => {
    raiseIncident(db.raw, { severity: "LOW", category: "x", incidentType: "y", title: "y", sourceSequence: 1, now: NOW });
    expect(() => db.raw.prepare("DELETE FROM security_incidents").run()).toThrow();
  });
});

describe("scanSecurityEvents", () => {
  it("raises CRITICAL for critical events and emergency stops", () => {
    event("CRITICAL", "system", "system.watchdog_kill", {}, NOW);
    event("LOW", "system", "system.emergency_stop", { reason: "drill" }, NOW);

    const raised = scanSecurityEvents(db.raw, { now: NOW });
    const types = raised.map((incident) => incident.incidentType).sort();
    expect(types).toEqual(["critical_event", "emergency_stop"]);
    expect(raised.every((incident) => incident.severity === "CRITICAL")).toBe(true);
  });

  it.each([
    ["wallet", "wallet", "wallet.key_read", "wallet_access", "HIGH"],
    ["config", "config", "config.security_changed", "config_change", "HIGH"],
    ["network", "network", "network.public_endpoint", "network_exposure", "HIGH"],
    ["process", "process", "process.spawn_child", "process_spawn", "MEDIUM"],
  ] as const)(
    "maps %s events to a %s incident",
    (_label, category, eventType, incidentType, severity) => {
      event("MEDIUM", category, eventType, {}, NOW);
      const raised = scanSecurityEvents(db.raw, { now: NOW });
      expect(raised.map((incident) => incident.incidentType)).toContain(incidentType);
      expect(raised.find((incident) => incident.incidentType === incidentType)?.severity).toBe(severity);
    },
  );

  it("escalates a replay-flagged treasury denial to HIGH", () => {
    event("MEDIUM", "financial", "treasury.denied", { reasonCode: "DUPLICATE_TRANSACTION" }, NOW);
    const raised = scanSecurityEvents(db.raw, { now: NOW });
    const replay = raised.find((incident) => incident.incidentType === "replay_attempt");
    expect(replay?.severity).toBe("HIGH");
  });

  it("only raises auth bursts at three or more failures", () => {
    event("LOW", "auth", "auth.failed", {}, NOW);
    event("LOW", "auth", "auth.failed", {}, NOW);
    expect(scanSecurityEvents(db.raw, { now: NOW })).toHaveLength(0);

    event("LOW", "auth", "auth.failed", {}, NOW);
    const raised = scanSecurityEvents(db.raw, { now: NOW });
    const burst = raised.find((incident) => incident.incidentType === "auth_failure_burst");
    expect(burst?.severity).toBe("HIGH");
  });

  it("raises tool and treasury denial bursts", () => {
    for (let i = 0; i < 5; i += 1) event("MEDIUM", "tool", "tool.denied", {}, NOW);
    for (let i = 0; i < 3; i += 1) event("MEDIUM", "financial", "treasury.denied", {}, NOW);

    const raised = scanSecurityEvents(db.raw, { now: NOW });
    expect(raised.map((incident) => incident.incidentType)).toContain("tool_denial_burst");
    expect(raised.map((incident) => incident.incidentType)).toContain("treasury_denial_burst");
  });

  it("is idempotent across repeated scans", () => {
    event("MEDIUM", "wallet", "wallet.access", {}, NOW);
    event("MEDIUM", "tool", "tool.denied", {}, NOW);

    const first = scanSecurityEvents(db.raw, { now: NOW });
    const second = scanSecurityEvents(db.raw, { now: NOW });

    expect(second.map((incident) => incident.id)).toEqual(first.map((incident) => incident.id));
    expect(new Set(second.map((incident) => incident.id)).size).toBe(second.length);
    expect(listIncidents(db.raw)).toHaveLength(first.length);
  });

  it("ignores events outside the scan window", () => {
    const stale = new Date(NOW.getTime() - 30 * 60_000);
    event("MEDIUM", "wallet", "wallet.access", {}, stale);

    expect(scanSecurityEvents(db.raw, { windowMs: 10 * 60_000, now: NOW })).toHaveLength(0);
    expect(scanSecurityEvents(db.raw, { windowMs: 60 * 60_000, now: NOW })).toHaveLength(1);
  });
});

describe("checkTamper", () => {
  it("passes for an intact chain and records nothing", () => {
    event("INFO", "tool", "tool.authorized", {}, NOW);
    const result = checkTamper(db.raw, NOW);
    expect(result).toMatchObject({ chainValid: true, sealsValid: true, recommendEmergencyStop: false });
    expect(result.incident).toBeNull();
    expect(listIncidents(db.raw)).toHaveLength(0);
  });

  it("raises one CRITICAL integrity incident and recommends the stop", () => {
    event("INFO", "tool", "tool.authorized", {}, NOW);
    event("INFO", "tool", "tool.denied", {}, NOW);
    db.raw.exec("DROP TRIGGER security_events_no_update");
    db.raw.prepare("UPDATE security_events SET details = '{\"forged\":true}' WHERE sequence = 1").run();

    const result = checkTamper(db.raw, NOW);
    expect(result.chainValid).toBe(false);
    expect(result.recommendEmergencyStop).toBe(true);
    expect(result.incident?.incidentType).toBe("audit_tamper");
    expect(result.incident?.severity).toBe("CRITICAL");
    expect(verifySecurityChain(db.raw).valid).toBe(false);

    const again = checkTamper(db.raw, NOW);
    expect(again.incident?.id).toBe(result.incident?.id);
    expect(listIncidents(db.raw, { severity: "CRITICAL" })).toHaveLength(1);
  });

  it("detects a seal that no longer matches the chain", () => {
    event("INFO", "tool", "tool.authorized", {}, NOW);
    db.raw
      .prepare(
        `INSERT INTO security_seals (id, sequence, head_hash, created_ms, created_at, reason, actor)
         VALUES ('seal-1', 1, 'bogus', ?, ?, 'drill', 'tester')`,
      )
      .run(NOW.getTime(), NOW.toISOString());

    const result = checkTamper(db.raw, NOW);
    expect(result.chainValid).toBe(true);
    expect(result.sealsValid).toBe(false);
    expect(result.recommendEmergencyStop).toBe(true);
  });
});

describe("emergency stop halts autonomous activity", () => {
  function contextWithGrant(): ToolContext {
    toolDb = createTestDb();
    return {
      identity: createTestIdentity(),
      // createTestConfig grants every capability, so authorization would pass:
      // only the emergency stop can block this dispatch.
      config: createTestConfig({ security: { lockdown: false } }),
      db: toolDb,
      conway: new MockConwayClient(),
      inference: new MockInferenceClient([]),
    } as ToolContext;
  }

  it("blocks an allowlisted tool from the marker file alone", async () => {
    const dir = tempDir("conway-ir-home-");
    process.env.HOME = dir;
    engageEmergencyStop({ reason: "security drill", requestedBy: "tester", now: NOW });
    expect(isEmergencyStopEngaged(path.join(dir, ".automaton"))).toBe(true);

    const context = contextWithGrant();
    const result = await executeTool("read_file", { path: "a.txt" }, createBuiltinTools("test-sandbox-id"), context);

    expect(result.error).toContain("emergency stop");
    const rows = context.db.raw
      .prepare("SELECT event_type AS eventType, details FROM security_events ORDER BY sequence")
      .all() as Array<{ eventType: string; details: string }>;
    expect(rows.some((row) => row.eventType === "tool.denied" && row.details.includes("EMERGENCY_STOP"))).toBe(true);
    expect(rows.some((row) => row.details.includes("security drill"))).toBe(false);
  });

  it("stays engaged when the marker is deleted but the audit trail says so", async () => {
    const dir = tempDir("conway-ir-home-");
    process.env.HOME = dir;
    const context = contextWithGrant();
    engageEmergencyStop({ reason: "drill", requestedBy: "tester", dir, db: context.db.raw, now: NOW });
    fs.rmSync(path.join(dir, "EMERGENCY_STOP"), { force: true });

    expect(isEmergencyStopEngaged(dir)).toBe(false);
    expect(isEmergencyStopEngagedInDb(context.db.raw)).toBe(true);
    expect(isEmergencyStopActive(context.db.raw)).toBe(true);

    const result = await executeTool("read_file", { path: "a.txt" }, createBuiltinTools("test-sandbox-id"), context);
    expect(result.error).toContain("emergency stop");
  });

  it("requires a named human to clear it, then dispatch runs again", async () => {
    const dir = tempDir("conway-ir-home-");
    process.env.HOME = dir;
    const context = contextWithGrant();
    engageEmergencyStop({ reason: "drill", requestedBy: "tester", dir, db: context.db.raw, now: NOW });

    expect(clearEmergencyStop({ confirmedBy: "", reason: "oops", dir, db: context.db.raw }).cleared).toBe(false);
    expect(isEmergencyStopActive(context.db.raw)).toBe(true);

    const cleared = clearEmergencyStop({ confirmedBy: "analyst", reason: "drill complete", dir, db: context.db.raw, now: NOW });
    expect(cleared.cleared).toBe(true);
    expect(isEmergencyStopActive(context.db.raw)).toBe(false);

    const result = await executeTool("read_file", { path: "a.txt" }, createBuiltinTools("test-sandbox-id"), context);
    expect(result.error ?? "").not.toContain("emergency stop");
  });

  async function startDaemon(): Promise<void> {
    const { createHeartbeatDaemon } = await import("../heartbeat/daemon.js");
    const daemon = createHeartbeatDaemon({
      identity: createTestIdentity(),
      config: createTestConfig(),
      heartbeatConfig: { entries: [], defaultIntervalMs: 60_000, lowComputeMultiplier: 2 },
      db,
      rawDb: db.raw,
      conway: new MockConwayClient() as never,
    });
    daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    daemon.stop();
    expect(daemon.isRunning()).toBe(false);
  }

  it("skips heartbeat ticks while engaged", async () => {
    process.env.HOME = tempDir("conway-ir-home-");
    engageEmergencyStop({ reason: "drill", requestedBy: "tester", db: db.raw, now: NOW });

    await startDaemon();
    expect(schedulerCalls.ticks).toBe(0);
  });

  it("runs a heartbeat tick when not engaged", async () => {
    process.env.HOME = tempDir("conway-ir-home-");

    await startDaemon();
    expect(schedulerCalls.ticks).toBe(1);
  });
});

describe("monitoring tasks", () => {
  it("registers the health guardian and security monitor tasks", () => {
    expect(typeof BUILTIN_TASKS.health_guardian).toBe("function");
    expect(typeof BUILTIN_TASKS.security_monitor).toBe("function");
  });

  it("security monitor derives incidents and reports integrity failure", async () => {
    const taskCtx = {
      db,
      config: createTestConfig(),
      identity: createTestIdentity(),
      conway: new MockConwayClient(),
    } as never;

    event("MEDIUM", "wallet", "wallet.access", {}, new Date());
    const clean = await BUILTIN_TASKS.security_monitor(undefined as never, taskCtx);
    expect(clean.shouldWake).toBe(true);
    expect(listIncidents(db.raw, { severity: "HIGH" })).toHaveLength(1);

    db.raw.exec("DROP TRIGGER security_events_no_update");
    db.raw.prepare("UPDATE security_events SET details = '{\"forged\":true}' WHERE sequence = 1").run();
    const tampered = await BUILTIN_TASKS.security_monitor(undefined as never, taskCtx);
    expect(tampered.message).toContain("emergency stop recommended");
    expect(listIncidents(db.raw, { severity: "CRITICAL" })).toHaveLength(1);
    const scan = JSON.parse(db.getKV("last_security_scan") ?? "{}") as {
      tamper?: string | null;
      chainValid?: boolean;
      open?: number;
    };
    expect(scan.tamper).toBe("audit_tamper");
    expect(scan.chainValid).toBe(false);
    expect(scan.open).toBe(2);
  });

  it("health guardian task records a report and never repairs by default", async () => {
    const dir = tempDir("conway-ir-home-");
    process.env.HOME = dir;
    await BUILTIN_TASKS.health_guardian(undefined as never, {
      db,
      config: createTestConfig(),
      identity: createTestIdentity(),
      conway: new MockConwayClient(),
    } as never);

    const stored = JSON.parse(db.getKV("last_health_report") ?? "{}") as {
      outcome?: { enabled: boolean; actions: unknown[] };
    };
    expect(stored.outcome?.enabled).toBe(false);
    expect(stored.outcome?.actions).toHaveLength(0);
  });
});
