# Conway Automaton — AI Integration

**Real inference was not executed.** No credential is present in the process environment and no
outbound AI request was authorised. This document therefore separates three things carefully:

1. what the **registry and routing code** actually do (verified by reading source and by tests),
2. what the **localhost provider** actually answers when probed read-only (verified live),
3. what a **real completion** would do (NOT DEMONSTRATED).

---

## 1. The provider set as configured

Source: `runtime/home/.automaton/inference-providers.json`, byte-identical (SHA-256 `A126C4E02077AB7D…`)
to `config/inference-providers.template.json`.

| Provider | Endpoint | Declared | Tier models (reasoning / fast / cheap) | Credential env | Key present |
|---|---|---|---|---|---|
| **freellmapi** | `http://localhost:3001/v1` | **enabled** | `auto` / `auto` / `auto` | `FREELLMAPI_API_KEY` | **no** |
| openai | `https://api.openai.com/v1` | **enabled** | `gpt-4.1` / `gpt-4.1-mini` / `gpt-4.1-nano` | `OPENAI_API_KEY` | **no** |
| groq | `https://api.groq.com/openai/v1` | **enabled** | `llama-3.3-70b-versatile` ×2 / `llama-3.1-8b-instant` | `GROQ_API_KEY` | **no** |
| together | `https://api.together.xyz/v1` | disabled | Llama-3.3-70B / 3.3-70B / 3.1-8B | `TOGETHER_API_KEY` | no |
| local | `http://localhost:11434/v1` | disabled | `llama3.3:70b` / `llama3.1:8b` | `LOCAL_API_KEY` | no |

`auto` is FreeLLMAPI's virtual-router model id: the gateway chooses the concrete upstream model. That
choice is **not observable from Conway**, which is why the console reports the actually-used model as
`UNKNOWN` rather than claiming `gpt-5.2` (the value declared in `automaton.json`).

### Tier defaults

```json
"reasoning": { "preferredProvider": "freellmapi", "fallbackOrder": ["openai", "groq", "together", "local"] },
"fast":      { "preferredProvider": "freellmapi", "fallbackOrder": ["groq", "openai", "together", "local"] },
"cheap":     { "preferredProvider": "freellmapi", "fallbackOrder": ["groq", "together", "local", "openai"] }
```

Because `together` and `local` are disabled, the **effective** orders are:

- reasoning: `freellmapi → openai → groq`
- fast: `freellmapi → groq → openai`
- cheap: `freellmapi → groq → openai`

---

## 2. Endpoint validation (P-6)

`src/inference/provider-url.ts` validates every configured `baseUrl` before the registry will use it:

- plaintext `http://` is accepted **only** for loopback hosts (`localhost`, `127.0.0.1`, `::1`);
- credentials embedded in a URL are rejected;
- the OpenAI transport is constructed with `redirect: "error"`, so a provider cannot redirect the
  request to a different origin with the credential attached.

**Live result:** 5 endpoints validated, **5 valid, 0 rejected** (`EV-02`). This is a *configuration
validity* result — no connection was opened by the validation itself.

---

## 3. Request lifecycle (what would happen)

```
caller (agent loop)
   │  { messages, tier: "fast" | "reasoning" | "cheap", tools?, maxTokens? }
   ▼
ProviderRegistry.resolveModel(tier)
   │  preferredProvider first, then fallbackOrder, skipping disabled providers
   │  credential read from process.env at call time (never from disk)
   ▼
UnifiedInferenceClient.complete()
   │  OpenAI SDK client per provider, redirect:"error", timeout applied
   ▼
provider  ──►  response | HTTP error | transport error
   │
   ├─ success → UnifiedInferenceResult {
   │              content, toolCalls, usage{input,output,total},
   │              cost{input,output,total}, metadata{
   │                 providerId, modelId, tier, latencyMs, retries, failedProviders } }
   │
   └─ error → isRetryableError()?
                ├─ yes (HTTP 429/500/503) → retry up to 3× (1s, 2s, 4s)
                │     └─ exhausted → next provider in the tier
                └─ no  → abort the tier, throw (no failover)
```

Circuit breaker: five consecutive failures on a provider disable it for **5 minutes**, after which
the next call fails over rather than retrying it.

---

## 4. Scenario results

### Scenario A — Provider discovery — **DEMONSTRATED (real, read-only)**

- The console parsed all five provider records from the deployed JSON.
- Every `baseUrl` passed P-6; none was rejected.
- Enabled/disabled state was read as declared (3 enabled, 2 disabled).
- Credential presence was resolved per provider **without reading any value**: all five reported
  `not present`.
- Tier resolution was exercised in tests: `freellmapi` is first for **every** tier.

Evidence: `EV-02` (panel table), `EV-08` (`tries FreeLLMAPI first for every tier`).

### Scenario B — Request routing — **DEMONSTRATED WITH MOCKS**

The OpenAI transport is mocked at the module boundary, so no packet can leave the process (a test
asserts exactly that: *"never performs real network I/O while these fall back"*).

Observed routing decisions:

| Tier | Resolved order |
|---|---|
| reasoning | `freellmapi → openai → groq` |
| fast | `freellmapi → groq → openai` |
| cheap | `freellmapi → groq → openai` |

