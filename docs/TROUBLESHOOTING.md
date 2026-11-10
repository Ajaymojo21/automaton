# TROUBLESHOOTING

Ordered by severity. Each entry states symptom, cause, fix, and prevention.

---

## 1. ACL lockout during hardening (critical)

**Symptom**

```
ls: cannot open directory 'runtime/home': Permission denied
```

`icacls` may still show an entry, but the tree is unreadable by your own account.

**Cause**

An ACL command used `/inheritance:r` together with a grant string whose principal was
not correctly quoted. The Windows username here contains a space
(`<windows-user>`), so the grant failed to apply and the result was an **empty
DACL** — no one could read the directory.

**Fix**

Grant the correctly quoted principal, then iterate every file in the tree:

```powershell
icacls "<repo-root>\runtime\home" /grant "<windows-user>:F"
Get-ChildItem -Recurse -Force "<repo-root>\runtime\home" |
  ForEach-Object { & icacls $_.FullName /grant "<windows-user>:F" }
```

Repeat for `backups`. Verify:

```
icacls "runtime\home"
```

Expected single ACE:

```
<host-name>\<windows-user>:(OI)(CI)(F)
```

`Set-Acl` with `SeSecurityPrivilege` failed in this environment; `icacls` worked.

**Prevention**

- Never apply `/inheritance:r` to a tree before testing on one file.
- Use the full `DOMAIN\user` form, fully quoted.
- Do not "fix" access by granting `Everyone`, `BUILTIN\Users`, or
  `Authenticated Users`.
- After any ACL change, immediately run `HEALTH_CHECK.bat` and `SECURITY_AUDIT.bat`.

---

## 2. `--run` is blocked with exit code 2

**Symptom**

```
ERROR main  Blocked "--run": runtime activation is not approved.
ERROR main  Reason: security.activationApproved is not true in automaton.json
```

**Cause**

This is the activation gate working. It requires **both**:

1. `"security": { "activationApproved": true }` in
   `runtime/home/.automaton/automaton.json`, and
2. `CONWAY_ACTIVATION=APPROVED` in the process environment.

**Fix**

There is no legitimate quick fix. Decide whether you actually intend to activate,
review [TREASURY_SECURITY.md](TREASURY_SECURITY.md), and then make both changes
deliberately. `START_CONWAY.bat` sets the env token after you type `APPROVED`.

**Do not** bypass the gate by editing `dist/` or removing the check. The gate is the
main protection against the upstream auto-wallet behaviour.

---

## 3. Preflight blocks wallet creation

**Symptom**

Preflight exits 2 with a wallet-creation message, even after typing `APPROVED`.

**Cause**

`wallet.json` is missing and `CONWAY_ALLOW_WALLET_CREATION` is not
`APPROVED`. This is intentional: activation and wallet generation are separate
decisions.

**Fix**

If and only if you have decided to create a new experimental wallet, run through
`START_CONWAY.bat` and type `CREATE-WALLET` at the second prompt. Never import a
production key. See [WALLET_SECURITY.md](WALLET_SECURITY.md).

---

## 4. `'pnpm' is not recognized` during build

**Symptom**

`pnpm run build` fails inside the nested workspace command
(`tsc && pnpm -r build`).

**Cause**

The portable Node runtime is on `PATH`, but the corepack `pnpm` shim is not visible
to the child `cmd.exe` process on Windows.

**Fix**

Use corepack explicitly with serial workspace builds:

```
corepack pnpm -r --workspace-concurrency=1 run build
```

A helper shim exists at `runtime/bin/pnpm.cmd` for interactive use.

---

## 5. `RangeError: options.minThreads and options.maxThreads must not conflict`

**Symptom**

Vitest crashes in `tinypool` when `--maxWorkers` is combined with `CI=1`.

**Cause**

Upstream test pool configuration conflicts with the worker flags on Windows.

**Fix**

Run without worker-count flags and without `CI`:

```
node node_modules/vitest/vitest.mjs run <test-file>
```

---

## 6. Full test suite hangs / worker processes leak

**Status: root-caused and fixed in Phase 15L (2026-10-31).** Kept here because the
symptom is memorable and the diagnosis path is not obvious.

**Symptom**

`vitest run` never exits; 60+ `node.exe` processes remain; one process accumulates
thousands of seconds of CPU. `src/__tests__/context-hardening.test.ts` reports
"Worker exited unexpectedly" or times out.

**Cause (measured, not inferred)**

Not a Windows incompatibility and not a worker-teardown bug. js-tiktoken's BPE merge
loop is superlinear on long repetitive text: `countTokens` took 67 ms at 1 000
characters, 220 ms at 2 000, 970 ms at 4 096, and did not return within 60 s at 50 000.
`estimateTokens()` in `src/agent/context.ts` runs over every turn on every context
build, so the three "token budget" tests that feed 5 × 50 000-character turns hung the
worker, and tinypool surfaced the stall as "Worker exited unexpectedly" and then never
resolved the pool. Reproduced outside vitest with a 12-line script before any fix was
attempted, and bisected to the single test by `-t` group filtering.

**Fix**

`src/memory/context-manager.ts` now encodes a bounded 2 048-character window and scales
the ratio to the full length. Worst case went from unbounded to ~233 ms, flat at 100 k
and 250 k characters; real prose is unaffected (100 k mixed characters: 0.8 ms).
`estimateTokens()` still takes `max(tokenCount, ceil(length / 4))`, so the budget can
only ever over-estimate — the change cannot cause context overflow. Regression pinned in
`src/__tests__/memory/context-manager.test.ts` (bounded time + proportionality).

