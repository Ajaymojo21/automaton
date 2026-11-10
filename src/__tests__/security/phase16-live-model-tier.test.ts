/**
 * Phase 16D — the live-model gate's tiers, end to end through the real CLI script.
 *
 * The unit suite already proves the gate's ordering. What it could not prove was the script
 * that operators run, and the script had a defect 16D found: it validated HOME in `runtime`
 * mode (which requires the live install's home) and then asserted the check
 * `home.isolated_test_tree`, which requires the opposite. That check could never pass, so the
 * script could never report READY — a gate that refuses forever is not a gate, it is a dead end,
 * and it hides whether the rest of the preparation is actually correct.
 *
 * These tests run `scripts/phase16-live-model-preflight.ts` as a child process and assert:
 *   - the live runtime tree still refuses (the original behaviour is unchanged);
 *   - `--test-home` pointed at the runtime home is refused by the guard, not accepted;
 *   - a properly built isolated home passes **all 18** safety checks and lands on
 *     PENDING_CREDENTIAL_APPROVAL — so the credential really is the only remaining blocker;
 *   - a loosened isolated home still refuses even when a credential and the human approval
 *     token are both present, i.e. safety outranks approval at the CLI level too.
 *
 * No credential is used anywhere except as an obviously fake string in a child environment that
 * never calls a model. No config file in the live install is read as anything but read-only.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "phase16-live-model-preflight.ts");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUNTIME_HOME = path.join(REPO_ROOT, "runtime", "home");
const EXIT: Record<string, number> = { READY: 0, PENDING_CREDENTIAL_APPROVAL: 1 };

const FAKE_KEY = "sk-FAKE-never-used-0000000000000000";

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "conway-16d-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** An isolated 16D home: every gate term satisfied except the credential. */
function safeTestHomeConfig(): Record<string, unknown> {
  return {
    name: "automaton-model-test",
    sandboxId: "",
    conwayApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    walletAddress: "",
    maxChildren: 0,
    dbPath: "~/.automaton/state.db",
    treasuryPolicy: {
      maxSingleTransferCents: 0,
      maxHourlyTransferCents: 0,
      maxDailyTransferCents: 0,
      maxMonthlyTransferCents: 0,
      minimumReserveCents: 0,
      maxX402PaymentCents: 0,
      x402AllowedDomains: [],
      transferCooldownMs: 0,
      maxTransfersPerTurn: 0,
      maxInferenceDailyCents: 0,
      requireConfirmationAboveCents: 0,
      agentBudgetCents: 0,
      childBudgetCents: 0,
    },
    security: {
      lockdown: true,
      activationApproved: false,
      allowedTools: [],
      selfHealingEnabled: false,
      allowFinancialTools: false,
      allowHostShell: false,
      allowSelfModification: false,
      allowReplication: false,
      allowExternalExposure: false,
      sandboxEnabled: true,
    },
  };
}

