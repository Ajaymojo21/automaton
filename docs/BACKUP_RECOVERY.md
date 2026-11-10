# BACKUP AND RECOVERY — Phase 11

**Backup utility:** `runtime/bin/backup.mjs` (via `BACKUP_CONWAY.bat`)
**Restore utility:** `runtime/bin/restore.mjs`
**Latest backup:** `backups/2026-10-31_10-27-31`
**Latest restore test:** `runtime/tmp/restore-test` — integrity verified

---

## 1. Design

The upstream `scripts/backup-restore.sh` requires bash and the `sqlite3` CLI, which is
not installed on this machine. It was **not executed**. A Node utility using the same
`better-sqlite3` library the app already loads replaces it, so no new dependency was
introduced.

The backup deliberately separates **state** from **secrets**:

| Item | Backed up | Reason |
|---|---|---|
| `state.db` | Yes, consistent snapshot via SQLite online backup API | Agent state |
| `heartbeat.yml` | Yes | Schedules |
| `automaton.json` | Yes, credential-shaped values **redacted** | Reusable settings without secrets |
| `constitution.md`, `SOUL.md`, `skills/` | Yes, if present | Behavioural context |
| `wallet.json` | **Never** | Private key must be backed up manually to encrypted storage |
| Provider API keys | **Never** | Must be re-entered after restore |
| Logs | No | Operational, not state |

Every backup writes `manifest.json` containing SHA-256 and byte size per file, plus a
`quick_check` result for the database. Stray `-shm`/`-wal` files created during the
snapshot are removed so the backup is self-contained.

---

## 2. Creating a backup

```
BACKUP_CONWAY.bat
```

or, with a custom destination:

```
node runtime/bin/backup.mjs --out D:\automaton-backups\2026-10-31
```

Destination defaults to `backups/<UTC timestamp>/`.

### 2.1 Verified result of the latest run

| File | Bytes | SHA-256 | Integrity |
|---|---|---|---|
| `state.db` | 512,000 | `2cc9d26ce4a20b3bd9a04d92c8c3a7940380ecd81665eacf9c215cd2faf765ff` | ok |
| `automaton.redacted.json` | 1,382 | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | redacted |
| `heartbeat.yml` | 860 | `1360e959c250844aedf7d9657ffb07df3b31c198e41a297d55007ec83aa7ace8` | — |

Manifest also records:

```
"excluded": [
  "wallet.json (holds private key; back up manually with encryption)",
  "credential values inside automaton.json (re-enter after restore)"
]
```

The backup utility prints the same warning to the console every run.

---

## 3. Restoring

Restore is intentionally **explicit and non-destructive by default**.

```
node runtime/bin/restore.mjs --from backups/2026-10-31_10-27-31 --to runtime/tmp/restore-test
```

| Behaviour | Detail |
|---|---|
| Manifest required | Aborts if `manifest.json` is missing |
| Hash verification | Every listed file is hashed and compared before copying |
| DB verification | `quick_check` on the restored copy before it is accepted |
| Live-directory protection | Refuses to write into the live `~/.automaton` unless `--allow-live` is passed |
| Partial writes | Aborts on the first mismatch |

### 3.1 Verified restore test

A restore into `runtime/tmp/restore-test` completed:

- `state.db` copied at 512,000 bytes, `quick_check ok`;
- `heartbeat.yml` and `automaton.json` (redacted) copied;
- `wallet.json` absent, as expected;
- no files were written to the live directory.

**To restore into the live installation** (destructive — requires a stopped runtime and
a fresh backup of current state first):

```
STOP_CONWAY.bat
BACKUP_CONWAY.bat
node runtime/bin/restore.mjs --from <backupDir> --to runtime/home/.automaton --allow-live
```

Then re-enter provider credentials in `automaton.json`. The restored config contains
empty/redacted credential fields by design. If a wallet existed, it was not in the
backup; recreate or manually restore it from encrypted storage.

---

## 4. Wallet backup (manual, separate)

`BACKUP_CONWAY.bat` will **never** copy `wallet.json`. If a wallet is created later:

1. Stop the runtime.
2. Copy `runtime/home/.automaton/wallet.json` to an encrypted container
   (BitLocker-protected volume, password manager attachment, or encrypted archive).
3. Do not place it in cloud sync folders, email, chat, or Git.
4. Verify the copy by decrypting it on a separate occasion.
5. Record the public address only.

Losing this file without a separate encrypted copy means losing the wallet
permanently. There is no recovery mechanism in the app.

---

## 5. Retention

No automatic pruning is implemented. Recommended policy:

| Type | Keep | Where |
|---|---|---|
| Daily state backups | 14 | Project `backups/` (same disk) |
| Weekly state backups | 8 | A second physical disk or encrypted external drive |
| Pre-upgrade backup | Until the upgrade is verified | Either |
| Wallet key backup | Indefinite, encrypted | Offline/encrypted, never the project tree |

Copy backups off the project volume periodically: a backup on the same disk does not
protect against disk failure or ransomware.

---

## 6. Recovery scenarios

| Scenario | Procedure |
|---|---|
| Corrupt `state.db` | Stop runtime; restore latest verified backup with `--allow-live`; run `HEALTH_CHECK.bat` |
| Accidental config change | Restore redacted config, re-enter credentials, audit |
| Disk full | Free space; `rotate-logs.mjs`; verify DB integrity |
| Ransomware / mass encryption | Restore from off-disk backup; do not pay; audit credentials |
| Lost wallet | No recovery unless a manual encrypted backup exists |

---

## 7. Phase verdict

**COMPLETE — BACKUP AND RESTORE VERIFIED.** A consistent, redacted, hash-manifested
backup was created, and a restore into a disposable directory passed integrity
checks. Secrets are excluded by design and the gap is documented rather than hidden.
