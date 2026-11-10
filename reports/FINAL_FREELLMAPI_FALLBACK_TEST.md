# Phase 20 — Final FreeLLMAPI Fallback Test

## 1. Objective

Verify §8 independently of real inference: (A) how the registry and inference client behave when
FreeLLMAPI fails in five specific ways, (B) that the provider ordering and disabled posture are the
intended ones, and (C) whether real fallback may be tested.

**Result: `MOCK_FALLBACK = VERIFIED`, `REAL_FALLBACK = NOT TESTED`.**

## 2. Scope

Mock-based, no-network tests added in this phase, driven through the **shipped** provider
configuration (`config/inference-providers.template.json` and a read-only copy of the deployed file)
rather than synthetic providers, so what is measured is what `src/agent/loop.ts:175-184` would use.
Existing suites were inspected to avoid duplicating coverage, and are reported alongside.

## 3. Approval reference

Master prompt §3 permits, without new approval: "read-only inspection, disposable test creation,
mock-based tests, static analysis, documentation corrections, non-network provider resolution tests,
security analysis, test reports." This file is exactly that category: **one new test file, zero source
changes.** §8C forbids contacting OpenAI or Groq automatically, so real fallback was not attempted.

## 4. Files inspected

`src/inference/inference-client.ts:10-13` (`RETRYABLE_STATUS_CODES = {429,500,503}`,
`RETRY_BACKOFF_MS = [1000,2000,4000]`, breaker threshold 5 / 5 minutes), `:100-148` (`chat`),
`:179-221` (`executeWithRetries`), `:223-272` (`executeSingleRequest`), `:413-416` (`isRetryableError`),
`:439-473` (`markProviderFailure` / `markProviderSuccess`), `:525-557` (`getStatusCode`);
`src/inference/provider-registry.ts:315-355` (`resolveCandidates`), `:401-430`
(`getProviderOrderForTier`); the existing suites `src/__tests__/inference/inference-client.test.ts`
(23 tests), `src/__tests__/integration/inference-failover.test.ts` (17 tests),
`src/__tests__/inference/provider-registry.test.ts` (31), `src/__tests__/inference/freellmapi-provider.test.ts` (15);
and the template's `tierDefaults` block.

## 5. Files modified

`src/__tests__/inference/freellmapi-fallback.test.ts` — new, 17 tests, 428 lines, sha256
`4aa1eb079a5dbb914841b0ba30645c34980d397cdeef4a747df5f3aac7fb82d2`.
`runtime/tmp/p20-fallback-tests.log` — captured run, sha256 `d5f4c7047a7450feeeb811fdc011abd95cbb8f6b6da0b9fb94a55265b6b987a8`.

## 6. Files not modified

`src/inference/inference-client.ts`, `src/inference/provider-registry.ts`, both existing inference test
files (extended by a new sibling file rather than edited, so their approved assertions stay intact),
the template, the deployed config, `dashboard/**`, and FreeLLMAPI.

## 7. Before / after hashes

Before this phase the shipped suite was 87 files / 2 158 tests. After: 88 files / 2 175 tests — the
delta is only the new file (+1 file, +17 tests), confirmed by the full regression (§11).
Unchanged: `provider-registry.ts` `b5542260…f20718`, `inference-client.ts` `ca061661…8863c`,
template and deployed config both `a126c4e0…e73855`.

## 8. §8A results — the five mandated failure simulations

All five are driven against the compiled registry + client with the OpenAI transport mocked per
instance, and each asserts the **ordered list of base URLs actually attempted**, so "did it fail over"
is answered by evidence rather than by reading the code.

