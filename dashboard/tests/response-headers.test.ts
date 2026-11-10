import { describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { BASE_HEADERS, CSP, sendJson, serveStatic } from "../server/http.js";

/**
 * The security headers are only real if every response carries them. `sendJson` set them first and
 * the static paths did not, so a page could be served without the CSP that the JSON API relies on.
 */

type Captured = { status?: number; headers?: Record<string, string> };

function fakeResponse(capture: Captured): ServerResponse {
  const res = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string>) {
      capture.status = status;
      capture.headers = headers;
      return res;
    },
    end() {
      res.headersSent = true;
    },
    write() {
      return true;
    },
    on() {},
    once() {},
    destroy() {},
  };
  return res as unknown as ServerResponse;
}

const REQUIRED = ["x-content-type-options", "referrer-policy", "content-security-policy"];

describe("every response carries the console's security headers", () => {
  it("names the three headers the mandate requires", () => {
    expect(BASE_HEADERS["content-security-policy"]).toBe(CSP);
    expect(BASE_HEADERS["x-content-type-options"]).toBe("nosniff");
    expect(BASE_HEADERS["referrer-policy"]).toBe("no-referrer");
  });

  it("applies them to a JSON response", () => {
    const captured: Captured = {};
    sendJson(fakeResponse(captured), 200, { ok: true });
    for (const header of REQUIRED) {
      expect(captured.headers?.[header], header).toBeTruthy();
    }
  });

  it("applies them to the plain-text refusal for a path that escapes the bundle", () => {
    const captured: Captured = {};
    const served = serveStatic(fakeResponse(captured), "/../../runtime/home/.automaton/automaton.json");
    expect(served).toBe(true);
    expect(captured.status).toBe(400);
    for (const header of REQUIRED) {
      expect(captured.headers?.[header], header).toBeTruthy();
    }
  });

  it("lets a caller add headers without dropping the baseline", () => {
    const captured: Captured = {};
    sendJson(fakeResponse(captured), 200, { ok: true }, { "retry-after": "30" });
    expect(captured.headers?.["retry-after"]).toBe("30");
    expect(captured.headers?.["content-security-policy"]).toBe(CSP);
  });
});
