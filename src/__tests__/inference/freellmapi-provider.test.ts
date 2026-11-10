import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openAiCtor } = vi.hoisted(() => {
  const ctor = vi.fn().mockImplementation(function MockOpenAI(this: any, options: unknown) {
    this.options = options;
    this.chat = { completions: { create: vi.fn() } };
  });
  return { openAiCtor: ctor };
});

vi.mock("openai", () => ({ default: openAiCtor }));

import { ProviderRegistry, type ModelTier } from "../../inference/provider-registry.js";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../../../config/inference-providers.template.json", import.meta.url),
);

const ORIGINAL_ENV = { ...process.env };
const TIERS: ModelTier[] = ["reasoning", "fast", "cheap"];

function readTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
}

function templatePayload(): any {
  return JSON.parse(readTemplate());
}

function registryFromTemplate(): ProviderRegistry {
  return ProviderRegistry.fromConfig(TEMPLATE_PATH);
}

function providerIds(registry: ProviderRegistry): string[] {
  return registry.getProviders().map((provider) => provider.id);
}

function modelIdsForTier(registry: ProviderRegistry, tier: ModelTier): string[] {
  return registry
    .resolveCandidates(tier)
    .filter((entry) => entry.provider.id === "freellmapi")
    .map((entry) => entry.model.id);
}

