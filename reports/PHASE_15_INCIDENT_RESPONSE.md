# Phase 15G — Security Monitoring and Incident Response

Date: 2026-10-31 · Install: `<repo-root>` (v0.2.1, commit `d8f8168`)
Status: implemented and unit-verified. Monitoring derives incidents from the
existing audit chain; the emergency stop is **not engaged** in the live install.

## Objective

Turn the tamper-evident event stream into actionable, deduplicated incidents with
fixed severities, detect attempts to falsify the audit trail, and provide an
emergency shutdown that actually stops autonomous behaviour.

## Components

| File | Role |
| --- | --- |
| `src/security/incidents.ts` | `raiseIncident`, `listIncidents`, `acknowledgeIncident`, `resolveIncident`, `incidentSummary`, `scanSecurityEvents`, `checkTamper`. |
| `src/security/emergency-stop.ts` | Marker + audit-trail stop state, engagement and human-only clearing. |
| `src/security/audit-chain.ts` | `appendSecuritySeal` / `verifySeals` — independent integrity anchors. |
| `src/heartbeat/tasks.ts` (`security_monitor`) | Periodic scan → incidents → KV summary → wake on CRITICAL/HIGH or integrity failure. |
| `src/heartbeat/daemon.ts` | Refuses to tick the scheduler while the stop is active (first tick and every scheduled tick). |
| `src/agent/tools.ts` | Refuses every tool dispatch while the stop is active, before authorization and policy. |
| `src/state/schema.ts` (V13) | `security_incidents` and `security_seals`, append-only via no-update/no-delete triggers, dedupe index `UNIQUE(incident_type, source_sequence) WHERE source_sequence IS NOT NULL`. |

## What is monitored

Authorisation failures and denials (`auth.failed`, `tool.denied`), financial
attempts (`treasury.denied`, replay/duplicate reason codes), wallet access
(`wallet.*`), tool execution decisions (`tool.authorized` / `tool.denied` with a
reason code and an argument **hash**, never argument values), configuration and
security changes (`config.*`, `security.config_changed`), process spawning
(`process.spawn*`), network exposure requests (`network.exposure`,
`network.public_endpoint`), maintenance actions (`maintenance.repair*`), and
system-level stop events (`system.emergency_stop*`).

## Severity model

`INFO` — routine authorizations and successful maintenance record-keeping.
`LOW` — executed repairs.
`MEDIUM` — denials, repair failures, tool-denial bursts (≥5 in window),
treasury-denial bursts (≥3), process spawns.
`HIGH` — wallet access, security-relevant config change, network exposure,
replay/duplicate financial attempt, auth-failure burst (≥3).
`CRITICAL` — any CRITICAL event, emergency stop engagement, audit-trail
integrity failure.

Incidents carry status `open → acknowledged → resolved`; acknowledgement and
resolution both require a non-empty named actor, and resolved rows are never
deleted (a DELETE raises via the trigger).

## Tamper protection

`scanSecurityEvents` is idempotent: re-scanning the same window returns the same
incident ids because `(incident_type, source_sequence)` is unique.
`checkTamper` verifies the recomputed chain **and** every seal. A seal stores the
chain head hash at a known sequence, so history rewritten after the seal is
detected even if the row's own `hash` column was left untouched. On failure it
raises one deduplicated CRITICAL `audit_tamper` incident (sentinel
`source_sequence = -1`) and returns `recommendEmergencyStop: true`. It never
clears, rewrites or re-seals anything itself.

Rotation: `rotate_audit_seal` is the only automatic integrity maintenance the
mechanic may perform, and it runs only when the chain verifies.

## Emergency shutdown

`engageEmergencyStop({ reason, requestedBy, db })` requires a non-empty reason,
writes the marker atomically (`tmp` + rename, mode `0600`) under the automaton
directory, appends a CRITICAL `system.emergency_stop` audit event, then invokes
the optional in-process `onStop` hook (a hook failure never un-engages the stop).
Re-engaging is idempotent and keeps the original reason and timestamp.

Effects while engaged:

* heartbeat daemon logs and skips the tick — no task executes;
* `executeTool` returns `Tool blocked: emergency stop is engaged` for **any**
  tool, including fully allowlisted ones, and records `tool.denied` with
  reasonCode `EMERGENCY_STOP`;
* the mechanic returns `skippedReason: "emergency stop engaged"` and performs
  nothing, including no sealing.

Clearing requires `confirmedBy` (a named human) **and** a reason; both are
audited as a MEDIUM `system.emergency_stop_cleared` event. An empty approver is
refused. Nothing in the agent, mechanic, guardian or monitoring task clears the
stop automatically, and an unreadable marker file counts as engaged (fail closed).

Operator paths today: create `~/.automaton/EMERGENCY_STOP` (or the runtime HOME
equivalent used by this isolated install), or call `engageEmergencyStop` from a
script. There is no CLI subcommand for it yet — see residual risks.

## Evidence

| Check | Result |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| `src/__tests__/phase15-incident-response.test.ts` | 26 passed / 26 |
| `src/__tests__/phase15-self-healing.test.ts` | 40 passed / 40 |
| `phase15-tool-security` / `phase15-sandbox` / `phase15-treasury` / `tools-security` | 16 / 46 / 35 / 71 — all passed |
| `heartbeat.test.ts` + `heartbeat-scheduler.test.ts` | 39 passed / 39 |

Representative assertions: the full `open → acknowledged → resolved` lifecycle
with no deletion; `DELETE FROM security_incidents` throws; duplicate raises
collapse to one row; anonymous acknowledgement and reason-less resolution return
`false`; each event class maps to the documented incident type and severity;
auth bursts fire at three failures and not at two; scans are idempotent; events
outside the window are ignored; a forged row is caught by both chain and seal
verification; an allowlisted `read_file` call is blocked by the marker file
alone; the block persists when the marker is deleted but the audit trail still
says engaged; clearing by a named approver restores dispatch; a mocked scheduler
records **zero** ticks while engaged and one tick when not; the security-monitor
task writes `last_security_scan` with `tamper: "audit_tamper"`, `chainValid:
false`, `open: 2` and wakes the agent.

## Residual risks

1. **Detection is poll-based.** Incidents appear when `security_monitor` runs, not
   instantaneously; the default interval governs mean time to detection.
2. **No external alerting.** Findings stay in the local database and KV; no SIEM,
   mail or webhook sink is wired (that would require network egress the current
   configuration forbids).
3. **No CLI command for the stop.** Operators must touch the marker file or call
   the API; a `conway emergency-stop` subcommand is the obvious next step.
4. **Incident descriptions embed event details.** Audit events store argument
   hashes rather than values, so this is low-risk, but a future event type that
   logs raw input would propagate into `security_incidents.description`.
5. **Single-host, single-database.** Tampering by someone with filesystem access
   to both `state.db` and the seal rows is out of scope for an application-level
   control; off-host, read-only backup copies (Phase 15K) are the mitigation.

## Constraint compliance

No Windows security setting, service, firewall rule or scheduled task was changed.
No network endpoint was exposed. No wallet, key, credential or transaction was
created or touched — monitoring observes the audit trail only. All activation
gates remain closed (`activationApproved: false`, activation environment
variables unset, `maxChildren: 0`), and the emergency stop is not engaged in the
live install, which is the expected steady state for an inert deployment.
