# SOURCE VERIFICATION REPORT — Conway Automaton

**Project:** Conway Automaton
**Install root:** `<repo-root>`
**Report date:** 2026-10-31
**Phase:** 2 of 14
**Status:** COMPLETE

---

## 1. Repository Identity

| Field | Verified value | Evidence |
|---|---|---|
| Repository URL | `https://github.com/Conway-Research/automaton` | GitHub API + `git remote -v` |
| Organization | `Conway-Research` | GitHub API |
| Repository | `automaton` | GitHub API |
| Default branch | `main` | GitHub API |
| License | MIT (`LICENSE`, SPDX `MIT`) | GitHub API license field + file read |
| Homepage | `https://web4.ai` | GitHub API |
| Stars / forks (at verification) | 7,625 / 1,098 | GitHub API |
| Created / pushed | 2026-02-11 / 2026-08-26 | GitHub API |
| GitHub org verified badge | No (org is not GitHub-verified) | GitHub API `is_verified: false` |
| Canonical npm package name | `@conway/automaton` v0.2.1 | `package.json` |

**Identity caveat:** The GitHub organization is not GitHub-verified. Identity was
corroborated by: README pointing to `conway.tech` / `web4.ai`, the org blog, the
published package name, and the release artifacts matching the repository. This is
strong but not cryptographic proof of official provenance. Recorded as residual
supply-chain risk R-S1.

## 2. Commit Pin

| Item | Value |
|---|---|
| Cloned commit | `d8f816881fd24b6f5e3d616e59edec387a447667` (`main` HEAD at clone time) |
| Commit date | 2026-08-26 |
| Commit subject | `it's beautiful` |
| Release tag | `v0.2.1` → `6fd836aa366db567cc26abd0c31cf4b20cb09353` |
| Commits ahead of `v0.2.1` | 59 |
| Diff vs `v0.2.1` | 74 files changed, +6,820 / −745 |
| Working tree (upstream files) | Clean at clone; only `runtime/` added by this installation |

**Rationale for pinning `main` instead of tag `v0.2.1`:** the 59 intervening commits
contain security-relevant fixes (HTTPS enforcement, local-worker confinement, path
confinement). The source package version still reports `0.2.1`. This is a
*post-release main snapshot*, documented as such; it is not a signed release artifact.

## 3. Source Inspection Performed

Read and reviewed (not exhaustive line-by-line of all 74 files): `README.md`,
`DOCUMENTATION.md` (42 KB), `ARCHITECTURE.md` (40 KB), `LICENSE`, `constitution.md`,
`package.json`, `pnpm-lock.yaml`, `src/index.ts`, `src/config.ts`,
`src/identity/wallet.ts`, `src/conway/client.ts`, `src/conway/topup.ts`,
`src/agent/tools.ts`, `src/agent/policy-engine.ts`, and all files under
`src/agent/policy-rules/`, `src/survival/funding.ts`, `src/setup/wizard.ts`,
`src/setup/environment.ts`, `src/heartbeat/tasks.ts`, `src/heartbeat/config.ts`,
`src/skills/registry.ts`, `src/observability/logger.ts`, `scripts/automaton.sh`,
`scripts/backup-restore.sh`, `.github/workflows/ci.yml`.

### 3.1 Security-relevant behaviours found in source

1. `--run` **always calls `getWallet()`** and silently generates an EVM/Solana wallet
   if `wallet.json` is absent (`src/index.ts`, `src/identity/wallet.ts`). Wallet files
   are written with mode `0600`, unencrypted.
2. On startup, `--run` attempts a **bootstrap top-up that buys $5 of credits with
   USDC** (`src/conway/topup.ts: bootstrapTopup`) before the agent loop starts.
3. The heartbeat's `check_usdc_balance` task performs **automatic top-ups** when USDC
   balance ≥ $5 (`src/heartbeat/tasks.ts`).
4. In local (non-sandbox) mode, the `exec` tool runs **host shell commands** via
   `execSync` with `cwd = HOME` (`src/conway/client.ts`). The agent's prompts assume a
   POSIX/Linux environment; on Windows this resolves to `cmd.exe`.
