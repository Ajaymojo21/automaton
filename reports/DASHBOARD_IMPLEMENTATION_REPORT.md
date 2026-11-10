# Phase 17 — DASHBOARD IMPLEMENTATION REPORT

**Deliverable:** CONWAY AUTOMATON / AI COMMAND CENTER — a local, operator-only console that reads
the real Conway system state.
**Verdict:** **DASHBOARD COMPLETE** — with the areas listed in §6 rendered `UNKNOWN` / `NOT VERIFIED`
because the underlying data does not exist yet, not because the code is missing.
**Agent status throughout:** inactive. `security.activationApproved = false`, `security.lockdown = true`,
`security.allowedTools = []`, `maxChildren = 0`, `selfHealingEnabled` never set true. The live config
file hash is identical before and after every dashboard action (§5).

All numbers in this report were produced by commands run in this session and are quoted from their
output. Nothing here is inferred from reading code.

---

## 1. What was built

| Layer | Location | Lines | Role |
|---|---|---|---|
| SPA entry | `dashboard/src/main.tsx`, `App.tsx` | 12 + 226 | 12-area navigation, token gate, live panel rendering, SSE subscription |
| API client | `dashboard/src/api.ts` | 93 | typed fetch wrapper; adds the CSRF header; single cookie/bearer path |
| Shared types | `dashboard/src/types.ts` | 71 | client mirror of the server `Cell` / `Panel` / `RestorePlan` shapes |
| Components | `dashboard/src/components/*` | 429 | `PanelView`, `CellView`, `VerdictBadge`, `Charts`, `Actions`, `TokenGate` |
| Theme | `dashboard/src/index.css` | 175 | premium dark-navy Tailwind 4 theme, verdict colour scale |
| HTTP server | `dashboard/server/index.ts` | 127 | loopback-only listener, fail-closed startup refusals, SSE wiring, graceful shutdown |
| Routing | `dashboard/server/routes.ts` | 164 | the 11 endpoints, auth/CSRF/rate-limit gates, action dispatch |
| Static + headers | `dashboard/server/http.ts` | 102 | SPA serving, CSP, `nosniff`, `no-referrer`, JSON helper |
| Security | `dashboard/server/security.ts` | 180 | token issuance, `timingSafeEqual`, session cookie, origin check, token bucket |
| **Read-only DB** | `dashboard/server/db.ts` | 130 | opens `state.db` **read-only**, never `createDatabase()`, never a migration |
| Source adapters | `dashboard/server/sources.ts` | 421 | the verified Conway module surface the panels read, imported from `src/**` via `tsx` |
| Queries | `dashboard/server/queries.ts` | 122 | row counts and bounded SELECTs against the live tables |
| Snapshot | `dashboard/server/state.ts` | 123 | one consistent snapshot per request; panels never touch disk themselves |
| Panels | `dashboard/server/panels/{core,safety,finance,ops}.ts` | 288 + 303 + 146 + 223 | the 12 panels and every cell's value + verdict |
| Values / verdicts | `dashboard/server/values.ts`, `panels/types.ts` | 72 + 42 | the five-value verdict vocabulary and its invariants |
| Redaction | `dashboard/server/redact.ts` | 45 | drops key material, passphrases, API keys and token values from every response |
| Commands | `dashboard/server/commands.ts` | 230 | the only three actions; two-stage restore with a held, re-verified plan |
| Verification | `dashboard/server/verify.ts` | 151 | recomputes backup manifests and compares `integrity_check` + rows, not live-vs-archive hashes |
| Processes | `dashboard/server/processes.ts` | 71 | PID/liveness reads by command-line identity; never kills |
| Stream | `dashboard/server/stream.ts` | 69 | SSE: authenticated clients only, bounded tick, no data the REST API does not already expose |
| HOME guard | `dashboard/server/home.ts` | 45 | refuses to start unless `HOME` resolves to the canonical runtime home |
| Audit | `dashboard/server/audit.ts` | 42 | append-only JSONL, one event per security-relevant decision |
| Tests | `dashboard/tests/*.test.ts` (10 files) | 97 tests | see `DASHBOARD_TEST_RESULTS.md` |
| Launchers | `dashboard/scripts/{start,stop,status}.mjs` | 99 + 133 + 179 | behind the four `.bat` files |
| Docs | `docs/DASHBOARD_{USER_GUIDE,SECURITY,API,OPERATIONS}.md` | — | §28 |

Source under `dashboard/src`, `dashboard/server`, `dashboard/scripts`: **4 613 lines** (measured with
`wc -l` over the `.ts`/`.tsx`/`.mjs`/`.css` set).

