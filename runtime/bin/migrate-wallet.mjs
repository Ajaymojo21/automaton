#!/usr/bin/env node
/**
 * Conway Automaton wallet encryption migration (Phase 15B).
 *
 * Converts a legacy plaintext wallet.json into an AES-256-GCM encrypted
 * envelope. Offline operation only: refuses to run while the runtime is live.
 *
 * Usage:
 *   set CONWAY_WALLET_PASSPHRASE=<passphrase>   (or CONWAY_WALLET_PASSPHRASE_FILE)
 *   node runtime/bin/migrate-wallet.mjs            # dry run, reports state
 *   node runtime/bin/migrate-wallet.mjs --apply    # perform migration
 *
 * Guarantees:
 *   - Never creates a wallet. Refuses when no wallet file exists.
 *   - Never prints the passphrase, private key, or secret key.
 *   - Verifies the encrypted copy decrypts to the same address before replacing.
 *   - Does not keep a plaintext backup (that would defeat the purpose).
 *
 * Exit codes: 0 = already encrypted or migration succeeded, 1 = failed/refused.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const walletPath =
  process.argv.find((a) => a.startsWith("--wallet="))?.slice("--wallet=".length) ||
  path.join(home, ".automaton", "wallet.json");
const apply = process.argv.includes("--apply");
const pidPath = path.join(root, "logs", "automaton.pid");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(walletPath)) {
  fail(`no wallet file at ${walletPath}; this tool never creates wallets.`);
}

if (process.env.CONWAY_WALLET_PASSPHRASE_FILE) {
  const file = process.env.CONWAY_WALLET_PASSPHRASE_FILE;
  if (!fs.existsSync(file)) fail(`passphrase file not found: ${file}`);
}
if (!process.env.CONWAY_WALLET_PASSPHRASE && !process.env.CONWAY_WALLET_PASSPHRASE_FILE) {
  fail(
    "passphrase unavailable; set CONWAY_WALLET_PASSPHRASE or CONWAY_WALLET_PASSPHRASE_FILE.",
  );
}

// Refuse while the runtime is live: concurrent writers could interleave writes.
try {
  const pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0) {
    process.kill(pid, 0);
    fail(`runtime appears active (pid ${pid}); stop it before migrating.`);
  }
} catch (err) {
  if (err?.message?.startsWith("runtime appears active")) throw err;
  // No live pid file: safe to continue.
}

const { migratePlaintextWallet, readWalletDataFromFile } = await import(
  pathToFileURL(path.join(root, "dist", "identity", "wallet.js")).href
);
const { walletFileIsEncrypted } = await import(
  pathToFileURL(path.join(root, "dist", "security", "wallet-crypto.js")).href
);

let alreadyEncrypted = false;
try {
  alreadyEncrypted = walletFileIsEncrypted(walletPath);
} catch (err) {
  fail(`cannot inspect wallet file: ${err.message}`);
}

if (alreadyEncrypted) {
  try {
    const data = readWalletDataFromFile(walletPath);
    console.log(`ALREADY ENCRYPTED: ${walletPath}`);
    console.log(`chain=${data.chainType || "evm"} (address not printed on this path)`);
    process.exit(0);
  } catch (err) {
    fail(
      `wallet is encrypted but cannot be decrypted with the supplied passphrase (${err.name}).`,
    );
  }
}

if (!apply) {
  console.log(`DRY RUN: ${walletPath} is a legacy plaintext wallet.`);
  console.log("Re-run with --apply to encrypt it. The passphrase is read from the environment.");
  process.exit(0);
}

try {
  const result = migratePlaintextWallet(walletPath);
  console.log(`MIGRATED: ${walletPath}`);
  console.log(`address=${result.address}`);
  console.log(`plaintextRemoved=${result.plaintextRemoved}`);
  if (!result.plaintextRemoved) {
    console.warn(
      "WARN: the plaintext file was replaced but could not be securely removed; " +
        "delete any *.migrating-* file manually and re-encrypt the device.",
    );
  }
  console.log(
    "NOTE: SSD wear-levelling may retain old blocks; full-disk encryption is required " +
      "to retire the prior plaintext key material.",
  );
} catch (err) {
  fail(`migration failed: ${err.message}`);
}
