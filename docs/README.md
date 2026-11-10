# Conway Automaton — Windows Installation Documentation

**Install root:** `<repo-root>`
**Version:** upstream `0.2.1` at commit `d8f816881fd24b6f5e3d616e59edec387a447667`
**Platform:** Windows 11 Home Single Language 26H2, x64
**Current status:** **INSTALLED — ACTIVATION REQUIRES APPROVAL**

This directory documents the isolated installation, its security controls, and the
operations needed to run, monitor, back up, and audit it. The upstream project
documentation remains at the repository root: [`../README.md`](../README.md),
[`../DOCUMENTATION.md`](../DOCUMENTATION.md), and [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

> **Nothing in this installation is financially active.** The runtime is installed in
> deny-by-default lockdown. No wallet exists. No API keys are configured. `--run`
> exits with code 2 until two independent activation signals are set by a human.

> **Phase 15 (security remediation) closed at status B — partially complete, residual risks
> documented.** Read [`PHASE_15_OVERVIEW.md`](PHASE_15_OVERVIEW.md) before changing any security
> setting or activating anything; its R-1…R-10 register is the list of what is still not proved.

> **Phase 16 (final security closure) also closed at status B — PARTIALLY VERIFIED.** Read
> [`PHASE_16_OVERVIEW.md`](PHASE_16_OVERVIEW.md) and
> [`PHASE_16_ACCEPTANCE_REPORT.md`](PHASE_16_ACCEPTANCE_REPORT.md). Status **A is not claimed**,
> because administrator-only Windows verification, real-data recovery and live-model testing are
> still unverified. All activation gates remain closed.

> **Phase 17 (AI Command Center dashboard) closed as DASHBOARD COMPLETE.** Read
> [`DASHBOARD_USER_GUIDE.md`](DASHBOARD_USER_GUIDE.md) to use it and
> [`../reports/DASHBOARD_ACCEPTANCE_REPORT.md`](../reports/DASHBOARD_ACCEPTANCE_REPORT.md) for the
> verdict and its open items. **The dashboard changed no activation decision and did not start the
> agent** — the live config hash is identical before and after the whole verification walk.

---

## Documentation map

| Document | Purpose |
|---|---|
| [ENVIRONMENT_AUDIT.md](ENVIRONMENT_AUDIT.md) | Phase 1 hardware, OS, toolchain and protected-environment audit |
| [SOURCE_VERIFICATION.md](SOURCE_VERIFICATION.md) | Phase 2 repository identity, commit pin, source behaviour review |
| [INSTALLATION_REPORT.md](INSTALLATION_REPORT.md) | Phases 3–4: isolation layout, dependency install, build evidence |
| [AI_CONFIGURATION.md](AI_CONFIGURATION.md) | Phase 5: model/provider configuration, placeholders, protected providers |
| [AGENT_CONFIGURATION.md](AGENT_CONFIGURATION.md) | Phase 8: agent, heartbeat and skill configuration |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Phase 9: hardening design, audit evidence, residual risks |
| [WALLET_SECURITY.md](WALLET_SECURITY.md) | Phase 6: wallet policy, key handling, creation gate |
| [TREASURY_SECURITY.md](TREASURY_SECURITY.md) | Phase 7: treasury limits, what the code actually enforces |
| [MONITORING_GUIDE.md](MONITORING_GUIDE.md) | Phase 10: health checks, logs, audit cadence |
| [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) | Phase 11: verified backup, restore and rotation procedure |
| [WINDOWS_OPERATIONS_GUIDE.md](WINDOWS_OPERATIONS_GUIDE.md) | Phase 13: the seven `.bat` wrappers and manual operation |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Known failure modes, including the ACL incident and the (now root-caused and fixed) suite hang |
| [FINAL_ACCEPTANCE_REPORT.md](FINAL_ACCEPTANCE_REPORT.md) | Phase 14: acceptance matrix, blockers, final classification |
| [PHASE_15_OVERVIEW.md](PHASE_15_OVERVIEW.md) | Phase 15: status B verdict, residual risks R-1…R-10 (see also the Phase 16 section below) |
| [PHASE_16_OVERVIEW.md](PHASE_16_OVERVIEW.md) | **Phase 16: read first.** Status B, what closure actually proved, R-1…R-23, operator decisions pending |
| [PHASE_16_ACCEPTANCE_REPORT.md](PHASE_16_ACCEPTANCE_REPORT.md) | Phase 16: requirement-by-requirement acceptance, blocked items, disclosed failures |
| [DASHBOARD_USER_GUIDE.md](DASHBOARD_USER_GUIDE.md) | **Phase 17: how to operate the console.** Start/stop, token unlock, verdict labels, the twelve areas, the three actions |
| [DASHBOARD_API.md](DASHBOARD_API.md) | Phase 17: endpoints, gates, response envelopes, the two-stage restore contract, CSP |
| [DASHBOARD_SECURITY.md](DASHBOARD_SECURITY.md) | Phase 17: threat model (including what it does **not** defend), read-only construction, loopback proof, known limitations |
| [DASHBOARD_OPERATIONS.md](DASHBOARD_OPERATIONS.md) | Phase 17: layout, dependencies, build/verify commands, launchers, failure modes, test inventory |

### Phase 15 — security remediation

Start with the overview; it carries the phase verdict and the residual-risk register.

| Document | Purpose |
|---|---|
| [PHASE_15_OVERVIEW.md](PHASE_15_OVERVIEW.md) | **Read first.** Status B verdict, gap closure by id, residual risks R-1…R-10, what was not touched |
| [PHASE_15_WALLET_ENCRYPTION.md](PHASE_15_WALLET_ENCRYPTION.md) | 15B: AES-256-GCM/scrypt envelope, passphrase sources, migration runbook |
| [PHASE_15_TREASURY_ENFORCEMENT.md](PHASE_15_TREASURY_ENFORCEMENT.md) | 15C: the 13-step authorization order, fail-closed table, forensic queries, how to change a limit |
| [PHASE_15_TOOL_PERMISSIONS.md](PHASE_15_TOOL_PERMISSIONS.md) | 15D: 11 capability classes, default deny, safe allowlisting, revocation, bounds |
| [PHASE_15_SANDBOX.md](PHASE_15_SANDBOX.md) | 15E: confinement, protected locations, shell deny list, environment scrubbing, and what it does not do |
| [PHASE_15_SELF_HEALING.md](PHASE_15_SELF_HEALING.md) | 15F: eight health checks, three repair classes, the three execution gates, opt-in |
| [PHASE_15_INCIDENT_RESPONSE.md](PHASE_15_INCIDENT_RESPONSE.md) | 15G: severity model, tamper detection, emergency-stop runbook, response playbook |
| [PHASE_15_WINDOWS_SECURITY.md](PHASE_15_WINDOWS_SECURITY.md) | 15H: host posture, what is UNVERIFIED from an unprivileged session, LAN exposure |
| [PHASE_15_PENETRATION_TESTING.md](PHASE_15_PENETRATION_TESTING.md) | 15I: seven attack classes, findings F1–F8, how to re-run and when you must |
| [PHASE_15_SOAK_TESTING.md](PHASE_15_SOAK_TESTING.md) | 15J: bounded soak, ten verdicts, and the seven things it cannot cover |
| [PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md) | 15K: what a restore actually proves here, the thin-archive limit, the `HOME` trap |

Executed evidence for every claim above is in
[`../reports/PHASE_15_PROGRESS.md`](../reports/PHASE_15_PROGRESS.md) and the
`reports/PHASE_15_*.md` / `*_RAW.*` files it links.

Machine-readable evidence lives in [`../reports/`](../reports):

- `health-latest.json` — latest `HEALTH_CHECK.bat` output
- `security-audit-latest.json` — latest `SECURITY_AUDIT.bat` output
- `ENVIRONMENT_AUDIT.md`, `SOURCE_VERIFICATION.md` — copies of the phase reports

Backups live in [`../backups/`](../backups) with a SHA-256 manifest per run.

---

## Phase 16 — final security closure

> **Read [`PHASE_16_OVERVIEW.md`](PHASE_16_OVERVIEW.md) before anything else in this section.**
> It carries the status **B** verdict and the R-1…R-23 register — the list of what is still not
> proved. [`PHASE_16_ACCEPTANCE_REPORT.md`](PHASE_16_ACCEPTANCE_REPORT.md) is the requirement-by-
> requirement matrix, including the blocked items and my own retracted claims.

| Document | Purpose |
|---|---|
| [PHASE_16_OVERVIEW.md](PHASE_16_OVERVIEW.md) | **Read first.** Status B, what changed, the four findings reading code could not produce, isolation tier honesty, open risks, operator decisions pending |
| [PHASE_16_ACCEPTANCE_REPORT.md](PHASE_16_ACCEPTANCE_REPORT.md) | Acceptance matrix per §, §31 deliverables A–J, blocked items with verbatim blockers, disclosed failures |

| Evidence (`../reports/`) | Contents |
|---|---|
| `PHASE_16_GAP_ANALYSIS.md` | Register **R-1…R-23**, each with status and evidence |
| `PHASE_16_CODE_SECURITY.md` | Code-level findings, fixes and probe output |
| `PHASE_16_PROGRESS.md` | Continuous checkpoint log: commands, hashes, timings, retractions |
| `PHASE_16_ISOLATION_EVALUATION.md` | 8 OS-isolation options against the measured token state; what Home SL makes impossible |
| `PHASE_16_WINDOWS_VERIFICATION.md` + `PHASE_16_WINDOWS_POSTURE_RAW.txt` | Read-only host verification; 10 VERIFIED, 5 UNVERIFIED-BLOCKED, elevated command block prepared |
| `PHASE_16_BACKUP_RESTORE.md` + `PHASE_16_16C_EVIDENCE.json` | Real-file backup/restore drill; `REAL_DATA_RESTORE = NOT YET PROVABLE` |
| `PHASE_16_LIVE_MODEL_TESTING.md` + `PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt` | 18-check gate, four-tier run, `PENDING CREDENTIAL APPROVAL` |
| `PHASE_16_REGRESSION_RESULTS.md` + `PHASE_16_16E_FULL_RUN_FINAL.json` | 2057 passed / 0 failed / 0 skipped, 5 blocked, 4 not applicable; **R-23** and its closure |
| `PHASE_16_DATASOURCE_INVENTORY.md` | The verified data sources Phase 17's dashboard must read |

Two things Phase 16 established that are easy to get wrong and expensive to learn later:

- **Verified source is not the verified artifact.** `START_CONWAY.bat` runs `dist\index.js`; for most
  of the phase `dist/` predated every security change (**R-23**). If you change `src/`, rebuild.
- **An archive of a live SQLite database legitimately hashes differently** from the live file while
  its content is identical. Compare `integrity_check` and rows, never live-vs-backup hashes.

---

## Phase 17 — AI Command Center dashboard

A local, operator-only console that reads the real Conway state. **Starting it does not start the
agent, and nothing in it can start the agent.** It binds `127.0.0.1:8787` only, refuses to boot on
any other host, and opens the live database through a read-only SQLite handle.

Start with `START_CONWAY_DASHBOARD.bat`; the page asks for the operator token held in
`dashboard\state\dashboard.token` (never printed by the server, never copied into a URL).

| Document | Purpose |
|---|---|
| [DASHBOARD_USER_GUIDE.md](DASHBOARD_USER_GUIDE.md) | **Read first.** Start/stop, the token unlock, the five verdict labels, the twelve areas and what each will not claim, the three actions |
| [DASHBOARD_API.md](DASHBOARD_API.md) | Every endpoint, the auth/CSRF/rate-limit gates, response envelopes, the two-stage restore contract, the real CSP |
| [DASHBOARD_SECURITY.md](DASHBOARD_SECURITY.md) | Threat model with explicit **No** rows, read-only-by-construction, HOME isolation, the loopback proof and its canary control, 7 known limitations |
| [DASHBOARD_OPERATIONS.md](DASHBOARD_OPERATIONS.md) | Layout, dependency split, build/verify commands, ports, the four launchers, failure modes, the HOME rule, test inventory |

| Evidence (`../reports/`) | Contents |
|---|---|
| `DASHBOARD_IMPLEMENTATION_REPORT.md` | What was built: 12 areas, 4 613 source lines, data flow, runtime/dependency choices, what was changed outside `dashboard/` |
| `DASHBOARD_SECURITY_REPORT.md` | §25 control-by-control, with the executed evidence for each; the danger list the console never touches |
| `DASHBOARD_TEST_RESULTS.md` | **10 files / 97 tests / 0 failed** (the count the report itself records; re-executed 2026-11-01T18:28 local during the Phase 19 baseline — an earlier revision of this row said 9/93 and was wrong), what each suite defends, non-vacuity proofs, the ten defects and their real causes, checks that could not run |
| `DASHBOARD_ACCEPTANCE_REPORT.md` | Requirement-by-requirement matrix, §31 deliverables A–J, verbatim blockers, disclosed self-corrections, activation posture at sign-off |
| `PHASE_17_PROGRESS.md` | Timestamped log: commands, hashes, timings, and the claims that were retracted |
| `../dashboard/diagnostics/PHASE_17_ROOT_SUITE.log` | Conway root suite re-run after the dashboard: **82 files / 2057 tests / 0 failed** — the same count Phase 16E closed with |

Two results worth internalising before you trust anything on screen:

- **The console is honest about being empty.** A cell can only be `VERIFIED` if it has a real value
  and a named source; `UNKNOWN` under a green badge is a bug the test suite forbids. Four tables
  (`security_events`, `security_incidents`, `security_seals`, `treasury_authorizations`) are absent
  from the live database, so the Security and Treasury panels show `NOT VERIFIED` — which is the
  correct reading, not a malfunction.
- **Six of the ten defects found were in code written during this phase, and none was caught by
  reading the code.** The restore step that wrote a different directory than the one the operator had
  confirmed, and the stop script that reported a successful kill as a survival, were both found by
  reading executed output. Verify by running, not by reviewing.

**Gap 19 of the Phase 16 datasource inventory is closed:** the dashboard imports Conway's `src/**`
through `tsx` rather than the stale `dist/`, and the root `dist/` was rebuilt during Phase 16E, so no
console value can silently come from pre-security semantics.

---

## Phase 18 — post-Phase-17 read-only audit

An audit, not a change. Nothing was migrated, gated, funded, scheduled, committed or enabled; the live
`automaton.json` hash and `state.db` mtime were re-measured before and after and are identical.

| Evidence (`../reports/`) | Contents |
|---|---|
| `PHASE_18_AUDIT.md` | **Read first.** Verdict, the executed command table, the database/security/accuracy/self-healing findings, GO / NO-GO, §10 amendment |
| `PHASE_18_MIGRATION_READINESS.md` | V12/V13 DDL, compatibility, ordering, the absence of any rollback, the runner defects, readiness-by-criterion, the operator procedure (not executed) |
| `PHASE_18_SECURITY_FINDINGS.md` | **F-18-01 … F-18-14** with severity, evidence, containment and the controls verified working |
| `PHASE_18_REMEDIATION_PLAN.md` | Tiered, ordered remediation with a verification requirement per item, and the read-only Windows commands prepared for an operator |
| `PHASE_18_APPROVAL_LIST.md` | The explicit human decision surface: A1–A12, B1–B5, mapped to the §29 prohibitions, with a blank approval record |
| `PHASE_18_PROGRESS.md` | Persistent progress: deliverable hashes, live-state preservation proof, task ledger, carried-forward unverified items |

Headline: **NO-GO for agent activation**, **GO for the dashboard**, **conditional GO for V12/V13**. The
dashboard's UNKNOWN / CRITICAL / NOT VERIFIED findings are almost all correct renderings of an empty,
unactivated install — proved by a census showing 38 of 39 tables hold zero rows — with five genuine
display defects. The runtime, not the console, is where missing data gets reported as success: an absent
`security_events` table makes the emergency stop report "not engaged"
([`src/security/emergency-stop.ts:89`](../src/security/emergency-stop.ts)).

Three claims in the older docs were **weaker than the audit's evidence** (Phase 19 A1 status, 2026-11-01):

- `WINDOWS_OPERATIONS_GUIDE.md` called `node dist/index.js --status` a "read-only snapshot". It opens a
  read-write handle and migrates the schema; `--pick-model` and `--configure` do too, and none of the
  three is activation-gated (**F-18-01**, **F-18-13**). **Corrected** in that guide's new §3.1/§3.2.
  The correction describes today's behaviour — the code itself is **A3**/**A4**, still unapproved.
- The isolation table below said `runtime/home/.automaton/` was "ACL-restricted to the current Windows
  user". That ACL has never been read by an unprivileged session — `icacls` needs elevation
  (**F-18-14**, Phase 16 **R-15**). **Corrected** above to `NOT VERIFIED` with the evidence boundary.
- The Phase 17 evidence row said 9 files / 93 tests. The measured figure is **10 files / 97 tests / 0
  failed**, with the Conway root suite at 82 files / 2 057 tests / 0 failed. **Corrected** above, and
  re-executed during the Phase 19 baseline rather than inherited.

---

## Quick start (after you decide to activate)

1. Read [`WALLET_SECURITY.md`](WALLET_SECURITY.md) and [`TREASURY_SECURITY.md`](TREASURY_SECURITY.md).
2. Decide the model provider. The default config has **no credentials**; see [`AI_CONFIGURATION.md`](AI_CONFIGURATION.md).
3. Edit `runtime/home/.automaton/automaton.json`. There is **no supported way to activate from the UI alone** — activation requires both:
   - `"security": { "activationApproved": true, ... }` in the config file, and
   - the environment variable `CONWAY_ACTIVATION=APPROVED` for the process.
4. Wallet creation additionally requires the `CONWAY_ALLOW_WALLET_CREATION=APPROVED` gate, which `START_CONWAY.bat` sets only after you type `CREATE-WALLET`.
5. Run `START_CONWAY.bat`, then `HEALTH_CHECK.bat` and `SECURITY_AUDIT.bat`.

**Do not** set `activationApproved: true` until you have read the treasury
enforcement table in [`TREASURY_SECURITY.md`](TREASURY_SECURITY.md). Some upstream
limits are advisory, not enforced.

---

## Isolation summary

| Resource | Location | Scope |
|---|---|---|
| Node.js runtime | `runtime/node-v22.23.4-win-x64/` | project-local, not installed system-wide |
| `HOME` for the runtime | `runtime/home/` | overrides only the child process `HOME` |
| pnpm store / corepack | `runtime/pnpm-store/`, `runtime/corepack/` | project-local |
| Config + DB + wallet | `runtime/home/.automaton/` | project-local; **NTFS ACL NOT VERIFIED** — see the note below |
| Logs | `logs/` | project-local |
| Backups | `backups/` | project-local; same ACL caveat |
| Launchers | `*.bat` in the project root | no startup entries, no services |

**On the ACL column (corrected in Phase 19 A1; Phase 18 F-18-14).** Earlier rows here asserted the
state tree was "ACL-restricted to the current Windows user". That is not a claim this installation
can currently support. What is verified: `saveConfig` requests mode `0o600` for the config file and
`0o700` for its directory ([src/config.ts:183-196](../src/config.ts)), and the tree is project-local.
What is **not** verified: the effective NTFS ACL. Reading it needs `icacls`, which requires elevation,
so the Phase 16 **R-15** item remains UNVERIFIED and is approval item **B1**. `docs/SECURITY_AUDIT.md`
§2.5 preserves an earlier single-user `FullControl` reading, but Phase 18 did not re-read it, so it is
historical rather than current evidence. Two traps worth knowing before you re-derive this: the live
`automaton.json` reports mode `666`, and **that proves nothing** — libuv synthesises Windows file
modes from the read-only attribute, so `666` is not a world-writable ACL any more than `600` is a
private one. Config credentials are stored as plaintext JSON fields (Phase 15B encrypted the wallet,
not the config), which is exactly why the unverified ACL matters; all three credential fields measure
zero-length strings today, and no credential may be entered without approval.

No system environment variable, Windows service, scheduled task, firewall rule,
Defender setting, Ollama model, FreeLLMAPI instance, or existing Qoder/OpenCode/MCP
configuration was modified.
