/**
 * Health Guardian (Phase 15F, extended for §4 of the final mission)
 *
 * Read-only health checks over the runtime database, audit chain, wallet storage
 * format, scheduler leases, treasury posture, provider configuration, security
 * invariants, dependencies, backups, disk space and the guardian's own process.
 *
 * The guardian never mutates state and never performs an outbound request: checks
 * that would need one are reported as `blocked` rather than probed.
 *
 * Five verdicts:
 *   pass              — observed healthy
 *   warn              — observed degraded, no action beyond attention
 *   fail              — observed broken
 *   blocked           — the source or the permission to assess it is absent; the
 *                       check could not be performed, which is not the same as failing
 *   requires_operator — observed state a human must correct (invariant drift, tamper)
 *
 * Severity order for the headline: fail > requires_operator > blocked > warn > pass.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonConfig, TreasuryPolicy } from "../types.js";
import { conwayRoot, stateDir } from "../runtime/home-guard.js";
import { SCHEMA_VERSION } from "../state/schema.js";
import { verifySecurityChain, verifySeals } from "../security/audit-chain.js";
import { resolveTreasuryPolicy } from "../security/treasury-guard.js";
import {
  isEmergencyStopEngagedInDb,
  readEmergencyStop,
  type EmergencyStopState,
} from "../security/emergency-stop.js";
import { ProviderUrlError, validateProviderBaseUrl } from "../inference/provider-url.js";

type DatabaseType = BetterSqlite3.Database;

export type HealthStatus = "pass" | "warn" | "fail" | "blocked" | "requires_operator";
export type HealthSummary = "healthy" | "degraded" | "failed" | "blocked" | "requires_operator";
export type OverallHealth = "ok" | "degraded" | "critical" | "blocked" | "requires_operator";

export interface HealthCheck {
  id: string;
  title: string;
  status: HealthStatus;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface HealthReport {
  generatedAt: string;
  /** Five-state headline. `overall` is the same verdict in the pre-existing vocabulary. */
  summary?: HealthSummary;
  overall: OverallHealth;
  emergencyStop: boolean;
  checks: HealthCheck[];
}

export interface HealthGuardianOptions {
  db: DatabaseType;
  config: AutomatonConfig;
  /** Directory containing automaton.json, wallet.json and the marker. */
  automatonDir?: string;
  /** Archive root to inspect. Defaults to `<repo>/backups`. */
  backupsDir?: string;
  now?: Date;
}

const ABSENT_TABLE = /no such table:\s*([a-z0-9_]+)/i;

function absentTable(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  const match = ABSENT_TABLE.exec(text);
  return match ? match[1] : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  // Previously this read the interactive user profile when HOME was unset, so a health
  // report could describe a state tree Conway never writes.
  return stateDir();
}

function checkEmergencyStop(
  state: EmergencyStopState,
  engagedInAuditTrail: boolean,
): HealthCheck {
  if (state.engaged || engagedInAuditTrail) {
    return {
      id: "emergency_stop",
      title: "Emergency stop",
      status: "fail",
      message: state.engaged
        ? `Emergency stop engaged: ${state.reason ?? "unknown"}`
        : "Emergency stop engaged in the audit trail (marker file missing)",
      evidence: {
        marker: state.engaged,
        auditTrail: engagedInAuditTrail,
        engagedAt: state.engagedAt,
        engagedBy: state.engagedBy,
      },
    };
  }
  return {
    id: "emergency_stop",
    title: "Emergency stop",
    status: "pass",
    message: "Not engaged",
  };
}

function checkDatabaseIntegrity(db: DatabaseType): HealthCheck {
  try {
    const rows = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
    const result = rows.map((row) => Object.values(row)[0]).join("; ");
    if (rows.length === 1 && result === "ok") {
      return {
        id: "database_integrity",
        title: "SQLite integrity",
        status: "pass",
        message: "quick_check ok",
      };
    }
    return {
      id: "database_integrity",
      title: "SQLite integrity",
      status: "fail",
      message: `quick_check reported: ${result}`,
    };
  } catch (error) {
    return {
      id: "database_integrity",
      title: "SQLite integrity",
      status: "fail",
      message: errorMessage(error, "quick_check failed"),
    };
  }
}

