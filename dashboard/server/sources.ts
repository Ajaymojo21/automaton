import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.js";
import { checkActivation, ACTIVATION_ENV_VAR, ACTIVATION_ENV_VALUE } from "../../src/security/activation.js";
import {
  readEmergencyStop,
  getEmergencyStopPaths,
  type EmergencyStopState,
} from "../../src/security/emergency-stop.js";
import { loadHeartbeatConfig } from "../../src/heartbeat/config.js";
import { ProviderUrlError, validateProviderBaseUrl } from "../../src/inference/provider-url.js";
import { walletExists, getWalletAddress, getWalletPath } from "../../src/identity/wallet.js";
import { runHealthChecks, type HealthReport } from "../../src/reliability/health-guardian.js";
import { assertHome } from "./home.js";
import {
  getDb,
  integrityCheck,
  schemaVersion,
  tableNames,
  countRows,
  CODE_SCHEMA_VERSION,
  type Db,
} from "./db.js";
import {
  CONFIG_PATH,
  EMERGENCY_STOP_PATH,
  PROJECT_BACKUPS_DIR,
  PROJECT_LOGS_DIR,
  PROJECT_REPORTS_DIR,
  REPO_ROOT,
  STATE_DIR,
  PROVIDERS_PATH,
  WALLET_PATH,
} from "./paths.js";
import type { AutomatonConfig } from "../../src/types.js";

/**
 * Every function here is a reader. Nothing in this module imports
 * `src/state/database.ts:createDatabase`, `src/index.ts` (`--status` opens a write handle
 * and migrates), `getWallet` (generates a key when the file is absent),
 * `saveConfig`/`syncHeartbeatToDb`/`loadSkills` (write), `scanSecurityEvents`/`checkTamper`
 * (INSERT incidents), `checkpointWAL` (truncates the WAL) or
 * `engageEmergencyStop`/`clearEmergencyStop` (writes/unlinks the marker). The prohibition
 * is enforced by import, not by convention — see tests/imports.test.ts.
 */

export interface FileMeta {
  exists: boolean;
  path: string;
  bytes: number | null;
  mtimeIso: string | null;
  sha256: string | null;
}

export function fileMeta(file: string, hashLimitBytes = 4 * 1024 * 1024): FileMeta {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { exists: false, path: file, bytes: null, mtimeIso: null, sha256: null };
    const sha = st.size <= hashLimitBytes ? sha256File(file) : null;
    return {
      exists: true,
      path: file,
      bytes: st.size,
      mtimeIso: st.mtime.toISOString(),
      sha256: sha,
    };
  } catch {
    return { exists: false, path: file, bytes: null, mtimeIso: null, sha256: null };
  }
}

export function sha256File(file: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function readConfig(): { config: AutomatonConfig | null; raw: Record<string, unknown> | null; meta: FileMeta } {
  assertHome();
  const meta = fileMeta(CONFIG_PATH);
  let raw: Record<string, unknown> | null = null;
  if (meta.exists) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
    } catch {
      raw = null;
    }
  }
  let config: AutomatonConfig | null = null;
  try {
    config = loadConfig();
  } catch {
    config = null;
  }
  return { config, raw, meta };
}

/**
 * The provider registry as the runtime will see it, read straight from the state-dir file.
 * Registration and URL validation are facts this can show; reachability and real inference are
 * not derived here, so the panel that renders it must keep them NOT VERIFIED.
 * `href` is only ever the value that passed validation — a rejected baseUrl is not echoed,
 * because a rejected URL is exactly the kind of string that can carry embedded credentials.
 */
export interface ProviderRow {
  id: string;
  href: string | null;
  validation: "valid" | "rejected";
  reason: string | null;
  enabled: boolean;
  apiKeyEnvVar: string | null;
  apiKeyPresent: boolean;
}

export interface ProvidersView {
  meta: FileMeta;
  parseError: string | null;
  rows: ProviderRow[];
}

