# Conway Automaton — Final Acceptance Report

**Demonstration completed:** 2026-11-09
**Final console state:** RUNNING — `http://127.0.0.1:8787`, server pid 32720, launcher pid 32052
**Git HEAD:** `d8f816881fd24b6f5e3d616e59edec387a447667` (unchanged, branch `main`)
**Node:** `runtime/node-v22.23.4-win-x64/node.exe` (ABI 127)

---

## 1. Acceptance checklist (mission §14)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Verify the dashboard | **PASS** | `EV-01`: 19/19 self-checks, `/api/health` 200, `VERIFIED` |
| 2 | Verify the demo launcher | **PASS** | `EV-13`: warm reuse (no duplicate) + cold start (health 200, new pid) both exit 0 |
| 3 | Verify the demo scenarios | **PASS** | `EV-02` … `EV-08`: all 8 scenarios executed or explicitly labelled `SIMULATED` / `NOT DEMONSTRATED` |
| 4 | Verify the security invariants | **PASS** | `EV-05`: all 10 invariants hold, 6 restricted tools denied |
| 5 | Verify the database remains unchanged | **PASS** | `EV-04`, `EV-11`: SHA-256 `2A8AEB34…EFBBA` identical, size 512,000 B, 38 tables, 37 empty |
| 6 | Verify provider configuration remains unchanged | **PASS** | `EV-11`: `inference-providers.json` hash `A126C4E0…3855` identical to template; no write |
| 7 | Verify FreeLLMAPI remains untouched | **PASS** | `EV-07`: TCP up, pid 17708 alive, no source/config/binding change, auth still enforced |
| 8 | Verify no agent process was activated | **PASS** | process scan: `NONE`; `CONWAY_ACTIVATION` absent; activation gate refused |
| 9 | Verify all demo artifacts are isolated | **PASS** | all probes under `runtime/tmp/` (gitignored); dashboard writes only to `dashboard/state` + `dashboard/logs` |
| 10 | Run the relevant test suite | **PASS** | `EV-10`: 89 files / 2,229 tests / 0 failures; dashboard 11/105; inference 3/94; tsc 0 errors |
| 11 | Record exact results | **PASS** | `CONWAY_DEMO_TEST_RESULTS.md` |
| 12 | Produce the final report | **PASS** | this document |

**Overall verdict: ACCEPTED.**

---

## 2. Integrity comparison — before vs after

### 2.1 Critical file hashes (17 files)

| File | SHA-256 (first 16) | Verdict |
|---|---|---|
| `runtime/home/.automaton/automaton.json` | `1C10ECC569222AEB` | UNCHANGED |
| `runtime/home/.automaton/inference-providers.json` | `A126C4E02077AB7D` | UNCHANGED |
| `config/inference-providers.template.json` | `A126C4E02077AB7D` | UNCHANGED |
| `package.json` | `20EED12B7E867078` | UNCHANGED |
| `vitest.config.ts` | `6EE48451AE935AE5` | UNCHANGED |
| `tsconfig.json` | `91DD9DDD49F3AEF7` | UNCHANGED |
| `src/inference/provider-url.ts` | `BBCBA34CFDC880FE` | UNCHANGED |
| `src/inference/provider-registry.ts` | `BBDE82A7A7ED37E8` | UNCHANGED |
| `src/inference/inference-client.ts` | `CA0616619FDC3CAC` | UNCHANGED |
| `src/agent/loop.ts` | `E97C188715655413` | UNCHANGED |
| `src/config.ts` | `8BC16FFB70EA0CB6` | UNCHANGED |
| `src/types.ts` | `2345854DFE699FAC` | UNCHANGED |
| `dashboard/server/index.ts` | `A04C4AC5B474C455` | UNCHANGED |
| `dashboard/server/db.ts` | `8036368D4B9CC70C` | UNCHANGED |
| `dashboard/server/routes.ts` | `572562DBEB254CF6` | UNCHANGED |
| `dashboard/server/panels/core.ts` | `19DDF64B28E55351` | UNCHANGED |
| `dashboard/server/panels/safety.ts` | `2409B6EA573A3E6B` | UNCHANGED |

### 2.2 Database

