# WINDOWS OPERATIONS GUIDE — Phase 13

**Shell:** `cmd.exe` via the provided `.bat` files, or Git Bash for manual commands
**Startup automation:** none
**Windows service:** none
**Firewall changes:** none

---

## 1. The seven wrappers

All scripts live in `<repo-root>\` and are ASCII/CRLF for
`cmd.exe`. Every script sets the project-local `HOME` and `PATH` itself; you do not
need to activate anything globally.

| Script | What it does | Prompts | Exit codes |
|---|---|---|---|
| `START_CONWAY.bat` | Runs preflight, rotates logs, starts `dist/index.js --run` hidden, writes PID | `APPROVED`, then `CREATE-WALLET` if no wallet | 0 started; 1 aborted/failed |
| `STOP_CONWAY.bat` | Validates PID command line, terminates, removes PID file | none (pause unless arg given) | 0 stopped; 1 failure |
| `RESTART_CONWAY.bat` | `STOP` then `START` | same as START | propagates |
| `HEALTH_CHECK.bat` | Read-only health report → `reports/health-latest.json` | none | 0 pass, 1 fail |
| `BACKUP_CONWAY.bat` | Consistent DB snapshot + redacted config → `backups/<stamp>` | none | 0 success |
| `OPEN_CONWAY_LOGS.bat` | Opens `logs\` in Explorer | none | 0 |
| `SECURITY_AUDIT.bat` | Posture/ACL/DB/log/network audit → `reports/security-audit-latest.json` | none | 0 pass |

**Current behaviour of `START_CONWAY.bat`:** it will stop at preflight because
`security.activationApproved` is `false`. This is the expected safe state, not a bug.

---

## 2. Environment the wrappers set

```bat
set "HOME=%ROOT%runtime\home"
set "COREPACK_HOME=%ROOT%runtime\corepack"
set "PATH=%ROOT%runtime\node-v22.23.4-win-x64;%ROOT%runtime\bin;%PATH%"
```

These apply only to the launched process. No `setx`, registry `Environment`, or
user/system variable is modified. The machine's default Node 24 and any existing
AI tooling remain untouched.

Activation-related variables:

| Variable | Set by | Purpose |
|---|---|---|
| `CONWAY_ACTIVATION=APPROVED` | `START_CONWAY.bat` after typing `APPROVED` | Second activation signal |
| `CONWAY_ALLOW_WALLET_CREATION=APPROVED` | `START_CONWAY.bat` after typing `CREATE-WALLET` | Wallet creation gate |

Both are process-scoped; they are not persisted.

Two further, unrelated tokens gate schema migration only
(`CONWAY_MIGRATION_APPROVAL`, `CONWAY_MIGRATION_ALLOW_CANONICAL` — see
[§3.1.1](#311-advancing-the-schema-deliberately---migrate-schema)). Neither reads nor is read
by the activation or wallet gates; setting one does not imply the other.

---

## 3. Manual operation (Git Bash / PowerShell)

From the install root:

```bash
export HOME='<repo-root>\runtime\home'
export PATH="<repo-root>/runtime/node-v22.23.4-win-x64:$PATH"