function checkSchemaVersion(db: DatabaseType): HealthCheck {
  try {
    const row = db
      .prepare("SELECT MAX(version) AS version FROM schema_version")
      .get() as { version: number | null } | undefined;
    const version = row?.version ?? 0;
    if (version >= SCHEMA_VERSION) {
      return {
        id: "schema_version",
        title: "Schema version",
        status: "pass",
        message: `schema ${version}`,
        evidence: { version, expected: SCHEMA_VERSION },
      };
    }
    return {
      id: "schema_version",
      title: "Schema version",
      status: "warn",
      message: `schema ${version} is older than ${SCHEMA_VERSION}; migrations run on next open`,
      evidence: { version, expected: SCHEMA_VERSION },
    };
  } catch (error) {
    return {
      id: "schema_version",
      title: "Schema version",
      status: "fail",
      message: errorMessage(error, "schema_version unreadable"),
    };
  }
}

function checkAuditChain(db: DatabaseType): HealthCheck {
  try {
    const chain = verifySecurityChain(db);
    if (!chain.valid) {
      // A broken chain on a table that exists is tamper: only a human may investigate it.
      return {
        id: "audit_chain",
        title: "Audit chain",
        status: "requires_operator",
        message: chain.reason ?? "chain verification failed",
        evidence: { brokenAtSequence: chain.brokenAtSequence },
      };
    }
    const seals = verifySeals(db);
    if (!seals.valid) {
      return {
        id: "audit_chain",
        title: "Audit chain",
        status: "requires_operator",
        message: seals.reason ?? "seal verification failed",
      };
    }
    return {
      id: "audit_chain",
      title: "Audit chain",
      status: "pass",
      message: `${chain.checked} events verified, ${seals.checked} seals`,
    };
  } catch (error) {
    const table = absentTable(error);
    if (table) {
      return {
        id: "audit_chain",
        title: "Audit chain",
        status: "blocked",
        message: `not assessed: table ${table} is absent from this database`,
        evidence: { absentTable: table },
      };
    }
    return {
      id: "audit_chain",
      title: "Audit chain",
      status: "fail",
      message: errorMessage(error, "chain unavailable"),
    };
  }
}

function checkStuckReservations(db: DatabaseType, now: Date): HealthCheck {
  try {
    const cutoff = now.getTime() - 10 * 60_000;
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM treasury_authorizations WHERE status = 'reserved' AND created_ms < ?",
      )
      .get(cutoff) as { n: number };
    if (row.n === 0) {
      return {
        id: "treasury_reservations",
        title: "Treasury reservations",
        status: "pass",
        message: "no reservations older than 10 minutes",
      };
    }
    return {
      id: "treasury_reservations",
      title: "Treasury reservations",
      status: "warn",
      message: `${row.n} reservation(s) older than 10 minutes`,
      evidence: { count: row.n },
    };
  } catch (error) {
    const table = absentTable(error);
    return {
      id: "treasury_reservations",
      title: "Treasury reservations",
      status: table ? "blocked" : "warn",
      message: table
        ? `not assessed: table ${table} is absent from this database`
        : "treasury table unavailable",
      evidence: table ? { absentTable: table } : undefined,
    };
  }
}

function checkExpiredLeases(db: DatabaseType, now: Date): HealthCheck {
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM heartbeat_schedule WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ?",
      )
      .get(now.toISOString()) as { n: number };
    if (row.n === 0) {
      return {
        id: "scheduler_leases",
        title: "Scheduler leases",
        status: "pass",
        message: "no expired leases",
      };
    }
    return {
      id: "scheduler_leases",
      title: "Scheduler leases",
      status: "warn",
      message: `${row.n} expired lease(s)`,
      evidence: { count: row.n },
    };
  } catch (error) {
    const table = absentTable(error);
    return {
      id: "scheduler_leases",
      title: "Scheduler leases",
      status: table ? "blocked" : "warn",
      message: table
        ? `not assessed: table ${table} is absent from this database`
        : "heartbeat_schedule unavailable",
      evidence: table ? { absentTable: table } : undefined,
    };
  }
}

