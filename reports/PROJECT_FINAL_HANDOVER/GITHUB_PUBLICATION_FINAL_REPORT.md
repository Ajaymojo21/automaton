# GitHub Publication — Final Security Remediation Report

- Repository: `<repo-root>`
- Branch: `main`
- Remote: `origin` -> `https://github.com/Conway-Research/automaton.git` (fetch and push)
- Published base: `d8f816881fd24b6f5e3d616e59edec387a447667` (`origin/main`, unchanged)
- Remediation commit: `de27cb94c3b41d37215e719dfea98af5c5bb1a87`
- Report date: 2026-11-10
- Report scope: mission sections 2-9 (dashboard findings, publication hygiene, history scan, quality review, verification, push attempt)

## Verdict

**SECURITY COMPLETE — PUSH BLOCKED BY PERMISSIONS**

The three dashboard findings are fixed in source and covered by executing tests; the repository is
clean of machine identifiers and live credentials; the root and dashboard suites, both typechecks
and both production builds pass. The publication commit exists locally and the remote history was
not altered. The push itself is refused by GitHub: the authenticated identity `Ajaymojo21` has no
write permission on `Conway-Research/automaton`. No bypass was attempted. The commit is preserved
locally and requires an owner grant or an operator-authorized destination before it can be published.

## 1. The three findings and their remediation

### Finding 1 — opaque and untrusted origins were accepted

**Defect.** State-changing and authenticated operations did not require a trusted `Origin`. A page
that sends `Origin: null` (sandboxed frame, `data:`/`file:` document, cross-origin redirect) or a
foreign origin was served like a same-origin caller, and the event-stream handshake ran no origin
gate at all.

**Remediation.**

| Location | Change |
|---|---|
| `dashboard/server/security.ts` | `isTrustedOrigin()` accepts exactly `http://127.0.0.1:8787`. `isTrustedRequest()` (line 216) requires, for every method other than `GET`/`HEAD`, a string `Origin` equal to that value, an optional `Referer` whose parsed origin equals it, and `x-conway-request: 1`. `GET`/`HEAD` may omit `Origin` but any origin that is present must be the trusted one. `null`, unparsable, prefix-spoofed and duplicated (array-valued) `Origin`/`Referer`/`Sec-Fetch-Site` headers are refused. |
| `dashboard/server/routes.ts` | New exported shared gate `apiGate()` (line 53) performs the origin check and the read/action rate-limit check, audits `request.rejected` with `reason: "origin"`, and returns the same `403` body for every route. `handleApi()` calls it before dispatch. |
| `dashboard/server/index.ts` | `/api/stream` (line 31) calls the same `apiGate()`, so the SSE route cannot be used as an alternate path around the gate. |

**Tests (executed).**

- `dashboard/tests/security.test.ts`: "treats Origin: null as an opaque origin and never trusts it" (line 171), "accepts the console origin exactly and rejects malformed variants" (183), "refuses a state-changing request that omits Origin entirely" (194), "compares the referer as an origin, not as a string prefix" (205), "refuses duplicated headers instead of trusting the first copy" (227), "denies a same-tab navigation from a foreign origin even with the header" (165), "denies a form post that omits the explicit opt-in header" (152).
- `dashboard/tests/http-contract.test.ts`: "refuses a null or malformed origin even on an authenticated read" (145), "refuses a state-changing request that omits Origin, and accepts one that names it" (157), "refuses a null-origin logout and leaves the live session untouched" (117), "applies the same origin and rate-limit gates to the stream handshake" (196, asserts `403` for a null origin and `429` after a burst on the stream route).

Same-origin functionality is preserved: the console sends the exact origin, the opt-in header and a
`Referer`, and the "exchanges the operator token for a cookie, then serves the panels" test continues
to pass end to end.

### Finding 2 — the pre-auth session probe disclosed the token length

**Defect.** `GET /api/session` returned metadata that included `tokenLength` to any unauthenticated
caller, which narrows a brute-force search and leaks an authentication detail on the one route
reachable before login.

**Remediation.**

