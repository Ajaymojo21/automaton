import { Bar, BarChart, CartesianGrid, Cell as RechartsCell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Cell as DataCell, Panel, Verdict } from "../types";

/** Only counts of cells that were actually produced this request. There is no time series
 *  because nothing has run: an empty timeline charted as a flat line would be invented data,
 *  so the console charts evidence posture instead. */

const VERDICTS: Verdict[] = ["VERIFIED", "EMPTY", "UNKNOWN", "NOT VERIFIED", "NOT APPLICABLE"];
const FILL: Record<Verdict, string> = {
  VERIFIED: "#34d399",
  EMPTY: "#38bdf8",
  UNKNOWN: "#8fa3c4",
  "NOT VERIFIED": "#fbbf24",
  "NOT APPLICABLE": "#1d2b44",
};

function collectCells(panel: Panel): DataCell[] {
  const out: DataCell[] = [];
  for (const section of panel.sections) {
    for (const entry of section.cells ?? []) out.push(entry.cell);
    for (const row of section.table?.rows ?? []) for (const value of row) if (typeof value === "object" && value !== null && "verdict" in value) out.push(value as DataCell);
    for (const entry of section.list ?? []) if (typeof entry.value === "object" && entry.value !== null && "verdict" in entry.value) out.push(entry.value as DataCell);
  }
  return out;
}

export default function EvidenceChart({ panel }: { panel: Panel }) {
  const cells = collectCells(panel);
  const counts = VERDICTS.map((verdict) => ({
    verdict,
    n: cells.filter((cell) => cell.verdict === verdict).length,
  }));
  const total = cells.length;
  if (total === 0) return null;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-frost">Evidence posture</h3>
        <span className="note">{total} values read from the live sources for this area</span>
      </div>
      <div className="mt-3 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={counts} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
            <CartesianGrid stroke="#1d2b44" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="verdict" tick={{ fill: "#8fa3c4", fontSize: 9 }} interval={0} height={34} angle={-12} textAnchor="end" />
            <YAxis tick={{ fill: "#8fa3c4", fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgba(56,189,248,0.08)" }}
              contentStyle={{ background: "#0e1728", border: "1px solid #1d2b44", borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: "#dbe7fb" }}
            />
            <Bar dataKey="n" radius={[4, 4, 0, 0]}>
              {counts.map((entry) => (
                <RechartsCell key={entry.verdict} fill={FILL[entry.verdict]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
