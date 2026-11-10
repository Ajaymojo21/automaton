# Complete Architecture and Integration Audit

- Date: 2026-11-10
- Project root: `<repo-root>`
- Method: whole-tree inspection, runtime probes, and a 13-area browser walk-through. Every claim
  below was checked against the code or an executed command; file paths are repository-relative.

## 1. Runtime architecture (as built)

```
src/
  index.ts                 CLI entry: --status, --migrate-schema, --run, config validation
  config.ts                automaton.json loading and defaults
  types.ts                 Config, SecurityConfig, TreasuryPolicy types
  agent/                   ReAct loop, tool registry, policy rules, spend tracker
  conway/                  Conway API client, resilient HTTP client, x402 transport
  inference/               provider registry, URL policy, failover classifier
  ollama/                  local endpoint discovery (guarded)
  heartbeat/               daemon, scheduler, tick context, task implementations
  state/                   SQLite open/create, schema V1-V14, migrations
  security/                treasury guard, URL guard, audit chain, wallet crypto
  reliability/             health guardian, mechanic, repair approval lifecycle
  registry/                 ERC-8004 agent card and discovery
  replication/             child spawning and constitution propagation
  self-mod/                code and tool modification audit
  identity/                wallet management (unused: no wallet exists)
  survival/, memory/, soul/, skills/, social/, orchestration/, git/, setup/, runtime/, observability/
dashboard/
  server/                  loopback HTTP server, auth, routes, panels, SSE, actions, audit
  server/panels/           core, finance, ops, safety, repair-approvals
  src/                     React UI (token gate, panels, actions, verdict badges)
runtime/
  home/.automaton/         automaton.json, heartbeat.yml, inference-providers.json, state.db
  node-v22.23.4-win-x64/   pinned runtime
  lib/wallet-material.mjs  shared wallet-material predicate for runtime and dashboard
  bin/backup.mjs           backup CLI
```

The production database is `runtime/home/.automaton/state.db`, schema V11. The code can create and
verify V14 (which adds security and repair-approval tables); the live file has not been migrated.

## 2. Data flow that matters for this handover

1. CLI starts -> `loadConfig()` reads `runtime/home/.automaton/automaton.json`.
2. Config validation calls `validateEndpointUrl()` on the Conway API URL (`src/index.ts:338`) and on
   the Ollama URL (`src/index.ts:386`). Failure is reported, not silently ignored.
3. `createConwayClient()` runs the same validation before building a client (`src/conway/client.ts:44`).
4. Provider registry resolves each base URL through `validateProviderBaseUrl()` and gives each OpenAI
   client a guarded `fetch` (`src/inference/provider-registry.ts:451-455`). The guard pins scheme,
   host and port, resolves DNS immediately before the request, and forces `redirect: "error"`.
5. Health checks read the database through a read-only handle and produce 16 checkpoints
   (`src/reliability/health-guardian.ts:800-816`).
6. The dashboard opens the same database read-only, builds 13 panels, and streams a digest every
   15 seconds (`dashboard/server/stream.ts:52`). The action endpoints are the only writers, and each
   one writes an audited JSONL line.
7. Repair approvals are persisted through `src/reliability/repair-approval.ts` into schema V14
   tables. The dashboard exposes propose/list/read/approve/reject (`dashboard/server/routes.ts:100-206`).

## 3. Integration audit findings and corrections

### 3.1 Dead or misleading indicators removed or corrected