`together` and `local` never appear as candidates while disabled.

### Scenario C — Error handling — **DEMONSTRATED WITH MOCKS**

| Failure | Classification | Behaviour |
|---|---|---|
| Connection refused | transport error, **no HTTP status** | **aborts the tier** — no failover |
| Timeout | transport error, no status | **aborts the tier** — no failover |
| `401` authentication | not in `{429,500,503}` | **aborts the tier** — no failover |
| `429` rate limit | retryable | 3 retries (1s/2s/4s) → **fails over** |
| `500` / `503` | retryable | retry → **fails over** |
| `200` with no `choices` | invalid response | **aborts the tier** — no failover |
| 5 consecutive failures | circuit breaker | provider disabled 5 min → next call fails over |

This is a **characterisation** result: the tests record current behaviour, and four of the five
scenarios are *abort-without-failover*. It is not a claim that any provider failure is survivable.

### Scenario D — Fallback — **DEMONSTRATED WITH MOCKS**

- A `429` on the cheap tier walked `freellmapi → groq → openai` and succeeded at the third provider.
- When **every** enabled provider was rate-limited, the tier failed with the provider names in the
  error message — a bounded, diagnosable failure rather than a silent hang.
- The circuit breaker opened after five failures and the next call failed over instead of retrying.

### Scenario E — Real inference — **NOT DEMONSTRATED**

| Precondition | State |
|---|---|
| `FREELLMAPI_API_KEY` in process environment | **ABSENT** |
| `OPENAI_API_KEY` | **ABSENT** |
| `GROQ_API_KEY` | **ABSENT** |
| Explicit operator authorisation for an outbound request | **NOT GIVEN** |
| Credential retrieval from files/browsers/other apps | **PROHIBITED — not attempted** |
| Substitute a paid provider automatically | **PROHIBITED — not attempted** |

**Blocker code: `BLOCKED_CREDENTIAL`.** No key was invented, guessed, read from disk, or echoed. No
request was sent to OpenAI or Groq. FreeLLMAPI was probed **without** a credential, which is the
read-only reachability test in §5.

What would be required to complete Scenario E: an operator-supplied `FREELLMAPI_API_KEY` in the
process environment, an explicit authorisation for the specific request, and a spend ceiling. Until
then the honest status is **NOT DEMONSTRATED**, and every downstream claim (latency, cost, model
identity, answer quality) remains **NOT MEASURED**.

---

## 5. FreeLLMAPI — read-only verification (no modification)

| Check | Result |
|---|---|
| TCP handshake `127.0.0.1:3001` | **connected** |
| Process | pid **17708**, alive throughout |
| `GET /v1/models` with no credential | **401**, `{"error":{"message":"Invalid API key","type":"authentication_error"}}` |
| Credential sent | **none** |
| Writes to the service | **none** |
| Source or config of FreeLLMAPI modified | **none** |
| Port or binding changed | **none** |

This is the correct posture for Conway today: the provider is registered and reachable, the auth wall
is real, and Conway holds no credential — so a call would fail closed with `401`, which the inference
client classifies as **non-retryable** and would surface rather than mask.

The registry's documented behaviour when the credential is absent is to send the literal placeholder
`missing-freellmapi_api_key` instead of an empty header; test `3b` asserts this. FreeLLMAPI's observed
`401 Invalid API key` is consistent with that — but the actual transmission was **not** exercised
here, because no inference call was made.

---

## 6. What is genuinely weak (and should not be sold as strong)

1. **Failover is narrow.** Only `429/500/503` walk the provider order. A timeout, a connection reset,
   a bad key or a malformed 200 all abort the tier. If resilience against those is required, the
   classifier must change and the tests must be re-baselined.
2. **`auto` hides the real model.** Conway cannot report which upstream model FreeLLMAPI chose. Any
   future cost or quality metric must come from the gateway, not be inferred.
3. **No cost telemetry.** `inference_costs` is empty because no call has ever run. A zero here means
   "table counted, zero rows", never "spend was zero".
4. **No live preflight.** `live-model-preflight.ts` exists but has never run; a broken credential is
   discovered on the first real call, not before.
5. **No provider health probe.** Reachability is not polled. The console can say "declared enabled
   and URL-valid", not "healthy".

---

## 7. Reproduce

```powershell
# Scenario A (real, read-only)
#   open http://127.0.0.1:8787 → AI Models panel
#   or: GET /api/panel/models with an operator session

# Scenarios B–D (mock-only, no network)
$env:HOME = '<repo-root>\runtime\home'
.\runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run `
  src/__tests__/inference/freellmapi-fallback.test.ts `
  src/__tests__/inference/inference-client.test.ts `
  src/__tests__/inference/provider-url-validation.test.ts
# observed: 3 files, 94 tests, 94 passed, 0 failed

# FreeLLMAPI reachability (no credential)
.\runtime\node-v22.23.4-win-x64\node.exe runtime\tmp\freellmapi-probe.mjs
```

Scenario E is intentionally absent from this list: running it requires a credential and an explicit
authorisation that were not available.
