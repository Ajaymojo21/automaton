# Phase 15K — Backup and Recovery Validation (Operator Guide)

**Control:** prove that a backup can actually be recovered — the archived bytes are the bytes that
were claimed, the SQLite file is structurally sound, the restore runs on a **copy** without
touching any live location, the audit chain works on the restored database, and no archive
contains plaintext key material.
**Result:** ten verdicts, all PASS, exit 0 — nine as recorded in Phase 15K plus
`liveDbGuardNonVacuous`, added in Phase 15M after the guard-path defect in §4 was found.
**Evidence:** [`../../reports/PHASE_15_BACKUP_TEST.md`](../../reports/PHASE_15_BACKUP_TEST.md),
raw output in [`../../reports/PHASE_15_BACKUP_RAW.json`](../../reports/PHASE_15_BACKUP_RAW.json)
**Runner:** [`scripts/phase15-backup-validate.ts`](../scripts/phase15-backup-validate.ts)

---

## 1. Read this first: the live database exists, and it is nearly empty

This is the fact that changes what "recovery tested" means, and getting the path right matters:

| Path | State (re-checked read-only, 2026-10-31) |
|---|---|
| `runtime/home/.automaton/state.db` | **exists**, 512 000 B (+`-shm`, `-wal` 0 B) — this is the live database |
| `<user-home>\.automaton\state.db` | does not exist; that `~/.automaton/` holds only `workspace/` goal dirs |
| `data/` | does not exist |
| `config/` | only `automaton.template.json` and `heartbeat.template.yml` — the live config is `runtime/home/.automaton/automaton.json` |

