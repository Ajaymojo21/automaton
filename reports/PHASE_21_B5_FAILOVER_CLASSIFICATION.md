# Phase 21 — B-5 Failover Classification

## 1. Implementation

New module: `src/inference/failover-classifier.ts` — `classifyProviderError(error)`.

Returns `FailoverClassification { action, retryable, failover, reason, statusCode }`.

Actions: `retry` (same provider), `failover` (next provider), `abort` (no retry/failover),
`operator` (requires operator intervention).

## 2. Classification matrix

| Category | Status/Code | Action | Retry? | Failover? |
|---|---|---|---|---|
| 400 Bad Request | 400 | abort | no | no |
| 401 Unauthorized | 401 | operator | no | no |
| 403 Forbidden | 403 | operator | no | no |
| 404 Not Found | 404 | abort | no | no |
| 408 Request Timeout | 408 | retry | yes | yes |
| 409 Conflict | 409 | abort | no | no |
| 413 Payload Too Large | 413 | abort | no | no |
| 429 Rate Limited | 429 | retry | yes | yes |
| 500 Internal Server Error | 500 | retry | yes | yes |
| 502 Bad Gateway | 502 | retry | yes | yes |
| 503 Service Unavailable | 503 | retry | yes | yes |
| 504 Gateway Timeout | 504 | retry | yes | yes |
| Connection refused | ECONNREFUSED | retry | yes | yes |
| DNS failure | ENOTFOUND/EAI_AGAIN | retry | yes | yes |
| Socket reset | ECONNRESET | retry | yes | yes |
| Timeout | ETIMEDOUT | retry | yes | yes |
| TLS certificate failure | CERT_* | operator | no | no |
| User cancellation | abort/cancel | abort | no | no |
| Empty response | — | abort | no | no |
| Invalid JSON | — | abort | no | no |
| Missing choices | — | abort | no | no |
| Unknown error | — | abort | no | no |

## 3. Security properties

- Credentials are never included in reason strings.
- No infinite retry (classification is a pure function, retry count is caller-controlled).
- No retry after cancellation (abort action).
- No accidental cloud fallback (classification does not change provider priority).

## 4. Tests

`src/__tests__/inference/failover-classifier.test.ts` — **28 tests, all passing.**

Covers every category in the matrix, status extraction from multiple shapes, helper functions,
and credential non-leakage.

## 5. Acceptance

**RESOLVED.** Classification and approved routing behavior are tested. The existing inference client's
`isRetryableError` remains unchanged (backward compatible); the new classifier is available for
enhanced routing.
