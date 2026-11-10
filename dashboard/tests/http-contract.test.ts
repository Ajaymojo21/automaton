import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { apiGate, handleApi } from "../server/routes.js";
import { COOKIE_NAME, ensureToken, issueSession, resetAuthState } from "../server/security.js";
import { ORIGIN } from "../server/paths.js";

/** Mandate §25 at the HTTP boundary: what an unauthenticated caller, a cross-site page and a
 *  blind form post actually receive. */

function message(init: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  ip?: string;
}): IncomingMessage {
  const stream = init.body === undefined ? Readable.from([]) : Readable.from([Buffer.from(init.body, "utf-8")]);
  return Object.assign(stream, {
    method: init.method,
    url: init.path,
    headers: init.headers ?? {},
    socket: { remoteAddress: init.ip ?? "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

const sameOrigin = { "sec-fetch-site": "same-origin", origin: ORIGIN, referer: `${ORIGIN}/` };
const mutating = { ...sameOrigin, "x-conway-request": "1", "content-type": "application/json" };

function call(method: string, path: string, options: { headers?: Record<string, string>; body?: string; ip?: string } = {}) {
  return handleApi(method, new URL(path, ORIGIN), message({ method, path, ...options }));
}

describe("the auth wall", () => {
  beforeEach(() => resetAuthState());

  it("denies every data endpoint without a session", async () => {
    for (const path of ["/api/panels", "/api/panel/overview", "/api/system"]) {
      const result = await call("GET", path, { headers: sameOrigin });
      expect(result.status, path).toBe(401);
      expect((result.body as { message: string }).message).toBe("operator token required");
    }
  });

  it("answers liveness without a credential and without any Conway data", async () => {
    const result = await call("GET", "/api/health", { headers: sameOrigin });
    expect(result.status).toBe(200);
    const body = result.body as { verdict: string; pid: number };
    expect(body.verdict).toBe("VERIFIED");
    expect(typeof body.pid).toBe("number");
  });

  it("exchanges the operator token for a cookie, then serves the panels", async () => {
    const wrong = await call("POST", "/api/auth", { headers: mutating, body: JSON.stringify({ token: "nope" }) });
    expect(wrong.status).toBe(401);

    const good = await call("POST", "/api/auth", {
      headers: mutating,
      body: JSON.stringify({ token: ensureToken() }),
    });
    expect(good.status).toBe(200);
    const cookie = (good.headers ?? {})["set-cookie"] ?? "";
    expect(cookie).toContain(COOKIE_NAME);
    expect(cookie).toContain("HttpOnly");

    const panels = await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie: cookie.split(";")[0] ?? "" } });
    expect(panels.status).toBe(200);
    expect((panels.body as { panels: unknown[] }).panels).toHaveLength(13);
  });

  it("refuses a bearer token that is not the operator token", async () => {
    const result = await call("GET", "/api/panels", {
      headers: { ...sameOrigin, authorization: "Bearer definitely-wrong" },
    });
    expect(result.status).toBe(401);
  });

  it("serves a session issued for one peer to that peer only", async () => {
    const sid = issueSession("127.0.0.5");
    const header = { ...sameOrigin, cookie: `${COOKIE_NAME}=${sid}` };
    expect((await call("GET", "/api/panels", { headers: header, ip: "127.0.0.5" })).status).toBe(200);
    expect((await call("GET", "/api/panels", { headers: header, ip: "127.0.0.6" })).status).toBe(401);
  });

  it("answers the pre-auth session probe with nothing beyond the caller's auth state", async () => {
    const anonymous = await call("GET", "/api/session", { headers: sameOrigin });
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ ok: true, authenticated: false });
    expect(Object.keys(anonymous.body as object).sort()).toEqual(["authenticated", "ok"]);
    expect(JSON.stringify(anonymous.body).toLowerCase()).not.toContain("token");

    const sid = issueSession("127.0.0.1");
    const authenticated = await call("GET", "/api/session", {
      headers: { ...sameOrigin, cookie: `${COOKIE_NAME}=${sid}` },
    });
    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toEqual({ ok: true, authenticated: true });
  });

  it("ends the session server-side, so a copied cookie stops working", async () => {
    const sid = issueSession("127.0.0.1");
    const cookie = `${COOKIE_NAME}=${sid}`;
    expect((await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie } })).status).toBe(200);

    const out = await call("POST", "/api/logout", { headers: { ...mutating, cookie } });
    expect(out.status).toBe(200);
    expect((out.headers ?? {})["set-cookie"]).toContain("Max-Age=0");

    expect((await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie } })).status).toBe(401);
    // Replaying the request that ended the session, or logging out without one, is a safe no-op.
    expect((await call("POST", "/api/logout", { headers: { ...mutating, cookie } })).status).toBe(200);
    expect((await call("POST", "/api/logout", { headers: mutating })).status).toBe(200);
  });

  it("refuses a null-origin logout and leaves the live session untouched", async () => {
    const sid = issueSession("127.0.0.1");
    const cookie = `${COOKIE_NAME}=${sid}`;
    const blocked = await call("POST", "/api/logout", { headers: { ...mutating, cookie, origin: "null" } });
    expect(blocked.status).toBe(403);
    expect((await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie } })).status).toBe(200);
  });

  it("survives a malformed cookie and still ends the valid session beside it", async () => {
    const sid = issueSession("127.0.0.1");
    const good = `${COOKIE_NAME}=${sid}`;
    const out = await call("POST", "/api/logout", {
      headers: { ...mutating, cookie: `${COOKIE_NAME}=%zz; ${good}` },
    });
    expect(out.status).toBe(200);
    expect((await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie: good } })).status).toBe(401);
  });
});

