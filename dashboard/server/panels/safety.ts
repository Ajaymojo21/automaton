import { empty, notVerified, observed, unknown, type Cell } from "../values.js";
import { countCell, type Snapshot } from "../state.js";
import type { Panel, PanelSection } from "./types.js";

export function securityPanel(s: Snapshot): Panel {
  const sections: PanelSection[] = [
    {
      title: "Emergency stop",
      layout: "metrics",
      cells: [
        {
          label: "Marker scan",
          cell: s.emergency.state.engaged
            ? observed("ENGAGED", "readEmergencyStop()", `marker at ${s.emergency.state.markerPath}, reason "${s.emergency.state.reason}"`)
            : observed(
                "NOT ENGAGED",
                "readEmergencyStop()",
                `union scan of ${s.emergency.pathsScanned.length} paths, none holding a marker. This is a scan result, not a guarantee: engage/clear are not reachable from this console.`,
              ),
        },
        {
          label: "Paths scanned",
          cell: observed(s.emergency.pathsScanned, "getEmergencyStopPaths()", "rendered so the operator can see the union, which follows ambient HOME"),
        },
        {
          label: "Audit-trail corroboration",
          cell: countCell(s, "security_events").verdict === "NOT VERIFIED"
            ? notVerified("security_events", "table absent (V12) — the second source of truth does not exist, so the marker scan is the only signal")
            : observed("available", "security_events"),
        },
      ],
    },
    {
      title: "Activation gates",
      layout: "table",
      note: "Presence is reported by key name. Values of gate variables are never read into a response.",
      table: {
        columns: ["gate", "state", "verdict"],
        rows: [
          ["security.activationApproved", String(s.activation.configActivationApproved), "VERIFIED (file)"],
          ["CONWAY_ACTIVATION", envState(s, "CONWAY_ACTIVATION"), "VERIFIED (this process)"],
          ["CONWAY_ALLOW_WALLET_CREATION", envState(s, "CONWAY_ALLOW_WALLET_CREATION"), "VERIFIED (this process)"],
          ["CONWAY_WALLET_PASSPHRASE", envState(s, "CONWAY_WALLET_PASSPHRASE"), "VERIFIED (this process)"],
          ["CONWAY_LIVE_MODEL_APPROVED", envState(s, "CONWAY_LIVE_MODEL_APPROVED"), "VERIFIED (this process)"],
        ],
      },
    },
    {
      title: "Audit chain, incidents and seals",
      layout: "metrics",
      cells: [
        { label: "Audit seals", cell: sealCell(s) },
        { label: "Incidents", cell: incidentCell(s) },
        {
          label: "File ACLs",
          cell: unknown("icacls", "NOT VERIFIED — the dashboard does not shell out for ACLs; re-run SECURITY_AUDIT.bat to collect them"),
        },
      ],
    },
    {
      title: "Configuration integrity",
      layout: "list",
      list: [
        { label: "automaton.json", value: observed(`${s.config.meta.bytes ?? "—"} bytes, sha256 ${String(s.config.meta.sha256 ?? "unavailable").slice(0, 16)}…`, "sha256 of the file as read") },
        { label: "Live database", value: observed(`sha256 not computed (the file is a live WAL database); integrity_check = ${s.db.integrity ?? "unreadable"}`, "PRAGMA integrity_check on a read-only handle") },
        { label: "Imported API contract", value: notVerified("src/security/**, src/runtime/**", "CONTRACT UNPINNED — these files are untracked in git and their signatures changed during Phase 16") },
      ],
    },
  ];
  return {
    id: "security",
    title: "Security Center",
    subtitle: "Gates, markers and audit posture — verified by read, never by assumption",
    sections,
  };
}

function envState(s: Snapshot, key: string): string {
  const gates = (s.activation.envGates as Array<{ key: string; present: boolean }>) ?? [];
  const found = gates.find((gate) => gate.key === key);
  if (!found) return "not monitored";
  return found.present ? "present" : "absent";
}

function sealCell(s: Snapshot): Cell {
  const count = countCell(s, "security_seals");
  if (count.verdict === "NOT VERIFIED") {
    return notVerified(
      "security_seals",
      "table absent — the seal chain cannot be read. An absent table is not evidence about the seals either way, so this area reports NOT VERIFIED and never a seal outcome.",
    );
  }
  if (count.rows === 0) return empty(0, "security_seals", "table exists, 0 seals — nothing to verify");
  return notVerified("security_seals", `${count.rows} seal rows exist; verifySeals was not run because it requires a write handle path the dashboard refuses to open`);
}

