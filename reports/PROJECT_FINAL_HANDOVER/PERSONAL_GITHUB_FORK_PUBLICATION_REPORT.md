# Personal GitHub Fork Publication Report

- Repository: `<repo-root>`
- Branch: `main`
- Mission mandate: `m-mwagetnc-mrzu`
- Report date: 2026-11-10

## Verdict

**PUBLISHED AND VERIFIED**

The authenticated account's personal fork was created through the official GitHub fork operation,
the existing local history was fast-forwarded to it without rewriting or discarding anything, and
every claim below was verified against the remote rather than inferred from a push exit code. The
original `origin` and the upstream repository are unchanged, all Conway security invariants remain
in their locked-down state, and no credential, wallet, database or machine-specific artifact was
published.

## 1. Authenticated identity and authentication method

| Item | Value |
|---|---|
| Authenticated GitHub account | `Ajaymojo21` |
| How it was established | username read from the stored credential for `host=github.com`; the secret half was filtered out of the pipeline and never displayed. GitHub itself had already named the same account in the earlier `403` message on upstream. |
| GitHub CLI (`gh`) | absent; not installed (the mission forbids installing unnecessary global tools) |
| Credential mechanism | Git Credential Manager `2.9.1+6760f0ef…`, `credential.helper = manager` from the Git for Windows system config (Windows Credential Manager backend, no plaintext credential file) |
| Credential exposure | none — the token was never printed, never placed in an argument, URL, environment variable, script or report; it moved from `git credential fill` straight into `curl --config -` over stdin |

## 2. Repository and remotes

| Item | Value |
|---|---|
| Original repository | `https://github.com/Conway-Research/automaton` |
| Original remote | `origin` — unchanged, fetch and push |
| Personal fork URL | `https://github.com/Ajaymojo21/automaton` |
| New remote | `personal-fork` — same URL, fetch and push; no credentials embedded |
| Verified fork parent | `Conway-Research/automaton` (GitHub API: `fork: true`, `parent.full_name`, `source.full_name`, `default_branch: main`, `permissions.push: true`, `private: false`) |

`origin` was not renamed, replaced, deleted or modified, and no credential was added to either URL.

## 3. Fork discovery and creation

| Step | Evidence |
|---|---|
| Check for an existing fork | `GET /repos/Ajaymojo21/automaton` returned `404` before creation |
| Create the fork | `POST /repos/Conway-Research/automaton/forks` returned `202` (accepted) |
| Fork metadata | `full_name: Ajaymojo21/automaton`, `fork: true`, `parent: Conway-Research/automaton`, `default_branch: main`, `owner.login: Ajaymojo21`, `permissions.push: true` |
| Fork becomes live | `git fetch personal-fork` succeeded and returned `main` plus the 7 other branches and 3 tags inherited from upstream |

The fork was created with GitHub's own fork operation, so the upstream remains the parent. No
standalone repository was created and the upstream repository was not modified in any way.

## 4. Local state at the start of the mission

| Check | Value |
|---|---|
| Repository root | `<repo-root>` |
| Branch | `main` |
| HEAD | `2702e9180b7496a0a83b130d25ef6f22d2529b04` (expected value) |
| Working tree | clean (0 entries) |
| Commits ahead of `origin/main` | 2 |
| Both unpublished commits present | `de27cb94c3b41d37215e719dfea98af5c5bb1a87`, `2702e9180b7496a0a83b130d25ef6f22d2529b04` |
| Merge / rebase / cherry-pick in progress | none (no `MERGE_HEAD`, `rebase-merge`, `rebase-apply` or `CHERRY_PICK_HEAD`) |

## 5. Reconciliation decision — fast-forward, no publication branch required

The fork's `main` was `d8f816881fd24b6f5e3d616e59edec387a447667`, the same as `origin/main`, and
`git merge-base --is-ancestor personal-fork/main main` succeeded. The fork therefore held no
independent commits and the local `main` was a strict descendant, so the preferred destination
`personal-fork/main` was safe. No `conway-final-handover` branch was needed, and no force, reset,
rebase or overwrite was used.

## 6. Push and actual result

```text
git push personal-fork main:main

To https://github.com/Ajaymojo21/automaton.git
   d8f8168..2702e91  main -> main
```

Exit status 0, a plain fast-forward (`d8f8168..2702e91`). No `--force`, `--force-with-lease`,
`--no-verify`, branch deletion or tag change.

## 7. Remote verification evidence

