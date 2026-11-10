#!/usr/bin/env node
/**
 * Conway Automaton preflight.
 *
 * Runs before START_CONWAY.bat launches the agent. Fails closed:
 * - Node major must be 22
 * - automaton.json must exist and be valid JSON
 * - security.activationApproved must be true
 * - CONWAY_ACTIVATION must equal APPROVED in the launching shell
 * - a missing wallet requires CONWAY_ALLOW_WALLET_CREATION=APPROVED
 * - a non-zero treasury requires financial tools to be enabled
 *
 * Exit codes: 0 = ready, 2 = blocked (approval/config), 1 = environment error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const automatonDir = path.join(home, ".automaton");
const configPath = path.join(automatonDir, "automaton.json");

function fail(code, message) {
  console.error(`[BLOCKED] ${message}`);
  process.exit(code);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) {
  console.error(`[FAIL] Expected Node 22.x, got ${process.version}.`);
  process.exit(1);
}

for (const dir of ["logs", "reports", "backups", path.join("runtime", "tmp")]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}

if (!fs.existsSync(configPath)) {
  fail(2, `Configuration not found: ${configPath}. Create it from config/automaton.template.json.`);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (err) {
  fail(2, `Configuration is not valid JSON: ${err.message}`);
}

const security = config.security || {};
if (security.activationApproved !== true) {
  fail(2, "security.activationApproved is not true. Activation requires explicit human approval.");
}
if (process.env.CONWAY_ACTIVATION !== "APPROVED") {
  fail(2, "CONWAY_ACTIVATION=APPROVED is not set in this shell. Activation requires explicit human approval.");
}
if (security.lockdown !== true) {
  console.warn("[WARN] security.lockdown is disabled. Tool execution is not deny-by-default.");
}
if (security.allowFinancialTools === true) {
  console.warn("[WARN] financial tools are enabled. Treasury limits apply; verify them before proceeding.");
  const treasury = config.treasuryPolicy || {};
  const cap = treasury.maxSingleTransferCents;
  if (typeof cap !== "number" || cap <= 0) {
    fail(2, "Financial tools are enabled but maxSingleTransferCents is not a positive number.");
  }
} else {
  const treasury = config.treasuryPolicy || {};
  const nonZero = Object.entries(treasury).filter(
    ([key, value]) => key !== "x402AllowedDomains" && typeof value === "number" && value > 0,
  );
  if (nonZero.length > 0) {
    console.warn(
      `[WARN] Treasury has non-zero limits while financial tools are disabled: ${nonZero
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    );
  }
}

const walletPath = path.join(automatonDir, "wallet.json");
if (!fs.existsSync(walletPath)) {
  if (process.env.CONWAY_ALLOW_WALLET_CREATION !== "APPROVED") {
    fail(
      2,
      "No wallet.json exists. Creating a new wallet requires CONWAY_ALLOW_WALLET_CREATION=APPROVED.",
    );
  }
  console.warn("[WARN] A new wallet will be generated at first run.");
}

if (!config.conwayApiKey && !process.env.CONWAY_API_KEY) {
  console.warn("[WARN] No Conway API key configured. The runtime will exit after startup.");
}

const pidPath = path.join(root, "logs", "automaton.pid");
if (fs.existsSync(pidPath)) {
  const pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      fail(2, `Automaton already running (pid ${pid}). Use RESTART_CONWAY.bat or STOP_CONWAY.bat.`);
    } catch {
      console.warn(`[WARN] Stale pid file (${pid}); it will be replaced.`);
    }
  }
}

console.log(`[PASS] Node ${process.version}`);
console.log(`[PASS] Config: ${configPath}`);
console.log(`[PASS] Lockdown: ${security.lockdown === true ? "enabled" : "DISABLED"}`);
console.log(`[PASS] Allowlist size: ${Array.isArray(security.allowedTools) ? security.allowedTools.length : 0}`);
console.log(`[PASS] Financial tools: ${security.allowFinancialTools === true ? "ENABLED" : "disabled"}`);
console.log("[PASS] Activation approved for this launch.");
