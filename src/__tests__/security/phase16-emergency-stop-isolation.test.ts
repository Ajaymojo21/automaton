/**
 * Phase 16A / Section 3 — emergency stop must follow the verified HOME.
 *
 * Two defects are pinned here:
 *  1. Engagement wrote to the canonical install directory even when HOME pointed at a
 *     sandbox, so a unit test put a real stop marker in the live state tree.
 *  2. The fail-open original read exactly one path; these tests also prove the union
 *     read still detects a marker written by a process that had a different HOME.
 *
 * Nothing in this file writes to the live install or to the real user profile.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearEmergencyStop,
  engageEmergencyStop,
  EMERGENCY_STOP_FILENAME,
  getEmergencyStopPath,
  getEmergencyStopPaths,
  isEmergencyStopEngaged,
  readEmergencyStop,
} from "../../security/emergency-stop.js";
import { candidateStateDirs, canonicalHome, stateDir } from "../../runtime/home-guard.js";

const HOME = process.env.HOME;
const USERPROFILE = process.env.USERPROFILE;
const realHomedir = os.homedir();

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const canonicalMarker = path.join(canonicalHome(), ".automaton", EMERGENCY_STOP_FILENAME);

afterEach(() => {
  if (HOME === undefined) delete process.env.HOME;
  else process.env.HOME = HOME;
  if (USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = USERPROFILE;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("emergency stop targets the process state dir", () => {
  it("uses HOME as the write target, not the canonical install", () => {
    const sandbox = tempDir("p16-stop-home-");
    process.env.HOME = sandbox;

    expect(getEmergencyStopPath()).toBe(path.join(sandbox, ".automaton", EMERGENCY_STOP_FILENAME));
    expect(getEmergencyStopPath()).toBe(path.join(stateDir(), EMERGENCY_STOP_FILENAME));
  });

  it("engages inside the sandbox and leaves the live install untouched", () => {
    const sandbox = tempDir("p16-stop-home-");
    process.env.HOME = sandbox;
    const existedBefore = fs.existsSync(canonicalMarker);

    engageEmergencyStop({ reason: "synthetic drill", requestedBy: "tester" });

    expect(fs.existsSync(path.join(sandbox, ".automaton", EMERGENCY_STOP_FILENAME))).toBe(true);
    expect(fs.existsSync(canonicalMarker)).toBe(existedBefore);
    expect(fs.existsSync(canonicalMarker)).toBe(false);
  });

  it("clears what it engaged", () => {
    const sandbox = tempDir("p16-stop-home-");
    process.env.HOME = sandbox;
    engageEmergencyStop({ reason: "synthetic drill", requestedBy: "tester" });

    const cleared = clearEmergencyStop({
      confirmedBy: "human-operator",
      reason: "drill complete",
    });

    expect(cleared.cleared).toBe(true);
    expect(isEmergencyStopEngaged()).toBe(false);
  });
});

describe("emergency stop fails closed across a HOME disagreement", () => {
  it("detects a marker left by a process with a different HOME and clears every copy", () => {
    const writtenBy = tempDir("p16-stop-writer-");
    const readBy = tempDir("p16-stop-reader-");
    // The writer's HOME becomes the reader's "profile" candidate: two locations the
    // union read is supposed to cover, both outside the live install.
    process.env.HOME = writtenBy;
    engageEmergencyStop({ reason: "engagement by the other launcher", requestedBy: "tester" });

    process.env.HOME = readBy;
    process.env.USERPROFILE = writtenBy;
    // Hard assertion, not a skip: if the profile candidate were absent the disagreement
    // would go untested while this file still reported green.
    expect(candidateStateDirs()).toContain(path.join(writtenBy, ".automaton"));

    expect(isEmergencyStopEngaged()).toBe(true);
    const state = readEmergencyStop();
    expect(state.engaged).toBe(true);
    expect(state.markerPath).toContain(EMERGENCY_STOP_FILENAME);

    const cleared = clearEmergencyStop({
      confirmedBy: "human-operator",
      reason: "drill complete",
    });
    expect(cleared.cleared).toBe(true);
    expect(isEmergencyStopEngaged()).toBe(false);
    expect(fs.existsSync(canonicalMarker)).toBe(false);
  });

  it("reports not engaged only when no scanned location holds a marker", () => {
    const sandbox = tempDir("p16-stop-home-");
    process.env.HOME = sandbox;
    for (const p of getEmergencyStopPaths()) {
      expect(fs.existsSync(p)).toBe(false);
    }
    expect(readEmergencyStop()).toEqual({ engaged: false });
  });

  it("counts an unreadable marker as engaged", () => {
    const sandbox = tempDir("p16-stop-home-");
    process.env.HOME = sandbox;
    const dir = path.join(sandbox, ".automaton");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, EMERGENCY_STOP_FILENAME), "{not json");

    const state = readEmergencyStop();
    expect(state.engaged).toBe(true);
    expect(state.reason).toBe("marker unreadable");
  });
});
