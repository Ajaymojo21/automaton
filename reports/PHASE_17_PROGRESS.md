# Phase 17 — Progress and Evidence Log

Persistent checkpoint log for the AI Command Center build, in the format of
`PHASE_16_PROGRESS.md`: command, output, timestamp, hash. **All timestamps are UTC**
(this machine runs at UTC+05:30 — e.g. a filesystem mtime of `15:48` is `10:18Z`).

Retracted claims are kept in place with the correction underneath. Deleting them would destroy the
only record of how the wrong conclusion was reached.

---

## 1. Standing facts, re-established at the end of the phase

| Fact | Value | Measured |
|---|---|---|
| Canonical HOME | `<repo-root>\runtime\home` | `[PASS] home_isolated` every run |
| Live config | 1382 bytes, mtime 2026-10-31T10:56:18Z, SHA-256 `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | before the walk and again at 10:26Z after it — **identical** |
| Live DB | 512000 bytes, mtime 2026-10-31T10:25:59.744Z, journal `wal`, `integrity_check` ok, schema 11 vs code 13 | `readonly-db.test.ts` + `db.ts` |
| Absent tables | `security_events`, `security_incidents`, `security_seals`, `treasury_authorizations` | confirmed still absent — the reason those panels say `NOT VERIFIED` |
| Console port | 8787 (`CONWAY_DASHBOARD_PORT` override), loopback only; 8788 is the Vite dev server, which proxies `/api` to 8787 | `paths.ts`, `vite.config.ts` |
| Runtime | `runtime/node-v22.23.4-win-x64/node.exe` — v22.23.4, ABI 127 | every command in this log used it; no global Node |
| npm cache | project-local `runtime/npm-cache` (273 MB), `dashboard/.npmrc` `save-exact=true` | `PHASE_17_CACHE_BEFORE/AFTER.txt` |
| Agent status | **inactive** — `CONWAY_ACTIVATION` unset, all nine gates closed | `status.mjs` at 10:26Z |

## 2. Timeline

### 2.1 Scaffold and dependency isolation — 09:16–09:17Z

`dashboard/package.json` created as an isolated workspace (`private`, `type: module`, not part of the
Conway pnpm workspace). Dependencies installed through the project-local cache so the user's npm
cache and global state stayed untouched:

```
reports/PHASE_17_CACHE_BEFORE.txt  313 B   09:16Z
reports/PHASE_17_NPM_INSTALL.log   840 B   09:17Z   100 packages → dashboard/node_modules
reports/PHASE_17_CACHE_AFTER.txt   313 B   09:17Z
```

`better-sqlite3@11.10.0` was deliberately **not** re-installed: it resolves from
`node_modules\.pnpm\better-sqlite3@11.10.0\…`, the ABI-127 build Conway already uses. Two native
builds of the same DB file would be a correctness hazard, not just duplication.

### 2.2 Source-surface probes — 09:35–09:36Z (read-only)

`dashboard/diagnostics/` holds the six scratch probes used to establish what the console may safely
read. They were moved out of `reports/` once read, because they are tooling, not deliverables.

```
PHASE_17_TABLE_PROBE.cjs      09:25Z   table presence/absence
PHASE_17_ROW_COUNT_PROBE.cjs  09:25Z   row counts against the read-only handle
PHASE_17_PANEL_DUMP.cjs       09:35Z   → PHASE_17_PANEL_DUMP.txt (11 915 B, all 12 panels)
PHASE_17_SERVER_BOOT.log      09:34Z   first boot of the server
PHASE_17_HEALTHCHECK_DUMP.cjs 09:35Z   the health action's real payload
```

First health artefact persisted at **09:36:53Z** (`dashboard/state/health-2026-11-01T09-36-53-173Z.json`).

### 2.3 Self-caught defects, first pass

**Defect — the login request omitted its own CSRF opt-in header.** Symptom: `POST /api/auth` returned
403 in the browser while every other call worked. Cause: `isTrustedRequest()` requires
`X-Conway-request: 1` on all non-GET methods, and the auth `fetch` was written before that rule was
applied to itself. Fix: header added on the auth path. Regression: `security.test.ts` "denies a form
post that omits the explicit opt-in header" and "denies a same-tab navigation from a foreign origin
even with the header".

**Defect — a cell could render `VERIFIED` above the value `UNKNOWN`.** Cause: verdict and value were
assigned independently per cell. Fix: the invariant is enforced in `values.ts`, so it cannot be
forgotten at a call site. Regression: `panel-verdicts.test.ts` "has no VERIFIED cell whose value is
the word UNKNOWN".

### 2.4 Health-check attempts — 10:00–10:05Z

Two `[FAIL]` lines appeared in `dashboard-health-2026-11-01T10-00-33-732Z.json` and its follow-ups at
10:05:27Z / 10:05:34Z. Both were bugs in the *checker*, and each one nearly produced a false security
claim.

**Defect — `agent_still_inactive: activationApproved=TRUE`.** The probe read
`<repo-root>\automaton.json`, which does not exist, and its `catch` inferred
"gates open" from "could not read". **Retracted:** the wrong conclusion was that a security invariant
had been violated. Reality: the correct file
(`runtime/home/.automaton/automaton.json`) reads `activationApproved: false` — and the failure mode
was worse than a false alarm, because an unreadable config was being reported as a security breach
rather than as unproven. Fix: `CONFIG_FILE` points at the real path; an unreadable config now yields
`NOT VERIFIED`, which blocks the exit code without claiming either outcome.

**Defect — `loopback_bind: nothing is listening` while the API returned 200.** Cause: the probe
parsed `netstat -ano` (whose LISTENING rows are mangled on this machine — remote addresses appear in
them) and `Get-NetTCPConnection -State Listen` (which returns nothing for a live loopback listener
here). **Both are unusable as liveness sources in this environment.** Fix: TCP handshake probes
(`canConnect`, 800 ms), plus `server_identity` (PID → command line → `server/index.ts` under the
runtime Node) so "something is listening" and "the right thing is listening" are separate checks.

### 2.5 Non-vacuity — the canary negative control

A check that only ever passes proves nothing. A throwaway server was bound to **`0.0.0.0:8791`** and
the same probe run against it:

```
[FAIL] not_exposed: … Wi-Fi <host-lan-ip>
[FAIL] server_identity: …
[FAIL] auth_wall: …
exit 1
```

So the loopback-only assertion distinguishes an exposed listener from a bound one. Also fixed in the
same change: link-local IPv6 (`fe80::/10`, multicast `ff`) is excluded from the routable-address list,
because refusing there would prove nothing about exposure.

### 2.6 The restore path — 10:18Z, and the one that mattered

`dashboard-health-2026-11-01T10-18-25-732Z.json` and
`dashboard/restore-targets/phase15-pre-20261031-211345--2026-11-01T10-18-51-787Z` are the artefacts of
the fixed flow, observed in the real browser:

```
Planned: 3 verified file(s) → …--2026-11-01T10-18-51-787Z
copied 3 file(s) to …--2026-11-01T10-18-51-787Z. The live database was not touched.
```

**Defect — the path the operator confirmed was not the path written.** Step 2 re-ran `planRestore()`,
which mints a fresh timestamped target each call, so the confirmation described a directory that was
not the one created. Detected only by reading the two strings next to each other; no code review
flagged it, and both steps "worked". Fix: `heldPlans` map (TTL 10 min), one-shot consume in
`executeConfirmedRestore()`, server-side re-check of the confirmation, re-verification of archive
bytes at execute time, refusal of an existing target, and refusal of any source outside the backups
tree even for a hand-built plan object.
Regressions: `restore-guard.test.ts` (14 tests, incl. "copies exactly the directory the operator
confirmed, then consumes the plan", asserting live `state.db` size+mtime unchanged) and
`http-contract.test.ts` ("executes the plan that was confirmed, to the path that was shown").

**Defect — the plan tile printed a raw array.** Root cause was worse than a formatting bug:
`src/types.ts` contained a **fabricated** `RestorePlan` mirror (`name`, `source`, `files: number`)
describing fields the server never sends. Fix: mirror matches the real server shape; `Actions.tsx`
renders `planned.files?.length`. The wire contract is now pinned (`typeof body.plan.files[0] === "string"`,
truthy `sourceDir`).

**Defect — `RESTORE-NOTE.txt` printed a sentence where the source archive belonged.** `noteFor`
passed `plan.summary` instead of `plan.sourceDir`, so the provenance record was useless. Fixed and
asserted (note contains the archive path and **not** the summary text).

### 2.7 Vitest executed code from inside a backup

**Defect — two suites failed with unrelated errors.** Cause: restore archives extracted into
`dashboard/restore-targets/` contain `*.test.ts` files from Conway's own history, and vitest's
default glob picked them up as this project's tests — the suite was running archived, unverified code.
Fix: `vite.config.ts` imports `defineConfig` from `vitest/config` with
`test.include: ["tests/**/*.test.ts"]`. The root Conway run confirms the separation independently:
`dashboard/tests` appears **0 times** in its output.

### 2.8 Stop / restart — and a third false alarm

Earlier in the session the console had refused to restart with `EADDRINUSE` / exit 5, which had been
recorded as "a stale process held the port". **Retracted.** The real cause:

**Defect — `stop.mjs` reported survival after a successful kill.** Liveness was tested as
`commandLineOf(pid) === null`, but `Get-CimInstance Win32_Process` returns an **empty string**, not
null, for a dead process. So the kill succeeded, the script declared the process immortal, fell back
to `taskkill`, kept the pid file, and `RESTART` then correctly refused to start a second console. The
`EADDRINUSE` I had blamed on the environment was my own bookkeeping.

Fix: `processExists()` via `Get-Process`; graceful `process.kill` → 12 × 250 ms poll → `taskkill /T /F`
→ 20 × 250 ms poll; then a **port re-check** through `GET /api/health` (reading `body.pid`) so a
detached listener left behind by the launcher is handled — identity-gated, same
`RUNTIME_NODE` + `server/index.ts` match, never a blind kill. Verified:
- stale pid → `[info] pid 31532 is already gone; the stale pid file was removed.`
- live console → `[PASS] console stopped; the port is free and the pid file was removed.`

Related environment note recorded so a future run does not repeat it: `Atomics.wait` on the main
thread is used deliberately for the polling pause (a `setTimeout` loop in a synchronous script would
spin), and background-task exit-code notifications on this harness are unreliable — every "it passed"
below was re-read from the command's own output file, not from the notification.

### 2.9 Closure runs — 10:26Z onward

| Time (UTC) | Command | Result |
|---|---|---|
| 10:26:2x | `tsc --noEmit -p tsconfig.server.json` | exit 0, no diagnostics |
| 10:26:2x | `tsc --noEmit -p tsconfig.json` | exit 0, no diagnostics |
| 10:26:29 | `curl /api/health` | `{"ok":true,"verdict":"VERIFIED","pid":31952,…}` |
| 10:26:36–39 | `scripts/status.mjs` | **19 pass, 0 fail, 0 not verified, 0 warn**, exit 0 → `dashboard-health-2026-11-01T10-26-39-578Z.json` |
| 10:26 (local 15:56:09) | `vitest run` (dashboard) | **9 files, 93 tests, 0 failed**, 3.35 s |
| 10:29–10:31:48 | `vitest run` (Conway root, pinned Node + canonical HOME) | **82 files, 2057 tests, 0 failed**, 96.11 s → `dashboard/diagnostics/PHASE_17_ROOT_SUITE.log` |
| 10:26 (before) and 10:35 (after) | `sha256sum automaton.json` | `1c10ecc5…4c966d` — unchanged across the whole phase |
| 10:35:06 | audit log | 141 events on 2026-11-01 |

The root-suite re-run exists specifically to convert "the dashboard cannot have changed Conway" from
an assumption into a measurement. It matches the Phase 16E closure count exactly (2057).

Note on that log, so nobody misreads it: it is full of `level:"error"` JSON lines (`Inference API
unavailable`, `API down`, `data: URI parse failed`, `Task 'failing_task' failure: Task failed
intentionally`). Those are the expected stderr of negative-path tests with deliberate mocks; the
summary line is `2057 passed (2057)`.

### 2.10 Documentation and index closure — 10:35Z onward

Four docs (`docs/DASHBOARD_{USER_GUIDE,API,SECURITY,OPERATIONS}.md`) written earlier in the phase and
re-checked against the code they describe. **Two corrections found during that re-check and fixed
before sign-off:** `DASHBOARD_API.md` first documented `form-action 'none'` and omitted
`style-src 'unsafe-inline'` — neither is the real CSP — and named the audit sink `audit.log` when it is
`audit-<YYYY-MM-DD>.jsonl`. A doc that quietly improves the implementation is worse than no doc,
because the next reader trusts it.

Four reports (`reports/DASHBOARD_{IMPLEMENTATION,SECURITY,TEST_RESULTS,ACCEPTANCE}_REPORT.md`) plus
this log; the Phase 17 section added to `docs/README.md`; gap 19 annotated as closed in
`reports/PHASE_16_DATASOURCE_INVENTORY.md`.

## 2.11 The last thing found was in my own security control

After the four reports were written, the live console was probed with `curl -D -` across every
response path. `/api/*` returned the three security headers; **`/`, `/index.html`, the traversal
refusal and the not-built fallback did not carry `referrer-policy`**, and the fallback carried no CSP
either. The control had been implemented inside `sendJson` and nowhere else — which is exactly the
shape of failure a header review misses, because the headers *are* in the code.

Fix: one exported `BASE_HEADERS` in `dashboard/server/http.ts`, spread into all four response sites
(`sendJson`, `serveStatic`, the not-built fallback, and the router's 404 in `index.ts`).

Two mistakes made *while applying that fix*, recorded rather than quietly corrected:

1. The new constant referenced `CSP` **above** its declaration — a temporal-dead-zone
   `ReferenceError` at module load, i.e. the server would not have booted at all. Caught by placing
   `CSP` first and confirmed by actually starting the server.
2. The first draft of `response-headers.test.ts` used `this` inside an object literal typed as `{}`;
   the **server typecheck failed with `TS2339`** and reported it before anything shipped. The
   duplicate blocks my two careless edits produced were caught by re-reading the file, not by the
   compiler.

Re-verified after the restart, 10:41Z:

```
stop.mjs  → [PASS] console stopped; the port is free and the pid file was removed.
start.mjs → [PASS] Conway AI Command Center launched (pid 22824) … The Conway agent was NOT started.
status.mjs→ 19 pass, 0 fail, 0 not verified, 0 warn — dashboard-health-2026-11-01T10-41-10-623Z.json
vitest    → Test Files 10 passed (10) · Tests 97 passed (97) · 3.41s
tsc server→ exit 0     tsc client→ exit 0
curl      → / , /index.html , /api/health , a ../ traversal path , /nope.xyz , /api/panels
            all 3/3 security headers (200 200 200 404 404 401)
sha256    → automaton.json 1c10ecc5…4c966d (unchanged) · state.db 512000 B, mtime 2026-10-31 (unchanged)
```

The stop/start cycle also re-proved the §2.8 fix in production: a clean stop, a free port, a clean
start, and no second-instance refusal. The client sources did not change, so `dashboard/dist` is
still the bundle hashed in §4 — no rebuild was needed, and R-23 says to check that rather than assume
it.

After the documentation pass that followed (`docs/DASHBOARD_API.md` and
`docs/DASHBOARD_OPERATIONS.md` updated for the new suite), the gates were run once more at 10:47Z:
both typechecks exit 0 and `Test Files 10 passed (10) · Tests 97 passed (97) · 3.44s` — the same
counts, from a markdown-only change, which is what a change to documentation should produce.

## 3. Deliverable hashes — final pass, 2026-11-01T10:45:32Z

```
4d9fb78789c6b4705131ea1b60d017e93fb67db1d62dda10c50624c5ff23d8c4  dashboard/dist/assets/index-BMdUMvJm.js
34b8c33cd239b414b2d563ca1757e27ea5fac8798d27d65dcbe4a18f2f4790cd  dashboard/dist/assets/index-sBvy4k0u.css
d1d24c011c2e5805effd9c709ca644d397bf78d5c2a96dd512985fd4b8c2bad1  dashboard/dist/index.html
dbb4db7c16a511588549ce7ee7a684ddfefc7020f82e275afbf6ce220965e254  dashboard/server/http.ts        (BASE_HEADERS fix)
a04c4ac5b474c455381806bfe918bc97ff65533eee802abbcc74d86d27a0c8e8  dashboard/server/index.ts       (404 path headers)
e3dba64d9736913c125b691726be15881b3cf4b81807df42567096c42381559c  dashboard/tests/response-headers.test.ts
8da2c0759d2e002d8341b8678beed914ac9836085632b5941084d66946eb17bb  docs/DASHBOARD_USER_GUIDE.md
cc477898151ea21645d9ca494b3c637efd315e8e069467c84ddf72f2e0c54453  docs/DASHBOARD_API.md   (superseded at 10:48Z — see the note under this block)
a2702b217e72a7139b1d0e43c63e8bd4365e9da1fd845740750d949e6bee021b  docs/DASHBOARD_SECURITY.md
9b9f0bc097b65eb7de3f624d7841c590695c2df0243c1d97d240b1b3a90e3175  docs/DASHBOARD_OPERATIONS.md   (superseded at 10:48Z — see the note under this block)
170cd12fee6515327dcb48db0a14efe91f20fce7013c20b5820d6ff0089618e6  docs/README.md                 (Phase 17 index added)
1263c253c914649122b44d8e12eb4e84bfc695f5e4e59e931756694445fd9b7a  reports/DASHBOARD_IMPLEMENTATION_REPORT.md
d2550ccc0f864af03f2747fc9747101bfc6bd83682eb7a51b2dce87fff84a012  reports/DASHBOARD_SECURITY_REPORT.md
a16f37be87e1ed626443285f10fc72a8f11f164ea83585be886f5b5d11d2a22b  reports/DASHBOARD_TEST_RESULTS.md
ca9f2e3b1801cd22c56db97d7d57de2037cd35f38f2e9513d1ceb93bb01f1490  reports/DASHBOARD_ACCEPTANCE_REPORT.md
dafc55deb353705e6e4ae19ce8d3bd75c28188883304bd7180c68a496bc9a8f6  dashboard/state/dashboard-health-2026-11-01T10-41-10-623Z.json
1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d  runtime/home/.automaton/automaton.json  ← the invariant
```

Two rows above are marked *superseded*. They are the hashes as measured at 10:45:32Z, and both
files were edited again after that pass — the §2.11 header fix needed documenting in the API
contract and the suite count needed correcting in the operations guide. Re-hashed at 10:48:15Z:

```
e46d4729da30776d218c95d49e1df59047b3886c3eb07a6aba1b46965b76d6a0  docs/DASHBOARD_API.md
4b8ca6f88e7e8f832f895c6465ed11b2a76a7eb40f36b3af3248d316e617320e  docs/DASHBOARD_OPERATIONS.md
```

Nothing else moved. The four `reports/DASHBOARD_*.md` hashes and the three `dashboard/dist` hashes
were re-run in the same command as the two above and matched the 10:45:32Z values byte for byte,
which is the check that matters: a markdown edit in `docs/` must not be able to change a bundle, and
if it had, the dist hashes would have said so. Marking the rows instead of silently replacing them
keeps the 10:45:32Z pass retrievable.

Earlier in the phase, at 10:35:06Z, the same set was hashed before the §2.11 fix; the four report
hashes differ from that pass and the three `dist` hashes are identical, which is the expected
signature of a server-side-only change with a documentation pass.

**This log's own hash cannot be recorded inside itself.** At the 10:35:06Z pass it was
`3aa31b7c8f352926c953cfde8bcf809fcdb50d1a79c48287f0506f90f582c2d9`, taken before this section was
rewritten; re-hash it externally if a receipt is needed.

**Rebuild rule carried over from Phase 16 R-23:** a verified source is not a verified artifact. If
`dashboard/src/**` changes, re-run `vite build` before trusting `dashboard/dist`, and re-check
`dist/` against `src/` for the Conway runtime too.

## 4. What is deliberately not in this phase

- No agent activation, no wallet, no funding, no credential entry, no purchase, no transaction,
  no financial tool, no replication, no network exposure, no service install, no Windows security
  change, no autonomous-execution enablement — the fourteen §29 items, none performed.
- No claim that application-level isolation equals OS isolation, and no "zero vulnerabilities".
- No fabricated data to make a blocked drill look complete. `REAL_DATA_RESTORE = NOT YET PROVABLE`
  is written in the UI and in the reports for the same reason.
