# Phase 16A — Code-Level Security Review

**Date:** 2026-11-01 · **Install:** `<repo-root>` v0.2.1 (continued, not reinstalled)
**Companion:** `reports/PHASE_16_GAP_ANALYSIS.md` (risk register), `reports/PHASE_16_PROGRESS.md` (change log, hashes, timings)
**Method:** read the code, then execute a probe or a test for every claim. Where a claim could
not be executed on this host it says so. Nothing in this file is inferred from the presence of
a guard — presence was not treated as behaviour.

---

## 1. Headline

The most severe finding of Phase 16 is **R-18: the project's shell-argument quoting protects
the sandbox and not this host.** It is RCE-grade, it was present in the codebase throughout
Phase 15, and Phase 15's conclusion "command injection closed" was *correct for `/bin/sh`* and
*wrong for `cmd.exe`*. It was latent only because `lockdown = true` and `allowedTools = []`.

The organising lesson, stated once here rather than repeated per finding: **the Conway tool
layer is written as if it always runs inside a Linux sandbox, but the live install runs with
`sandboxId = ""`, which makes every `conway.exec()` a `cmd.exe` invocation on the user's
machine.** R-16, R-18 and §6 below are all instances of that one mismatch.

---

## 2. Authorization path — verified, not assumed

`executeTool()` (`src/agent/tools.ts:3400`) gates in this order. Each step was read, and the
order matters because it determines what a bypass would have to defeat.

| # | Gate | Anchor | Fail-closed? |
|---|---|---|---|
| 1 | unknown tool | `tools.ts` dispatch head | yes — refusal |
| 2 | emergency stop | `isEmergencyStopActive`, union of file marker + DB | yes (fixed in 16A.1, see §5) |
| 3 | authorizer (capability + allowlist + lockdown) | `authorizeToolCall` | yes |
| 4 | **policy-layer presence** | `checkPolicyEnforcement(authorization.capabilities, policyPresence)` at `tools.ts:3478`, driven by `POLICY_REQUIRED_CAPABILITIES` at `src/security/policy-enforcement.ts:24` | **yes** — a caller that omits the engine gets refusals for any of `financial, wallet_signing, shell_execution, agent_spawning, publishing, administrative` |
| 5 | policy evaluation | engine rules | yes |
| 6 | treasury guard | `src/security/treasury-guard.ts` | yes — and it **throws** rather than proceeding if `treasury_authorizations` is absent (`:387-400`) |
| 7 | timeout / output bounds, sanitize | `tools.ts` | yes |
| 8 | commit + `recordSpend` + release | `tools.ts` | **no** — see §5, spend tracking |

Residual at gate 4: the `policyEngine` parameter is still *optional in the type* and enforced at
runtime. That is the documented design decision from 16A.1 (making it required would break every
out-of-tree caller at once); the runtime refusal is the control. Recorded, not hidden.

Bypass tests: `src/__tests__/security/phase16-policy-enforcement.test.ts` (direct and indirect
omission), plus the 146-test dispatch run covering treasury-behind-policy integration.

---

## 3. SQL — four interpolated statements, all reviewed

`grep` for `prepare(\`…${` across `src/` (excluding tests) returns exactly four sites. All four
were read, not pattern-matched:

| Site | Interpolated value | Verdict |
|---|---|---|
| `src/memory/tools.ts:285` `DELETE FROM ${table} WHERE id = ?` | `table` comes from a fixed 5-entry `typeToTable` map (`:262-270`); an unmapped type returns before the query | **safe** — identifier from an allowlist, value parameterised |
| `src/state/database.ts:805` `SELECT * FROM policy_decisions ${where}` | `where` assembled from an internal clause list, not user strings | **safe** as written; brittle if a caller ever passes raw text |
| `src/state/database.ts:1798` `UPDATE working_memory SET ${setClauses.join(", ")}` | every clause is a literal `col = ?`; values in `params` | **safe** |
| `src/state/database.ts:1971` `UPDATE procedural_memory SET ${col} = ${col} + 1 …` | `col` is internal | **safe**, and the only non-parameterised *value* path — worth an assertion if that function ever takes external input |

No string-built SQL takes a model-supplied or request-supplied value. This is a positive finding
and is reported as one.

---

## 4. R-18 — POSIX quoting under `cmd.exe` (High, CLOSED)

### Mechanism

`src/conway/client.ts:113-122` — when `sandboxId` is empty, `exec` becomes
`execSync(command, { cwd: resolveHome(), env: scrubEnvironment(process.env).env })`.
Measured: `COMSPEC = C:\WINDOWS\system32\cmd.exe`. `execSync` passes the string to that shell.
`cmd.exe` does not treat `'` as a quote character.

### Reproduction

`reports/PHASE_16_WINQUOTING_PROBE.cjs` (re-runnable; pins the old helper verbatim):

