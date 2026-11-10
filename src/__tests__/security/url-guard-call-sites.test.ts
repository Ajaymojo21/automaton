/**
 * B-9: the guard is only real if the code that performs the network call asks it first.
 *
 * These tests exercise the production entry points, not the guard module in isolation,
 * and assert that a hostile URL is refused *before* the transport is touched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createConwayClient } from "../../conway/client.js";
import { ResilientHttpClient } from "../../conway/http-client.js";
import { discoverOllamaModels } from "../../ollama/discover.js";
import { fetchAgentCard } from "../../registry/discovery.js";

const stubDb = () => {
  const runs: unknown[][] = [];
  const db = {
    prepare: () => ({
      get: () => undefined,
      run: (...args: unknown[]) => {
        runs.push(args);
        return { changes: 1 };
      },
    }),
  };
  return { db: db as never, runs };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Conway API client (src/conway/client.ts)", () => {
  it("refuses a plain-HTTP non-loopback API URL before it builds a client", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(() =>
      createConwayClient({ apiUrl: "http://api.example.com", apiKey: "test-key-not-real", sandboxId: "sb" }),
    ).toThrow(/URL guard: NON_LOOPBACK_HTTP/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an HTTPS IP-literal API URL, private or not", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(() =>
      createConwayClient({ apiUrl: "https://10.0.0.5/v1", apiKey: "test-key-not-real", sandboxId: "sb" }),
    ).toThrow(/URL guard: HTTPS_IP_LITERAL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Resilient HTTP client (src/conway/http-client.ts)", () => {
  it("refuses a cloud-metadata address before the transport is called", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ResilientHttpClient();
    await expect(client.request("https://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /URL rejected by security guard \(BLOCKED_ADDRESS_RANGE\)/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses embedded credentials in a request URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ResilientHttpClient();
    await expect(client.request("https://user:pass@api.example.com/v1")).rejects.toThrow(
      /URL rejected by security guard \(USERINFO\)/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("agent-card discovery (src/registry/discovery.ts)", () => {
  it("blocks an IPv6 link-local card URI before fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchAgentCard("https://[fe80::1]/card.json")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks an IPv4-mapped private address the legacy regex does not name", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchAgentCard("https://[::ffff:10.0.0.5]/card.json")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks credentials embedded in a card URI", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchAgentCard("https://user:pass@example.com/card.json")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Ollama discovery (src/ollama/discover.ts)", () => {
  it("refuses a plain-HTTP LAN endpoint and performs no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { db, runs } = stubDb();

    await expect(discoverOllamaModels("http://10.0.0.5:11434", db)).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it("refuses an HTTPS private endpoint and performs no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { db, runs } = stubDb();

    await expect(discoverOllamaModels("https://10.0.0.5:11434", db)).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it("still reaches a legitimate loopback Ollama, with redirects disabled", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3:8b", model: "llama3:8b", modified_at: "2026-01-01T00:00:00Z", size: 1 }],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const { db, runs } = stubDb();

    await expect(discoverOllamaModels("http://127.0.0.1:11434", db)).resolves.toEqual(["llama3:8b"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/tags");
    expect(init.redirect).toBe("error");
    expect(runs.length).toBe(1);
  });
});