| Location | Change |
|---|---|
| `dashboard/server/routes.ts` | `/api/session` (line 79) now returns exactly `{ ok: true, authenticated: <boolean> }`. No token, length, cookie name, session count or expiry is disclosed. |
| `dashboard/server/security.ts` | `tokenMatches()` (line 52) hashes both the candidate and the expected value with SHA-256 before `crypto.timingSafeEqual`, so a wrong-length candidate no longer returns early and cannot be distinguished by timing or by response. |
| `docs/DASHBOARD_API.md`, `docs/DASHBOARD_SECURITY.md` | Documented that the probe reports only `authenticated`, and that comparison is over fixed-width digests. |

**Tests (executed).**

- `dashboard/tests/http-contract.test.ts`: "answers the pre-auth session probe with nothing beyond the caller's auth state" (87) asserts the exact anonymous body `{ ok: true, authenticated: false }`, asserts the key set is exactly `authenticated` + `ok`, asserts the serialized body contains no `token` substring, then repeats the probe with a valid session and gets `{ ok: true, authenticated: true }`.
- `dashboard/tests/security.test.ts`: "rejects empty, short and wrong-length candidates without a timing side channel" (35) and "does not leak the token into the session cookie" (43).

### Finding 3 — logout did not invalidate the server-side session

**Defect.** Logout cleared the cookie in the browser but left the session valid in the server's
session table, so a copied cookie kept working; open event streams also survived.

**Remediation.**

| Location | Change |
|---|---|
| `dashboard/server/security.ts` | `revokeSession()` (line 175) deletes every session id the request presents through `dropSession()` (166), which fires `onSessionRevoked` listeners (159). `sessionIdOf()`, `hasValidSession()` and `sessionIsLive()` treat a duplicated session cookie as ambiguous (no authentication) and expire, evict or peer-rebind through the same `dropSession()` path. Cookie values with malformed percent escapes are decoded defensively instead of throwing. |
| `dashboard/server/routes.ts` | `logout` (line 249) calls `revokeSession(req.headers.cookie)`, audits `auth.logout` with `detail.revoked`, and returns `{ ok: true }` plus `set-cookie: conway_cc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`. Repeating logout, or logging out without a session, is a `200` no-op. |
| `dashboard/server/stream.ts` | Each SSE client records the session id that opened it. A module-level `onSessionRevoked` listener (line 19) ends and drops matching streams immediately, and the tick loop re-checks `sessionIsLive` (line 64) so a stream cannot outlive an expired or revoked session. |

**Tests (executed).**

- `dashboard/tests/security.test.ts`: "revokes the session itself, so a copied cookie stops authenticating" (114), "expires a session after the TTL even when its cookie is replayed" (125), "revokes every session a duplicated cookie presents" (82), "treats a malformed cookie escape as an unmatched value, not a crash" (75).
- `dashboard/tests/http-contract.test.ts`: "ends the session server-side, so a copied cookie stops working" (102, asserts `401` for the copied cookie, `200` for a repeated logout and `200` for a logout with no session), "refuses a null-origin logout and leaves the live session untouched" (117), "survives a malformed cookie and still ends the valid session beside it" (125).
- `dashboard/tests/stream.test.ts` (new): "closes the stream a session opened when that session is revoked" (23), "leaves a bearer-token stream attached, because it has no session to revoke" (34), "closes only the revoked session's stream" (44).

CSRF posture is unchanged and strictly stronger: logout is a mutation, so it requires the trusted
origin, the opt-in header and an accepted `Referer`; a null-origin logout is refused with `403` and
the live session stays usable.

## 2. Test and build results (executed on the remediation tree)

Both suites must run under the pinned interpreter `runtime/node-v22.23.4-win-x64/node.exe`
(ABI 127): `better-sqlite3` in `node_modules` is built for that ABI, and a system Node 24 runner
fails at module load with `NODE_MODULE_VERSION 137` vs `127`. That is an invocation constraint of
this checkout, not a code defect, and it applies equally to `pnpm exec vitest` when Node 24 is first
on `PATH`.

