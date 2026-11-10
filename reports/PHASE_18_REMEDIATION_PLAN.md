# Phase 18 — Prioritized Remediation Plan

Purpose: turn the 14 findings in
[`PHASE_18_SECURITY_FINDINGS.md`](PHASE_18_SECURITY_FINDINGS.md) into an ordered, verifiable sequence of
changes, and make explicit which changes must land before agent activation and which must not.

**This plan has not been executed.** Phase 18 was a read-only audit; nothing below was implemented,
applied, committed, scheduled or enabled. Every item needs the approval recorded in
[`PHASE_18_APPROVAL_LIST.md`](PHASE_18_APPROVAL_LIST.md) before work starts.

---

## 1. Sequencing rules

1. **Code fixes before schema application.** V12/V13 are the migration runner's first real use on this
   file, and the runner is the thing that can record a failed migration as applied (F-18-02). Fixing the
   runner costs nothing in live state; applying the schema through a broken runner is irreversible.
2. **Local, reversible, testable first.** Tier 0/1 items touch files under version control in spirit and
   can be reverted by editing them again. The schema apply (Tier 1 step 5) cannot.
3. **One change, one fresh measurement.** No item is "done" when the edit is written; it is done when the
   listed verification output is captured. Consistent with the standing rule that a risk is never marked
   resolved without a new verification result.
4. **Never bundle an approval with an activation.** Items marked "gate-neutral" must be approved and
   verified while `activationApproved=false`. If a single change request mixes "fix the runner" with
   "turn the runtime on", the audit trail can no longer say which was reviewed.
5. **Back up before anything that can't be undone** — and verify the backup after taking it, not before
   relying on it.

## 2. Tier 0 — no approval needed (this session could have done these; it chose not to)

Nothing in Tier 0 changes behavior. These are documentation and hygiene, listed so the tier below stays
short and every remaining item is genuinely a decision.