| Input | Command built | exitCode | stdout |
|---|---|---|---|
| `…\nope&echo INJECTED_AMP` | `cat '…\nope&echo INJECTED_AMP'` | **0** | `INJECTED_AMP'` |
| `…/nope&echo INJECTED_AMP` | same, forward slashes | **0** | `INJECTED_AMP'` |
| `…/nope\|echo INJECTED_PIPE` | `cat '…/nope\|echo INJECTED_PIPE'` | **0** | `INJECTED_PIPE'` |

A first attempt at this probe was written inline through `bash -e` and was **invalid** — bash ate
the backslashes and the resulting `\r` truncated the command line, producing a false negative. The
file probe replaced it. Noted because it is how a reviewer could wrongly conclude the quoting works.

### Reachability (traced, not argued)

`read_file` → `args.path` is model input → `confinePathToSandbox()` → `confineToRoot()` keeps `&`
and `|` (legal Windows filename characters; verified: `nope&echo INJECTED` → `ok`, `protected=false`)
→ `ctx.conway.readFile()` is `fs.readFileSync` locally (`client.ts:207`) and **throws** for the
non-existent file → the `catch` written for a broken Conway API falls back to
`conway.exec("cat …")` at `tools.ts:240`. One tool call, one injected command.

Same shape at `tools.ts:3329` for every generic installed tool.

### Fix and its shape

`src/security/shell-quote.ts` — `quoteShellArg(arg, platform = process.platform)` returns
`{ok:true, value}` or `{ok:false, reason}`.

- POSIX branch: `quoteForPosix()` is the deleted `escapeShellArg` **verbatim**, so the sandbox
  cannot regress.
- Windows branch: **refuses** rather than quotes, on `\0 & | < > ^ " % ! CR LF`. cmd.exe cannot be
  reliably escaped (two parse passes, `^`, delayed expansion), so refusal is the correct primitive.
- Deliberately **not** refused: `'`, `$`, `` ` ``, `(`, `)`, `;` — none of them starts a second
  command in cmd.exe (no command substitution, and `;` is an argument separator), so refusing them
  would reject
  legitimate paths without rejecting anything dangerous. This is why the three existing
  `tools-security.test.ts` quoting tests (which pin `'\''` output for `it's a file.txt` and
  `$(whoami).txt`) still pass **unchanged**: 71/71, no test churn.

### Accepted functional cost

On the local Windows install, a generic installed tool **cannot receive arguments** any more:
`JSON.stringify(args)` always contains `"`, so the wrapper fails closed. That path was already
broken — cmd.exe split the JSON on its own spaces — and it is unreachable today
(`allowedTools = []`). The correct replacement is `execFile` with an argv array, or routing
installed tools through the sandbox; **designed, not implemented**, because it changes execution
rather than guarding. Recorded as an open design item, not a closed one.

### Not changed, deliberately

`src/git/tools.ts:219` keeps its own POSIX `escapeShellArg`. Its inputs are `repoPath` from config
and an internal `staged ? "--cached" : ""` flag (`:66`) — no model-controlled value reaches it.
Widening this change to config-sourced input would have expanded the diff for no measured risk.
If `repoPath` ever becomes user-settable, it must adopt `quoteShellArg`.

---

## 5. Fail-open and silent-failure findings

| Finding | Status |
|---|---|
| Emergency stop read the DB only, so a HOME mismatch reported "not engaged" | **fixed** in 16A.1 — union of marker + DB, fail-closed |
| `tryAppendSecurityEvent` / `tryAppendSecuritySeal` swallowed every write failure | **fixed** in 16A.5 — both now log at `error` with severity/category/eventType/reason. The chain is still best-effort by design; what changed is that a dropped write is loud, because an unrecorded event must not be mistaken for an intact chain |
| `recordSpend` failure after a committed transfer | **partly fixed** (16A.5): both catch blocks now emit a CRITICAL `spend.tracking_failed` security event with tool, amountCents and reason. **Deliberately not rolled back** — the external transfer already happened, so undoing the local commit would misreport money that moved. Consequence measured and pinned: `spend_tracking` stays at 0 while `treasury_authorizations` sums 100, i.e. the budget the *next* hour reads is an under-count (R-6) |
| Mechanic pattern net did not cover activation approvals or tool allowlists, and used `\s+` where ids use `_` | **fixed** in 16A.4; probe `reports/PHASE_16_PATTERN_PROBE.cjs` shows 8 names newly matched, and `prune_expired_leases` correctly still unmatched |
| R-11 — `financial.inference_daily_cap` (`src/agent/policy-rules/financial.ts:243-249`) only fires for tool names `chat` and `inference`, **neither of which exists as a tool** | **OPEN, designed.** The real inference cost is known at `src/agent/loop.ts:648` (`costCents: routerResult.costCents`) and `grep recordSpend src/agent/loop.ts` returns **nothing** — inference spend is never recorded, so the cap has no data to enforce on. Remediation: call `sessionSpend.recordSpend("inference", routerResult.costCents)` at the turn-commit point, and change the rule from a tool-name match to a category/phase check. Not done here: it moves money-accounting into the hot loop and needs its own tests |
| R-13 — `x402_fetch` (`tools.ts:2795`) records `amountCents: 0`, so the x402 envelope is a sum of zeros | **OPEN.** Fix requires the settled amount from the x402 response path, which the client does not currently surface |
| R-12 — `resolveSandboxRoot` falls back to `process.cwd()` when neither `security.sandboxRoot` nor `HOME` is set (`src/security/sandbox.ts:34-43`) | **OPEN.** With the §3 home guard, `HOME` is always set before a Conway operation, so the fallback is not the live path; but if it is reached, "confined to root" means "confined to wherever the process started". Remediation: drop the `cwd` fallback and fail closed |

