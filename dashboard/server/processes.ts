import { spawnSync } from "node:child_process";

export interface ProcessProbe {
  ran: boolean;
  error: string | null;
  nodePids: number[];
  conwayIdentifiable: false;
}

/**
 * `tasklist /FO CSV /NH` is a fixed argv array with no shell, no operator input and a hard
 * timeout. It reports image names, not command lines, so it can count `node.exe` processes
 * but cannot tell which one is the Conway runtime. The panel therefore still says UNKNOWN
 * for agent CPU/RAM: substituting this dashboard process's own `process.memoryUsage()`
 * would be the fabricated-value failure the mandate prohibits.
 */
export function probeProcesses(): ProcessProbe {
  const none: ProcessProbe = { ran: false, error: null, nodePids: [], conwayIdentifiable: false };
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("tasklist", ["/FO", "CSV", "/NH"], {
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (cause) {
    return { ...none, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (result.error) {
    return { ...none, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ...none, error: `tasklist exited ${result.status}` };
  }
  const pids: number[] = [];
  for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    if (cols[0].toLowerCase() !== "node.exe") continue;
    const pid = Number(cols[1]);
    if (Number.isFinite(pid)) pids.push(pid);
  }
  return { ran: true, error: null, nodePids: pids, conwayIdentifiable: false };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}