| Check | Observed |
|---|---|
| Fork exists and is public | API `200`; `private: false`; `pushed_at` advanced to `2026-11-10T08:56:03Z` |
| Fork parent | `Conway-Research/automaton` (`fork: true`, `source` also the upstream) |
| Destination branch | `refs/heads/main` on `personal-fork` |
| Remote branch contains local HEAD | `git ls-remote personal-fork refs/heads/main` = `2702e9180b7496a0a83b130d25ef6f22d2529b04` |
| Both unpublished commits reachable | `git merge-base --is-ancestor de27cb9 personal-fork/main` = 0; same for `2702e91` |
| Published tree equals local tree | tree hashes identical (`YES`) |
| No commit lost | `git rev-list --count main..personal-fork/main` = 0; `git rev-list --count personal-fork/main..main` = 0 after the push |
| Original upstream unchanged | `git ls-remote origin refs/heads/main` still `d8f816881fd24b6f5e3d616e59edec387a447667` |
| Local working tree | clean |
| No sensitive runtime files published | 527 tracked files in `personal-fork/main`; filename scan for `.env`, `wallet.json`, `state.db`, `id_rsa`/`id_ed25519`, `*.pem`/`*.pfx`/`*.key`, credentials/secrets files, `node_modules/`, `dist/`, `runtime/home|tmp|node-v22|corepack|npm-cache|downloads`, `*.db-wal`/`*.db-shm` found nothing |
| Other fork refs preserved | 7 inherited feature branches and tags `v0.1.0`, `v0.2.0`, `v0.2.1` still present; only `main` moved |

The fork's history now reads: `d8f8168` (published upstream base) → `de27cb9` (security
remediation) → `2702e91` (publication review) → this report's follow-on docs commit.

## 8. Security invariants after publication

Read-only probe of `runtime/home/.automaton/automaton.json` and the state directory; nothing was
started or changed by this mission.

| Invariant | State |
|---|---|
| `security.lockdown` | `true` |
| `security.activationApproved` | `false` |
| `security.allowedTools` | `[]` |
| `allowFinancialTools`, `allowHostShell`, `allowSelfModification`, `allowReplication`, `allowExternalExposure` | all `false` |
| `maxChildren` | `0` |
| `treasuryPolicy` | 10 keys, all `0` or `[]` |
| `walletAddress` | `""` |
| Credential fields | present but zero-length (values not printed) |
| `wallet.json` | absent |
| Runtime state directory | gitignored and absent from the published tree |

No agent activation, wallet creation, financial action, production migration, real inference,
FreeLLMAPI/Ollama/OmniRoute/OpenCode change, Qoder global configuration change, or exposure beyond
loopback occurred.

## 9. Specialist security review

`ecc:security-reviewer` reviewed the executed process and the published tree once. Verdict: **PASS
WITH NOTES**. Findings incorporated:

| Severity | Finding | Disposition |
|---|---|---|
| Medium | `reports/` (0 files upstream, 140 files here) publishes internal audit detail, which lowers attacker reconnaissance cost on a public fork | Accepted deliberately: the handover reports are part of the mission's deliverable, the mission forbids removing legitimate reports to shrink the commit, and the material is defensive documentation with no live secrets |
| Low | The previous publication report repeated the account email in prose | **Fixed** in a follow-on docs commit; the email remains only where it is unavoidable, in commit author metadata |
| Low | `reports/.p20-dist-pre.manifest` exposes internal `dist\` file paths and sizes | Accepted; paths and sizes only, retained as build evidence |
| Low | Residual: the producer side of the credential pipeline cannot be proven by a third party | Documented; the command used `git credential fill | sed | printf` into `curl --config -`, so the token never entered argv, a file or the terminal |

Confirmed by the review: no embedded remote credentials, no credential material, wallet material or
database in the published tree, `origin` untouched, no forced update in the reflog, and all
invariants intact.

## 10. Files changed by this mission

| File | Change |
|---|---|
| `.git/config` (local, untracked) | `personal-fork` remote added; `origin` unchanged |
| `reports/PROJECT_FINAL_HANDOVER/GITHUB_PUBLICATION_FINAL_REPORT.md` | Removed the duplicated account email (Low finding) |
| `reports/PROJECT_FINAL_HANDOVER/PERSONAL_GITHUB_FORK_PUBLICATION_REPORT.md` | This report |

No application code, configuration template, test or launcher was modified; the publication is a
remote-side operation plus documentation.

## 11. Remaining blockers

None for this mission. The personal fork is published and verified. The Conway-Research upstream
still does not grant write access to `Ajaymojo21`; that is unchanged and no longer relevant to
publication, since the authorized destination is the personal fork. Any future upstream
contribution would proceed as a pull request from `Ajaymojo21/automaton`, not as a direct push.

## 12. Reproduction and verification commands

```text
git -C <repo-root> remote -v
git -C <repo-root> rev-parse main
git -C <repo-root> ls-remote personal-fork refs/heads/main
git -C <repo-root> ls-remote origin refs/heads/main
git -C <repo-root> merge-base --is-ancestor de27cb9 personal-fork/main
git -C <repo-root> rev-list --count personal-fork/main..main
git -C <repo-root> status --porcelain
curl -s https://api.github.com/repos/Ajaymojo21/automaton
```

A commit cannot contain its own hash: the published commits of record are `de27cb9` and `2702e91`,
and the final fork tip (this report plus the PII correction) is whatever
`git rev-parse personal-fork/main` prints — its ancestry must include both commits above.
