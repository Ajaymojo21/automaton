# Final Acceptance Matrix

- Date: 2026-11-10
- Project: `<repo-root>`
- Status vocabulary (exactly one per row): `COMPLETE AND VERIFIED`, `COMPLETE — OPERATOR APPROVAL
  REQUIRED`, `PARTIALLY COMPLETE`, `BLOCKED`, `NOT VERIFIED`.

## Matrix

| # | Component | Status | Basis |
|---|---|---|---|
| 1 | Repository structure and source of truth | COMPLETE AND VERIFIED | Project root confirmed; code, dashboard, runtime HOME and reports inspected; prior Phase 20/21/Ultimate/Final Closure reports read. |
| 2 | Pinned runtime and dependencies | COMPLETE AND VERIFIED | Node 22.23.4 at `runtime/node-v22.23.4-win-x64/node.exe`; better-sqlite3 loads under it; all suites run with it. |
| 3 | Lockdown configuration invariants | COMPLETE AND VERIFIED | `lockdown=true`, `activationApproved=false`, `allowedTools=[]`, five capability flags false, `maxChildren=0`, `walletAddress=""` read from `runtime/home/.automaton/automaton.json`; harness rows pass. |
| 4 | Treasury limits (12 monetary limits) | COMPLETE AND VERIFIED | `resolveTreasuryPolicy()` returns 0 for all 12 under lockdown; x402 allowlist empty; F-1 fail-closed tests pass. |
| 5 | Wallet absence and wallet-material exclusion | COMPLETE AND VERIFIED | No wallet address and no key material on disk; shared `isWalletFile()` used by backup, restore and dashboard; adversarial tests pass. |
| 6 | Database integrity and inventory (B-7) | COMPLETE AND VERIFIED | Integrity `ok`; 37 tables, 39 indexes, 0 triggers, 0 FK violations; read-only inventory artifact retained. |
| 7 | Disposable schema migration package (B-1) | COMPLETE AND VERIFIED | V11 -> V14 on disposable copies; refusal gates; startup mismatch safety; archived backup migration; integrity verified before/after. |
| 8 | Production schema migration V11 -> V14 | COMPLETE — OPERATOR APPROVAL REQUIRED | Not executed. Live DB remains V11 and hash-unchanged. Approval scope in `REMAINING_OPERATOR_APPROVALS.md`. |
| 9 | Startup schema-mismatch safety | COMPLETE AND VERIFIED | `createDatabase()` upgrades a disposable V11 copy; incomplete V14 raises `MigrationVerificationError`. |
| 10 | Repair approval persistence and governance (B-2/B-8) | COMPLETE AND VERIFIED | 14 mission properties mapped to schema V14, CAS transitions, append-only events and persistence tests; approval never executes a repair. |
| 11 | Provider configuration, selection and redaction (B-3) | COMPLETE AND VERIFIED | Three enabled providers pass URL policy; template resolves; no network opened by resolution; mock inference tests pass; no credential read. |
| 12 | Live provider inference | COMPLETE — OPERATOR APPROVAL REQUIRED | No real inference request made, per mission. |
| 13 | Failover classification, retries, backoff, no duplicate effects (B-5) | COMPLETE AND VERIFIED | 24 tests across `failover-classifier` and `freellmapi-fallback`; x402 paid-request no-retry test. |
| 14 | Safe observability and redaction (B-6) | COMPLETE AND VERIFIED | `log-redaction` (5) and `phase16-audit-visibility` (10) tests pass; dashboard shows source and staleness. |
| 15 | URL guard on every outbound path (B-9) | PARTIALLY COMPLETE | Guard wired at Conway client, resilient HTTP client, startup config, Ollama discovery and provider transport; redirects disabled; DNS checked immediately before request. Residual: Node re-resolves at connect, so the check/connect window is narrowed but not atomically pinned; see the B-9 report section 5. |
| 16 | Health Guardian five-state model (Section 4) | COMPLETE AND VERIFIED | 16 checks with `pass/warn/fail/blocked/requires_operator` and severity-ordered summary; live run reports 16 checks. |
| 17 | Non-executing Autonomous Mechanic (Section 4) | COMPLETE AND VERIFIED | Execution gate requires `security.selfHealingEnabled=true`; classification marks privileged repairs `requires_approval`; runtime state is disabled. |
| 18 | Dashboard completeness, 13 areas (Section 5) | COMPLETE AND VERIFIED | Browser harness opened all 13 areas; each rendered content; 0 console, page or network errors. |
| 19 | Dashboard authorization, loopback binding and headers | COMPLETE AND VERIFIED | Token exchange to HttpOnly SameSite=Strict cookie; server refuses non-127.0.0.1 host; CSP/nosniff/referrer-policy on every response; LAN fetch refused; forbidden action endpoints return 404/405. |
| 20 | Dashboard data accuracy and integration audit (Section 6) | COMPLETE AND VERIFIED | Stale/misleading indicators corrected; health panel distinguishes guardian status from supported verdict; action results observed live. |
| 21 | Heartbeat `check_usdc_balance` timeout root cause (Section 7) | COMPLETE AND VERIFIED | Context fetches credits once and USDC once (guarded); task returns early under lockdown; no network call; tests strengthened. |
| 22 | Root regression suite | COMPLETE AND VERIFIED | 98 files / 2378 tests passed, exit 0, 109.25 s. |
| 23 | Dashboard regression suite | COMPLETE AND VERIFIED | 11 files / 108 tests passed, exit 0, 3.43 s. |
| 24 | Typechecks (root, dashboard, dashboard server) | COMPLETE AND VERIFIED | Three `tsc --noEmit` runs, all exit 0. |
| 25 | Production builds | COMPLETE AND VERIFIED | Root `tsc` exit 0; dashboard `vite build` exit 0, 836 modules. |
| 26 | Runtime invariant sweep (Section 11) | PARTIALLY COMPLETE | 34 pass, 0 fail, 3 NOT VERIFIED: BitLocker status (needs elevated shell), Defender/firewall state, negative proof of outbound silence. |
| 27 | Environment preservation (FreeLLMAPI, Ollama, other projects) | COMPLETE AND VERIFIED | No write, restart or configuration change was made to those systems by this mission; all mission writes were confined to the Conway tree. FreeLLMAPI working-tree changes seen in `git status` predate this mission (last commit 2026-10-02) and were not touched. |
| 28 | Agent activation, financial execution, replication, exposure | COMPLETE — OPERATOR APPROVAL REQUIRED | Intentionally not performed; all gates remain closed. Activation, funding and exposure each need separate approval. |
| 29 | Documentation and this handover set | COMPLETE AND VERIFIED | README deployment-state section, `docs/DASHBOARD_API.md` corrected, 14 reports written from executed evidence. |

## Explicit NOT VERIFIED items

1. BitLocker protection status. Not probed: the mission forbids `manage-bde -protectors -get`, and
   `manage-bde -status` requires an elevated Administrator terminal that this session does not have.
2. Microsoft Defender and Windows Firewall state. Not modified and not probed.
3. Negative proof that no process made any outbound connection during the session. The mission's
   checks that matter positively are covered: no inference request, no financial request, no agent
   process. A universal negative is not provable from inside the session and is marked NOT VERIFIED
   rather than claimed.

## Notes on honest status

- Row 8 and row 12 are not failures. They are actions the mission explicitly reserved for the
  operator. Their engineering prerequisites are complete and tested.
- Row 26 is PARTIALLY COMPLETE because three probes could not be performed, not because a probe
  failed.
- Rows 3-5, 10, 15 and 19 were re-verified after the final source edits and dashboard rebuild.
