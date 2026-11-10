# PHASE 16 — DATA SOURCE INVENTORY for the "AI Command Center" dashboard

**Project:** Conway Automaton v0.2.1 — `<repo-root>`
**Prepared:** 2026-11-01 (local) — read-only investigation
**Purpose:** enumerate every source the dashboard can legitimately read, mapped to the 12 panels.

---

> ## ⚠ ADDENDUM — revalidated at 06:32 UTC (≈12:02 local, UTC+05:30)
>
> This inventory was first written at 11:55:34 local. A second, fully independent read-only
> pass then re-ran every load-bearing probe at **06:32:13 UTC** (`runHealthChecks`
> `generatedAt`, captured verbatim below). Findings that changed:
>
> 1. **`src/security/emergency-stop.ts` was rewritten underneath me** (11:57:14) by the
>    concurrent Phase 16A isolation work. Its read side is now a **fail-closed union scan**
>    and `readEmergencyStop()` gained `markerPath`; `getEmergencyStopPaths()` is new. §H2 is
>    rewritten to the current file.
> 2. **A real `EMERGENCY_STOP` marker existed in the live state tree during this session**,
>    leaked by a unit test, then quarantined and deleted by that other workstream. It is
>    **absent from every scanned path now** (verified). Full provenance in **§H2a** — read it;
>    it is direct evidence that the previous single-path read failed *open*, which is a
>    panel-6/7/11 design constraint, not trivia.
> 3. Two `health-guardian.ts` line refs shifted (now `runHealthChecks:335`,
>    `checkWalletStorage:283`); all other cited signatures re-verified correct.
> 4. `disk_space` moved between runs (46.3 % → 46.2 %, `freeBytes` 235998625792 →
>    235882713088) — proof these values must be read live, never cached.
> 5. **Still unchanged, re-verified:** live schema **11** (rows 2…11) vs code **13**; the four
>    tables `treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`
>    remain **ABSENT**; 38 tables; `state.db` sha256-identical and mtime-identical → **no writes
>    by me**; `logs\` still empty; no Conway process; `walletExists:false`, `getWalletAddress:null`;
>    ports 8787/8585/5173 all bind-tested FREE, `0.0.0.0:3001` still PID 12652 (FreeLLMAPI, other
>    project — untouched, never queried).
> 6. New gaps **20** and **21** added; danger row 9 renumbered and re-scoped.
>
> Net effect on the design: **nothing that was safe to read became unsafe, and no panel gained
> real data.** What changed is that two APIs are broader than first documented, and the
> emergency-stop panel now has a documented false-negative history.

---

## 0. Evidence discipline and safety attestation

Every claim below is backed by output captured during this investigation. Anything not
directly observed is marked **NOT VERIFIED** with the reason.

### Commands actually run

| # | What | How |
|---|---|---|
| 1 | Live DB inspection | `better-sqlite3` with `{ readonly: true, fileMustExist: true }`, pinned Node 22.23.4 (ABI 127), cwd = repo root, `HOME=<repo-root>\runtime\home` |
| 2 | Conway module probes | `node_modules/tsx/dist/cli.mjs` running a scratch `.ts` in the OS temp dir, importing `src/**` by `file:///` URL |
| 3 | OS metric probes | scratch `.cjs` in the OS temp dir run by the pinned node; PowerShell probes in temp |
| 4 | Process/port inventory | `Get-CimInstance Win32_Process`, `Get-NetTCPConnection`, `netstat -ano -p TCP`, `[System.Net.Sockets.TcpListener]` bind test on `127.0.0.1` |
| 5 | Filesystem/config/backup/log inventory | `ls`, `find`, `Get-ChildItem`, direct reads |

### Mutation attestation

**The live `state.db` was NOT modified.**

| File | Before (UTC) | After (UTC) | Verdict |
|---|---|---|---|
| `state.db` | 512000 B, `31-10-2026 10:25:59` | 512000 B, `31-10-2026 10:25:59` | **unchanged** |
| `state.db-wal` | 0 B, `31-10-2026 11:28:11` | 0 B, `31-10-2026 11:28:11` | **unchanged** |
| `state.db-shm` | 32768 B, `31-10-2026 17:59:03` | 32768 B, `01-11-2026 06:17:55` | **mtime refreshed by my read-only opens** |

> **Recorded side effect (expected, documented in the task brief):** opening a WAL-mode
> database read-only refreshes the `-shm` sidecar's last-write time. Size is unchanged
> (32768 B, pre-existing since 31-10 `11:28:11`); no bytes were written to `state.db` or
> `state.db-wal`. **The dashboard will reproduce this touch on every poll.** If the
> operator treats `-shm` mtime as a "database was used" signal, that signal is already
> invalid — use `state.db` mtime instead.
>
> **Stronger check added on revalidation (06:32 UTC):** I hashed the DB, not just its
> mtime. `sha256(state.db)[0:16] = 2a8aeb3494f1507a` **before and after** opening it
> read-only, running `runHealthChecks`, `isEmergencyStopActive(db)` and the `schema_version`
> / row-count probes → **IDENTICAL**, size 512000 B and mtime `2026-10-31T10:25:59.744Z`
> both unchanged. `-wal` stayed 0 B. `-shm` mtime moved again (`06:32:13Z`), as predicted
> above. This is content-level proof of read-only behaviour, not timestamp-level.

- No repository file was edited. Scratch scripts lived only in
  `<user-home>\AppData\Local\Temp\` (`conway_ro_probe.cjs`,
  `conway_ro_exports.ts`, `conway_os_probe.cjs`, `conway_procs.ps1`, `conway_ports.ps1`,
  `conway_counters.ps1`) and are deleted at the end of this task.
- `git --no-optional-locks status --porcelain` was used specifically so the git index is
  not rewritten. Baseline before this report: **63 entries** (pre-existing working-tree
  changes from earlier phases, not mine).
- `project createDatabase()` was **never** called against the live path.
- No wallet was created, no config changed, no agent started, `CONWAY_ACTIVATION` /
  `CONWAY_ALLOW_WALLET_CREATION` were never set in any probed process.
- **Concurrent-session note (expanded at revalidation):** another agent is actively editing
  this repo. Created/appeared during this session, **not by this investigation**:
  `src/runtime/home-guard.ts` (11:41→11:51), `backups/phase16-pre-20261101-113803/` (11:38),
  `backups/phase16/emergency-stop.ts.bak` (11:44), `reports/PHASE_16_ISOLATION_EVALUATION.md`
  (11:48), `reports/PHASE_16_WINDOWS_POSTURE_RAW.txt` (11:42),
  `reports/PHASE_16_TEST_ARTIFACT_EMERGENCY_STOP_2026-11-01.json` (11:55),
  `reports/PHASE_16_CHECKSUMS.txt` (11:59), `src/__tests__/security/` (new, incl.
  `phase16-emergency-stop-isolation.test.ts`).
  Sources touched after 11:40 include `config.ts` (11:42:12), `identity/wallet.ts` (11:42:41),
  `reliability/health-guardian.ts` (11:44:50), `skills/loader.ts` (11:46:14), `index.ts`
  (11:47:59), `runtime/home-guard.ts` (11:51:18), `security/emergency-stop.ts` (11:57:14).
  `git --no-optional-locks status --porcelain` moved 63 → 65 → **66** across the session
  (the 63 baseline was pre-existing; my report is one of the added entries).
  **I re-verified every signature this report cites against the current files, after those
  edits:** `config.ts` 26/34/118/180/206/216 ✓, `identity/wallet.ts` 73/77/163/235/255/270/282 ✓,
  `skills/loader.ts` 42 + `db.upsertSkill` at 78 ✓, `state/database.ts` (unchanged, 31-10) ✓,
  `state/schema.ts` (unchanged) ✓, `incidents.ts`/`treasury-guard.ts`/`tool-authorizer.ts`
  (unchanged, 31-10) ✓. Only the two `health-guardian.ts` line refs and the whole
  `emergency-stop.ts` surface needed correcting — done in §H1/§H2.
  **Design consequence:** `src/security/**` is still untracked in git (`?? src/security/`,
  `?? src/runtime/`) and `dist/` still contains **none** of it, so the dashboard has no
  versioned, compiled contract to bind to. Pin the files you import by sha256
  (`reports/PHASE_16_CHECKSUMS.txt` already does this for 5 files) and re-verify at startup.

---

## A. Live SQLite database

**Path:** `<repo-root>\runtime\home\.automaton\state.db`
(config `dbPath` is `~/.automaton/state.db`; `~` resolves against `process.env.HOME`,
which the `.bat` wrappers set to `runtime\home`.)

**Safe read API:**

```ts
import Database from "better-sqlite3";
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
```

Must be the **pinned runtime** `runtime\node-v22.23.4-win-x64\node.exe` — better-sqlite3
11.10.0 is built for Node 22 (ABI **127**, verified via `process.versions.modules`).
System Node (`C:\Program Files\nodejs\node.exe`) has not been proven ABI-compatible here —
**NOT VERIFIED**, do not use it.

**Observed pragmas:**

| Probe | Result |
|---|---|
| `PRAGMA journal_mode` | `wal` |
| `PRAGMA user_version` | `0` — **the app does not use `user_version` at all.** Do not read it for the schema version. |
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA quick_check` (via health module) | `ok` |

**Schema version — authoritative source is the `schema_version` table:**

Rows present: `2, 3, 4, 5, 6, 7, 8, 9, 10, 11` (10 rows, all `applied_at = 2026-10-31 10:25:59`).
No row for `1` (the base `CREATE_TABLES` is not version-stamped) and **no row for 12 or 13.**

> **LIVE SCHEMA VERSION = 11. CODE `SCHEMA_VERSION` = 13** (`src/state/schema.ts:8`).
> The belief "10 or 11" is resolved: it is **11**.
> `runHealthChecks()` confirms this in its own words:
> `"schema 11 is older than 13; migrations run on next open"`.

**Tables: 38 total (37 app tables + SQLite's `sqlite_sequence`).**

Every table except `schema_version` has **exactly 0 rows.** Observed counts:

| Rows | Tables |
|---|---|
| **10** | `schema_version` |
| **0** | `child_lifecycle_events`, `children`, `discovered_agents_cache`, `episodic_memory`, `event_stream`, `goals`, `heartbeat_dedup`, `heartbeat_entries`, `heartbeat_history`, `heartbeat_schedule`, `identity`, `inbox_messages`, `inference_costs`, `installed_tools`, `knowledge_store`, `kv`, `metric_snapshots`, `model_registry`, `modifications`, `onchain_transactions`, `policy_decisions`, `procedural_memory`, `registry`, `relationship_memory`, `reputation`, `semantic_memory`, `session_summaries`, `skills`, `soul_history`, `spend_tracking`, `sqlite_sequence`, `task_graph`, `tool_calls`, `transactions`, `turns`, `wake_events`, `working_memory` |

Other `sqlite_master` objects: **91 indexes, 0 triggers, 0 views.** The absence of any
trigger is independent confirmation that V12/V13 never ran (they create
`treasury_authorizations_no_delete`, `security_events_no_update/_no_delete`,
`security_incidents_no_delete`, `security_seals_no_update/_no_delete`).

### The single most important constraint

**`treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`
DO NOT EXIST in the live database.** Migrations V12 and V13 have never been applied
against it. Consequences measured live (see §H):

- `getTreasuryGuard(...)` **throws** `treasury_authorizations table missing; schema migration 12 not applied`
- `verifySecurityChain(db)` **throws** `SqliteError: no such table: security_events`
- `verifySeals(db)` returns `{ valid: false, checked: 0, reason: "security_seals table is unavailable" }`
- `listIncidents(db)` / `incidentSummary(db)` **throw** `SqliteError: no such table: security_incidents`
- `runHealthChecks(...)` reports `overall: "critical"` with `audit_chain → fail → "no such table: security_events"`

**The dashboard must not be the thing that migrates the live database.** The only code
path that applies migrations is `createDatabase()` (`src/state/database.ts:80`), which:
`new Database(dbPath)` read-write (line 87) → `PRAGMA journal_mode = WAL` (90) →
`integrity_check` (95) → `db.exec(CREATE_TABLES)` (101-104) → `applyMigrations(db)` (107)
→ `INSERT ... schema_version` (114-118). It is an unconditional writer. Its migration loop
(`applyMigrations`, lines 571-649) runs every migration with `currentVersion < m.version`
inside a transaction and inserts a `schema_version` row per migration.

## B. Migrations in code, and which tables each creates

`src/state/schema.ts` + `applyMigrations` in `src/state/database.ts:577-638`.

| Ver | Constant | Creates / alters | In live DB? |
|---|---|---|---|
| base | `CREATE_TABLES` | `schema_version`, `identity`, `turns`, `tool_calls`, `heartbeat_entries`, `transactions`, `installed_tools`, `modifications`, `kv`, `skills`, `children`, `registry`, `reputation`, `inbox_messages` | ✅ applied, 0 rows each |
| 2 | `MIGRATION_V2` | `skills`, `children`, `registry`, `reputation` (+idx) | ✅ row exists |
| 3 | `MIGRATION_V3` | `inbox_messages` (+idx) | ✅ row exists |
| 4 | `MIGRATION_V4` + 5 `_ALTER*` | `policy_decisions`, `spend_tracking`, `heartbeat_schedule`, `heartbeat_history`, `wake_events`, `heartbeat_dedup`; ALTER `inbox_messages` (+`to_address`,`raw_content`,`status`,`retry_count`,`max_retries`); data-migrates `heartbeat_entries`→`heartbeat_schedule` | ✅ row exists |
| 5 | `MIGRATION_V5` | `soul_history`, `working_memory`, `episodic_memory`, `session_summaries`, `semantic_memory`, `procedural_memory`, `relationship_memory` | ✅ row exists |
| 6 | `MIGRATION_V6` | `inference_costs`, `model_registry` | ✅ row exists |
| 7 | `MIGRATION_V7` | `child_lifecycle_events`, `discovered_agents_cache`, `onchain_transactions` | ✅ row exists |
| 8 | `MIGRATION_V8` | `metric_snapshots` | ✅ row exists |
| 9 | `MIGRATION_V9` + `_ALTER_CHILDREN_ROLE` | `goals`, `task_graph`, `event_stream`; `children.role` | ✅ row exists |
| 10 | `MIGRATION_V10` | `knowledge_store` | ✅ row exists |
| 11 | `MIGRATION_V11` | `ALTER children ADD chain_type` | ✅ row exists — **highest applied** |
| **12** | `MIGRATION_V12` | **`treasury_authorizations`** (+4 idx +append-only trigger), **`security_events`** (+3 idx +2 triggers) | ❌ **ABSENT — no row, no table, no trigger** |
| **13** | `MIGRATION_V13` | **`security_incidents`** (+3 idx +1 partial unique idx +trigger), **`security_seals`** (+1 idx +2 triggers) | ❌ **ABSENT — no row, no table, no trigger** |

**Backend design rule that follows:** any panel sourced from V12/V13 must render
UNKNOWN with the reason "migration not applied", and must never fall back to
`createDatabase()` to make the data appear. Panels sourced from V1-V11 tables can render a
verified **empty** state (table exists, 0 rows) — which is a *different* and honest claim
from UNKNOWN.

## C. Configuration file

**Path:** `<repo-root>\runtime\home\.automaton\automaton.json`
(1382 B, mtime `31-10-2026 10:56:18 UTC`). Template: `config\automaton.template.json`.
Safe read: plain `fs.readFileSync` + `JSON.parse`, or `loadConfig()` from `src/config.ts`
(**read-only; verified — it only reads**).

Observed, exactly as on disk:

| Field | Value | Dashboard note |
|---|---|---|
| `name` | `automaton-local` | |
| `genesisPrompt` | `"You are a supervised local test instance. Do not perform financial, replication, self-modification, or external exposure actions."` | |
| `creatorAddress` | `0x0000000000000000000000000000000000000000` | zero address — placeholder, **not** a real creator |
| `registeredWithConway` | `false` | |
| `sandboxId` | `""` | empty → UNKNOWN |
| `conwayApiUrl` | `https://api.conway.tech` | |
| `conwayApiKey` | `""` | **length 0 → NOT CONFIGURED. Show only a boolean, never the value.** |
| `openaiApiKey` | `""` | length 0 → NOT CONFIGURED |
| `anthropicApiKey` | `""` | length 0 → NOT CONFIGURED |
| `ollamaBaseUrl` | **key ABSENT from file** | `loadConfig()` → `undefined`. (docs/AI_CONFIGURATION.md claims `""` — the doc is out of sync with the live file.) |
| `inferenceModel` | `gpt-5.2` | declaration only |
| `maxTokensPerTurn` | `4096` | |
| `heartbeatConfigPath` | `~/.automaton/heartbeat.yml` | |
| `dbPath` | `~/.automaton/state.db` | |
| `logLevel` | `info` | |
| `walletAddress` | `""` | empty; consistent with no wallet |
| `version` | `0.2.1` | matches `package.json` |
| `skillsDir` | `~/.automaton/skills` | |
| `maxChildren` | `0` | **file says 0; `DEFAULT_CONFIG.maxChildren` is 3** (`src/types.ts`) — show the file value, note the default differs |
| `maxTurnsPerCycle` | `25` | |
| `childSandboxMemoryMb` | `1024` | |
| `chainType` | `evm` | |
| `treasuryPolicy` | 10 keys, all `0` / `[]` | see below |
| `security` | 8 keys, see below | see below |
| `modelStrategy`, `soulConfig`, `socialRelayUrl`, `ollamaBaseUrl` | **ABSENT from file** | `loadConfig()` backfills some from `DEFAULT_CONFIG` / `DEFAULT_*` constants |
| `selfHealingEnabled` | **ABSENT from file's `security` block** | `normalizeSecurityConfig` fills `false`. Observed via `loadConfig()`: `security.selfHealingEnabled = false` — **a code default, not an operator declaration.** |

`security` (as persisted): `lockdown: true`, `activationApproved: false`,
`allowedTools: []`, `allowFinancialTools: false`, `allowHostShell: false`,
`allowSelfModification: false`, `allowReplication: false`, `allowExternalExposure: false`.
After `normalizeSecurityConfig`, `loadConfig()` additionally reports
`allowedCapabilities: []`, `revokedTools: []`, `maxToolDurationMs: 60000`,
`maxToolOutputBytes: 65536`, `sandboxEnabled: true`, `selfHealingEnabled: false`.

`treasuryPolicy` (as persisted): `maxSingleTransferCents: 0`, `maxHourlyTransferCents: 0`,
`maxDailyTransferCents: 0`, `minimumReserveCents: 0`, `maxX402PaymentCents: 0`,
`x402AllowedDomains: []`, `transferCooldownMs: 0`, `maxTransfersPerTurn: 0`,
`maxInferenceDailyCents: 0`, `requireConfirmationAboveCents: 0`.

> **⚠ Non-obvious finding for the Treasury panel.** `loadConfig()` deep-merges
> `DEFAULT_TREASURY_POLICY` (src/types.ts:593-607) under the file's block, so the
> *effective* policy returned by `resolveTreasuryPolicy(config)` is **not all zeros.**
> Observed live: the 10 persisted keys are `0`/`[]`, but
> **`maxMonthlyTransferCents: 100000`, `agentBudgetCents: 200000`, `childBudgetCents: 50000`
> come from code defaults because the file omits them.** The dashboard must label those
> three as "defaulted from code, not declared on disk", and must not render the treasury as
> "all limits zero ⇒ cannot spend". Spending is actually blocked by
> `security.lockdown=true` + `allowFinancialTools=false` + an empty allowlist, not by
> treasury numbers.

**Interpretation rule for the whole panel:** config values are **declarations at rest, not
proof of runtime behaviour.** Nothing in `automaton.json` proves any process read it.
Pair every config assertion with a process/liveness assertion, and render
"declared, not observed" where no live process exists.

## D. Heartbeat config and skills directory

| Item | Path | State |
|---|---|---|
| Heartbeat YAML | `runtime\home\.automaton\heartbeat.yml` | **EXISTS**, 860 B, mtime `31-10-2026 10:21:46 UTC` |
| Skills dir | `runtime\home\.automaton\skills\` | **EXISTS but EMPTY** (0 entries) — verified by recursive listing |
| `skills` table | live DB | **EXISTS, 0 rows** |
| `heartbeat_schedule` table | live DB | **EXISTS, 0 rows** |
| `heartbeat_entries` table | live DB | **EXISTS, 0 rows** |
| `heartbeat_history` table | live DB | **EXISTS, 0 rows** |
| `heartbeat_dedup` table | live DB | **EXISTS, 0 rows** |
| `wake_events` table | live DB | **EXISTS, 0 rows** |

`heartbeat.yml` declares 6 entries (`entries:` list) plus `defaultIntervalMs: 60000`,
`lowComputeMultiplier: 4`:

| name | schedule | task | enabled |
|---|---|---|---|
| heartbeat_ping | `*/15 * * * *` | heartbeat_ping | **true** |
| check_credits | `0 */6 * * *` | check_credits | **true** |
| health_check | `*/30 * * * *` | health_check | **true** |
| check_usdc_balance | `*/5 * * * *` | check_usdc_balance | false |
| check_for_updates | `0 */4 * * *` | check_for_updates | false |
| check_social_inbox | `*/2 * * * *` | check_social_inbox | false |

> **Critical distinction:** 3 entries are *enabled in YAML*, but the scheduler table
> `heartbeat_schedule` has **0 rows**, i.e. `syncHeartbeatToDb()`
> (`src/heartbeat/config.ts:130`) has never run against this database. The heartbeat has
> never executed. Panel 8 must show "declared 6 / enabled 3" next to "runs recorded: 0" —
> and the honest read of 0 rows in `heartbeat_history` is **never run**, not **healthy**.

Safe read: `loadHeartbeatConfig(path)` from `src/heartbeat/config.ts:66` — takes an
optional explicit path, returns `DEFAULT_HEARTBEAT_CONFIG` when the file is missing and on
YAML parse failure (so a parse error silently looks like defaults). For the dashboard,
prefer reading + parsing the YAML directly so you can distinguish *file absent* /
*parse failed* / *parsed N entries*. **Never** call `saveHeartbeatConfig` /
`writeDefaultHeartbeatConfig` / `syncHeartbeatToDb` (all writers).

## E. Logs

| Item | Finding |
|---|---|
| Logger implementation | `src/observability/logger.ts` — `StructuredLogger` writes JSON lines to **`process.stdout.write`** (file header comment: *"Uses process.stdout.write to avoid console.log recursion"*). **It has no file sink.** `setGlobalLogLevel`, `getGlobalLogLevel`, `createLogger(module)`, `StructuredLogger.setSink/resetSink`. |
| Pretty sink | `src/observability/pretty-sink.ts` — used only by `--run` (`src/index.ts:179`) |
| **Log directory** | `<repo-root>\logs\` — **EXISTS and IS EMPTY (0 files)**. Verified twice, before and after all probes. |
| `logs\automaton.pid` | **ABSENT** — the runtime has never been started via `START_CONWAY.bat` |
| Active log pattern | `logs\automaton-YYYYMMDD-HHMMSS.log` (stdout redirect) — **none exist** |
| Error log pattern | `logs\automaton-YYYYMMDD-HHMMSS.err.log` — **none exist** |
| Log naming source | `START_CONWAY.bat` uses `Start-Process -RedirectStandardOutput/-RedirectStandardError` — the files are created by the *launcher*, not the app |
| `OPEN_CONWAY_LOGS.bat` | opens `logs\` in Explorer; **`mkdir`s it if missing** |
| Rotation | `runtime\bin\rotate-logs.mjs` — renames `*.log` >10 MB, keeps 5; a **writer**, not a read path |

**Only `.log` files present anywhere in the repo** (all are *test* output, NOT runtime logs;
do not surface them as agent activity):

| Size (B) | mtime | Path |
|---|---|---|
| 84719 | 2026-10-31 16:03 | `runtime\vitest.log` |
| 24137 | 2026-10-31 16:05 | `runtime\test-batch1.log` |
| 47102 | 2026-10-31 16:09 | `runtime\test-batch2.log` |
| 1230 | 2026-10-31 16:23 | `runtime\test-context.log` |
| 4511 | 2026-10-31 16:23 | `runtime\test-localworker.log` |

**Sample lines available:** none from the runtime — **there are zero application log lines to
sample.** NOT VERIFIED as to log content because no log has ever been written. The
secret-leakage scanner (`runtime\bin\security-audit.mjs`, §G) reported *"no credential
patterns found in logs"*, consistent with an empty `logs\`.

`runtime\audit.json` (233885 B) is **a pnpm/npm dependency-audit artifact** — first keys are
`{"actions":[{"action":"update","resolves":[{"id":1113515,"path":".>vitest>vite>rollup",...`
It is **not** a Conway security audit and must NOT be wired to the Security Center panel.

**Dashboard consequence:** Activity/Logs (panel 9) renders **UNKNOWN / no data** for all
runtime activity. It may legitimately show *file inventory* (paths, sizes, mtimes) with an
explicit "0 application log files exist; the runtime has never been launched."

## F. Backups

**Root:** `<repo-root>\backups\` — 8 directories.

| Directory | Contents | Manifest | Kind |
|---|---|---|---|
| `2026-10-31_10-27-31` | `state.db` 512000 B (`15:57:31`), `state.db-wal` 0 B, `state.db-shm` 32768 B (`23:37:40`), `automaton.redacted.json` 1382 B, `heartbeat.yml` 860 B, `manifest.json` 731 B | ✅ **`manifest.json`** — JSON with SHA-256 per file + `bytes` + `integrity` | **REAL DB BACKUP** |
| `phase15-pre-20261031-175152` | 9 `.ts`/`.md` source files (`types.ts` 42560, `config.ts` 7138, `wallet.ts` 6217, `schema.ts` 24371, `database.ts` 92891, `agent/tools.ts` 121207, `logger.ts` 3126, `index.ts` 19144, `docs/README.md` 4579) | ✅ `manifest.sha256` (9 lines) | source snapshot |
| `phase15-pre-20261031-202919` | `src/security/audit-chain.ts` 9666, `phase15-self-healing.test.ts` 15144, `reliability/health-guardian.ts` 9798, `reliability/mechanic.ts` 8258, `heartbeat/daemon.ts` 5258, `security/emergency-stop.ts` 4923 | ✅ `manifest.sha256` (2 lines — **incomplete vs 6 files**) | source snapshot |
| `phase15-pre-20261031-211345` | `treasury-guard.ts` 18652, `phase15-treasury.test.ts` 20101, `phase15-penetration.test.ts` 20673 | ✅ `MANIFEST.sha256` (3 lines) | source snapshot |
| `phase15-pre-20261031-215500` | `spend-tracker.ts` 4663, `general-harness.ts` 15165, `loop.ts` 41503, `tools.ts` 131066, `soak-test.sh` 4682 | ✅ `MANIFEST.sha256` (5 lines) | source snapshot |
| `phase15L-pre-20261031-224048` | 5 test files under `src\__tests__\` | ✅ `MANIFEST.sha256` (5 lines, repo-root-relative paths) | source snapshot |
| `phase15M-pre-20261031-233344` | `phase15-backup-validate.ts.edited` 12118, `ORIGINAL_CONTENT.txt` 723 | ✅ `MANIFEST.sha256` (1 line) | edit scratch |
| `phase16-pre-20261101-113803` | `config.ts` 8972, `tools.ts` 131066, `index.ts` 20492 | ✅ `MANIFEST.sha256` (3 lines) | source snapshot — **created by the concurrent session, not by me** |

`manifest.json` for the real DB backup, verbatim (SHA-256 values are real):

```json
{ "createdAt": "2026-10-31T10:27:31.875Z", "root": "<repo-root>",
  "files": {
    "state.db":                  { "sha256": "2cc9d26ce4a20b3bd9a04d92c8c3a7940380ecd81665eacf9c215cd2faf765ff", "bytes": 512000, "integrity": "ok" },
    "automaton.redacted.json":   { "sha256": "1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d", "bytes": 1382, "redacted": true },
    "heartbeat.yml":             { "sha256": "1360e959c250844aedf7d9657ffb07df3b31c198e41a297d55007ec83aa7ace8", "bytes": 860 } },
  "excluded": [ "wallet.json (holds private key; back up manually with encryption)",
                "credential values inside automaton.json (re-enter after restore)" ] }
```

> **NOT VERIFIED:** I did **not** recompute the SHA-256 digests, so I cannot claim the
> backup still matches its manifest. The dashboard may legitimately do so — hashing backup
> files is read-only. Panel 10 should show "manifest present, last backup 2026-10-31,
> 1 database backup / 7 source snapshots" and a **Verify** action that only *reads* and
> hashes (never `restore.mjs`).
>
> `automaton.redacted.json` in the backup is byte-identical in content to the live config
> because every credential field was already `""`; nothing needed redacting.
>
> **Only ONE directory is a state.db backup.** Every other `phase15*`/`phase16*` directory is
> a *source-code pre-edit snapshot*. Panel 10 must not present "8 backups" as "8 restorable
> database backups."

## G. Existing wrappers and scripts — dashboard-button safety matrix

### `.bat` wrappers at repo root (all set `HOME=%ROOT%runtime\home` and use the pinned node)

| Wrapper | Target | What it does | What it writes | Wallet creation? | Activates agent? | Modifies config? | **Safe as a dashboard button?** |
|---|---|---|---|---|---|---|---|
| `HEALTH_CHECK.bat` | `runtime\bin\health-check.mjs` | 8 checks: pid liveness, config, lockdown, activation flag, allowlist size, wallet **existence only**, `PRAGMA quick_check` on a `{readonly:true}` handle, `fs.statfsSync` disk, logs dir, activation env presence | **`reports\health-latest.json`** (only) | No | No | No | ✅ **YES** — DB read-only (mjs lines 95-96), no migration. Writes one report file. |
| `SECURITY_AUDIT.bat` | `runtime\bin\security-audit.mjs` | config posture, `icacls` ACL breadth, wallet presence, `quick_check`, `policy_decisions` deny count (try/catch on missing table), **regex scan of `logs\*.log` for secret shapes (counts only, never values)**, `netstat -ano -p TCP` filtered to the agent PID, activation env presence | **`reports\security-audit-latest.json`** (only) | No | No | No | ✅ **YES** — DB opened `{readonly:true}` (line 120). No activation, no wallet, no config write. Subprocesses are `icacls`/`netstat` (read-only). |
| `BACKUP_CONWAY.bat` | `runtime\bin\backup.mjs` | online `db.backup(dest)` snapshot, verify with `integrity_check` on the copy, redact credential-shaped keys, copy `heartbeat.yml`/`constitution.md`/`SOUL.md`/`skills/`, write `manifest.json` with SHA-256, `rm`s the copy's `-shm`/`-wal` | **new `backups\<ISOstamp>\` dir + files**; opens `state.db` **NOT readonly** (line 70, `new Database(dbPath,{fileMustExist:true})`) | No | No | No | ⚠ **MUTATING (filesystem growth), read-only w.r.t. DB content.** Never runs migrations. Acceptable as an explicit, user-initiated button; never on a poll. |
| `OPEN_CONWAY_LOGS.bat` | Explorer | `mkdir`s `logs\` if missing, then `start` | may create `logs\` | No | No | No | ✅ harmless but pointless (dir exists, empty) |
| `STOP_CONWAY.bat` | `runtime\bin\stop.mjs` | reads pid file, **verifies the PID's command line matches `/Conway-Automaton/i` and refuses to kill otherwise**, SIGTERM then SIGKILL, `rm`s pid file | deletes `logs\automaton.pid` | No | No | No | ❌ **NO** — kills a process. Currently no-op (`no pid file`). Good *design model* for parentage verification, though. |
| `START_CONWAY.bat` | `preflight.mjs` → `rotate-logs.mjs` → `node dist\index.js --run` | **prompts `Type APPROVED`**, then **sets `CONWAY_ACTIVATION=APPROVED`**; if no `wallet.json`, prompts `Type CREATE-WALLET` and **sets `CONWAY_ALLOW_WALLET_CREATION=APPROVED`**; spawns a hidden background node with stdout/stderr redirected into `logs\` and writes `logs\automaton.pid` | config-independent, but **triggers wallet creation and full activation** | **YES (conditional)** | **YES** | No | ⛔ **ABSOLUTELY NOT.** Highest-risk item in the repo. |
| `RESTART_CONWAY.bat` | STOP + START | inherits START's risks | — | YES | YES | No | ⛔ **NO** |

`preflight.mjs` fails closed on: Node major ≠ 22, missing/invalid `automaton.json`,
`security.activationApproved !== true`, `CONWAY_ACTIVATION !== "APPROVED"` →
exit 2; missing wallet without `CONWAY_ALLOW_WALLET_CREATION=APPROVED` → exit 2;
**it also `fs.mkdirSync`s `logs`, `reports`, `backups`, `runtime\tmp`** on every run.
Currently it would exit 2 at the `activationApproved` gate — *provided it is reached*,
but it never writes config.

### `scripts/`

| Script | Verdict |
|---|---|
| `phase15-backup-validate.ts` (12118 B) | Read-only *against live paths* by construction, but it **imports `createDatabase`** and calls it, plus `appendSecurityEvent` + `verifySecurityChain` — on a **restored temp copy**. Long-running. ❌ not a dashboard read path |
| `phase15-soak.ts` (18450 B) | Isolated temp HOME + temp DB; imports `createDatabase`, `executeTool`, `PolicyEngine`, `SpendTracker`, **`checkTamper` and `scanSecurityEvents`** (both writers). ❌ never invoke from the dashboard |
| `phase15l-snapshot.sh`, `soak-test.sh`, `automaton.sh`, `backup-restore.sh` | shell helpers; `soak-test.sh` starts the real automaton (its own header says Phase 15 forbids this). ❌ |

### Reports (already-generated read-only payloads)

| File | Size | mtime | Source | Content observed |
|---|---|---|---|---|
| `reports\health-latest.json` | 1209 B | `31-10-2026 16:58` local | `runtime\bin\health-check.mjs` lines 127-134 | `timestamp "2026-10-31T11:28:11.221Z"`, `overall "PASS"`, 10 checks: process **warn** "not running (no live pid file)"; config pass; lockdown pass "enabled"; activation_flag info "not approved (expected)"; allowed_tools pass "0 tool(s) allow-listed"; wallet info "no wallet present"; database pass "quick_check ok"; **disk pass "220.0 GB free"**; logs pass; activation_env info "token absent" |
| `reports\security-audit-latest.json` | 1132 B | same | `runtime\bin\security-audit.mjs` lines 209-216 | `timestamp "2026-10-31T11:28:11.309Z"`, `overall "PASS"`, 9 info findings: lockdown enabled; `activationApproved=false (expected at rest)`; `allowlist empty (all tools denied)`; `no wallet file`; `quick_check ok`; **`0 denied tool call(s) recorded`**; `no credential patterns found in logs`; `automaton not running`; `CONWAY_ACTIVATION token absent` |

> Both reports are **~19 h stale** relative to this investigation. They are genuine,
> safe-to-read payloads; the dashboard **must render their embedded `timestamp` and a
> staleness badge**, and should treat "not running" as an accurate observation rather than a
> failure. Re-generating them is safe (buttons) but they are the *only* two files either
> script writes.

### `src/state/database.ts` — reusable raw-handle readers (no wrapper needed)

These take a **raw `better-sqlite3` `Database`**, not the `AutomatonDatabase` wrapper, so
they work with a `{readonly:true}` handle. Verified signatures (line numbers):

| Export | Signature | Writes? | Table in live DB? |
|---|---|---|---|
| `getPolicyDecisions` | `(db, filters: {turnId?, toolName?, decision?: PolicyAction}) → PolicyDecisionRow[]` | read | ✅ present, 0 rows |
| `getSpendByWindow` | `(db, category: string, windowType: "hour"\|"day", window: string) → number` | read | ✅ present, 0 rows |
| `getHeartbeatSchedule` | `(db) → HeartbeatScheduleRow[]` | read | ✅ 0 rows |
| `getHeartbeatTask` | `(db, taskName) → HeartbeatScheduleRow \| undefined` | read | ✅ 0 rows |
| `getHeartbeatHistory` | `(db, taskName, limit=50) → HeartbeatHistoryRow[]` | read | ✅ 0 rows |
| `getUnconsumedWakeEvents` | `(db) → WakeEventRow[]` | read | ✅ 0 rows |
| `getActiveGoals` / `getGoalById` | `(db)` / `(db, id) → GoalRow[] \| undefined` | read | ✅ 0 rows |
| `getTasksByGoal` / `getReadyTasks` / `getTaskById` | `(db, goalId)` / `(db)` / `(db,id)` | read | ✅ 0 rows |
| `getRecentEvents` / `getEventsByGoal` / `getEventsByType` | `(db, agentAddress, limit=50)` … | read | ✅ 0 rows |
| `getKnowledgeByCategory` / `searchKnowledge` | `(db, category)` / `(db, query, …)` | read | ✅ 0 rows |
| `getUnprocessedInboxCount` | `(db) → number` | read | ✅ 0 rows |
| `getSoulHistory` / `getCurrentSoulVersion` / `getLatestSoulHistory` | `(db, limit=50)` / `(db) → number` / `(db)` | read | ✅ 0 rows |
| `getChildrenByStatus` | `(db, status) → any[]` | read | ✅ 0 rows |
| `withTransaction` | `(db, fn) → T` | **depends on fn** | — |
| `checkpointWAL` | `(db) → void` — `wal_checkpoint(TRUNCATE)` | ⛔ **WRITER** | — |
| **all `insert*` / `update*` / `delete*` / `upsert*` / `prune*` / `acquire*` / `release*` / `claim*` / `mark*` / `reset*` / `consumeNextWakeEvent` / `isDeduplicated`** | | ⛔ writers or side-effecting | — |

**There is no exported factory that returns the `AutomatonDatabase` wrapper without
migrating.** `createDatabase()` is the only one. Consequence: **the dashboard must query
raw SQL over a readonly handle (or the raw-handle helpers above), and must never use
`db.getAgentState()` / `db.getTurnCount()` / `db.getSkills()` etc.**

## H. Conway's own read-only status exports (verified against the LIVE DB)

I imported `src/**` under `tsx` and called only the read-only functions against a
`{readonly:true}` handle. **All results below are observed output, not code reading.**
`src/security/**` and `src/reliability/**` Phase-15 modules are **source-only — `dist/`
does not contain them** (see §H6), so import from `src` via `tsx`.

### H1 `src/reliability/health-guardian.ts`

```ts
export function runHealthChecks(options: {
  db: DatabaseType;                    // raw better-sqlite3 handle — readonly works
  config: AutomatonConfig;             // from loadConfig()
  automatonDir?: string;               // defaults to path.join(process.env.HOME||os.homedir(), ".automaton")
  now?: Date;
}): HealthReport                       // { generatedAt, overall: "ok"|"degraded"|"critical", emergencyStop: boolean, checks: HealthCheck[] }
// HealthCheck = { id, title, status: "pass"|"warn"|"fail", message, evidence? }
```

**Verified read-only — no writes occurred** (`state.db` mtime unchanged after the call).
Observed output against the live DB:

```
overall: "critical"     emergencyStop: false
  emergency_stop        pass  "Not engaged"
  database_integrity    pass  "quick_check ok"
  schema_version        warn  "schema 11 is older than 13; migrations run on next open"   {version:11, expected:13}
  audit_chain           FAIL  "no such table: security_events"          ← NOT tampering
  treasury_reservations warn  "treasury table unavailable"
  scheduler_leases      pass  "no expired leases"
  disk_space            pass  "46.3% free (219.8 GiB)"  {freeBytes:235998625792, totalBytes:510146899968, ratio:0.4626}
  wallet_storage        pass  "no wallet on disk"
```

> **Design trap — the dashboard must translate this.** `overall:"critical"` and
> `audit_chain:"fail"` are triggered purely by the **absent V12/V13 tables**, not by any
> integrity problem (`quick_check`/`integrity_check` are both `ok`). Rendering
> `runHealthChecks()` verbatim would show a false red "audit trail tampered" alarm on a
> clean install. Map `audit_chain → "no such table"` to
> **NOT VERIFIED — migration 12/13 not applied**, never to FAIL.
>
> **These values are live, not constants.** A second run 40 minutes later (06:32 UTC)
> returned the identical report **except** `disk_space`: `46.2% free (219.7 GiB)`,
> `freeBytes: 235882713088` (was `235998625792`). Same `totalBytes`. So: never hard-code
> the first draft's numbers, and note that `emergencyStop:false` in the report is
> independent of the `emergency_stop` check — both were `false`/`pass` in both runs.

Caveat on `checkWalletStorage` (now line 283; `runHealthChecks` is now line 335 — both
shifted by 2 when this file was edited at 11:44:50): if `wallet.json` ever appears, this function
**parses its content** and returns `evidence.fields = Object.keys(raw)` (field *names* only,
never values). Acceptable, but do not let the dashboard render `evidence.fields` for a
wallet file without review.

### H2 `src/security/emergency-stop.ts`

> ⚠ **REVALIDATED at 06:32 UTC — this module was REWRITTEN by the
> concurrent Phase 16A workstream at 11:57:14 local, i.e. *after* the first draft of this
> inventory. The signatures below are the **current** file (7 261 B,
> sha256 `49c80b36d8953f83…` — independently recomputed with `sha256sum` and matching
> `reports/PHASE_16_CHECKSUMS.txt`); the pre-rewrite version is preserved at
> `backups/phase16/emergency-stop.ts.bak` (6 753 B) and the true pre-16A original
> (4 923 B) at `backups/phase15-pre-20261031-202919/src/security/emergency-stop.ts`.
> Re-read this module before binding to it — see §H2a for the live-fire incident that caused
> the rewrite.

| Export | Signature | Read/Write | Verified (observed this run) |
|---|---|---|---|
| `EMERGENCY_STOP_FILENAME` | `"EMERGENCY_STOP"` | const | |
| `getEmergencyStopPaths(dir?)` | `→ string[]` — **the whole union the read side scans** | read | `["<repo-root>\runtime\home\.automaton\EMERGENCY_STOP", "<user-home>\.automaton\EMERGENCY_STOP"]` — **both absent** |
| `getEmergencyStopPath(dir?)` | `→ string` = `getEmergencyStopPaths()[0]` = `stateDir()`-first | read | `…\runtime\home\.automaton\EMERGENCY_STOP` (this is the **write target**) |
| `readEmergencyStop(dir?)` | `→ {engaged, reason?, engagedAt?, engagedBy?, markerPath?}` | **read** | `{ engaged: false }`. Scans **every** candidate dir; fail-closed: an *unreadable* marker → `engaged:true, reason:"marker unreadable"`. **`markerPath` is new** — surface it |
| `isEmergencyStopEngaged(dir?)` | `→ boolean` | read | `false` |
| `isEmergencyStopEngagedInDb(db)` | `→ boolean` | **read** — guards on `sqlite_master` first | `false` (returns false while `security_events` is absent; `catch` → `true`) |
| `isEmergencyStopActive(db?)` | `→ boolean` | read | `false` (marker ∨ audit trail) |
| `engageEmergencyStop({reason, requestedBy?, dir?, db?, now?, onStop?})` | `src/security/emergency-stop.ts:123` | ⛔ **WRITER** — `mkdirSync` + atomic tmp/`rename` of the marker **in the state dir** + `tryAppendSecurityEvent` | not called |
| `clearEmergencyStop({confirmedBy, reason, dir?, db?, now?})` | `:183` | ⛔ **WRITER** — `unlinkSync` on **all** found markers + audit event; returns `{cleared,error}` instead of throwing | not called |

Path derivation is now delegated to `src/runtime/home-guard.ts`: `stateDir()` →
`resolveHome(env)/.automaton`, `canonicalHome()` → `<repo-root>\runtime\home`,
and `candidateStateDirs()` = `{canonicalHome, env.HOME, os.homedir()}` each + `\.automaton`.
**Consequence for the dashboard:** the read side also scans
`<user-home>\.automaton\EMERGENCY_STOP` — the **real Windows user profile**,
outside this project. Verified content of that dir today: `workspace\` only (no marker, no
`state.db`, no config). A marker left there by *any other* process would make the Security
panel report `engaged:true`, so **always render `markerPath`** — "not engaged" must say where
it looked.

**H2a — LIVE-FIRE EVIDENCE that the old single-path read failed open (do not skip).**
At 11:55:11 local a real marker appeared at `runtime\home\.automaton\EMERGENCY_STOP`
(100 B, `{"reason":"security drill","engagedAt":"2026-01-05T12:00:00.000Z","engagedBy":"tester"}`).
**This investigation did not create it.** Attribution (captured, not inferred):
`grep -rn "security drill" src/` → exactly one hit,
`src/__tests__/phase15-incident-response.test.ts:308`
`engageEmergencyStop({ reason: "security drill", requestedBy: "tester", now: NOW })` — a unit
test that omitted `dir`, so the then-single-path writer resolved against the ambient `HOME`
and **dropped a real emergency stop into the live state tree**. The `engagedAt` of
2026-01-05 is the test's frozen `NOW`, 10 months in the past — a fixture, not an operator.
It was subsequently quarantined to `reports/PHASE_16_TEST_ARTIFACT_EMERGENCY_STOP_2026-11-01.json`
(11:55:11, 100 B — byte-identical to the marker) and removed (`.automaton` dir mtime 11:57:19).
Re-verified **absent from both candidate paths** at 06:32 UTC:

```
--- getEmergencyStopPaths() union scan ---
   absent <repo-root>\runtime\home\.automaton\EMERGENCY_STOP
   absent <user-home>\.automaton\EMERGENCY_STOP
readEmergencyStop()          = {"engaged":false}
isEmergencyStopEngaged()     = false
isEmergencyStopActive(db)    = false
```

`src/__tests__/security/phase16-emergency-stop-isolation.test.ts`
now pins the defect, and its own header states the fix intent ("a unit test put a real stop
marker in the live state tree").

**Why this matters to your backend, concretely:** with the *old* code, `readEmergencyStop()`
would have returned `engaged:false` while the marker existed, because the reader and the
launcher disagreed about `HOME`. Panels 2/6/7/11 must therefore treat
**`engaged:false` as "no marker at the paths I scanned"**, never as "safe", and must re-read
per request rather than cache. If you bind against `dist/` you get the stale single-path
version (see §H6) — bind against `src/`.

> **Honesty rule for panel 6/11:** `engaged: false` means *"no marker file exists"*, which
> is **not** evidence the agent is safe — it is evidence nothing has pressed the button.
> The DB half is non-informative while `security_events` is absent. Show **"NOT ENGAGED
> (no marker file at either scanned path; audit trail not verifiable — V12 not applied)"**.

### H3 `src/security/incidents.ts`

| Export | Signature | Read/Write | Verified |
|---|---|---|---|
| `listIncidents(db, {status?, severity?, limit?})` | `→ SecurityIncident[]` | read | ⛔ **THROWS** `SqliteError: no such table: security_incidents` |
| `incidentSummary(db)` | `→ {open, acknowledged, resolved, bySeverity{INFO,LOW,MEDIUM,HIGH,CRITICAL}}` | read | ⛔ **THROWS** same |
| `raiseIncident(db, input)` | | ⛔ WRITER | not called |
| `acknowledgeIncident(db,id,actor,now?)` / `resolveIncident(db,id,actor,resolution,now?)` | `→ boolean` | ⛔ WRITERS (UPDATE) | not called |
| `scanSecurityEvents(db, {windowMs?, now?})` | `→ SecurityIncident[]` | ⛔ **WRITER** — reads `security_events` then calls `raiseIncident` (INSERT) repeatedly. "Scan" in the name is misleading | not called |
| `checkTamper(db, now?)` | `→ {chainValid, sealsValid, reason?, recommendEmergencyStop, incident}` | ⛔ **WRITER on failure** — calls `raiseIncident` when the chain is invalid | not called |

**Panel 8 (Self-Healing) / Security Center incident feed ⇒ UNKNOWN**, with reason
"`security_incidents` table absent (V13 never applied)". `scanSecurityEvents` and
`checkTamper` must **never** be wired to a dashboard button.

### H4 `src/security/audit-chain.ts`

| Export | Verified against live DB |
|---|---|
| `verifySecurityChain(db) → {valid, checked, reason?, brokenAtSequence?}` | ⛔ **THROWS** `SqliteError: no such table: security_events` (no internal try/catch — line 194) |
| `verifySeals(db) → {valid, checked, reason?}` | `{ valid: false, checked: 0, reason: "security_seals table is unavailable" }` (has try/catch — line 332) |
| `appendSecurityEvent` / `tryAppendSecurityEvent` / `appendSecuritySeal` / `tryAppendSecuritySeal` | ⛔ WRITERS (the `try*` variants swallow errors, so they silently no-op against the absent tables — which is why `authorizeToolCall({db})` is not obviously mutating) |
| `canonicalJson(value)`, `GENESIS_HASH` | pure |

### H5 `src/security/treasury-guard.ts`, `src/security/tool-authorizer.ts`, `src/config.ts`, `src/identity/wallet.ts`

**`resolveTreasuryPolicy` lives in `src/security/treasury-guard.ts:79`, NOT `src/config.ts`**
(as the task brief assumed). `src/config.ts` has no `resolveTreasuryPolicy` export.

```ts
export function resolveTreasuryPolicy(config: AutomatonConfig): TreasuryPolicy  // treasury-guard.ts:79
// returns config.treasuryPolicy verbatim if present, else LOCKDOWN/DEFAULT by config.security.lockdown
```
Observed: returns the 10 zeroed file keys **+ `maxMonthlyTransferCents:100000`,
`agentBudgetCents:200000`, `childBudgetCents:50000` from the `loadConfig()` default merge.

```ts
export function resolveTreasuryIntent(toolName, args, policy):
  {kind:"none"} | {kind:"invalid",reasonCode,message} | {kind:"financial",intent}   // treasury-guard.ts:102
```
**Pure — no db, no writes.** Verified: `resolveTreasuryIntent("transfer_credits",
{amount_cents:500,to_address:"0xabc"}, policy)` → `{kind:"financial",intent:{operation:
"transfer_out",amountCents:500,recipient:"0xabc"}}`. Safe for a "what *would* this tool
resolve to" explainer.

```ts
export class TreasuryGuard { constructor(db, policy, now=Date.now); authorize(req); commit(id, cents?); release(id, reason?); getAuthorization(id); getRecent(limit=50) }
export function getTreasuryGuard(context: { db: {raw: DatabaseType}, config }): TreasuryGuard
```
> **The constructor calls a private `assertSchema()` and THROWS.** Verified live:
> `Error: treasury_authorizations table missing; schema migration 12 not applied`.
> Panel 5 (Treasury) therefore has **no runtime source at all** — `getRecent()` /
> `getAuthorization()` are the only read methods but they are unreachable because
> construction fails. Render the *policy* (from `resolveTreasuryPolicy`, marked
> "declaration") and UNKNOWN for *authorizations* ("table absent — V12 not applied").
> Note the class also caches per-db in a `WeakMap` (`getTreasuryGuard`).

```ts
export function authorizeToolCall(
  tool: Pick<AutomatonTool,"name"|"category">,
  config: AutomatonConfig,
  options?: { actor?: string; args?: Record<string,unknown>; db?: DatabaseType; now?: Date }
): { allowed, reasonCode, message, capabilities, timeoutMs, maxOutputBytes }        // tool-authorizer.ts:175
```
> **⚠ Read-only ONLY IF `options.db` IS OMITTED.** With a `db` it calls
> `tryAppendSecurityEvent` → INSERT into `security_events`. Verified **without** `db`:
> `check_credits` → `{allowed:false, reasonCode:"NOT_ALLOWLISTED", capabilities:["read_only","external_api"], timeoutMs:60000, maxOutputBytes:65536}`;
> `transfer_credits` → `{allowed:false, reasonCode:"NOT_ALLOWLISTED", capabilities:["financial","wallet_signing","network_access"]}`.
> **This is genuine verified evidence for the Security Center**: every tool, including
> read-only ones, is currently denied because `allowedCapabilities` is empty.
> Also exported and pure: `capabilitiesForTool`, `describeToolClassification`,
> `isExplicitlyClassified`.

```ts
export function getConfigPath(): string       // → <repo-root>\runtime\home\.automaton\automaton.json  ✅ verified
export function loadConfig(): AutomatonConfig | null   // READ-ONLY ✅ verified; null iff file missing/invalid JSON
export function normalizeSecurityConfig(raw): SecurityConfig   // pure
export function resolvePath(p: string): string
export function saveConfig(config) / createConfig(params)      // ⛔ WRITERS — never call
```

`src/identity/wallet.ts` — **the wallet question, proven:**

| Export | Behaviour when no wallet exists | Verified live | Safe? |
|---|---|---|---|
| `getAutomatonDir()` | pure path via `resolveHome()` | `C:\...\runtime\home\.automaton` | ✅ |
| `getWalletPath()` | pure path | `C:\...\runtime\home\.automaton\wallet.json` | ✅ |
| `walletExists()` | **`fs.existsSync(walletFile())` — nothing else** | `false` | ✅ **USE THIS** |
| `getWalletAddress()` | `if (!fs.existsSync(walletFile())) return null` **before any other work** | `null` | ✅ |
| `loadWalletAccount()` | `if (!exists) return null` | not called; code-verified | ✅ (but returns a signing-capable account — do not surface) |
| `getWalletChainType()` | returns `"evm"` when the file is absent | not called | ✅ but **misleading** — a *default*, not an observation. Do not show as the chain |
| **`getWallet(chainType?)`** | ⛔ **CREATES ONE.** Line 169 `mkdirSync(automatonDir())`; when the file is absent it falls to line 189 `getWalletPassphrase()` then generates a key and `writeEncryptedWalletFile(...)` (lines 202 / 222) | **not called** | ⛔ **NEVER from the dashboard** |
| `readWalletDataFromFile(p?, env?)` | decrypts; throws `WalletCryptoError` | not called | ⚠ reads key material into memory |
| `generateSolanaKeypair()`, `writeEncryptedWalletFile()`, `migratePlaintextWallet()` | create / rewrite key material | not called | ⛔ |

> **Why `getWallet()` is currently survivable but still forbidden as a call:** with no
> `wallet.json`, `getWallet()` reaches `getWalletPassphrase()`
> (`src/security/wallet-crypto.ts:318`) which throws `WalletLockedError` when neither
> `CONWAY_WALLET_PASSPHRASE` nor `CONWAY_WALLET_PASSPHRASE_FILE` is set — so nothing is
> written *today*. But that is an accident of the environment: **if the dashboard process
> ever inherits a passphrase env var, a single `getWallet()` call silently generates and
> persists a new private key.** The only real gate against wallet creation in library code
> is the passphrase requirement; `CONWAY_ALLOW_WALLET_CREATION` is enforced **only** in
> `runtime\bin\preflight.mjs:84` (grep across `src/` found it **only in tests**), so nothing
> in importable code checks it. **Use `walletExists()` + `getWalletAddress()`; put
> `getWallet()` on the danger list.**

`src/security/activation.ts`:
```ts
export const ACTIVATION_ENV_VAR = "CONWAY_ACTIVATION"; export const ACTIVATION_ENV_VALUE = "APPROVED";
export function checkActivation(config: Pick<AutomatonConfig,"security">, env = process.env):
  { approved: boolean; reason: string }
```
**Pure, no I/O** — ideal for the Agent panel. With the live config it short-circuits at the
first gate → `{approved:false, reason:"security.activationApproved is not true in automaton.json"}`.
(Note: the *reason* is the function's own string; the value `approved:false` is verified.)

`src/agent/policy-engine.ts` exposes only `class PolicyEngine` — constructed from rules +
context; its evaluation path is coupled to a live turn. For a read-only Security panel use
**`authorizeToolCall`** instead; use `getPolicyDecisions(db, {})` for the historical feed
(0 rows today).

`src/security/sandbox.ts` (pure, useful for the Security panel):
`resolveSandboxRoot`, `sandboxContext`, `isProtectedPath(target)`, `confineToRoot(input,root)`,
`validateShellCommand(command)`, `scrubEnvironment(env=process.env) → ScrubReport` — all
pure functions over strings/objects, no I/O. `src/reliability/mechanic.ts`:
`classifyRepair(repairId, description)` is pure; `runMechanic(report, options)` **performs
repairs — never call it** (it is gated by `security.selfHealingEnabled`).

### H6 CRITICAL BUILD-GAP: `dist/` is stale and cannot serve the dashboard

`dist/` has **no `reliability/` and no `runtime/` directory**, and `dist/security/` contains
only `activation.js`, `audit-chain.js`, `treasury-guard.js`, `wallet-crypto.js`. **Missing
from `dist`:** `health-guardian`, `mechanic`, `emergency-stop`, `incidents`, `sandbox`,
`tool-authorizer`, `home-guard`. `dist/config.js` has **0 references to `home-guard`** and is
dated `31 Oct 18:39`, while **20+ `src/**` files are newer** (including `config.ts`,
`identity/wallet.ts`, `agent/tools.ts`).

**Consequence:** the dashboard must import **`src/**` via `tsx`** (verified working —
`node_modules/tsx` is present; `node_modules/tsx/dist/cli.mjs` ran my probe successfully),
or the project must be rebuilt (`pnpm build` = `tsc`, **writes `dist/`** — a mutation, so
not a dashboard action). Importing `dist` would silently give you *older semantics* and
would throw `ERR_MODULE_NOT_FOUND` for the Phase-15 modules.

Also: `"type": "module"`, so all imports are ESM; `package.json` `exports` only maps
`.`, `./config.js`, `./state/database.js` — reach the rest by relative path under `src`.

## I. OS metrics on Windows with no native dependencies — measured

Probe run with the pinned Node 22.23.4 (ABI 127), cwd = repo root.

| API | Measured result | Usable? |
|---|---|---|
| `os.cpus()` | **20 logical CPUs**, all `"13th Gen Intel(R) Core(TM) i7-13650HX"`, `speed 2803`; per-core cumulative `times {user, nice, sys, idle, irq}` (e.g. core 0 `user 164625, sys 277296, idle 2941937, irq 39203`) | ✅ **CPU model, core count, and — by differencing `times` across two samples ≥1 s apart — real per-core utilisation %** |
| **`os.loadavg()`** | **`[0, 0, 0]`** | ❌ **VERIFIED USELESS ON WINDOWS — always zero. Must never be rendered as "0% load".** |
| `os.totalmem()` | `34053414912` B = **31.72 GiB** | ✅ |
| `os.freemem()` | `17773322240` B = **16.55 GiB** | ✅ |
| derived RAM used | `47.81 %` | ✅ honest arithmetic |
| `os.uptime()` | `3384.468` s | ✅ machine uptime |
| `os.networkInterfaces()` | `["Wi-Fi", "Loopback Pseudo-Interface 1"]` | ✅ |
| **`fs.statfsSync` present?** | **`typeof fs.statfsSync === "function"` → `true`; `fs.statfs` → `true`** | ✅ **AVAILABLE IN NODE 22 ON WINDOWS** |
| `fs.statfsSync("C:\\")` | `{ type:0, bsize:4096, blocks:124547583, bfree:57618397, bavail:57618397, files:0, ffree:0 }` → **total 475.1 GiB, free 220.0 GiB** | ✅ total/free/used. **`type`, `files`, `ffree` are 0/absent on Windows ⇒ NO inode metrics** |
| `process.memoryUsage()` | `{ rss: 26910720, heapTotal: 5611520, heapUsed: 3964696, external: 1300644, arrayBuffers: 10535 }` | ✅ but this is **the dashboard process's own RSS** — label it as such; it is *not* Conway's |
| `os.concurrency` | **absent** (`typeof os.concurrency === "number"` → `false` in 22.23.4) | ❌ |
| PowerShell `Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1` | **`0`** | ❌ single-sample returns 0 here |
| PowerShell `Get-Counter '\Memory\Available MBytes'` | `16912` MiB | ✅ agrees with `os.freemem()` |
| PowerShell `Get-CimInstance Win32_Processor.LoadPercentage` | **`27`** (1 socket object; `Count=1`) | ✅ **the only ready-made OS-computed CPU %** |
| `Win32_OperatingSystem` | `TotalVisibleMemorySize_KB=33255288`, `FreePhysicalMemory_KB=17310780` | ✅ matches `os.totalmem/freemem` |
| `Win32_LogicalDisk DriveType=3` | `C: Size=510146899968 Free=235993088000` | ✅ **byte-exact match** to `statfsSync` (`blocks*bsize`) |

### Recommended least-fake approach (Health Monitor / System Controls)

1. **CPU %** — two `os.cpus()` samples ≥1 s apart, per core:
   `busy = Δuser+Δsys+Δnice+Δirq`, `total = busy + Δidle`, `pct = 100*busy/total`; average
   across cores. Self-contained, no PowerShell process spawn per poll, and gives a
   *real* per-core sparkline. Optionally cross-check against
   `Win32_Processor.LoadPercentage` and show both if they disagree.
   **Never** label `os.loadavg()`'s zeros as load. If only one sample is available,
   render **"CPU — NOT VERIFIED (requires two samples)"**, not `0 %`.
2. **RAM** — `os.totalmem()`/`os.freemem()` and `used = total - free`. Caveat to state in
   the UI: Windows `GlobalMemoryStatusEx` free memory is *not* "memory available to start a
   large allocation" (it excludes reclaimable standby/modified pages), so treat `used %` as
   approximate. Cross-check with `Memory\Available MBytes` if a strict number is needed.
3. **Disk** — `fs.statfsSync(path)` for the volume holding `state.db`:
   `total = blocks*bsize`, `free = bavail*bsize`, `used = total-free`. Verified to agree with
   WMI to the byte. **Omit inode/"files" metrics entirely and mark them
   `NOT AVAILABLE ON WINDOWS (statfsSync returns files=0, ffree=0)`** rather than showing 0.
4. **Process-level metrics for Conway** — **NOT AVAILABLE: no Conway process exists**
   (§J). Any per-process CPU/RAM for the agent must be UNKNOWN, and must not be substituted
   with the dashboard's own `process.memoryUsage()`.
5. Prefer reading metrics **in-process** (`os`/`fs`) over spawning `powershell.exe` per
   poll: process spawn is 100s of ms, and `security-audit.mjs` shows a spawn is easy to get
   wrong. Use PowerShell/WMI only for a manually-triggered "deep check".

## J. Process and port inventory — is Conway running? **No.**

**Parentage/command-line verification (not port-based), via `Get-CimInstance Win32_Process`:**

- Processes whose `CommandLine` matched `Conway|conway|automaton`: **only my own probe
  plumbing** — `bash.exe` (PIDs 16616 → 3676 → 14628) and `powershell.exe` 13684 executing
  the temp `.ps1` whose *text* contains the word "conway". No Conway runtime process.
- Processes whose `ExecutablePath` is under `<repo-root>\`: **NONE.**
- Every `node.exe` running (7) is the **system** `C:\Program Files\nodejs\node.exe`, never
  the pinned `runtime\node-v22.23.4-win-x64\node.exe`. None has `--run` or `dist\index.js`
  under the Conway root.
- `logs\automaton.pid` **absent**; `logs\` empty.
- `Get-NetTCPConnection`/`netstat` show **no listener attributable to any Conway process.**

> **CONWAY IS NOT RUNNING.** Its activation gates are closed, its pid file does not exist,
> its log directory is empty, and its pinned runtime binary is not among the running
> processes. Panels 2, 5, 7, 8, 9, 11 must therefore present *declared state + absence of
> evidence*, not health.

### The 3001 listener — NOT Conway. Do not touch.

`netstat -ano -p TCP` shows `TCP 0.0.0.0:3001 … LISTENING 12652`.
**The PID has changed from the previously reported 15168 to 12652** (service restart).
PID 15168 no longer exists (`Get-CimInstance Win32_Process -Filter "ProcessId=15168"` → empty).

Verified parentage and identity of **12652**:

| Property | Value |
|---|---|
| Name / Exe | `node.exe` @ `C:\Program Files\nodejs\node.exe` (**not** the Conway pinned runtime) |
| CommandLine | `"C:\Program Files\nodejs\node.exe" dist/index.js` — **no `--run` flag** |
| Parent chain | 12652 ← `powershell.exe` 9144 ← `svchost.exe` 2484 ← `services.exe` 1768 ← `wininit.exe` |
| Scheduled task | **`FreeLLMAPI Backend` — State: Running** (`Get-ScheduledTask`) |
| Launcher evidence | `Desktop\Start_FreeLLMAPI.bat`: *"Production backend: scheduled task 'FreeLLMAPI Backend' -> scripts\freellmapi-service.ps1 -> node dist\index.js in server\ (port 3001)"*, project root `<freellmapi-root>` |

**Conclusion: PID 12652 is the FreeLLMAPI backend of a DIFFERENT project, running as a
Windows scheduled task.** It is not Conway (different node binary, no `--run`, no Conway
path, service-parented while Conway is only ever launched interactively through
`START_CONWAY.bat`). **It must not be killed, restarted, probed, or bound over, and port
3001 must not be used by the dashboard.** I did not issue any request to it — identity was
established from command line, parentage, the scheduled task and its launcher file.

Other listeners observed (all foreign, do not bind over): `0.0.0.0:20128` +
`127.0.0.1:20131` (`omniroute`/`server-ws.mjs`), `<host-lan-ip>:49523` (Qoder.exe),
`:::445` (System). Note `Get-NetTCPConnection -State Listen` **omitted 3001/20128/445**
in this environment; **`netstat -ano -p TCP` is the authoritative tool here.**

### Recommended dashboard port: **`127.0.0.1:8787`**

Verified free by *actually binding* a `[System.Net.Sockets.TcpListener]` on the loopback
address and releasing it, at 2026-11-01 ~11:47 local:

```
127.0.0.1:3100  FREE (bind succeeded)   127.0.0.1:7788  FREE (bind succeeded)
127.0.0.1:3101  FREE                    127.0.0.1:8123  FREE
127.0.0.1:3300  FREE                    127.0.0.1:8787  FREE  ← RECOMMENDED
127.0.0.1:4173  FREE                    127.0.0.1:8788  FREE
127.0.0.1:5013  FREE                    127.0.0.1:9099  FREE
```

All ten candidates were free, so 8787 is chosen for being outside the IANA-registered
ranges in use here and outside the Windows dynamic range (≥49152).
**Bind `127.0.0.1` only — never `0.0.0.0`.** `security-audit.mjs` flags a
`0.0.0.0`/`[::]` listener owned by the agent as **severity `high`**; binding the dashboard to
all interfaces would trip its own audit and expose an unauthenticated console (note: the
audit only matches listeners to the **agent's** pid file, so a dashboard on `0.0.0.0` would
be *missed*, not caught — worse). **Re-verify 8787 with `netstat`/a bind test at startup**
and handle `EADDRINUSE` by failing loudly; a concurrent session may claim it.

---

# THE 12 PANELS — mapped data sources

Provenance legend: **DB** = readonly SQLite · **CFG** = `automaton.json` · **YML** =
`heartbeat.yml` · **FS** = filesystem stat only · **MOD** = importable `src/` function ·
**REP** = pre-generated report JSON · **OS** = `os`/`fs.statfsSync`/WMI · **ABSENT**.

### 1 — Overview

| Data | Source | Current verified content |
|---|---|---|
| Product/version | CFG `version`, `package.json` `"version"` | `0.2.1` / `0.2.1` (agree) |
| Install root | `runtime` path; `health-latest.json.root` | `<repo-root>` |
| Runtime resolved home | MOD `getAutomatonDir()` | `...\runtime\home\.automaton` |
| Activation decision | MOD `checkActivation(loadConfig(), process.env)` | **`approved:false`** — verified via `loadConfig()` |
| Process running | FS `logs\automaton.pid` + §J parentage | **NO** (pid file absent; no Conway exe in the process list) |
| DB health | DB `PRAGMA integrity_check` | `ok` |
| Schema | DB `schema_version` | **v11 / code v13 — V12+V13 NOT applied** |
| Rows of substance | DB counts | **37 tables, 36 empty; only `schema_version` has 10 rows** |
| Disk free | OS `fs.statfsSync` | **220.0 GiB free of 475.1 GiB (46.3 %)** |
| RAM | OS `os.totalmem/freemem` | 16.55 / 31.72 GiB free → **47.8 % used** |
| CPU | OS `os.cpus()` | 20 logical cores, i7-13650HX @2803 MHz; **utilisation UNKNOWN until two samples exist** |
| Last backup | FS `backups\` | 1 DB backup `2026-10-31_10-27-31` (2026-10-31T10:27:31Z) |
| Log volume | FS `logs\` | **0 files** |

**Headline the panel must carry: "Installed, configured, and never run."** Everything
runtime-shaped is UNKNOWN. Do **not** present "37 tables / 0 rows" as "healthy empty system"
without the "never launched" framing.

### 2 — AI Agent

| Data | Source | Content |
|---|---|---|
| Identity / name | CFG `name` | `automaton-local` |
| Genesis prompt | CFG `genesisPrompt` | supervised-test-instance text (quote it — it is the strongest at-rest guard) |
| Creator address | CFG | zero address → **placeholder, NOT a real creator** |
| Agent lifecycle state | DB `SELECT value FROM kv WHERE key='agent_state'` | **ABSENT — `kv` has 0 rows ⇒ UNKNOWN.** `db.getAgentState()` would return `'setup'` — **that is a code default, not evidence; do not display it as the state** |
| Turns / reasoning history | DB `turns` (0), `tool_calls` (0) | **EMPTY — never run** |
| Active skills | DB `skills` (0), FS `skills\` (empty dir) | **EMPTY** |
| Installed tools | DB `installed_tools` (0) | **EMPTY** |
| Children / replication | DB `children` (0), `child_lifecycle_events` (0), CFG `maxChildren: 0` | **EMPTY + disabled** |
| Inbox | DB `inbox_messages` (0), MOD `getUnprocessedInboxCount(db)` | **0** |
| Soul / persona | DB `soul_history` (0), FS `SOUL.md` | **ABSENT — no soul file, no history** |
| Registry / social | DB `registry` (0), `reputation` (0), `discovered_agents_cache` (0), CFG `registeredWithConway: false` | **EMPTY + unregistered** |
| Session/memory | DB `working_memory`, `episodic_memory`, `semantic_memory`, `procedural_memory`, `relationship_memory`, `session_summaries`, `event_stream` — all 0 | **EMPTY** |
| Cost consumed | DB `transactions` (0), `spend_tracking` (0), `inference_costs` (0) | **0 observed ⇒ but the true statement is "never run", not "free"** |

**Verdict: the agent has never executed a turn.** Panel 2 is almost entirely
"declared in config / empty in DB". `checkActivation` is the only *behavioural* fact here.

### 3 — AI Models & providers

| Data | Source | Content |
|---|---|---|
| Configured model | CFG `inferenceModel` | `gpt-5.2` — **a string, not a verified model** |
| `maxTokensPerTurn` | CFG | `4096` |
| Conway API | CFG `conwayApiUrl` = `https://api.conway.tech`; `conwayApiKey` length **0** | **NOT CONFIGURED** |
| OpenAI | CFG `openaiApiKey` length **0** | **NOT CONFIGURED** |
| Anthropic | CFG `anthropicApiKey` length **0** | **NOT CONFIGURED** |
| Ollama | CFG key `ollamaBaseUrl` **ABSENT** → `loadConfig()` `undefined` | **NOT CONFIGURED** |
| Supported set + routing order | `docs/AI_CONFIGURATION.md` §2; `src/conway/inference.ts` (`type InferenceBackend = "conway" \| "openai" \| "anthropic" \| "ollama"`, `resolveInferenceBackend(model, {openaiApiKey, anthropicApiKey, ollamaBaseUrl, …})`, `getModelProvider(modelId)`) | registry lookup → name heuristics (`claude*`→Anthropic, `gpt-*`/`o1..o9`→OpenAI) → **Conway fallback** |
| Model tables | DB `model_registry` (0), `inference_costs` (0) | **EMPTY — no model has ever been registered or called** |
| Env overrides | `CONWAY_API_URL`, `CONWAY_API_KEY`, `OLLAMA_BASE_URL` (documented in `--help`) | **NOT VERIFIED as unset in the dashboard's future parent process** — read `process.env` at runtime and mark each *present/absent*, never its value |

**How to detect "not configured" without touching secrets (verified approach):** read the
config object and test **presence and emptiness only** — `(cfg.openaiApiKey ?? "").length
=== 0` → NOT CONFIGURED; `cfg.ollamaBaseUrl === undefined` → ABSENT. My probe printed only
lengths and the literal `ABSENT`. **Never render a credential value, never log it, never
include it in an API response** — even though all four are currently empty strings.
Also state the honest inference: **with no key and `inferenceModel: gpt-5.2`, an activated
run falls through to the Conway backend and would fail at inference** (documented as the
intended safe state). Also note `docs/AI_CONFIGURATION.md` lists `ollamaBaseUrl: ""` while
the live file **lacks the key entirely** — flag the doc drift rather than trusting the doc.

### 4 — Wallet

| Data | Source | Content |
|---|---|---|
| Wallet exists | MOD `walletExists()` → `fs.existsSync` | **`false` — verified live** |
| Expected path | MOD `getWalletPath()` | `...\runtime\home\.automaton\wallet.json` (**file does not exist**) |
| Address | MOD `getWalletAddress()` | **`null`** — returns before any other work when the file is absent; **proven not to create** |
| CFG `walletAddress` | | `""` |
| Chain type | DB/CFG `chainType` = `evm`; **do not use `getWalletChainType()`** (returns `"evm"` as a default when no wallet exists — indistinguishable from a real EVM wallet) | declared only |
| Balance | requires Conway API + credentials | **UNKNOWN — no credentials, no wallet, no network path** |
| Encryption posture | `docs/PHASE_15_WALLET_ENCRYPTION.md`, `src/security/wallet-crypto.ts` (`getWalletPassphrase` throws `WalletLockedError` without env) | passphrase env **absent in my probe env**; must be re-checked by the dashboard at runtime |
| Backup exclusion | `manifest.json.excluded` | "wallet.json (holds private key; back up manually with encryption)" |
| Health signal | MOD `runHealthChecks` check `wallet_storage` | **`pass — "no wallet on disk"`** |

**Panel 4 = definitively empty, and that is a verified fact rather than a gap.** Render
"WALLET NOT PROVISIONED" from `walletExists() === false`, and **never** call `getWallet()`
to "check". `reports\security-audit-latest.json` corroborates: `wallet.present → "no wallet file"`.

### 5 — Treasury

| Data | Source | Content |
|---|---|---|
| Policy (declarations) | MOD `resolveTreasuryPolicy(loadConfig())` — **in `src/security/treasury-guard.ts:79`, not `config.ts`** | 10 persisted keys all `0`/`[]`; **3 keys silently defaulted to non-zero: `maxMonthlyTransferCents 100000`, `agentBudgetCents 200000`, `childBudgetCents 50000`** |
| Authorizations ledger | DB `treasury_authorizations` | ⛔ **TABLE ABSENT (V12)** |
| Guard instance | MOD `getTreasuryGuard({db, config})` | ⛔ **THROWS** `treasury_authorizations table missing; schema migration 12 not applied` — `getRecent()`/`getAuthorization()` unreachable |
| Reserved/committed totals | would be `SUM(amount_cents) WHERE decision='allow' AND status IN ('reserved','committed')` | **UNKNOWN — no table** |
| Historical spend | DB `spend_tracking` (0), `transactions` (0), MOD `getSpendByWindow(db, cat, "hour"\|"day", window)` → `number` | **0** — honest reading: *never run* |
| Tool→intent mapping | MOD `resolveTreasuryIntent(toolName,args,policy)` — **pure, verified** | works; e.g. `transfer_credits{500}` → `{kind:"financial",intent:{operation:"transfer_out",amountCents:500}}` |
| Health signal | `runHealthChecks` → `treasury_reservations` | `warn "treasury table unavailable"` (again: absence, not a problem) |

**Panel 5 must be split visibly into "policy (declared, readable)" and "authorizations
(runnable ledger does not exist yet)".** Use `resolveTreasuryIntent` for a *explain-only*
"what would this spend be classified as" widget — it needs no db and cannot write.

### 6 — Security Center

| Data | Source | Content |
|---|---|---|
| Activation | MOD `checkActivation(config, env)` — pure | **`{approved:false, reason:"security.activationApproved is not true in automaton.json"}`** |
| Activation env | `process.env.CONWAY_ACTIVATION === "APPROVED"` presence only | **absent in probe env**; must be re-read live, never value-echoed |
| Lockdown | CFG `security.lockdown` | `true` |
| Allowlist | CFG `security.allowedTools` | `[]` — `security-audit-latest.json`: *"allowlist empty (all tools denied)"* |
| Capability flags | CFG | all of `allowFinancialTools`, `allowHostShell`, `allowSelfModification`, `allowReplication`, `allowExternalExposure` = **false** |
| Normalized extras | MOD `normalizeSecurityConfig` | `allowedCapabilities: []`, `revokedTools: []`, `sandboxEnabled: true`, `maxToolDurationMs: 60000`, `maxToolOutputBytes: 65536`, **`selfHealingEnabled: false` (defaulted — absent from file)** |
| Live authorization decisions | MOD `authorizeToolCall(tool, config)` **without `db`** | **verified: `check_credits` → `NOT_ALLOWLISTED`; `transfer_credits` → `NOT_ALLOWLISTED`** — deny-by-default confirmed at runtime, not just on paper |
| Policy decision history | DB `policy_decisions` (0), MOD `getPolicyDecisions(db, {})` | **EMPTY** |
| Tamper-evident audit chain | DB `security_events` | ⛔ **ABSENT** — `verifySecurityChain` **throws**; `runHealthChecks.audit_chain` reports `fail "no such table: security_events"` → **must be shown as NOT VERIFIED, not FAIL** |
| Seals | DB `security_seals` | ⛔ **ABSENT** — `verifySeals` → `{valid:false, checked:0, reason:"security_seals table is unavailable"}` |
| Incidents | DB `security_incidents` | ⛔ **ABSENT** — `listIncidents`/`incidentSummary` throw |
| Emergency stop | MOD `readEmergencyStop()` / `isEmergencyStopEngagedInDb(db)` | `{engaged:false}` + `false` (DB half non-informative while the table is absent). **Re-verified 06:32 UTC across both scanned paths** — see §H2/§H2a and gap row 20 |
| Secret hygiene | `security-audit-latest.json` | *"no credential patterns found in logs"* (true because `logs\` is empty) |
| Network exposure | `security-audit-latest.json` | *"automaton not running"* — no agent-owned listener (§J confirms) |
| File ACLs | `icacls` (as `security-audit.mjs` does) | **NOT VERIFIED by me** — I did not run `icacls`. Reusable read-only, but note `security-audit.mjs` reports only *breadth* (`Everyone:(`, `BUILTIN\Users:([FMW]`, `S-1-1-0`), never a full ACL dump |
| Crypto module | `src/security/wallet-crypto.ts` | present; passphrase resolution **fails closed** without env |

**Strongest honest claim for panel 6:** posture is **deny-by-default and verified by
execution** (`authorizeToolCall` denies even read-only tools) — but the *tamper-evidence*
layer is **entirely unverifiable** because its tables do not exist. Do not let the absent
`security_events` table become a red "integrity failure". Also do not surface
`runtime\audit.json` (a dependency-audit artifact) as a Conway security finding.

### 7 — Health Monitor

| Data | Source | Content |
|---|---|---|
| Full report | MOD `runHealthChecks({db, config, automatonDir})` — **read-only, verified working** | **`overall:"critical"`**, 8 checks — see the §H1 transcript. **Requires translation** before display |
| Per-check reality | | `emergency_stop` pass · `database_integrity` pass (`quick_check ok`) · `schema_version` **warn** (11 < 13) · **`audit_chain` fail = missing table, NOT tampering** · **`treasury_reservations` warn = missing table** · `scheduler_leases` pass · `disk_space` pass (46.3 %, 219.8 GiB) · `wallet_storage` pass ("no wallet on disk") |
| Launcher-level health | `HEALTH_CHECK.bat` / `runtime\bin\health-check.mjs`; **REP** `reports\health-latest.json` | `overall:"PASS"`, 10 checks, **timestamp 2026-10-31T11:28:11Z ⇒ ~19 h stale**; `process` = **warn "not running (no live pid file)"** |
| DB integrity | DB `PRAGMA integrity_check` | `ok` (38 tables, 91 indexes, 0 triggers) |
| Scheduler leases | DB `heartbeat_schedule` — `lease_expires_at IS NOT NULL AND < now` | 0 rows ⇒ **no expired leases, but also no leases at all** |
| CPU/RAM/disk | OS (§I) | cores/model ✅ · **CPU % requires two samples** · RAM ✅ · disk ✅ via `statfsSync` · **`os.loadavg()` = `[0,0,0]` — DO NOT USE** |
| Metric history | DB `metric_snapshots` (0) | **EMPTY — no historical health series to chart** |
| Liveness | §J | **no Conway process running** |

**Panel 7 must show two distinct health sources** — the *file/DB* health (real and green)
and the *runtime* health (does not exist) — plus the schema-lag warning as a first-class
item, since it is the root cause of most UNKNOWNs on this dashboard.

### 8 — Self-Healing

| Data | Source | Content |
|---|---|---|
| Enabled? | CFG `security.selfHealingEnabled` | **ABSENT from the file**; `loadConfig()` yields **`false` via `normalizeSecurityConfig` default**. Correct label: **"disabled (code default; not explicitly declared by the operator)"** |
| Mechanic | MOD `classifyRepair(repairId, description?)` (pure) / `runMechanic(report, options)` (**writes / executes repairs**) | **`runMechanic` must never be called from the dashboard** |
| Repairs performed | DB `modifications` (0) | **EMPTY — none** |
| Heartbeat declared | **YML** `heartbeat.yml` | 6 entries, **3 enabled** (heartbeat_ping */15, check_credits 0 */6, health_check */30), `defaultIntervalMs 60000`, `lowComputeMultiplier 4` |
| Heartbeat scheduled | DB `heartbeat_schedule` | **0 rows ⇒ `syncHeartbeatToDb` never ran; the YAML has never reached the scheduler** |
| Heartbeat history | DB `heartbeat_history` | **0 rows ⇒ NEVER RUN, not "all green"** |
| Leases / dedup / wake events | DB `heartbeat_schedule.lease_*`, `heartbeat_dedup` (0), `wake_events` (0) | **EMPTY** |
| Incident-driven healing | DB `security_incidents` | ⛔ **ABSENT (V13)** — `listIncidents`/`incidentSummary` throw |
| Incident scan | MOD `scanSecurityEvents(db)` | ⛔ **WRITER** — must not be used |
| Daemon | `src/heartbeat/daemon.ts`, `scheduler.ts`, `tasks.ts` | source only; **never started** (§J, empty history) |

**Panel 8 verdict: there is no self-healing to report.** Every field is either a code
default, an empty table, or an absent table. The one genuinely useful display is the
**YAML-vs-DB divergence** (6 declared / 3 enabled vs 0 scheduled / 0 run) — it is a real,
verified, self-explanatory observation.

### 9 — Activity / Logs

| Data | Source | Content |
|---|---|---|
| Runtime log files | FS `logs\` | ⛔ **DIRECTORY EMPTY — 0 files. No active log, no error log, no pid file.** The app has no file sink; `logs\*.log` exist only via `START_CONWAY.bat`'s `Start-Process -RedirectStandardOutput`, which has never run |
| Sample log lines | | **NONE AVAILABLE — NOT VERIFIED (no log has ever been written)** |
| Structured log shape | `src/observability/logger.ts` (stdout JSON, `LogEntry`, levels via `LOG_LEVEL_PRIORITY`), CFG `logLevel: "info"` | declaration |
| Agent activity | DB `turns` (0), `tool_calls` (0), `event_stream` (0) | **EMPTY** |
| Financial activity | DB `transactions` (0), `spend_tracking` (0), `inference_costs` (0) | **EMPTY** |
| Policy activity | DB `policy_decisions` (0) | **EMPTY** |
| Security activity | DB `security_events` | ⛔ **ABSENT (V12)** |
| Heartbeat activity | DB `heartbeat_history` (0) | **EMPTY — never run** |
| Self-mod activity | DB `modifications` (0) | **EMPTY** |
| Inbox activity | DB `inbox_messages` (0) | **EMPTY** |
| Test-run logs | FS `runtime\test-*.log`, `runtime\vitest.log` (5 files, sizes in §E) | **exist but are NOT agent activity — label explicitly as build/test output if shown at all** |
| Reports generated | FS `reports\*.json`, `reports\PHASE_15_*.md` (21 files) | real file inventory with timestamps; `health-latest.json` / `security-audit-latest.json` are the only machine-readable feeds |

**Panel 9 renders "NO ACTIVITY DATA — the runtime has never been launched",** backed by
`logs\` empty + pid absent + every activity table 0 rows. Do **not** fill the timeline with
`vitest.log` lines.

### 10 — Backup & Recovery

| Data | Source | Content |
|---|---|---|
| Backup inventory | FS `backups\` | **8 directories (§F)** — but only **ONE** (`2026-10-31_10-27-31`) contains `state.db`; the other 7 are *source-file pre-edit snapshots* |
| DB backup | FS | `state.db` 512000 B, taken `2026-10-31T10:27:31.875Z`; `integrity: "ok"` recorded at backup time; `-shm`/`-wal` were `rm`'d by design (`backup.mjs` lines 77-79) — although `-shm` reappeared at 23:37:40 |
| Manifest | **`manifest.json`** | SHA-256 per file + bytes + integrity + `excluded[]` naming `wallet.json` and credential values |
| Redaction | `automaton.redacted.json` 1382 B, `redacted: true` | credential-shaped keys would be `<REDACTED>`; in this install all were already `""` |
| Hash verification | MOD — `crypto.createHash("sha256")` over backup files | **read-only and safe; NOT VERIFIED by me** (I did not recompute). Expose as a **Verify** button |
| Restore | `runtime\bin\restore.mjs --from --to [--allow-live]` | verifies hashes + `integrity_check` **before** copying, and **refuses to write into the live `~/.automaton` without `--allow-live`**. ⛔ **WRITER — never wire `--allow-live`; if exposed at all, only to a disposable `--to`** |
| Backup tool | `BACKUP_CONWAY.bat` / `backup.mjs` | ⛔ creates new dirs; opens `state.db` **non-readonly**; never migrates |
| Docs | `docs\BACKUP_RECOVERY.md`, `reports\PHASE_15_BACKUP_TEST.md`, `PHASE_15_BACKUP_RAW.json`, `docs\PHASE_15_BACKUP_VALIDATION.md` | prose/artifacts, safe to read and quote with timestamps |
| Freshness | | **last DB backup 2026-10-31 ⇒ >1 day old at the time of writing — show as an age, and never as "backed up"** |

**Panel 10's main job is to prevent a misreading:** say "1 database backup + 7 source
snapshots", not "8 backups".

### 11 — System Controls

**This panel must be almost entirely inert, because every control mutates live state or
activates the agent.**

| Control | Backing | Effect | Verdict |
|---|---|---|---|
| Start Conway | `START_CONWAY.bat` | sets `CONWAY_ACTIVATION=APPROVED`; **offers wallet creation** (`CONWAY_ALLOW_WALLET_CREATION=APPROVED`); runs `dist\index.js --run`; writes pid + 2 log files | ⛔ **DISABLE / OMIT. Must not be reachable from the dashboard.** |
| Stop / Restart | `STOP_CONWAY.bat` → `stop.mjs` | SIGTERM/SIGKILL + `rm` pid file (does guard the PID by command-line match) | ⛔ no-op today (not running); never auto-exposed |
| Engage emergency stop | MOD `engageEmergencyStop({reason, requestedBy?, dir?, db?, now?, onStop?})` — `src/security/emergency-stop.ts:123` | **writes the `EMERGENCY_STOP` marker into `stateDir()` (follows ambient `HOME`, so with `HOME` unset it lands in `<user-home>\.automaton`) + `tryAppendSecurityEvent`**; fail-safe | ⚠ **The only arguably-justifiable write.** Requires an explicit typed reason and a human approver. Note **nothing clears it automatically** — `clearEmergencyStop` (line 183) demands `confirmedBy` + `reason` and unlinks **every** candidate marker. Consider omitting it entirely in v1: pressing it is a real, sticky action on a machine that is not running anything — and §H2a proves a unit test already pressed it by accident |
| Health check | `HEALTH_CHECK.bat` | writes `reports\health-latest.json` only; DB readonly | ✅ **safe button** |
| Security audit | `SECURITY_AUDIT.bat` | writes `reports\security-audit-latest.json` only; DB readonly; runs `icacls` + `netstat` | ✅ **safe button** |
| Backup | `BACKUP_CONWAY.bat` | new `backups\<stamp>\` | ⚠ safe-for-DB, filesystem-mutating. Explicit user action only, never scheduled by the dashboard |
| Verify backup hashes | custom read-only code | none | ✅ safe |
| Restore | `restore.mjs` | overwrites files | ⛔ never to the live dir; omit or gate to a disposable target |
| Apply migrations / bring schema to v13 | `createDatabase()`, `automaton --status`, `--run` | **writes schema + `schema_version` rows to the live DB** | ⛔ **THE #1 thing to withhold.** See danger list |
| `--configure` / `--pick-model` | `src/index.ts:172-176` | write `automaton.json` — **and are NOT behind `requireActivation()`** (unlike `--setup`/`--init`/`--provision`) | ⛔ omit |
| Self-heal run | `runMechanic` | executes repairs | ⛔ |
| Incident scan | `scanSecurityEvents`, `checkTamper` | INSERT incidents | ⛔ |
| Skill sync | `loadSkills(dir, db)` | `db.upsertSkill` | ⛔ |
| WAL checkpoint | `checkpointWAL(db)` | `wal_checkpoint(TRUNCATE)` | ⛔ |

**What panel 11 should actually be:** a *read-only status board of gates* —
`activationApproved:false` · `lockdown:true` · `allowedTools:[]` · `maxChildren:0` ·
`CONWAY_ACTIVATION` absent · `CONWAY_ALLOW_WALLET_CREATION` absent · no wallet ·
no process · schema 11/13 — each labelled **"DECLARED AT REST, NOT ENFORCED BY THIS
DASHBOARD"**, plus two genuinely safe buttons (**Run health check**, **Run security audit**)
and an explicit **"Controls disabled: the agent is inactive by design"** notice.
Read `process.env` presence **by key name only**; if you must display env-var state, print
`present/absent` and never a value (`scrubEnvironment` in `src/security/sandbox.ts:282`
shows which keys the project itself considers sensitive).

### 12 — Settings

| Data | Source | Content |
|---|---|---|
| Live config file | FS `runtime\home\.automaton\automaton.json` | 1382 B, **mtime 2026-10-31 10:56:18 UTC** — show this as "last modified" and treat it as the authoritative *declared* state |
| Effective config | MOD `loadConfig()` | the file **merged with `DEFAULT_CONFIG` + `DEFAULT_TREASURY_POLICY` + `DEFAULT_MODEL_STRATEGY_CONFIG` + `DEFAULT_SOUL_CONFIG` + `normalizeSecurityConfig`**. **Render these as two columns: "on disk" vs "effective", because they differ** — `maxChildren` 0 vs default 3; `selfHealingEnabled` absent vs `false`; treasury `maxMonthlyTransferCents` absent vs 100000; `agentBudgetCents` absent vs 200000; `childBudgetCents` absent vs 50000; `ollamaBaseUrl` absent vs `undefined` |
| Heartbeat settings | **YML** `heartbeat.yml` + MOD `loadHeartbeatConfig(path)` | 6 entries / 3 enabled / interval 60000 / lowComputeMultiplier 4. ⚠ `loadHeartbeatConfig` **silently returns defaults on YAML parse failure** — parse it yourself so a corrupt file does not look like a valid default |
| Skills settings | FS `skills\` (empty dir) + DB `skills` (0) | **none installed** |
| Templates | `config\automaton.template.json` (1383 B), `config\heartbeat.template.yml` (860 B) | read-only reference; useful to show "what the operator did *not* set" |
| Paths | CFG `dbPath`, `heartbeatConfigPath`, `skillsDir` (all `~/…`), resolved by MOD `resolvePath` / `joinTilde` against `process.env.HOME` | **`~` resolution is a live correctness hazard:** run without `HOME=C:\…\runtime\home` and the same code reads/writes a *different* install. `src/index.ts:72 requireConwayHome()` + `src/runtime/home-guard.ts` (`assertConwayHome`, `resolveHome`, `canonicalHome`, `normalizeHome`, `candidateStateDirs`, `HomeGuardError`) exist precisely because *"Phase 15 ended up signing a database that did not exist and reporting a PASS for it."* **The dashboard MUST set `HOME` to `runtime\home` and call `assertConwayHome({mode:"runtime"})` at startup, refusing to serve if it throws** |
| Constitution | `constitution.md` (1927 B), `src/replication/constitution.ts` | read-only text |
| Writing settings | MOD `saveConfig`, `createConfig`, `saveHeartbeatConfig`, `writeDefaultHeartbeatConfig` | ⛔ **WRITERS — panel 12 must be read-only.** Any "edit" affordance should export a diff for the human to apply by hand |

---

# GAPS — what must render UNKNOWN / NOT VERIFIED

| # | Panel | Field | Why | Honest label |
|---|---|---|---|---|
| 1 | 6, 9, 2 | **`security_events` audit trail** (and everything derived from it) | table ABSENT — V12 never applied; `verifySecurityChain` throws | `NOT VERIFIED — migration 12 not applied to the live DB` |
| 2 | 5 | **Treasury authorization ledger**, reserved/committed totals, `getRecent()` | table `treasury_authorizations` ABSENT; `getTreasuryGuard()` throws | `NOT VERIFIED — table absent` |
| 3 | 6, 8 | **Security incidents** (open/acknowledged/resolved, by severity) | table `security_incidents` ABSENT — V13; `listIncidents`/`incidentSummary` throw | `NOT VERIFIED — migration 13 not applied` |
| 4 | 6 | **Audit seal verification** | table `security_seals` ABSENT; `verifySeals` → `{valid:false, reason:"security_seals table is unavailable"}` | `NOT VERIFIED — cannot verify seals (absent). ⛔ must NOT be shown as "seals failed"` |
| 5 | 2, 9, 11 | **Agent runtime state** (`agent_state`) | `kv` has 0 rows. `db.getAgentState()` would return the *code default* `'setup'` | `UNKNOWN — never started (do NOT display "setup")` |
| 6 | 9, 7, 1 | **All application logs / activity timeline** | `logs\` empty; no pid file; the logger has no file sink; redirection only happens in `START_CONWAY.bat` | `NO DATA — the runtime has never been launched` |
| 7 | 4 | **Wallet balance / USD / chain state** | no `wallet.json`, no API key, no network path | `UNKNOWN — wallet not provisioned` (existence=false *is* verified) |
| 8 | 3 | **Model actually in use / token costs / provider latency** | `model_registry`, `inference_costs` both 0 rows; `inferenceModel: gpt-5.2` is a declaration | `NOT VERIFIED — declared "gpt-5.2", never invoked` |
| 9 | 7, 1 | **CPU utilisation %** | `os.loadavg()` returns `[0,0,0]` on Windows (verified); `Get-Counter '\Processor(_Total)'` returned `0` on one sample | `NOT VERIFIED until two `os.cpus()` samples are captured` — never `0 %` |
| 10 | 8 | **Self-healing enablement** | `selfHealingEnabled` **absent from `automaton.json`**; the `false` you get from `loadConfig()` is a code default | `false (code default — operator never declared it)` |
| 11 | 8 | **Heartbeat executions / next runs** | `heartbeat_schedule` and `heartbeat_history` both 0 rows despite 3 YAML-enabled entries ⇒ `syncHeartbeatToDb` never ran | `NEVER RUN — 0 scheduled, 0 executed` (not "all green") |
| 12 | 10 | **Backup integrity today** | manifest hashes recorded at backup time were **not recomputed by me**; the live DB has changed since (config mtime 10:56 > backup 10:27) | `UNVERIFIED — click Verify to re-hash (read-only)` |
| 13 | 6 | **File ACLs** on `automaton.json` / `state.db` / `wallet.json` | I did not run `icacls`; only `security-audit.mjs` does, and only its *breadth* heuristic | `NOT VERIFIED (re-runnable via SECURITY_AUDIT.bat)` |
| 14 | 6, 11 | **Env gates in the dashboard's own process** (`CONWAY_ACTIVATION`, `CONWAY_ALLOW_WALLET_CREATION`, `CONWAY_WALLET_PASSPHRASE`) | absent in *my* probe env; the dashboard's parent env is a different process, established only when it starts | `CHECK AT STARTUP, print present/absent by key name — never a value` |
| 15 | 1, 7 | **Conway process CPU/RAM/PID/uptime** | no Conway process exists (§J) | `UNKNOWN — not running`; never substitute `process.memoryUsage()` of the dashboard |
| 16 | 12, all | **Config-as-behaviour** | nothing proves any process read `automaton.json` | `DECLARED AT REST — NOT observed in a running process` |
| 17 | 2, 9 | **Soul / persona, memory, registry, reputation, children, skills, installed tools, inbox** | tables all present but 0 rows; `SOUL.md` absent; `skills\` empty | `EMPTY — never populated (verified 0 rows)` — *empty ≠ unknown; prefer this label where the table exists* |
| 18 | 3, 4 | **`getWalletChainType()` / `chainType` for a wallet** | returns `"evm"` as a default when no wallet exists — indistinguishable from a real EVM wallet | `UNKNOWN (API returns a default, not an observation)` |
| 19 | all | **Whether `dist/` matches `src/`** | `dist` is stale: no `reliability/`, no `runtime/`, no `emergency-stop`/`incidents`/`sandbox`/`tool-authorizer`; 20+ src files newer than `dist/index.js` | `BUILD IS STALE — import `src` via tsx; do NOT trust `dist`` |
| 20 | 2, 6, 7, 11 | **Emergency stop "not engaged"** | `readEmergencyStop()` is a **union scan** of `stateDir()` + `canonicalHome()` + **the real user profile** `<user-home>\.automaton` (§H2). `engaged:false` only means nothing was found at those paths, and the set changes with ambient `HOME`. The audit-trail half (`isEmergencyStopEngagedInDb`) is **non-informative** while `security_events` is absent, so the second source of truth does not exist | `NOT ENGAGED per marker scan (N paths checked, list markerPath) — audit trail NOT VERIFIED` |
| 21 | all | **The imported API contract itself** | `src/security/**` + `src/runtime/**` are **untracked in git** and were edited under this investigation — `emergency-stop.ts` went 4 923 B (pre-16A, in `backups/phase15-pre-20261031-202919`) → 6 753 B (`backups/phase16/*.bak`) → 7 261 B, changing signatures mid-session (§0, §H2). No compiled, versioned contract exists | `CONTRACT UNPINNED — hash the files you import at build time and re-verify at startup; expect signature drift` |

## Addendum — Phase 17 closure of gap 19 (2026-11-01)

The rows above are the Phase 16 record and are left as written. One of them is now resolved, so the
resolution is appended rather than substituted:

- **Gap 19 (`dist/` vs `src/`) — CLOSED.** Two independent changes ended it. (a) The dashboard reads
  Conway through **`src/**` imported under `tsx`**, so no console value can silently carry
  pre-security semantics; `tests/danger-imports.test.ts` enforces that the import graph stays
  read-only, with a positive control. (b) The repo `dist/` was rebuilt during Phase 16E — measured
  again at 2026-11-01: `find src -name '*.ts' -newer dist/index.js` returns **0 files**, so
  `dist/index.js` (23 428 B) is no longer older than the source it is supposed to mirror.
- **H6 ("the dashboard cannot serve from `dist/`")** is superseded for this purpose: the console's
  own bundle is `dashboard/dist/` (Vite output — `index-BMdUMvJm.js` 532.87 kB,
  `index-sBvy4k0u.css` 17.85 kB), which is unrelated to Conway's `dist/`. The rule that survives is
  **R-23's**: a verified source is not a verified artifact — rebuild, then re-verify.
- Gaps **1–6** (the four absent tables, empty `kv`, empty logs) are **not** closed by Phase 17; the
  dashboard renders them as `NOT VERIFIED` / `UNKNOWN` with the reason, exactly as this inventory
  instructed it to. Gaps **12** (backup hashes un-recomputed) and **7** (no wallet) acquired
  mechanisms — `verify-backups` re-hashes read-only, and the Wallet panel asserts existence rather
  than calling `getWallet()`. Gap **13** (file ACLs) and **21** (unpinned contract) remain open
  operator items.

Evidence: `reports/DASHBOARD_SECURITY_REPORT.md` §3, `reports/DASHBOARD_TEST_RESULTS.md` §2,
`reports/PHASE_17_PROGRESS.md`.

---

# DANGER LIST — operations that would mutate live state

Severity: ⛔ = never reachable from the dashboard; ⚠ = only behind an explicit, typed human
confirmation.

| # | Operation | Where | Exact mutation it performs | Verdict |
|---|---|---|---|---|
| 1 | **`createDatabase(dbPath)`** | `src/state/database.ts:80` | Opens read-write (`new Database`, l.87) → `journal_mode=WAL` (l.90) → `db.exec(CREATE_TABLES)` (l.101-104) → **`applyMigrations`** runs V2…V13 creating 4 tables + 9 triggers + inserts `schema_version` rows 12 & 13 (l.571-648) → `INSERT OR REPLACE schema_version(13)` (l.114-118). **Also `mkdirSync(dir)` (l.84) and it hard-throws if `integrity_check` ≠ ok (l.95-98)** | ⛔ **THE central prohibition.** Calling it to *read* would permanently migrate the live DB |
| 2 | **`automaton --status`** | `src/index.ts:154 → showStatus() → createDatabase(resolvePath(config.dbPath))` (l.199) | **identical to #1** — looks like a harmless status command and is not. Also `getAgentState/getTurnCount/getInstalledTools/getHeartbeatEntries/getSkills/getChildren/getRegistryEntry` | ⛔ **Trap: `--status` is NOT read-only.** Never expose |
| 3 | `--run` (`START_CONWAY.bat`, `RESTART_CONWAY.bat`) | `src/index.ts:178 → run()` | Activates the agent (`CONWAY_ACTIVATION=APPROVED`), spawns a background process, writes `logs\automaton*.log`, `.err.log`, `logs\automaton.pid`; runs the heartbeat; executes tools; writes DB | ⛔ |
| 4 | **Wallet creation: `getWallet(chainType?)`** | `src/identity/wallet.ts:163` | `mkdirSync(automatonDir)` (l.169-171); with no `wallet.json` it generates a key (`generatePrivateKey()` / `generateSolanaKeypair()`) and **`writeEncryptedWalletFile(...)`** (l.202, l.222) | ⛔ **Silently creates a private key if a passphrase env var is present.** Use `walletExists()` / `getWalletAddress()` |
| 5 | `generateSolanaKeypair()`, `writeEncryptedWalletFile()`, `migratePlaintextWallet()` | `wallet.ts:85/147/292`, `runtime\bin\migrate-wallet.mjs --apply` | create or rewrite key material | ⛔ |
| 6 | `saveConfig(config)` / `createConfig(params)` | `src/config.ts:180 / 216` | overwrites `automaton.json` — the file that holds the activation gates | ⛔ |
| 7 | `saveHeartbeatConfig()` / `writeDefaultHeartbeatConfig()` / **`syncHeartbeatToDb()`** | `src/heartbeat/config.ts:106 / 123 / 130` | overwrites `heartbeat.yml`; **INSERTs/UPDATEs `heartbeat_schedule` in the live DB** | ⛔ |
| 8 | `loadSkills(skillsDir, db)` | `src/skills/loader.ts:42` (l.72-79 of the body) | `db.upsertSkill(skill)` per discovered skill + `db.getSkills(true)` — writes `skills` | ⛔ |
| 9 | **`engageEmergencyStop(options)`** / **`clearEmergencyStop(options)`** | `src/security/emergency-stop.ts:123 / :183` (post-16A rewrite) | **writes the `EMERGENCY_STOP` marker file** in `stateDir()` (which follows ambient `HOME`!) + `tryAppendSecurityEvent`; clear `unlink`s **every** candidate marker. Sticks: nothing clears it automatically. A unit test already fired this into the live tree once — see §H2a | ⚠ ⛔ for v1 — a real, sticky action against a machine running nothing |
| 10 | **`scanSecurityEvents(db)`** | `src/security/incidents.ts:235` | reads `security_events` then **INSERTs incidents via `raiseIncident`** repeatedly. Name implies read-only — it is not | ⛔ |
| 11 | **`checkTamper(db)`** | `src/security/incidents.ts:430` | **INSERTs a CRITICAL `audit_tamper` incident on failure** and returns `recommendEmergencyStop:true` | ⛔ |
| 12 | `raiseIncident` / `acknowledgeIncident` / `resolveIncident` | `incidents.ts:89 / 153 / 168` | INSERT / UPDATE `security_incidents` | ⛔ |
| 13 | `appendSecurityEvent` / `appendSecuritySeal` | `src/security/audit-chain.ts:88 / 253` | INSERT into the append-only tables (the `try*` variants swallow errors and are also writes) | ⛔ |
| 14 | **`authorizeToolCall(tool, config, { db })`** — *with* `options.db` | `src/security/tool-authorizer.ts:175-209` | every decision path calls `tryAppendSecurityEvent(options.db, …)` → INSERT `security_events` (currently a swallowed no-op; a real write once V12 lands) | ⛔ **pass NO `db`** to keep it read-only |
| 15 | `TreasuryGuard.authorize/commit/release` | `src/security/treasury-guard.ts:217 / 488 / 534` | transactional INSERT/UPDATE on `treasury_authorizations`; `authorize` also emits a security event | ⛔ (`getAuthorization`/`getRecent` are read methods but unreachable — the constructor throws) |
| 16 | `runMechanic(report, options)` | `src/reliability/mechanic.ts:132` | performs repairs (may restart tasks / write) | ⛔ |
| 17 | **`checkpointWAL(db)`** | `src/state/database.ts:658` | `PRAGMA wal_checkpoint(TRUNCATE)` — **truncates `state.db-wal`**. Works even against what you think is a read-only view if the handle is RW | ⛔ |
| 18 | Every other `src/state/database.ts` writer | `insert*`, `upsert*`, `update*`, `delete*`, `prune*`, `acquireTaskLease`, `releaseTaskLease`, `clearExpiredLeases`, `claimInboxMessages`, `markInboxProcessed/Failed`, `resetInboxToReceived`, `consumeNextWakeEvent`, `insertDedupKey`, `pruneExpiredDedupKeys`, `wm*`, `setKV`, `setAgentState`, `runTransaction`, `withTransaction(db, fn)` | DB writes | ⛔ |
| 19 | **`BACKUP_CONWAY.bat` / `backup.mjs`** | `runtime\bin\backup.mjs:70` | **opens `state.db` NOT readonly** (`new Database(dbPath,{fileMustExist:true})`); `db.backup(dest)`; **creates `backups\<ISOstamp>\`** and `rm`s the copy's `-shm`/`-wal`; writes `manifest.json`. **Never runs migrations** | ⚠ filesystem-mutating, DB-content-safe. Explicit user action only |
| 20 | **`restore.mjs --allow-live`** | `runtime\bin\restore.mjs` | copies over the live `~/.automaton` (it *refuses* without `--allow-live`) | ⛔ never expose `--allow-live` |
| 21 | **`STOP_CONWAY.bat` / `stop.mjs`** | `runtime\bin\stop.mjs` | SIGTERM/SIGKILL a pid + `fs.rmSync(pidPath)` (guarded by a `/Conway-Automaton/i` command-line check) | ⛔ |
| 22 | `preflight.mjs` | `runtime\bin\preflight.mjs` (l.31) | `fs.mkdirSync`s `logs`, `reports`, `backups`, `runtime\tmp` on every run; exits 2 at the activation gate | ⚠ writes dirs; harmless but not "read-only" |
| 23 | `rotate-logs.mjs` | `runtime\bin\rotate-logs.mjs` | renames + **unlinks** `logs\*.log` | ⛔ |
| 24 | `--configure` / `--pick-model` | `src/index.ts:172 / 166` | write `automaton.json` (providers, model, treasury). **Not wrapped in `requireActivation()`**, unlike `--setup`/`--init`/`--provision` | ⛔ and note the missing gate |
| 25 | `scripts\phase15-soak.ts`, `phase15-backup-validate.ts`, `soak-test.sh` | `scripts\` | both import `createDatabase`, `scanSecurityEvents`, `checkTamper`; long-running; write temp trees | ⛔ |
| 26 | `pnpm build` / `tsc` | `package.json:scripts.build` | rewrites all of `dist/` | ⛔ for the dashboard (it is the fix for #19, but must be an operator action) |
| 27 | **Binding `0.0.0.0` or `[::]`, or port 3001** | dashboard server | `0.0.0.0:3001` belongs to **another project's** FreeLLMAPI backend (PID 12652, scheduled task `FreeLLMAPI Backend`) — binding it fails and any "restart to free the port" logic would kill someone else's service; `0.0.0.0` would expose an unauthenticated console and `security-audit.mjs` would rate a `0.0.0.0` listener *owned by the agent* as severity **high** | ⛔ bind `127.0.0.1:8787` only |
| 28 | Reading secret **values** into any response | config JSON, `process.env`, `wallet.json` | all four credential fields are currently `""`, and `wallet.json` does not exist — but `checkWalletStorage` **parses** `wallet.json` if it appears, and `readWalletDataFromFile` decrypts key material into memory | ⛔ emit only `configured/not configured` booleans; never values; never `evidence.fields` from `wallet_storage` |

---

## Appendix — quick reference for the backend

```
pinned runtime : <repo-root>\runtime\node-v22.23.4-win-x64\node.exe   (v22.23.4, ABI 127)
HOME           : <repo-root>\runtime\home        ← MANDATORY; also call assertConwayHome({mode:"runtime"})
cwd            : <repo-root>
live DB        : <repo-root>\runtime\home\.automaton\state.db   [readonly, fileMustExist]
config         : <repo-root>\runtime\home\.automaton\automaton.json
heartbeat      : <repo-root>\runtime\home\.automaton\heartbeat.yml   (skills\ = empty)
emergency stop : union scan of <repo-root>\runtime\home\.automaton\EMERGENCY_STOP
                 + <user-home>\.automaton\EMERGENCY_STOP   (BOTH ABSENT → engaged:false; render markerPath)
                 one real marker DID exist here 11:55:11, leaked by a unit test — §H2a; quarantined to
                 reports\PHASE_16_TEST_ARTIFACT_EMERGENCY_STOP_2026-11-01.json and removed
wallet         : <repo-root>\runtime\home\.automaton\wallet.json     (ABSENT)
logs           : <repo-root>\logs\               (EMPTY; pid file ABSENT)
reports        : <repo-root>\reports\health-latest.json | security-audit-latest.json  (stale ~19 h)
backups        : <repo-root>\backups\            (1 DB backup + 7 source snapshots)
schema         : live 11 / code 13  ·  user_version = 0 (unused)  ·  integrity_check = ok  ·  journal_mode = wal
tables         : 38 (37 app + sqlite_sequence); 36 have 0 rows; only schema_version has 10
ABSENT tables  : treasury_authorizations, security_events, security_incidents, security_seals  (+ all V12/V13 triggers)
import path    : src/** via node_modules/tsx/dist/cli.mjs   — dist/ is STALE (no reliability/, no runtime/, no incidents/emergency-stop/tool-authorizer/sandbox)
dashboard port : 127.0.0.1:8787  (bind-verified FREE; re-verify at startup)   NEVER 3001 (FreeLLMAPI, PID 12652)
```
