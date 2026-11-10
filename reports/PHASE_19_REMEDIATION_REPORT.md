# Phase 19 — Remediation Report

**What was approved and executed:** A2 (migration runner hardening, D-1 scope = **A2-full**) and
A3 (read-only `--status` + explicit `--migrate-schema`).
**What was not approved and was therefore not implemented:** A4, A5, A6, A7, A8.
**Outside the phase:** A9 (live V12/V13 migration), A10, A11, A12, B1–B5.

Operator approval was given as a single decision over A2+A3 ("runner + read-only status"). Two
sub-decisions were delegated to the agent by the operator: D-1 (A2 scope) → **A2-full** chosen, and
D-4 (A4 design) → moot, because A4 was not approved. The delegation of D-1 is recorded here as well as
in the approval record, because it means the *scope* of an approved code change was chosen by the agent,
not by a human.

Nothing in §14 of the mandate was performed. Every §13 invariant was re-measured after each write;
the final measurement is in `PHASE_19_MIGRATION_RUNNER_REPORT.md` §5 and `PHASE_19_SECURITY_VERIFICATION.md`.

---

## 1. Changes applied, file by file

| File | Change | SHA-256 now | Previous record |
|---|---|---|---|
| `src/state/database.ts` | A2: verified-tolerance ALTER helper, per-version object verification, no `MAX(version)` stamping, `ON CONFLICT DO NOTHING`, plan-completeness assertion, fail-closed `assertSchemaIsCurrent`. A3: read-only section (`ReadOnlyDatabase`, `ReadOnlyDatabaseError`, `openDatabaseReadOnly`, `StatusSnapshot`, `buildStatusSnapshot`, `readStatusSnapshot`) | `12a040ded8dd4102a676e78fb68a2e1b971bf6539b974069d56b12cf079054b7` | A2-only state was `2bc6eb2d…` (**superseded** by the A3 addition); pre-A2 content is not hash-recorded (see gap below) |
| `src/state/schema.ts` | A2: `CREATE TABLE IF NOT EXISTS knowledge_store` (:665, F-18-11); `DeclaredObjects` + `declaredObjects()` DDL-derived manifest (:822/:829) | `f6b4caca034de875919f4bdf17ba3b9cd7024c3bcee10b6df42260e24a08c94c` | not hash-recorded before A2 |
| `src/state/schema-migration.ts` | **new** — gated migration runner for `--migrate-schema`. Later in the same approved item: `isPathInside` (F-19-08) and `resolveExistingAncestor` + resolved-path containment (F-19-09) | `7bb864c269b4b23747daf7b8dbdabf6630a7837c066f364136c97a7f50363a52` | first A3 record `ab5715a4…` then `0c923078…` after F-19-08 (**both superseded**, in that order) |
| `src/index.ts` | `--status` → `readStatusSnapshot`; new `--migrate-schema` dispatch (:165); help text + two env entries; `ReadOnlyDatabaseError` handling exits 1 | `b84166e99b96ffe7e34842e251874320fda44b77ce1e15c55dc59603f0d7d0ab` | pre-A3 `0c5d398f…` (**superseded**) |
| `src/__tests__/migration-runner.test.ts` | **new** — 40 A2 tests (§4.E.1–E.8 + spoof/propagation/idempotency cases) | `00b1dac4f0c04e332460f7dec4065dfa6f1c8a336af4abb6b9efb53eb42e97f0` | `4ddd0ccf0bf1a7d7a7509dce565f57ebb6538e1bd55665f779ac910b9ce59645` (**superseded** by the "eleven"→"twelve" title correction only) |
| `src/__tests__/readonly-status-migration.test.ts` | **new** — 29 A3 tests in four describes | `4ded2b7a3f01a428fc9f92bfaa528cc553c1b09dad5a2b166b738ff375a750a1` | — |
| `src/__tests__/migration-path-containment.test.ts` | **new** (F-19-08) — 10 tests: the comparison primitive, the re-cased live path, the state-directory-itself refusal, and a source guard that both decisions use `isPathInside` | `81a4b1d4291d6ecfec2821e70b22817a697207354d93d311ac9c989282103a40` | — |
| `src/__tests__/migration-path-redirection.test.ts` | **new** (F-19-09) — 7 tests: the resolver, a junction that escapes the state directory, a junction that aims at the live home, the in-sandbox control, and a source guard that no containment decision reads the typed path | `4a795a92f7f7ef24c5f9e273de0510a12f0630b7d9b928cbc53b5e3f015dd761` | — |
| `docs/WINDOWS_OPERATIONS_GUIDE.md` | A1 then A3 doc follow-through: §3.1 rewritten to the read-only reality, new §3.1.1 for `--migrate-schema`, §2 migration-token cross-reference, §3.2 corrected line refs + "A4 was not approved", §4 status paragraph | `bf87cdb99f7e840e8b3a42c57357031b6226da7e32ae261f4cde0f8f16d94e80` | A1 version superseded (hash not separately recorded) |
| `reports/PHASE_19_*.md` | this phase's records; five new files, three appended | (self-hashes not recorded — convention) | — |

