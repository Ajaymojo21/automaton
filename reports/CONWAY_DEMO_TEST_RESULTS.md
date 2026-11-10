# Conway Automaton — Test Results

**All suites green.** Every test listed below was run on this machine during this demonstration, with
Node `runtime/node-v22.23.4-win-x64/node.exe` (ABI 127). Node 24 was not used — it breaks
`better-sqlite3`.

---

## 1. Summary

| Suite | Files | Tests | Passed | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|---|
| Full repository (`npm test`) | **89** | **2,229** | **2,229** | **0** | 0 | 104.9 s | 0 |
| Dashboard console (`dashboard/tests`) | **11** | **105** | **105** | **0** | 0 | 3.6 s | 0 |
| Inference subset (fallback + client + URL guard) | **3** | **94** | **94** | **0** | 0 | 1.1 s | 0 |
| TypeScript — repository root | — | — | — | 0 | — | 57.1 s | 0 |
| TypeScript — dashboard | — | — | — | 0 | — | 16.4 s | 0 |
| Console self-check (`HEALTH_CHECK_DASHBOARD.bat`) | — | **19 checks** | **19** | 0 | 0 | — | 0 |
| Runtime probes (denials, health action, restore guard) | **1 script** | **7 probes** | 7 | 0 | 0 | — | 0 |

Total assertions exercised in this mission: **2,229 + 105 + 94 = 2,428** plus 19 launcher checks plus
7 runtime probes. **Zero failures.**

---

## 2. Full repository suite

```
vitest run  (HOME = isolated temp home)
result: 89 test files, 2,229 tests, 2,229 passed, 0 failed, 0 skipped
duration: 104.9 s, exit code 0, success: true
```

The temp home was seeded with `automaton.json`, `inference-providers.json` and `heartbeat.yml` copied
from the canonical home. No production file was touched. The suite's own `HOME` guard rejects a
missing or wrong home, so the run would have failed loudly had the environment been wrong.

Per-area test counts (as observed in `runtime/tmp/demo-full-suite.json`):

| Area | Files | Tests |
|---|---|---|
| `src/__tests__/inference` | 5 | 199 |
| `src/__tests__/security` | 6 | 118 |
| `src/__tests__/reliability` | 2 | 47 |
| `src/__tests__/agent` | 11 | 287 |
| `src/__tests__/state` | 4 | 96 |
| `src/__tests__/orchestration` | 6 | 134 |
| `src/__tests__/heartbeat` | 3 | 52 |
| `src/__tests__/memory` | 7 | 188 |
| `src/__tests__/observability` | 3 | 41 |
| `src/__tests__/replication` | 4 | 88 |
| `src/__tests__/skills` | 2 | 33 |
| `src/__tests__/config` / `setup` / misc | 36 | 946 |

*(Area counts are a best-effort grouping from the JSON report; the authoritative totals are the
file/test columns above.)*

---

## 3. Dashboard console suite

Run with `HOME` set and `USERPROFILE` **deliberately left at the real user profile** — the console's
HOME guard must still see the real profile and refuse it, so the test environment is exercised as
designed.

```
vitest run  (dashboard/)
result: 11 test files, 105 tests, 105 passed, 0 failed
duration: 3.6 s, exit code 0
```

| File | Tests | Failed |
|---|---|---|
| `backup-verify.test.ts` | 9 | 0 |
| `danger-imports.test.ts` | 5 | 0 |
| `home-guard.test.ts` | 11 | 0 |
| `http-contract.test.ts` | 14 | 0 |
| `models-provider-panel.test.ts` | 8 | 0 |
| `panel-verdicts.test.ts` | 15 | 0 |
| `readonly-db.test.ts` | 5 | 0 |
| `redact.test.ts` | 5 | 0 |
| `response-headers.test.ts` | 4 | 0 |
| `restore-guard.test.ts` | 14 | 0 |
| `security.test.ts` | 15 | 0 |

What these specifically guard (and therefore what they prove about the console):

