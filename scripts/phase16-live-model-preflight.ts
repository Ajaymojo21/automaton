/**
 * Phase 16A.2 / 16D — evaluate the live-model pre-flight against the config this process
 * actually resolves, and print the verdict.
 *
 * Read-only: it loads the config, checks the environment and reports. It never calls a
 * model, never writes a credential, never sets an approval flag, and never changes config.
 *
 *   HOME="<repo-root>/runtime/home" \
 *     ./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
 *     scripts/phase16-live-model-preflight.ts
 *
 *   # 16D isolated tier — run the gate against a dedicated test home instead of the live
 *   # state tree. The directory must already exist; the guard refuses a fallback location.
 *     … scripts/phase16-live-model-preflight.ts --test-home runtime/model-test-home
 *
 * Exit codes: 0 READY, 1 PENDING_CREDENTIAL_APPROVAL, 2 SAFETY_GATE_FAILED.
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { canonicalHome, inspectConwayHome, stateDir } from "../src/runtime/home-guard.js";
import { readEmergencyStop } from "../src/security/emergency-stop.js";
import {
  APPROVAL_ENV_VAR,
  runLiveModelPreflight,
  summarizePreflight,
} from "../src/security/live-model-preflight.js";

const EXIT: Record<string, number> = {
  READY: 0,
  PENDING_CREDENTIAL_APPROVAL: 1,
  SAFETY_GATE_FAILED: 2,
};

/**
 * `--test-home` selects the 16D isolated tier. Without it the script keeps its original
 * behaviour: validate HOME in runtime mode, which is exactly the configuration that must
 * refuse, because the live install's own state tree is never a safe place to run a model.
 *
 * The HOME assignment below is a process-local mutation of this CLI process only. It is what
 * makes every downstream resolver — `stateDir()`, `loadConfig()`, `readEmergencyStop()` —
 * read the test tree instead of the live one, and it changes nothing on disk.
 */
const testHomeArgIndex = process.argv.indexOf("--test-home");
const requestedTestHome =
  testHomeArgIndex > -1 && process.argv[testHomeArgIndex + 1]
    ? path.resolve(process.argv[testHomeArgIndex + 1])
    : undefined;

function main(): number {
  if (requestedTestHome) process.env.HOME = requestedTestHome;

  const guard = requestedTestHome
    ? inspectConwayHome({ mode: "isolated" })
    : inspectConwayHome();
  if (!guard.ok) {
    console.error(`HOME guard refused: ${guard.reasonCode} — ${guard.message}`);
    return EXIT.SAFETY_GATE_FAILED;
  }

  const config = loadConfig();
  if (!config) {
    console.error(`No config found under ${stateDir()}. Nothing to evaluate.`);
    return EXIT.SAFETY_GATE_FAILED;
  }

  const liveHome = path.resolve(canonicalHome());
  const resolvedHome = path.resolve(process.env.HOME ?? "");
  const walletMaterialPresent =
    fs.existsSync(path.join(stateDir(), "wallet.json")) ||
    fs.existsSync(path.join(stateDir(), "keystore.json"));

  const result = runLiveModelPreflight({
    config,
    env: process.env,
    walletMaterialPresent,
    homeGuardOk: true,
    // The live install's own home is the state tree the tests must not touch. A live-model
    // test needs its own home, so this is false unless --test-home supplied one.
    homeIsIsolatedTestHome: requestedTestHome !== undefined && resolvedHome !== liveHome,
    emergencyStopEngaged: readEmergencyStop().engaged,
  });

  console.log(`Conway live-model pre-flight — ${new Date().toISOString()}`);
  console.log(
    `home=${resolvedHome} isolated=${String(resolvedHome !== liveHome)}` +
      ` tier=${requestedTestHome ? "isolated-test-home" : "runtime"}`,
  );
  console.log(summarizePreflight(result));
  console.log(
    `\nVerdict: ${result.verdict}. ` +
      (result.verdict === "READY"
        ? "A live model call is permitted for this environment."
        : result.verdict === "PENDING_CREDENTIAL_APPROVAL"
          ? `No credential in the environment, or ${APPROVAL_ENV_VAR}=${"APPROVED"} not set by a human. Nothing was activated.`
          : `Safety gate failed: ${result.failedCheckIds.join(", ")}. Fix the configuration; this script changes nothing.`),
  );
  return EXIT[result.verdict] ?? EXIT.SAFETY_GATE_FAILED;
}

process.exitCode = main();