**Not modified:** `runtime/home/**` (config, `state.db`, WAL sidecars), `dashboard/**`, `dist/**` is a
build output regenerated from source, `package.json`, `.gitignore`, any Windows setting, any unrelated AI
environment. The full write inventory is in `PHASE_19_PROGRESS.md` §4.

**Evidence gap, stated rather than papered over:** because A7 (the git baseline commit) was not approved,
`git diff` against HEAD spans Phase 16–19 and cannot isolate this phase's diff, and no pre-A2 hash was
recorded for `src/state/schema.ts`. The A2/A3 changes are therefore evidenced by their current hashes,
their tests, and the RED/GREEN logs — not by a version-control delta. This is the direct cost of not
approving A7, and it is why the A7 request remains open.

## 2. Findings closed by the approved work

| Finding | Closed by | How it is now proved, not asserted |
|---|---|---|
| **F-18-01** `--status` opens read-write and migrates | A3 | 4 tests on the read-only handle (write attempt → `SQLITE_READONLY`; missing file → `SQLITE_CANTOPEN`, file not created) + 8 tests on a disposable V11 copy (schema stays 11, sha256 and mtime unchanged, four V12/V13 tables still absent, no row written) + 6 source-level wiring guards + manual E2E on the built bundle |
| **F-18-02** runner swallows failures then stamps the version; untested | A2 | `MigrationVerificationError`, per-version `assertVersionObjectsExist` inside the same transaction; the runner is now exported and has 40 tests |
| **F-18-11** V10 not idempotent | A2 | `IF NOT EXISTS` + "re-running V10 onto a database that already has `knowledge_store` converges" |
| **F-19-01** acceptance criterion counted triggers wrongly (7 vs 6) | A2 | criterion restated as **names**, pinned by the `pins V12+V13 by name in both directions` test |
| **F-19-02** seven unbounded catches, not one | A2 (scope A2-full) | all seven routed through the verified helper; the `the seven unbounded migration catches are gone` grep-guard test |

F-19-08 and F-19-09 — two gate defects that the security review found **in code written during the
approved A3 work** — were also closed inside that same approved scope. They are recorded in §3 with
their full RED/GREEN evidence and in `PHASE_19_SECURITY_VERIFICATION.md` §2, not folded quietly into the
table above.

## 3. New findings recorded in this phase

