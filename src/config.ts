/**
 * Automaton Configuration
 *
 * Loads and saves the automaton's configuration from ~/.automaton/automaton.json
 */

import fs from "fs";
import path from "path";
import type { AutomatonConfig, TreasuryPolicy, ModelStrategyConfig, SoulConfig, SecurityConfig, ToolCapability } from "./types.js";
import {
  DEFAULT_CONFIG,
  DEFAULT_TREASURY_POLICY,
  LOCKDOWN_TREASURY_POLICY,
  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_SOUL_CONFIG,
  DEFAULT_SECURITY_CONFIG,
} from "./types.js";
import { getAutomatonDir } from "./identity/wallet.js";
import { joinTilde } from "./runtime/home-guard.js";
import { loadApiKeyFromConfig } from "./identity/provision.js";
import { createLogger } from "./observability/logger.js";
import type { ChainType } from "./identity/chain.js";

const logger = createLogger("config");
const CONFIG_FILENAME = "automaton.json";

export function getConfigPath(): string {
  return path.join(getAutomatonDir(), CONFIG_FILENAME);
}

/**
 * Load the automaton config from disk.
 * Merges with defaults for any missing fields.
 */
export function loadConfig(): AutomatonConfig | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const apiKey = raw.conwayApiKey || loadApiKeyFromConfig();

    // Normalize security first so the treasury base reflects the lockdown posture:
    // under lockdown every monetary limit is zero, and a missing/malformed value
    // can never inherit a permissive default (F-1 remediation).
    const security = normalizeSecurityConfig(raw.security);

    // Deep-merge treasury policy. Under lockdown the base is the all-zero lockdown
    // policy, so missing keys (including the Phase 15 monthly/agent/child budgets)
    // cannot silently inherit non-zero defaults.
    const treasuryBase = security.lockdown ? LOCKDOWN_TREASURY_POLICY : DEFAULT_TREASURY_POLICY;
    const treasuryPolicy: TreasuryPolicy = {
      ...treasuryBase,
      ...(raw.treasuryPolicy ?? {}),
    };

    // Validate every numeric treasury value fail-closed: non-number, non-finite,
    // negative, non-integer or overflow values reset to the (lockdown-aware) base,
    // never to a permissive default.
    for (const [key, value] of Object.entries(treasuryPolicy)) {
      if (key === "x402AllowedDomains") continue; // array, not number
      const baseValue = (treasuryBase as any)[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > Number.MAX_SAFE_INTEGER
      ) {
        logger.warn(`Invalid treasury value for ${key}: ${String(value)}, using base value`);
        (treasuryPolicy as any)[key] = baseValue;
      }
    }

    // Deep-merge model strategy config with defaults
    const modelStrategy: ModelStrategyConfig = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      ...(raw.modelStrategy ?? {}),
    };

    // Deep-merge soul config with defaults
    const soulConfig: SoulConfig = {
      ...DEFAULT_SOUL_CONFIG,
      ...(raw.soulConfig ?? {}),
    };

    // Security was already normalized above (treasury base depends on it).
    // (No duplicate assignment.)

    return {
      ...DEFAULT_CONFIG,
      ...raw,
      sandboxId:
        typeof raw.sandboxId === "string"
          ? raw.sandboxId.trim()
          : DEFAULT_CONFIG.sandboxId,
      conwayApiKey: apiKey,
      treasuryPolicy,
      modelStrategy,
      soulConfig,
      security,
      chainType: raw.chainType || "evm",
    } as AutomatonConfig;
  } catch {
    return null;
  }
}

const VALID_CAPABILITIES: ToolCapability[] = [
  "read_only",
  "filesystem_read",
  "filesystem_write",
  "shell_execution",
  "network_access",
  "external_api",
  "financial",
  "wallet_signing",
  "agent_spawning",
  "publishing",
  "administrative",
];

