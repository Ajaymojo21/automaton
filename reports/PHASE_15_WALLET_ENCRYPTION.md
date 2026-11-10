# Phase 15B — Wallet Encryption at Rest

**Status:** IMPLEMENTED AND TESTED (synthetic keys only)
**Install:** `<repo-root>` (v0.2.1, commit `d8f8168`)
**Date:** 2026-10-31
**Scope:** Wallet private-key storage, key derivation, migration tooling, error and log hygiene.

---

## 1. Executive Summary

Before Phase 15, `src/identity/wallet.ts` wrote `wallet.json` containing a raw EVM private key
or a base58 Solana secret key in plaintext (gap **G-01** in
[PHASE_15_GAP_ANALYSIS.md](./PHASE_15_GAP_ANALYSIS.md)). Phase 15 replaces that with an
authenticated encrypted envelope:

- **AES-256-GCM** (authenticated encryption, 96-bit IV, 128-bit tag)
- **scrypt** key derivation (N=32768, r=8, p=1, 32-byte key, 64 MB maxmem)
- **Random 16-byte salt** and **random 12-byte IV** per encryption
- Envelope metadata (format, algorithm, KDF params, chain type, createdAt) bound as **AAD**, so
  parameter or metadata tampering breaks authentication
- Passphrase supplied only through `CONWAY_WALLET_PASSPHRASE` or `CONWAY_WALLET_PASSPHRASE_FILE`
- Atomic file writes (temp file `wx` 0600 → fsync → rename → chmod)
- Post-write verification: the persisted envelope is decrypted and the address re-derived; the
  file is deleted if verification fails
- Offline migration tool that verifies before replacing and then zero-overwrites the plaintext

**No wallet was created or modified in the real installation.** `runtime/home/.automaton` contains
no `wallet.json`. All keys used in testing were synthetic and lived in a temporary directory that
has been deleted.

---

## 2. Implementation

### 2.1 `src/security/wallet-crypto.ts` (new)

| Element | Value |
|---|---|
| Envelope `version` | `2` |
| `format` | `conway-wallet` |
| `algorithm` | `aes-256-gcm` |
| `kdf` | `scrypt` |
| scrypt params | N=32768, r=8, p=1, keyLen=32, maxmem=64 MiB |
| salt | 16 random bytes, base64 |
| iv | 12 random bytes, base64 |
| tag | 16 bytes, base64 |
| minimum passphrase | 12 characters (creation only) |

Exports: `encryptWalletData`, `decryptWalletData`, `validateWalletData`, `getWalletPassphrase`,
`walletFileIsEncrypted`, `isEncryptedWalletEnvelope`, and error classes
`WalletCryptoError` / `WalletLockedError` / `WalletDecryptionError`.

Key handling details:

- The plaintext payload and derived key are `Buffer.fill(0)`-ed after use.
- `decryptWalletData` validates envelope structure, base64 lengths, KDF parameters, and AAD before
  attempting decryption. Any failure — wrong passphrase or tampering — throws a single generic
  `WalletDecryptionError` so callers cannot distinguish "wrong password" from "modified file".
- `getWalletPassphrase` throws `WalletLockedError` when no passphrase source is configured and
  never embeds the passphrase value in the message.

### 2.2 `src/identity/wallet.ts` (rewritten)

- `getWallet()` refuses to create a wallet without a passphrase and writes only encrypted envelopes.
- `readWalletDataFromFile()` decrypts envelopes; a legacy plaintext file is still readable so an
  existing install can boot and migrate, but logs a warning pointing at the migration tool.
- `getWalletAddress()`, `loadWalletAccount()`, `getWalletChainType()` all go through the encrypted
  reader, so no code path returns a key without decryption.
- `migratePlaintextWallet()`:
  1. Validates and parses the plaintext file.
  2. Writes an encrypted copy to a sibling path.
  3. Decrypts the copy and confirms the derived address matches the original.
  4. Renames the plaintext aside, renames the encrypted copy into place.
  5. Zero-overwrites and unlinks the reserved plaintext file (`plaintextRemoved` in the result).

### 2.3 `runtime/bin/migrate-wallet.mjs` (new CLI)

- **Dry run by default**; requires `--apply` to change anything.
- Refuses when no wallet file exists (this tool never creates wallets).
- Refuses while `logs/automaton.pid` points at a live process.
- Reads the passphrase only from the environment; never prints it, the private key, or the secret.
- Prints only the derived address and migration status.
- Deliberately keeps **no plaintext backup** — a copy would defeat the purpose. Safety comes from
  verify-before-replace instead.
- Exit codes: `0` success/already encrypted, `1` refused/failed.

---

## 3. Windows DPAPI Investigation

The prompt asked whether DPAPI is available and appropriate. Findings:

| Question | Result |
|---|---|
| DPAPI present? | Yes — `CryptProtectData`/`CryptUnprotectData` exist in `crypt32.dll` on Windows 11 Home 26H2. |
| Usable from Node without new dependencies? | No. Node core has no DPAPI binding; it requires either a native addon (new dependency + build toolchain, explicitly out of scope) or spawning PowerShell (`ProtectedData`). |
| Threat model fit | DPAPI is bound to the **user profile**. Every process running as this user can decrypt the blob, including the agent itself. It would not isolate key material from the agent, only from offline file theft on another machine. It also couples the wallet to this Windows account and profile, complicating the existing backup/restore procedure. |
| Decision | **Rejected as the primary mechanism.** Portable AES-256-GCM keeps the encrypted format platform-independent and testable, and the passphrase is not stored on disk. |

