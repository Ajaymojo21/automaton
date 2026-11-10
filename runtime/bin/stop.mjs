#!/usr/bin/env node
/**
 * Stop the automaton process recorded in logs/automaton.pid.
 *
 * Refuses to kill a PID whose command line does not reference this
 * installation's dist/index.js, to avoid terminating a recycled PID.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pidPath = path.join(root, "logs", "automaton.pid");

if (!fs.existsSync(pidPath)) {
  console.log("Automaton is not running (no pid file).");
  process.exit(0);
}

const pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
if (!Number.isInteger(pid) || pid <= 0) {
  console.error(`[FAIL] Invalid pid file: ${pidPath}`);
  process.exit(1);
}

let commandLine = "";
if (process.platform === "win32") {
  try {
    commandLine = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: "utf-8" },
    ).trim();
  } catch {
    commandLine = "";
  }
}

if (commandLine && !/Conway-Automaton/i.test(commandLine)) {
  console.error(`[FAIL] PID ${pid} does not belong to this installation; refusing to kill it.`);
  console.error(`       Command line: ${commandLine.slice(0, 200)}`);
  process.exit(1);
}

try {
  process.kill(pid, "SIGTERM");
  console.log(`[PASS] Sent termination signal to pid ${pid}.`);
} catch (err) {
  if (err.code === "ESRCH") {
    console.log(`[INFO] pid ${pid} already exited.`);
  } else {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`[PASS] Force-killed pid ${pid}.`);
    } catch (killErr) {
      console.error(`[FAIL] Could not stop pid ${pid}: ${killErr.message}`);
      process.exit(1);
    }
  }
}

fs.rmSync(pidPath, { force: true });