function incidentCell(s: Snapshot): Cell {
  const count = countCell(s, "security_incidents");
  if (count.verdict === "NOT VERIFIED") {
    return notVerified("security_incidents", "table absent (V13) — listIncidents/incidentSummary throw. NOT VERIFIED, not \"no incidents\".");
  }
  if (count.rows === 0) return empty(0, "security_incidents", "table exists, 0 incidents");
  return observed(count.rows, "security_incidents", `${count.rows} incident row(s) — do not call scanSecurityEvents(); it INSERTs`);
}

/**
 * The guardian reports `blocked` when a source is absent — usually a table the live database
 * does not yet have. Phase 16 recorded the display trap: "table security_seals ABSENT …
 * must NOT be shown as seals failed". So the panel keeps the raw status visible, adds the
 * dashboard's reading beside it, and recomputes the headline from the checks that had a source.
 */
interface CheckReading {
  rawStatus: string;
  dashboardVerdict: "NOT VERIFIED" | "VERIFIED";
  reason: string;
}

function readCheck(check: { id: string; status: string; message: string }): CheckReading {
  if (check.status === "blocked") {
    return {
      rawStatus: check.status,
      dashboardVerdict: "NOT VERIFIED",
      reason: `the guardian had no source to assess — ${check.message}`,
    };
  }
  return { rawStatus: check.status, dashboardVerdict: "VERIFIED", reason: `the guardian observed this directly (${check.status})` };
}

function adjustedOverall(report: NonNullable<Snapshot["health"]["report"]>): { value: string; note: string } {
  const excluded = report.checks.filter((check) => check.status === "blocked");
  const informative = report.checks.filter((check) => check.status !== "blocked");
  const operator = informative.filter((check) => check.status === "requires_operator");
  const failed = informative.filter((check) => check.status === "fail");
  const warned = informative.filter((check) => check.status === "warn");
  // No informative check at all is not a pass: there was nothing to observe.
  const value =
    informative.length === 0
      ? "NOT VERIFIED"
      : failed.length > 0
        ? "critical"
        : operator.length > 0
          ? "requires_operator"
          : warned.length > 0
            ? "degraded"
            : "ok";
  return {
    value,
    note: `${informative.length} check(s) had a source, ${excluded.length} reported blocked, ${operator.length} require operator action, ${warned.length} warn, ${failed.length} fail`,
  };
}

export function healthPanel(s: Snapshot): Panel {
  const report = s.health.report;
  const adjusted = report ? adjustedOverall(report) : null;
  return {
    id: "health",
    title: "Health Monitor",
    subtitle: "runHealthChecks() over a read-only handle, plus the host it runs on",
    sections: [
      {
        title: "Guardian result",
        layout: "metrics",
        cells: [
          {
            label: "Overall (as reported)",
            cell: report ? observed(report.overall, "runHealthChecks()", `generatedAt ${report.generatedAt}`) : notVerified("runHealthChecks()", s.health.error ?? "no report"),
          },
          {
            label: "Overall (informative checks only)",
            cell: adjusted
              ? observed(
                  adjusted.value,
                  "dashboard reclassification",
                  `${adjusted.note}. A check reported blocked had no source; it is excluded here and shown as-is in the table below.`,
                )
              : notVerified("dashboard reclassification", "no report to reclassify"),
          },
          {
            label: "Report freshness",
            cell: freshness(s),
          },
        ],
      },
      {
        title: "Checks",
        layout: "table",
        note: "Two verdict columns on purpose: the first is what the guardian returned, the second is what the evidence supports. Nothing is hidden and nothing is silently upgraded.",
        table: {
          columns: ["id", "guardian status", "dashboard verdict", "message", "evidence"],
          rows: (report?.checks ?? []).map((check) => {
            const reading = readCheck(check);
            return [
              check.id,
              check.status,
              reading.dashboardVerdict === "NOT VERIFIED" ? `NOT VERIFIED — ${reading.reason}` : reading.reason,
              check.message,
              check.evidence ? JSON.stringify(check.evidence) : "—",
            ];
          }),
        },
      },
      {
        title: "Host",
        layout: "metrics",
        cells: [
          {
            label: "CPU utilisation",
            cell: s.os.cpuPercent === null
              ? unknown("two os.cpus() samples", "NOT VERIFIED until two samples are captured — never 0 %")
              : observed(`${s.os.cpuPercent} %`, `os.cpus() sample pair (${s.os.cores} cores)`, "os.loadavg() returns [0,0,0] on Windows and is not used"),
          },
          { label: "Memory used", cell: observed(`${s.os.usedMemPercent} %`, `os.totalmem()/os.freemem()`, `${s.os.totalMemBytes - s.os.freeMemBytes} of ${s.os.totalMemBytes} bytes`) },
          { label: "Disk (state volume)", cell: s.disk ? observed(`${s.disk.freeBytes} free of ${s.disk.totalBytes}`, "fs.statfsSync()") : unknown("fs.statfsSync()", "unreadable") },
          { label: "Node runtime", cell: observed(`${s.os.nodeVersion} on ${s.os.platform} ${s.os.arch}`, "process.version") },
          { label: "Dashboard process", cell: observed(s.dashboardPid, "process.pid of the dashboard", "this is the console's own process, never presented as the agent's") },
        ],
      },
    ],
  };
}

