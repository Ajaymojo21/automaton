export type Verdict =
  | "VERIFIED"
  | "EMPTY"
  | "UNKNOWN"
  | "NOT VERIFIED"
  | "NOT APPLICABLE";

/**
 * Mandate §17 — the four states are not interchangeable and the dashboard never
 * collapses them:
 *
 *   VERIFIED      an observation was made this request, from a read-only source
 *   EMPTY         the container exists and was counted: zero rows / zero entries
 *   UNKNOWN       no observation is possible (never provisioned, no such source)
 *   NOT VERIFIED  a source exists but would need a write, an absent table, or elevation
 *   NOT APPLICABLE the question does not apply in the current posture
 */

export interface Cell<T = unknown> {
  verdict: Verdict;
  value?: T;
  note?: string;
  source: string;
  observedAt: string;
}

export function observed<T>(
  value: T,
  source: string,
  note?: string,
): Cell<T> {
  return { verdict: "VERIFIED", value, source, observedAt: now(), note };
}

export function empty<T>(value: T, source: string, note?: string): Cell<T> {
  return { verdict: "EMPTY", value, source, observedAt: now(), note };
}

export function unknown(source: string, note: string): Cell<never> {
  return { verdict: "UNKNOWN", source, observedAt: now(), note };
}

export function notVerified(source: string, note: string): Cell<never> {
  return { verdict: "NOT VERIFIED", source, observedAt: now(), note };
}

export function notApplicable(source: string, note: string): Cell<never> {
  return { verdict: "NOT APPLICABLE", source, observedAt: now(), note };
}

/** A reader that threw is never reported as a failing value — only as unverifiable. */
export function fromThrow<T>(
  source: string,
  note: string,
  read: () => { verdict: Verdict; value: T; note?: string },
): Cell<T> {
  try {
    const r = read();
    return { ...r, source, note: r.note ?? note, observedAt: now() };
  } catch (cause) {
    return notVerified(source, `${note} (${describe(cause)})`);
  }
}

export function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`.slice(0, 240);
  return String(cause).slice(0, 240);
}

export function now(): string {
  return new Date().toISOString();
}
