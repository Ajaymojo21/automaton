# Phase 15J — Bounded Soak and Reliability Test (Operator Guide)

**Control:** run the autonomous machinery continuously under a resource budget and prove nothing
drifts — no dangling reservations, no broken hash chain, no unbounded state growth, no secret
persistence, no privilege gained by the self-healing path.
**Result:** 3 000 iterations, 5 764 ms, **all ten verdicts PASS**, exit 0.
**Evidence:** [`../../reports/PHASE_15_SOAK_TEST.md`](../../reports/PHASE_15_SOAK_TEST.md),
raw metrics in [`../../reports/PHASE_15_SOAK_RAW.json`](../../reports/PHASE_15_SOAK_RAW.json)
**Runner:** [`scripts/phase15-soak.ts`](../scripts/phase15-soak.ts)

---

## 1. Why this is not `scripts/soak-test.sh`

The upstream runner is a 72-hour test: it starts `node dist/index.js` and watches RSS, database
size and error rate. Two facts make it unusable here, and both are constraint-driven rather than
convenient:

1. every activation gate is closed, so that process cannot run an actual autonomous cycle — it
   would idle for 72 hours and measure nothing;
2. `dist/` is a stale build predating the Phase 15 source fixes, so a soak of it would measure
   code that is no longer the install.

`scripts/phase15-soak.ts` therefore reproduces the same measurements against the live `src/`
stack, in-process, bounded and isolated. **This is a substitute chosen for constraint compliance,
not a rebranding of a skipped test** — and it is honest about what it cannot see (§6).

## 2. Bounds and isolation

| Item | Value |
|---|---|
| Iterations | 3 000 completed; the 180 000 ms wall budget was never reached (actual 5 764 ms) |
| Sampling | every 100 iterations; heavy monitoring cycle every 50; chain verification every 200 |
| State | fresh `state.db` in `mkdtemp` under `%TEMP%`, `HOME` redirected to the same temp tree |
| Sandbox root | a separate `mkdtemp` directory |
| Conway / social API | `MockConwayClient` / `MockInferenceClient` — no network calls |
| Wallet | none; a verdict asserts no wallet or key material appears in the state dir |
| Activation | `activationApproved` untouched; `CONWAY_ACTIVATION` unset, used only as a scrub-target fixture |
| Self-healing | `selfHealingEnabled: false`; the runner **throws** if the mechanic ever reports `enabled` |
| Replication | `maxChildren = 0`; no spawn tool is dispatched |
| Teardown | temp dirs deleted unless `--keep true`; verified absent after the run |

The policy engine is assembled exactly as `src/index.ts` assembles it
(`createDefaultRules(treasuryPolicy, security)`), and every tool call goes through `executeTool`
with a turn context — so the soak measures the real dispatch stack, not a subset of it.

## 3. Workload mix (seeded PRNG, seed `20261031`, reproducible)

| Share | Work |
|---|---|
| 30 % | `exec` dispatch — 85 % benign, 15 % `rm -rf /` (must be denied) |
| 15 % | `write_file` + `read_file` round trip inside the sandbox |
| 15 % | direct `TreasuryGuard.authorize` — 90 % commit, 10 % release (exercises abandoned reservation paths) |
| 12 % | `transfer_credits` dispatch, 50 cents, with a secret sentinel embedded in the `reason` argument |
| 12 % | control functions called directly, with their verdicts asserted |
| 16 % | `appendSecurityEvent` onto the audit chain |
| every 50 | `pruneExpiredDedupKeys`, `scanSecurityEvents`, `checkTamper`, `runHealthChecks`, `runMechanic`, emergency-stop check |

## 4. Recorded results

```
soak: 3000 iterations in 5763.5ms | rss x1.428 | state 8089344B (1138.97B/iter)
      | dispatches 1709 denied 453 | control violations 0/353 | errors 0 | status PASS
```

| Counter | Value | Reading |
|---|---|---|
| `toolDispatches` | 1 709 | calls that went through `executeTool` |
| `toolDenied` | 453 | 26.5 % denied — the `rm -rf /` payloads plus per-turn/per-window treasury caps under the reused `soak-turn-%25` identity |
| `treasuryCommitted` / `treasuryReleased` | 52 / 6 | reservation lifecycle exercised both ways |
| `controlCalls` / `controlViolations` | 353 / **0** | confinement, protected-path recognition, shell deny list and env scrub all held |
| `chainChecks` | 15 | mid-run `verifySecurityChain`, all valid |
| `incidents` | 52 | the sum of `scanSecurityEvents` results across 60 heavy cycles — repeat detections of the same events, **not** 52 distinct incidents |
| `mechanicActions` | 0 | the mechanic never acted, as required |
| `errors` | 0 | no iteration threw |
| audit rows | 3 437 | chain valid over all of them at the end |