| Gate | Command | Result |
|---|---|---|
| Root suite | `runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run` | **98 files, 2378 tests passed, 0 failed, exit 0** (124.07 s) |
| Dashboard suite | `cd dashboard && ..\runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run` | **12 files, 127 tests passed, 0 failed, exit 0** (6.02 s) |
| Root typecheck | `node.exe node_modules\typescript\bin\tsc --noEmit` | exit 0 |
| Dashboard typecheck | `cd dashboard && ..\runtime\node-v22.23.4-win-x64\node.exe node_modules\typescript\bin\tsc --noEmit` | exit 0 |
| Root build | `pnpm run build` (`tsc && pnpm -r build`) with the repo shim on `PATH` | exit 0, `dist/` and `packages/cli/dist` emitted |
| Dashboard build | `node.exe node_modules\vite\bin\vite.js build` | exit 0, 532.91 kB bundle (rollup chunk-size advisory only) |
| Working tree | `git status --porcelain` | 0 entries after all builds and tests |

Dashboard files and counts from the executed run:

| Test file | Tests |
|---|---|
| `tests/security.test.ts` | 24 |
| `tests/http-contract.test.ts` | 21 |
| `tests/restore-guard.test.ts` | 17 |
| `tests/panel-verdicts.test.ts` | 15 |
| `tests/home-guard.test.ts` | 11 |
| `tests/backup-verify.test.ts` | 9 |
| `tests/models-provider-panel.test.ts` | 8 |
| `tests/redact.test.ts` | 5 |
| `tests/danger-imports.test.ts` | 5 |
| `tests/readonly-db.test.ts` | 5 |
| `tests/response-headers.test.ts` | 4 |
| `tests/stream.test.ts` | 3 |
| **Total** | **127** |

One build invocation detail is recorded for honesty: the repository's root `build` script ends with
`pnpm -r build`, and in a non-interactive shell without the repo shim on `PATH` the first attempt
exited 1 at that step with `'pnpm' is not recognized` after `tsc` had already succeeded. Re-running
with `runtime/bin` on `PATH` (the launchers do this themselves) exited 0. No source change was
needed.

## 3. Publication hygiene audit

Scanned with `git grep` over the index and working tree, and with `git log --all -p` over all 308
reachable commits. Machine-specific values are reported as placeholders in this document by design.

| Pattern | Result |
|---|---|
| Windows account name (two independent fragments, case-insensitive) | 0 files in the worktree, index, HEAD tree and all 308 commits |
| This machine's hostname | 0 occurrences |
| Resolved `C:\Users\<name>` / `/c/Users/<name>` paths | 0 live paths; 2 files use the literal placeholder `/c/Users/name` as a documented Git Bash example (`src/runtime/home-guard.ts` and its test) |
| Concrete temp/cache paths under the user profile | 0 |
| Private-range LAN addresses `192.168.x.x` | 6 files, all synthetic: three URL-guard test files that assert private ranges are blocked, one source comment naming the blocked CIDR, and two recorded test-run JSON artifacts whose test titles contain those fixture addresses. None is this machine's address. |
| Credential shapes (PEM blocks, `ghp_`, `sk-` >= 40 chars, `xox*`, `AKIA`) | Worktree: 1 synthetic PEM fixture in `dashboard/tests/redact.test.ts` plus 2 documentation mentions of the scanned patterns in `reports/PHASE_18_SECURITY_FINDINGS.md` and `reports/PHASE_19_APPROVAL_RECORD.md`. History: introduced only by the remediation commit; no live credential anywhere. |
| Sensitive filenames ever tracked (`*.pem`, `*.key`, `*.pfx`, `.env*`, `id_rsa`, `id_ed25519`, `wallet.json`, `credentials*`, `*secret*`, `*seed*`) | 0 |
| Tracked runtime artifacts (`dist/`, `node_modules/`, `runtime/home/`, `runtime/tmp/`, `*.db`, logs, backups) | 0 |
| Secrets in reports or terminal output produced by this mission | none printed; the invariant probe reports key fields as empty/non-empty only |

