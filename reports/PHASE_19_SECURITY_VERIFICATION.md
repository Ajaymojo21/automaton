# Phase 19 — Security verification of the approved remediation (A2 + A3)

Verdicts in this file are four-state: **PASS** (executed, observed), **FAIL** (executed,
observed wrong), **NOT VERIFIED** (would need a run that is out of scope or unapproved),
**NOT APPLICABLE**. Every command quoted below was actually run; nothing here is inferred
from the presence of a source file.

| Field | Value |
|---|---|
| Reviewed scope | A2 (migration runner) and A3 (read-only `--status`, gated `--migrate-schema`) — the only items with operator approval |
| Not reviewed | A4, A5, A6, A7, A8, A9 — **not implemented**, because not approved. Absence of findings here means absence of code, not cleanliness. |
| Method | `ecc:security-review` checklist applied line-by-line to the A2/A3 diff, plus two adversarial probes written test-first against the gate |
| Window | 2026-11-01, 15:24Z–16:25Z (local log clock +05:30) |
| Runtime | pinned `runtime/node-v22.23.4-win-x64/node.exe`, better-sqlite3 11.10.0 / SQLite 3.49.2 |
| Live state during review | unchanged throughout; proof in §6 |

---

## 1. Checklist result

| # | Checklist control | What was checked | Result | Evidence |
|---|---|---|---|---|
| 1 | No secrets in source | grep of the A2/A3 diff for keys, tokens, wallet material | PASS | no literal secret in `src/state/schema-migration.ts`, `src/state/database.ts` read-only section, `src/index.ts` |
| 2 | Secrets from the environment, validated at the boundary | both gate tokens read from `process.env` only, compared before any file open | PASS | `evaluateMigrationGate` `src/state/schema-migration.ts:61`; refusal order proven by 10 gate tests |
| 3 | Exact-value authorization comparison, never truthiness | `"1"/"true"/"yes"` must not approve; `CONWAY_ACTIVATION` must not approve | PASS | `src/state/schema-migration.ts:69` (`supplied !== MIGRATION_APPROVAL_VALUE`); test "does not treat agent activation as migration approval" |
| 4 | Report and logs carry no secret values | the audit report stores the token **name** and a boolean, never the value | PASS | `MigrationReport.approval` `src/state/schema-migration.ts:87`; test asserts `JSON.stringify(report)` does not contain `APPROVED` |
| 5 | Credential fields never printed | invariant probe reads `.length`, not the value | PASS | `runtime/tmp/p19-a3-final-invariants.log`: `conwayApiKey length (value not read): 0` |
| 6 | Input validation at the boundary | the operator-supplied `--database` value passes gate → home → resolve → containment → existence → integrity before any write | PASS | refusal-order tests (A3 suite) + CLI runs in §5 |
| 7 | No SQL injection | every statement in the A2/A3 paths is a static literal or uses `?` | PASS | `pragma_table_info(?)` `src/state/database.ts:771`, `INSERT INTO schema_version (version) VALUES (?)` `:866`, `SELECT … WHERE type = ? AND name = ?`; the two pre-existing interpolated fragments (`getPolicyDecisions` `src/state/database.ts:1070`, `getSpendByWindow` `:1114`) build only from a fixed whitelist of literal clauses and pass all values as parameters — reviewed, not modified |
| 8 | Least privilege on the read path | `--status` opens `readonly: true, fileMustExist: true`; migration code unreachable from it | PASS | `src/state/database.ts:611`; 4 read-only-handle tests assert a write raises `SQLITE_READONLY` |
| 9 | Separation of duties | migration approval and agent activation are different variables, different code paths, neither imports the other | PASS | `src/state/schema-migration.ts:14-16`; no import of the activation gate anywhere in the module |
| 10 | Fail closed | unresolvable path, unresolvable state dir, failing `integrity_check`, non-Conway home → refuse, no report, no DDL | PASS | `src/state/schema-migration.ts:279-307`; the resolver returns `null` rather than guessing (§3) |
| 11 | Error messages without internal detail | refusals name the stage, the operator's own path and the environment variable to set; no stack trace, no config dump | PASS | §5 output; `refuse()` `src/state/schema-migration.ts:257` |
| 12 | Filesystem write discipline | reports never overwrite (`-2`, `-3` suffix), refusals write nothing, the write connection sets only `busy_timeout`/`foreign_keys` (no `journal_mode` write) | PASS | `writeReport` `src/state/schema-migration.ts:240`; idempotency test expects exactly 2 reports from 2 runs |
| 13 | Deny-by-default containment | path must be inside the verified state directory and outside the canonical home unless a second token names it | PASS after F-19-08 and F-19-09 | §3, §4 |
| 14 | Dependency review | no new dependency introduced by A2/A3 | PASS | diff touches `src/state/*`, `src/index.ts`, `src/__tests__/*`, `docs/`, `reports/` only |
| 15 | Security-relevant tests are not skipped | focused A2+A3+containment+redirection all executed, not filtered out | PASS | §7 |

