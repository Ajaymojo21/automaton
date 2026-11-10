# B-9 URL Guard Runtime Verification

- Date: 2026-11-10
- Guard modules: `src/security/url-guard.ts`, `src/inference/provider-url.ts`
- Tests: `src/__tests__/security/url-guard.test.ts`, `src/__tests__/security/url-guard-call-sites.test.ts`,
  `src/__tests__/inference/provider-url-validation.test.ts` (54 tests)
- Result: guard is present on every real outbound path inspected; call-site tests prove the
  transport is never reached for a hostile URL.

## 1. Policy

`validateEndpointUrl(raw, label)` compiles the URL with `compileProviderUrlPolicy()` and rejects:

- empty, untrimmed, malformed, or unsupported-scheme URLs;
- embedded userinfo credentials, fragments, and query strings in a base URL;
- plain HTTP to anything that is not a loopback literal (`localhost`, `127.0.0.1`, `::1`);
- HTTPS to IP literals;
- private, link-local, unspecified, and multicast address ranges;
- hostnames that canonicalise to a different host (alternative IPv4/IPv6 notation, trailing dot).

`checkOutboundUrl(raw, { allowHttpOnLoopback })` is the request-time variant. It permits a query
string (legitimate on a request), rejects userinfo and unsupported schemes, applies the same address
category rules, and is called immediately before the transport.

`assertEndpointResolvesSafely()` / `assertHostResolvesSafely()` perform `dns.lookup(..., { all: true,
verbatim: true })` and reject if any answer is in a forbidden range. `createProviderFetch()` also
pins the request to the provider's scheme, host and port (`OFFSITE_REQUEST` / `OFFSITE_PORT`) and
forces `redirect: "error"`.

## 2. Every real outbound path

| Path | Guard placement | Test proof |
|---|---|---|
| Conway API client construction (`src/conway/client.ts:44`) | `validateEndpointUrl(apiUrl, "conway_api")` before the client is built | refuses `http://api.example.com` (NON_LOOPBACK_HTTP) and `https://10.0.0.5/v1` (HTTPS_IP_LITERAL), `fetch` not called |
| Startup config validation (`src/index.ts:338,386`) | Conway URL and Ollama URL validated at boot | provider URL tests + call-site tests |
| Resilient HTTP client (`src/conway/http-client.ts:25`) | `checkOutboundUrl()` before `fetch` | refuses `https://169.254.169.254/...` (cloud metadata) and URLs with credentials, `fetch` not called |
| Provider transport (`src/inference/provider-registry.ts:451-455`) | `validateProviderBaseUrl()` at resolution, then `createProviderFetch()` for every request | `provider-url-validation.test.ts` obligations 14-29: redirect disabled, cross-host redirect never reaches transport, loopback cross-port hop refused, HTTPS downgrade refused, DNS answers in private/link-local ranges refused |
| Ollama discovery (`src/ollama/discover.ts:47-52`) | `validateEndpointUrl()` then `assertEndpointResolvesSafely()` | LAN endpoint and private HTTPS endpoint refused with no request; legitimate `127.0.0.1:11434` reached with `redirect: "error"` |
| Agent-card discovery (`src/registry/discovery.ts`) | guarded fetch | IPv6 link-local, IPv4-mapped private address, and credentialed card URIs blocked before fetch |

## 3. Threats covered

- Unsupported schemes, URL credentials, malformed or empty URLs: rejected.
- Localhost/loopback: allowed only over HTTP as a deliberate local-provider rule (see section 4).
- Private/link-local/metadata ranges: rejected, including IPv6 link-local and IPv4-mapped forms.
- IPv4/IPv6 tricks and hostname spoofing: canonicalisation check rejects alternative notation and a
  trailing dot.
- Redirect-based SSRF: `redirect: "error"` on provider and Ollama fetches; tests prove a redirect
  destination never reaches the transport.
- Configuration override: `overrideBaseUrl()` re-validates and keeps the previous value on failure
  (tests 14b-14d).
- DNS rebinding: the host is resolved immediately before the request and every answer is checked;
  the request URL is pinned to the configured host and port.
- Check/use window: see the residual limitation in section 5.

## 4. Scope of the local exception

The guard is a category rule: plain HTTP is allowed only to a loopback literal, on any port. It is
not a hostname allowlist and it does not admit LAN, private, or link-local addresses. The shipped
FreeLLMAPI endpoint `http://localhost:3001/v1` is accepted under this rule. So is a local Ollama
endpoint, which the mission also requires to keep working. This rule predates this mission (it was
introduced and approved with the P-20 provider URL policy); this mission connected the existing
validator to the remaining outbound paths and proved it there. If the operator wants a stricter
per-port allowlist (for example only 3001 and 11434), that is a policy change with blast radius on
local providers and should be approved separately.

## 5. Residual limitation, stated plainly

Node's global `fetch` resolves DNS again at connection time. The guard's resolution is therefore a
check immediately before use, not an atomic pin of the address that will actually be connected. A
hostile DNS server that answers differently between the two lookups could still steer a connection
into a forbidden range. Closing this completely requires a custom dispatcher/agent with a pinned
lookup, which means adding a transport dependency or replacing global fetch. That change was not
made in this mission because it is a significant architectural change with no approval, and the
current threat model (operator-configured provider endpoints, redirects disabled, host/port pinned)
does not include a compromised DNS resolver. The limitation is recorded rather than claimed away.

## 6. Evidence

- `runtime/tmp/final-full-suite.log`: all URL guard, call-site and provider-url tests pass as part of
  the 98-file / 2378-test root suite.
- Guard unit tests: 19 cases in `url-guard.test.ts` including a parametrised outbound matrix.
- Call-site tests: 10 tests, each asserting `fetch` was not called.
- Provider URL tests: 54 tests, including redirect, DNS and override paths.
