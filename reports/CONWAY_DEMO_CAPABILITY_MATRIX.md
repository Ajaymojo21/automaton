# Conway Automaton — Capability Matrix

Every row was classified from source code **and** from an observation made during this
demonstration. A row is only `IV` if something actually ran and produced evidence.

---

## Legend

| Code | Meaning |
|---|---|
| **IV** | **IMPLEMENTED AND VERIFIED** — code exists and was exercised at runtime in this demonstration |
| **INV** | **IMPLEMENTED BUT NOT RUNTIME-VERIFIED** — code exists and is reachable, but was not exercised here |
| **PI** | **PARTIALLY IMPLEMENTED** — some of the path exists; a dependency, table or branch is missing |
| **DP** | **DOCUMENTED / PLANNED** — described, not functional |
| **DIS** | **DISABLED BY SECURITY POLICY** — implemented and intentionally switched off |
| **NI** | **NOT IMPLEMENTED** — no code path exists |

`EV-xx` identifiers refer to the evidence register in `CONWAY_DEMO_FINAL_ACCEPTANCE.md`.

---

## 1. Operator console

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 1 | Loopback HTTP server on `127.0.0.1:8787` | **IV** | `EV-01` | refuses any other host; port 3001 explicitly forbidden |
| 2 | 12-panel observation surface | **IV** | `EV-02` | all 12 returned in one authenticated call |
| 3 | Operator-token authentication | **IV** | `EV-03` | anonymous `GET /api/panels` → `401 operator token required` |
| 4 | Session cookie (HttpOnly, SameSite=Strict) | **IV** | `EV-01`, `EV-03` | auth exchange observed in audit log |
| 5 | Origin enforcement | **IV** | `EV-03` | `Origin: http://evil.example` → `403 cross-origin request refused` |
| 6 | CSRF header requirement on writes | **IV** | `EV-03` | POST without `x-conway-request: 1` → `403` |
| 7 | Per-client token-bucket rate limit | **INV** | source only | 40-token bucket, refill 40/min; not stressed |
| 8 | Read-only SQLite handle | **IV** | `EV-04` | `readonly:true, fileMustExist:true`; write refused by SQLite |
| 9 | No migration path from the console | **IV** | `EV-04` | `createDatabase()` never imported; 4 V12/V13 tables still absent |
| 10 | Per-cell evidence verdicts (5 states) | **IV** | `EV-02` | `VERIFIED / EMPTY / UNKNOWN / NOT VERIFIED / NOT APPLICABLE` |
| 11 | Append-only audit trail | **IV** | `EV-12` | JSONL, redacted, one file per UTC day |
| 12 | Secret redaction | **IV** | `redact.test.ts` 5/5 | applied to audit `detail` and JSON bodies |
| 13 | Secret-free config rendering | **IV** | `EV-02` | settings panel shows `not configured`, never values |
| 14 | SPA bundle served | **IV** | `EV-01` | `dashboard/dist/index.html` present |
| 15 | Health-check action | **IV** | `EV-02` | `POST /api/action/health-check` → 200, 8 checks, persisted |
| 16 | Backup verification action | **INV** | route + tests | `backup-verify.test.ts` 9/9; not invoked against live backups |
| 17 | Restore **plan** guard | **IV** | `EV-03` | bogus plan → `400 no manifest in …, refusing to restore unverified bytes` |
| 18 | Restore **execution** | **INV** | `restore-guard.test.ts` 14/14 | requires a verified manifest; not executed here |
| 19 | SSE stream | **INV** | `stream.ts` | no subscriber exercised |
| 20 | Danger-import audit (no shell/db-write imports) | **IV** | `danger-imports.test.ts` 5/5 | static enforcement of the read-only claim |

---

