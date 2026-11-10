# Pre-Activation Readiness Audit — Architecture Audit

## 1. Architecture map

```
Operator (human)
   │
   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Read-only Operator Console (dashboard/, 24 server modules, 12 panels) │
│  - HTTP 127.0.0.1:8787, token + session + CSRF + origin checks     │
│  - SQLite opened readonly:true, fileMustExist:true (no migrations)   │
│  - Actions: health-check, verify-backups, restore (guarded)          │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │ read-only                    │ read-only
               ▼                              ▼
   runtime/home/.automaton/          dashboard/state + logs
   ├─ automaton.json                 ├─ dashboard.token
   ├─ inference-providers.json        ├─ dashboard.pid
   ├─ heartbeat.yml                  ├─ health-*.json
   └─ state.db (V11, WAL, 38 tables) └─ audit-*.jsonl
               │
               │ (only if --run, gated)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Conway Agent Runtime (src/, never started in this audit)              │
│  - src/index.ts → requireConwayHome() → checkActivation()           │
│  - getWallet() → createDatabase() → registerAutomaton()             │
│  - heartbeat daemon + agent loop (infinite)                          │
│  - inference client (provider registry, P-6 validation, failover)    │
│  - treasury guard (centralized authorization)                       │
│  - tool authorizer (capability-based denial)                         │
│  - policy engine + spend tracker                                      │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
   External: Conway API (api.conway.tech), FreeLLMAPI (localhost:3001),
             AI providers (openai/groq), MCP servers
```

## 2. Component inventory

| Subsystem | Files | State |
|---|---|---|
| Agent loop | `src/agent/` (24) | implemented, never run |
| Orchestration | `src/orchestration/` (12) | implemented, never run |
| Heartbeat | `src/heartbeat/` (5) | implemented, never started |
| Replication | `src/replication/` (8) | implemented, disabled |
| Self-modification | `src/self-mod/` (4) | implemented, disabled |
| Inference | `src/inference/` (7) | registry + client, P-6 validated, not exercised live |
| Security | `src/security/` (11) | all gates functional, tested |
| Reliability | `src/reliability/` (2) | guardian operational, mechanic disabled |
| State/DB | `src/state/` (3) | V11 live, V13 expected |
| Identity/wallet | `src/identity/` (4) | no wallet exists |
| Memory | `src/memory/` (16) | no rows |
| Skills | `src/skills/` (3) | none loaded |
| Dashboard | `dashboard/` (24 server + 11 frontend) | operational |
| Console scripts | `START/STOP/HEALTH_CHECK/RUN_CONWAY_DEMO.bat` | verified |

## 3. Activation dependencies

```
--run
  └─ requireConwayHome()  [HOME guard]
  └─ checkActivation(config, env)  [TWO independent signals]
       ├─ security.activationApproved === true  (config)
       └─ CONWAY_ACTIVATION === "APPROVED"      (env)
  └─ getWallet()  [creates wallet if absent — requires passphrase]
  └─ createDatabase(dbPath)  [read-write, migrates, writes identity]
  └─ registerAutomaton()  [network → api.conway.tech]
  └─ bootstrapTopup()  [only if !lockdown || allowFinancialTools]
  └─ heartbeat.start()  [scheduler begins]
  └─ runAgentLoop()  [infinite]
```

Every arrow above is gated. No alternate path reaches wallet creation, DB migration, registration,
heartbeat, or the agent loop without passing `checkActivation()` first.

## 4. Capability classification (90 rows)

See `CONWAY_DEMO_CAPABILITY_MATRIX.md` for the full table. Summary:

| Class | Count |
|---|---|
| IMPLEMENTED AND VERIFIED | 49 |
| IMPLEMENTED BUT NOT RUNTIME-VERIFIED | 11 |
| PARTIALLY IMPLEMENTED | 5 |
| DOCUMENTED / PLANNED | 1 |
| DISABLED BY SECURITY POLICY | 17 |
| NOT IMPLEMENTED | 7 |

## 5. Financial execution paths

| Path | Gate | Status |
|---|---|---|
| `transfer_credits` tool | tool authorizer (financial + wallet_signing + network_access) → treasury guard (single cap) | denied `NOT_ALLOWLISTED` |
| `x402_fetch` tool | tool authorizer (financial + network + wallet_signing) → treasury guard (maxX402) | denied `NOT_ALLOWLISTED` |
| `fund_child` tool | tool authorizer (financial + wallet_signing) → treasury guard (child budget) | denied `NOT_ALLOWLISTED` |
| `topup_credits` tool | tool authorizer (financial + network) → treasury guard (credit_purchase) | denied `NOT_ALLOWLISTED` |
| Bootstrap topup | `!lockdown || allowFinancialTools` → treasury guard | disabled by lockdown |
| Treasury guard itself | `resolveTreasuryPolicy` → lockdown → all zeros | all caps 0 |

## 6. Database dependencies

- `createDatabase()` (read-write, migrates) — only called from `--run` and `--init` (both gated).
- `readStatusSnapshot()` (read-only) — used by `--status` (ungated, safe).
- `openDatabaseReadOnly()` — used by migration preflight and dashboard.
- Dashboard uses `new Database(file, { readonly: true, fileMustExist: true })` — never migrates.

## 7. AI inference dependencies

- Provider registry loads from `inference-providers.json`, validates URLs via P-6.
- Inference client uses OpenAI SDK transport with `redirect: "error"`.
- Credential resolution from `process.env` at call time (never from disk).
- Failover: only 429/500/503 walk the provider order; other errors abort.
- Circuit breaker: 5 failures → 5 min disable.
- Real inference: NOT TESTED (no credential).

## 8. Security boundaries

| Boundary | Control | Verified |
|---|---|---|
| Browser → console | loopback bind, token, session cookie, origin, CSRF | yes |
| Console → state | readonly SQLite, no createDatabase import | yes |
| Console → host | no shell, no writes outside state/logs | yes (static audit) |
| Agent → world | activation gate, tool authorizer, capability grants, treasury policy, maxChildren=0 | gate verified |
| Process → provider | P-6 URL validation, redirect:error, env credentials | validation verified |
| Console → restore | manifest verification before any byte restored | verified (bogus refused) |
| Migration → DB | two env gates, containment check, integrity preflight | verified (disposable copy) |
