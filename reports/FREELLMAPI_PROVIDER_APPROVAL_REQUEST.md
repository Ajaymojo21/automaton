# A13 (proposed) — FreeLLMAPI as an inference provider in Conway

**Status at the time this document was written: REQUEST ONLY. NOTHING WAS APPLIED.** No Conway
source file, no config file, no provider file and no live-tree path was created, modified or
deleted in order to produce this document. The live tree is byte-identical to the state certified
in `reports/PHASE_19_PROGRESS.md` §5 (proof in §7 below).

> **STATUS UPDATE (2026-11-01, additive — the paragraph above is left intact as the record of
> what was true when this request was filed).** A13 was subsequently approved and **A13.1 was
> implemented**, test-first, with the §13 probe re-run and the config baseline extended. The
> outcome, the exact write set, the executed test evidence and the honest attribution of who
> approved what are recorded in
> [`reports/A13_FREELLMAPI_IMPLEMENTATION_REPORT.md`](file:///<repo-root>/reports/A13_FREELLMAPI_IMPLEMENTATION_REPORT.md).
> Decisions P-1…P-6 were resolved as: **P-1 = A13.1** (not A13.2, not A13.3); **P-2 = loopback
> `http://localhost:3001/v1`**; **P-3 = token via `FREELLMAPI_API_KEY` env var only, never
> stored in the tree**; **P-4 = preferred on all three tiers, with openai/groq retained as
> fallbacks**; **P-5 = no network probe performed** — §3 was closed by read-only inspection of
> FreeLLMAPI's own source plus `netstat`, without contacting or modifying it; **P-6 = not
> implemented** — the §4.1 gap (the registry path does not validate the URL scheme) remains an
> open, recorded finding because closing it requires a source change, which is unapproved.
> Sections 1–9 below are the original request and are **not** edited further; where this update
> contradicts them, the update and the implementation report are current.

Requested by: the operator ("please add freellmapi also in conway", 2026-11-01).
Prepared by: the agent, under the Phase 19 §2 strict approval protocol, which says
"Do not assume that running this prompt automatically approves every item" and
"Stop before applying unapproved changes."

**ID note.** The Phase 19 mandate's decision list runs A1–A12 plus B1–B5. "A13" is **not** a
mandate item — it is a new ID this agent invented for a request that falls outside the Phase 19
scope. Phase 19 is closed and this document does not amend it. If the operator prefers a
different label, the content is unaffected.

---

## 1. What "add FreeLLMAPI" could mean — three distinct changes

Conway has **two separate inference paths**, and "add a provider" means a different edit in each.

| Option | What it does | Files touched | Code change? |
|---|---|---|---|
| **A13.1 — registry provider record** | Gives FreeLLMAPI a slot in the tier-based failover used by the agent loop and workers | **new** file `runtime/home/.automaton/inference-providers.json` | No |
| **A13.2 — `ollamaBaseUrl` reuse** | Points Conway's existing "local OpenAI-compatible backend" setting at FreeLLMAPI | `automaton.json` (`ollamaBaseUrl`, `inferenceModel`, possibly `modelStrategy`) via `--configure` | No |
| **A13.3 — built-in provider** | Ships FreeLLMAPI as a `DEFAULT_PROVIDERS` entry like `openai`/`groq`/`together`/`local` | `src/inference/provider-registry.ts`, tests, docs | **Yes** |

A13.1 and A13.2 both write into the **canonical runtime tree**, which the Phase 19 §13/§14
protections cover; A13.3 is a source change that needs A7-style change control, which is
**still not approved**. Nothing in this document claims that A2/A3 approval extends to any of
them — that approval covered the migration runner and read-only status only.

**Recommendation: A13.2, then A13.1.** A13.2 reuses a path that already has a loopback
allowance and already has a configuration UI; A13.1 is config-only but has a sharp edge
(§4.2). A13.3 is not recommended until the unknowns in §3 are resolved and the A4 config
write-boundary gate is approved, because it hard-codes a third-party endpoint into source that
ships with the repo.

## 2. Verified current state (read-only, this session)

`runtime/home/.automaton/` contains exactly: `automaton.json`, `heartbeat.yml`, `skills/`,
`state.db`, `state.db-shm`, `state.db-wal`. **There is no `inference-providers.json`** — so the
registry is running on `DEFAULT_PROVIDERS`, and the model-strategy block is absent from the
config.

`automaton.json` — SHA-256 `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d`,
1382 B, mtime `2026-10-31T10:56:18.616Z`. This **equals** the value registered in
`PHASE_19_PROGRESS.md` §5, i.e. unchanged since Phase 19 closed. Field values inspected
(non-secret only; secret fields were measured by **length**, never printed):

| Key | Current value |
|---|---|
| `inferenceModel` | `gpt-5.2` |
| `conwayApiUrl` | `https://api.conway.tech` |
| `ollamaBaseUrl` | **absent** |
| `modelStrategy` | **absent** |
| `conwayApiKey` / `openaiApiKey` / `anthropicApiKey` | length **0** each |
| `walletAddress` | length **0** (no wallet) |
| `maxChildren` | `0` |
| `registeredWithConway` | `false` |
| `security.lockdown` / `activationApproved` / `allowedTools` | `true` / `false` / `[]` |

The relevant code, as it exists today:

- `src/agent/loop.ts:175` loads `path.join(stateDir(), "inference-providers.json")` and
  `:176` builds the registry with `ProviderRegistry.fromConfig`; `:180-182` calls
  `registry.overrideBaseUrl("openai", process.env.OPENAI_BASE_URL)` when that env var is set.
- `src/inference/provider-registry.ts:71` `DEFAULT_PROVIDERS` = `openai` (enabled, priority 1),
  `groq`, `together` (priority 3, **`enabled: false`** `:205`), and `local` — a loopback
  OpenAI-compatible provider at `http://localhost:11434/v1` with
  `apiKeyEnvVar: "LOCAL_API_KEY"`, zero cost, priority 10, **`enabled: false`** (`:207-239`).
  **The pattern FreeLLMAPI would fit already exists in the code.**
- `:432-444` `buildResolvedModel` constructs `new OpenAI({ apiKey, baseURL: provider.baseUrl })`.
- `src/conway/inference.ts:36` `isLoopbackHttpUrl` → `:55` `allowHttpOnLoopback`, and `:115`
  picks the backend base URL per provider. `src/conway/http-client.ts:15-40` `assertSecureUrl`
  refuses non-HTTPS except loopback (`localhost`, `127.0.0.1`, `::1`) when explicitly allowed;
  `src/types.ts:721` defaults `allowHttpOnLoopback: false`.
- `src/setup/configure.ts:208` prompts for the Ollama base URL, `:224` honours
  `OLLAMA_BASE_URL`, `:239-240` sets `inferenceModel`; `src/setup/model-picker.ts:40-43,76-80`
  does the same for model selection. Both write through `saveConfig`
  (`src/setup/configure.ts:329,334,339,344`, `src/setup/model-picker.ts:80`).
- `src/types.ts:1245` `ModelProvider = "openai" | "anthropic" | "conway" | "ollama" | "other"` —
  a closed union. A FreeLLMAPI entry in the model registry can be labelled `"other"` with no
  type change, but `src/conway/inference.ts:187-189` only special-cases `"ollama"` when choosing
  a backend.

## 3. What is still UNKNOWN and must come from the operator

These are not gaps in the analysis; they are facts the agent cannot obtain without either the
operator's answer or a separately authorized outbound probe. **FreeLLMAPI itself will not be
modified** — Phase 19 §14 lists it among environments that must never be touched.

1. **Transport endpoint.** `http://localhost:<port>/v1`? Which port? Is it loopback-only or a
   LAN/remote host? A non-loopback URL changes this from "local plumbing" to an external egress
   path and would need the §13 "no external exposure" ruling revisited first.
2. **Authentication.** Does it require a token/header at all? If yes, its value must live in an
   environment variable (`FREELLMAPI_API_KEY`), never in `automaton.json`, never in source,
   never in a log or report, and never printed. Conway already reads the key named by each
   provider's `apiKeyEnvVar` at `provider-registry.ts:446-450`.
3. **Model IDs and tiers.** Which model names does it serve, and which Conway tier
   (`reasoning` / `fast` / `cheap`) should each map to? `resolveCandidates` matches
   `model.tier === effectiveTier` (`:327`) and silently skips a provider that has no model in
   the requested tier.
4. **Context/output window and capability flags** (`supportsTools`, `supportsVision`,
   `supportsStreaming`) — wrong values here produce truncated or failed calls, not a loud error.
5. **Cost.** `costPerInputToken` / `costPerOutputToken` feed the budget tracker
   (`src/inference/budget.ts`). For a free local service, `0`/`0` matches the `local` provider.
6. **Intended role.** Is FreeLLMAPI meant to be the primary inference path, a fallback, or only
   a cheap/offline tier? This decides `priority` and `tierDefaults`.

Until 1–3 are answered, A13.1/A13.3 cannot be specified precisely enough to implement safely.

## 4. Design consequences the operator should see before approving

### 4.1 The provider-registry path does not enforce HTTPS
`buildResolvedModel` (`provider-registry.ts:434-437`) hands `provider.baseUrl` straight to the
OpenAI SDK. There is no `assertSecureUrl` call on that path — `src/inference/inference-client.ts`
contains no URL-scheme validation at all. The HTTPS requirement exists only on the Conway API
client (`src/conway/http-client.ts:68`). Consequence: an `http://` — including a **non-loopback**
`http://` — provider base URL is accepted today without complaint. Any A13 implementation that
adds a plain-HTTP provider should therefore add a validation gate at the same time (loopback-only
`http`, mirroring `LOOPBACK_HOSTS`), or it silently widens a hole that §13 was written to keep
shut. This asymmetry predates Phase 19 and was found while preparing this request; it is
recorded here rather than back-dated into the closed Phase 19 findings table.

### 4.2 A provider config file **replaces** the provider list
`fromConfig` (`:283-286`): if the JSON's `providers` array yields one or more valid entries, it
**becomes the entire list** — `DEFAULT_PROVIDERS` is discarded, not merged. So an
`inference-providers.json` that mentions only FreeLLMAPI would remove `openai`, `groq` and
`together` from failover. The file must therefore restate every provider that should remain
available. There is no merge semantics to rely on.

### 4.3 A provider without its env var sends a placeholder token
`resolveApiKey` (`:446-457`) returns `missing-<envvar lowercased>` for any provider whose
`apiKeyEnvVar` is unset; only `id === "local"` is special-cased to `"local"`. A new
`freellmapi` id with no env var set would therefore put the literal string
`missing-freellmapi_api_key` in an `Authorization` header. Depending on the server, that is
either a 401 or — worse — an accepted anonymous call that masks a misconfiguration. Options:
reuse `id: "local"` (A13.1/A13.2 with no code change), or change the keyless-provider rule to be
loopback-based rather than id-based (A13.3, needs its own test).

### 4.4 Config writes bypass the agent-facing protections
`automaton.json` is protected from the agent's own file tools (`src/agent/policy-rules/path-protection.ts:18`,
`src/agent/policy-rules/authority.ts:19`, `src/security/sandbox.ts:123`), but `--configure` and
the model picker write it through `saveConfig` with no such gate, and
`src/agent/tools.ts:2175-2182` lets a running agent mutate `inferenceModel` and persist it. The
unapproved A4 item was exactly the config write-boundary gate. Adding a provider while A4 is
unapproved does not wait for it — but the operator should know that the write itself is
ungated.

