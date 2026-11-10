import type { IncomingMessage } from "node:http";
import {
  COOKIE_NAME,
  ensureToken,
  isAuthenticated,
  isTrustedRequest,
  issueSession,
  rateLimit,
  revokeSession,
  sessionCookie,
  tokenMatches,
} from "./security.js";
import { audit } from "./audit.js";
import { buildSnapshot } from "./state.js";
import { buildAllPanels, buildPanel, isPanelId, PANEL_ORDER } from "./panels/index.js";
import { executeConfirmedRestore, planRestore, runHealthCheckAction, verifyBackupsAction, createRepairProposalAction } from "./commands.js";
import { readRepairApprovals, writableRepairApprovals } from "./repair-approvals.js";
import { clientIp } from "./http.js";

const MAX_BODY_BYTES = 8 * 1024;

export type RouteResult = { status: number; body: unknown; headers?: Record<string, string> };

function denied(status: number, message: string, verdict = "NOT VERIFIED"): RouteResult {
  return { status, body: { ok: false, verdict, message } };
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function checkAuth(req: IncomingMessage, ip: string): boolean {
  return isAuthenticated(req.headers, ip);
}

/** Origin and rate-limit gates, shared by the JSON router and the event stream. Keeping one
 *  copy is what stops a second `/api/*` entry point from skipping one of them. Returns the
 *  refusal to send, or null to continue. */
export function apiGate(method: string, pathname: string, req: IncomingMessage): RouteResult | null {
  const ip = clientIp(req);
  if (!isTrustedRequest(method, req.headers)) {
    audit({ at: new Date().toISOString(), event: "request.rejected", ip, method, route: `${method} ${pathname}`, verdict: "DENIED", detail: { reason: "origin" } });
    return denied(403, "cross-origin request refused");
  }
  const limit = rateLimit(`${ip}:${pathname.startsWith("/api/action/") ? "action" : "read"}`);
  if (!limit.allowed) {
    return { status: 429, body: { ok: false, verdict: "NOT VERIFIED", message: "rate limited" }, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } };
  }
  return null;
}

