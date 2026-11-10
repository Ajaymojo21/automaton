# Phase 20 — P-6 Provider URL Security Validation: Remediation

## 1. Objective

Close A13 finding **P-6** — the provider registry accepts arbitrary `baseUrl` values — by adding
fail-closed URL validation at every point where a provider URL enters the registry, and by preventing
a loopback provider from being redirected off loopback.

## 2. Scope

Three call sites in `src/inference/provider-registry.ts`, one new guard module, and one test file.
No change to `src/conway/http-client.ts`, no change to any provider's configured URL, no change to
FreeLLMAPI, no change to the shipped template or deployed config, no change to the failover policy
(F-20-06 is recorded separately and is a different decision).

## 3. Approval reference — **THIS IS THE BLOCKER**

`P-6 = NOT APPROVED.`

| Check performed | Result |
|---|---|
| Grep for `P-6` across `reports/*.md` | appears only in `FREELLMAPI_PROVIDER_APPROVAL_REQUEST.md` §10 and `A13_FREELLMAPI_IMPLEMENTATION_REPORT.md`, both as **"not implemented, requires a source change, which is unapproved"** |
| `reports/PHASE_18_APPROVAL_LIST.md` §6 approval record table | **blank in every row** (A1–A12, B1–B5) |
| `reports/PHASE_19_PROGRESS.md` §3 decisions | D-2 (A2) and D-3 (A3) answered YES; **no P-6 question was ever asked** |
| `reports/FREELLMAPI_PROVIDER_APPROVAL_REQUEST.md` §10 | approved scope was **A13.1 = the configuration file only**; its own §10 records P-6 as the untouched gap |
| Master prompt §3 | "A13.1 … was NOT an operator approval of all future FreeLLMAPI changes"; "P-6 source modification … Requires explicit approval for the precise source-code change" |

**Action taken:** stop at the approval boundary. **No source file was modified.**
Prepared instead: this proposal, the exact file/function/line plan below, and the RED test file
(`runtime/tmp/p20-p6-red.test.ts`) so that approval can be granted against a known, already-measured
change rather than an imagined one.

Permitted-without-approval work completed: read-only analysis, disposable probes, mock-based tests,
this documentation. Forbidden and not done: source edit, real inference, activation.

## 4. Files inspected

`src/inference/provider-registry.ts` — all six §5-named members:
`normalizeProviders` (`:515-554`), `ProviderRegistry.fromConfig` (`:272-305`), `resolveModel` (`:307`),
`resolveCandidates` (`:315-355`), `buildResolvedModel` (`:432-444`), `overrideBaseUrl` (`:265-270`).
`src/inference/inference-client.ts:413-416` (`isRetryableError`), `src/agent/loop.ts:155-184`,
`src/conway/http-client.ts:13-40` (`LOOPBACK_HOSTS`, `assertSecureUrl`), `src/__tests__/inference/provider-registry.test.ts`,
`src/__tests__/http-client.test.ts`.

## 5. Files modified

**None.**

## 6. Files not modified

Every file listed in §4, plus the template, the deployed config, `src/index.ts`, `dashboard/**`,
and FreeLLMAPI. `find src -type f -newermt 2026-11-04` returns exactly one path —
`src/__tests__/inference/freellmapi-fallback.test.ts`, the §8 test file added by this phase.

## 7. Before / after hashes

| File | Hash (unchanged, because nothing was written) |
|---|---|
| `src/inference/provider-registry.ts` | `b5542260fbce0a7f4cdc933d5ca6287f7554ed6e8422add5f01b064259f20718` (18 796 B) — after: identical |
| `src/inference/inference-client.ts` | `ca0616619fdc3cacea56643123ea968c47c6dd133644e71c01c9fac79c28863c` (15 537 B) — after: identical |
| `src/agent/loop.ts` | `e97c18871565541395c3becfdf763b5e0cf9be6e1ac12a888e9883a82a79d83f` — after: identical |
| `src/conway/http-client.ts` | `d9b2fc4cb509af81426e82b349b38d726b48740cbcb82db304c6471859911070` — after: identical |
| `config/inference-providers.template.json` | `a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` — after: identical |
| `runtime/home/.automaton/inference-providers.json` | `a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` — after: identical |

