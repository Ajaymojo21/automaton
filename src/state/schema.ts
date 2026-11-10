/**
 * Automaton SQLite Schema
 *
 * All tables for the automaton's persistent state.
 * The database IS the automaton's memory.
 */

export const SCHEMA_VERSION = 14;

export const CREATE_TABLES = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Core identity key-value store
  CREATE TABLE IF NOT EXISTS identity (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Agent reasoning turns (the thinking/action log)
  -- Application-level validation: state must be a valid AgentState ('setup','waking','running','sleeping','low_compute','critical','dead')
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    state TEXT NOT NULL,
    input TEXT,
    input_source TEXT,
    thinking TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    token_usage TEXT NOT NULL DEFAULT '{}',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tool call results (denormalized for fast lookup)
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES turns(id),
    name TEXT NOT NULL,
    arguments TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat configuration entries
  -- Application-level validation: enabled must be 0 or 1 (boolean integer)
  CREATE TABLE IF NOT EXISTS heartbeat_entries (
    name TEXT PRIMARY KEY,
    schedule TEXT NOT NULL,
    task TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    params TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Financial transaction log
  -- Application-level validation: type must be one of 'transfer_out','transfer_in','credit_purchase','topup','x402_payment','inference'
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount_cents INTEGER,
    balance_after_cents INTEGER,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed tools and MCP servers
  CREATE TABLE IF NOT EXISTS installed_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  );

  -- Self-modification audit log (append-only)
  CREATE TABLE IF NOT EXISTS modifications (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    diff TEXT,
    reversible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- General key-value store for arbitrary state
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed skills
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Spawned child automatons
  -- Application-level validation: status must be one of 'spawning','running','sleeping','dead','unknown'
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  -- ERC-8004 registration state
  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Reputation feedback received and given
  -- Application-level validation: score must be 1-5
  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indices for common queries
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_turns_state ON turns(state);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_modifications_type ON modifications(type);
  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);

  -- Inbox messages table
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V3 = `
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V4 = `
  -- Policy decisions table
  CREATE TABLE IF NOT EXISTS policy_decisions (
    id TEXT PRIMARY KEY,
    turn_id TEXT,
    tool_name TEXT NOT NULL,
    tool_args_hash TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','dangerous','forbidden')),
    decision TEXT NOT NULL CHECK(decision IN ('allow','deny','quarantine')),
    rules_evaluated TEXT NOT NULL DEFAULT '[]',
    rules_triggered TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_policy_decisions_turn ON policy_decisions(turn_id);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_tool ON policy_decisions(tool_name);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON policy_decisions(decision);

  -- Spend tracking table
  CREATE TABLE IF NOT EXISTS spend_tracking (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    recipient TEXT,
    domain TEXT,
    category TEXT NOT NULL CHECK(category IN ('transfer','x402','inference','other')),
    window_hour TEXT NOT NULL,
    window_day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(category, window_hour);
  CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(category, window_day);

  -- Heartbeat schedule (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_schedule (
    task_name TEXT PRIMARY KEY,
    cron_expression TEXT NOT NULL,
    interval_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    max_retries INTEGER NOT NULL DEFAULT 1,
    tier_minimum TEXT NOT NULL DEFAULT 'dead'
      CHECK(tier_minimum IN ('dead','critical','low_compute','normal','high')),
    last_run_at TEXT,
    next_run_at TEXT,
    last_result TEXT CHECK(last_result IN ('success','failure','timeout','skipped') OR last_result IS NULL),
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat history (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_history (
    id TEXT PRIMARY KEY,
    task_name TEXT NOT NULL REFERENCES heartbeat_schedule(task_name),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT NOT NULL CHECK(result IN ('success','failure','timeout','skipped')),
    duration_ms INTEGER,
    error TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hb_history_task ON heartbeat_history(task_name, started_at);

  -- Wake events (Phase 1.1)
  CREATE TABLE IF NOT EXISTS wake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wake_unconsumed ON wake_events(created_at) WHERE consumed_at IS NULL;

  -- Heartbeat dedup (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_dedup (
    dedup_key TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_dedup_expires ON heartbeat_dedup(expires_at);

  -- Data migration: heartbeat_entries -> heartbeat_schedule
  INSERT OR IGNORE INTO heartbeat_schedule (task_name, cron_expression, enabled, last_run_at, next_run_at)
  SELECT name, schedule, enabled, last_run, next_run FROM heartbeat_entries;
`;

// Inbox modifications for V4 (ALTER TABLE must be run separately from CREATE TABLE)
export const MIGRATION_V4_ALTER = `
  ALTER TABLE inbox_messages ADD COLUMN to_address TEXT;
`;

export const MIGRATION_V4_ALTER2 = `
  ALTER TABLE inbox_messages ADD COLUMN raw_content TEXT;
`;

// Inbox state machine columns (Phase 1.2)
// Note: SQLite ALTER TABLE ADD COLUMN cannot include CHECK constraints,
// so status validation is enforced at the application level.
export const MIGRATION_V4_ALTER_INBOX_STATUS = `
  ALTER TABLE inbox_messages ADD COLUMN status TEXT DEFAULT 'received';
`;

export const MIGRATION_V4_ALTER_INBOX_RETRY = `
  ALTER TABLE inbox_messages ADD COLUMN retry_count INTEGER DEFAULT 0;
`;

export const MIGRATION_V4_ALTER_INBOX_MAX_RETRIES = `
  ALTER TABLE inbox_messages ADD COLUMN max_retries INTEGER DEFAULT 3;
`;

export const MIGRATION_V2 = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  CREATE TABLE IF NOT EXISTS registry (
    agent_id TEXT PRIMARY KEY,
    agent_uri TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'eip155:8453',
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);
`;

// === Phase 2.1 + 2.2: Soul + Memory Tables ===

export const MIGRATION_V5 = `
  -- === Phase 2.1: Soul System ===

  CREATE TABLE IF NOT EXISTS soul_history (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_source TEXT NOT NULL CHECK(change_source IN ('agent','human','system','genesis','reflection')),
    change_reason TEXT,
    previous_version_id TEXT REFERENCES soul_history(id),
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_soul_version ON soul_history(version);

  -- === Phase 2.2: Memory System ===

  CREATE TABLE IF NOT EXISTS working_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('goal','observation','plan','reflection','task','decision','note','summary')),
    priority REAL NOT NULL DEFAULT 0.5,
    token_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    source_turn TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id, priority);

  CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    outcome TEXT CHECK(outcome IN ('success','failure','partial','neutral') OR outcome IS NULL),
    importance REAL NOT NULL DEFAULT 0.5,
    embedding_key TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    classification TEXT NOT NULL DEFAULT 'maintenance' CHECK(classification IN ('strategic','productive','communication','maintenance','idle','error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(event_type);
  CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
  CREATE INDEX IF NOT EXISTS idx_episodic_classification ON episodic_memory(classification);

  CREATE TABLE IF NOT EXISTS session_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    tools_used TEXT NOT NULL DEFAULT '[]',
    outcomes TEXT NOT NULL DEFAULT '[]',
    turn_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('self','environment','financial','agent','domain','procedural_ref','creator')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    embedding_key TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memory(category);

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    steps TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relationship_memory (
    id TEXT PRIMARY KEY,
    entity_address TEXT NOT NULL UNIQUE,
    entity_name TEXT,
    relationship_type TEXT NOT NULL,
    trust_score REAL NOT NULL DEFAULT 0.5,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_trust ON relationship_memory(trust_score);
`;

// === Phase 2.3: Inference & Model Strategy Tables ===

export const MIGRATION_V6 = `
  -- === Phase 2.3: Inference & Model Strategy ===

  CREATE TABLE IF NOT EXISTS inference_costs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('agent_turn','heartbeat_triage','safety_check','summarization','planning')),
    cache_hit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inf_session ON inference_costs(session_id);
  CREATE INDEX IF NOT EXISTS idx_inf_model ON inference_costs(model);
  CREATE INDEX IF NOT EXISTS idx_inf_created ON inference_costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_inf_task ON inference_costs(task_type);

  CREATE TABLE IF NOT EXISTS model_registry (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tier_minimum TEXT NOT NULL DEFAULT 'normal',
    cost_per_1k_input INTEGER NOT NULL DEFAULT 0,
    cost_per_1k_output INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    context_window INTEGER NOT NULL DEFAULT 128000,
    supports_tools INTEGER NOT NULL DEFAULT 1,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    parameter_style TEXT NOT NULL DEFAULT 'max_tokens' CHECK(parameter_style IN ('max_tokens','max_completion_tokens')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// === Phase 3: Replication + Social ===

export const MIGRATION_V7 = `
  -- === Phase 3.1: Replication Lifecycle ===

  CREATE TABLE IF NOT EXISTS child_lifecycle_events (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL CHECK(to_state IN (
      'requested','sandbox_created','runtime_ready','wallet_verified',
      'funded','starting','healthy','unhealthy','stopped','failed','cleaned_up'
    )),
    reason TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_child_events ON child_lifecycle_events(child_id, created_at);

  -- === Phase 3.2: Social & Registry ===

  CREATE TABLE IF NOT EXISTS discovered_agents_cache (
    agent_address TEXT PRIMARY KEY,
    agent_card TEXT NOT NULL,
    fetched_from TEXT NOT NULL,
    card_hash TEXT NOT NULL,
    valid_until TEXT,
    fetch_count INTEGER NOT NULL DEFAULT 1,
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onchain_transactions (
    id TEXT PRIMARY KEY,
    tx_hash TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    gas_used INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_onchain_status ON onchain_transactions(status);
`;

// === Phase 4.1: Observability ===

export const MIGRATION_V8 = `
  -- === Phase 4.1: Observability ===

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]',
    alerts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_at ON metric_snapshots(snapshot_at);
`;

// === Plan A: Orchestration + Memory ===

export const MIGRATION_V9 = `
  -- Schema version: 9
  -- Tables: goals, task_graph, event_stream

  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,                    -- ULID
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active|completed|failed|paused
    strategy TEXT,
    expected_revenue_cents INTEGER DEFAULT 0,
    actual_revenue_cents INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deadline TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_graph (
    id TEXT PRIMARY KEY,                    -- ULID
    parent_id TEXT,                         -- parent task (decomposition)
    goal_id TEXT NOT NULL REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending|assigned|running|completed|failed|blocked|cancelled
    assigned_to TEXT,                       -- agent wallet address (0x...)
    agent_role TEXT,                        -- predefined role name
    priority INTEGER DEFAULT 50,           -- 0-100
    dependencies TEXT DEFAULT '[]',        -- JSON array of task IDs
    result TEXT,                           -- JSON TaskResult
    estimated_cost_cents INTEGER DEFAULT 0,
    actual_cost_cents INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_task_graph_goal ON task_graph(goal_id);
  CREATE INDEX IF NOT EXISTS idx_task_graph_status ON task_graph(status);
  CREATE INDEX IF NOT EXISTS idx_task_graph_assigned ON task_graph(assigned_to);

  CREATE TABLE IF NOT EXISTS event_stream (
    id TEXT PRIMARY KEY,                    -- ULID
    type TEXT NOT NULL,                     -- EventType enum
    agent_address TEXT NOT NULL,
    goal_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    compacted_to TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_agent ON event_stream(agent_address, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_goal ON event_stream(goal_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON event_stream(type, created_at);
`;

// Role column for children table (must be separate statement for SQLite ALTER)
export const MIGRATION_V9_ALTER_CHILDREN_ROLE = `
  ALTER TABLE children ADD COLUMN role TEXT DEFAULT 'generalist';
`;

// === Solana Integration: Chain Type Column ===

export const MIGRATION_V11 = `
  -- Schema version: 11
  -- Add chain_type column to children table for multi-chain support
  ALTER TABLE children ADD COLUMN chain_type TEXT DEFAULT 'evm';
`;

export const MIGRATION_V10 = `
  -- Schema version: 10
  -- Tables: knowledge_store

  CREATE TABLE IF NOT EXISTS knowledge_store (
    id TEXT PRIMARY KEY,                    -- ULID
    category TEXT NOT NULL,                 -- market|technical|social|financial|operational
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,                   -- agent address that contributed
    confidence REAL DEFAULT 1.0,
    last_verified TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_store(category);
  CREATE INDEX IF NOT EXISTS idx_knowledge_key ON knowledge_store(key);
`;

// === Phase 15: Centralized Treasury + Tamper-Evident Audit ===
//
// treasury_authorizations is the single record of every financial decision.
// Reserved rows count toward every budget until they are committed or released,
// so an in-flight transfer cannot be double-spent by a concurrent call.
export const MIGRATION_V12 = `
  -- Schema version: 12
  -- Tables: treasury_authorizations, security_events

  CREATE TABLE IF NOT EXISTS treasury_authorizations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    tool_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    requested_amount_cents INTEGER NOT NULL,
    recipient TEXT,
    domain TEXT,
    child_id TEXT,
    actor TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
    status TEXT NOT NULL CHECK(status IN ('reserved','committed','released','denied')),
    reason_code TEXT,
    reason_message TEXT,
    balance_cents INTEGER,
    created_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    committed_ms INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_treasury_created ON treasury_authorizations(created_ms);
  CREATE INDEX IF NOT EXISTS idx_treasury_status ON treasury_authorizations(operation, status);
  CREATE INDEX IF NOT EXISTS idx_treasury_child ON treasury_authorizations(child_id, status);
  CREATE INDEX IF NOT EXISTS idx_treasury_decision ON treasury_authorizations(decision, status);

  CREATE TRIGGER IF NOT EXISTS treasury_authorizations_no_delete
    BEFORE DELETE ON treasury_authorizations
    BEGIN
      SELECT RAISE(ABORT, 'treasury_authorizations is append-only');
    END;

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, timestamp);
  CREATE INDEX IF NOT EXISTS idx_security_events_category ON security_events(category, timestamp);

  CREATE TRIGGER IF NOT EXISTS security_events_no_update
    BEFORE UPDATE ON security_events
    BEGIN
      SELECT RAISE(ABORT, 'security_events is append-only');
    END;

  CREATE TRIGGER IF NOT EXISTS security_events_no_delete
    BEFORE DELETE ON security_events
    BEGIN
      SELECT RAISE(ABORT, 'security_events is append-only');
    END;
`;

export const MIGRATION_V13 = `
  -- Schema version: 13
  -- Tables: security_incidents, security_seals

  CREATE TABLE IF NOT EXISTS security_incidents (
    id TEXT PRIMARY KEY,
    created_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
    category TEXT NOT NULL,
    incident_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_sequence INTEGER,
    status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
    acknowledged_by TEXT,
    acknowledged_ms INTEGER,
    resolved_by TEXT,
    resolved_ms INTEGER,
    resolution TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_incidents_status ON security_incidents(status, severity, created_ms);
  CREATE INDEX IF NOT EXISTS idx_incidents_type ON security_incidents(incident_type, created_ms);
  CREATE INDEX IF NOT EXISTS idx_incidents_created ON security_incidents(created_ms);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_dedupe
    ON security_incidents(incident_type, source_sequence)
    WHERE source_sequence IS NOT NULL;

  CREATE TRIGGER IF NOT EXISTS security_incidents_no_delete
    BEFORE DELETE ON security_incidents
    BEGIN
      SELECT RAISE(ABORT, 'security_incidents is append-only (resolve, do not delete)');
    END;

  CREATE TABLE IF NOT EXISTS security_seals (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL UNIQUE,
    head_hash TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    actor TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_seals_sequence ON security_seals(sequence);

  CREATE TRIGGER IF NOT EXISTS security_seals_no_update
    BEFORE UPDATE ON security_seals
    BEGIN
      SELECT RAISE(ABORT, 'security_seals is append-only');
    END;

  CREATE TRIGGER IF NOT EXISTS security_seals_no_delete
    BEFORE DELETE ON security_seals
    BEGIN
      SELECT RAISE(ABORT, 'security_seals is append-only');
    END;
`;

// === Phase 23: Durable repair-approval governance (B-2 / B-8) ===
//
// The approval lifecycle lived in a Map, so every restart erased the record of who approved
// what. `repair_approvals` is the durable current state; `repair_approval_events` is the
// append-only, hash-chained history (same construction as security_events). Approval never
// executes a repair: the terminal state of an approval decision is `ready_for_execution`.
export const MIGRATION_V14 = `
  -- Schema version: 14
  -- Tables: repair_approvals, repair_approval_events

  CREATE TABLE IF NOT EXISTS repair_approvals (
    id TEXT PRIMARY KEY,
    finding_id TEXT NOT NULL,
    component TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    proposed_action TEXT NOT NULL,
    expected_benefit TEXT NOT NULL,
    potential_side_effects TEXT NOT NULL,
    risk_classification TEXT NOT NULL CHECK(risk_classification IN ('low','medium','high','critical')),
    required_permissions TEXT NOT NULL DEFAULT '[]',
    expected_downtime INTEGER NOT NULL DEFAULT 0,
    rollback_possible INTEGER NOT NULL DEFAULT 0,
    created_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('detected','diagnosis','repair_proposed','awaiting_approval','approved','rejected','expired','ready_for_execution','verification','completed','failed')),
    approval_identity TEXT,
    decision_ms INTEGER,
    decision_reason TEXT,
    audit_reference TEXT,
    action_hash TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    decision_key TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_repair_approvals_status
    ON repair_approvals(status, created_ms);
  CREATE INDEX IF NOT EXISTS idx_repair_approvals_finding
    ON repair_approvals(finding_id, action_hash);

  -- Duplicate prevention: one live approval request per finding+action.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_approvals_live
    ON repair_approvals(finding_id, action_hash)
    WHERE status IN ('awaiting_approval','ready_for_execution');

  -- Replay protection: a decision key can settle exactly one proposal.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_approvals_decision_key
    ON repair_approvals(decision_key)
    WHERE decision_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS repair_approval_events (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    at_ms INTEGER NOT NULL,
    at_iso TEXT NOT NULL,
    event TEXT NOT NULL,
    actor TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    UNIQUE(proposal_id, sequence)
  );

  CREATE INDEX IF NOT EXISTS idx_repair_approval_events_proposal
    ON repair_approval_events(proposal_id, sequence);

  CREATE TRIGGER IF NOT EXISTS repair_approval_events_no_update
    BEFORE UPDATE ON repair_approval_events
    BEGIN
      SELECT RAISE(ABORT, 'repair_approval_events is append-only');
    END;

  CREATE TRIGGER IF NOT EXISTS repair_approval_events_no_delete
    BEFORE DELETE ON repair_approval_events
    BEGIN
      SELECT RAISE(ABORT, 'repair_approval_events is append-only');
    END;
`;

/**
 * The objects a block of DDL is meant to create.
 *
 * Derived from the SQL itself rather than hand-maintained, so the manifest cannot
 * drift away from the migration it describes. The runner verifies these names
 * before it records a version, which is what stops a `schema_version` row from
 * claiming a schema that was never built (F-18-02).
 */
export interface DeclaredObjects {
  tables: string[];
  indexes: string[];
  triggers: string[];
  columns: { table: string; column: string }[];
}

export function declaredObjects(sql: string): DeclaredObjects {
  const code = sql.replace(/--[^\n]*/g, "");
  const names = (pattern: RegExp): string[] =>
    [...code.matchAll(pattern)].map((match) => match[1]);
  const columns = [
    ...code.matchAll(/ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/gi),
  ].map((match) => ({ table: match[1], column: match[2] }));

  return {
    tables: names(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi),
    indexes: names(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi),
    triggers: names(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi),
    columns,
  };
}
