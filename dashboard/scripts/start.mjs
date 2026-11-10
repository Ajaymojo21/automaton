#!/usr/bin/env node
/**
 * Conway Automaton — AI Command Center launcher (start).
 *
 * Pins HOME to the isolated runtime home before anything else, refuses to launch a second
 * instance on the same port, and records the child pid so STOP can verify what it kills.
 *
 * This script never sets CONWAY_ACTIVATION, CONWAY_ALLOW_WALLET_CREATION or any other
 * approval gate. Starting the console does not start the agent.
 *
 * Exit code: 0 = launched, 1 = refused.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = path.resolve(here, "..");
const ROOT = path.resolve(DASHBOARD, "..");
const NODE = path.join(ROOT, "runtime", "node-v22.23.4-win-x64", "node.exe");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVER = path.join(DASHBOARD, "server", "index.ts");
const PID_FILE = path.join(DASHBOARD, "state", "dashboard.pid");
const OUT_LOG = path.join(DASHBOARD, "logs", "dashboard.out.log");
const ERR_LOG = path.join(DASHBOARD, "logs", "dashboard.err.log");
const HOST = "127.0.0.1";
const PORT = Number(process.env.CONWAY_DASHBOARD_PORT ?? 8787);

function fail(message) {
  process.stdout.write(`[FAIL] ${message}\n`);
  process.exit(1);
}

// Mandate §3 — refuse to launch toward any other state tree.
const canonical = path.join(ROOT, "runtime", "home");
process.env.HOME = canonical;
if (!fs.existsSync(path.join(canonical, ".automaton", "state.db"))) {
  fail(`no Conway database under ${canonical}. Refusing to point the console at another home.`);
}
for (const [label, file] of [["Node runtime", NODE], ["tsx", TSX], ["server entry", SERVER]]) {
  if (!fs.existsSync(file)) fail(`${label} not found at ${file}`);
}
fs.mkdirSync(path.join(DASHBOARD, "state"), { recursive: true });
fs.mkdirSync(path.join(DASHBOARD, "logs"), { recursive: true });

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

if (fs.existsSync(PID_FILE)) {
  const recorded = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
  if (recorded > 0 && (await portInUse())) {
    fail(`a console is already running (pid ${recorded} on ${HOST}:${PORT}). Use STOP_CONWAY_DASHBOARD.bat first; nothing is killed to free the port.`);
  }
  fs.rmSync(PID_FILE, { force: true });
}
if (await portInUse()) fail(`port ${PORT} is occupied by a process this console did not record. It is not killed.`);

if (!fs.existsSync(path.join(DASHBOARD, "dist", "index.html"))) {
  process.stdout.write("[warn] dashboard/dist/index.html is absent — the API works, the page renders as plain text until `npm run build`.\n");
}

const out = fs.openSync(OUT_LOG, "a");
const err = fs.openSync(ERR_LOG, "a");
const child = spawn(NODE, [TSX, "server/index.ts"], {
  cwd: DASHBOARD,
  env: { ...process.env, HOME: canonical },
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: true,
});
if (!child.pid) fail("the console process could not be created");
fs.writeFileSync(PID_FILE, `${child.pid}\n`, { encoding: "utf-8", flag: "wx" });
child.unref();

process.stdout.write(
  [
    `[PASS] Conway AI Command Center launched (pid ${child.pid})`,
    `       URL    http://${HOST}:${PORT}  (loopback only)`,
    `       HOME   ${canonical}`,
    `       logs   ${OUT_LOG}`,
    `       pid    ${PID_FILE}`,
    "",
    `Operator token: ${path.join(DASHBOARD, "state", "dashboard.token")}`,
    "The Conway agent was NOT started by this action and cannot be started from the console.",
  ].join("\n") + "\n",
);
