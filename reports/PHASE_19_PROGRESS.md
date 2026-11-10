# Phase 19 — Progress Log

Persistent, timestamped record of what was done, what was measured, and what is waiting.
All times UTC unless marked "local".

Current classification: **A1 complete; A2 and A3 approved, executed and verified; A4–A8 still BLOCKED
awaiting human approval.** Live V12/V13 migration (A9) is outside the phase and remains **not done**:
the live schema is still 11.
Phase 19 as a whole was **C — BLOCKED (awaiting approval)** until the operator answered the approval
question (recorded in `PHASE_19_APPROVAL_RECORD.md` §9; the answer's clock time was not captured in any
retained log, so none is asserted here); A2 and A3 are now executed with test evidence. The
classification is not "complete" — five of the seven approval-eligible items (A4–A8) never started.

---

## 1. Deliverables produced in this phase, and their state

| Deliverable (mandate §15) | State | SHA-256 | Size |
|---|---|---|---|
| `reports/PHASE_19_AUDIT.md` | **written** | `d5e7bf63dc73ce1da34c29b30249b2d81ee05b756f7a3b38088ade8293fb9755` | 16 870 B |
| `reports/PHASE_19_APPROVAL_RECORD.md` | **written — A2–A8 requests, now with the §9 approval answer and the post-approval scope disclosure** | at creation `06d5ed58c6085c2d0676d07ab171fe6ff15f16f4ac0c8f254b093777458e111d` (34 003 B) — **SUPERSEDED** by the §9 approval record → `1e126d4c4b9ce1874b68150f5d0e39a7e8fb6de67fa37757f3b1098d70bd6b27` (36 283 B) — **SUPERSEDED** by the "what A3 ended up covering" disclosure → current `dd2ce0dd6c6d0a53c931f46085bf7ab003f4c7648c3d43bc39ae193ff15237c3` | 37 705 B |
| `reports/PHASE_19_TEST_RESULTS.md` | **written — A–C, G–J now executed; D/E/F still awaiting A5/A6** | at creation `726afab6423e286698f2bc461939e1469d579602068a27398bad148c69b2eb83` (5 972 B) — **SUPERSEDED** by rows 21–34 plus §2/§3 → `1ef5a10b15dcc2a3be2f9f995c73acca042fc98816f2dbaa61e49fb400a36776` (12 004 B) — **SUPERSEDED** through this record-keeping pass (rows 35–36) → current `e86319005b14dddd2e16fd4948b89e1e919102d90926ae4e241cedccdc81f3fc` | 13 770 B |
| `reports/PHASE_19_GIT_CHANGE_CONTROL.md` | **written** | `41f7a45df27c93eb3ec15c148c82838101bb74bd8a9036884b2f0b09692c5453` | 9 862 B |
| `reports/PHASE_19_PROGRESS.md` | this file | (self-hashes are not recorded here — see convention below) | — |
| `reports/PHASE_19_REMEDIATION_REPORT.md` | **written after the approved A2+A3 batch**, with executed evidence | `c32698a09976f7030f1a87654ce089d46e2d8494a8c121aeb64f0b097c28e4d0` | 18 325 B |
| `reports/PHASE_19_MIGRATION_RUNNER_REPORT.md` | **written after the approved A2+A3 batch**, with executed evidence | `cce641a885d1103f12cc9595404851379e2fb832e021a15826694a5ad5dd837e` | 15 285 B |
| `reports/PHASE_19_SECURITY_VERIFICATION.md` | **written** — the security checklist pass that found and closed F-19-08 and F-19-09 | `3df4258de88d4fb401bf342420a30e71bf31daf0cc6c95436e176203928a87c2` (17 871 B) — **SUPERSEDED** by the §6 close-of-phase re-check and WAL-sidecar proof → current `e438d074357d8833aa8ff6c8565c545ddda5d8a8610e6e75976a3872e95c4a5b` | 18 888 B |

The last three were withheld deliberately while no remediation existed: creating them earlier would
have produced documents asserting fixes that did not exist — exactly the "cosmetically green" failure
mandate §17 forbids. They were written only after the approved A2/A3 implementation, and each asserts
only what a captured command proved.