## 2. The twelve areas

`PANEL_ORDER` (`dashboard/server/panels/index.ts:8`) is the single source of the navigation order, and
`isPanelId()` rejects anything else — an unknown panel id is a 404, not a blank page.

| # | id | Nav label | Primary verified sources |
|---|---|---|---|
| 1 | `overview` | Overview | config file, DB row counts, OS metrics, process identity |
| 2 | `agent` | AI Agent | `security.*` gates, `agent_state` (`kv`), activation env |
| 3 | `models` | AI Models | `model_registry`, `inference_costs`, declared `inferenceModel` |
| 4 | `wallet` | Wallet | `walletExists()` / `getWalletAddress()` — existence only, never key material |
| 5 | `treasury` | Treasury | `treasuryPolicy` in config; `treasury_authorizations` where present |
| 6 | `security` | Security Center | gates, emergency-stop marker scan, `security_events`/`_incidents`/`_seals` |
| 7 | `health` | Health Monitor | last persisted health report + OS metrics (CPU sampled from `os.cpus()` deltas) |
| 8 | `self-healing` | Self-Healing | `selfHealingEnabled` with its provenance label; guardian/mechanic availability |
| 9 | `logs` | Activity Logs | `logs/` directory listing, dashboard audit tail |
| 10 | `backup` | Backup & Recovery | `runtime/home/.automaton/backups` + `backups/` manifests, restore planner |
| 11 | `controls` | System Controls | the three actions and their gate state — **no start/stop the agent control exists** |
| 12 | `settings` | Settings | ports, HOME path, token location, invariant list |

## 3. Runtime and dependencies

- **Pinned runtime only:** `runtime/node-v22.23.4-win-x64/node.exe` (v22.23.4, ABI 127). No global
  Node is used for any dashboard operation.
- **No new native dependency.** `better-sqlite3@11.10.0` resolves from the existing repo store
  (`node_modules\.pnpm\better-sqlite3@11.10.0\…`), so there is exactly one ABI-matched build shared
  with Conway — the dashboard does not compile its own copy.
- **100 SPA packages** installed into `dashboard/node_modules` through the project-local npm cache
  `runtime/npm-cache` (`dashboard/.npmrc`: `cache=<repo-root>/runtime/npm-cache`,
  `save-exact=true`). Nothing was written to the user npm cache.
- Frontend stack is React 18 + TypeScript + Tailwind 4 + Recharts 2, all of which were already
  compatible with the pinned runtime. Backend is Node's own `http` module + `tsx` — no framework
  added.
- Conway's own modules are imported from **`src/**` via `tsx`**, never from `dist/`, so the console
  cannot silently run older semantics than the source it is supposed to report on. (See §5 of
  `DASHBOARD_SECURITY.md`.)

## 4. Data flow

```
browser (SPA, 127.0.0.1:8787)
  └─ fetch + CSRF header ──> routes.ts ──> security.ts (auth, origin, rate limit)
                              │
                              ├─ state.ts ── buildSnapshot() ── sources.ts ─┬─ automaton.json (read)
                              │                                             ├─ db.ts  (READ-ONLY sqlite handle)
                              │                                             ├─ queries.ts (bounded SELECT)
                              │                                             ├─ OS metrics (os.*, statfsSync)
                              │                                             └─ processes.ts (read-only identity)
                              ├─ panels/*.ts ── Cell{value, verdict, source}
                              └─ redact.ts ── response
audit.ts <── every decision above         stream.ts <── SSE tick, authenticated clients only
```

One snapshot per request: panels are pure functions of it, so two panels can never disagree about
the state of the world mid-render.

## 5. What was changed outside `dashboard/`

Deliberately minimal, and every item is reversible:

1. Four launcher batch files at the repo root — `START_CONWAY_DASHBOARD.bat`,
   `STOP_CONWAY_DASHBOARD.bat`, `RESTART_CONWAY_DASHBOARD.bat`, `HEALTH_CHECK_DASHBOARD.bat`.
2. One desktop shortcut, `Conway Automaton Control Center.lnk`. The pre-existing
   `Conway Automaton.lnk` was not touched.
3. `docs/README.md` — a Phase 17 section pointing at the four new docs.
4. `reports/PHASE_16_DATASOURCE_INVENTORY.md` — gap 19 annotated with its closure.
5. Nothing in `src/`, no config file, no database, no existing backup, and no existing report was
   modified. `automaton.json` SHA-256 before and after the full verification walk:
   `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` (1382 bytes, mtime 2026-10-31T10:56:18Z).