function providerRow(entry: unknown): ProviderRow {
  const record = (entry ?? {}) as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : "(missing id)";
  const declared = typeof record.baseUrl === "string" ? record.baseUrl : null;
  const envVar = typeof record.apiKeyEnvVar === "string" && record.apiKeyEnvVar.length > 0
    ? record.apiKeyEnvVar
    : null;

  let href: string | null = null;
  let reason: string | null = null;
  try {
    href = validateProviderBaseUrl(declared ?? "", id);
  } catch (error) {
    reason = error instanceof ProviderUrlError ? error.reason : "UNPARSEABLE";
  }

  return {
    id,
    href,
    validation: href === null ? "rejected" : "valid",
    reason,
    enabled: record.enabled !== false,
    apiKeyEnvVar: envVar,
    apiKeyPresent: envVar !== null && typeof process.env[envVar] === "string" && process.env[envVar]!.length > 0,
  };
}

export function providersView(): ProvidersView {
  assertHome();
  const meta = fileMeta(PROVIDERS_PATH);
  if (!meta.exists) {
    return { meta, parseError: null, rows: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
  } catch (error) {
    return { meta, parseError: error instanceof Error ? error.message : String(error), rows: [] };
  }

  const declared = (parsed as { providers?: unknown } | null)?.providers;
  const rows = Array.isArray(declared) ? declared.map((entry) => providerRow(entry)) : [];
  return { meta, parseError: null, rows };
}

/**
 * The distinction the mandate demands: a key present in `automaton.json` is *declared*;
 * a value that `loadConfig()` supplied from `DEFAULT_SECURITY_CONFIG` is a code default the
 * operator never chose. `raw` is the file, `config` is the merged object.
 */
export function declaredVsDefault(
  raw: Record<string, unknown> | null,
  config: AutomatonConfig | null,
): Array<{ key: string; declared: boolean; effective: unknown; source: "automaton.json" | "code default" }> {
  const security = (raw?.security ?? {}) as Record<string, unknown>;
  const effectiveSecurity = config?.security ?? {};
  const keys = new Set([...Object.keys(effectiveSecurity), ...Object.keys(security)]);
  return [...keys].sort().map((key) => ({
    key,
    declared: Object.prototype.hasOwnProperty.call(security, key),
    effective: (effectiveSecurity as Record<string, unknown>)[key] ?? null,
    source: Object.prototype.hasOwnProperty.call(security, key) ? "automaton.json" as const : "code default" as const,
  }));
}

export function activationView(config: AutomatonConfig | null): Record<string, unknown> {
  assertHome();
  const gate = config
    ? checkActivation(config, process.env)
    : { approved: false, reason: "no automaton.json to evaluate" };
  // Presence by NAME only. The value of a wallet or activation variable is never read out.
  const envKeys = [
    ACTIVATION_ENV_VAR,
    "CONWAY_ALLOW_WALLET_CREATION",
    "CONWAY_WALLET_PASSPHRASE",
    "CONWAY_LIVE_MODEL_APPROVED",
    "CONWAY_DASHBOARD_TOKEN",
  ];
  return {
    approved: gate.approved,
    reason: gate.reason,
    configActivationApproved: config?.security?.activationApproved ?? null,
    envValueExpected: ACTIVATION_ENV_VALUE,
    envGates: envKeys.map((key) => ({ key, present: process.env[key] !== undefined })),
  };
}

export function emergencyStopView(): {
  state: EmergencyStopState;
  pathsScanned: string[];
  canonicalMarker: FileMeta;
} {
  assertHome();
  return {
    state: readEmergencyStop(),
    pathsScanned: getEmergencyStopPaths(),
    canonicalMarker: fileMeta(EMERGENCY_STOP_PATH),
  };
}

export function walletView(config: AutomatonConfig | null): Record<string, unknown> {
  assertHome();
  const exists = walletExists();
  const meta = fileMeta(WALLET_PATH);
  const srcPath = path.resolve(getWalletPath());
  return {
    // walletExists()/getWalletAddress() are the read-only pair. getWallet() is not called:
    // with no wallet.json it generates a key and writes an encrypted file.
    exists,
    address: exists ? getWalletAddress() : null,
    path: srcPath,
    // Two independent derivations of the wallet location must agree before `exists` is
    // trusted: the module follows HOME, the panel follows the pinned path constant.
    pathAgreement: srcPath === path.resolve(WALLET_PATH),
    declaredAddressInConfig: config?.walletAddress || null,
    file: meta,
    // getWalletChainType() returns "evm" as a default with no wallet present, which is
    // indistinguishable from a real EVM wallet, so the dashboard does not call it.
    chainType: exists ? "NOT VERIFIED (API returns a default, not an observation)" : "UNKNOWN (no wallet)",
  };
}

export function heartbeatView(): { file: FileMeta; config: Record<string, unknown> | null; error: string | null } {
  assertHome();
  const file = fileMeta(path.join(STATE_DIR, "heartbeat.yml"));
  try {
    const config = loadHeartbeatConfig(file.path) as unknown as Record<string, unknown>;
    const entries = Array.isArray(config.entries) ? config.entries : [];
    return {
      file,
      config: {
        ...config,
        entries,
        entryCount: entries.length,
        enabledCount: entries.filter((e: { enabled?: boolean }) => e?.enabled === true).length,
      },
      error: null,
    };
  } catch (cause) {
    return { file, config: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function healthView(): { report: HealthReport | null; error: string | null } {
  assertHome();
  const dbResult = getDb();
  if (!dbResult.ok) return { report: null, error: dbResult.error };
  const { config } = readConfig();
  if (!config) return { report: null, error: "automaton.json unreadable" };
  try {
    const report = runHealthChecks({
      db: dbResult.handle.db,
      config,
      automatonDir: STATE_DIR,
    });
    return { report: sanitiseHealth(report), error: null };
  } catch (cause) {
    return { report: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Wallet field NAMES are never forwarded, even though they are only key names: the
 *  operator-facing panel must show existence, not structure. */
function sanitiseHealth(report: HealthReport): HealthReport {
  return {
    ...report,
    checks: report.checks.map((check) => {
      if (check.id !== "wallet_storage" || !check.evidence) return check;
      const { fields: _fields, ...rest } = check.evidence;
      return { ...check, evidence: rest };
    }),
  };
}

export interface DbInventory {
  file: FileMeta;
  error: string | null;
  integrity: string | null;
  liveVersion: number | null;
  codeVersion: number;
  journalMode: string | null;
  tables: Array<{ name: string; rows: number }> | null;
  walSidecars: Array<{ name: string; bytes: number | null }>;
}

export function dbInventory(): DbInventory {
  assertHome();
  const file = fileMeta(path.resolve(STATE_DIR, "state.db"), 0);
  const result = getDb();
  const base: DbInventory = {
    file,
    error: result.ok ? null : result.error,
    integrity: null,
    liveVersion: null,
    codeVersion: CODE_SCHEMA_VERSION,
    journalMode: null,
    tables: null,
    walSidecars: sidecars(),
  };
  if (!result.ok) return base;
  const db = result.handle.db;
  try {
    const names = [...tableNames(db)].sort();
    const version = schemaVersion(db);
    return {
      ...base,
      integrity: integrityCheck(db),
      liveVersion: version.live,
      codeVersion: version.code,
      journalMode: String(db.pragma("journal_mode", { simple: true }) ?? "unknown"),
      tables: names.map((name) => ({ name, rows: safeCount(db, name) })),
    };
  } catch (cause) {
    return { ...base, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function safeCount(db: Db, name: string): number {
  try {
    return countRows(db, name);
  } catch {
    return -1;
  }
}

function sidecars(): Array<{ name: string; bytes: number | null }> {
  return ["-wal", "-shm"].map((suffix) => {
    const p = `${path.resolve(STATE_DIR, "state.db")}${suffix}`;
    try {
      return { name: path.basename(p), bytes: fs.statSync(p).size };
    } catch {
      return { name: path.basename(p), bytes: null };
    }
  });
}

export function logsView(): {
  dir: string;
  exists: boolean;
  files: Array<{ name: string; bytes: number; mtimeIso: string }>;
  pidFile: FileMeta;
} {
  const files: Array<{ name: string; bytes: number; mtimeIso: string }> = [];
  let exists = false;
  try {
    exists = fs.statSync(PROJECT_LOGS_DIR).isDirectory();
    for (const name of fs.readdirSync(PROJECT_LOGS_DIR)) {
      try {
        const st = fs.statSync(path.join(PROJECT_LOGS_DIR, name));
        if (st.isFile()) files.push({ name, bytes: st.size, mtimeIso: st.mtime.toISOString() });
      } catch {
        /* a file that vanished mid-listing is not state */
      }
    }
  } catch {
    exists = false;
  }
  files.sort((a, b) => (a.mtimeIso < b.mtimeIso ? 1 : -1));
  return {
    dir: PROJECT_LOGS_DIR,
    exists,
    files: files.slice(0, 50),
    pidFile: fileMeta(path.join(PROJECT_LOGS_DIR, "automaton.pid")),
  };
}

export function backupsView(limit = 40): {
  dir: string;
  exists: boolean;
  entries: Array<{ name: string; kind: "directory" | "file"; bytes: number | null; mtimeIso: string | null }>;
} {
  const entries: Array<{ name: string; kind: "directory" | "file"; bytes: number | null; mtimeIso: string | null }> = [];
  let exists = false;
  try {
    exists = fs.statSync(PROJECT_BACKUPS_DIR).isDirectory();
    for (const name of fs.readdirSync(PROJECT_BACKUPS_DIR)) {
      const meta = fileMeta(path.join(PROJECT_BACKUPS_DIR, name), 0);
      let isDir = false;
      try {
        isDir = fs.statSync(path.join(PROJECT_BACKUPS_DIR, name)).isDirectory();
      } catch {
        isDir = false;
      }
      entries.push({
        name,
        kind: isDir ? "directory" : "file",
        bytes: isDir ? null : meta.bytes,
        mtimeIso: isDir ? new Date(fs.statSync(path.join(PROJECT_BACKUPS_DIR, name)).mtime).toISOString() : meta.mtimeIso,
      });
    }
  } catch {
    exists = false;
  }
  entries.sort((a, b) => (b.mtimeIso ?? "").localeCompare(a.mtimeIso ?? ""));
  return { dir: PROJECT_BACKUPS_DIR, exists, entries: entries.slice(0, limit) };
}

export function reportsView(): Record<string, FileMeta> {
  const names = ["health-latest.json", "security-audit-latest.json"];
  const out: Record<string, FileMeta> = {};
  for (const name of names) out[name] = fileMeta(path.join(PROJECT_REPORTS_DIR, name), 0);
  out["SOUL.md (repo root)"] = fileMeta(path.join(REPO_ROOT, "SOUL.md"), 0);
  out["SOUL.md (state dir)"] = fileMeta(path.join(STATE_DIR, "SOUL.md"), 0);
  return out;
}

export interface OsSample {
  cpuPercent: number | null;
  cores: number;
  loadAvg: number[];
  loadAvgUsable: boolean;
  totalMemBytes: number;
  freeMemBytes: number;
  usedMemPercent: number;
  platform: string;
  release: string;
  arch: string;
  nodeVersion: string;
  uptimeSeconds: number;
}

/**
 * `os.loadavg()` is `[0,0,0]` on Windows — a real measurement of nothing. CPU percent
 * therefore comes from two `os.cpus()` samples, and the loadavg field carries a flag that
 * tells the UI not to render it as zero.
 */
export async function osSample(sampleMs = 150): Promise<OsSample> {
  const before = os.cpus();
  const wallBefore = process.hrtime.bigint();
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const after = os.cpus();
  const wallAfter = process.hrtime.bigint();
  const busy = sumCpu(after) - sumCpu(before);
  const spanMs = Number(wallAfter - wallBefore) / 1e6;
  const total = after.length * spanMs;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg();
  return {
    cpuPercent: total > 0 ? Math.min(100, Math.round((busy / total) * 1000) / 10) : null,
    cores: after.length,
    loadAvg: load,
    loadAvgUsable: process.platform !== "win32",
    totalMemBytes: totalMem,
    freeMemBytes: freeMem,
    usedMemPercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    uptimeSeconds: Math.round(os.uptime()),
  };
}

function sumCpu(cpus: os.CpuInfo[]): number {
  return cpus.reduce(
    (acc, cpu) => acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq,
    0,
  );
}

export function diskSpace(dir: string): { totalBytes: number; freeBytes: number } | null {
  try {
    const stats = fs.statfsSync(path.resolve(dir));
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  } catch {
    return null;
  }
}
