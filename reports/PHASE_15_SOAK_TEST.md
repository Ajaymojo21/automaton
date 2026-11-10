# Phase 15J — Bounded Soak and Reliability Test

Date: 2026-10-31 · Runner: [scripts/phase15-soak.ts](file:///<repo-root>/scripts/phase15-soak.ts) · Raw evidence: [reports/PHASE_15_SOAK_RAW.json](file:///<repo-root>/reports/PHASE_15_SOAK_RAW.json)

## Objective

Exercise the autonomous machinery — dispatch gate, treasury guard, audit chain,
incident scanner, health guardian and mechanic — continuously under a resource
budget, and prove that nothing drifts: no dangling reservations, no broken hash
chain, no unbounded state growth, no secret persistence, and no privilege gained
by the self-healing path.

## Why this is not `scripts/soak-test.sh`

The upstream runner is a 72-hour test: it starts `node dist/index.js` and watches RSS,
database size and error rate. Phase 15 keeps every activation gate closed, so that
process cannot run an actual autonomous cycle — it would idle for 72 hours and measure
nothing. It is also unusable as-is for a second reason: `dist/` is a stale build that
predates the Phase 15 source fixes, so a soak of it would measure code that is no longer
the install.

This runner therefore reproduces the same measurements against the live `src/` stack,
in-process, bounded, and isolated. It is a substitute chosen for constraint compliance,
not a rebranding of a skipped test.

## Bounds and isolation

| Item | Value |
| --- | --- |
| Iterations | 3000 (completed; wall budget 180 000 ms never reached — actual 5 764 ms) |
| Sampling | every 100 iterations; heavy monitoring cycle every 50; chain verification every 200 |
| State | fresh `state.db` in `mkdtemp` under `%TEMP%`, `HOME` redirected to the same temp tree |
| Sandbox root | separate `mkdtemp` directory |
| Conway/social API | `MockConwayClient` / `MockInferenceClient` — no network calls |
| Wallet | none; verdict asserts no wallet/key material appears in the state dir |
| Activation | `activationApproved` untouched; `CONWAY_ACTIVATION` unset; used only as a scrub-target fixture |
| Self-healing | `selfHealingEnabled: false`; the runner throws if the mechanic ever reports `enabled` |
| Replication | `maxChildren = 0`; no spawn tool is dispatched |
| Teardown | temp dirs deleted unless `--keep true`; verified absent after the run |

The policy engine is assembled exactly as `src/index.ts` assembles it
(`createDefaultRules(treasuryPolicy, security)`), and every tool call goes through
`executeTool` with a turn context, so the soak measures the real dispatch stack rather
than a subset of it.

## Workload mix

Per iteration, chosen by a seeded PRNG (seed `20261031`, reproducible):

| Share | Work |
| --- | --- |
| 30% | `exec` dispatch — 85% benign, 15% `rm -rf /` (must be denied) |
| 15% | `write_file` + `read_file` round trip inside the sandbox |
| 15% | direct `TreasuryGuard.authorize` → 90% `commit`, 10% `release` (exercises the reservation lifecycle, including abandoned paths) |
| 12% | `transfer_credits` dispatch, 50 cents, with a secret sentinel embedded in the `reason` argument |
| 12% | control functions called directly, with their verdicts asserted (see below) |
| 16% | `appendSecurityEvent` onto the audit chain |
| every 50 | `pruneExpiredDedupKeys`, `scanSecurityEvents`, `checkTamper`, `runHealthChecks`, `runMechanic`, emergency-stop check |

## Results

```
soak: 3000 iterations in 5763.5ms | rss x1.428 | state 8089344B (1138.97B/iter)
      | dispatches 1709 denied 453 | control violations 0/353 | errors 0 | status PASS
```

| Counter | Value | Reading |
| --- | --- | --- |
| `toolDispatches` | 1 709 | calls that went through `executeTool` |
| `toolDenied` | 453 | 26.5% denied — the `rm -rf /` payloads plus per-turn/per-window treasury caps under the reused `soak-turn-%25` identity |
| `treasuryCommitted` / `treasuryReleased` | 52 / 6 | reservation lifecycle exercised both ways |
| `controlCalls` / `controlViolations` | 353 / **0** | path confinement, protected-path recognition, shell deny list and environment scrub all held |
| `chainChecks` | 15 | mid-run `verifySecurityChain`, all valid |
| `incidents` | 52 | sum of `scanSecurityEvents` results across 60 heavy cycles, i.e. repeat detections of the same events, not 52 distinct incidents |
| `mechanicActions` | 0 | the mechanic never acted, as required |
| `errors` | 0 | no iteration threw |
| audit rows | 3 437 | chain valid over all of them at the end |

Latency per iteration: p50 0.724 ms, p95 3.892 ms, p99 35.366 ms, max 69.552 ms. The p99
tail is the heavy cycles (prune + scan + tamper + health + mechanic) landing inside the
sample window, not a slow dispatch path.

Growth: RSS 83 075 072 → 118 603 776 B (x1.428 against the upstream 2x threshold), heap
x0.778 (heap was *below* the warmup sample at the end, i.e. garbage was collected), state
files (db + WAL) growing 1 139 B per iteration against a 16 384 B bound.

## Verdicts — all ten PASS

| Verdict | Basis |
| --- | --- |
| `chainValidAtEnd` | `verifySecurityChain` over 3 437 rows → `{valid: true, checked: 3437}` |
| `noDanglingReservations` | `SELECT COUNT(*) … WHERE status = 'reserved'` → 0 |
| `sentinelNeverPersisted` | `security_events.details LIKE '%soak-sentinel-secret-4f2c9b%'` → 0 rows, although the sentinel was passed inside a real transfer argument |
| `noWalletMaterialCreated` | no entry in the state dir matching `wallet`, `.pem`, `.key` |
| `mechanicRemainedInert` | 0 actions; the runner throws if `outcome.enabled` is ever true |
| `controlFunctionsHeld` | 0 violations in 353 direct control calls |
| `rssGrowthUnder2x` | peak/baseline = 1.428 |
| `heapGrowthUnder2x` | 0.778 |
| `stateGrowthBounded` | trailing 75% window: 1 138.97 B/iteration against a 16 384 B ceiling |
| `zeroErrors` | 0 |

`stateGrowthBounded` measures the database file **plus** the WAL, over the trailing three
quarters of the run. Both details matter: measured on `state.db` alone the growth looks
like zero, because SQLite keeps the pages in the WAL until it auto-checkpoints (the file
was 4 096 B while the WAL was megabytes), and the opening phase is dominated by that fill
rather than by retained data. A first version of this script asserted `dbGrowthLinear` as
`last.dbBytes > 0`, which is trivially true and was replaced.

## What this soak does NOT cover

Stated plainly, because a PASS here is not a production readiness claim:

1. **The real inference loop.** No model, no provider HTTP, no turn assembly from a live
   API response. Dispatch is driven by the PRNG workload, not by an agent's choices.
2. **The real Conway API and any network at all.** Mocks answer everything; request
   timeouts, retries, rate-limit responses and TLS failures are untested here.
3. **Wallet signing.** There is no wallet, per the Phase 15 prohibitions, so x402
   negotiation and transaction signing paths are not exercised end to end.
4. **Real filesystem side effects.** `write_file`/`read_file` route through the Conway
   client (`ctx.conway.writeFile`), which is mocked; `sandboxDirBytes` is 0 for exactly
   this reason. Local filesystem confinement is covered by the 15I suite and
   `phase15-sandbox`, not by this soak.
5. **Duration.** 3 000 iterations in under six seconds is a soak of the *logic*, not of
   time. Long-running failure modes that need hours — WAL checkpoint pathology across
   process restarts, OS handle leaks, log rotation, disk-full behaviour, scheduler drift
   — are not covered. 5.7 seconds cannot detect a leak that takes a day to matter.
6. **Concurrency across processes.** One process, one SQLite connection. Multi-process
   write contention and file-lock behaviour are untested.
7. **Post-activation paths.** Child spawning, funding, self-modification and external
   exposure are denied by policy here; an activated agent reaches code that never runs in
   this soak. Re-running after activation is a precondition for any production claim.

## Constraint compliance

No wallet created, no key generated, no transaction submitted, no credits purchased, no
API credential entered, no financial tool enabled, no unrestricted tool enabled, no
activation, no replication, no network listener opened, no service installed, no Windows
security setting touched. All state was confined to two temp directories that were deleted
on teardown. Synthetic addresses and a synthetic sentinel string only.

## Command

```
./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
  scripts/phase15-soak.ts --iterations 3000 --budget-ms 180000 \
  --sample-every 100 --heavy-every 50 --chain-every 200 \
  --out reports/PHASE_15_SOAK_RAW.json
```

Exit code 0 (all verdicts pass); 1 on a failed verdict; 2 on a crash. Probe runs at 50 and
200 iterations preceded the recorded run, and the 200-iteration probe is what surfaced the
four measurement defects corrected before the recorded run: hyphenated flags were ignored,
`dbGrowthLinear` was tautological, body-level denials returned as result text were not
counted, and direct control-function results were discarded instead of asserted.