## 5. §13 invariant impact

| §13 invariant | Effect of A13 | Action |
|---|---|---|
| "No credentials entered" | **Shifts only if** FreeLLMAPI needs a token (§3.2). A keyless loopback endpoint leaves it intact. | If a token is needed, it goes to an env var in the process scope only — never to `automaton.json`, source, log, or report. Operator supplies it at run time. |
| "No external exposure" | A **loopback** endpoint is not exposure *of* Conway, but it is a new outbound connection *from* Conway to another local process. A non-loopback URL is a different decision. | Needs an explicit operator ruling recorded in this file before implementation. |
| "No agent process started" | Unaffected — a provider record is inert until the agent runs, and the agent stays lockdown-gated. | Verify `security.lockdown=true`, `activationApproved=false`, `allowedTools=[]` after the change. |
| "No financial tool / transaction / wallet / treasury zeros / `x402AllowedDomains=[]`" | Unaffected — inference providers are not in the treasury path. | Re-verify with the existing probe. |
| "Self-healing disabled / no heartbeat schedule" | Unaffected. | Re-verify. |
| "Canonical HOME preserved" / "correct process-scoped HOME" | Applies to every command run during the change. | Pinned Node 22.23.4 + `HOME` pinned to the canonical runtime home, as in Phase 19. |
| "Live schema V11 / no V12-V13 applied" | Unaffected — no migration, no database write. | Re-verify `schema_version` and `state.db` hash. |

