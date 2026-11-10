# Phase 20 — Final FreeLLMAPI Real Inference Test

## 1. Objective

Determine whether a controlled, single outbound inference request from Conway's real inference path to
FreeLLMAPI may be made, and if so make exactly one; if not, report precisely which gate stopped it.

**Result: no request was attempted. `REAL_INFERENCE = BLOCKED_NO_CREDENTIAL` and `BLOCKED_APPROVAL`.**

## 2. Scope

Gate verification and request preparation only. No agent loop, no `--run`, no activation, no heartbeat,
no tool execution, no financial operation, no wallet, and no change to FreeLLMAPI or its environment
(§7A's ten prohibitions). Nothing in this phase restarts, reconfigures or reads the internals of the
FreeLLMAPI service.

## 3. Approval reference

Master prompt §3: *"Real inference: Requires a separate explicit operator approval for one controlled
outbound request. A key being present in the environment does not itself constitute approval to send a
request."* §7A: credential may come **only** from `FREELLMAPI_API_KEY` in the process environment.
**No such approval exists in any record** — `PHASE_18_APPROVAL_LIST.md` §6 is blank, and
`PHASE_19_PROGRESS.md` §3 shows only A2 and A3 ever approved. This report therefore documents the gate,
not a request.

## 4. Files inspected

`src/inference/provider-registry.ts:272-305` (`fromConfig`), `:315-355` (`resolveCandidates`),
`:432-444` (`buildResolvedModel`), `:446-457` (`resolveApiKey`);
`src/inference/inference-client.ts:100-148` (`chat`), `:179-221` (`executeWithRetries`),
`:223-272` (`executeSingleRequest`), `:413-416` (`isRetryableError`);
`src/agent/loop.ts:155-184` (config→env key bridge and the provider-file path);
`runtime/home/.automaton/inference-providers.json`; `config/inference-providers.template.json`.

## 5. Files modified / 6. Files not modified

Modified: this report and `runtime/tmp/` probe scripts and logs only.
Not modified: `src/**` except the new §8 test file (`src/__tests__/inference/freellmapi-fallback.test.ts`),
`dashboard/**`, `config/**`, the deployed provider config, `automaton.json`, `state.db`, FreeLLMAPI, and
the global environment. No `FREELLMAPI_API_KEY` was created, exported into a persistent scope, or copied
from any other application or file.

## 7. Before / after hashes

`config/inference-providers.template.json` and `runtime/home/.automaton/inference-providers.json`:
`a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` before and after (byte-for-byte
identical to each other, §9).
`src/inference/provider-registry.ts` `b5542260…f20718`, `src/inference/inference-client.ts` `ca061661…8863c`,
`src/agent/loop.ts` `e97c1887…9d83f` — all unchanged.
Full table in `FINAL_FREELLMAPI_SECURITY_AUDIT.md` §7.

## 8. Credential gate — measured, not assumed

`runtime/tmp/p20-credential-presence.log` (prints presence and length only):

```
FREELLMAPI_API_KEY present: false | length: 0
OPENAI_API_KEY present: false
GROQ_API_KEY present: false
CONWAY_ACTIVATION set: false
OPENAI_BASE_URL set: false
```

Per §7A the following were **not** done, on purpose: `.freellmapi/unified-api-key.txt` was not read, no
credential file was searched for, no browser storage or other application's key was used, no key was
invented, and nothing was printed. Had the variable been present, the check would still have stopped at
the approval gate below.

Consequence in the real code path: `resolveApiKey` (`provider-registry.ts:446-457`) substitutes the
documented placeholder `missing-freellmapi_api_key` when the variable is absent. A request sent in this
state would be answered `401 authentication_error` by FreeLLMAPI — that would prove the socket and the
auth rejection path, but it would **not** prove inference works, and §7A forbids presenting it as a
success. P-6's design note (`FREELLMAPI_PROVIDER_APPROVAL_REQUEST.md` §10, P-3) already recorded this.

## 9. Approval gate

Two independent conditions must both hold before one request is sent; **neither holds**:
1. explicit operator approval for exactly one controlled outbound request — **absent**;
2. `FREELLMAPI_API_KEY` present in the process environment — **absent (length 0)**.

## 10. Prepared request plan (the §7 request, ready to execute on approval)

| Field | Value |
|---|---|
| Harness | a dedicated, isolated, **one-shot** script under `runtime/tmp/` that imports the **compiled** `dist/inference/provider-registry.js` and `dist/inference/inference-client.js`, calls `ProviderRegistry.fromConfig(<canonical runtime/home/.automaton/inference-providers.json>)` and then `UnifiedInferenceClient.chat({ tier: "cheap", messages: […] })`. Not a hand-rolled `fetch`, and not `--run`, so the provider resolution, key handling and payload construction under test are the ones the agent would actually use. |
| Endpoint | `http://localhost:3001/v1/chat/completions` (from the deployed config, not hard-coded) |
| Model | `auto` (FreeLLMAPI's virtual router alias — `freellmapi server/src/routes/proxy.ts:47`) |
| Prompt | one minimal, non-sensitive line, e.g. `Reply with the single word: ready` |
| max_tokens | 100 |
| Timeout | 30 000 ms |
| Requests | **1 initial request, 0 retries.** `chat()` on the `cheap` tier would walk `freellmapi → groq → openai`, so the harness must call `chatDirect({ providerId: "freellmapi", modelId: "auto" })` to pin the destination, and must not add a retry. A second attempt requires a separate explicit decision (§7). |
| Credentials | read from `process.env.FREELLMAPI_API_KEY` by the registry itself; never passed as an argument, never written to a file, never logged. `Authorization` headers are not captured. |
| Isolation | `CONWAY_HOME_MODE=isolated`, process-scoped `HOME` only; the global Windows `HOME` is not touched (§13) |
| Classification | success / 401 / 403 / connection refused / timeout / provider unavailable / rate limited / invalid model / invalid response — recorded as observed, with the HTTP status if any |

## 11. RED / GREEN evidence

Not applicable to an unmade request. The closest executed evidence that the plumbing is real:
`runtime/tmp/p20-fallback-tests.log` — 17 tests driving the actual compiled registry + client against the
shipped config with the transport mocked, proving tier resolution, payload construction, retry
classification and failover ordering all work without a network. That is a **mock** result; §20 forbids
calling it a verified provider.

## 12. Regression results

Full root suite unchanged and green at the time of writing: 88 files / 2 175 tests / 0 failed, exit 0
(`runtime/tmp/p20-full-regression.log`). No network-dependent test exists in the suite: §17-style
resolution tests assert the absence of `fetch` calls, and
`freellmapi-provider.test.ts` "resolves all tiers without opening a socket" enforces it.

## 13. Real inference status

**`BLOCKED_NO_CREDENTIAL` + `BLOCKED_APPROVAL`.** `PASS / FAIL` are not applicable — nothing was sent.
The integration's end-to-end behaviour is therefore **unproven**, and no report in this phase claims
otherwise.

## 14. Fallback status

`MOCK_FALLBACK = VERIFIED`; `REAL_FALLBACK = NOT TESTED` (§8C: no automatic contact with OpenAI or
Groq). The two are kept distinct in every artifact.

## 15. Security invariant results

Unchanged — `runtime/tmp/p20-close-invariants.log`. In particular `state.db` byte-identical
(`2a8aeb34…efbba`, 512 000 B, mtime `2026-10-31T10:25:59.744Z`), schema 11, no wallet, activation
still false, treasury limits still zero. `CONWAY_ACTIVATION`, `CONWAY_MIGRATION_APPROVAL` and
`CONWAY_MIGRATION_ALLOW_CANONICAL` remain unset.

## 16. Residual findings

- **F-20-11** The absence of a credential means the *authentication* leg of the A13 integration has
  never been exercised end to end — FreeLLMAPI's 401-on-placeholder behaviour is inferred from
  `freellmapi server/src/lib/inference-auth.ts:13-20`, not measured from Conway. Recorded as
  `FreeLLMAPI Authentication = NOT TESTED (BLOCKED)`.
- **F-20-12** Even a successful one-shot call would prove only that Conway's inference path can reach
  the gateway with a key. It would say nothing about the agent loop, tool safety, treasury behaviour or
  production readiness (§7E). Any acceptance language must repeat that limit.
- **F-20-07** (from the audit) bears on this decision: the gateway answers on the LAN interface too, so
  "localhost" in the request plan is a client-side choice, not a server-side guarantee.

## 17. Rollback instructions

Nothing to roll back: no request, no credential, no config change. If a future approved run misbehaves,
the harness is a single disposable file under `runtime/tmp/` (gitignored at `.gitignore:18`) and the
provider config is unchanged — remove the harness, re-run `p20-close-probe.mjs`, done.

## 18. Final GO / NO-GO

**NO-GO for a real inference request in this phase.** The blocking condition is a decision, not a
defect: **P-ASK-2** in `FINAL_FREELLMAPI_PROGRESS.md` asks the operator for (a) one controlled
`chatDirect` request to FreeLLMAPI and (b) the environment variable to be set for that request. Once
both are granted, §10 above is the exact plan and needs no further design work.
