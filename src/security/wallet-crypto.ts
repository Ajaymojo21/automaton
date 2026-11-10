/**
 * Wallet cryptography.
 *
 * Encrypts wallet key material at rest with AES-256-GCM and a scrypt-derived key.
 * This is a standard, audited construction (Node's OpenSSL-backed crypto); no
 * custom cipher or KDF is implemented here.
 *
 * Envelope metadata is authenticated as additional data, so altering the KDF
 * parameters, salt, IV, chain type, or version causes decryption to fail.
 *
 * The passphrase is never stored in the envelope, source, or logs. It is read
 * from CONWAY_WALLET_PASSPHRASE or CONWAY_WALLET_PASSPHRASE_FILE.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import fs from "node:fs";
import bs58 from "bs58";
import type { WalletData } from "../types.js";

export const WALLET_ENVELOPE_VERSION = 2;
export const WALLET_ENVELOPE_FORMAT = "conway-wallet";
export const WALLET_CIPHER = "aes-256-gcm";
export const WALLET_KDF = "scrypt";
export const MIN_PASSPHRASE_LENGTH = 12;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export interface WalletKdfParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

export interface EncryptedWalletEnvelope {
  version: typeof WALLET_ENVELOPE_VERSION;
  format: typeof WALLET_ENVELOPE_FORMAT;
  algorithm: typeof WALLET_CIPHER;
  kdf: typeof WALLET_KDF;
  kdfParams: WalletKdfParams;
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
  chainType: "evm" | "solana";
  createdAt: string;
}

export class WalletCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletCryptoError";
  }
}

export class WalletLockedError extends WalletCryptoError {
  constructor(
    message = "Wallet passphrase unavailable. Set CONWAY_WALLET_PASSPHRASE or CONWAY_WALLET_PASSPHRASE_FILE.",
  ) {
    super(message);
    this.name = "WalletLockedError";
  }
}

export class WalletDecryptionError extends WalletCryptoError {
  constructor() {
    // Deliberately does not distinguish wrong passphrase from tampering.
    super("Wallet decryption failed: invalid passphrase or corrupted file.");
    this.name = "WalletDecryptionError";
  }
}

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new WalletCryptoError(
      `Wallet passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  }
}

function decodeBase64(value: unknown, expectedBytes: number, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new WalletCryptoError(`Invalid wallet envelope field: ${field}`);
  }
  const buf = Buffer.from(value, "base64");
  if (buf.length !== expectedBytes) {
    throw new WalletCryptoError(`Invalid wallet envelope field length: ${field}`);
  }
  return buf;
}

function validateParams(params: unknown): WalletKdfParams {
  if (!params || typeof params !== "object") {
    throw new WalletCryptoError("Invalid wallet KDF parameters");
  }
  const p = params as Record<string, unknown>;
  const N = p.N;
  const r = p.r;
  const par = p.p;
  const keyLength = p.keyLength;

  const isPow2 = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 16384 && n <= 1048576 && (n & (n - 1)) === 0;

  if (!isPow2(N) || typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 16 ||
      typeof par !== "number" || !Number.isInteger(par) || par < 1 || par > 4 ||
      keyLength !== KEY_BYTES) {
    throw new WalletCryptoError("Unsupported wallet KDF parameters");
  }
  return { N, r, p: par, keyLength };
}

function buildAad(envelope: Pick<EncryptedWalletEnvelope,
  "version" | "format" | "algorithm" | "kdf" | "kdfParams" | "chainType">): Buffer {
  return Buffer.from(
    [
      envelope.format,
      `v${envelope.version}`,
      envelope.algorithm,
      envelope.kdf,
      `N=${envelope.kdfParams.N}`,
      `r=${envelope.kdfParams.r}`,
      `p=${envelope.kdfParams.p}`,
      `keyLength=${envelope.kdfParams.keyLength}`,
      `chain=${envelope.chainType}`,
    ].join("|"),
    "utf-8",
  );
}

function deriveKey(passphrase: string, salt: Buffer, params: WalletKdfParams): Buffer {
  return scryptSync(passphrase, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Validate a wallet payload and normalise it. Used for both decrypted envelopes
 * and legacy plaintext files. Rejects ambiguous material (two keys, no key,
 * key/chain mismatch).
 */
