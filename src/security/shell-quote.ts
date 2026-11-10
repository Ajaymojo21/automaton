/**
 * Host-aware shell argument quoting (Phase 16A, R-18).
 *
 * The project's previous helper wrapped every argument in POSIX single quotes:
 * `'…'` with `'\''` for embedded quotes. That is correct for `/bin/sh` and is what the
 * Conway sandbox uses. It is **inert on Windows**, where Node's `execSync` hands the
 * command line to `cmd.exe`, which does not treat `'` as a quote character at all.
 *
 * Measured on this host (2026-11-01, `reports/PHASE_16_WINQUOTING_PROBE.cjs`, pinned
 * Node 22.23.4): `cat '<path>&echo INJECTED_AMP'` exited 0 and printed `INJECTED_AMP'`.
 * The same held for `|`. So the quoting gave no protection for the characters that
 * actually chain commands under `cmd.exe`.
 *
 * cmd.exe cannot be safely escaped — its parsing rules (two parse passes, `^` escaping,
 * delayed expansion) are not reliably escapable for arbitrary strings. The correct
 * response for a model-influenced value is to refuse it, not to quote it. That is what
 * this module does on Windows, and what it does *not* do is pretend a single quote is
 * protection.
 */

export type QuotedArg = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Characters `cmd.exe` consumes at parse time: `&` and `|` chain and pipe commands,
 * `<`/`>` redirect, `^` escapes the next character, `"` terminates its own quoted
 * region, `%`/`!` expand variables, and a newline ends the line — which starts a new
 * command. POSIX-safe characters that are inert in `cmd.exe` (`'`, `$`, backtick,
 * parentheses, `;`) are deliberately *not* in this set: refusing them would break
 * legitimate paths without refusing anything dangerous.
 */
const CMD_UNSAFE_CHARACTERS: readonly string[] = [
  "\0",
  "&",
  "|",
  "<",
  ">",
  "^",
  '"',
  "%",
  "!",
  "\n",
  "\r",
];

/** Quote one argument for POSIX `/bin/sh` (the Conway sandbox shell). */
export function quoteForPosix(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function describeCharacter(character: string): string {
  if (character === "\n") return "newline";
  if (character === "\r") return "carriage return";
  if (character === "\0") return "NUL";
  return JSON.stringify(character);
}

/**
 * Quote an argument for the shell that will actually parse it.
 *
 * `platform` is a parameter, not read from `process.platform` at the call site, so the
 * Windows branch is testable on any host and the POSIX branch is testable on Windows.
 */
export function quoteShellArg(
  arg: string,
  platform: NodeJS.Platform = process.platform,
): QuotedArg {
  if (platform !== "win32") {
    return { ok: true, value: quoteForPosix(arg) };
  }

  const offending = CMD_UNSAFE_CHARACTERS.find((character) => arg.includes(character));
  if (offending !== undefined) {
    return {
      ok: false,
      reason:
        `refused: the argument contains ${describeCharacter(offending)}, which cmd.exe ` +
        `treats as a command separator or escape. Windows cannot safely quote a ` +
        `model-supplied argument, so it is refused rather than passed.`,
    };
  }

  // No parse-time metacharacter remains. Quote for readability and to preserve spaces;
  // cmd.exe will pass the literal text including the quotes, which the receiving tool
  // tolerates for paths but nothing else.
  return { ok: true, value: quoteForPosix(arg) };
}
