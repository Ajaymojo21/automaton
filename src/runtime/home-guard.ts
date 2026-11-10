/**
 * Centralised HOME resolution.
 *
 * Conway resolves every `~` configuration path (`dbPath`, heartbeat config, skills
 * directory) against `process.env.HOME`, not against the operating system's idea of the
 * user directory. Before this module the fallback was `"/root"`, which on Windows becomes
 * `C:\root\.automaton` — a second, silent state tree that no wrapper, backup or audit
 * looks at. Phase 15 measured the damage: a guard list built from `os.homedir()` signed a
 * file that does not exist and reported a PASS that guaranteed nothing.
 *
 * Two tiers, deliberately different:
 *
 * - `resolveHome()` is the always-on tier. It replaces the `HOME || "/root"` fallback and
 *   refuses to invent a state directory. It is used by every path resolver.
 * - `assertConwayHome()` is the entry-point tier, called by the app, the CLI actions,
 *   migrations and the dashboard before any Conway state is touched. It additionally
 *   rejects the real user profile, which is the other place a missing `HOME` leaks to.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HomeGuardMode = "runtime" | "isolated";

export type HomeGuardReason =
  | "OK"
  | "HOME_UNSET"
  | "HOME_IS_USER_PROFILE"
  | "HOME_IS_FILESYSTEM_ROOT"
  | "HOME_NOT_A_DIRECTORY"
  | "HOME_NOT_RUNTIME"
  | "HOME_NOT_ISOLATED";

export interface HomeGuardResult {
  ok: boolean;
  reasonCode: HomeGuardReason;
  /** The normalised HOME under inspection, when one was supplied. */
  actual: string | null;
  /** The canonical runtime home, in runtime mode. */
  expected: string | null;
  /** Where `.automaton` would be created for `actual`. */
  stateDir: string | null;
  message: string;
}

export class HomeGuardError extends Error {
  readonly reasonCode: HomeGuardReason;
  readonly result: HomeGuardResult;

  constructor(result: HomeGuardResult) {
    super(result.message);
    this.name = "HomeGuardError";
    this.reasonCode = result.reasonCode;
    this.result = result;
  }
}

const IS_WINDOWS = process.platform === "win32";

/**
 * This file sits two levels below the repository root in both layouts that execute it
 * (`src/runtime/` under tsx, `dist/runtime/` after build), so the root is derivable
 * without trusting an environment variable — which is the thing being guarded.
 */
export function conwayRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

/** The only HOME a Conway runtime process is allowed to use by default. */
export function canonicalHome(): string {
  return path.join(conwayRoot(), "runtime", "home");
}

/**
 * Turn whatever a shell handed us into a path this platform can compare.
 *
 * Git Bash sets `HOME=/c/Users/name`, which `path.win32.resolve` would read as
 * `C:\c\Users\name`. Comparing the two forms without converting them makes a guard
 * vacuous — it can only ever disagree — so the conversion happens here, once.
 */
export function normalizeHome(raw: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const posixDrive = /^\/([a-zA-Z])\/(.*)$/.exec(raw);
    const driveRoot = /^\/([a-zA-Z])\/?$/.exec(raw);
    let windows = raw;
    if (posixDrive) windows = `${posixDrive[1].toUpperCase()}:${path.sep}${posixDrive[2].replace(/\//g, path.sep)}`;
    else if (driveRoot) windows = `${driveRoot[1].toUpperCase()}:${path.sep}`;
    else windows = raw.replace(/\//g, path.sep);
    const resolved = path.win32.resolve(windows);
    return trimTrailingSeparators(resolved);
  }
  return trimTrailingSeparators(path.posix.resolve(raw));
}

function trimTrailingSeparators(value: string): string {
  if (value.length <= 3 && /[a-zA-Z]:[\\/]$/.test(value)) return value;
  if (value === "/") return value;
  return value.replace(/[\\/]+$/, "");
}

function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const na = normalizeHome(a, platform);
  const nb = normalizeHome(b, platform);
  return platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function isFilesystemRoot(value: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") return /^[a-zA-Z]:\\$/.test(value);
  return value === "/";
}

export function remediationHint(expected: string = canonicalHome()): string {
  if (IS_WINDOWS) {
    return [
      `Set HOME to the Conway runtime home before running Conway code:`,
      `  cmd:  set "HOME=${expected}"`,
      `  ps:   $env:HOME = '${expected}'`,
      `  bash: HOME='${expected.replace(/\\/g, "/")}' <command>`,
      `Or launch through the .bat wrappers, which set it for you.`,
    ].join("\n");
  }
  return `Set HOME to the Conway runtime home before running Conway code: HOME=${expected} <command>`;
}

/**
 * Always-on tier: the home that `~` means for this process.
 *
 * Throws instead of substituting `/root`. An unset HOME is an operator error with a
 * one-line fix; writing a second state tree is not recoverable by reading logs.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HOME;
  if (!raw || !raw.trim()) {
    const wouldBe = IS_WINDOWS
      ? path.join(process.env.SystemDrive || "C:", "\\root", ".automaton")
      : "/root/.automaton";
    throw new HomeGuardError({
      ok: false,
      reasonCode: "HOME_UNSET",
      actual: null,
      expected: canonicalHome(),
      stateDir: null,
      message: `Refusing to resolve "~": HOME is unset, which would write state to ${wouldBe}. No state directory is created.\n${remediationHint()}`,
    });
  }
  return normalizeHome(raw);
}

/**
 * Always-on tier for the bare path form used by `resolvePath`.
 *
 * The `~` is removed before joining. The first version of this helper only stripped a
 * leading separator, so `~/.automaton/state.db` produced `<home>\~\.automaton\state.db`
 * — a path one directory deep in the wrong place, which no test would have noticed if it
 * had only asserted "starts with home". The original `p.slice(1)` behaviour is what matters.
 */
