# Phase 15E — Agent Sandboxing

**Date:** 2026-10-31
**Status:** PASS (application-level; OS-level isolation not enabled — see residuals)
**Constraint:** no administrator rights, no Windows service, no firewall or
Defender change, no public endpoint.

## 1. Objective

Limit what an agent can touch when it runs on the host: filesystem scope,
protected locations, shell commands, child-process environment and credential
material. Block user documents, browser credentials, other AI agent
configurations, production wallets, unrelated environment variables and other
databases.

## 2. What is enforced

| Control | Implementation |
|---|---|
| Filesystem root | `resolveSandboxRoot` — remote sandbox `/root`; local `security.sandboxRoot` else `HOME` |
| Path confinement | `confineToRoot` — `path.resolve` + `path.relative` (not string prefixes), null-byte and Windows device-name rejection, `realpath` of nearest existing ancestor to defeat symlink/junction escapes |
| Protected locations | `isProtectedPath` — Documents, Desktop, Downloads, Pictures, Videos, Music, OneDrive, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.config`, `.qoder`, `.cursor`, `.claude`, `.codex`, `.ollama`, AppData credentials/Crypto/Chrome/Edge/Firefox/Bitcoin/Ethereum, `System32`, plus `wallet.json`, `automaton.json`, `id_rsa`, `id_ed25519`; `CONWAY_PROTECTED_PATHS` extends the list |
| Shell deny-list | `validateShellCommand` — recursive delete of roots, drive format/partition, shadow-copy/backup destruction, firewall/Defender/registry/service/task/ACL/boot changes, shutdown, credential reads, `ssh-keygen`/GPG export, download-and-execute, encoded PowerShell, tunnels (ngrok/cloudflared), automaton state/database deletion, `DROP TABLE`, references to protected locations |
| Environment | `scrubEnvironment` — drops all `CONWAY_*` plus names matching key/token/secret/pass/credential/mnemonic/seed/private/auth/cookie/session |
| Local child processes | `src/conway/client.ts` `execSync` now passes the scrubbed environment |

Integration points in `src/agent/tools.ts`:

- `exec` → `validateShellCommand` (when `security.sandboxEnabled !== false`),
  then the pre-existing forbidden-pattern guard, then `ctx.conway.exec`.
- `write_file` → `confineToRoot` + `isProtectedPath`, then the existing
  protected-file invariant.
- `read_file` → sensitive basename/extension guard, then confinement, then
  read/fallback `cat` with shell-escaped confined path.

## 3. Evidence (executed)

| Check | Command | Result |
|---|---|---|
| 15E suite | `vitest run src/__tests__/phase15-sandbox.test.ts` (Node 22) | **46/46 passed** |
| Tool-security suite | `vitest run src/__tests__/phase15-tool-security.test.ts` | 16/16 passed |
| Legacy tool suite | `vitest run src/__tests__/tools-security.test.ts` | 71/71 passed |

Covered behaviours: relative allow, `..` traversal, absolute outside path,
sibling-prefix directory (`root-evil`), null byte, reserved device names,
junction/symlink escape (when link creation is permitted), protected path inside
the root, eight protected-location classes, fifteen denied commands, four
allowed commands, nine scrubbed variables, write/read/exec integration including
"client never called when blocked".

## 4. What this is not

This is an **application-level** sandbox. It does not create a Windows Job
Object, AppContainer, restricted token, VM or container; it does not change
network reachability, Defender or the firewall; it does not enforce CPU/memory
quotas; it does not isolate processes. It stops accidental and casual escape,
protects known credential/system locations, and provides a second line behind
the Phase 15D capability authorizer. It is not a defence against arbitrary code
execution once a `shell_execution`-capable tool is deliberately granted.

## 5. Residual risks

1. **Deny-list, not allow-list, for shell.** A novel destructive command not in
   the pattern set can run if `shell_execution` is granted. Capability
   authorization is the primary control.
2. **Windows path semantics on a POSIX-remote sandbox.** For a remote sandbox
   the root is `/root`; on a Windows host `path.resolve("/root", …)` maps to the
   current drive. Confinement and traversal checks remain correct, but displayed
   paths differ from POSIX form. The live install has `sandboxId: ""` (local),
   so this does not affect it.
3. **Environment scrubbing applies to spawned children only.** Values already
   loaded into the Node process remain in memory; scrubbing prevents inheritance.
4. **Protected list is finite.** New browser profiles or agent tools need to be
   added to `protectedPrefixes()` or `CONWAY_PROTECTED_PATHS`.
5. **Writes by other code paths.** `edit_own_file` and skill installers write via
   their own helpers; they are restricted to the `.automaton` tree and gated by
   `administrative` capability, but do not call `confineToRoot`.
6. **No resource limits.** Soak tests (15J) measure behaviour; they do not cap
   CPU/memory at the OS level.

## 6. Constraint compliance

No administrator action, service installation, firewall/Defender change, public
tunnel or network exposure was performed. All escape tests used synthetic files
in temporary directories. No wallet, credential or user document was read.