`dbPath` is `~/.automaton/state.db`, and the `.bat` wrappers set `HOME` to `runtime/home/`, so
**the tilde resolves to the isolated runtime home, not to your user profile.** Any audit that looks
only at `%USERPROFILE%\.automaton\` will report "no database" and be wrong.

What is actually in the live file: `PRAGMA integrity_check` → `ok`; `schema_version` top value
**11** (the archive is 10, so the live file has been opened once and migrated forward); 38 tables;
and exactly one non-empty table, `schema_version` with 10 rows. `security_events`,
`treasury_authorizations`, `security_incidents` and `security_seals` are **absent** — the Phase 15
build has never opened it, so V12 and V13 have not been applied.

Consequences: the restore was validated against the **archived** database; "do not overwrite the
active DB" was proven by construction (a copy into a temp dir) plus a before/after signature of
every live path, including this file; and it was **not** proven against a database holding user
data, because none exists at any path. The first real run creates the Phase 15 tables in the live
file.

## 2. What was validated

Archive `backups/2026-10-31_10-27-31/` — the only state backup in the install, taken during
Phases 10/11. Contents: `state.db` (512 000 B), `state.db-shm`, `state.db-wal` (0 B),
`automaton.redacted.json`, `heartbeat.yml`, `skills/`, `manifest.json`.

| Verdict | Basis | Result |
|---|---|---|
| `manifestHashesMatch` | recompute SHA-256 for each of the 3 manifest entries and compare | PASS — 0 mismatches, 0 missing |
| `archiveIntegrityOk` | `PRAGMA integrity_check` on the archived `state.db`, opened **read-only** | PASS — `ok` |
| `noPlaintextKeyMaterial` | 6 secret patterns (key-shaped JSON fields, PEM headers, hex-key context, OpenAI/Anthropic/AWS key shapes) across every text artifact | PASS — 0 hits |
| `restoreIntegrityOk` | `PRAGMA integrity_check` on the restored copy | PASS — `ok` |
| `restoredChainValid` | append a `restore.validation` security event to the restored copy, then `verifySecurityChain` | PASS — valid, 1 row |
| `restoreMigratedSchema` | the archive is `schema_version` 10; opening it through `createDatabase` must apply V11–V13 | PASS — migrated to 13, `security_events` created |
| `noRowsLostOnRestore` | table-by-table row counts before vs after migration | PASS — 41 tables → 41, none decreased |
| `livePathsUntouched` | per-file SHA-256 signature of `data/`, `config/` and every candidate `~/.automaton/state.db` path, before and after the run | PASS — byte-identical; the live runtime-home database hashes `2a8aeb34…` both before and after. **Before the 15M fix this list resolved to a non-existent path (§4)** |
| `restoreWasDisposable` | the restore destination resolved inside `fs.realpathSync(os.tmpdir())` | PASS — `%TEMP%\conway-15k-restore-*`, deleted on teardown |

## 3. The archive is thin, and that limits what "recovery" means

The archived `state.db` contains exactly one non-empty table: `schema_version` with 10 rows. Every
other table — including `kv`, where a plaintext wallet would have lived — is empty. Consequences,
stated rather than glossed:

1. `noRowsLostOnRestore` is a **weak assertion on this input**: there was nothing to lose. What it
   genuinely proves is that the V10 → V13 migration path runs against an old file and produces a
   working, chain-capable database.
2. **Data preservation across a restore is therefore not demonstrated end-to-end.** The mechanism
   is exercised; a representative dataset is not.
3. The freshest state backup **predates all of Phase 15**. Any recovery today rolls the install
   back to a pre-remediation schema and then migrates it forward — which the test shows works —
   but the Phase 15 audit trail is not in any archive.

This is residual risk **R-2**. Re-run this validation after the first real backup.

## 4. The guard-path defect: what `livePathsUntouched` did not actually protect

The validator snapshots these paths before and after the run
([`scripts/phase15-backup-validate.ts:35`](../scripts/phase15-backup-validate.ts#L35)):

```ts
const LIVE_GUARD_PATHS = ["data", path.join(os.homedir(), ".automaton", "state.db"), "config"];
```

On Windows `os.homedir()` follows `USERPROFILE`, so the second entry resolves to
`<user-home>\.automaton\state.db` — a file that **does not exist**. The live database
is at `runtime/home/.automaton/state.db` (§1). The verdict passed, and it passed because the thing
it was supposed to protect was not in the list it read.

Two things to hold separately:

- **The claim was true.** The validator writes only into `%TEMP%\conway-15k-restore-*` and never
  opens the live file for writing. After the fact, `state.db` was still 512 000 B with mtime
  15:55:59, predating both validator runs, and `-wal` was 0 B. Nothing was damaged.
- **The measurement did not prove it.** That is the difference between a guarantee and a
  lucky-looking green row, and this phase originally published it as a guarantee.

**Fixed on 2026-10-31.** The guard list now resolves through `process.env.HOME` as the launchers
do (with `os.homedir()` as a second candidate), and a tenth verdict, `liveDbGuardNonVacuous`,
fails the run when no candidate database path was actually signed:

```bash
cd <repo-root>
HOME="<repo-root>\\runtime\\home" \
  ./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
  scripts/phase15-backup-validate.ts --archive backups/2026-10-31_10-27-31
# recorded: rc=0, status=PASS, 10/10 verdicts, live DB signed as 2a8aeb34… , before == after

env -u HOME ./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
  scripts/phase15-backup-validate.ts --archive backups/2026-10-31_10-27-31 --out /tmp/scratch.json
