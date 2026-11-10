# Phase 16C — Real-Data Backup and Restore Validation

**Section 7 of the Phase 16 brief.** Executed 01-11-2026, 13:52–14:05 IST, against the live
install at `<repo-root>`. Every number in this file came from a command that
was actually run; the command is printed with each result.

Headline verdict:

| Item | Verdict |
|---|---|
| Consistent backup of the live `state.db` | **VERIFIED** — archive content equals live content exactly |
| Restore drill into an alternate path | **VERIFIED** — 10/10 harness verdicts PASS, live DB untouched |
| Live database unmodified by the whole exercise | **VERIFIED** — SHA-256 identical before and after |
| **Real-data** restore (recovering actual user data) | **NOT YET PROVABLE** — the live DB contains zero user rows (measured, see §3) |
| Backup excludes private keys | **VERIFIED** by automated test against a planted fixture (`wallet.json` never archived, config values redacted) |
| Schema V12/V13 migration of the live DB | **NOT EXECUTED** — deliberately; operator-visible step (R-14), see §8 |

No activation gate, approval or security invariant was changed (§10 list re-verified in §9).

---

## 1. Method: reuse, not new code

Two vetted tools already existed and were used as-is:

1. `runtime/bin/backup.mjs` — the tool the operator actually runs. Uses the **SQLite online
   backup API** (`better-sqlite3` `.backup()`), copies `heartbeat.yml` / `skills/`, writes
   `automaton.json` with credential-shaped fields redacted, **refuses to copy `wallet.json`**, and
   emits `manifest.json` with SHA-256 + byte counts.
2. `scripts/phase15-backup-validate.ts` — the Phase 15K restore harness. Verifies manifest hashes,
   scans every artifact for plaintext key material, restores the archive **into a disposable
   directory under `os.tmpdir()`**, then asserts `livePathsUntouched` and
   `liveDbGuardNonVacuous`. It never restores over an active database.

One new automated suite was added to make the guarantees re-runnable rather than one-off (§6).
No production source file was modified in this section, so no `.bak`/SHA-256 pre-record was
required for it.

The obsolete POSIX helper `scripts/backup-restore.sh` was read but **not** used — see §7 (R-20).

---

## 2. State of the live database before anything ran

```
$ sha256sum runtime/home/.automaton/state.db
2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba
```

Read-only probe (`reports/PHASE_16_16C_EVIDENCE.cjs`, pinned Node 22.23.4,
`new Database(path, {readonly:true, fileMustExist:true})`), full JSON in
`reports/PHASE_16_16C_EVIDENCE.json`:

| Measurement | Value |
|---|---|
| bytes | 512 000 |
| `integrity_check` | `ok` |
| `journal_mode` | `wal` |
| `user_version` | 0 |
| tables | 37 |
| non-empty tables | **1** — `schema_version` (10 rows) |
| total rows in the entire database | **10** |

Side files: `state.db-wal` = **0 bytes**, `state.db-shm` = 32 768 bytes. A zero-length WAL holds no
frames, so the main file already contained every committed page at the moment of measurement — but
that is a point-in-time observation, not a property to rely on (§7).

## 3. How much real data exists — the decisive measurement

The 10 rows are migration bookkeeping, not user data:

```
schema_version: version 2,3,4,5,6,7,8,9,10,11 — all applied_at "2026-10-31 10:25:59"
```

Every other table is empty. The 36 zero-row tables are the ones that would hold anything a user
would care about recovering:

`child_lifecycle_events, children, discovered_agents_cache, episodic_memory, event_stream, goals,
heartbeat_dedup, heartbeat_entries, heartbeat_history, heartbeat_schedule, identity,
inbox_messages, inference_costs, installed_tools, knowledge_store, kv, metric_snapshots,
model_registry, modifications, onchain_transactions, policy_decisions, procedural_memory, registry,
relationship_memory, reputation, semantic_memory, session_summaries, skills, soul_history,
spend_tracking, task_graph, tool_calls, transactions, turns, wake_events, working_memory`

That includes `episodic_memory`, `semantic_memory`, `working_memory`, `turns`, `tool_calls`,
`transactions`, `onchain_transactions`, `spend_tracking`, `identity` and `soul_history` — all zero.
The agent has never run a live cycle against this database, consistent with every activation gate
being closed.

