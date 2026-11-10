# Conway Automaton — Security Walkthrough

**Posture: unchanged and closed.** No control was relaxed, bypassed or reconfigured for this
demonstration. Restricted operations were *attempted* in the sense that the real authorisation
functions were called with restricted inputs; none was executed.

---

## 1. The invariants, as actually read

Read through `loadConfig()` — i.e. the effective values the runtime would use, not merely the file
text — and recorded in `runtime/tmp/demo-security.json` (`EV-05`).

| Invariant | Required | Observed | Status |
|---|---|---|---|
| `security.lockdown` | `true` | **`true`** | holds |
| `security.activationApproved` | `false` | **`false`** | holds |
| `security.allowedTools` | `[]` | **`[]`** | holds |
| `security.allowedCapabilities` | `[]` | **`[]`** | holds |
| `allowFinancialTools` | `false` | **`false`** | holds |
| `allowHostShell` | `false` | **`false`** | holds |
| `allowSelfModification` | `false` | **`false`** | holds |
| `allowReplication` | `false` | **`false`** | holds |
| `allowExternalExposure` | `false` | **`false`** | holds |
| `maxChildren` | `0` | **`0`** | holds |
| `smartContractTools` / `mcpTools` / `socialTools` / `survivalTools` | not set | **not set** | holds |
| `CONWAY_ACTIVATION` env | absent | **ABSENT** | holds |
| `CONWAY_ALLOW_WALLET_CREATION` env | absent | **ABSENT** | holds |
| Wallet file | none | **NO WALLET CONFIGURED** | holds |

The console's own gate board independently re-read the same values and reported 12 gate checks
passing inside the 19-check health run (`EV-01`).

---

## 2. Activation gating

`src/security/activation.ts` requires **two independent signals**:

1. `security.activationApproved === true` in the persisted config, **and**
2. `CONWAY_ACTIVATION=APPROVED` in the process environment.

Observed call:

```json
{
  "approved": false,
  "reason": "security.activationApproved is not true in automaton.json",
  "envVarName": "CONWAY_ACTIVATION",
  "envVarPresent": false
}
```

The gate short-circuits on the first missing signal and returns a reason, not a boolean. There is no
override parameter, no "force" flag, and no console route that reaches it: a probe to
`POST /api/action/start` returned **404 `no such endpoint`**.

This matters because starting the runtime is not a neutral act — the source comment is explicit that
`--run` loads or creates a wallet, registers the identity, may purchase credits, and begins
autonomous execution.

---

## 3. Tool permission restrictions — six real denials

`authorizeToolCall(tool, config)` was called with the live config and **no database handle**, so no
security-event row could be written and no tool could execute.

| Tool | Requested capabilities | Decision | Reason code |
|---|---|---|---|
| `transfer_credits` | `financial`, `wallet_signing`, `network_access` | **DENIED** | `NOT_ALLOWLISTED` |
| `x402_fetch` | `financial`, `network_access`, `wallet_signing` | **DENIED** | `NOT_ALLOWLISTED` |
| `spawn_child` | `agent_spawning`, `administrative` | **DENIED** | `NOT_ALLOWLISTED` |
| `edit_own_file` | `administrative`, `filesystem_write` | **DENIED** | `NOT_ALLOWLISTED` |
| `send_message` | `network_access`, `external_api` | **DENIED** | `NOT_ALLOWLISTED` |
| `system_synopsis` | `read_only` | **DENIED** | `NOT_ALLOWLISTED` |

Two observations worth stating plainly:

- **Even a read-only tool is denied.** `system_synopsis` requires only `read_only`, and it is still
  refused because `allowedCapabilities` is empty. The posture is "nothing is granted", not "safe
  things are granted".
- The denial message is specific — `Tool "transfer_credits" requires capabilities not granted:
  financial, wallet_signing, network_access` — which is auditable. A generic "denied" would be
  harder to diagnose and easier to fudge.