**Hash convention** (carried from Phase 18): a file never records its own hash, so this file is the
only one without an entry. The table above is the authoritative record for the other seven Phase 19
reports; §5 repeats the same values alongside the source, test and doc hashes so the code and its
records are one snapshot. If any listed file is later edited, its row is marked **SUPERSEDED** with the
new hash appended rather than the old value being rewritten — earlier evidence is never silently
overwritten.

## 2. Log

**2026-11-01 ~18:24 local (12:54Z) — Phase 19 mandate received and read.**
Attachment read in full (792 lines). Binding constraints taken as: A2–A8 approval is *not* implied by
the prompt; A9 is outside the phase; §13 invariants and §14 prohibitions hold absolutely.

**~12:54–12:58Z — Phase 18 documents re-read.** All six located in `reports/` and read: AUDIT,
MIGRATION_READINESS, SECURITY_FINDINGS, REMEDIATION_PLAN, APPROVAL_LIST, PROGRESS. The approval
record (§6) inspected: **blank in every row** → no pre-existing approval for any A item.

**13:04Z — live baseline verified (not inherited).** HOME guard `HOME VERIFIED`;
`automaton.json` `1c10ecc5…966d`; `state.db` 512 000 B @ `2026-10-31T10:25:59.744Z`;
`-wal` 0 B; `-shm` 32 768 B; read-only open → schema **11**, 38 tables, `integrity_check ok`, all
four V12/V13 tables absent; size + mtime re-checked after the probe → **unchanged: true**.
All §13 gates re-read from the live file. Ten treasury limits measured `0`. Four credential fields
measured as **zero-length** (length only; no value read).

**13:05Z — process attribution.** A `node.exe dist/index.js` process (PID 12652) looked like a Conway
agent. Its parent is `powershell.exe -File …\TradingProjects\freellmapi\scripts\freellmapi-service.ps1`
→ **FreeLLMAPI's own service, not Conway**. Left untouched (§14). No Conway service, no Conway
scheduled task, no agent runtime. The console is PID 22824/22936 under the project runtime.

**13:06Z — dashboard probes.** `127.0.0.1:8787` open; `GET /` → **200, 792 bytes**;
`<host-lan-ip>:8787` → **Connection refused**.

**13:07–13:10Z — F-19-03 quantified.** 26 socket-table captures against the live listener: the
`LISTENING` row appeared in 2, was absent in 24, and `Get-NetTCPConnection -State Listen` returned no
record — while the port accepted every positive probe. Also tested during an in-flight request
(still no LISTENING row, 4 ESTABLISHED rows). Conclusion recorded: a socket table on this host is
unreliable **in both directions**; probe and attribute the PID.

**~13:08Z — fresh dashboard regression run (mandate §12.H).**
`vitest run --reporter=basic` in `dashboard/`, HOME pinned →
**Test Files 10 passed (10) / Tests 97 passed (97) / 0 failed**, 3.37 s, start 18:28:30 local.
This is why `docs/README.md`'s "9 files / 93 tests" was corrected to 10/97 with a *measured* number
rather than an inherited one.

**13:09–13:11Z — A1 executed (TIER 0, documentation only).** Three files edited:

| File | Edit |
|---|---|
| `docs/WINDOWS_OPERATIONS_GUIDE.md` | `--status` comment corrected; new §3.1 (measured read-write + migrating behaviour, gate map `:121/:143/:160` vs ungated `:154/:166/:172`, read-only alternatives) and §3.2 (ungated `--pick-model` / `--configure` table with what each writes); "Status without starting" → "Status without starting the agent" with the write caveat |
| `docs/README.md` | isolation table → ACL **NOT VERIFIED** with evidence boundary, the libuv `666` trap, and the plaintext-config consequence; Phase 17 evidence row → **10 files / 97 tests**; three-claim passage rewritten to separate *corrected* from *still awaiting approval* |
| `docs/DASHBOARD_OPERATIONS.md` | new §"Proving reachability: probe, do not read a socket table" with the 26-capture table and the one-directional inference rule |