---

## 2. Findings closed during this review

### F-19-08 — case-insensitive home guard behind a case-sensitive containment check (CLOSED)

The canonical check compared `path.resolve(target)` with `path.resolve(canonicalHome())`
using `startsWith`, while `samePath` in `src/runtime/home-guard.ts:103` — the guard that
decides which HOME is trustworthy — is deliberately case-insensitive on Windows and
normalises Git-Bash `/c/...` spelling. `HOME=<repo-root>\runtime\home`
passes the guard, then failed the `startsWith`, so the live tree read as "not canonical":
**one token instead of two** to reach the live database.

- RED (test-first, `runtime/tmp/p19-a3-case-red.log`, started 21:39:11 local):
  `Test Files 1 failed (1) / Tests 8 failed | 1 passed (9)`; the decisive line was the
  pre-fix message `Migration refused: <repo-root>\runtime\home\.automaton\a3-case-probe-does-not-exist.db is not inside the verified state directory <user-home>\…` — it fell through to the sandbox check instead of naming canonical.
- Fix: `isPathInside` (`src/state/schema-migration.ts:173`) — platform-correct separator
  containment, case-insensitive on win32, prefix-sibling (`…\homekeeper`) rejected.
- GREEN (`runtime/tmp/p19-a3-case-green.log`, started 21:40:32 local): `Test Files 3 passed (3) / Tests 79 passed (79)` — containment 10 + readonly 29 + runner 40; `tsc --noEmit` exit 0, `tsc` build exit 0.
  *(Additive correction: an earlier draft of this line said "4 files". At this point in the phase the
  redirection file did not exist yet, so the run — and the log — had 3. Verified against the log header.)*
- CLI proof after the fix, 16:11:21Z: re-cased live path refused with
  `… is inside the canonical runtime home. Advancing the live schema needs CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED as well …`, exit 1.

### F-19-09 — a junction inside the state directory could move the write (CLOSED)

Found by working through checklist item 13 rather than by testing the happy path. Both
containment decisions compared **spellings**; a Windows directory junction is a spelling
that names somewhere else:

```
mklink /J <sandbox>\.automaton\escape  <anywhere-on-the-volume>
Conway --migrate-schema --database <sandbox>\.automaton\escape\state.db
```

The literal path is inside the verified state directory, so the gate approved it and the
bytes written were the ones under `<anywhere>`. The same mechanism aimed at the live
runtime home was **not** recognised as canonical — so a single
`CONWAY_MIGRATION_APPROVAL=APPROVED` could have advanced the live schema, which is
decision A9 and is explicitly not approved. Junctions were chosen as the probe because
`fs.symlinkSync(target, link, "junction")` succeeds for an ordinary unprivileged user on
this host (measured in this window), so the defence cannot assume the attacker would need
elevation to create a link.

- Reproductor: `src/__tests__/migration-path-redirection.test.ts`, 7 tests.
- RED (`runtime/tmp/p19-a3-jx-red.log` 21:49:06, re-run after a test-side import mistake
  `runtime/tmp/p19-a3-jx-red2.log` 21:49:43):
  `Tests 6 failed | 1 passed (7)`. The decisive assertion was
  `expect(result.ok).toBe(false)` → **`expected true to be false`**: the pre-fix gate
  returned success and migrated a disposable V11 database that physically sat outside the
  state directory. The live-tree variant failed with
  `expected 'Migration refused: no database at C:\…' to match /canonical/i` — refusal by
  accident, not recognition.
- Fix: `resolveExistingAncestor` (`src/state/schema-migration.ts:198`) resolves both sides
  through `fs.realpathSync.native` before comparison, walking past only a genuinely absent
  tail (`ENOENT`/`ENOTDIR`); any other error returns `null`, which is a refusal, not a
  guess. Both call sites now take the resolved path
  (`src/state/schema-migration.ts:279`, `:302`), `canonicalStatus` resolves the canonical
  home too (`:228`), and the write opens the **resolved** file (`:329`) so the audit report
  names the database that was actually written.
- GREEN (`runtime/tmp/p19-a3-jx-green2.log`, started 21:52:37 local): `Test Files 4 passed (4) / Tests 86 passed (86)` — A2 40, A3 29, containment 10, redirection 7. `tsc --noEmit` and `tsc` both exit 0 (0-byte logs).
- One intermediate failure is recorded rather than hidden: the first GREEN run
  (`p19-a3-jx-green.log`) showed `1 failed | 85 passed`, and the cause was **my test
  expectation**, not the product — `fs.mkdtempSync(os.tmpdir())` yields the 8.3 short name
  `<user-home>\…` while `realpathSync.native` returns the long form. The assertion was
  corrected to compare against the resolved spelling; it still proves the link component is
  gone and the target directory is present.