function checkDiskSpace(dir: string): HealthCheck {
  try {
    const stats = (
      fs as unknown as {
        statfsSync?: (target: string) => { bsize: number; bavail: number; blocks: number };
      }
    ).statfsSync?.(dir);
    if (!stats || stats.blocks === 0) {
      return {
        id: "disk_space",
        title: "Disk space",
        status: "warn",
        message: "free-space probe unavailable",
      };
    }
    const freeBytes = stats.bavail * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const ratio = totalBytes > 0 ? freeBytes / totalBytes : 0;
    const status: HealthStatus = ratio < 0.03 ? "fail" : ratio < 0.1 ? "warn" : "pass";
    return {
      id: "disk_space",
      title: "Disk space",
      status,
      message: `${(ratio * 100).toFixed(1)}% free (${(freeBytes / 1024 ** 3).toFixed(1)} GiB)`,
      evidence: { freeBytes, totalBytes, ratio },
    };
  } catch {
    return {
      id: "disk_space",
      title: "Disk space",
      status: "warn",
      message: "free-space probe failed",
    };
  }
}

function checkWalletStorage(dir: string): HealthCheck {
  const walletPath = path.join(dir, "wallet.json");
  if (!fs.existsSync(walletPath)) {
    return {
      id: "wallet_storage",
      title: "Wallet storage",
      status: "pass",
      message: "no wallet on disk",
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as Record<string, unknown>;
    const hasPlaintext = "privateKey" in raw || "secretKey" in raw;
    if (hasPlaintext) {
      return {
        id: "wallet_storage",
        title: "Wallet storage",
        status: "fail",
        message: "wallet.json contains plaintext key material",
        evidence: { fields: Object.keys(raw) },
      };
    }
    if (
      typeof raw.version === "number" &&
      typeof raw.algorithm === "string" &&
      typeof raw.ciphertext === "string"
    ) {
      return {
        id: "wallet_storage",
        title: "Wallet storage",
        status: "pass",
        message: "encrypted envelope detected",
        evidence: { fields: Object.keys(raw) },
      };
    }
    return {
      id: "wallet_storage",
      title: "Wallet storage",
      status: "warn",
      message: "wallet.json format not recognized",
      evidence: { fields: Object.keys(raw) },
    };
  } catch (error) {
    return {
      id: "wallet_storage",
      title: "Wallet storage",
      status: "fail",
      message: errorMessage(error, "wallet.json unreadable"),
    };
  }
}

/**
 * What this process can observe about "running". Under the activation gate the agent is
 * deliberately not started, so absence of a lease is the expected state, not a fault.
 */
function checkProcess(config: AutomatonConfig, db: DatabaseType, now: Date): HealthCheck {
  const evidence = {
    pid: process.pid,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    activationApproved: config.security?.activationApproved === true,
  };
  if (config.security?.activationApproved !== true) {
    return {
      id: "process",
      title: "Agent process",
      status: "pass",
      message: `guardian pid ${process.pid} alive (node ${process.version}); agent not started: activation gate closed`,
      evidence,
    };
  }
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM heartbeat_schedule WHERE lease_expires_at IS NOT NULL AND lease_expires_at > ?",
      )
      .get(now.toISOString()) as { n: number };
    if (row.n > 0) {
      return {
        id: "process",
        title: "Agent process",
        status: "pass",
        message: `activation approved; ${row.n} live scheduler lease(s)`,
        evidence: { ...evidence, liveLeases: row.n },
      };
    }
    return {
      id: "process",
      title: "Agent process",
      status: "warn",
      message: "activation approved but no live scheduler lease — the agent is not running",
      evidence: { ...evidence, liveLeases: 0 },
    };
  } catch (error) {
    const table = absentTable(error);
    return {
      id: "process",
      title: "Agent process",
      status: table ? "blocked" : "warn",
      message: table
        ? `not assessed: table ${table} is absent from this database`
        : "scheduler state unavailable",
      evidence,
    };
  }
}