The console writes only into `dashboard/state`, `dashboard/logs`, `dashboard/dist`,
`dashboard/diagnostics` and — when an operator explicitly confirms a restore — a **new** directory
under `dashboard/restore-targets`.

## 6. Not implemented, and why

These are absent because the mandate forbids them or the data does not exist — not because they were
forgotten:

- **No agent start/stop/restart control.** Starting the console must never activate the agent
  (§17). There is no endpoint that can do it and no code path that could reach one.
- **No wallet creation or funding.** `walletExists()`/`getWalletAddress()` only; `getWallet()` is
  never called because it generates key material when no wallet exists.
- **No live-model credential entry, no purchases.** `conwayApiKey`/`openaiApiKey`/`anthropicApiKey`
  are never read into a response; live-model testing remains `PENDING CREDENTIAL APPROVAL`.
- **No arbitrary command execution.** The three actions are typed, named functions (`commands.ts`).
- **No LAN/public exposure.** `HOST` is `127.0.0.1`; anything else makes the process refuse to start.
- **No Windows service and no autostart.** The console runs only while a launcher is invoked.
- **No self-healing enablement.** The panel reports the current value and its provenance; it cannot
  flip it.
- **Areas blocked on data** (rendered honestly, with the reason shown in the UI): the four absent
  tables (`security_events`, `security_incidents`, `security_seals`, `treasury_authorizations` →
  migrations V12/V13 not applied to the live DB, **R-14**); `REAL_DATA_RESTORE = NOT YET PROVABLE`
  (no genuine user data exists yet, Phase 16 §7); agent runtime state (`kv` 0 rows — never displayed
  as the code default `'setup'`).

## 7. Verification performed

Re-run at 2026-11-01T10:26Z for this report; see `DASHBOARD_TEST_RESULTS.md` for the full log and
`PHASE_17_PROGRESS.md` for the timeline.

| Check | Command | Result |
|---|---|---|
| Server typecheck | `tsc --noEmit -p tsconfig.server.json` | exit 0, no output |
| Client typecheck | `tsc --noEmit -p tsconfig.json` | exit 0, no output |
| Production build | `vite build` | `dist/index.html`, `assets/index-BMdUMvJm.js` 532.87 kB, `assets/index-sBvy4k0u.css` 17.85 kB |
| Tests | `vitest run` | **10 files, 97 tests, 0 failed**, 3.41 s |
| Health check | `scripts/status.mjs` | **19 pass, 0 fail, 0 not verified, 0 warn**, exit 0 |
| Invariants | same run | all nine gate checks PASS; `CONWAY_ACTIVATION` unset |
| Config unchanged | `sha256sum automaton.json` | `1c10ecc5…4c966d`, identical to the pre-walk baseline |
| Browser walk | 12 areas, real Chrome | zero console errors; every cell carries a verdict badge |

## 8. Defects found and fixed during implementation

Twelve defects were caught by reading executed output, not by inspection — and every one of them was
in code written for this dashboard, its launch scripts or its test configuration. Each is closed with
a regression assertion; `DASHBOARD_TEST_RESULTS.md` §4 has the full cause-and-fix table:

1. `status.mjs` read the config at the wrong path and its `catch` inferred "gates open" from "could
   not read" — a guard that reports a security breach merely because a file is missing.
2. `status.mjs` used `netstat`/`Get-NetTCPConnection`, both unreliable in this environment → false
   "nothing is listening" while the server was answering 200.
3. Restore step 2 re-planned and could write a **different directory** than the one the operator
   confirmed — which made the confirmation not a confirmation.
4. The client's `RestorePlan` mirror was fabricated; the plan tile rendered an array as text.
5. `RESTORE-NOTE.txt` printed the plan's summary sentence as the "source archive".
6. `stop.mjs` treated an empty `Get-CimInstance` result as "still alive", so a successful kill
   reported survival and `RESTART` refused to start the console.
7. Security headers were set inside `sendJson` only: the SPA page, the traversal refusal and the
   not-built fallback served without `referrer-policy` (and one without CSP).
8. Archives extracted into `dashboard/restore-targets` contain `*.test.ts` files, which vitest's
   default glob executed as if they were this project's suite — pinned by `test.include`.
9. The login request omitted the CSRF opt-in header that every mutation requires.
10. A cell could render `VERIFIED` while its value was literally `UNKNOWN`.
11. The restore target used a non-exclusive `mkdir`, which would have merged over an existing
    directory.
12. While fixing #7 I introduced a temporal-dead-zone reference and a `this`-typed test stub; the
    server typecheck reported it (`TS2339`) and the boot test would have caught the throw — recorded
    here because "the fix broke the build" is part of the honest record.
