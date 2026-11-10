# Phase 17 — DASHBOARD TEST RESULTS

**Run:** 2026-11-01T10:40Z (final), pinned runtime
`runtime/node-v22.23.4-win-x64/node.exe` (v22.23.4, ABI 127), `HOME` forced to
`<repo-root>\runtime\home`.
**Command:** `cd dashboard && ../runtime/node-v22.23.4-win-x64/node.exe ./node_modules/vitest/vitest.mjs run --reporter=basic`

```
 RUN  v2.1.9 <repo-root>/dashboard

 ✓ tests/danger-imports.test.ts (5 tests) 11ms
 ✓ tests/redact.test.ts (5 tests) 4ms
 ✓ tests/response-headers.test.ts (4 tests) 3ms
 ✓ tests/home-guard.test.ts (11 tests) 13ms
 ✓ tests/security.test.ts (15 tests) 12ms
 ✓ tests/backup-verify.test.ts (9 tests) 41ms
 ✓ tests/readonly-db.test.ts (5 tests) 15ms
 ✓ tests/restore-guard.test.ts (14 tests) 60ms
 ✓ tests/panel-verdicts.test.ts (15 tests) 5ms
 ✓ tests/http-contract.test.ts (14 tests) 1531ms

 Test Files  10 passed (10)
      Tests  97 passed (97)
   Duration  3.41s
```

**Passed 97 · Failed 0 · Skipped 0 · Blocked 0 · Not applicable 0.** No test was disabled, no
assertion was weakened to reach green, and no failure is hidden in a summary.

## 1. Companion gates, same session

| Gate | Command | Result |
|---|---|---|
| Server types | `tsc --noEmit -p tsconfig.server.json` | exit **0**, no diagnostics |
| Client types | `tsc --noEmit -p tsconfig.json` | exit **0**, no diagnostics |
| Production bundle | `vite build` | `index.html` + `assets/index-BMdUMvJm.js` (532.87 kB, gzip 154.96 kB) + `assets/index-sBvy4k0u.css` (17.85 kB) — client sources unchanged by the final header fix, so the bundle hash is the same |
| Runtime health | `node dashboard/scripts/status.mjs` | **19 pass, 0 fail, 0 not verified, 0 warn**, exit 0 → `dashboard/state/dashboard-health-2026-11-01T10-41-10-623Z.json` (after the final restart) and `…10-26-39-578Z.json` (before it) |
| Invariants | same run, 9 gate checks | all PASS; `CONWAY_ACTIVATION` unset |
| Live config unchanged | `sha256sum runtime/home/.automaton/automaton.json` | `1c10ecc5…4c966d`, identical to the pre-implementation baseline |
| Live DB unchanged | `ls -l runtime/home/.automaton/state.db` | 512000 bytes, mtime 2026-10-31 — unchanged |
| Stop → start cycle | `scripts/stop.mjs`, `scripts/start.mjs` | `[PASS] console stopped; the port is free and the pid file was removed.` then `[PASS] … launched (pid 22824)`; the agent was not started by either |
| Security headers on every response path | `curl -D` over `/`, `/index.html`, `/api/health`, a traversal-shaped path, an unknown dotted path, `/api/panels` | **3/3 headers on all six** (`nosniff`, `no-referrer`, CSP); HTTP 200 / 200 / 200 / 404 / 404 / 401 respectively |
| Browser | real Chrome, all 12 areas, three actions | zero console errors; every cell carried a verdict badge |

## 2. What each suite protects