export function joinTilde(rest: string, env: NodeJS.ProcessEnv = process.env): string {
  const relative = rest.replace(/^~/, "").replace(/^[\\/]+/, "");
  return path.join(resolveHome(env), relative);
}

/**
 * The state directory for read-only paths that must keep reporting something when HOME is
 * missing — health checks, the provider registry, the dashboard.
 *
 * `resolveHome()` throws for exactly that case, which is right for anything that writes
 * state but wrong for a monitor whose job is to describe the install. These fall back to
 * the documented canonical home instead of `C:\root` or the interactive user profile, so
 * what gets reported is at least the tree Conway actually uses.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HOME;
  const home = raw && raw.trim() ? normalizeHome(raw) : canonicalHome();
  return path.join(home, ".automaton");
}

export interface InspectOptions {
  mode?: HomeGuardMode;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Directory that must exist for `isolated` mode to be accepted. Defaults to HOME itself. */
  requireExists?: boolean;
}

function fail(reasonCode: HomeGuardReason, message: string, partial: Partial<HomeGuardResult>): HomeGuardResult {
  return { ok: false, reasonCode, message, actual: null, expected: null, stateDir: null, ...partial };
}

/**
 * Entry-point tier. `runtime` demands the canonical home; `isolated` demands an explicit,
 * existing sandbox directory that is neither the user profile nor a filesystem root.
 */
export function inspectConwayHome(options: InspectOptions = {}): HomeGuardResult {
  const mode = options.mode ?? "runtime";
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const raw = env.HOME;

  if (!raw || !raw.trim()) {
    return fail("HOME_UNSET", `HOME is unset. ${remediationHint()}`, { expected: canonicalHome() });
  }

  const actual = normalizeHome(raw, platform);

  if (isFilesystemRoot(actual, platform)) {
    return fail("HOME_IS_FILESYSTEM_ROOT", `HOME resolves to the filesystem root "${actual}"; refusing to create .automaton there.`, {
      actual,
      expected: canonicalHome(),
    });
  }

  const userProfile = platform === "win32" ? normalizeHome(os.homedir(), platform) : os.homedir();
  if (samePath(actual, userProfile, platform)) {
    return fail(
      "HOME_IS_USER_PROFILE",
      `HOME is the real user profile (${actual}); Conway must not create ${path.join(actual, ".automaton")} there. ${remediationHint()}`,
      { actual, expected: canonicalHome(), stateDir: path.join(actual, ".automaton") },
    );
  }

  const exists = safeIsDirectory(actual);
  if (options.requireExists !== false && !exists) {
    return fail("HOME_NOT_A_DIRECTORY", `HOME does not resolve to an existing directory: ${actual}`, {
      actual,
      expected: mode === "runtime" ? canonicalHome() : null,
      stateDir: path.join(actual, ".automaton"),
    });
  }

  if (mode === "runtime") {
    const expected = canonicalHome();
    if (!samePath(actual, expected, platform)) {
      return fail("HOME_NOT_RUNTIME", `HOME is ${actual}, expected the Conway runtime home ${expected}. ${remediationHint(expected)}`, {
        actual,
        expected,
        stateDir: path.join(actual, ".automaton"),
      });
    }
    return {
      ok: true,
      reasonCode: "OK",
      actual,
      expected,
      stateDir: path.join(actual, ".automaton"),
      message: `HOME verified against the canonical Conway runtime home: ${actual}`,
    };
  }

  // Isolated mode is the test/soak/restore path. The guard's job here is to prove the
  // sandbox is a real, explicitly created directory rather than a fallback, and to say
  // which home it was told about — never to accept the user profile.
  const expected = null;
  const resolved = safeRealpath(actual) ?? actual;
  if (samePath(resolved, canonicalHome(), platform)) {
    return fail("HOME_NOT_ISOLATED", `mode "isolated" requires a sandbox home, not the runtime home ${resolved}.`, {
      actual,
      expected,
      stateDir: path.join(actual, ".automaton"),
    });
  }
  return {
    ok: true,
    reasonCode: "OK",
    actual,
    expected,
    stateDir: path.join(actual, ".automaton"),
    message: `Isolated Conway home verified: ${resolved}`,
  };
}

function safeIsDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function safeRealpath(candidate: string): string | null {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return null;
  }
}

export function assertConwayHome(options: InspectOptions = {}): HomeGuardResult {
  const result = inspectConwayHome(options);
  if (!result.ok) throw new HomeGuardError(result);
  return result;
}

/** Every location the state directory could legitimately be, for read-only reconciliation. */
export function candidateStateDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = new Set<string>([path.join(canonicalHome(), ".automaton")]);
  if (env.HOME && env.HOME.trim()) dirs.add(path.join(normalizeHome(env.HOME), ".automaton"));
  const profileHome = process.platform === "win32" ? normalizeHome(os.homedir()) : os.homedir();
  dirs.add(path.join(profileHome, ".automaton"));
  return Array.from(dirs);
}