## 8. The vulnerability, precisely

Three independent entry points admit a URL without validating it:

1. **Configuration load** — `normalizeProviders` `:543`:
   `baseUrl: stringOr(candidate.baseUrl, fallback?.baseUrl ?? "https://api.openai.com/v1")`.
   `stringOr` (`:632`) returns the input for any non-empty string, so `http://203.0.113.10/v1`,
   `file:///etc/passwd`, `data:…` and `http://user:pass@host/` all pass; and an **empty** string
   silently becomes the OpenAI cloud endpoint (F-20-03).
2. **Environment override** — `overrideBaseUrl` `:265-270` assigns whatever it is handed.
   `src/agent/loop.ts:170-173` sets `process.env.OPENAI_BASE_URL` from `config.conwayApiUrl` and
   `:181` feeds it in (F-20-02). The env var can also be set by anything that inherits the shell.
3. **Client construction** — `buildResolvedModel` `:432-444`:
   `new OpenAI({ apiKey, baseURL: provider.baseUrl })`. This is the last point through which every
   candidate must pass, so it is where a final guard belongs — and where the redirect constraint must
   be attached (F-20-05).

Measured consequence: 30/30 hostile URLs accepted, and a loopback URL followed a redirect to a second
listener. `src/conway/http-client.ts:13-40` already contains the correct pattern for Conway's own API
traffic; the inference path simply does not use it.

## 9. Proposed implementation (smallest safe change)

**New file `src/inference/provider-url.ts` (~70 lines):**

```ts
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertProviderBaseUrl(raw: unknown, providerId: string): string {
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length === 0) throw …;   // no silent default
  const url = new URL(raw);                       // parse, then validate the PARSED value
  if (url.protocol !== "https:" && url.protocol !== "http:") throw …;
  if (url.username || url.password) throw …;      // embedded credentials
  if (url.hash) throw …;                          // unexpected fragment
  if (url.search) throw …;                        // query on a base URL is unexpected
  const host = url.hostname.toLowerCase().replace(/\.$/, "");  // trailing dot, case
  const port = url.port === "" ? defaultPortFor(url.protocol) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw …;
  if (url.protocol === "https:") return url.toString();
  if (!isLoopbackLiteral(host)) throw …;          // exact set: localhost | 127.0.0.1 | ::1
  return url.toString();
}
```

`isLoopbackLiteral` matches the **bracket-stripped IPv6 literal** and the exact IPv4 dotted-quad
`127.0.0.1` **only**. It deliberately rejects `0x7f000001`, `0177.0.0.1`, `2130706433`, `127.1`,
`0.0.0.0`, `[::ffff:127.0.0.1]`, `localhost.evil.example`, `notlocalhost` and any other spelling —
§5C: "do not assume that a hostname is loopback merely because its text contains 'localhost'".
Reusing `LOOPBACK_HOSTS` from `src/conway/http-client.ts` is *not* sufficient on its own, because that
set is checked against `parsed.hostname` which keeps the brackets on `::1` — the new helper must
normalise first. `src/conway/http-client.ts` itself is not touched (§5E).

**Three call-site edits in `src/inference/provider-registry.ts`:**

| Line | Change |
|---|---|
| `:543` (`normalizeProviders`) | `baseUrl: assertProviderBaseUrl(candidate.baseUrl ?? fallback?.baseUrl, id)` — validation at the boundary; a provider that fails is **dropped** from the set (fail closed), exactly as a provider with no id or no models already is, with the reason logged. No silent `https://api.openai.com/v1` substitution. |
| `:265-270` (`overrideBaseUrl`) | validate before assigning; on failure, keep the previous value and log. `loop.ts:181`'s Conway-compute fallback therefore cannot downgrade a shipped HTTPS provider to HTTP. |
| `:432-444` (`buildResolvedModel`) | last-resort `assertProviderBaseUrl` guard plus the redirect constraint: `new OpenAI({ apiKey, baseURL, fetch: guardedFetch })` where `guardedFetch` re-runs `assertProviderBaseUrl` against each `Location` the response offers before the next hop is attempted. |

**Redirect handling (§5D) — measured options, both proven effective** in `runtime/tmp/p20-redirect.log`:

