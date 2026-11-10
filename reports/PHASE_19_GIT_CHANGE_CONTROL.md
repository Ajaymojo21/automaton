# Phase 19 — Git Change Control

Status: **nothing staged, nothing committed, nothing pushed.** The inspection below was run read-only
against the git index (`git status`, `git diff --stat`, `git add --dry-run`, `git check-ignore -v`),
which does not mutate the repository or the working tree.

This document exists because **A7 is unapproved** and because the inspection found that the current
ignore rules cannot safely support the A7 staging scope as written (F-19-04). That must be decided
before a commit, not discovered during one.

---

## 1. Measured repository state

| Item | Value |
|---|---|
| Inside work tree | yes |
| Branch | `main` |
| HEAD | `d8f8168` — "it's beautiful" |
| Prior commits sampled | `871c53e` "Internal RL Update", `22096f7` "Merge pull request #316 …" |
| Modified (unstaged) | **40 paths** |
| Untracked | **35 paths** (directory-collapsed) |
| Staged | none (`git status --porcelain` shows no first-column entries) |

F-18-08 — the security layer is outside version control — is **still open**, unchanged by anything in
Phase 19 so far.

## 2. Modified files (40)

```
.gitignore                     package.json                 pnpm-lock.yaml
src/__tests__/agent/general-harness.test.ts   src/__tests__/command-injection.test.ts
src/__tests__/loop.test.ts     src/__tests__/memory/context-manager.test.ts
src/__tests__/mocks.ts         src/__tests__/orchestration/local-worker-harness.test.ts
src/__tests__/path-protection.test.ts         src/__tests__/skills-hardening.test.ts
src/__tests__/tools-security.test.ts          src/agent/harnesses/general-harness.ts
src/agent/loop.ts              src/agent/policy-rules/index.ts
src/agent/policy-rules/validation.ts          src/agent/spend-tracker.ts
src/agent/system-prompt.ts     src/agent/tools.ts
src/config.ts                  src/conway/client.ts
src/conway/topup.ts            src/git/state-versioning.ts
src/heartbeat/daemon.ts        src/heartbeat/tasks.ts
src/identity/wallet.ts         src/index.ts
src/memory/context-manager.ts  src/registry/agent-card.ts
src/replication/constitution.ts src/self-mod/code.ts
src/self-mod/tools-manager.ts  src/setup/defaults.ts
src/skills/loader.ts           src/skills/registry.ts
src/soul/model.ts              src/soul/tools.ts
src/state/database.ts          src/state/schema.ts          src/types.ts
```

Every file A2, A3, A4, A5 and A6 would touch is **already modified and uncommitted**:
`src/state/database.ts` (A2/A3), `src/state/schema.ts` (A2), `src/index.ts` (A3/A4),
`src/config.ts` (A4), `src/security/**` (A5/A6 — untracked), `src/reliability/mechanic.ts` (A6 —
untracked), `src/agent/tools.ts` (A6). This is the practical meaning of F-18-08: there is no baseline
to diff a security change against, so a bad edit and an intended edit are currently
indistinguishable. **A7 is the precondition for every later phase's reviewability**, not bookkeeping.

## 3. Untracked inventory (35 collapsed entries), classified

| Class | Paths |
|---|---|
| **Source — review scope** | `src/security/`, `src/runtime/`, `src/reliability/`, `src/agent/policy-rules/lockdown.ts`, `src/__tests__/security/`, `src/__tests__/security-lockdown.test.ts`, `src/__tests__/runtime/`, `src/__tests__/helpers/`, `src/__tests__/phase15-*.test.ts` (7 files) |
| **Config — review scope** | `config/` (2 files by dry-run) |
| **Console — review scope** | `dashboard/` (**74 files** by dry-run — see §5) |
| **Documentation** | `docs/` (31), `reports/` (69) |
| **Launchers** | the 11 `.bat` wrappers |
| **Scripts** | `scripts/phase15-backup-validate.ts`, `phase15-soak.ts`, `phase15l-snapshot.sh`, `phase16-live-model-preflight.ts` |
| **Runtime state — must stay out** | `runtime/` (**19 424 files by dry-run** — see §4) |

## 4. F-19-04 (High, blocks A7) — the ignore rules do not exclude what they appear to exclude

`.gitignore` is itself modified with an "Local installation state and secrets" block (9 added lines):

```
runtime/home/  runtime/corepack/  runtime/pnpm-store/  runtime/tmp/  runtime/node-v22.23.4-win-x64/
backups/  logs/
```

Verified working: `git check-ignore -v runtime/home/.automaton/state.db` and `…/automaton.json` both
resolve to `runtime/home/`. **Verified broken:**

