import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SPA_DIST_DIR } from "./paths.js";

export function clientIp(req: IncomingMessage): string {
  // Loopback only: the socket address is the authority. Forwarded headers are ignored so a
  // proxy cannot spoof the peer that session rebinding trusts.
  return req.socket.remoteAddress ?? "unknown";
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...BASE_HEADERS,
    ...headers,
  });
  res.end(payload);
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

// Every response leaves this file, including the plain-text fallbacks, so no path can ship a page
// without the headers the rest of the console relies on.
export const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": CSP,
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

export function serveStatic(res: ServerResponse, pathname: string): boolean {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(SPA_DIST_DIR, rel);
  if (target !== SPA_DIST_DIR && !target.startsWith(SPA_DIST_DIR + path.sep)) {
    res.writeHead(400, { "content-type": "text/plain", ...BASE_HEADERS });
    res.end("bad path");
    return true;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return false;
  const ext = path.extname(target).toLowerCase();
  const hashed = /[.-][0-9a-zA-Z_]{8,}\.(js|css)$/.test(path.basename(target));
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": ext === ".html" || !hashed ? "no-store" : "public, max-age=31536000, immutable",
    ...BASE_HEADERS,
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

export function serveIndex(res: ServerResponse): void {
  const index = path.join(SPA_DIST_DIR, "index.html");
  if (!fs.existsSync(index)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...BASE_HEADERS });
    res.end(
      [
        "Conway Automaton — AI Command Center",
        "",
        "The SPA bundle is not built yet, so this page is served as plain text.",
        "Run: cd dashboard && npm run build     (then reload)",
        "",
        "The API is live regardless of the bundle:",
        "  GET  /api/health   liveness",
        "  POST /api/auth     operator token (printed in this console window at startup)",
        "  GET  /api/panels   the twelve command-center areas",
        "",
        "No agent control is reachable from this server. See dashboard docs.",
      ].join("\n"),
    );
    return;
  }
  serveStatic(res, "/index.html");
}