5. `write_file` / `read_file` in local mode are **not confined** to the project tree.
6. Policy engine is deny-by-default only for rules that exist; there is **no global
   activation gate and no global risky-tool kill switch**.
7. Treasury gaps: `x402` per-payment cap and minimum-reserve rules return `null`
   (not enforced); `topup_credits`, `create_sandbox`, `spawn_child`, `fund_child`,
   `register_domain` are outside treasury enforcement. `quarantine` decisions are
   treated as denials by `executeTool`.
8. There is **no lockdown/allowlist mode** and no approval requirement to start
   autonomous operation.
9. `simple-git` is declared as a dependency but is **not imported anywhere** in
   `src/` or `packages/` (verified by grep). Git tooling in `src/agent/tools.ts`
   shells out instead.

These findings drove the hardening plan (see `SECURITY_AUDIT.md`): activation gate,
lockdown allowlist, zero-spend financial policy, disabling bootstrap/auto top-up in
lockdown, and exclusion of git/self-mod/replication tools from the allowlist.

## 4. Dependency Inventory (resolved at install)

Installed with pnpm 10.28.1, `--frozen-lockfile`, store in `runtime/.pnpm-store`.

**Runtime dependencies (16):** `@solana/web3.js 1.98.4`, `@types/better-sqlite3 7.6.13`,
`better-sqlite3 11.10.0`, `bs58 6.0.0`, `chalk 5.6.2`, `cron-parser 4.9.0`,
`gray-matter 4.0.3`, `js-tiktoken 1.0.21`, `openai 6.24.0`, `ora 8.2.0`,
`simple-git 3.30.0`, `siwe 2.3.2`, `tweetnacl 1.0.3`, `ulid 2.4.0`, `viem 2.45.3`,
`yaml 2.8.2`.
**Dev dependencies (4):** `@types/node 20.19.33`, `tsx 4.21.0`, `typescript 5.9.3`,
`vitest 2.1.9`.
**Total resolved packages:** 281.

`better-sqlite3` and `esbuild` are the only dependencies permitted to run install
scripts (`package.json` → `pnpm.onlyBuiltDependencies`). `bufferutil` and
`utf-8-validate` build scripts were skipped by pnpm (optional native accelerators;
not required at runtime).

## 5. Vulnerability Audit (`pnpm audit`, 2026-10-31)

Totals: **5 critical, 18 high, 21 moderate, 2 low** across 281 packages.

### 5.1 Runtime-reachable / runtime-dependency findings

| Package | Sev | Installed | Fixed | Reachability / mitigation |
|---|---|---|---|---|
| `simple-git` | critical ×3, high ×4 | 3.30.0 | 4.0.1 (major) | **Not imported anywhere in `src/` or `packages/`** — dependency is inert. Lockdown allowlist excludes all git/self-mod tools. Residual: package remains installed. |
| `yaml` | moderate | 2.8.2 | 2.8.3 | Used by `heartbeat/config.ts` and `skills/registry.ts`. Patched at 2.8.3; safe patch-level upgrade path. |
| `js-yaml` (via `gray-matter`) | high ×4 | 3.14.2 | 3.15.2 | Used to parse skill front-matter (trusted local files). Patch-level fix available. |
| `ws` (via `@solana/web3.js`, `siwe`→`ethers`) | high ×2 | 7.5.10 / 8.17.1 / 8.18.3 | 7.5.11 / 8.21.0 | Solana support is inactive in this installation (EVM-only, lockdown). Patch/minor fix available. |
| `stream-json` (via `jayson`/`@solana/web3.js`) | moderate ×3 | 1.9.1 | 3.6.0 (major) | Only reachable through Solana RPC client, which is disabled in this installation. |
| `uuid` (via `jayson`, `rpc-websockets`) | moderate | 8.3.2 / 11.1.0 | 11.1.1 | Advisory applies only when callers pass an explicit buffer to v3/v5/v6; jayson uses `v4()` without a buffer. Solana path disabled. |

