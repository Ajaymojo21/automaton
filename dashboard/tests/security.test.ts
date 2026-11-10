import { describe, expect, it, beforeEach, vi } from "vitest";
import fs from "node:fs";
import {
  COOKIE_NAME,
  bearerOf,
  ensureToken,
  hasValidSession,
  isAuthenticated,
  issueSession,
  isTrustedOrigin,
  isTrustedRequest,
  parseCookies,
  rateLimit,
  resetAuthState,
  revokeSession,
  sessionCookie,
  sessionCount,
  tokenMatches,
} from "../server/security.js";
import { ORIGIN, TOKEN_PATH } from "../server/paths.js";

/** Mandate §25 — auth, CSRF, rate limiting and session protection, each tested by trying the
 *  attack rather than by asserting the happy path. */

describe("operator token", () => {
  it("is a 43-character base64url secret stored 0600 and never overwritten", () => {
    const token = ensureToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.existsSync(TOKEN_PATH)).toBe(true);
    const before = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
    expect(ensureToken()).toBe(before);
  });

  it("rejects empty, short and wrong-length candidates without a timing side channel", () => {
    const token = ensureToken();
    expect(tokenMatches("", token)).toBe(false);
    expect(tokenMatches(token.slice(0, -1), token)).toBe(false);
    expect(tokenMatches(`${token}x`, token)).toBe(false);
    expect(tokenMatches(token, token)).toBe(true);
  });

  it("does not leak the token into the session cookie", () => {
    expect(sessionCookie("abc123")).toContain(`${COOKIE_NAME}=abc123`);
    expect(sessionCookie("abc123")).not.toContain(ensureToken());
  });

  it("issues an HttpOnly SameSite=Strict cookie", () => {
    const value = sessionCookie(issueSession("127.0.0.1"));
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Strict");
    expect(value).toContain("Max-Age=");
  });
});