# recorded: rc=1, failed verdicts: liveDbGuardNonVacuous  <- the original defect, now detected
```

The second run is the point: it is the negative control that shows the verdict is not tautological.
**Always launch this validator with the same `HOME` the `.bat` wrappers use**, or it will fail —
correctly — because it cannot see the live database.

One side effect to know about when you inspect the live file: opening a WAL-mode database
read-only creates or refreshes `state.db-shm`, so its timestamp moves even though `state.db` and
`state.db-wal` are untouched.

## 5. Secret hygiene of the archives

`automaton.redacted.json` is genuinely scrubbed — verified **by value**, not by filename:

| Field | Archived value |
|---|---|
| `conwayApiKey` / `openaiApiKey` / `anthropicApiKey` | `""` |
| `walletAddress` | `""` |
| `security.activationApproved` | `false` |
| `security.lockdown` | `true` |
| `maxChildren` | `0` |
| `treasuryPolicy.x402AllowedDomains` | `[]` |

The manifest's own `excluded` list records why: `wallet.json` (holds a private key — back up
manually, and only in its encrypted envelope form) and credential values inside `automaton.json`
(re-enter after restore). No `wallet.json` exists in this install and Phase 15 created none.

The scan was extended beyond the validated archive across all five backup directories
(`2026-10-31_10-27-31` plus the four `phase15-pre-*` source snapshots): 33 scannable files,
**0** secret hits. The scanner reports only file, pattern id and count — never the matched text —
so a passing run does not itself become a disclosure channel.

## 6. Tooling gap found, and the substitution made

`scripts/backup-restore.sh` is the upstream CLI and depends on a `sqlite3` binary
(`SQLITE3="${SQLITE3:-sqlite3}"`). **That binary is not present on this host**, so its `verify`,
`backup` and `restore` subcommands cannot run as written.

Its logic is sound and it does the right things — checkpoint the WAL, use an atomic backup, verify
before restoring. `scripts/phase15-backup-validate.ts` reimplements the same three steps through
the `better-sqlite3` binding the app already ships with, so validation does not depend on a system
binary the install never provided. **This is a documented substitution, not a fix to the script**;
changing the script was out of scope while the phase still had to be reported. If you want the
CLI usable, install a `sqlite3` binary or port the script to the Node binding — either is your
call, and neither was taken here.

## 7. The restore procedure this validates

```bash
# 1. never restore onto a live database — restore onto a copy in a scratch directory
cp backups/<archive>/state.db  "$SCRATCH/restored.db"

# 2. open it through the app so migrations apply in order
#    (createDatabase runs V11, V12, V13; V12/V13 add the hash chain and incident tables)

# 3. confirm structure and chain before pointing anything at it
#    PRAGMA integrity_check  ->  'ok'
#    verifySecurityChain()   ->  { valid: true }

# 4. only then, with the automaton stopped, replace the live file
#    and keep its -wal and -shm siblings consistent
```

The script performs steps 1–3 automatically and deletes the scratch directory. **Step 4 is
deliberately manual** — Phase 15 forbids the runner from overwriting live state, and you should
keep it that way: a backup tool that can silently replace a running database is a worse failure
mode than a restore that needs a human.

## 8. Running it

```bash
cd <repo-root>
./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
  scripts/phase15-backup-validate.ts
```

Recorded: `status=PASS`, exit code 0, no failed verdicts. Re-run it (a) after any schema change,
(b) after the first real backup containing actual data, and (c) as part of any incident response
where the audit chain is suspect — the restored-chain verdict is what tells you whether your last
known-good copy is actually usable.

## 9. Operating notes

- **Backups stay out of `%USERPROFILE%` shares.** Controlled Folder Access is off and disk
  encryption is unverified on this host
  ([PHASE_15_WINDOWS_SECURITY.md](PHASE_15_WINDOWS_SECURITY.md)).
- **A restore is a rollback of the audit trail.** The restored database reopens with whatever
  events the archive held; the events after that point are gone. If the incident history matters
  for an investigation, export it before restoring.
- **Migrations run forward automatically** on open (V11 → V13). There is no downgrade path, so
  once a restored copy has been opened by the current build, do not point an older build at it.
- **Rotate through the Phase 11 backup schedule** rather than trusting the single 2026-10-31
  archive; today that archive is the only state backup that exists.

## 10. Residual risks

1. **Restore proved structurally, not data-wise** (§3) — residual R-2.
2. **The freshest archive predates Phase 15**, so no current audit trail is recoverable. The live
   database is also pre-Phase-15 (schema V11, V12/V13 not applied), so there is nowhere yet to
   recover a hash chain from.
3. **The upstream CLI remains unrunnable on this host** (`sqlite3` missing); validation covers the
   same steps but the operator-facing command is still broken.
4. **No live-database contention case.** A restore attempt against a database with an active WAL
   from a running process was never exercised, because nothing was running.
5. **The live database holds no user data yet**, so `livePathsUntouched` — now genuinely signed at
   §4 — still protects a file whose only content is schema history. Re-run after the first real
   cycle to make the guarantee mean something.
6. **`~` resolution is platform-fragile in general.** `resolvePath` (src/config.ts:201) uses
   `process.env.HOME || "/root"`. In an ambient shell with no `HOME`, every `~` path in the config
   resolves under `/root` → `C:\root\…` on this host. Launch through the `.bat` wrappers, which set
   `HOME`, or you will be reading and writing a different state tree than you think.