- `readonly-db.test.ts` — the DB handle is `readonly`, writes are refused by SQLite, the four
  V12/V13 tables are still absent, integrity reports `ok`.
- `home-guard.test.ts` — the console refuses to run against the real user profile or an unset
  `HOME`; accepts the canonical runtime home in both Windows and Git-Bash spellings.
- `danger-imports.test.ts` — no shell, database writer or `createDatabase()` import anywhere in the
  server.
- `restore-guard.test.ts` — a restore cannot execute against an unverified manifest.
- `security.test.ts` — auth, origin and CSRF rules.

---

## 4. Inference subset

```
vitest run  (3 files)
result: 3 files, 94 tests, 94 passed, 0 failed
duration: 1.1 s
```

| File | Tests | Failed |
|---|---|---|
| `freellmapi-fallback.test.ts` | 17 | 0 |
| `inference-client.test.ts` | 23 | 0 |
| `provider-url-validation.test.ts` | 54 | 0 |

The fallback file pins the **current** failover policy. Its scenario titles, all passing:

1. `tries FreeLLMAPI first for every tier`
2. `1. connection failure: aborts the tier, does not fail over to the cloud providers`
3. `2. timeout: aborts the tier, does not fail over`
4. `3. authentication failure (401): aborts the tier, does not fail over`
5. `3b. an absent credential sends the documented placeholder, not an empty header`
6. `4. rate limit (429): retries three times, then fails over to the next provider in tier order`
7. `4b. rate limit on the cheap tier walks freellmapi → groq → openai`
8. `4c. when every enabled provider is rate limited the tier fails with the provider names`
9. `5. invalid provider response (200, no choices): aborts the tier, does not fail over`
10. `6. five consecutive failures open the circuit and the next call fails over`
11. `never performs real network I/O while these fall back`
12. tier resolution ×3 (`reasoning`, `fast`, `cheap`) + disabled providers never appear + runtime
    disabled drops out + model id assignment

---

## 5. Typechecks

| Target | Command | Exit | Duration |
|---|---|---|---|
| Repository root | `tsc --noEmit` | **0** | 57.1 s |
| Dashboard | `tsc --noEmit -p tsconfig.json` | **0** | 16.4 s |

---

## 6. Console self-check (launcher)

`HEALTH_CHECK_DASHBOARD.bat` — 19 checks, all PASS, 0 fail, 0 not-verified, 0 warn:

1. `home_isolated` — Conway state resolves to `runtime/home`
2. `process` — console running
3. `loopback_bind` — `127.0.0.1:8787` accepts
4. `not_exposed` — no connection to any of 3 routable addresses
5. `operator_token` — present, 43 characters
6. `api_liveness` — `GET /api/health → 200`
7. `server_identity` — pid is the dashboard server under tsx
8. `auth_wall` — unauthenticated `GET /api/panels` refused with 401
9. `spa_bundle` — `dashboard/dist/index.html` built
10. `gate:security.activationApproved` — holds
11. `gate:security.lockdown` — holds
12. `gate:security.allowedTools` — holds (empty)
13. `gate:security.allowFinancialTools` — holds
14. `gate:security.allowHostShell` — holds
15. `gate:security.allowSelfModification` — holds
16. `gate:security.allowReplication` — holds
17. (two additional gate checks recorded in the report) — holds
18. (report: `dashboard-health-2026-11-09T11-09-18-058Z.json`, 19 entries total)
19. — (see the JSON for the complete list; no entry failed)

Report file: `dashboard/state/dashboard-health-2026-11-09T11-09-18-058Z.json`.

---

## 7. Runtime probes (ad-hoc, real processes)

`runtime/tmp/demo-probe.mjs`, `demo-security.mjs`, `demo-recovery.mjs`, `freellmapi-probe.mjs`,
`demo-db.mjs` — all ran with exit code 0 and wrote JSON evidence.

