# Phase 20 — Final Acceptance Report

Project root: `<repo-root>` · Phase window: UTC `2026-11-04T04:32Z → 05:12Z`
Mission (master prompt header): "close the outstanding security gap, verify actual provider
communication through a controlled non-agent test, validate fallback behaviour and produce a final
evidence-backed report. This is NOT an agent activation project. Do not activate Conway."

## 1. Objective

Score the twelve §18 decisions separately, then classify the phase — without merging a blocked item into
a green one.

## 2. Scope

Acceptance of everything measured in Phase 20. No new measurement beyond §12 item A–H re-runs
(`runtime/tmp/p20-regression-items.log`) and the process/schedule queries
(`runtime/tmp/p20-no-schedule-no-process.log`) was needed to reach these verdicts.

## 3. Approval reference

Approved and relied upon: **A13.1** (configuration-only provider integration; self-authored approval,
defined scope) and the §3 no-approval tier (read-only inspection, disposable tests, mock tests, static
analysis, documentation, reports).
**Not approved, and therefore scored as blocked:** P-6 source modification; one controlled real
inference request; real fallback against OpenAI/Groq; A4–A9; A11 dashboard changes; A12 scheduling;
B1 elevated posture check. Evidence: `reports/PHASE_19_APPROVAL_RECORD.md` (A2/A3 approved, A4–A9 "N"),
`reports/PHASE_18_APPROVAL_LIST.md` §6 (every row blank), and the absence of any `P-6` row in any
approval record. No approval was fabricated and this master prompt was not read as blanket approval.

## 4. Files inspected

See §4 of `FINAL_FREELLMAPI_SECURITY_AUDIT.md` (code), `_P6_REMEDIATION.md` §4 (registry members),
`_INFERENCE_TEST.md` §4 (client paths), `_FALLBACK_TEST.md` §4 (tests) and
`_SECURITY_INVARIANTS.md` §4 (state). This report adds the two approval records above.

## 5. Files modified

| File | Kind | Hash |
|---|---|---|
| `src/__tests__/inference/freellmapi-fallback.test.ts` | new §8 test suite (17 tests) | `4aa1eb079a5dbb914841b0ba30645c34980d397cdeef4a747df5f3aac7fb82d2` |
| `runtime/tmp/p20-p6-red.test.ts` | new §6 RED suite (22 tests, outside shipped include) | `72112967b3cf8b8a96a0473588bc1653bfa6d1a8ae8bc8d4abc1bae06114b0de` |
| `runtime/tmp/p20-p6-vitest.config.ts` | runner config | `b64e9f87595e528d84708964da811a015d5f6cda634447c81f310619f1097c74` |
| `runtime/tmp/p20-p6-probe.mjs` · `p20-redirect-probe.mjs` · `p20-close-probe.mjs` · `p20-exposure-probe.mjs` | probes | `43d19b00…fe904` · `b17930e0…42a8f` · `c0d333d2…88c633` · `d7c3f311…5840b` |
| `runtime/tmp/p20-run-items.sh` · `p20-process-attribution.ps1` | §12 item runner · process attribution | `b56d17a830f5b53a1688bb5bcf17fa0028715ecc021c30230b439a6ee028eacb` · `a85e54a42e89410ebc3acbad3c8ab5f7b29f79d4118d9f832f92efd136640592` |
| `runtime/tmp/p20-*.log` | captured evidence, 15 files | — |
| `reports/FINAL_FREELLMAPI_*.md` | the eight §16 reports | §7 below |
| `dist/**` | **generated** by the §12 J build: 544 of 544 files carry an mtime at or after `2026-11-04T04:45:51Z` | — |

**No source file under `src/` other than the one new test file, and no configuration or state file, was
modified.** §15's warning is applied deliberately: the write set is "tests, probes, reports and logs" and
the build output moved too; those two statements are recorded separately rather than collapsed into
"nothing but reports".

## 6. Files not modified

`src/inference/provider-registry.ts`, `src/inference/inference-client.ts`, `src/agent/loop.ts`,
`src/conway/http-client.ts`, `src/index.ts`, `src/state/**`, `src/config.ts`, `dashboard/**`,
`vitest.config.ts`, `package.json`, `config/inference-providers.template.json`,
`runtime/home/.automaton/{automaton.json,inference-providers.json,state.db,-wal,-shm}`, the global
Windows environment, and every FreeLLMAPI file (Conway wrote none; see `_SECURITY_INVARIANTS.md` §15 for
the concurrent third-party activity in that tree).

## 7. Before / after hashes

Source, config and state: identical before/after — full table in `_SECURITY_INVARIANTS.md` §7, single
fact: all eight hashes unchanged at `04:32Z`, `04:55Z` and `05:07Z`.

