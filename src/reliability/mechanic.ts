/**
 * Autonomous Mechanic (Phase 15F)
 *
 * Executes a small, fixed set of pre-approved repairs derived from a health
 * report. Everything else is either queued for human approval or refused
 * outright.
 *
 * Hard limits (enforced by classification, not by prompt):
 *   - never touches wallet keys or key material;
 *   - never changes financial limits or authorizes a transaction;
 *   - never disables a security control (audit, sandbox, authorization);
 *   - never grants permissions or capabilities;
 *   - never enables replication or spawning;
 *   - never exposes a network endpoint;
 *   - never changes Defender, firewall, BitLocker or Windows security settings.
 *
 * Repair execution is additionally gated on `security.selfHealingEnabled`
 * (default false) and is suppressed entirely while the emergency stop is
 * engaged.
 *
 * The mechanic takes no approval records and reads no approval store: a recorded
 * approval changes nothing here, because approving is a separate, non-executing act.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonConfig } from "../types.js";
import {
  clearExpiredLeases,
  pruneExpiredDedupKeys,
} from "../state/database.js";
import { tryAppendSecurityEvent, tryAppendSecuritySeal } from "../security/audit-chain.js";
import { isEmergencyStopEngaged, isEmergencyStopEngagedInDb } from "../security/emergency-stop.js";
import type { HealthReport, HealthStatus } from "./health-guardian.js";

type DatabaseType = BetterSqlite3.Database;

export type RepairClassification = "automatic" | "requires_approval" | "forbidden";

export interface RepairClassificationResult {
  classification: RepairClassification;
  reason: string;
}

const AUTOMATIC_REPAIRS = new Set([
  "prune_expired_leases",
  "prune_dedup_keys",
  "rotate_audit_seal",
]);

const APPROVAL_REPAIRS = new Set([
  "release_stale_treasury_reservations",
  "vacuum_database",
  "reencrypt_wallet",
  "refresh_wallet_backup",
  "investigate_audit_tamper",
]);

/** Text that must never reach an automated repair path. */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /wallet\s*(key|private|secret|seed|mnemonic)/i, reason: "wallet key material" },
  { pattern: /private[_\s-]?key|seed phrase|mnemonic/i, reason: "key material" },
  { pattern: /(financial|treasury|spend|transfer)[_\s-]*(limit|cap|budget|policy)/i, reason: "financial limit" },
  { pattern: /authori[sz]e|approve\s+(payment|transaction)|sign\s+transaction|send\s+transaction/i, reason: "transaction authorization" },
  { pattern: /disable[_\s-]+(audit|sandbox|security|authoriz|lockdown|monitor)/i, reason: "security control" },
  { pattern: /(grant|elevate|revoke|widen)[_\s-]+(permission|capabilit|privilege|admin)/i, reason: "permission grant" },
  // Activation approval is the human gate on the whole runtime. It must be refused by
  // name, not only because no approved registry entry happens to cover it yet.
  { pattern: /activation[_\s-]*(approv|gate|enabled?)|(approv|enable|disable|set|grant|clear)[_\s-]+activation/i, reason: "activation approval" },
  // Tool/capability allowlists are the authorization surface itself.
  { pattern: /(allowed|allow)[_\s-]*(tools?|capabilit|list)|(tools?|capabilit)[_\s-]*allow(ed|ist)/i, reason: "tool permission allowlist" },
  { pattern: /replication|spawn\s+child|create\s+child|enable\s+children/i, reason: "replication" },
  { pattern: /expose\s+(port|endpoint)|public\s+url|tunnel/i, reason: "network exposure" },
  { pattern: /defender|firewall|bitlocker|windows\s+security|smart\s*screen/i, reason: "Windows security setting" },
  { pattern: /\b(acl|icacls|takeown|permissions?\s+change)\b/i, reason: "filesystem permission" },
  { pattern: /api[_\s-]?key|credential|password|token/i, reason: "credential handling" },
];

export function classifyRepair(repairId: string, description = ""): RepairClassificationResult {
  const text = `${repairId} ${description}`;
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      return {
        classification: "forbidden",
        reason: `Refused: repair would affect ${reason}`,
      };
    }
  }
  if (AUTOMATIC_REPAIRS.has(repairId)) {
    return { classification: "automatic", reason: "pre-approved maintenance repair" };
  }
  if (APPROVAL_REPAIRS.has(repairId)) {
    return {
      classification: "requires_approval",
      reason: "repair touches protected state and needs human approval",
    };
  }
  return {
    classification: "forbidden",
    reason: "Refused: unknown repair id is not in the approved registry",
  };
}

export interface RepairAction {
  repairId: string;
  checkId: string;
  status: "applied" | "failed" | "skipped";
  detail: string;
  changes?: number;
}

export interface MechanicOutcome {
  enabled: boolean;
  emergencyStop: boolean;
  skippedReason?: string;
  actions: RepairAction[];
  pendingApproval: Array<{ repairId: string; reason: string }>;
  seal?: { sequence: number; headHash: string };
}

