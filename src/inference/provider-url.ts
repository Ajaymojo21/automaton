import dns from "node:dns/promises";

export type ProviderUrlReason =
  | "EMPTY"
  | "UNTRIMMED"
  | "PARSE_FAILED"
  | "UNSUPPORTED_SCHEME"
  | "EMPTY_HOST"
  | "USERINFO"
  | "FRAGMENT"
  | "QUERY"
  | "INVALID_PORT"
  | "HOST_CANONICALISED"
  | "MALFORMED_HOST"
  | "NON_LOOPBACK_HTTP"
  | "HTTPS_IP_LITERAL"
  | "BLOCKED_ADDRESS_RANGE"
  | "OFFSITE_REQUEST"
  | "OFFSITE_PORT"
  | "RESOLUTION_FAILED";

export interface ProviderUrlPolicy {
  providerId: string;
  protocol: "http:" | "https:";
  host: string;
  port: number;
  origin: string;
  href: string;
}

type AddressCategory = "loopback" | "private" | "link_local" | "multicast" | "unspecified" | "public";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|\d?\d)$/;

const REASONS: Record<ProviderUrlReason, string> = {
  EMPTY: "the baseUrl is missing or empty; every provider must declare an explicit endpoint",
  UNTRIMMED: "the baseUrl has leading or trailing whitespace or control characters",
  PARSE_FAILED: "the baseUrl is not a URL the WHATWG parser accepts",
  UNSUPPORTED_SCHEME: "only http: and https: endpoints are supported",
  EMPTY_HOST: "the baseUrl has no host",
  USERINFO: "the baseUrl embeds a username or password; credentials belong in the API-key env var",
  FRAGMENT: "the baseUrl has a fragment",
  QUERY: "the baseUrl has a query string",
  INVALID_PORT: "the baseUrl port is outside 1-65535",
  HOST_CANONICALISED:
    "the host written in the baseUrl is not the host the parser resolved it to " +
    "(alternative IPv4/IPv6 notation or a trailing dot); write localhost, 127.0.0.1 or [::1]",
  MALFORMED_HOST: "the host is neither a valid hostname nor a valid IP literal",
  NON_LOOPBACK_HTTP:
    "plain HTTP is allowed only to the loopback literals localhost, 127.0.0.1 and [::1]; use https",
  HTTPS_IP_LITERAL: "https endpoints must be addressed by hostname, not by an IP literal",
  BLOCKED_ADDRESS_RANGE: "the host is in an address range providers are not allowed to reach",
  OFFSITE_REQUEST: "the request left the provider endpoint",
  OFFSITE_PORT: "the request changed port from the provider endpoint",
  RESOLUTION_FAILED: "the provider host could not be resolved before the request was sent",
};

export class ProviderUrlError extends Error {
  readonly reason: ProviderUrlReason;
  readonly providerId: string;

  constructor(reason: ProviderUrlReason, providerId: string, detail?: string) {
    const where = detail ? ` [${detail}]` : "";
    super(`provider '${providerId}' baseUrl rejected: ${REASONS[reason]}${where}`);
    this.name = "ProviderUrlError";
    this.reason = reason;
    this.providerId = providerId;
  }
}

function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => IPV4_OCTET.test(part));
}

function isIpv6(host: string): boolean {
  return host.includes(":");
}

function hex(word: number): string {
  return word.toString(16);
}

function ipv4Words(host: string): string[] {
  const [a, b, c, d] = host.split(".").map(Number);
  return [hex(a * 256 + b), hex(c * 256 + d)];
}

function toWords(text: string): string[] {
  if (text === "") {
    return [];
  }

  const words: string[] = [];
  for (const part of text.split(":")) {
    if (part === "") {
      continue;
    }
    if (isIpv4(part)) {
      words.push(...ipv4Words(part));
    } else {
      words.push(part);
    }
  }
  return words;
}

function expandIpv6(host: string): number[] {
  const compressed = host.indexOf("::");
  const head = toWords(compressed === -1 ? host : host.slice(0, compressed));
  const tail = compressed === -1 ? null : toWords(host.slice(compressed + 2));
  const words = tail === null ? head : [...head, ...Array(Math.max(1, 8 - head.length - tail.length)).fill("0"), ...tail];
  return words.slice(0, 8).map((word) => Number.parseInt(word || "0", 16) || 0);
}

function ipv4Category(octets: number[]): AddressCategory {
  const [a, b] = octets;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
    return "private";
  }
  if (a === 169 && b === 254) return "link_local";
  if (a >= 224) return "multicast";
  return "public";
}

function ipv6Category(words: number[]): AddressCategory {
  if (words.every((word) => word === 0)) return "unspecified";
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return "loopback";
  if ((words[0] & 0xff00) === 0xff00) return "multicast";
  if ((words[0] & 0xffc0) === 0xfe80) return "link_local";
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return ipv4Category([words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff]);
  }
  return "public";
}

export function addressCategory(host: string): AddressCategory {
  const normalised = unbracket(host).toLowerCase();
  if (normalised === "localhost") return "loopback";
  if (isIpv4(normalised)) return ipv4Category(normalised.split(".").map(Number));
  if (isIpv6(normalised)) return ipv6Category(expandIpv6(normalised));
  return "public";
}

function targetOf(protocol: string, host: string, port?: number): string {
  const authority = host.includes(":") ? `[${host}]` : host;
  return port === undefined ? `${protocol}//${authority}` : `${protocol}//${authority}:${port}`;
}

