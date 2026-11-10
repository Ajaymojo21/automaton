# Using the Conway Automaton AI Command Center

A local, read-only operator console for the Conway Automaton install at
`<repo-root>`. It shows what the system actually is — not what the code
would prefer it to be — and it cannot start, fund, migrate, seal, engage or repair anything.

## Start and stop

| Do this | By running |
|---|---|
| Start | `START_CONWAY_DASHBOARD.bat`, or the **Conway Automaton Control Center** desktop shortcut |
| Stop | `STOP_CONWAY_DASHBOARD.bat` |
| Restart | `RESTART_CONWAY_DASHBOARD.bat` |
| Check | `HEALTH_CHECK_DASHBOARD.bat` |

Each launcher pins `HOME` to `<repo-root>\runtime\home` before it resolves
anything, uses the project's own Node (`runtime\node-v22.23.4-win-x64\node.exe`), and never
installs a service, startup entry or scheduled task. Starting the console does **not** start the
Conway agent, and the console prints that fact in its banner.

Then open `http://127.0.0.1:8787` in a browser on this machine. Nothing else can reach it.

## Unlocking

The console asks for a **local operator token**. It is the contents of:

```
<repo-root>\dashboard\state\dashboard.token
```

Open it in Notepad, copy the single 43-character line, paste it into the field, Unlock console.

- The token is never stored in the browser — not in localStorage, not in a cookie you can read.
  It lives in memory for the tab and disappears when you lock the console or restart the server.
- The server deliberately does not print the token in its own logs or banner.
- Every restart logs all sessions out. That is intended: there is no session state on disk.

## Reading the console

Every value carries a verdict and the source it came from. The five verdicts are not
interchangeable, and the console never collapses them:

| Verdict | Means |
|---|---|
| **VERIFIED** | an observation was made during this read, from a named read-only source |
| **EMPTY** | the container exists and was counted — zero rows, zero files |
| **UNKNOWN** | no observation is possible here; there is no default substituted |
| **NOT VERIFIED** | a source exists but proving the value needs a write, an absent table, or elevation |
| **NOT APPLICABLE** | the question does not apply to this install |

So a grey **UNKNOWN** is not a failure and a red badge is not an alarm: crimson is reserved for
an observed failure, and amber means *unproven*. When a tile says
`NOT VERIFIED — table absent`, it is telling you the console refused to guess.

The header strip is the live digest pushed over the stream every 15 seconds. The tiles inside an
area come from the last full read; **Re-read** forces a new one. If the strip still says
*waiting for the first stream frame*, the browser is not attached to `/api/stream`.

## The twelve areas

| Area | What it answers | What it will not claim |
|---|---|---|
| **Overview** | whole-system posture: runtime home, activation, emergency stop, wallet, self-healing, health, schema, data plane | it never renders the agent's runtime state as `setup` — that is a code default, not an observation |
| **AI Agent** | whether the agent is running and what its control surface is | no process is identified from `tasklist` image names; the agent state is UNKNOWN |
| **AI Models** | declared model, token ceiling, credential **presence**, live-model gate | nothing here proves a model was called; live testing is `PENDING CREDENTIAL APPROVAL` |
| **Wallet** | wallet existence, address, balances | `NO WALLET CONFIGURED` — no wallet exists, none is created, no key material is ever displayed |
| **Treasury** | the declared policy limits | *declared* and *effective* are separate columns; enforcement state is not inferred from a config value |
| **Security Center** | emergency stop, activation gates, audit chain, incidents, seals, config integrity | absent tables are NOT VERIFIED — never "seals failed" |
| **Health Monitor** | the pinned guardian's 8 checks, plus host facts | `audit_chain: fail` on a missing table is shown as a schema gap, with the two-column reading explained |
| **Self-Healing** | whether the mechanic could run | it cannot: `NOT REACHABLE`, `NEVER RUN`, and the console has no code path to enable it |
| **Activity Logs** | agent log files, console audit trail | `NO DATA — the runtime has never been launched from this console` |
| **Backup & Recovery** | archives on disk, what has actually been hash-verified, restore to an alternate path | verification is on demand (press **Verify**) so the panel stays fast |
| **System Controls** | which controls exist and why they are disabled | there is no start/stop/activate control on this page, by design |
| **Settings** | endpoints, config keys, security block, write paths that are not exposed | declared-at-rest values are labelled as such |

## The three actions you can take

In **Health Monitor** → **Run**: executes the Conway guardian over the read-only handle and
writes a *new* file under `dashboard/state/health-<stamp>.json`. It never overwrites an earlier
report and never writes to Conway's `reports/`.

In **Backup & Recovery** → **Verify**: re-hashes every archive file against its own manifest.
Read-only. Current result: `9/10 archive(s) carry a manifest · 28 archived file(s) match,
6 live-file entry(ies) match, 0 problem(s)`.

In **Backup & Recovery** → **Restore a backup to an alternate path**, two stages:

1. **1 · Plan and verify** — type the backup directory name and repeat it in the confirmation
   box. The console verifies the hashes and shows you the exact target directory and file count.
   Nothing is copied yet.
2. **2 · Copy to alternate path** — enabled only after a successful plan, and it writes to the
   directory the plan showed you.

A restore always creates a **new** directory under `dashboard/restore-targets/`. It never
overwrites the live state, it refuses any target inside `runtime/home`, and it refuses a target
that already exists. The copied folder contains `RESTORE-NOTE.txt` naming the source archive,
the target and the files. **Promoting a restored copy into `runtime/home/.automaton` is a manual
operator action** (`restore.mjs` without `--allow-live`, with the live tree moved aside first);
the console has no button for it and no code path for it.

## What you will not find here

No start/stop/activate button. No wallet creation or funding. No API key entry. No migration
runner. No emergency-stop control. No self-healing toggle. No shell, no command box, no way to
make the console run something you typed. Those are not missing features — they are the mandate:
the agent stays inactive until you decide otherwise, and the console exists so you can see that
state clearly.

## If something looks wrong

Run `HEALTH_CHECK_DASHBOARD.bat`. It prints one line per check and exits non-zero if any check
failed **or could not be made** — an unproven check is never rounded up into a pass. It also
re-reads the live config and prints each security gate separately, so you can confirm that
opening the console did not change anything:

```
[PASS] gate:security.activationApproved: holds (must not be true)
[PASS] gate:security.lockdown: holds (must stay true)
[PASS] gate:security.allowedTools: holds (must stay empty)
```

`19 pass, 0 fail, 0 not verified, 0 warn` is the expected result of a healthy, unused console.

## Data written by the console

| Path | Contents |
|---|---|
| `dashboard/state/dashboard.token` | the operator token, mode 0600, created once |
| `dashboard/state/dashboard.pid` | the launcher's process id while the console runs |
| `dashboard/state/health-*.json` | one file per guardian run |
| `dashboard/state/dashboard-health-*.json` | one file per `HEALTH_CHECK_DASHBOARD.bat` run |
| `dashboard/logs/audit-<date>.jsonl` | auth attempts, denials, actions, restore stages |
| `dashboard/logs/dashboard.out.log` / `.err.log` | server stdout/stderr |
| `dashboard/restore-targets/<name>--<stamp>/` | only what you explicitly restore |

Nothing outside `dashboard/` is written. Conway's `runtime/home/`, `logs/`, `reports/` and
`backups/` are read-only from the console's point of view.
