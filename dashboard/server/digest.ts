import { agentStateCell, guardCell, healthCell, overviewPanel } from "./panels/core.js";
import { countCell, type Snapshot } from "./state.js";

/** The small, cheap payload the stream pushes. It is a projection of the same snapshot the
 *  panels render, so a tile can never disagree with its own detail page. */
export function overviewDigest(snapshot: Snapshot) {
  const panel = overviewPanel(snapshot);
  return {
    ok: true,
    observedAt: snapshot.observedAt,
    home: guardCell(snapshot),
    health: healthCell(snapshot),
    agentState: agentStateCell(snapshot),
    activation: { verdict: "VERIFIED", value: snapshot.activation.approved === true },
    emergencyStop: { verdict: "VERIFIED", value: snapshot.emergency.state.engaged ? "ENGAGED" : "NOT ENGAGED" },
    wallet: { verdict: "VERIFIED", value: snapshot.wallet.exists ? String(snapshot.wallet.address ?? "present") : "NO WALLET CONFIGURED" },
    incidents: countCell(snapshot, "security_incidents"),
    tiles: panel.sections[0]?.cells?.map((cell) => ({ label: cell.label, verdict: cell.cell.verdict, value: cell.cell.value })) ?? [],
  };
}
