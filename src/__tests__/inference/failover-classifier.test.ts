import { describe, it, expect } from "vitest";
import { classifyProviderError, isRetryable, allowsFailover } from "../../inference/failover-classifier.js";

describe("failover classifier (B-5)", () => {
  const cases: Array<{ name: string; error: unknown; action: string; statusCode?: number }> = [
    { name: "400 Bad Request", error: { status: 400, message: "bad request" }, action: "abort", statusCode: 400 },
    { name: "401 Unauthorized", error: { status: 401, message: "unauthorized" }, action: "operator", statusCode: 401 },
    { name: "403 Forbidden", error: { status: 403, message: "forbidden" }, action: "operator", statusCode: 403 },
    { name: "404 Not Found", error: { status: 404, message: "not found" }, action: "abort", statusCode: 404 },
    { name: "408 Request Timeout", error: { status: 408, message: "timeout" }, action: "retry", statusCode: 408 },
    { name: "409 Conflict", error: { status: 409, message: "conflict" }, action: "abort", statusCode: 409 },
    { name: "413 Payload Too Large", error: { status: 413, message: "too large" }, action: "abort", statusCode: 413 },
    { name: "429 Rate Limited", error: { status: 429, message: "rate limited" }, action: "retry", statusCode: 429 },
    { name: "500 Internal Server Error", error: { status: 500, message: "ise" }, action: "retry", statusCode: 500 },
    { name: "502 Bad Gateway", error: { status: 502, message: "bad gateway" }, action: "retry", statusCode: 502 },
    { name: "503 Service Unavailable", error: { status: 503, message: "unavailable" }, action: "retry", statusCode: 503 },
    { name: "504 Gateway Timeout", error: { status: 504, message: "gateway timeout" }, action: "retry", statusCode: 504 },
    { name: "connection refused (ECONNREFUSED)", error: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, action: "retry" },
    { name: "DNS failure (ENOTFOUND)", error: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" }, action: "retry" },
    { name: "socket reset", error: { code: "ECONNRESET", message: "socket hang up" }, action: "retry" },
    { name: "timeout (ETIMEDOUT)", error: { code: "ETIMEDOUT", message: "request timed out" }, action: "retry" },
    { name: "TLS certificate failure", error: { code: "CERT_HAS_EXPIRED", message: "certificate has expired" }, action: "operator" },
    { name: "user cancellation", error: { message: "request aborted" }, action: "abort" },
    { name: "empty response", error: { message: "empty response body" }, action: "abort" },
    { name: "invalid JSON", error: { message: "invalid json parse error" }, action: "abort" },
    { name: "missing choices", error: { message: "no choices in response" }, action: "abort" },
    { name: "unknown error", error: { message: "something weird" }, action: "abort" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = classifyProviderError(c.error);
      expect(result.action).toBe(c.action);
      if (c.statusCode !== undefined) expect(result.statusCode).toBe(c.statusCode);
    });
  }

  it("extracts status from response.status", () => {
    const r = classifyProviderError({ response: { status: 429 } });
    expect(r.action).toBe("retry");
    expect(r.statusCode).toBe(429);
  });

  it("extracts status from cause.status", () => {
    const r = classifyProviderError({ cause: { status: 503 } });
    expect(r.action).toBe("retry");
    expect(r.statusCode).toBe(503);
  });

  it("extracts status from string code (cause)", () => {
    const r = classifyProviderError({ cause: { code: "ECONNREFUSED" }, message: "refused" });
    expect(r.action).toBe("retry");
  });

  it("isRetryable returns true for retry action", () => {
    const r = classifyProviderError({ status: 429 });
    expect(isRetryable(r)).toBe(true);
    expect(allowsFailover(r)).toBe(true);
  });

  it("isRetryable returns false for abort action", () => {
    const r = classifyProviderError({ status: 400 });
    expect(isRetryable(r)).toBe(false);
    expect(allowsFailover(r)).toBe(false);
  });

  it("reason strings never contain credential material", () => {
    const r = classifyProviderError({ status: 401, message: "key=sk-secret123" });
    expect(r.reason).not.toContain("sk-secret123");
  });
});
