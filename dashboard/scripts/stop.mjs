#!/usr/bin/env node
/**
 * Conway Automaton — AI Command Center launcher (stop).
 *
 * Kills only a pid this console recorded in dashboard/state/dashboard.pid, and only after the
 * live command line has been read back and matched against the Conway runtime and the dashboard
 * server entry. A recycled pid belonging to another program is refused, not killed.
 *
 * Existence is tested with Get-Process, not with the command line: Get-CimInstance answers with
 * an empty string for a process that no longer exists, which reads as "still alive" to a check
 * that looks for null.
 *
 * Exit code: 0 = stopped or nothing was running, 1 = refused or the port stayed busy.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DASHBOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DASHBOARD, "..");
const PID_FILE = path.join(DASHBOARD, "state", "dashboard.pid");
const RUNTIME_NODE = path.join(ROOT, "runtime", "node-v22.23.4-win-x64", "node.exe").toLowerCase();
const PORT = Number(process.env.CONWAY_DASHBOARD_PORT ?? 8787);
const pause = new Int32Array(new SharedArrayBuffer(4));

function fail(message) {
  process.stdout.write(`[FAIL] ${message}\n`);
  process.exit(1);
}

function processExists(pid) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { "yes" } else { "no" }`],
    { encoding: "utf-8", timeout: 10_000 },
  );
  return (result.stdout ?? "").trim() === "yes";
}

/** The command line is the identity proof, and it is only ever read — never assumed. */
function commandLineOf(pid) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`],
    { encoding: "utf-8", timeout: 10_000 },
  );
  if (result.status !== 0) return "";
  return (result.stdout ?? "").trim();
}

function isDashboardServer(commandLine) {
  const lowered = commandLine.toLowerCase();
  return lowered.includes(RUNTIME_NODE) && lowered.includes("server/index.ts");
}

/** Graceful signal, then /T /F on the tree: the pid file records the tsx launcher and the
 *  HTTP listener is its child, so a parent-only kill can leave the port occupied. */
function stopPid(pid) {
  try {
    process.kill(pid);
  } catch {
    /* already exiting */
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    Atomics.wait(pause, 0, 0, 250);
    if (!processExists(pid)) return { stopped: true, neededForce: false };
  }
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf-8", timeout: 10_000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    Atomics.wait(pause, 0, 0, 250);
    if (!processExists(pid)) return { stopped: true, neededForce: true };
  }
  return { stopped: false, neededForce: true };
}

async function portPid() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
    const body = await response.json();
    return Number.isInteger(body?.pid) ? body.pid : null;
  } catch {
    return null;
  }
}

if (!fs.existsSync(PID_FILE)) {
  const orphan = await portPid();
  if (orphan) fail(`nothing is recorded in ${PID_FILE}, but a dashboard server answers on port ${PORT} as pid ${orphan}. Refusing to kill an unrecorded process; stop it manually.`);
  process.stdout.write("[info] no dashboard pid file — nothing this console recorded is running.\n");
  process.exit(0);
}

const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
const pid = Number(raw);
if (!Number.isInteger(pid) || pid <= 0 || pid > 4_000_000_000) {
  fs.rmSync(PID_FILE, { force: true });
  fail(`pid file "${raw}" is not a process id. It was removed; no process was touched.`);
}

if (!processExists(pid)) {
  fs.rmSync(PID_FILE, { force: true });
  process.stdout.write(`[info] pid ${pid} is already gone; the stale pid file was removed.\n`);
  process.exit(0);
}

const live = commandLineOf(pid);
if (live.length === 0) fail(`pid ${pid} exists but its command line could not be read, so it cannot be identified as the console. Nothing was killed.`);
if (!isDashboardServer(live)) {
  fail(`pid ${pid} does not belong to the Conway dashboard (command line read back, not matched). Nothing was killed.\n       recorded: ${live.slice(0, 200)}`);
}

process.stdout.write(`[info] stopping the console (pid ${pid})…\n`);
const stopped = stopPid(pid);
if (!stopped.stopped) fail(`pid ${pid} survived a graceful stop and taskkill. Investigate manually; the pid file was kept.`);
if (stopped.neededForce) process.stdout.write("[info] terminated via taskkill after the graceful stop timed out.\n");

// The listener may outlive the launcher it was spawned from; the port has to be free before the
// pid file is removed, otherwise START would fail with EADDRINUSE against an invisible process.
const child = await portPid();
if (child && child !== pid) {
  const childLine = commandLineOf(child);
  if (!isDashboardServer(childLine)) {
    fail(`port ${PORT} is still answered by pid ${child}, which is not the dashboard server. Nothing further was killed; the pid file was kept.`);
  }
  process.stdout.write(`[info] the detached listener (pid ${child}) still holds port ${PORT}; stopping it…\n`);
  const childStopped = stopPid(child);
  if (!childStopped.stopped) fail(`pid ${child} would not stop. Investigate manually; the pid file was kept.`);
}
if (await portPid()) fail(`the console stopped but port ${PORT} still answers; the pid file was kept.`);

fs.rmSync(PID_FILE, { force: true });
process.stdout.write("[PASS] console stopped; the port is free and the pid file was removed.\n");
