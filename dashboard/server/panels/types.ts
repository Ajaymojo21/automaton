import type { Cell } from "../values.js";

export type CellValue = Cell | string | number | boolean | null;

export interface PanelSection {
  title: string;
  layout: "metrics" | "table" | "notice" | "list";
  cells?: Array<{ label: string; cell: Cell }>;
  table?: { columns: string[]; rows: Array<CellValue[]> };
  notice?: { level: "danger" | "warn" | "info"; text: string };
  list?: Array<{ label: string; value: CellValue }>;
  note?: string;
}

export interface Panel {
  id: string;
  title: string;
  subtitle: string;
  sections: PanelSection[];
}

export type PanelId =
  | "overview"
  | "agent"
  | "models"
  | "wallet"
  | "treasury"
  | "security"
  | "health"
  | "self-healing"
  | "logs"
  | "backup"
  | "controls"
  | "settings"
  | "repair-approvals";

export function verdictColumn(): string {
  return "verdict";
}
