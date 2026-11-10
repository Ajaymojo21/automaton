# Phase 16D — Isolated Live-Model Testing Environment

**Section 8 of the Phase 16 brief.** Executed 01-11-2026, 13:39–14:15 IST.

```
LIVE MODEL TESTING = PENDING CREDENTIAL APPROVAL
```

That verdict is now **earned by construction**, not asserted: an isolated home exists that passes
**18/18 safety checks**, and the only terms still false are `credentialPresent=false` and
`approvalPresent=false` — both of which belong to the operator (§29 items 6 and 1). No credential
was entered, no model was called, nothing was activated.

Raw capture of all four tiers: `reports/PHASE_16_LIVE_MODEL_PREFLIGHT_RAW.txt`.

---

## 1. The defect 16D found in its own preparation gate

`scripts/phase16-live-model-preflight.ts` evaluated the check `home.isolated_test_tree` from
`runLiveModelPreflight({ homeIsIsolatedTestHome: resolvedHome !== liveHome })`, but it obtained
`resolvedHome` after calling `inspectConwayHome()` in its **default `runtime` mode** — which
*requires* `HOME` to equal the live install's canonical home (`src/runtime/home-guard.ts:232-240`).

So the two conditions were mutually exclusive:

| Step | Requirement | Consequence |
|---|---|---|
| `inspectConwayHome()` (runtime mode) | `HOME === runtime\home` | aborts before the gate runs otherwise |
| `homeIsIsolatedTestHome` | `HOME !== runtime\home` | can only be true when the step above already aborted |

**`home.isolated_test_tree` could never pass, therefore the script could never print `READY`.**

Fail-closed is the right direction for a security gate, but a gate whose success state is
unreachable is not a control — it is a dead end that also hides whether the rest of the preparation
is correct, because every run stops at the same two failures regardless of the configuration. The
brief's §8 requires an isolated model-testing *environment*; you cannot demonstrate you have one
with a script that structurally denies its existence.

Fix (`scripts/phase16-live-model-preflight.ts`, backed up as
`backups/phase16/phase16-live-model-preflight.ts.pre-16D.bak`, pre-hash
`dc6dc95d585ed0be93d003be6ad709ad46d4b1f6f779845c692ed01be1fea138`):

- a `--test-home <dir>` switch that re-validates through the guard's **`isolated` mode**
  (`home-guard.ts:251-270`), which already exists for exactly this purpose and additionally refuses
  the user profile and a filesystem root;
- `process.env.HOME` is reassigned **inside the child script only**, so `stateDir()`,
  `loadConfig()` and `readEmergencyStop()` all resolve against the test tree instead of the live
  one. Nothing on disk changes; recorded as risk **R-22** and closed.

The default (no-flag) behaviour is deliberately unchanged, because "pointed at the live state tree"
must stay a refusal.

## 2. The four tiers, as executed

Pinned Node 22.23.4, `HOME=<repo-root>\runtime\home`, repo root cwd.

| # | Invocation | Expected | Actual |
|---|---|---|---|
| 1 | `…phase16-live-model-preflight.ts` | refuse — live tree | `tier=runtime`, **exit 2**, `verdict=SAFETY_GATE_FAILED`, fails `home.isolated_test_tree`, `treasury.all_zero` |
| 2 | `… --test-home runtime/home` | refuse — spoof attempt | **exit 2**, `HOME_NOT_ISOLATED — mode "isolated" requires a sandbox home, not the runtime home`; no verdict table printed (guard stops first) |
| 3 | `… --test-home runtime/model-test-home` | safety clean, stop at credential | `tier=isolated-test-home`, **18 PASS / 0 FAIL**, `credentialPresent=false approvalPresent=false`, **exit 1**, `verdict=PENDING_CREDENTIAL_APPROVAL` |
| 4 | `… --test-home runtime/no-such-home` | refuse — not a real dir | **exit 2**, `HOME_NOT_A_DIRECTORY` |

Tier 2 is the important one for §3's HOME-isolation mandate: naming the live state directory as a
"test home" is rejected by the guard rather than accepted on the operator's word.

## 3. The 18 gate terms (tier 3, verbatim from the run)

