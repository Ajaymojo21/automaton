# Phase 15E — Agent Sandboxing (Operator Guide)

**Control:** what an agent can touch while it runs — filesystem scope, protected locations,
shell commands, and the environment its children inherit.
**Status:** implemented, 46 tests executed. **This is an application-level sandbox.** It is not
a Windows Job Object, AppContainer, restricted token, VM or container, and creating one needs
administrator rights this session does not have.
**Evidence:** [`../../reports/PHASE_15_SANDBOX_SECURITY.md`](../../reports/PHASE_15_SANDBOX_SECURITY.md)
**Code:** [`src/security/sandbox.ts`](../src/security/sandbox.ts), integration in
[`src/agent/tools.ts`](../src/agent/tools.ts), child env in
[`src/conway/client.ts`](../src/conway/client.ts)

---

## 1. Position in the defence stack

The capability authorizer (Phase 15D) is the **primary** control: if `shell_execution` is not
granted, there is no shell to abuse. The sandbox is the second line — it limits the blast radius
of a tool that *was* granted, and stops accidental or casual escape. Read it that way, and do not
use its deny list as a reason to grant a capability.

## 2. Filesystem scope

| Piece | Behaviour |
|---|---|
| Root | `resolveSandboxRoot` — `/root` for a remote sandbox; on a local install, `security.sandboxRoot` if set, else `HOME` |
| Confinement | `confineToRoot` — `path.resolve` + `path.relative`, **not** string prefixes, so `..` and a sibling directory whose name starts with the root (`root-evil`) are rejected; rejects null bytes and Windows reserved device names (`CON`, `NUL`, `COM1`…); calls `realpath` on the nearest existing ancestor to defeat symlink and junction escapes |
| Protected locations | `isProtectedPath` — blocked even when the path is *inside* the root |

Windows-specific note worth knowing before you change this code: `path.resolve("/root", …)` on a
Windows host maps onto the current drive. Confinement and traversal checks stay correct, but
displayed paths differ from POSIX form. The live install has `sandboxId: ""` (local), so this does
not affect it today.

## 3. What is protected

`isProtectedPath` blocks, at minimum:

- **user content** — Documents, Desktop, Downloads, Pictures, Videos, Music, OneDrive;
- **credential and config directories** — `.ssh`, `.aws`, `.gnupg`, `.gpg`, `.kube`, `.docker`,
  `.config`, and the other AI tools' own state: `.qoder`, `.cursor`, `.claude`, `.codex`, `.ollama`;
- **browser profiles** — AppData credential stores and Chrome / Edge / Firefox `User Data`, plus
  Bitcoin and Ethereum data directories;
- **OS** — `SystemRoot\System32` on Windows, `/etc`, `/root/.ssh` on POSIX;
- **by basename anywhere in the tree** — `wallet.json`, `automaton.json`, `id_rsa`, `id_ed25519`.

Extend it without a code change:

```bash
export CONWAY_PROTECTED_PATHS="/d/vault:/e/projects/client-secrets"
```

**Phase 15L fixed a real defect here.** `isProtectedFile()` in
[`src/self-mod/code.ts`](../src/self-mod/code.ts) compared raw POSIX literals
(`/etc/systemd`, `/proc`, …) against a Windows-resolved path, so on this platform **every
absolute pattern in that list was inert** — the self-modification guard protected nothing the
path list claimed. It now resolves patterns the same way it resolves input, and additionally
delegates to `isProtectedPath` so there is one source of truth instead of a second, POSIX-only
list. The fix is Windows-verified; the POSIX branch of the new test has never executed (R-7).

## 4. Shell commands

`validateShellCommand` denies, among others:

recursive deletion of roots · drive format and partitioning · volume-shadow-copy and backup
destruction (`vssadmin`) · firewall, Defender, registry, service, scheduled-task, ACL and boot
configuration changes · shutdown · credential reads (`cat ~/.ssh/id_rsa`,
`type …\.aws\credentials`) · `ssh-keygen` and GPG key export · download-and-execute ·
encoded PowerShell and `iex` · tunnels (`ngrok`, `cloudflared`) · deletion of the automaton
state directory or database · `DROP TABLE` · **any reference to a protected location** ·
`cipher /w`.

