#!/usr/bin/env node
/**
 * Rotate automaton log files larger than 10 MB, keeping the 5 most recent
 * rotations per file. Safe to run while the process is writing (rename only
 * affects the current handle's target on Windows after restart; the running
 * process keeps writing to the renamed file until restart).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const logsDir = path.join(root, "logs");
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 5;

if (!fs.existsSync(logsDir)) process.exit(0);

let rotated = 0;
for (const file of fs.readdirSync(logsDir)) {
  if (!file.endsWith(".log")) continue;
  const full = path.join(logsDir, file);
  const stat = fs.statSync(full);
  if (stat.size < MAX_BYTES) continue;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedName = `${file}.${stamp}`;
  fs.renameSync(full, path.join(logsDir, rotatedName));
  rotated++;

  const prefix = `${file}.`;
  const old = fs
    .readdirSync(logsDir)
    .filter((f) => f.startsWith(prefix) && !f.endsWith(".log"))
    .sort()
    .reverse()
    .slice(KEEP);
  for (const stale of old) {
    fs.unlinkSync(path.join(logsDir, stale));
  }
}

console.log(rotated === 0 ? "No log rotation needed." : `Rotated ${rotated} log file(s).`);
