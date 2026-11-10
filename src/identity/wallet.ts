/**
 * Automaton Wallet Management
 *
 * Creates and manages wallets for the automaton's identity and payments.
 * Supports both EVM (secp256k1/viem) and Solana (Ed25519/tweetnacl) wallets.
 *
 * Phase 15: key material is written only inside an AES-256-GCM envelope with a
 * scrypt-derived key. Plaintext wallet files are still readable for migration,
 * but new wallets are never written in plaintext. The passphrase comes from
 * CONWAY_WALLET_PASSPHRASE or CONWAY_WALLET_PASSPHRASE_FILE and is never logged.
 */

import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { resolveHome } from "../runtime/home-guard.js";
import fs from "fs";
import path from "path";
import type { WalletData } from "../types.js";
import type { ChainType } from "./chain.js";
import { EvmChainIdentity, SolanaChainIdentity } from "./chain.js";
import type { ChainIdentity } from "./chain.js";
import { createLogger } from "../observability/logger.js";
import {
  WalletCryptoError,
  decryptWalletData,
  encryptWalletData,
  getWalletPassphrase,
  isEncryptedWalletEnvelope,
  validateWalletData,
  walletFileIsEncrypted,
} from "../security/wallet-crypto.js";
import type { EncryptedWalletEnvelope } from "../security/wallet-crypto.js";

const logger = createLogger("wallet");

/**
 * Create a stub PrivateKeyAccount for Solana wallets.
 */
function createSolanaStubAccount(solanaAddress: string): PrivateKeyAccount {
  const throwSigning = () => {
    throw new Error(
      "Cannot use EVM signing methods on a Solana wallet. Use chainIdentity instead.",
    );
  };
  return {
    address: solanaAddress as any,
    publicKey: "0x" as any,
    source: "custom",
    type: "local",
    signMessage: throwSigning as any,
    signTypedData: throwSigning as any,
    signTransaction: throwSigning as any,
    sign: throwSigning as any,
  } as unknown as PrivateKeyAccount;
}

/**
 * Resolved per call, not at import: a module-level constant would freeze whichever HOME
 * happened to be set when the module was first loaded, and the previous `/root` fallback
 * put the private key file at `C:\root\.automaton\wallet.json` for any caller that forgot
 * to set HOME. Missing HOME is now an error with a one-line fix, not a silent relocation.
 */
function automatonDir(): string {
  return path.join(resolveHome(), ".automaton");
}

function walletFile(): string {
  return path.join(automatonDir(), "wallet.json");
}

export function getAutomatonDir(): string {
  return automatonDir();
}

export function getWalletPath(): string {
  return walletFile();
}

/**
 * Generate a Solana Ed25519 keypair.
 * Returns the 64-byte secret key (first 32 = private, last 32 = public).
 */
export function generateSolanaKeypair(): { secretKey: Uint8Array; publicKey: Uint8Array; address: string } {
  const keypair = nacl.sign.keyPair();
  return {
    secretKey: keypair.secretKey,
    publicKey: keypair.publicKey,
    address: bs58.encode(keypair.publicKey),
  };
}

/**
 * Atomically write a wallet file with owner-only permissions.
 */
function atomicWriteWallet(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs govern access */ }
}

/**
 * Read wallet data from a file, decrypting an encrypted envelope when present.
 * Legacy plaintext files are accepted for migration but produce a warning.
 */
export function readWalletDataFromFile(
  filePath: string = walletFile(),
  env: NodeJS.ProcessEnv = process.env,
): WalletData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    throw new WalletCryptoError("Wallet file is unreadable or not valid JSON.");
  }

  if (isEncryptedWalletEnvelope(parsed)) {
    return decryptWalletData(parsed, getWalletPassphrase(env));
  }

  logger.warn(
    "Legacy unencrypted wallet detected. Migrate with runtime/bin/migrate-wallet.mjs.",
  );
  return validateWalletData(parsed);
}

/**
 * Encrypt and persist wallet data. Used by creation and migration.
 */
export function writeEncryptedWalletFile(
  data: WalletData,
  passphrase: string,
  filePath: string = walletFile(),
): EncryptedWalletEnvelope {
  const envelope = encryptWalletData(data, passphrase);
  atomicWriteWallet(filePath, JSON.stringify(envelope, null, 2));
  return envelope;
}

/**
 * Get or create the automaton's wallet.
 * Creation requires a passphrase and writes only the encrypted envelope.
 *
 * @param chainType - If creating a new wallet, which chain to use. Defaults to "evm".
 */
