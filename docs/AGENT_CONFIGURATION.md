# AGENT CONFIGURATION — Phase 8

**Identity:** not registered, no wallet
**Autonomy:** disabled (activation gate closed)
**Agent state:** `setup`
**Configured children:** 0

---

## 1. Runtime configuration (current)

File: `runtime/home/.automaton/automaton.json`

| Field | Value | Meaning |
|---|---|---|
| `name` | `automaton-local` | Local label; not registered with Conway |
| `genesisPrompt` | "You are a supervised local test instance. Do not perform financial, replication, self-modification, or external exposure actions." | Explicitly constrains the agent's self-description |
| `creatorAddress` | `0x000…0000` | Placeholder, not a real creator |
| `registeredWithConway` | `false` | No cloud registration |
| `sandboxId` | `""` | Local mode, not Conway Cloud |
| `walletAddress` | `""` | No wallet |
| `chainType` | `evm` | Default chain family |
| `inferenceModel` | `gpt-5.2` | No provider key configured |
| `maxTokensPerTurn` | `4096` | Per-turn token cap |
| `maxTurnsPerCycle` | `25` | Bounds a heartbeat cycle |
| `maxChildren` | `0` | **Replication disabled at config level** |
| `childSandboxMemoryMb` | `1024` | Inert while `maxChildren` is 0 |
| `logLevel` | `info` | No debug logging of payloads |

The genesis prompt is not a security control by itself; the policy engine and
activation gate are. It is kept as defence in depth and to set expectations if the
agent ever runs.

---

## 2. Security configuration

```json
"security": {
  "lockdown": true,
  "activationApproved": false,
  "allowedTools": [],
  "allowFinancialTools": false,
  "allowHostShell": false,
  "allowSelfModification": false,
  "allowReplication": false,
  "allowExternalExposure": false
}
```

| Flag | Current | Effect when `lockdown: true` |
|---|---|---|
| `allowedTools` | `[]` | **Every** tool call is denied (`TOOL_NOT_ALLOWED`) |
| `allowFinancialTools` | `false` | `financial` category denied; bootstrap/heartbeat top-ups skipped |
| `allowHostShell` | `false` | `exec`, `write_file` denied (`HOST_SHELL_DISABLED`) |
| `allowSelfModification` | `false` | `self_mod` category denied |
| `allowReplication` | `false` | `replication` category denied (children also capped at 0) |
| `allowExternalExposure` | `false` | `expose_port`, `remove_port`, `register_domain` denied |

Additional controls independent of the flags:

- **Activation gate** — `security.activationApproved` must be `true` **and**
  `CONWAY_ACTIVATION=APPROVED` must be present, or `--run` exits 2 before identity
  or wallet initialisation.
- **Config normalisation** — invalid or missing security values fail closed:
  booleans are coerced with `=== true`, and a non-array allowlist becomes `[]`.
- **`maxChildren: 0`** — even if the replication policy flag were flipped, the
  numeric cap still blocks child creation.

---

## 3. Heartbeat configuration

File: `runtime/home/.automaton/heartbeat.yml`

| Task | Schedule | Enabled | Notes |
|---|---|---|---|
| `heartbeat_ping` | every 15 min | Yes | Liveness only |
| `check_credits` | every 6 h | Yes | Reads balance; with no Conway key it will error harmlessly |
| `health_check` | every 30 min | Yes | Local health signal |
| `check_usdc_balance` | every 5 min | **No** | Would trigger auto top-ups; also hard-guarded under lockdown |
| `check_for_updates` | every 4 h | **No** | Avoids unsolicited code changes |
| `check_social_inbox` | every 2 min | **No** | Avoids external social surface |

`defaultIntervalMs: 60000`, `lowComputeMultiplier: 4`.

The heartbeat daemon does not run unless the main process runs, which is gated by
activation. Under lockdown, `check_usdc_balance` returns `{shouldWake:false}` even
if someone re-enables it in YAML (`src/heartbeat/tasks.ts`).

---

## 4. Skills

`runtime/home/.automaton/skills/` is **empty**. No third-party skill was installed.
Upstream skill packs can execute code and call tools; adding any is a separate
review decision. If skills are added later:

1. Read every file before installation.
2. Keep the tool allowlist empty or minimal.
3. Re-run `SECURITY_AUDIT.bat`.
4. Do not install skills that request shell, network exposure, or financial tools.

---

## 5. Context and SOUL files

| File | Present in runtime home | Note |
|---|---|---|
| `constitution.md` | No | Upstream copy exists at repository root; not loaded from there |
| `SOUL.md` | No | Not created |
| `state.db` | Yes | SQLite store; empty agent state |

The absence of `SOUL.md` and a runtime constitution means the agent has no
project-specific behavioural charter beyond `genesisPrompt`. This is acceptable for
an inactive installation; add them deliberately before activation if desired, and
remember they are readable by the agent.

---

## 6. State database

`runtime/home/.automaton/state.db` was created by `--status` and passes
`PRAGMA quick_check`. Current contents: zero turns, zero tool calls, zero
transactions, zero children, zero heartbeat executions, zero policy denials.
The DB is protected by the `runtime/home` ACL and included in backups via the
SQLite online backup API.

---

## 7. What activation would change

Activation does **not** automatically relax the security flags. Even with
`activationApproved: true` and the env token:

- `allowedTools: []` still denies every tool;
- all capability flags remain `false`;
- `maxChildren: 0` remains;
- no wallet exists unless the separate wallet gate is passed;
- no inference provider key exists.

Activation only allows the process to start and initialise identity. Capability must
then be granted flag by flag, with the allowlist populated by tool name. This is
intentional: starting the runtime and granting powers are separate decisions.

---

## 8. Phase verdict

**COMPLETE.** The agent is configured, identifiable, and inert. No identity,
registration, child, skill, tool, or heartbeat capability can act without a
deliberate, multi-step human change.
