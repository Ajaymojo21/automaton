# Pre-Activation Readiness Audit — Tool Permission Audit

## 1. Tool authorizer

`src/security/tool-authorizer.ts` classifies every tool by capability and enforces a
deny-by-default policy:

- **allow-by-name**: tool name in `security.allowedTools` → allowed.
- **allow-by-capability**: all required capabilities in `security.allowedCapabilities` → allowed.
- **otherwise**: denied with `NOT_ALLOWLISTED` and the missing capabilities listed.

Decision order: revoked list → unclassified (`UNCLASSIFIED_TOOL`) → allow-by-name →
allow-by-capability → deny. Deny is the fallthrough.

## 2. Enforcement point

Authorization is called in `src/agent/tools.ts:3462`, **immediately before tool execution**, with the
database handle (so every decision is written to the audit chain). It is not a prompt-level check —
it runs in code.

## 3. Live denial evidence

Six restricted tools were called against the live config (no db handle, so no side effects):

| Tool | Required capabilities | Decision |
|---|---|---|
| `transfer_credits` | financial, wallet_signing, network_access | `NOT_ALLOWLISTED` |
| `x402_fetch` | financial, network_access, wallet_signing | `NOT_ALLOWLISTED` |
| `spawn_child` | agent_spawning, administrative | `NOT_ALLOWLISTED` |
| `edit_own_file` | administrative, filesystem_write | `NOT_ALLOWLISTED` |
| `send_message` | network_access, external_api | `NOT_ALLOWLISTED` |
| `system_synopsis` | read_only | `NOT_ALLOWLISTED` |

**Even read-only tools are denied** because `allowedCapabilities` is empty. The posture is
"nothing granted", not "safe things granted".

## 4. Financial tools

All four financial tools (`transfer_credits`, `x402_fetch`, `fund_child`, `topup_credits`) are
classified as financial and denied at the authorizer. Even if the authorizer were bypassed, the
treasury guard (centralized, with lockdown → all zeros) would deny. Defense in depth.

## 5. Shell and self-modification

- Host shell: `allowHostShell = false`; shell-capable tools require `shell_execution` capability.
- Self-modification: `allowSelfModification = false`; `edit_own_file`, `revert_last_edit`,
  `reset_to_upstream` require administrative + filesystem_write.
- MCP installation: requires administrative + network + shell.
- Skill installation: requires administrative + filesystem + network.

## 6. Verdict

Tool permissions are enforced in code at execution time, not by prompt. All restricted tools are
denied. The authorizer is deny-by-default with a typed reason code and missing-capability list.
No unguarded tool path was found.
