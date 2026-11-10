# Phase 18 — Changes Requiring Human Approval

Every line here is a change that **was not made**. Phase 18 was read-only: no migration executed, no gate
changed, no credential entered, no wallet created, no service installed, no Windows setting touched, no
repair run, nothing pushed.

Read this list as the decision surface. The findings behind it are in
[`PHASE_18_SECURITY_FINDINGS.md`](PHASE_18_SECURITY_FINDINGS.md); the sequence is in
[`PHASE_18_REMEDIATION_PLAN.md`](PHASE_18_REMEDIATION_PLAN.md).

---

## 1. How to read the columns

| Column | Meaning |
|---|---|
| **§29 item** | Which of the fourteen prohibited-without-approval actions the change touches. `—` means it touches none. |
| **Reversible** | Can the change be undone without a restore? Irreversible items deserve more scrutiny, not less. |
| **Audit recommendation** | What the evidence supports recommending — **not** an approval. The gate is a human. |
| **Blocks activation** | Whether agent activation should stay refused until this is closed. |

## 2. Approve-first list (pre-activation, in this order)

| # | Change | Files | §29 item | Reversible | Blocks activation | Audit recommendation |
|---|---|---|---|---|---|---|
| **A1** | Correct the docs that call `--status` a "read-only snapshot, exit 0"; and align two other doc claims that exceed the evidence — the isolation table's "ACL-restricted to the current Windows user" (never read; F-18-14) and the Phase 17 test count (9/93 in the docs, 10/97 measured) | [docs/WINDOWS_OPERATIONS_GUIDE.md:62,102](file:///<repo-root>/docs/WINDOWS_OPERATIONS_GUIDE.md#L62), [docs/README.md](file:///<repo-root>/docs/README.md) | — | Yes | No (reduces accident risk immediately) | **No approval required — documentation only.** Listed so it is not lost; it is Tier 0 items 0.1/0.3 in the remediation plan. The audit did not do it because its own mandate was read-only |
| **A2** | Bounded catch in the V11 migration; `IF NOT EXISTS` on V10; version row asserted against schema, not stamped from `MAX(version)`; four new tests | [src/state/database.ts:625-629,110-118](file:///<repo-root>/src/state/database.ts#L625), [src/state/schema.ts:665](file:///<repo-root>/src/state/schema.ts#L665) | — | Yes | **Yes** | **Approve** |
| **A3** | Split read-open from migrate-open; `--status` read-only; migrations behind an explicit approved command | [src/index.ts:154,199](file:///<repo-root>/src/index.ts#L154), [src/state/database.ts:101-118](file:///<repo-root>/src/state/database.ts#L101) | — (removes an unapproved path *to* a change) | Yes | **Yes** | **Approve** |
| **A4** | Add `requireActivation` to `--configure` and `--pick-model`, or per-field confirmation for credential / treasury / `maxChildren` / endpoint prompts | [src/index.ts:166,172](file:///<repo-root>/src/index.ts#L166), [src/setup/configure.ts:206-208,245-257,278-284,304-306](file:///<repo-root>/src/setup/configure.ts#L206), [src/setup/model-picker.ts:76-80](file:///<repo-root>/src/setup/model-picker.ts#L76) | **6, 9, 10, 11** | Yes | **Yes** | **Approve** — this is the gate the mandate intends, currently bypassable by a human with no checkpoint |
| **A5** | `isEmergencyStopEngagedInDb` fails **closed** on an absent `security_events` table | [src/security/emergency-stop.ts:89](file:///<repo-root>/src/security/emergency-stop.ts#L89) | 14 (autonomy safety) | Yes | **Yes** | **Approve** — makes the system stricter; review the consequence: on a pre-V12 database the runtime will treat the stop as engaged |
| **A6** | Dropped audit append = hard failure for HIGH/CRITICAL; `tool-authorizer.decide()` surfaces write failure; seal append routed through `runRepair`/`classifyRepair` | [src/security/audit-chain.ts:165-185](file:///<repo-root>/src/security/audit-chain.ts#L165), [src/security/tool-authorizer.ts:191](file:///<repo-root>/src/security/tool-authorizer.ts#L191), [src/reliability/mechanic.ts:244](file:///<repo-root>/src/reliability/mechanic.ts#L244) | 14 | Yes | **Yes** | **Approve** |
| **A7** | Commit `src/security/**`, `src/runtime/**`, `config/`, the 11 `.bat` wrappers, `dashboard/`; then tag | git index (currently HEAD `d8f8168`, 40 M + 35 ??) | — | Yes (before push) | **Yes** | **Approve the commit; do NOT approve a push** without separate consent |
| **A8** | Secret scan of the exact staged set, immediately before A7 | staged blob list | — | n/a | precondition to A7 | **Approve** — `runtime/home/` must stay untracked; measured credential fields are empty strings today, re-verify at commit time |
| **A9** | **Apply V12 + V13 to the live database**, after a verified backup | `runtime/home/.automaton/state.db` (+ `schema_version`) | — (**not** an activation change: activation stays false) | **No** — restore-only | **Yes** | **Approve conditionally**: only after A2/A3, only with a re-hashed backup, only with activation still false |
| **A10** | Verify post-apply read-only: 4 tables, 7 append-only triggers, `integrity_check ok`, `MAX(version)=13`, `chain_type` intact, row-13 `applied_at` genuine | read-only handles | — | n/a | part of A9 | **Approve** |
| **A11** | Dashboard display fixes: satisfiable gate rows, guardian `not_verified` status instead of console regex, EMPTY→NOT VERIFIED for absent sources, and updating the tests that assert the current wrong values | [ops.ts:32,141-155](file:///<repo-root>/dashboard/server/panels/ops.ts#L32), [safety.ts:112](file:///<repo-root>/dashboard/server/panels/safety.ts#L112), [core.ts:79-80,211](file:///<repo-root>/dashboard/server/panels/core.ts#L79), [health-guardian.ts:172-213](file:///<repo-root>/src/reliability/health-guardian.ts#L172), [panel-verdicts.test.ts:149-152](file:///<repo-root>/dashboard/tests/panel-verdicts.test.ts#L149) | — | Yes | No | **Approve** |
| **A12** | Schedule `health_guardian` and `security_monitor`, then observe one supervised cycle before trusting `shouldWake` | `runtime/home/.automaton/heartbeat.yml` + `heartbeat_schedule` | 14 (unattended execution) | Yes | **Yes** | **Defer**: approve only after A5/A6/A9/A10 are verified. Scheduling today would arm a wake loop whose condition is currently unsatisfiable |

## 3. Approve-later list (blocks real money / real credentials, not activation)

| # | Change | Files | §29 item | Recommendation |
|---|---|---|---|---|
| **B1** | Administrator-run read-only Windows verification (`icacls` on the state tree, Defender / firewall profile / BitLocker **protection status** only) | host, read-only | — | **Approve as a read-only check.** Never `manage-bde -protectors -get`; no key material in scope |
| **B2** | Decide whether config-file credential fields need encryption **before** any key is entered | [src/config.ts:180-197](file:///<repo-root>/src/config.ts#L180) | 6 | **Approve the assessment**; the entry itself is a separate later decision |
| **B3** | Move the wallet-creation gate from the launcher into `src/` | [runtime/bin/preflight.mjs:82-91](file:///<repo-root>/runtime/bin/preflight.mjs#L82) | 4 | **Approve** — defense in depth, no behavior change for the current (inactive) system |
| **B4** | Add coverage tooling and a browser E2E harness | `package.json` devDeps | — | **Approve** — coverage is currently *unmeasured*, and "2 057 tests pass" is not "80% covered" |
| **B5** | Real-data backup/restore proof (needs genuine data to exist first) | — | — | **Cannot be approved meaningfully yet**; stays `NOT YET PROVABLE` |

## 4. Explicitly NOT on any approval list — refuse as bundled or implied

The mandate's fourteen prohibitions stay prohibited. An approval for anything in §2 or §3 does **not**
authorize any of these, and none of them is a prerequisite for anything above:

| §29 | Prohibition | Status measured in this audit |
|---|---|---|
| 1 | `activationApproved = true` | **false** — unchanged |
| 2 | `CONWAY_ACTIVATION=APPROVED` | not set |
| 3 | `CONWAY_ALLOW_WALLET_CREATION=APPROVED` | not set (launcher only) |
| 4 | Create a real wallet | **no `wallet.json`** |
| 5 | Fund a wallet | no wallet to fund |
| 6 | Enter real API credentials | three fields present as **zero-length strings** |
| 7 | Purchase AI credits | not attempted |
| 8 | Execute blockchain transactions | none |
| 9 | Enable financial tools | `allowFinancialTools=false`, every treasury limit **0** |
| 10 | Enable replication | `allowReplication=false`, `maxChildren=0` |
| 11 | Enable public network exposure | `allowExternalExposure=false`; dashboard bound to `127.0.0.1`; Wi-Fi-interface probe **refused** |
| 12 | Install permanent Windows services | no service, no scheduled task matching conway/automaton |
| 13 | Change Windows security settings | none read beyond non-privileged queries; none changed |
| 14 | Enable unrestricted autonomous execution | `lockdown=true`, `allowedTools=[]`, `selfHealingEnabled` absent (effective false) |

**Two invariants to hold explicitly while approving §2:** `selfHealingEnabled` must not be set to true as
a side effect of "fixing the health panel", and `allowedTools` must stay `[]` while the audit chain is
being repaired — A6 is precisely what makes a non-empty `allowedTools` meaningful later.

## 5. Decision framing the audit cannot make for you

1. **A5 changes safety semantics.** Failing closed means an absent tamper-evident trail is treated as
   "the stop may be engaged". Measured blast radius: `isEmergencyStopActive` is consulted by the **agent
   tool path** ([src/agent/tools.ts:3437](file:///<repo-root>/src/agent/tools.ts#L3437)),
   by the heartbeat daemon
   ([src/heartbeat/daemon.ts:121,140](file:///<repo-root>/src/heartbeat/daemon.ts#L121)),
   by the health guardian ([src/reliability/health-guardian.ts:339](file:///<repo-root>/src/reliability/health-guardian.ts#L339))
   and by the mechanic ([src/reliability/mechanic.ts:144](file:///<repo-root>/src/reliability/mechanic.ts#L144)).
   On today's V11 database that makes the emergency stop **permanently engaged** until V12 lands — the
   agent would refuse tool execution and the daemon would idle. That is the correct posture for a system
   whose last-line control cannot be read; it is also a deliberate availability cost, so approve it
   knowing which commands stop working. If that ordering is unwanted, approve A5 + A9 together, in that
   order, and the window closes.
2. **A9 is the only irreversible item.** Its real rollback is the backup, which is why A9 is conditional
   on a re-hashed archive rather than on `BACKUP_CONWAY.bat` having exited 0.
3. **A4 could be met either way.** Gating `--configure` behind activation, or behind per-field
   confirmation, are different designs. The audit recommends per-field confirmation for credentials,
   treasury limits, `maxChildren` and endpoints, because a setup tool that requires activation cannot
   configure an inactive system — but that is a product decision, not an evidence conclusion.
4. **A12 arms a loop.** Its failure mode (F-18-04) is quiet self-waking rather than a loud error, so
   "observe one cycle" is the minimum, not a formality.
5. **Nothing above is sufficient for status A.** Administrator verification (B1) and real-data restore
   (B5) remain open, so per §10 the activation gates stay closed and no report in this project may claim
   status A while they are unverified.

## 6. Approval record

| # | Approved? (Y/N) | By | Date | Conditions / scope notes |
|---|---|---|---|---|
| A1 | | | | |
| A2 | | | | |
| A3 | | | | |
| A4 | | | | |
| A5 | | | | |
| A6 | | | | |
| A7 | | | | commit only — push needs separate consent |
| A8 | | | | |
| A9 | | | | **irreversible** — requires verified backup |
| A10 | | | | |
| A11 | | | | |
| A12 | | | | |
| B1 | | | | read-only only |
| B2 | | | | |
| B3 | | | | |
| B4 | | | | |
| B5 | | | | blocked pending real data |

Blank by design. This audit has no authority to fill it, and an entry here is not permission for any
§4 item.