> **`REAL_DATA_RESTORE = NOT YET PROVABLE`**
>
> **Why:** there is no genuine user data to recover. §7 of the brief forbids fabricating test data
> to claim successful real-data recovery, so no rows were inserted into the live database to make a
> nicer-looking assertion.
>
> **What would make it provable:** run the agent (or the dashboard, which writes nothing) long
> enough to produce at least one row in a user-data table, take a fresh archive, then restore it to
> an alternate path and diff row-for-row. The tooling, the test suite and the operator procedure
> below already support that; only the data is missing.
>
> **What *is* proven:** the backup is byte-consistent and content-complete against the real live
> file, and a restore of that real file lands correctly, migrates and stays writable — on a copy,
> never on the active database.

## 4. The backup that was taken

```
$ HOME="<repo-root>\runtime\home" \
  ./runtime/node-v22.23.4-win-x64/node.exe runtime/bin/backup.mjs
[PASS] state.db backed up and verified (512000 bytes)
[PASS] automaton.json backed up with credentials redacted
[PASS] heartbeat.yml
[PASS] skills/
Backup complete: <repo-root>\backups\2026-11-01_08-24-20
```

`HOME` was verified in the same shell as `<repo-root>\runtime\home` (§3 of the
brief) before the tool ran; `node=v22.23.4`.

`manifest.json` records:

| File | SHA-256 | bytes |
|---|---|---|
| `state.db` | `2cc9d26ce4a20b3bd9a04d92c8c3a7940380ecd81665eacf9c215cd2faf765ff` | 512 000 |
| `automaton.redacted.json` | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | 1 382 |
| `heartbeat.yml` | `1360e959c250844aedf7d9657ffb07df3b31c198e41a297d55007ec83aa7ace8` | 860 |

`excluded`: `wallet.json (holds private key; back up manually with encryption)`,
`credential values inside automaton.json (re-enter after restore)`.

**Live vs archive content comparison** (`reports/PHASE_16_16C_COMPARE.cjs`, both handles readonly):

```json
"comparison": {
  "sameTableSet": true,
  "tablesWithDifferentRowCount": [],
  "tablesWithDifferentRowContent": [],
  "identicalContent": true,
  "sameByteSize": true
}
IDENTICAL=true liveRows=10 backupRows=10
```

Per-table SHA-256 of ordered row content matched for all 37 tables, `schema_version` rows matched
exactly (V2..V11), and both files reported `integrity_check = ok`.

### Finding: a hash comparison would have failed a good backup

Live `state.db` hashes to `2a8aeb34…`; the archive of it hashes to `2cc9d26c…` — **different hashes,
identical content, identical size**. The backup API rewrites the destination header (change
counter/freelist bookkeeping), so the files are not byte-identical even when the data is.

This matters because "compare the backup hash to the live hash" is the intuitive acceptance test,
and it is wrong: it fails 100% of correct backups. Acceptance must be
`integrity_check = ok` **+** content equality (the 15K harness compares the archive against *its
own manifest*, which is the correct use of a hash — tamper detection, not source equality).
`sha256LiveEqualsArchive: false` is therefore recorded as an expected result in
`reports/PHASE_16_16C_EVIDENCE.json`, and the new suite pins the criterion (§6).

## 5. The restore drill

```
$ ./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
    scripts/phase15-backup-validate.ts \
    --archive backups/2026-11-01_08-24-20 \
    --out reports/PHASE_16_16C_RESTORE_RAW.json
15K: archive=2026-11-01_08-24-20 manifest=true secrets=0 restore=ok chain=true status=PASS
EXIT=0
```

`generatedAt: 2026-11-01T08:25:04.105Z`, `nodeVersion: v22.23.4`. All ten verdicts PASS:

