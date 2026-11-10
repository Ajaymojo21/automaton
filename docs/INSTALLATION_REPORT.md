# INSTALLATION REPORT — Phases 3–4

**Install root:** `<repo-root>`
**Source commit:** `d8f816881fd24b6f5e3d616e59edec387a447667` (`main`, `v0.2.1-59-gd8f8168`)
**Report date:** 2026-10-31
**Status:** COMPLETE

---

## 1. What was installed, and what was not

| Item | Installed | Scope | Evidence |
|---|---|---|---|
| Node.js 22.23.4 win-x64 | Yes, portable | `runtime/node-v22.23.4-win-x64/` | `node --version` → `v22.23.4`; binary SHA-256 matched the published `SHASUMS256.txt` |
| pnpm 10.28.1 | Yes, project-local | `runtime/corepack/`, store in `runtime/pnpm-store/` | version pinned by `package.json` `packageManager`; driven through corepack |
| Repository dependencies | Yes | root `node_modules/`, `packages/cli/node_modules/` | install completed; `tsc --noEmit` exit 0 |
| Build output | Yes | `dist/`, `packages/cli/dist/` | `dist/index.js`, `dist/config.js`, `dist/security/activation.js`, `dist/agent/policy-rules/lockdown.js` present |
| System-wide Node/npm/pnpm | **No** | — | existing Node v24.18.0 and npm untouched |
| Windows service / scheduled task / startup entry | **No** | — | nothing registered |
| Docker / WSL2 | **No** | — | environment already lacked both; not required by the chosen native path |
| Defender / Firewall / SmartScreen changes | **No** | — | controls remain enabled |

### 1.1 Why a portable Node runtime

The machine's default Node is **v24.18.0** (ABI 137). The project declares
`"node": ">=20.0.0"`, but `better-sqlite3@11.x` ships prebuilt binaries only for
specific ABI versions, and the upstream CI pins Node 22. Rather than modify the
system Node installation (protected by the task rules), a verified portable
Node 22.23.4 was extracted under `runtime/`. The launcher scripts prepend it to
`PATH` for the Automaton process only.

**ABI note:** `better-sqlite3` was confirmed loadable by Node 22.23.4 (ABI 127).
No native rebuild was required.

---

## 2. Dependency installation

Workspace layout:

```
pnpm-workspace.yaml  -> packages: ["packages/*"]
packages/cli         -> @conway/automaton-cli 0.2.0
root                 -> @conway/automaton 0.2.1
```

Install command (executed through corepack so no global pnpm was installed):

```
corepack pnpm install --frozen-lockfile
```

### 2.1 Supply-chain controls applied

| Control | Action | Reason |
|---|---|---|
| Lockfile honoured | `--frozen-lockfile` | Prevent silent resolution drift |
| Install scripts limited | `pnpm.onlyBuiltDependencies = ["better-sqlite3", "esbuild"]` | Only native build steps run; arbitrary package postinstall scripts are blocked |
| Known-vulnerable transitive pins | `pnpm.overrides`: `yaml@^2.0.0 → 2.8.3`, `js-yaml@^3.0.0 → 3.15.2` | Advisory remediation without changing direct dependencies |
| `ws` overrides attempted | **Reverted** | Forcing a `ws` version broke peer dependencies (`isows`, `openai`); lockfile restored from `HEAD` and reinstalled. Not worth destabilising the tree. |
| Registry | Public npm registry over HTTPS | No private registry configured |

### 2.2 Direct dependency inventory (runtime)

| Package | Declared | Purpose | Notes |
|---|---|---|---|
| `better-sqlite3` | ^11.0.0 | Local state DB | Native module; prebuilt ABI 127 |
| `openai` | ^6.24.0 | Model client | Also used for OpenAI-compatible endpoints |
| `viem` | ^2.44.2 | EVM wallet/transactions | Wallet not created |
| `@solana/web3.js` | ^1.98.0 | Solana wallet/transactions | Alternate chain, unused |
| `siwe` | ^2.3.0 | Sign-In With Ethereum | Registration only |
| `simple-git` | ^3.24.0 | Git operations | **Installed but not exercised** — residual risk |
| `yaml` | ^2.4.0 | Heartbeat/config parsing | Overridden to 2.8.3 |
| `js-tiktoken` | ^1.0.21 | Token counting | — |
| `cron-parser`, `chalk`, `ora`, `gray-matter`, `bs58`, `tweetnacl`, `ulid` | as declared | support libraries | — |