```
PASS  home.isolated_test_tree        homeGuardOk=true isolatedTestHome=true
PASS  agent.activation_closed        activationApproved=false
PASS  env.activation_flags_unset     CONWAY_ACTIVATION=unset CONWAY_ALLOW_WALLET_CREATION=unset
PASS  lockdown.engaged               lockdown=true
PASS  tools.allowlist_empty          allowedTools=0
PASS  capabilities.no_privileged_grant none granted
PASS  wallet.no_material             walletMaterialPresent=false
PASS  treasury.all_zero              all treasury limits are 0
PASS  credential.not_in_config       config holds no credential material
PASS  treasury.x402_domains_empty    x402AllowedDomains=0
PASS  financial.disabled             allowFinancialTools=false
PASS  shell.disabled                 allowHostShell=false
PASS  self_modification.disabled     allowSelfModification=false
PASS  replication.disabled           allowReplication=false maxChildren=0
PASS  publishing.disabled            allowExternalExposure=false
PASS  sandbox.enabled                sandboxEnabled=true
PASS  self_healing.disabled          selfHealingEnabled=false
PASS  emergency_stop.not_engaged     engaged=false
```

Mapping to §8's requirements — *no wallet*: `wallet.no_material`; *no financial permissions*:
`treasury.all_zero` (all 13 fields) + `financial.disabled` + `treasury.x402_domains_empty`;
*no publishing*: `publishing.disabled`; *no replication*: `replication.disabled` + `maxChildren=0`;
*no unrestricted shell/filesystem*: `shell.disabled` + `sandbox.enabled` + `tools.allowlist_empty`;
*no self-modification*: `self_modification.disabled` + `self_healing.disabled`.

## 4. The environment that was created

`runtime/model-test-home/.automaton/automaton.json` — 1 547 bytes, 50 lines, SHA-256
`e69c8495aba170e82fffeaa801582757dba1d6f009eae794e24a145753c877b2`. That directory holds one file
and nothing else.

Deliberately **config-only — no `state.db`, no `wallet.json`, no `skills/`, no heartbeat**. §3's
rule against a second state tree is honoured: the 16D fixture adds no database, and a test asserts
that none appears (`does not create a database anywhere in the test home`).

Its `treasuryPolicy` block writes **all 13 numeric fields to 0 explicitly**, including
`maxMonthlyTransferCents`, `agentBudgetCents` and `childBudgetCents` — see §5.

What a live-model run in this home would cover, once a credential is supplied by the operator:
synthetic prompts only; single turn; `maxTurnsPerCycle: 3`; tool allowlist empty so the model can
talk but cannot act; spend tracking asserted at zero; and the gate re-evaluated immediately before
the call, not cached.

## 5. New risk R-21 — the live lockdown config silently inherits non-zero money caps

Tier 1 failed `treasury.all_zero` with `non-zero: maxMonthlyTransferCents, agentBudgetCents,
childBudgetCents` — three fields that **do not appear in the live `automaton.json` at all**.

`src/config.ts:45-48` merges `{ ...DEFAULT_TREASURY_POLICY, ...(raw.treasuryPolicy ?? {}) }`. The
live file pins 10 fields to zero; the three above were added to `DEFAULT_TREASURY_POLICY`
(`src/types.ts:604-606`) after that file was written, so they resolve from the default:

| Field | Resolved on the live install | Meaning |
|---|---|---|
| `maxMonthlyTransferCents` | **100 000** ($1 000) | monthly transfer ceiling |
| `agentBudgetCents` | **200 000** ($2 000) | per-agent budget |
| `childBudgetCents` | **50 000** ($500) | per-child budget |

These are not inert. `src/security/treasury-guard.ts:404`, `:414`, `:424` read all three as
enforcement caps, so a "every monetary limit is zero" installation actually carries three
non-zero limits, and the `LOCKDOWN_TREASURY_POLICY` constant (`src/types.ts:614-628`), whose doc
comment promises "Every monetary limit is zero", is not what the live config resolves to.