/** The console is a separate process. Its liveness is never probed here and never equals agent health. */
function checkDashboard(): HealthCheck {
  const root = conwayRoot();
  const server = path.join(root, "dashboard", "server", "index.ts");
  const built = path.join(root, "dashboard", "dist", "index.html");
  if (!fs.existsSync(server)) {
    return {
      id: "dashboard",
      title: "Dashboard console",
      status: "warn",
      message: "dashboard/server/index.ts is missing; the operator console cannot start",
      evidence: { sourcesPresent: false },
    };
  }
  return {
    id: "dashboard",
    title: "Dashboard console",
    status: "pass",
    message: `console sources present (${fs.existsSync(built) ? "build present" : "not built"}); liveness NOT VERIFIED — no outbound probe is allowed, and console health is not agent health`,
    evidence: { sourcesPresent: true, buildPresent: fs.existsSync(built) },
  };
}

interface ProviderFileEntry {
  id?: unknown;
  enabled?: unknown;
  baseUrl?: unknown;
}

/**
 * Configuration-only provider check. It validates the base URL with the same policy the
 * request path uses, and deliberately makes no request: credentials are never read here.
 */
function checkProviderConfig(dir: string, config: AutomatonConfig): HealthCheck {
  const configPath = path.join(dir, "inference-providers.json");
  if (!fs.existsSync(configPath)) {
    if (config.security?.activationApproved !== true) {
      return {
        id: "provider_config",
        title: "Inference provider",
        status: "pass",
        message: "no provider config and the activation gate is closed; no provider is in use",
        evidence: { configPresent: false },
      };
    }
    return {
      id: "provider_config",
      title: "Inference provider",
      status: "warn",
      message: "no provider config; the registry would fall back to its shipped defaults",
      evidence: { configPresent: false },
    };
  }

  let providers: ProviderFileEntry[];
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { providers?: unknown };
    if (!Array.isArray(raw.providers)) {
      return {
        id: "provider_config",
        title: "Inference provider",
        status: "warn",
        message: "inference-providers.json declares no provider list; shipped defaults would be used",
        evidence: { configPresent: true },
      };
    }
    providers = raw.providers as ProviderFileEntry[];
  } catch {
    return {
      id: "provider_config",
      title: "Inference provider",
      status: "fail",
      message: "inference-providers.json is not valid JSON",
      evidence: { configPresent: true },
    };
  }

  const enabled = providers.filter((entry) => entry && entry.enabled !== false);
  const rejected: string[] = [];
  for (const entry of enabled) {
    const id = typeof entry.id === "string" ? entry.id : "unnamed";
    try {
      validateProviderBaseUrl(entry.baseUrl, id);
    } catch (error) {
      rejected.push(error instanceof ProviderUrlError ? `${id}:${error.reason}` : `${id}:invalid`);
    }
  }

  if (rejected.length > 0) {
    return {
      id: "provider_config",
      title: "Inference provider",
      status: "fail",
      message: `provider base URL rejected by the outbound policy: ${rejected.join(", ")}`,
      evidence: { configPresent: true, enabled: enabled.length, rejected },
    };
  }
  if (enabled.length === 0) {
    return {
      id: "provider_config",
      title: "Inference provider",
      status: "warn",
      message: "no enabled provider is declared",
      evidence: { configPresent: true, enabled: 0 },
    };
  }
  return {
    id: "provider_config",
    title: "Inference provider",
    status: "pass",
    message: `${enabled.length} enabled provider(s) passed URL policy; live credentials NOT VERIFIED (no request made)`,
    evidence: {
      configPresent: true,
      enabled: enabled.length,
      ids: enabled.map((entry) => (typeof entry.id === "string" ? entry.id : "unnamed")),
    },
  };
}

/**
 * A locked-down runtime must not simultaneously permit a dangerous capability. This is a
 * coherence check: an unlocked runtime is an operator decision, but `lockdown: true` with
 * `allowFinancialTools: true` is a contradiction a human must correct.
 */
