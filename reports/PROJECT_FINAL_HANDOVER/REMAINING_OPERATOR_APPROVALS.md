# Remaining Operator Approvals

- Date: 2026-11-10
- None of the actions below was performed. This mission's instructions explicitly reserve them for
  the operator, and no approval may be inferred from the mission itself.

## 1. Production schema migration V11 -> V14

**Why it is needed:** the live database lacks six V14 tables (`security_events`,
`security_incidents`, `security_seals`, `treasury_authorizations`, `repair_approvals`,
`repair_approval_events`). Until it is migrated, three health checks have no source and the Repair
Approvals feature cannot persist proposals in production.

**Prerequisites**

1. A fresh, verified backup of `runtime/home/.automaton/state.db` (the backup tool must be used, not
   a plain file copy, because the database is in WAL mode).
2. The operator reads `DATABASE_AND_MIGRATION_READINESS.md` and accepts the object delta
   (6 tables, 17 indexes, 8 triggers, 81 columns).
3. The migration is run with the pinned Node 22.23.4 binary against the canonical HOME, with the
   approval token and the canonical-home token both set to the exact required value.

**Expected result**

```
Schema migrated from 11 to 14; 6 tables, 17 indexes, 8 triggers, 81 columns created.
PRAGMA user_version = 14
PRAGMA integrity_check = ok
```

**Verification after**

- `--status` reports version 14 and integrity `ok`.
- Row counts in all pre-existing tables are unchanged.
- The health headline stops reporting `blocked` for the three source-less checks.
- The dashboard and the agent both read the migrated database.

**Rollback**

Stop the dashboard, restore the pre-migration copy (byte-identical, hash
`2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`), restart. This was exercised on a
disposable copy.

**Risk:** low-to-moderate. Migration is forward-only; rollback is by restore. The migration path was
verified against an archived real backup and against a disposable copy of the live file.

## 2. Live provider inference

**Why it is needed:** the provider plumbing, URL guard, failover and mock behaviour are verified, but
no real model request has been made. A live request is the only way to confirm end-to-end provider
behaviour.

**Prerequisites**

1. Explicit operator authorization for a live request.
2. Credentials supplied through the environment or the existing provider configuration; this report
   does not contain and will not request their values.
3. Confirmation that FreeLLMAPI remains at `http://localhost:3001/v1` and that the request will not
   change its configuration or binding.
4. A bounded request: one model, one short prompt, a small token budget, no tools, no financial
   action, no agent loop.

**Do not**

- print, copy, persist or commit a credential;
- point the request at a different host or port than the configured provider;
- retry a paid x402 request.

**Evidence to capture:** provider id, model id, HTTP status, latency, token usage, and the
redacted request id. No prompt content that contains secrets.

## 3. Wallet creation or restore

**Why it is needed:** the agent cannot transact or hold funds without a wallet, and the project's
own survival model assumes one. This mission explicitly forbids creating or restoring one.

**Prerequisites**

1. A separate written approval that names the chain, the custody model, and the recovery procedure.
2. A decision on where the key material lives and how it is backed up; the existing code can encrypt
   wallet storage, but key custody is an operator responsibility.
3. Acceptance that the first funded wallet changes the threat model: financial tools, treasury
   limits and x402 become live concerns.
4. A test plan for the wallet path that does not use real funds first.

**Never**

- create a wallet to make a check pass;
- restore a wallet from an untrusted archive;
- store a seed phrase in a report, log, chat, or source file.

**Current state:** no wallet address, no wallet file, no key material. The backup and restore tools
refuse wallet material by construction.

## 4. Agent activation

**Why it is needed:** the agent loop, heartbeat and scheduler are not running. Activating them is the
step that turns this from a verified install into an operating agent.

**Prerequisites**

1. A separate written activation approval.
2. The production database migrated (approval 1) or an explicit acceptance that startup will migrate
   it automatically.
3. Provider inference approved (approval 2) and credentials present.
4. A funding decision and treasury policy review; the current policy is all-zero under lockdown.
5. Self-healing decision: keep it disabled for the first run, or approve a bounded enablement.
6. A monitoring window with the dashboard open and a stop procedure ready.

**Not authorized by this mission:** `--run`, `--provision`, setting the activation gate, enabling
financial tools, host shell, self-modification, replication, or external exposure.

**Current state:** `activationApproved=false`, `allowedTools=[]`, all capability flags false,
`maxChildren=0`, no agent process, no heartbeat or scheduler process.

## 5. Optional hardening approvals (not required to operate)

| Item | Why it needs approval | Blast radius |
|---|---|---|
| DNS-pinned dispatcher for provider fetch | Closes the check/connect window described in `B9_URL_GUARD_RUNTIME_VERIFICATION.md` | Adds a transport dependency or replaces global fetch; all provider requests |
| Stricter loopback port allowlist | The current rule allows HTTP to any loopback port; a port allowlist would be narrower | Would break local providers on other ports (e.g. Ollama 11434) unless explicitly listed |
| Timeout for Solana USDC balance | Currently no explicit timeout; unreachable with no wallet | Small, provider-specific |
| Refresh `reports/health-latest.json` on a schedule | The dashboard reports it as stale (14087 minutes at last observation) | Low; operational scheduling |

## 6. Approval record

No approval was granted or implied during this mission. The four actions in sections 1-4 remain
unapproved, and the system is intentionally left in the state described in
`FINAL_ACCEPTANCE_MATRIX.md`.