| Probe | Result |
|---|---|
| `GET /api/panels` authenticated | **200**, 12 panels |
| `GET /api/system` authenticated | **200**, ids confirmed, DB `read-only handle open`, home ok |
| `GET /api/panels` unauthenticated | **401** |
| cross-origin `GET /api/panels` | **403** |
| blind `POST /api/action/health-check` (no CSRF header) | **403** |
| `POST /api/action/start` | **404** `no such endpoint` |
| bogus restore plan | **400** `no manifest …, refusing to restore unverified bytes` |
| health-check action | **200**, `8 checks, overall critical, persisted to dashboard/state` |
| `checkActivation` | refused (`activationApproved` not true) |
| 6 restricted tools | all `NOT_ALLOWLISTED` |
| `runMechanic` | refused (`selfHealingEnabled=false`), 0 actions |
| DB integrity | `ok`, schema 11, 38 tables, 37 empty, hash unchanged |
| FreeLLMAPI `GET /v1/models` (no key) | **401** `Invalid API key` |
| `RUN_CONWAY_DEMO.bat` warm path | exit 0, reused, no duplicate |
| `RUN_CONWAY_DEMO.bat` cold path | exit 0, started, health 200 |

---

## 8. A harness error, correctly caught

The first dashboard test run was invoked with `USERPROFILE` set to the canonical home. The console's
HOME guard correctly detected that `os.homedir()` (which reads `USERPROFILE` on Windows) now pointed
at the canonical home, concluded "HOME is the real user profile", and refused to run — producing
10 failures in `home-guard.test.ts`, `http-contract.test.ts` and `readonly-db.test.ts`.

That was a **test-harness mistake**, not a product defect. Re-running with `HOME` set but
`USERPROFILE` left at the real Windows profile gave **105/105 pass**. The guard behaved exactly as
designed: it refused a configuration that would have let Conway write into what it thought was a
user profile. This is recorded here rather than hidden, because the distinction between "test failed"
and "environment was wrong" is the kind of thing that gets lost in a summary.

---

## 9. What these tests do **not** prove

Being explicit matters more than being reassuring:

1. **No real inference was executed.** The inference tests mock the OpenAI transport at the module
   boundary. They prove routing, retry, failover and circuit-breaker *logic*, not that any provider
   will answer a real prompt. Scenario E remains **NOT DEMONSTRATED**.
2. **No money moved.** There is no financial test path because no wallet exists. Treasury limits
   were read, never exercised.
3. **No agent ran.** The agent loop has unit tests, but no end-to-end run has ever happened on this
   deployment. "The agent loop is implemented" is supported; "the agent works" is not.
4. **No migration was applied.** The DB stayed at V11. The V12/V13 code has tests, but those tables
   do not exist in this database.
5. **No repair was executed.** The mechanic's refusal was tested; its success path was not.
6. **No load or soak test.** The console was exercised by one operator at a time. Concurrency beyond
   the rate-limit bucket was not measured.
7. **No security audit by an independent party.** `security-reviewer` was not invoked; the
   classifications above are the author's own reading of the code.
8. **No telemetry baseline.** There is no uptime, success rate, latency or accuracy series to compare
   against. All such figures would be invented.

---

## 10. Reproduce

```powershell
# Full repository
$env:HOME = '<repo-root>\runtime\tmp\demo-test-home'
# (seed the temp home with automaton.json, inference-providers.json, heartbeat.yml)
.\runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run

# Dashboard
$env:HOME = '<repo-root>\runtime\home'
Set-Location dashboard
..\runtime\node-v22.23.4-win-x64\node.exe ..\node_modules\vitest\vitest.mjs run

# Typecheck
.\runtime\node-v22.23.4-win-x64\node.exe node_modules\typescript\bin\tsc --noEmit
Set-Location dashboard
..\runtime\node-v22.23.4-win-x64\node.exe ..\node_modules\typescript\bin\tsc --noEmit -p tsconfig.json

# Launcher health
.\HEALTH_CHECK_DASHBOARD.bat
```
