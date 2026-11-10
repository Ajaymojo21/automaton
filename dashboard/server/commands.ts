import fs from "node:fs";
import path from "node:path";
import { buildSnapshot } from "./state.js";
import { verifyBackupDir, listBackupDirs, isWalletFile } from "./verify.js";
import { writableRepairApprovals } from "./repair-approvals.js";
import { DuplicateProposalError, type RepairProposal } from "../../src/reliability/repair-approval.js";
import { audit } from "./audit.js";
import { DASHBOARD_ROOT, PROJECT_BACKUPS_DIR, STATE_DIR } from "./paths.js";
import { describe } from "./values.js";

export interface ActionResult {
  ok: boolean;
  action: string;
  verdict: string;
  summary: string;
  data?: unknown;
}

/** Create a repair proposal from a health check finding (governance only, no execution). */
export function createRepairProposalAction(input: {
  findingId: string;
  component: string;
  rootCause: string;
  proposedAction: string;
  riskClassification: "low" | "medium" | "high" | "critical";
}): ActionResult {
  const opened = writableRepairApprovals();
  if (!opened.ok) {
    return {
      ok: false,
      action: "repair-propose",
      verdict: "NOT VERIFIED",
      summary: `approval store unavailable: ${opened.error}`,
    };
  }
  let proposal: RepairProposal;
  try {
    proposal = opened.store.createProposal({
      findingId: input.findingId,
      component: input.component,
      rootCause: input.rootCause,
      proposedAction: input.proposedAction,
      expectedBenefit: "Resolve the health finding",
      potentialSideEffects: "Depends on the specific repair",
      riskClassification: input.riskClassification,
      requiredPermissions: ["maintenance"],
      expectedDowntime: false,
      rollbackPossible: true,
    });
  } catch (cause) {
    const duplicate = cause instanceof DuplicateProposalError;
    return {
      ok: false,
      action: "repair-propose",
      verdict: "DENIED",
      summary: duplicate ? cause.message : `could not record proposal: ${describe(cause)}`,
    };
  }
  audit({ at: new Date().toISOString(), event: "repair-approval.proposed", verdict: "VERIFIED", detail: { id: proposal.id, findingId: input.findingId } });
  return {
    ok: true,
    action: "repair-propose",
    verdict: "VERIFIED",
    summary: `proposal ${proposal.id} created, awaiting approval`,
    data: proposal,
  };
}

const STATE_WRITE_ROOT = path.join(DASHBOARD_ROOT, "state");

/** Runs the guardian in-process over the read-only handle, then persists a NEW file.
 *  No subprocess is spawned: the only process the dashboard launches is `tasklist`. */