Verification: grep over the three files for the retired strings → only the two occurrences that
*quote the retired wording inside the correction* remain (`README.md:198`, `:233`). No live incorrect
claim survives. `git diff --stat -- docs/` shows nothing because `docs/` is untracked — which is
itself F-18-08, still open.

**13:11Z — A1 non-mutation proof.** `POST-A1 automaton.json sha256: 1c10ecc5…966d`,
`state.db 512000 / 2026-10-31T10:25:59.744Z`, `MATCHES BASELINE: true`.

**13:11–13:13Z — A2–A8 prepared, and four evidence corrections found while reading the code.**

- **F-19-01** — `grep -n "CREATE TRIGGER"` over `src/state/schema.ts`: V12+V13 define **6** append-only
  triggers, not the 7 asserted in four Phase 18 documents and inherited by the Phase 19 mandate
  (§4 test E.3). 4 tables and 12 indexes confirmed. Corrected the acceptance criterion to **names,
  not a count**, so an A2 test or A9/A10 check cannot false-fail on a good migration.
- **F-19-02** — the swallow-then-stamp defect is **seven catches across V4 (×5), V9, V11**, not V11
  alone (`database.ts:590-594`, `:617`, `:627`). A2 scope put to the operator as D-1.
- **§4.3** — both ungated commands funnel through one writer, `saveConfig` (`config.ts:180`), so A4's
  "validate at the write boundary" is one choke point, not five (`configure.ts:329/334/339/344`,
  `model-picker.ts:80`).
- **§4.4** — `tryAppendSecurityEvent` has **13 call sites** (tools ×5, treasury-guard ×3,
  emergency-stop ×2, mechanic ×2, tool-authorizer ×1), not the 3 modules Phase 18 named. Priced into
  A6 rather than discovered mid-edit.
- **F-19-04** — `git add --dry-run` on the A7 scope would stage **19 424 files**, including
  `runtime/.pnpm-store/` (18 628 — the ignore rule reads `runtime/pnpm-store/`, the directory is
  `.pnpm-store`), `runtime/npm-cache/` (783), and **`dashboard/state/dashboard.token` (44 B, the live
  operator token)**, plus `dashboard/restore-targets/` and `runtime/model-test-home/.automaton/`.
  `runtime/home/` itself is correctly ignored (`git check-ignore -v` proves it for both `state.db` and
  `automaton.json`). Proposed remedy: fix ignore rules first, stage by explicit allowlist only,
  scan staged blobs before committing. **No token value was ever read.**

**13:14Z — Phase 19 records written** (the four files in §1) and hashed above.

**13:14Z — STOPPED at the approval gate.** No A2–A8 code change applied. The root test suite has
**not** been re-run in this phase; the 82/2 057 figure in circulation is Phase 18's, and is labelled
inherited everywhere it appears here.

**Approval received (clock time not captured).** The operator selected **"A2 + A3 (runner + read-only
status)"** and delegated D-1 (A2 scope) and D-4 (A4 design) to the agent. A4, A5, A6, A7 and A8 were
**not** selected. Nothing after this point touches an unapproved item; the record is in
`PHASE_19_APPROVAL_RECORD.md` §9, including the disclosure that **A2-full was the agent's choice**.

**19:11–19:27 local — A2 executed, test-first.**
`a2-red.log` (start 19:11:38) **37 failed \| 1 passed (38)** → runner change → `a2-green.log`
(19:21:42) **39 passed** → full root suite `a2-fullsuite.log` (19:22:27) **83 files / 2 096 / 0
failed** → 40th test added (index names pinned) → `a2-green2.log` (19:26:37) **40 passed**.
Closes F-18-02 (a version can no longer be recorded for objects that do not exist), F-18-11 (V9/V10
idempotency) and F-19-02 (all seven unbounded catches routed through one verified helper). The plan
completeness assertion replaces the old blind stamp.