describe("FreeLLMAPI provider configuration (A13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTOMATON_CREDITS_BALANCE;
    delete process.env.AUTOMATON_INFERENCE_TASK_TYPE;
    delete process.env.FREELLMAPI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("ships a checked-in provider template beside the other templates", () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
    expect(fs.existsSync(path.resolve(path.dirname(TEMPLATE_PATH), "automaton.template.json"))).toBe(true);
  });

  it("the template is valid JSON that the registry accepts", () => {
    const payload = templatePayload();
    expect(Array.isArray(payload.providers)).toBe(true);
    const ids = providerIds(registryFromTemplate());
    expect(ids).toContain("freellmapi");
  });

  it("restates every default provider: a config file replaces the list, it does not merge", () => {
    // ProviderRegistry.fromConfig discards DEFAULT_PROVIDERS as soon as the file yields one
    // valid entry (src/inference/provider-registry.ts:283-286). An omissions here would remove
    // a cloud provider from failover with no error raised.
    const ids = providerIds(registryFromTemplate());
    expect(ids).toEqual(expect.arrayContaining(["openai", "groq", "together", "local", "freellmapi"]));
    expect(ids).toHaveLength(5);
  });

  it("preserves the pre-A13 enable/disable posture of the providers it restates", () => {
    const registry = registryFromTemplate();
    const byId = new Map(registry.getProviders().map((p) => [p.id, p]));
    expect(byId.get("openai")?.enabled).toBe(true);
    expect(byId.get("groq")?.enabled).toBe(true);
    expect(byId.get("together")?.enabled).toBe(false);
    expect(byId.get("local")?.enabled).toBe(false);
    expect(byId.get("openai")?.baseUrl).toBe("https://api.openai.com/v1");
    expect(byId.get("groq")?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(byId.get("together")?.baseUrl).toBe("https://api.together.xyz/v1");
    expect(byId.get("local")?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("points FreeLLMAPI at the loopback OpenAI-compatible surface, not at a cloud host", () => {
    const entry = templatePayload().providers.find((p: any) => p.id === "freellmapi");
    expect(entry.baseUrl).toBe("http://localhost:3001/v1");
    expect(entry.enabled).toBe(true);
    expect(entry.apiKeyEnvVar).toBe("FREELLMAPI_API_KEY");
  });

  it("covers all three tiers so resolution never silently skips the provider", () => {
    // resolveCandidates matches model.tier === tier (src/inference/provider-registry.ts:327) and
    // drops a provider with no model in the requested tier without any diagnostic.
    const registry = registryFromTemplate();
    for (const tier of TIERS) {
      expect(modelIdsForTier(registry, tier).length, `tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("routes every tier to FreeLLMAPI first while keeping the previous order as fallback", () => {
    const registry = registryFromTemplate();
    for (const tier of TIERS) {
      const candidates = registry.resolveCandidates(tier);
      expect(candidates[0].provider.id, `tier ${tier}`).toBe("freellmapi");
      expect(candidates.map((c) => c.provider.id)).toContain("openai");
    }
  });

  it("uses FreeLLMAPI's stable router alias instead of a pinned upstream model id", () => {
    // Upstream free-model catalogues churn; 'auto' is the gateway's own virtual model
    // (freellmapi server/src/routes/proxy.ts:47 AUTO_MODEL_ID).
    const registry = registryFromTemplate();
    for (const tier of TIERS) {
      for (const id of modelIdsForTier(registry, tier)) {
        expect(id === "auto" || id.startsWith("auto:"), `${tier}: ${id}`).toBe(true);
      }
    }
  });

  it("declares FreeLLMAPI models as zero-cost so the budget tracker is not fed invented spend", () => {
    const payload = templatePayload();
    const entry = payload.providers.find((p: any) => p.id === "freellmapi");
    for (const model of entry.models) {
      expect(model.costPerInputToken).toBe(0);
      expect(model.costPerOutputToken).toBe(0);
      expect(model.supportsStreaming).toBe(true);
    }
  });

  it("resolves all tiers without opening a socket", () => {
    // Tier resolution constructs clients only; a fetch here would mean configuration time
    // reaches the network, which is exactly what the lockdown posture forbids.
    const fetchSpy = vi.fn(() => {
      throw new Error("resolution must not perform network I/O");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const registry = registryFromTemplate();
    for (const tier of TIERS) {
      registry.resolveModel(tier);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("takes the FreeLLMAPI credential from the environment only", () => {
    // resolveCandidates() builds a client for every candidate, so read the options off the
    // resolved client rather than off the constructor call history.
    process.env.FREELLMAPI_API_KEY = "test-key-from-environment";
    const resolved = registryFromTemplate().resolveModel("fast");
    expect(resolved.provider.id).toBe("freellmapi");
    const options = (resolved.client as unknown as { options: { apiKey: string; baseURL: string } }).options;
    expect(options.apiKey).toBe("test-key-from-environment");
    expect(options.baseURL).toBe("http://localhost:3001/v1");
  });

  it("sends no credential material when the env var is absent", () => {
    // Unset => the registry's documented placeholder (src/inference/provider-registry.ts:446-457).
    // FreeLLMAPI answers 401 authentication_error for it, so a missing key fails loudly rather
    // than silently calling an unauthenticated endpoint.
    const resolved = registryFromTemplate().resolveModel("fast");
    const options = (resolved.client as unknown as { options: { apiKey: string } }).options;
    expect(options.apiKey).toBe("missing-freellmapi_api_key");
    expect(resolved.model.id).toBe("auto");
  });

  it("keeps secrets out of the template file itself", () => {
    const raw = readTemplate();
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(raw).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
    expect(raw).not.toMatch(/"apiKey"\s*:/);
    expect(raw.match(/FREELLMAPI_API_KEY/g)?.length).toBeGreaterThan(0);
  });

  it("falls back to the pre-A13 provider when FreeLLMAPI is disabled", () => {
    const payload = templatePayload();
    payload.providers.find((p: any) => p.id === "freellmapi").enabled = false;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a13-disabled-"));
    const file = path.join(dir, "providers.json");
    fs.writeFileSync(file, JSON.stringify(payload), "utf8");

    const registry = ProviderRegistry.fromConfig(file);
    expect(registry.resolveModel("reasoning").provider.id).toBe("openai");
  });

  it("leaves the rest of the registry contract untouched", () => {
    const registry = registryFromTemplate();
    expect(TIERS).toContain(registry.getModel("freellmapi", "auto").model.tier);
    expect(() => registry.getModel("freellmapi", "no-such-model")).toThrow(/Unknown model/);
    registry.disableProvider("freellmapi", "test", 60_000);
    expect(() => registry.getModel("freellmapi", "auto")).toThrow(/disabled/);
  });
});
