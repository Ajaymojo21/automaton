# Pre-Activation Readiness Audit — Wallet Security

## 1. Wallet creation timing

`getWallet()` is called only from:
- `--run` (line 292) — gated by `checkActivation()`
- `--init` (line 137) — gated by `requireActivation()`
- `--provision` (line 151, indirectly via SIWE) — gated by `requireActivation()`

**Read-only commands (`--status`, `--help`, `--version`, `--configure`, `--pick-model`) never call
`getWallet()`.** No wallet material is created by status inspection or audit commands.

## 2. Key storage

- Location: `runtime/home/.automaton/wallet.json`.
- Format: AES-256-GCM envelope with scrypt-derived key (Phase 15).
- Passphrase: from `CONWAY_WALLET_PASSPHRASE` or `CONWAY_WALLET_PASSPHRASE_FILE`, never logged.
- File permissions: `0o600` (owner-only), directory `0o700`.
- Atomic write via temp file + rename + fsync.
- Legacy plaintext files are readable for migration but new wallets are never written in plaintext.
- `migratePlaintextWallet()` exists for offline migration; caller must stop the runtime first.

## 3. Current state

- **No wallet file exists.** `walletExists()` returns false. `NO WALLET CONFIGURED`.
- No private key material on disk.
- No keystore or wallet.json anywhere under `runtime/home/`.

## 4. Leak paths

| Vector | Protected? | Evidence |
|---|---|---|
| Logs | Yes — passphrase never logged; private key never logged | `wallet.ts` logger calls contain no key material |
| Exceptions | Yes — errors contain reason codes, not key material | `WalletCryptoError` messages are generic |
| Backups | **Potential** — backup manifests include file lists; if a wallet file existed it would be included | backup-verify tests check manifest integrity, not content redaction |
| Console | Yes — wallet panel shows existence and address only, never key material | `walletPanel()` in `dashboard/server/panels/finance.ts` |
| Process args | No wallet path in argv | static inspection |
| Environment | Passphrase is in env (operator's responsibility) | documented |

## 5. Encryption verification

- Algorithm: AES-256-GCM with scrypt KDF.
- `walletFileIsEncrypted()` checks envelope format.
- `decryptWalletData()` validates on read.
- Round-trip verified by `migratePlaintextWallet()` (verify-after-write).
- **Not independently audited** — no external crypto review. The implementation uses Node.js
  built-in `crypto` module. Claim is "implemented", not "audited".

## 6. Verdict

Wallet creation is gated behind activation, keys are encrypted at rest with owner-only permissions,
and no read-only command creates wallet material. The one gap is that backup manifests do not
explicitly exclude wallet files — if a wallet existed, a backup would include it. This is a
documentation/operational note, not a code defect, since backups are operator-initiated.
