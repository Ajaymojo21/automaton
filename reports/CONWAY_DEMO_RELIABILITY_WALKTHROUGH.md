# Conway Automaton — Reliability & Self-Healing Walkthrough

Two separate subsystems, with deliberately different powers:

| Subsystem | Module | Mutates? | State in this deployment |
|---|---|---|---|
| **Health Guardian / System Doctor** | `src/reliability/health-guardian.ts` | **no** — read-only checks | **running, verified** |
| **Autonomous Mechanic** | `src/reliability/mechanic.ts` | yes, but gated and classified | **disabled, refuses to act** |

The separation is the design: the thing that *diagnoses* cannot *repair*, and the thing that repairs
must pass a classifier plus a global enablement gate plus (for some repairs) human approval.

---

## 1. Health Guardian — the eight checks

Executed against the live read-only database. Full report:
`dashboard/state/health-2026-11-09T11-10-07-106Z.json`.

| # | Check | Status | Message | Reading |
|---|---|---|---|---|
| 1 | `emergency_stop` | **pass** | Not engaged | marker union scan found nothing |
| 2 | `database_integrity` | **pass** | `quick_check ok` | SQLite agrees the file is sound |
| 3 | `schema_version` | **warn** | `schema 11 is older than 13; migrations run on next open` | evidence `{version:11, expected:13}` |
| 4 | `audit_chain` | **fail** | `no such table: security_events` | **no source**, not a finding |
| 5 | `treasury_reservations` | **warn** | `treasury table unavailable` | V12/V13 table absent |
| 6 | `scheduler_leases` | **pass** | `no expired leases` | — |
| 7 | `disk_space` | **pass** | `44.7% free (212.5 GiB)` | evidence: 228,204,040,192 free of 510,146,899,968 |
| 8 | `wallet_storage` | **pass** | `no wallet on disk` | existence/format only, never key material |

### Why the headline says `critical`

`runHealthChecks()` computes `overall` from the raw check statuses, and a `fail` forces `critical`.
Check 4 fails because the table it reads does not exist. So the *guardian's* verdict is `critical`
while the *system* is not in a critical condition.

The console refuses to pass that headline through unqualified. Its Health panel reports two columns:

- **Overall (as reported):** `critical`
- **Overall (informative checks only):** `degraded` — "7 informative check(s), 1 reclassified
  NOT VERIFIED (absent source), 2 warn, 0 fail. 'critical' comes from audit_chain failing on a
  missing table, not from a security finding."

That is the correct treatment. The alternative — reporting `ok` — would hide a real gap; reporting
`critical` alone would misrepresent the severity. Both facts are shown.

### Report freshness is reported, not hidden

`reports/health-latest.json` was **12,942 minutes old** (~9 days) at observation time. It is written by
`HEALTH_CHECK.bat`, not by the console, so its staleness is a property of the scheduled job, not of
the guardian. The console displays the age and the hash rather than implying freshness.

---

## 2. The Mechanic — classification before execution

`classifyRepair(repairId)` is a pure function returning one of three classes:

| Class | Meaning |
|---|---|
| `automatic` | may run without human input **if** self-healing is enabled |
| `requires_approval` | must be approved by a human before it can run |
| `forbidden` | never runs, under any configuration |

### 2.1 Real plan derived from the real health report

```
audit_chain            → investigate_audit_tamper            [requires_approval]
treasury_reservations  → release_stale_treasury_reservations [requires_approval]
```

Both entries are **proposals only**. No action was taken.

### 2.2 The gate refused

```json
{
  "enabled": false,
  "emergencyStop": false,
  "skippedReason": "self-healing is disabled (security.selfHealingEnabled=false)",
  "actions": 0,
  "pending": 0
}
```

`runMechanic()` returns **before** touching anything: zero actions, zero pending. The refusal is a
typed reason string, not a silent no-op — a caller can distinguish "disabled" from "nothing to do".

### 2.3 Forbidden repairs are forbidden by name, not by prompt

Six destructive repair identities were passed to the classifier. All six returned `forbidden`:

| Repair id | Classification |
|---|---|
| `disable_audit_logging` | **forbidden** |
| `spawn_child` | **forbidden** |
| `transfer_credits` | **forbidden** |
| `enable_activation` | **forbidden** |
| `rotate_wallet_keys` | **forbidden** |
| `widen_tool_permissions` | **forbidden** |

This is the property that makes the mechanic safe to enable later: it cannot be talked into disabling
the audit log, moving money, rotating keys, spawning a child, or widening its own permissions, because
those names are classified before any execution path is considered.

---

## 3. Simulated recovery — the seven-step walkthrough

**Everything in this section is `SIMULATED` except the classifier, which is real.** The "unhealthy
component" is a synthetic `HealthReport`; no process, file, table or service was touched.

