# Phase 15D — Tool Permission System (Operator Guide)

**Control:** an in-process authorization layer decides whether a tool may run. It is independent
of the model, the prompt, and the policy engine, and its default is **deny everything**.
**Status:** implemented, 16 tests executed.
**Evidence:** [`../../reports/PHASE_15_TOOL_SECURITY.md`](../../reports/PHASE_15_TOOL_SECURITY.md)
**Code:** [`src/security/tool-authorizer.ts`](../src/security/tool-authorizer.ts),
dispatch integration in [`src/agent/tools.ts`](../src/agent/tools.ts), normalization in
[`src/config.ts`](../src/config.ts) (`normalizeSecurityConfig`)

> **Live posture:** `lockdown: true`, `allowedTools: []`, no `allowedCapabilities`. Under this
> configuration **every one of the 77 builtin tools evaluates to `NOT_ALLOWLISTED`.** The
> install executes no tools at all until a human edits the config.

---

## 1. Why this exists

Prompt-level "do not use that tool" guidance is not a control — the model can be argued out of
it, and a tool the model never asked for can still be reachable through a wrapper. Phase 15
moved the decision into code that runs before the tool body, on every dispatch.

## 2. The capability model

Eleven classes: `read_only`, `filesystem_read`, `filesystem_write`, `shell_execution`,
`network_access`, `external_api`, `financial`, `wallet_signing`, `agent_spawning`, `publishing`,
`administrative`.

All **77** builtin tools have an explicit entry in `TOOL_CAPABILITIES`. A tool inherits the
**union** of its classes — `transfer_credits` is `financial` + `wallet_signing` + `network_access`,
so granting two of the three does not enable it. A test asserts no builtin relies on the category
fallback (`isExplicitlyClassified`), so a new builtin that is not classified fails the suite
rather than silently inheriting a coarse category.

## 3. Decision order

1. name in `security.revokedTools` → **deny `TOOL_REVOKED`**;
2. no capability classification → **deny `UNCLASSIFIED_TOOL`**;
3. name in `security.allowedTools` → allow;
4. otherwise every capability the tool needs must be granted, through
   `security.allowedCapabilities` or one of the legacy flags:

| Legacy flag | Grants |
|---|---|
| `allowHostShell` | `shell_execution` + `filesystem_write` |
| `allowFinancialTools` | `financial` + `wallet_signing` |
| `allowSelfModification` | `administrative` |
| `allowReplication` | `agent_spawning` |
| `allowExternalExposure` | `publishing` + `network_access` |

Any missing capability → **deny `NOT_ALLOWLISTED`**.

A missing `security` block is normalized to `DEFAULT_SECURITY_CONFIG`, whose allowlist and
capability grants are **both empty**. An unconfigured install therefore runs nothing. The
default fails closed; it does not fail open.

## 4. Where it sits in dispatch — and why the order matters

`executeTool` runs, in order:

1. unknown tool → error;
2. **authorizer** → `Tool denied: CODE — message`;
3. policy engine (only when the caller supplied one — see residual 1);
4. centralized treasury guard (financial intent);
5. execute the body under `maxToolDurationMs`;
6. sanitize external results, truncate to `maxToolOutputBytes`;
7. treasury commit/release + spend tracking.

The authorizer is **first**, so neither a policy-engine bypass nor a direct call to
`executeTool` reaches a body without a grant. The emergency stop is checked before even that
(see [PHASE_15_INCIDENT_RESPONSE.md](PHASE_15_INCIDENT_RESPONSE.md)).

**Indirect invocation is covered.** A tool whose body calls `executeTool` for a second tool is
re-authorized on the inner call — this is the Trojan-wrapper case in the penetration suite, and
it is a test, not an assumption.

## 5. Audit

Every decision appends to the hash-chained `security_events` table:

- allow → `tool.authorized`, severity `INFO`;
- deny → `tool.denied`, severity `MEDIUM`.

`details` holds the tool name, its capability list, the reason code, and a **SHA-256 hash of the
arguments** — never the arguments. A test passes a synthetic secret as an argument and asserts
the secret is absent from the stored row.