| File | Tests | Invariant it defends |
|---|---|---|
| `http-contract.test.ts` | 14 | The wire behaves as documented: every data endpoint denies without a session; liveness answers without a credential **and without leaking Conway data**; the token→cookie exchange then serves panels; a bearer token that is not the operator token is refused; **a session issued for one loopback peer is served to that peer only**; cross-site read refused before touching Conway; blind form post without the opt-in header refused; an unknown route does not echo a stack or an internal path; malformed JSON is a 400 not a crash; non-JSON content type rejected; a flooding client is rate limited and told when to come back; restore rejects traversal and an untyped confirmation; **planning never names the live state directory as a target**; and "executes the plan that was confirmed, to the path that was shown". |
| `security.test.ts` | 15 | Token is 43-char base64url, stored 0600, never overwritten; empty/short/wrong-length candidates rejected without a timing side channel; the token does not leak into the cookie; cookie is `HttpOnly SameSite=Strict`; session binds to the issuing peer; unknown/empty cookie refused; cookie **or** bearer authenticates and nothing else; the session table is capped; same-origin GET needs no opt-in; cross-site read, header-less form post, **and a same-tab navigation from a foreign origin carrying the header** are all denied; a burst past bucket capacity is refused and recovers with time; action traffic stays separate from read traffic. |
| `panel-verdicts.test.ts` | 15 | The honesty contract of the UI: all 12 mandated areas render in the mandated order; **every value names a source**; **no cell is `VERIFIED` while its value is the word `UNKNOWN`**; agent runtime state stays `UNKNOWN` instead of showing the code default `'setup'`; the declared model is `NOT VERIFIED` because no inference has ever run; the security readers are `NOT VERIFIED`; **the phrase "seals failed" appears nowhere**; the guardian's raw status stays visible while its absent-source failure is reclassified; `EMPTY` (counted zero) is kept distinct from `UNKNOWN` (nothing to count); activation false and no wallet; lockdown on with an empty tool list; self-healing disabled with its mechanic unreachable; **a code default is labelled a code default, not an operator decision**; no logs, no soul, no timeline; heartbeats shown as declared-but-never-scheduled. |
| `restore-guard.test.ts` | 14 | Archive name is validated (empty/oversized/non-string, traversal); confirmation must equal the archive name; a manifest-less archive is refused; the target is never inside the live state directory; working-tree references are excluded; **execute refuses when nothing was confirmed first**; "copies exactly the directory the operator confirmed, then consumes the plan"; the confirmation is re-checked server-side, not only in the browser; an existing target directory is refused; a plan that failed its own gates is refused; a hand-built plan pointing outside the backups tree is refused; a manifest entry that escapes its archive is refused; and bytes go to a NEW directory while the live DB keeps its size and mtime. |
| `home-guard.test.ts` | 11 | The canonical runtime home is accepted (Windows **and** Git Bash posix spellings); an unset `HOME` is rejected instead of invented; the real Windows user profile, the historic `/root` fallback, a bare filesystem root, a non-existent directory, and **a different existing directory (i.e. a second Conway install)** are all rejected; the state directory pins under the runtime home; `process.env.HOME` is locked at import time; a failing guard surfaces remediation text rather than a bare throw. |
| `backup-verify.test.ts` | 9 | Archive hits and repo hits are labelled differently; a manifest entry that escapes its archive is refused; a changed archived file is `MISMATCH`, never `MATCH`; malformed hash lines are ignored rather than trusted; absent manifest → `kind: none` instead of a throw; the archives the operator can actually choose are listed; **every manifested archive verifies with zero non-MATCH entries**; the one manifest-less directory is kept out of the restore surface. |
| `danger-imports.test.ts` | 5 | No write-side Conway symbol is imported by any dashboard server file — with a **positive control** (the check does flag a denied import when one is present), a scan-size assertion so it cannot pass by scanning nothing, a permitted-reader/denied-write disambiguation, and a staleness check that every denied symbol still exists in Conway source. |
| `readonly-db.test.ts` | 5 | The canonical DB opens and nothing else; **"cannot write" is proven by SQLite refusing the statement, not by the dashboard asking politely**; integrity and schema version are reported without migrating; the four absent tables are confirmed still absent — which is *why* those panels render `NOT VERIFIED`; an existing table is counted without inventing rows. |
| `redact.test.ts` | 5 | Keys naming a credential drop their values; ordinary operational keys survive; key-shaped strings, PEM blocks, raw 32-byte hex and JWTs are scrubbed; nested objects/arrays walk and stop at the depth limit; **a secret cannot survive as a substring of a longer note**. |
| `response-headers.test.ts` | 4 | The three security headers (`nosniff`, `no-referrer`, CSP) are on **every** response path, not just JSON: the baseline is named, `sendJson` applies it, the static server's traversal refusal (400) applies it, and a caller adding a header such as `retry-after` cannot drop it. Added because the static and plain-text paths originally shipped without `referrer-policy`, and the not-built fallback shipped without CSP at all. |

Coverage is stated as test counts, not a percentage: `@vitest/coverage-v8` is **not installed**, and
installing it is an open operator decision (§5). Claiming a coverage number without running the
collector would be exactly the kind of unverified claim this phase is meant to prevent.

## 3. Non-vacuity — how the checks were proven to be able to fail

