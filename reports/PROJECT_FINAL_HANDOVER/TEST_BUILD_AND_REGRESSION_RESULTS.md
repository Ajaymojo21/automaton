# Test, Build and Regression Results

- Date: 2026-11-10
- Runtime: pinned Node `v22.23.4` (`runtime/node-v22.23.4-win-x64/node.exe`)
- Test runner: vitest 2.1.9 (`node_modules/vitest/vitest.mjs`)
- Compiler: TypeScript 5.9.3 (`node_modules/typescript/bin/tsc`)
- All commands below were executed and their output captured. Nothing in this report is projected.

## 1. Regression suites

| Suite | Command | Files | Tests | Exit | Duration | Log |
|---|---|---|---|---|---|---|
| Root (full) | `runtime\node-v22.23.4-win-x64\node.exe node_modules\vitest\vitest.mjs run` | 98 | 2378 | 0 | 109.25 s | `runtime/tmp/final-full-suite.log` |
| Dashboard | `cd dashboard && <pinned node> node_modules\vitest\vitest.mjs run` | 11 | 108 | 0 | 3.43 s | `runtime/tmp/final-dashboard-suite.log` |
| Focused heartbeat | vitest on `heartbeat-scheduler.test.ts` + `heartbeat.test.ts` | 2 | 41 | 0 | - | session output |
| Mission group A | 10 files: repair-approval, repair-approval-persistence, url-guard, url-guard-call-sites, provider-url-validation, phase16-backup-roundtrip, phase15-treasury, f1-treasury-fail-closed, failover-classifier, freellmapi-provider | 10 | 242 | 0 | - | session output |
| Mission group B (B-3/B-5/B-6) | 8 files: freellmapi-fallback, freellmapi-provider, provider-url-validation, failover-classifier, log-redaction, phase16-audit-visibility, x402-paid-request-no-retry, phase16-live-model-preflight | 8 | 131 | 0 | - | session output |

Dashboard suite detail (from the log): redact 5, response-headers 4, danger-imports 5, home-guard 11,
security 15, readonly-db 5, backup-verify 9, restore-guard 17, models-provider-panel 8,
panel-verdicts 15, http-contract 14.

## 2. Typechecks

| Target | Command | Exit |
|---|---|---|
| Root | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 0 |
| Dashboard UI | `node node_modules/typescript/bin/tsc -p dashboard/tsconfig.json --noEmit` | 0 |
| Dashboard server | `node node_modules/typescript/bin/tsc -p dashboard/tsconfig.server.json --noEmit` | 0 |

The dashboard server typecheck initially failed with `TS2552: Cannot find name 'RequestInfo'` at
`src/inference/provider-url.ts:270,292`, because that tsconfig has no DOM lib. Fixed by deriving the
input type from `fetch` itself (`type FetchInput = Parameters<typeof fetch>[0]`). After the fix, all
three typechecks are clean. The 54 provider URL tests remained green.

## 3. Production builds

| Target | Command | Exit | Output |
|---|---|---|---|
| Root | `node node_modules/typescript/bin/tsc -p tsconfig.json` | 0 | `dist/` emitted |
| Dashboard | `node node_modules/vite/bin/vite.js build` (in `dashboard/`) | 0 | 836 modules; `dist/assets/index-CorZBI7P.js` 532.91 kB |

## 4. Specialised harnesses

| Harness | Command | Result | Log |
|---|---|---|---|
| B-1 migration package | `<pinned node> runtime/tmp/b1-migration-package.mjs` | `B-1 RESULT: PASS` | `runtime/tmp/b1-final.log` |
| Section 11 invariants | `<pinned node> node_modules/tsx/dist/cli.mjs runtime/tmp/final-invariants.mts` | PASS: 34 pass, 0 fail, 3 NOT VERIFIED | `runtime/tmp/final-invariants.log` |
| Dashboard browser walk-through | `<pinned node> runtime/tmp/s5-dashboard-browser.mjs` | PASS: 13 areas, 0 console/page/request errors | `runtime/tmp/s5-browser.log`, `runtime/tmp/s5-shots/` |
| Dashboard live API probe | `<pinned node> runtime/tmp/s5-dashboard-live.mjs` | PASS: 13 panels, auth wall, forbidden endpoints rejected | `runtime/tmp/s5-live.log` |

## 5. Failures encountered and resolved during the session

1. Zombie dashboard process: a previously launched console was reported alive but had no listening
   socket after a stop. The stop script verified the command line before terminating it, then the
   server was restarted. Later a child process answered HTTP while `netstat` showed no LISTEN row;
   the LAN-refusal probe was used as the behavioural proof of loopback-only binding.
2. Browser harness expected 12 areas and found 13 after Repair Approvals was labelled. The harness
   was corrected, because 13 is the intended product surface.
3. Browser harness counted the expected SSE teardown (`GET /api/stream`, `net::ERR_ABORTED`) as a
   failed request after "Lock console". Filtered as an expected abort; no other request failed.
4. Dashboard server typecheck (see section 2). Fixed in source, not by relaxing the config.
5. Invariants harness run under the system Node v24.18.0 failed with `ERR_DLOPEN_FAILED`
   (`better-sqlite3` built for NODE_MODULE_VERSION 127, runtime 137). Re-run with the pinned Node
   22.23.4. This is a toolchain fact, not a product defect.
6. Invariants harness queried a nonexistent `events` table; the production V11 schema has `turns`
   instead. The probe was corrected to `turns` (0 rows).

No test was deleted, skipped, or weakened to reach green. The heartbeat fix added assertions
(lockdown performs no top-up call; a stubbed top-up is reported), and the dashboard/source fixes were
made in production code with tests unchanged.

## 6. Coverage statement

The mission's 80% coverage expectation applies to new logic. New and changed modules are covered by
focused suites: repair approvals (26 tests), URL guard (19 + 10 call-site), provider URL (54),
treasury fail-closed (9), failover (24), backup/restore (21), heartbeat (41 across two files),
dashboard (108). Line coverage percentages were not regenerated in this run; where a numeric coverage
figure is required, it should be produced with `vitest run --coverage` rather than asserted here.

## 7. Reproducibility notes

- Always invoke the pinned Node binary. The system Node v24 cannot load the installed
  `better-sqlite3` native module.
- The dashboard suite runs from `dashboard/` against its own `node_modules`.
- The browser harness needs `playwright-core` and the Chromium executable at the paths recorded in
  the harness; it reads the operator token in-process and never prints it.
- Builds and tests were re-run after the final source edits and dashboard rebuild, so the recorded
  results correspond to the current working tree.