| Field | Before | After | Verdict |
|---|---|---|---|
| `state.db` SHA-256 | `2A8AEB3494F1507A352F591C5EF40B7320813E18796B077B01448582619EFBBA` | identical | **UNCHANGED** |
| Size | 512,000 B | 512,000 B | UNCHANGED |
| Schema (live) | 11 | 11 | UNCHANGED |
| `integrity_check` | ok | ok | UNCHANGED |
| Table count | 38 | 38 | UNCHANGED |
| Populated tables | 1 (`schema_version`, 10 rows) | identical | UNCHANGED |
| `state.db-shm` | 32,768 B, mtime 10:52:13 | 32,768 B, mtime 16:40:05 | **mtime only** (sidecar, expected, disclosed) |
| `state.db-wal` | 0 B | 0 B | UNCHANGED |

### 2.3 Git state

| Field | Before | After | Verdict |
|---|---|---|---|
| HEAD | `d8f81688…` | `d8f81688…` | UNCHANGED |
| Branch | `main` | `main` | UNCHANGED |
| Tracked modifications | 41 | 41 | UNCHANGED |
| Untracked paths | 44 | 44 | UNCHANGED |
| Total changes | 85 | 85 | UNCHANGED |

No tracked file was modified by this demonstration. The counts did not move, which is the strongest
available statement that nothing product-level was touched.

### 2.4 FreeLLMAPI

| Field | Observation | Verdict |
|---|---|---|
| Process pid 17708 | alive throughout | UNCHANGED |
| Port 3001 | TCP connects | UNCHANGED |
| `GET /v1/models` without credential | `401 Invalid API key` | auth still enforced |
| Source / config / binding | not touched | UNCHANGED |

### 2.5 Security invariants

All 10 invariants re-read after the demonstration; all hold (see `CONWAY_DEMO_SECURITY_WALKTHROUGH.md`
§1). Activation environment variables remain `ABSENT`.

---

## 3. Files created by this demonstration

Only new files. No tracked file was modified.

### 3.1 Repository root

| File | Purpose |
|---|---|
| `RUN_CONWAY_DEMO.bat` | single demo launcher (canonical HOME, duplicate detection, browser open) |

### 3.2 Reports (8 deliverables)

| File |
|---|
| `reports/CONWAY_DEMO_EXECUTIVE_SUMMARY.md` |
| `reports/CONWAY_DEMO_ARCHITECTURE.md` |
| `reports/CONWAY_DEMO_CAPABILITY_MATRIX.md` |
| `reports/CONWAY_DEMO_AI_INTEGRATION.md` |
| `reports/CONWAY_DEMO_SECURITY_WALKTHROUGH.md` |
| `reports/CONWAY_DEMO_RELIABILITY_WALKTHROUGH.md` |
| `reports/CONWAY_DEMO_TEST_RESULTS.md` |
| `reports/CONWAY_DEMO_FINAL_ACCEPTANCE.md` (this file) |

### 3.3 Transient evidence (gitignored, under `runtime/tmp/`)

| File | Purpose |
|---|---|
| `demo-baseline.json` | pre-demo hashes, counts, sidecars, ports, credential presence |
| `demo-probe.mjs` / `demo-probe.json` | authenticated 12-panel fetch + 5 denial probes |
| `freellmapi-probe.mjs` / `freellmapi-probe.json` | read-only FreeLLMAPI reachability |
| `demo-recovery.mjs` / `demo-recovery.json` | real health report, plan, refusal, simulated scenario, forbidden probes |
| `demo-security.mjs` / `demo-security.json` | activation refusal + 6 tool denials + gate reading |
| `demo-db.mjs` / `demo-db.json` | read-only DB inspector (schema, counts, integrity, before/after hash) |
| `demo-inference-tests.json` + `.log` | 3 inference files / 94 tests |
| `demo-dashboard-tests.json` + `.log` | 11 dashboard files / 105 tests |
| `demo-full-suite.json` + `.log` | 89 files / 2,229 tests |
| `demo-tsc-root.log` / `demo-tsc-dashboard.log` | typecheck output |
| `demo-test-home/` | isolated HOME used by the full suite |

### 3.4 Dashboard-generated (under `dashboard/state` and `dashboard/logs`)

| File | Purpose |
|---|---|
| `dashboard/state/dashboard-health-2026-11-09T11-09-18-058Z.json` | 19-check self-check report |
| `dashboard/state/health-2026-11-09T11-10-07-106Z.json` | guardian report from the health-check action |
| `dashboard/state/dashboard.pid` | overwritten with the new launcher pid |
| `dashboard/logs/audit-2026-11-09.jsonl` | **appended** — new denial/auth events from this demo |
| `dashboard/logs/dashboard.out.log` | **appended** — startup lines |