node dist/index.js --status          # read-only — see §3.1 for the one side effect
node runtime/bin/health-check.mjs    # health report
node runtime/bin/security-audit.mjs  # audit
node runtime/bin/backup.mjs          # backup
node runtime/bin/rotate-logs.mjs     # rotate logs >= 10 MB
```

Do **not** run `node dist/index.js --run` manually unless you intend activation; it
will exit 2 while the config flag is false, which is the correct refusal.

### 3.1 `--status` is a read-only snapshot

Phase 18 found that it was not (**F-18-01**): `showStatus()` called `createDatabase(dbPath)`,
which opens **read-write** and runs `applyMigrations()` on every open, so "just checking"
could permanently advance the schema and would create `state.db` plus every table when the
file was absent. Phase 19 **A3** closed that. `--status`
([src/index.ts:160](../src/index.ts)) now dispatches to `showStatus()`
([src/index.ts:226](../src/index.ts)), which calls `readStatusSnapshot(dbPath)`
([src/state/database.ts:675](../src/state/database.ts)) → `openDatabaseReadOnly()`
([src/state/database.ts:601](../src/state/database.ts)):

- `new Database(path, { readonly: true, fileMustExist: true })`
  ([src/state/database.ts:611](../src/state/database.ts)) — SQLite will not write to the file
  and will not create it;
- no `journal_mode` pragma is issued, because writing that pragma would itself be a write;
- every statistic is a `SELECT` (`COUNT(*)`, `SELECT value FROM kv WHERE key = ?`-style
  lookups) — there is no DDL and no `INSERT`/`UPDATE`/`DELETE` on this path;
- `applyMigrations()` is not reachable from `--status`, so the schema version is reported as
  found and never advanced.

Two consequences operators need to know:

- **A missing database is now a visible failure, exit 1.** Before A3 the same situation
  quietly created a fresh V13 database and printed an empty status; now
  `ReadOnlyDatabaseError` is caught in `showStatus()`
  ([src/index.ts:238](../src/index.ts)), logged as `Status unavailable: …` and the process
  exits 1 without creating anything. Any `.bat` wrapper or external health check that read
  `--status`'s exit code must treat 1 as "there is no database to read", not "the agent is
  unhealthy" — the two are different conditions and only the first is normal on a new
  install.
- **`-wal` and `-shm` sidecars can still appear.** On a WAL database, SQLite creates or
  refreshes the `-wal`/`-shm` files when the database is opened, *including* a read-only
  open. Measured on a copy of the live database: `state.db` itself is byte-for-byte
  unchanged (same size, same SHA-256, same mtime) across repeated `--status` runs; the
  sidecars are not. Do not treat a changed `-wal` mtime as evidence that `--status` wrote
  to the database, and do not treat the sidecars as part of a backup — `BACKUP_CONWAY.bat`
  takes the consistent snapshot instead.

The command still starts no agent process and cannot enable activation; `requireActivation()`
guards only `--init` ([src/index.ts:127](../src/index.ts)), `--provision` (`:149`) and
`--setup` (`:186`). What changed is that it is now also true that it does not touch the
database.

The dashboard console (`dashboard/server/db.ts`) has always opened `readonly: true,
fileMustExist: true` and never imports `src/state/database.ts`; that is unchanged and is
enforced by `dashboard/tests/danger-imports.test.ts`.

### 3.1.1 Advancing the schema deliberately: `--migrate-schema`

Because `--status` no longer migrates, migration is now an explicit operator action
(Phase 19 **A2**/**A3**, [src/state/schema-migration.ts:193](../src/state/schema-migration.ts)):

```bash
CONWAY_MIGRATION_APPROVAL=APPROVED node dist/index.js --migrate-schema
```

| Token | Value | Effect |
|---|---|---|
| `CONWAY_MIGRATION_APPROVAL` | must be exactly `APPROVED` | the only gate for schema migration. It grants nothing else: not agent activation, not wallet creation, not tool or shell access. |
| `CONWAY_MIGRATION_ALLOW_CANONICAL` | must additionally be exactly `APPROVED` | required before the command will target any path inside the canonical runtime home, i.e. `runtime\home\.automaton\state.db`. |

Refusal order, each of which exits non-zero and writes **no** report: gate → Conway home
guard → target (canonical containment, then state-directory containment, then existence) →
read-only `integrity_check` preflight. Only after those pass does it open the target
read-write and apply the pending `MIGRATION_STEPS`; if a migration statement itself fails, a
report is written with `error.stage = "migration"` and the command exits 1.

What the command guarantees:

- the target must already be inside the state directory that `requireConwayHome()`'s
  equivalent guard (`inspectConwayHome`) just verified, so a stray or wrong-`HOME` tree is
  refused rather than migrated;
- `integrity_check` must return `ok` on a **read-only** handle before any DDL is attempted;
- every run that reaches DDL leaves a JSON report naming the created tables, indexes,
  triggers, views and columns, with the before/after schema version — so the change is
  auditable after the fact without re-opening the database and guessing.

**The live database is still at schema V11** and this document is written while that is true.
Phase 19 approval covered the runner and the read-only status path only; applying V12/V13 to
`runtime\home\.automaton\state.db` is **A9** and is a separate, still-unapproved decision.
Until then, do not set `CONWAY_MIGRATION_ALLOW_CANONICAL`.

### 3.2 Ungated mutating CLI commands

Two further commands change configuration and, like `--status`, carry no activation gate
(**F-18-13**). Unlike `--status` they are writes: `--status` became read-only in Phase 19
**A3**, but these two were **not** part of the approved A2/A3 scope, so they are listed here
so they are not mistaken for safe inspection commands:

| Command | Dispatch | What it writes | Gate |
|---|---|---|---|
| `--pick-model` | [src/index.ts:192](../src/index.ts) → [src/setup/model-picker.ts](../src/setup/model-picker.ts) | `inferenceModel`, provider/key fields in `automaton.json` | none |
| `--configure` | [src/index.ts:198](../src/index.ts) → [src/setup/configure.ts](../src/setup/configure.ts) | API credentials, treasury limits, `maxChildren`, relay/RPC endpoints, model/provider config in `automaton.json`; opens `createDatabase` too ([src/setup/configure.ts:220](../src/setup/configure.ts)), so it still migrates the schema on open | none |

`--setup` performs the same job through the wizard and **is** gated
([src/index.ts:186](../src/index.ts)), which is the asymmetry Phase 19 **A4** was proposed to
close. **A4 was not approved**, so the gap stands and `--configure` remains an ungated write
that can also advance the schema. Phase 18 measured every credential field in the live
`automaton.json` as a zero-length string; correcting this documentation does not change
that, and no credential may be entered through these commands without approval.

---

## 4. Starting, stopping, checking

### Normal start (only after approval)

1. `HEALTH_CHECK.bat` — resolve any `fail`.
2. `SECURITY_AUDIT.bat` — confirm expected posture.
3. `START_CONWAY.bat`.
4. Type `APPROVED` (and `CREATE-WALLET` only if you have decided to create one).
5. In a second window, `HEALTH_CHECK.bat` and check `logs\automaton-*.log`.

### Normal stop

```
STOP_CONWAY.bat
```

The stop utility will not kill a process unless its command line contains
`Conway-Automaton`, so a stale or recycled PID cannot terminate an unrelated process.

### Restart

```
RESTART_CONWAY.bat
```

### Status without starting the agent

```
node dist/index.js --status
```

Output includes name, address, creator, sandbox, state, turns, tools, skills,
heartbeats, children, agent ID, model, and version.

Since Phase 19 **A3** this really is "status without touching the database": the command
opens the file `readonly: true, fileMustExist: true`, runs no DDL and applies no migrations —
see [§3.1](#31---status-is-a-read-only-snapshot). It starts no agent process and cannot enable
activation. If the database does not exist it now logs `Status unavailable: …` and exits 1
instead of creating one, and the WAL `-wal`/`-shm` sidecars may still be refreshed by SQLite
while `state.db` itself is untouched. To advance the schema, run
[`--migrate-schema`](#311-advancing-the-schema-deliberately---migrate-schema) explicitly.

---

## 5. What is deliberately absent

| Capability | State | Why |
|---|---|---|
| Windows service | Not installed | Requires approval; not needed for supervised use |
| Scheduled task | Not created | Same |
| Startup folder / Run key entry | Not created | Explicitly prohibited without approval |
| Firewall rule | Not created | No listener to protect |
| Port forwarding / tunnel | Not created | Explicitly prohibited without approval |
| Defender exclusion | Not added | Security controls must remain effective |
| System-wide Node/pnpm | Not installed | Isolation requirement |

A desktop shortcut is optional and does not execute anything until double-clicked.
See [INSTALLATION_REPORT.md](INSTALLATION_REPORT.md) for the isolation table.

---

## 6. Uninstall / rollback

Because nothing was installed system-wide, rollback is contained:

1. `STOP_CONWAY.bat`.
2. Back up anything you want to keep (`BACKUP_CONWAY.bat`, plus `wallet.json`
   manually if it exists).
3. Delete the project directory `<repo-root>`.

There is no service, registry entry, startup item, or global package to remove.
If a desktop shortcut was created, delete it separately.

---

## 7. Troubleshooting entry points

- Health failure → [MONITORING_GUIDE.md](MONITORING_GUIDE.md)
- Permission errors / ACL lockout → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Test suite hangs and worker leaks → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Restore procedure → [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)