Latency: p50 0.724 ms, p95 3.892 ms, p99 35.366 ms, max 69.552 ms. The p99 tail is the heavy
cycles (prune + scan + tamper + health + mechanic) landing inside the sample window, not a slow
dispatch path.

Growth: RSS 83 075 072 → 118 603 776 B (×1.428 against the upstream 2× threshold); heap ×0.778,
i.e. the heap ended *below* the warmup sample because garbage was collected; state files (db +
WAL) at 1 139 B per iteration against a 16 384 B bound.

## 5. The ten verdicts, and what each actually means

| Verdict | Basis |
|---|---|
| `chainValidAtEnd` | `verifySecurityChain` over 3 437 rows → `{valid: true, checked: 3437}` |
| `noDanglingReservations` | `SELECT COUNT(*) … WHERE status = 'reserved'` → 0 |
| `sentinelNeverPersisted` | `security_events.details LIKE '%soak-sentinel-secret-4f2c9b%'` → 0 rows, **although the sentinel was passed inside a real transfer argument** |
| `noWalletMaterialCreated` | no entry in the state dir matching `wallet`, `.pem`, `.key` |
| `mechanicRemainedInert` | 0 actions; the runner throws if `outcome.enabled` is ever true |
| `controlFunctionsHeld` | 0 violations in 353 direct control calls |
| `rssGrowthUnder2x` | peak/baseline = 1.428 |
| `heapGrowthUnder2x` | 0.778 |
| `stateGrowthBounded` | trailing 75 % window: 1 138.97 B/iteration against a 16 384 B ceiling |
| `zeroErrors` | 0 |

**Two measurement subtleties that were wrong before they were fixed**, and matter if you edit the
runner:

- `stateGrowthBounded` must measure the database file **plus the WAL**, over the trailing three
  quarters of the run. Measured on `state.db` alone the growth looks like zero, because SQLite
  keeps pages in the WAL until it auto-checkpoints — during the run the file was 4 096 B while the
  WAL was megabytes. And the opening phase is dominated by that fill rather than by retained data.
- An earlier version asserted `dbGrowthLinear` as `last.dbBytes > 0` — trivially true. Replaced.

A 200-iteration probe surfaced four measurement defects that were corrected before the recorded
run: hyphenated flags were ignored, the tautological growth assertion, body-level denials returned
as result text were not counted, and direct control-function results were discarded instead of
asserted. A PASS from a runner that discards the verdict is not a PASS.

## 6. What this soak does NOT cover

Stated plainly, because a PASS here is not a production-readiness claim:

1. **The real inference loop.** No model, no provider HTTP, no turn assembly from a live API
   response. Dispatch is driven by the PRNG workload, not by an agent's choices.
2. **The Conway API and any network at all.** Mocks answer everything; timeouts, retries,
   rate-limit responses and TLS failures are untested here.
3. **Wallet signing.** There is no wallet, per the Phase 15 prohibitions, so x402 negotiation and
   signing are not exercised end to end.
4. **Real filesystem side effects.** `write_file`/`read_file` route through the mocked Conway
   client, which is why `sandboxDirBytes` is 0. Local confinement is covered by 15I and
   `phase15-sandbox`, not by this soak.
5. **Duration.** 3 000 iterations in under six seconds is a soak of the *logic*, not of time.
   WAL checkpoint pathology across restarts, OS handle leaks, log rotation, disk-full behaviour
   and scheduler drift are not covered. **5.7 seconds cannot detect a leak that takes a day to
   matter.**
6. **Cross-process concurrency.** One process, one SQLite connection. Multi-process write
   contention and file-lock behaviour are untested.
7. **Post-activation paths.** Child spawning, funding, self-modification and external exposure are
   denied by policy here; an activated agent reaches code that never runs in this soak.

## 7. Running it

```bash
cd <repo-root>
./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs \
  scripts/phase15-soak.ts --iterations 3000 --budget-ms 180000 \
  --sample-every 100 --heavy-every 50 --chain-every 200 \
  --out reports/PHASE_15_SOAK_RAW.json
```

Exit `0` all verdicts pass · `1` a verdict failed · `2` a crash. Use the portable Node 22 runtime —
system Node 24 cannot load `better-sqlite3`. Add `--keep true` only if you want the temp tree for
inspection, and delete it afterwards.

**When to re-run:** after any change to the dispatch gate, treasury guard, audit chain, incidents
module or mechanic; before activation; and immediately after activation with the post-activation
paths actually reachable.

## 8. Residual risks

1. Time-bounded, not hour-bounded (§6.5). Long-horizon failure modes are uncovered.
2. Mocked I/O means no real failure injection — no disk-full, no network partition, no slow peer.
3. Single process, so lock contention between the heartbeat daemon and an agent loop is untested.
4. The soak ran while `selfHealingEnabled` was `false`; an enabled mechanic performing real repairs
   under load has never been soaked.
5. `toolDenied` at 26.5 % is *expected* here and is not a health signal for a configured install —
   on a live install the same ratio would be an alert.
