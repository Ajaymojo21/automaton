# Conway Automaton — Architecture

**Scope:** the architecture as it exists in the working tree at HEAD
`d8f816881fd24b6f5e3d616e59edec387a447667`, verified by reading source and by running the
read-only console. Where a component has never executed, this document says so.

---

## 1. Deployment topology (this machine, this demonstration)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Windows 11 host — loopback only                                             │
│                                                                              │
│   Browser  ──HTTP──►  127.0.0.1:8787                                        │
│                          │                                                   │
│                          ▼                                                   │
│              ┌───────────────────────────────┐                               │
│              │ Read-only Operator Console    │   dashboard/server/*          │
│              │ 24 TS modules, 12 panels      │   pid 32720 (server)          │
│              │ token + session + CSRF + CORS │   pid 32052 (launcher)        │
│              └───────┬───────────────┬───────┘                               │
│                      │ read-only     │ read-only                             │
│                      ▼               ▼                                       │
│        runtime/home/.automaton/    dashboard/state + logs                    │
│        ├─ automaton.json           ├─ dashboard.token                        │
│        ├─ inference-providers.json ├─ dashboard.pid                          │
│        ├─ heartbeat.yml            ├─ health-*.json                          │
│        └─ state.db  (V11, WAL)     └─ audit-YYYY-MM-DD.jsonl                 │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │ Conway agent runtime — NOT RUNNING, and not startable from here     │     │
│   │ src/agent, src/orchestration, src/heartbeat, src/inference,         │     │
│   │ src/security, src/reliability, src/state, src/identity, src/skills  │     │
│   └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│   FreeLLMAPI  ── 127.0.0.1:3001  (separate project, pid 17708, untouched)     │
│                  GET /v1/models without a key → 401 authentication_error     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Two independent processes matter:

| Process | Role | Evidence |
|---|---|---|
| Launcher (`dashboard/scripts/start.mjs`) | validates HOME, refuses duplicates, spawns detached server, writes pid file | `EV-13` |
| Server (`dashboard/server/index.ts` under `tsx`) | HTTP surface, auth, panels, actions | `EV-01`, `EV-02` |

The agent is a **third** process type that this topology deliberately does not contain.

---

## 2. Layer model

### 2.1 Operator surface — `dashboard/`

24 server-side TypeScript modules (18 top-level + 6 panel modules) and 11 frontend files.

| Area | Modules | Responsibility |
|---|---|---|
| Entry | `server/index.ts` | creates the HTTP server, asserts loopback host, refuses forbidden ports, installs signal handlers |
| Routing | `server/routes.ts` | the complete API table (see §3) |
| Auth | `server/security.ts` | operator token, constant-time compare, session cookie, origin/CSRF checks, token-bucket rate limit |
| Read-only DB | `server/db.ts` | `new Database(file, { readonly: true, fileMustExist: true })`, schema/integrity/table helpers |
| Snapshot | `server/state.ts` | one immutable observation per request, assembled from read-only sources |
| Sources | `server/sources.ts` | config, providers, wallet, backups, logs, activation, emergency stop, OS sample |
| Panels | `server/panels/{core,safety,finance,ops,index}.ts` | 12 panels, each cell carrying a verdict and a source citation |
| Values | `server/values.ts` | the five-state vocabulary: `VERIFIED`, `EMPTY`, `UNKNOWN`, `NOT VERIFIED`, `NOT APPLICABLE` |
| Actions | `server/commands.ts` | health-check, backup verification, restore plan/execute (guarded) |
| Audit | `server/audit.ts` | append-only JSONL, redacted, best-effort |
| Guards | `server/home.ts`, `server/verify.ts`, `server/redact.ts`, `server/digest.ts` | HOME assertion, backup manifest verification, secret redaction, hashing |
| Transport | `server/http.ts`, `server/stream.ts` | headers, static/SPA serving, SSE stream |

**Design invariant:** the console observes; it does not mutate Conway state. It imports no
`createDatabase()`, so the V12/V13 migrations cannot run from the UI. A test asserts this.

### 2.2 Control plane — `src/security/` (11 modules)

| Module | Responsibility | Demonstrated |
|---|---|---|
| `activation.ts` | two-signal gate: `security.activationApproved === true` **and** `CONWAY_ACTIVATION=APPROVED` | **yes** — refused |
| `tool-authorizer.ts` | capability classification per tool; allow-by-name, allow-by-capability, else deny | **yes** — 6 denials |
| `policy-enforcement.ts` | required-capability policy layer presence checks | read |
| `audit-chain.ts` | hash-chained security events, seals | **not verifiable** — tables absent (V12/V13) |
| `incidents.ts` | incident records | source present, tables absent |
| `emergency-stop.ts` | marker-file union scan across candidate paths | **yes** — `NOT ENGAGED` |
| `live-model-preflight.ts` | pre-flight checks before a live model call | not exercised |

Denial reasons are typed (`NOT_ALLOWLISTED`, `TOOL_REVOKED`, `UNCLASSIFIED_TOOL`,
`ALLOWED_BY_NAME`, `ALLOWED_BY_CAPABILITY`) and each decision returns capabilities, a timeout and an
output cap.

### 2.3 Intelligence plane — `src/inference/` (7 modules)

```
inferenceModel (automaton.json)
        │
        ▼
ProviderRegistry.fromConfig(inference-providers.json)
        │  validates every baseUrl through P-6 (provider-url.ts)
        │  resolves credential from process.env by provider id
        ▼
resolveModel(tier) → ordered candidate list
        │  reasoning: freellmapi → openai → groq → (together, local disabled)
        │  fast:      freellmapi → groq → openai
        │  cheap:     freellmapi → groq → together → local → openai
        ▼
UnifiedInferenceClient  ── OpenAI SDK transport ──► provider
        │  retry on 429/500/503 with 1s/2s/4s backoff
        │  circuit breaker: 5 failures → 5 minutes disabled
        │  metadata: providerId, modelId, tier, latencyMs, retries, failedProviders
        ▼
UnifiedInferenceResult (content, toolCalls, usage, cost, metadata)
```

The registry's **P-6 validator** (`src/inference/provider-url.ts`) is the security-relevant part:
it rejects non-loopback plaintext HTTP, blocks credential-bearing URLs, and the transport is created
with `redirect: "error"` so a provider cannot bounce the request to another origin. All five
configured endpoints pass; zero were rejected.

### 2.4 State plane — `src/state/` + `runtime/home/.automaton/state.db`

SQLite, WAL journal, **38 tables**, live schema **V11**. In this deployment **37 tables are empty**;
`schema_version` holds 10 rows (V2–V11). Four tables the code expects do not exist yet:
`treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`.

Tables group into: identity (`identity`, `registry`, `reputation`), cognition
(`working_memory`, `episodic_memory`, `semantic_memory`, `procedural_memory`, `knowledge_store`,
`soul_history`), execution (`turns`, `tool_calls`, `task_graph`, `goals`, `event_stream`), economy
(`spend_tracking`, `transactions`, `onchain_transactions`, `inference_costs`), scheduling
(`heartbeat_*`, `wake_events`), multi-agent (`children`, `child_lifecycle_events`), and governance
(`policy_decisions`, `modifications`, `schema_version`).

### 2.5 Reliability plane — `src/reliability/` (2 modules)

```
runHealthChecks({db, config, automatonDir})
   ├─ emergency_stop        (marker scan)
   ├─ database_integrity    (quick_check)
   ├─ schema_version        (live vs code)
   ├─ audit_chain           (verifySecurityChain + verifySeals)
   ├─ treasury_reservations (stale reservations)
   ├─ scheduler_leases      (expired leases)
   ├─ disk_space            (free ratio)
   └─ wallet_storage        (format only, never key material)
        │
        ▼  HealthReport { overall: ok|degraded|critical, checks[] }
        │
classifyRepair(repairId) → automatic | requires_approval | forbidden
        │
runMechanic(report, {db, config, automatonDir})
        └─ returns immediately with skippedReason when
           security.selfHealingEnabled === false  ← current state
```

**Separation of concerns is real:** the guardian is read-only, the classifier is pure, and the
mechanic is the only mutating component — gated, and additionally suppressed while the emergency stop
is engaged. The forbidden list is enforced by classification, not by prompt text: audit disabling,
key rotation, credit transfer, child spawning, activation, and permission widening are all
`forbidden` by name.

### 2.6 Execution plane — present but inert

| Subsystem | Files | State |
|---|---|---|
| Agent loop | `src/agent/` (24 files) | never started |
| Orchestration | `src/orchestration/` (12) | no tasks |
| Heartbeat | `src/heartbeat/` (5) | 6 declared, 3 enabled in YAML, 0 in DB |
| Replication | `src/replication/` (8) | `maxChildren=0`, `allowReplication=false` |
| Self-modification | `src/self-mod/` (4) | `allowSelfModification=false` |
| Survival / social / skills | 3 + 4 + 3 | no activity |
| Memory | `src/memory/` (16) | no rows |
| Identity / wallet | `src/identity/` (4) | **no wallet file** |

---

## 3. HTTP surface — the complete route table

Verified from `dashboard/server/routes.ts`; nothing below is invented.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth` | token in body | exchange operator token for an HttpOnly session cookie |
| POST | `/api/logout` | session | drop the session |
| GET | `/api/session` | session | session validity |
| GET | `/api/health` | **none** | liveness + pid + verdict (deliberately unauthenticated so a supervisor can probe it) |
| GET | `/api/panels` | session | all 12 panels in one snapshot |
| GET | `/api/panel/:id` | session | one panel |
| GET | `/api/system` | session | ids, DB state, HOME guard |
| POST | `/api/action/health-check` | session + `x-conway-request: 1` | run the guardian read-only and persist to `dashboard/state` |
| POST | `/api/action/verify-backups` | session + CSRF header | verify backup manifests |
| POST | `/api/action/restore` | session + CSRF header | plan/execute a **verified** restore |

There is **no** `/api/action/start`, no activation endpoint, no wallet endpoint, no shell endpoint.
A probe against `/api/action/start` returned `404`.

**Request gate order** (`server/index.ts` → `routes.ts`):

1. bind assertion — host must be `127.0.0.1`, port must not be in `FORBIDDEN_PORTS` (3001 is
   explicitly reserved for another project)
2. method/path match
3. `isTrustedRequest` — `sec-fetch-site` same-origin, `origin` must be `http://127.0.0.1:8787`,
   referer prefix for writes, and `x-conway-request: 1` on every non-GET
4. authentication — Bearer token or session cookie
5. rate limit — 40-token bucket per client
6. handler

---

## 4. Data flow: one panel read

```
GET /api/panels
  → isTrustedRequest()            origin + fetch-site
  → isAuthenticated()             Bearer or cookie
  → rateLimit()
  → buildAllPanels(buildSnapshot())
        buildSnapshot():
          readConfig()            automaton.json            (read-only)
          providersView()         inference-providers.json  + P-6 validation
          walletView()            existence only
          dbInventory()           open readonly, pragma integrity, schema, counts
          healthView()            runHealthChecks() read-only
          heartbeatView()         YAML vs DB
          backupsView()           manifest directories
          logsView()              files + sizes
          activationView()        checkActivation()
          emergencyStopView()     marker scan
          osSample()             disk, memory, cpu count
        → Panel[] each cell: { verdict, value, note, source, observedAt }
  → JSON
  → audit({ event: "panel.read", ... })
```

The `verdict` field is the honesty mechanism: a cell can never render a bare number without saying
whether it was observed, counted as empty, unknowable, or unverifiable.

---

## 5. Trust boundaries

| Boundary | Control | Verified |
|---|---|---|
| Browser → console | loopback bind, operator token, session cookie (`HttpOnly`, `SameSite=Strict`), origin check, CSRF header | yes |
| Console → state | SQLite `readonly`, no `createDatabase()` import, dedicated test | yes |
| Console → host | no shell execution path, no file writes outside `dashboard/state` and `dashboard/logs` | yes (by import audit + `danger-imports.test.ts`) |
| Agent → world | activation gate, tool authoriser, capability grants, treasury policy, `maxChildren=0` | gate verified; agent never ran |
| Process → provider | P-6 URL validation, `redirect: "error"`, credential from env only | validation verified; no call made |
| Console → backup restore | manifest verification before any byte is restored | bogus plan refused |

---

## 6. What is architecturally absent (not "broken")

- No message queue, no external broker, no multi-node coordination. Single-process, single-host.
- No secrets manager. Credentials are environment variables, by design.
- No write API for Conway state. The console is intentionally one-way.
- No telemetry exporter. Metrics exist only as DB rows (all zero here) and dashboard JSON files.
- No HTTPS. Loopback-only HTTP with a token is the stated threat model; adding TLS would not change
  the trust boundary on a single-user host.

---

## 7. Why the console was reused instead of building a demo app

The console already implements the exact properties a demo needs and a demo app would have to fake:
a real auth wall, a real read-only DB handle, per-cell evidence labels, a real audit trail, and
19 self-checks. Building a second surface would have duplicated process management and introduced a
new thing to secure. The demonstration therefore adds **one batch launcher** and **transient probe
scripts under `runtime/tmp/`** (gitignored), and changes no product code.