| Path | `git check-ignore` | Dry-run files | Why it leaks |
|---|---|---|---|
| `runtime/.pnpm-store/` | **NOT ignored** | **18 628** | the rule says `runtime/pnpm-store/`; the real directory is `runtime/.pnpm-store/` — leading dot, so the rule never matched |
| `runtime/npm-cache/` | **NOT ignored** | **783** | no rule covers it |
| `runtime/bin/` | not ignored | 9 | legitimate tooling — *should* be committed |
| `runtime/downloads/` | not ignored | 2 | installer archives; do not belong in git |
| `runtime/model-test-home/.automaton/automaton.json` | not ignored | 1 | a **second state tree** outside canonical HOME. Content-checked without printing values: all three credential fields `len 0`, `lockdown:true`, `activationApproved:false`, `allowedTools:[]` — **no secret and no invariant violation**, but committing another `.automaton` config invites exactly the HOME-confusion Phase 16 §3 forbids |
| `runtime/audit.json`, `runtime/*.log` | not ignored | several | generated reports/logs (§9: logs are not stageable) |
| `dashboard/state/dashboard.token` | **NOT ignored** | **1** | **the live 44-byte operator token.** Its value was never read into any output. Mandate §9 forbids staging operator tokens; `git add dashboard/` would stage it |
| `dashboard/state/*` (10 files) | not ignored | 10 | pid + 9 dashboard health report JSONs |
| `dashboard/restore-targets/` | not ignored | 4 | a real restore snapshot (`phase15-pre-20261031-211345--…`) — local backup material, §9 forbidden |
| `dashboard/node_modules/`, `dashboard/logs/` | ignored | 0 | correct already |

**Consequence.** A7 executed as "stage the review scope directories" commits ~19 400 store blobs and
the operator token. Once committed, the token is in history; deleting the file later does not remove
it, and rotating it means restarting the console and re-issuing. That is the specific failure F-18-08's
remedy could create, and the reason A8 (scan the exact staged set) is not optional decoration.

**Proposed remedy (part of the A7 approval, not applied):**

1. Fix the ignore rules before any staging: `runtime/.pnpm-store/`, `runtime/npm-cache/`,
   `runtime/downloads/`, `runtime/model-test-home/`, `runtime/*.log`, `runtime/audit.json`,
   `dashboard/state/`, `dashboard/restore-targets/`, `dashboard/diagnostics/` (evidence only — the
   operator decides), and `**/dashboard.token`.
2. Stage by **explicit allowlist**, never by directory: `git add -- <file> …`. No `git add -A`, no
   `git add .`, no `git add runtime/`, no `git add dashboard/`.
3. Re-run `git check-ignore -v` on every forbidden class after the rule change and capture the output.
4. Run A8 against the staged blobs. Confirm `git ls-files | grep -iE "token|wallet|\.env|state\.db|
   pnpm-store|npm-cache"` is empty.
5. Only then commit. **Push requires separate consent and is not requested here.**

Note that a `.gitignore` change is a source change, which means **A7's first step is itself an
approved edit** — it cannot be waved through as housekeeping.

## 5. Proposed staging set (exact, for approval)

| Set | Contents | Count (dry-run) |
|---|---|---|
| S1 source | all 40 modified paths except none; plus the untracked `src/**` security/runtime/reliability/test dirs | 40 mod + ~14 new dirs/files |
| S2 config | `config/` | 2 |
| S3 console | `dashboard/{server,src,tests,scripts}` + `package.json`, `tsconfig*.json`, `vite.config.ts`, `.npmrc` — **excluding** `state/`, `restore-targets/`, `diagnostics/`, `node_modules/`, `dist/`, `logs/` | ~55 of 74 |
| S4 launchers | the 11 `.bat` | 11 |
| S5 docs | `docs/**` | 31 |
| S6 evidence | `reports/**` | 69 |
| S7 build | `package.json`, `pnpm-lock.yaml`, `.gitignore` | 3 |
| S8 scripts | `scripts/phase15-*`, `scripts/phase16-*`, `runtime/bin/**` | ~13 |

Excluded by design: everything in §4's leak table, plus `dist/`, `logs/`, `backups/`, `runtime/home/`.

## 6. Commit and tag plan (post-approval only)

- Message form `<type>: <description>` with a body explaining *why*, per the engineering rules —
  draft: `chore: bring the Conway security layer, console, and operations docs under version control`
  with a body recording that this closes F-18-08, that `runtime/home/` stays excluded, and that no
  push is implied.
- Tag (e.g. `phase-19-baseline`) **only if separately approved** — recorded as a decision, not assumed.
- After commit: record `git rev-parse HEAD`, `git show --stat HEAD`, and the four verification greps
  in §5 of the approval record's A7 row.
- No remote push. No remote is even configured-checked in this session; that is deliberate —
  contacting a remote is a shared-state action requiring its own consent.

## 7. Secret-scan plan (A8), blocked on nothing but approval

No third-party scanner is installed (`gitleaks`, `trufflehog`, `detect-secrets` → all absent), and
installing one into an unrelated environment is not proposed. Plan: a project-local Node script that
iterates `git diff --cached --name-only`, reads each **staged blob** with `git show :<path>`, and
matches the pattern set in the approval record §7. Output never contains a matched value — file,
line, finding type, severity only. Canary-tested: the scanner is run against a fixture containing a
fake `sk-…` string and must report it, so a clean result is known to be capable of being dirty.

## 8. Invariants after this inspection

Re-measured after all git commands: `automaton.json` `1c10ecc5…966d`, `state.db` `512 000 B` /
`2026-10-31T10:25:59.744Z`, schema 11, gates unchanged, no staging, no commit, no push. The token
file was stat-ed, never read.