function checkSecurityInvariants(config: AutomatonConfig): HealthCheck {
  const security = config.security;
  if (!security) {
    return {
      id: "security_invariants",
      title: "Security invariants",
      status: "warn",
      message: "no security block in the loaded config; defaults apply",
    };
  }

  const contradictions: string[] = [];
  if (security.lockdown === true) {
    for (const key of [
      "allowFinancialTools",
      "allowHostShell",
      "allowSelfModification",
      "allowReplication",
      "allowExternalExposure",
    ] as const) {
      if (security[key] === true) contradictions.push(`${key}=true`);
    }
    if (security.allowedTools.length > 0) contradictions.push("allowedTools is not empty");
    if ((security.allowedCapabilities ?? []).length > 0) contradictions.push("allowedCapabilities is not empty");
  }

  if (contradictions.length > 0) {
    return {
      id: "security_invariants",
      title: "Security invariants",
      status: "requires_operator",
      message: `security posture is inconsistent: ${contradictions.join("; ")}`,
      evidence: { lockdown: security.lockdown, contradictions },
    };
  }
  return {
    id: "security_invariants",
    title: "Security invariants",
    status: "pass",
    message: security.lockdown
      ? "lockdown engaged with no permitted capability"
      : "lockdown not engaged; capabilities are allowlisted",
    evidence: { lockdown: security.lockdown, allowedTools: security.allowedTools.length },
  };
}

const TREASURY_NUMERIC_LIMITS: Array<keyof TreasuryPolicy> = [
  "maxSingleTransferCents",
  "maxHourlyTransferCents",
  "maxDailyTransferCents",
  "minimumReserveCents",
  "maxX402PaymentCents",
  "transferCooldownMs",
  "maxTransfersPerTurn",
  "maxInferenceDailyCents",
  "requireConfirmationAboveCents",
  "maxMonthlyTransferCents",
  "agentBudgetCents",
  "childBudgetCents",
];

/** Under lockdown every limit must resolve to zero; the effective policy is what counts. */
function checkTreasuryLimits(config: AutomatonConfig): HealthCheck {
  if (config.security?.lockdown !== true) {
    return {
      id: "treasury_limits",
      title: "Treasury limits",
      status: "pass",
      message: "lockdown is not engaged; the treasury policy is the operator's own",
    };
  }
  const policy = resolveTreasuryPolicy(config);
  const nonZero = TREASURY_NUMERIC_LIMITS.filter((key) => policy[key] !== 0);
  const domains = policy.x402AllowedDomains.length;
  if (nonZero.length > 0 || domains > 0) {
    return {
      id: "treasury_limits",
      title: "Treasury limits",
      status: "requires_operator",
      message: `lockdown is engaged but ${nonZero.length} limit(s) are non-zero and ${domains} x402 domain(s) are allowed`,
      evidence: { nonZero: nonZero.map(String), x402AllowedDomains: domains },
    };
  }
  return {
    id: "treasury_limits",
    title: "Treasury limits",
    status: "pass",
    message: `${TREASURY_NUMERIC_LIMITS.length} monetary limits are zero and the x402 allowlist is empty`,
    evidence: { limitsChecked: TREASURY_NUMERIC_LIMITS.length },
  };
}

/** High-severity audit events in the last day are the runtime-error signal available offline. */
function checkRuntimeErrors(db: DatabaseType, now: Date): HealthCheck {
  try {
    const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM security_events WHERE severity IN ('HIGH','CRITICAL') AND timestamp >= ?",
      )
      .get(since) as { n: number };
    if (row.n === 0) {
      return {
        id: "runtime_errors",
        title: "Runtime errors",
        status: "pass",
        message: "no HIGH/CRITICAL security events in the last 24h",
      };
    }
    return {
      id: "runtime_errors",
      title: "Runtime errors",
      status: "warn",
      message: `${row.n} HIGH/CRITICAL security event(s) in the last 24h`,
      evidence: { count: row.n },
    };
  } catch (error) {
    const table = absentTable(error);
    return {
      id: "runtime_errors",
      title: "Runtime errors",
      status: table ? "blocked" : "warn",
      message: table
        ? `not assessed: table ${table} is absent from this database`
        : "security_events unavailable",
      evidence: table ? { absentTable: table } : undefined,
    };
  }
}

