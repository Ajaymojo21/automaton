#!/usr/bin/env node
/**
 * Conway Automaton — AI Command Center launcher (health).
 *
 * Read-only. Verifies the console itself: the HOME it was launched under, that it is bound to
 * loopback and nothing else, that its API answers, that its operator token file is intact, and
 * that the Conway agent is still inactive after all of this.
 *
 * Exit code: 0 = every check passed, 1 = at least one FAIL or NOT VERIFIED. A check that could
 * not be made is never rounded up into a pass.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DASHBOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DASHBOARD, "..");
const CANONICAL = path.join(ROOT, "runtime", "home");
const CONFIG_FILE = path.join(CANONICAL, ".automaton", "automaton.json");
const PID_FILE = path.join(DASHBOARD, "state", "dashboard.pid");
const TOKEN_FILE = path.join(DASHBOARD, "state", "dashboard.token");
const PORT = Number(process.env.CONWAY_DASHBOARD_PORT ?? 8787);

const results = [];
function record(status, id, message) {
  results.push({ status, id, message });
  process.stdout.write(`[${status}] ${id}: ${message}\n`);
}

/** TCP handshake only — no HTTP, so this proves the bind and nothing else. */
function canConnect(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/** Every address this machine answers on except loopback. If the console accepted one of
 *  these it would be reachable from the LAN, which the mandate forbids. */
function routableAddresses() {
  const out = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family === "IPv6" || entry.family === 6 ? "6" : "4";
      const loopback = entry.address === "127.0.0.1" || entry.address === "::1";
      if (!loopback && !entry.internal) out.push({ name, address: entry.address, family });
    }
  }
  return out;
}

process.env.HOME = CANONICAL;
const stateDb = path.join(CANONICAL, ".automaton", "state.db");
if (fs.existsSync(stateDb)) record("PASS", "home_isolated", `Conway state resolves to ${CANONICAL}`);
else record("FAIL", "home_isolated", `no database under ${CANONICAL}; another state tree would be in use`);

