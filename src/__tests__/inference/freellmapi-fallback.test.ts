/**
 * Phase 20 §8 — fallback verification for the canonical FreeLLMAPI provider set.
 *
 * §8A drives UnifiedInferenceClient against the real shipped template
 * (config/inference-providers.template.json), not against synthetic providers, so the
 * behaviour measured is the behaviour the agent loop would actually get. The OpenAI
 * transport is mocked at the module boundary: no request can leave the process, which is
 * what §8C ("do not contact OpenAI or Groq automatically") requires.
 *
 * §8B pins the tier ordering and the disabled posture.
 *
 * These are characterisation tests: they record the fallback policy as it exists today.
 * Four of the five §8A scenarios are abort-without-failover, because isRetryableError
 * (src/inference/inference-client.ts:413-416) needs an HTTP status and a connection
 * error, a timeout, a 401 and a choice-less response all have none. That is asserted as
 * documented current behaviour, not as a passing safety property — see
 * reports/FINAL_FREELLMAPI_FALLBACK_TEST.md.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const queue: Array<(payload: unknown) => unknown | Promise<unknown>> = [];
  const calls: Array<{ baseURL: string; payload: unknown }> = [];

  const ctor = vi.fn().mockImplementation(function MockOpenAI(
    this: Record<string, unknown>,
    options: { baseURL?: string } | undefined,
  ) {
    const baseURL = String(options?.baseURL ?? "");
    const create = vi.fn(async (payload: unknown) => {
      calls.push({ baseURL, payload });
      const next = queue.shift();
      if (!next) {
        throw new Error("No OpenAI mock response queued");
      }
      return next(payload);
    });
    this.baseURL = baseURL;
    this.options = options;
    this.chat = { completions: { create } };
  });

  return { queue, calls, ctor };
});

vi.mock("openai", () => ({ default: mockState.ctor }));

import { ProviderRegistry, type ModelTier } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import type { ChatMessage } from "../../types.js";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../../../config/inference-providers.template.json", import.meta.url),
);

const ORIGINAL_ENV = { ...process.env };
const BASE_MESSAGES: ChatMessage[] = [{ role: "user", content: "ping" }];

const FREELLMAPI_BASE_URL = "http://localhost:3001/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * A status-less error is what the OpenAI SDK raises for a transport failure
 * (APIConnectionError carries no `.status`), and getStatusCode() only inspects
 * `.status`, `.response.status`, `.cause.status` and a 429/500/503 substring in the
 * message. None of those match, so the attempt is classified non-retryable.
 */
function queueStatuslessError(message: string): void {
  mockState.queue.push(async () => {
    throw new Error(message);
  });
}

function queueHttpError(status: number, message = `HTTP ${status}`): void {
  mockState.queue.push(async () => {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    throw err;
  });
}