| ID | Severity | Finding | Status |
|---|---|---|---|
| **F-19-05** | Medium (behaviour change, undisclosed until now) | A3 changes `--status`'s exit code when the database is missing: pre-A3 it silently created a V13 database and exited 0; post-A3 it logs `Status unavailable: …` and exits **1**. No `.bat` wrapper was changed, so `HEALTH_CHECK.bat` or any external monitor that treats a non-zero `--status` exit as "agent unhealthy" will now see a *new* failure mode on an un-setup install — which is actually "there is no database yet". | **open** — disclosed in the operations guide §3.1; consumer audit needs its own approval (not part of A2/A3) |
| **F-19-06** | Medium | Migration verification compares **object names**, not object **shape**: a table created with the wrong columns/types satisfies `assertVersionObjectsExist`. Only ALTER-declared columns are checked structurally. | **open** — closing it is a new change requiring approval |
| **F-19-07** | Low, but it disables a safety net | `npm run test:security` (`vitest run --grep 'security\|injection\|policy'`) cannot run under the pinned vitest 2.1.9: `CACError: Unknown option --grep`. `test:financial` has the same defect. The security subset therefore has to be invoked as `--testNamePattern`, which is not what the documented script says. **Not a Phase 19 regression** — `package.json` was never edited here — but a documented check that silently does not work is worse than a missing one. | **open** — script fix (`--grep` → `--testNamePattern`) needs approval because it touches `package.json` |
| **F-19-08** | **High — found in code written during the approved A3 work.** Two-token protection reduced to one token | The canonical check compared `path.resolve(target)` against `path.resolve(canonicalHome())` with `startsWith`, while `samePath` in `src/runtime/home-guard.ts:103` — the guard that decides which HOME is trustworthy — is deliberately case-insensitive on Windows and normalises Git-Bash `/c/...` spellings. `HOME=<repo-root>\runtime\home` passed the home guard and then failed the `startsWith`, so the **live tree read as "not canonical"**: one token instead of two to reach the live database. | **CLOSED** inside the approved A3 scope — `isPathInside` (`src/state/schema-migration.ts:173`: platform-correct separator containment, case-insensitive on win32, prefix-sibling `…\homekeeper` rejected). Test-first: RED `runtime/tmp/p19-a3-case-red.log` **8 failed \| 1 passed (9)** → GREEN `p19-a3-case-green.log` **3 files / 79 tests** (containment 10 + readonly 29 + runner 40), `tsc --noEmit` and `tsc` exit 0 → CLI proof 16:11:21Z: re-cased live path refused *naming* `CONWAY_MIGRATION_ALLOW_CANONICAL`, exit 1. Full write-up: `PHASE_19_SECURITY_VERIFICATION.md` §2 |
| **F-19-09** | **High — also found in my own A3 code.** Containment compared spellings, not locations | Both containment decisions compared literal path strings, and a Windows directory junction is a spelling that names somewhere else: `mklink /J <sandbox>\.automaton\escape <anywhere>` with `--database <sandbox>\.automaton\escape\state.db` let the *string* pass the state-directory check while the *bytes written* landed outside it. Aimed at the live runtime home it was **not** recognised as canonical, so a single `CONWAY_MIGRATION_APPROVAL=APPROVED` could have advanced the live schema — decision **A9**, explicitly not approved. Junctions were chosen as the probe because `fs.symlinkSync(t, l, "junction")` succeeds for an ordinary unprivileged user on this host (measured in this phase), so the defence cannot assume the attacker needed elevation. | **CLOSED** inside the approved A3 scope — `resolveExistingAncestor` (`:198`) resolves both sides through `fs.realpathSync.native`, walking past only a genuinely absent `ENOENT`/`ENOTDIR` tail and returning `null` (= refusal) on any other error; `canonicalStatus` (`:228`), the containment test (`:302`) and the `new Database` handle (`:329`) all take the **resolved** path, so the audit report names the database actually written. Test-first: RED `p19-a3-jx-red2.log` **6 failed \| 1 passed (7)** with the decisive assertion `expect(result.ok).toBe(false)` → **`expected true to be false`** (pre-fix the gate reported success and migrated a disposable V11 database physically outside the sandbox) → GREEN `p19-a3-jx-green2.log` **4 files / 86 tests**, typecheck and build exit 0. Reconstructor: `src/__tests__/migration-path-redirection.test.ts` (7 tests). Live `state.db` `2a8aeb34…` unchanged before and after. Full write-up: `PHASE_19_SECURITY_VERIFICATION.md` §2 |
| **F-19-10** | Low, filesystem-access-dependent | Resolution and open are not atomic: between `resolveExistingAncestor` and `new Database(real)` a process that can already write inside the state directory could re-aim a link. The window is narrower than the one F-19-09 closed and needs the same pre-existing access; the complete fix is to verify the handle after opening, or hold a directory handle for the state dir. | **recorded, not implemented** — no test for it exists yet, and untested security code is worse than a documented gap. Needs its own approval. |
| **F-19-11** | Low | `writeReport` uses `existsSync` then `writeFileSync` to pick its `-2`/`-3` filename, so two concurrent runs by the same user can overwrite one another's report (TOCTOU). | **recorded** — single-operator CLI; an `O_EXCL` create would be a new change beyond A2/A3 |
| **F-19-12** | Low | The default report directory is `<repo>/reports`, writable by any process that can run the CLI, and the CLI exposes no flag to redirect it. | **recorded** — A1 documentation names the path; adding a flag is beyond A2/A3 |

## 4. Additive corrections to earlier Phase 19 records

Earlier statements are not rewritten; they are corrected forward.

1. **`reports/PHASE_19_APPROVAL_RECORD.md` §2 test-plan item 8** says post-A3 `--status` must report
   "the same **12** fields". Measured: the block prints **13** fields (Name, Address, Creator, Sandbox,
   State, Turns, Tools, Skills, Heartbeats, Children, Agent ID, Model, Version). The implemented output
   is **byte-identical to pre-A3**, so the equivalence guarantee holds; the number in the plan was wrong,
   not the behaviour. `readonly-status-migration.test.ts` pins all 13 labels.
2. **`reports/PHASE_19_TEST_RESULTS.md` row 12** ("all ten `treasuryPolicy` limits `0`") conflates a list
   with a limit. Measured precisely: `treasuryPolicy` has **9 numeric keys, all `0`**, plus
   `x402AllowedDomains` = `[]` (10 keys total). The security posture is unchanged; the wording was imprecise.
