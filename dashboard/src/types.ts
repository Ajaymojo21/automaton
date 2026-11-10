/** Client mirror of dashboard/server/values.ts and dashboard/server/panels/types.ts.
 *  Duplicated deliberately: the client tsconfig excludes server/, and the SPA must not
 *  typecheck against the process that reads the live database. */

export type Verdict = "VERIFIED" | "EMPTY" | "UNKNOWN" | "NOT VERIFIED" | "NOT APPLICABLE";

export interface Cell<T = unknown> {
  verdict: Verdict;
  value?: T;
  note?: string;
  source: string;
  observedAt: string;
}

export type CellValue = Cell | string | number | boolean | null;

export interface PanelSection {
  title: string;
  layout: "metrics" | "table" | "notice" | "list";
  cells?: Array<{ label: string; cell: Cell }>;
  table?: { columns: string[]; rows: CellValue[][] };
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

export interface Digest {
  ok: boolean;
  observedAt?: string;
  verdict?: string;
  message?: string;
  home?: Cell;
  health?: Cell;
  agentState?: Cell;
  activation?: { verdict: string; value: unknown };
  emergencyStop?: { verdict: string; value: unknown };
  wallet?: { verdict: string; value: unknown };
  incidents?: Cell;
  tiles?: Array<{ label: string; verdict: Verdict; value?: unknown }>;
}

export interface ActionResult {
  ok: boolean;
  action?: string;
  verdict: string;
  summary: string;
  stage?: string;
  message?: string;
  plan?: RestorePlan;
  data?: unknown;
}

/** Hand-written mirror of `RestorePlan` in server/commands.ts — the object `/api/action/restore`
 *  returns under `plan` at the plan stage. The client tsconfig excludes server/, so this copy
 *  exists; the field list must stay identical to the server's or the UI renders undefined. */
export interface RestorePlan {
  ok: boolean;
  verdict: string;
  summary: string;
  sourceDir?: string;
  target?: string;
  /** Relative paths inside the archive, not a count. */
  files?: string[];
}
