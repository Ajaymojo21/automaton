# Pre-Activation Readiness Audit — Executive Summary

**Mission:** Complete Autonomous Pre-Activation Audit (readiness only — no activation)
**Date:** 2026-11-09
**Project root:** `<repo-root>`
**Canonical HOME:** `<repo-root>\runtime\home`
**Git HEAD:** `d8f816881fd24b6f5e3d616e59edec387a447667` (branch `main`)

---

## 1. Verdict

> ## **NO-GO — NOT READY FOR ACTIVATION**
>
> Treasury security was unresolved at the start of this mission and has now been **remediated in
> source** (F-1) with a fail-closed fix and 9 new regression tests. All security invariants hold.
> However, three conditions still block activation: (1) the live database is at V11 while the code
> expects V13 and the audit chain cannot be verified; (2) no approval surface exists for
> `requires_approval` repairs; (3) real inference, wallet creation and financial execution have never
> been exercised. Tests pass, the dashboard is healthy, and the build succeeds — but none of those
> constitutes readiness, and the audit says so explicitly.

---

## 2. What was done

| Phase | Activity | Result |
|---|---|---|
| A | Repository + architecture audit | Complete; architecture map + capability classification in `PRE_ACTIVATION_ARCHITECTURE_AUDIT.md` |
| B | F-1 treasury security audit + remediation | **Fixed** — 6 source files patched, 9 new tests, all passing |
| C | Activation gate audit | Complete — dual gate verified, no bypass path found |
| D | Wallet & key-material safety | Complete — encrypted at rest, gated behind activation, no leak paths |
| E | Database safety & migration readiness | Complete — V12/V13 inspected, migration tested on disposable copy (V11→V13, integrity ok), production untouched |
| F | FreeLLMAPI & AI integration readiness | Complete — config verified, mock inference verified, real inference NOT TESTED |
| G | Network & external service safety | Complete — all destinations classified, redirect protection confirmed |
| H | Agent loop, heartbeat & scheduler safety | Complete — all gated behind activation, no background start from read-only commands |
| I | AI & financial tool permission audit | Complete — 6 restricted tools denied, enforcement at execution time |
| J | Observability & reliability readiness | Complete — guardian operational, mechanic disabled, no approval surface |
| K | Dashboard readiness | Complete — 12 panels, 19/19 self-checks, no misleading green indicators |
| L | Safe remediation | F-1 fix implemented + tested |
| M | Complete regression | **Run 1: 90 files / 2,238 tests / 1 failure (intermediate state); Run 2: 90 files / 2,238 tests / 0 failures** |
| N | Final invariant verification | **All invariants hold** |

---

## 3. Critical findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| **F-1** | **HIGH** | Three treasury limits (`maxMonthlyTransferCents`, `agentBudgetCents`, `childBudgetCents`) inherited non-zero defaults under lockdown | **REMEDIATED** — fail-closed fix in `loadConfig`, `resolveTreasuryPolicy`, `agent/loop.ts`, `tools.ts`, wizard, configure; DEFAULT retained for non-locked-down configs |
| **F-2** | **MEDIUM** | Live schema V11 vs code V13; audit chain unverifiable | Open — requires deliberate migration |
| **F-3** | **MEDIUM** | No approval surface for `requires_approval` repairs | Open — design gap |
| **F-4** | **MEDIUM** | Failover aborts on 401/timeout/connection by design | Documented behaviour |
| **F-5** | **LOW** | Operator token stored as file on disk | Accepted (single-user loopback model) |
| **F-6** | **LOW** | Console audit sink is best-effort | Documented |
| **F-7** | **LOW** | No telemetry baseline | Open |
| **F-8** | **INFO** | 37 of 38 tables empty — system never executed | Expected |

---

## 4. Fixes implemented

| Fix | Files | Tests |
|---|---|---|
| F-1 treasury fail-closed | `src/config.ts`, `src/security/treasury-guard.ts`, `src/agent/loop.ts`, `src/agent/tools.ts`, `src/setup/wizard.ts`, `src/setup/configure.ts`, `src/types.ts` | 9 new tests in `src/__tests__/security/f1-treasury-fail-closed.test.ts`, all passing |