## 2. Control plane / security

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 21 | Dual activation gate | **IV** | `EV-05` | `approved=false`, reason `security.activationApproved is not true in automaton.json` |
| 22 | Activation env-var gate (`CONWAY_ACTIVATION`) | **IV** | `EV-05` | env var `ABSENT`; both signals required |
| 23 | Tool authorisation by capability | **IV** | `EV-05` | 6/6 restricted tools → `NOT_ALLOWLISTED` |
| 24 | Allow-by-name allowlist | **IV** | `EV-05` | `allowedTools=[]` |
| 25 | Explicit capability grants | **IV** | `EV-05` | `allowedCapabilities=[]` |
| 26 | Unclassified-tool denial | **IV** | `EV-05` + source | `UNCLASSIFIED_TOOL` branch present |
| 27 | Tool revocation list | **INV** | source | `revokedTools` branch; list empty |
| 28 | Emergency-stop marker scan | **IV** | `EV-02` | union scan of 2 candidate paths, `NOT ENGAGED` |
| 29 | Emergency-stop engage/clear | **INV** | `src/security/emergency-stop.ts` | implemented for the agent; **no console route** (correctly) |
| 30 | Audit-chain verification | **PI** | `EV-06` | `fail: no such table: security_events` — source absent in V11 |
| 31 | Security seals | **PI** | `EV-04` | `security_seals` absent |
| 32 | Incident records | **PI** | `EV-04` | `security_incidents` absent |
| 33 | Policy-enforcement layer check | **INV** | `policy-enforcement.ts` | pure function; not invoked at runtime here |
| 34 | Live-model preflight | **INV** | `live-model-preflight.ts` | never called (no live model) |
| 35 | Finance/tool/self-mod/replication/exposure flags | **IV** | `EV-05` | all `false` as read through `loadConfig()` |
| 36 | `maxChildren = 0` | **IV** | `EV-05` | read from config |
| 37 | Wallet creation gate | **IV** | `EV-05` + `EV-02` | no wallet file; `CONWAY_ALLOW_WALLET_CREATION` absent |

---

## 3. AI / inference

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 38 | Provider registry loaded from config | **IV** | `EV-02` | 5 providers parsed |
| 39 | P-6 endpoint validation | **IV** | `EV-02` | 5 valid, **0 rejected** |
| 40 | Credential presence reporting | **IV** | `EV-02` | all five `not present`; values never read |
| 41 | Tier resolution + ordering | **IV** | `EV-08` | reasoning/fast/cheap orders asserted |
| 42 | Retry on 429/500/503 with backoff | **IV** | `EV-08` | test 4: three retries then failover |
| 43 | Circuit breaker (5 failures → 5 min) | **IV** | `EV-08` | test 6 opens the circuit |
| 44 | Failover across providers | **IV** | `EV-08` | 429 walks `freellmapi → groq → openai` |
| 45 | Failover on timeout / connection / 401 / empty-200 | **PI** | `EV-08` | **aborts the tier by design** — not a failover path |
| 46 | Real inference call | **INV** | `EV-07` | **NOT DEMONSTRATED** — no credential, no authorisation |
| 47 | FreeLLMAPI provider record | **IV** | `EV-02`, `EV-07` | `http://localhost:3001/v1`, declared enabled, key absent |
| 48 | FreeLLMAPI service reachability | **IV** | `EV-07` | TCP up; `GET /v1/models` → `401 Invalid API key` |
| 49 | Cost accounting | **INV** | `EV-02` | `inference_costs` 0 rows; no call, no cost |
| 50 | Model registry persistence | **INV** | `EV-02` | `model_registry` 0 rows |
| 51 | Latency / token telemetry | **NI** | — | `NOT MEASURED`; no source exists yet |
| 52 | Conway cloud registration | **DP** | `EV-02` | `registeredWithConway=false`, empty API key |

---

## 4. Reliability

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 53 | Health guardian, 8 checks | **IV** | `EV-06` | emergency stop, integrity, schema, audit, treasury, leases, disk, wallet |
| 54 | Persisted health report | **IV** | `EV-02`, `EV-06` | `dashboard/state/health-*.json` + `reports/health-latest.json` (stale) |
| 55 | Dashboard reclassification of absent sources | **IV** | `EV-02` | `critical` → `degraded`, 1 check `NOT VERIFIED` |
| 56 | Repair classification (pure) | **IV** | `EV-06` | `automatic` / `requires_approval` / `forbidden` |
| 57 | Autonomous repair execution | **DIS** | `EV-06` | `skippedReason: self-healing is disabled (security.selfHealingEnabled=false)`, 0 actions |
| 58 | Approval queue for `requires_approval` repairs | **NI** | — | the mechanic returns them; **no approval surface exists** |
| 59 | Post-repair verification | **NI** | — | nothing was repaired, so nothing to verify |
| 60 | Heartbeat declaration | **PI** | `EV-02` | 6 declared, 3 enabled in YAML, **0 in DB** |
| 61 | Heartbeat scheduling / execution | **DIS** | `EV-02` | 0 scheduled, 0 executed |
| 62 | Scheduler lease pruning | **DIS** | `EV-06` | classified `automatic` but gated off |
| 63 | Treasury reservation release | **DIS** | `EV-06` | `requires_approval`; table absent anyway |
| 64 | Escalation / paging / alerting | **NI** | — | no notification channel in the repo |

