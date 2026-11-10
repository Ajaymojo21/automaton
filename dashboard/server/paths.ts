import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DASHBOARD_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(here, "..", "..");

export const CANONICAL_HOME = path.join(REPO_ROOT, "runtime", "home");
export const STATE_DIR = path.join(CANONICAL_HOME, ".automaton");
export const DB_PATH = path.join(STATE_DIR, "state.db");
export const CONFIG_PATH = path.join(STATE_DIR, "automaton.json");
export const HEARTBEAT_PATH = path.join(STATE_DIR, "heartbeat.yml");
export const WALLET_PATH = path.join(STATE_DIR, "wallet.json");
export const PROVIDERS_PATH = path.join(STATE_DIR, "inference-providers.json");
export const EMERGENCY_STOP_PATH = path.join(STATE_DIR, "EMERGENCY_STOP");
/** Dedicated approval store (schema V14). Deliberately NOT state.db: the dashboard never
 *  writes the agent's database, and never triggers a state.db migration. */
export const REPAIR_APPROVALS_DB_PATH = path.join(STATE_DIR, "repair-approvals.db");

export const PROJECT_DIR = path.join(REPO_ROOT);
export const PROJECT_LOGS_DIR = path.join(REPO_ROOT, "logs");
export const PROJECT_BACKUPS_DIR = path.join(REPO_ROOT, "backups");
export const PROJECT_REPORTS_DIR = path.join(REPO_ROOT, "reports");
export const PROJECT_SOUL_PATH = path.join(REPO_ROOT, "SOUL.md");

export const SPA_DIST_DIR = path.join(DASHBOARD_ROOT, "dist");
export const TOKEN_PATH = path.join(DASHBOARD_ROOT, "state", "dashboard.token");
export const DASHBOARD_LOGS_DIR = path.join(DASHBOARD_ROOT, "logs");

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.CONWAY_DASHBOARD_PORT ?? 8787);
export const ORIGIN = `http://${HOST}:${PORT}`;

/** Port 3001 belongs to another project (FreeLLMAPI backend) and is never used. */
export const FORBIDDEN_PORTS = new Set([3001]);