---

## 3. Controls the two findings produced

| Control | Where | Why it is now structural |
|---|---|---|
| One comparison primitive | `isPathInside`, used by both containment decisions | a source-level guard test asserts `canonicalStatus` uses it and that no `startsWith(` survives in that path |
| Resolve before deciding | `resolveExistingAncestor` before both `isPathInside` calls | a second guard test asserts `resolveExistingAncestor(target)`, `canonicalStatus(real`, `isPathInside(real, realStateDir` and forbids `isPathInside(target,` — the typed string may appear in messages but must not decide anything |
| Fail closed on the unknown | `null` → `refuse("target" \| "home")` | no fallback to the literal path; a path whose location is unknown is a path that is not approved |

---

## 4. Refusal order (unchanged by the fixes, restated because it is the security property)

`gate` → `home` → resolve → `canonical` → `state-directory containment` → `existence` →
`integrity` → DDL. Every stage before DDL writes **no report**, because "the run did not
happen" is not an auditable event and half-written reports invite invented approval records.

---

## 5. Executed adversarial runs (CLI, rebuilt bundle)

| Run | Result |
|---|---|
| `--migrate-schema --database …escape\victim.db` with `CONWAY_HOME_MODE=isolated`, `CONWAY_MIGRATION_APPROVAL=APPROVED`, HOME=sandbox | exit 1 — `Migration refused: <user-home>\…\.automaton\escape\victim.db resolves to <user-home>\…\outside\victim.db, which is not inside the verified state directory …` (16:24:07Z) |
| Escaped victim database afterwards | `sha256 2a8aeb3494f1…` — byte-identical to the V11 database it was copied from; still V11 |
| Control: same command, database genuinely inside the sandbox state directory | exit 0 — `Schema migrated from 11 to 13; 4 tables, 12 indexes, 6 triggers, 50 columns created.` (16:24:45Z). The counts independently re-confirm the F-19-01 measurement. |
| Report location for the control | the CLI has no report-directory flag; the run wrote `reports/migration-2026-11-01T16-24-45-361Z.json`, which was moved to `runtime/tmp/p19-a3-jx-e2e-report.json` so the audit directory is not polluted by a sandbox test. `reports/migration-*.json` now counts 0. |
| Sandbox teardown | junction removed with `rmdirSync` (removes the reparse point, never its target); `outside/victim.db` still present and 512 000 B; temp tree deleted |

---

## 6. Live-state proof after the security work

Re-run of the invariant probe at 16:25Z on the current bundle —
`security.lockdown=true`, `activationApproved=false`, `allowedTools=[]`,
`allowFinancialTools/allowHostShell/allowSelfModification/allowReplication/allowExternalExposure=false`,
`maxChildren=0` (top-level config key), `treasuryPolicy` 9 numeric limits all zero plus
`x402AllowedDomains=[]`, api-key and wallet-address fields length 0, no `wallet.json`,
`CONWAY_ACTIVATION` and `CONWAY_MIGRATION_APPROVAL` unset in the operator shell.

`runtime/home/.automaton/automaton.json` `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d`;
`state.db` `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`, 512 000 B,
mtime `2026-10-31T10:25:59.744Z`; read-only probe `schema 11 | tables 38 | integrity_check
ok`; the four V12/V13 tables still absent; 0 migration reports against the live tree.

**Close-of-phase re-check, 16:49:10Z** (`runtime/tmp/p19-close-invariants.log`, pinned Node 22.23.4,
HOME pinned, database opened `{readonly: true, fileMustExist: true}`): every value above reproduced
unchanged. The **WAL sidecars were checked explicitly**, because opening a WAL-mode database read-only
can still write `-shm` — `state.db-wal` is 0 B with mtime `2026-11-01 13:54:49 local` and `state.db-shm`
is 32 768 B with mtime `2026-11-01 17:02:51 local`, both **predating the first Phase 19 probe**
(18:34 local) and the last (22:19 local). No read in this phase wrote to the live tree at all. The
close-out focused test re-run at 16:57:37Z (`p19-close-focused.log`) is **4 files / 86 tests / 0
failed**, and the live files were re-statted and re-hashed at **17:10:16Z**, after that run:
`state.db` still 512 000 B, mtime `2026-10-31 15:55:59.744 local`, hash `2a8aeb34…`; `-wal` still 0 B
@ `13:54:49 local`; `-shm` still 32 768 B @ `17:02:51 local`. The test run changed nothing in the live
tree either.

---

## 7. Regression evidence

