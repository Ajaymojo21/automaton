import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ServerResponse } from "node:http";
import { COOKIE_NAME, issueSession, resetAuthState, revokeSession } from "../server/security.js";
import { addClient, clientCount, stopStream } from "../server/stream.js";

/** The stream used to authenticate once at connect and never again, so a revoked session kept
 *  receiving snapshots until the process ended. These tests hold it to the same lifetime. */

type FakeRes = ServerResponse & { end: ReturnType<typeof vi.fn> };

function fakeRes(): FakeRes {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as FakeRes;
}

describe("event stream follows session revocation", () => {
  beforeEach(() => resetAuthState());
  afterEach(() => stopStream());

  it("closes the stream a session opened when that session is revoked", () => {
    const sid = issueSession("127.0.0.1");
    const res = fakeRes();
    addClient(res, "127.0.0.1", sid);
    expect(clientCount()).toBe(1);

    expect(revokeSession(`${COOKIE_NAME}=${sid}`)).toBe(true);
    expect(res.end).toHaveBeenCalled();
    expect(clientCount()).toBe(0);
  });

  it("leaves a bearer-token stream attached, because it has no session to revoke", () => {
    const res = fakeRes();
    addClient(res, "127.0.0.1", null);
    const sid = issueSession("127.0.0.1");

    revokeSession(`${COOKIE_NAME}=${sid}`);
    expect(res.end).not.toHaveBeenCalled();
    expect(clientCount()).toBe(1);
  });

  it("closes only the revoked session's stream", () => {
    const mine = issueSession("127.0.0.1");
    const other = issueSession("127.0.0.1");
    const mineRes = fakeRes();
    const otherRes = fakeRes();
    addClient(mineRes, "127.0.0.1", mine);
    addClient(otherRes, "127.0.0.1", other);

    revokeSession(`${COOKIE_NAME}=${mine}`);
    expect(mineRes.end).toHaveBeenCalled();
    expect(otherRes.end).not.toHaveBeenCalled();
    expect(clientCount()).toBe(1);
  });
});
