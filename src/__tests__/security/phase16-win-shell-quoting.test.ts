/**
 * Phase 16A — R-18: POSIX single-quote escaping is inert under cmd.exe.
 *
 * Red-first evidence for the underlying defect is `reports/PHASE_16_WINQUOTING_PROBE.cjs`,
 * executed on this host: `cat '<path>&echo INJECTED_AMP'` exited 0 with stdout
 * `INJECTED_AMP'`. The tests below pin the refusal that replaces it, and pin that the
 * POSIX branch is unchanged — the Conway sandbox shell is `/bin/sh`, where the quoting is
 * genuinely correct and must not regress.
 *
 * `platform` is injectable, so the Windows branch is exercised here even though this
 * suite runs on Windows and the POSIX branch is exercised here even though it cannot run
 * on this machine's shell.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { quoteShellArg, quoteForPosix, type QuotedArg } from "../../security/shell-quote.js";
import { createBuiltinTools } from "../../agent/tools.js";
import type { ToolContext } from "../../types.js";

const CHAINERS = [
  "nope&echo INJECTED_AMP",
  "nope|echo INJECTED_PIPE",
  'break"out',
  "nope^&echo HIJACK",
  "nope%PATH%suffix",
  "nope!VARSUFFIX!",
  "line1\nline2 echo INJECTED_NEWLINE",
  "line1\rline2",
  "nul\0suffix",
  "nope>outfile",
  "infile<nope",
];

const BENIGN = [
  "C:\\repo\\runtime\\home\\notes.txt",
  "my file.txt",
  "it's a file.txt",
  "$(whoami).txt",
  "foo; cat /etc/passwd",
  "/tmp/a`b`(c).txt",
];

describe("quoteShellArg — Windows branch", () => {
  it("refuses every cmd.exe parse-time metacharacter", () => {
    for (const value of CHAINERS) {
      const result = quoteShellArg(value, "win32");
      expect(result.ok, JSON.stringify(value)).toBe(false);
      if (!result.ok) expect(result.reason).toContain("cmd.exe");
    }
  });

  it("passes benign paths unchanged into the quoting step", () => {
    for (const value of BENIGN) {
      const result = quoteShellArg(value, "win32");
      expect(result.ok, JSON.stringify(value)).toBe(true);
    }
  });

  it("a refusal never produces a command fragment", () => {
    for (const value of CHAINERS) {
      const result = quoteShellArg(value, "win32");
      expect((result as QuotedArg & { value?: string }).value).toBeUndefined();
    }
  });
});

describe("quoteShellArg — POSIX branch must not regress", () => {
  it("keeps exact /bin/sh quoting for every value, including metacharacters", () => {
    for (const value of [...CHAINERS, ...BENIGN]) {
      const result = quoteShellArg(value, "darwin");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(quoteForPosix(value));
    }
  });

  it("escapes embedded single quotes with the '\\'' technique", () => {
    const result = quoteShellArg("it's", "linux");
    expect(result.ok && result.value).toBe("'it'\\''s'");
  });
});

describe("read_file fallback no longer shells out an unsafe path on Windows", () => {
  const originalPlatform = process.platform;
  const tools = createBuiltinTools("phase16-r18-sandbox");
  const readTool = tools.find((t) => t.name === "read_file")!;

  function stubContext(calls: string[]): ToolContext {
    return {
      identity: { name: "t", address: "0x000000000000000000000000000000000000dEaD", sandboxId: "phase16-r18-sandbox" },
      config: { security: { sandboxRoot: "C:\\phase16-r18-root" } },
      conway: {
        // readFile always throwing is what reached the vulnerable fallback.
        readFile: async () => {
          throw new Error("API broken");
        },
        exec: async (command: string) => {
          calls.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      db: {},
    } as unknown as ToolContext;
  }

  function pretendWindows() {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  }
  function pretendPosix() {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("read_file exists", () => {
    expect(readTool).toBeDefined();
  });

  it("refuses to build a cat command from a chaining path while on Windows", async () => {
    pretendWindows();
    for (const value of CHAINERS) {
      const calls: string[] = [];
      const result = await readTool.execute({ path: value }, stubContext(calls));
      expect(String(result), JSON.stringify(value)).toContain("Blocked:");
      expect(calls, JSON.stringify(value)).toEqual([]);
    }
  });

  it("positive control: on POSIX the same fallback still quotes and runs", async () => {
    pretendPosix();
    const calls: string[] = [];
    await readTool.execute({ path: "my file.txt" }, stubContext(calls));
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^cat '.*my file\.txt'$/);
  });

  it("positive control: on Windows a benign path still reaches the fallback", async () => {
    pretendWindows();
    const calls: string[] = [];
    await readTool.execute({ path: "my file.txt" }, stubContext(calls));
    expect(calls.length).toBe(1);
  });

  it("the injection is what the refusal prevents — the unguarded shape really did chain", () => {
    // Documents the exact string the old code produced, so the fix is not mistaken for a
    // cosmetic change. cmd.exe splits on `&` and ignores the quotes.
    const vulnerable = `cat ${quoteForPosix("nope&echo INJECTED_AMP")}`;
    expect(vulnerable).toBe("cat 'nope&echo INJECTED_AMP'");
    expect(quoteShellArg("nope&echo INJECTED_AMP", "win32").ok).toBe(false);
  });
});

describe("call_installed_tool no longer shells out unsafe JSON on Windows", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("quoteShellArg refuses JSON, which always contains a double quote", () => {
    // This is the argument the generic wrapper interpolates. On Windows it can no longer
    // be passed at all, so the wrapper must fail closed rather than build a command.
    const json = JSON.stringify({ path: "a", nested: { b: 1 } });
    expect(json).toContain('"');
    expect(quoteShellArg(json, "win32").ok).toBe(false);
  });

  it("the installed-tool wrapper returns a refusal, not a shell command, on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const { loadInstalledTools } = await import("../../agent/tools.js");
    const calls: string[] = [];
    const entry = {
      id: "1",
      name: "echo-tool",
      type: "custom",
      config: { command: "some-installed-binary" },
      installedAt: new Date().toISOString(),
      enabled: true,
    };
    const loaded = loadInstalledTools({ getInstalledTools: () => [entry] });
    expect(loaded.length).toBe(1);
    const ctx = {
      conway: {
        exec: async (command: string) => {
          calls.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    } as unknown as ToolContext;
    const result = await loaded[0]!.execute({ anything: 1 }, ctx);
    expect(String(result)).toContain("Blocked:");
    expect(calls).toEqual([]);
  });

  it("positive control: on POSIX the same wrapper still builds the quoted command", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const { loadInstalledTools } = await import("../../agent/tools.js");
    const calls: string[] = [];
    const loaded = loadInstalledTools({
      getInstalledTools: () => [
        {
          id: "1",
          name: "echo-tool",
          type: "custom",
          config: { command: "some-installed-binary" },
          installedAt: new Date().toISOString(),
          enabled: true,
        },
      ],
    });
    const ctx = {
      conway: {
        exec: async (command: string) => {
          calls.push(command);
          return { exitCode: 0, stdout: "ok", stderr: "" };
        },
      },
    } as unknown as ToolContext;
    await loaded[0]!.execute({ anything: 1 }, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("some-installed-binary '");
  });
});
