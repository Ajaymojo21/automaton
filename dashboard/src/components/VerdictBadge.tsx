import type { Verdict } from "../types";

/** Colour carries meaning, so the five states never collapse into "red = bad":
 *  NOT VERIFIED is amber (unproven), crimson is reserved for an observed failure. */
const STYLES: Record<Verdict, string> = {
  VERIFIED: "border-verdant/40 bg-verdant/10 text-verdant",
  EMPTY: "border-beam/40 bg-beam/10 text-beam",
  UNKNOWN: "border-mist/30 bg-mist/10 text-mist",
  "NOT VERIFIED": "border-amber/40 bg-amber/10 text-amber",
  "NOT APPLICABLE": "border-edge bg-panel-2 text-mist/70",
};

const GLYPH: Record<Verdict, string> = {
  VERIFIED: "✓",
  EMPTY: "0",
  UNKNOWN: "?",
  "NOT VERIFIED": "!",
  "NOT APPLICABLE": "–",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${STYLES[verdict]}`}
      title={verdict}
    >
      <span aria-hidden>{GLYPH[verdict]}</span>
      {verdict}
    </span>
  );
}