---

## 5. State and data

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 65 | SQLite WAL store | **IV** | `EV-04` | `journal_mode=wal`, `integrity_check=ok` |
| 66 | Schema version reporting | **IV** | `EV-04` | live **11**, code **13** |
| 67 | Table inventory + honest row counts | **IV** | `EV-04` | 38 tables; 37 empty; `schema_version` 10 rows |
| 68 | V12/V13 migrations | **NI** | `EV-04` | not applied; four tables absent |
| 69 | Treasury authorisation tables | **NI** | `EV-04` | `treasury_authorizations` absent |
| 70 | Durability guarantee for console reads | **IV** | `EV-11` | DB SHA-256 identical before/after; only `-shm` mtime moved |

---

## 6. Execution plane (all inert here)

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 71 | Agent loop | **DIS** | `EV-05`, process scan | no agent process; activation refused |
| 72 | Task orchestration | **DIS** | `task_graph` 0 rows | — |
| 73 | Heartbeat wake cycle | **DIS** | 0 rows | — |
| 74 | Tool execution | **DIS** | `EV-05` | authoriser denies before execution |
| 75 | Host shell | **DIS** | `allowHostShell=false` | — |
| 76 | Self-modification | **DIS** | `allowSelfModification=false` | — |
| 77 | Replication / child spawning | **DIS** | `allowReplication=false`, `maxChildren=0` | — |
| 78 | External / LAN exposure | **DIS** | `allowExternalExposure=false` | console binds loopback only |
| 79 | Wallet creation / funding | **DIS** | no wallet file | env approval var absent |
| 80 | Financial transfers / x402 payments | **DIS** | `EV-05` | `transfer_credits`, `x402_fetch` denied |
| 81 | MCP server installation | **DIS** | authoriser map | requires administrative + network + shell |
| 82 | Skill installation | **DIS** | authoriser map | requires administrative + filesystem + network |
| 83 | Email / social / messaging | **DIS** | authoriser map | `send_message` denied |

---

## 7. Operations

| # | Capability | Class | Evidence | Notes |
|---|---|---|---|---|
| 84 | `START_CONWAY_DASHBOARD.bat` | **IV** | `EV-01`, `EV-13` | pins HOME, refuses duplicates |
| 85 | `STOP_CONWAY_DASHBOARD.bat` | **IV** | `EV-13` | stops only the recorded pid; port verified free |
| 86 | `HEALTH_CHECK_DASHBOARD.bat` | **IV** | `EV-01` | 19 pass / 0 fail / 0 not-verified / 0 warn |
| 87 | `RUN_CONWAY_DEMO.bat` (new) | **IV** | `EV-13` | warm reuse **and** cold start both verified |
| 88 | Backup directories + manifests | **IV** | `EV-02` | 10 entries, 2 DB backups |
| 89 | Log files | **IV** | `EV-02` | 5 audit files; no agent logs (agent never ran) |
| 90 | Windows service / auto-start | **NI** | — | deliberately absent |

---

## 8. Tally

| Class | Count |
|---|---|
| **IV — implemented and verified** | **49** |
| **INV — implemented, not runtime-verified** | **11** |
| **PI — partially implemented** | **5** |
| **DP — documented / planned** | **1** |
| **DIS — disabled by security policy** | **17** |
| **NI — not implemented** | **7** |
| **Total rows** | **90** |

The distribution is the story: the **observation and control plane is complete and proven**; the
**execution plane is implemented but switched off**; and the gaps are concentrated in three places —
migration state (V11 vs V13), the missing approval surface for `requires_approval` repairs, and
production telemetry.

---

## 9. The five classifications a reader is most likely to misread

1. **`DIS` is not `NI`.** The agent loop, wallet, spawning and financial tools have real code. They
   are off because the configuration says off and the code enforces it — not because they are stubs.
2. **`IV` for failover does not mean "survives any failure".** It means the 429/500/503 path is
   proven. Timeout, connection error, 401 and empty-200 **abort** the tier (row 45).
3. **`PI` for the audit chain is not a tamper finding.** The table does not exist in V11, so the
   check had no source. The console says `NOT VERIFIED`, which is the correct answer.
4. **`IV` for the activation gate means it refused.** That is the success condition for this
   deployment.
5. **`NI` for telemetry is a real gap**, not modesty: there is no uptime, success-rate or accuracy
   series anywhere in the system, so none is reported.
