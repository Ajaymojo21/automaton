# Security and Lockdown Verification

- Date: 2026-11-10
- Runtime HOME: `<repo-root>\runtime\home`
- Harness: `runtime/tmp/final-invariants.mts`, executed with the pinned Node 22.23.4
- Result: `INVARIANTS RESULT: PASS (34 pass, 0 fail, 3 not verified)`

## 1. Configuration invariants (Section 8)

Read from `runtime/home/.automaton/automaton.json` and re-checked by the harness:

| Invariant | Expected | Observed | Verdict |
|---|---|---|---|
| `security.lockdown` | true | true | PASS |
| `security.activationApproved` | false | false | PASS |
| `security.allowedTools` | `[]` | `[]` | PASS |
| `security.allowFinancialTools` | false | false | PASS |
| `security.allowHostShell` | false | false | PASS |
| `security.allowSelfModification` | false | false | PASS |
| `security.allowReplication` | false | false | PASS |
| `security.allowExternalExposure` | false | false | PASS |
| `maxChildren` | 0 | 0 | PASS |
| `maxTurnsPerCycle` | bounded | 25 | PASS |
| `walletAddress` | empty | `""` | PASS |
| wallet material on disk | absent | absent (including one nested level) | PASS |

No `wallet.json`, keystore, private key or seed phrase was found in the runtime HOME. No wallet was
created or restored at any point.

## 2. Treasury (B-4)

`resolveTreasuryPolicy(config)` (`src/security/treasury-guard.ts:79`) returns the effective policy.
Under `lockdown=true` all 12 numeric limits resolve to zero:

`maxSingleTransferCents`, `maxHourlyTransferCents`, `maxDailyTransferCents`, `minimumReserveCents`,
`maxX402PaymentCents`, `transferCooldownMs`, `maxTransfersPerTurn`, `maxInferenceDailyCents`,
`requireConfirmationAboveCents`, `maxMonthlyTransferCents`, `agentBudgetCents`, `childBudgetCents`.

`x402AllowedDomains` is empty. The health guardian independently re-reads the same 12 keys and reports
"12 monetary limits are zero and the x402 allowlist is empty" (evidence `{"limitsChecked":12}`).
`src/__tests__/security/f1-treasury-fail-closed.test.ts` (9 tests) and
`src/__tests__/phase15-treasury.test.ts` (45 tests) pass. Invalid or inherited values are reset to the
lockdown-aware base rather than defaulting to a spendable policy.

## 3. Wallet and financial execution

- No wallet exists, so no financial path is reachable.
- `check_usdc_balance` returns immediately when lockdown is engaged and financial tools are disabled
  (`src/heartbeat/tasks.ts:148-156`).
- The harness records: financial transaction "not run", wallet create/restore "not run",
  `CONWAY_ALLOW_WALLET_CREATION` unset. All PASS.
- No financial transaction, top-up or x402 payment was executed.

## 4. Activation, heartbeat, scheduler, shell

- `CONWAY_ACTIVATION` is unset. `--run` and `--provision` were never executed.
- Process scan (PowerShell `Get-CimInstance Win32_Process`) found no process running
  `src/index.ts`, `--run`, `heartbeat/daemon` or `heartbeat/scheduler`. PASS.
- The only long-lived Conway process is the dashboard server, which the same scan distinguishes from
  an agent process.
- No shell command execution through agent tools occurred; there is no agent.

## 5. Dashboard exposure

| Check | Result |
|---|---|
| `GET http://127.0.0.1:8787/api/session` | HTTP 200 (loopback answers) |
| `GET http://10.123.203.198:8787/api/session` | `ECONNREFUSED` (LAN address refused) |
| `netstat` rows for a non-loopback 8787 listener | 0 (this Windows stack did not expose the LISTEN row even while the loopback socket answered; the LAN refusal above is the behavioural proof) |
| Server bind | `HOST = "127.0.0.1"` in `dashboard/server/paths.ts:31`; the server throws if the host is anything else (`dashboard/server/index.ts:69`) |
| Port 3001 collision | refused by `FORBIDDEN_PORTS` (`dashboard/server/paths.ts:36`) |
| Auth | POST `/api/auth` exchanges the operator token for an HttpOnly, SameSite=Strict cookie (`dashboard/server/security.ts:83-84`); `/api/stream` requires the session |
| Forbidden actions | Nine probes (start, activate, run, migrate, provision, wallet create, fund, repair execute) returned 404 or 405; `allRejected: true` |
| Headers | CSP `default-src 'self'`, `nosniff`, `no-referrer` on every response, including errors (`dashboard/server/http.ts:40-42`) |

## 6. Repair approvals are non-executing (Section 8)

- Approval transitions a proposal to `ready_for_execution`, never `completed`
  (`src/reliability/repair-approval.ts` header; `markCompleted` refuses without a separate
  verification step).
- The mechanic refuses to execute while `security.selfHealingEnabled !== true`
  (`src/reliability/mechanic.ts:143`), which is the case here.
- At runtime the mechanic panel reports `VERIFIED / NOT REACHABLE`.
- No repair was executed during the mission.

## 7. Secrets

- No credential was searched for, printed, copied, persisted or invented.
- Error responses carry no stack trace or internal path (`dashboard/server/index.ts` error handler).
- Backup artifacts record hashes and redact credential-shaped fields; they exclude wallet material.
- The dashboard token is read in-process by the harness and never printed to a log or report.

## 8. NOT VERIFIED (stated, not hidden)

1. BitLocker protection status. The mission forbids `manage-bde -protectors -get`; `manage-bde
   -status` requires an elevated Administrator terminal, which this session does not have.
2. Microsoft Defender / Windows Firewall state. Not modified and not probed.
3. A universal negative that no process made any outbound connection. Not provable from inside the
   session. The positive checks that matter (no inference, no financial request, no agent process)
   all pass.

## 9. Environment preservation

- Every mission write was confined to `<repo-root>`.
- FreeLLMAPI (`<freellmapi-root>`, `http://localhost:3001/v1`)
  was not reconfigured, restarted or bound differently. Its repository shows pre-existing local
  modifications (last commit 2026-10-02) that were not touched by this mission.
- Ollama, OmniRoute, OpenCode, Qoder, TradingAgents, ADRE-RN and Paperclip AI were not modified.
- No global environment variable was changed; the runtime HOME was passed per-process.
