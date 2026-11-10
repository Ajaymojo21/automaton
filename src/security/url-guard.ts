/**
 * Centralized URL security guard (Phase 22 / B-9)
 *
 * Wraps the P-6 provider URL validator so that every operator-configured endpoint
 * (Conway API, Ollama, MCP, webhooks, custom tools) follows the same fail-closed
 * policy. Reuses `compileProviderUrlPolicy` and `addressCategory` from
 * `src/inference/provider-url.ts` so there is one validation implementation.
 *
 * Policy:
 *   - HTTPS is allowed to public hostnames.
 *   - HTTP is allowed only to loopback literals (localhost, 127.0.0.1, ::1).
 *   - Credentials in URLs, fragments, query strings, userinfo, and redirects are rejected.
 *   - DNS resolution is checked for private/link-local/multicast/unspecified ranges.
 *   - Redirects are rejected by default (redirect: "error").
 */

import {
  compileProviderUrlPolicy,
  addressCategory,
  type ProviderUrlPolicy,
} from "../inference/provider-url.js";

export type EndpointKind = "conway_api" | "ollama" | "mcp" | "webhook" | "custom_tool" | "provider";

export interface EndpointValidationResult {
  ok: boolean;
  reason?: string;
  policy?: ProviderUrlPolicy;
}

/**
 * Validate an operator-configured endpoint URL. Returns a structured result
 * instead of throwing, so callers can report the reason without leaking the URL.
 */
export function validateEndpointUrl(
  raw: unknown,
  label: string,
): EndpointValidationResult {
  try {
    const policy = compileProviderUrlPolicy(raw, label);
    // Additional check: HTTP to non-loopback is already rejected by compileProviderUrlPolicy.
    // HTTPS to IP literals is rejected by compileProviderUrlPolicy.
    // Here we add a final category check for the resolved host.
    const category = addressCategory(policy.host);
    if (policy.protocol === "http:" && category !== "loopback") {
      return { ok: false, reason: "NON_LOOPBACK_HTTP" };
    }
    if (category === "private" || category === "link_local" || category === "unspecified" || category === "multicast") {
      // Allow private only if it's loopback (already handled above).
      return { ok: false, reason: "BLOCKED_ADDRESS_RANGE" };
    }
    return { ok: true, policy };
  } catch (error) {
    const reason = (error as { reason?: string }).reason ?? "PARSE_FAILED";
    return { ok: false, reason };
  }
}

/**
 * Synchronous outbound-request guard for a fully-formed request URL (query strings are
 * legitimate here, unlike a provider base URL). Rejects credentials in the authority,
 * unsupported schemes, and addresses that no outbound call may reach.
 *
 * Returns a reason instead of throwing so callers can log without echoing the URL.
 */
export function checkOutboundUrl(
  raw: string,
  options: { allowHttpOnLoopback: boolean },
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "PARSE_FAILED" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "USERINFO" };
  if (url.hostname === "") return { ok: false, reason: "EMPTY_HOST" };

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const category = addressCategory(host);

  if (url.protocol === "https:") {
    if (category === "private" || category === "link_local" || category === "unspecified" || category === "multicast") {
      return { ok: false, reason: "BLOCKED_ADDRESS_RANGE" };
    }
    return { ok: true, url };
  }
  if (url.protocol === "http:") {
    if (!options.allowHttpOnLoopback) return { ok: false, reason: "HTTPS_REQUIRED" };
    if (category !== "loopback") return { ok: false, reason: "NON_LOOPBACK_HTTP" };
    return { ok: true, url };
  }
  return { ok: false, reason: "UNSUPPORTED_SCHEME" };
}

/**
 * Async DNS safety check — reuses the provider module's resolution logic.
 * Call this before making a request to an operator-configured endpoint.
 */
export async function assertEndpointResolvesSafely(policy: ProviderUrlPolicy): Promise<EndpointValidationResult> {
  // Re-import the async check by calling dns.lookup directly, mirroring provider-url.ts.
  const dns = await import("node:dns/promises");
  const { addressCategory: ac } = await import("../inference/provider-url.js");
  if (isIpLiteral(policy.host)) {
    return { ok: true, policy };
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(policy.host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "RESOLUTION_FAILED" };
  }
  for (const record of records) {
    const category = ac(record.address);
    const forbidden =
      policy.protocol === "http:"
        ? category !== "loopback"
        : category === "private" || category === "link_local" || category === "unspecified" || category === "multicast";
    if (forbidden) {
      return { ok: false, reason: "BLOCKED_ADDRESS_RANGE" };
    }
  }
  return { ok: true, policy };
}

/** Resolve a hostname and reject any answer in a forbidden range. */
export async function assertHostResolvesSafely(
  host: string,
  protocol: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isIpLiteral(host)) return { ok: true };
  const dns = await import("node:dns/promises");
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "RESOLUTION_FAILED" };
  }
  for (const record of records) {
    const category = addressCategory(record.address);
    const forbidden =
      protocol === "http:"
        ? category !== "loopback"
        : category === "private" || category === "link_local" || category === "unspecified" || category === "multicast";
    if (forbidden) return { ok: false, reason: "BLOCKED_ADDRESS_RANGE" };
  }
  return { ok: true };
}

function isIpLiteral(host: string): boolean {
  return host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}
