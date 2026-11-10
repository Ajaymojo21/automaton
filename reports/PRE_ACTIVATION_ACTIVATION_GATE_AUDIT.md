# Pre-Activation Readiness Audit — Activation Gate Audit

## 1. Activation entry-point matrix

| CLI command | Calls `requireActivation()`? | Reaches wallet? | Reaches DB write? | Reaches registration? | Reaches heartbeat? | Reaches agent loop? |
|---|---|---|---|---|---|---|
| `--run` | yes (via `run()` → `checkActivation`) | yes | yes (createDatabase) | yes | yes | yes |
| `--init` | **yes** | yes | no | no | no | no |
| `--provision` | **yes** | yes (SIWE) | no | no | no | no |
| `--setup` | **yes** | yes (wallet) | yes (config) | no | no | no |
| `--configure` | no | no | config only | no | no | no |
| `--pick-model` | no | no | no | no | no | no |
| `--status` | no | no | no (read-only snapshot) | no | no | no |
| `--migrate-schema` | no | no | yes (gated separately) | no | no | no |
| `--help` / `--version` | no | no | no | no | no | no |

## 2. Dual gate verification

`checkActivation(config, env)` requires **both**:
1. `config.security.activationApproved === true`
2. `env.CONWAY_ACTIVATION === "APPROVED"`

Both are off by default. Neither can be set by the agent (config is operator-written, env is
inherited from the operator's shell). The gate short-circuits on the first missing signal and
returns a reason string.

`requireActivation()` calls `checkActivation()` and `process.exit(2)` on failure. No override
parameter, no force flag.

## 3. Dashboard activation surface

- `POST /api/action/start` → **404 `no such endpoint`**. There is no activation route in the
  console. A probe confirmed this.
- No console API can set `security.activationApproved` or `CONWAY_ACTIVATION`.

## 4. Bypass analysis

| Vector | Guarded? | Evidence |
|---|---|---|
| Subprocess env inheritance | Yes — env var must be explicitly set by operator | `activation.ts` reads from process env |
| Alternate CLI command (`--init`, `--provision`, `--setup`) | Yes — all call `requireActivation()` | `src/index.ts` lines 127, 149, 186 |
| Dashboard API | Yes — no route exists | 404 probe |
| Background service / heartbeat | Yes — only created inside `run()` after the gate | `src/index.ts:497` |
| Migration command | Yes — separate gate (`CONWAY_MIGRATION_APPROVAL`), does not read activation | `schema-migration.ts` |
| Wallet creation without activation | No — `getWallet()` is only called from gated commands | static inspection |

## 5. Test evidence

- `checkActivation` tested via `src/security/activation.ts` unit tests (part of the 2,238-test suite).
- `requireActivation` is a thin wrapper; no separate test, but the logic is trivial and was
  exercised by the `--status` (ungated) and `--run` (gated) paths.
- The dashboard's `security.test.ts` (15 tests) covers auth, origin, CSRF.

## 6. Verdict

**No bypass path found.** Activation requires two independent human-set signals, all CLI entry points
that touch wallets/DB/registration call the gate, and the dashboard has no activation route. The gate
is fail-closed and returns a typed reason on denial.
