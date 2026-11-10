/**
 * Input Validation Policy Rules
 *
 * Validates tool arguments before execution. Catches malformed
 * input before it reaches any shell command or API call.
 */

import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

/**
 * npm package names are `name` or `@scope/name`, and neither segment may begin with
 * `-` or `.`. The leading-character rule is the security-relevant part: the value is
 * interpolated into `npm install -g <value>`, so a leading `-` makes npm read it as a
 * *switch* rather than a package.
 *
 * Measured against npm 10.9.9 on this host (2026-11-01, since reverted): shell
 * metacharacters, spaces and `=` were already rejected, so value-bearing switches such
 * as `--userconfig=/path` were never reachable. What was reachable is a leading-dash
 * value that npm's parser consumes as switches, leaving no positional package — npm then
 * installs the *current working directory*. `npm install -g -forgery` linked the whole
 * Conway project into the pinned Node runtime. Unknown switches are not rejected either.
 * The consequence is not code execution, but it is enough to install the wrong target.
 */
const PACKAGE_NAME_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
export { PACKAGE_NAME_RE };

export function isValidPackageName(value: string): boolean {
  return PACKAGE_NAME_RE.test(value);
}

const SKILL_NAME_RE = /^[a-zA-Z0-9-]+$/;
const GIT_HASH_RE = /^[a-f0-9]{7,40}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CRON_PARTS_RE = /^(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)$/;

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

/**
 * Validate npm package name format.
 */
function createPackageNameRule(): PolicyRule {
  return {
    id: "validate.package_name",
    description: "Validate npm package name format",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["install_npm_package", "install_mcp_server"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const pkg = request.args.package as string | undefined;
      if (pkg === undefined) return null;

      if (!isValidPackageName(pkg)) {
        return deny(
          "validate.package_name",
          "VALIDATION_FAILED",
          `Invalid package name: "${pkg}". Must match ${PACKAGE_NAME_RE.source}`,
        );
      }
      return null;
    },
  };
}

/**
 * Validate skill name format.
 */
function createSkillNameRule(): PolicyRule {
  return {
    id: "validate.skill_name",
    description: "Validate skill name format (alphanumeric + hyphens only)",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["install_skill", "create_skill", "remove_skill"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const name = request.args.name as string | undefined;
      if (name === undefined) return null;

      if (!SKILL_NAME_RE.test(name)) {
        return deny(
          "validate.skill_name",
          "VALIDATION_FAILED",
          `Invalid skill name: "${name}". Must match ${SKILL_NAME_RE.source}`,
        );
      }
      return null;
    },
  };
}

/**
 * Validate git commit hash format.
 */
function createGitHashRule(): PolicyRule {
  return {
    id: "validate.git_hash",
    description: "Validate git commit hash format",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["pull_upstream"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const commit = request.args.commit as string | undefined;
      if (commit === undefined) return null; // commit is optional

      if (!GIT_HASH_RE.test(commit)) {
        return deny(
          "validate.git_hash",
          "VALIDATION_FAILED",
          `Invalid git hash: "${commit}". Must be 7-40 lowercase hex characters.`,
        );
      }
      return null;
    },
  };
}

/**
 * Validate port number range.
 */
function createPortRangeRule(): PolicyRule {
  return {
    id: "validate.port_range",
    description: "Validate port number is in valid range (1-65535)",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["expose_port", "remove_port"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const port = request.args.port as number | undefined;
      if (port === undefined) return null;

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return deny(
          "validate.port_range",
          "VALIDATION_FAILED",
          `Invalid port: ${port}. Must be integer 1-65535.`,
        );
      }
      return null;
    },
  };
}

/**
 * Validate cron expression structure.
 */
function createCronExpressionRule(): PolicyRule {
  return {
    id: "validate.cron_expression",
    description: "Validate cron expression format",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["modify_heartbeat"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const schedule = request.args.schedule as string | undefined;
      if (schedule === undefined) return null;

      if (!CRON_PARTS_RE.test(schedule.trim())) {
        return deny(
          "validate.cron_expression",
          "VALIDATION_FAILED",
          `Invalid cron expression: "${schedule}". Must be 5 space-separated fields.`,
        );
      }
      return null;
    },
  };
}

/**
 * Validate Ethereum address format.
 */
function createAddressFormatRule(): PolicyRule {
  return {
    id: "validate.address_format",
    description: "Validate Ethereum address format (0x + 40 hex chars)",
    priority: 100,
    appliesTo: {
      by: "name",
      names: ["transfer_credits", "send_message", "fund_child"],
    },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const address = (request.args.to_address as string | undefined)
        ?? (request.args.agent_address as string | undefined);
      if (address === undefined) return null;

      if (!ADDRESS_RE.test(address)) {
        return deny(
          "validate.address_format",
          "VALIDATION_FAILED",
          `Invalid address format: "${address}". Must be 0x followed by 40 hex characters.`,
        );
      }
      return null;
    },
  };
}

export function createValidationRules(): PolicyRule[] {
  return [
    createPackageNameRule(),
    createSkillNameRule(),
    createGitHashRule(),
    createPortRangeRule(),
    createCronExpressionRule(),
    createAddressFormatRule(),
  ];
}
