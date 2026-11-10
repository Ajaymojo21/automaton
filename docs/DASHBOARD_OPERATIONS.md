# Operating the AI Command Center console

Build, dependency, port and failure-mode reference for `dashboard/`. The day-to-day "start it,
read it" material is in [`DASHBOARD_USER_GUIDE.md`](DASHBOARD_USER_GUIDE.md); the guarantees are
in [`DASHBOARD_SECURITY.md`](DASHBOARD_SECURITY.md); the wire contract is in
[`DASHBOARD_API.md`](DASHBOARD_API.md).

## Layout

```
dashboard/
  server/            Node + TypeScript REST/SSE backend (never imported by the browser)
    panels/          the 12 areas, one module per group, plus types.ts
    index.ts         HTTP server, bind rules, shutdown, banner
    routes.ts        request gates and endpoint table
    db.ts            the ONLY SQLite handle in the console: readonly + fileMustExist
    home.ts          lockHomeOrThrow() — the HOME isolation guard
    security.ts      token, sessions, CSRF, rate limiting
    verify.ts        read-only re-hashing of backups against their own manifests
    commands.ts      the three actions, including the two-stage restore
    processes.ts     tasklist (the only subprocess in the console)
    redact.ts        structural secret redaction for the audit trail
  src/               React + TypeScript + Tailwind + Recharts client
  tests/             10 vitest files, 97 tests
  scripts/           start.mjs / stop.mjs / status.mjs — what the .bat files call
  diagnostics/       one-off probe scripts used to gather evidence (not part of the runtime)
  state/             token, pid, health reports
  logs/              audit JSONL + server stdout/stderr
  dist/              built SPA bundle (served by the same process)
  restore-targets/   only what an operator explicitly restores
```

The console is **not** a Conway workspace package. It has its own `package.json`, is not in the
root workspace list, and is not built by Conway's build. Deleting `dashboard/` leaves Conway
exactly as it was.

## Dependencies and the pinned runtime

Everything runs on the project's own Node — `runtime\node-v22.23.4-win-x64\node.exe` (v22.23.4,
ABI 127). Nothing is installed system-wide and the global npm configuration is untouched.

| Package group | Lives in | Why |
|---|---|---|
| react, react-dom, recharts, vite, vitest, tailwind, tsx, typescript | `dashboard/node_modules` (100 packages) | the SPA toolchain is dashboard-local |
| `better-sqlite3@11.10.0` | repo root `node_modules/.pnpm/…` via upward resolution | it must be the same ABI-matched native build the agent uses; a second copy would be a second `.node` binary to keep in sync |

`dashboard/.npmrc` pins the npm cache to `runtime/npm-cache` (273 MB, project-local) with
`save-exact=true`, `fund=false`, `audit=false`. That is a per-tree setting; the user's global
npm config is not modified. Evidence: `../reports/PHASE_17_CACHE_BEFORE.txt`,
`PHASE_17_CACHE_AFTER.txt`, `PHASE_17_NPM_INSTALL.log`.

## Build and verify

From `dashboard/`, with `HOME` pinned (the server refuses to start without it):

```bash
export HOME="<repo-root>\\runtime\\home"
N=../runtime/node-v22.23.4-win-x64/node.exe

$N ../node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json   # server  → exit 0
$N ../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json          # client  → exit 0
$N ./node_modules/vite/bin/vite.js build                                  # dist/
$N ./node_modules/vitest/vitest.mjs run --reporter=basic                  # 97 tests
```

Last full run on 2026-11-01:

- server typecheck exit 0, client typecheck exit 0
- `vite build` → `dist/index.html`, `dist/assets/index-sBvy4k0u.css` (17.85 kB),
  `dist/assets/index-BMdUMvJm.js` (532.87 kB, 154.96 kB gzip)
- `vitest run` → **10 files, 97 tests, 0 failed**, 3.41 s

The vite chunk-size warning at 500 kB is expected: React, Recharts and the d3 modules it pulls in
are one bundle, deliberately, because this is a single-page local console with no network
latency to optimise for.

**Rebuild after changing `src/`.** `server/index.ts` serves `dashboard/dist/`, not `src/`. The
Phase 16 post-mortem (`R-23`) was exactly this failure mode in Conway itself: a verified source
file is not the verified artifact. If the browser shows old behaviour, rebuild and hard-reload.

## Ports

