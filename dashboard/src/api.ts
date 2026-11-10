import type { ActionResult, Cell, Digest, Panel } from "./types";

/** Every request goes to the same loopback origin that served this bundle. credentials are
 *  sent so the HttpOnly SameSite=Strict session cookie travels; no token is ever stored in
 *  localStorage, so a stolen bundle cannot read the Conway database. */

const JSON_HEADERS: Record<string, string> = { "content-type": "application/json" };

/** Mutations carry the explicit opt-in header the server requires for CSRF defence. */
const MUTATION_HEADERS: Record<string, string> = { ...JSON_HEADERS, "x-conway-request": "1" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned ${response.status} (not JSON)`);
  }
  if (!response.ok) {
    const message = (body as { message?: string })?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function getSession(): Promise<{ authenticated: boolean }> {
  const body = await request<{ ok: boolean; authenticated: boolean }>("/api/session");
  return { authenticated: body.authenticated === true };
}

export async function login(token: string): Promise<void> {
  await request<{ ok: boolean }>("/api/auth", {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ token }),
  });
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/api/logout", { method: "POST", headers: MUTATION_HEADERS });
}

export async function getPanels(): Promise<{ observedAt: string; panels: Panel[] }> {
  const body = await request<{ ok: true; observedAt: string; panels: Panel[] }>("/api/panels");
  return { observedAt: body.observedAt, panels: body.panels };
}

export async function getPanel(id: string): Promise<Panel> {
  const body = await request<{ ok: true; panel: Panel }>(`/api/panel/${encodeURIComponent(id)}`);
  return body.panel;
}

export function postAction(name: "health-check" | "verify-backups"): Promise<ActionResult> {
  return request<ActionResult>(`/api/action/${name}`, { method: "POST", headers: MUTATION_HEADERS });
}

export function planRestore(name: string, confirm: string): Promise<ActionResult> {
  return request<ActionResult>("/api/action/restore", {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ name, confirm }),
  });
}

export function executeRestore(name: string, confirm: string): Promise<ActionResult> {
  return request<ActionResult>("/api/action/restore", {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ name, confirm, execute: true }),
  });
}

export function cellValueLabel(cell: Cell): string {
  if (cell.value === undefined || cell.value === null) return "—";
  if (typeof cell.value === "object") return JSON.stringify(cell.value);
  return String(cell.value);
}

/** EventSource cannot set an Authorization header, so the stream authenticates with the
 *  session cookie alone. */
export function openStream(onDigest: (digest: Digest) => void): () => void {
  const source = new EventSource("/api/stream", { withCredentials: true });
  source.addEventListener("snapshot", (event: MessageEvent<string>) => {
    try {
      onDigest(JSON.parse(event.data) as Digest);
    } catch {
      /* a malformed frame is ignored; the next poll replaces it */
    }
  });
  return () => source.close();
}