`automaton.json` hash `1c10ecc5…` **will change** if A13.2 is chosen, and a new
`inference-providers.json` **will appear** if A13.1 is chosen. Both are registered, disclosed
baseline moves — see §7.

## 6. Test plan (test-first; nothing here runs against the live tree)

Mandate §4/§5 still applies to any future implementation: disposable fixtures only, never the
live `state.db` as a test fixture, and never run a new command against the live database.

1. **RED** — new test file `src/__tests__/inference/freellmapi-provider.test.ts` (name subject to
   §3 answers), asserting: the provider record parses through `normalizeProviders`
   (`provider-registry.ts:515`) with the intended `baseUrl`/`apiKeyEnvVar`/tier set; a loopback
   `http` URL is accepted; a **non-loopback** `http` URL is refused; `openai`/`groq`/`together`
   remain resolvable when the file is present (the §4.2 replacement hazard); unset key produces
   the documented behaviour, not a silent bogus bearer token. Run and capture the failure reason
   in `runtime/tmp/`.
2. **GREEN** — smallest change that satisfies it, then `tsc --noEmit` and `tsc` both exit 0.
3. **No-network proof** — a test that instantiates the registry and asserts that
   `resolveModel`/`resolveCandidates` perform **no fetch**; resolution must not open a socket
   before the agent decides to call.