`8787` by default, overridable with `CONWAY_DASHBOARD_PORT`. The server binds `127.0.0.1` and
**refuses to start** if `HOST` is anything else (exit 4) or if the port is 3001, which belongs to
FreeLLMAPI (`FORBIDDEN_PORTS`, exit 4). The vite dev server uses 8788 and proxies `/api` to 8787
with `changeOrigin: false`, so the same-origin check still applies in development.

```bash
CONWAY_DASHBOARD_PORT=8899 ../runtime/.../node.exe ../node_modules/tsx/dist/cli.mjs server/index.ts
```

`HEALTH_CHECK_DASHBOARD.bat` honours the same variable, so a second instance can be checked
independently.

### Proving reachability: probe, do not read a socket table

Phase 18 found, and the Phase 19 baseline re-measured on 2026-11-01, that **`netstat` does not
reliably enumerate the listening socket for this console.** With the server running and accepting
connections:

| Check | Result |
|---|---|
| `netstat -ano -p tcp \| findstr 8787` — 20 captures over ~2 minutes | **no `LISTENING` row** in any of them; `ESTABLISHED` / `TIME_WAIT` rows for the same port appear normally |
| the same two commands 22 captures in — 2 captures | did show `TCP 127.0.0.1:8787 0.0.0.0:0 LISTENING <pid>` |
| `Get-NetTCPConnection -LocalPort 8787 -State Listen` | **no record** |
| `exec 3<>/dev/tcp/127.0.0.1/8787` (positive TCP probe) | **connected in every trial**, and `GET http://127.0.0.1:8787/` returned `200`, 792 bytes |
| `exec 3<>/dev/tcp/<Wi-Fi interface IP>/8787` | **`Connection refused`** |

The operational rule that follows is one-directional and must not be inverted:

- **Absence of a listener row is not evidence of non-exposure.** Never conclude "nothing is
  listening" from an empty `netstat`/`Get-NetTCPConnection` result — this console is proof that a
  live, accepting listener can be missing from both.
- **Presence of a row is not evidence of exposure either**, until the owning PID is attributed.
  `STOP_CONWAY_DASHBOARD.bat` exists precisely because a port can be held by a stranger.

Establish reachability with **positive connection probes** and then attribute the owning PID:

```bash
# 1. does it answer?
(exec 3<>/dev/tcp/127.0.0.1/8787 && echo OPEN && exec 3<&-) || echo CLOSED
# 2. is it loopback-only? probe the machine's own non-loopback address
(exec 3<>/dev/tcp/<LAN-IP>/8787 && echo "EXPOSED" && exec 3<&-) || echo "refused — not reachable here"
# 3. who owns it (the console refuses any other bind)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' |
  Where-Object { $_.CommandLine -match 'Conway-Automaton' } | Select-Object ProcessId, CommandLine"
```

`HEALTH_CHECK_DASHBOARD.bat` → `dashboard/scripts/status.mjs` already uses the positive-probe method
for its port checks rather than trusting a socket table; `DASHBOARD_SECURITY.md` §"the loopback proof"
records the canary control that shows the probe discriminates.

## Launchers

| Script | Behaviour |
|---|---|
| `START_CONWAY_DASHBOARD.bat` | → `dashboard/scripts/start.mjs`. Verifies HOME, `state.db`, Node, tsx and the server entry; refuses if the port already answers (nothing is killed to free it); spawns a detached hidden server with output appended to `dashboard/logs/`; records the pid with `wx`; prints a banner stating the agent was not started. Exit 0 only on `[PASS]`. |
| `STOP_CONWAY_DASHBOARD.bat` | → `stop.mjs`. Reads the pid file, proves the process exists, reads its live command line and refuses unless it is the Conway runtime running `server/index.ts`; graceful signal, then `taskkill /T /F` on the tree; then re-checks the port and stops the detached listener if it outlived the launcher. Keeps the pid file if anything failed. |
| `RESTART_CONWAY_DASHBOARD.bat` | stop then start, and it **refuses to start a second console on top of one that would not stop**. |
| `HEALTH_CHECK_DASHBOARD.bat` | → `status.mjs`. 19 checks, one line each, plus a JSON report in `dashboard/state/`. Exit 1 on any FAIL **or NOT VERIFIED**. |

Pass any argument to skip the trailing `pause` (used by the automated runs:
`cmd //c "HEALTH_CHECK_DASHBOARD.bat arg1"`).

Desktop shortcut: **Conway Automaton Control Center** → `START_CONWAY_DASHBOARD.bat`, working
directory `<repo-root>`. The pre-existing **Conway Automaton** shortcut
(→ `START_CONWAY.bat`, the agent) was not modified.

## Failure modes and what they mean

