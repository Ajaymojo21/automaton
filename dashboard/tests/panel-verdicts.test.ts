import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../server/state.js";
import { buildAllPanels, PANEL_ORDER } from "../server/panels/index.js";
import type { Cell } from "../server/values.js";
import type { Panel, PanelSection } from "../server/panels/types.js";

/** Mandate §17 forbids three renderings in particular: an absent table shown as a failure, a
 *  value shown as VERIFIED when it is really unknown, and any claim that a risk is resolved
 *  without a new verification. These assert the whole panel set, not one hand-picked cell. */

function sections(panel: Panel): PanelSection[] {
  return panel.sections;
}

function allCells(panels: Panel[]): Array<{ panelId: string; label: string; cell: Cell }> {
  const out: Array<{ panelId: string; label: string; cell: Cell }> = [];
  for (const panel of panels) {
    for (const section of sections(panel)) {
      for (const entry of section.cells ?? []) {
        out.push({ panelId: panel.id, label: entry.label, cell: entry.cell });
      }
      for (const row of section.table?.rows ?? []) {
        for (const value of row) {
          if (value && typeof value === "object" && "verdict" in value) {
            out.push({ panelId: panel.id, label: section.title, cell: value as Cell });
          }
        }
      }
      for (const entry of section.list ?? []) {
        const value = entry.value;
        if (value && typeof value === "object" && "verdict" in value) {
          out.push({ panelId: panel.id, label: entry.label, cell: value as Cell });
        }
      }
    }
  }
  return out;
}

function findCell(panels: Panel[], label: string): Cell {
  const found = allCells(panels).find((entry) => entry.label === label);
  if (!found) throw new Error(`no cell labelled "${label}"`);
  return found.cell;
}

const panels = buildAllPanels(await buildSnapshot());
const cells = allCells(panels);

describe("the twelve areas", () => {
  it("renders every mandated area, in the mandated order", () => {
    expect(panels.map((panel) => panel.id)).toEqual(PANEL_ORDER);
    expect(panels.map((panel) => panel.id)).toEqual([
      "overview",
      "agent",
      "models",
      "wallet",
      "treasury",
      "security",
      "health",
      "self-healing",
      "logs",
      "backup",
      "controls",
      "settings",
      "repair-approvals",
    ]);
  });

  it("names a source for every single value", () => {
    const sourceless = cells.filter((entry) => !entry.cell.source || entry.cell.source.length === 0);
    expect(sourceless).toEqual([]);
  });
});

describe("unknown is never dressed up as verified", () => {
  it("has no VERIFIED cell whose value is the word UNKNOWN", () => {
    const offenders = cells
      .filter((entry) => entry.cell.verdict === "VERIFIED" && String(entry.cell.value).trim().toUpperCase() === "UNKNOWN")
      .map((entry) => `${entry.panelId}/${entry.label}`);
    expect(offenders).toEqual([]);
  });

  it("leaves the agent runtime state UNKNOWN rather than showing the code default", () => {
    const cell = findCell(panels, "Agent runtime state");
    expect(cell.verdict).toBe("UNKNOWN");
    expect(cell.value).toBeUndefined();
  });

  it("marks the declared model NOT VERIFIED because no inference has ever run", () => {
    expect(findCell(panels, "Declared model").verdict).toBe("NOT VERIFIED");
  });
});

describe("an absent table is not a failure", () => {
  it("reports the security readers as NOT VERIFIED", () => {
    for (const label of ["Audit seals", "Incidents", "Audit-trail corroboration", "Authorization ledger"]) {
      const cell = findCell(panels, label);
      expect(cell.verdict, `${label} must not read as a failure`).toBe("NOT VERIFIED");
    }
  });

  it("never contains the phrase 'seals failed' anywhere in the payload", () => {
    const payload = JSON.stringify(panels).toLowerCase();
    expect(payload).not.toContain("seals failed");
    expect(payload).not.toContain("seal failure");
  });

  it("keeps the raw guardian status visible while reclassifying the blocked checks", () => {
    const reported = findCell(panels, "Overall (as reported)");
    const adjusted = findCell(panels, "Overall (informative checks only)");
    expect(reported.verdict).toBe("VERIFIED");
    // The live V11 database has no security_events or treasury_authorizations table, so the
    // guardian reports those checks blocked. Blocked is the guardian's own word for "no
    // source to assess" — it is not the same as a failure, and the dashboard does not upgrade it.
    expect(reported.value).toBe("blocked");
    // With the blocked checks set aside, what remains is a stale-schema warning and a stale
    // archive — not a critical finding.
    expect(adjusted.value).not.toBe("critical");
    expect(String(adjusted.note)).toContain("reported blocked");
  });

  it("separates EMPTY (counted zero) from UNKNOWN (nothing to count)", () => {
    expect(findCell(panels, "kv keys").verdict).toBe("EMPTY");
    expect(findCell(panels, "Turn count").verdict).toBe("UNKNOWN");
  });
});

describe("the closed gates are shown as closed", () => {
  it("shows activation false and no wallet", () => {
    expect(findCell(panels, "Agent activation").value).toBe(false);
    expect(findCell(panels, "Wallet").value).toBe("NO WALLET CONFIGURED");
    expect(findCell(panels, "wallet.json").value).toBe("absent");
  });

  it("shows lockdown on with an empty allowed-tool list", () => {
    expect(findCell(panels, "Lockdown").value).toBe(true);
    expect(findCell(panels, "Allowed tools").value).toBe(0);
  });

  it("shows self-healing disabled and its mechanic unreachable", () => {
    expect(findCell(panels, "selfHealingEnabled").value).toBe(false);
    expect(findCell(panels, "Mechanic").value).toBe("NOT REACHABLE");
  });

  it("labels a code default as a code default instead of an operator decision", () => {
    const selfHealing = findCell(panels, "selfHealingEnabled");
    expect(String(selfHealing.note)).toContain("code default");
  });
});

describe("activity that has never happened is not reported as clean", () => {
  it("shows no logs, no soul, no timeline", () => {
    expect(findCell(panels, "Activity logs").verdict).toBe("EMPTY");
    expect(findCell(panels, "Soul / persona").value).toBe(false);
    expect(findCell(panels, "Activity timeline").verdict).toBe("UNKNOWN");
  });

  it("shows heartbeat declarations as declared-but-never-scheduled", () => {
    const nextRuns = findCell(panels, "Next runs");
    expect(String(nextRuns.value)).toContain("NEVER RUN");
  });
});