| # | Action | Finding | Verification |
|---|---|---|---|
| 0.1 | Correct the operator documentation: [docs/WINDOWS_OPERATIONS_GUIDE.md:62](file:///<repo-root>/docs/WINDOWS_OPERATIONS_GUIDE.md#L62) currently presents `node dist/index.js --status` as a **"read-only snapshot, exit 0"**, and `:102` repeats the command. It opens a read-write handle and migrates. The wording must say so until item 2 lands, then change back when the behavior does | F-18-01 | The `# read-only snapshot` comment no longer appears next to `--status` in that file; a warning line naming `--pick-model` and `--configure` as the other ungated write paths is present |
| 0.2 | Record that `netstat -an -p tcp` does not list the live 8787 listener on this machine, so exposure must be proved by a positive connect probe | F-18-12 (interpretation) | The note appears in `docs/DASHBOARD_OPERATIONS.md` next to the port section |
| 0.3 | Align two further doc claims with the evidence in [docs/README.md](file:///<repo-root>/docs/README.md): the isolation table's "ACL-restricted to the current Windows user" (never read — F-18-14 / R-15) and the Phase 17 row's "9 files / 93 tests" (measured 10 files / 97 tests / 0 failed) | F-18-14, doc drift | Neither sentence remains as an unqualified claim; the test count matches an executed run |

## 3. Tier 1 — before activation, in this order

### 1. Fix the migration runner's error handling (F-18-02) — **highest priority**

**Change.** Replace the unbounded `catch` at
[src/state/database.ts:625-629](file:///<repo-root>/src/state/database.ts#L625)
with a catch that re-throws anything whose message is not `duplicate column name`, and give
`MIGRATION_V10` its missing `IF NOT EXISTS`
([src/state/schema.ts:665](file:///<repo-root>/src/state/schema.ts#L665), F-18-11).
Reconsider the `INSERT OR REPLACE` fallback at
[database.ts:110-118](file:///<repo-root>/src/state/database.ts#L110): the version row
should be asserted against the schema (do the tables exist?), not stamped from `MAX(version)`.

**Why first.** It is the only item whose defect can silently corrupt the *record* of every later item.

**Verification (must be captured, not asserted).** New tests, executed:
`applyMigrations` (a) applies V12/V13 to a V11 fixture and the four tables plus all seven triggers exist;
(b) when `apply()` throws a non-duplicate-column error, **no** `schema_version` row is written and the
next boot retries; (c) re-running V11 on a database that already has `chain_type` succeeds without
masking other errors; (d) the fallback does not stamp 13 when `security_events` is absent. Then the full
root suite re-run (baseline this audit: 82 files / 2 057 tests / 0 failed / 88.52 s).

**Approval.** Code change to a security-relevant module → yes.

### 2. Gate the ungated mutating CLI paths (F-18-01, F-18-13)

**Change.** Split "open for reading" from "open and migrate": `--status` should use a read-only handle
(the dashboard already has a working pattern in [dashboard/server/sources.ts:39](file:///<repo-root>/dashboard/server/sources.ts#L39)),
and schema application should move behind an explicit, named command that requires approval. Add
`requireActivation` to `--configure` and `--pick-model`
([src/index.ts:166,172](file:///<repo-root>/src/index.ts#L166)), or — if activation is
genuinely the wrong gate for a setup tool — make the credential/treasury/`maxChildren`/endpoint prompts
require their own explicit confirmation, so that §29 items 6/9/10/11 cannot be satisfied through a
command that never asks.

**Why before activation.** After activation this distinction disappears; the whole point of the gate is
that it is the last human checkpoint.

**Verification.** Bypass tests (the pattern Phase 16 A.1 established): invoking `--status` against a V11
copy leaves `MAX(version)` at 11 and the file mtime unchanged; `--configure` and `--pick-model` exit 2 with
`activationApproved=false`; a test asserts the exit code rather than the log text.

**Approval.** Yes — changes operator-visible CLI behavior.

### 3. Make the audit chain honest about being absent (F-18-03)

**Change.**
- [src/security/emergency-stop.ts:89](file:///<repo-root>/src/security/emergency-stop.ts#L89):
  `if (!hasEvents) return false;` → return `true`. A missing tamper-evident trail must not be read as
  "nothing is stopped". This is the fail-open branch the live V11 database takes, and it is the one
  control where the deliberate path is weaker than the accidental one (`catch` already returns `true` at
  `:98`).
- [src/security/audit-chain.ts:165-185](file:///<repo-root>/src/security/audit-chain.ts#L165):
  a dropped append becomes a hard failure for HIGH/CRITICAL events; LOW/MAY stay best-effort but must
  return a distinguishable result instead of `null`.
- [src/security/tool-authorizer.ts:191](file:///<repo-root>/src/security/tool-authorizer.ts#L191):
  `decide()` must not silently proceed when the durable record of the decision could not be written.
- [src/reliability/mechanic.ts:244](file:///<repo-root>/src/reliability/mechanic.ts#L244):
  route the seal append through `runRepair` so it passes `classifyRepair` and the `confirm` hook
  (F-18-10).

**Why before activation.** With `allowedTools=[]` today, the authorizer records nothing worth having. The
first granted tool turns this into an accountability hole.

**Verification.** Unit tests on a table-less database: `isEmergencyStopEngagedInDb` returns `true`;
`tryAppendSecurityEvent` for a CRITICAL event throws rather than returning `null`; the authorizer's deny
path still denies and still surfaces the write failure. Dashboard suite stays green (baseline 10 files /
97 tests / 0 failed).

**Approval.** Yes — this is a security control change, and it makes the system *stricter*, which is
exactly the kind of change that must not be slipped in unreviewed.

### 4. Put the security layer under version control (F-18-08)

**Change.** Commit `src/security/**`, `src/runtime/**`, `config/`, the 11 `.bat` wrappers and
`dashboard/` after review; tag the result. HEAD is `d8f8168` (2026-08-26, message "it's beautiful") with
40 modified + 35 untracked paths.

**Why before activation.** "The code enforces the gates" is only auditable if the code has a baseline.
Without it there is no diff to review, no rollback target, and no way to prove the gate code was not
changed between phases.

**Verification.** `git ls-files src/security src/runtime` non-empty; `git status --porcelain` shows no
untracked source; a tag exists; `git log` records per-path review. **Precondition:** a secret scan of the
staged set first — `automaton.json` lives under `runtime/home`, which must stay untracked; nothing with a
credential may enter the index. The audit measured the three credential fields as empty strings, so today
there is nothing to leak, but the scan must be re-run at commit time, not assumed from this audit.

**Approval.** Yes — shared-state change (git history), and it is the first item that leaves the local
working tree.

### 5. Apply V12 and V13 — deliberately, with a verified backup (F-18-01/F-18-03/F-18-04 all resolve here)

**Only after items 1–4.** The full technical assessment is in
[`PHASE_18_MIGRATION_READINESS.md`](PHASE_18_MIGRATION_READINESS.md) §6; condensed:

1. `BACKUP_CONWAY.bat`, then re-hash the archive against its own manifest and confirm every entry matches
   before treating it as the rollback. (Rollback is restore-only — no down-migration exists.)
2. Assert `process.env.HOME === "<repo-root>\runtime\home"` **in the process that
   opens the database**, not in a shell that hopes to pass it down.
3. Open through the migration path with activation **still false**. Applying a schema does not require
   `CONWAY_ACTIVATION` and must not be used as a reason to set it.
4. Verify read-only: four tables present; **all seven append-only triggers** present; `integrity_check` =
   `ok`; `MAX(version)` = 13; `children.chain_type` still present.
5. Check that row 13's `applied_at` is the real apply time. If it was written by the `INSERT OR REPLACE`
   fallback instead of the transactional loop, **F-18-02 fired** — stop and re-examine rather than trust
   the green.
6. Expect, then confirm: `audit_chain pass`, `schema_version pass`, the four NOT VERIFIED cells on the
   Security and Treasury panels become real readings, `getTreasuryGuard()` stops throwing.

**Status of that expectation.** It is an inference from the code paths, **not a tested prediction** — the
readiness report says so explicitly, and this plan does not upgrade it.

**Approval.** Yes, and this is the single most consequential approval in the plan: it is irreversible
except by restore.

### 6. Fix the five dashboard display defects (F-18-05, F-18-06, F-18-07)

**Changes.**
- [dashboard/server/panels/ops.ts:154-155](file:///<repo-root>/dashboard/server/panels/ops.ts#L154):
  compare host against host (split the port off) and required `"disabled"` against the boolean
  rendering, so both rows can reach VERIFIED on a healthy system.
- Move the "no source yet" distinction into the guardian: a `not_verified` status rather than the console
  regex-matching another module's prose ([safety.ts:112](file:///<repo-root>/dashboard/server/panels/safety.ts#L112),
  F-18-06). Until then the headline says `degraded` when `ok` is honest.
- [ops.ts:32](file:///<repo-root>/dashboard/server/panels/ops.ts#L32) and
  [core.ts:211](file:///<repo-root>/dashboard/server/panels/core.ts#L211): a non-existent
  source is NOT VERIFIED, not EMPTY — per
  [types.ts:36-38](file:///<repo-root>/dashboard/server/panels/types.ts#L36).
  **The test that asserts the wrong value must change with the code**:
  [dashboard/tests/panel-verdicts.test.ts:149-152](file:///<repo-root>/dashboard/tests/panel-verdicts.test.ts#L149)
  asserts `expect(findCell(panels, "Soul / persona").value).toBe(false)` and
  `expect(findCell(panels, "Activity logs").verdict).toBe("EMPTY")` — leaving it would make the suite
  defend the bug.

**Verification.** Assert on the live board that the two gate rows read VERIFIED with the agent still
inactive; assert EMPTY appears only where the row census showed a real, counted zero; dashboard suite
green.

**Approval.** Yes (code), but gate-neutral — safe to do while everything stays off.

### 7. Schedule `health_guardian` and `security_monitor`, then observe one cycle

**Only after items 1–6.** Today neither task id appears in
`runtime/home/.automaton/heartbeat.yml` (six entries, three enabled: `heartbeat_ping`, `check_credits`,
`health_check`) and `heartbeat_schedule` has **0 rows**, gated on `row.enabled`
([src/heartbeat/scheduler.ts:126](file:///<repo-root>/src/heartbeat/scheduler.ts#L126)).
That is the only reason F-18-04's wake loop has not fired.

**Change.** Add the two entries, then run one supervised cycle and read
`last_health_report` / `last_security_scan` from the KV store before trusting `shouldWake`.

**Why last.** Scheduling a task whose failure mode is a permanent wake condition, on a schema whose
tables were just created by an untested runner, is how a control plane becomes a self-inflicted outage.

**Approval.** Yes — configuration change to a running system.

## 4. Tier 2 — before real money, before real credentials

| Finding | Action | Gate it unblocks |
|---|---|---|
| F-18-09 | Move the wallet-creation check from [runtime/bin/preflight.mjs:82-91](file:///<repo-root>/runtime/bin/preflight.mjs#L82) into `src/`, so the control is not only in a `.bat` wrapper. Today two real gates still hold (`requireActivation`, `WalletLockedError`) | §29 #4 |
| F-18-14 | Run the read-only `icacls` checks below, then decide whether config-field encryption is needed *before* any key is entered | §29 #6 |
| — | Sandbox claims: keep describing application-level restriction as application-level. Do not let the board imply OS-level isolation (Phase 16 A.3 / R-4) | §29 #14 |
| — | Add `@vitest/coverage-v8` and a browser E2E harness; the current suites are green but coverage is **unmeasured**, not "80%" | none |

## 5. Prepared read-only commands the audit could not run (§30: record the limitation, continue)

These are for a privileged operator. They are **read-only**; none retrieves, displays, copies or stores a
recovery key, and `manage-bde -protectors -get` remains prohibited by the mandate (§6).

```
icacls "<repo-root>\runtime\home" /save "%TEMP%\home-acl.txt" /tab
icacls "<repo-root>\runtime\home\.automaton"
Get-MpComputerStatus | Select AntivirusEnabled,RealTimeProtectionEnabled,AntispywareEnabled
Get-NetFirewallProfile | Select Name,Enabled
Get-BitLockerVolume -MountPoint "C:" | Select MountPoint,ProtectionStatus,VolumeStatus,EncryptionMethod
```

Expected evidence on completion: an ACL capture showing only the intended principals on the state tree,
and a BitLocker **protection status** (not key material). Until they exist, Phase 16's R-15 and this
audit's F-18-14 stay UNVERIFIED, and status A remains unavailable — the mandate says so directly: do not
claim status A while administrator verification is unverified.

## 6. Explicitly NOT in this plan

Nothing below appears in any tier, and no step above implies permission to do it:

1. Setting `activationApproved` to true, or `CONWAY_ACTIVATION=APPROVED`.
2. Setting `CONWAY_ALLOW_WALLET_CREATION=APPROVED` outside the launcher's own typed confirmation.
3. Creating or funding a wallet; any transaction; any x402 payment.
4. Entering real API credentials or purchasing credits.
5. Enabling financial tools, host shell, self-modification, replication, or external exposure.
6. Enabling `selfHealingEnabled` or running any repair.
7. Installing a Windows service or scheduled task for Conway.
8. Changing any Windows security setting, or touching BitLocker protector output.
9. Exposing the dashboard beyond `127.0.0.1`.
10. Editing `lockdown`, `allowedTools`, `maxChildren`, or the treasury limits to non-zero.

If a future step appears to require one of these, that is a signal the step is mis-specified — stop and
re-plan rather than approving it.

## 7. Effort and dependency summary

| Order | Item | Tier | Depends on | Est. | Blocking activation? |
|---|---|---|---|---|---|
| 1 | Runner error handling + V10 idempotency + tests | 1 | — | S | Yes |
| 2 | Gate `--status`/`--configure`/`--pick-model`; split read vs migrate | 1 | — | M | Yes |
| 3 | Fail-closed emergency stop + hard audit-append failure + seal via classifier | 1 | — | M | Yes |
| 4 | Version-control the security layer (after a secret scan) | 1 | 1–3 | S | Yes |
| 5 | Backup → verify → apply V12/V13 → verify read-only | 1 | 1–4 | S (procedure M) | Yes |
| 6 | Dashboard display defects + the test that asserts the bug | 1 | — | S | No |
| 7 | Schedule guardian + monitor, observe one supervised cycle | 1 | 1–6 | S | Yes |
| 0.1/0.2 | Documentation | 0 | — | XS | No |
| T2 | `icacls` verification, wallet gate in `src/`, coverage + E2E | 2 | 1–7 | M | No (blocks real money) |

Items 1, 2, 3 and 6 are mutually independent and could be reviewed in parallel; 4 must follow 1–3 so the
committed baseline contains the fixes; 5 must follow 4; 7 must follow 5.
