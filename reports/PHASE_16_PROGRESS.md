# Phase 16 — Progress Log

**Started:** 2026-11-01 11:20 IST
**Last updated:** 2026-11-01 12:10 IST
**Scope:** Section 5 (16A) — code-level security closure; Section 3 — mandatory HOME isolation.
**Governing prompt:** Phase 16 (Final Security Closure) + Phase 17 (AI Command Center), attached 2026-11-01.

This file is the persistent checkpoint record required by Sections 10 and 30. It is
appended to as work proceeds; every claim below carries the command that produced it.
Nothing in this log is carried forward from Phase 15 without fresh evidence.

---

## Standing invariants (re-verified at each checkpoint)

| Invariant | Required value | Verified 2026-11-01 12:08 IST |
|---|---|---|
| `security.activationApproved` | `false` | `false` in `runtime/home/.automaton/automaton.json` |
| `CONWAY_ACTIVATION` | unset | `undefined` in the process env |
| `CONWAY_ALLOW_WALLET_CREATION` | unset | `undefined` in the process env |
| `security.lockdown` | `true` | `true` in the config file |
| `security.allowedTools` | `[]` | `[]` in the config file |
| `maxChildren` | `0` | `0` in the config file |
| `security.selfHealingEnabled` | `false` | key **absent** from the file; effective value `false` from `DEFAULT_SECURITY_CONFIG` (`src/types.ts:692`) |
| `wallet.json` | absent | `existsSync` = `false` |
| Live state DB untouched | `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba` | re-hashed, identical to the 15M record |
| No emergency-stop marker in the live tree | absent | `runtime/home/.automaton/EMERGENCY_STOP` does not exist (see 16A-DEFECT-2) |

`allowedCapabilities` and `sandboxEnabled` are likewise absent from the operator config,
so they take their defaults (`[]` and `true`). Recording "absent, therefore default"
rather than "the file says X" is deliberate: a later reader can check the file and get
the same answer.

The invariants were not altered by any action in this phase. No credential was
entered, no wallet created or funded, no transaction executed, no network exposure
enabled, no Windows service installed, no Windows security setting changed.

---

## Section 3 — centralized HOME isolation (DONE)

**Requirement:** every manual command, Node process, backend, test and migration must use
`<repo-root>\runtime\home`; never fall back to `C:\root\.automaton`
or the Windows user profile; abort with a clear error when the condition fails; prove the
guard is non-vacuous.

**Finding that shaped the design:** the fallback was not one line. `process.env.HOME ||
"/root"`-style silent fallbacks appeared at **12 sites** across `src/`, including the
wallet file path, the replication constitution, the registry agent card, the skills
loader/registry, self-modification, the Conway client and the soul model. On Windows,
`/root` resolves to `C:\root`, so any launcher that forgot `HOME` relocated the entire
state tree — including the private-key file — outside the isolated install.

**Implementation** — `src/runtime/home-guard.ts` (new, single source of truth):

- `conwayRoot()` / `canonicalHome()` — derived from the module location, so `src/` and
  `dist/` resolve the same root.
- `normalizeHome()` — converts Git Bash `/c/...` to `C:\...`, strips trailing separators.
- `resolveHome()` — **tier A**: throws `HomeGuardError(HOME_UNSET)` instead of returning
  `/root`.
- `joinTilde()` — the one place `~` is expanded.
- `stateDir()` — HOME-derived, read-only fallback to the canonical home; never the profile.
- `inspectConwayHome()` / `assertConwayHome()` — **tier B**: reason codes `OK`,
  `HOME_UNSET`, `HOME_IS_USER_PROFILE`, `HOME_IS_FILESYSTEM_ROOT`, `HOME_NOT_A_DIRECTORY`,
  `HOME_NOT_RUNTIME`, `HOME_NOT_ISOLATED`.
- `candidateStateDirs()` — every location state could legitimately live, used by the
  fail-closed emergency-stop read.
- `src/index.ts` → `requireConwayHome()` runs as the first statement of `main()` and
  exits `2` with an actionable message when the check fails.

**Call sites migrated:** `src/config.ts` (`resolvePath`), `src/identity/wallet.ts`,
`src/security/emergency-stop.ts`, `src/reliability/health-guardian.ts`,
`src/agent/loop.ts`, `src/git/state-versioning.ts`, plus the 10-file sweep
(`agent/system-prompt.ts`, `conway/client.ts`, `registry/agent-card.ts`,
`replication/constitution.ts`, `self-mod/code.ts`, `setup/defaults.ts`,
`skills/loader.ts`, `skills/registry.ts`, `soul/model.ts`, `soul/tools.ts`).
A grep for `process.env.HOME || "/root"` now returns only two doc-comment mentions.

**Tests:** `src/__tests__/runtime/home-guard.test.ts` — 19 passed. Includes the
non-vacuity proof required by Section 3: with `HOME` deleted, `resolvePath()` throws
**and** the `existsSync` state of the forbidden paths (`C:\root\.automaton`, the user
profile) is unchanged before and after, so the test fails if the guard ever stops
mattering.

---

## Section 5 / 16A.1 — policy enforcement mandatory at dispatch (DONE)

**Requirement (verbatim):** "No sensitive tool may execute without authorization. No
caller may silently omit the policy layer. All execution paths must use the same
authorization mechanism. Fail closed when policy context is missing. Add direct and
indirect bypass tests. Update all call sites safely. Do not break existing functionality
without tests."

**Phase 15 residual risk R-3 / finding F7 closed.** `PolicyEngine` was an optional
parameter of `executeTool`, and three Phase 15 suites had *pinned the bypass as expected
behaviour* (`phase15-penetration.test.ts` asserted that a `transfer_credits` dispatch with
`undefined` engine succeeded).

**Implementation** — `src/security/policy-enforcement.ts` (new) + gate in
`src/agent/tools.ts`:

- `POLICY_REQUIRED_CAPABILITIES = financial, wallet_signing, shell_execution,
  agent_spawning, publishing, administrative`. `filesystem_write` and `network_access`
  are deliberately excluded — including them would deny every read/write of ordinary
  operation without adding a control the authorizer does not already apply. Documented
  in the module.
- Gate order is now: unknown tool → emergency stop → authorizer → **policy presence** →
  policy evaluation → treasury guard → timeout/output bounds → sanitize → commit/release.
  The presence gate sits **before** the treasury, which is what makes the bypass tests
  meaningful rather than decorative.
- Missing engine → `POLICY_ENGINE_MISSING`; engine without turn context →
  `POLICY_TURN_CONTEXT_MISSING`. Both write a HIGH `tool.denied` security event.
- A non-capability tool dispatched without the engine still runs, but a LOW
  `policy.skipped` event is written so the omission is visible in the audit trail.
- `checkPolicyEnforcement()` separates `enforced` ("may proceed") from `policyRan`
  ("engine and context both supplied") — conflating them denied every read-only call.
  That was a real bug, caught by the new tests, not a test-authoring slip.

**Call sites updated safely:** all three production dispatch sites
(`agent/loop.ts:659`, `agent/harnesses/general-harness.ts:291` and `:339`) already pass
both engine and turn context — verified by reading them, not assumed.
`agent/loop.ts` now builds the same engine `src/index.ts` builds when a caller constructs
the loop without one, so no entry point can produce a runtime whose sensitive tools are
silently denied.

**Tests:** `src/__tests__/security/phase16-policy-enforcement.test.ts` — 13 passed.
- *Direct bypass:* `transfer_credits` with no engine → `POLICY_ENGINE_MISSING` **and**
  `treasuryRows() === 0`, proving the denial precedes any ledger write.
- *Indirect bypass:* a `list_sandboxes`-named wrapper whose handler re-enters
  `executeTool("exec", …)` without an engine → inner call refused, `innerOutcome !== "RAN"`.
- Audit assertions: a `tool.denied` row containing `shell_execution` exists; `policy.skipped`
  is written for the skip case and absent when the engine ran.

---

## 16A — defects found while implementing, and their closure

### 16A-DEFECT-1 — emergency stop failed open when HOME disagreed (fixed in 15-line change)

`readEmergencyStop()` read exactly one path. With `HOME` unset it looked in the Windows
user profile while the launcher had written the marker under the runtime home, and
reported the stop as **cleared**. Dispatch continued. This is the same class of bug as
R-3: a security control whose effectiveness depended on a call-site courtesy.

Fixed by union-scanning `candidateStateDirs()`, with "unreadable marker counts as
engaged" preserved.

### 16A-DEFECT-2 — the fix itself wrote a live emergency-stop marker (found by test fallout)

Making the read scan every candidate location exposed a second problem in my own change:
`candidateStateDirs()` returns the canonical install first, so `engageEmergencyStop()`
without an explicit `dir` **wrote its marker into the live state tree** —
`runtime/home/.automaton/EMERGENCY_STOP`. It happened during the 11:54 IST test run and
contaminated 13 unrelated tests in `phase15-incident-response` and `phase15-penetration`
(every later dispatch reported "emergency stop is engaged").

Evidence captured before remediation:

| Item | Value |
|---|---|
| Path | `runtime/home/.automaton/EMERGENCY_STOP` |
| Size | 100 B |
| mtime | 2026-11-01 11:55 IST |
| Content | `{"reason":"security drill","engagedAt":"2026-01-05T12:00:00.000Z","engagedBy":"tester"}` |
| SHA-256 | `9a0aca923c8fffb3f362b1727695efd5e837aed31387b91a51599d18fec37122` |

The mocked `engagedAt` date proved it was test output, not operator action. Remediation
was a **move, not a delete**: quarantined to
`reports/PHASE_16_TEST_ARTIFACT_EMERGENCY_STOP_2026-11-01.json` (hash re-verified
identical), leaving the live state dir clean and the evidence intact.

Code fixes:
1. `automatonDirs()` now puts `stateDir()` — the process's own verified directory —
   first, so engagement targets HOME and reads remain fail-closed.
2. `clearEmergencyStop()` removes **every** scanned marker. Removing only the first
   reported a successful clear while the stop stayed engaged — an inconsistent state,
   and the reason `phase15-incident-response.test.ts:348` failed.

**Tests:** `src/__tests__/security/phase16-emergency-stop-isolation.test.ts` — 6 passed.
Pins that engagement lands in the sandbox and that `existsSync(canonicalMarker)` is
**false** afterwards; that a marker written by a process with a different HOME is still
detected and fully cleared; unreadable marker → engaged. The cross-directory case is
constructed from two temp dirs (`HOME` and `USERPROFILE`), never the live install or the
real profile, and its candidate-set precondition is a hard assertion so the test cannot
pass vacuously.

---

## Section 5 / 16A.4 — self-healing safety (DONE)

Requirement (§5 A.4): self-healing stays disabled by default, and the mechanic must
never modify wallet credentials, treasury limits, security policies, activation
approvals or tool permissions.

