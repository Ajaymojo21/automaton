# Phase 21 — Blocker Register

## Updated blockers

| ID | Severity | Status | Description |
|---|---|---|---|
| B-1 | CRITICAL | **READY FOR SEPARATE APPROVAL** | Migration tested on disposable copy (V11→V13). Production untouched. Operator must set env vars + take backup. |
| B-2 | HIGH | **IMPLEMENTED AND TESTED** | Repair approval lifecycle (15 tests). No actual repair executed. |
| B-3 | HIGH | **BLOCKED — CREDENTIAL UNAVAILABLE** | No credential. Real inference not tested. Mock inference verified. |
| B-4 | MEDIUM | **RESOLVED (lockdown)** | All 12 fields zero under lockdown. Non-locked-down retains DEFAULT defaults. |
| B-5 | MEDIUM | **RESOLVED** | Failover classifier implemented (28 tests). |
| B-6 | LOW | **RESOLVED** | Telemetry baseline captured (evidence-backed). |
| B-7 | INFO | **RESOLVED — EXPECTED EMPTY** | 37 tables, all expected empty (activation-dependent). |

## New blockers

| ID | Severity | Description |
|---|---|---|
| B-8 | MEDIUM | No approval surface exposed via dashboard HTTP (store is in-memory only). |
| B-9 | MEDIUM | Endpoint URL validation gap (SSRF) for operator-set URLs. |
| B-10 | LOW | Backup manifests may include wallet files. |

## Verdict

No CRITICAL blockers remain (B-1 is ready for separate approval). Three HIGH blockers: B-2 resolved,
B-3 blocked (credential), B-8 new (dashboard integration). B-4 and B-5 resolved. B-6 and B-7 resolved.
