/**
 * Activation Gate
 *
 * Starting the agent runtime is a state-changing operation: `--run` loads or
 * creates a wallet, registers the identity, may purchase credits, and begins
 * autonomous execution. This gate requires two independent, explicit signals
 * before that can happen:
 *
 *   1. `security.activationApproved === true` in the persisted config
 *   2. `CONWAY_ACTIVATION=APPROVED` in the process environment
 *
 * Both are off by default. Neither can be set by the agent itself: the config
 * file is protected by policy rules and the environment is inherited from the
 * human operator's shell.
 */

import type { AutomatonConfig } from "../types.js";

export const ACTIVATION_ENV_VAR = "CONWAY_ACTIVATION";
export const ACTIVATION_ENV_VALUE = "APPROVED";

export interface ActivationStatus {
  approved: boolean;
  reason: string;
}

/**
 * Evaluate whether runtime activation has been explicitly approved.
 * Accepts the config and an environment map for deterministic testing.
 */
export function checkActivation(
  config: Pick<AutomatonConfig, "security">,
  env: NodeJS.ProcessEnv = process.env,
): ActivationStatus {
  if (config.security?.activationApproved !== true) {
    return {
      approved: false,
      reason:
        "security.activationApproved is not true in automaton.json",
    };
  }

  if (env[ACTIVATION_ENV_VAR] !== ACTIVATION_ENV_VALUE) {
    return {
      approved: false,
      reason: `environment variable ${ACTIVATION_ENV_VAR} is not set to ${ACTIVATION_ENV_VALUE}`,
    };
  }

  return { approved: true, reason: "activation approved" };
}