### 2.3 Windows-specific installation issues encountered

1. **Nested `pnpm -r build` could not find `pnpm`.** The root `build` script is
   `tsc && pnpm -r build`. Inside a child process spawned by the portable runtime,
   the corepack shim was not on the Windows `PATH`. A `runtime/bin/pnpm.cmd` shim
   was created, and builds were executed as
   `corepack pnpm -r --workspace-concurrency=1 run build`.
2. **Worker thread conflict.** Passing `--maxWorkers` together with `CI=1` produced
   `RangeError: options.minThreads and options.maxThreads must not conflict` in
   `tinypool`. Tests are therefore run without those flags (see
   [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).
3. **Long test runtime.** The full suite is slow on Windows and one file hangs
   (documented in the testing section of [FINAL_ACCEPTANCE_REPORT.md](FINAL_ACCEPTANCE_REPORT.md)).
   This is an upstream test-harness limitation, not an installation failure.

---

## 3. Build evidence

Commands executed from the install root with the portable runtime first on `PATH`:

```
node node_modules/typescript/bin/tsc --noEmit
```

Result: **exit code 0**, no diagnostics.

```
corepack pnpm -r --workspace-concurrency=1 run build
```

Result: root `dist/` and `packages/cli/dist/` produced. Verified files:

- `dist/index.js`
- `dist/config.js`
- `dist/security/activation.js`
- `dist/agent/policy-rules/lockdown.js`
- `dist/agent/policy-rules/index.js`

The CLI starts and reports status:

```
node dist/index.js --status
```

Result: **exit 0**, prints name `automaton-local`, creator zero-address, state
`setup`, zero turns/tools/skills/heartbeats/children, model `gpt-5.2`, version
`0.2.1`.

---

## 4. Configuration instantiation

`config/automaton.template.json` was copied to
`runtime/home/.automaton/automaton.json`. The instantiated file deliberately keeps:

```
"registeredWithConway": false,
"sandboxId": "",
"conwayApiKey": "",
"openaiApiKey": "",
"anthropicApiKey": "",
"walletAddress": "",
"maxChildren": 0,
"security": {
  "lockdown": true,
  "activationApproved": false,
  "allowedTools": [],
  "allowFinancialTools": false,
  "allowHostShell": false,
  "allowSelfModification": false,
  "allowReplication": false,
  "allowExternalExposure": false
}
```

Treasury policy is all zeros (see [TREASURY_SECURITY.md](TREASURY_SECURITY.md)).
No placeholder was replaced with a real credential.

---

## 5. Isolation verification

| Check | Result |
|---|---|
| `HOME` used by runtime | `<repo-root>\runtime\home` |
| Config path resolved | `...\runtime\home\.automaton\automaton.json` |
| DB path resolved | `...\runtime\home\.automaton\state.db` |
| Any write outside install root | None observed |
| Existing Ollama models touched | No |
| FreeLLMAPI on `localhost:3001` touched | No |
| Existing OpenCode / Qoder / MCP configs touched | No |
| System `PATH` / env permanently changed | No |
| Windows services or startup entries created | No |

ACL hardening applied to `runtime/home/` and `backups/` (single-user FullControl).
The initial application of that ACL caused a lockout; the incident and its repair
are documented in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#1-acl-lockout-during-hardening-critical).

---

## 6. Phase verdict

**COMPLETE.** The application builds, the CLI runs in read-only status mode, and the
runtime refuses to start in the absence of explicit activation. No system-wide
change was made. No credential, wallet, or financial capability was enabled.