export interface MechanicOptions {
  db: DatabaseType;
  config: AutomatonConfig;
  automatonDir?: string;
  now?: Date;
  /** Explicit override for tests or a human-run maintenance command. */
  allowRepairs?: boolean;
  /** Called before each repair executes; return false to abort that repair. */
  confirm?: (repairId: string) => boolean;
}

function statusFor(checkId: string, report: HealthReport): HealthStatus {
  return report.checks.find((check) => check.id === checkId)?.status ?? "pass";
}

/**
 * Run the mechanic. Safe repairs run only when self-healing is explicitly
 * enabled (or `allowRepairs` is set by a human-run command) and the emergency
 * stop is not engaged.
 */
export function runMechanic(report: HealthReport, options: MechanicOptions): MechanicOutcome {
  const now = options.now ?? new Date();
  const enabled =
    options.config.security?.selfHealingEnabled === true || options.allowRepairs === true;
  const emergencyStop =
    report.emergencyStop ||
    isEmergencyStopEngaged(options.automatonDir) ||
    isEmergencyStopEngagedInDb(options.db);

  const outcome: MechanicOutcome = {
    enabled,
    emergencyStop,
    actions: [],
    pendingApproval: [],
  };

  if (emergencyStop) {
    outcome.skippedReason = "emergency stop engaged";
    return outcome;
  }
  if (!enabled) {
    outcome.skippedReason = "self-healing is disabled (security.selfHealingEnabled=false)";
    return outcome;
  }

  const runRepair = (
    repairId: string,
    checkId: string,
    apply: () => number,
  ): void => {
    const classification = classifyRepair(repairId);
    if (classification.classification !== "automatic") {
      outcome.pendingApproval.push({ repairId, reason: classification.reason });
      return;
    }
    if (options.confirm && !options.confirm(repairId)) {
      outcome.actions.push({
        repairId,
        checkId,
        status: "skipped",
        detail: "declined by confirmation hook",
      });
      return;
    }
    try {
      const changes = apply();
      outcome.actions.push({
        repairId,
        checkId,
        status: "applied",
        detail: `${changes} row(s) changed`,
        changes,
      });
      tryAppendSecurityEvent(
        options.db,
        {
          severity: "LOW",
          category: "maintenance",
          eventType: "maintenance.repair",
          actor: "mechanic",
          details: { repairId, checkId, changes },
        },
        now,
      );
    } catch (error) {
      outcome.actions.push({
        repairId,
        checkId,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      tryAppendSecurityEvent(
        options.db,
        {
          severity: "MEDIUM",
          category: "maintenance",
          eventType: "maintenance.repair_failed",
          actor: "mechanic",
          details: { repairId, checkId },
        },
        now,
      );
    }
  };

  // A blocked check means the source was absent, so there is nothing to repair — acting on it
  // would be guessing. requires_operator means a human must decide; the mechanic only records it.
  const schedulerStatus = statusFor("scheduler_leases", report);
  if (schedulerStatus === "warn" || schedulerStatus === "fail") {
    runRepair("prune_expired_leases", "scheduler_leases", () =>
      clearExpiredLeases(options.db),
    );
  } else if (schedulerStatus === "blocked") {
    outcome.actions.push({
      repairId: "prune_expired_leases",
      checkId: "scheduler_leases",
      status: "skipped",
      detail: "not assessed: the guardian reported scheduler_leases as blocked",
    });
  }

  const treasuryStatus = statusFor("treasury_reservations", report);
  if (treasuryStatus === "warn" || treasuryStatus === "fail") {
    outcome.pendingApproval.push({
      repairId: "release_stale_treasury_reservations",
      reason: "financial state changes require human approval",
    });
  }

  const auditStatus = statusFor("audit_chain", report);
  if (auditStatus === "requires_operator" || auditStatus === "fail") {
    outcome.pendingApproval.push({
      repairId: "investigate_audit_tamper",
      reason: "audit chain failure must be investigated by a human",
    });
  } else if (auditStatus === "blocked") {
    // Routine maintenance writes a seal, and a seal needs a chain to anchor to. With the
    // audit table absent there is nothing to anchor and nothing to prune for.
    outcome.actions.push({
      repairId: "rotate_audit_seal",
      checkId: "audit_chain",
      status: "skipped",
      detail: "not assessed: the guardian reported audit_chain as blocked",
    });
  } else {
    // Routine, low-risk maintenance regardless of degraded state.
    runRepair("prune_dedup_keys", "runtime_hygiene", () => pruneExpiredDedupKeys(options.db));
    const seal = tryAppendSecuritySeal(options.db, {
      reason: "scheduled health checkpoint",
      actor: "mechanic",
      now,
    });
    if (seal) {
      outcome.seal = { sequence: seal.sequence, headHash: seal.headHash };
    }
  }

  return outcome;
}