---

## 5. Test results

| Run | Files | Tests | Passed | Failed | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|---|
| Run 1 | 90 | 2,238 | 2,237 | 1 | 0 | 149.4 s | 1 |
| Run 2 | 90 | 2,238 | 2,238 | 0 | 0 | 116.9 s | 0 |
| TypeScript (root) | — | — | — | 0 | — | 60.4 s | 0 |
| TypeScript (dashboard) | — | — | — | 0 | — | 16.4 s | 0 |

Run 1's single failure (`general-harness.test.ts`) was caused by an intermediate state of the F-1
remediation (DEFAULT treasury keys temporarily zeroed). The root cause was identified, DEFAULT was
restored to its original non-zero values (preserving non-locked-down test semantics), and Run 2
passed cleanly. This is a legitimate remediation iteration, not a test weakening.

---

## 6. Invariant verification (final)

All 10 security invariants hold. All treasury limits are zero. No wallet created. No production
migration. Database hash unchanged (`2A8AEB34…EFBBA`). No agent process. No activation env vars.
FreeLLMAPI untouched. Dashboard healthy.

---

## 7. Remaining blockers (see `PRE_ACTIVATION_BLOCKER_REGISTER.md`)

| Blocker | Severity | Required action |
|---|---|---|
| B-1 | CRITICAL | Apply V12/V13 migrations deliberately (operator approval required) |
| B-2 | HIGH | Implement approval surface for `requires_approval` repairs |
| B-3 | HIGH | Supply credentials and run authorized real inference test |
| B-4 | MEDIUM | Resolve F-1's latent risk in non-locked-down configs (already fail-closed under lockdown) |
| B-5 | MEDIUM | Widen failover classifier if timeout/connection resilience is required |
| B-6 | LOW | Establish telemetry baseline |
| B-7 | INFO | 37 of 38 tables empty (expected — system never ran) |

---

## 8. Report index

| Report | Contents |
|---|---|
| `PRE_ACTIVATION_EXECUTIVE_SUMMARY.md` | This document |
| `PRE_ACTIVATION_ARCHITECTURE_AUDIT.md` | Architecture map, activation dependencies, capability classification |
| `PRE_ACTIVATION_TREASURY_SECURITY.md` | F-1 deep audit, remediation, test evidence |
| `PRE_ACTIVATION_ACTIVATION_GATE_AUDIT.md` | Activation entry-point matrix, bypass analysis |
| `PRE_ACTIVATION_WALLET_SECURITY.md` | Wallet creation, key storage, encryption, leak paths |
| `PRE_ACTIVATION_DATABASE_READINESS.md` | Schema, migrations, backup/restore, production safety |
| `PRE_ACTIVATION_FREELLMAPI_READINESS.md` | Provider config, P-6, mock inference, real inference status |
| `PRE_ACTIVATION_NETWORK_SECURITY.md` | Endpoint classification, redirect protection, SSRF |
| `PRE_ACTIVATION_TOOL_PERMISSION_AUDIT.md` | Tool inventory, permission enforcement, denial evidence |
| `PRE_ACTIVATION_RELIABILITY_AUDIT.md` | Guardian, mechanic, self-healing status |
| `PRE_ACTIVATION_REGRESSION.md` | Two-run regression results |
| `PRE_ACTIVATION_SECURITY_INVARIANTS.md` | Final invariant verification |
| `PRE_ACTIVATION_FINAL_ACCEPTANCE.md` | Acceptance checklist, hashes, changed files |
| `PRE_ACTIVATION_BLOCKER_REGISTER.md` | Classified findings with remediation and approval requirements |

---

## 9. Final statement

The audit is complete. One code remediation (F-1) was implemented and verified. All security invariants
hold. The system is **not** ready for activation: the database is unmigrated, the approval surface
does not exist, and real inference has never been tested. The verdict is **NO-GO**, and the blockers
are documented with specific remediation paths.

A successful audit is not permission to activate Conway.