Five entries were missing and were added during Phase 15I (finding **F2**): service installation,
`CurrentVersion\Run` persistence, **`manage-bde -protectors` (recovery-key retrieval)**,
`manage-bde -on|-off|…` (BitLocker state changes), and the
`Enable|Disable|Unlock|Protect|Unprotect-BitLocker` cmdlets.

The recovery-key entry is the one to notice: it means an agent cannot ask the shell to retrieve a
BitLocker recovery key **even if `shell_execution` has been granted**. That is the master
prompt's standing prohibition enforced in code rather than by convention.

**This is a deny list, not an allow list.** It matches command strings, not a parsed shell tree.
Renamed binaries, aliasing and split arguments can evade a pattern; one test asserts this
honestly (`echo $(pwd)` is allowed by design). Do not describe this control as command allowlisting.

## 5. Environment scrubbing

`scrubEnvironment` drops every `CONWAY_*` variable plus any name matching
`key`, `token`, `secret`, `pass`, `credential`, `mnemonic`, `seed`, `private`, `auth`, `cookie`,
`session`. It applies to **spawned children**, which is what prevents a subprocess from reading
`CONWAY_ACTIVATION` or an API key out of its inherited environment. Values already loaded into the
Node process remain in memory — scrubbing prevents inheritance, not recall.

The penetration test seeds a child with `CONWAY_ACTIVATION`, `CONWAY_ALLOW_WALLET_CREATION`,
`OPENAI_API_KEY`, `MY_SESSION_TOKEN` and `AWS_SECRET_ACCESS_KEY` and asserts all five are gone.

## 6. Integration points

| Tool | Order of checks |
|---|---|
| `exec` | `validateShellCommand` (when `security.sandboxEnabled !== false`) → pre-existing forbidden-pattern guard → `ctx.conway.exec` |
| `write_file` | `confineToRoot` → `isProtectedPath` → existing protected-file invariant |
| `read_file` | sensitive basename/extension guard → confinement → read, with the fallback `cat` given a shell-escaped confined path |

`normalizeSecurityConfig` refuses `sandboxEnabled: false` — the sandbox cannot be switched off by
editing the config. That was tested as an attack, not assumed.

One gap is documented rather than closed: `edit_own_file` and the skill installers write through
their own helpers. They stay inside the `.automaton` tree and are gated behind the
`administrative` capability, but they do **not** call `confineToRoot`.

## 7. What this sandbox does not do

Stated because an operator deciding whether to grant `shell_execution` needs the honest scope.
It does not:

- create a Job Object, AppContainer or restricted token;
- change network reachability, Defender, the firewall or any Windows setting;
- enforce CPU or memory quotas;
- isolate processes from each other;
- stop a process that already has arbitrary code execution in this user session.

It stops accidental and casual escape, protects the known credential and system locations, and
provides a second line behind capability authorization.

## 8. Verifying the control yourself

```bash
cd <repo-root>
N=./runtime/node-v22.23.4-win-x64/node.exe
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-sandbox.test.ts       # 46/46
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-tool-security.test.ts # 16/16
$N node_modules/vitest/vitest.mjs run src/__tests__/tools-security.test.ts        # 71/71
$N node_modules/vitest/vitest.mjs run src/__tests__/path-protection.test.ts       # 27/27 (after 15L)
```

The 46 cases cover: relative paths allowed, `..` traversal denied, absolute paths outside the
root denied, the sibling-prefix directory, null bytes, reserved device names, junction/symlink
escape where link creation is permitted, a protected path *inside* the root, eight protected
location classes, fifteen denied commands, four allowed commands, nine scrubbed variables, and
the write/read/exec integrations including "the client is never called once blocked".

## 9. Residual risks

1. **Deny list, not allow list, for shell.** Capability authorization is the real control.
2. **Windows path semantics on a POSIX-style remote root** (cosmetic on this install, which is local).
3. **Scrubbing covers children only**, not already-loaded process memory.
4. **The protected list is finite.** A new browser or a new AI tool needs an entry in
   `protectedPrefixes()` or `CONWAY_PROTECTED_PATHS`.
5. **Some write paths skip `confineToRoot`** (`edit_own_file`, skill installers).
6. **No resource limits.** Phase 15J measures behaviour under load; it does not cap CPU or
   memory at the OS level.
7. **Both 15L sandbox-related product fixes are Windows-verified only.**