Reports (measured `2026-11-04T05:12Z`; a report never records its own hash, and the progress log was
still moving while this table was built, so six of the eight are hashed here):

| Report | SHA-256 |
|---|---|
| `FINAL_FREELLMAPI_SECURITY_AUDIT.md` | `36efa2cc2a17534dd70eba6d530bddf3022c09450f01bb761a1041bcfad4fa69` |
| `FINAL_FREELLMAPI_P6_REMEDIATION.md` | `14e8839772713522feebc28a59fff26fd8aff14b8ee07b1b9b4c6bfa6de469c0` |
| `FINAL_FREELLMAPI_INFERENCE_TEST.md` | `dcadc066d05ef42225a0af58712faf5ed294176049a86b64f67b935fed781326` |
| `FINAL_FREELLMAPI_FALLBACK_TEST.md` | `fd1cfb91974ba5785897b60ce8b8b4aca4ce09ae694d8c974ab605eaaa11450d` |
| `FINAL_FREELLMAPI_REGRESSION.md` | `db0edf13b02abe0083526a2746597e5d9f8acaaa20927cd96d6bf0aa616c0ed3` |
| `FINAL_FREELLMAPI_SECURITY_INVARIANTS.md` | `1bf7d4e17f2501edbf26788ea5544fa58e12c6e0cad05810acaeba0b377108d6` |
| `FINAL_FREELLMAPI_PROGRESS.md` | written **after** this report and still being finalised while it was drafted, so no hash for it is recorded here. `_PROGRESS.md` §7 carries this report's measured hash; a file never records its own hash, and the next phase's verification run can re-hash both. |

Historical hashes from A13 and Phase 19 are **not** overwritten anywhere in these eight files; where a
value moved, the older one is kept and marked (e.g. F-20-10 keeps both schema readings).

## 8. RED test evidence

`runtime/tmp/p20-regression-items.log` item A: **13 failed | 9 passed (22)**, `VITEST_EXIT=1`,
`2026-11-04T05:06:53Z` — the eighteen §6 P-6 obligations, failing only where behaviour is unapproved.
Supporting: `p20-p6-red.log` 30/30 hostile URLs accepted; `p20-redirect.log` loopback→loopback redirect
followed by both plain fetch and the SDK client.

## 9. GREEN test evidence

Itemised §12 B–H all exit 0 (31 / 23 / 64 / 17 / 70 / 60 / 48 tests). Shipped suite item K: 88 files /
2 175 tests / 0 failed, exit 0, measured twice. `tsc --noEmit` and `tsc` both exit 0.

## 10. Regression results, real inference status, fallback status

| | Result |
|---|---|
| Regression (§12 K) | **PASS** — 88 / 2 175 / 0 failed, delta vs historical 87 / 2 158 explained exactly by the one new §8 test file |
| Real inference | **BLOCKED_APPROVAL + BLOCKED_NO_CREDENTIAL** — no request attempted; `FREELLMAPI_API_KEY` length 0 |
| Fallback | **MOCK_FALLBACK = VERIFIED**, **REAL_FALLBACK = NOT TESTED** — kept distinct in every artifact |

## 11. Security invariant results

**PASS** — all §13 invariants re-measured unchanged; live schema still 11; `state.db` byte-identical; no
wallet, no agent process, no scheduled task, no migration report, no credential in any config field.

## 12. §18 ACCEPTANCE MATRIX — twelve separate decisions

