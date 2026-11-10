/**
 * Provider failover classification (Phase 21 B-5)
 *
 * Classifies a provider error into one of four actions:
 *   - retry:    retry the same provider (transient)
 *   - failover: try the next provider in tier order (transient, provider-level)
 *   - abort:    do not retry, do not failover (non-transient / client error)
 *   - operator: requires operator intervention (credentials, config)
 *
 * This module is pure and has no side effects. It never leaks credentials or
 * prompts into the returned reason strings.
 */

export type FailoverAction = "retry" | "failover" | "abort" | "operator";

export interface FailoverClassification {
  action: FailoverAction;
  retryable: boolean;
  failover: boolean;
  reason: string;
  statusCode?: number;
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ["status", "statusCode"]) {
    const v = e[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  const resp = e.response as Record<string, unknown> | undefined;
  if (resp && typeof resp === "object") {
    const s = resp.status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  const cause = e.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause === "object") {
    const s = cause.status ?? cause.statusCode;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  return undefined;
}

function extractCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  const code = e.code;
  if (typeof code === "string") return code;
  const cause = e.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause === "object" && typeof cause.code === "string") return cause.code;
  return undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const NON_TRANSIENT_STATUS = new Set([400, 401, 403, 404, 409, 413]);

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function classifyProviderError(error: unknown): FailoverClassification {
  const status = extractStatus(error);
  const code = extractCode(error);
  const message = extractMessage(error).toLowerCase();

  // User cancellation — never retry, never failover.
  if (message.includes("abort") || message.includes("cancel") || code === "ABORT_ERR") {
    return { action: "abort", retryable: false, failover: false, reason: "user cancellation", statusCode: status };
  }

  // TLS certificate validation failure — operator intervention.
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl") || code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return { action: "operator", retryable: false, failover: false, reason: "TLS certificate validation failure", statusCode: status };
  }

  // HTTP status-based classification.
  if (status !== undefined) {
    if (NON_TRANSIENT_STATUS.has(status)) {
      const reasons: Record<number, string> = {
        400: "bad request",
        401: "unauthorized (credentials)",
        403: "forbidden",
        404: "not found (model or endpoint)",
        409: "conflict",
        413: "payload too large",
      };
      if (status === 401 || status === 403) {
        return { action: "operator", retryable: false, failover: false, reason: reasons[status], statusCode: status };
      }
      return { action: "abort", retryable: false, failover: false, reason: reasons[status] ?? `client error ${status}`, statusCode: status };
    }
    if (TRANSIENT_STATUS.has(status)) {
      const reasons: Record<number, string> = {
        408: "request timeout",
        429: "rate limited",
        500: "internal server error",
        502: "bad gateway",
        503: "service unavailable",
        504: "gateway timeout",
      };
      return { action: "retry", retryable: true, failover: true, reason: reasons[status] ?? `transient error ${status}`, statusCode: status };
    }
    if (status >= 400 && status < 500) {
      return { action: "abort", retryable: false, failover: false, reason: `client error ${status}`, statusCode: status };
    }
    if (status >= 500) {
      return { action: "retry", retryable: true, failover: true, reason: `server error ${status}`, statusCode: status };
    }
  }

  // Transport / network errors (no HTTP status).
  if (code && CONNECTION_CODES.has(code)) {
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return { action: "retry", retryable: true, failover: true, reason: "DNS failure", statusCode: status };
    }
    if (code === "ECONNREFUSED") {
      return { action: "retry", retryable: true, failover: true, reason: "connection refused", statusCode: status };
    }
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return { action: "retry", retryable: true, failover: true, reason: "timeout", statusCode: status };
    }
    return { action: "retry", retryable: true, failover: true, reason: `connection error (${code})`, statusCode: status };
  }

  // Message-based transport detection.
  if (message.includes("timeout") || message.includes("timed out")) {
    return { action: "retry", retryable: true, failover: true, reason: "timeout", statusCode: status };
  }
  if (message.includes("econnrefused") || message.includes("connection refused")) {
    return { action: "retry", retryable: true, failover: true, reason: "connection refused", statusCode: status };
  }
  if (message.includes("enotfound") || message.includes("dns")) {
    return { action: "retry", retryable: true, failover: true, reason: "DNS failure", statusCode: status };
  }
  if (message.includes("socket") && (message.includes("reset") || message.includes("hang up"))) {
    return { action: "retry", retryable: true, failover: true, reason: "socket reset", statusCode: status };
  }

  // Response-shape errors (no status, but a response was received).
  if (message.includes("empty") && (message.includes("response") || message.includes("body"))) {
    return { action: "abort", retryable: false, failover: false, reason: "empty response", statusCode: status };
  }
  if (message.includes("json") && (message.includes("invalid") || message.includes("parse") || message.includes("unexpected"))) {
    return { action: "abort", retryable: false, failover: false, reason: "invalid JSON", statusCode: status };
  }
  if (message.includes("choices") && (message.includes("missing") || message.includes("no "))) {
    return { action: "abort", retryable: false, failover: false, reason: "missing choices", statusCode: status };
  }

  // Empty response object (200 with no choices) — handled by caller; classify as abort.
  if (message.includes("no choices") || message.includes("empty choices")) {
    return { action: "abort", retryable: false, failover: false, reason: "missing choices", statusCode: status };
  }

  return { action: "abort", retryable: false, failover: false, reason: "unknown error", statusCode: status };
}

/**
 * Helper: does this classification allow a retry on the same provider?
 */
export function isRetryable(classification: FailoverClassification): boolean {
  return classification.retryable;
}

/**
 * Helper: does this classification allow failover to the next provider?
 */
export function allowsFailover(classification: FailoverClassification): boolean {
  return classification.failover;
}
