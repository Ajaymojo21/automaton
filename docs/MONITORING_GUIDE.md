# MONITORING GUIDE — Phase 10

**Monitoring mode:** local, pull-based, no external telemetry
**Latest health result:** **PASS**
**Latest security audit result:** **PASS**

---

## 1. What is monitored

| Signal | Source | File |
|---|---|---|
| Process liveness | PID file + command-line validation | `logs/automaton.pid` |
| Config presence and posture | `automaton.json` | `runtime/home/.automaton/automaton.json` |
| Lockdown / allowlist | Config | same |
| Wallet presence (existence only) | `wallet.json` stat | same directory |
| Database integrity | `PRAGMA quick_check` | `runtime/home/.automaton/state.db` |
| Disk free | Filesystem | install volume |
| Logs directory | Existence | `logs/` |
| Activation env token | Process environment | current shell/process |
| Policy denials | `policy_decisions` table | `state.db` |
| Credential patterns in logs | Regex scan (values never printed) | `logs/*.log` |
| Network listeners owned by the agent | `netstat -ano` filtered by PID | live process |

No OpenAI/Conway/Anthropic telemetry is enabled. Nothing is uploaded.

---

## 2. Health check

Command: `HEALTH_CHECK.bat` (or `node runtime/bin/health-check.mjs`)

Result is written to `reports/health-latest.json`. Exit codes:

| Exit | Meaning |
|---|---|
| `0` | PASS or PASS with warnings (e.g. process not running) |
| `1` | A failing check (config missing, DB corrupt, disk low) |

Latest observed output (2026-10-31T11:03:47Z):

| Check | Status | Detail |
|---|---|---|
| process | warn | not running (no live pid file) — expected |
| config | pass | path resolved |
| lockdown | pass | enabled |
| activation_flag | info | not approved (expected) |
| allowed_tools | pass | 0 allow-listed |
| wallet | info | no wallet present |
| database | pass | `quick_check ok` |
| disk | pass | 220.1 GB free |
| logs | pass | directory present |
| activation_env | info | token absent |

**Interpretation:** a `warn` for "not running" is normal for an installed-but-inactive
deployment. A `fail` on config, database, or disk requires action before any start.

---

## 3. Security audit

Command: `SECURITY_AUDIT.bat` (or `node runtime/bin/security-audit.mjs`)

Writes `reports/security-audit-latest.json`. It reports info-level findings for a
healthy locked-down install and escalates when it sees:

- lockdown disabled;
- `activationApproved: true` while the install is meant to be at rest;
- a non-empty allowlist;
- a wallet file present;
- nonzero treasury limits;
- broad ACLs (`Everyone`, `BUILTIN\Users`, `Authenticated Users`);
- a listener bound to `0.0.0.0` or `[::]` owned by the agent;
- credential-shaped strings in logs;
- denied policy decisions recorded in the DB.

It never prints secret values, only pattern counts.

**Cadence:** run after every config change, before and after every start, and at
least weekly while inactive. Run it immediately if a wallet or provider key is added.

---

## 4. Logs

| Property | Value |
|---|---|
| Directory | `logs/` |
| Active log | `automaton-YYYYMMDD-HHMMSS.log` |
| Error log | `automaton-YYYYMMDD-HHMMSS.err.log` |
| Level | `info` (no debug payload logging) |
| Rotation | `runtime/bin/rotate-logs.mjs`, runs at start; rotates files ≥ 10 MB, keeps 5 generations |
| Secret handling | Logger does not intentionally log credentials; audit scans for leaks |

Open the folder with `OPEN_CONWAY_LOGS.bat`.

**What to look for:**

- `Blocked "--run": runtime activation is not approved.` — gate working.
- `TOOL_NOT_ALLOWED`, `FINANCIAL_DISABLED`, `HOST_SHELL_DISABLED`,
  `REPLICATION_DISABLED`, `EXTERNAL_EXPOSURE_DISABLED` — policy denials.
- `credit topup`, `transfer`, `x402` — should not appear while locked down.
- Repeated restarts or PID mismatches — investigate with
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Logs are excluded from automated backup because they are operational artifacts, not
state. Archive them separately if needed.

---

## 5. Process and PID handling

- `START_CONWAY.bat` launches `node dist/index.js --run` hidden, redirects stdout and
  stderr, and writes the PID to `logs/automaton.pid`.
- `STOP_CONWAY.bat` reads that PID, validates via PowerShell `Get-CimInstance` that
  the command line contains `Conway-Automaton`, sends `SIGTERM`, then `SIGKILL` after a
  grace period, and removes the PID file.
- A stale PID file is detected by the health check and preflight. The stop utility
  refuses to kill a PID whose command line does not match, preventing an unrelated
  process from being terminated.

---

## 6. Recommended operating cadence

| Frequency | Action |
|---|---|
| Before every start | `HEALTH_CHECK.bat`, `SECURITY_AUDIT.bat` |
| After every config change | `SECURITY_AUDIT.bat` |
| Daily (if running) | Review new log lines for denials or errors |
| Weekly (inactive) | `HEALTH_CHECK.bat`, disk check |
| Before/after upgrades | `BACKUP_CONWAY.bat`, then audit |
| On any suspected exposure | `STOP_CONWAY.bat`, audit, rotate credentials |

There is **no automatic alerting** (no email, webhook, or Windows event trigger).
Monitoring is manual by design; adding external alerting is a separate decision and
must not open a public port.

---

## 7. Metrics that matter at activation

Once (and only if) the agent is activated, watch:

- `Turns` growth vs `maxTurnsPerCycle: 25`;
- `Children` count vs `maxChildren: 0`;
- policy denial spikes (may indicate prompt injection);
- credit/USDC balance deltas;
- DB size growth (`state.db`);
- unexpected outbound connections.

`--status` prints a compact snapshot:

```
Name: automaton-local | State: setup | Turns: 0 | Tools: 0 | Skills: 0
Heartbeats: 0 | Children: 0 | Agent ID: not registered
```
