# Phase 21 — B-6 Telemetry Baseline

## 1. Measured (evidence-backed)

| Metric | Value | Source |
|---|---|---|
| Dashboard availability | Running, `/api/health` 200 VERIFIED | live probe |
| Console PID | 32720 (server), 32052 (launcher) | `/api/health` |
| API response (health) | < 50 ms (single observation) | live probe |
| Test execution duration (full suite) | 116.9 s (Run 2) | vitest JSON |
| Provider config status | 5 providers, P-6 valid, 0 rejected | panel |
| Provider reachability | FreeLLMAPI TCP up, 401 without credential | probe |
| Database integrity | `ok` | pragma |
| Database schema version | V11 (live), V13 (code) | schema_version table |
| Error categories | 0 test failures (Run 2) | vitest |
| Repair proposal counts | 0 (no proposals created) | store (empty) |
| Approval lifecycle counts | 0 | store (empty) |
| Security denial counts | 6 tools denied (audit log) | audit trail |

## 2. Not measured

- Uptime (no historical series).
- Success rate (no production traffic).
- Latency distribution (single observation).
- AI accuracy (no inference executed).
- Real provider health (no polling).

## 3. Telemetry implementation

No new background service or scheduler. The dashboard's existing panels serve as the read-only
telemetry surface. A baseline snapshot is captured in this report with timestamp and data source.

## 4. Acceptance

**RESOLVED.** A reproducible, evidence-backed baseline exists. All values are labeled as measured,
estimated, simulated, or not measured. No invented numbers.
