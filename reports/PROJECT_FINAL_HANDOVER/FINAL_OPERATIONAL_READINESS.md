# Final Operational Readiness

- Date: 2026-11-10
- Verdict: **ready for supervised, read-only operator use; not activated and not ready for
  autonomous operation by design**
- Dashboard: `http://127.0.0.1:8787` (loopback only)

## 1. Current operating posture

| Item | State |
|---|---|
| Agent loop | Not running; never started |
| Heartbeat / scheduler | Not running |
| Dashboard | Running, loopback only, token-gated, read-only by default |
| Security posture | `lockdown=true`, `activationApproved=false`, `allowedTools=[]` |
| Capabilities | financial, host shell, self-modification, replication, external exposure: all false |
| Children | 0 |
| Treasury | All 12 monetary limits zero; x402 allowlist empty |
| Wallet | None (no address, no key material) |
| Production database | V11, hash `2a8aeb...`, integrity `ok`, untouched |
| Self-healing | Disabled; mechanic non-executing |
| Repair approvals | Durable design ready; production persistence requires V14 migration |

## 2. Opening and using the console

1. Use the desktop shortcut `Conway Automaton Control Center.lnk`, or run
   `START_CONWAY_DASHBOARD.bat`.
2. The token gate asks for the operator token. The token is in the dashboard token file under
   `dashboard/`; read it locally. Do not paste it into a report, chat or ticket.
3. After unlock, 13 areas are available. The default posture is read-only.
4. `Run` in Health Monitor executes the guardian over a read-only handle and writes a new report file.
5. `Verify` in Backup & Recovery re-hashes archives against their manifests.
6. Restore is two-stage and deliberately awkward: type the archive name, review the plan, then
   confirm. It copies to `dashboard/restore-targets/`, never to the live runtime.
7. `STOP_CONWAY_DASHBOARD.bat` stops the console.

`START_CONWAY.bat` is a supervised agent launcher with its own confirmation prompt. It is not part of
normal console use and must not be run without activation approval. `RUN_CONWAY_DEMO.bat` opens the
existing read-only console only.

## 3. What the operator will see, and why

- Health headline `blocked (as reported)`: three of 16 checks have no source in a V11 database. The
  panel also shows an informational `degraded` reading for the 13 checks that did have a source.
- Agent state `UNKNOWN — never started`: this is correct, not a failure.
- Mechanic `VERIFIED / NOT REACHABLE`: self-healing is disabled.
- Health file `reports/health-latest.json` may be stale; the panel reports its age in minutes.
- Dashboard health is not agent health. The panel says so explicitly.

## 4. Routine operator checks

| Frequency | Check | Expected |
|---|---|---|
| On opening | Unlock, confirm 13 areas, confirm snapshot timestamp advances | No console errors |
| Daily | Health Monitor `Run` | New persisted report; unchanged blocked set on V11 |
| Weekly | Backup & Recovery `Verify` | 0 problems; archive age under threshold |
| Weekly | Security Center | lockdown true, activation false, wallet absent |
| Before any change | Read the relevant report in this directory | Approval scope understood |
| After any approved change | Re-run the invariant harness and the focused suites | 34 pass, 0 fail, 3 NOT VERIFIED known rows |

## 5. Incident and stop procedure

- If the console misbehaves: `STOP_CONWAY_DASHBOARD.bat`, then restart. The console is stateless
  apart from its audit log and action outputs.
- If an agent process is ever found: stop it immediately and investigate. No agent process existed
  during this mission.
- If a wallet or key file appears: stop, do not move or copy it, and preserve it for the operator.
- If `state.db` integrity fails: do not migrate; restore from a verified backup instead.

## 6. Readiness by use case

| Use case | Readiness | Reason |
|---|---|---|
| Inspect the install and its security posture | Ready now | Dashboard and read-only checks verified |
| Run health and backup verification | Ready now | Actions observed live, audited, non-destructive |
| Review and manage repair proposals | Ready after V14 migration | Tables absent on V11; API fails closed |
| Migrate production | Approval required | Disposable verification complete; production untouched |
| Live inference | Approval required | No request made; credentials not read |
| Create or restore a wallet | Approval required | Forbidden by mission; no material exists |
| Activate the agent | Approval required | Gates closed; no process started |
| Autonomous, self-funding operation | Not ready | Requires all four approvals plus funding and monitoring |

## 7. Known limitations carried into operation

1. Three Section 11 probes are NOT VERIFIED: BitLocker status, Defender/firewall state, and a
   universal negative on outbound traffic. See `FINAL_ACCEPTANCE_MATRIX.md`.
2. DNS check/connect window on provider fetch is narrowed but not atomically pinned; see the B-9
   report.
3. Solana USDC balance has no explicit timeout; unreachable with no wallet.
4. The health report file is refreshed by `HEALTH_CHECK.bat`, not by the console.
5. The work is uncommitted. Decide whether to commit before further changes.

## 8. Handover checklist

- [x] 14 reports in `reports/PROJECT_FINAL_HANDOVER/`
- [x] README deployment-state section
- [x] `docs/DASHBOARD_API.md` matches the code
- [x] Invariants re-verified after the final edits
- [x] Root and dashboard suites, typechecks and builds green
- [x] Production database hash unchanged
- [x] No wallet, no activation, no migration, no inference, no financial action
- [ ] Operator approval for production migration
- [ ] Operator approval for live inference
- [ ] Operator approval for wallet creation/restore
- [ ] Operator approval for agent activation
