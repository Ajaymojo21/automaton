import { empty, notVerified, observed, unknown, type Cell } from "../values.js";
import { countCell, type Snapshot } from "../state.js";
import type { Panel } from "./types.js";

export function overviewPanel(s: Snapshot): Panel {
  const schemaMatch =
    s.db.liveVersion !== null && s.db.codeVersion === s.db.liveVersion;
  return {
    id: "overview",
    title: "Overview",
    subtitle: "Whole-system posture from read-only sources",
    sections: [
      {
        title: "Control plane",
        layout: "metrics",
        cells: [
          { label: "Runtime home", cell: guardCell(s) },
          {
            label: "Agent activation",
            cell: s.activation.approved === true
              ? observed(true, "src/security/activation.ts:checkActivation")
              : observed(false, "src/security/activation.ts:checkActivation", String(s.activation.reason ?? "")),
          },
          {
            label: "Emergency stop",
            cell: s.emergency.state.engaged
              ? observed("ENGAGED", "src/security/emergency-stop.ts:readEmergencyStop", `marker ${s.emergency.state.markerPath}`)
              : observed(
                  "NOT ENGAGED",
                  "src/security/emergency-stop.ts:readEmergencyStop",
                  `union scan of ${s.emergency.pathsScanned.length} candidate paths found no marker; audit trail NOT VERIFIED separately`,
                ),
          },
          {
            label: "Wallet",
            cell: s.wallet.exists
              ? observed(String(s.wallet.address ?? "present"), "src/identity/wallet.ts:walletExists")
              : observed("NO WALLET CONFIGURED", "src/identity/wallet.ts:walletExists"),
          },
          {
            label: "Self-healing",
            cell: selfHealingCell(s),
          },
          { label: "Health", cell: healthCell(s) },
        ],
      },
      {
        title: "Data plane",
        layout: "metrics",
        cells: [
          {
            label: "Live database",
            cell: s.db.error
              ? notVerified("dashboard/server/db.ts", `read-only open failed: ${s.db.error}`)
              : observed(s.db.file.path, "dashboard/server/db.ts", `integrity ${s.db.integrity}, journal ${s.db.journalMode}`),
          },
          {
            label: "Schema",
            cell: s.db.liveVersion === null
              ? unknown("sqlite_master", "schema_version table not readable")
              : schemaMatch
                ? observed(`live ${s.db.liveVersion} = code ${s.db.codeVersion}`, "schema_version")
                : observed(
                    `live ${s.db.liveVersion} < code ${s.db.codeVersion}`,
                    "schema_version",
                    "V12/V13 migrations are not applied; their four tables are absent, so those readers are NOT VERIFIED rather than FAIL",
                  ),
          },
          { label: "Agent runtime state", cell: agentStateCell(s) },
          {
            label: "Conway process",
            cell: unknown(
              "tasklist (fixed argv, read-only)",
              `${s.processes.nodePids.length} node.exe process(es) visible; tasklist reports image names only, so none can be identified as the Conway runtime. The dashboard's own memory usage is never substituted.`,
            ),
          },
          {
            label: "Activity logs",
            cell: s.logs.files.length === 0
              ? empty(0, "logs/ directory listing", "NO DATA — the runtime has never been launched from this console")
              : observed(s.logs.files.length, "logs/ directory listing"),
          },
          {
            label: "Config as behaviour",
            cell: notVerified(
              "automaton.json",
              "DECLARED AT REST — nothing here proves a running process read it. The agent is inactive by design.",
            ),
          },
        ],
      },
      {
        title: "Operator posture",
        layout: "notice",
        notice: {
          level: "info",
          text: "Controls disabled: the agent is inactive by design. This console reads; it does not start, fund, migrate, seal, engage or repair.",
        },
      },
    ],
  };
}

export function guardCell(s: Snapshot): Cell {
  if (!s.home) return unknown("dashboard/server/home.ts", "HOME guard has not run yet");
  return s.home.ok
    ? observed(s.home.actual ?? s.home.stateDir ?? "", "assertConwayHome({mode:'runtime'})", `expected ${s.home.expected}`)
    : notVerified("assertConwayHome({mode:'runtime'})", s.home.message);
}

export function agentStateCell(s: Snapshot): Cell {
  if (!s.agentStateObs.ok) {
    return notVerified("kv table", `kv unreadable: ${s.agentStateObs.error}`);
  }
  if (!s.agentStateObs.value || !s.agentStateObs.value.present) {
    return unknown(
      "kv table",
      "UNKNOWN — never started. db.getAgentState() would return the code default 'setup'; that is a default, not an observation, so it is not displayed.",
    );
  }
  return observed(s.agentStateObs.value.raw, "kv['agent_state']");
}