### State found before any change

| Item | Measured 2026-11-01 12:49 IST | Verdict |
|---|---|---|
| `security.selfHealingEnabled` in the live config | key **absent** (not `false`, not `true`) | takes `DEFAULT_SECURITY_CONFIG.selfHealingEnabled = false` (`src/types.ts:693`) |
| Mechanic enable test | `config.security?.selfHealingEnabled === true \|\| allowRepairs === true` | absent key ⇒ `undefined === true` ⇒ **false**. Disabled by construction, not by a `!false` inversion |
| `classifyRepair` unknown ids | fall through to `forbidden` ("not in the approved registry") | deny-by-default |
| Pattern check order | patterns loop **before** the registry lookup | a forbidden-text id cannot be laundered by registering it |

No invariant was changed while verifying this: `activationApproved=false`,
`lockdown=true`, `allowedTools=[]`, `maxChildren=0` (top-level key, present, value 0),
`CONWAY_ACTIVATION`/`CONWAY_ALLOW_WALLET_CREATION` unset, `wallet.json` absent, live DB
hash still `2a8aeb34…efbba`, no emergency-stop marker in the live tree.

### 16A.4-DEFECT-3 — the pattern net did not cover two of the five protected categories

The new tests passed on the first run, which was the suspicious part. Probing the
regular expressions directly instead of trusting the green checkmark showed **why**: the
refusals came from the deny-by-default registry (unknown id → forbidden), not from the
`FORBIDDEN_PATTERNS` net that is supposed to be the second line of defence. Run of
`reports/PHASE_16_PATTERN_PROBE.cjs`, which parses the pattern array out of each file
version and is re-runnable:

```
=== PRE-16A.4 (backups/phase16/mechanic.ts.pre-16A4.bak) — 11 patterns ===
set_activation_approved  NO PATTERN MATCH
enable_activation        NO PATTERN MATCH
grant_capability         NO PATTERN MATCH
elevate_privilege        NO PATTERN MATCH
add_allowed_tool         NO PATTERN MATCH
disable_sandbox          NO PATTERN MATCH
disable_lockdown         NO PATTERN MATCH
disable_audit            NO PATTERN MATCH
raise_treasury_limit     MATCH /(financial|treasury|spend|transfer)[_\s-]*(limit|cap|budget|policy)/i
export_private_key       MATCH /private[_\s-]?key|seed phrase|mnemonic/i

=== POST-16A.4 (src/reliability/mechanic.ts) — 13 patterns ===
set_activation_approved  MATCH /activation[_\s-]*(approv|gate|enabled?)|(approv|enable|disable|set|grant|clear)[_\s-]+activation/i
enable_activation        MATCH (same activation pattern)
grant_capability         MATCH /(grant|elevate|revoke|widen)[_\s-]+(permission|capabilit|privilege|admin)/i
elevate_privilege        MATCH (same permission pattern)
add_allowed_tool         MATCH /(allowed|allow)[_\s-]*(tools?|capabilit|list)|(tools?|capabilit)[_\s-]*allow(ed|ist)/i
disable_sandbox          MATCH /disable[_\s-]+(audit|sandbox|security|authoriz|lockdown|monitor)/i
disable_lockdown         MATCH (same security-control pattern)
disable_audit            MATCH (same security-control pattern)
prune_expired_leases     NO PATTERN MATCH   (correct — it is a pre-approved maintenance repair)
```

Three concrete faults, all fixed in `src/reliability/mechanic.ts`:

1. **Activation approvals had no pattern at all.** §29 lists "setting
   `activationApproved` to true" as prohibited; the mechanic had nothing to refuse it.
2. **Tool-permission allowlists had no pattern at all.** Same for `allowedTools`.
3. **`\s+` where the ids use `_`.** `disable\s+(sandbox|…)` cannot match
   `disable_sandbox`, and `(grant|elevate)\s+(permission|…)` cannot match
   `grant_capability`. Underscore-joined repair ids — the style the registry itself uses
   (`prune_expired_leases`, `rotate_audit_seal`) — slipped past the net.

**Why this mattered even though nothing was exploitable today:** every one of those ids
was already refused, because it is not in `AUTOMATIC_REPAIRS`. The gap is a
defence-in-depth one — the moment a maintainer registers such an id as automatic or
approval-required, the pattern net was the only thing left standing between that edit and
an unattended change to an activation gate. The registry is a whitelist of *known*
repairs; the patterns are the guard against a *newly whitelisted* repair doing something
prohibited. That guard was partly absent.

### Tests added

`src/__tests__/security/phase16-self-healing-safety.test.ts` — **28 tests** (this file
plus `src/__tests__/phase15-self-healing.test.ts` = **68 passed / 68**). It pins:

- 21 forbidden ids across the five protected categories, each with its category.
- **Reason-by-name assertions**, so a refusal must come from the pattern net, not from
  the unknown-id fallback — the exact weakness the probe found:
  `["set_activation_approved", "activation approval"]`,
  `["grant_capability", "permission grant"]`,
  `["add_allowed_tool", "tool permission allowlist"]`,
  `["disable_lockdown", "security control"]`, and five more.
- Unknown ids, including plausible-sounding ones, stay forbidden.
- Widening the patterns did **not** break maintenance: the 3 automatic and 5
  approval-required registry entries still classify as before.
- `allowRepairs` cannot widen *what* executes: every applied action in a forced run must
  independently classify as `automatic`.
- Byte-level proof that a mechanic run never touches config or wallet files — SHA-256 of
  `automaton.json` and `wallet.json` inside the run's `automatonDir` taken before and
  after and asserted identical.
- Everything runs against temp directories and a mocked clock (`2026-01-05T12:00:00Z`);
  no run can reach the live state tree.

### Also fixed while typechecking this file

The explicit test typecheck (tsconfig excludes `src/__tests__`) failed with
`TS2322: Type '"warn" | "ok"' is not assignable to type 'OverallHealth'` at line 43 of my
new test file — the synthetic `HealthReport` used `"warn"`, which is not a member of
`"ok" | "degraded" | "critical"` (`src/reliability/health-guardian.ts:25`). Vitest strips
types, so the suite was green while the file did not typecheck. Changed to `"critical"`,
matching what the real guardian computes for a failing check, and the typecheck now exits
0. Latent test-only defect, no production impact.

---

## Section 5 / 16A.5 — investigation of R-6, R-7, R-8, R-10 (DONE — 2 fixed, 1 blocked, 1 measured, 1 closed)

