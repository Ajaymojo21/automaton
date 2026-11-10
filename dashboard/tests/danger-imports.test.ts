import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../server/paths.js";

/** sources.ts carries a header comment promising that none of Conway's write-side functions is
 *  imported by the dashboard. This test is the receipt for that promise: the comment is only a
 *  claim until something checks it, and a future edit can silently break it. */

const DASHBOARD_SERVER = path.join(REPO_ROOT, "dashboard", "server");

const FORBIDDEN_NAMES = [
  "createDatabase",
  "getWallet",
  "generateSolanaKeypair",
  "writeEncryptedWalletFile",
  "migratePlaintextWallet",
  "loadWalletAccount",
  "engageEmergencyStop",
  "clearEmergencyStop",
  "saveConfig",
  "createConfig",
  "syncHeartbeatToDb",
  "runMechanic",
] as const;

const FORBIDDEN_SPECIFIERS = ["../../src/index.js", "../src/index.js", "./index.js"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Import statements only. The denied names legitimately appear in prose comments, and a
 *  substring search over the whole file would flag documentation as a violation. */
const IMPORT_RE = /\bimport\s+(?:type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;

function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1] ?? "";
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces?.[1]) {
      for (const part of braces[1].split(",")) {
        const token = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (token) names.push(token);
      }
    }
    const defaultLike = clause.replace(/\{[\s\S]*?\}/, "").replace(/^\s*,/, "").trim();
    if (defaultLike && !defaultLike.startsWith("*")) names.push(defaultLike);
  }
  return names;
}

function specifiers(source: string): string[] {
  return Array.from(source.matchAll(IMPORT_RE), (match) => match[2] ?? "");
}

function violationsFor(source: string): string[] {
  const found: string[] = [];
  for (const name of FORBIDDEN_NAMES) {
    if (importedNames(source).includes(name)) found.push(`named import: ${name}`);
  }
  for (const specifier of specifiers(source)) {
    if (FORBIDDEN_SPECIFIERS.includes(specifier)) found.push(`module specifier: ${specifier}`);
  }
  return found;
}

describe("the dashboard imports readers only", () => {
  it("scans a non-trivial number of server files", () => {
    const files = tsFiles(DASHBOARD_SERVER);
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it("finds no write-side Conway import in any dashboard server file", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(DASHBOARD_SERVER)) {
      const violations = violationsFor(fs.readFileSync(file, "utf-8"));
      if (violations.length > 0) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${violations.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("flags a denied import when one is actually present (positive control)", () => {
    const attack = `import { createDatabase } from "../../src/state/database.js";\n`;
    expect(violationsFor(attack)).toContain("named import: createDatabase");
  });

  it("does not confuse a permitted reader with a denied write", () => {
    expect(violationsFor(`import { getWalletPath, walletExists } from "../../src/identity/wallet.js";`)).toEqual([]);
    expect(violationsFor(`import { getWallet } from "../../src/identity/wallet.js";`)).toContain("named import: getWallet");
  });

  it("is not a stale list: every denied symbol still exists in Conway source", () => {
    const sources = [
      path.join(REPO_ROOT, "src", "state", "database.ts"),
      path.join(REPO_ROOT, "src", "identity", "wallet.ts"),
      path.join(REPO_ROOT, "src", "security", "emergency-stop.ts"),
      path.join(REPO_ROOT, "src", "config.ts"),
      path.join(REPO_ROOT, "src", "heartbeat", "config.ts"),
      path.join(REPO_ROOT, "src", "reliability", "mechanic.ts"),
    ];
    const all = sources.map((file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "")).join("\n");
    for (const name of FORBIDDEN_NAMES) {
      expect(all, `${name} is no longer defined in the scanned sources — update the deny list`).toContain(name);
    }
  });
});