4. **Failover** — extend the pattern in `src/__tests__/integration/inference-failover.test.ts`:
   FreeLLMAPI unavailable ⇒ registry falls back, and the fallback list still contains the
   originally enabled providers.
5. **Suite** — full root regression, not only focused tests. Phase 19's baseline was
   86 files / 2 143 tests / 0 failed; if counts move, the reason is stated, never absorbed.
6. **Live-tree verification after the change** — re-run the surviving Phase 19 probe
   `runtime/tmp/p19-close-invariants.cjs` (pinned Node, `HOME` pinned, database opened
   `{readonly: true, fileMustExist: true}`) and quote its output verbatim in the implementation
   report, including the WAL sidecar mtimes.
7. **Coverage** — ≥80 % on any new logic. No test reported as passed unless it ran and passed.

## 7. Rollback and re-baseline

**Baseline (recorded now, measured read-only this session):**
- `automaton.json` — SHA-256 `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d`,
  1382 B, mtime `2026-10-31T10:56:18.616Z`.
- `inference-providers.json` — **does not exist**.
- `state.db` — `2a8aeb34…`, 512 000 B, mtime `2026-10-31T10:25:59.744Z`; `schema_version` 11;
  V12/V13 tables absent.

**Rollback per option.** A13.1: delete the one file created (it is a file this change owns) →
registry returns to `DEFAULT_PROVIDERS`. A13.2: restore `automaton.json` from the byte copy taken
immediately before the write → hash returns to `1c10ecc5…`. A13.3: revert the source commit —
which assumes a git baseline that does not exist yet (Phase 19 F-19-04: no git delta available,
A7 unapproved). **A13.3 therefore has no clean rollback path until A7 is approved.**

