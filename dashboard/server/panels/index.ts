import type { Snapshot } from "../state.js";
import type { Panel, PanelId } from "./types.js";
import { agentPanel, modelsPanel, overviewPanel } from "./core.js";
import { treasuryPanel, walletPanel } from "./finance.js";
import { healthPanel, securityPanel, selfHealingPanel } from "./safety.js";
import { backupPanel, controlsPanel, logsPanel, settingsPanel } from "./ops.js";
import { repairApprovalsPanel } from "./repair-approvals.js";

export const PANEL_ORDER: PanelId[] = [
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
];

const BUILDERS: Record<PanelId, (snapshot: Snapshot) => Panel> = {
  overview: overviewPanel,
  agent: agentPanel,
  models: modelsPanel,
  wallet: walletPanel,
  treasury: treasuryPanel,
  security: securityPanel,
  health: healthPanel,
  "self-healing": selfHealingPanel,
  logs: logsPanel,
  backup: backupPanel,
  controls: controlsPanel,
  settings: settingsPanel,
  "repair-approvals": repairApprovalsPanel,
};

export function buildPanel(id: PanelId, snapshot: Snapshot): Panel {
  return BUILDERS[id](snapshot);
}

export function buildAllPanels(snapshot: Snapshot): Panel[] {
  return PANEL_ORDER.map((id) => BUILDERS[id](snapshot));
}

export function isPanelId(value: string): value is PanelId {
  return (PANEL_ORDER as string[]).includes(value);
}
