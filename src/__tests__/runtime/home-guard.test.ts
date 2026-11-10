/**
 * Phase 16 — HOME isolation guard (Section 3 of the mandate, closes R-10).
 *
 * The guard exists because Phase 15 published two verdicts that were computed against a
 * path which does not exist on this install: `os.homedir()` follows USERPROFILE while
 * Conway resolves `~` through `process.env.HOME`. A guard whose failure is indistinguishable
 * from its success is the defect, so every test below asserts the failure branch too.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HomeGuardError,
  candidateStateDirs,
  canonicalHome,
  conwayRoot,
  inspectConwayHome,
  joinTilde,
  normalizeHome,
  resolveHome,
  stateDir,
} from "../../runtime/home-guard.js";
import { resolvePath } from "../../config.js";

const isWin = process.platform === "win32";
let scratch: string[] = [];
const savedHome = process.env.HOME;

function tempHome(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

describe("canonical runtime home", () => {
  it("is derived from the module location, not from an environment variable", () => {
    const root = conwayRoot();
    expect(root).toBe(path.resolve(root));
    expect(canonicalHome()).toBe(path.join(root, "runtime", "home"));
  });

  it("exists on this install, so the guard is not pointing at a fiction", () => {
    expect(fs.existsSync(canonicalHome())).toBe(true);
    expect(fs.statSync(canonicalHome()).isDirectory()).toBe(true);
  });
});

describe("normalizeHome", () => {
  it("converts the Git Bash drive form so a comparison can actually match", () => {
    // Without this, HOME=/c/foo normalises to C:\c\foo and every equality test against
    // C:\foo silently disagrees — a vacuous guard of exactly the Phase 15K kind.
    expect(normalizeHome("/c/Users/name", "win32")).toBe("C:\\Users\\name");
    expect(normalizeHome("/c/", "win32")).toBe("C:\\");
  });

  it("strips trailing separators and leaves a drive root alone", () => {
    expect(normalizeHome("C:\\Users\\name\\\\", "win32")).toBe("C:\\Users\\name");
    expect(normalizeHome("/var/lib/app/", "linux")).toBe("/var/lib/app");
    expect(normalizeHome("/", "linux")).toBe("/");
  });
});

describe("resolveHome — the always-on tier", () => {
  it("returns the normalised HOME when one is supplied", () => {
    // Normalisation follows the host platform, which is the point: on Windows a POSIX-style
    // HOME means <SystemDrive>\srv\conway\home, not a path that no API can open.
    expect(resolveHome({ HOME: "/srv/conway/home" })).toBe(
      isWin ? "C:\\srv\\conway\\home" : "/srv/conway/home",
    );
  });

  it("throws instead of inventing /root when HOME is unset", () => {
    expect(() => resolveHome({})).toThrow(HomeGuardError);
    try {
      resolveHome({});
      throw new Error("resolveHome should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HomeGuardError);
      expect((err as HomeGuardError).reasonCode).toBe("HOME_UNSET");
      // The message must name the location it refused to use, or the operator cannot fix it.
      expect((err as HomeGuardError).message).toMatch(/root/);
      expect((err as HomeGuardError).message).toMatch(/HOME/);
    }
  });

  it("treats a whitespace HOME as unset", () => {
    expect(() => resolveHome({ HOME: "   " })).toThrow(/HOME is unset/);
  });
});

describe("resolvePath — the production tilde resolver", () => {
  it("resolves ~ under HOME for every consumer of dbPath", () => {
    const home = tempHome("conway-16-home-");
    process.env.HOME = home;
    const resolved = resolvePath("~/.automaton/state.db");
    expect(resolved.startsWith(path.resolve(home))).toBe(true);
    expect(resolved).toBe(path.join(home, ".automaton", "state.db"));
  });

  it("refuses to fall back, and creates no state directory anywhere when HOME is unset", () => {
    // Non-vacuity: the old code returned C:\root\.automaton\state.db and mkdir -p would
    // happily have built it. The assertion is both the throw and the absence.
    delete process.env.HOME;
    const forbidden = [
      path.join(isWin ? process.env.SystemDrive || "C:" : "", "root", ".automaton"),
      path.join(os.homedir(), ".automaton"),
    ];
    const before = forbidden.map((p) => fs.existsSync(p));
    expect(() => resolvePath("~/.automaton/state.db")).toThrow(HomeGuardError);
    expect(forbidden.map((p) => fs.existsSync(p))).toEqual(before);
  });
});

describe("inspectConwayHome — the entry-point tier", () => {
  it("accepts the canonical runtime home in runtime mode", () => {
    process.env.HOME = canonicalHome();
    const result = inspectConwayHome({ mode: "runtime" });
    expect(result.ok).toBe(true);
    expect(result.expected).toBe(canonicalHome());
    expect(result.stateDir).toBe(path.join(canonicalHome(), ".automaton"));
  });

  it("accepts the canonical home whatever the separator or case used to spell it", () => {
    if (!isWin) return;
    for (const variant of [`${canonicalHome()}\\`, canonicalHome().toUpperCase()]) {
      process.env.HOME = variant;
      expect(inspectConwayHome({ mode: "runtime" }).ok).toBe(true);
    }
  });

  it("rejects the real user profile, which is where a missing HOME leaks to", () => {
    process.env.HOME = os.homedir();
    const result = inspectConwayHome({ mode: "runtime" });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("HOME_IS_USER_PROFILE");
  });

  it("rejects a filesystem root before it can host .automaton", () => {
    process.env.HOME = isWin ? "C:\\" : "/";
    const result = inspectConwayHome({ mode: "runtime" });
    expect(result.reasonCode).toBe("HOME_IS_FILESYSTEM_ROOT");
  });

  it("rejects a HOME that does not exist rather than creating one", () => {
    process.env.HOME = path.join(tempHome("conway-16-missing-"), "not-created");
    const result = inspectConwayHome({ mode: "runtime" });
    expect(result.reasonCode).toBe("HOME_NOT_A_DIRECTORY");
    expect(fs.existsSync(process.env.HOME)).toBe(false);
  });

  it("distinguishes a wrong-but-real home from the canonical one", () => {
    process.env.HOME = tempHome("conway-16-other-");
    const runtime = inspectConwayHome({ mode: "runtime" });
    expect(runtime.reasonCode).toBe("HOME_NOT_RUNTIME");
    const isolated = inspectConwayHome({ mode: "isolated" });
    expect(isolated.ok).toBe(true);
  });

  it("does not let isolated mode quietly mean the runtime home or the profile", () => {
    process.env.HOME = canonicalHome();
    expect(inspectConwayHome({ mode: "isolated" }).reasonCode).toBe("HOME_NOT_ISOLATED");
    process.env.HOME = os.homedir();
    expect(inspectConwayHome({ mode: "isolated" }).reasonCode).toBe("HOME_IS_USER_PROFILE");
  });
});

describe("candidateStateDirs — the read path must not fail open", () => {
  it("always includes the canonical tree, even with HOME unset", () => {
    // The emergency-stop bug this enables: HOME unset meant the marker was looked for in
    // one wrong place and reported absent, i.e. the stop read as cleared.
    const dirs = candidateStateDirs({});
    expect(dirs.length).toBeGreaterThanOrEqual(1);
    expect(dirs).toContain(path.join(canonicalHome(), ".automaton"));
  });

  it("is never empty, which would make any union scan vacuous", () => {
    expect(candidateStateDirs({ HOME: tempHome("conway-16-cand-") }).length).toBeGreaterThan(0);
    expect(new Set(candidateStateDirs({})).size).toBe(candidateStateDirs({}).length);
  });
});

describe("stateDir — read-only fallback that names a real tree", () => {
  it("prefers HOME, and falls back to the canonical runtime home rather than the profile", () => {
    expect(stateDir({ HOME: "/srv/x" })).toBe(path.join(resolveHome({ HOME: "/srv/x" }), ".automaton"));
    expect(stateDir({})).toBe(path.join(canonicalHome(), ".automaton"));
    expect(stateDir({})).not.toBe(path.join(os.homedir(), ".automaton"));
  });
});
