# Conway Automaton — Executive Summary

**Demonstration date:** 2026-11-09 (local, Asia/Kolkata)
**Project root:** `<repo-root>`
**Canonical HOME:** `<repo-root>\runtime\home`
**Console:** `http://127.0.0.1:8787` (loopback only)
**Git HEAD:** `d8f816881fd24b6f5e3d616e59edec387a447667` (branch `main`)

---

## 1. Verdict

> **A real, working, read-only control centre over a deliberately inactive agent. The control plane, the security gates, the health machinery, the provider registry and the test suite are real and were exercised. The agent itself was never started, no wallet exists, no inference call was made, and nothing touched money.**

| Dimension | Result |
|---|---|
| Console operational | **YES** — 12/12 panels returned, 19/19 launcher health checks passed |
| Security posture | **UNCHANGED** — every gate still closed, all six restricted tools denied |
| Reliability machinery | **REAL, AND DELIBERATELY NOT EXECUTING REPAIRS** |
| AI inference | **NOT DEMONSTRATED (no credential, no authorisation)** — architecture verified, behaviour verified with mocks |
| Database | **UNCHANGED** — byte-identical SHA-256 before and after |
| Test suite | **89 files / 2,229 tests / 0 failures** |
| Agent process | **NONE** |

---

## 2. What Conway actually is, in one paragraph

Conway Automaton is a supervised autonomous-agent runtime. The repository contains a full agent
loop, a SQLite state store, an inference layer with a provider registry and failover, a security
layer with a dual activation gate, tool authorisation and an audit chain, a reliability layer with a
health guardian and a gated repair mechanic, plus a **separate, read-only operator console** that
observes all of that without being able to change it. In this deployment the agent has never run:
the state database is at schema V11, all 37 operational tables are empty, there is no wallet, and
every capability that could act on the world is switched off. What is demonstrably alive is the
**observability and control plane** — and that is precisely what this demonstration exercises.

---

## 3. What was executed live (real processes, real code)

| # | Demonstration | Evidence |
|---|---|---|
| 1 | Operator console launched via the project's own approved launcher | `EV-01` — 19/19 checks pass |
| 2 | All 12 console panels read through the authenticated API | `EV-02` — `/api/panels` 200, 12 panels |
| 3 | Authentication, origin and CSRF denials | `EV-03` — 401 / 403 / 403 / 404 / 400 |
| 4 | Read-only database inspection (schema, integrity, row counts) | `EV-04` — 38 tables, integrity `ok`, hash unchanged |
| 5 | Activation gate + tool authoriser refusal on six restricted tools | `EV-05` — 6/6 `NOT_ALLOWLISTED` |
| 6 | Health guardian run + repair classification + refusal to execute | `EV-06` — 8 checks, 2 plans, 0 actions |
| 7 | FreeLLMAPI reachability and auth enforcement (no credential sent) | `EV-07` — TCP up, `401 Invalid API key` |
| 8 | Mock-only inference, fallback and URL-guard test evidence | `EV-08` — 3 files / 94 tests |
| 9 | Console test suite | `EV-09` — 11 files / 105 tests |
| 10 | Whole repository test suite | `EV-10` — 89 files / 2,229 tests |
| 11 | Before/after integrity comparison | `EV-11` — 17 file hashes + DB hash unchanged |
| 12 | Audit trail of the demonstration itself | `EV-12` — append-only JSONL |
| 13 | `RUN_CONWAY_DEMO.bat` warm and cold launch paths | `EV-13` |

---

## 4. What is real vs simulated vs blocked

### 4.1 REAL — observed on this machine during this demonstration

- The console process, its loopback socket, its operator token gate, its 12 panels.
- The read-only SQLite handle (`readonly: true, fileMustExist: true`) and the absence of migrations.
- The health guardian's eight checks and its persisted report.
- The repair classifier (`classifyRepair`) and the mechanic's refusal to act while disabled.
- The activation gate's refusal and the tool authoriser's six denials.
- The dashboard's own append-only audit log.
- The full test suite.

### 4.2 SIMULATED — labelled, never presented as operational

- **An unhealthy component** (synthetic `HealthReport` with expired scheduler leases and a stale
  treasury reservation). No process or file was touched. The resulting plan was produced by the
  **real** classifier; only the input was synthetic.
- **Provider failure and failover** — driven through the real inference client with the OpenAI
  transport mocked at the module boundary. No packet left the machine.

### 4.3 NOT DEMONSTRATED — blocked, not skipped for convenience

| Scenario | Blocker | Why no workaround was used |
|---|---|---|
| Real inference (Scenario E) | `FREELLMAPI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` all **ABSENT**; no explicit operator authorisation for an outbound request | Credentials may not be harvested from files, browsers or other apps; paid providers may not be substituted |
| Real provider failover | Same | Mocks only |
| Real repair execution | `security.selfHealingEnabled=false` | Enabling it would violate the mission's security invariants |
| Wallet / treasury / transfer flows | No wallet, no funding, all treasury gates closed | Forbidden by mission |

### 4.4 DISABLED BY SECURITY POLICY — must not be "fixed" for a demo

Agent activation · financial tools · host shell · self-modification · replication · child spawning ·
external exposure · self-healing execution · wallet creation. Each is off in configuration **and**
enforced in code.

---

## 5. Findings the operator should know

These are real observations, not demo artefacts.

### F-1 (High, latent) — three treasury limits are effectively non-zero while the config says zero

`runtime/home/.automaton/automaton.json` declares all ten `treasuryPolicy` keys as `0`. But
`loadConfig()` (`src/config.ts:45-48`) merges `DEFAULT_TREASURY_POLICY` **first**:

```ts
const treasuryPolicy: TreasuryPolicy = {
  ...DEFAULT_TREASURY_POLICY,      // non-zero defaults
  ...(raw.treasuryPolicy ?? {}),   // declared zeros for 7 keys
};
```

Three keys are **absent** from `automaton.json` and therefore inherit non-zero defaults:

| Key | Declared | Effective (as loaded) |
|---|---|---|
| `maxMonthlyTransferCents` | *absent* | **100000** ($1,000) |
| `agentBudgetCents` | *absent* | **200000** ($2,000) |
| `childBudgetCents` | *absent* | **50000** ($500) |

**No money can move today** — `lockdown=true`, `allowedTools=[]`, `allowFinancialTools=false`, and
`transfer_credits` is denied `NOT_ALLOWLISTED`. This is a **latent** defect: it becomes reachable the
moment financial tools are enabled and the operator believes the limits are zero. The dashboard
already surfaces it in the Treasury panel as "declared vs default". **Recommendation:** declare all
ten keys explicitly, or change the merge so an explicit `treasuryPolicy` object is not silently
widened by defaults.

### F-2 (Medium) — schema drift, V11 live vs V13 expected

Live `user_version` is `0` (unused) and the `schema_version` table stops at **V11** with 10 rows
(V2–V11). Code expects **V13**. Four tables that V12/V13 would create are absent:
`treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`. Consequences:

- The health guardian's `audit_chain` check reports **fail** with `no such table: security_events`.
- That single missing source is what makes the guardian's overall verdict `critical`.
- The console correctly reclassifies it to **`degraded`** and marks the check `NOT VERIFIED`
  (absent source) rather than pretending the chain was verified or that it was tampered with.

The console never migrates: it imports no `createDatabase()`, opens the DB read-only, and a dedicated
test (`dashboard/tests/readonly-db.test.ts`) asserts the four tables are still absent.

### F-3 (Low) — the heartbeat is declared but has never been synchronised

`heartbeat.yml` declares **6** entries, **3** are enabled in the YAML, and the database holds **0**
(`heartbeat_entries` empty). `syncHeartbeatToDb()` has never run. This is the expected state of an
agent that has never been activated — reported here so nobody mistakes "3 enabled in YAML" for
"3 running". Nothing is scheduled, nothing has executed.

### F-4 (Medium) — failover is narrower than "fallback" implies

`isRetryableError()` only treats HTTP **429 / 500 / 503** as retryable. The characterisation tests
record that a **connection failure, a timeout, a 401, and a 200-with-no-choices all abort the tier
without failing over**. Only rate-limit and server-error classes walk the provider order. This is
documented behaviour, not a bug discovered today — but it means "fallback" should not be read as
"any provider failure is survivable".

### F-5 (Informational) — 37 of 38 tables are empty

Only `schema_version` holds rows. `turns`, `tool_calls`, `transactions`, `inference_costs`,
`model_registry`, `heartbeat_*`, `children`, `wallet`-adjacent state: all zero. Every "0" in the
console is a **counted** zero (`EMPTY`), not an unknown, and the console distinguishes the two.

---

## 6. How to run the demonstration

```bat
RUN_CONWAY_DEMO.bat
```

It pins `HOME` to `runtime\home`, reuses a console already answering on `127.0.0.1:8787`, otherwise
starts the existing launcher, waits for `/api/health`, and opens the browser. It never starts the
agent and never sets `CONWAY_ACTIVATION`.

```bat
STOP_CONWAY_DASHBOARD.bat     :: stops only the console it recorded
HEALTH_CHECK_DASHBOARD.bat    :: 19 read-only self-checks
```

The operator token lives in `dashboard\state\dashboard.token`. Paste it once into the console; it is
never printed by any script in this demonstration.

---

## 7. Deliverables

| File | Contents |
|---|---|
| `CONWAY_DEMO_EXECUTIVE_SUMMARY.md` | This document |
| `CONWAY_DEMO_ARCHITECTURE.md` | Layers, modules, request and data flow |
| `CONWAY_DEMO_CAPABILITY_MATRIX.md` | Every capability classified with evidence |
| `CONWAY_DEMO_AI_INTEGRATION.md` | Registry, routing, retry, fallback, Scenarios A–E |
| `CONWAY_DEMO_SECURITY_WALKTHROUGH.md` | Invariants, gates, denials, audit, F-1 |
| `CONWAY_DEMO_RELIABILITY_WALKTHROUGH.md` | Guardian, mechanic, simulated recovery |
| `CONWAY_DEMO_TEST_RESULTS.md` | Exact counts and what the tests do not prove |
| `CONWAY_DEMO_FINAL_ACCEPTANCE.md` | Checklist, hashes, changed files, skipped scenarios |

---

## 8. What production readiness would require

1. Decide the intended posture: the system is currently **safe because it is inert**. Activation,
   wallet creation and financial tooling are all gated off, and nothing has ever run.
2. Resolve **F-1** before any financial capability is enabled.
3. Apply V12/V13 migrations deliberately (never from the console) so the audit chain and treasury
   tables exist, then re-run the guardian — `critical` should become `degraded`/`ok` on merit.
4. Supply credentials through the process environment only, then re-run Scenario E with an explicit
   operator authorisation and a spend ceiling.
5. Widen `isRetryableError` if timeout/connection failover is actually required, and re-baseline the
   fallback tests.
6. Keep the console read-only, loopback-only and single-instance. That property is tested, not
   aspirational.

---

## 9. Honesty statement

Every number in these reports comes from a command run on this machine during this demonstration, or
from a file the demonstration produced. Nothing was estimated. Where no verified source exists the
reports say **NOT MEASURED** or **NOT VERIFIED** rather than inventing a figure. Simulated inputs are
labelled `SIMULATED` at the point of use. Real inference was **not** performed and is reported as
**NOT DEMONSTRATED**.
