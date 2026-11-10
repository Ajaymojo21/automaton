/**
 * Phase 15B — wallet encryption tests.
 *
 * Uses synthetic keys generated inside temporary directories only. No key is
 * written to the live runtime home, and no wallet is created for the agent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
import {
  decryptWalletData,
  encryptWalletData,
  getWalletPassphrase,
  isEncryptedWalletEnvelope,
  validateWalletData,
  walletFileIsEncrypted,
  WalletCryptoError,
  WalletDecryptionError,
  WalletLockedError,
} from "../security/wallet-crypto.js";
import {
  migratePlaintextWallet,
  readWalletDataFromFile,
  writeEncryptedWalletFile,
} from "../identity/wallet.js";

const PASSPHRASE = "correct horse battery staple";
const EVM_KEY = ("0x" + "11".repeat(32)) as `0x${string}`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-phase15-wallet-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function evmData() {
  return {
    privateKey: EVM_KEY,
    chainType: "evm" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function solanaData() {
  const keypair = nacl.sign.keyPair();
  return {
    secretKey: bs58.encode(keypair.secretKey),
    chainType: "solana" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("wallet envelope encryption", () => {
  it("round-trips an EVM wallet", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const decrypted = decryptWalletData(envelope, PASSPHRASE);
    expect(decrypted.privateKey).toBe(EVM_KEY);
    expect(decrypted.chainType).toBe("evm");
  });

  it("round-trips a Solana wallet", () => {
    const data = solanaData();
    const envelope = encryptWalletData(data, PASSPHRASE);
    const decrypted = decryptWalletData(envelope, PASSPHRASE);
    expect(decrypted.secretKey).toBe(data.secretKey);
    expect(decrypted.chainType).toBe("solana");
  });

  it("does not contain the plaintext key anywhere in the envelope", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(EVM_KEY);
    expect(serialized).not.toContain(EVM_KEY.slice(2));
    expect(envelope.ciphertext).not.toContain("1111");
    expect(envelope).not.toHaveProperty("privateKey");
  });

  it("uses a fresh salt and IV for every encryption", () => {
    const a = encryptWalletData(evmData(), PASSPHRASE);
    const b = encryptWalletData(evmData(), PASSPHRASE);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects a passphrase shorter than the minimum", () => {
    expect(() => encryptWalletData(evmData(), "short")).toThrow(WalletCryptoError);
  });

  it("rejects a wrong passphrase with a non-specific error", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    expect(() => decryptWalletData(envelope, "wrong horse battery staple")).toThrow(
      WalletDecryptionError,
    );
    try {
      decryptWalletData(envelope, "wrong horse battery staple");
    } catch (err) {
      expect((err as Error).message).not.toContain("passphrase is wrong");
      expect((err as Error).message).not.toContain("tampered");
    }
  });

  it("detects ciphertext tampering", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 0x01;
    const tampered = { ...envelope, ciphertext: bytes.toString("base64") };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("detects auth-tag tampering", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const tag = Buffer.from(envelope.tag, "base64");
    tag[0] ^= 0x01;
    const tampered = { ...envelope, tag: tag.toString("base64") };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("detects salt replacement (key derivation binding)", () => {
    const a = encryptWalletData(evmData(), PASSPHRASE);
    const b = encryptWalletData(evmData(), PASSPHRASE);
    const tampered = { ...a, salt: b.salt };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("detects IV replacement", () => {
    const a = encryptWalletData(evmData(), PASSPHRASE);
    const b = encryptWalletData(evmData(), PASSPHRASE);
    const tampered = { ...a, iv: b.iv };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("detects KDF parameter tampering via authenticated metadata", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const tampered = {
      ...envelope,
      kdfParams: { ...envelope.kdfParams, N: 16384 },
    };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("detects chain-type tampering via authenticated metadata", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    const tampered = { ...envelope, chainType: "solana" as const };
    expect(() => decryptWalletData(tampered, PASSPHRASE)).toThrow(WalletDecryptionError);
  });

  it("rejects an unsupported envelope version", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    expect(() =>
      decryptWalletData({ ...envelope, version: 1 as unknown as 2 }, PASSPHRASE),
    ).toThrow(WalletCryptoError);
  });

  it("rejects malformed base64 fields", () => {
    const envelope = encryptWalletData(evmData(), PASSPHRASE);
    expect(() =>
      decryptWalletData({ ...envelope, salt: "not-base64!!" }, PASSPHRASE),
    ).toThrow(WalletCryptoError);
  });
});

describe("wallet payload validation", () => {
  it("rejects a payload with both EVM and Solana keys", () => {
    const data = { ...evmData(), ...solanaData() };
    expect(() => validateWalletData(data)).toThrow(WalletCryptoError);
  });

  it("rejects a payload with no key", () => {
    expect(() => validateWalletData({ chainType: "evm" })).toThrow(WalletCryptoError);
  });

  it("rejects an EVM key with the wrong length", () => {
    expect(() =>
      validateWalletData({ privateKey: "0x1234", chainType: "evm" }),
    ).toThrow(WalletCryptoError);
  });

  it("rejects a Solana chain type paired with an EVM key", () => {
    expect(() =>
      validateWalletData({ privateKey: EVM_KEY, chainType: "solana" }),
    ).toThrow(WalletCryptoError);
  });

  it("infers Solana from a secret key when chainType is absent", () => {
    const data = solanaData();
    const validated = validateWalletData({
      secretKey: data.secretKey,
      createdAt: data.createdAt,
    });
    expect(validated.chainType).toBe("solana");
  });
});

describe("passphrase resolution", () => {
  it("reads the environment variable", () => {
    expect(getWalletPassphrase({ CONWAY_WALLET_PASSPHRASE: PASSPHRASE })).toBe(PASSPHRASE);
  });

  it("reads a passphrase file", () => {
    const file = path.join(tmpDir, "pass.txt");
    fs.writeFileSync(file, PASSPHRASE + "\n", { mode: 0o600 });
    expect(
      getWalletPassphrase({ CONWAY_WALLET_PASSPHRASE_FILE: file }),
    ).toBe(PASSPHRASE);
  });

  it("fails closed when no passphrase source exists", () => {
    expect(() => getWalletPassphrase({})).toThrow(WalletLockedError);
  });

  it("fails closed when the passphrase file is missing", () => {
    expect(() =>
      getWalletPassphrase({ CONWAY_WALLET_PASSPHRASE_FILE: path.join(tmpDir, "nope") }),
    ).toThrow(WalletLockedError);
  });

  it("does not include the passphrase value in the error", () => {
    try {
      getWalletPassphrase({ CONWAY_WALLET_PASSPHRASE: "short" });
    } catch (err) {
      expect((err as Error).message).not.toContain("short");
    }
  });
});

describe("wallet file integration", () => {
  it("writes and reads an encrypted wallet file", () => {
    const file = path.join(tmpDir, "wallet.json");
    writeEncryptedWalletFile(evmData(), PASSPHRASE, file);
    expect(walletFileIsEncrypted(file)).toBe(true);
    const raw = fs.readFileSync(file, "utf-8");
    expect(raw).not.toContain(EVM_KEY.slice(2));
    const loaded = readWalletDataFromFile(file, { CONWAY_WALLET_PASSPHRASE: PASSPHRASE });
    expect(loaded.privateKey).toBe(EVM_KEY);
  });

  it("refuses to read an encrypted file without a passphrase", () => {
    const file = path.join(tmpDir, "wallet.json");
    writeEncryptedWalletFile(evmData(), PASSPHRASE, file);
    expect(() => readWalletDataFromFile(file, {})).toThrow(WalletLockedError);
  });

  it("reads a legacy plaintext wallet for migration", () => {
    const file = path.join(tmpDir, "wallet.json");
    fs.writeFileSync(file, JSON.stringify(evmData()), { mode: 0o600 });
    const loaded = readWalletDataFromFile(file, {});
    expect(loaded.privateKey).toBe(EVM_KEY);
  });

  it("migrates a plaintext wallet and removes the plaintext copy", () => {
    const file = path.join(tmpDir, "wallet.json");
    fs.writeFileSync(file, JSON.stringify(evmData()), { mode: 0o600 });
    const result = migratePlaintextWallet(file, {
      CONWAY_WALLET_PASSPHRASE: PASSPHRASE,
    });
    expect(result.migrated).toBe(true);
    expect(result.address).toBe(privateKeyToAccount(EVM_KEY).address);
    expect(walletFileIsEncrypted(file)).toBe(true);
    const files = fs.readdirSync(tmpDir);
    expect(files.filter((f) => f.includes("migrating"))).toHaveLength(0);
    expect(fs.readFileSync(file, "utf-8")).not.toContain(EVM_KEY.slice(2));
  });

  it("reports an already-encrypted wallet as not migrated", () => {
    const file = path.join(tmpDir, "wallet.json");
    writeEncryptedWalletFile(evmData(), PASSPHRASE, file);
    const result = migratePlaintextWallet(file, {
      CONWAY_WALLET_PASSPHRASE: PASSPHRASE,
    });
    expect(result.migrated).toBe(false);
  });

  it("does not treat an arbitrary JSON file as a wallet envelope", () => {
    const file = path.join(tmpDir, "wallet.json");
    fs.writeFileSync(file, JSON.stringify({ hello: "world" }));
    expect(walletFileIsEncrypted(file)).toBe(false);
    expect(isEncryptedWalletEnvelope({ version: 2 })).toBe(false);
  });
});