export async function runHealthCheckAction(): Promise<ActionResult> {
  const snapshot = await buildSnapshot();
  const report = snapshot.health.report;
  if (!report) {
    audit({ at: snapshot.observedAt, event: "action.health-check", verdict: "NOT VERIFIED", detail: { error: snapshot.health.error } });
    return {
      ok: false,
      action: "health-check",
      verdict: "NOT VERIFIED",
      summary: `health checks could not run: ${snapshot.health.error ?? "no report"}`,
    };
  }
  const target = path.join(STATE_WRITE_ROOT, `health-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  let persisted = true;
  try {
    fs.mkdirSync(STATE_WRITE_ROOT, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ source: "dashboard read-only run", snapshot: { observedAt: snapshot.observedAt, db: snapshot.db.error }, report }, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
  } catch (cause) {
    persisted = false;
    audit({ at: report.generatedAt, event: "action.health-check.persist", verdict: "NOT VERIFIED", detail: { error: describe(cause) } });
  }
  audit({ at: report.generatedAt, event: "action.health-check", verdict: report.overall, detail: { checks: report.checks.length, persisted } });
  return {
    ok: true,
    action: "health-check",
    verdict: report.overall,
    summary: `${report.checks.length} checks, overall ${report.overall}${persisted ? `, persisted to dashboard/state` : ", persistence failed"}`,
    data: report,
  };
}

/** Re-hash every archive against its own manifest. Read-only with respect to Conway state. */
export async function verifyBackupsAction(): Promise<ActionResult> {
  const started = new Date().toISOString();
  const dirs = listBackupDirs(PROJECT_BACKUPS_DIR);
  const checks = dirs.map((dir) => verifyBackupDir(dir));
  const withManifest = checks.filter((check) => check.kind !== "none");
  const all = withManifest.flatMap((check) => check.checks);
  const archiveMatched = all.filter((file) => file.base === "archive" && file.verdict === "MATCH");
  const repoMatched = all.filter((file) => file.base === "repo" && file.verdict === "MATCH");
  const problems = all.filter((file) => file.verdict !== "MATCH");
  const verdict = withManifest.length === 0 ? "NOT VERIFIED" : problems.length === 0 ? "VERIFIED" : "MISMATCH";
  audit({ at: started, event: "action.verify-backups", verdict, detail: { dirs: dirs.length, checked: withManifest.length, problems: problems.map((file) => `${file.rel}=${file.verdict}`) } });
  return {
    ok: verdict === "VERIFIED",
    action: "verify-backups",
    verdict,
    summary: `${withManifest.length}/${dirs.length} archive(s) carry a manifest · ${archiveMatched.length} archived file(s) match, ${repoMatched.length} live-file entry(ies) match, ${problems.length} problem(s)`,
    data: { checks, problems: problems.map((file) => ({ rel: file.rel, base: file.base, verdict: file.verdict })) },
  };
}

export interface RestorePlan {
  ok: boolean;
  verdict: string;
  summary: string;
  sourceDir?: string;
  target?: string;
  files?: string[];
}

/**
 * §17: "Restore must require explicit confirmation. Never overwrite active state
 * automatically." The confirmation string must equal the archive name character-for-character,
 * the archive must verify first, and the target is always a NEW directory under
 * `dashboard/restore-targets/`. `restore.mjs --allow-live` — which copies over the live
 * state — is not reachable from this code path, and the target check makes it unreachable
 * even if a caller tried to point it there.
 */
export function planRestore(backupDirName: string, confirmText: string): RestorePlan {
  if (typeof backupDirName !== "string" || backupDirName.length === 0 || backupDirName.length > 200) {
    return { ok: false, verdict: "NOT VERIFIED", summary: "archive name rejected (length/type)" };
  }
  if (/[/\\]|^\.\.?$/.test(backupDirName)) {
    return { ok: false, verdict: "NOT VERIFIED", summary: "archive name must be a single path segment" };
  }
  if (confirmText !== backupDirName) {
    return { ok: false, verdict: "NOT VERIFIED", summary: "typed confirmation does not equal the archive name" };
  }
  const dir = path.join(PROJECT_BACKUPS_DIR, backupDirName);
  const check = verifyBackupDir(dir);
  if (check.kind === "none" || check.checks.length === 0) {
    return { ok: false, verdict: "NOT VERIFIED", summary: `no manifest in ${backupDirName}, refusing to restore unverified bytes` };
  }
  const bad = check.checks.filter((file) => file.verdict !== "MATCH");
  if (bad.length > 0) {
    return { ok: false, verdict: "MISMATCH", summary: `${bad.length} file(s) failed hash verification: ${bad.map((file) => `${file.file}=${file.verdict}`).join(", ")}` };
  }
  // Only archive-resolved entries are copies of the backup. A repo-resolved MATCH proves the
  // *live* file equals the snapshot; copying that would "restore" the current working tree.
  const archived = check.checks.filter((file) => file.base === "archive");
  const drift = check.checks.filter((file) => file.base === "repo");
  if (archived.length === 0) {
    return {
      ok: false,
      verdict: "NOT VERIFIED",
      summary: `${backupDirName} verifies ${drift.length} live-file entry/entries and holds no archive-relative copy — refusing to restore a snapshot that has no restorable bytes`,
    };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(DASHBOARD_ROOT, "restore-targets", `${backupDirName}--${stamp}`);
  if (path.resolve(target) === path.resolve(STATE_DIR) || path.resolve(target).startsWith(path.resolve(STATE_DIR))) {
    return { ok: false, verdict: "NOT VERIFIED", summary: "refusing any target inside the live state directory" };
  }
  const files = archived.map((file) => file.rel);
  const plan: RestorePlan = {
    ok: true,
    verdict: "VERIFIED",
    summary: `${files.length} verified archive file(s) will be copied to a new directory${drift.length ? `; ${drift.length} repo-relative entry/entries are working-tree references and are excluded` : ""}`,
    sourceDir: dir,
    target,
    files,
  };
  holdPlan(backupDirName, plan);
  return plan;
}

const PLAN_TTL_MS = 10 * 60_000;
const heldPlans = new Map<string, { plan: RestorePlan; at: number }>();

/** Remembers the plan the operator was shown so step 2 can copy exactly that path. Bounded:
 *  the oldest held plan is dropped once the map is full, because a stale plan is worthless. */
function holdPlan(name: string, plan: RestorePlan): void {
  heldPlans.set(name, { plan, at: Date.now() });
  if (heldPlans.size <= 16) return;
  const oldest = [...heldPlans.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  if (oldest && oldest[0] !== name) heldPlans.delete(oldest[0]);
}

/**
 * Step 2. This consumes the plan confirmed at step 1 instead of computing a new one, so the
 * directory the operator approved is the directory that gets written — a fresh `planRestore()`
 * here would stamp a different target than the one that was just shown. The plan is single-use
 * and re-verified against the archive before a byte is copied.
 */
export function executeConfirmedRestore(name: string, confirm: string): ActionResult {
  const base = { action: "restore", verdict: "NOT VERIFIED" };
  const held = heldPlans.get(name);
  heldPlans.delete(name);
  if (!held) return { ...base, ok: false, summary: "no confirmed plan for that archive — run step 1 first" };
  if (confirm !== name) return { ...base, ok: false, summary: "typed confirmation does not equal the archive name" };
  if (Date.now() - held.at > PLAN_TTL_MS) return { ...base, ok: false, summary: "the confirmed plan is older than 10 minutes — run step 1 again" };
  const check = verifyBackupDir(held.plan.sourceDir ?? "");
  const matching = new Set(check.checks.filter((file) => file.base === "archive" && file.verdict === "MATCH").map((file) => file.rel));
  const lost = (held.plan.files ?? []).filter((rel) => !matching.has(rel));
  if (lost.length > 0) return { ...base, ok: false, summary: `${lost.length} file(s) no longer verify against the archive; nothing was copied` };
  const target = held.plan.target ?? "";
  if (target && fs.existsSync(target)) return { ...base, ok: false, summary: `refusing to write over an existing directory: ${target}` };
  return executeRestore(held.plan);
}

export function executeRestore(plan: RestorePlan): ActionResult {
  const base = { action: "restore", verdict: plan.verdict };
  if (!plan.ok || !plan.target || !plan.files || !plan.sourceDir) {
    return { ...base, ok: false, summary: plan.summary };
  }
  const source = path.resolve(plan.sourceDir);
  const target = plan.target;
  const entries = plan.files;
  if (!source.startsWith(path.resolve(PROJECT_BACKUPS_DIR) + path.sep) && source !== path.resolve(PROJECT_BACKUPS_DIR)) {
    return { ...base, ok: false, summary: "source archive is not inside the backups tree" };
  }
  // Refuse to restore any wallet or key material, even if a manifest lists it.
  const walletEntries = entries.filter((rel) => isWalletFile(rel));
  if (walletEntries.length > 0) {
    return { ...base, ok: false, summary: `restore refused: archive contains wallet/key material (${walletEntries.join(", ")})` };
  }
  try {
    // Resolve every destination before creating anything: a manifest entry that escapes the
    // archive must not leave a half-built restore directory behind.
    const pairs = entries.map((rel) => {
      const from = confine(source, rel);
      const to = confine(target, rel);
      if (!from || !to) throw new Error(`manifest entry escaped its archive: ${rel}`);
      if (isWalletFile(rel)) throw new Error(`wallet material refused: ${rel}`);
      assertRegularArchiveEntry(from, rel);
      return { from, to };
    });
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.mkdirSync(target, { recursive: false, mode: 0o700 });
    for (const { from, to } of pairs) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    fs.writeFileSync(path.join(target, "RESTORE-NOTE.txt"), noteFor(plan), "utf-8");
  } catch (cause) {
    audit({ at: new Date().toISOString(), event: "action.restore", verdict: "NOT VERIFIED", detail: { error: describe(cause) } });
    return { ...base, ok: false, summary: `copy failed: ${describe(cause)}` };
  }
  audit({ at: new Date().toISOString(), event: "action.restore", verdict: "VERIFIED", detail: { target: plan.target, files: plan.files.length } });
  return {
    ...base,
    ok: true,
    summary: `copied ${plan.files.length} file(s) to ${plan.target}. The live database was not touched.`,
    data: { target: plan.target },
  };
}

function confine(root: string, rel: string): string | null {
  const candidate = path.resolve(root, rel);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

/** A manifest promises a regular file. A link in its place would copy whatever it points at. */
export function assertRegularArchiveEntry(file: string, rel: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`refusing linked archive entry: ${rel}`);
  if (!stat.isFile()) throw new Error(`refusing non-regular archive entry: ${rel}`);
}

function noteFor(plan: RestorePlan): string {
  return [
    "Conway dashboard restore — alternate path, read-only against the live state.",
    `source archive : ${plan.sourceDir}`,
    `target         : ${plan.target}`,
    "files          :",
    ...(plan.files ?? []).map((name) => `  - ${name}`),
    "",
    "This directory is a copy for inspection. Promoting it to runtime/home/.automaton is an",
    "operator action (restore.mjs without --allow-live, with the live tree moved aside first),",
    "and it stays an operator action: the dashboard has no code path that overwrites live state.",
  ].join("\n");
}
