/**
 * Phase 20 P-6 — provider base-URL validation, shipped.
 *
 * Migrated from runtime/tmp/p20-p6-red.test.ts (the 22 test-first cases written while P-6 was
 * still unapproved) and expanded with the transport guard: the redirect constraint, the
 * off-site request checks, and the DNS-resolution check that §5.2 requires.
 *
 * The assertions state the required end state, not an implementation detail: a provider whose
 * base URL fails validation must not be admitted at all (fail closed), so it can never become a
 * candidate and never reaches buildResolvedModel().
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { openAiCtor, dnsLookup } = vi.hoisted(() => ({
  openAiCtor: vi.fn().mockImplementation(function MockOpenAI(this: Record<string, unknown>, options: unknown) {
    this.options = options;
    this.chat = { completions: { create: vi.fn() } };
  }),
  dnsLookup: vi.fn(),
}));

vi.mock("openai", () => ({ default: openAiCtor }));
vi.mock("node:dns/promises", () => ({ default: { lookup: dnsLookup } }));

import { ProviderRegistry } from "../../inference/provider-registry.js";
import {
  ProviderUrlError,
  validateProviderBaseUrl,
} from "../../inference/provider-url.js";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../../../config/inference-providers.template.json", import.meta.url),
);
const ORIGINAL_ENV = { ...process.env };
const tmpDirs: string[] = [];

function configFor(baseUrl: unknown, id = "probe"): string {
  const payload = {
    providers: [
      {
        id,
        name: id,
        baseUrl,
        apiKeyEnvVar: "PROBE_API_KEY",
        models: [{ id: "m-fast", tier: "fast", contextWindow: 128000, maxOutputTokens: 1024 }],
        priority: 1,
        enabled: true,
      },
    ],
    tierDefaults: { fast: { preferredProvider: id, fallbackOrder: [] } },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p20-p6-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "providers.json");
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  return file;
}

function configForMany(providers: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p20-p6-many-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "providers.json");
  fs.writeFileSync(file, JSON.stringify({ providers }), "utf8");
  return file;
}

function load(baseUrl: unknown, id?: string): ProviderRegistry {
  return ProviderRegistry.fromConfig(configFor(baseUrl, id));
}

function admitted(registry: ProviderRegistry, id = "probe"): boolean {
  return registry.getProviders().some((provider) => provider.id === id);
}

function resolvedBaseUrl(registry: ProviderRegistry, id = "probe"): string | undefined {
  const entry = registry.resolveCandidates("fast").find((c) => c.provider.id === id);
  if (!entry) {
    return undefined;
  }
  return (entry.client as unknown as { options?: { baseURL?: string } }).options?.baseURL;
}

function guardOf(registry: ProviderRegistry, id = "probe"): typeof fetch {
  const entry = registry.resolveCandidates("fast").find((c) => c.provider.id === id);
  if (!entry) {
    throw new Error(`provider '${id}' produced no candidate`);
  }
  const fetchOption = (entry.client as unknown as { options?: { fetch?: unknown } }).options?.fetch;
  if (typeof fetchOption !== "function") {
    throw new Error("resolved client carries no guard fetch");
  }
  return fetchOption as typeof fetch;
}

function providerEntry(id: string, baseUrl: unknown): Record<string, unknown> {
  return {
    id,
    name: id,
    baseUrl,
    apiKeyEnvVar: "PROBE_API_KEY",
    models: [{ id: "m-fast", tier: "fast", contextWindow: 128000, maxOutputTokens: 1024 }],
    priority: 1,
    enabled: true,
  };
}

beforeEach(() => {
  openAiCtor.mockClear();
  dnsLookup.mockReset();
  dnsLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AUTOMATON_CREDITS_BALANCE;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.FREELLMAPI_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("P-6 obligations 1-4: what must still be accepted", () => {
  it("1. a valid HTTPS provider is accepted", () => {
    const registry = load("https://api.example.com/v1");
    expect(admitted(registry)).toBe(true);
    expect(resolvedBaseUrl(registry)).toBe("https://api.example.com/v1");
  });

  it("2. http://localhost is accepted", () => {
    const registry = load("http://localhost:3001/v1");
    expect(admitted(registry)).toBe(true);
    expect(resolvedBaseUrl(registry)).toBe("http://localhost:3001/v1");
  });

  it("3. http://127.0.0.1 is accepted", () => {
    const registry = load("http://127.0.0.1:3001/v1");
    expect(admitted(registry)).toBe(true);
    expect(resolvedBaseUrl(registry)).toBe("http://127.0.0.1:3001/v1");
  });

  it("4. IPv6 loopback http://[::1] is accepted", () => {
    const registry = load("http://[::1]:3001/v1");
    expect(admitted(registry)).toBe(true);
    expect(resolvedBaseUrl(registry)).toBe("http://[::1]:3001/v1");
  });

  it("4b. host casing is normalised, not treated as a different host", () => {
    const registry = load("http://LOCALHOST:3001/v1");
    expect(admitted(registry)).toBe(true);
    expect(resolvedBaseUrl(registry)).toBe("http://localhost:3001/v1");
  });
});

describe("P-6 obligations 5-13: hostile URLs must fail closed", () => {
  it("5. a public HTTP endpoint is rejected", () => {
    expect(admitted(load("http://203.0.113.10/v1"))).toBe(false);
  });

  it("6. a LAN HTTP endpoint is rejected", () => {
    expect(admitted(load("http://192.168.1.10:3001/v1"))).toBe(false);
  });

  it("7. non-loopback private HTTP endpoints are rejected", () => {
    expect(admitted(load("http://10.0.0.5/v1"))).toBe(false);
    expect(admitted(load("http://172.16.3.4:3001/v1"))).toBe(false);
    expect(admitted(load("http://169.254.169.254/latest/meta-data"))).toBe(false);
  });

  it("8. an arbitrary hostname over HTTP is rejected", () => {
    expect(admitted(load("http://evil.example/v1"))).toBe(false);
    expect(admitted(load("http://inference.internal:3001/v1"))).toBe(false);
  });

  it("9. unsupported schemes are rejected", () => {
    for (const url of [
      "file:///etc/passwd",
      "file:///C:/Windows/system32",
      "data:text/plain;base64,SGVsbG8=",
      "gopher://127.0.0.1:70/v1",
      "javascript:alert(1)",
      "ftp://localhost:21/v1",
      "ws://localhost:3001/v1",
    ]) {
      expect(admitted(load(url)), url).toBe(false);
    }
  });

  it("10. embedded userinfo credentials are rejected", () => {
    expect(admitted(load("http://user:password@localhost:3001/v1"))).toBe(false);
    expect(admitted(load("https://user:password@api.openai.com/v1"))).toBe(false);
    expect(admitted(load("http://token@127.0.0.1:3001/v1"))).toBe(false);
  });

  it("11. malformed URLs and invalid ports are rejected", () => {
    for (const url of [
      "not a url",
      "http://",
      "http://localhost:0/v1",
      "http://localhost:99999999/v1",
      "http://localhost:notaport/v1",
      "//localhost:3001/v1",
      "localhost:3001/v1",
    ]) {
      expect(admitted(load(url)), String(url)).toBe(false);
    }
  });

  it("12. hostname spoofing is rejected", () => {
    // A host is not loopback because its text contains "localhost".
    expect(admitted(load("http://localhost.evil.example/v1"))).toBe(false);
    expect(admitted(load("http://notlocalhost:3001/v1"))).toBe(false);
    expect(admitted(load("http://localhost@evil.example/v1"))).toBe(false);
    expect(admitted(load("http://evil.example/?x=localhost"))).toBe(false);
    expect(admitted(load("http://evil.example/#localhost"))).toBe(false);
    expect(admitted(load("http://xlocalhost:3001/v1"))).toBe(false);
  });

  it("12b. a fragment on an otherwise valid loopback URL is rejected", () => {
    expect(admitted(load("http://localhost:3001/v1#fragment"))).toBe(false);
  });

  it("13. alternative numeric IP representations are handled safely", () => {
    // None of these spellings is a literal in the approved allowlist
    // (localhost / 127.0.0.1 / ::1). Accepting them means trusting the platform resolver to
    // canonicalise 0x7f000001 -> 127.0.0.1, which the WHATWG parser indeed does — see
    // runtime/tmp/p20c-url-parse-probe.log — so the validator compares the written host with
    // the parsed host instead of trusting either one alone.
    for (const url of [
      "http://0x7f000001:3001/v1",
      "http://0177.0.0.1:3001/v1",
      "http://2130706433:3001/v1",
      "http://127.1:3001/v1",
      "http://0.0.0.0:3001/v1",
      "http://[::ffff:127.0.0.1]:3001/v1",
      "http://[0:0:0:0:0:ffff:7f00:1]:3001/v1",
      "http://127.0.0.1.:3001/v1",
    ]) {
      expect(admitted(load(url)), url).toBe(false);
    }
  });
});

describe("P-6 obligations 14-18: transport, compatibility and fail-closed defaults", () => {
  it("14. the client built for a loopback provider constrains redirects", () => {
    // A URL that is loopback at construction time says nothing about the next hop.
    // runtime/tmp/p20-redirect.log proved by experiment that plain fetch AND the OpenAI SDK
    // both follow a 127.0.0.1 -> 127.0.0.1 cross-port redirect. The registry must pass a
    // mitigation down; today it passes a guard fetch.
    const registry = load("http://localhost:3001/v1");
    const entry = registry.resolveCandidates("fast")[0];
    const options = (entry.client as unknown as {
      options?: { fetch?: unknown; redirect?: string };
    }).options;

    const guarded = typeof options?.fetch === "function" || options?.redirect === "error";
    expect(guarded, "resolved client must carry a redirect constraint").toBe(true);
  });

  it("14b. overrideBaseUrl rejects a non-loopback HTTP destination and keeps the previous value", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    const before = registry.getProviders().find((p) => p.id === "openai")?.baseUrl;
    expect(() => registry.overrideBaseUrl("openai", "http://evil.example/v1")).toThrow(ProviderUrlError);
    expect(registry.getProviders().find((p) => p.id === "openai")?.baseUrl).toBe(before);
  });

  it("14c. overrideBaseUrl still accepts the legitimate loopback Conway endpoint", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    registry.overrideBaseUrl("openai", "http://127.0.0.1:3001/v1");
    expect(registry.getProviders().find((p) => p.id === "openai")?.baseUrl).toBe(
      "http://127.0.0.1:3001/v1",
    );
  });

  it("14d. overrideBaseUrl accepts the shipped public HTTPS endpoint and normalises it", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    registry.overrideBaseUrl("openai", "https://API.Conway.tech/v1");
    expect(registry.getProviders().find((p) => p.id === "openai")?.baseUrl).toBe(
      "https://api.conway.tech/v1",
    );
  });

  it("15. every provider in the shipped template still resolves", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    const ids = registry.getProviders().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["freellmapi", "openai", "groq", "together", "local"]));
    expect(ids).toHaveLength(5);
    for (const tier of ["reasoning", "fast", "cheap"] as const) {
      expect(registry.resolveCandidates(tier).length, `tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("16. FreeLLMAPI remains resolvable at localhost:3001", () => {
    const entry = ProviderRegistry.fromConfig(TEMPLATE_PATH)
      .resolveCandidates("fast")
      .find((c) => c.provider.id === "freellmapi");
    expect(entry).toBeDefined();
    expect((entry!.client as unknown as { options: { baseURL: string } }).options.baseURL).toBe(
      "http://localhost:3001/v1",
    );
  });

  it("17. provider resolution opens no network connection", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("resolution must not perform network I/O");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    for (const tier of ["reasoning", "fast", "cheap"] as const) {
      registry.resolveCandidates(tier);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("18. an invalid configuration fails closed instead of silently re-pointing at a cloud provider", () => {
    // normalizeProviders() used to substitute https://api.openai.com/v1 for an empty baseUrl, so
    // a truncated local config sent prompts and the credential to OpenAI without any error.
    // Failing closed means the provider is not admitted.
    expect(admitted(load(""))).toBe(false);
    expect(admitted(load(undefined))).toBe(false);
    expect(admitted(load(null))).toBe(false);
    expect(admitted(load("   "))).toBe(false);
    expect(admitted(load("http://localhost:3001/v1\t"))).toBe(false);
  });
});

describe("P-6 expansion: the guard fetch enforces the endpoint and the redirect policy", () => {
  it("19. a request to the provider endpoint is sent with redirect disabled", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("http://127.0.0.1:3001/v1"));

    await guard("http://127.0.0.1:3001/v1/chat/completions", { method: "POST" });

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3001/v1/chat/completions");
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });

  it("20. a redirect destination on a different host never reaches the transport", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("http://127.0.0.1:3001/v1"));

    await expect(guard("http://evil.example/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("21. a loopback cross-port hop never reaches the transport", async () => {
    // runtime/tmp/p20-redirect.log: 127.0.0.1:3001 -> 127.0.0.1:9999 was followed by plain fetch.
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("http://127.0.0.1:3001/v1"));

    await expect(guard("http://127.0.0.1:9999/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("22. an HTTPS provider keeps its TLS and rejects a downgrade hop", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("https://api.example.com/v1"));

    await guard("https://api.example.com/v1/chat/completions");
    expect(transport).toHaveBeenCalledTimes(1);

    await expect(guard("http://api.example.com/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("23. a hostname that resolves to a non-loopback address is refused for HTTP", async () => {
    // DNS-rebinding posture: the literal is loopback-shaped but the name resolves off-box.
    dnsLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("http://localhost:3001/v1"));

    await expect(guard("http://localhost:3001/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("24. a hostname that resolves to a link-local address is refused for HTTPS", async () => {
    dnsLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("https://metadata.example/v1"));

    await expect(guard("https://metadata.example/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("25. a hostname that no longer resolves is refused instead of failing open", async () => {
    dnsLookup.mockRejectedValue(new Error("ENOTFOUND"));
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("https://gone.example/v1"));

    await expect(guard("https://gone.example/v1/chat/completions")).rejects.toThrow(ProviderUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("26. an IP-literal endpoint needs no resolution and is sent as written", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const guard = guardOf(load("http://[::1]:3001/v1"));

    await guard("http://[::1]:3001/v1/chat/completions");

    expect(dnsLookup).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("P-6 expansion: validator unit surface", () => {
  const accepted = [
    "https://api.openai.com/v1",
    "https://api.groq.com/openai/v1",
    "https://api.together.xyz/v1",
    "http://localhost:11434/v1",
    "http://localhost:3001/v1",
    "http://127.0.0.1:3001/v1",
    "http://[::1]:3001/v1",
    "https://gateway.example",
  ];

  const rejected = [
    "",
    "   ",
    "  https://api.example.com/v1",
    "https://api.example.com/v1 ",
    "\thttp://localhost:3001/v1",
    "http://localhost:3001/v1\n",
    "http://localhost:3001/v1 ",
    "https://api.example.com/v1?token=secret",
    "https://api.example.com/v1#frag",
    "https://user:pass@api.example.com/v1",
    "http://localhost:3001:443/v1",
    "https://0x7f000001/v1",
    "https://2130706433/v1",
    "https://api.example.com./v1",
    "https://100.64.0.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://[fe80::1]/v1",
    "https://[ff00::1]/v1",
    "https://[::]/v1",
    "http://100.64.0.1/v1",
  ];

  it("27. every approved endpoint validates and normalises", () => {
    for (const url of accepted) {
      expect(validateProviderBaseUrl(url, "probe"), url).toBe(new URL(url).href);
    }
  });

  it("28. every hostile or ambiguous endpoint throws with a reason code", () => {
    for (const url of rejected) {
      expect(() => validateProviderBaseUrl(url, "probe"), JSON.stringify(url)).toThrow(ProviderUrlError);
    }
  });

  it("29. a rejected error names the provider and the reason, never the raw input", () => {
    const secret = "http://user:hunter2@localhost:3001/v1";
    let caught: unknown;
    try {
      validateProviderBaseUrl(secret, "probe");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderUrlError);
    expect((caught as ProviderUrlError).reason).toBe("USERINFO");
    expect((caught as Error).message).toContain("probe");
    expect((caught as Error).message).toContain("username");
    expect((caught as Error).message).not.toContain("hunter2");
    expect((caught as Error).message).not.toContain("user:");
  });

  it("30. non-string configuration fails closed", () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], ["http://localhost:3001/v1"]]) {
      expect(() => validateProviderBaseUrl(value, "probe"), JSON.stringify(value)).toThrow(ProviderUrlError);
    }
  });

  it("31. IPv4-mapped and compressed IPv6 spellings of loopback are refused", () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]:3001/v1",
      "http://[0:0:0:0:0:ffff:7f00:1]:3001/v1",
      "http://[::ffff:0:7f00:1]:3001/v1",
      "http://[0000:0000:0000:0000:0000:0000:0000:0001]:3001/v1",
    ]) {
      expect(() => validateProviderBaseUrl(url, "probe"), url).toThrow(ProviderUrlError);
    }
  });

  it("32. any IPv6 spelling other than the [::1] literal is refused, including a long-form loopback", () => {
    // Deliberate strictness: the allowlist is the three literals localhost / 127.0.0.1 / [::1].
    // Accepting a parser-canonicalised equivalent would mean trusting the parser to decide which
    // hosts are loopback, which is exactly the bypass class runtime/tmp/p20c-url-parse-probe.log
    // documents (0x7f000001 -> 127.0.0.1).
    expect(() => validateProviderBaseUrl("http://[0:0:0:0:0:0:0:1]:3001/v1", "probe")).toThrow(
      ProviderUrlError,
    );
    expect(validateProviderBaseUrl("http://[::1]:3001/v1", "probe")).toBe("http://[::1]:3001/v1");
  });
});

describe("P-6 expansion: partial configuration failure stays partial", () => {
  it("33. one bad provider does not pull in the shipped cloud defaults", () => {
    const registry = ProviderRegistry.fromConfig(
      configForMany([providerEntry("gateway", "http://localhost:3001/v1"), providerEntry("evil", "http://evil.example/v1")]),
    );
    const ids = registry.getProviders().map((p) => p.id);
    expect(ids).toEqual(["gateway"]);
  });

  it("34. an unknown provider with no baseUrl is refused, not sent to OpenAI", () => {
    const registry = ProviderRegistry.fromConfig(configForMany([providerEntry("mystery", undefined)]));
    expect(registry.getProviders().map((p) => p.id)).toEqual([]);
  });

  it("35. a duplicate provider id is refused rather than shadowing the admitted endpoint", () => {
    const registry = ProviderRegistry.fromConfig(
      configForMany([
        providerEntry("gateway", "http://localhost:3001/v1"),
        providerEntry("gateway", "https://api.openai.com/v1"),
      ]),
    );
    const ids = registry.getProviders().map((p) => p.id);
    expect(ids).toEqual(["gateway"]);
    expect(resolvedBaseUrl(registry, "gateway")).toBe("http://localhost:3001/v1");
  });

  it("36. a known provider may omit baseUrl and inherit its shipped endpoint", () => {
    const registry = ProviderRegistry.fromConfig(configForMany([providerEntry("groq", undefined)]));
    expect(registry.getProviders().map((p) => p.id)).toEqual(["groq"]);
    expect(resolvedBaseUrl(registry, "groq")).toBe("https://api.groq.com/openai/v1");
  });
});

describe("P-6 §8 configuration surface", () => {
  function configPathFor(text: string, prefix = "p20-cfg-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    const file = path.join(dir, "providers.json");
    fs.writeFileSync(file, text, "utf8");
    return file;
  }

  it("37. a missing config file still yields the shipped, validated defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p20-missing-"));
    tmpDirs.push(dir);
    const registry = ProviderRegistry.fromConfig(path.join(dir, "absent.json"));
    expect(registry.getProviders().map((p) => p.id)).toEqual(["openai", "groq", "together", "local"]);
    for (const provider of registry.getProviders()) {
      expect(validateProviderBaseUrl(provider.baseUrl, provider.id)).toBe(provider.baseUrl);
    }
  });

  it("38. malformed JSON keeps the defaults (unchanged posture, pinned as a decision)", () => {
    // F-20-04: this swallow-to-defaults path is deliberately NOT changed by P-6 — the defaults it
    // falls back to are themselves URL-validated (case 37), so no invalid endpoint can be
    // reached through it. Reported separately in
    // reports/FINAL_FREELLMAPI_P6_REMEDIATION.md.
    const registry = ProviderRegistry.fromConfig(configPathFor("{ not json"));
    expect(registry.getProviders().length).toBe(4);
    expect(registry.resolveModel("reasoning").provider.id).toBe("openai");
  });

  it("39. a non-array providers payload is ignored, keeping the defaults", () => {
    const registry = ProviderRegistry.fromConfig(configPathFor(JSON.stringify({ providers: { broken: true } })));
    expect(registry.getProviders().length).toBe(4);
  });

  it("40. an explicitly empty provider list is honoured instead of reviving cloud defaults", () => {
    const registry = ProviderRegistry.fromConfig(configPathFor(JSON.stringify({ providers: [] })));
    expect(registry.getProviders()).toEqual([]);
    expect(() => registry.resolveModel("fast")).toThrow(/No provider\/model available for tier 'fast'/);
  });

  it("41. a config whose only provider fails validation admits nothing", () => {
    const registry = ProviderRegistry.fromConfig(configFor("http://evil.example/v1"));
    expect(registry.getProviders()).toEqual([]);
    expect(registry.resolveCandidates("fast")).toEqual([]);
    expect(() => registry.resolveModel("fast")).toThrow(/No provider\/model available/);
    expect(openAiCtor).not.toHaveBeenCalled();
  });

  it("42. an unknown model id is still refused by getModel", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    expect(() => registry.getModel("freellmapi", "no-such-model")).toThrow(/Unknown model/);
  });

  it("43. a hostile OPENAI_BASE_URL cannot be applied through the override path", () => {
    // src/agent/loop.ts:180-181 feeds process.env.OPENAI_BASE_URL straight into
    // overrideBaseUrl(); that is why the override has to validate.
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    process.env.OPENAI_BASE_URL = "http://169.254.169.254/latest/meta-data";
    const before = registry.getProviders().find((p) => p.id === "openai")?.baseUrl;
    expect(() => registry.overrideBaseUrl("openai", process.env.OPENAI_BASE_URL)).toThrow(ProviderUrlError);
    expect(registry.getProviders().find((p) => p.id === "openai")?.baseUrl).toBe(before);
  });

  it("44. a legitimate Conway HTTPS override still applies", () => {
    const registry = ProviderRegistry.fromConfig(TEMPLATE_PATH);
    process.env.OPENAI_BASE_URL = "https://api.conway.tech/v1";
    registry.overrideBaseUrl("openai", process.env.OPENAI_BASE_URL);
    expect(registry.getProviders().find((p) => p.id === "openai")?.baseUrl).toBe(
      "https://api.conway.tech/v1",
    );
  });
});

describe("P-6 §5.3 redirect protection, measured on the wire", () => {
  // Cases 19-22 above assert the *instruction* handed to the transport (redirect: "error").
  // That is not the same claim as "a redirect was refused", so this block drives the real
  // global fetch against two real loopback HTTP servers and counts the hits the second one
  // receives. Both servers bind 127.0.0.1 on an ephemeral port and are closed in afterAll.
  // Nothing leaves the machine: the "public" and "unsupported scheme" locations are never
  // resolved because the redirect is refused before a second hop is attempted.
  let source: http.Server;
  let target: http.Server;
  let sourcePort = 0;
  let targetPort = 0;
  let targetHits = 0;
  let sourceHits = 0;
  let mode: "ok" | "cross-port" | "public" | "file" = "ok";

  function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
  }

  function close(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  beforeAll(async () => {
    target = http.createServer((_req, res) => {
      targetHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    targetPort = await listen(target);

    source = http.createServer((_req, res) => {
      sourceHits += 1;
      if (mode === "ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      const location =
        mode === "cross-port"
          ? `http://127.0.0.1:${targetPort}/v1/chat/completions`
          : mode === "public"
            ? "https://api.evil.example/v1/chat/completions"
            : "file:///C:/Windows/system32/drivers/etc/hosts";
      res.writeHead(302, { location });
      res.end();
    });
    sourcePort = await listen(source);
  });

  afterAll(async () => {
    await close(source);
    await close(target);
  });

  it("45. positive control: the loopback endpoint is reachable through the guard", async () => {
    mode = "ok";
    targetHits = 0;
    sourceHits = 0;
    const guard = guardOf(load(`http://127.0.0.1:${sourcePort}/v1`));

    const response = await guard(`http://127.0.0.1:${sourcePort}/v1/chat/completions`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(sourceHits).toBe(1);
  });

  it("46. a loopback-to-loopback cross-port redirect is refused and the second server is never hit", async () => {
    mode = "cross-port";
    targetHits = 0;
    const guard = guardOf(load(`http://127.0.0.1:${sourcePort}/v1`));

    await expect(
      guard(`http://127.0.0.1:${sourcePort}/v1/chat/completions`, { method: "POST" }),
    ).rejects.toThrow();

    expect(targetHits, "the redirect destination must receive zero requests").toBe(0);
  });

  it("47. a redirect to a public HTTPS host is refused before any name resolution", async () => {
    mode = "public";
    const guard = guardOf(load(`http://127.0.0.1:${sourcePort}/v1`));

    await expect(
      guard(`http://127.0.0.1:${sourcePort}/v1/chat/completions`, { method: "POST" }),
    ).rejects.toThrow();

    expect(dnsLookup).not.toHaveBeenCalled();
    expect(targetHits).toBe(0);
  });

  it("48. a redirect to an unsupported scheme is refused", async () => {
    mode = "file";
    const guard = guardOf(load(`http://127.0.0.1:${sourcePort}/v1`));

    await expect(
      guard(`http://127.0.0.1:${sourcePort}/v1/chat/completions`, { method: "POST" }),
    ).rejects.toThrow();

    expect(targetHits).toBe(0);
  });

  it("49. the refusal is surfaced as a transport error, not a silent empty completion", async () => {
    mode = "cross-port";
    const guard = guardOf(load(`http://127.0.0.1:${sourcePort}/v1`));

    let caught: unknown;
    try {
      await guard(`http://127.0.0.1:${sourcePort}/v1/chat/completions`, { method: "POST" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message).length).toBeGreaterThan(0);
  });
});