Hygiene changes made in this commit:

- Machine-specific paths and account names in `docs/` and `reports/` were replaced with
  `<repo-root>`, `<user-home>`, `%LOCALAPPDATA%` and equivalent portable placeholders.
- Test fixtures derive their paths at runtime instead of naming this checkout; the
  case-insensitivity probe in `src/__tests__/migration-path-containment.test.ts` now recases the
  live path generically rather than embedding a literal.
- `.gitignore` covers `runtime/home/`, `runtime/node-v22.23.4-win-x64/`, `runtime/corepack/`,
  `runtime/.pnpm-store/`, `runtime/npm-cache/`, `runtime/downloads/`, `runtime/model-test-home/`,
  `runtime/tmp/`, `runtime/audit.json`, `backups/`, `logs/`, `dashboard/.npmrc`,
  `dashboard/state/`, `dashboard/restore-targets/`, `dashboard/diagnostics/` and rolling report
  outputs.
- Launchers locate themselves with `%~dp0` and derive `HOME`, `COREPACK_HOME`, `PATH` and the
  pinned `node.exe` from the checkout instead of a hard-coded home directory.
- Valid technical documentation and the synthetic security fixtures were preserved; nothing was
  deleted or weakened to reduce the commit.

## 4. Git history and secret scan

| Check | Result |
|---|---|
| Reachable commits | 308 |
| Commits ahead of `origin/main` | 1 (before this report's own commit) |
| Commits whose diff adds an account name, hostname or resolved user path | 0 |
| Commits whose diff adds a PEM block or a token-shaped string | 1 — `de27cb9`, the synthetic redaction fixture described above |
| Sensitive filenames in any commit | 0 |
| History rewrite performed | none |
| Force push performed | none |
| Remote history modified | none; `origin/main` is still `d8f8168` |

The three remediated findings and the hygiene edits are all inside unpublished local history, so no
already-published commit required rewriting.

## 5. Files changed

Against the published base `d8f8168`:

- 363 files changed, 62,529 insertions, 347 deletions.
- 526 files tracked at the tip.

Remediation-specific files:

| File | Nature |
|---|---|
| `dashboard/server/security.ts` | origin policy, hashed token comparison, session revocation, defensive cookie decoding |
| `dashboard/server/routes.ts` | shared `apiGate`, minimal `/api/session`, revoking `logout` |
| `dashboard/server/index.ts` | gate and session binding on `/api/stream` |
| `dashboard/server/stream.ts` | revocation-aware SSE clients and tick re-check |
| `dashboard/tests/security.test.ts` | +5 tests (24 total) |
| `dashboard/tests/http-contract.test.ts` | +3 tests (21 total) |
| `dashboard/tests/stream.test.ts` | new, 3 tests |
| `docs/DASHBOARD_API.md`, `docs/DASHBOARD_SECURITY.md`, `docs/DASHBOARD_OPERATIONS.md` | origin policy, probe contract, logout revocation, test counts |

The rest of the commit is the previously prepared handover surface: README and deployment-state
section, documentation corrections, launchers and health/backup scripts, config templates,
`.gitignore`, the dashboard application, and the existing reports. No unrelated architecture change
was introduced.

## 6. Branch, remote and push verification

| Check | Observation |
|---|---|
| `git remote -v` | `origin` fetch/push both `https://github.com/Conway-Research/automaton.git`; no credential embedded in the URL |
| `git config user.name` | `Ajaymojo21` (the account email is carried only by commit author metadata and is omitted here) |
| `git ls-remote origin main` | `d8f816881fd24b6f5e3d616e59edec387a447667` — the remote did not move before or after the probe |
| `git rev-list --count origin/main..main` | 1 |
| Push permission probe | `GIT_TERMINAL_PROMPT=0 git push --dry-run origin main` |

Probe output, verbatim:

```text
remote: Permission to Conway-Research/automaton.git denied to Ajaymojo21.
fatal: unable to access 'https://github.com/Conway-Research/automaton.git/': The requested URL returned error: 403
```

Exit status 128. The `gh` CLI is not installed in this environment, so GitHub's own server message
is the permission evidence; no alternative credential path was probed.

What was deliberately **not** done: no remote URL change, no invented fork, no new repository, no
force push, no `--no-verify`, no credential request or disclosure, and no retry loop against the
same 403.

## 7. Remaining authorization blocker

Publication is blocked on one external decision, not on engineering work:

- **Required:** write (or maintainer) permission on `Conway-Research/automaton` for the pushing
  identity, **or** an explicitly operator-authorized alternative destination (an existing fork or a
  new repository whose ownership is established) plus authorization to add that remote.

Until one of those exists, the publication commit stays local and intact. Anyone with repository
access can reproduce the state and push `main` unchanged.

## 8. Final invariant verification

Read-only probe of the live runtime configuration and state; nothing was changed by this mission.

| Invariant | Observed |
|---|---|
| `security.lockdown` | `true` |
| `security.activationApproved` | `false` |
| `security.allowedTools` | `[]` |
| `security.allowFinancialTools` | `false` |
| `security.allowHostShell` | `false` |
| `security.allowSelfModification` | `false` |
| `security.allowReplication` | `false` |
| `security.allowExternalExposure` | `false` |
| `maxChildren` | `0` |
| `treasuryPolicy` | 10 keys, all `0` or `[]` (single/hourly/daily transfer, reserve, x402 payment, allowed domains, cooldown, transfers per turn, inference daily, confirmation threshold) |
| `walletAddress` | `""` |
| Provider keys (`conwayApiKey`, `openaiApiKey`, `anthropicApiKey`) | present but empty; `registeredWithConway: false` |
| Wallet file | absent |
| `EMERGENCY_STOP` marker | absent |
| Live database | 512,000 bytes, SHA-256 `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba`, mtime `2026-10-31T10:25:59.744Z` — identical before and after the full test/build cycle |

No agent activation, wallet creation, financial execution, production migration, real inference
request, `--provision`, `--run`, FreeLLMAPI reconfiguration or dashboard exposure beyond loopback
occurred.

## 9. Residual notes

1. `git diff --check d8f8168 HEAD` exits 2 for trailing whitespace on 23 lines of
   `reports/PHASE_15_WINDOWS_POSTURE_RAW.txt` and 1 line of `reports/PHASE_17_PANEL_DUMP.txt`.
   Both are verbatim captures of PowerShell/terminal output; editing them would misrepresent the
   evidence, so they are preserved as recorded. No source file is affected.
2. Automated invocations must use the pinned Node 22 runtime, as documented in §2.
3. The `Referer` equality check is defense in depth: responses send `Referrer-Policy: no-referrer`,
   so a conforming console usually omits it. It only tightens the gate for clients that do send it.
4. Bearer-token event streams have no server-side session to revoke by design; they close when the
   connection or process ends. Cookie sessions are the revocable path, and the tests assert both
   behaviors.
5. The pre-auth probe and the health route share the per-IP read bucket (40 requests/minute). On a
   loopback-only console this can only throttle the caller's own address.
6. A commit cannot contain its own hash. The remediation evidence is fixed at `de27cb9`; this
   report is committed after it, and the publication tip is whatever `git rev-parse main` prints
   (its parent must be `de27cb9`).

## 10. Reproduction commands

```text
git -C <repo-root> log --oneline -1
git -C <repo-root> diff --stat d8f816881fd24b6f5e3d616e59edec387a447667 HEAD
git -C <repo-root> ls-remote origin main
git -C <repo-root> rev-list --count origin/main..main

cd <repo-root>
runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run
runtime\node-v22.23.4-win-x64\node.exe node_modules\typescript\bin\tsc --noEmit

cd <repo-root>\dashboard
..\runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run
..\runtime\node-v22.23.4-win-x64\node.exe node_modules\typescript\bin\tsc --noEmit
..\runtime\node-v22.23.4-win-x64\node.exe node_modules\vite\bin\vite.js build
```