A green suite that cannot go red is worthless, so each critical guard has a counter-example:

| Check | Proof it can fail |
|---|---|
| Loopback-only exposure | A canary server bound to `0.0.0.0:8791` made the same probe report `[FAIL] not_exposed` naming the Wi-Fi address `<host-lan-ip>`, plus `[FAIL] server_identity` and `[FAIL] auth_wall`, exit **1**. |
| Danger-import scan | `danger-imports.test.ts` injects a denied import into a fixture and asserts the scanner reports it. |
| HOME guard | `home-guard.test.ts` runs the guard against the user profile, `/root`, a bare drive root, and a second install directory, and expects each to throw. |
| Redaction | `redact.test.ts` puts a secret inside a longer string and asserts the whole value is gone. |
| Backup verification | `backup-verify.test.ts` rewrites an archived file and asserts the result is `MISMATCH`, not `MATCH`. |
| Restore | The execute tests assert that a second execute — same parameters, valid confirmation — is **refused**, because the plan was consumed. |
| Read-only DB | The write test issues a real `INSERT` and asserts SQLite rejects it. |

## 4. Failures encountered, and what each one actually was

Twelve defects were found while running this loop. **Every one of them was in code written for this
dashboard — including its launch scripts and test configuration — and not one was found by reading
the code.** Each was found by reading executed output that disagreed with what the code said should
happen. Each is closed with a regression assertion.

| # | Symptom as observed | Real cause | Fix | Regression |
|---|---|---|---|---|
| 1 | Health check said `[FAIL] agent_still_inactive: activationApproved=TRUE` | The probe read `ROOT/automaton.json` instead of `runtime/home/.automaton/automaton.json`, and its `catch` inferred "open" from "could not read" | Correct `CONFIG_FILE`; an unreadable config is now `NOT VERIFIED`, which is neither claim | `status.mjs` 9 gate checks, all PASS; NOT VERIFIED blocks the exit code |
| 2 | `[FAIL] loopback_bind: nothing is listening` while the API answered 200 | `netstat -ano` output is mangled here and `Get-NetTCPConnection -State Listen` returns nothing for a live loopback listener — both unusable as a liveness source | TCP handshake probes (`canConnect`) instead of parsing OS tables | Canary at §3 proves the check discriminates |
| 3 | Restore wrote a directory whose timestamp differed from the one shown | Step 2 re-ran `planRestore()`, which generates a fresh target; the operator's confirmation was not a confirmation of what was written | Held plan + one-shot consume + re-verify at execute time; routes no longer re-plan | `restore-guard.test.ts` "copies exactly the directory the operator confirmed…"; `http-contract.test.ts` "executes the plan that was confirmed, to the path that was shown" |
| 4 | Plan tile rendered `[object Object]`-style raw array text | The client's `RestorePlan` mirror was invented — `name`/`source`/`files: number` — and did not match the server | Real mirror (`sourceDir`, `target`, `files: string[]`) + render the count | `http-contract.test.ts` pins `typeof body.plan.files[0] === "string"` and a truthy `sourceDir` |
| 5 | `RESTORE-NOTE.txt` "source archive" held a whole sentence | `noteFor` passed `plan.summary` where `plan.sourceDir` was meant | Provenance field corrected | `restore-guard.test.ts` asserts the note contains the archive path and **not** the summary sentence |
| 6 | `RESTART` refused to start the console; `stop.mjs` reported "survived both a graceful stop and taskkill (128)" after a successful kill | Liveness was tested as `commandLineOf(pid) === null`, but `Get-CimInstance` returns **empty string**, never null, for a dead process. (This also explains earlier `EADDRINUSE`/exit 5.) | Rewritten around `Get-Process`, plus a port re-read via `/api/health` and identity-gated handling of a detached listener | Verified live: stale pid → "already gone, pid file removed"; live → "[PASS] console stopped; the port is free and the pid file was removed." |
| 7 | Two test suites failed with unrelated errors mid-session | Extracted restore archives under `dashboard/restore-targets/` contain `*.test.ts` copies, and vitest's default glob executed them as source | `vite.config.ts` now imports `defineConfig` from `vitest/config` with `test.include: ["tests/**/*.test.ts"]` | Suite is 9 files, reproducible from the repo state |
| 8 | Login returned 403 in the browser | The login `fetch` itself omitted the `X-Conway-request: 1` opt-in header that every mutation requires | Header added on the auth call too | `security.test.ts` form-post cases; live login works |
| 9 | A panel cell displayed `UNKNOWN` under a green `VERIFIED` badge | Verdict and value were computed independently | The verdict vocabulary enforces the invariant centrally, in `values.ts` | `panel-verdicts.test.ts` "has no VERIFIED cell whose value is the word UNKNOWN" |
| 10 | Restore into an existing directory would merge over it | `mkdir` was called without exclusivity | Refuses any existing target before writing | `restore-guard.test.ts` "refuses to write over a directory that already exists" |
| 11 | `curl -D` showed the SPA page and the 400/404 plain-text responses **without** `referrer-policy`, and the not-built fallback without CSP | The headers were written inline in `sendJson` only, so every other response path silently lacked them — the classic "security control implemented in one place" failure | One exported `BASE_HEADERS` spread into all four response sites in `http.ts` + `index.ts` | `response-headers.test.ts` (4 tests) plus the live six-path header probe in §1 |
| 12 | **Self-inflicted while fixing #11:** the server typecheck failed with `TS2339 Property 'headersSent' does not exist on type '{}'`, and an earlier draft would have thrown a temporal-dead-zone `ReferenceError` at module load because the new constant referenced `CSP` before its declaration | A `this`-based test stub typed as `{}`; and a constant placed above the value it depends on. The duplicate-block mess that followed two careless edits was only visible by re-reading the file | Stub rewritten without `this`; `CSP` declared before `BASE_HEADERS`; duplicates removed and the region re-read | Both typechecks exit 0; suite 10 files / 97 tests; the server boots and answers, which a TDZ throw would have prevented |

