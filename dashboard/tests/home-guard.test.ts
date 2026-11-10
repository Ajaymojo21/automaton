import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { inspectConwayHome, normalizeHome, canonicalHome } from "../../src/runtime/home-guard.js";
import { CANONICAL_HOME, STATE_DIR } from "../server/paths.js";

/** Mandate §3 requires proof that the guard is non-vacuous: it must actually reject the two
 *  places a missing HOME leaks to (the Windows user profile and C:\root.automaton) and accept
 *  the canonical runtime home in both the Git Bash posix form and the Windows form. */

const posixForm = (windowsPath: string): string => {
  const drive = windowsPath.slice(0, 1).toLowerCase();
  const rest = windowsPath.slice(2).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return `/${drive}/${rest}`;
};

describe("HOME guard is non-vacuous", () => {
  it("accepts the canonical runtime home", () => {
    const result = inspectConwayHome({ mode: "runtime", env: { HOME: CANONICAL_HOME } as NodeJS.ProcessEnv });
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe("OK");
    expect(result.expected?.toLowerCase()).toBe(canonicalHome().toLowerCase());
  });

  it("accepts the Git Bash posix spelling of the same directory", () => {
    const result = inspectConwayHome({
      mode: "runtime",
      env: { HOME: posixForm(CANONICAL_HOME) } as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(true);
    expect(normalizeHome(posixForm(CANONICAL_HOME))).toBe(normalizeHome(CANONICAL_HOME));
  });

  it("rejects an unset HOME instead of inventing one", () => {
    const result = inspectConwayHome({ mode: "runtime", env: {} as NodeJS.ProcessEnv });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_UNSET");
  });

  it("rejects the real Windows user profile", () => {
    const result = inspectConwayHome({
      mode: "runtime",
      env: { HOME: os.homedir() } as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_IS_USER_PROFILE");
  });

  it("rejects the historic /root fallback before a state tree is created", () => {
    const fakeRoot = path.win32.resolve("C:\\root");
    const result = inspectConwayHome({ mode: "runtime", env: { HOME: fakeRoot } as NodeJS.ProcessEnv });
    expect(result.ok).toBe(false);
    expect(["HOME_NOT_RUNTIME", "HOME_NOT_A_DIRECTORY"]).toContain(result.reasonCode);
  });

  it("rejects a bare filesystem root", () => {
    const result = inspectConwayHome({ mode: "runtime", env: { HOME: "C:\\" } as NodeJS.ProcessEnv });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_IS_FILESYSTEM_ROOT");
  });

  it("rejects a non-existent directory", () => {
    const result = inspectConwayHome({
      mode: "runtime",
      env: { HOME: path.join(CANONICAL_HOME, "does-not-exist-anywhere") } as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_NOT_A_DIRECTORY");
  });

  it("rejects a different existing directory (a second Conway install)", () => {
    const result = inspectConwayHome({
      mode: "runtime",
      env: { HOME: path.resolve(CANONICAL_HOME, "..") } as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_NOT_RUNTIME");
  });
});

describe("dashboard path derivation", () => {
  it("pins the state directory under the runtime home, never the user profile", () => {
    expect(STATE_DIR.toLowerCase()).toBe(path.join(CANONICAL_HOME, ".automaton").toLowerCase());
    expect(STATE_DIR.toLowerCase()).not.toContain(os.homedir().toLowerCase());
    expect(CANONICAL_HOME.toLowerCase()).toContain(path.join("runtime", "home").toLowerCase());
  });

  it("locks process.env.HOME at import time", async () => {
    // Importing the module is what pins HOME; the assertion is about the side effect.
    await import("../server/home.js");
    expect(normalizeHome(process.env.HOME ?? "")).toBe(normalizeHome(CANONICAL_HOME));
  });

  it("surfaces a remediation message when the guard fails", async () => {
    const { homeGuardError } = await import("../server/home.js");
    const message = homeGuardError("HOME is the real user profile").message;
    expect(message).toContain("refuses to read Conway state from any other location");
    expect(message).toContain(canonicalHome());
  });
});
