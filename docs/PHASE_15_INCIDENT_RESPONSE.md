# Phase 15G — Security Monitoring, Incidents and Emergency Stop (Operator Guide)

**Control:** the tamper-evident event stream becomes deduplicated incidents with fixed severities;
audit falsification is detectable; and one switch stops all autonomous behaviour.
**Status:** implemented, 26 tests executed. **The emergency stop is NOT engaged** in the live
install — that is the expected steady state for an inert deployment.
**Evidence:** [`../../reports/PHASE_15_INCIDENT_RESPONSE.md`](../../reports/PHASE_15_INCIDENT_RESPONSE.md)
**Code:** [`src/security/incidents.ts`](../src/security/incidents.ts),
[`src/security/emergency-stop.ts`](../src/security/emergency-stop.ts),
[`src/security/audit-chain.ts`](../src/security/audit-chain.ts), V13 in
[`src/state/schema.ts`](../src/state/schema.ts), task `security_monitor` in
[`src/heartbeat/tasks.ts`](../src/heartbeat/tasks.ts)

---

## 1. What is monitored

Derived from the hash-chained `security_events` table — events written by Phase 15C and 15D, so
monitoring observes rather than re-implements authorization.

`auth.failed` and `tool.denied` (authorisation failures) · `treasury.denied` including
replay/duplicate reason codes · `wallet.*` access · `tool.authorized` / `tool.denied` with reason
code and an argument **hash**, never argument values · `config.*` and `security.config_changed` ·
`process.spawn*` · `network.exposure` and `network.public_endpoint` · `maintenance.repair*` ·
`system.emergency_stop*`.

## 2. Severity model

| Level | Assignments |
|---|---|
| `INFO` | routine authorizations, successful maintenance record-keeping |
| `LOW` | executed repairs |
| `MEDIUM` | denials, repair failures, tool-denial bursts (≥5 in window), treasury-denial bursts (≥3), process spawns |
| `HIGH` | wallet access, security-relevant config change, network exposure, replay/duplicate financial attempt, auth-failure burst (≥3) |
| `CRITICAL` | any CRITICAL event, emergency stop engagement, audit-trail integrity failure |

Incidents move `open → acknowledged → resolved`. Both acknowledgement and resolution require a
**non-empty named actor**; anonymous acknowledgement returns `false`. Resolved rows are never
deleted — `DELETE FROM security_incidents` throws via trigger.

## 3. The `security_monitor` heartbeat task

Each interval it scans the window, raises or updates incidents, writes a KV summary, and **wakes
the agent on CRITICAL, HIGH, or an integrity failure**. Default posture: no wake-up on INFO/LOW,
so a busy audit chain does not produce a self-inflicted alert storm.

Detection is **poll-based**. Mean time to detection is the configured interval.

## 4. Tamper detection — two independent proofs

`checkTamper` verifies both:

1. the recomputed hash chain (`verifySecurityChain`) — each event's hash covers the previous
   hash, so an inserted, edited or deleted row breaks the sequence even if the append-only
   `UPDATE`/`DELETE` triggers were dropped; and
2. every seal (`verifySeals`) — a seal stores the chain head hash at a known sequence, so history
   rewritten *before* the seal is caught even when the row's own `hash` column was left untouched.

On failure it raises one deduplicated CRITICAL `audit_tamper` incident (sentinel
`source_sequence = -1`) and returns `recommendEmergencyStop: true`. It never clears, rewrites or
re-seals anything itself — a detector that can fix its own evidence is not a detector.

`scanSecurityEvents` is idempotent: re-scanning the same window returns the same incident ids,
because `UNIQUE(incident_type, source_sequence)` is enforced in V13.

The only automatic integrity maintenance the mechanic may perform is `rotate_audit_seal`, and only
while the chain verifies (see [PHASE_15_SELF_HEALING.md](PHASE_15_SELF_HEALING.md)).

## 5. Emergency stop — the operator runbook

### Engage

Two paths. **The marker file is the one that works when the software is misbehaving:**

```bash
# the runtime HOME in use by this isolated install
touch "<repo-root>/runtime/home/.automaton/EMERGENCY_STOP"
```

or programmatically:

```js
engageEmergencyStop({ reason: "audit chain break at seq 118", requestedBy: "<operator>", db })
```