None of the above are tracked by git (the `dashboard/` and `runtime/` trees are untracked in this
working copy), and none changes Conway state.

### 3.5 Cleanup performed

- `runtime/tmp/demo-test-home/` is retained for reproducibility; it contains only copies of three
  config files, no secrets, and is gitignored.
- The console is **left running** for the operator, as required ("leave it running for the operator").
- No temporary DB rows, no migration, no production config write.

---

## 4. Skipped scenarios and why

| Scenario (mission §8) | Status | Reason |
|---|---|---|
| DEMO 1 — System startup | **executed** | console up, health 200 |
| DEMO 2 — AI request lifecycle | **executed (mock)** | mocks only; real path NOT DEMONSTRATED |
| DEMO 3 — Provider failure | **executed (mock)** | 401/timeout/connection/empty-200 abort; 429/500/503 fail over |
| DEMO 4 — Security denial | **executed** | 6 tools denied, activation refused |
| DEMO 5 — Health monitoring | **executed** | synthetic unhealthy report; guardian ran for real |
| DEMO 6 — Recovery planning | **executed (simulated)** | no repair executed |
| DEMO 7 — Audit and reporting | **executed** | audit trail + health reports + 8 documents |
| DEMO 8 — Final system status | **executed** | §5 below |
| Scenario E — real inference | **NOT DEMONSTRATED** | `BLOCKED_CREDENTIAL`: no key, no authorisation |
| Real repair execution | **NOT EXECUTED** | `selfHealingEnabled=false` |
| Wallet / treasury / transfer flows | **NOT DEMONSTRATED** | no wallet, no funding, gates closed |
| V12/V13 migration | **NOT APPLIED** | prohibited; would change production state |
| Cold-start of the launcher | **executed** (§1, item 2) | verified end-to-end |
| Independent security review | **not performed** | no `security-reviewer` was invoked; classifications are the author's own |

Every skipped or non-executed item has a stated blocker; none was skipped for convenience.

---

## 5. Final system status (DEMO 8)

| Capability area | Status |
|---|---|
| Console | **operational** — loopback, token-gated, 12 panels, 19/19 self-checks |
| Security gates | **closed** — all invariants hold, 6 tools denied |
| Health monitoring | **operational** — 8 checks, guardian + persisted report |
| Self-healing execution | **disabled by policy** — mechanic refuses, 0 actions |
| Provider registry | **operational** — 5 providers, P-6 valid, 0 rejected |
| Real inference | **NOT DEMONSTRATED** — no credential |
| Fallback logic | **verified with mocks** — 429/500/503 only |
| Database | **intact** — V11, 38 tables, 37 empty, hash unchanged |
| Audit chain | **NOT VERIFIED** — `security_events` absent (V12/V13) |
| Heartbeat | **declared, never synced** — 6/3/0 |
| Wallet | **absent** |
| Treasury | **read-only; F-1 latent defect** |
| Agent process | **none** |
| Tests | **2,229 + 105 + 94 = 2,428 assertions, 0 failures** |
| Typecheck | **0 errors** (root + dashboard) |

---

## 6. Residual risks (carried forward)

1. **F-1 (High, latent):** three treasury limits inherit non-zero defaults despite a zeroed config.
   Fix before any financial capability is enabled.
2. **F-2 (Medium):** V11 vs V13 drift; audit chain and treasury tables absent. Apply migrations
   deliberately, then re-run the guardian.
3. **F-3 (Medium):** no approval surface for `requires_approval` repairs.
4. **F-4 (Medium):** failover aborts on 401/timeout/connection by design.
5. **F-5 (Low):** operator token stored as a file on disk (accepted, single-user loopback model).
6. **F-6 (Low):** console audit sink is best-effort.
7. **F-7 (Low):** no telemetry baseline exists; any performance claim would be invented.
8. **F-8 (Informational):** 37 of 38 tables empty — the system has never executed a turn.

---

## 7. Sign-off

- The demonstration used the **actual repository, dashboard, APIs, tests and configuration**.
- Every figure in the eight reports is either a command result or a file the demonstration produced.
- Where no verified source exists, the reports say `NOT MEASURED` / `NOT VERIFIED` / `NOT DEMONSTRATED`.
- Simulated inputs are labelled `SIMULATED` at the point of use.
- No security invariant was changed. No production state was written. No credential was read or
  printed. No agent was activated. FreeLLMAPI was not touched.
- The console is running at `http://127.0.0.1:8787` for the operator.

**Acceptance: PASS.**