---

## 6. Remaining POSIX assumptions (R-19, recorded, not fixed)

`FORBIDDEN_COMMAND_PATTERNS` (`src/security/sandbox.ts:206-248`) is 36 entries and is
**more Windows-aware than expected** — `format`, `diskpart`, `vssadmin`, `wbadmin`, `cipher /w`,
`bcdedit`, `netsh advfirewall`, `Set-MpPreference`, `reg add/delete HKLM`, `sc`/`net` service,
`schtasks /create`, `New-Service`, `takeown`, `icacls`, `shutdown`, `manage-bde -protectors`,
`Invoke-Expression`, `powershell -e`/`-encodedcommand`, and `curl … | sh` all appear. Read as
evidence, not assumed from the file name.

It is still a deny-list, and the Windows-relevant omissions I could name are: `del /f /s /q <path>`
(`rd /s /q` is covered, `del` is not), `certutil -urlcache -f`, `bitsadmin`, `mshta`, `rundll32`,
`wmic`, and `curl` POST exfiltration. Because `validateShellCommand` scans the whole command
string, `&`-chaining does not defeat it outright — but any unlisted command does.

Not extended in this phase: adding to a deny-list is whack-a-mole and the file itself says the
primary control is the callable tool set and capability grants. The honest statement is that
`exec` is reachable only through `shell_execution`, which is denied by `lockdown = true` and the
empty allowlist, and that if activation ever grants it, the deny-list is not the thing standing
between the agent and the host. R-4 says the same thing from the other side: application-level
controls are not OS isolation.

Also POSIX-shaped and **not** closed: `isProtectedPath` (`sandbox.ts:103-131`) special-cases
`/etc` and `/root/.ssh` on the non-Windows branch while relying on `protectedPrefixes()` for
Windows, and remote sandboxes are wrapped to run from `/root` (`client.ts:139`). Neither is on
the live path (`sandboxId = ""`).

---

## 7. Isolation evaluation as it applies to code (A.3, restated)

The sandbox in `src/security/sandbox.ts` is confinement logic in the same process as the code it
confines. Its own header says it is not an OS sandbox; this review confirms that in the specific
sense that matters: the same module's `exec` path hands strings to `cmd.exe` with the user's full
token, and R-18 was a consequence. No privileged component was installed and no stronger isolation
was enabled — tiers (ii)/(iii) in `reports/PHASE_16_ISOLATION_EVALUATION.md` need operator approval.

---

## 8. Verification anchors

Every number below was executed this session with the pinned runtime
(`HOME=<repo-root>\runtime\home`, `node-v22.23.4-win-x64`); none is remembered.

| Check | Result |
|---|---|
| `tsc --noEmit` (prod, `tsconfig.json` includes `src/**/*`) | exit **0** |
| `phase16-win-shell-quoting.test.ts` | **13 passed** (red-first: 2 failed before the fix) |
| `phase16-package-name-hardening.test.ts` | **15 passed** (red-first: 7 failed / 5 passed) |
| `tools-security.test.ts` | **71 passed**, unchanged — no assertion edited |
| `command-injection.test.ts` | **102 passed** |
| `policy-engine.test.ts` | **26 passed** |
| 4-suite run above together | **201 passed / 201** |
| `phase16-audit-visibility.test.ts` / `phase16-live-model-preflight.test.ts` | **10** / **23 passed** |
| `chain.test.ts` | **13 passed** |
| self-healing pair | **68 passed** |
| `tsx scripts/phase16-live-model-preflight.ts` vs live install | exit **2**, `SAFETY_GATE_FAILED`, 16/18 PASS, `credentialPresent=false` |
| live DB `runtime/home/.automaton/state.db` | SHA `2a8aeb34…efbba` after every step of this phase — **never written to** |
| pinned Node runtime dir | restored to `corepack`, `npm` after the R-16 probe side effect; no shims remain |

---

## 9. What this file does not claim

- It does not claim zero vulnerabilities. R-11, R-12, R-13, R-14, R-15, R-17 and R-19 are open.
- It does not claim Phase 15's review was negligent: R-18 was invisible to a reviewer reasoning
  about the sandbox, and the sandbox was the intended production target. The live install being
  Windows-local is what made it reachable.
- No claim here rests on a POSIX execution path: R-7 (POSIX product behaviour) is **BLOCKED** —
  no WSL distro and the component is disabled — so the POSIX branch of `quoteShellArg` is verified
  by unit assertion of the string it returns, **not** by running `/bin/sh` on this host.
- The Windows-branch tests run on Windows, so they exercise the real platform rather than a mock.
