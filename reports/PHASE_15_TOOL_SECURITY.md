# Phase 15D — Centralized Tool Permission System

**Date:** 2026-10-31
**Status:** PASS (with documented residuals)
**Scope:** every builtin tool dispatch, independent of model prompts.

## 1. Objective

Replace prompt-level "please do not use that tool" guidance with an
authorization layer that the model cannot talk its way past:

- default **DENY ALL**;
- explicit allowlisting by tool name or by capability class;
- least privilege — a tool runs only when **all** of its capability classes are
  granted;
- identity, argument-hash audit, revocation, timeout and output bounds;
- identical enforcement for direct (`executeTool`) and indirect (nested /
  installed-tool) invocation.

## 2. Implementation

| Piece | File |
|---|---|
| Capability classification + decision engine | `src/security/tool-authorizer.ts` |
| Dispatch integration (authorize → policy → treasury → timeout → execute) | `src/agent/tools.ts` (`executeTool`) |
| Audit sink | `src/security/audit-chain.ts` (hash-chained `security_events`) |
| Config normalization (fail closed) | `src/config.ts` (`normalizeSecurityConfig`) |
| Types / defaults | `src/types.ts` (`ToolCapability`, `SecurityConfig`) |

### Capability model

Eleven classes: `read_only`, `filesystem_read`, `filesystem_write`,
`shell_execution`, `network_access`, `external_api`, `financial`,
`wallet_signing`, `agent_spawning`, `publishing`, `administrative`.

All **77** builtin tools have an explicit entry in `TOOL_CAPABILITIES`
(e.g. `transfer_credits → financial + wallet_signing + network_access`). A
category fallback exists for tools that are not builtins, and a test asserts
that no builtin relies on it (`isExplicitlyClassified`).

### Decision order

1. `revokedTools` contains the name → **TOOL_REVOKED** (deny).
2. No capability classification → **UNCLASSIFIED_TOOL** (deny).
3. Name is in `allowedTools` → allow (explicit human allowlist).
4. Otherwise every capability must be granted through `allowedCapabilities` or a
   legacy flag (`allowHostShell → shell_execution + filesystem_write`,
   `allowFinancialTools → financial + wallet_signing`,
   `allowSelfModification → administrative`, `allowReplication → agent_spawning`,
   `allowExternalExposure → publishing + network_access`).
   Any missing capability → **NOT_ALLOWLISTED** (deny).

A missing `security` block is treated as `DEFAULT_SECURITY_CONFIG`, whose
allowlist and capability grants are empty — so an unconfigured install executes
no tools at all.

### Audit

Every decision appends to the hash-chained `security_events` table:

- allow → `tool.authorized`, severity `INFO`;
- deny → `tool.denied`, severity `MEDIUM`.

Details contain the tool name, capability list, reason code and a SHA-256
**hash** of the arguments — never the raw arguments (verified by a test that
passes a synthetic secret and asserts it is absent from the row).

### Dispatch bounds

- `security.maxToolDurationMs` (default 60 000) — `Promise.race` around the
  tool body; a timed-out financial call releases its treasury reservation.
- `security.maxToolOutputBytes` (default 65 536) — result truncated with an
  explicit `[truncated: N bytes omitted]` marker.

## 3. Enforcement in the dispatch path

`executeTool` order is now:

1. unknown tool → error;
2. **authorizer** (this phase) → `Tool denied: CODE — message`;
3. policy engine (when supplied);
4. centralized treasury guard (financial intent);
5. execute with timeout;
6. sanitize external results, truncate to byte cap;
7. treasury commit/release + spend tracking.

Because the authorizer is first, a policy-engine bypass or a direct call to
`executeTool` cannot reach a tool body without an explicit grant. A wrapper tool
that calls `executeTool` for a second tool is re-authorized on the inner call —
covered by the "nested (indirect) dispatch" test.

## 4. Evidence (executed)

| Check | Command | Result |
|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| 15D suite | `vitest run src/__tests__/phase15-tool-security.test.ts` (Node 22) | **16/16 passed** |
| 15E suite | `vitest run src/__tests__/phase15-sandbox.test.ts` | **46/46 passed** |
| Treasury regression | `vitest run src/__tests__/phase15-treasury.test.ts` | 35/35 passed |
| Policy-engine regression | `vitest run src/__tests__/policy-engine.test.ts` | 26/26 passed |
| Lockdown regression | `vitest run src/__tests__/security-lockdown.test.ts` | passed |
| Legacy tool-security regression | `vitest run src/__tests__/tools-security.test.ts` | 71/71 passed |

15D covers: deny-by-default, all-builtin denial under defaults, explicit
allowlist, all-capabilities requirement, legacy flag mapping, revocation,
unclassified rejection, timeout budget/output cap propagation, tool body never
runs when denied, args hashing without leakage, nested dispatch denial, timeout
enforcement, output truncation, treasury release on timeout, and a verifiable
audit chain.

## 5. Residual risks

1. **Application-level control.** This is in-process authorization. Code that
   does not go through `executeTool` (e.g. future call sites) bypasses it; a
   repository-wide grep for other dispatch paths is part of the 15L regression.
2. **Category fallback.** A non-builtin tool inherits coarse capabilities from
   its category; it still needs an explicit capability grant, but a
   mis-declared category could under-classify a custom tool.
3. **Arg hashing only in the audit row.** Full arguments are not stored, which
   limits forensic reconstruction; the policy/decisions tables retain hashes.
4. **Timeout is cooperative.** A synchronous tool body blocks the event loop and
   cannot be pre-empted by `Promise.race`; the builtin bodies are async/network
   bound, but a CPU-bound plugin would overrun the budget.
5. **Default config grants nothing**, so the live install remains fully inert
   until a human edits `security.allowedCapabilities` / `allowedTools`.

## 6. Live-install posture (unchanged)

The live configuration still has `lockdown: true`, `activationApproved: false`,
empty `allowedTools`, and no capability grants. Under the new authorizer every
builtin tool evaluates to `NOT_ALLOWLISTED`. No activation gate was opened.
