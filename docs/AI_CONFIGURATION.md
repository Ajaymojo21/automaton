# AI CONFIGURATION — Phase 5

**Status:** CONFIGURED WITH PLACEHOLDERS ONLY — **no credentials entered**
**Model configured:** `gpt-5.2` (upstream default)
**Providers modified:** none

---

## 1. Current state

The instantiated config at `runtime/home/.automaton/automaton.json` contains:

```json
"conwayApiUrl": "https://api.conway.tech",
"conwayApiKey": "",
"openaiApiKey": "",
"anthropicApiKey": "",
"ollamaBaseUrl": "",
"inferenceModel": "gpt-5.2",
"maxTokensPerTurn": 4096
```

All credential fields are empty strings. No key was entered, generated, or copied
from any existing environment. No `.env` file was created.

Because `conwayApiKey` is empty and the default model resolves to the Conway
backend, an activated run would fail at the inference layer until a provider is
deliberately configured. That is the intended safe state: the process cannot spend
inference credits it does not have.

---

## 2. How provider routing works (from source)

`src/conway/inference.ts` resolves a backend in this order:

1. **Model registry lookup** — `getModelProvider(model)`:
   - `ollama` → only if `ollamaBaseUrl` is set
   - `anthropic` → only if `anthropicApiKey` is set
   - `openai` → only if `openaiApiKey` is set
   - `conway` → always eligible
2. **Name heuristics** — `claude*` → Anthropic; `gpt-*`/`o1..o9`/`chatgpt` → OpenAI.
3. **Fallback** — Conway API.

This means:

- Setting `inferenceModel` alone does **not** select a provider; the matching key
  must also exist, otherwise the request falls through to Conway.
- An `ollamaBaseUrl` pointing at the existing local Ollama would let the agent use
  local models. **This was not configured.** The existing Ollama installation and
  its models are protected by the task rules and were not queried, modified, or
  repointed.

---

## 3. Provider options and requirements

### Option A — Conway Cloud (no change to local AI stack)

| Field | Value |
|---|---|
| `conwayApiUrl` | `https://api.conway.tech` (default) |
| `conwayApiKey` | required; obtain from Conway |
| `registeredWithConway` | must be `true` for cloud sandbox mode |
| Cost | Conway credits, purchased by a human |

**Approval required before entering the key.** Entering a paid API credential is an
explicit gate in the task rules. No key was requested or stored.

### Option B — OpenAI-compatible endpoint

| Field | Value |
|---|---|
| `openaiApiKey` | required |
| `inferenceModel` | must match an OpenAI model id, e.g. `gpt-5.2` |
| Cost | per-token billing on your OpenAI account |

**Approval required.** Also note that pointing `conwayApiUrl` at a third-party
OpenAI-compatible proxy is possible in code but would send prompts and data to that
proxy; do not do it without a data-handling decision.

### Option C — Anthropic

| Field | Value |
|---|---|
| `anthropicApiKey` | required |
| `inferenceModel` | must start with `claude` for the heuristic path |

At runtime the agent loop copies `config.anthropicApiKey` into
`process.env.ANTHROPIC_API_KEY` if the variable is absent
(`src/agent/loop.ts`). This is process-local, not a persistent environment change.

### Option D — Existing local Ollama

| Field | Value |
|---|---|
| `ollamaBaseUrl` | e.g. `http://127.0.0.1:11434` |
| Model | must be registered with provider `ollama` |

**Not configured.** The existing Ollama service is on the protected list. Using it
would not modify it, but it would create load and couple this agent to that
installation. Treat this as a separate, explicit decision.

---

## 4. Protected environments — confirmation

| Environment | Port | Action taken |
|---|---|---|
| FreeLLMAPI | `localhost:3001` | Not contacted, not modified |
| Ollama | `localhost:11434` | Not contacted, not modified, no model pulled |
| OpenCode | local config | Not read or modified |
| Qoder | local config / MCP | Not modified |
| Existing MCP servers | — | Not modified |
| TradingAgents / ADRE-RN / Paperclip | — | Not touched |
| Existing env vars | — | Not changed; runtime sets `HOME`, `COREPACK_HOME`, `PATH` for child processes only |

The installation binds no network listener. `netstat` inspection during the audit
showed no Automaton-owned listener.

---

## 5. Cost controls currently in force

| Control | State | Enforcement |
|---|---|---|
| Bootstrap `$5` top-up on start | Disabled by lockdown | Code guard in `src/index.ts`: skipped unless `!lockdown` or `allowFinancialTools` |
| Heartbeat USDC balance check / auto top-up | Returns `shouldWake:false` under lockdown | `src/heartbeat/tasks.ts` |
| `maxInferenceDailyCents` | `0` | See [TREASURY_SECURITY.md](TREASURY_SECURITY.md) — **0 does not necessarily mean "block all"**; read that document before activation |
| Inference spending without credentials | Impossible | Empty keys |

**No AI credits were purchased. No provider trial was started. No model was pulled.**

---

## 6. What a human must do to enable inference

1. Choose one provider above and obtain its credential through that provider's
   normal account flow.
2. Approve the spend and the credential entry explicitly.
3. Put the key in `runtime/home/.automaton/automaton.json` (or a secret manager,
   then inject it at launch). The config file is ACL-restricted to the current
   Windows user and is written with mode `0600` by the app.
4. Never commit the config file. `.gitignore` already excludes runtime artifacts;
   verify with `git status` before any commit.
5. Run `SECURITY_AUDIT.bat`; it checks logs for credential patterns but never
   prints key values.