## 6. Bounds

| Setting | Default | Effect |
|---|---|---|
| `security.maxToolDurationMs` | 60 000 | `Promise.race` around the body; a timed-out financial call releases its treasury reservation |
| `security.maxToolOutputBytes` | 65 536 | result truncated with an explicit `[truncated: N bytes omitted]` marker |

The timeout is **cooperative**: a synchronous body blocks the event loop and cannot be
pre-empted. The builtin bodies are async/network-bound, so this holds in practice; a CPU-bound
plugin would overrun the budget.

## 7. Granting access safely

Stop the runtime, edit `runtime/home/.automaton/automaton.json`, restart.

```jsonc
"security": {
  "lockdown": true,
  "activationApproved": false,
  "allowedTools": [],                    // prefer capabilities over names
  "allowedCapabilities": ["read_only"],  // least privilege, one class at a time
  "revokedTools": [],
  "maxToolDurationMs": 60000,
  "maxToolOutputBytes": 65536
}
```

**Prefer `allowedCapabilities` to `allowedTools`.** Phase 15I finding **F3** confirmed that a name
in `allowedTools` is a **full grant for that tool, with no capability requirement at all**. The
layers behind it still apply, and tests pin that:

- an `exec` allowlisted by name still cannot run `manage-bde -protectors -get c:`;
- `transfer_credits` allowlisted by name still cannot book 999 999 cents against a 1 000-cent cap;
- an **unclassified** tool is denied even when its name is allowlisted — `UNCLASSIFIED_TOOL` is
  evaluated before the name check, so the list cannot resurrect a renamed or unknown tool;
- a financial tool named in the list is still denied while `allowFinancialTools` is false
  (`security-lockdown` suite).

That is the operator consequence, stated plainly: **never put a financial, spawning, publishing,
shell or self-modification tool into `allowedTools`.** Those classes are meant to be reached
through capabilities plus the policy and treasury layers.

To withdraw a tool while keeping its class granted, add it to `revokedTools`. Revocation is
evaluated first and cannot be overridden by the allowlist or by capabilities.

## 8. Verifying the control yourself

```bash
cd <repo-root>
N=./runtime/node-v22.23.4-win-x64/node.exe
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-tool-security.test.ts   # 16/16
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-sandbox.test.ts         # 46/46
$N node_modules/vitest/vitest.mjs run src/__tests__/tools-security.test.ts          # 71/71
$N node_modules/vitest/vitest.mjs run src/__tests__/policy-engine.test.ts           # 26/26
$N node_modules/vitest/vitest.mjs run src/__tests__/security-lockdown.test.ts       # passed
node node_modules/typescript/bin/tsc --noEmit                                       # exit 0
```

Coverage includes deny-by-default, denial of every builtin under defaults, explicit allowlist
behaviour, the all-capabilities requirement, legacy flag mapping, revocation, unclassified
rejection, timeout and output-cap propagation, "the body never runs when denied", argument
hashing without leakage, nested dispatch denial, timeout enforcement, output truncation, treasury
release on timeout, and a verifiable audit chain.

## 9. Residual risks

1. **Application-level control.** Code that does not go through `executeTool` bypasses this. A
   repository-wide grep for other dispatch paths was part of the 15L regression; any *new* call
   site is on you.
2. **Policy engine still optional** (F7/R-3): `policyEngine` and `turnContext` are optional
   parameters, and rules are skipped when the caller omits them. The authorizer, treasury guard
   and sandbox do not depend on them. See
   [PHASE_15_PENETRATION_TESTING.md](PHASE_15_PENETRATION_TESTING.md).
3. **Category fallback for non-builtin tools** inherits coarse capabilities. It still requires an
   explicit capability grant, but a mis-declared custom category can under-classify.
4. **Only argument hashes are stored.** Forensic reconstruction of exactly what a tool was asked
   to do is limited by design.
5. **Cooperative timeout.**
6. **The default grants nothing**, which is the intended posture — but it also means a freshly
   configured install looks "broken" until a human grants capabilities deliberately.