export async function handleApi(
  method: string,
  url: URL,
  req: IncomingMessage,
): Promise<RouteResult> {
  const ip = clientIp(req);
  const route = `${method} ${url.pathname}`;

  const gate = apiGate(method, url.pathname, req);
  if (gate) return gate;

  if (method === "POST" && url.pathname === "/api/auth") return authenticate(req, ip);
  if (method === "POST" && url.pathname === "/api/logout") return logout(req, ip);
  if (method === "GET" && url.pathname === "/api/session") {
    // This route answers without a credential, so it returns nothing but the caller's own
    // auth state: no token length, no session count, no hint about the credential at all.
    return { status: 200, body: { ok: true, authenticated: checkAuth(req, ip) } };
  }
  if (method === "GET" && url.pathname === "/api/health") {
    return { status: 200, body: { ok: true, verdict: "VERIFIED", pid: process.pid, observedAt: new Date().toISOString() } };
  }

  if (!checkAuth(req, ip)) {
    audit({ at: new Date().toISOString(), event: "request.unauthenticated", ip, method, route, verdict: "DENIED" });
    return denied(401, "operator token required");
  }

  if (method === "GET" && url.pathname === "/api/panels") {
    const snapshot = await buildSnapshot();
    return { status: 200, body: { ok: true, observedAt: snapshot.observedAt, panels: buildAllPanels(snapshot) } };
  }
  const panelMatch = /^\/api\/panel\/([a-z-]+)$/.exec(url.pathname);
  if (method === "GET" && panelMatch && isPanelId(panelMatch[1])) {
    const snapshot = await buildSnapshot();
    return { status: 200, body: { ok: true, observedAt: snapshot.observedAt, panel: buildPanel(panelMatch[1], snapshot) } };
  }
  if (method === "GET" && url.pathname === "/api/system") {
    const snapshot = await buildSnapshot();
    return { status: 200, body: { ok: true, observedAt: snapshot.observedAt, ids: PANEL_ORDER, home: snapshot.home, db: snapshot.db.error ?? "read-only handle open" } };
  }

  if (method === "POST" && url.pathname === "/api/action/health-check") {
    return { status: 200, body: await runHealthCheckAction() };
  }
  if (method === "POST" && url.pathname === "/api/action/verify-backups") {
    return { status: 200, body: await verifyBackupsAction() };
  }
  if (method === "POST" && url.pathname === "/api/action/repair-propose") {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) return denied(415, "application/json required");
    let body: { findingId?: unknown; component?: unknown; rootCause?: unknown; proposedAction?: unknown; riskClassification?: unknown };
    try { body = JSON.parse(await readBody(req)) as typeof body; } catch { return denied(400, "malformed JSON body"); }
    const findingId = typeof body.findingId === "string" ? body.findingId : "";
    const component = typeof body.component === "string" ? body.component : "";
    const rootCause = typeof body.rootCause === "string" ? body.rootCause : "";
    const proposedAction = typeof body.proposedAction === "string" ? body.proposedAction : "";
    const risk = (typeof body.riskClassification === "string" ? body.riskClassification : "medium") as "low" | "medium" | "high" | "critical";
    if (!findingId || !component || !proposedAction) return denied(400, "findingId, component, proposedAction required");
    const result = createRepairProposalAction({ findingId, component, rootCause, proposedAction, riskClassification: risk });
    return { status: result.ok ? 200 : 400, body: result };
  }
  if (method === "POST" && url.pathname === "/api/action/restore") {
    return restore(req, ip);
  }

  // Repair approval endpoints (B-8): authenticated, CSRF-protected writes.
  if (method === "GET" && url.pathname === "/api/repair-approvals") {
    const opened = readRepairApprovals();
    if (!opened.ok) {
      return {
        status: opened.absent ? 200 : 503,
        body: {
          ok: false,
          verdict: "NOT VERIFIED",
          absent: opened.absent,
          count: null,
          proposals: [],
          message: opened.error,
        },
      };
    }
    const status = url.searchParams.get("status") ?? undefined;
    const proposals = status
      ? opened.store.listProposals({ status: status as never })
      : opened.store.listProposals();
    return { status: 200, body: { ok: true, verdict: "VERIFIED", count: proposals.length, proposals } };
  }
  const approvalMatch = /^\/api\/repair-approval\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && approvalMatch) {
    const opened = readRepairApprovals();
    if (!opened.ok) return denied(503, opened.error);
    const proposal = opened.store.getProposal(approvalMatch[1]);
    if (!proposal) return denied(404, "proposal not found");
    return {
      status: 200,
      body: { ok: true, verdict: "VERIFIED", proposal, events: opened.store.listEvents(proposal.id) },
    };
  }
  const approveMatch = /^\/api\/repair-approval\/([^/]+)\/approve$/.exec(url.pathname);
  if (method === "POST" && approveMatch) {
    return handleRepairApprovalDecision(req, ip, approveMatch[1], "approve");
  }
  const rejectMatch = /^\/api\/repair-approval\/([^/]+)\/reject$/.exec(url.pathname);
  if (method === "POST" && rejectMatch) {
    return handleRepairApprovalDecision(req, ip, rejectMatch[1], "reject");
  }
  return denied(404, "no such endpoint");
}