**If it ever comes back**

1. Kill only workers whose executable path is inside this project:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -like '<repo-root>\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

2. Bisect with `-t "<describe name>"` per group, then per test, rather than reading the
   tinypool error as a harness fault.

---

## 7. Platform test failures (≈21–22)

**Status: resolved in Phase 15L — 19 failures → 0, full suite now completes.**

**Symptom**

Failures involving paths like `/tmp/...`, `/etc/conway`, POSIX permissions, or shell
commands.

**Cause and what each fix touched**

| Failure | Real cause | Fixed in |
| --- | --- | --- |
| 17 in `skills-hardening` / `command-injection` | `new URL(...).pathname` yields `/C:/…` on Windows, so the assertion never read a file and failed with `ENOENT` | test only (`fileURLToPath`) |
| 1 in `path-protection` | the absolute entries in `BLOCKED_DIRECTORY_PATTERNS` (`/etc/systemd`, `/proc`, `/sys`) were compared raw against a resolved path, so **every one of them was inert on Windows** | product — `isProtectedFile` now resolves both sides and reuses the sandbox protected-path list |
| 1 in `orchestration/local-worker-harness` | the test redirected `HOME`, but `os.homedir()` follows `USERPROFILE` on Windows, so plan artifacts were written into the real user profile and the assertions looked in the temp dir | test only (redirect both) |

**Fix**

Treat these as environment incompatibilities, not regressions, **unless** the failure
is in a security assertion — and check that question before relabelling anything. Two of
the 19 were genuinely product-side: one inert protection list, one isolation leak. Record
the file names and counts in any report; do not mark the suite as green.

**Residual**

The pre-fix leaks are still on disk: `~\.automaton\workspace\` holds 28 goal directories
written by earlier full-suite runs (including `goal-1` from this one). Nothing new is
written since the fix. Removal is the operator's call — see
`reports/PHASE_15_REGRESSION_ACCEPTANCE.md`.


---

## 8. `better-sqlite3` ABI / module version mismatch

**Symptom**

`Error: The module was compiled against a different Node.js version` or
`NODE_MODULE_VERSION` mismatch.

**Cause**

The app was launched with a different Node (e.g. system Node 24, ABI 137) than the
one used to install `better-sqlite3` (Node 22.23.4, ABI 127).

**Fix**

Always launch through the `.bat` wrappers, or set `PATH` to the portable runtime
first. Do not rebuild native modules against Node 24 unless you also reinstall the
entire dependency tree.

---

## 9. Health check says `process: warn`

**Symptom**

`"detail": "not running (no live pid file)"`.

**Cause**

The agent is not running. For an installed-but-inactive deployment this is expected.

**Fix**

None needed. If you expected it to be running, check `logs\automaton-*.err.log` and
confirm preflight passed.

---

## 10. Stop refuses to kill the PID

**Symptom**

`STOP_CONWAY.bat` reports failure or skips termination.

**Cause**

The PID file is stale, or the PID now belongs to a process whose command line does
not contain `Conway-Automaton`. The utility refuses to kill an unrelated process.

**Fix**

Confirm no `node dist/index.js --run` from this project is running (Task Manager or
the PowerShell query in §6), then delete `logs\automaton.pid` manually.

---

## 11. Config written to the wrong location

**Symptom**

The app creates `C:\Users\<you>\.automaton\` instead of
`runtime\home\.automaton\`.

**Cause**

`HOME` was not set before launching.

**Fix**

Use the wrappers, or export
`HOME=<repo-root>\runtime\home` before running. If a stray
`C:\Users\<you>\.automaton` was created, inspect it, back up anything you need, and
remove it — but never delete a pre-existing `.automaton` directory that you did not
create in this session.

**The same trap corrupts evidence, not just state.** `~` in config paths resolves through
`process.env.HOME` ([src/config.ts:201](../src/config.ts#L201)), so any audit or validator run
outside the wrappers inspects the wrong tree. This is exactly how the Phase 15K backup validator
reported `livePathsUntouched` = PASS while signing a non-existent `state.db` path; the fix, and the
`liveDbGuardNonVacuous` verdict that now **fails the run** (exit 1) when `HOME` is unset, are in
[PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md) §4.

---

## 12. A secret was placed in config or logs

**Immediate actions**

1. Stop the runtime.
2. Rotate the credential at the provider.
3. Run `SECURITY_AUDIT.bat` to confirm what was exposed.
4. Replace the value in `automaton.json`; do not commit the file.
5. If it reached Git, treat the secret as permanently compromised and rewrite
   history only with a deliberate plan.

The config is ACL-restricted and mode `0600`, but it is **not encrypted**. See
[WALLET_SECURITY.md](WALLET_SECURITY.md) §3.1 and
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) R-W1.

---

## 13. Disk space or database corruption

Run `HEALTH_CHECK.bat`. If the database check fails:

1. Stop the runtime.
2. Restore the newest verified backup (`restore.mjs --allow-live`).
3. Re-run the health check.
4. If no backup is usable, move `state.db` aside (do not delete) and let the app
   recreate it; agent state will be lost.

---

## 14. BitLocker status query is denied

`Get-BitLockerVolume` returned "Access denied" on this Home edition / non-elevated
session. Do not assume the disk is encrypted. Verify device encryption manually in
Windows Settings before storing a wallet or long-lived credentials.