| Verdict | Result | What it actually means |
|---|---|---|
| `manifestHashesMatch` | true | 3/3 manifest entries re-hashed identically; no drift since the backup |
| `archiveIntegrityOk` | true | `integrity_check = ok` on the archived DB |
| `noPlaintextKeyMaterial` | true | 6 secret patterns scanned across every artifact — **0 hits** |
| `restoreIntegrityOk` | true | the restored copy is a sound database |
| `restoredChainValid` | true | audit-chain verification passed after a real append |
| `restoreMigratedSchema` | true | `security_events` exists on the restored copy |
| `noRowsLostOnRestore` | true | 0 tables lost rows across migration |
| `livePathsUntouched` | true | before/after signatures identical |
| `liveDbGuardNonVacuous` | true | the guard signed a *real* path, not an empty list |
| `restoreWasDisposable` | true | restore destination was under the OS temp directory |

Restored-copy measurements: `schemaVersion` **13** (the archived file is V11 — the application
migrated it on open), `tablesBefore/tablesAfter` 41/41, `securityEventsAfterWrite` 1,
`chainValid` true.

**The active database survived the entire exercise untouched:**

```
$ sha256sum runtime/home/.automaton/state.db     # after backup AND restore drill
2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba     # unchanged
```

The harness signed both candidate live paths — the correct isolated one
(`…\runtime\home\.automaton\state.db`, hash above) and the default Windows one
(`<user-home>\.automaton\state.db`, `absent`) — so the §3 HOME-isolation rule is
also covered by this evidence: no state directory was created outside `runtime\home`.

## 6. New automated coverage

`src/__tests__/security/phase16-backup-roundtrip.test.ts` — **8 passed**, explicit typecheck
**exit 0** (vitest strips types, so the suite being green is not proof it typechecks; both were
run). Every database it touches lives in a fresh `os.tmpdir()` fixture; it never opens the live DB.

| Test | Proves |
|---|---|
| online backup under a concurrent writer | 2 000-row WAL DB snapshotted while 80 further rows are appended; snapshot passes `integrity_check`, ids stay dense, every payload still hashes to its own id (a torn copy would break this), and **the source file hash is unchanged** |
| naive copy loses committed rows | measured: a `cp` of the main file alone while the WAL holds frames restores **5** rows; the backup API of the same source restores **6**. This is why `cp` is not the backup mechanism |
| honours the isolated HOME | runs the real `runtime/bin/backup.mjs` with `HOME` pointed at a fixture; archives that HOME's `state.db`, and creates nothing at the other HOME |
| never archives `wallet.json` | a `wallet.json` holding a planted private key sits next to the DB before the run (precondition asserted); the archive tree contains no `wallet.json` and no planted secret |
| redacts credential-shaped fields | planted `apiKey`/`privateKey` values become `<REDACTED>`; non-vacuity asserted by confirming the planted value *is* present in the source file |
| manifest hashes are verifiable | every manifest entry re-hashed and byte-count checked |
| restore lands on an alternate path | archive → `restored/state.db` while the active DB keeps growing to 150 rows; the restored copy holds the 100-row snapshot, the active file's hash is unchanged by the restore, and the restored copy is then **opened and written to** |
| no stale WAL sidecar carried into a restore | the restored location has no `-wal`/`-shm` siblings, and the copy opens clean |

## 7. WAL and side-file caveats (operational)

- Read-only opens of a WAL-mode database **recreate `-shm` (and sometimes a 0-byte `-wal`) next to
  the file**. Both the live directory and the new archive show side files timestamped after their
  own creation (14:02 vs 13:54) purely because verification opened them. They are 0/32 768 bytes
  and hold no frames, so they are harmless here — but they are **not** covered by `manifest.json`,
  and a future restore that blindly copies `-wal`/`-shm` alongside `state.db` could resurrect
  frames whose salt no longer matches the main file. **Restore procedure: copy `state.db` alone and
  delete any `-wal`/`-shm` at the destination first.** The suite asserts the sidecar-free case.
- `runtime/bin/backup.mjs` deletes the side files it creates during verification, but a later
  read-only open brings `-shm` back. That is SQLite behaviour, not a defect in the tool.

### R-20 (new, recorded — not fixed): `scripts/backup-restore.sh` will overwrite any target it is given

`scripts/backup-restore.sh` `do_restore` copies `<backup_path>` straight onto `<db_path>`
(`cp "$backup_path" "$db_path"`, then also copies `-wal`/`-shm`), with an integrity check on the
*source* but no refusal of a live destination. It does timestamp a `state.db.pre-restore.<epoch>`
copy first, so the operation is recoverable, and it only runs when an operator types the target
explicitly — there is no automated caller anywhere in `src/` (grep: no references).

