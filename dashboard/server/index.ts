import "./home.js";
import http from "node:http";
import { lockHomeOrThrow } from "./home.js";
import { FORBIDDEN_PORTS, HOST, ORIGIN, PORT, TOKEN_PATH } from "./paths.js";
import { ensureToken, isAuthenticated, sessionIdOf } from "./security.js";
import { audit } from "./audit.js";
import { apiGate, handleApi } from "./routes.js";
import { BASE_HEADERS, clientIp, sendJson, serveIndex, serveStatic } from "./http.js";
import { addClient, clientCount, startStream, stopStream } from "./stream.js";
import { closeDb } from "./db.js";

function refusal(reason: string, code: number): never {
  process.stderr.write(`\n[conway-dashboard] REFUSING TO START\n${reason}\n`);
  audit({ at: new Date().toISOString(), event: "startup.refused", verdict: "NOT VERIFIED", detail: { reason, code } });
  process.exit(code);
}

const server = http.createServer((req, res) => {
  void route(req, res).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    // No stack trace and no internal path leaves through an error response.
    if (!res.headersSent) sendJson(res, 500, { ok: false, verdict: "NOT VERIFIED", message: "internal error" });
    audit({ at: new Date().toISOString(), event: "request.error", verdict: "NOT VERIFIED", detail: { message } });
  });
});

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", ORIGIN);
  const method = req.method ?? "GET";

  if (url.pathname === "/api/stream") {
    // The stream is a data route like any other: it passes the same origin and rate-limit
    // gates, and records the same denial, instead of relying on the browser to keep a
    // cross-site EventSource from opening it.
    const gate = apiGate(method, url.pathname, req);
    if (gate) {
      sendJson(res, gate.status, gate.body, gate.headers);
      return;
    }
    if (!isAuthed(req)) {
      audit({ at: new Date().toISOString(), event: "request.unauthenticated", ip: clientIp(req), method, route: `${method} ${url.pathname}`, verdict: "DENIED" });
      sendJson(res, 401, { ok: false, verdict: "NOT VERIFIED", message: "operator token required" });
      return;
    }
    // The session id is recorded so revoking it closes this stream rather than only the
    // cookie. A bearer-token client has no session, hence null.
    const dispose = addClient(res, clientIp(req), sessionIdOf(req.headers.cookie) || null);
    req.on("close", dispose);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const result = await handleApi(method, url, req);
    sendJson(res, result.status, result.body, result.headers);
    return;
  }

  if (method === "GET" || method === "HEAD") {
    if (serveStatic(res, url.pathname)) return;
    if (url.pathname.includes(".")) {
      res.writeHead(404, { "content-type": "text/plain", ...BASE_HEADERS });
      res.end("not found");
      return;
    }
    serveIndex(res);
    return;
  }

  sendJson(res, 405, { ok: false, verdict: "NOT VERIFIED", message: "method not allowed" });
}

function isAuthed(req: http.IncomingMessage): boolean {
  return isAuthenticated(req.headers, clientIp(req));
}

function listen(): http.Server {
  if (FORBIDDEN_PORTS.has(PORT)) {
    refusal(`port ${PORT} is reserved for another project and is never bound`, 4);
  }
  if (HOST !== "127.0.0.1") {
    refusal(`the console binds loopback only; refusing host ${HOST}`, 4);
  }
  return server.listen(PORT, HOST);
}

function banner(): void {
  process.stdout.write(
    [
      "",
      "  CONWAY AUTOMATON / AI COMMAND CENTER",
      `  ${ORIGIN}  (loopback only)`,
      "",
      `  Operator token: read it from ${TOKEN_PATH}`,
      "  It is deliberately not printed here — this stream may be redirected to a log.",
      "",
      "  The Conway agent is NOT started by this process and cannot be started from it.",
      "",
    ].join("\n"),
  );
}

function main(): void {
  try {
    const guard = lockHomeOrThrow();
    process.stdout.write(`[conway-dashboard] HOME guard OK: ${guard.actual}\n`);
  } catch (cause) {
    refusal(cause instanceof Error ? cause.message : String(cause), 3);
  }

  ensureToken();
  const instance = listen();
  instance.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      refusal(`port ${PORT} is already in use — another dashboard is probably running. Nothing is killed to free it.`, 5);
    }
    refusal(`listen failed: ${error.code ?? error.message}`, 5);
  });
  instance.on("listening", () => {
    startStream();
    banner();
    audit({ at: new Date().toISOString(), event: "startup.listening", verdict: "VERIFIED", detail: { host: HOST, port: PORT } });
  });
}

function shutdown(signal: string): void {
  audit({ at: new Date().toISOString(), event: "shutdown", verdict: "VERIFIED", detail: { signal, sseClients: clientCount() } });
  stopStream();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main();
