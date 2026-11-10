/**
 * Policy Rules Registry
 *
 * Central registry for all policy rules. Aggregates rules from
 * each sub-phase module.
 */

import type { PolicyRule, TreasuryPolicy, SecurityConfig } from "../../types.js";
import { DEFAULT_TREASURY_POLICY } from "../../types.js";
import { createValidationRules } from "./validation.js";
import { createCommandSafetyRules } from "./command-safety.js";
import { createPathProtectionRules } from "./path-protection.js";
import { createFinancialRules } from "./financial.js";
import { createAuthorityRules } from "./authority.js";
import { createRateLimitRules } from "./rate-limits.js";
import { createLockdownRules } from "./lockdown.js";

/**
 * Create the default set of policy rules.
 * Each sub-phase adds its rules here. When a security config is supplied,
 * lockdown rules are prepended so they are evaluated first.
 */
export function createDefaultRules(
  treasuryPolicy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
  security?: SecurityConfig,
): PolicyRule[] {
  const lockdown = security ? createLockdownRules(security) : [];
  return [
    ...lockdown,
    ...createValidationRules(),
    ...createCommandSafetyRules(),
    ...createPathProtectionRules(),
    ...createFinancialRules(treasuryPolicy),
    ...createAuthorityRules(),
    ...createRateLimitRules(),
  ];
}