export function selfHealingCell(s: Snapshot): Cell {
  const declared = s.securityOrigin.find((entry) => entry.key === "selfHealingEnabled");
  if (!declared) {
    return observed(false, "loadConfig() merge", "false (code default — the operator never declared it; automaton.json has no security.selfHealingEnabled key)");
  }
  if (!declared.declared) {
    return observed(declared.effective, "loadConfig() merge", `${String(declared.effective)} (code default — not declared in automaton.json)`);
  }
  return observed(declared.effective, "automaton.json security.selfHealingEnabled");
}

export function healthCell(s: Snapshot): Cell {
  if (s.health.error || !s.health.report) {
    return notVerified("src/reliability/health-guardian.ts:runHealthChecks", `health checks could not run: ${s.health.error ?? "no report"}`);
  }
  const report = s.health.report;
  const blocked = report.checks.filter((check) => check.status === "blocked");
  const liveSchema = s.db.liveVersion === null ? "unknown schema" : `schema ${s.db.liveVersion}`;
  if (report.overall === "blocked") {
    return observed(
      `${report.overall} (as reported) — a source was absent, which is not a finding`,
      "runHealthChecks(readonly db, config)",
      `${blocked.map((check) => check.id).join(", ")} had no source in the live database (${liveSchema}). See the Health area for the raw status beside the dashboard reading.`,
    );
  }
  if (report.overall === "requires_operator") {
    return observed(
      report.overall,
      "runHealthChecks(readonly db, config)",
      `the guardian observed drift or tamper a human must correct: ${report.checks
        .filter((check) => check.status === "requires_operator")
        .map((check) => check.id)
        .join(", ")}`,
    );
  }
  return observed(report.overall, "runHealthChecks(readonly db, config)");
}

export function agentPanel(s: Snapshot): Panel {
  const tables = s.tables.filter((t) => t.area === "agent");
  return {
    id: "agent",
    title: "AI Agent",
    subtitle: "Runtime identity, memory and children — all sourced from the live database",
    sections: [
      {
        title: "Runtime state",
        layout: "metrics",
        cells: [
          { label: "Agent state", cell: agentStateCell(s) },
          {
            label: "Turn count",
            cell: s.turns.ok
              ? s.turns.value === null
                ? unknown("kv['turn_count']", "key absent — the agent has never taken a turn")
                : observed(s.turns.value, "kv['turn_count']")
              : notVerified("kv table", s.turns.error),
          },
          { label: "kv keys", cell: s.kv.ok ? empty(s.kv.value.length, "kv table", "0 keys — nothing has ever been written") : notVerified("kv table", s.kv.error) },
          {
            label: "Soul / persona",
            cell: soulCell(s),
          },
        ],
      },
      {
        title: "Persistence",
        layout: "table",
        note: "EMPTY means the table exists and was counted at zero. It is deliberately not the same label as UNKNOWN.",
        table: {
          columns: ["table", "verdict", "rows", "note"],
          rows: tables.map((t) => [
            t.table,
            t.rows === null ? "NOT VERIFIED" : t.rows === 0 ? "EMPTY" : "VERIFIED",
            t.rows ?? "—",
            t.error ?? (t.rows === 0 ? "exists, 0 rows" : `exists, ${t.rows} row(s)`),
          ]),
        },
      },
      {
        title: "Controls",
        layout: "notice",
        notice: {
          level: "warn",
          text: "No agent control is reachable from this area. START would set CONWAY_ACTIVATION=APPROVED and call run(), which spawns a process, executes tools and writes the database. §29 forbids that without approval, so the button does not exist.",
        },
      },
    ],
  };
}

function soulCell(s: Snapshot): Cell {
  const repo = s.reports["SOUL.md (repo root)"];
  const state = s.reports["SOUL.md (state dir)"];
  const history = countCell(s, "soul_history");
  if (!repo.exists && !state.exists && history.rows === 0) {
    return empty(false, "SOUL.md + soul_history", "EMPTY — no SOUL.md at either path and soul_history has 0 rows");
  }
  if (repo.exists) return observed(repo.path, "SOUL.md", `sha256 ${repo.sha256?.slice(0, 12)}…`);
  return unknown("SOUL.md", "not found and soul_history is not empty — reconcile manually");
}