Two further items were **not** dashboard bugs and are recorded as environment hazards instead:
`Atomics.wait` on the main thread (worked around in the stop script's polling loop) and the
unreliable exit codes on background-task notifications (verified by re-reading `/api/health` and the
process command line rather than trusting a shell exit status).

## 5. Not executed, and why — named rather than glossed

| Would-be check | Status | Exact blocker |
|---|---|---|
| Coverage percentage | **NOT RUN** | `@vitest/coverage-v8` is not installed; installing a dependency is an operator decision under §2 (inspect/back-up/record before changing). |
| Conway root suite re-run after dashboard implementation | **RUN** — 82 files / 2057 tests, 0 failed (§6) | — |
| E2E against the live agent | **BLOCKED — BY DESIGN** | The agent is inactive and must stay inactive (§17); there is nothing to exercise. |
| Real-data restore drill | **NOT YET PROVABLE** | No genuine user data exists yet. Fabricating data to make the test pass is explicitly prohibited (§7). |
| Live-model panel with real inference | **PENDING CREDENTIAL APPROVAL** | No credentials entered; §29 forbids it without approval. |
| Windows ACL verification of dashboard files | **NOT VERIFIED** | `icacls` hardening is **R-15**, an open operator decision; nothing was changed. |
| Accessibility audit beyond keyboard/contrast reading | **NOT RUN** | No axe/Playwright harness installed in this workspace. |

## 6. Conway root suite, re-run after the dashboard implementation

Run at 2026-11-01T10:29–10:31Z with the same pinned runtime and canonical `HOME`
(`node node_modules/vitest/vitest.mjs run --reporter=basic` from the repo root), full output in
`dashboard/diagnostics/PHASE_17_ROOT_SUITE.log`:

```
 Test Files  82 passed (82)
      Tests  2057 passed (2057)
   Duration  96.11s
```

**0 failed, 0 skipped.** The count is identical to the Phase 16E closure run (2057 passed), which is
the confirmation — not the assumption — that the dashboard changed nothing in Conway's behaviour.
The dashboard adds files under `dashboard/` only; `src/`, `dist/`, `automaton.json` and `state.db`
are untouched by it, and the root suite still passes at the same count.

Two observations from that log, recorded rather than tidied away:

- The root run does **not** sweep up `dashboard/tests` (zero occurrences of those paths in its
  output), so the two suites stay independent and neither can pass or fail on the other's files.
- The log is full of `level:"error"` JSON lines (`Inference API unavailable`, `API down`,
  `data: URI parse failed`, `Task 'failing_task' failure: Task failed intentionally`). These are
  the **expected** stderr of negative-path tests using deliberate mocks; the corresponding
  assertions passed. A reader who greps this log for `error` without reading the summary line would
  wrongly conclude the suite failed — which is why the counts above, not the noise, are the result.