`engageEmergencyStop` requires a non-empty reason, writes the marker atomically (`tmp` + rename,
mode `0600`) under the automaton directory, appends a CRITICAL `system.emergency_stop` audit
event, then calls the optional in-process `onStop` hook. **A hook failure never un-engages the
stop.** Re-engaging is idempotent and keeps the original reason and timestamp.

### What stops

| Component | Behaviour while engaged |
|---|---|
| heartbeat daemon | logs and skips the tick — **zero** tasks execute (asserted against a mocked scheduler: 0 ticks engaged, 1 tick not) |
| `executeTool` | returns `Tool blocked: emergency stop is engaged` for **any** tool, including fully allowlisted ones, and records `tool.denied` with `reasonCode: EMERGENCY_STOP` |
| mechanic | returns `skippedReason: "emergency stop engaged"`, performs nothing, including no sealing |
| health guardian | reports `critical` on the `emergency_stop` check |

The block persists when the marker file is deleted but the audit trail still says engaged — that
is the dual-source check, and it was tested that way deliberately.

### Clear

```js
clearEmergencyStop({ confirmedBy: "<operator>", reason: "false positive, chain verified" })
```

Both fields are required. An empty approver is refused. The clearance is audited as a MEDIUM
`system.emergency_stop_cleared` event. **Nothing in the agent, mechanic, guardian or monitoring
task clears the stop automatically** — an agent cannot un-pause itself. There is no CLI
subcommand yet (residual 3), so a manual clear currently means a script, or removing the marker
**and** accepting that the audit trail still reports engaged until a proper clearance is written.

### Also worth knowing

An **unreadable marker file counts as engaged** (fail closed). If the stop appears sticky with no
event, check the file's ACL before assuming a bug.

## 6. Response playbook

| Signal | First action |
|---|---|
| `audit_tamper` (CRITICAL) | engage the emergency stop; **do not** run `vacuum`, `rotate_audit_seal` or any repair; copy `state.db` (+`-wal`/`-shm`) to a read-only location, then verify. `investigate_audit_tamper` is approval-required by design |
| `treasury.denied` burst (MEDIUM) or replay/duplicate (HIGH) | check `treasury_authorizations` for the actor and the idempotency key; a HIGH replay means something retried a money operation |
| `network.exposure` / `network.public_endpoint` (HIGH) | verify nothing is listening: `netstat -ano \| findstr LISTENING` and confirm no Conway-owned PID; `allowExternalExposure` must stay `false` |
| `config.*` / `security.config_changed` (HIGH) | diff `automaton.json` against `config/automaton.template.json`; a grant you did not make is the incident |
| `tool.denied` burst | usually expected posture — with the default config **every** dispatch is denied. Escalate only when denials are mixed with authorizations for the same class, which indicates a grant appeared |
| stuck `reserved` treasury rows | reconcile manually; the agent will not release them for you |

## 7. Verifying the control yourself

```bash
cd <repo-root>
N=./runtime/node-v22.23.4-win-x64/node.exe
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-incident-response.test.ts # 26/26
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-self-healing.test.ts      # 40/40
node node_modules/typescript/bin/tsc --noEmit                                          # exit 0
```

Representative assertions: the full lifecycle with no deletion; `DELETE FROM security_incidents`
throws; duplicate raises collapse to one row; anonymous acknowledgement and reason-less
resolution return `false`; each event class maps to the documented incident type and severity;
auth bursts fire at three failures and **not** at two; scans are idempotent; events outside the
window are ignored; a forged row is caught by both chain and seal verification; an allowlisted
`read_file` is blocked by the marker file alone; clearing by a named approver restores dispatch;
the `security_monitor` task writes `last_security_scan` with `tamper: "audit_tamper"`,
`chainValid: false`, `open: 2` and wakes the agent.

## 8. Residual risks

1. **Poll-based detection.** Nothing is instantaneous; the interval is your MTTD.
2. **No external alerting.** Findings stay in the local database and KV. No SIEM, mail or webhook
   sink is wired, because that needs network egress the current configuration forbids. If the
   process is dead, so is the monitor — see the guardian's liveness limit.
3. **No CLI for the stop.** Marker file or API only; `conway emergency-stop` is the obvious next
   build.
4. **Incident descriptions embed event details.** Events store argument hashes rather than values,
   so this is low risk today — but a future event type that logs raw input would propagate into
   `security_incidents.description`.
5. **Single host, single database.** Tampering by someone with filesystem access to both `state.db`
   and the seal rows is out of scope for an application-level control. The mitigation is off-host,
   read-only backup copies — see [PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md).