Source of the risk numbers: `docs/PHASE_15_OVERVIEW.md:66-123` ("Residual risks — read
these before activating").

### R-6 · "session spend tracking can fail open after commit" — **worse than recorded, and partly fixed**

Phase 15 called it "Accepted, not fixed … Compensated by the DB-side caps and the audit
chain". Four measured facts change that verdict:

1. **The DB-side compensation is real, but only for transfers.** `TreasuryGuard` enforces
   its hourly/daily caps from its own `treasury_authorizations` table
   ([src/security/treasury-guard.ts:387-400](../src/security/treasury-guard.ts#L387)),
   written durably at reserve time — so a failed `recordSpend` cannot open a transfer-cap
   bypass. The `spend_tracking` aggregate that policy rules read
   ([src/agent/policy-rules/financial.ts:134](../src/agent/policy-rules/financial.ts#L134))
   is a second, weaker copy of the same limit.
2. **The audit-chain compensation was not real.** `tryAppendSecurityEvent` caught every
   error and returned `null` with no trace at all
   (`backups/phase16/audit-chain.ts.pre-16A5.bak`, lines 161-167). The live database is
   schema V11, where `security_events` does not exist — measured directly:
   `tableCount=38`, `security_events present=false`, `treasury_authorizations present=false`,
   `security_incidents present=false`, `security_seals present=false`. So on the live
   install **every audit append was already a silent no-op**, and a reader of the R-6 note
   would have believed a chain was recording it.
3. **`x402_fetch` records `amountCents: 0`** by design ("actual amount is inside the x402
   protocol"), so the x402 envelope in `SpendTracker.checkLimit`
   (`maxX402PaymentCents * 10` / `* 50`) is computed against a sum of zeros — a vacuous
   limit.
4. **Nothing anywhere records `category: "inference"`.** `recordSpend` has exactly two
   production call sites ([src/agent/tools.ts:3643, 3660](../src/agent/tools.ts#L3643)) —
   `transfer_credits` and `x402_fetch`. A full registry dump contains no tool named `chat`
   or `inference`, which is what
   `financial.inference_daily_cap` matches on
   ([src/agent/policy-rules/financial.ts:249](../src/agent/policy-rules/financial.ts#L249)).
   So `maxInferenceDailyCents` is **enforced nowhere**: the rule can never select a tool,
   and the aggregate it reads can never be non-zero.

**Fixed (both are visibility fixes; neither changes a security decision):**
- `tryAppendSecurityEvent` and `tryAppendSecuritySeal` now log the swallowed error
  (module, event type, severity, reason truncated to 200 chars) and still return `null`.
- A failed `recordSpend` after a committed financial tool now writes a **CRITICAL
  `spend.tracking_failed`** audit event with the tool, amount and reason, and keeps the
  logger entry. It does not roll the commit back — the external transfer really happened,
  and un-reserving it would hide it from the durable ledger too.

**Not fixed, designed instead** (recorded as new risk **R-11**): the inference budget needs
a writer at the point cost is known — `routerResult.costCents` at
[src/agent/loop.ts:648](../src/agent/loop.ts#L648) — and a gate that runs *before* routing,
because inference is not a dispatched tool. `reports/PHASE_16_CODE_SECURITY.md` holds the
design. The new test `the inference daily cap rule does fire once such a row exists` proves
the rule logic is sound in isolation, so the gap is wiring, not policy.

### R-7 · "both 15L product fixes are unverified on POSIX" — **BLOCKED, cannot be closed on this host**

Verified the claim rather than repeating it: `src/security/sandbox.ts:105-111` branches on
a module-level `const isWindows = process.platform === "win32"`, so the POSIX branch
(`normalized.startsWith("/etc") || normalized.startsWith("/root/.ssh")`) cannot execute in
this process — and mocking `process.platform` would not help, because `normalizeForCompare`
uses `path.resolve`, which is the win32 implementation on this host; a `/etc` input resolves
to `C:\etc`, so a mocked-platform test would assert a POSIX expectation against Windows
semantics and prove nothing. A real run needs a POSIX runner:
`wsl --status` → WSL2 default but **no distro installed** (`wsl -l -q` empty) and the WSL
optional component disabled (Phase 1 audit, `reports/ENVIRONMENT_AUDIT.md:29`); installing it
needs elevation and a reboot, and installing a distro is a new component — both outside what
this phase may do unilaterally. `VERDICT: NOT VERIFIED ON POSIX — BLOCKED`, operator
instruction in `reports/PHASE_16_CODE_SECURITY.md`.

Two static observations recorded without claiming they are fixes: the POSIX prefix checks
use `startsWith("/etc")` without a separator (so `/etcetera` matches — over-block, not
under-block), and `WINDOWS_RESERVED` device-name rejection also applies on POSIX
(over-strict, harmless).

### R-8 · "one load-dependent test timeout" — **measured, unchanged**

`src/__tests__/heartbeat.test.ts` run twice in isolation with the pinned Node:
**2.815 s and 2.775 s wall**, 100% pass both times, suite duration 2.29 s / 2.28 s. The
30 s default `testTimeout` is therefore not a defect in the test; it is host saturation
during the full-suite run — same class as the `discover_agents` A/B measured earlier
(62.01 s vs 63.37 s against a 180 s budget). `testTimeout` deliberately stays at the
default: raising it would hide real hangs.

### R-10 · "`~` resolves through HOME, not the Windows profile" — **CLOSED by Section 3, re-verified**

`resolvePath()` ([src/config.ts:206-211](../src/config.ts#L206)) is now
`p.startsWith("~") ? joinTilde(p) : p`, and `joinTilde` → `resolveHome()`, which **throws
`HOME_UNSET`** instead of substituting `/root`. The remaining `/root` literals in the tree
are all *inside* sandbox semantics, not host fallbacks:
`src/security/sandbox.ts:39` (`if (sandboxId) return "/root"` — the cloud sandbox's own
root), `:109` (a deny-list entry), and `src/replication/{constitution,spawn}.ts`
(child-sandbox paths; replication is inert here — `allowReplication=false`, `maxChildren=0`).
Non-vacuity proved by `home-guard.test.ts` (HOME deleted → resolve throws *and* every
forbidden path's `existsSync` is unchanged).

One related gap found on the way and **not** changed: `resolveSandboxRoot()`
([src/security/sandbox.ts:34-43](../src/security/sandbox.ts#L34)) still falls back to
`process.cwd()` when neither `security.sandboxRoot` nor `HOME` is set. It is not a state
tree, so it does not violate §3, but it silently widens the writable root to whatever
directory the process started in. Recorded as **R-12**; the fix is to route it through
`resolveHome()` so an unset HOME fails closed the same way `~` does.

---

## Section 5 / 16A.2 · Section 8 / 16D — live-model security preparation (DONE as preparation)

Requirement: prepare the isolated live-model testing environment, but "do not enter real API
credentials automatically" and "do not activate a live agent without approval".

New gate — `src/security/live-model-preflight.ts` — 18 checks, one per prohibition:
isolated test home, `activationApproved=false`, activation env flags unset, `lockdown=true`,
`allowedTools=[]`, no privileged capability grant, no wallet material, every treasury field
zero, no x402 domain, no credential in the config file, financial/shell/self-modification/
replication/exposure/self-healing all disabled, sandbox enabled, emergency stop not engaged.
Verdicts are `READY` / `PENDING_CREDENTIAL_APPROVAL` / `SAFETY_GATE_FAILED`; credential and
approval presence are reported as booleans only — **no code path returns or prints a value**.

Executed against the live install (read-only, `scripts/phase16-live-model-preflight.ts`,
exit 2):

```
home=<repo-root>\runtime\home isolated=false
FAIL  home.isolated_test_tree        homeGuardOk=true isolatedTestHome=false
FAIL  treasury.all_zero              non-zero: maxMonthlyTransferCents, agentBudgetCents, childBudgetCents
credentialPresent=false approvalPresent=false
verdict=SAFETY_GATE_FAILED
```

16 of 18 checks pass on the live config. The two failures are correct refusals, not
defects: the live state tree must not double as the model-testing environment (§8), and the
operator's treasury has non-zero monthly/agent/child budgets. So the honest state is:

**`LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`** — nothing was activated, no credential
was entered, and the gate that would admit a real model call is written, tested and shown to
refuse the current environment.

**Tests:** `src/__tests__/security/phase16-live-model-preflight.test.ts` — **23 passed**,
including one failing check per prohibited action, "a blank credential is not a credential",
"any value other than APPROVED is not approval", "safety failure outranks a held credential",
and `neither the checks nor the summary echo a credential value` (a planted secret string is
asserted absent from both the summary and the serialized result).

### Addendum — 16D executed, and the gate was found to be permanently refusing (§8)

The paragraph above was written from the unit tests. Running the script as §8 requires then
proved it could never say anything except *no*: `scripts/phase16-live-model-preflight.ts`
validated `HOME` in the guard's **`runtime`** mode — which requires `HOME` = the live home —
and then asserted `home.isolated_test_tree`, which requires the opposite. Recorded as **R-22**,
high for the deliverable, fail-closed for safety.

Fix (pre-change file backed up to `backups/phase16/phase16-live-model-preflight.ts.pre-16D.bak`,
SHA `dc6dc95d…` verified byte-identical; new SHA `812e6ebf…`): an optional `--test-home <dir>`
re-validates through the guard's **existing `isolated`** mode instead of adding a second policy.
Default (no flag) behaviour is unchanged and still demands the canonical runtime home, so the
§3 guard is not weakened — it is *re-used*. The isolated tier refuses the runtime home itself
(`HOME_NOT_ISOLATED`) and non-existent directories (`HOME_NOT_A_DIRECTORY`).

Isolated environment created at `runtime/model-test-home/.automaton/automaton.json`
(1 547 B, 50 lines, SHA `e69c8495…`): config only — no wallet, no keystore, no database, no
`.db-wal`/`.db-shm`; `maxChildren=0`, `allowedTools=[]`, `lockdown=true`,
`activationApproved=false`, sandbox enabled, and all **13** treasury fields written explicitly to
`0` rather than left to inherit defaults.

Four tiers executed 2026-11-01 08:44:01–02Z, verbatim in `reports/PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt`:

| Tier | Result |
|---|---|
| runtime home (no flag) | exit 2 — `SAFETY_GATE_FAILED`, refuses the live state tree as a test env |
| `--test-home runtime/home` (misuse) | exit 2 — `HOME_NOT_ISOLATED`, **no** `verdict=` line printed |
| `--test-home` non-existent dir | exit 2 — `HOME_NOT_A_DIRECTORY` |
| `--test-home runtime/model-test-home` | **18 PASS / 0 FAIL**, exit 1 — `PENDING_CREDENTIAL_APPROVAL`, `credentialPresent=false approvalPresent=false` |
| same + a fake key in env + `CONWAY_LIVE_MODEL_APPROVED=APPROVED` | exit 0 — `verdict=READY`, reached for the first time |
| loosened config + key + approval | exit 2 — `agent.activation_closed`, `tools.allowlist_empty`, `shell.disabled`, `treasury.all_zero` outrank the credential |

New tests: `src/__tests__/security/phase16-live-model-tier.test.ts` — **8 passed**, spawn the real
CLI through `process.execPath` + `node_modules/tsx/dist/cli.mjs`, assert the tiers above, assert
non-vacuity (`credentialPresent=true approvalPresent=true` in the READY case), and assert the
isolated home still contains only `automaton.json`.

Executing the gate is also what surfaced **R-21**: the live lockdown config resolves
`maxMonthlyTransferCents=100000`, `agentBudgetCents=200000`, `childBudgetCents=50000` from code
defaults because `automaton.json` predates those fields and `src/config.ts:45-48` deep-merges.
Not auto-fixed — that means editing the operator's live config; remedy recorded instead.

**`LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`** remains the verdict, now earned by
construction rather than asserted: every safety term is provably satisfiable and only the two
operator-owned terms (a real credential, and `CONWAY_LIVE_MODEL_APPROVED=APPROVED`) are missing.

---

## Section 5 / 16A.6 — npm package-name flag confusion (R-16, CLOSED)

### The gap

`install_npm_package`, `install_mcp_server` and `installNpmPackage()` all build
`` `npm install -g ${pkg}` ``. The validator guarding them,
`/^[@a-zA-Z0-9._/-]+$/`, was duplicated in **four** places: `src/agent/policy-rules/validation.ts:10`
(the `validate.package_name` rule) and three "defense-in-depth" inline copies —
`src/agent/tools.ts:604`, `src/agent/tools.ts:1000`, `src/self-mod/tools-manager.ts:24`.

It rejected every shell metacharacter, so the original Phase 15 conclusion was "injection
closed". It did **not** reject a value beginning with `-`.

First measurement (before any fix, pinned npm 10.9.9, `HOME` = the runtime home):

```
=== C: legacy regex already rejected '=' payloads ===
--userconfig=/tmp/evil             legacy rejected
-forgery                           LEGACY-ACCEPTED
--foreground-scripts               LEGACY-ACCEPTED
--registry=http://attacker.invalid legacy rejected
-@scope/pkg                        LEGACY-ACCEPTED
```

So value-bearing switches (`--userconfig=/path`) were **never** reachable — `=` and space
were already excluded. My first draft of the finding claimed they were; that claim is
wrong and is corrected here and in the code comment. What *was* reachable is any
leading-dash token.

### What a leading-dash token actually does — measured, with an incident

```
=== D: install consumes leading-dash tokens as switches ===
npm install -g --phase16probe   →  added 1 package in 26s
=== E: single dash ===
npm install -g -forgery         →  up to date
```

npm does **not** reject an unknown switch, and having consumed the only argument as a
switch it was left with no positional package — so it installed the **current working
directory**. Probe D created
`runtime/node-v22.23.4-win-x64/node_modules/@conway/automaton` as a Windows **junction**
pointing at the whole Conway project, plus `automaton` / `conway-automaton` shims (`.`,
`.cmd`, `.ps1`) in the pinned Node directory.

**This was an unintended change made by a read-only-intended probe, and it is reported as
such.** It violates the §2 "inspect, do not modify" intent for the runtime directory.

Revert (deliberately *not* `rm -rf`: on a junction that recurses into the real target):

| Step | Command | Result |
|---|---|---|
| 1 | `npm uninstall -g @conway/automaton` | `removed 1 package in 533ms` |
| 2 | `dir /a node_modules\@conway` | 0 files, junction gone |
| 3 | `rmdir @conway` (empty scope dir) | removed |
| 4 | `ls node_modules` | `corepack  npm` — the original contents |
| 5 | shims check | `no shims remain` |
| 6 | `sha256sum runtime/home/.automaton/state.db` | `2a8aeb34…efbba` — **unchanged** |
| 7 | project dirs | `src`, `package.json` present |

Severity, stated honestly: not code execution. It is **wrong-target install** — the agent
can make npm install something other than the named package, from a string the model
supplied. On this host the demonstration installed the agent's own project, which is why
it was visible. A different cwd would have installed that instead.

### Fix

One exported source of truth, reused at all four sites:

```ts
const PACKAGE_NAME_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function isValidPackageName(value: string): boolean { … }
```

Neither segment may start with `-` or `.` — which is also what npm itself requires, so
this rejects no legitimate package. `validation.ts` is types-only in its imports, so
`tools.ts` and `self-mod/tools-manager.ts` can both depend on it without a cycle.

### Secondary finding — npm writes outside the isolated HOME (new risk **R-17**)

The probes proved a §3 isolation gap that is independent of the Conway code: npm on
Windows resolves its cache from `%LocalAppData%` (i.e. `USERPROFILE`), **not** from
`HOME`. After the probes:

- `runtime/home/npm-cache` — **absent** (nothing written inside the isolated tree)
- `<user-home>\AppData\Local\npm-cache\` — `_cacache`, `_logs`, `_npx` present,
  and `_logs` contains absolute host paths from the probe run.

So "every process uses the runtime home" is true for Conway's own `~` resolution (R-10,
closed) and **false** for the toolchains Conway shells out to. Any future npm use —
including the dashboard's `npm install` in Phase 17 — writes to the Windows user profile,
not the isolated tree. Remediation would be setting `npm_config_cache` / `LOCALAPPDATA`
for child processes; that changes host behaviour, so it is **recorded, not applied**.

**Tests:** `src/__tests__/security/phase16-package-name-hardening.test.ts` — **15 passed**,
and they were run red-first: the red output was
`install_npm_package -forgery: expected 'Installed: -forgery' to contain 'Blocked:'`, i.e.
the test caught the payload reaching the shell boundary before any fix existed. Coverage:
the exported validator, the policy rule, both `executeTool`-level tool bodies (asserting
`conway.exec` is **never called**, with positive controls that a valid name does reach it
with the exact string `npm install -g express`), and `installNpmPackage()`. Non-vacuity is
pinned by asserting each `LEGACY_BYPASS` payload *passed* the old pattern.

---

## Section 5 / 16A.7 — POSIX quoting is inert under cmd.exe (R-18, CLOSED)

### The defect, found by review and confirmed by execution

Reviewing the shell-interpolation sites raised a question the Phase 15 audit never asked:
**which shell actually parses these commands on this host?** `src/conway/client.ts:113-122`
runs the local fallback with `execSync(command, …)`, and `execSync` on Windows uses
`%ComSpec%` — measured here as `C:\WINDOWS\system32\cmd.exe`. Every guard written for the
Conway sandbox assumes `/bin/sh`.

`escapeShellArg()` (`src/agent/tools.ts`, the last function in the file) is POSIX quoting:
`'…'` with `'\''` for embedded quotes. `cmd.exe` does not treat `'` as a quote character at
all.

Probe: `reports/PHASE_16_WINQUOTING_PROBE.cjs`, run 13:33 with the pinned Node.

| Input path | Command built | exitCode | stdout | Injection? |
|---|---|---|---|---|
| `…\nope&echo INJECTED_AMP` | `cat '…\nope&echo INJECTED_AMP'` | **0** | `INJECTED_AMP'` | **YES — second command executed** |
| `…/nope&echo INJECTED_AMP` | same, forward slashes | **0** | `INJECTED_AMP'` | **YES** |
| `…/nope\|echo INJECTED_PIPE` | `cat '…/nope\|echo INJECTED_PIPE'` | **0** | `INJECTED_PIPE'` | **YES** |

### Reachability from model input, traced rather than assumed

`read_file` takes `args.path` straight from the tool call:

1. `confinePathToSandbox()` → `confineToRoot()` — `&` and `\|` are legal Windows filename
   characters, so confinement passes them. Verified with a throwaway `tsx` probe:
   `"nope&echo INJECTED"` → `ok path=<repo-root>\runtime\home\nope&echo INJECTED protected=false`.
2. `ctx.conway.readFile(confined)` → local path is `fs.readFileSync` (`client.ts:207`) → **throws**
   because the file does not exist.
3. The `catch` at `tools.ts:237` was written for a broken Conway API and falls back to
   `exec("cat …")` — which is where the quoting applies, and where cmd.exe ignores it.

So a single `read_file` call with a crafted path executes an arbitrary second command on
the host, in the same shape as the two `escapeShellArg` call sites
(`tools.ts:240` read fallback, `tools.ts:3329` generic installed-tool wrapper).

**Not live today, and stated that way deliberately:** `lockdown = true` and `allowedTools =
[]` (§29 invariants, re-read this session), so no tool dispatches at all. It becomes live
the moment tools are enabled — which is the point of activation. Latent RCE-grade, gated by
a policy that is currently on.

### Fix

`src/security/shell-quote.ts` (new, 3 336 B) exports
`quoteShellArg(arg, platform = process.platform): {ok:true, value} | {ok:false, reason}`.
`platform` is a parameter so both branches are testable on this one host.

- **POSIX branch unchanged** — `quoteForPosix()` is the old function verbatim. The Conway
  sandbox shell is `/bin/sh`; the quoting there is correct and must not regress.
- **Windows branch refuses** rather than quotes. cmd.exe cannot be reliably escaped (two
  parse passes, `^` escaping, delayed expansion), so a model-influenced value containing any
  parse-time metacharacter is refused: `\0 & | < > " % ! ^ newline CR`.

The set is deliberately narrow. `'`, `$`, backtick, parentheses and `;` are inert in
cmd.exe — refusing them would reject legitimate paths without refusing anything dangerous,
and the `'\''` sequence inside a POSIX-quoted string is already correct there.

Both call sites now fail closed: `read_file` returns `Blocked: …` and never calls `exec`;
the installed-tool wrapper returns `Blocked: …` and never calls `exec`. The local
`escapeShellArg` was deleted, so the file no longer contains a second quoting rule.

Consequence worth stating: on the local Windows install, generic installed tools that take
arguments **cannot run** through the shell wrapper any more, because `JSON.stringify(args)`
always contains `"`. That is a functional reduction in a path that is currently unreachable
(`allowedTools = []`) and was silently broken anyway — cmd.exe split the JSON on its own
spaces. The correct fix is `execFile` with an argv array, recorded as a design item in
`reports/PHASE_16_CODE_SECURITY.md`, not applied here.

**Same pattern, deliberately not changed:** `src/git/tools.ts:219` has its own copy of
`escapeShellArg`. Its inputs are `repoPath` from config and an internal
`staged ? "--cached" : ""` flag — no model-controlled value. Left alone to bound this
change; recorded.

**Tests:** `src/__tests__/security/phase16-win-shell-quoting.test.ts` — **13 passed**,
red-first (`expect(String(result)).toContain("Blocked:")` received
`exit_code: 0` before the fix). Covers: every metacharacter refused on win32, benign paths
still accepted, a refusal yields no command fragment, the POSIX branch byte-identical for
all 17 inputs, `'\''` escaping, `read_file` refuses 11 payloads with `exec` never called,
two positive controls (POSIX `cat '…'` still built; win32 benign path still reaches the
fallback), and the installed-tool wrapper refusing on win32 while still quoting on linux.

No existing test needed changing: `tools-security.test.ts` (**71 passed**) pins `'`-quoted
output for `it's a file.txt`, `$(whoami).txt` and `foo; cat /etc/passwd` — all three stay
allowed on win32, which is the intended split.

---

## Section 6 / 16B — Windows host verification (DONE as far as a filtered token allows)

All commands were **re-executed 13:45–13:50 IST** rather than transcribed from the 11:41 raw dump,
and the raw dump was read in full first. Output → `reports/PHASE_16_WINDOWS_VERIFICATION.md`.

VERIFIED this session: Secure Boot `UEFISecureBootEnabled=1`; Defender `AMServiceEnabled/RealTime/
AV/NIS/Ioav/Behavior/Tamper` all `True`, `Mode=Normal`, signature `1.463.68.0` age 0; threat history
`detections=0 threats=0`; firewall all three profiles `ON` with `BlockInbound,AllowOutbound`;
**two enabled inbound ALLOW rules for `C:\program files\nodejs\node.exe`, Public profile,
LocalPort Any (TCP+UDP)**; session token `Medium Mandatory Level` with `BUILTIN\Administrators`
marked *"Group used for deny only"*; `whoami /priv` holding no SeDebug/SeTcb/SeBackup/SeRestore/
SeSecurity; `net localgroup Administrators` → `Administrator`, `<windows-user>`; `WinDefend` and
`MpsSvc` Running/Automatic, `BDESVC`/`KeyIso` Running/Manual; `vmms` absent; OS `10.0.26300`.

UNVERIFIED — BLOCKED by elevation, with the exact error text recorded: `manage-bde -status`
(`An attempt to access a required resource was denied`), `Get-Tpm` (`Administrator privilege is
required`), namespaced `Win32_Tpm` (`Access denied`, 0x80041003), every Defender exclusion field
(`{N/A: Must be an administrator to view exclusions}`), `Confirm-SecureBootUEFI`
(`SetPrivilegeFailed`). `manage-bde -protectors -get` was **not** attempted, and no state-changing
command was run.

**R-1 wording corrected:** Phase 15 said "no administrator rights". Measured, the account *is* in
`Administrators` and the token is UAC-filtered to Medium. So the remedy for four blocked items is
**one elevated read-only run**, not an environmental dead end — and `icacls` was added to that same
operator instruction so R-15 rides along.

**Two self-corrections during this pass:** (a) the operator instruction initially contained
`Get-CimInstance -ClassName Win32_SecureBootSetting`, which does not exist — `Get-CimClass` returned
`Not found`, so it was replaced with `Confirm-SecureBootUEFI` plus an explicit note that it will
still fail for want of `SeTcbPrivilege` and that this is not a Secure Boot finding; (b) the first
`whoami` reading had to be re-run as `$env:SystemRoot\System32\whoami.exe` because Git Bash shadows
it with coreutils — the earlier capture had already noted that.

**Phase 17-relevant facts:** the standing Node firewall allow-rule is scoped by program path and
does **not** cover Conway's pinned `runtime\node-v22.23.4-win-x64\node.exe`, so a `127.0.0.1`
dashboard needs no rule and receives no inbound grant. Port `8787` had **no listener**. Non-local
listeners observed and untouched (§2): `:::3001` PID 12652 `node` (FreeLLMAPI),
`<host-lan-ip>` 54375 `Qoder`, 63057 `chrome`. Conway itself has no listener.

---

## Section 7 / 16C — real-data backup and restore (PARTIALLY VERIFIED)

Full evidence: `reports/PHASE_16_BACKUP_RESTORE.md`; machine-readable:
`reports/PHASE_16_16C_EVIDENCE.json`, `reports/PHASE_16_16C_RESTORE_RAW.json`.

**Reuse, not new code.** `runtime/bin/backup.mjs` (SQLite online backup API, redacts config
credentials, refuses `wallet.json`, writes a hash manifest) and `scripts/phase15-backup-validate.ts`
(restore into `os.tmpdir()`, ten verdicts) already existed and were used as-is. One new suite
(`/src/__tests__/security/phase16-backup-roundtrip.test.ts`) makes the guarantees re-runnable. **No
production source file was modified in 16C** — `src/agent/tools.ts` still hashes
`16dac75c…`, the value it has held since 16A.7.

**The decisive measurement came first.** The live `state.db` holds **37 tables, 1 non-empty, 10
rows total** — all 10 are `schema_version` bookkeeping (V2..V11, applied 2026-10-31 10:25:59).
`episodic_memory`, `semantic_memory`, `working_memory`, `turns`, `tool_calls`, `transactions`,
`onchain_transactions`, `spend_tracking`, `identity` and `soul_history` are all **zero rows**. So:

> `REAL_DATA_RESTORE = NOT YET PROVABLE` — because there is no genuine user data to recover, and
> §7 forbids fabricating rows to make a nicer claim. Nothing was inserted into the live database.

**What *is* verified, executed:** backup of the real live file →
`backups/2026-11-01_08-24-20/`; content comparison live-vs-archive = **identical** across all 37
tables (per-table row digests, `schema_version` rows, `integrity_check ok`, same 512 000 bytes);
restore drill **10/10 PASS** (V11 archive migrated to **V13** on the copy, 41/41 tables, 0 rows lost,
audit chain valid, restore destination under the OS temp dir, live-path guard non-vacuous); and the
live file **unchanged throughout**: `2a8aeb34…efbba` before the backup and after the drill.

### Finding: hash comparison is the wrong acceptance test for a backup

Live `state.db` = `2a8aeb34…`; its archive = `2cc9d26c…` — **different SHA-256, identical content,
identical size.** The backup API rewrites the destination header. The intuitive check ("does the
backup hash match the source?") therefore fails **every correct backup**. Acceptance must be
`integrity_check` + content equality; hashes belong to archive-vs-manifest tamper detection, which
is what the 15K harness actually does. Pinned by a test, and recorded as `sha256LiveEqualsArchive:
false` in the evidence JSON so a future reviewer cannot mistake it for corruption.

### New risk **R-20** — `scripts/backup-restore.sh` restores by overwrite

`do_restore` copies its `<db_path>` argument straight over whatever is there
(`cp "$backup_path" "$db_path"`, then copies `-wal`/`-shm` too), with an integrity check on the
source but **no refusal of a live destination**. Mitigating facts, all measured: it writes a
timestamped `state.db.pre-restore.<epoch>` first, it only runs when an operator types a target, and
`grep -rn "backup-restore" src/ runtime/bin/ dashboard/` returns **nothing** — no automated caller.
Severity **Low, operator-only, accepted**, with the constraint recorded forward: the Phase 17
dashboard's restore must be built against an alternate-destination model with explicit confirmation
(§28), not against this script.

### WAL side-file caveat

Read-only opens recreate `-shm` (32 768 B) and sometimes a 0-byte `-wal` beside the file — visible
in both the live dir and the new archive at 14:02 against a 13:54 creation time. Harmless here, not
manifest-covered, and a reason the documented restore procedure is *copy `state.db` alone, delete
destination side files first*; the suite asserts the sidecar-free restore.

### Test-run log (Phase 16C)

| Time (IST) | Command | Result |
|---|---|---|
| 13:52 | `HOME` + `node --version` guard, `sha256sum runtime/home/.automaton/state.db` | `HOME=…\runtime\home`, `v22.23.4`, `2a8aeb34…` |
| 13:54 | `$N runtime/bin/backup.mjs` | 4×`[PASS]`, archive `backups/2026-11-01_08-24-20`, 512 000 B verified |
| 13:55 | `$N reports/PHASE_16_16C_COMPARE.cjs live archive` | `IDENTICAL=true liveRows=10 backupRows=10` |
| 13:56 | 15K harness `--archive backups/2026-11-01_08-24-20 --out reports/PHASE_16_16C_RESTORE_RAW.json` | `status=PASS`, exit **0**, 10/10 verdicts |
| 13:57 | `sha256sum` live DB after backup + drill | `2a8aeb34…` — **unchanged** |
| 14:01 | explicit typecheck of the new suite | exit **2** — `TS2304: Cannot find name 'count'` (leftover from a rename); fixed |
| 14:01 | vitest run new suite | **7 passed / 1 failed** — my invented assertion: `expected 0 to be greater than 0` |
| 14:02 | same, after replacing that assertion with a measured hazard test | **8 passed / 8** |
| 14:02 | explicit typecheck again | exit **0** |
| 14:03 | `$N reports/PHASE_16_16C_EVIDENCE.cjs` (live + archive) | 37/1/10 live, 37/1/10 archive, `sha256LiveEqualsArchive: false` |
| 14:04 | `loadConfig` probe through the app's own loader | all §10 invariants hold, both API-key lengths 0 |
| 14:05 | `ls runtime/home/.automaton/wallet.json`; `grep -rn "backup-restore" src/ runtime/bin/ dashboard/` | `No such file or directory`; **no references** |

**The 14:01 red run was my error, not the code's.** I had asserted that `-wal`/`-shm` still exist
after closing the last connection; SQLite checkpoints and *deletes* them on a clean close. The
first run of that test measured the truth and refused my assumption. It was replaced with a test
that proves the real hazard instead: with a writer still open, a `cp` of the main file alone
restores **5** rows while the backup API of the same source restores **6** — the concrete reason
`cp` is not a backup mechanism, and a green-on-first-run suite would have hidden that.

Also caught by the explicit typecheck, not by vitest: `TS2304` on a stale `count` identifier after
renaming `count` → `rowCount`. The suite would have thrown at runtime; the typechecker found it
before any run. This is the third time in Phase 16 that the separate typecheck earned its keep.

---

## Section 9 / 16E — full security regression (DONE — and it found the phase's most serious gap)

Deliverable: `reports/PHASE_16_REGRESSION_RESULTS.md`, with the §9 five categories.

| | |
|---|---|
| Passed | **2057** tests / 529 suites / 82 files, exit 0, span **104.1 s** (`reports/PHASE_16_16E_FULL_RUN_FINAL.json`) |
| Failed | **0** |
| Skipped | **0** — `numPendingTests: 0` *and* a grep for `.skip`/`.only`/`.todo`/`xit(`/`xdescribe(` under `src/__tests__/` returned nothing, so "nothing was skipped" is verified |
| Blocked | **5** — coverage (B1), POSIX (B2, R-7), elevated Windows host (B3, R-1/16B), live-model call (B4, R-9), real-data restore (B5, R-2) |
| Not applicable | **4** — Docker/container, WSL path, LAN exposure, macOS |

Two disclosures that belong in the log rather than only in the report:

1. **My first "full run" was the wrong number.** The 14:09 run (81 files / 2049 tests) was taken
   *before* `phase16-live-model-tier.test.ts` was saved — `grep -c live-model-tier` on that JSON
   returned **0**. It is kept, not overwritten, and the suite was re-run; the delta is exactly the
   10th Phase 16 file (82−81, 529−526, 2057−2049). Reporting 2049 would have understated the
   phase by one of its own deliverables.
2. **Coverage cannot be measured here.** `vitest run --coverage` → `MISSING DEPENDENCY Cannot find
   dependency '@vitest/coverage-v8'`. `vitest.config.ts` nevertheless declares thresholds
   (60/50/55/60) — **the configured quality gate has never run and is inert.** Installing the
   provider adds a dev dependency to the existing install, so it was not done; it is an operator
   decision. `devDependencies` is `@types/node`, `tsx`, `typescript`, `vitest`.

### R-23 — the artifact the launcher runs did not contain Phase 16

The suite tests `src/`. `START_CONWAY.bat:56` executes `dist\index.js --run`. Measured before any
fix: newest `.js` under `dist/` was **2026-10-31 18:39**, i.e. before every 16A–16D change;
**0** of its 500 files mentioned `POLICY_ENGINE_MISSING`; `dist/security/live-model-preflight.js`
did not exist. No test could have caught that — a 2057-test green suite and an un-hardened
launcher were simultaneously true. This is the strongest argument in the phase for asking what
actually executes, rather than what is verified.

Closed by §2 protocol, in order: baseline manifest (`reports/PHASE_16_16E_DIST_PRE.manifest`,
520 files, 2 625 512 B, digest `5a5109f8…`) → rollback copy `backups/phase16/pre-16E-dist/`
manifest-verified **identical** → rebuild with the project-local compiler only, root `tsc` and
`tsc -p packages/cli`, both exit 0 → post manifest (`deb086df…`, 540 files) → orphan scan:
135 `.js`, **0** without a matching `src/*.ts`.

`npm run build` was deliberately **not** used: it is `tsc && pnpm -r build`, and pnpm resolves its
cache from `%LocalAppData%` (**R-17**), which would write outside the isolated `HOME`. `packages/`
holds exactly one workspace (`@conway/automaton-cli`, build = `tsc`), so invoking the two compilers
directly reproduces the build without that side effect.

Rebuilt-artifact safety smoke (the point of closing R-23 — verification has to follow the artifact):
`HOME` guard fires as the first output line; `--run` exits **2** with
`security.activationApproved is not true in automaton.json`; `state.db` SHA-256
`2a8aeb34…efbba` identical before and after; still no `wallet.json`; `C:\root` **does not exist**
on the host, so the `C:\root` string in `loop.test.ts` output is an in-memory fixture sandbox root
and nothing fell back to it (§3).

### Test-run log (Phase 16E)

| # | Command | Result | Time |
|---|---|---|---|
| 1 | `vitest run --reporter=json --outputFile=…FULL_RUN.json` (14:09) | 81 files / 2049 passed / 0 failed | 83.4 s span |
| 2 | `vitest run --reporter=json --outputFile=…FULL_RUN_FINAL.json` (14:23) | **82 files / 529 suites / 2057 passed / 0 failed / 0 pending**, exit 0 | 104.1 s span |
| 3 | `tsc --noEmit` (production) | exit **0** | — |
| 4 | explicit `tsc --noEmit` over the 10 Phase 16 test files + `live-model-preflight.ts` + the script | exit **0** | — |
| 5 | `vitest run --coverage <one file>` | `MISSING DEPENDENCY '@vitest/coverage-v8'`, exit 1 → **B1 Blocked** | — |
| 6 | secret scan over the phase's artifacts | 9 matches, **all** synthetic fixtures (listed in the report §7) | — |
| 7 | `dist` tree manifest (pre) | 520 files / 2 625 512 B / `5a5109f8…` | — |
| 8 | rebuild: root `tsc`, then `tsc -p packages/cli` | both exit **0** | — |
| 9 | `dist` tree manifest (post) | 540 files / 2 853 381 B / `deb086df…`; marker count 0 → **2** | — |
| 10 | orphan scan | 135 `.js`, 0 orphans | — |
| 11 | `node dist/index.js --run` | guard line, exit **2**, `state.db` unchanged, no wallet | ~1 s |
| 12 | `ls /c/root` | does not exist | — |

Load variance, reported rather than tuned away: `loop.test.ts` **80.1 s → 100.8 s** across two runs
of identical code. Its `discover_agents` test timed out once (12:15 run) at 180 s and was
root-caused in §16A to ~60 s of intrinsic cost plus host saturation, by A/B swapping
`loop.ts` against its pre-16A backup (**62.01 s** vs **63.37 s** — noise). It passed in both 16E
runs; `src/agent/loop.ts` re-hash-verified this session at `e97c188715655413…`. `testTimeout` was
not raised and no timing assertion was loosened.

---

## Test-run log (Phase 16A)

| Time (IST) | Command | Result |
|---|---|---|
| 11:54 | vitest run `runtime/home-guard.test.ts` + `security/phase16-policy-enforcement.test.ts` | **32 passed** (19 + 13) after fixing `joinTilde` and `enforced`/`policyRan` |
| 11:56 | `tsc --noEmit` (pinned Node 22.23.4) | exit **0**, no output |
| 11:57 | vitest run, 10 Phase 15 security suites | **26 failed / 338 passed** — emergency-stop contamination plus policy-gate fallout |
| 11:59 | quarantine of the leaked marker + `automatonDirs`/`clearEmergencyStop` fix | — |
| 12:01 | vitest run `security/phase16-emergency-stop-isolation.test.ts` | **6 passed** |
| 12:03 | same, after converting the vacuous-skip guard into a hard assertion | **6 passed** |
| 12:04 | vitest run, 10 security suites + `security/` | **13 failed / 370 passed** — contamination gone, pure call-site fallout |
| 12:06 | `tsc --noEmit` | exit **0** |
| 12:06 | explicit typecheck of the 4 new/changed test files + helper | exit **0** |
| 12:07 | explicit typecheck of the 4 modified Phase 15 suites | 1 error, **pre-existing** (`phase15-sandbox.test.ts:78` — five `allow*` fields absent from a literal; identical in `backups/phase16/phase15-sandbox.test.ts.pre-16A.bak`). Fixed by spreading `DEFAULT_SECURITY_CONFIG`, whose five fields are all `false` — the same falsy values the fields had at runtime when missing. |
| 12:08 | vitest run, 4 updated suites | **1 failed / 155 passed** |
| 12:09 | same | **0 failed** |
| 12:10 | vitest run, 13 security/runtime files | **403 passed / 403** |
| 12:10 | **full suite** (75 files), background | **2 failed / 1950 passed (1952)** in 92 s — `loop.test.ts` "forbidden patterns blocked", `agent/general-harness.test.ts` "sanitizes hostile web_fetch output". Both traced to the new gate, fixed below |
| 12:08 | live config re-read (`automaton.json` via pinned Node) | invariants table above produced from that output, not from memory |
| 12:14 | vitest run `loop.test.ts` + `agent/general-harness.test.ts` | **30 passed / 30** |
| 12:15 | full suite + `tsc --noEmit` re-run | **1 failed / 1951 passed (1952)** in 1286 s; `tsc --noEmit` exit **0** |
| 12:16–12:20 | A/B of the one failure (`loop.test.ts > discover_agents …`, "Test timed out in 180000ms") | **pre-existing slow test, not a 16A regression** — see below |
| 12:44 | `FORBIDDEN_PATTERNS` widened in `src/reliability/mechanic.ts` (backup + pre-hash recorded first; file mtime 12:44:18 confirms) | diff = 4 lines, pattern list only (11 → 13 entries) |
| 12:45–12:47 | `tsc --noEmit` after the mechanic change (pinned Node 22.23.4) | exit **0**, zero output |
| 12:45–12:47 | explicit typecheck of the 4 Phase 16 test files | exit **2** — `TS2322` in the new 16A.4 file (`overall: "warn"`); the file had never been typechecked, only run |
| 12:48 | same typecheck after `"warn"` → `"critical"` | exit **0**, zero output |
| 12:48:30 | vitest run `security/phase16-self-healing-safety.test.ts` + `phase15-self-healing.test.ts` | **68 passed / 68** (28 + 40), 1.73 s |
| 12:52 | `node reports/PHASE_16_PATTERN_PROBE.cjs` | 8 previously-uncovered names now MATCH; `prune_expired_leases` correctly still unmatched |
| 12:49–12:52 | live config, live DB hash, marker and env re-read | invariants table above all hold; DB `512 000 B`, hash unchanged; `EMERGENCY_STOP` absent; both activation env vars `undefined`; `wallet.json` absent |
| 13:00 | edits to `src/security/audit-chain.ts` + `src/agent/tools.ts` (16A.5 R-6), backups taken first | `tsc --noEmit` exit **0** |
| 13:02:48 | vitest run new `security/phase16-audit-visibility.test.ts` | 1 failed / 9 passed — the `inference` tool name needs the `external_api` capability grant; assertion fixed to match the *real* gate order, not the code I wished for |
| 13:03:31 | vitest run, 5 suites (audit visibility + treasury + penetration + tool security + incident response) | **146 passed / 146** |
| 13:03:54 | vitest run `chain.test.ts` | **13 passed / 13** |
| 13:04 | `wsl --status`, `wsl -l -q`, `tsc --noEmit` (src + 2 test files) | WSL2 default but **no distro**, component disabled → R-7 BLOCKED; typechecks exit **0** |
| 13:05–13:06 | heartbeat suite, two isolated timed runs | **2.815 s / 2.775 s wall**, both pass → R-8 is host saturation, not test defect |
| 13:09:17 | vitest run `security/phase16-live-model-preflight.test.ts` | **23 passed / 23** |
| 13:11:07 | `tsc --noEmit` + explicit typecheck of the 4 new files | first run exit **2** (TS2352 `Record<string, unknown>` cast in the new module), fixed with a typed `keyof AutomatonConfig` list; then exit **0** |
| 13:11:33 | `tsx scripts/phase16-live-model-preflight.ts` against the live install | exit **2**, `verdict=SAFETY_GATE_FAILED`, 16/18 PASS, `credentialPresent=false approvalPresent=false` — the gate refuses the live tree as designed |
| 13:19:34 | red-first run of `security/phase16-package-name-hardening.test.ts` (nothing implemented yet) | **7 failed / 5 passed** — decisive line: `install_npm_package -forgery: expected 'Installed: -forgery' to contain 'Blocked:'` |
| 13:21:13 | same suite after implementing the strict validator | **1 failed / 13 passed** — my own non-vacuity assertion rejected `--userconfig=/tmp/evil` as a *legacy* bypass: `=` was never admitted. Finding narrowed, comment corrected. |
| 13:22–13:23 | npm probes D/E/F on pinned npm 10.9.9 | side effect: `npm install -g --phase16probe` linked the **project itself** into the runtime Node dir (junction + 6 shims) |
| 13:23 | revert `npm uninstall -g @conway/automaton` → `rmdir @conway` | `removed 1 package`; `node_modules` back to `corepack npm`; no shims; live DB hash still `2a8aeb34…efbba` |
| 13:25:22 | vitest run `phase16-package-name-hardening.test.ts` | **15 passed / 15** |
| 13:25:34 | regression: `command-injection.test.ts` + `policy-engine.test.ts` | **128 passed / 128** (102 + 26) — every previously valid package name still valid |
| 13:25:34 | `tsc --noEmit` (prod) | exit **0** |
| 13:26:09 | explicit typecheck of the new test file | first run exit **2** (`TS2353` — `config` is not a `PolicyRequest` field; vitest strips types so the suite had been green on a non-typechecking file), fixed to the real shape; then exit **0** |
| 13:26:09 | live DB re-hash after all 16A.6 work | `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba` — **unchanged** |
| 13:23–13:35 | `reports/PHASE_16_WINQUOTING_PROBE.cjs`, pinned Node 22.23.4, `COMSPEC=C:\WINDOWS\system32\cmd.exe` | **injection reproduced**: `cat '…nope&echo INJECTED_AMP'` → exitCode **0**, stdout `INJECTED_AMP'`; same for `\|`. First inline attempt was invalid (bash ate the backslashes) and was replaced by the file probe. |
| 13:23–13:35 | `tsx` probe of `confineToRoot` with metacharacter paths | `nope&echo INJECTED` → **ok**, `protected=false` — confinement passes it, so the `read_file` fallback is reachable from model input |
| 13:35:46 | red-first run of `security/phase16-win-shell-quoting.test.ts` | **2 failed / 11 passed** — refusal assertions received `exit_code: 0`, i.e. the command was built |
| 13:37:03 | vitest run 4 suites (R-18 + R-16 + `tools-security` + `command-injection`) | **201 passed / 201** (13 + 15 + 71 + 102) — no existing test required changing |
| 13:37+ | `tsc --noEmit` + explicit typecheck of both new test files | exit **0** / exit **0** |
| 13:37+ | live DB re-hash after 16A.7 | `2a8aeb34…efbba` — **unchanged** |
| 13:44:58 | vitest run `src/__tests__/security` + `src/__tests__/runtime` (16A close-out) | **143 passed / 143** across 9 files |
| 13:45–13:50 | 16B re-execution: `manage-bde -status`, `Get-Tpm`, `Win32_Tpm`, Secure Boot registry, `Get-MpComputerStatus`, `Get-MpThreat*`, `netsh advfirewall show allprofiles`, `Get-NetFirewallRule`+filters, `whoami /groups` `/priv`, `net localgroup Administrators`, `Get-Service`, `Win32_OperatingSystem` | all values reproduced from the 11:41 capture; four items still elevation-blocked; no protector query, no state change |
| 13:47 | `Get-CimClass Win32_SecureBootSetting` | **Not found** → the invented operator command was removed from the report before it could be handed over |
| 13:47+ | `Get-NetTCPConnection -State Listen` | `8787: no listener`; non-local listeners `:::3001` (FreeLLMAPI, PID 12652, untouched), `<host-lan-ip>` Qoder/chrome |

### Call-site updates to existing suites (why each change is legitimate, not a test-softening)

13 tests broke. All 13 were call sites that dispatched a capability-bearing tool *without*
a policy engine — i.e. they were testing the layers behind the gate while themselves
exercising the bypass. Per "update all call sites safely":

- `phase15-penetration` — 6 sites now assemble the engine with `makePolicyEngine()`,
  exactly as `src/index.ts` does. The test whose premise was the bypass ("an engine-less
  dispatch still cannot spend…") was **rewritten to assert the new invariant**:
  `POLICY_ENGINE_MISSING`, `not.toContain("Treasury denied")`, `execCalls === 0`, and
  revocation still enforced for non-capability tools. Its comment records that it was
  F7 and that 16A.1 closed it.
- `phase15-treasury` — describe renamed to "treasury guard behind the mandatory policy
  layer"; 4 sites given an engine; **a new test added** asserting an engine-less
  financial dispatch is refused before `treasury_authorizations` gains a row.
- `phase15-tool-security` — timeout site given an engine plus `lockdown: false` (the
  lockdown rule now runs and would deny before the body could time out); the audit-row
  query now selects `WHERE event_type = 'tool.authorized'` because the deliberate
  engine-less dispatch correctly produces a `policy.skipped` row as its newest event.
- `phase15-sandbox` — `exec` sites given an engine; sandbox deny-list assertions and
  `execCalls` unchanged.
- Two assertions changed from a specific layer's wording to either layer's reason code
  (`SPEND_LIMIT_EXCEEDED` | `Treasury denied`), because the engine's financial rules read
  the *same centralized policy* as the guard and now answer first. The security claim in
  each test — that no cent moved — is asserted unchanged, and one test pins the exact
  rule (`financial.transfer_max_single`, "single transfer max of 0 cents").
- Invalid synthetic addresses (`"0xabc"`) replaced with a well-formed one in 7 sites:
  argument validation now runs, and refusing to construct a malformed transfer is the
  control working, not a regression.

`src/__tests__/helpers/dispatch.ts` (new) holds the shared engine/turn constructors so
four suites do not each re-implement the production assembly.

### The two full-suite failures (found only by running everything, not just the security files)

**`loop.test.ts > forbidden patterns blocked`.** Measured by temporarily pointing the
assertion at the field the test ignored, then restoring the file from a copy:

```
Received: "Policy denied: FORBIDDEN_COMMAND — Blocked: Delete .automaton directory (pattern: rm\s+(-rf?\s+)?.*\.automaton)"
```

The loop never passed a policy engine, so the `rm -rf ~/.automaton` command was refused by
the inline secondary net inside the `exec` body and the text landed in `result`. With
`agent/loop.ts` now always carrying an engine, the engine's `FORBIDDEN_COMMAND` rule
refuses first and the refusal lands in `error` — the same decision, one layer earlier,
which is the point of 16A.1. The test now asserts that reason code and the word
`Blocked` in `error`, and keeps `conway.execCalls.length === 0`, which is the actual
security claim. The inline net stays as defense-in-depth for a dispatch that reaches the
body.

**`agent/general-harness.test.ts > sanitizes hostile web_fetch output`.** Its fixture is
`x402_fetch`, explicitly classified `["financial","network_access","wallet_signing"]`
(`src/security/tool-authorizer.ts:102`), and the test built a `HarnessContext` with no
`policyEngine` — so it hit the new gate:
`Error: Policy denied: POLICY_ENGINE_MISSING …`. This was a real gap, not a test artifact:
one production execution path assembled its context without the layer. Fixed centrally by
constructing the engine in the shared `createHarness()` helper, which also made the
per-test `(harness as any).context.policyEngine = …` injection redundant; that injection
is removed and the stale comment claiming "the harness wrapper dispatches without a policy
engine" corrected. Both files are backed up in `backups/phase16/` with pre-change hashes.

### The remaining full-suite failure is pre-existing slowness, measured not assumed

`loop.test.ts > Agent Loop > discover_agents turns are retained in context (not classified
as idle)` failed with `Test timed out in 180000ms` in the 12:15 run. It passes in
isolation, so the cause had to be established rather than waved at. Measured by swapping
`src/agent/loop.ts` between the 16A version and `backups/phase16/loop.ts.pre-16A.bak` and
running that one test with `-t "discover_agents"`:

| Configuration | Test duration |
|---|---|
| pre-16A `loop.ts` (baseline) | **62.01 s** |
| 16A `loop.ts` (with the default-engine fallback) | **63.37 s** |

A 2 % difference is noise; the test costs ~60 s on its own and only breaches the 180 s
per-test ceiling when 75 files run concurrently. `src/agent/loop.ts` was restored to the
16A version and hash-verified (`e97c18871565541395c3becfdf763b5e0cf9be6e1ac12a888e9883a82a79d83f`)
after the experiment.

Recorded as a known suite-quality risk, **not fixed here**: shrinking it would mean
editing the sleeps in an unrelated test, which is the kind of change that silently
weakens a timing assertion. Full suite, this run: **1951 passed / 1 timed out / 1952**.

---

## Backups and change record (Section 2 protocol)

| File | Backup | Pre-change SHA-256 |
|---|---|---|
| `src/security/emergency-stop.ts` | `backups/phase16/emergency-stop.ts.bak` | `5b0e3394d3cf2649cb67a775f3cde33600f65d260ecd6c2aa8bc4de22a66f931` |
| `src/__tests__/phase15-penetration.test.ts` | `backups/phase16/phase15-penetration.test.ts.pre-16A.bak` | `d9b64c76b55c76056e38bbb115600cc82cf4829ccf0acd27b2e2bc2e417cd06a` |
| `src/__tests__/phase15-sandbox.test.ts` | `backups/phase16/phase15-sandbox.test.ts.pre-16A.bak` | `5af45e289f2fb95111362f6f46c3f63c6d7f2c400a9122b4832453002ff0c49b` |
| `src/__tests__/phase15-tool-security.test.ts` | `backups/phase16/phase15-tool-security.test.ts.pre-16A.bak` | `cf61c289e6076e022575acc601cdd263b55b18be2638560cf6a355bbb3f7dbf2` |
| `src/__tests__/phase15-treasury.test.ts` | `backups/phase16/phase15-treasury.test.ts.pre-16A.bak` | `7ea7c998947de02de38c67bfcfdd5a0ec920a4e46c1064000efbc995e75c849b` |
| `src/agent/loop.ts` | `backups/phase16/loop.ts.pre-16A.bak` | `3cedc7e85c877801ea2d23c34e0130b6e06b3918212e96c41e34e666dbe1b657` |
| `src/__tests__/agent/general-harness.test.ts` | `backups/phase16/general-harness.test.ts.pre-16A.bak` | `056368c20498b05593d67bccb28890089d61f8be57bed6b2064363e077dea99d` |
| `src/__tests__/loop.test.ts` | `backups/phase16/loop.test.ts.pre-16A.bak` | `113b496d34b8dc35c53a8e4b85ecd661491c747662172a075c7d84f62cd1e1fe` |
| `src/reliability/mechanic.ts` | `backups/phase16/mechanic.ts.pre-16A4.bak` | `1174417f717792caf267a1cdeea053e6dc8623e86610b54296f896cc87bbe7b1` (8 336 B) → post-change `3ba85fa8c839e2dca388ce0ce80ada5f29219e75bb9974903aa01a8754f4a621` |
| `src/__tests__/security/phase16-self-healing-safety.test.ts` | new file (16A.4), no prior version | `4da79f8d4f256f6b1c75494f3ce3b0b1c7df5526621de160c02c91589f4bbc7b` (8 900 B) after the `OverallHealth` fix |
| `src/security/audit-chain.ts` | `backups/phase16/audit-chain.ts.pre-16A5.bak` | `0f5e84246648fc00853a344258dd925abd1d81a148195ebe6e7170455595adfb` (10 338 B) → post-change `fc8b997b36f1fc69b454af007d8cca05e402669f82e23fd0d457d130a9d9a398` |
| `src/agent/tools.ts` | `backups/phase16/tools.ts.pre-16A5.bak` | `e5c3a320192d9143239437819d5557b965e51777897bb86d4d5fcb4590e5b156` (133 320 B) → after 16A.5 `3c1ff852236bc5075782aa4584821b922d01651125a5d8928b3950d37deb5aeb` → after 16A.6 `8dfc9327e3f931ce82960c973f308167d26d166fde35f20978c23f0792703e95` (134 711 B) |
| `src/agent/policy-rules/validation.ts` | `backups/phase16/validation.ts.pre-16A5.bak` | `2c30ba0b950eeab302c6b03b08b5f15529149e2fc5d5576e66df759ff8b9800c` (5 690 B) → post 16A.6 `fb00194d82eff525cf7f04887efaf54c28d873b6737afd1b3273673f775c102a` (6 798 B) |
| `src/self-mod/tools-manager.ts` | `backups/phase16/tools-manager.ts.pre-16A5.bak` | `97f2fc541720a92e463174d462ce0d1c5850e4bd2c692fbb1e33fb1541641588` (2 607 B, backup verified byte-identical) → post 16A.6 `e94d32c295b44b26dbced46585dfe3f8d3de33b0a76897aa745dc5f4ccc330dc` (2 770 B) |
| `src/__tests__/security/phase16-package-name-hardening.test.ts` | new file (16A.6) | `dc8aa76bbbb6376ace6ea5da36d6076796ee09989a56e54d65a0263582b4c0c7` (7 710 B), 15 tests |
| `src/agent/tools.ts` (16A.7) | same `backups/phase16/tools.ts.pre-16A5.bak` | `8dfc9327e3f931ce82960c973f308167d26d166fde35f20978c23f0792703e95` → post 16A.7 `16dac75c72ee34019ab1700f6c25d01851bd6f77aa1bd513d201391d65d52bbf` (134 901 B): local `escapeShellArg` deleted, both call sites use `quoteShellArg` |
| `src/security/shell-quote.ts` | new file (16A.7) | `751bb24bd8b9a9e9dd26c214e71c91007a8857b0dfe141629dbfe686740d0af8` (3 336 B) |
| `src/__tests__/security/phase16-win-shell-quoting.test.ts` | new file (16A.7) | `9299ea4e6bbed35ad1eaca264c752efb905444cc8fe7a805262a83a5c3a4f3d3` (8 283 B), 13 tests |
| `reports/PHASE_16_WINQUOTING_PROBE.cjs` | new file (16A.7 evidence, re-runnable) | 1 517 B |
| `src/security/live-model-preflight.ts` | new file (16A.2) | — |
| `src/__tests__/security/phase16-live-model-preflight.test.ts` | new file (16A.2) | — |
| `src/__tests__/security/phase16-audit-visibility.test.ts` | new file (16A.5) | — |
| `scripts/phase16-live-model-preflight.ts` | new file (16A.2/16D runner, read-only) | — |
| `reports/PHASE_16_PATTERN_PROBE.cjs` | new file (16A.4 evidence, re-runnable) | — |

Rollback for the 16A.4 change is a single file copy:
`cp backups/phase16/mechanic.ts.pre-16A4.bak src/reliability/mechanic.ts`. The diff is
four lines inside `FORBIDDEN_PATTERNS` and nothing else — two existing entries rewritten
(`disable\s+` → `disable[_\s-]+`; `(grant|elevate)\s+` → `(grant|elevate|revoke|widen)[_\s-]+`)
and two new entries added (activation approval, tool-permission allowlist). No registry
entry, no classification signature, and no execution path changed.

No existing backup, database or report was deleted. Protected systems (OmniRoute/OmniRoad,
FreeLLMAPI, Ollama, OpenCode, Qoder global config, existing MCP servers, TradingAgents,
ADRE-RN, Paperclip AI, Windows services, Windows security settings) were not modified;
FreeLLMAPI's listener on `0.0.0.0:3001` (PID 12652) was observed and left untouched.

**One unintended change was made and reverted (16A.6).** The npm flag-confusion probe
installed the Conway project itself into `runtime/node-v22.23.4-win-x64` — a junction at
`node_modules/@conway/automaton` plus `automaton`/`conway-automaton` shims in `.`, `.cmd`
and `.ps1` form. That directory is part of the pinned runtime, i.e. inside the install
Section 2 says not to perturb. It was unlinked with `npm uninstall -g @conway/automaton`
(the junction was deliberately not deleted with `rm -rf`, which on a Windows junction
recurses into the real project), the empty scope dir removed with `rmdir`, and the restore
verified by listing (`node_modules` = `corepack`, `npm`; no shims), by confirming the
project tree intact, and by re-hashing the live DB to `2a8aeb34…efbba`. No file outside
`runtime/node-v22.23.4-win-x64` was created except npm's own cache log under
`%LocalAppData%\npm-cache` (see **R-17**).

---

## Checkpoint status

| Checkpoint | Status |
|---|---|
| Section 3 — HOME isolation guard + tests | **DONE** |
| 16A.1 — mandatory policy enforcement + bypass tests | **DONE** |
| 16A.2 — live-model security preparation | **DONE as preparation** — `src/security/live-model-preflight.ts` (18 checks) + `scripts/phase16-live-model-preflight.ts` executed; 23/23 tests; live verdict `SAFETY_GATE_FAILED`, `credentialPresent=false` → testing stays PENDING CREDENTIAL APPROVAL |
| 16A.3 — stronger isolation evaluation | evaluation written (`reports/PHASE_16_ISOLATION_EVALUATION.md`); doc integration in `docs/PHASE_16_OVERVIEW.md`; tiers (ii)/(iii) need operator approval |
| 16A.4 — self-healing safety verification | **DONE** — self-healing confirmed disabled by construction; 68/68 tests; pattern-net gap found by probe and closed (16A.4-DEFECT-3) |
| 16A.5 — R-6/R-7/R-8/R-10 investigation | **DONE** — R-6 partly fixed + 3 new risks recorded (R-11, R-12, R-13); R-7 BLOCKED (no POSIX runner); R-8 measured 2.8 s isolated; R-10 closed and re-verified. 10 + 23 new tests |
| 16A.6 — npm package-name flag confusion | **DONE** — one validator shared by 4 call sites; 15 new tests (red-first), 128 regression tests still green; R-16 closed, R-17 (npm writes outside the isolated HOME) recorded not fixed |
| 16A.7 — Windows shell quoting (R-18) | **DONE** — injection reproduced by probe, reachability traced, `quoteShellArg` refuses cmd.exe metacharacters on win32 while the POSIX branch is unchanged; 13 new tests (red-first), 201 green across 4 suites, no existing test changed |
| 16B — Windows administrator verification | **DONE to the limit of a filtered token** — `reports/PHASE_16_WINDOWS_VERIFICATION.md`; 4 items UNVERIFIED-BLOCKED with an exact elevated read-only instruction; R-1 reworded (UAC-filtered Administrator, not standard user) |
| 16C — real-data backup/restore validation | **PARTIALLY VERIFIED** — live DB backed up (online backup API) and restored into a disposable path with 10/10 harness verdicts PASS and the active file provably unchanged; `REAL_DATA_RESTORE = NOT YET PROVABLE` on measured grounds (37 tables, 1 non-empty, 10 rows, all migration bookkeeping); 8 new tests; R-20 recorded |
| 16D — isolated live-model testing | **DONE as preparation** — `runtime/model-test-home/` created (config only, 13 treasury fields written to 0, no wallet, no DB); the gate's `runtime`-mode/`isolated`-mode contradiction recorded as **R-22** and closed by adding `--test-home`; four tiers executed and captured verbatim (`reports/PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt`): runtime tier refuses, misuse refused, isolated tier passes **18/18** and stops at `credentialPresent=false approvalPresent=false`, and a fake key + `CONWAY_LIVE_MODEL_APPROVED=APPROVED` reaches `verdict=READY`; 8 new CLI-level tests; **`LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL`** still stands because no real credential exists and none was entered. See `reports/PHASE_16_LIVE_MODEL_TESTING.md`; **R-21** (live config inherits non-zero caps) recorded, not auto-fixed |
| 16E — full security regression | **DONE** — 82 files / 529 suites / **2057 passed, 0 failed, 0 pending**, span 104.1 s; typecheck exit 0; no `.skip`/`.only` in the suite; **found and closed R-23: `dist/` predated all of Phase 16, so the launcher ran un-hardened code** (backed up, rebuilt, orphan-scanned, `--run` still exits 2 with `state.db` unchanged). 5 Blocked + 4 Not-applicable items recorded honestly. `reports/PHASE_16_REGRESSION_RESULTS.md` |
| Phase 17 — dashboard | data-source inventory complete (`reports/PHASE_16_DATASOURCE_INVENTORY.md`) |

## Remaining risks carried into 16B–16E

- **R-3 is closed at the dispatch layer.** Not closed: any future `executeTool` caller
  inside `src/` that omits the engine now gets refusals rather than a policy run. The
  type still marks the parameter optional; the runtime enforces it. Recorded rather than
  silently accepted.
- **R-4 unchanged** — application-level controls are not OS isolation.
- **New, requires operator action:** the project root grants `Authenticated Users:(M)`,
  so any local account can edit Conway's source — which undermines every in-process
  control above. Tightening that ACL needs elevation and is an approval item, not an
  automatic action.
- **Suite hermeticity changed by design:** because the emergency-stop read is fail-closed,
  a genuine engagement in the live install makes every Conway process — test harnesses
  included — report the stop engaged until a named human clears it. That is the intended
  behaviour of an emergency stop, and it is recorded here so a future red suite is not
  misread as a new defect.
- **R-18 closed, with one design item left.** The `read_file` fallback and the
  installed-tool wrapper are the two injection sites fixed. The correct replacement for the
  second — `execFile` with an argv array instead of a shell string — is a change to how
  installed tools execute, not to their guarding, so it is designed in
  `reports/PHASE_16_CODE_SECURITY.md` and **not** implemented. `src/git/tools.ts:219` keeps
  its own POSIX `escapeShellArg`; its inputs are config-sourced, so it is recorded rather
  than widened into this change.
- **R-17 (new, recorded, not fixed):** `HOME` isolation does not extend to the toolchains
  Conway shells out to. npm resolves its cache from `%LocalAppData%`, so the 16A.6 probes
  wrote `_cacache`, `_logs` and `_npx` under the Windows user profile while
  `runtime/home/npm-cache` stayed absent. Fixing it means setting `npm_config_cache` (or
  `LOCALAPPDATA`) for child processes, which changes host behaviour and touches how npm
  resolves for anything else running as this user — an approval item. Relevant to Phase 17,
  which needs `npm install` for the dashboard.
- **R-20 (new, recorded, not fixed):** `scripts/backup-restore.sh` `do_restore` overwrites whatever
  `<db_path>` the operator types, checks only the source's integrity, and copies `-wal`/`-shm`
  blindly. It is not wired to anything — `grep -rn "backup-restore" src/ runtime/bin/ dashboard/`
  returns nothing — and it does write a `state.db.pre-restore.<epoch>` copy first, so it is rated
  Low and left alone. The forward constraint that matters: the Phase 17 dashboard restore path must
  use an alternate destination plus explicit confirmation (§28), never this script.
- **16C is PARTIALLY VERIFIED by design, not by oversight.** Backup and restore mechanics are
  VERIFIED against the real live file; genuine *real-data* recovery is NOT YET PROVABLE because the
  database holds 10 rows of migration bookkeeping and zero user rows. No rows were fabricated to
  upgrade the label. Also not claimed: a live concurrent-writer race on the production file (the
  agent is inactive, so that proof comes from the equivalent fixture test), off-host durability, and
  encryption-at-rest (16B). The live DB stays at schema **V11** while the code is **V13** (R-14) —
  migrating it means opening it through `createDatabase()`, which rewrites the active file, so that
  is an operator decision with a fresh archive taken first, not something 16C did quietly.
- **Operational finding that changes how a backup must be checked:** an archive of `state.db` has
  *different bytes* from the live file (`2cc9d26c…` vs `2a8aeb34…`) while its content is identical.
  Any acceptance test that hashes live-vs-backup fails every good backup. Use `integrity_check` plus
  content equality; reserve hashes for archive-vs-manifest tamper detection.
- **R-16 closed, with the severity narrowed by measurement.** The reachable payload class
  was leading-dash values, not value-bearing switches (`=` and space were always rejected).
  The demonstrated consequence is a wrong-target install, not code execution. `reports/PHASE_16_CODE_SECURITY.md`
  carries the probe output.
- **R-21 (new, recorded, deliberately NOT auto-fixed):** executing the 16D gate showed that the
  live lockdown config resolves **non-zero** money caps — `maxMonthlyTransferCents=100000`,
  `agentBudgetCents=200000`, `childBudgetCents=50000` — because `automaton.json` predates those
  fields and `src/config.ts:45-48` deep-merges over `DEFAULT_TREASURY_POLICY`. Not a live exposure
  (lockdown, empty allowlist, no wallet, no activation flag — all re-read through the app's own
  loader), but a defence-in-depth gap and a structural hazard for any future field. The remedy is
  three lines in the operator's config; silently editing the operator's live treasury is not mine
  to do. The isolated 16D fixture writes all 13 fields to `0` by construction.
- **R-22 closed — a gate that can never say yes is not a control.** The 16D script validated `HOME`
  in `runtime` mode and then asserted the `isolated` property, so it could only ever refuse. Found
  by *executing* it, not by its 23 unit tests. Fixed by reusing the guard's existing `isolated`
  mode behind `--test-home`, leaving default behaviour intact and adding 8 CLI-level tests.
- **R-23 closed — and it is the phase's most serious finding.** `dist/` predated every Phase 16
  change, while `START_CONWAY.bat` launches `dist\index.js`: 0 marker files, no
  `live-model-preflight.js`, newest output 2026-10-31 18:39. Verified source ≠ verified artifact.
  Backed up (digest-identical rollback), rebuilt with the project-local `tsc` only (avoiding the
  `pnpm` profile write of R-17), orphan-scanned, then re-smoked against the artifact itself.
- **Coverage is unmeasurable in this install, and that is itself a finding.** `vitest.config.ts`
  sets 60/50/55/60 thresholds but `@vitest/coverage-v8` is absent, so the gate has never run. Any
  claim about test coverage in Phase 16 is therefore about *counts executed*, not percentage of
  code under test.
