# Phase 21 — B-7 Database Table Inventory

## 1. Summary

| Category | Count |
|---|---|
| Total tables (incl. sqlite_sequence) | 38 |
| Application tables | 37 |
| Populated | 1 (`schema_version`, 10 rows) |
| Empty | 36 |

## 2. Table inventory

| Table | Rows | Purpose | Expected before activation? | Classification |
|---|---|---|---|---|
| schema_version | 10 | Migration tracking | Yes (V2–V11) | POPULATED |
| identity | 0 | Key-value identity store | No (populated on activation) | EXPECTED EMPTY |
| turns | 0 | Agent reasoning turns | No (activation) | EXPECTED EMPTY |
| tool_calls | 0 | Tool call results | No (activation) | EXPECTED EMPTY |
| heartbeat_entries | 0 | Heartbeat config | No (sync on activation) | EXPECTED EMPTY |
| transactions | 0 | Financial transaction log | No (financial activity) | EXPECTED EMPTY |
| installed_tools | 0 | MCP servers/tools | No (installation) | EXPECTED EMPTY |
| children | 0 | Child agents | No (replication disabled) | EXPECTED EMPTY |
| child_lifecycle_events | 0 | Child lifecycle | No (replication) | EXPECTED EMPTY |
| goals | 0 | Agent goals | No (activation) | EXPECTED EMPTY |
| task_graph | 0 | Task orchestration | No (activation) | EXPECTED EMPTY |
| event_stream | 0 | Event log | No (activation) | EXPECTED EMPTY |
| inbox_messages | 0 | Message inbox | No (activation) | EXPECTED EMPTY |
| spend_tracking | 0 | Spend records | No (financial activity) | EXPECTED EMPTY |
| onchain_transactions | 0 | On-chain tx log | No (financial activity) | EXPECTED EMPTY |
| inference_costs | 0 | AI cost tracking | No (inference activity) | EXPECTED EMPTY |
| model_registry | 0 | Model metadata | No (inference activity) | EXPECTED EMPTY |
| heartbeat_schedule | 0 | Heartbeat schedule | No (sync on activation) | EXPECTED EMPTY |
| heartbeat_history | 0 | Heartbeat history | No (activation) | EXPECTED EMPTY |
| wake_events | 0 | Wake requests | No (activation) | EXPECTED EMPTY |
| heartbeat_dedup | 0 | Dedup keys | No (activation) | EXPECTED EMPTY |
| kv | 0 | Key-value store | No (activation) | EXPECTED EMPTY |
| working_memory | 0 | Working memory | No (activation) | EXPECTED EMPTY |
| episodic_memory | 0 | Episodic memory | No (activation) | EXPECTED EMPTY |
| semantic_memory | 0 | Semantic memory | No (activation) | EXPECTED EMPTY |
| procedural_memory | 0 | Procedural memory | No (activation) | EXPECTED EMPTY |
| knowledge_store | 0 | Knowledge base | No (activation) | EXPECTED EMPTY |
| session_summaries | 0 | Session summaries | No (activation) | EXPECTED EMPTY |
| relationship_memory | 0 | Relationship memory | No (activation) | EXPECTED EMPTY |
| reputation | 0 | Reputation scores | No (activation) | EXPECTED EMPTY |
| soul_history | 0 | Soul versions | No (activation) | EXPECTED EMPTY |
| skills | 0 | Installed skills | No (skill installation) | EXPECTED EMPTY |
| modifications | 0 | Self-modifications | No (self-mod disabled) | EXPECTED EMPTY |
| policy_decisions | 0 | Policy decisions | No (activation) | EXPECTED EMPTY |
| registry | 0 | Agent registry | No (registration) | EXPECTED EMPTY |
| metric_snapshots | 0 | Metrics | No (monitoring) | EXPECTED EMPTY |
| discovered_agents_cache | 0 | Agent discovery | No (activation) | EXPECTED EMPTY |
| treasury_authorizations | N/A (V12) | Treasury auth log | No (V12 migration) | NOT YET CREATED |
| security_events | N/A (V12) | Audit chain | No (V12 migration) | NOT YET CREATED |
| security_incidents | N/A (V13) | Incident tracking | No (V13 migration) | NOT YET CREATED |
| security_seals | N/A (V13) | Hash seals | No (V13 migration) | NOT YET CREATED |

## 3. Classification

All empty tables are **EXPECTED EMPTY** — they are activation-dependent, financial, or runtime-state
tables that are only populated after authorized activation. No unexpected empty tables found.

## 4. Acceptance

**B-7 classified: EXPECTED EMPTY.** No fake production data created. Table inventory documented.
4 tables (V12/V13) do not exist yet (migration not applied).