export function validateWalletData(value: unknown): WalletData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WalletCryptoError("Wallet data is not an object.");
  }
  const raw = value as Record<string, unknown>;
  const privateKey = raw.privateKey;
  const secretKey = raw.secretKey;

  const hasEvm =
    typeof privateKey === "string" && /^0x[0-9a-fA-F]{64}$/.test(privateKey);
  let hasSolana = false;
  if (typeof secretKey === "string" && secretKey.length > 0) {
    try {
      hasSolana = bs58.decode(secretKey).length === 64;
    } catch {
      hasSolana = false;
    }
  }

  if (Number(hasEvm) + Number(hasSolana) !== 1) {
    throw new WalletCryptoError(
      "Wallet data must contain exactly one valid key (EVM or Solana).",
    );
  }

  const chainType = raw.chainType ?? (hasSolana ? "solana" : "evm");
  if (chainType !== "evm" && chainType !== "solana") {
    throw new WalletCryptoError("Wallet chain type is invalid.");
  }
  if (chainType === "solana" && !hasSolana) {
    throw new WalletCryptoError("Solana wallet is missing a valid secret key.");
  }
  if (chainType === "evm" && !hasEvm) {
    throw new WalletCryptoError("EVM wallet is missing a valid private key.");
  }

  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.length > 0
      ? raw.createdAt
      : new Date(0).toISOString();

  const out: WalletData = { createdAt, chainType };
  if (hasEvm) out.privateKey = privateKey as `0x${string}`;
  if (hasSolana) out.secretKey = secretKey as string;
  return out;
}

export function isEncryptedWalletEnvelope(value: unknown): value is EncryptedWalletEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === WALLET_ENVELOPE_VERSION &&
    v.format === WALLET_ENVELOPE_FORMAT &&
    v.algorithm === WALLET_CIPHER &&
    v.kdf === WALLET_KDF
  );
}

/**
 * Encrypt wallet data into a self-describing envelope.
 */
export function encryptWalletData(
  data: WalletData,
  passphrase: string,
): EncryptedWalletEnvelope {
  assertPassphrase(passphrase);
  const validated = validateWalletData(data);
  const chainType = (validated.chainType ?? "evm") as "evm" | "solana";
  const kdfParams: WalletKdfParams = {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keyLength: KEY_BYTES,
  };
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);

  const header = {
    version: WALLET_ENVELOPE_VERSION,
    format: WALLET_ENVELOPE_FORMAT,
    algorithm: WALLET_CIPHER,
    kdf: WALLET_KDF,
    kdfParams,
    chainType,
  } as const;

  const payload = Buffer.from(
    JSON.stringify({
      privateKey: validated.privateKey,
      secretKey: validated.secretKey,
      chainType,
      createdAt: validated.createdAt,
    }),
    "utf-8",
  );

  let key: Buffer | null = null;
  try {
    key = deriveKey(passphrase, salt, kdfParams);
    const cipher = createCipheriv(WALLET_CIPHER, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(buildAad(header));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ...header,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
      createdAt: validated.createdAt,
    };
  } finally {
    payload.fill(0);
    if (key) key.fill(0);
  }
}

/**
 * Decrypt and validate an envelope. Throws the same error for a wrong passphrase
 * and for tampered data, so an attacker learns nothing from the error text.
 */
export function decryptWalletData(
  envelope: EncryptedWalletEnvelope,
  passphrase: string,
): WalletData {
  assertPassphrase(passphrase);
  if (!isEncryptedWalletEnvelope(envelope)) {
    throw new WalletCryptoError("Unsupported wallet envelope.");
  }
  const kdfParams = validateParams(envelope.kdfParams);
  if (envelope.chainType !== "evm" && envelope.chainType !== "solana") {
    throw new WalletCryptoError("Invalid wallet chain type in envelope.");
  }
  const salt = decodeBase64(envelope.salt, SALT_BYTES, "salt");
  const iv = decodeBase64(envelope.iv, IV_BYTES, "iv");
  const tag = decodeBase64(envelope.tag, TAG_BYTES, "tag");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  let key: Buffer | null = null;
  let plaintext: Buffer | null = null;
  try {
    key = deriveKey(passphrase, salt, { ...kdfParams });
    const decipher = createDecipheriv(WALLET_CIPHER, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(buildAad(envelope));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return validateWalletData(JSON.parse(plaintext.toString("utf-8")));
  } catch {
    throw new WalletDecryptionError();
  } finally {
    if (plaintext) plaintext.fill(0);
    if (key) key.fill(0);
  }
}

/**
 * Resolve the wallet passphrase from the environment or a protected file.
 * The value is never included in an error message.
 */
export function getWalletPassphrase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const direct = env.CONWAY_WALLET_PASSPHRASE;
  if (typeof direct === "string" && direct.length > 0) {
    assertPassphrase(direct);
    return direct;
  }

  const file = env.CONWAY_WALLET_PASSPHRASE_FILE;
  if (typeof file === "string" && file.length > 0) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8").trim();
    } catch {
      throw new WalletLockedError(
        "Wallet passphrase file could not be read. Check CONWAY_WALLET_PASSPHRASE_FILE.",
      );
    }
    assertPassphrase(content);
    return content;
  }

  throw new WalletLockedError();
}

/**
 * Return true if the wallet file is an encrypted envelope. Does not decrypt.
 */
export function walletFileIsEncrypted(filePath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return isEncryptedWalletEnvelope(parsed);
  } catch {
    return false;
  }
}
