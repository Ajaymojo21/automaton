/**
 * Application-level sandbox (Phase 15E)
 *
 * Provides filesystem confinement, protected-path checks, shell command
 * validation, and environment scrubbing for tools that run on the host.
 *
 * Limitations are deliberate and documented: this is not an OS sandbox. It does
 * not create a job object, restrict syscalls, or change Windows Firewall. It
 * prevents accidental and casual escape from the configured root and blocks
 * known credential/system locations; it is not a defence against a determined
 * attacker with code execution.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AutomatonConfig } from "../types.js";

const isWindows = process.platform === "win32";

/** Windows device names that must never be used as a file target. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Environment variables that must never reach a child process. */
const SENSITIVE_ENV_PATTERN =
  /(KEY|TOKEN|SECRET|PASS|PASSWORD|PASSWD|CREDENTIAL|MNEMONIC|SEED|PRIVATE|AUTH|COOKIE|SESSION)/i;

export interface SandboxContext {
  /** True when commands run on the local host (no Conway sandbox). */
  local: boolean;
  root: string;
}

export function resolveSandboxRoot(
  config: AutomatonConfig,
  sandboxId: string | undefined,
  home: string | undefined = process.env.HOME,
): string {
  if (sandboxId) return "/root";
  const configured = config.security?.sandboxRoot;
  const resolved = configured || home || process.cwd();
  return path.resolve(resolved);
}

export function sandboxContext(
  config: AutomatonConfig,
  sandboxId: string | undefined,
): SandboxContext {
  return { local: !sandboxId, root: resolveSandboxRoot(config, sandboxId) };
}

function protectedPrefixes(): string[] {
  const home = os.homedir();
  const prefixes = [
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Downloads"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    path.join(home, "Music"),
    path.join(home, "OneDrive"),
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(home, ".config"),
    path.join(home, ".qoder"),
    path.join(home, ".cursor"),
    path.join(home, ".claude"),
    path.join(home, ".codex"),
    path.join(home, ".ollama"),
    path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"),
    path.join(home, "AppData", "Roaming", "Microsoft", "Crypto"),
    path.join(home, "AppData", "Local", "Google", "Chrome", "User Data"),
    path.join(home, "AppData", "Local", "Microsoft", "Edge", "User Data"),
    path.join(home, "AppData", "Roaming", "Mozilla", "Firefox"),
    path.join(home, "AppData", "Roaming", "Bitcoin"),
    path.join(home, "AppData", "Roaming", "Ethereum"),
  ];

  const extra = process.env.CONWAY_PROTECTED_PATHS;
  if (extra) {
    prefixes.push(
      ...extra
        .split(path.delimiter)
        .map((p) => p.trim())
        .filter(Boolean),
    );
  }
  return prefixes;
}

function normalizeForCompare(value: string): string {
  const normalized = path.resolve(value);
  return isWindows ? normalized.toLowerCase() : normalized;
}

/**
 * True when the path is inside a known-protected location (user documents,
 * browser profiles, other AI tool configs, SSH/cloud credentials, wallets).
 */
export function isProtectedPath(target: string): boolean {
  const normalized = normalizeForCompare(target);
  if (isWindows) {
    const winDir = (process.env.SystemRoot || "C:\\Windows").toLowerCase();
    if (normalized.startsWith(path.join(winDir, "System32").toLowerCase())) return true;
    if (normalized === winDir) return true;
  } else if (normalized.startsWith("/etc") || normalized.startsWith("/root/.ssh")) {
    return true;
  }

  for (const prefix of protectedPrefixes()) {
    const p = normalizeForCompare(prefix);
    if (normalized === p || normalized.startsWith(p + path.sep)) return true;
  }

  // Wallet/config material of this or any other automaton install.
  const base = path.basename(normalized);
  if (
    base === "wallet.json" ||
    base.startsWith("wallet.json.") ||
    base === "automaton.json" ||
    base === "id_rsa" ||
    base === "id_ed25519"
  ) {
    return true;
  }

  return false;
}

export interface ConfineResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Resolve a user-supplied path against the sandbox root and refuse escapes.
 *
 * Uses path.relative (not string prefixes) so Windows separators, drive-relative
 * paths and `..` segments are handled correctly, and realpath-checks the nearest
 * existing ancestor to defeat symlink/junction traversal.
 */
export function confineToRoot(input: string, root: string): ConfineResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Path must be a non-empty string" };
  }
  if (input.includes("\0")) {
    return { ok: false, error: "Path contains a null byte" };
  }
  if (WINDOWS_RESERVED.test(path.basename(input))) {
    return { ok: false, error: "Path uses a reserved Windows device name" };
  }

  const resolvedRoot = path.resolve(root);
  const expanded = input.startsWith("~")
    ? path.join(resolvedRoot, input.slice(1))
    : path.resolve(resolvedRoot, input);

  let relative: string;
  try {
    relative = path.relative(resolvedRoot, expanded);
  } catch {
    return { ok: false, error: "Path cannot be resolved" };
  }

  if (relative === "") {
    return { ok: true, path: expanded };
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      error: `Path "${input}" resolves outside the sandbox root (${resolvedRoot})`,
    };
  }

  // Realpath the nearest existing ancestor to catch symlink/junction escapes.
  let existing = expanded;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  try {
    const realExisting = fs.realpathSync(existing);
    const realRelative = path.relative(fs.realpathSync(resolvedRoot), realExisting);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return {
        ok: false,
        error: `Path "${input}" escapes the sandbox root through a link`,
      };
    }
  } catch {
    // Root may not exist yet; the lexical check above still holds.
  }

  if (isProtectedPath(expanded)) {
    return { ok: false, error: `Path "${input}" is a protected location` };
  }

  return { ok: true, path: expanded };
}