function checkDependencies(): HealthCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 22) {
    return {
      id: "dependency",
      title: "Runtime dependencies",
      status: "fail",
      message: `node ${process.versions.node} is older than the supported 22.x runtime`,
      evidence: { node: process.version },
    };
  }
  const requireFromHere = createRequire(import.meta.url);
  const missing: string[] = [];
  for (const name of ["better-sqlite3", "openai"]) {
    try {
      requireFromHere.resolve(name);
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    return {
      id: "dependency",
      title: "Runtime dependencies",
      status: "fail",
      message: `runtime dependency not resolvable: ${missing.join(", ")}`,
      evidence: { missing },
    };
  }
  return {
    id: "dependency",
    title: "Runtime dependencies",
    status: "pass",
    message: `node ${process.versions.node}; core dependencies resolvable`,
    evidence: { node: process.version },
  };
}

const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Reads the newest archive manifest. It does not re-hash the archive; the console does that. */
function checkBackup(backupsDir: string, now: Date): HealthCheck {
  if (!fs.existsSync(backupsDir)) {
    return {
      id: "backup",
      title: "Backup",
      status: "warn",
      message: "no backups/ directory; no verified archive is available for recovery",
    };
  }
  let newest: { name: string; at: number } | null = null;
  for (const entry of fs.readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(backupsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifest)) continue;
    const at = fs.statSync(manifest).mtimeMs;
    if (!newest || at > newest.at) newest = { name: entry.name, at };
  }
  if (!newest) {
    return {
      id: "backup",
      title: "Backup",
      status: "warn",
      message: "no archive with a manifest.json in backups/",
    };
  }
  const ageMs = now.getTime() - newest.at;
  const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60_000)));
  if (ageMs > BACKUP_MAX_AGE_MS) {
    return {
      id: "backup",
      title: "Backup",
      status: "warn",
      message: `latest verified archive is ${ageDays} day(s) old`,
      evidence: { archive: newest.name, ageDays },
    };
  }
  return {
    id: "backup",
    title: "Backup",
    status: "pass",
    message: `latest archive ${newest.name} is ${ageDays} day(s) old`,
    evidence: { archive: newest.name, ageDays },
  };
}

const SEVERITY: Record<HealthStatus, number> = {
  pass: 0,
  warn: 1,
  blocked: 2,
  requires_operator: 3,
  fail: 4,
};

function summarize(checks: HealthCheck[]): { summary: HealthSummary; overall: OverallHealth } {
  let worst: HealthStatus = "pass";
  for (const check of checks) {
    if (SEVERITY[check.status] > SEVERITY[worst]) worst = check.status;
  }
  switch (worst) {
    case "fail":
      return { summary: "failed", overall: "critical" };
    case "requires_operator":
      return { summary: "requires_operator", overall: "requires_operator" };
    case "blocked":
      return { summary: "blocked", overall: "blocked" };
    case "warn":
      return { summary: "degraded", overall: "degraded" };
    default:
      return { summary: "healthy", overall: "ok" };
  }
}

export function runHealthChecks(options: HealthGuardianOptions): HealthReport {
  const now = options.now ?? new Date();
  const dir = resolveDir(options.automatonDir);
  const marker = readEmergencyStop(dir);
  const stopInAuditTrail = isEmergencyStopEngagedInDb(options.db);
  const emergencyStop = marker.engaged || stopInAuditTrail;
  const backupsDir = options.backupsDir ?? path.join(conwayRoot(), "backups");

  const checks: HealthCheck[] = [
    checkEmergencyStop(marker, stopInAuditTrail),
    checkProcess(options.config, options.db, now),
    checkDatabaseIntegrity(options.db),
    checkSchemaVersion(options.db),
    checkAuditChain(options.db),
    checkStuckReservations(options.db, now),
    checkExpiredLeases(options.db, now),
    checkRuntimeErrors(options.db, now),
    checkSecurityInvariants(options.config),
    checkTreasuryLimits(options.config),
    checkProviderConfig(dir, options.config),
    checkDependencies(),
    checkBackup(backupsDir, now),
    checkDiskSpace(dir),
    checkWalletStorage(dir),
    checkDashboard(),
  ];

  const { summary, overall } = summarize(checks);

  return {
    generatedAt: now.toISOString(),
    summary,
    overall,
    emergencyStop,
    checks,
  };
}