| Approach | Measured result | Compatible with the SDK? |
|---|---|---|
| A: `redirect: "error"` on the request | blocked (`serverB hits=0`) | Not exposed by the OpenAI SDK's `create()` options; would need it threaded through `fetchInit`, and it also forbids legitimate HTTPS redirects |
| **B: custom `fetch` that re-validates each hop (recommended)** | blocked (`serverB hits=0`), error surfaced as `Connection error.` | Yes — the SDK accepts `fetch`. Caveat recorded: a throwing custom fetch is retried internally by the SDK, so the guard must be paired with `maxRetries: 0` on the guard path or the failure count is misleading |

Recommendation: **B**, because it keeps HTTPS redirect behaviour intact for the cloud providers while
constraining only the hop that §5D forbids — a loopback HTTP URL landing off loopback.

**Security impact of the change.** Prevents: cleartext exfiltration of prompt content and an
environment-sourced API key to an attacker-chosen host via a config file, via `OPENAI_BASE_URL`, or via
a silently defaulted empty field; and the loopback→off-loopback redirect hop. Does not weaken: TLS,
certificate verification (nothing sets `rejectUnauthorized`), `http-client.ts`, or any existing provider.
Availability risk introduced: a config that used to (unsafe) load now drops the offending provider —
that is the intended fail-closed behaviour and is exactly what obligation 18 tests.

**Compatibility (§5F) — the four live URLs all survive the guard:**
`http://localhost:3001/v1` (freellmapi), `https://api.openai.com/v1`, `https://api.groq.com/openai/v1`,
`https://api.together.xyz/v1`, `http://localhost:11434/v1` (local, disabled). Obligations 1–4 and
14c–17 already pass today and must keep passing.

