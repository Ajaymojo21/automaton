# Phase 15B — Wallet Encryption at Rest (Operator Guide)

**Control:** every wallet the automaton writes is an authenticated encrypted envelope. No code
path writes a private key in plaintext.
**Status:** implemented, 30 tests executed, migration tool verified end-to-end on a synthetic key.
**Evidence:** [`../../reports/PHASE_15_WALLET_ENCRYPTION.md`](../../reports/PHASE_15_WALLET_ENCRYPTION.md)
**Code:** [`src/security/wallet-crypto.ts`](../src/security/wallet-crypto.ts),
[`src/identity/wallet.ts`](../src/identity/wallet.ts),
[`runtime/bin/migrate-wallet.mjs`](../runtime/bin/migrate-wallet.mjs)

> **There is no wallet in this install.** `runtime/home/.automaton/` contains no `wallet.json`,
> and Phase 15 did not create one. Wallet creation remains gated behind
> `CONWAY_ALLOW_WALLET_CREATION=APPROVED`, which `START_CONWAY.bat` sets only after you type
> `CREATE-WALLET`. Nothing in this document changes that gate.

---

## 1. What is actually enforced

| Element | Value | Why it matters |
|---|---|---|
| Cipher | AES-256-GCM | authenticated — tampering fails the open, it does not silently return garbage |
| KDF | scrypt, N=32768, r=8, p=1, keyLen=32, maxmem 64 MiB | memory-hard; the parameters are stored in the envelope and bound as AAD |
| Salt | 16 random bytes per encryption | identical passphrases produce different files |
| IV | 12 random bytes per encryption | single use per key, never reused |
| Tag | 16 bytes | integrity |
| AAD | `format`, `algorithm`, `kdf`, `kdfParams`, `chainType`, `createdAt` | downgrading a parameter or swapping the chain type breaks authentication |
| Envelope `version` | `2` | leaves room for a format change without ambiguity |
| Minimum passphrase | 12 characters, enforced at creation | see §5 for the recommended length |

The payload buffer and the derived key are zero-filled after use. Node's garbage collector can
still have copied a string, so this is hygiene, not a guarantee.

## 2. Where the passphrase lives

Only two sources are read, in this order:

1. `CONWAY_WALLET_PASSPHRASE` — the value itself in the environment.
2. `CONWAY_WALLET_PASSPHRASE_FILE` — a path to a file whose contents are the passphrase.

There is no third source. No passphrase is stored in `automaton.json`, in the database, in a
keyfile beside the wallet, or in the OS credential store. If neither variable is set,
`getWalletPassphrase()` throws `WalletLockedError` and the message never contains the
passphrase value.

That is a deliberate consequence of rejecting Windows DPAPI. DPAPI exists on this host
(`crypt32.dll`), but a blob protected that way is readable by *every process running as this
user* — including the agent — and it would let the wallet unlock itself. The phase brief
forbids automatic unlock, so DPAPI is documented as a rejected option rather than implemented.

**Practical rule:** put the passphrase in your shell profile or a password manager, not in a
`.bat` file, and never in a committed file.

## 3. Migrating a pre-Phase-15 plaintext wallet

Run from the install root, with the portable runtime (system Node 24 cannot load
`better-sqlite3`, and the tool needs the same build the app uses):

```bash
cd <repo-root>
export CONWAY_WALLET_PASSPHRASE='the-new-passphrase'

# 1. dry run — the default. Prints what it would do, changes nothing.
./runtime/node-v22.23.4-win-x64/node.exe runtime/bin/migrate-wallet.mjs

# 2. apply
./runtime/node-v22.23.4-win-x64/node.exe runtime/bin/migrate-wallet.mjs --apply
```

Recorded output from the end-to-end run against a synthetic key
(`0x1111…1111`, never funded, never on-chain):

```
DRY RUN: …/wallet.json is a legacy plaintext wallet.        DRYRUN_EXIT=0
MIGRATED: …/wallet.json
address=0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A
plaintextRemoved=true                                        APPLY_EXIT=0
Envelope keys: version,format,algorithm,kdf,kdfParams,chainType,salt,iv,ciphertext,tag,createdAt
HAS_PLAINTEXT=false
ALREADY ENCRYPTED: …/wallet.json                             RERUN_EXIT=0
FAIL: … cannot be decrypted with the supplied passphrase.    WRONGPASS_EXIT=1
FAIL: passphrase unavailable; set CONWAY_WALLET_PASSPHRASE…  NOPASS_EXIT=1
FAIL: no wallet file at …; this tool never creates wallets.  NOWALLET_EXIT=1
```