**19:34–20:19 local — A3 executed.** Read-only handle + snapshot + gated `--migrate-schema`
(`src/state/database.ts:567-686`, `src/state/schema-migration.ts`, `src/index.ts:160-176`).
Focused `readonly-status-migration.test.ts` + `migration-runner.test.ts` → **69 passed**
(`p19-a3-final-focused.log`, start 21:07:37 local / 15:37:37Z); full suite
`p19-a3-final-fullsuite.log` (20:54:43 local) **84 / 2 126 / 0 failed**; `tsc --noEmit` and `tsc` both
exit 0; security-named subset (`--testNamePattern 'security|injection|policy'`) **25 files passed /
59 skipped, 178 passed / 1 948 skipped**, exit 0 (`p19-a3-final-security.log`, 21:25:54 local).
`--status` E2E at 15:52:02Z: **exit 0, 13 fields printed, `state.db` byte-identical**.

**20:09–20:16 local — probe bugs in my own verification script (not product defects).**
Three: read `security.maxChildren` (it is a **top-level** config key); counted `x402AllowedDomains`
as a non-zero treasury limit; probed for a `goal_registry` table that has never existed. Corrected
script re-run clean. **Lesson recorded:** a hand-written probe is as fallible as hand-written
documentation — the sanctioned invariant checks now live in the test suite, not in ad-hoc scripts.

**21:39–21:42 local — F-19-08 found and closed (A3 follow-up, same approved item).**
A case-insensitive home guard behind a case-sensitive `startsWith` containment meant a re-cased live
path would be migrated with **one** token instead of two. RED `p19-a3-case-red.log` (21:39:11)
**8 failed \| 1 passed (9)** → `isPathInside` → GREEN `p19-a3-case-green.log` (21:40:32)
**3 files / 79 passed**, typecheck + build exit 0, full suite (21:41:09) **85 / 2 136 / 0 failed**,
CLI proof 16:11:21Z.

**21:47–21:56 local — F-19-09 found and closed (security checklist pass over A3).**
Working checklist item 13 rather than the happy path exposed the same class of defect one layer
deeper: containment compared **spellings**, so a directory junction inside the verified state
directory could move the write elsewhere — and a junction aimed at the live home was not recognised
as canonical. Junctions were used as the probe because they need no elevation on this host
(measured). RED `p19-a3-jx-red2.log` (21:49:43) **6 failed \| 1 passed (7)**, the decisive line being
`expect(result.ok).toBe(false)` → **`expected true to be false`**: the pre-fix gate migrated a
disposable V11 database that physically sat outside the sandbox. Fix: `resolveExistingAncestor`
(`fs.realpathSync.native`, walks past only an absent tail, returns `null` — a refusal — on any other
error). GREEN `p19-a3-jx-green2.log` (21:52:37) **4 files / 86 passed**; CLI escape **exit 1** with
both spellings named (16:24:07Z), escaped victim left byte-identical; control inside the state
directory **exit 0**, `migrated from 11 to 13; 4 tables, 12 indexes, 6 triggers, 50 columns`
(16:24:45Z); final full suite (21:55:34) **86 files / 2 143 / 0 failed**, exit 0. One intermediate
run (1 failed \| 85 passed) was **this test's own 8.3-short-name expectation**, corrected and recorded.
Sandbox teardown removed the junction as a reparse point before deleting anything.
New open findings from the same review, recorded not implemented: **F-19-10** (resolve/open are not
atomic), **F-19-11** (`writeReport` TOCTOU overwrite), **F-19-12** (no flag to redirect the report
directory).

**21:22 local and 16:25Z — `--status` documentation and invariant re-check.**
`docs/WINDOWS_OPERATIONS_GUIDE.md` re-worked: §3.1 now states the read-only guarantee and the
**F-19-05 exit-code change**, §3.1.1 documents `--migrate-schema`, its two tokens and the refusal
order, §3.2 says plainly that **A4 was not approved** so `--configure` remains an ungated write.
Post-work invariant probe: every §13 invariant holds; live `state.db` `2a8aeb34…` 512 000 B @
`2026-10-31T10:25:59.744Z`; schema **11**; 38 tables; `integrity_check ok`; four V12/V13 tables
absent; no `wallet.json`; credential fields zero-length (lengths only, never values);
`CONWAY_ACTIVATION` and `CONWAY_MIGRATION_APPROVAL` unset; **0 migration reports against the live
tree**.

