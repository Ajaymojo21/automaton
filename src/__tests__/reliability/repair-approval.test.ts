import { describe, it, expect, beforeEach } from "vitest";
import { RepairApprovalStore } from "../../reliability/repair-approval.js";

describe("repair approval lifecycle", () => {
  let store: RepairApprovalStore;

  beforeEach(() => {
    store = new RepairApprovalStore({ now: () => new Date("2026-11-10T00:00:00.000Z") });
  });

  function makeProposal() {
    return store.createProposal({
      findingId: "F-1",
      component: "treasury",
      rootCause: "missing keys",
      proposedAction: "prune_expired_leases",
      expectedBenefit: "free space",
      potentialSideEffects: "none",
      riskClassification: "low",
      requiredPermissions: ["maintenance"],
      expectedDowntime: false,
      rollbackPossible: true,
    });
  }

  it("creates a proposal in awaiting_approval", () => {
    const p = makeProposal();
    expect(p.status).toBe("awaiting_approval");
    expect(p.approvalIdentity).toBeNull();
    expect(p.decisionAt).toBeNull();
    expect(p.actionHash).toBeTruthy();
  });

  it("approves a pending proposal to ready_for_execution (not completed)", () => {
    const p = makeProposal();
    const result = store.approve(p.id, "operator@example.com", "reviewed and approved");
    expect(result.ok).toBe(true);
    expect(result.proposal!.status).toBe("ready_for_execution");
    expect(result.proposal!.approvalIdentity).toBe("operator@example.com");
    expect(result.proposal!.decisionReason).toBe("reviewed and approved");
  });

  it("approved proposal is NOT completed", () => {
    const p = makeProposal();
    store.approve(p.id, "op", "ok");
    const got = store.getProposal(p.id)!;
    expect(got.status).toBe("ready_for_execution");
    expect(got.status).not.toBe("completed");
  });

  it("rejects a pending proposal", () => {
    const p = makeProposal();
    const result = store.reject(p.id, "op", "too risky");
    expect(result.ok).toBe(true);
    expect(result.proposal!.status).toBe("rejected");
  });

  it("prevents duplicate approval", () => {
    const p = makeProposal();
    store.approve(p.id, "op", "first");
    const second = store.approve(p.id, "op2", "second");
    expect(second.ok).toBe(false);
    expect(second.reason).toContain("not awaiting approval");
  });

  it("prevents duplicate rejection", () => {
    const p = makeProposal();
    store.reject(p.id, "op", "no");
    const second = store.reject(p.id, "op2", "no2");
    expect(second.ok).toBe(false);
  });

  it("requires identity for approval", () => {
    const p = makeProposal();
    const result = store.approve(p.id, "", "reason");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("identity is required");
  });

  it("requires reason for approval", () => {
    const p = makeProposal();
    const result = store.approve(p.id, "op", "");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("reason is required");
  });

  it("expires proposals past TTL", () => {
    const now = new Date("2026-11-10T00:00:00.000Z");
    const futureNow = new Date("2026-11-10T01:00:00.000Z");
    // Create with ttlMs=0 so expiresAt === createdAt; then use a store whose now is later.
    const store = new RepairApprovalStore({ now: () => now, defaultTtlMs: 0 });
    const p = store.createProposal({
      findingId: "F-2",
      component: "db",
      rootCause: "r",
      proposedAction: "vacuum_database",
      expectedBenefit: "b",
      potentialSideEffects: "s",
      riskClassification: "medium",
      requiredPermissions: [],
      expectedDowntime: false,
      rollbackPossible: true,
    });
    // The proposal was created with expiresAt === now. Move to a store with future now
    // by re-checking expiry through a manual store that shares the same proposal map
    // is not possible (in-memory). Instead, verify expiry logic via isApprovedForAction
    // with a future time is not available; use the store's own expireIfNeeded path by
    // constructing a proposal whose expiresAt is in the past relative to the store now.
    const expiredStore = new RepairApprovalStore({ now: () => futureNow, defaultTtlMs: 0 });
    const p2 = expiredStore.createProposal({
      findingId: "F-3",
      component: "db",
      rootCause: "r",
      proposedAction: "vacuum_database",
      expectedBenefit: "b",
      potentialSideEffects: "s",
      riskClassification: "medium",
      requiredPermissions: [],
      expectedDowntime: false,
      rollbackPossible: true,
      ttlMs: -1,
    });
    const result = expiredStore.approve(p2.id, "op", "late");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("action hash binds approval to exact action", () => {
    const p = makeProposal();
    store.approve(p.id, "op", "ok");
    const hash = p.actionHash;
    expect(store.isApprovedForAction(p.id, hash)).toBe(true);
    expect(store.isApprovedForAction(p.id, "wrong-hash")).toBe(false);
  });

  it("markCompleted requires ready_for_execution", () => {
    const p = makeProposal();
    const r = store.markCompleted(p.id, "verified");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not ready_for_execution");
  });

  it("markCompleted works after approval", () => {
    const p = makeProposal();
    store.approve(p.id, "op", "ok");
    const r = store.markCompleted(p.id, "health check passed");
    expect(r.ok).toBe(true);
    expect(r.proposal!.status).toBe("completed");
  });

  it("markFailed works after approval", () => {
    const p = makeProposal();
    store.approve(p.id, "op", "ok");
    const r = store.markFailed(p.id, "rollback triggered");
    expect(r.ok).toBe(true);
    expect(r.proposal!.status).toBe("failed");
  });

  it("lists pending proposals", () => {
    makeProposal();
    // A second proposal for the same finding+action is now refused (duplicate prevention),
    // so this one targets a different finding.
    const p2 = store.createProposal({
      findingId: "F-2",
      component: "treasury",
      rootCause: "missing keys",
      proposedAction: "prune_expired_leases",
      expectedBenefit: "free space",
      potentialSideEffects: "none",
      riskClassification: "low",
      requiredPermissions: ["maintenance"],
      expectedDowntime: false,
      rollbackPossible: true,
    });
    store.approve(p2.id, "op", "ok");
    const pending = store.listPending();
    expect(pending.length).toBe(1);
  });

  it("unknown proposal returns not found", () => {
    const result = store.approve("nonexistent", "op", "reason");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not found");
  });
});
