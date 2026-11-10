import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATION_V12, MIGRATION_V14 } from "../../state/schema.js";
import { DuplicateProposalError, RepairApprovalStore } from "../../reliability/repair-approval.js";
import { verifySecurityChain } from "../../security/audit-chain.js";

/** B-8: the approval lifecycle must survive a restart, settle exactly once, and keep an
 *  append-only history. Every assertion here runs against a disposable SQLite file. */

let dir: string;
let file: string;
let db: Database.Database;

const now = () => new Date("2026-11-10T00:00:00.000Z");

function open(): Database.Database {
  const handle = new Database(file);
  handle.exec(MIGRATION_V12);
  handle.exec(MIGRATION_V14);
  return handle;
}

function input(overrides: Partial<Parameters<RepairApprovalStore["createProposal"]>[0]> = {}) {
  return {
    findingId: "F-B8",
    component: "reliability",
    rootCause: "approval lost on restart",
    proposedAction: "prune_expired_leases",
    expectedBenefit: "durable governance",
    potentialSideEffects: "none",
    riskClassification: "low" as const,
    requiredPermissions: ["maintenance"],
    expectedDowntime: false,
    rollbackPossible: true,
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-approvals-"));
  file = path.join(dir, "repair-approvals.db");
  db = open();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("durable approval storage", () => {
  it("survives a restart", () => {
    const first = new RepairApprovalStore({ db, now });
    const created = first.createProposal(input());
    db.close();

    db = open();
    const second = new RepairApprovalStore({ db, now });
    const reloaded = second.getProposal(created.id);
    expect(reloaded?.status).toBe("awaiting_approval");
    expect(reloaded?.findingId).toBe("F-B8");
    expect(reloaded?.requiredPermissions).toEqual(["maintenance"]);
  });

  it("persists an approval as ready_for_execution, never completed", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    const result = store.approve(created.id, "operator@example.com", "reviewed");
    expect(result.ok).toBe(true);

    db.close();
    db = open();
    const reloaded = new RepairApprovalStore({ db, now }).getProposal(created.id);
    expect(reloaded?.status).toBe("ready_for_execution");
    expect(reloaded?.approvalIdentity).toBe("operator@example.com");
    expect(reloaded?.revision).toBe(2);
  });

  it("refuses a duplicate live proposal for the same finding and action", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    expect(() => store.createProposal(input())).toThrow(DuplicateProposalError);
    expect(store.listProposals()).toHaveLength(1);
    expect(store.getProposal(created.id)?.status).toBe("awaiting_approval");
  });

  it("replays an identical decision instead of applying it twice", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    const first = store.approve(created.id, "op", "ok", { idempotencyKey: "decision-1" });
    const second = store.approve(created.id, "op", "ok", { idempotencyKey: "decision-1" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.replay).toBe(true);
    expect(store.getProposal(created.id)?.revision).toBe(2);
  });

  it("rejects a reused idempotency key for a different proposal", () => {
    const store = new RepairApprovalStore({ db, now });
    const a = store.createProposal(input());
    const b = store.createProposal(input({ findingId: "F-OTHER" }));
    expect(store.approve(a.id, "op", "ok", { idempotencyKey: "shared" }).ok).toBe(true);
    const reused = store.approve(b.id, "op", "ok", { idempotencyKey: "shared" });
    expect(reused.ok).toBe(false);
    expect(reused.reason).toContain("idempotency key");
  });

  it("fails a stale revision instead of overwriting a newer decision", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    const stale = store.approve(created.id, "op", "ok", { expectedRevision: 99 });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toContain("revision conflict");
    expect(store.getProposal(created.id)?.status).toBe("awaiting_approval");
  });

  it("settles a race exactly once across two handles", () => {
    const other = open();
    try {
      const created = new RepairApprovalStore({ db, now }).createProposal(input());
      const a = new RepairApprovalStore({ db, now }).approve(created.id, "a", "ok");
      const b = new RepairApprovalStore({ db: other, now }).approve(created.id, "b", "ok");
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(new RepairApprovalStore({ db, now }).getProposal(created.id)?.revision).toBe(2);
    } finally {
      other.close();
    }
  });

  it("keeps an append-only, hash-chained history", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    store.approve(created.id, "op", "ok");
    const events = store.listEvents(created.id);

    expect(events.map((e) => e.event)).toEqual([
      "repair.proposal.created",
      "repair.proposal.approved",
    ]);
    expect(events[1].prevHash).toBe(events[0].hash);

    expect(() =>
      db.prepare("UPDATE repair_approval_events SET event = 'forged'").run(),
    ).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM repair_approval_events").run()).toThrow(/append-only/);
  });

  it("persists expiry and refuses a late approval", () => {
    const store = new RepairApprovalStore({ db, now, defaultTtlMs: -1 });
    const created = store.createProposal(input({ ttlMs: -1 }));
    const late = store.approve(created.id, "op", "late");
    expect(late.ok).toBe(false);
    expect(late.reason).toContain("expired");
    expect(new RepairApprovalStore({ db, now }).getProposal(created.id)?.status).toBe("expired");
  });

  it("writes decisions into the tamper-evident security chain", () => {
    const store = new RepairApprovalStore({ db, now });
    const created = store.createProposal(input());
    store.approve(created.id, "op", "ok");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM security_events").get() as { n: number };
    expect(rows.n).toBe(2);
    expect(verifySecurityChain(db).valid).toBe(true);
  });
});
