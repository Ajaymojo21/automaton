# Phase 15K — Backup and Recovery Hardening

Date: 2026-10-31 · Runner: [scripts/phase15-backup-validate.ts](file:///<repo-root>/scripts/phase15-backup-validate.ts) · Raw evidence: [reports/PHASE_15_BACKUP_RAW.json](file:///<repo-root>/reports/PHASE_15_BACKUP_RAW.json)

## Objective

Prove that a backup can actually be recovered: the archived bytes are the bytes that were
claimed, the SQLite file is structurally sound, the restore path runs on a copy without
touching any live location, the audit chain works on the restored database, and no archive
contains plaintext key material.

## What was validated

Archive `backups/2026-10-31_10-27-31/` — the only state backup in the install, taken during
Phase 10/11. Contents: `state.db` (512 000 B), `state.db-shm`, `state.db-wal` (0 B),
`automaton.redacted.json`, `heartbeat.yml`, `skills/`, `manifest.json`.

| Verdict | Basis | Result |
| --- | --- | --- |
| `manifestHashesMatch` | recompute SHA-256 for each of the 3 manifest entries and compare | PASS — 0 mismatches, 0 missing |
| `archiveIntegrityOk` | `PRAGMA integrity_check` on the archived `state.db`, opened read-only | PASS — `ok` |
| `noPlaintextKeyMaterial` | 6 secret patterns (key-shaped JSON fields, PEM headers, hex-key context, OpenAI/Anthropic/AWS key shapes) across every text artifact | PASS — 0 hits |
| `restoreIntegrityOk` | `PRAGMA integrity_check` on the restored copy | PASS — `ok` |
| `restoredChainValid` | append a `restore.validation` security event to the restored copy, then `verifySecurityChain` | PASS — valid, 1 row |
| `restoreMigratedSchema` | the archive is `schema_version` 10; opening it through `createDatabase` must apply V11–V13 | PASS — migrated to 13, `security_events` created |
| `noRowsLostOnRestore` | table-by-table row counts before vs after migration | PASS — 41 tables → 41 tables, none decreased |
| `livePathsUntouched` | signature of `data/`, `~/.automaton/state.db` and `config/` (per-file SHA-256) taken before and after the whole run | PASS — byte-identical. **As first recorded this proved less than it appeared to: the `state.db` entry resolved to a path that does not exist. See "Guard-path defect" below — fixed and re-run in 15M** |
| `restoreWasDisposable` | the restore destination resolved inside `fs.realpathSync(os.tmpdir())` | PASS — `%TEMP%\conway-15k-restore-*`, deleted on teardown |
| `liveDbGuardNonVacuous` | **added in 15M:** at least one candidate `~/.automaton/state.db` must actually have been signed, so the guard cannot pass vacuously | PASS after the fix — live DB `2a8aeb34…` identical before and after; **FAIL (rc=1) in the negative control run with `HOME` unset** |

Overall as recorded in 15K: `status=PASS`, exit code 0, 9/9 verdicts.
Overall after the 15M fix and re-run: `status=PASS`, exit code 0, **10/10 verdicts**, and the
`livePathsUntouched` guarantee now covers the database the launchers actually use.

## Live-state inventory (important context, not a pass)

> **Correction 2026-10-31, during 15M.** This section as first written said "There is **no active
> database in this install**" and listed three paths. That was wrong in its reasoning, though the
> conclusion it supported still holds. The check looked at `data/`, at
> `<user-home>\.automaton\state.db` (the *ambient* user profile) and at `config/`.
> It did not look at `runtime/home/.automaton/`, which is where the database actually lives for
> every launch through the `.bat` wrappers: `dbPath` is `~/.automaton/state.db` and the wrappers
> set `HOME` to `runtime/home/`. Re-checked read-only against the real file:
>
> ```
> runtime/home/.automaton/state.db   512 000 B (+ -shm, -wal 0 B)
>   schema_top           = 11            (archive is 10, so the live file migrated forward once)
>   table_count          = 38
>   nonempty tables      = ["schema_version=10"]
>   security_events      = absent
>   treasury_authorizations = absent
>   security_incidents / security_seals = absent
>   PRAGMA integrity_check = ok
>   opened readonly:true — no write, no migration attempted
> ```
>
> So a live database **does** exist; it is simply empty apart from `schema_version`, and it has
> never been opened by the Phase 15 build — V12 and V13 have not been applied to it. The substance
> of the finding is unchanged and, if anything, sharper: **the only populated content anywhere in
> this install is the schema history**, no archive holds a Phase 15 audit trail, and the first
> real run creates the Phase 15 tables in the live file. `~/.automaton/` in the ambient profile
> still contains only `workspace/` goal directories.

What the original check did establish, restated against the correct paths:

- `data/` does not exist.
- `<user-home>\.automaton\state.db` does not exist; `~/.automaton/` there contains
  only `workspace/` goal directories.
- `config/` contains only `automaton.template.json` and `heartbeat.template.yml` — there is no
  live `automaton.json` (the live config is `runtime/home/.automaton/automaton.json`).
- the live `runtime/home/.automaton/state.db` is empty but for `schema_version`, and predates V12.

So the restore was validated against the archived database, and the "do not overwrite the
active DB" guarantee was proven by construction (a copy into a temp dir) plus the before/after
signature of every live path — including, in the re-check, the runtime-home file itself. It was
not proven against a database holding user data, because none exists at any path. The first real
run creates the Phase 15 tables in the live file.

## Guard-path defect found during 15M (recorded, not silently fixed)

`livePathsUntouched` compares SHA-256 signatures of `LIVE_GUARD_PATHS` before and after the run
(`scripts/phase15-backup-validate.ts:35`):

```ts
const LIVE_GUARD_PATHS = ["data", path.join(os.homedir(), ".automaton", "state.db"), "config"];
```

On Windows `os.homedir()` follows `USERPROFILE`, so that entry resolves to
`<user-home>\.automaton\state.db` — **a path that does not exist**. The guard
therefore signed nothing at the location the live database actually occupies
(`runtime/home/.automaton/state.db`, because the wrappers set `HOME` to `runtime/home/` and
`dbPath` is `~/.automaton/state.db`). A verdict that passes because the thing it protects is
absent is a cosmetic PASS, and this one was reported as a guarantee.

**Fixed during 15M** (the defect was in the *measurement*, so the fix is to the validator and then
a re-run, not to a recorded PASS left standing):

```ts
function liveGuardPaths(): string[] {
  const homes = [process.env.HOME, os.homedir()].filter((h): h is string => Boolean(h));
  const dbPaths = homes.map((home) => path.join(home, ".automaton", "state.db"));
  return Array.from(new Set(["data", "config", ...dbPaths]));
}
```

plus a tenth verdict that cannot pass vacuously:

```ts
liveDbGuardNonVacuous: Object.entries(parts.liveBefore)
  .filter(([target]) => target.endsWith(path.join(".automaton", "state.db")))
  .some(([, signature]) => signature !== "absent"),
```

Re-run **with `HOME` set exactly as the `.bat` wrappers set it**
(`HOME=<repo-root>\runtime\home`), `--archive backups/2026-10-31_10-27-31`:

```
rc=0
15K: archive=2026-10-31_10-27-31 manifest=true secrets=0 restore=ok chain=true status=PASS
verdicts (10, all true): manifestHashesMatch, archiveIntegrityOk, noPlaintextKeyMaterial,
  restoreIntegrityOk, restoredChainValid, restoreMigratedSchema, noRowsLostOnRestore,
  livePathsUntouched, liveDbGuardNonVacuous, restoreWasDisposable
live guard paths signed:
  data                                                     => absent
  config                                                   => automaton.template.json:…
  <repo-root>\runtime\home\.automaton\state.db => 2a8aeb3494f1507a352f591c…
  <user-home>\.automaton\state.db            => absent
before == after: true
node v22.23.4
```

**Negative control, so the new verdict is not tautological.** The same command with `HOME`
unset (`env -u HOME`, writing to a scratch report so the official evidence was not overwritten):

```
rc=1   status=FAIL   failed verdicts: liveDbGuardNonVacuous
```

— exactly the original defect reproduced, now detected instead of passed. Typecheck of the edited
script: `tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict
--esModuleInterop --skipLibCheck --resolveJsonModule scripts/phase15-backup-validate.ts` → **exit 0**.
Pre-edit content of both changed regions is recorded in `backups/phase15M-pre-20261031-233344/`
with `MANIFEST.sha256`.

The nine verdicts in the table above are unchanged by the fix — the archive, the restore and the
secret scan all behaved the same way. What changed is that `livePathsUntouched` is now a real
guarantee about the live database, and that the report says which path it means.

Side effect of the read-only re-check worth knowing: `state.db-shm` carries a 23:29 timestamp
because opening a WAL-mode database read-only creates or refreshes it. `state.db` (512 000 B,
15:55:59) and `state.db-wal` (0 B) are unmodified, and the run's before/after signature of the
database itself is byte-identical.

## The archive is thin, and that limits what "recovery" means here

The archived `state.db` contains exactly one non-empty table: `schema_version` with 10 rows.
Every other table — including `kv`, which is where a plaintext wallet would have lived — is
empty. Consequences, stated rather than glossed:

1. `noRowsLostOnRestore` is a weak assertion on this input: there was nothing to lose. What
   it genuinely proves is that the V10 → V13 migration path runs against an old file and
   produces a working, chain-capable database.
2. Data preservation across a restore is therefore **not** demonstrated end-to-end by this
   phase. The mechanism is exercised; a representative dataset is not.
3. The freshest state backup predates all of Phase 15. Any recovery today rolls the install
   back to a pre-remediation schema and then migrates it forward — which the test shows
   works, but the audit trail from Phase 15 itself is not in any archive.

## Secret hygiene of the archives

The archived `automaton.redacted.json` is genuinely scrubbed, verified by value rather than
by the filename:

| Field | Archived value |
| --- | --- |
| `conwayApiKey` | `""` |
| `openaiApiKey` | `""` |
| `anthropicApiKey` | `""` |
| `walletAddress` | `""` |
| `security.activationApproved` | `false` |
| `security.lockdown` | `true` |
| `maxChildren` | `0` |
| `treasuryPolicy.x402AllowedDomains` | `[]` |

The manifest's own `excluded` list records why: `wallet.json` (holds a private key; back up
manually with encryption) and credential values inside `automaton.json` (re-enter after
restore). No `wallet.json` exists in this install, and none was created by Phase 15.