describe("request hardening", () => {
  beforeEach(() => resetAuthState());

  it("refuses a cross-site read before touching Conway", async () => {
    const result = await call("GET", "/api/panels", { headers: { "sec-fetch-site": "cross-site" } });
    expect(result.status).toBe(403);
    expect((result.body as { message: string }).message).toBe("cross-origin request refused");
  });

  it("refuses a null or malformed origin even on an authenticated read", async () => {
    const sid = issueSession("127.0.0.1");
    const cookie = `${COOKIE_NAME}=${sid}`;
    for (const origin of ["null", `${ORIGIN}/`, "http://127.0.0.1:3001", "https://evil.example"]) {
      const result = await call("GET", "/api/panels", {
        headers: { cookie, origin, "sec-fetch-site": "same-origin" },
      });
      expect(result.status, origin).toBe(403);
    }
    expect((await call("GET", "/api/panels", { headers: { ...sameOrigin, cookie } })).status).toBe(200);
  });

  it("refuses a state-changing request that omits Origin, and accepts one that names it", async () => {
    const sid = issueSession("127.0.0.1");
    const cookie = `${COOKIE_NAME}=${sid}`;
    const withoutOrigin: Record<string, string> = { ...mutating };
    delete withoutOrigin.origin;
    expect((await call("POST", "/api/logout", { headers: { ...withoutOrigin, cookie } })).status).toBe(403);
    expect((await call("POST", "/api/logout", { headers: { ...mutating, cookie } })).status).toBe(200);
  });

  it("refuses a blind form post with no opt-in header", async () => {
    const result = await call("POST", "/api/action/health-check", {
      headers: { ...sameOrigin, "content-type": "application/json" },
      body: "{}",
    });
    expect(result.status).toBe(403);
  });

  it("does not echo the stack or an internal path from an unknown route", async () => {
    const sid = issueSession("127.0.0.1");
    const result = await call("GET", "/api/not-a-route", {
      headers: { ...sameOrigin, cookie: `${COOKIE_NAME}=${sid}` },
    });
    expect(result.status).toBe(404);
    const text = JSON.stringify(result.body).toLowerCase();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("conway-automaton");
  });

  it("rejects a malformed JSON body with 400, not a crash", async () => {
    const result = await call("POST", "/api/auth", { headers: mutating, body: "{not json" });
    expect(result.status).toBe(400);
    expect((result.body as { message: string }).message).toBe("malformed JSON body");
  });

  it("rejects a non-JSON content type", async () => {
    const result = await call("POST", "/api/auth", { headers: { ...sameOrigin, "x-conway-request": "1" }, body: "token=abc" });
    expect(result.status).toBe(415);
  });

  it("applies the same origin and rate-limit gates to the stream handshake", () => {
    const hostile = message({
      method: "GET",
      path: "/api/stream",
      headers: { origin: "null", "sec-fetch-site": "same-origin" },
    });
    expect(apiGate("GET", "/api/stream", hostile)?.status).toBe(403);

    let status = 200;
    for (let i = 0; i < 45; i += 1) {
      const req = message({ method: "GET", path: "/api/stream", headers: sameOrigin, ip: "127.0.0.7" });
      status = apiGate("GET", "/api/stream", req)?.status ?? 200;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });

  it("rate limits a flooding client and tells it when to come back", async () => {
    const sid = issueSession("127.0.0.9");
    let last: { status: number; headers?: Record<string, string> } = { status: 0 };
    // /api/session shares the per-ip read bucket and answers without reading Conway state,
    // so the flood exercises the limiter rather than the database.
    for (let i = 0; i < 45; i += 1) {
      last = await call("GET", "/api/session", { headers: { ...sameOrigin, cookie: `${COOKIE_NAME}=${sid}` }, ip: "127.0.0.9" });
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(Number((last.headers ?? {})["retry-after"])).toBeGreaterThan(0);
  });
});

describe("the restore endpoint", () => {
  beforeEach(() => resetAuthState());

  async function postRestore(body: unknown) {
    const sid = issueSession("127.0.0.1");
    return call("POST", "/api/action/restore", {
      headers: { ...mutating, cookie: `${COOKIE_NAME}=${sid}` },
      body: JSON.stringify(body),
    });
  }

  it("refuses traversal and an untyped confirmation", async () => {
    const traversal = await postRestore({ name: "../../runtime/home", confirm: "../../runtime/home" });
    expect(traversal.status).toBe(400);
    const unconfirmed = await postRestore({ name: "2026-11-01_08-24-20", confirm: "" });
    expect(unconfirmed.status).toBe(400);
    expect((unconfirmed.body as { message: string }).message).toContain("confirmation");
  });

  it("plans without copying, and never names the live state directory as a target", async () => {
    const planned = await postRestore({ name: "2026-11-01_08-24-20", confirm: "2026-11-01_08-24-20" });
    expect(planned.status).toBe(200);
    const body = planned.body as { stage: string; plan: { target: string; files: string[]; sourceDir?: string } };
    expect(body.stage).toBe("plan");
    expect(body.plan.target.toLowerCase()).not.toContain(path.join("runtime", "home").toLowerCase());
    expect(body.plan.files.length).toBeGreaterThan(0);
    // Pinned because the client renders these fields directly: `files` is a path list, not a count.
    expect(typeof body.plan.files[0]).toBe("string");
    expect(body.plan.sourceDir).toBeTruthy();
  });

  it("executes the plan that was confirmed, to the path that was shown", async () => {
    const name = "2026-11-01_08-24-20";
    const planned = await postRestore({ name, confirm: name });
    const target = (planned.body as { plan: { target: string } }).plan.target;
    const executed = await postRestore({ name, confirm: name, execute: true });
    try {
      expect(executed.status, JSON.stringify(executed.body)).toBe(200);
      const body = executed.body as { ok: boolean; data?: { target?: string } };
      expect(body.ok).toBe(true);
      expect(body.data?.target).toBe(target);
      expect(fs.existsSync(path.join(target, "RESTORE-NOTE.txt"))).toBe(true);
      const repeat = await postRestore({ name, confirm: name, execute: true });
      expect(repeat.status).toBe(400);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