Assessment: **Low, operator-only, accepted for now.** §7's rule "never overwrite the active DB" is
satisfied by using the 15K harness / the new suite instead, which is what Phase 16C did. Fixing the
shell script is not free: it is a POSIX script on a Windows-local host, and its `wal_checkpoint` +
`cp` approach is the same class of problem §4/§6 identified. It is **not** wired to the dashboard —
the Phase 17 brief requires restore to need explicit confirmation and never to overwrite active
state automatically, so the dashboard's restore path must be built against an alternate-destination
model instead of this script.

## 8. Schema drift was observed, not silently "fixed"

The archived database is **V11** (`user_version` is 0; the `schema_version` table tops out at 11),
while the code is **V13** — R-14 from the gap analysis, reconfirmed here. The restore drill showed
the application migrating a *copy* from V11 to V13 without losing a row.

The live database was **not** migrated. `createDatabase()` migrates on open, so opening the live
file through the application would rewrite it. That is a real change to active state and is left as
an explicit operator step, not something 16C did quietly:

```
# Operator decision point — rewrites the live file. Take a fresh archive first.
# (existing archive: backups/2026-11-01_08-24-20)
```

## 9. Invariants re-read after the exercise (through the application's own loader)

`loadConfig("runtime/home/.automaton/automaton.json")` with `HOME` = the isolated runtime home:

```json
{"lockdown":true,"activationApproved":false,"allowedTools":[],"selfHealingEnabled":false,
 "allowFinancialTools":false,"allowHostShell":false,"allowReplication":false,
 "allowExternalExposure":false,"maxChildren":0,"dbPath":"~/.automaton/state.db",
 "openaiApiKeyLen":0,"conwayApiKeyLen":0}
```

Note `selfHealingEnabled` is **absent from the JSON file** and resolves to `false` via
`src/config.ts:169-172` + `DEFAULT_SECURITY_CONFIG` (`src/types.ts:693`) — reported as resolved, not
as written. Activation env vars `CONWAY_ACTIVATION` and `CONWAY_ALLOW_WALLET_CREATION` are both
unset. `runtime/home/.automaton/wallet.json` does **not** exist (`No such file or directory`), so no
wallet was ever created and none was backed up.

## 10. What this section does NOT claim

- It does **not** claim a real-data recovery was demonstrated. `REAL_DATA_RESTORE = NOT YET
  PROVABLE`, for the measured reason in §3.
- It does not prove the backup API is safe against a *live concurrent agent* writing to the actual
  production file — the agent is inactive, so the concurrency proof comes from the equivalent
  fixture test (§6), not from a live write race.
- It does not prove off-host durability: every artifact stayed on this machine.
- It does not prove encryption-at-rest — BitLocker remained UNVERIFIED without elevation (16B).
- It does not restore the config's credential fields, which are redacted by design; a restored
  install needs keys re-entered by the operator. Today there are none to re-enter.

## 11. Reproduce

```bash
cd <repo-root>
export HOME="<repo-root>\runtime\home"
N=./runtime/node-v22.23.4-win-x64/node.exe

$N runtime/bin/backup.mjs                       # → backups/<UTC stamp>/
$N reports/PHASE_16_16C_EVIDENCE.cjs            # live (+ ARCHIVE_DB for the comparison)
$N reports/PHASE_16_16C_COMPARE.cjs \
   runtime/home/.automaton/state.db backups/<stamp>/state.db
$N node_modules/tsx/dist/cli.mjs scripts/phase15-backup-validate.ts \
   --archive backups/<stamp> --out reports/PHASE_16_16C_RESTORE_RAW.json
$N node_modules/vitest/vitest.mjs run src/__tests__/security/phase16-backup-roundtrip.test.ts
```

**Phase 16C verdict: PARTIALLY VERIFIED.** Backup and restore mechanics are VERIFIED against the
real live database with the active file provably untouched; genuine *real-data* recovery is NOT YET
PROVABLE because the database holds 10 rows of migration bookkeeping and nothing else. All
activation gates remain closed.