function positiveIntegerOr(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Normalize a persisted security block. Missing or invalid values fall back
 * to the locked-down defaults, never to permissive ones.
 */
export function normalizeSecurityConfig(raw: unknown): SecurityConfig {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowedTools = Array.isArray(input.allowedTools)
    ? input.allowedTools.filter((t): t is string => typeof t === "string")
    : DEFAULT_SECURITY_CONFIG.allowedTools;
  const allowedCapabilities = Array.isArray(input.allowedCapabilities)
    ? input.allowedCapabilities.filter((c): c is ToolCapability =>
        typeof c === "string" && (VALID_CAPABILITIES as string[]).includes(c),
      )
    : (DEFAULT_SECURITY_CONFIG.allowedCapabilities ?? []);
  const revokedTools = Array.isArray(input.revokedTools)
    ? input.revokedTools.filter((t): t is string => typeof t === "string")
    : (DEFAULT_SECURITY_CONFIG.revokedTools ?? []);

  return {
    lockdown: input.lockdown === true ? true : DEFAULT_SECURITY_CONFIG.lockdown,
    activationApproved:
      input.activationApproved === true ? true : DEFAULT_SECURITY_CONFIG.activationApproved,
    allowedTools,
    allowFinancialTools:
      input.allowFinancialTools === true ? true : DEFAULT_SECURITY_CONFIG.allowFinancialTools,
    allowHostShell:
      input.allowHostShell === true ? true : DEFAULT_SECURITY_CONFIG.allowHostShell,
    allowSelfModification:
      input.allowSelfModification === true
        ? true
        : DEFAULT_SECURITY_CONFIG.allowSelfModification,
    allowReplication:
      input.allowReplication === true ? true : DEFAULT_SECURITY_CONFIG.allowReplication,
    allowExternalExposure:
      input.allowExternalExposure === true
        ? true
        : DEFAULT_SECURITY_CONFIG.allowExternalExposure,
    allowedCapabilities,
    revokedTools,
    maxToolDurationMs: positiveIntegerOr(
      input.maxToolDurationMs,
      DEFAULT_SECURITY_CONFIG.maxToolDurationMs ?? 60000,
    ),
    maxToolOutputBytes: positiveIntegerOr(
      input.maxToolOutputBytes,
      DEFAULT_SECURITY_CONFIG.maxToolOutputBytes ?? 65536,
    ),
    // Sandbox checks cannot be disabled from config; a tampered or malformed
    // value must not widen the agent's reach.
    sandboxEnabled: true,
    sandboxRoot:
      typeof input.sandboxRoot === "string" && input.sandboxRoot.length > 0
        ? input.sandboxRoot
        : DEFAULT_SECURITY_CONFIG.sandboxRoot,
    // Opt-in only: a malformed value must never enable autonomous repair.
    selfHealingEnabled:
      input.selfHealingEnabled === true
        ? true
        : DEFAULT_SECURITY_CONFIG.selfHealingEnabled,
  };
}

/**
 * Save the automaton config to disk.
 * Includes treasuryPolicy in the persisted config.
 */
export function saveConfig(config: AutomatonConfig): void {
  const dir = getAutomatonDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const configPath = getConfigPath();
  const toSave = {
    ...config,
    treasuryPolicy: config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    modelStrategy: config.modelStrategy ?? DEFAULT_MODEL_STRATEGY_CONFIG,
    soulConfig: config.soulConfig ?? DEFAULT_SOUL_CONFIG,
    security: config.security ?? DEFAULT_SECURITY_CONFIG,
  };
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
  });
}

/**
 * Resolve ~ paths to absolute paths.
 *
 * `~` means `process.env.HOME` — which is what the .bat wrappers set — and nothing else.
 * The previous `HOME || "/root"` fallback silently relocated the whole state tree to
 * `C:\root\.automaton` when a caller forgot to set HOME, so it is now a hard stop.
 */
export function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return joinTilde(p);
  }
  return p;
}

/**
 * Create a fresh config from setup wizard inputs.
 */
export function createConfig(params: {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  registeredWithConway: boolean;
  sandboxId: string;
  walletAddress: string;
  apiKey: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  parentAddress?: string;
  treasuryPolicy?: TreasuryPolicy;
  chainType?: ChainType;
}): AutomatonConfig {
  const normalizedSandboxId = (params.sandboxId || "").trim();
  return {
    name: params.name,
    genesisPrompt: params.genesisPrompt,
    creatorMessage: params.creatorMessage,
    creatorAddress: params.creatorAddress,
    registeredWithConway: params.registeredWithConway,
    sandboxId: normalizedSandboxId,
    conwayApiUrl:
      DEFAULT_CONFIG.conwayApiUrl || "https://api.conway.tech",
    conwayApiKey: params.apiKey,
    openaiApiKey: params.openaiApiKey,
    anthropicApiKey: params.anthropicApiKey,
    ollamaBaseUrl: params.ollamaBaseUrl,
    inferenceModel: DEFAULT_CONFIG.inferenceModel || "gpt-5.2",
    maxTokensPerTurn: DEFAULT_CONFIG.maxTokensPerTurn || 4096,
    heartbeatConfigPath:
      DEFAULT_CONFIG.heartbeatConfigPath || "~/.automaton/heartbeat.yml",
    dbPath: DEFAULT_CONFIG.dbPath || "~/.automaton/state.db",
    logLevel: (DEFAULT_CONFIG.logLevel as AutomatonConfig["logLevel"]) || "info",
    walletAddress: params.walletAddress,
    version: DEFAULT_CONFIG.version || "0.2.1",
    skillsDir: DEFAULT_CONFIG.skillsDir || "~/.automaton/skills",
    maxChildren: DEFAULT_CONFIG.maxChildren || 3,
    parentAddress: params.parentAddress,
    treasuryPolicy: params.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    security: DEFAULT_SECURITY_CONFIG,
    chainType: params.chainType || "evm",
  };
}