| # | Decision | Verdict | Basis (measured, not inferred) |
|---|---|---|---|
| 1 | **A13.1 configuration-based provider integration** | **PASS** | template == deployed byte-for-byte (`a126c4e0…e73855`); all 5 providers resolve; FreeLLMAPI first in every tier; resolution opens no socket (§12 items B/D/H green) |
| 2 | **P-6 provider URL validation** | **BLOCKED_APPROVAL** | no approval row exists anywhere; source untouched (hash identical); 13 obligations red by design; proposal + call sites + test plan prepared in `_P6_REMEDIATION.md` §9/§10 |
| 3 | **FreeLLMAPI authentication** | **BLOCKED → NOT TESTED** | no credential in the environment, so the 401 path was never exercised from Conway; only the *placeholder-substitution* behaviour is verified (mock, test 3b). The gateway's real rejection is inferred from its own source, not measured — stated as such |
| 4 | **Real inference** | **BLOCKED_APPROVAL** (also `BLOCKED_NO_CREDENTIAL`) | both §7 gates absent; the one-shot plan is fully specified in `_INFERENCE_TEST.md` §10 and needs no further design |
| 5 | **Mock fallback** | **PASS** | 17 tests, exit 0 (`p20-fallback-tests.log`); exact attempt sequences captured, e.g. `[freellmapi ×4, openai]` on the 429 path |
| 6 | **Real fallback** | **NOT TESTED / BLOCKED_APPROVAL** | no OpenAI or Groq contact (§8C forbids automatic contact) |
| 7 | **Provider config integrity** | **PASS** | deployed identical to template; no key material in either file; ordering preserved (§9); five providers with expected enabled flags |
| 8 | **TypeScript** | **PASS** | `tsc --noEmit` exit 0, `tsc` exit 0, both logs 0 bytes = no diagnostics |
| 9 | **Full regression** | **PASS** | two independent full runs, both 88 / 2 175 / 0 failed, exit 0; counts fresh, delta explained |
| 10 | **Security invariants** | **PASS** | §13 table, every row VERIFIED, before == after |
| 11 | **Live database integrity** | **PASS** | schema 11 (`schema_version`, 10 rows), 38 tables, `integrity_check ok`, db hash/size/mtime unchanged, `-wal` 0 B; the one side effect (`-shm` mtime) disclosed |
| 12 | **Agent activation readiness** | **NO-GO** | P-6 still open (#2), authentication never exercised (#3), real inference never run (#4), real fallback untested (#6); plus Phase 19's unresolved A4/A5/A6 and F-19-04 staging hazard |

No row was merged into another. In particular #1, #5, #7, #8, #9, #10 and #11 are genuinely green, and
that does **not** make #2, #3, #4, #6 or #12 greener.

**OVERALL CLASSIFICATION: C — BLOCKED.**
Reason, per §18's "weakest activation-critical result" rule: the phase's two headline objectives — close
the P-6 gap, and verify actual provider communication through a controlled test — are both stopped at
approval gates (#2 and #4/#3). Nothing failed, so **D is wrong**; nothing was delivered that closes the
gap, so **B would overstate**. The blocked state is a decision that is the operator's to make, not a
defect: the exact asks are in `_PROGRESS.md` §12 as P-ASK-1 … P-ASK-6.

## 13. Residual findings

Carried forward unchanged from `_SECURITY_AUDIT.md` §14: **F-20-01** (any baseUrl admitted — HIGH),
**F-20-02** (env override path, `OPENAI_BASE_URL` → `overrideBaseUrl` — HIGH), **F-20-03** (empty baseUrl
silently becomes the OpenAI cloud endpoint — HIGH), **F-20-04** (parse failure swallowed; provider list
replaced not merged — MEDIUM), **F-20-05** (loopback URL does not constrain the redirect hop — MEDIUM),
**F-20-06** (failover only for 429/500/503 — MEDIUM, availability), **F-20-07** (FreeLLMAPI also listens
on the LAN IPv4 — HIGH contextual, operator-side), **F-20-08** (dashboard "AI Models" panel knows nothing
about A13's provider file or `FREELLMAPI_API_KEY`; it never claims a false green — LOW/MEDIUM),
**F-20-09/10/11/12** and regression-report **R-20-01…04**.

## 14. What Phase 20 did not do

Did not activate the agent, run the loop or `--run`; create or fund a wallet; execute a transaction;
enable financial tools; apply V12/V13 live; enable self-healing or replication; install a service or
scheduled task; expose Conway on LAN or publicly; modify FreeLLMAPI, Ollama, OmniRoute/OmniRoad,
OpenCode or Qoder global config, TradingAgents, ADRE-RN, Paperclip AI or any MCP server; change
firewall, Defender or the global environment; stage, commit or push anything (`git status` was read
only); print or store any key. `manage-bde -protectors -get` was never run.

## 15. Rollback instructions

Per `_SECURITY_INVARIANTS.md` §17, in three separated categories: (A) P-6 source — nothing to revert,
hashes prove it; (B) provider configuration — delete only
`runtime/home/.automaton/inference-providers.json`; (C) test/report artefacts — remove the one shipped
test file and, after supersession, the `runtime/tmp` artefacts. `dist/**` regenerates from unchanged
source. No credential was created, so nothing needs rotating, and no FreeLLMAPI credential may be
deleted as a rollback step.

## 16. Final GO / NO-GO

**NO-GO for closing this phase as "security closed and provider communication verified".** The work that
was approvable is done and green; the work that would have closed the mission is waiting on two explicit
operator decisions (P-ASK-1 and P-ASK-2). **GO** on A13.1, mock fallback, provider configuration
integrity, TypeScript, regression, invariants and live-database integrity. **NO-GO** on agent activation,
unchanged from Phase 19.