Decision order inside the authoriser: revoked list → unclassified → allow-by-name → allow-by-capability
→ deny. Deny is the fallthrough, not an explicit branch that could be forgotten.

---

## 4. Console-level access control (independent of the agent)

| Probe | Result | Meaning |
|---|---|---|
| `GET /api/panels` with no credential | **401** `operator token required` | auth wall |
| `GET /api/panels` with a valid token but `Origin: http://evil.example` | **403** `cross-origin request refused` | a malicious page cannot read the console even if it obtains a token |
| `POST /api/action/health-check` with a valid token but no `x-conway-request: 1` | **403** `cross-origin request refused` | no blind POST / CSRF |
| `POST /api/action/start` | **404** `no such endpoint` | there is no activation route to attack |
| `POST /api/action/restore` with a bogus backup name | **400** `no manifest in no-such-backup-for-demo, refusing to restore unverified bytes` | destructive action guarded by manifest verification |

Session cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`, 8-hour TTL, max 32 sessions. The operator
token is compared with constant-time equality, is created with `wx` (never overwritten), and lives in
`dashboard/state/dashboard.token`. **It was never printed** by any script in this demonstration, and
the probe scripts deliberately emit only status codes and sanitised bodies.

Additional structural checks:

- `server/index.ts` refuses to bind anything except `127.0.0.1` and refuses `FORBIDDEN_PORTS`
  (3001 is reserved for FreeLLMAPI).
- `HEALTH_CHECK_DASHBOARD.bat` proved **no connection is established to any of the 3 routable
  addresses** — the console is not reachable off-host.
- `danger-imports.test.ts` (5/5) statically forbids the console from importing a shell, a database
  writer, or `createDatabase()`.

---

## 5. Financial restrictions

| Control | State |
|---|---|
| Wallet file | **absent** — `walletExists()` false, `NO WALLET CONFIGURED` |
| Wallet creation env approval | **absent** |
| `allowFinancialTools` | `false` |
| `transfer_credits` | denied `NOT_ALLOWLISTED` |
| `x402_fetch` | denied `NOT_ALLOWLISTED` |
| Transactions in DB | `transactions` 0 rows, `onchain_transactions` 0 rows |
| Spend tracking | `spend_tracking` 0 rows |
| Treasury authorisations table | **absent** (V12/V13) |
| Treasury reservations check | `warn: treasury table unavailable` |

### Finding F-1 — effective treasury limits are not what the file says

`automaton.json` declares all ten `treasuryPolicy` keys as `0`. But `src/config.ts:45-48` merges
`DEFAULT_TREASURY_POLICY` **before** the declared object, so any key **absent** from the file inherits
the code default. Three keys are absent:

| Key | Declared | Effective |
|---|---|---|
| `maxMonthlyTransferCents` | *absent* | **100000** |
| `agentBudgetCents` | *absent* | **200000** |
| `childBudgetCents` | *absent* | **50000** |

The console surfaces this in the Treasury panel as "declared vs default", which is how it was found.
**Exploitability today: none** — four independent gates (lockdown, empty allowlist, financial tools
off, no wallet) each block the path. **Exploitability after financial tools are enabled: direct**,
because an operator reading `automaton.json` would reasonably believe every limit is zero.

This is the single most important security item in this report. It is a *latent* defect, and it is
reported rather than fixed because changing the merge semantics is a product decision, not a demo
step.

---

## 6. Self-modification, replication, exposure

| Boundary | Enforcement | Evidence |
|---|---|---|
| Self-modification | `allowSelfModification=false`; `edit_own_file` / `revert_last_edit` / `reset_to_upstream` require administrative + filesystem-write capabilities | denied |
| Replication | `allowReplication=false`, `maxChildren=0`; `spawn_child` requires `agent_spawning` | denied |
| Child budget | `childBudgetCents` effective 50000 (see F-1) | console finding |
| External exposure | `allowExternalExposure=false`; console binds loopback only; no inbound rule added; firewall untouched | 19/19 checks |
| Host shell | `allowHostShell=false`; shell-capable tools require `shell_execution` | denied |
| MCP installation | requires administrative + network + shell | denied by classification |
| Windows security settings | mechanic is forbidden by classification from touching Defender/firewall/BitLocker | `classifyRepair` returns `forbidden` |

---

## 7. Audit and reporting

There are **two different audit mechanisms**, and conflating them would be misleading.

### 7.1 Conway's security audit chain — **NOT VERIFIED**

`verifySecurityChain()` reads the `security_events` table. That table does not exist in the live V11
database, so the guardian's `audit_chain` check returns:

```
fail — no such table: security_events
```

The console does **not** render this as "tamper detected" and does **not** render it as "chain
intact". It reclassifies the check to `NOT VERIFIED — source absent`, and reports overall
`degraded` for the seven checks that could actually be evaluated. This is the correct handling of a
missing source.

### 7.2 The console's own audit trail — **VERIFIED**

`dashboard/logs/audit-2026-11-09.jsonl` is append-only JSONL, redacted on write. Extracts from this
demonstration:

```
event=request.unauthenticated  route=GET /api/panels                 verdict=DENIED
event=auth.failed                                                    verdict=DENIED
event=auth.success                                                   verdict=VERIFIED
event=request.rejected         route=GET /api/panels                 verdict=DENIED
event=request.rejected         route=POST /api/action/health-check   verdict=DENIED
event=action.restore.plan                                            verdict=NOT VERIFIED
event=action.health-check                                            verdict=critical
event=startup.listening        detail={host:127.0.0.1, port:8787}    verdict=VERIFIED
```

Every denial attempted during the demonstration is recorded, with the route and verdict. The audit
sink is explicitly best-effort (a failed audit write must not take down a read-only console), and a
missing sink is a *reported* condition rather than a silent one.

**What this proves:** the console records who tried what and how it was decided.
**What it does not prove:** that the *agent's* actions are audited — the agent has never acted, and
its chain table does not exist yet.

---

## 8. What was deliberately NOT done

| Not done | Why |
|---|---|
| Set `CONWAY_ACTIVATION` | would defeat the primary gate |
| Set `CONWAY_ALLOW_WALLET_CREATION` | prohibited |
| Enable `security.selfHealingEnabled` | would allow real repairs |
| Enable financial / shell / self-mod / replication flags | prohibited by mission |
| Create or fund a wallet | prohibited |
| Run a migration to V13 | prohibited; console must not migrate |
| Open the console to LAN | prohibited |
| Modify firewall or Defender | prohibited |
| Read credential values | prohibited; only presence was checked |
| Print the operator token | prohibited by this demonstration's own rules |
| Run `manage-bde -protectors -get` | explicitly prohibited |

---

## 9. Residual risk register

| ID | Risk | Severity | Status |
|---|---|---|---|
| **F-1** | Three treasury limits inherit non-zero defaults despite a zeroed config | **High (latent)** | open — see §5 |
| F-2 | Live schema V11 vs code V13; audit chain and treasury tables absent | Medium | open — blocks audit verification |
| F-3 | No approval surface for `requires_approval` repairs | Medium | open — mechanic can only refuse |
| F-4 | Failover aborts on 401/timeout/connection | Medium | documented behaviour |
| F-5 | Operator token stored as a file on disk | Low | accepted design; loopback single-user model |
| F-6 | No TLS on the console | Low | accepted: loopback + token + origin checks |
| F-7 | Console audit sink is best-effort and can silently lose a write | Low | documented in code and in `/api/system` |
| F-8 | 45 node processes on the host, mostly unrelated; the console cannot attribute all of them | Low | reported as "unidentified" rather than guessed |

---

## 10. Bottom line

The security model is **real and enforced in code**, not asserted in documentation. Three
independent planes hold: the agent cannot start, the agent could not act if it did, and the console
cannot change Conway state. The one thing an operator should act on before enabling anything is
**F-1**, because it is the difference between "all limits are zero" and "three limits are not".