function freshness(s: Snapshot): Cell {
  const latest = s.reports["health-latest.json"];
  if (!latest.exists) return unknown("reports/health-latest.json", "no persisted report; the panel value came from a live read this request");
  const ageMs = Date.now() - new Date(latest.mtimeIso ?? 0).getTime();
  return observed(
    `${latest.path} (${Math.round(ageMs / 60000)} min old, sha256 ${String(latest.sha256 ?? "").slice(0, 12)}…)`,
    "reports/health-latest.json mtime",
    "the persisted file is written by HEALTH_CHECK.bat, not by this console — its staleness is reported, not repaired",
  );
}

export function selfHealingPanel(s: Snapshot): Panel {
  const schedule = countCell(s, "heartbeat_schedule");
  const history = countCell(s, "heartbeat_history");
  return {
    id: "self-healing",
    title: "Self-Healing",
    subtitle: "Enablement, schedule and execution history",
    sections: [
      {
        title: "Enablement",
        layout: "metrics",
        cells: [
          { label: "selfHealingEnabled", cell: selfHealingCell(s) },
          {
            label: "Mechanic",
            cell: observed("NOT REACHABLE", "design", "runMechanic() performs repairs (may restart tasks and write). §16A.4 requires the mechanic never to touch wallet credentials, treasury limits, security policies, activation approvals or tool permissions — the only way to guarantee that here is not to expose it."),
          },
        ],
      },
      {
        title: "Heartbeat",
        layout: "metrics",
        cells: [
          { label: "Declared entries (heartbeat.yml)", cell: declaredHeartbeat(s) },
          { label: "heartbeat_schedule rows", cell: countToCell(schedule, "heartbeat_schedule") },
          { label: "heartbeat_history rows", cell: countToCell(history, "heartbeat_history") },
          {
            label: "Next runs",
            cell: schedule.verdict === "NOT VERIFIED" || (schedule.rows ?? 0) === 0
              ? observed("NEVER RUN — 0 scheduled, 0 executed", "heartbeat_schedule/heartbeat_history", "syncHeartbeatToDb() never ran; it is a write and the dashboard does not write. Not \"all green\".")
              : unknown("heartbeat_schedule", "scheduled rows exist but no execution history was read"),
          },
        ],
      },
      {
        title: "Posture",
        layout: "notice",
        notice: {
          level: "info",
          text: "Self-healing stays disabled by default (mandate §17 \"Keep: selfHealingEnabled = false\"). Enabling it is a §29 item 14 decision — unrestricted autonomous execution — and the enable switch is not rendered.",
        },
      },
    ],
  };
}

function selfHealingCell(s: Snapshot): Cell {
  const declared = s.securityOrigin.find((entry) => entry.key === "selfHealingEnabled");
  if (!declared || !declared.declared) {
    return observed(false, "loadConfig() code default", "false — the key is ABSENT from automaton.json; the value is a code default the operator never declared");
  }
  return observed(declared.effective, "automaton.json security.selfHealingEnabled");
}

function declaredHeartbeat(s: Snapshot): Cell {
  const heartbeat = s.heartbeat.config as Record<string, unknown> | null;
  if (!heartbeat) return notVerified("heartbeat.yml", s.heartbeat.error ?? "unreadable");
  const entries = (heartbeat.entries as Array<{ enabled?: boolean }>) ?? [];
  const enabled = entries.filter((entry) => entry?.enabled === true).length;
  if (enabled > 0 && (s.tables.find((t) => t.table === "heartbeat_schedule")?.rows ?? 0) === 0) {
    return observed(
      `${entries.length} declared, ${enabled} enabled in YAML, 0 in the database`,
      "heartbeat.yml",
      "declared ≠ scheduled. syncHeartbeatToDb() has never run against this database.",
    );
  }
  return observed(`${entries.length} declared, ${enabled} enabled`, "heartbeat.yml");
}

function countToCell(
  count: { verdict: "VERIFIED" | "EMPTY" | "NOT VERIFIED"; rows: number | null; note: string },
  table: string,
): Cell {
  if (count.verdict === "NOT VERIFIED") return notVerified(table, count.note);
  if (count.verdict === "EMPTY") return empty(0, table, count.note);
  return observed(count.rows ?? 0, table, count.note);
}