function portOf(url: URL): number {
  return url.port === "" ? defaultPort(url.protocol) : Number(url.port);
}

function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

function authorityHost(raw: string): string {
  const rest = raw.slice(raw.indexOf("://") + 3);
  const authority = rest.split(/[/?#\\]/)[0];
  const host = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.split(":")[0];
  return unbracket(host).toLowerCase();
}

export function compileProviderUrlPolicy(raw: unknown, providerId: string): ProviderUrlPolicy {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ProviderUrlError("EMPTY", providerId);
  }
  if (raw !== raw.trim()) {
    throw new ProviderUrlError("UNTRIMMED", providerId);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderUrlError("PARSE_FAILED", providerId);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ProviderUrlError("UNSUPPORTED_SCHEME", providerId, `${url.protocol}//${url.hostname}`);
  }
  if (url.hostname === "") {
    throw new ProviderUrlError("EMPTY_HOST", providerId, url.protocol);
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderUrlError("USERINFO", providerId, `${url.protocol}//${url.hostname}`);
  }
  if (url.hash !== "") {
    throw new ProviderUrlError("FRAGMENT", providerId, targetOf(url.protocol, url.hostname, portOf(url)));
  }
  if (url.search !== "") {
    throw new ProviderUrlError("QUERY", providerId, targetOf(url.protocol, url.hostname, portOf(url)));
  }

  const protocol = url.protocol as "http:" | "https:";
  const port = portOf(url);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProviderUrlError("INVALID_PORT", providerId, `${protocol}//${url.hostname}`);
  }

  const parsedHost = unbracket(url.hostname).toLowerCase();
  if (authorityHost(raw) !== parsedHost) {
    throw new ProviderUrlError("HOST_CANONICALISED", providerId, targetOf(protocol, parsedHost, port));
  }
  if (!isIpv4(parsedHost) && !isIpv6(parsedHost) && !HOSTNAME_PATTERN.test(parsedHost)) {
    throw new ProviderUrlError("MALFORMED_HOST", providerId, targetOf(protocol, parsedHost, port));
  }

  if (protocol === "http:" && !LOOPBACK_HOSTS.has(parsedHost)) {
    throw new ProviderUrlError("NON_LOOPBACK_HTTP", providerId, targetOf(protocol, parsedHost, port));
  }
  if (protocol === "https:" && (isIpv4(parsedHost) || isIpv6(parsedHost)) && !LOOPBACK_HOSTS.has(parsedHost)) {
    throw new ProviderUrlError("HTTPS_IP_LITERAL", providerId, targetOf(protocol, parsedHost, port));
  }

  const category = addressCategory(parsedHost);
  if (category === "unspecified" || category === "link_local" || category === "multicast") {
    throw new ProviderUrlError("BLOCKED_ADDRESS_RANGE", providerId, `${targetOf(protocol, parsedHost, port)} is ${category}`);
  }

  return { providerId, protocol, host: parsedHost, port, origin: url.origin, href: url.href };
}

export function validateProviderBaseUrl(raw: unknown, providerId: string): string {
  return compileProviderUrlPolicy(raw, providerId).href;
}

async function assertResolvesSafely(policy: ProviderUrlPolicy): Promise<void> {
  if (isIpv4(policy.host) || isIpv6(policy.host)) {
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(policy.host, { all: true, verbatim: true });
  } catch {
    throw new ProviderUrlError(
      "RESOLUTION_FAILED",
      policy.providerId,
      `${targetOf(policy.protocol, policy.host, policy.port)} did not resolve`,
    );
  }

  for (const record of records) {
    const category = addressCategory(record.address);
    const forbidden =
      policy.protocol === "http:"
        ? category !== "loopback"
        : category === "private" || category === "link_local" || category === "unspecified" || category === "multicast";
    if (forbidden) {
      throw new ProviderUrlError(
        "BLOCKED_ADDRESS_RANGE",
        policy.providerId,
        `${targetOf(policy.protocol, policy.host, policy.port)} resolves to a ${category} address`,
      );
    }
  }
}

/** Derived from fetch itself: the DOM lib spells this `RequestInfo`, Node's types do not, and the
 *  dashboard server compiles this file without `lib.dom`. */
type FetchInput = Parameters<typeof fetch>[0];

function requestTargetUrl(input: FetchInput, policy: ProviderUrlPolicy): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderUrlError("PARSE_FAILED", policy.providerId);
  }

  const host = unbracket(url.hostname).toLowerCase();
  if (url.protocol !== policy.protocol || host !== policy.host) {
    throw new ProviderUrlError("OFFSITE_REQUEST", policy.providerId, `${url.protocol}//${host}`);
  }
  if (portOf(url) !== policy.port) {
    throw new ProviderUrlError("OFFSITE_PORT", policy.providerId, targetOf(url.protocol, host, portOf(url)));
  }
  return url.href;
}

export function createProviderFetch(baseUrl: string, providerId: string): typeof fetch {
  const policy = compileProviderUrlPolicy(baseUrl, providerId);

  return async function guardedProviderFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
    const href = requestTargetUrl(input, policy);
    await assertResolvesSafely(policy);

    const guarded: RequestInit = { ...(init ?? {}), redirect: "error" };
    if (typeof input === "object" && !(input instanceof URL)) {
      return fetch(new Request(input, guarded));
    }
    return fetch(href, guarded);
  };
}
