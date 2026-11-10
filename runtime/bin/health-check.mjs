#!/usr/bin/env node
/**
 * Conway Automaton health check (read-only).
 *
 * Verifies process liveness, configuration presence, database integrity,
 * disk headroom, and whether the activation gate is armed. Never reads
 * wallet.json or any credential value.
 *
 * Exit code: 0 = healthy, 1 = degraded/failed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const automatonDir = path.join(home, ".automaton");
const logsDir = path.join(root, "logs");
const pidPath = path.join(logsDir, "automaton.pid");
const reportPath = path.join(root, "reports", "health-latest.json");

const checks = [];
function check(name, status, detail) {
  checks.push({ name, status, detail });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// 1. Process liveness
let pid = null;
let running = false;
try {
  pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0) {
    process.kill(pid, 0);
    running = true;
  }
} catch {
  running = false;
}
check(
  "process",
  running ? "pass" : "warn",
  running ? `running (pid ${pid})` : "not running (no live pid file)",
);

// 2. Configuration
const configPath = path.join(automatonDir, "automaton.json");
const config = readJson(configPath);
check("config", config ? "pass" : "fail", config ? configPath : `missing: ${configPath}`);
if (config) {
  const security = config.security || {};
  check(
    "lockdown",
    security.lockdown === true ? "pass" : "warn",
    security.lockdown === true ? "enabled" : "DISABLED",
  );
  check(
    "activation_flag",
    "info",
    security.activationApproved === true ? "approved at rest" : "not approved (expected)",
  );
  check(
    "allowed_tools",
    Array.isArray(security.allowedTools) && security.allowedTools.length > 0 ? "info" : "pass",
    `${Array.isArray(security.allowedTools) ? security.allowedTools.length : 0} tool(s) allow-listed`,
  );
}

// 3. Wallet presence (existence only, never contents)
const walletPath = path.join(automatonDir, "wallet.json");
check(
  "wallet",
  "info",
  fs.existsSync(walletPath) ? "wallet.json present (contents not read)" : "no wallet present",
);

// 4. Database integrity
const dbPath = config?.dbPath
  ? config.dbPath.replace(/^~/, home)
  : path.join(automatonDir, "state.db");
if (fs.existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const result = db.pragma("quick_check");
    db.close();
    const ok = result?.[0]?.quick_check === "ok";
    check("database", ok ? "pass" : "fail", ok ? "quick_check ok" : JSON.stringify(result));
  } catch (err) {
    check("database", "fail", `cannot open: ${err.message}`);
  }
} else {
  check("database", "warn", "state.db not created yet");
}

// 5. Disk headroom
try {
  const stats = fs.statfsSync(root);
  const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
  check("disk", freeGb >= 2 ? "pass" : "warn", `${freeGb.toFixed(1)} GB free`);
} catch (err) {
  check("disk", "warn", `unavailable: ${err.message}`);
}

// 6. Logs directory
check("logs", fs.existsSync(logsDir) ? "pass" : "warn", logsDir);

// 7. Activation environment token (presence only)
check(
  "activation_env",
  "info",
  process.env.CONWAY_ACTIVATION === "APPROVED" ? "token present in this shell" : "token absent",
);

const failed = checks.filter((c) => c.status === "fail");
const report = {
  timestamp: new Date().toISOString(),
  overall: failed.length > 0 ? "FAIL" : "PASS",
  root,
  checks,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

for (const c of checks) {
  console.log(`[${c.status.toUpperCase().padEnd(4)}] ${c.name}: ${c.detail}`);
}
console.log(`\nOverall: ${report.overall} (report: ${reportPath})`);
process.exit(failed.length > 0 ? 1 : 0);