function queueCompletion(content = "ok"): void {
  mockState.queue.push(async () => ({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
}

/** A 200 response that simply has no choices — the gateway replied, uselessly. */
function queueChoicelessResponse(): void {
  mockState.queue.push(async () => ({ choices: [], usage: null }));
}

function providerIdsForTier(registry: ProviderRegistry, tier: ModelTier): string[] {
  return registry.resolveCandidates(tier).map((entry) => entry.provider.id);
}

function attemptedBaseURLs(): string[] {
  return mockState.calls.map((call) => call.baseURL);
}

function canonicalRegistry(): ProviderRegistry {
  return ProviderRegistry.fromConfig(TEMPLATE_PATH);
}

describe("phase20 §8A — mock fallback behaviour through the canonical config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.queue.splice(0, mockState.queue.length);
    mockState.calls.splice(0, mockState.calls.length);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTOMATON_CREDITS_BALANCE;
    delete process.env.AUTOMATON_INFERENCE_TASK_TYPE;
    delete process.env.FREELLMAPI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it("tries FreeLLMAPI first for every tier", async () => {
    for (const tier of ["reasoning", "fast", "cheap"] as const) {
      mockState.calls.splice(0, mockState.calls.length);
      const registry = canonicalRegistry();
      const client = new UnifiedInferenceClient(registry);
      queueCompletion(`ok-${tier}`);

      const result = await client.chat({ tier, messages: BASE_MESSAGES });

      expect(result.metadata.providerId, `tier ${tier}`).toBe("freellmapi");
      expect(attemptedBaseURLs(), `tier ${tier}`).toEqual([FREELLMAPI_BASE_URL]);
    }
  });

  it("1. connection failure: aborts the tier, does not fail over to the cloud providers", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    queueStatuslessError("Connection error.");

    await expect(client.chat({ tier: "reasoning", messages: BASE_MESSAGES })).rejects.toThrow(
      /Connection error\./,
    );

    // Documented current policy: a transport failure is non-retryable, so openai and groq
    // are never reached even though both are enabled and next in the fallback order.
    expect(attemptedBaseURLs()).toEqual([FREELLMAPI_BASE_URL]);
  });

  it("2. timeout: aborts the tier, does not fail over", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    queueStatuslessError("Request timed out.");

    await expect(client.chat({ tier: "fast", messages: BASE_MESSAGES })).rejects.toThrow(
      /Request timed out\./,
    );

    expect(attemptedBaseURLs()).toEqual([FREELLMAPI_BASE_URL]);
  });

  it("3. authentication failure (401): aborts the tier, does not fail over", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    queueHttpError(401, "Invalid API key");

    await expect(client.chat({ tier: "reasoning", messages: BASE_MESSAGES })).rejects.toThrow(
      /Invalid API key/,
    );

    // 401 is not in RETRYABLE_STATUS_CODES (src/inference/inference-client.ts:10), so the
    // configured OpenAI/Groq keys are never exercised as a side effect of a bad local key.
    expect(attemptedBaseURLs()).toEqual([FREELLMAPI_BASE_URL]);
  });

  it("3b. an absent credential sends the documented placeholder, not an empty header", () => {
    // With FREELLMAPI_API_KEY unset the registry substitutes a placeholder
    // (src/inference/provider-registry.ts:446-457). FreeLLMAPI answers 401 to it, so a
    // missing key fails loudly instead of reaching an unauthenticated endpoint.
    const resolved = canonicalRegistry().resolveModel("fast");
    const options = (resolved.client as unknown as { options: { apiKey: string; baseURL: string } })
      .options;
    expect(options.apiKey).toBe("missing-freellmapi_api_key");
    expect(options.baseURL).toBe(FREELLMAPI_BASE_URL);
  });

  it("4. rate limit (429): retries three times, then fails over to the next provider in tier order", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    for (let i = 0; i < 4; i++) {
      queueHttpError(429, "rate limited");
    }
    queueCompletion("from-openai");

    vi.useFakeTimers();
    const pending = client.chat({ tier: "reasoning", messages: BASE_MESSAGES });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();

    expect(result.content).toBe("from-openai");
    expect(result.metadata.providerId).toBe("openai");
    expect(result.metadata.failedProviders).toEqual(["freellmapi"]);
    expect(result.metadata.retries).toBe(3);
    expect(attemptedBaseURLs()).toEqual([
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      OPENAI_BASE_URL,
    ]);
  });

  it("4b. rate limit on the cheap tier walks freellmapi → groq → openai", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    for (let i = 0; i < 4; i++) {
      queueHttpError(429, "rate limited");
    }
    for (let i = 0; i < 4; i++) {
      queueHttpError(429, "rate limited");
    }
    queueCompletion("from-openai");

    vi.useFakeTimers();
    const pending = client.chat({ tier: "cheap", messages: BASE_MESSAGES });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();

    expect(result.metadata.providerId).toBe("openai");
    expect(result.metadata.failedProviders).toEqual(["freellmapi", "groq"]);
    expect(attemptedBaseURLs()).toEqual([
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      FREELLMAPI_BASE_URL,
      GROQ_BASE_URL,
      GROQ_BASE_URL,
      GROQ_BASE_URL,
      GROQ_BASE_URL,
      OPENAI_BASE_URL,
    ]);
  });

  it("4c. when every enabled provider is rate limited the tier fails with the provider names", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    for (let i = 0; i < 12; i++) {
      queueHttpError(429, "rate limited");
    }

    vi.useFakeTimers();
    // The rejection handler is attached before the timers run; awaiting the chat promise
    // only afterwards leaves a window in which Node reports the rejection as unhandled.
    const rejected = expect(client.chat({ tier: "fast", messages: BASE_MESSAGES })).rejects.toThrow(
      /All providers failed for tier 'fast'\. Failed providers: freellmapi, groq, openai/,
    );
    await vi.runAllTimersAsync();
    await rejected;
    vi.useRealTimers();
  });

  it("5. invalid provider response (200, no choices): aborts the tier, does not fail over", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    queueChoicelessResponse();

    await expect(client.chat({ tier: "fast", messages: BASE_MESSAGES })).rejects.toThrow(
      /No completion choice returned from provider 'freellmapi'/,
    );

    expect(attemptedBaseURLs()).toEqual([FREELLMAPI_BASE_URL]);
  });

  it("6. five consecutive failures open the circuit and the next call fails over", async () => {
    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);

    // 401 is non-retryable, so one chat() call is one counted failure. Five calls reach
    // CIRCUIT_BREAKER_FAILURE_THRESHOLD (src/inference/inference-client.ts:12) and the
    // registry is told to disable the provider for five minutes.
    for (let i = 0; i < 5; i++) {
      queueHttpError(401, "Invalid API key");
      await expect(client.chat({ tier: "reasoning", messages: BASE_MESSAGES })).rejects.toThrow(
        /Invalid API key/,
      );
    }

    expect(registry.getProviders().find((p) => p.id === "freellmapi")?.enabled).toBe(false);

    mockState.calls.splice(0, mockState.calls.length);
    queueCompletion("skipped-freellmapi");
    const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

    expect(result.metadata.providerId).toBe("openai");
    // failedProviders stays empty: the provider is not skipped by the client's circuit
    // bookkeeping at this point, it is gone from the candidate list altogether, because
    // markProviderFailure() asked the registry to disable it
    // (src/inference/inference-client.ts:439-457 → registry.disableProvider). A disabled
    // provider never appears in resolveCandidates(), so nothing is recorded as "failed".
    expect(result.metadata.failedProviders).toEqual([]);
    expect(providerIdsForTier(registry, "reasoning")).toEqual(["openai", "groq"]);
    expect(attemptedBaseURLs()).toEqual([OPENAI_BASE_URL]);
  });

  it("never performs real network I/O while these fall back", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("fallback tests must not reach the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const registry = canonicalRegistry();
    const client = new UnifiedInferenceClient(registry);
    queueHttpError(429, "rate limited");
    queueCompletion();

    vi.useFakeTimers();
    const pending = client.chat({ tier: "reasoning", messages: BASE_MESSAGES });
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("phase20 §8B — provider ordering and disabled posture", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTOMATON_CREDITS_BALANCE;
    delete process.env.AUTOMATON_INFERENCE_TASK_TYPE;
    delete process.env.FREELLMAPI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reasoning resolves to freellmapi → openai → groq", () => {
    expect(providerIdsForTier(canonicalRegistry(), "reasoning")).toEqual([
      "freellmapi",
      "openai",
      "groq",
    ]);
  });

  it("fast resolves to freellmapi → groq → openai", () => {
    expect(providerIdsForTier(canonicalRegistry(), "fast")).toEqual([
      "freellmapi",
      "groq",
      "openai",
    ]);
  });

  it("cheap resolves to freellmapi → groq → openai", () => {
    expect(providerIdsForTier(canonicalRegistry(), "cheap")).toEqual([
      "freellmapi",
      "groq",
      "openai",
    ]);
  });

  it("together and local stay disabled and never appear as candidates", () => {
    const registry = canonicalRegistry();
    const byId = new Map(registry.getProviders().map((p) => [p.id, p]));
    expect(byId.get("together")?.enabled).toBe(false);
    expect(byId.get("local")?.enabled).toBe(false);

    for (const tier of ["reasoning", "fast", "cheap"] as const) {
      const ids = providerIdsForTier(registry, tier);
      expect(ids, `tier ${tier}`).not.toContain("together");
      expect(ids, `tier ${tier}`).not.toContain("local");
    }
  });

  it("a provider disabled at runtime is dropped from the next resolution", () => {
    const registry = canonicalRegistry();
    registry.disableProvider("freellmapi", "phase20 ordering probe", 60_000);
    expect(providerIdsForTier(registry, "fast")).toEqual(["groq", "openai"]);
    registry.enableProvider("freellmapi");
    expect(providerIdsForTier(registry, "fast")[0]).toBe("freellmapi");
  });

  it("the deployed copy resolves to the same ordering as the template", () => {
    // §9: the file the agent loop actually reads must agree with the checked-in template.
    // Compared through a read-only copy in a temp directory; the live file is never opened
    // for writing by a test.
    const repoRoot = path.resolve(path.dirname(TEMPLATE_PATH), "..");
    const deployed = path.join(repoRoot, "runtime", "home", ".automaton", "inference-providers.json");
    if (!fs.existsSync(deployed)) {
      return;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p20-ordering-"));
    const copy = path.join(tmp, "deployed-copy.json");
    fs.copyFileSync(deployed, copy);

    const templateOrder = {
      reasoning: providerIdsForTier(canonicalRegistry(), "reasoning"),
      fast: providerIdsForTier(canonicalRegistry(), "fast"),
      cheap: providerIdsForTier(canonicalRegistry(), "cheap"),
    };
    const deployedRegistry = ProviderRegistry.fromConfig(copy);
    expect({
      reasoning: providerIdsForTier(deployedRegistry, "reasoning"),
      fast: providerIdsForTier(deployedRegistry, "fast"),
      cheap: providerIdsForTier(deployedRegistry, "cheap"),
    }).toEqual(templateOrder);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