3. **Location of `maxChildren` was never recorded** in `PHASE_19_TEST_RESULTS.md` row 12 or the
   `PHASE_19_PROGRESS.md` §2 13:04Z entry, and it is **not** beside the similar-sounding flags: it is a
   **top-level** config key (`cfg.maxChildren = 0`), not `security.maxChildren`. A probe during this phase looked under
   `security.maxChildren`, got `undefined`, and was corrected — the live value was never in doubt, the
   measurement path was. Two further probe bugs found and fixed the same way in the same script: counting
   `x402AllowedDomains` as a non-zero limit, and probing for a `goal_registry` table that has never
   existed (the four pending V12/V13 tables are named in `PHASE_19_MIGRATION_RUNNER_REPORT.md` §2).
   **Lesson recorded:** a hand-written probe is as fallible as hand-written documentation; the sanctioned
   invariant checks now live in the test suite, not in ad-hoc scripts.
4. **`reports/PHASE_19_APPROVAL_RECORD.md` §1(d)** stated 12 indexes for V12/V13. That was **right**; the
   interim "eleven" that appeared in a test *title* during A2 was the error (a `CREATE UNIQUE INDEX` the
   first grep missed). The title is fixed; the assertion always listed 12 names.
5. **D-1 disclosure.** The operator answered the A2-scope question with "DECIDE IT YOUR SELF IS THE BEST OF
   MY KNOWLEDGE". The agent chose **A2-full** (all seven ALTER sites, not the V11-only minimum). This is
   recorded as an agent-chosen scope on a human-approved code change, which is the honest description of
   what happened.

## 5. What is still open, unchanged, and why

| Item | State | Why it was not touched |
|---|---|---|
| A4 — gate `--configure` / `--pick-model` | **not approved, not implemented** | `--configure` still writes credentials, treasury limits, `maxChildren` and opens `createDatabase` (which still migrates) with **no gate** — `docs/WINDOWS_OPERATIONS_GUIDE.md` §3.2 now says so explicitly |
| A5 — emergency stop fail-closed | not approved, not implemented | still reports "engaged" against a pre-V12 database |
| A6 — audit chain / tool authorizer write failures | not approved, not implemented | `tryAppendSecurityEvent`'s 13 call sites still tolerate a silent write failure |
| A7 — git baseline + commit | not approved, not implemented | no commit, no tag; **push was never authorised**. Root cause F-19-04 (ignore rules would stage 19 424 files incl. `dashboard/state/dashboard.token`) is unfixed because fixing `.gitignore` is part of A7 |
| A8 — secret scan of the staged set | not approved, not implemented | no third-party scanner is installed; nothing was staged, so nothing was scanned |
| A9/A10 — live V12/V13 + post-apply verification | **outside Phase 19** | live schema is still **11** by design |
| A11/A12, B1–B5 | not in scope | mandate §8/§11/§14 |
| F-19-05, F-19-06, F-19-07 | open | each is a change beyond the approved A2/A3 scope |
| F-19-10, F-19-11, F-19-12 | recorded, **not implemented** | low-severity residual defects in the new gate, found during the security review of A3. Each would be a *further* code change with no test yet written for it; mandate §12 forbids presenting untested hardening as verified, and §2 forbids inferring approval. They are disclosed here instead of being silently widened into A3. |

## 6. Classification

- **Phase 19 remediation (A2, A3): DONE and verified** — focused migration/status suite **4 files /
  86 tests passed** (A2 40, A3 29, path containment 10, path redirection 7 — `p19-a3-jx-green2.log`);
  root regression **86 files / 2 143 tests / 0 failed**, exit 0 (`p19-jx-final-fullsuite.log`); typecheck
  and build exit 0; live `state.db` and `automaton.json` hashes unchanged; `reports/migration-*.json`
  count **0**. Two gate defects that this phase's own security review found in the new A3 code
  (F-19-08, F-19-09) were closed test-first inside the approved scope rather than left as notes. The
  dashboard suite (10 / 97) was run in this phase but **not re-run after the last source edits** — see
  `PHASE_19_TEST_RESULTS.md` §2, slot H.
- **Migration-runner readiness: READY** for a *non-canonical* target. The gate, refusal order,
  preflight and report are tested; `--migrate-schema` works against an isolated home.
- **Live V12/V13 (A9): NOT EXECUTED — still requires separate explicit approval.** The tooling for it now
  exists and is gated; the decision has not been made.
- **Dashboard readiness: NOT ASSESSED in this phase** (A11 unapproved; F-18-05/06/07 remain open).
- **Agent activation: NO-GO.** `security.lockdown = true`, `activationApproved = false`,
  `allowedTools = []`, `maxChildren = 0`, all treasury limits zero, no wallet, no credentials, no agent
  process, nothing scheduled, no exposure. A2/A3 changed no activation state and cannot — the migration
  gate reads and writes only its own two variables. Activation stays NO-GO until every activation-blocking
  finding (A4, A5, A6 and the dashboard findings) is independently closed and verified.