const FORBIDDEN_COMMAND_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Destructive filesystem operations
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|[a-z]:\\)/i, reason: "recursive delete of a root path" },
  { pattern: /\b(rmdir|rd)\s+\/s\s+\/q\s+[a-z]:\\/i, reason: "recursive delete of a drive" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "drive format" },
  { pattern: /\bdiskpart\b/i, reason: "disk partitioning" },
  { pattern: /\bvssadmin\b/i, reason: "shadow copy manipulation" },
  { pattern: /\bwbadmin\b/i, reason: "backup deletion" },
  { pattern: /\bcipher\s+\/w/i, reason: "free-space wipe" },
  // Windows security and boot configuration
  { pattern: /\bbcdedit\b/i, reason: "boot configuration change" },
  { pattern: /\bnetsh\s+(advfirewall|firewall)\b/i, reason: "firewall change" },
  { pattern: /\bSet-MpPreference\b/i, reason: "Defender change" },
  { pattern: /\b(Add|Remove)-MpPreference\b/i, reason: "Defender change" },
  { pattern: /\breg\s+(add|delete)\s+.*HK(LM|EY_LOCAL_MACHINE)/i, reason: "registry change" },
  { pattern: /\b(sc|net)\s+(create|delete|stop|start)\s+/i, reason: "service manipulation" },
  { pattern: /\bschtasks\s+\/create/i, reason: "scheduled task creation" },
  { pattern: /\bNew-Service\b/i, reason: "service installation" },
  { pattern: /\breg\s+(add|delete)\b.*\\CurrentVersion\\Run\b/i, reason: "startup persistence" },
  { pattern: /\btakeown\b/i, reason: "ownership change" },
  { pattern: /\bicacls\b/i, reason: "ACL change" },
  { pattern: /\bshutdown\b/i, reason: "system shutdown" },
  { pattern: /\brestart-computer\b/i, reason: "system restart" },
  { pattern: /\bstop-computer\b/i, reason: "system shutdown" },
  // Credential and key material access
  { pattern: /(cat|type|more|get-content)\s+.*(\.ssh|\.aws|\.gnupg|\.env|wallet\.json|automaton\.json)/i, reason: "credential file read" },
  { pattern: /(cat|type|more|get-content)\s+.*(appdata|documents|desktop|downloads)/i, reason: "user profile read" },
  { pattern: /\bssh-keygen\b/i, reason: "key generation" },
  { pattern: /\bgpg\s+--(export|gen)/i, reason: "key export" },
  { pattern: /\bmanage-bde\b.*-protectors\b/i, reason: "BitLocker recovery key retrieval" },
  { pattern: /\b(Enable|Disable|Unlock|Protect|Unprotect)-BitLocker\b/i, reason: "BitLocker state change" },
  { pattern: /\bmanage-bde\s+-(on|off|forceoff|pause|resume|clear|autounlock)\b/i, reason: "BitLocker state change" },
  // Download-and-execute payloads
  { pattern: /\b(curl|wget|iwr|invoke-webrequest)\b.*\|\s*(sh|bash|powershell|cmd)/i, reason: "download and execute" },
  { pattern: /\bInvoke-Expression\b|\biex\b/i, reason: "dynamic code execution" },
  { pattern: /\bpowershell(\.exe)?\b.*\s-(e|enc|encodedcommand)\b/i, reason: "encoded command execution" },
  // Service/tunnel exposure
  { pattern: /\bngrok\b|\bcloudflared\b|\blocaltunnel\b/i, reason: "public tunnel" },
  // Automaton self-harm
  { pattern: /rm\s+.*\.automaton/i, reason: "automaton state deletion" },
  { pattern: /rm\s+.*state\.db/i, reason: "database deletion" },
  { pattern: /DROP\s+TABLE/i, reason: "database destruction" },
];

/**
 * Validate a shell command before execution. Returns null when acceptable,
 * otherwise a human-readable denial. This is a deny-list, not a sandbox: the
 * callable tool set and capability grants remain the primary control.
 */
export function validateShellCommand(command: string): string | null {
  if (typeof command !== "string" || command.trim().length === 0) {
    return "Blocked: command is empty";
  }
  for (const { pattern, reason } of FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: command rejected (${reason})`;
    }
  }
  for (const prefix of protectedPrefixes()) {
    if (command.toLowerCase().includes(prefix.toLowerCase())) {
      return "Blocked: command references a protected location";
    }
  }
  return null;
}

export interface ScrubReport {
  env: NodeJS.ProcessEnv;
  removed: string[];
}

/**
 * Build a child environment without secrets. All CONWAY_* variables are removed
 * (they carry activation and passphrase tokens), as are key/token/password-like
 * names.
 */
export function scrubEnvironment(env: NodeJS.ProcessEnv = process.env): ScrubReport {
  const out: NodeJS.ProcessEnv = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("CONWAY_")) {
      removed.push(key);
      continue;
    }
    if (SENSITIVE_ENV_PATTERN.test(key)) {
      removed.push(key);
      continue;
    }
    out[key] = value;
  }
  return { env: out, removed };
}
