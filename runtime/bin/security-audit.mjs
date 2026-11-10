#!/usr/bin/env node
/**
 * Conway Automaton security audit (read-only).
 *
 * Checks activation/lockdown posture, file ACLs, database integrity,
 * accidental secret leakage into logs, and network listeners owned by the
 * automaton process. Never prints secret values.
 *
 * Exit code: 0 = no failures, 1 = failure found.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.env.HOME || path.join(root, "runtime", "home");
const automatonDir = path.join(home, ".automaton");
const logsDir = path.join(root, "logs");
const pidPath = path.join(logsDir, "automaton.pid");

const findings = [];
function add(severity, id, detail) {
  findings.push({ severity, id, detail });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function aclOf(file) {
  if (process.platform !== "win32" || !fs.existsSync(file)) return null;
  try {
    return execFileSync("icacls", [file], { encoding: "utf-8" });
  } catch {
    return null;
  }
}

function aclLooksBroad(acl) {
  if (!acl) return false;
  return /Everyone:\(|BUILTIN\\Users:\([FMW]|S-1-1-0/i.test(acl);
}

// 1. Config posture
const config = readJson(path.join(automatonDir, "automaton.json"));
if (!config) {
  add("high", "config.missing", "automaton.json not found");
} else {
  const s = config.security || {};
  if (s.lockdown !== true) add("high", "security.lockdown", "lockdown is disabled");
  else add("info", "security.lockdown", "lockdown enabled");

  if (s.activationApproved === true) {
    add("warn", "security.activation", "activationApproved=true is persisted on disk");
  } else {
    add("info", "security.activation", "activationApproved=false (expected at rest)");
  }

  for (const flag of [
    "allowFinancialTools",
    "allowHostShell",
    "allowSelfModification",
    "allowReplication",
    "allowExternalExposure",
  ]) {
    if (s[flag] === true) add("high", `security.${flag}`, `${flag} is enabled`);
  }

  if (Array.isArray(s.allowedTools) && s.allowedTools.length > 0) {
    add("info", "security.allowedTools", `allowlist: ${s.allowedTools.join(", ")}`);
  } else {
    add("info", "security.allowedTools", "allowlist empty (all tools denied)");
  }

  const treasury = config.treasuryPolicy || {};
  for (const key of [
    "maxSingleTransferCents",
    "maxHourlyTransferCents",
    "maxDailyTransferCents",
    "maxX402PaymentCents",
    "maxInferenceDailyCents",
  ]) {
    if (typeof treasury[key] === "number" && treasury[key] > 0) {
      add("warn", `treasury.${key}`, `${key}=${treasury[key]} (non-zero)`);
    }
  }
}

// 2. ACLs
const configAcl = aclOf(path.join(automatonDir, "automaton.json"));
if (configAcl && aclLooksBroad(configAcl)) {
  add("high", "acl.config", "automaton.json ACL appears broad (Everyone/Users)");
}
const walletPath = path.join(automatonDir, "wallet.json");
if (fs.existsSync(walletPath)) {
  const walletAcl = aclOf(walletPath);
  if (walletAcl && aclLooksBroad(walletAcl)) {
    add("high", "acl.wallet", "wallet.json ACL appears broad (Everyone/Users)");
  } else {
    add("info", "wallet.present", "wallet.json present; ACL not broad (contents not read)");
  }
} else {
  add("info", "wallet.present", "no wallet file");
}

// 3. Database
const dbPath = config?.dbPath ? config.dbPath.replace(/^~/, home) : path.join(automatonDir, "state.db");
if (fs.existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("quick_check");
    const ok = integrity?.[0]?.quick_check === "ok";
    add(ok ? "info" : "high", "db.integrity", ok ? "quick_check ok" : JSON.stringify(integrity));

    let denied = 0;
    try {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM policy_decisions WHERE decision = 'deny'")
        .get();
      denied = row?.n ?? 0;
    } catch {
      /* table may not exist yet */
    }
    db.close();
    add("info", "db.policy_denials", `${denied} denied tool call(s) recorded`);
  } catch (err) {
    add("high", "db.integrity", `cannot open database: ${err.message}`);
  }
} else {
  add("info", "db.integrity", "database not created yet");
}

// 4. Secret leakage scan (counts only, never prints matches)
const secretPatterns = [
  { id: "openai_key", re: /sk-[A-Za-z0-9_-]{20,}/g },
  { id: "evm_private_key", re: /0x[a-fA-F0-9]{64}/g },
  { id: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];
let totalHits = 0;
if (fs.existsSync(logsDir)) {
  for (const file of fs.readdirSync(logsDir)) {
    if (!file.endsWith(".log")) continue;
    const text = fs.readFileSync(path.join(logsDir, file), "utf-8");
    for (const { id, re } of secretPatterns) {
      const hits = (text.match(re) || []).length;
      if (hits > 0) {
        totalHits += hits;
        add("high", "logs.secret", `${hits} ${id} match(es) in ${file} (value not printed)`);
      }
    }
  }
}
if (totalHits === 0) add("info", "logs.secret", "no credential patterns found in logs");

// 5. Network listeners owned by the automaton process
let pid = null;
try {
  pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
} catch {
  /* not running */
}
if (process.platform === "win32" && pid) {
  try {
    const netstat = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8" });
    const listeners = netstat
      .split(/\r?\n/)
      .filter((line) => /LISTENING/i.test(line))
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 5 && cols[cols.length - 1] === String(pid));
    if (listeners.length === 0) {
      add("info", "network.listeners", "no TCP listeners owned by the automaton process");
    }
    for (const cols of listeners) {
      const local = cols[1];
      const exposed = /^(0\.0\.0\.0|\[::\]):/.test(local);
      add(
        exposed ? "high" : "info",
        "network.listener",
        `${local} ${exposed ? "(bound to all interfaces)" : "(loopback/bound address)"}`,
      );
    }
  } catch (err) {
    add("warn", "network.listeners", `netstat failed: ${err.message}`);
  }
} else {
  add("info", "network.listeners", pid ? "skipped outside Windows" : "automaton not running");
}

// 6. Activation environment token
add(
  "info",
  "activation.env",
  process.env.CONWAY_ACTIVATION === "APPROVED"
    ? "CONWAY_ACTIVATION token present in this shell"
    : "CONWAY_ACTIVATION token absent",
);

const failures = findings.filter((f) => f.severity === "high");
const report = {
  timestamp: new Date().toISOString(),
  overall: failures.length > 0 ? "FAIL" : "PASS",
  findings,
};
fs.mkdirSync(path.join(root, "reports"), { recursive: true });
const reportPath = path.join(root, "reports", "security-audit-latest.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

for (const f of findings) {
  console.log(`[${f.severity.toUpperCase().padEnd(4)}] ${f.id}: ${f.detail}`);
}
console.log(`\nOverall: ${report.overall} (report: ${reportPath})`);
process.exit(failures.length > 0 ? 1 : 0);