function createTestHome(name: string, config: Record<string, unknown>): string {
  const home = path.join(workDir, name);
  fs.mkdirSync(path.join(home, ".automaton"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".automaton", "automaton.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
  return home;
}

interface Run {
  status: number;
  out: string;
}

/**
 * `execFileSync` throws on a non-zero exit, which is the expected outcome for every refusal
 * tier here, so the status code is recovered from the error rather than treated as a failure.
 */
function runPreflight(args: string[], env: Record<string, string> = {}): Run {
  try {
    const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, ...args], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: RUNTIME_HOME, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 2, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function passLines(out: string): string[] {
  return out.split(/\r?\n/).filter((line) => line.startsWith("PASS  "));
}

function failLines(out: string): string[] {
  return out.split(/\r?\n/).filter((line) => line.startsWith("FAIL  "));
}

describe("live-model pre-flight — the live runtime tree", () => {
  it("still refuses, and still reports the runtime tier", () => {
    const run = runPreflight([]);
    expect(run.status, run.out).toBe(2);
    expect(run.out).toContain("tier=runtime");
    expect(run.out).toContain("verdict=SAFETY_GATE_FAILED");
    expect(failLines(run.out).some((l) => l.includes("home.isolated_test_tree"))).toBe(true);
  });

  it("refuses when --test-home is pointed at the runtime home itself", () => {
    const run = runPreflight(["--test-home", RUNTIME_HOME]);
    expect(run.status, run.out).toBe(2);
    expect(run.out).toContain("HOME_NOT_ISOLATED");
    // The guard refuses before any check runs, so there is no verdict table to read.
    expect(run.out).not.toContain("verdict=");
  });

  it("refuses a --test-home that does not exist", () => {
    const run = runPreflight(["--test-home", path.join(workDir, "absent-home")]);
    expect(run.status, run.out).toBe(2);
    expect(run.out).toContain("HOME_NOT_A_DIRECTORY");
  });
});

describe("live-model pre-flight — the isolated 16D tier", () => {
  it("passes every safety check and stops at the credential", () => {
    const home = createTestHome("safe", safeTestHomeConfig());
    const run = runPreflight(["--test-home", home]);
    expect(run.out, run.out).toContain("tier=isolated-test-home");
    expect(failLines(run.out), run.out).toEqual([]);
    expect(passLines(run.out)).toHaveLength(18);
    expect(run.out).toContain("credentialPresent=false approvalPresent=false");
    expect(run.status).toBe(EXIT.PENDING_CREDENTIAL_APPROVAL);
    expect(run.out).toContain("verdict=PENDING_CREDENTIAL_APPROVAL");
  });

  it("reaches READY only with a credential and the human approval token", () => {
    const home = createTestHome("ready", safeTestHomeConfig());
    const run = runPreflight(["--test-home", home], {
      OPENAI_API_KEY: FAKE_KEY,
      CONWAY_LIVE_MODEL_APPROVED: "APPROVED",
    });
    expect(run.status, run.out).toBe(EXIT.READY);
    expect(run.out).toContain("verdict=READY");
    expect(run.out).toContain("credentialPresent=true approvalPresent=true");
  });

  it("a held credential and approval token do not outrank a safety failure", () => {
    const loosened = safeTestHomeConfig();
    const security = loosened.security as Record<string, unknown>;
    security.activationApproved = true;
    security.allowedTools = ["shell_execution"];
    security.allowHostShell = true;
    const treasury = loosened.treasuryPolicy as Record<string, unknown>;
    treasury.maxSingleTransferCents = 500;
    treasury.agentBudgetCents = 5000;
    const home = createTestHome("loosened", loosened);

    const run = runPreflight(["--test-home", home], {
      OPENAI_API_KEY: FAKE_KEY,
      CONWAY_LIVE_MODEL_APPROVED: "APPROVED",
    });
    expect(run.status, run.out).toBe(2);
    expect(run.out).toContain("verdict=SAFETY_GATE_FAILED");
    const failed = failLines(run.out).map((l) => l.split(/\s+/)[1]);
    expect(failed).toContain("agent.activation_closed");
    expect(failed).toContain("tools.allowlist_empty");
    expect(failed).toContain("shell.disabled");
    expect(failed).toContain("treasury.all_zero");
    // Non-vacuity: the credential and approval really were present in this run, so the refusal
    // below is the safety layer winning, not the gate never having seen a credential.
    expect(run.out).toContain("credentialPresent=true approvalPresent=true");
  });

  it("never writes into the test home beyond the config it was given", () => {
    const home = createTestHome("untouched", safeTestHomeConfig());
    const before = fs.readdirSync(path.join(home, ".automaton")).sort();
    runPreflight(["--test-home", home], { OPENAI_API_KEY: FAKE_KEY });
    const after = fs.readdirSync(path.join(home, ".automaton")).sort();
    expect(after).toEqual(before);
    expect(after).toEqual(["automaton.json"]);
  });

  it("does not create a database anywhere in the test home", () => {
    // §3 forbids a second state tree with real state in it. The 16D fixture is config-only.
    const home = createTestHome("nodb", safeTestHomeConfig());
    runPreflight(["--test-home", home]);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
      });
    expect(walk(home).filter((f) => /\.(db|db-wal|db-shm)$/.test(f))).toEqual([]);
  });
});