Order of operations inside the tool, and why each step is there:

1. refuse if `logs/automaton.pid` points at a live process — no migration under a running agent;
2. refuse if no wallet file exists — this tool never creates a wallet;
3. validate and parse the plaintext;
4. write the encrypted envelope to a **sibling** path;
5. decrypt that copy and re-derive the address; only if it matches the original does it rename;
6. rename the plaintext aside, rename the envelope into place;
7. zero-overwrite and unlink the reserved plaintext file (`plaintextRemoved=true`).

**There is intentionally no plaintext backup.** Keeping a copy would defeat the purpose. The
safety property comes from verify-before-replace, not from a rollback file.

## 4. Verifying the control yourself

```bash
cd <repo-root>
./runtime/node-v22.23.4-win-x64/node.exe node_modules/vitest/vitest.mjs run \
  src/__tests__/phase15-wallet-crypto.test.ts
# recorded: Tests 30 passed (30), ~5.3 s, exit 0
node node_modules/typescript/bin/tsc --noEmit          # recorded: exit 0
```

The 30 tests cover EVM and Solana round-trips, absence of plaintext inside the envelope,
unique salt/IV per encryption, short- and wrong-passphrase rejection, tampering of
ciphertext / tag / salt / IV / KDF params / chain metadata, malformed base64, payload
validation, missing passphrase via env and via file, encrypted write and read, legacy
plaintext read, migration, and plaintext removal.

To confirm the live install is wallet-free:

```bash
ls -la runtime/home/.automaton/          # expect no wallet.json, no .enc-*, no .migrating-*
```

## 5. Operating rules

- **Use a long passphrase.** scrypt slows offline brute force; it does not excuse a weak
  secret. 20+ random characters.
- **A wrong passphrase and a tampered file produce the same error** (`WalletDecryptionError`,
  one generic message). That is the anti-oracle design. If a good passphrase suddenly fails,
  check file integrity and whether a backup restore replaced the wallet — not the password.
- **Post-write verification deletes the file it just wrote** if it cannot be decrypted back.
  A wallet that fails to persist leaves you exactly where you started, with an error, not with
  an unusable file.
- **The legacy read path still accepts a plaintext file** so an old install can boot and then
  migrate. It logs a warning pointing at this tool. "Encrypted" is therefore enforced on
  write, not on read. If you see that warning, run §3.
- **Backups exclude `wallet.json` by design** (Phase 11 exclusion list, re-verified in
  Phase 15K). If you want the wallet in a backup, back up the *envelope* yourself and keep the
  passphrase separately.
- **No key rotation CLI exists yet.** To change the passphrase, decrypt with the old one and
  re-encrypt with the new — currently by re-running migration on a wallet you have temporarily
  decrypted, or by restoring the key into a fresh creation you approve. The `version` field
  exists so a rotation format can be added without ambiguity.

## 6. Residual risks

1. **Same-user code execution reads the decrypted key from process memory.** The boundary is
   OS session isolation, not this envelope. The envelope defends the file at rest.
2. **SSD wear-levelling.** Zero-overwriting a small JSON file does not guarantee the old cells
   are erased. Only full-disk encryption retires those blocks — and disk encryption is
   **UNVERIFIED** on this host (see [PHASE_15_WINDOWS_SECURITY.md](PHASE_15_WINDOWS_SECURITY.md)).
3. **No hardware-backed key, no HSM, no interactive unlock.**
4. **A weak passphrase is brute-forceable offline** by whoever has the file.
5. **Log hygiene was audited for this module, not exhaustively across the codebase** in 15B;
   the broader check is Phase 15G's audit-chain argument hashing (see
   [PHASE_15_INCIDENT_RESPONSE.md](PHASE_15_INCIDENT_RESPONSE.md)).

## 7. Pre-change recovery

`src/identity/wallet.ts` as it stood before Phase 15 is in
`backups/phase15-pre-20261031-175152/` with `manifest.sha256`. Reverting the control means
restoring a plaintext key writer; do it only knowingly.
