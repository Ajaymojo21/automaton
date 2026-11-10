# B-10 Backup and Restore Verification

- Date: 2026-11-10
- Shared policy: `runtime/lib/wallet-material.mjs` (`isWalletFile`, `assertPlainArchiveName`)
- Runtime tools: `runtime/bin/backup.mjs`, `runtime/bin/restore.mjs`
- Dashboard tools: `dashboard/server/verify.ts`, `dashboard/server/commands.ts`
- Tests: `src/__tests__/security/phase16-backup-roundtrip.test.ts` (21 tests), all passing

## 1. Never archive or restore wallet material

One predicate decides what is key material, and all three consumers import it:

- `runtime/bin/backup.mjs` skips matching files and records each omission;
- `runtime/bin/restore.mjs` refuses matching entries;
- `dashboard/server/verify.ts` and `commands.ts` import the same function
  (`dashboard/server/verify.ts:115,132`; `dashboard/server/commands.ts:236,247`).

The predicate matches wallet file names (`wallet.json`, `wallet.enc-*`, keystore, mnemonic, seed
phrase, private key, `.key`, `.pem`, `.p12`, `.jks`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`,
`wallet.backup`) and the directory segments `.automaton`, `keystore`, `wallets`. An absolute path
inside `.automaton` is therefore classified as material — fail-closed, not an invitation to widen
the allowlist.

A test asserts the dashboard verifier imports this shared policy instead of re-implementing it
(`the dashboard verifier imports the shared policy instead of re-implementing it`), so the two
halves of the backup path cannot drift apart.

## 2. Backup behaviour

- Uses the SQLite online backup API, so a WAL database under a concurrent writer is snapshotted
  without tearing (`snapshots a WAL database that is being written to, without tearing`).
- A plain file copy loses committed rows; the backup API does not (`a plain copy of the main file
  loses committed rows; the backup API does not`).
- Archives only the HOME it was given (`archives the live database of the HOME it was given, and
  nothing else`).
- Never archives `wallet.json` even when it sits next to the database, and skips wallet files planted
  inside `skills/`, recording each omission (`never archives wallet.json...`; `skips wallet files
  planted inside skills/ and records each omission`).
- Redacts credential-shaped config fields and records verifiable hashes; also redacts non-string
  credentials such as seed phrases and credential blocks.
- Refuses linked config files and linked `skills/` directories rather than following them.
- Refuses to write a backup into a directory that already holds wallet material.
- Verification is by content equality, because a WAL snapshot's bytes need not equal the source.
- Refuses manifest entries with separators, drive letters, UNC prefixes, `..`, control characters or
  a NUL byte (`assertPlainArchiveName`).

## 3. Restore behaviour

Two-stage, and the stages are separate requests:

1. `planRestore` validates the archive name, the typed confirmation, the manifest, every file hash,
   and that the archive is not composed only of working-tree references. It produces a concrete
   target under `dashboard/restore-targets/<name>--<stamp>` and holds that plan for 10 minutes.
2. `executeConfirmedRestore` consumes the held plan instead of re-planning, so the directory written
   is the directory the operator was shown. It re-verifies the bytes, refuses an existing target,
   refuses a second execution of a consumed plan, refuses a source outside the backups tree, and
   refuses any wallet entry even if a manifest lists it. Every destination is confined to the target
   before anything is created, so a hostile manifest cannot leave a half-built directory.

Restore never opens a backup database (which would create a fresh `-shm` sibling) and never writes to
`runtime/home/.automaton`. Tests prove restore lands on an alternate path while the active database
keeps moving on, and that a stale WAL sidecar is not carried into the restored location.

## 4. Live dashboard evidence

- `POST /api/action/verify-backups` observed live:
  `9/10 archive(s) carry a manifest · 28 archived file(s) match, 6 live-file entry(ies) match, 0 problem(s)`.
- The restore form is gated in the browser: empty confirmation disabled, wrong confirmation
  disabled, matching confirmation enabled. The harness deliberately did not click the execute
  control, so no restore was performed against production.
- No wallet material was found before or after the verification.

## 5. Adversarial cases covered by tests

- Manifest lists wallet material: refused.
- Wallet material smuggled through `skills/` with a clean manifest: refused.
- Linked file where the manifest promises a regular file: refused.
- Manifest file whose bytes no longer match its hash: refused.
- Clean archive: restored, proving the refusals are not a blanket failure.
- Restore into the live database path: impossible by construction; executed plans target
  `dashboard/restore-targets/`.
- Archive name with `/`, `\`, `..`, or an over-long value: refused by the planner.
- Confirmation not character-identical to the name: refused.

## 6. Evidence

- `runtime/tmp/final-full-suite.log` includes the 21-test backup/restore suite.
- `runtime/tmp/s5-browser.log` records `backupResult` and `restoreGate`.
- `runtime/tmp/s5-live.log` records the verified backup summary.