### Step 1 — a component reports unhealthy (**SIMULATED**)

```json
{ "id": "scheduler_leases",       "status": "warn", "message": "SIMULATED: 2 expired leases" }
{ "id": "treasury_reservations",  "status": "warn", "message": "SIMULATED: 1 stale reservation" }
{ "id": "audit_chain",            "status": "pass", "message": "SIMULATED: chain intact" }
{ "id": "database_integrity",     "status": "pass", "message": "SIMULATED: ok" }
```

### Step 2 — the health check detects it

The same code path as §1 receives this report; the checks that are `warn` become candidates.

### Step 3 — the diagnostic result

Two warnings, two passes. `overall` is `degraded` by construction of the synthetic report.

### Step 4 — a proposed repair plan is generated (**real classifier**)

```
scheduler_leases       → prune_expired_leases             [automatic]
treasury_reservations  → release_stale_treasury_reservations [requires_approval]
```

Note the asymmetry: a lease prune is classified `automatic`, a treasury reservation release is
`requires_approval`. The classifier does not treat all warnings alike.

### Step 5 — approval boundaries

- `prune_expired_leases` would need only the global self-healing gate.
- `release_stale_treasury_reservations` would additionally need a human approval — **and no approval
  surface exists in this build** (see §5).

### Step 6 — simulated repair result

```json
{
  "enabled": false,
  "skippedReason": "self-healing is disabled (security.selfHealingEnabled=false)",
  "actions": 0
}
```

**No repair was executed**, simulated or otherwise. The mechanic's own gate stopped the run — which is
the correct behaviour for a demonstration that must not alter the system.

### Step 7 — post-repair verification

**NOT RUN.** No repair was applied, so there is nothing to verify. Reporting a "verified healthy"
state here would be fabrication.

---

## 4. Heartbeat and scheduler

| Fact | Value | Interpretation |
|---|---|---|
| Entries declared in `heartbeat.yml` | **6** | configuration exists |
| Entries enabled in the YAML | **3** | intent to run three of them |
| Entries in `heartbeat_entries` table | **0** | `syncHeartbeatToDb()` has never run |
| Schedules created | **0** | nothing is queued |
| Executions | **0** | nothing has woken |
| `heartbeat_history` rows | **0** | no history |
| `wake_events` rows | **0** | no wake cycles |

"3 enabled" must not be read as "3 running". The console shows all four numbers side by side, which
is the only way that distinction survives contact with a dashboard.

---

## 5. What is missing (and would be dishonest to imply exists)

1. **No approval surface.** The mechanic can classify a repair `requires_approval`, but there is no
   queue, no UI, no CLI, and no record type for an approval decision. A `requires_approval` repair can
   therefore only sit unexecuted.
2. **No post-repair verification loop.** The intended workflow includes validate-after-repair; the
   code path has never run and there is no evidence it is correct.
3. **No escalation.** Nothing pages, emails, or notifies. `health-latest.json` going stale for 9 days
   produced no alert — it produced a number in a panel, which is only useful if someone looks.
4. **No repair history.** With self-healing off, there is no audit of repairs because there are no
   repairs. The table that would hold them has never been exercised.
5. **`critical` is sticky.** Because the guardian derives `overall` from raw statuses, any absent
   source will pin the headline at `critical` until migrations run. The console compensates; the
   guardian does not.

---

## 6. Reproduce

```powershell
$env:HOME = '<repo-root>\runtime\home'
.\runtime\node-v22.23.4-win-x64\node.exe node_modules\tsx\dist\cli.mjs runtime\tmp\demo-recovery.mjs
```

Expected output (observed):

```
realOverall: critical
realPlan:    audit_chain -> investigate_audit_tamper [requires_approval]
             treasury_reservations -> release_stale_treasury_reservations [requires_approval]
realOutcome: enabled=false, skippedReason="self-healing is disabled (security.selfHealingEnabled=false)", actions=0
simulatedPlan: scheduler_leases -> prune_expired_leases [automatic]
forbidden:   disable_audit_logging, spawn_child, transfer_credits,
             enable_activation, rotate_wallet_keys, widen_tool_permissions  → all [forbidden]
```

A second, independent path exists in the console: `POST /api/action/health-check` runs the same
guardian read-only and persists a report to `dashboard/state/` (`EV-02`: `8 checks, overall critical,
persisted to dashboard/state`).

---

## 7. Bottom line

The **monitoring** half of self-healing is real, safe and honest: eight checks, per-check evidence, a
deliberate two-column verdict when a source is missing, and a staleness report instead of a fake
"healthy".

The **repair** half is real code that has been **proven to refuse**. That is the correct state for a
system whose security policy says `selfHealingEnabled=false`. What does not exist yet is the human
approval loop that would make `requires_approval` meaningful — and until that exists, "autonomous
self-healing" is a design, not an operational capability.
