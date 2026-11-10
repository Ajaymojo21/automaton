# WALLET SECURITY — Phase 6

**Wallet created:** **NO**
**Wallet funded:** **NO**
**Blockchain transactions executed:** **NONE**
**Production/primary wallet imported:** **NO**

---

## 1. Verified current state

| Check | Result | Evidence |
|---|---|---|
| `runtime/home/.automaton/wallet.json` exists | No | `ls` → "No such file or directory" |
| Wallet address in config | Empty string | `automaton.json` `"walletAddress": ""` |
| Creator address | Zero address `0x000…0000` | `automaton.json` |
| Chain type | `evm` (default) | `automaton.json` |
| On-chain activity by this installation | None | No wallet, no RPC calls performed |
| Secrets in config | None | All key fields empty |
| Wallet file in backups | Excluded by design | `backups/…/manifest.json` lists it as excluded |

`--status` confirms the runtime reports an empty address and `Agent ID: not registered`.

---

## 2. Why no wallet exists

Upstream behaviour (verified in `src/index.ts` and `src/identity/wallet.ts` during
Phase 2): `--run` calls `getWallet()` unconditionally and **silently generates a new
EVM/Solana keypair** when `wallet.json` is absent. The generated file is written
unencrypted with mode `0600`.

That default was judged unacceptable for an unattended start. Three independent
gates now prevent it:

| Layer | Gate | Failure mode |
|---|---|---|
| 1. Activation | `security.activationApproved === true` **and** `CONWAY_ACTIVATION=APPROVED` | `--run` exits 2 before `getWallet()` is reached |
| 2. Preflight | Requires `CONWAY_ALLOW_WALLET_CREATION=APPROVED` when `wallet.json` is missing | Preflight exits 2 |
| 3. Launcher | `START_CONWAY.bat` prompts `Type CREATE-WALLET`; only then sets the env token | Aborts on any other input |

Live verification of layer 1 (2026-10-31):

```
node dist/index.js --run
ERROR main  Blocked "--run": runtime activation is not approved.
ERROR main  Reason: security.activationApproved is not true in automaton.json
exit code 2
wallet.json: not created
```

Layer 2 was verified in preflight testing: with activation approved but no
`CONWAY_ALLOW_WALLET_CREATION`, preflight blocks wallet creation.

---

## 3. Key-handling rules for this installation

These are binding for any future activation:

1. **Never import the primary crypto wallet.** No seed phrase, keystore, or private
   key from any existing wallet may be placed in this project.
2. **Never paste a seed phrase into any file, chat, terminal, or web form** in the
   course of operating this agent.
3. **Generate a new, experimental wallet only**, and only after explicit approval.
   It must be treated as disposable and funded with an amount you are prepared to lose.
4. **Never store private keys in source code, config templates, notes, or Git.**
5. **Never upload wallet material to an external service.** The backup utility
   deliberately excludes `wallet.json`.
6. **Do not reuse the agent wallet for personal funds.** Separate the experimental
   wallet from anything holding real value.

### 3.1 Storage reality

The upstream wallet file is **unencrypted JSON** protected only by filesystem ACLs
and mode `0600`. There is no password-based encryption in the wallet module.
Therefore:

- The only effective at-rest protection is the Windows ACL on
  `runtime/home/.automaton/` (single-user FullControl) plus full-disk encryption.
- **BitLocker status was not verified** in this installation and is not assumed.
  Verify it before funding any wallet.
- Antivirus exclusions were **not** added, so Defender scans the file normally.

This limitation is recorded as residual risk **R-W1**:
*wallet private key is stored unencrypted at rest; confidentiality depends on OS ACL
and disk encryption.*

---

## 4. Creation procedure (only after approval)

Do not run this until you have decided the treasury policy in
[TREASURY_SECURITY.md](TREASURY_SECURITY.md).

1. Confirm `security.lockdown` and `allowedTools` are still restrictive.
2. Set `activationApproved: true` in `automaton.json`.
3. Run `START_CONWAY.bat`.
4. Type `APPROVED` for activation, then `CREATE-WALLET` for wallet creation. These
   are two separate confirmations.
5. The app generates a new EVM keypair (default `chainType: "evm"`) and writes
   `wallet.json`.
6. Immediately run `BACKUP_CONWAY.bat` for the non-secret state, then back up
   `wallet.json` **manually to encrypted storage** — it is intentionally excluded
   from the automated backup.
7. Record the public address only. Never record the private key.

**Do not fund the wallet** until you have completed the treasury review and decided
an enforceable spending limit. The agent's transfer tool can move credits; a funded
wallet is the precondition for any loss.

---

## 5. Recovery and compromise

| Scenario | Action |
|---|---|
| `wallet.json` lost | If unfunded: delete and regenerate. If funded: funds are unrecoverable unless you exported the key earlier. This is why the automatic backup excludes it. |
| Suspected key exposure | Stop the runtime (`STOP_CONWAY.bat`), move remaining funds out using a wallet you control, then delete `wallet.json` and regenerate. |
| ACL misconfiguration | Re-apply the single-user FullControl ACL; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Do not "fix" it by granting `Everyone`. |
| Config leaked with key | Rotate the key by regenerating the wallet and revisiting any provider credentials stored alongside it. |

---

## 6. Phase verdict

**COMPLETE — SAFE STATE.** No wallet exists, no key material exists anywhere in the
installation, and the code path that would create one is gated three times. Wallet
creation and funding remain blocked pending explicit human approval.
