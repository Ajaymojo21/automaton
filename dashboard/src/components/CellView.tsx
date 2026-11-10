import VerdictBadge from "./VerdictBadge";
import { cellValueLabel } from "../api";
import type { Cell, CellValue } from "../types";

function isCell(value: unknown): value is Cell {
  return typeof value === "object" && value !== null && "verdict" in (value as Record<string, unknown>);
}

export function cellToText(value: CellValue): string {
  if (value === null || value === undefined) return "—";
  if (isCell(value)) return cellValueLabel(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A cell renders its verdict, its value and — never omitted — the reason it is what it is.
 *  The source string is what makes "UNKNOWN" defensible instead of decorative. */
export function CellBlock({ cell, label }: { cell: Cell; label: string }) {
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        <VerdictBadge verdict={cell.verdict} />
      </div>
      <div className="value mt-2">{cellValueLabel(cell)}</div>
      {cell.note ? <div className="note mt-2">{cell.note}</div> : null}
      <div className="note mt-2 text-mist/60">source: {cell.source}</div>
    </div>
  );
}

export function CellInline({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex items-center gap-2">
      <VerdictBadge verdict={cell.verdict} />
      <span className="value">{cellValueLabel(cell)}</span>
    </span>
  );
}

export { isCell };