describe("sessions", () => {
  beforeEach(() => resetAuthState());

  it("binds a session to the issuing loopback peer", () => {
    const sid = issueSession("127.0.0.1");
    const header = `${COOKIE_NAME}=${sid}`;
    expect(hasValidSession(header, "127.0.0.1")).toBe(true);
    resetAuthState();
    const stolen = issueSession("127.0.0.1");
    expect(hasValidSession(`${COOKIE_NAME}=${stolen}`, "127.0.0.2")).toBe(false);
    // the rebinding deletes the session, so replay from the original peer is dead too
    expect(hasValidSession(`${COOKIE_NAME}=${stolen}`, "127.0.0.1")).toBe(false);
  });

  it("refuses an unknown or empty cookie", () => {
    expect(hasValidSession(undefined, "127.0.0.1")).toBe(false);
    expect(hasValidSession(`${COOKIE_NAME}=nonexistent`, "127.0.0.1")).toBe(false);
  });

  it("treats a malformed cookie escape as an unmatched value, not a crash", () => {
    expect(() => parseCookies(`${COOKIE_NAME}=%zz`)).not.toThrow();
    expect(parseCookies(`${COOKIE_NAME}=%zz`)[COOKIE_NAME]).toBe("%zz");
    expect(hasValidSession(`${COOKIE_NAME}=%zz`, "127.0.0.1")).toBe(false);
    expect(revokeSession(`${COOKIE_NAME}=%zz`)).toBe(false);
  });

  it("revokes every session a duplicated cookie presents", () => {
    const first = issueSession("127.0.0.1");
    const second = issueSession("127.0.0.1");
    const header = `${COOKIE_NAME}=${first}; ${COOKIE_NAME}=${second}`;
    // Two credentials are ambiguous, so neither one authenticates a request...
    expect(hasValidSession(header, "127.0.0.1")).toBe(false);
    // ...but logout still ends both, so it cannot report success while one survives.
    expect(revokeSession(header)).toBe(true);
    expect(hasValidSession(`${COOKIE_NAME}=${first}`, "127.0.0.1")).toBe(false);
    expect(hasValidSession(`${COOKIE_NAME}=${second}`, "127.0.0.1")).toBe(false);
  });

  it("parses cookies and bearer tokens", () => {
    expect(parseCookies(`a=1; ${COOKIE_NAME}=xyz; b=2`)[COOKIE_NAME]).toBe("xyz");
    expect(parseCookies(undefined)).toEqual({});
    expect(bearerOf("Bearer deadbeef")).toBe("deadbeef");
    expect(bearerOf("Basic deadbeef")).toBe("");
  });

  it("authenticates by cookie or by bearer token, and by nothing else", () => {
    const sid = issueSession("127.0.0.1");
    expect(isAuthenticated({ cookie: `${COOKIE_NAME}=${sid}` }, "127.0.0.1")).toBe(true);
    expect(isAuthenticated({ authorization: `Bearer ${ensureToken()}` }, "127.0.0.1")).toBe(true);
    expect(isAuthenticated({}, "127.0.0.1")).toBe(false);
    expect(isAuthenticated({ authorization: "Bearer wrong" }, "127.0.0.1")).toBe(false);
  });

  it("caps the session table", () => {
    for (let i = 0; i < 40; i += 1) issueSession("127.0.0.1");
    expect(sessionCount()).toBeLessThanOrEqual(32);
  });

  it("revokes the session itself, so a copied cookie stops authenticating", () => {
    const sid = issueSession("127.0.0.1");
    const header = `${COOKIE_NAME}=${sid}`;
    expect(hasValidSession(header, "127.0.0.1")).toBe(true);
    expect(revokeSession(header)).toBe(true);
    expect(hasValidSession(header, "127.0.0.1")).toBe(false);
    // A repeated logout is a successful no-op, not an error.
    expect(revokeSession(header)).toBe(false);
    expect(revokeSession(undefined)).toBe(false);
  });

  it("expires a session after the TTL even when its cookie is replayed", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
      const sid = issueSession("127.0.0.1");
      const header = `${COOKIE_NAME}=${sid}`;
      expect(hasValidSession(header, "127.0.0.1")).toBe(true);
      vi.setSystemTime(new Date("2026-11-10T08:00:01Z"));
      expect(hasValidSession(header, "127.0.0.1")).toBe(false);
      expect(sessionCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CSRF and cross-origin posture", () => {
  it("allows same-origin GET without any opt-in", () => {
    expect(isTrustedRequest("GET", { "sec-fetch-site": "same-origin" })).toBe(true);
    expect(isTrustedRequest("GET", {})).toBe(true);
  });

  it("denies a cross-site read", () => {
    expect(isTrustedRequest("GET", { "sec-fetch-site": "cross-site" })).toBe(false);
    expect(isTrustedRequest("GET", { origin: "https://evil.example" })).toBe(false);
  });

  it("denies a form post that omits the explicit opt-in header", () => {
    expect(isTrustedRequest("POST", { "sec-fetch-site": "same-origin" })).toBe(false);
    expect(isTrustedRequest("POST", { "sec-fetch-site": "same-origin", referer: "https://evil.example/x" })).toBe(false);
    expect(
      isTrustedRequest("POST", {
        "sec-fetch-site": "same-origin",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
        "x-conway-request": "1",
      }),
    ).toBe(true);
  });

  it("denies a same-tab navigation from a foreign origin even with the header", () => {
    expect(
      isTrustedRequest("POST", { origin: "https://evil.example", "x-conway-request": "1" }),
    ).toBe(false);
  });

  it("treats Origin: null as an opaque origin and never trusts it", () => {
    expect(isTrustedRequest("GET", { origin: "null" })).toBe(false);
    expect(
      isTrustedRequest("POST", {
        origin: "null",
        "sec-fetch-site": "same-origin",
        referer: `${ORIGIN}/`,
        "x-conway-request": "1",
      }),
    ).toBe(false);
  });

  it("accepts the console origin exactly and rejects malformed variants", () => {
    for (const origin of [`${ORIGIN}/`, "http://127.0.0.1:3001", "https://evil.example", "", "not a url"]) {
      expect(isTrustedRequest("GET", { origin }), origin).toBe(false);
    }
    expect(isTrustedRequest("GET", { origin: [ORIGIN] })).toBe(false);
    expect(isTrustedRequest("GET", { origin: ORIGIN })).toBe(true);
    expect(isTrustedOrigin(ORIGIN)).toBe(true);
    expect(isTrustedOrigin(`${ORIGIN}/`)).toBe(false);
    expect(isTrustedOrigin("null")).toBe(false);
  });

  it("refuses a state-changing request that omits Origin entirely", () => {
    expect(
      isTrustedRequest("POST", {
        "sec-fetch-site": "same-origin",
        referer: `${ORIGIN}/`,
        "x-conway-request": "1",
      }),
    ).toBe(false);
    expect(isTrustedRequest("DELETE", { "x-conway-request": "1" })).toBe(false);
  });

  it("compares the referer as an origin, not as a string prefix", () => {
    expect(
      isTrustedRequest("POST", {
        origin: ORIGIN,
        referer: `${ORIGIN}.evil.example/`,
        "x-conway-request": "1",
      }),
    ).toBe(false);
    // The same rejection must also come from the equality, not only from URL parsing: this
    // referer parses cleanly to a different origin.
    expect(
      isTrustedRequest("POST", {
        origin: ORIGIN,
        referer: "https://evil.example/x",
        "x-conway-request": "1",
      }),
    ).toBe(false);
    expect(
      isTrustedRequest("POST", { origin: ORIGIN, referer: `${ORIGIN}/`, "x-conway-request": "1" }),
    ).toBe(true);
  });

  it("refuses duplicated headers instead of trusting the first copy", () => {
    expect(
      isTrustedRequest("POST", {
        origin: [ORIGIN, ORIGIN],
        referer: `${ORIGIN}/`,
        "x-conway-request": "1",
      }),
    ).toBe(false);
    expect(
      isTrustedRequest("POST", {
        origin: ORIGIN,
        referer: [`${ORIGIN}/`],
        "x-conway-request": "1",
      }),
    ).toBe(false);
    expect(
      isTrustedRequest("GET", { "sec-fetch-site": ["same-origin"] }),
    ).toBe(false);
  });
});

describe("rate limiting", () => {
  beforeEach(() => resetAuthState());

  it("refuses a burst past the bucket capacity and recovers with time", () => {
    const start = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 60; i += 1) {
      if (rateLimit("127.0.0.1:read", start).allowed) allowed += 1;
    }
    expect(allowed).toBe(40);
    const afterMinute = rateLimit("127.0.0.1:read", start + 61_000);
    expect(afterMinute.allowed).toBe(true);
  });

  it("keeps action traffic separate from read traffic", () => {
    const start = 2_000_000;
    for (let i = 0; i < 45; i += 1) rateLimit("127.0.0.1:read", start);
    expect(rateLimit("127.0.0.1:read", start).allowed).toBe(false);
    expect(rateLimit("127.0.0.1:action", start).allowed).toBe(true);
  });
});