**Compensating OS-level protection:** the `.automaton` directory already carries a single-user
ACL (`FullControl` for the owning account only), the file is written 0600/owner-only, and the
device-level control is full-disk encryption (BitLocker status is reported read-only in Phase 15H).
A future enhancement could wrap the passphrase with DPAPI for "unattended" operation, but that
would re-introduce exactly the weakness the prompt forbids (automatic unlock), so it is documented
as a residual gap rather than implemented.

---

## 4. Evidence

All commands were run from `<repo-root>` with the portable Node runtime.

### 4.1 Unit and integration tests

```
node node_modules/typescript/bin/tsc --noEmit
  → exit 0

node node_modules/vitest/vitest.mjs run src/__tests__/phase15-wallet-crypto.test.ts
  → Tests 30 passed (30), duration ~5.3 s, exit 0
```

Coverage includes: EVM round-trip, Solana round-trip, absence of plaintext in the envelope,
unique salt/IV per encryption, short-passphrase rejection, wrong-passphrase rejection,
tampering of ciphertext/tag/salt/IV/KDF/chain metadata, malformed base64, payload validation,
missing passphrase (env and file), encrypted file write/read, legacy plaintext read, migration,
and plaintext removal.

### 4.2 Migration CLI end-to-end (synthetic key, temp dir)

Fixture: `{"chainType":"evm","privateKey":"0x1111…1111"}` — a deliberately synthetic key, never
funded, never used on-chain.

```
DRY RUN: …/wallet.json is a legacy plaintext wallet.
DRYRUN_EXIT=0

MIGRATED: …/wallet.json
address=0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A
plaintextRemoved=true
APPLY_EXIT=0

Envelope keys: version,format,algorithm,kdf,kdfParams,chainType,salt,iv,ciphertext,tag,createdAt
IS_ENVELOPE=true
HAS_PLAINTEXT=false

ALREADY ENCRYPTED: …/wallet.json          RERUN_EXIT=0
FAIL: … cannot be decrypted with the supplied passphrase (WalletDecryptionError).   WRONGPASS_EXIT=1
FAIL: passphrase unavailable; set CONWAY_WALLET_PASSPHRASE or CONWAY_WALLET_PASSPHRASE_FILE.  NOPASS_EXIT=1
FAIL: no wallet file at …; this tool never creates wallets.   NOWALLET_EXIT=1
```

The temp directory was deleted after the test.

### 4.3 Real installation state

```
runtime/home/.automaton →
  automaton.json, heartbeat.yml, skills/, state.db, state.db-shm, state.db-wal
```

No `wallet.json`, no `.migrating-*`, no `.enc-*` files. The install remains wallet-free.

---

## 5. Threat Model Notes

| Threat | Mitigation | Residual |
|---|---|---|
| Offline theft of `wallet.json` | AES-256-GCM + scrypt; no passphrase on disk | Weak passphrase remains brute-forceable offline; recommend ≥ 20 random characters |
| Tampering with ciphertext/metadata | AEAD tag + AAD-bound metadata | None for integrity; denial-of-service is possible (file made unreadable) |
| Wrong passphrase oracle | Single generic decryption error | None |
| Key material in logs | Logger never receives key material; only a legacy-file warning is logged | Debug-level dumps elsewhere were not exhaustively audited in 15B; see 15G |
| Key material in process memory | Buffers zeroed after use | Node GC can copy strings; not a hard guarantee |
| Key material in backups | Backup script excludes `wallet.json`/`config` (Phase 11); 15K adds a key-material scan | SSD wear-levelling may retain deleted plaintext |
| Rollback to plaintext | Only `migratePlaintextWallet` writes plaintext-adjacent artifacts, and it zeroes them | A user could restore an old plaintext backup; 15K validates backups |
| Passphrase exposure via env | Env is isolated to the process; never logged | Any process running as this user can read its own env — OS session isolation is the boundary |

---

## 6. Residual Risks

1. **Passphrase availability model.** The passphrase must be provided at process start via env.
   There is no interactive unlock, no HSM, and no DPAPI wrapping (rejected above). An attacker with
   code execution as the same user can read the decrypted key from the process.
2. **SSD remnants.** Zero-overwriting a small JSON file does not guarantee physical erasure on an
   SSD. Only full-disk encryption (BitLocker) retires the old blocks.
3. **No key rotation.** Re-encryption under a new passphrase is not yet exposed as a CLI. The
   envelope version field exists to allow it.
4. **Legacy read path.** `readWalletDataFromFile` still accepts plaintext so an existing install can
   boot. This is intentional and logged, but it means "encrypted" is not enforced at read time.
5. **No hardware-backed keys.** Software keys only; consistent with the "no wallet creation" gate.

---

## 7. Files Changed / Added

| File | Change |
|---|---|
| `src/security/wallet-crypto.ts` | Added |
| `src/identity/wallet.ts` | Rewritten for encrypted storage, atomic writes, migration |
| `src/__tests__/phase15-wallet-crypto.test.ts` | Added (30 tests) |
| `runtime/bin/migrate-wallet.mjs` | Added |
| `dist/**` | Rebuilt via `tsc` |

Pre-change copies of `src/identity/wallet.ts` and its peers are in
`backups/phase15-pre-20261031-175152/` with `manifest.sha256`.

---

## 8. Verdict for 15B

**PASS with documented residuals.** Authenticated encryption with an established algorithm is in
force for all wallet writes; migration tooling is verified end-to-end; no real wallet exists and no
key material was generated for or written to the production install.
