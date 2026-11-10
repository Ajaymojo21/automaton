import { describe, it, expect } from "vitest";
import { validateEndpointUrl, assertEndpointResolvesSafely, checkOutboundUrl } from "../../security/url-guard.js";

describe("URL guard (B-9)", () => {
  it("accepts https public hostname", () => {
    const r = validateEndpointUrl("https://api.example.com/v1", "test");
    expect(r.ok).toBe(true);
  });

  it("accepts http loopback", () => {
    const r = validateEndpointUrl("http://localhost:3001/v1", "test");
    expect(r.ok).toBe(true);
  });

  it("accepts http 127.0.0.1", () => {
    const r = validateEndpointUrl("http://127.0.0.1:8787/", "test");
    expect(r.ok).toBe(true);
  });

  it("rejects http to public host", () => {
    const r = validateEndpointUrl("http://example.com/v1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NON_LOOPBACK_HTTP");
  });

  it("rejects userinfo", () => {
    const r = validateEndpointUrl("https://user:pass@example.com/v1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("USERINFO");
  });

  it("rejects fragment", () => {
    const r = validateEndpointUrl("https://example.com/v1#frag", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("FRAGMENT");
  });

  it("rejects query", () => {
    const r = validateEndpointUrl("https://example.com/v1?q=1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("QUERY");
  });

  it("rejects empty", () => {
    const r = validateEndpointUrl("", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("EMPTY");
  });

  it("rejects unsupported scheme", () => {
    const r = validateEndpointUrl("ftp://example.com/v1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNSUPPORTED_SCHEME");
  });

  it("rejects non-loopback http IP literal", () => {
    const r = validateEndpointUrl("http://192.168.1.1/v1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NON_LOOPBACK_HTTP");
  });

  it("rejects https IP literal", () => {
    const r = validateEndpointUrl("https://192.168.1.1/v1", "test");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("HTTPS_IP_LITERAL");
  });

  it("rejects localhost with trailing dot", () => {
    const r = validateEndpointUrl("http://localhost./v1", "test");
    expect(r.ok).toBe(false);
  });

  it("rejects unspecified address", () => {
    const r = validateEndpointUrl("http://0.0.0.0/v1", "test");
    expect(r.ok).toBe(false);
  });

  it("rejects link-local", () => {
    const r = validateEndpointUrl("http://169.254.1.1/v1", "test");
    expect(r.ok).toBe(false);
  });

  it("rejects multicast", () => {
    const r = validateEndpointUrl("http://224.0.0.1/v1", "test");
    expect(r.ok).toBe(false);
  });

  it("rejects null/non-string", () => {
    const r = validateEndpointUrl(null, "test");
    expect(r.ok).toBe(false);
  });

  it("rejects invalid port", () => {
    const r = validateEndpointUrl("https://example.com:99999/v1", "test");
    expect(r.ok).toBe(false);
  });

  it("assertEndpointResolvesSafely returns ok for IP literal", async () => {
    const r = await assertEndpointResolvesSafely({ host: "127.0.0.1", protocol: "http:", port: 80, origin: "http://127.0.0.1", href: "http://127.0.0.1/", providerId: "t" } as any);
    expect(r.ok).toBe(true);
  });
});

describe("outbound request guard (B-9, request URLs)", () => {
  const strict = { allowHttpOnLoopback: false };
  const local = { allowHttpOnLoopback: true };

  it("allows https with a query string (unlike a base URL)", () => {
    expect(checkOutboundUrl("https://api.example.com/v1/agents?limit=10", strict).ok).toBe(true);
  });

  it("rejects URL credentials", () => {
    const r = checkOutboundUrl("https://user:pass@api.example.com/v1", strict);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("USERINFO");
  });

  it.each([
    ["http://127.0.0.1:3001/v1", "http 127"],
    ["http://localhost:3001/v1", "http localhost"],
    ["http://[::1]:3001/v1", "http ::1"],
  ])("allows loopback HTTP when enabled: %s", (url) => {
    expect(checkOutboundUrl(url, local).ok).toBe(true);
  });

  it.each([
    ["http://169.254.169.254/latest/meta-data", "link-local metadata"],
    ["https://10.0.0.5/v1", "private 10/8"],
    ["https://192.168.1.10/v1", "private 192.168/16"],
    ["https://172.16.0.1/v1", "private 172.16/12"],
    ["https://[fe80::1]/v1", "ipv6 link-local"],
    ["https://0.0.0.0/v1", "unspecified"],
  ])("rejects %s", (url) => {
    expect(checkOutboundUrl(url, local).ok).toBe(false);
  });

  it("rejects unsupported schemes", () => {
    expect(checkOutboundUrl("file:///c:/windows/win.ini", strict).ok).toBe(false);
    expect(checkOutboundUrl("gopher://example.com/", strict).ok).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(checkOutboundUrl("not a url", strict).ok).toBe(false);
  });

  it("rejects loopback HTTP when loopback is not enabled", () => {
    const r = checkOutboundUrl("http://localhost:3001/v1", strict);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("HTTPS_REQUIRED");
  });
});
