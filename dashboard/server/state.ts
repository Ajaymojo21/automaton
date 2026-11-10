import { auditLogState } from "./audit.js";
import {
  activationView,
  backupsView,
  dbInventory,
  declaredVsDefault,
  diskSpace,
  emergencyStopView,
  heartbeatView,
  healthView,
  logsView,
  osSample,
  providersView,
  readConfig,
  reportsView,
  walletView,
  type DbInventory,
  type FileMeta,
  type OsSample,
} from "./sources.js";
import { lastHomeGuard } from "./home.js";
import type { HomeGuardResult } from "../../src/runtime/home-guard.js";
import { probeProcesses, type ProcessProbe } from "./processes.js";
import { RELEVANT_TABLES, agentState, kvEntries, rowCount, turnCount, type Query } from "./queries.js";
import { STATE_DIR } from "./paths.js";
import type { AutomatonConfig } from "../../src/types.js";
import type { HealthReport } from "../../src/reliability/health-guardian.js";

export interface TableObservation {
  table: string;
  area: string;
  present: boolean;
  rows: number | null;
  error: string | null;
}

export interface Snapshot {
  observedAt: string;
  stateDir: string;
  home: HomeGuardResult | null;
  config: { config: AutomatonConfig | null; raw: Record<string, unknown> | null; meta: FileMeta };
  providers: ReturnType<typeof providersView>;
  securityOrigin: Array<{ key: string; declared: boolean; effective: unknown; source: string }>;
  activation: Record<string, unknown>;
  emergency: ReturnType<typeof emergencyStopView>;
  wallet: Record<string, unknown>;
  heartbeat: ReturnType<typeof heartbeatView>;
  health: { report: HealthReport | null; error: string | null };
  db: DbInventory;
  tables: TableObservation[];
  kv: Query<Array<{ key: string; value: string }>>;
  agentStateObs: Query<{ present: boolean; raw: string | null }>;
  turns: Query<number | null>;
  logs: ReturnType<typeof logsView>;
  backups: ReturnType<typeof backupsView>;
  reports: Record<string, FileMeta>;
  os: OsSample;
  disk: { totalBytes: number; freeBytes: number } | null;
  processes: ProcessProbe;
  auditLog: { dir: string; writable: boolean; files: number };
  dashboardPid: number;
}

function observeTables(): TableObservation[] {
  return RELEVANT_TABLES.map(({ table, area }) => {
    const count = rowCount(table);
    if (count.ok) return { table, area, present: true, rows: count.value, error: null };
    return {
      table,
      area,
      present: !count.absent,
      rows: null,
      error: count.error,
    };
  });
}

/** One read per request. Every panel renders from this object, so no two areas can show
 *  contradictory values for the same source. */
export async function buildSnapshot(): Promise<Snapshot> {
  const config = readConfig();
  const os = await osSample();
  return {
    observedAt: new Date().toISOString(),
    stateDir: STATE_DIR,
    home: lastHomeGuard(),
    config,
    providers: providersView(),
    securityOrigin: declaredVsDefault(config.raw, config.config),
    activation: activationView(config.config),
    emergency: emergencyStopView(),
    wallet: walletView(config.config),
    heartbeat: heartbeatView(),
    health: healthView(),
    db: dbInventory(),
    tables: observeTables(),
    kv: kvEntries(),
    agentStateObs: agentState(),
    turns: turnCount(),
    logs: logsView(),
    backups: backupsView(),
    reports: reportsView(),
    os,
    disk: diskSpace(STATE_DIR),
    processes: probeProcesses(),
    auditLog: auditLogState(),
    dashboardPid: process.pid,
  };
}

export function tableFor(snapshot: Snapshot, table: string): TableObservation | undefined {
  return snapshot.tables.find((entry) => entry.table === table);
}

/** EMPTY only when the table exists and counted zero; NOT VERIFIED when it is absent. */
export function countCell(snapshot: Snapshot, table: string): { verdict: "VERIFIED" | "EMPTY" | "NOT VERIFIED"; rows: number | null; note: string } {
  const found = tableFor(snapshot, table);
  if (!found || found.rows === null) {
    return { verdict: "NOT VERIFIED", rows: null, note: found?.error ?? `"${table}" was not queried` };
  }
  return {
    verdict: found.rows === 0 ? "EMPTY" : "VERIFIED",
    rows: found.rows,
    note: found.rows === 0 ? `table "${table}" exists and contains 0 rows` : `table "${table}" has ${found.rows} row(s)`,
  };
}