Severity **Medium** (defence-in-depth gap, not a live exposure). Compensating controls, all
re-read through the application's own loader during 16C and unchanged since:
`lockdown=true`, `activationApproved=false`, `allowedTools=[]`, `allowFinancialTools=false`,
`maxChildren=0`, no wallet material, both activation env flags unset. Nothing reaches the caps.

**Not fixed, on purpose.** Tightening it means editing the operator's live
`runtime/home/.automaton/automaton.json`. That is a change to the user's install configuration, it
is not required to deliver 16D (the isolated home is correct by construction), and the preflight now
detects it loudly instead of it sitting silent. The operator action, once an archive exists (one was
taken in 16C at `backups/2026-11-01_08-24-20`):

```json
"maxMonthlyTransferCents": 0,
"agentBudgetCents": 0,
"childBudgetCents": 0
```

Adding these three lines makes tier 1 fail **only** on `home.isolated_test_tree` — which is the
correct single reason for the live tree to refuse.

## 6. Automated coverage added

`src/__tests__/security/phase16-live-model-tier.test.ts` — **8 passed**, explicit typecheck
**exit 0**, 6.03 s (each test spawns the real CLI under tsx).

| Test | Asserts |
|---|---|
| live runtime tree refuses | exit 2, `tier=runtime`, `verdict=SAFETY_GATE_FAILED`, `home.isolated_test_tree` among the failures — the original behaviour is preserved |
| `--test-home` = runtime home | exit 2 with `HOME_NOT_ISOLATED`, and **no** verdict table, proving the guard runs before the gate |
| `--test-home` nonexistent | exit 2 with `HOME_NOT_A_DIRECTORY` |
| isolated home | **0 FAIL lines, exactly 18 PASS lines**, `credentialPresent=false approvalPresent=false`, exit 1 = PENDING_CREDENTIAL_APPROVAL |
| credential + approval token | exit 0 = READY, i.e. the success state is genuinely reachable and needs only the two operator-owned terms |
| loosened config **with** credential + approval | exit 2 `SAFETY_GATE_FAILED`; failures include `agent.activation_closed`, `tools.allowlist_empty`, `shell.disabled`, `treasury.all_zero`; plus the non-vacuity line `credentialPresent=true approvalPresent=true` — safety outranks a held credential at CLI level, not only in unit tests |
| test home untouched | the home's `.automaton` directory holds exactly `automaton.json` before and after a run |
| no database created | a recursive walk finds no `.db`/`.db-wal`/`.db-shm` |

The 23-test unit suite for this gate (`phase16-live-model-preflight.test.ts`) still passes; it was
not modified.

## 7. What this section does NOT claim

- It does **not** claim any live model was tested. Zero provider calls were made; the only key
  strings in this work are `sk-FAKE-never-used-0000000000000000` inside a child environment that
  has no network call in its code path.
- It does not claim the isolated home is the *only* thing standing between this install and a live
  agent — activation approval, lockdown, the empty tool allowlist and the OS-level gap (R-4, R-15)
  all still apply.
- It does not claim OS isolation. The test home is a directory-level separation of state, enforced by
  the home guard; it is not a container, job object or user account boundary
  (`reports/PHASE_16_ISOLATION_EVALUATION.md`).
- `READY` is reachable, which is the point of the fix — it does **not** mean anything is approved.
  The gate prints the same 18 lines whether or not a credential exists, and the credential remains
  the operator's to supply.

## 8. Reproduce

```bash
cd <repo-root>
export HOME="<repo-root>\runtime\home"
N=./runtime/node-v22.23.4-win-x64/node.exe; S=scripts/phase16-live-model-preflight.ts
$N node_modules/tsx/dist/cli.mjs $S                              # tier 1, exit 2
$N node_modules/tsx/dist/cli.mjs $S --test-home runtime/home     # tier 2, exit 2
$N node_modules/tsx/dist/cli.mjs $S --test-home runtime/model-test-home  # tier 3, exit 1
$N node_modules/vitest/vitest.mjs run src/__tests__/security/phase16-live-model-tier.test.ts
```

**Phase 16D verdict: PENDING CREDENTIAL APPROVAL** — preparation complete and verified; execution
blocked on a provider credential and the human `CONWAY_LIVE_MODEL_APPROVED=APPROVED` token, both of
which stay with the operator by §29.