| Check | Command | Result |
|---|---|---|
| Focused A2 + A3 + containment + redirection | `vitest run` on the four files | 86 passed / 0 failed, exit 0 (21:52:37 local) |
| Full root suite before the redirection fix | `vitest run` | 85 files / 2 136 tests passed, exit 0 (started 21:41:09 local, 88.84 s) |
| Full root suite after the redirection fix | `vitest run` → `runtime/tmp/p19-jx-final-fullsuite.log` | **86 files / 2 143 tests passed, 0 failed, exit 0** (started 21:55:34 local, 88.90 s). `state.db` re-hashed after the run: `2a8aeb34…` unchanged; `reports/migration-*.json` count 0 |
| Typecheck | `tsc --noEmit` | exit 0, empty output |
| Build | `tsc` | exit 0, empty output |
| Security-named subset | `vitest run --testNamePattern 'security\|injection\|policy'` | 25 files passed / 59 skipped, 178 tests passed / 1 948 skipped, exit 0 (15:56:00Z) — note this pattern excludes `src/__tests__/migration-*.test.ts`, whose names are "A2/A3 …", which is why the focused runs above were also executed |

`npm run test:security` and `npm run test:financial` remain **broken** (F-19-07): they pass
`--grep`, which vitest 2.1.9 rejects. Fixing the scripts is a `package.json` change outside
the A2/A3 approval, so they were not edited; the subset was run with the equivalent
`--testNamePattern` and is recorded as such.

---

## 8. Residual risks and honest gaps

| ID | Statement | Severity | Disposition |
|---|---|---|---|
| F-19-10 | Resolution and open are not atomic. Between `resolveExistingAncestor` and `new Database(real)` an attacker with write access in the state directory could re-aim a link. The window is narrower than the one F-19-09 closed and requires the same filesystem access; the complete fix is to verify the handle after opening (or hold a directory handle for the state dir). | Low, pre-authenticated-access-dependent | Recorded, **not implemented** — no test for it exists yet, and untested security code is worse than a documented gap. |
| F-19-11 | `writeReport` uses `existsSync` then `writeFileSync` to pick its `-2`/`-3` name (TOCTOU overwrite possible under concurrent runs by the same user). | Low | Recorded; single-operator CLI. |
| F-19-12 | The default report directory is `<repo>/reports`, writable by any process that can run the CLI, and the CLI exposes no flag to redirect it. | Low | Recorded; A1 documentation names the path. |
| F-19-05 | `--status` exit-code semantics changed (missing database now exits 1 instead of migrating it silently). Any wrapper `.bat` or external health check must treat 1 as "there is no database to read". | Medium (operational) | Documented in `docs/WINDOWS_OPERATIONS_GUIDE.md` §3.1; **no wrapper was found or modified** in this phase. |
| F-19-06 | A2 verifies declared objects **by name**, not by shape: a table created with the right name and wrong columns satisfies `assertVersionObjectsExist`. | Medium | Recorded as an open finding; closing it needs a column-level manifest comparison, which is beyond the A2 diff reviewed here. |
| F-19-04 (unchanged) | A4 not approved, so `--configure` remains an ungated write that can also advance the schema. | High | **Out of scope by decision.** Not remediated; `docs/WINDOWS_OPERATIONS_GUIDE.md` §3.2 says so plainly. |
| — | No subprocess-level E2E for the gate in the test suite; the CLI layer was verified by the executed runs in §5 and by 6 source-level wiring guards. | — | Stated rather than papered over. |
| — | The A2/A3 diff cannot be isolated by `git diff` (A7 baseline not approved; 78 dirty entries pre-existed), so TDD checkpoint commits were impossible. | — | Recorded as an evidence gap in `PHASE_19_REMEDIATION_REPORT.md` §1. |

---

## 9. Verdicts (kept separate, per mandate §16)

| Decision | Verdict | Basis |
|---|---|---|
| A2 migration-runner hardening | **PASS** | 40 tests + full suite + build, all executed |
| A3 read-only status + gated migration | **PASS**, after closing F-19-08 and F-19-09 | 46 tests across three files + CLI refusals/control + invariant re-check |
| Live V12/V13 migration readiness (A9) | **NO-GO — not approved** | schema still 11, 0 reports against the live tree, second token not set |
| Dashboard readiness | **NOT GO** (10 of 97 panels verified) | Phase 17/18 records unchanged by this work |
| Agent activation readiness | **NO-GO** | `activationApproved=false`, `allowedTools=[]`, `maxChildren=0`, and F-19-04/F-19-06 remain open |

The gate's security property is now: *the approved write is the file at the resolved path
inside the verified state directory, reachable only with a token whose exact value is
`APPROVED`, and never reachable through the activation gate, through `--status`, or through
a link.*