| Symptom | Cause | Action |
|---|---|---|
| `REFUSING TO START … port 8787 is already in use` (exit 5) | a console is already running | use `RESTART_CONWAY_DASHBOARD.bat`; nothing is killed to free the port |
| `[FAIL] … does not belong to the Conway dashboard` | the pid file points at a recycled pid | stop.mjs refused to kill a stranger — investigate the pid, then delete `dashboard/state/dashboard.pid` by hand |
| `[info] pid N is already gone; the stale pid file was removed` | the server died without cleaning up | run `START_CONWAY_DASHBOARD.bat` again |
| `[FAIL] port 8899 is still answered by pid N, which is not the dashboard server` | a different program holds the port | stop.mjs refused to kill it; move the console to another port |
| Browser says `cross-origin request refused` on login | the request lacked `X-Conway-request: 1` | use the page's own form; a hand-rolled `fetch` must send the header |
| Console shows the token gate after it worked | the server restarted (sessions are memory-only) | unlock again |
| `REFUSING TO START … HOME` (exit 3) | `HOME` is not `runtime/home` | never work around it — see below |
| `[NOT VERIFIED] gates` | the live config could not be read | the health check is refusing to guess; check `runtime/home/.automaton/automaton.json` exists |

## The HOME rule

The console refuses to run unless `HOME` resolves to
`<repo-root>\runtime\home`. Do not relax this, and do not run the server
from a shell that has fallen back to `C:\root.automaton` or the Windows user profile: the whole
point of the guard is that a console reading the wrong database would report *true things about
the wrong system*. `tests/home-guard.test.ts` exists so the guard cannot quietly become
decorative.

## Development loop

```bash
# terminal 1 — API on 8787
cd dashboard && HOME="<repo-root>\\runtime\\home" \
  ../runtime/node-v22.23.4-win-x64/node.exe ../node_modules/tsx/dist/cli.mjs server/index.ts

# terminal 2 — SPA on 8788 with hot reload, /api proxied to 8787
cd dashboard && ../runtime/node-v22.23.4-win-x64/node.exe ./node_modules/vite/bin/vite.js
```

`npm run server` uses `tsx watch`; the launchers do not, because a watch mode detached from a
terminal is a server that restarts under an operator's feet.

## Test suite

`vite.config.ts` restricts vitest to `tests/**/*.test.ts`. That restriction is load-bearing:
`restore-targets/` holds files copied out of Conway backups, including their own `*.test.ts`,
and the default glob picked two of them up and tried to run them. Unverified bytes taken out of
an archive must never become part of the project's own test run.

| File | Tests | Proves |
|---|---|---|
| `home-guard.test.ts` | 11 | the HOME guard rejects five wrong environments, non-vacuously |
| `security.test.ts` | 24 | token shape, timing-safe compare, session cap, peer binding, logout revocation, CSRF, rate limit boundary |
| `stream.test.ts` | 3 | a revoked session's open event stream is closed, and a bearer client's is not |
| `danger-imports.test.ts` | 5 | no server file imports the 12 forbidden Conway symbols, with a positive control |
| `readonly-db.test.ts` | 5 | the live handle cannot write, and the V12/V13 tables really are absent |
| `panel-verdicts.test.ts` | 15 | the 12 areas in order, every cell names a source, no VERIFIED cell carries "UNKNOWN", absent tables are NOT VERIFIED |
| `redact.test.ts` | 5 | secret key names (including `privateKeyPem`) and secret-shaped values never reach the log |
| `backup-verify.test.ts` | 9 | archive-vs-repo labelling, traversal rejected, tampering detected, real tree verifies |
| `restore-guard.test.ts` | 17 | every refusal, the confirmed-path reuse, single-use plans, existing-target refusal, live DB untouched |
| `models-provider-panel.test.ts` | 8 | provider/model status is presence-only and absent models are NOT VERIFIED |
| `http-contract.test.ts` | 21 | the real request gates at the HTTP boundary, including the stream handshake, plus plan→execute writing the confirmed path |
| `response-headers.test.ts` | 4 | CSP, `nosniff` and `no-referrer` on **every** response path — JSON, the SPA page, the traversal 400, the not-built fallback — and a custom header cannot displace the baseline |

## Backing this directory up

`dashboard/` needs no backup of its own except `state/dashboard.token` — and that token is a
loopback credential, regenerable by deleting the file and restarting. `state/`, `logs/`, `dist/`
and `restore-targets/` are all reproducible. Conway's real state (`runtime/home/`, `backups/`)
is backed up by the Phase 16 tooling, not by the console.
