# PHASE 15A — SECURITY GAP ANALYSIS

**Audit date:** 2026-10-31
**Commit under audit:** `d8f816881fd24b6f5e3d616e59edec387a447667`
**Method:** fresh source read of wallet, treasury, policy, tool execution, sandbox,
logging, backup, and reliability paths, cross-checked against the Phase 14 reports.
**Install state during audit:** inactive, lockdown on, no wallet, no credentials.

Severity: **CRITICAL / HIGH / MEDIUM / LOW**. "Code-enforced" means an execution path
checks it; a config field alone is not a control.

---

## 1. Known issues confirmed

| ID | Issue | Evidence | Severity |
|---|---|---|---|
| G-01 | Wallet private key stored plaintext, mode `0600` only | `src/identity/wallet.ts:118,136` write JSON with raw key; no encryption layer | HIGH |
| G-02 | `minimumReserveCents` not enforced | `src/agent/policy-rules/financial.ts:181-209` returns `null` unconditionally | HIGH |
| G-03 | `transferCooldownMs` not enforced | referenced only in `src/types.ts` and `src/setup/wizard.ts`; no runtime reader | MEDIUM |
| G-04 | Tools outside treasury policy | `topup_credits` (`src/agent/tools.ts:277`), replication auto-top-up (`:1653-1670`), bootstrap/heartbeat top-ups | HIGH |
| G-05 | No live agent execution validation | activation gate deliberately closed; no ReAct turn ever ran | MEDIUM (by design) |
| G-06 | No penetration test | no adversarial suite existed | MEDIUM |
| G-07 | No soak test | no long-running harness existed | MEDIUM |
| G-08 | BitLocker status unverified | `Get-BitLockerVolume` returned "Access denied" | MEDIUM |
| G-09 | Windows-specific upstream test failures | 21–22 path/POSIX failures; `context-hardening` hangs | LOW |

---

## 2. New issues found in the fresh audit

| ID | Issue | Evidence | Severity |
|---|---|---|---|
| G-10 | No monthly spending window | only `window_hour` / `window_day` in `spend_tracking` (`src/state/schema.ts:213-226`) | HIGH |
| G-11 | No agent-level or child-level budget | `TreasuryPolicy` has no budget field; no aggregation by child | HIGH |
| G-12 | Spend check is read-then-execute with no serialization | rules read `spend_tracking`, then tool executes; two calls in one process can both pass | HIGH |
| G-13 | No duplicate/replay prevention | identical `transfer_credits` args can be repeated until limits trip | HIGH |
| G-14 | x402 spend recorded as `0` cents | `src/agent/tools.ts:3375` | MEDIUM |
| G-15 | `quarantine` has no approval channel and is silently converted to denial | `src/agent/tools.ts:3330`; no operator approval path | LOW (fail-closed) |
| G-16 | Policy is skipped entirely if `policyEngine`/`turnContext` absent | `src/agent/tools.ts:3320` | HIGH (if a caller omits them) |
| G-17 | Windows path confinement compares with `+ "/"` | `src/agent/tools.ts:45`; resolved Windows paths use `\`, so either legitimate writes are blocked or the boundary is unreliable | HIGH |
| G-18 | No symlink/junction escape check on writes | `path.resolve` alone does not resolve links | HIGH |
| G-19 | Local `exec` runs through the host shell with `cwd = HOME` | `src/conway/client.ts:111-127` (`execSync`, shell interpretation) | CRITICAL if host shell is enabled |
| G-20 | No environment scrubbing before shell/file tools | child inherits process env, including any provider keys | HIGH |
| G-21 | Logger has no redaction layer | `src/observability/logger.ts:64-108` serializes context and error stacks verbatim | HIGH |
| G-22 | No tool execution timeout at the dispatch layer | tools self-manage timeouts inconsistently; `exec` accepts caller timeout | MEDIUM |
| G-23 | No output size cap at dispatch | tool results are returned whole; 10 MB buffer in local exec | MEDIUM |
| G-24 | No tool revocation list or per-capability grants | only the flat `allowedTools` list and category flags | MEDIUM |
| G-25 | Audit trail is a mutable SQLite table with no tamper evidence | `policy_decisions` rows can be updated/deleted | MEDIUM |
| G-26 | Health check is shallow | no CPU/memory, wallet-format, treasury-integrity, permission-integrity, or log-anomaly checks | MEDIUM |
| G-27 | No automated recovery or incident classification | no mechanic, no severity model, no emergency-stop utility | MEDIUM |
| G-28 | No backup-side scan for accidental private-key material | backup excludes `wallet.json` but does not assert the rest is key-free | MEDIUM |
| G-29 | Config load swallows all parse errors and returns `null` | `src/config.ts` catch blocks give no diagnostic context | LOW |
| G-30 | No file locking between two concurrent automaton processes | SQLite serializes writes, but treasury check+act is app-level | MEDIUM |

---

## 3. What remains sound

- Activation gate verified: config flag + env token; `--run` exits 2 and does not
  create a wallet.
- Lockdown policy denies all tools when `allowedTools` is empty.
- Financial category denied under lockdown.
- Bootstrap and heartbeat top-ups are skipped under lockdown.
- Config normalisation fails closed for security flags.
- Config/wallet directories are single-user ACLs; backups exclude the wallet.
- No network listener, no service, no startup entry.

---

## 4. Remediation plan (Phase 15B–15G)

| Gap group | Remediation |
|---|---|
| G-01, G-28 | AES-256-GCM + scrypt wallet envelope, passphrase from env/file, legacy-read, migration CLI, backup key-material assertion |
| G-02, G-03, G-10–G-13, G-14 | Central `TreasuryGuard`: balance, reserve, cooldown, per-tx/hourly/daily/monthly/lifetime/child budgets, duplicate/replay, transactional authorize+record, audit rows |
| G-04 | Route every `financial` tool and replication top-up through the guard; deny unclassified financial tools |
| G-16, G-22–G-24 | Central `authorizeToolExecution` in `executeTool` independent of the policy engine; timeouts, output cap, revocation, capability classification |
| G-17–G-20 | Path boundary via `path.relative` + realpath, protected-directory denylist, env scrubbing, command validation |
| G-21 | Logger redaction for secret-shaped keys and values |
| G-25, G-27 | Hash-chained `security_events` table + incident severity + emergency stop |
| G-26, G-27 | Health guardian and restricted mechanic |
| G-05–G-09 | Automated adversarial suite, bounded soak, Windows read-only collector, regression report |

Residual issues that cannot be fully closed without OS support or human approval
(true Windows sandbox, BitLocker, live-agent testing) will be documented as residual
risks, not claimed as fixed.