**22:19–22:24 local (16:49Z) — record-keeping closed, housekeeping, final invariant re-check.**
§1 of this file rewritten from the pre-approval state ("NOT CREATED — deliberately") to the delivered
state with SUPERSEDED rows; §4 write inventory extended to cover the A2/A3 source, test, build-output
and doc writes; §5 hash register added and, beside it, the last §13 measurement of the phase
(`runtime/tmp/p19-close-invariants.log`). `PHASE_19_REMEDIATION_REPORT.md` gained F-19-08 and F-19-09
(closed, with their RED/GREEN logs) and F-19-10/11/12 (recorded, not implemented);
`PHASE_19_SECURITY_VERIFICATION.md` §2 got an **additive correction**: its F-19-08 GREEN line first
said "4 files / 79 tests", the captured log says **3 files / 79 tests** (containment 10 + readonly 29
+ runner 40 — the redirection file did not exist yet at that point). No source file was edited after
`p19-jx-final-fullsuite.log` (86 / 2 143 / 0 failed), so that run is still the current regression
proof for the code in the §5 register.

Housekeeping: four dead scratch files of mine removed from `runtime/tmp/` (`a2-fullsuite.counts`,
`a3-fullsuite.counts`, `newrunner.ts` — a staged copy superseded by the real source, and
`splice_runner.py`, a one-off editor). **Every captured log and probe script that a Phase 19 report
cites was kept** — deleting evidence to tidy a directory is the opposite of what this phase is for.
`runtime/tmp/restore-test/` (the Phase 16C fixture) and `runtime/tmp/fix-acl.ps1` (not this phase's)
were left alone.

Two process faults of my own in this pass, recorded rather than smoothed over: **(a)** inserting row 36
into `PHASE_19_TEST_RESULTS.md` matched on the "## 2. Not executed" heading and deleted it, leaving the
new row stranded inside the corrections paragraph; the heading was restored, the row moved into the
table, and the incident is noted in that file. **(b)** the F-19-08 GREEN line in
`PHASE_19_SECURITY_VERIFICATION.md` was written from memory as "4 files" when the log says 3 — the same
class of error as the Phase 18 "eleven indexes" title, and the reason every count in §5 was re-measured
from the file rather than quoted from the narrative.

Close-out check: `vitest run` over the four migration files after all edits →
**4 files / 86 tests / 0 failed**, exit 0 (`runtime/tmp/p19-close-focused.log`, 16:56Z) — this is
`TEST_RESULTS.md` row 36, not a new claim about the code, which was not touched.

## 3. Decisions the operator must make (the ask)

| ID | Question | Where | Answer |
|---|---|---|---|
| D-0 | Approve A1b: the same two doc corrections in the 9 other locations? | approval record §0 | **unanswered** |
| D-1 | A2 scope: V11 only, or all seven ALTER catches? (recommended: all seven) | §1 | **delegated to the agent** → agent chose A2-full, disclosed |
| D-2 | Approve A2? | §1 | **YES** |
| D-3 | Approve A3? Confirm command name `--migrate-schema` and that its token is a **separate** variable, not `CONWAY_ACTIVATION` | §2 | **YES**; separate `CONWAY_MIGRATION_APPROVAL` + a second `CONWAY_MIGRATION_ALLOW_CANONICAL` for the live tree |
| D-4 | A4 design: write-boundary gate / activation gate / per-field confirmation (recommended: boundary) | §3 | delegated, **moot** — A4 not approved |
| D-5 | Approve A5 knowing it makes the stop read "engaged" on a pre-V12 database? | §4 | **unanswered** |
| D-6 | Approve all of A6, or (a)+(b) now and the seal routing later? | §5 | **unanswered** |
| D-7 | Approve the §5 staging set of the change-control doc, and fix `.gitignore` first? Tag yes/no. **Push not requested** | §4–6 | **unanswered** — nothing staged, committed or pushed |
| D-8 | Approve the in-repo staged-blob scanner for A8, or require a third-party tool (an environment change)? | §7 | **unanswered** |

Anything answered "approve" is executed to completion with test evidence, then re-verified against
§13 before the next item is touched.

## 4. Live-state invariants and the complete Phase 19 write inventory

All §13 invariants hold, re-measured after every write made in this phase. No §14 prohibited operation
was performed: no migration executed **against the live or canonical database** (every migration in the
evidence logs ran on a disposable V11 fixture inside a temp-directory sandbox under
`CONWAY_HOME_MODE=isolated`, and each sandbox was torn down after itself), no V12/V13 applied to the
live tree, no activation, no wallet, no credential,
no transaction, no self-healing, no scheduling, no replication, no exposure, no service, no scheduled
task, no firewall/Defender/BitLocker/global-env change, no unrelated AI environment touched
(FreeLLMAPI's process was identified and left alone), no `manage-bde`, no push.

Complete write inventory for Phase 19, cumulative and final:

**Before approval (A1 only — documentation):** `docs/WINDOWS_OPERATIONS_GUIDE.md`, `docs/README.md`,
`docs/DASHBOARD_OPERATIONS.md`, `reports/PHASE_19_AUDIT.md`, `reports/PHASE_19_APPROVAL_RECORD.md`,
`reports/PHASE_19_TEST_RESULTS.md`, `reports/PHASE_19_GIT_CHANGE_CONTROL.md`,
`reports/PHASE_19_PROGRESS.md`.

**After the A2+A3 approval (source, tests, build output, reports):**

| Path | Kind | Why |
|---|---|---|
| `src/state/database.ts` | source (modified) | A2 verified-tolerance helper, per-version object verification, plan-completeness assertion, fail-closed `assertSchemaIsCurrent`; A3 read-only handle + status snapshot |
| `src/state/schema.ts` | source (modified) | A2: `CREATE TABLE IF NOT EXISTS knowledge_store` (F-18-11) + the DDL-derived `DeclaredObjects` manifest |
| `src/state/schema-migration.ts` | source (**new**) | the gated `--migrate-schema` runner, incl. `isPathInside` (F-19-08) and `resolveExistingAncestor` (F-19-09) |
| `src/index.ts` | source (modified) | `--status` → read-only snapshot; `--migrate-schema` dispatch; help text; `ReadOnlyDatabaseError` exit 1 |
| `src/__tests__/migration-runner.test.ts` | test (**new**) | 40 A2 tests (§4.E.1–E.8 + spoof/propagation/idempotency) |
| `src/__tests__/readonly-status-migration.test.ts` | test (**new**) | 29 A3 tests |
| `src/__tests__/migration-path-containment.test.ts` | test (**new**) | 10 tests — F-19-08 re-cased / Git-Bash-spelled live path |
| `src/__tests__/migration-path-redirection.test.ts` | test (**new**) | 7 tests — F-19-09 junction bypass |
| `dist/**` | build output | regenerated by `tsc` from the sources above; not hand-edited |
| `docs/WINDOWS_OPERATIONS_GUIDE.md` | doc (modified again) | §3.1 read-only reality + F-19-05 exit-code note; new §3.1.1 `--migrate-schema`; §3.2 "A4 was not approved"; §2/§4 cross-references |
| `reports/PHASE_19_REMEDIATION_REPORT.md`, `reports/PHASE_19_MIGRATION_RUNNER_REPORT.md`, `reports/PHASE_19_SECURITY_VERIFICATION.md` | reports (**new**) | the three §15 deliverables that could only be written after the approved work existed |
| `reports/PHASE_19_{PROGRESS,TEST_RESULTS,APPROVAL_RECORD,MIGRATION_RUNNER}.md` | reports (appended) | evidence for the runs above |
| `runtime/tmp/*.log` | scratch evidence | RED/GREEN/typecheck/build/invariant captures, named in the tables above |

**Never written:** `runtime/home/**` (config, `state.db`, WAL/SHM sidecars), any `.env`, any wallet,
any credential, any token, `dashboard/**`, `package.json`, `.gitignore`, any Windows setting, any
unrelated AI environment. `state.db` appears in this phase only as a **read** (read-only handle, plus
one probe of a non-existent filename reached through a junction, which the gate refused).

## 5. Final hash register (reports)

Recorded once, at the close of the A2+A3 record-keeping. Earlier §1 values remain as
**SUPERSEDED** rows rather than being rewritten.

**Reports** — first pass measured `2026-11-01T16:49:26Z` (22:19 local). Three files were then re-measured because they gained content after that pass: `PHASE_19_TEST_RESULTS.md` (rows 35 and 36), `PHASE_19_APPROVAL_RECORD.md` (the post-approval scope disclosure) and `PHASE_19_SECURITY_VERIFICATION.md` (the §6 close-of-phase re-check). Their superseded intermediate hashes are listed in their rows rather than removed: this register is written last, so it has to describe the files as they then stand — and once it is written, no further report may be edited without marking its row **SUPERSEDED**. `PHASE_19_PROGRESS.md` is this file and does not record its own hash (Phase 18 convention).

| File | Bytes | SHA-256 |
|---|---|---|
| `PHASE_19_AUDIT.md` | 16 870 | `d5e7bf63dc73ce1da34c29b30249b2d81ee05b756f7a3b38088ade8293fb9755` |
| `PHASE_19_GIT_CHANGE_CONTROL.md` | 9 862 | `41f7a45df27c93eb3ec15c148c82838101bb74bd8a9036884b2f0b09692c5453` |
| `PHASE_19_APPROVAL_RECORD.md` | 37 705 | `dd2ce0dd6c6d0a53c931f46085bf7ab003f4c7648c3d43bc39ae193ff15237c3` (supersedes `06d5ed58…` 34 003 B at creation and `1e126d4c…` 36 283 B after the §9 answer) |
| `PHASE_19_TEST_RESULTS.md` | 13 770 | `e86319005b14dddd2e16fd4948b89e1e919102d90926ae4e241cedccdc81f3fc` (supersedes, in order, `1ef5a10b…` 12 004 B → `dca80920…` 12 741 B → `a46ddbaa…` 13 636 B → `2d04f037…` 13 635 B; all four were this file's own intermediate states while rows 35 and 36 were inserted, a heading was accidentally consumed and restored, and a duplicated row was removed) |
| `PHASE_19_MIGRATION_RUNNER_REPORT.md` | 15 285 | `cce641a885d1103f12cc9595404851379e2fb832e021a15826694a5ad5dd837e` |
| `PHASE_19_SECURITY_VERIFICATION.md` | 18 888 | `e438d074357d8833aa8ff6c8565c545ddda5d8a8610e6e75976a3872e95c4a5b` (supersedes `3df4258d…` 17 871 B; §6 gained the close-of-phase re-check and the WAL-sidecar proof) |
| `PHASE_19_REMEDIATION_REPORT.md` | 18 325 | `c32698a09976f7030f1a87654ce089d46e2d8494a8c121aeb64f0b097c28e4d0` |

**Source, tests and docs** — re-hashed at the same moment, so the register and the code are a single
snapshot:

| File | Bytes | SHA-256 |
|---|---|---|
| `src/state/database.ts` | 104 398 | `12a040ded8dd4102a676e78fb68a2e1b971bf6539b974069d56b12cf079054b7` |
| `src/state/schema.ts` | 29 691 | `f6b4caca034de875919f4bdf17ba3b9cd7024c3bcee10b6df42260e24a08c94c` |
| `src/state/schema-migration.ts` | 15 971 | `7bb864c269b4b23747daf7b8dbdabf6630a7837c066f364136c97a7f50363a52` |
| `src/index.ts` | 23 323 | `b84166e99b96ffe7e34842e251874320fda44b77ce1e15c55dc59603f0d7d0ab` |
| `src/__tests__/migration-runner.test.ts` | 23 099 | `00b1dac4f0c04e332460f7dec4065dfa6f1c8a336af4abb6b9efb53eb42e97f0` |
| `src/__tests__/readonly-status-migration.test.ts` | 26 642 | `4ded2b7a3f01a428fc9f92bfaa528cc553c1b09dad5a2b166b738ff375a750a1` |
| `src/__tests__/migration-path-containment.test.ts` | 8 037 | `81a4b1d4291d6ecfec2821e70b22817a697207354d93d311ac9c989282103a40` |
| `src/__tests__/migration-path-redirection.test.ts` | 10 374 | `4a795a92f7f7ef24c5f9e273de0510a12f0630b7d9b928cbc53b5e3f015dd761` |
| `docs/WINDOWS_OPERATIONS_GUIDE.md` | 12 696 | `bf87cdb99f7e840e8b3a42c57357031b6226da7e32ae261f4cde0f8f16d94e80` |

**Final invariant measurement of this phase** — `runtime/tmp/p19-close-invariants.log`, 16:47Z, run
with HOME pinned to the canonical runtime home and the project's pinned Node 22.23.4, database opened
`{readonly: true, fileMustExist: true}`:

```
automaton.json 1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d
state.db 2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba 512000 2026-10-31T10:25:59.744Z
schema_version 11 | tables 38 | integrity { integrity_check: 'ok' } | v12v13 present []
lockdown true | activationApproved false | allowedTools [] | maxChildren 0 | numeric treasury zero true
wallet exists false
credential lengths conwayApiKey=0 openaiApiKey=0 anthropicApiKey=0 sandboxId=0 walletAddress=0
env CONWAY_ACTIVATION unset | CONWAY_MIGRATION_APPROVAL unset | CONWAY_MIGRATION_ALLOW_CANONICAL unset
migration reports 0
```

Every §13 invariant holds and `state.db` is byte-identical to the Phase 18/19 baseline — same hash,
same size, same mtime — after every write in this phase. Only lengths of credential fields were read,
never values.

**WAL sidecars, checked explicitly because a read-only open of a WAL database can still touch them:**
`state.db-wal` **0 B**, mtime `2026-11-01 13:54:49 local`, and `state.db-shm` **32 768 B**, mtime
`2026-11-01 17:02:51 local`. Both sizes match the 13:04Z baseline and **both mtimes precede every
Phase 19 database access** (the first probe was 18:34 local, the last 22:19 local), so no read in this
phase wrote to the live tree at all — not the main file, not the sidecars. `state.db` itself stays at
mtime `2026-10-31 15:55:59.744 local` (`2026-10-31T10:25:59.744Z`).

## 6. What Phase 19 does NOT claim

1. It does not claim the live database is migrated: the schema is **11** and stays 11 until A9 is
   separately approved and run with both tokens.
2. It does not claim A4–A8 were done. `--configure` and `--pick-model` are still ungated writers; the
   emergency stop is still not fail-closed; the audit-chain write paths are still tolerant; nothing is
   committed, tagged or pushed; nothing was secret-scanned, because nothing was staged.
3. It does not claim the dashboard is verified against the new code — slot H ran in this phase but was
   **not re-run** after the last source edits.
4. It does not claim the gate is atomically airtight (**F-19-10**) or that a report cannot be
   overwritten by a concurrent run (**F-19-11**), or that the runner's verification checks object
   *shape* rather than object *name* (**F-19-06**).
5. It does not claim that the A2/A3 diff is isolable in version control. **A7 was not approved**, so
   there is no baseline commit; the evidence is content hashes plus executed tests (**F-19-04**).
6. It does not claim agent activation. Mandate §16's answer for activation readiness is **NO-GO**,
   unchanged by A2/A3, because A4, A5, A6 and the dashboard findings remain open.

The objective stated in §17 — "a genuinely secure, auditable and reliable Conway Automaton, not a
cosmetically green dashboard" — is advanced by A2 and A3 and is **not** finished by them.
