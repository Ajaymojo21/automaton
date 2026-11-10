import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ORIGIN, TOKEN_PATH } from "./paths.js";
import { audit } from "./audit.js";

export const COOKIE_NAME = "conway_cc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;

interface Session {
  createdAt: number;
  expiresAt: number;
  ip: string;
}

const sessions = new Map<string, Session>();

export class AuthUnavailable extends Error {}

/**
 * The token is the dashboard's own operator credential — not a Conway secret. It lives in
 * `dashboard/state/dashboard.token`, is created with `wx` so an existing one is never
 * overwritten, and is compared with a constant-time equality. The operator pastes it once,
 * the same way a Jupyter console hands out its key; after that the HttpOnly cookie carries
 * a random session id instead of the token itself.
 */
export function ensureToken(): string {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  try {
    return readToken(fs.readFileSync(TOKEN_PATH, "utf-8"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  const created = crypto.randomBytes(32).toString("base64url");
  const fd = fs.openSync(TOKEN_PATH, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${created}\n`, "utf-8");
  } finally {
    fs.closeSync(fd);
  }
  audit({ at: new Date().toISOString(), event: "token.created", verdict: "VERIFIED" });
  return created;
}

function readToken(raw: string): string {
  const token = raw.trim();
  if (token.length < 32) throw new AuthUnavailable("dashboard token file is truncated");
  return token;
}

export function tokenMatches(candidate: string, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  // Hash both sides before comparing: an early return on a length mismatch would still tell an
  // unauthenticated caller how long the operator token is.
  const a = crypto.createHash("sha256").update(candidate, "utf-8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf-8").digest();
  return crypto.timingSafeEqual(a, b);
}

export function issueSession(ip: string): string {
  prune();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) dropSession(oldest);
  }
  const sid = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  sessions.set(sid, { createdAt: now, expiresAt: now + SESSION_TTL_MS, ip });
  return sid;
}

function prune(): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (session.expiresAt <= now) dropSession(sid);
  }
}

export function sessionCookie(sid: string): string {
  return [
    `${COOKIE_NAME}=${sid}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    // No `Secure`: this console is loopback-http only. Adding it would break the page.
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; ");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeCookieValue(part.slice(eq + 1).trim());
  }
  return out;
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape is an unmatched cookie value, not a server error.
    return raw;
  }
}

/** Every value this header presents for the session cookie. Cookies ignore ports, so a sibling
 *  loopback app can plant a second cookie of the same name; all of them are accounted for. */
function sessionIdsOf(header: string | undefined): string[] {
  const ids: string[] = [];
  if (!header) return ids;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    ids.push(decodeCookieValue(part.slice(eq + 1).trim()));
  }
  return ids;
}

/** Whether this exact session id is live for this peer. Also used by the event stream, which
 *  re-checks it so a revoked session cannot keep receiving frames after logout. */
export function sessionIsLive(sid: string, ip: string): boolean {
  const session = sessions.get(sid);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    dropSession(sid);
    return false;
  }
  // Rebind: a stolen cookie presented from another loopback peer is not usable.
  if (session.ip !== ip) {
    dropSession(sid);
    return false;
  }
  return true;
}

/** The session id this request presents, or "" when it presents none or more than one. */
export function sessionIdOf(header: string | undefined): string {
  const ids = sessionIdsOf(header);
  return ids.length === 1 ? ids[0] : "";
}

export function hasValidSession(header: string | undefined, ip: string): boolean {
  const ids = sessionIdsOf(header);
  // Two session cookies are ambiguous; never guess which one the browser meant.
  if (ids.length !== 1) return false;
  return sessionIsLive(ids[0], ip);
}

type SessionRevocationListener = (sid: string) => void;
const revocationListeners = new Set<SessionRevocationListener>();

/** Notifies long-lived handlers (the event stream) that a session id is no longer valid. */
export function onSessionRevoked(listener: SessionRevocationListener): () => void {
  revocationListeners.add(listener);
  return () => {
    revocationListeners.delete(listener);
  };
}

function dropSession(sid: string): boolean {
  if (!sessions.delete(sid)) return false;
  for (const listener of revocationListeners) listener(sid);
  return true;
}

/** Destroys every server-side session this cookie header carries. Returns whether one was
 *  live, so a repeated logout stays a successful no-op instead of an error. The peer is not
 *  consulted: whoever presents the session can end it. */
export function revokeSession(header: string | undefined): boolean {
  let revoked = false;
  for (const sid of sessionIdsOf(header)) {
    if (dropSession(sid)) revoked = true;
  }
  return revoked;
}

export function bearerOf(header: string | undefined): string {
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : "";
}

/** A request is authorised by a live session cookie or by the operator token itself. */
export function isAuthenticated(
  headers: { cookie?: string; authorization?: string },
  ip: string,
): boolean {
  return hasValidSession(headers.cookie, ip) || tokenMatches(bearerOf(headers.authorization), ensureToken());
}

/** The only origin this console ever trusts. `Origin: null` is an opaque origin (sandboxed
 *  iframe, `data:`, `file:`) and is never the console, so it is never accepted. */
export function isTrustedOrigin(origin: string): boolean {
  return origin === ORIGIN;
}

function refererOrigin(referer: string): string {
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

/** Mandate §25 — no cross-origin read of a loopback console, and no blind POST.
 *
 *  GET/HEAD may omit Origin (same-origin navigation and fetch do), but a present Origin must
 *  be the console's own. Every state-changing method must name that origin explicitly: a
 *  request without an Origin is not proven same-origin and is refused. */
export function isTrustedRequest(
  method: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const fetchSite = headers["sec-fetch-site"];
  if (fetchSite !== undefined && (typeof fetchSite !== "string" || (fetchSite !== "same-origin" && fetchSite !== "none"))) {
    return false;
  }
  const origin = headers.origin;
  // An array means the header arrived more than once (Node folds duplicates into one), and a
  // folded value is never a proven origin.
  if (origin !== undefined && (typeof origin !== "string" || !isTrustedOrigin(origin))) return false;
  if (method === "GET" || method === "HEAD") return true;
  if (typeof origin !== "string") return false;
  const referer = headers.referer;
  if (referer !== undefined && (typeof referer !== "string" || refererOrigin(referer) !== ORIGIN)) return false;
  return headers["x-conway-request"] === "1";
}

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();
const RATE_CAPACITY = 40;
const RATE_REFILL_PER_MS = 40 / 60_000;

/** Small token bucket: a compromised tab cannot turn the console into a probe tool. */
export function rateLimit(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const bucket = buckets.get(key) ?? { tokens: RATE_CAPACITY, last: now };
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + (now - bucket.last) * RATE_REFILL_PER_MS);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / RATE_REFILL_PER_MS) };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { allowed: true, retryAfterMs: 0 };
}

export function resetAuthState(): void {
  sessions.clear();
  buckets.clear();
}

export function sessionCount(): number {
  prune();
  return sessions.size;
}