**Explicitly NOT in this change:** F-20-04 (invalid-JSON → defaults), because shipped test
`provider-registry.test.ts:80` asserts that behaviour and changing it is a separate decision;
F-20-06 (failover only for 429/500/503); F-20-07 (FreeLLMAPI's bind address — §10 forbids touching it);
F-20-08 (dashboard panel — §11 requires its own approval).

## 10. RED / GREEN test plan

RED — **already executed, not manufactured.** `runtime/tmp/p20-p6-red-vitest.log`,
`2026-11-04T04:52:46Z`, exit 1: **13 failed | 9 passed (22 tests)**, mapping to §6 as:

| Obligation | Test | RED now | Why |
|---|---|---|---|
| 1 HTTPS accepted | :1 | passes | correct today, must stay |
| 2 localhost HTTP | :2 | passes | correct today |
| 3 127.0.0.1 HTTP | :3 | passes | correct today |
| 4 `[::1]` HTTP | :4, :4b | passes | correct today (case-insensitive) |
| 5 public HTTP | :5 | **FAILS** | `http://203.0.113.10/v1` admitted |
| 6 LAN HTTP | :6 | **FAILS** | `http://<host-lan-ip>:3001/v1` admitted |
| 7 private HTTP | :7 | **FAILS** | `10.0.0.5`, `172.16.3.4`, `169.254.169.254` (cloud metadata) admitted |
| 8 arbitrary hostname HTTP | :8 | **FAILS** | `evil.example`, `inference.internal` admitted |
| 9 unsupported schemes | :9 | **FAILS** | `file:`, `data:`, `gopher:`, `javascript:`, `ftp:`, `ws:` admitted |
| 10 embedded credentials | :10 | **FAILS** | `http://user:password@localhost:3001/v1` admitted |
| 11 malformed / bad port | :11 | **FAILS** | `"not a url"`, `http://`, port 0, port 99999999, `//host` admitted |
| 12 hostname spoofing | :12, :12b | **FAILS** | `localhost.evil.example`, `notlocalhost`, `localhost@evil.example`, `#localhost` admitted; fragments admitted |
| 13 alternative IP forms | :13 | **FAILS** | `0x7f000001`, `0177.0.0.1`, `2130706433`, `127.1`, `0.0.0.0`, `::ffff:127.0.0.1`, `127.0.0.1.` admitted |
| 14 redirect | :14, :14b, :14c | **:14 and :14b FAIL** (:14c passes) | no `fetch`/`redirect` constraint on the resolved client; `overrideBaseUrl` accepts `http://evil.example/v1` |
| 15 existing providers resolve | :15 | passes | must stay green |
| 16 FreeLLMAPI at localhost:3001 | :16 | passes | must stay green |
| 17 no socket during resolution | :17 | passes | must stay green |
| 18 invalid config fails closed | :18 | **FAILS** | `""`, `undefined`, `null`, `"   "`, trailing `\t` all admitted or silently re-pointed |

Supporting capture: `runtime/tmp/p20-p6-red.log` (30-case probe against the compiled `dist` registry,
`30/30 hostile-or-edge URLs ACCEPTED`), and `runtime/tmp/p20-redirect.log` for obligation 14's
empirical side.

GREEN sequence once approved:
1. snapshot the three target files by hash (values in §7);
2. add `src/inference/provider-url.ts`;
3. wire the three call sites;
4. move `runtime/tmp/p20-p6-red.test.ts` → `src/__tests__/inference/provider-url-validation.test.ts`
   and delete `runtime/tmp/p20-p6-vitest.config.ts`;
5. run the focused file → expect **22 passed**, exit 0;
6. run the focused inference subset (currently 7 files / 195 tests) and the shipped
   `provider-registry.test.ts` + `http-client.test.ts` unchanged;
7. full root regression (currently 88 files / 2 175 tests) + `tsc --noEmit` + `tsc`;
8. re-run `runtime/tmp/p20-close-probe.mjs` and confirm every §13 invariant plus the four §5F provider
   URLs still resolving;
9. mark this report SUPERSEDED with the executed evidence, keeping the RED record.

Rollback if GREEN shows an unwanted side effect: restore the three files from §7's hashes and delete
`provider-url.ts` — no data migration is involved and the provider config never changes, so rollback is
pure source restoration.

## 11. Regression results

No source change → the current suite is the pre-change baseline:
`runtime/tmp/p20-full-regression.log` **88 files / 2 175 tests / 0 failed**, exit 0.
Focused inference set `runtime/tmp/p20-focused-inference.log` **7 files / 195 tests / 0 failed**, exit 0.
After GREEN, the same two numbers plus the relocated 22 tests are the comparison target.

## 12. Real inference status

`BLOCKED_APPROVAL` and `BLOCKED_NO_CREDENTIAL`. P-6 is a validation change; it does not require and did
not receive a network call.

## 13. Fallback status

`MOCK_FALLBACK = VERIFIED` (17 tests, `p20-fallback-tests.log`), `REAL_FALLBACK = NOT TESTED`.
The §8 tests also pin the compatibility property P-6 must not break: the shipped ordering
`freellmapi → openai → groq` (reasoning) and `freellmapi → groq → openai` (fast, cheap) with
`together`/`local` disabled.

## 14. Security invariant results

All §13 invariants verified unchanged by `runtime/tmp/p20-close-invariants.log` — lockdown true,
activation false, zero tools, zero treasury limits, zero children, schema 11, `state.db` byte-identical,
no wallet, no migration, no activation env vars.

## 15. Residual findings

F-20-01, F-20-02, F-20-03 and F-20-05 remain **open** because the fix is unapproved.
F-20-04, F-20-06, F-20-07, F-20-08 are recorded and deliberately out of P-6's scope.
Additionally: this proposal's redirect mitigation (B) interacts with the SDK's internal retry loop —
if implemented, pair it with `maxRetries: 0` on the guarded path so a blocked redirect is not silently
attempted three more times.

## 16. Rollback instructions (§17A)

Restore only `src/inference/provider-registry.ts` (and, once created, `src/inference/provider-url.ts`)
from the verified snapshots in §7. Do not revert the 37 pre-existing modified `src/` files or any other
uncommitted work in the tree — they belong to earlier phases and are unrelated.

## 17. Final GO / NO-GO

**NO-GO to implement.** The change is fully specified, its RED is measured, its blast radius is three
call sites, and its compatibility set is pinned by already-green tests — but P-6 source modification
requires an explicit operator approval that does not exist. **GO to approve and execute** on the
decision recorded in `FINAL_FREELLMAPI_PROGRESS.md` as **P-ASK-1**.