### 5.2 Development-only findings (not shipped to runtime)

`vitest 2.1.9`, `vite`, `postcss`, `esbuild` (tsx), `rollup`, `nanoid`,
`source-map-js`, `@vitest/mocker`, `tinypool` — all reachable only from the local
test/dev toolchain. They are not imported by `dist/` at runtime. They remain recorded
as residual dev-environment risk (R-S2); no `--host`/UI server is ever used.

**Note:** `package.json` CI runs `pnpm audit --audit-level=high || true`, so upstream
does not gate on audit results.

## 6. Platform Support Assessment

- CI matrix: **Ubuntu only**, Node 20/22 (`.github/workflows/ci.yml`). No Windows CI.
- Source assumes POSIX paths, POSIX shell commands, and `/etc/conway` detection.
- The official installer `scripts/automaton.sh` is bash-only.
- `better-sqlite3` ships Windows prebuilds; it installed successfully on Windows with
  Node 22.23.4 (ABI 127).
- **Conclusion:** Windows is *not* an officially supported runtime target. This
  installation runs the Node application natively on Windows, with the agent's
  shell/VM tooling disabled under lockdown. It is a supervised, local-only deployment,
  not a supported production configuration.

## 7. Install Scripts Inspected (not executed)

| Script | Behaviour | Decision |
|---|---|---|
| `scripts/automaton.sh` | Checks node ≥ 20 + git, runs `corepack enable pnpm`, clones repo, `pnpm install --frozen-lockfile`, `pnpm run build`, then `exec node dist/index.js --run`. | **Not executed.** Runs the agent immediately (would generate a wallet). Equivalent steps performed manually, without `--run`. |
| `scripts/backup-restore.sh` | bash + `sqlite3` CLI backup/restore/verify. | **Not executed.** `sqlite3` CLI is not installed. Replaced by a Node/better-sqlite3 backup utility. |
| `.github/workflows/ci.yml` | Ubuntu typecheck/test/security-test. | Not applicable to Windows; used as reference for the test command set. |

## 8. Supply-Chain Controls Applied

1. Repository URL confirmed via GitHub API before cloning; clone performed only from
   `https://github.com/Conway-Research/automaton.git`.
2. Commit pinned and recorded (`d8f8168…`); upstream working tree clean at clone.
3. Node.js 22.23.4 official `win-x64` zip downloaded from `nodejs.org` and verified:
   SHA-256 `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`
   matches the official `SHASUMS256.txt` entry.
4. Dependencies installed with `--frozen-lockfile`; only `better-sqlite3` and
   `esbuild` permitted to execute install scripts.
5. No credential, wallet, or API key was created, requested, or stored during
   verification.
6. No lifecycle script from the repository was executed.

## 9. Residual Risks from Source Verification

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-S1 | GitHub org not verified; provenance is corroborated, not signed | Medium | Documented; commit pinned |
| R-S2 | Dev-toolchain dependency advisories (vitest/vite chain) | Low (dev-only) | Documented; no dev server exposed |
| R-S3 | `simple-git` 3.30.0 critical advisories remain installed | Medium | Mitigated: unused + excluded from allowlist; documented |
| R-S4 | Post-release `main` snapshot, not a signed release | Medium | Documented; commit pinned |
| R-S5 | Windows is unsupported upstream | High | Mitigated: local-only, lockdown, tool restrictions |
| R-S6 | Transitive advisory fixes require dependency overrides | Medium | Tracked in Phase 9 hardening |

## 10. Phase 2 Verdict

**COMPLETE — source verified, pinned, and audited.**

- Official repository identity corroborated and cloned from the canonical URL.
- Commit, release, license, dependency inventory, and audit results recorded.
- Install scripts inspected; none executed.
- Runtime/platform limitations identified and carried into the hardening plan.
- No installation or build action was taken during this phase beyond the verified
  clone; dependency installation and build are recorded under Phase 3–4.