The scan was extended beyond the validated archive across all five backup directories
(`2026-10-31_10-27-31` plus the four `phase15-pre-*` source snapshots): 33 scannable files,
**0** secret hits. The scanner reports only file, pattern id and count — never the matched
text, so a passing run does not itself become a disclosure channel.

## Tooling gap found and worked around

`scripts/backup-restore.sh` is the upstream CLI and it depends on a `sqlite3` binary
(`SQLITE3="${SQLITE3:-sqlite3}"`). That binary is not present on this host, so its `verify`,
`backup` and `restore` subcommands cannot run as written. Its logic is sound and it does the
right things (checkpoint the WAL, use an atomic backup, verify before restore); the
Phase 15K runner reimplements the same three steps through the `better-sqlite3` binding the
app already ships with, so validation does not depend on a system binary the install never
provided. This is a documented substitution, not a fix to the script — changing it is out of
scope while the phase still has to be reported.

## Restore procedure this validates (for the operator)

```
# 1. never restore onto a live database — restore onto a copy in a scratch directory
cp backups/<archive>/state.db  "$SCRATCH/restored.db"
# 2. open it through the app so migrations apply in order
#    (createDatabase runs V11, V12, V13; V12/V13 add the hash chain and incident tables)
# 3. confirm structure and chain before pointing anything at it
#    PRAGMA integrity_check → 'ok'; verifySecurityChain → { valid: true }
# 4. only then, with the automaton stopped, replace the live file, keeping its -wal/-shm siblings consistent
```

The script performs steps 1–3 automatically and deletes the scratch directory. Step 4 is
deliberately manual: Phase 15 forbids the runner from overwriting live state.

## Constraint compliance

No live database was created, modified or deleted. No wallet was created and no key material
was generated, read or displayed. No restoration targeted the configured live path. The temp
scratch directory was removed on teardown (`finally`, so it is removed even on failure).
Read-only opens were used for the archive itself. No Windows security setting, service or
scheduled task was touched.