let pid = null;
if (fs.existsSync(PID_FILE)) {
  pid = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
  const alive = Number.isInteger(pid) && pid > 0
    && spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process -Id ${pid} -ErrorAction SilentlyContinue`], { encoding: "utf-8", timeout: 10_000 }).status === 0;
  if (alive) record("PASS", "process", `console running as pid ${pid}`);
  else record("FAIL", "process", `pid file says ${pid} but no such process is running`);
} else {
  record("FAIL", "process", "no dashboard pid file — the console is not running (use START_CONWAY_DASHBOARD.bat)");
}

// Behavioural, not a socket table: this machine's `netstat -ano`/`Get-NetTCPConnection` output
// is unreliable, so the bind is proven by handshake instead — loopback must answer and every
// routable interface address must refuse.
const listening = await canConnect("127.0.0.1", PORT);
if (listening) record("PASS", "loopback_bind", `127.0.0.1:${PORT} accepts connections`);
else record("FAIL", "loopback_bind", `nothing on this machine accepted a connection on 127.0.0.1:${PORT}`);

// Link-local IPv6 (fe80::) needs a scope id to be reachable at all, so refusing there would
// prove nothing; it is excluded rather than counted as a pass.
const routable = routableAddresses().filter((entry) => entry.family === "4" || !/^(fe80|ff)/i.test(entry.address));
const exposed = [];
for (const entry of routable) {
  if (await canConnect(entry.address, PORT)) exposed.push(`${entry.name} ${entry.address}`);
}
if (exposed.length > 0) record("FAIL", "not_exposed", `the console answered on non-loopback address(es): ${exposed.join("; ")}`);
else if (routable.length === 0) record("NOT VERIFIED", "not_exposed", "this machine reports no routable interface address to probe — loopback bind was checked, LAN reachability could not be");
else record("PASS", "not_exposed", `no connection established to any of ${routable.length} routable address(es) — localhost only`);

const token = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf-8").trim() : "";
if (token.length >= 32) record("PASS", "operator_token", `present and ${token.length} characters (value not printed)`);
else record("FAIL", "operator_token", token.length === 0 ? "missing" : `truncated (${token.length} characters)`);

if (listening) {
  let servedPid = null;
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
    const body = await response.json();
    servedPid = body?.pid ?? null;
    if (response.status === 200 && body.verdict === "VERIFIED") record("PASS", "api_liveness", `GET /api/health -> ${response.status}, pid ${body.pid}`);
    else record("FAIL", "api_liveness", `GET /api/health -> ${response.status} ${JSON.stringify(body).slice(0, 120)}`);
  } catch (cause) {
    record("FAIL", "api_liveness", `request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  // Whatever answers on this port must be the dashboard server itself, not some unrelated
  // process that grabbed the number first. The pid file holds the tsx launcher; the listener
  // is its child, so the command line is the identity, not the pid.
  if (Number.isInteger(servedPid) && servedPid > 0) {
    const probe = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${servedPid}" -ErrorAction SilentlyContinue).CommandLine`],
      { encoding: "utf-8", timeout: 15_000 },
    );
    const commandLine = (probe.stdout ?? "").trim();
    if (commandLine.includes("server/index.ts") && commandLine.includes("tsx")) record("PASS", "server_identity", `pid ${servedPid} is the dashboard server (command line names server/index.ts under tsx)`);
    else if (commandLine.length === 0) record("NOT VERIFIED", "server_identity", `pid ${servedPid} reported by /api/health has no readable command line`);
    else record("FAIL", "server_identity", `pid ${servedPid} is not the dashboard server: ${commandLine.slice(0, 120)}`);
  } else {
    record("NOT VERIFIED", "server_identity", "/api/health did not report a process id, so the listener could not be identified");
  }
  try {
    const unauthenticated = await fetch(`http://127.0.0.1:${PORT}/api/panels`);
    if (unauthenticated.status === 401) record("PASS", "auth_wall", "GET /api/panels without a session is refused with 401");
    else record("FAIL", "auth_wall", `expected 401, received ${unauthenticated.status}`);
  } catch (cause) {
    record("FAIL", "auth_wall", `request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

if (fs.existsSync(path.join(DASHBOARD, "dist", "index.html"))) record("PASS", "spa_bundle", "dashboard/dist/index.html is built");
else record("WARN", "spa_bundle", "bundle absent — the page serves as plain text until `npm run build`");

// The point of the whole mandate: opening the console must not have activated anything.
// This reads the live config the agent itself uses — runtime/home/.automaton/automaton.json.
// A file that cannot be read is reported as NOT VERIFIED, never as a gate outcome, because
// "could not look" and "looked and found it open" are different claims.
const gates = [
  ["security.activationApproved", (config) => config?.security?.activationApproved !== true, "must not be true"],
  ["security.lockdown", (config) => config?.security?.lockdown === true, "must stay true"],
  ["security.allowedTools", (config) => Array.isArray(config?.security?.allowedTools) && config.security.allowedTools.length === 0, "must stay empty"],
  ["security.allowFinancialTools", (config) => config?.security?.allowFinancialTools !== true, "must not be true"],
  ["security.allowHostShell", (config) => config?.security?.allowHostShell !== true, "must not be true"],
  ["security.allowSelfModification", (config) => config?.security?.allowSelfModification !== true, "must not be true"],
  ["security.allowReplication", (config) => config?.security?.allowReplication !== true, "must not be true"],
  ["security.allowExternalExposure", (config) => config?.security?.allowExternalExposure !== true, "must not be true"],
  ["maxChildren", (config) => config?.maxChildren === 0, "must stay 0"],
];

try {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  for (const [id, holds, expectation] of gates) {
    if (holds(config)) record("PASS", `gate:${id}`, `holds (${expectation})`);
    else record("FAIL", `gate:${id}`, `does not hold — ${expectation}`);
  }
} catch (cause) {
  const reason = cause instanceof Error ? cause.message : String(cause);
  record("NOT VERIFIED", "gates", `${CONFIG_FILE} could not be read (${reason}); the activation gates were neither confirmed closed nor claimed open`);
}

const activationEnv = process.env.CONWAY_ACTIVATION;
if (activationEnv) record("FAIL", "activation_env", `CONWAY_ACTIVATION=${activationEnv} is set in this health check's own environment; it must not be exported to the console`);
else record("PASS", "activation_env", "CONWAY_ACTIVATION is unset for this run");

const count = (status) => results.filter((entry) => entry.status === status).length;
// An unproven check is a failure of the health check: the console may only claim what it read.
const blocked = count("FAIL") + count("NOT VERIFIED");
const reportDir = path.join(DASHBOARD, "state");
fs.mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportFile = path.join(reportDir, `dashboard-health-${stamp}.json`);
fs.writeFileSync(reportFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), home: CANONICAL, port: PORT, results }, null, 2)}\n`, "utf-8");
process.stdout.write(`\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("NOT VERIFIED")} not verified, ${count("WARN")} warn — ${reportFile}\n`);
process.exit(blocked > 0 ? 1 : 0);