| §8A case | Injected failure | Measured behaviour | Verdict vs existing policy |
|---|---|---|---|
| 1. connection failure | status-less `Error("Connection error.")` | `chat()` rejects with the original message; **only `http://localhost:3001/v1` is attempted**; OpenAI/Groq never reached | correct per `isRetryableError` (no status ⇒ non-retryable) — recorded as **F-20-06** |
| 2. timeout | `Error("Request timed out.")` | identical: rejects, no failover | same |
| 3. authentication failure | `Error` with `status = 401` | rejects immediately, no failover, no retry | 401 is absent from `RETRYABLE_STATUS_CODES` — intended: a bad local key must not consume paid cloud quota |
| 3b. credential handling | `FREELLMAPI_API_KEY` unset | client built with baseURL `http://localhost:3001/v1` and apiKey `missing-freellmapi_api_key` (the registry's documented placeholder) | no credential is invented, no unauthenticated call is silently made |
| 4. rate limit | four consecutive `status = 429` | **4 attempts on FreeLLMAPI** (1 + 3 retries, 7 s of backoff under fake timers), then failover: reasoning → `openai`, cheap → `groq` → `openai`; `metadata.failedProviders = ["freellmapi"]`, `metadata.retries = 3` | matches the documented policy exactly |
| 4c. everyone rate limited | twelve `429` across three providers | rejects with `All providers failed for tier 'fast'. Failed providers: freellmapi, groq, openai` | correct |
| 5. invalid response | 200 with `choices: []` | rejects `No completion choice returned from provider 'freellmapi'`, **no failover** | the error carries no status ⇒ non-retryable — recorded as **F-20-06** |
| 6. circuit breaker | five consecutive `401` | after the 5th, `registry` reports `freellmapi.enabled === false`; the next `chat()` resolves to `openai` and FreeLLMAPI is absent from `resolveCandidates()` | correct; note `failedProviders` is `[]` in that call because a disabled provider never becomes a candidate, so it is not counted as "failed" |
| — | global `fetch` stubbed to throw | 0 calls during a full failover sequence | proves the suite cannot touch the network |

## 9. §8B results — ordering and disabled posture

| Tier | Required order (master prompt §8B) | Measured from the shipped template | Match |
|---|---|---|---|
| reasoning | `freellmapi → openai → groq` | `["freellmapi","openai","groq"]` | yes |
| fast | `freellmapi → groq → openai` | `["freellmapi","groq","openai"]` | yes |
| cheap | `freellmapi → groq → openai` | `["freellmapi","groq","openai"]` | yes |

`together` and `local` are `enabled: false` and appear in **no** tier's candidate list; disabling a
provider at runtime removes it from the next resolution and re-enabling restores it first.
The **deployed** copy (`runtime/home/.automaton/inference-providers.json`) is compared through a
read-only temp copy and yields the identical ordering for all three tiers (§9 integrity).

## 10. RED / GREEN evidence

These are **characterisation tests of behaviour that already exists**, so the honest classification is
GREEN-first with no RED available to manufacture: §6 forbids manufacturing a RED, and pretending the
policy were broken would be false. Two genuine authoring failures occurred and are recorded rather
than hidden — `runtime/tmp/p20-p6-red-vitest.log` is unrelated:
- the first run failed 2 of 17 tests: `expect(vi.runAllTimersAsync()).resolves.toBeUndefined()` (it
  resolves to the `vi` object, not undefined) and an assumed `failedProviders: ["freellmapi"]` on the
  circuit-breaker test, which is wrong because a registry-disabled provider never enters the candidate
  list. Both were test bugs, not product bugs; the implementation was **not** changed to satisfy them.
- the intermediate run then reported `17 passed` but exit 1 because the all-providers-failed promise
  rejected before its handler was attached; the fix attaches `expect().rejects` before running timers.

Final captured run: `runtime/tmp/p20-fallback-tests.log`, start `10:14:22` local,
**1 file / 17 tests / 0 failed, exit 0, Duration 687 ms**, no unhandled errors.

## 11. Regression results

Focused (§12 B–H equivalents): `runtime/tmp/p20-focused-inference.log` — **7 files / 195 tests passed,
exit 0**, comprising `freellmapi-provider` 15, `inference-failover` 17, `provider-registry` 31,
`inference-client` 23, `freellmapi-fallback` 17, `http-client` 28, `inference-router` 64.
Full root: `runtime/tmp/p20-full-regression.log` — **88 files / 2 175 tests / 0 failed, exit 0**, 89.60 s.
`tsc --noEmit` and `tsc` both exit 0.

## 12. Real inference status

`BLOCKED_NO_CREDENTIAL` + `BLOCKED_APPROVAL`; irrelevant to fallback, which is deliberately tested
without a network. See `FINAL_FREELLMAPI_INFERENCE_TEST.md`.

## 13. Fallback status

`MOCK_FALLBACK = VERIFIED`. `REAL_FALLBACK = NOT TESTED` — no OpenAI or Groq request was made and none
will be without §8C's three prerequisites (separate operator approval, an available credential, an
explicit request plan). The two states are never merged in any artifact of this phase.

## 14. Security invariant results

Unchanged: `runtime/tmp/p20-close-invariants.log`. The §8 test file writes nothing outside
`os.tmpdir()`; it never opens `state.db`, never reads a credential value, and asserts zero `fetch`
calls. `CONWAY_ACTIVATION` remains unset; schema stays 11.

## 15. Residual findings

- **F-20-06** (availability, confirmed by test): failover exists only for 429/500/503. A dead local
  gateway (connection refused), a hung gateway (timeout), a wrong key (401) or a garbage 200 aborts the
  whole tier with **no** fallback provider attempted, while a rate-limited gateway does fall over.
  Whether that asymmetry is intended is a product decision — it is not a P-6 change, and it was not
  "fixed" by weakening a test.
- **F-20-11** (from the inference report): the authentication leg has never been exercised for real, so
  "401 → no failover" is verified against a simulated status, not against FreeLLMAPI's actual rejection.
- The circuit-breaker interaction is subtle and is now pinned by test: after 5 failures the provider
  disappears from candidates, so `failedProviders` reports `[]` even though a provider was effectively
  removed. Any dashboard or log that infers "no provider failed" from an empty `failedProviders` would
  be wrong.

## 16. Rollback instructions

`rm src/__tests__/inference/freellmapi-fallback.test.ts` and re-run the suite; expect 87 files /
2 158 tests. No other artifact of this phase affects behaviour, and no source file is involved.

## 17. Final GO / NO-GO

**GO** for §8A and §8B: the fallback policy is verified against the shipped configuration with captured
counts, and the ordering and disabled posture match §8B exactly.
**NO-GO / NOT TESTED** for §8C real fallback, which is blocked on operator approval and credentials.
