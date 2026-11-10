import { CellBlock, CellInline, cellToText, isCell } from "./CellView";
import type { Panel, PanelSection } from "../types";

const NOTICE_STYLES: Record<NonNullable<PanelSection["notice"]>["level"], string> = {
  danger: "border-crimson/40 bg-crimson/8 text-crimson",
  warn: "border-amber/40 bg-amber/8 text-amber",
  info: "border-beam/35 bg-beam/8 text-beam",
};

const NOTICE_LABEL: Record<NonNullable<PanelSection["notice"]>["level"], string> = {
  danger: "Blocked",
  warn: "Caution",
  info: "Note",
};

function Section({ section }: { section: PanelSection }) {
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold tracking-wide text-frost">{section.title}</h3>
        {section.note ? <span className="note">{section.note}</span> : null}
      </div>

      {section.layout === "metrics" && section.cells ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {section.cells.map((entry) => (
            <CellBlock key={entry.label} label={entry.label} cell={entry.cell} />
          ))}
        </div>
      ) : null}

      {section.layout === "notice" && section.notice ? (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed ${NOTICE_STYLES[section.notice.level]}`}>
          <span className="font-semibold">{NOTICE_LABEL[section.notice.level]} — </span>
          {section.notice.text}
        </div>
      ) : null}

      {section.layout === "list" && section.list ? (
        <ul className="mt-3 divide-y divide-edge-soft">
          {section.list.map((entry) => (
            <li key={entry.label} className="flex items-start justify-between gap-4 py-2">
              <span className="eyebrow pt-0.5">{entry.label}</span>
              <span className="shrink-0">{isCell(entry.value) ? <CellInline cell={entry.value} /> : <span className="value">{cellToText(entry.value)}</span>}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {section.layout === "table" && section.table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {section.table.columns.map((column) => (
                  <th key={column} className="table-head">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, columnIndex) => (
                    <td key={columnIndex} className="table-cell">
                      {isCell(value) ? <CellInline cell={value} /> : <span className="value">{cellToText(value)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {section.table.rows.length === 0 ? (
                <tr>
                  <td className="table-cell note" colSpan={section.table.columns.length}>
                    NO DATA — the source was read and returned nothing.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default function PanelView({ panel }: { panel: Panel }) {
  return (
    <div className="space-y-4">
      {panel.sections.map((section) => (
        <Section key={section.title} section={section} />
      ))}
    </div>
  );
}
