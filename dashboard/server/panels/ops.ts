import { empty, notApplicable, notVerified, observed, unknown } from "../values.js";
import { type Snapshot } from "../state.js";
import { HOST, ORIGIN, PORT } from "../paths.js";
import type { Panel, PanelSection } from "./types.js";

export function logsPanel(s: Snapshot): Panel {
  const files = s.logs.files;
  return {
    id: "logs",
    title: "Activity Logs",
    subtitle: "Agent logs and the console's own audit trail",
    sections: [
      {
        title: "Agent logs",
        layout: "table",
        note: "Log redirection happens only in START_CONWAY.bat, which the dashboard does not run. The logger itself has no file sink, so an empty logs/ directory is the expected state of an agent that has never been started — not a logging failure.",
        table: {
          columns: ["file", "bytes", "modified"],
          rows: files.length === 0
            ? [["—", "NO DATA", "the runtime has never been launched"]]
            : files.map((file) => [file.name, file.bytes, file.mtimeIso]),
        },
      },
      {
        title: "Process state",
        layout: "metrics",
        cells: [
          {
            label: "PID file",
            cell: s.logs.pidFile.exists
              ? observed(s.logs.pidFile.path, "logs/automaton.pid", `${s.logs.pidFile.bytes} bytes, modified ${s.logs.pidFile.mtimeIso}`)
              : empty("absent", "logs/automaton.pid", "no pid file — consistent with an agent that has never run"),
          },
          { label: "Activity timeline", cell: unknown("event_stream", "table exists and holds 0 rows; an empty timeline is not a gap-free timeline") },
        ],
      },
      {
        title: "Console audit trail",
        layout: "metrics",
        cells: [
          {
            label: "Audit log",
            cell: s.auditLog.writable
              ? observed(`${s.auditLog.files} file(s) in ${s.auditLog.dir}`, "dashboard audit writer", "append-only JSONL, values redacted structurally before write")
              : notVerified("dashboard audit writer", `audit sink not writable at ${s.auditLog.dir}`),
          },
        ],
      },
    ],
  };
}

export function backupPanel(s: Snapshot): Panel {
  const entries = s.backups.entries;
  const dbBackups = entries.filter((entry) => /^\d{4}-\d{2}-\d{2}_/.test(entry.name));
  return {
    id: "backup",
    title: "Backup & Recovery",
    subtitle: "What exists on disk, and what has actually been verified",
    sections: [
      {
        title: "Database backups",
        layout: "table",
        note: "An online-backup copy rewrites the SQLite header, so it legitimately hashes differently from its source. Equality is therefore checked archive-versus-its-own-manifest, never archive-versus-live-database.",
        table: {
          columns: ["directory", "kind", "bytes", "modified", "verification"],
          rows: (dbBackups.length > 0 ? dbBackups : entries.slice(0, 6)).map((entry) => [
            entry.name,
            entry.kind,
            entry.bytes ?? "—",
            entry.mtimeIso ?? "—",
            "UNVERIFIED — use Verify to re-hash against its manifest (read-only)",
          ]),
        },
      },
      {
        title: "Integrity today",
        layout: "metrics",
        cells: [
          {
            label: "Live database",
            cell: s.db.integrity ? observed(`integrity_check = ${s.db.integrity}`, "PRAGMA integrity_check (read-only handle)") : notVerified("PRAGMA integrity_check", s.db.error ?? "unreadable"),
          },
          { label: "Backup count", cell: observed(entries.length, "backups/ listing", `${dbBackups.length} database backup(s), ${entries.length - dbBackups.length} source snapshot(s)`) },
          {
            label: "Manifest hashes recomputed",
            cell: unknown("verify endpoint", "NOT VERIFIED in this view — hashing every archive on each poll would make the panel slow; press Verify"),
          },
        ],
      },
      {
        title: "Restore",
        layout: "notice",
        notice: {
          level: "danger",
          text: "Restore is available only as a copy to an alternate path, behind a typed confirmation, and never against the live state directory. restore.mjs --allow-live is not exposed: it overwrites the active database. A restore also cannot be verified as successful until the migrated V12/V13 tables exist, which is an operator decision, not a dashboard action.",
        },
      },
    ],
  };
}

export function controlsPanel(s: Snapshot): Panel {
  const sections: PanelSection[] = [
    {
      title: "Controls disabled: the agent is inactive by design",
      layout: "notice",
      notice: {
        level: "warn",
        text: "START / STOP / RESTART / ACTIVATE / CREATE WALLET / FUND / ENABLE FINANCIAL TOOLS / ENABLE REPLICATION / ENABLE SELF-HEALING / ENGAGE EMERGENCY STOP / MIGRATE SCHEMA do not exist as endpoints. Each one either activates the agent, writes state, or moves money, and §29 lists all of them as prohibited without approval.",
      },
    },
    {
      title: "Safe actions that are wired",
      layout: "table",
      note: "Both are read-only against the live tree and run as fixed argv arrays with no shell and no operator-supplied command line.",
      table: {
        columns: ["action", "what it runs", "writes"],
        rows: [
          ["Run health check", "the pinned runtime executing src/reliability/health-guardian.ts over a read-only handle", "dashboard/state/health-<timestamp>.json (new file, never an existing one; Conway's reports/ tree is not written)"],
          ["Verify backups", "re-hash archive files against their own manifests", "nothing outside the audit log"],
        ],
      },
    },
    {
      title: "Gate board",
      layout: "table",
      note: "Read at request time. §29 invariants must stay as shown; the dashboard has no endpoint that changes any of them.",
      table: {
        columns: ["invariant", "required", "observed", "verdict"],
        rows: invariants(s),
      },
    },
  ];
  return { id: "controls", title: "System Controls", subtitle: "What this console will and will not do", sections };
}