| Finding | Why it was wrong | Correction |
|---|---|---|
| `ABSENT_TABLE_NOTE` in `dashboard/server/panels/types.ts` | Unused constant hardcoding "schema V11; migrations V12/V13 not applied", which would become false after any migration and was never rendered. | Deleted. Nothing imported it. |
| Health panel hardcoded V11 wording in `dashboard/server/panels/core.ts` | The panel claimed the live database was V11 regardless of the actual version, and recited migration numbers. | Replaced with a derived label: `schema <liveVersion>` or `unknown schema`, and the blocked-check ids come from the report itself. |
| Unlabelled `repair-approvals` area | The area existed in the server panel list but had no UI label, so the 13th area was invisible or mislabelled. | Added `"repair-approvals": "Repair Approvals"` to `dashboard/src/App.tsx`; dashboard rebuilt. |
| `docs/DASHBOARD_API.md` said 12 areas and "8 checks, overall critical" | Both statements were stale; the live product has 13 areas and currently reports 16 checks. | Corrected to 13 areas and the observed live result, with an explanation of the blocked headline. |
| `docs/DASHBOARD_API.md` said "All three" action endpoints | Five action endpoints now exist (health-check, verify-backups, restore, repair-propose, decisions). | Reworded; added the B-8 repair approval section. |
| Agent panel subtitle implied a general schema source | It now states the panel is sourced from the live database, which is accurate at any schema version. | Updated in `dashboard/server/panels/core.ts`. |

No panel was removed. No working indicator was deleted. No unnecessary rewrite was performed.

### 3.2 Cross-layer consistency checks

- Panel ids in `dashboard/server/panels/index.ts` (13) match the labels in `dashboard/src/App.tsx`
  (13) and the browser harness' expected list (13). The harness initially failed with "expected 12,
  rendered 13"; the harness was corrected after the 13th area was confirmed intentional.
- `GET /api/panels` returns 13 panels in the live probe (`runtime/tmp/s5-live.log`).
- Every action result shown in the UI comes from the server response, not from a client-side
  simulation. Observed live: `"16 checks, overall blocked, persisted to dashboard/state"` and
  `"9/10 archive(s) carry a manifest · 28 archived file(s) match, 6 live-file entry(ies) match, 0 problem(s)"`.
- The UI's forbidden-control text matches the route table: probes against start/activate/run/
  migrate/provision/wallet/fund/repair-execute returned 404 or 405, all nine of them.
- The restore form is disabled unless the typed confirmation equals the archive name; the browser
  harness verified empty and wrong confirmations are disabled and a matching one is enabled, without
  clicking it.
- Health Guardian status and dashboard verdict are deliberately two columns. A `blocked` guardian
  check with no source is shown as "NOT VERIFIED — the guardian had no source to assess", not as a
  pass or a failure.

### 3.3 What the dashboard can and cannot do

- It cannot start, stop, activate, fund, migrate, seal, engage emergency stop, enable financial
  tools, enable replication, enable self-healing, create a wallet, or run a repair. Those endpoints
  do not exist.
- It can persist a health report, verify backup manifests, plan and execute a copy-restore into
  `dashboard/restore-targets/`, and manage non-executing repair approvals.
- Restoring into `runtime/home/.automaton` remains a manual operator action; no dashboard code path
  writes there.

## 4. Architecture risks that remain (documented, not hidden)

1. The live database is V11, so six V14 tables are absent. The health guardian therefore reports
   three checks as `blocked` (no source). This is expected until an approved migration runs.
2. The guardian's health file in `reports/health-latest.json` was 14087 minutes old at the last
   observation. The dashboard reports the staleness and does not refresh it automatically; that file
   is written by `HEALTH_CHECK.bat`.
3. `getSolanaUsdcBalance()` has no timeout (`src/conway/x402.ts` path). It is unreachable while no
   wallet is configured, and is recorded as a known limitation rather than silently fixed.
4. Dashboard health is not agent health. The dashboard panel states this explicitly; the agent was
   never started, so its state is `UNKNOWN — never started`, not "healthy".

## 5. Evidence

- Browser walk-through: `runtime/tmp/s5-browser.log` (PASS, 13 areas, 0 console/page/network errors).
- Live API probe: `runtime/tmp/s5-live.log` (13 panels, auth wall, forbidden endpoints 404/405).
- Source inspection: files cited above.
