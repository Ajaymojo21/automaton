import type { Snapshot } from "../state.js";
import type { Panel } from "./types.js";
import { observed, empty, notVerified, unknown } from "../values.js";
import { readRepairApprovals } from "../repair-approvals.js";

export function repairApprovalsPanel(_s: Snapshot): Panel {
  const opened = readRepairApprovals();
  if (!opened.ok) {
    const cell = opened.absent
      ? unknown(
          "repair-approvals.db",
          "NO DATA — no repair proposal has ever been recorded. The store is created by the first authorised POST /api/action/repair-propose.",
        )
      : notVerified("repair-approvals.db", opened.error);
    return {
      id: "repair-approvals" as never,
      title: "Repair Approvals",
      subtitle: "Governance surface — approval does not execute repairs",
      sections: [
        { title: "Pending proposals", layout: "metrics", cells: [{ label: "Store", cell }] },
        {
          title: "Boundary",
          layout: "notice",
          notice: {
            level: "info",
            text: "Approval moves a proposal to READY_FOR_EXECUTION. It never runs the repair, the agent, the scheduler, a shell, or a financial tool.",
          },
        },
      ],
    };
  }

  const proposals = opened.store.listProposals();
  const pending = proposals.filter((p) => p.status === "awaiting_approval");
  const ready = proposals.filter((p) => p.status === "ready_for_execution");
  const emptyStore = proposals.length === 0;

  return {
    id: "repair-approvals" as never,
    title: "Repair Approvals",
    subtitle: "Governance surface — approval does not execute repairs",
    sections: [
      {
        title: "Pending proposals",
        layout: "metrics",
        cells: [
          {
            label: "Total proposals",
            cell: emptyStore
              ? empty(0, "repair-approvals.db · repair_approvals", "store exists; no proposals recorded")
              : observed(proposals.length, "repair-approvals.db · repair_approvals"),
          },
          { label: "Awaiting approval", cell: observed(pending.length, "repair-approvals.db · repair_approvals WHERE status='awaiting_approval'") },
          { label: "Ready for execution", cell: observed(ready.length, "repair-approvals.db · repair_approvals WHERE status='ready_for_execution'") },
        ],
      },
      {
        title: "Proposals",
        layout: "table",
        note: "Approve/reject via POST /api/repair-approval/:id/approve or /reject with { identity, reason, expectedRevision?, idempotencyKey? }. Approval moves to READY_FOR_EXECUTION but does NOT execute the repair.",
        table: {
          columns: ["id", "finding", "component", "risk", "status", "rev", "expires"],
          rows: emptyStore
            ? [["—", "NO DATA", "no proposals", "—", "—", "—", "—"]]
            : proposals.map((p) => [p.id, p.findingId, p.component, p.riskClassification, p.status, String(p.revision), p.expiresAt]),
        },
      },
      {
        title: "Boundary",
        layout: "notice",
        notice: {
          level: "info",
          text: "Every decision is appended to repair_approval_events (append-only, hash-chained) and to the security audit chain. An approval is never an execution.",
        },
      },
    ],
  };
}