async function handleRepairApprovalDecision(
  req: IncomingMessage,
  ip: string,
  id: string,
  kind: "approve" | "reject",
): Promise<RouteResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return denied(415, "application/json required");
  let body: { identity?: unknown; reason?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return denied(400, "malformed JSON body");
  }
  const identity = typeof body.identity === "string" ? body.identity : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const opened = writableRepairApprovals();
  if (!opened.ok) {
    audit({
      at: new Date().toISOString(),
      event: `repair-approval.${kind}`,
      ip,
      verdict: "NOT VERIFIED",
      detail: { id, reason: opened.error },
    });
    return denied(503, opened.error);
  }
  const options = {
    expectedRevision:
      typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
        ? body.expectedRevision
        : undefined,
    idempotencyKey: typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined,
  };
  let result: import("../../src/reliability/repair-approval.js").ApprovalDecision;
  try {
    result = kind === "approve"
      ? opened.store.approve(id, identity, reason, options)
      : opened.store.reject(id, identity, reason, options);
  } catch (cause) {
    return denied(500, `decision failed: ${String(cause).slice(0, 160)}`);
  }
  audit({
    at: new Date().toISOString(),
    event: `repair-approval.${kind}`,
    ip,
    verdict: result.ok ? "VERIFIED" : "DENIED",
    detail: { id, identity, reason: result.reason ?? null, replay: result.replay === true },
  });
  return {
    status: result.ok ? 200 : 400,
    body: result.ok ? { ok: true, proposal: result.proposal } : { ok: false, verdict: "NOT VERIFIED", message: result.reason },
  };
}

async function authenticate(req: IncomingMessage, ip: string): Promise<RouteResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return denied(415, "application/json required");
  let token = "";
  try {
    const parsed = JSON.parse(await readBody(req)) as { token?: unknown };
    token = typeof parsed.token === "string" ? parsed.token : "";
  } catch {
    return denied(400, "malformed JSON body");
  }
  if (!tokenMatches(token, ensureToken())) {
    audit({ at: new Date().toISOString(), event: "auth.failed", ip, verdict: "DENIED", detail: { length: token.length } });
    return denied(401, "invalid operator token");
  }
  const sid = issueSession(ip);
  audit({ at: new Date().toISOString(), event: "auth.success", ip, verdict: "VERIFIED", detail: { session: sid.slice(0, 6) } });
  return { status: 200, body: { ok: true, verdict: "VERIFIED", cookie: COOKIE_NAME }, headers: { "set-cookie": sessionCookie(sid) } };
}

async function logout(req: IncomingMessage, ip: string): Promise<RouteResult> {
  // Deleting the session before clearing the cookie is what makes logout real: the cookie
  // value alone no longer authenticates anything, even if a copy of it was already taken.
  const revoked = revokeSession(req.headers.cookie);
  audit({ at: new Date().toISOString(), event: "auth.logout", ip, verdict: "VERIFIED", detail: { revoked } });
  return { status: 200, body: { ok: true }, headers: { "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` } };
}

async function restore(req: IncomingMessage, ip: string): Promise<RouteResult> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return denied(415, "application/json required");
  let body: { name?: unknown; confirm?: unknown; execute?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return denied(400, "malformed JSON body");
  }
  const name = typeof body.name === "string" ? body.name : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";
  if (body.execute === true) {
    // Step 2 never re-plans: it consumes the plan the operator confirmed at step 1, so the
    // path shown and the path written are the same path.
    const result = executeConfirmedRestore(name, confirm);
    audit({
      at: new Date().toISOString(),
      event: "action.restore.execute",
      ip,
      verdict: result.verdict,
      detail: { name, ok: result.ok, summary: result.summary },
    });
    return {
      status: result.ok ? 200 : 400,
      body: result.ok ? result : { ...result, message: result.summary },
    };
  }
  const plan = planRestore(name, confirm);
  if (!plan.ok) {
    audit({ at: new Date().toISOString(), event: "action.restore.plan", ip, verdict: plan.verdict, detail: { name, reason: plan.summary } });
    // `message` is this API's error field everywhere else; `summary` is the ActionResult field.
    return { status: 400, body: { ok: false, verdict: plan.verdict, message: plan.summary } };
  }
  audit({ at: new Date().toISOString(), event: "action.restore.plan", ip, verdict: "VERIFIED", detail: { name, target: plan.target } });
  return { status: 200, body: { ok: true, verdict: "VERIFIED", stage: "plan", plan } };
}