function invariants(s: Snapshot): Array<Array<string | number>> {
  const config = s.config.config;
  const security = config?.security ?? undefined;
  const value = (label: string, required: string, actual: unknown, note: string): Array<string | number> => {
    const observedText = actual === undefined ? "absent (code default)" : String(actual);
    const verdict = observedText.toLowerCase() === required.toLowerCase() ? "VERIFIED" : "NOT VERIFIED";
    return [label, required, observedText, `${verdict} — ${note}`];
  };
  return [
    value("activationApproved", "false", security?.activationApproved, "automaton.json security"),
    value("CONWAY_ACTIVATION", "absent", s.activation.envGates ? gatePresent(s, "CONWAY_ACTIVATION") : undefined, "process environment of the dashboard"),
    value("lockdown", "true", security?.lockdown, "automaton.json security"),
    value("allowedTools", "[]", security?.allowedTools?.length === 0 ? "[]" : JSON.stringify(security?.allowedTools ?? []), "automaton.json security"),
    value("maxChildren", "0", config?.maxChildren, "automaton.json maxChildren"),
    value("selfHealingEnabled", "false", originDeclared(s, "selfHealingEnabled"), "security.selfHealingEnabled — declared value, not the merge default"),
    value("wallet creation gate", "absent", gatePresent(s, "CONWAY_ALLOW_WALLET_CREATION"), "CONWAY_ALLOW_WALLET_CREATION"),
    value("bind address", HOST, `${HOST}:${PORT}`, "server socket"),
    value("public exposure", "disabled", security?.allowExternalExposure, "security.allowExternalExposure"),
  ];
}

function gatePresent(s: Snapshot, key: string): string {
  const gates = (s.activation.envGates as Array<{ key: string; present: boolean }>) ?? [];
  const found = gates.find((gate) => gate.key === key);
  return found ? (found.present ? "present" : "absent") : "absent";
}

function originDeclared(s: Snapshot, key: string): string | undefined {
  const entry = s.securityOrigin.find((item) => item.key === key);
  if (!entry) return undefined;
  return entry.declared ? String(entry.effective) : undefined;
}

export function settingsPanel(s: Snapshot): Panel {
  const raw = s.config.raw ?? {};
  const secretish = ["conwayApiKey", "openaiApiKey", "anthropicApiKey", "walletAddress"];
  return {
    id: "settings",
    title: "Settings",
    subtitle: "Paths, ports and the config file as it sits on disk",
    sections: [
      {
        title: "Endpoints",
        layout: "list",
        list: [
          { label: "Bind address", value: observed(`${HOST}:${PORT}`, "server socket", "loopback only; the server refuses any other host and port 3001 is never used (it belongs to another project)") },
          { label: "Allowed origin", value: observed(ORIGIN, "CSRF check") },
          { label: "Database", value: observed(s.db.file.path, "readonly handle", `integrity ${s.db.integrity ?? "n/a"}, journal ${s.db.journalMode ?? "n/a"}`) },
          { label: "State directory", value: observed(s.stateDir, "assertConwayHome({mode:'runtime'})") },
          { label: "Config file", value: observed(s.config.meta.path, "filesystem", `${s.config.meta.bytes ?? "—"} bytes, sha256 ${String(s.config.meta.sha256 ?? "").slice(0, 16)}…`) },
        ],
      },
      {
        title: "Configuration keys",
        layout: "table",
        note: "Credential fields are reported as configured/not configured. Their values are never serialised into a response, and the save path is not exposed.",
        table: {
          columns: ["key", "state"],
          rows: secretish.map((key) => [
            key,
            typeof raw[key] === "string" && (raw[key] as string).length > 0 ? "configured (value withheld)" : "not configured",
          ]),
        },
      },
      {
        title: "Security block — declared versus code default",
        layout: "table",
        note: "The one column the operator usually wants is whether a value was actually chosen. R-21 and the selfHealingEnabled finding both come from this distinction.",
        table: {
          columns: ["key", "declared", "effective", "source"],
          rows: s.securityOrigin.map((entry) => [entry.key, entry.declared ? "yes" : "no", String(entry.effective), entry.source]),
        },
      },
      {
        title: "Write paths that are not exposed",
        layout: "list",
        list: [
          { label: "saveConfig / createConfig", value: notApplicable("src/config.ts", "overwrites the file holding the activation gates") },
          { label: "syncHeartbeatToDb", value: notApplicable("src/heartbeat/config.ts", "INSERTs/UPDATEs heartbeat_schedule in the live database") },
          { label: "applyMigrations (V12/V13)", value: notApplicable("src/state/database.ts", "permanently migrates the live database; it runs inside createDatabase(), which the dashboard never imports") },
          { label: "Dashboard settings file", value: notApplicable("by design", "there is no persisted dashboard preference that can change agent behaviour") },
        ],
      },
    ],
  };
}