export function modelsPanel(s: Snapshot): Panel {
  const raw = s.config.raw ?? {};
  const declared = (key: string): boolean => typeof raw[key] === "string" && String(raw[key]).length > 0;
  const providerKeys = [
    ["conwayApiKey", "CONWAY_API_KEY"],
    ["openaiApiKey", "OPENAI_API_KEY"],
    ["anthropicApiKey", "ANTHROPIC_API_KEY"],
  ] as const;
  const providerEnvRows = s.providers.rows.map((row) => [
    `provider ${row.id} apiKeyEnvVar`,
    row.apiKeyPresent ? "present" : "not present",
    `inference-providers.json apiKeyEnvVar / env ${row.apiKeyEnvVar ?? "(undeclared)"}`,
  ]);
  const admitted = s.providers.rows.filter((row) => row.validation === "valid");
  const rejected = s.providers.rows.filter((row) => row.validation !== "valid");
  return {
    id: "models",
    title: "AI Models",
    subtitle: "Declared configuration versus observed inference",
    sections: [
      {
        title: "Declaration versus observation",
        layout: "metrics",
        cells: [
          {
            label: "Declared model",
            cell: declared("inferenceModel")
              ? notVerified(
                  "automaton.json inferenceModel",
                  `declared "${String(raw.inferenceModel)}" — declared, never invoked. No inference call has run, so the model actually in use is UNKNOWN.`,
                )
              : unknown("automaton.json", "no inferenceModel declared"),
          },
          { label: "model_registry", cell: countToCell(countCell(s, "model_registry"), "model_registry") },
          { label: "inference_costs", cell: countToCell(countCell(s, "inference_costs"), "inference_costs") },
          {
            label: "Provider latency",
            cell: unknown("no source", "NOT VERIFIED — no inference has run, so there is no latency to report"),
          },
          {
            label: "Token cost today",
            cell: unknown("inference_costs", "NOT VERIFIED — table empty; 0 would be a real number only after a call"),
          },
        ],
      },
      {
        title: "Provider registry (inference-providers.json)",
        layout: "table",
        note: s.providers.parseError
          ? `${s.providers.meta.path} could not be parsed: ${s.providers.parseError}`
          : `${s.providers.meta.path} — sha256 ${s.providers.meta.sha256?.slice(0, 12) ?? "unavailable"}…, ` +
            `${admitted.length} endpoint(s) pass P-6 URL validation, ${rejected.length} rejected. ` +
            "This table is configuration validity only: no connection has been opened and no model has been called.",
        table: {
          columns: ["provider", "validated endpoint", "url validation", "rejection reason", "enabled", "key env var", "key present"],
          rows: s.providers.rows.map((row) => [
            row.id,
            row.href ?? "(not shown)",
            row.validation,
            row.reason ?? "—",
            row.enabled ? "declared enabled" : "declared disabled",
            row.apiKeyEnvVar ?? "(undeclared)",
            row.apiKeyPresent ? "present" : "not present",
          ]),
        },
      },
      {
        title: "Reachability, real inference, activation",
        layout: "metrics",
        cells: [
          {
            label: "Endpoint reachability",
            cell: notVerified(
              "no source",
              "NOT VERIFIED — the dashboard opens no connection to any provider. Mandate §6.1 requires explicit operator authorisation before an outbound inference request.",
            ),
          },
          {
            label: "Real inference",
            cell: notVerified(
              "no source",
              "NOT VERIFIED — no chat completion has been executed against any provider, so no provider is connected.",
            ),
          },
          {
            label: "Agent activation",
            cell: observed(
              s.activation.approved === true ? "approved" : "not approved",
              "activationView / automaton.json security.activationApproved",
              `reason: ${String(s.activation.reason ?? "not reported")} — not approved is the intended lockdown posture.`,
            ),
          },
        ],
      },
      {
        title: "Credential gates (presence only — values are never read out)",
        layout: "table",
        note: "Mandate §29 item 6: entering real API credentials requires approval. The dashboard neither accepts nor displays them.",
        table: {
          columns: ["field", "configured", "source"],
          rows: [
            ...providerKeys.map(([field, envName]) => [
              field,
              typeof raw[field] === "string" && String(raw[field]).length > 0 ? "configured" : "not configured",
              `automaton.json ${field} / env ${envName}`,
            ]),
            ...providerEnvRows,
          ],
        },
      },
      {
        title: "Live model testing",
        layout: "notice",
        notice: {
          level: "info",
          text: "LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL. Phase 16D delivered the preflight and the isolated tier; it did not run a live model, because no credential is configured and none may be entered automatically.",
        },
      },
    ],
  };
}

function countToCell(
  count: { verdict: "VERIFIED" | "EMPTY" | "NOT VERIFIED"; rows: number | null; note: string },
  table: string,
): Cell {
  if (count.verdict === "NOT VERIFIED") return notVerified(table, count.note);
  if (count.verdict === "EMPTY") return empty(0, table, count.note);
  return observed(count.rows ?? 0, table, count.note);
}