**Re-baseline procedure after any approved A13 step:** re-hash every file the change touched,
append the old value with **SUPERSEDED** rather than overwriting it (the standing convention),
re-state the whole §13 invariant set from the probe output, and record what a reader should now
expect the config hash to be.

## 8. What approving A13 would NOT mean

- Not activation. `security.activationApproved` stays `false` and `CONWAY_ACTIVATION` stays
  unset; §2 forbids combining a code-remediation approval with agent activation.
- Not migration. Live schema stays V11; V12/V13 remain unapplied; no gate token is reused.
- Not A4/A5/A6/A7/A8. The config write-boundary gate, emergency stop, audit chain, git baseline
  and staged-set secret scan are all still unapproved, and A13 does not smuggle any of them in.
- Not touching FreeLLMAPI. §14 prohibits modifying it; this is a Conway-side change only.
- Not a live-DB test fixture, not a network call made from this document, and not evidence that
  any test has run — none has, because nothing was implemented.

## 9. Decisions requested

| # | Question | Choices |
|---|---|---|
| P-1 | Which option? | A13.2 (reuse `ollamaBaseUrl`) / A13.1 (`inference-providers.json`) / A13.3 (source) / decline |
| P-2 | Endpoint and transport | loopback `http://localhost:<port>/v1` (port from operator) / https / decline to say |
| P-3 | Credential | no token needed / token via `FREELLMAPI_API_KEY` env var (operator supplies at run time; never stored in the tree) |
| P-4 | Role | primary / fallback / cheap tier only |
| P-5 | May the agent probe the endpoint read-only (`GET /v1/models`) to fill §3 itself? | yes, once / no |
| P-6 | Add the §4.1 loopback-only URL validation to the registry path as part of A13? | yes / no (leaving it as a recorded finding) |

Answers to P-1…P-4 are enough to write an implementation plan. P-5 and P-6 change what the plan
has to prove.

## 10. Resolution (appended after implementation — §9 above is the original, unedited request)

| # | Question | Outcome |
|---|---|---|
| P-1 | Which option? | **A13.1** — `runtime/home/.automaton/inference-providers.json`, config only. No Conway source file was modified. A13.2 and A13.3 were not done. |
| P-2 | Endpoint and transport | **loopback `http://localhost:3001/v1`** — port 3001 read from FreeLLMAPI's own `server/src/lib/config.ts:85`, not guessed. |
| P-3 | Credential | **env var only** (`FREELLMAPI_API_KEY`). Nothing was stored in the tree, and a test asserts the config file contains no secret-shaped string. |
| P-4 | Role | **preferred on all three tiers** (`reasoning`/`fast`/`cheap`), with `openai`/`groq`/`together`/`local` retained in the fallback order and all four default providers restated verbatim — because a config file *replaces* the provider list (§4.2), it does not merge. |
| P-5 | Read-only probe of `/v1/models`? | **Not performed.** All §3 unknowns were closed from FreeLLMAPI source + `netstat`. No request was ever sent to it and nothing of its was modified. |
| P-6 | Add loopback-only URL validation to the registry? | **Not implemented.** Remains an open finding: `buildResolvedModel` still accepts any `baseUrl` scheme. Needs a source change, which is unapproved. |

Full evidence — approval attribution, the three-file inventory with hashes, the RED/GREEN logs,
the deployed-file proof, the re-run §13 probe and the rollback procedure — is in
`reports/A13_FREELLMAPI_IMPLEMENTATION_REPORT.md`.
