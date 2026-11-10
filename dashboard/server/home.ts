import {
  assertConwayHome,
  canonicalHome,
  type HomeGuardResult,
} from "../../src/runtime/home-guard.js";
import { CANONICAL_HOME } from "./paths.js";

/**
 * Mandate §3: HOME is pinned before any Conway read, and re-asserted before every
 * operation. Pinning happens here, at import time, so no module can observe a process
 * whose HOME still points at the Windows user profile.
 */
process.env.HOME = CANONICAL_HOME;

let lastResult: HomeGuardResult | null = null;

export function homeGuardError(message: string): Error {
  return new Error(
    `${message}\n${[
      "The dashboard refuses to read Conway state from any other location.",
      `Expected HOME = ${canonicalHome()}`,
      "Start the dashboard with START_CONWAY_DASHBOARD.bat, which pins HOME for you.",
    ].join("\n")}`,
  );
}

/** Re-derive the guard from the live environment. Never caches a passing result. */
export function assertHome(): HomeGuardResult {
  lastResult = assertConwayHome({ mode: "runtime" });
  return lastResult;
}

export function lastHomeGuard(): HomeGuardResult | null {
  return lastResult;
}

/** Startup tier: throws instead of returning, so `main()` can refuse to serve. */
export function lockHomeOrThrow(): HomeGuardResult {
  try {
    return assertHome();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw homeGuardError(`HOME guard failed: ${reason}`);
  }
}
