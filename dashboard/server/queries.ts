import { getDb, tableNames, countRows, type Db } from "./db.js";
import { assertHome } from "./home.js";

export type Query<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; absent: boolean };

function withDb<T>(table: string | null, read: (db: Db, has: Set<string>) => T): Query<T> {
  assertHome();
  const result = getDb();
  if (!result.ok) return { ok: false, error: result.error, absent: false };
  try {
    const has = tableNames(result.handle.db);
    if (table && !has.has(table)) {
      return { ok: false, error: `table "${table}" absent`, absent: true };
    }
    return { ok: true, value: read(result.handle.db, has) };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause), absent: false };
  }
}

export function rows<T>(sql: string, table: string | null = null): Query<T[]> {
  // `sql` is always a literal from this file. There is no parameter path for a caller,
  // and there will not be one: the HTTP layer never reaches this module with a string.
  return withDb(table, (db) => db.prepare(sql).all() as T[]);
}

export function row<T>(sql: string, table: string | null = null): Query<T | null> {
  return withDb(table, (db) => (db.prepare(sql).get() as T | undefined) ?? null);
}

export function rowCount(table: string): Query<number> {
  return withDb(table, (db) => countRows(db, table));
}

/** `kv` exists and is empty, so the agent's state has never been written. Reading the
 *  table directly (rather than db.getAgentState(), which falls back to a code default)
 *  is what lets the panel say UNKNOWN instead of "setup". */
export function kvEntries(): Query<Array<{ key: string; value: string }>> {
  return rows<{ key: string; value: string }>("SELECT key, value FROM kv ORDER BY key", "kv");
}

export interface AgentStateObservation {
  present: boolean;
  raw: string | null;
}

export function agentState(): Query<AgentStateObservation> {
  return withDb("kv", (db) => {
    const found = db
      .prepare("SELECT value FROM kv WHERE key = 'agent_state'")
      .get() as { value: string } | undefined;
    return { present: Boolean(found), raw: found?.value ?? null };
  });
}

export function turnCount(): Query<number | null> {
  return withDb("kv", (db) => {
    const found = db
      .prepare("SELECT value FROM kv WHERE key = 'turn_count'")
      .get() as { value: string } | undefined;
    return found ? Number(found.value) : null;
  });
}

/** Tables the twelve areas actually read. Every name here was confirmed against the live
 *  V11 database by reports/PHASE_17_TABLE_PROBE.cjs (37 app tables) rather than guessed
 *  from the migration source: `registry` not `agent_registry`, `inbox_messages` not
 *  `inbox`, `transactions` not `wallet_transactions`, and five separate memory tables. */
export const RELEVANT_TABLES: Array<{ table: string; area: PanelArea }> = [
  { table: "kv", area: "agent" },
  { table: "registry", area: "agent" },
  { table: "children", area: "agent" },
  { table: "child_lifecycle_events", area: "agent" },
  { table: "skills", area: "agent" },
  { table: "installed_tools", area: "agent" },
  { table: "tool_calls", area: "agent" },
  { table: "soul_history", area: "agent" },
  { table: "goals", area: "agent" },
  { table: "turns", area: "agent" },
  { table: "task_graph", area: "agent" },
  { table: "wake_events", area: "agent" },
  { table: "inbox_messages", area: "agent" },
  { table: "reputation", area: "agent" },
  { table: "working_memory", area: "agent" },
  { table: "episodic_memory", area: "agent" },
  { table: "semantic_memory", area: "agent" },
  { table: "procedural_memory", area: "agent" },
  { table: "relationship_memory", area: "agent" },
  { table: "session_summaries", area: "agent" },
  { table: "identity", area: "agent" },
  { table: "modifications", area: "agent" },
  { table: "knowledge_store", area: "agent" },
  { table: "discovered_agents_cache", area: "agent" },
  { table: "event_stream", area: "logs" },
  { table: "metric_snapshots", area: "health" },
  { table: "model_registry", area: "models" },
  { table: "inference_costs", area: "models" },
  { table: "transactions", area: "wallet" },
  { table: "onchain_transactions", area: "wallet" },
  { table: "spend_tracking", area: "treasury" },
  { table: "policy_decisions", area: "treasury" },
  { table: "treasury_authorizations", area: "treasury" },
  { table: "security_events", area: "security" },
  { table: "security_incidents", area: "security" },
  { table: "security_seals", area: "security" },
  { table: "heartbeat_entries", area: "self-healing" },
  { table: "heartbeat_schedule", area: "self-healing" },
  { table: "heartbeat_history", area: "self-healing" },
  { table: "heartbeat_dedup", area: "self-healing" },
];

export type PanelArea =
  | "agent"
  | "models"
  | "wallet"
  | "treasury"
  | "security"
  | "health"
  | "logs"
  | "self-healing";