export async function getWallet(chainType?: ChainType): Promise<{
  account: PrivateKeyAccount;
  chainIdentity: ChainIdentity;
  chainType: ChainType;
  isNew: boolean;
}> {
  if (!fs.existsSync(automatonDir())) {
    fs.mkdirSync(automatonDir(), { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(walletFile())) {
    const walletData = readWalletDataFromFile(walletFile());
    const resolvedChainType = walletData.chainType || "evm";

    if (resolvedChainType === "solana" && walletData.secretKey) {
      const secretKey = bs58.decode(walletData.secretKey);
      const solanaIdentity = new SolanaChainIdentity(secretKey);
      const account = createSolanaStubAccount(solanaIdentity.address);
      return { account, chainIdentity: solanaIdentity, chainType: "solana", isNew: false };
    }

    const account = privateKeyToAccount(walletData.privateKey!);
    return { account, chainIdentity: new EvmChainIdentity(account), chainType: "evm", isNew: false };
  }

  // Creation requires an explicit passphrase; refuse to write plaintext.
  const passphrase = getWalletPassphrase();
  const resolvedChain = chainType || "evm";

  if (resolvedChain === "solana") {
    const { secretKey, address } = generateSolanaKeypair();
    const solanaIdentity = new SolanaChainIdentity(secretKey);

    const walletData: WalletData = {
      chainType: "solana",
      secretKey: bs58.encode(secretKey),
      createdAt: new Date().toISOString(),
    };

    writeEncryptedWalletFile(walletData, passphrase, walletFile());
    const verified = readWalletDataFromFile(walletFile());
    if (!verified.secretKey || bs58.encode(bs58.decode(verified.secretKey)) !== bs58.encode(secretKey)) {
      try { fs.unlinkSync(walletFile()); } catch { /* best effort */ }
      throw new WalletCryptoError("Wallet verification failed after write; file removed.");
    }

    const account = createSolanaStubAccount(address);
    return { account, chainIdentity: solanaIdentity, chainType: "solana", isNew: true };
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const walletData: WalletData = {
    chainType: "evm",
    privateKey,
    createdAt: new Date().toISOString(),
  };

  writeEncryptedWalletFile(walletData, passphrase, walletFile());
  const verified = readWalletDataFromFile(walletFile());
  if (!verified.privateKey || privateKeyToAccount(verified.privateKey).address !== account.address) {
    try { fs.unlinkSync(walletFile()); } catch { /* best effort */ }
    throw new WalletCryptoError("Wallet verification failed after write; file removed.");
  }

  return { account, chainIdentity: new EvmChainIdentity(account), chainType: "evm", isNew: true };
}

/**
 * Get the wallet address without returning signing capabilities.
 */
export function getWalletAddress(): string | null {
  if (!fs.existsSync(walletFile())) {
    return null;
  }

  const walletData = readWalletDataFromFile(walletFile());

  if (walletData.chainType === "solana" && walletData.secretKey) {
    const secretKey = bs58.decode(walletData.secretKey);
    const keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
    return bs58.encode(keypair.publicKey);
  }

  return privateKeyToAccount(walletData.privateKey!).address;
}

/**
 * Load the full wallet account (needed for signing).
 * For Solana wallets, returns null; callers should use getWallet().
 */
export function loadWalletAccount(): PrivateKeyAccount | null {
  if (!fs.existsSync(walletFile())) {
    return null;
  }

  const walletData = readWalletDataFromFile(walletFile());
  if (walletData.chainType === "solana") {
    return null;
  }
  return privateKeyToAccount(walletData.privateKey!);
}

/**
 * Get the chain type from the wallet file.
 */
export function getWalletChainType(): ChainType {
  if (!fs.existsSync(walletFile())) {
    return "evm";
  }
  try {
    const walletData = readWalletDataFromFile(walletFile());
    return walletData.chainType || "evm";
  } catch {
    return "evm";
  }
}

export function walletExists(): boolean {
  return fs.existsSync(walletFile());
}

/**
 * Convert a legacy plaintext wallet file into an encrypted envelope.
 * Offline operation: the caller must stop the runtime first. The plaintext file
 * is replaced; because secure deletion is not guaranteed on SSDs, treat the old
 * key as potentially recoverable until the device is re-encrypted.
 */
export function migratePlaintextWallet(
  filePath: string = walletFile(),
  env: NodeJS.ProcessEnv = process.env,
): { migrated: boolean; address: string; plaintextRemoved: boolean } {
  if (!fs.existsSync(filePath)) {
    throw new WalletCryptoError("No wallet file exists to migrate.");
  }
  if (walletFileIsEncrypted(filePath)) {
    const data = readWalletDataFromFile(filePath, env);
    return { migrated: false, address: addressOf(data), plaintextRemoved: true };
  }

  const plaintext = fs.readFileSync(filePath, "utf-8");
  const data = validateWalletData(JSON.parse(plaintext));
  const address = addressOf(data);
  const passphrase = getWalletPassphrase(env);

  const encryptedPath = `${filePath}.enc-${Date.now()}`;
  writeEncryptedWalletFile(data, passphrase, encryptedPath);

  // Verify the encrypted copy decrypts to the same address before replacing.
  const verified = readWalletDataFromFile(encryptedPath, env);
  if (addressOf(verified) !== address) {
    try { fs.unlinkSync(encryptedPath); } catch { /* best effort */ }
    throw new WalletCryptoError("Migration verification failed; original wallet left untouched.");
  }

  const plaintextPath = `${filePath}.migrating-${Date.now()}`;
  fs.renameSync(filePath, plaintextPath);
  fs.renameSync(encryptedPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs govern access */ }

  // Overwrite then remove the plaintext copy. SSD wear-levelling can retain old
  // blocks; device re-encryption is the only full remedy.
  let plaintextRemoved = false;
  try {
    const size = fs.statSync(plaintextPath).size;
    fs.writeFileSync(plaintextPath, Buffer.alloc(size, 0));
    fs.unlinkSync(plaintextPath);
    plaintextRemoved = true;
  } catch { /* best effort; caller is warned */ }

  return { migrated: true, address, plaintextRemoved };
}

function addressOf(data: WalletData): string {
  if (data.chainType === "solana" && data.secretKey) {
    const keypair = nacl.sign.keyPair.fromSecretKey(bs58.decode(data.secretKey));
    return bs58.encode(keypair.publicKey);
  }
  return privateKeyToAccount(data.privateKey!).address;
}
