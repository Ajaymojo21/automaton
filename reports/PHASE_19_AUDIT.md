# Phase 19 — Audit and Scope Verification

Objective: establish, by measurement, the state Phase 19 starts from; carry every Phase 18 finding
forward without downgrade; and record the discrepancies found while preparing the A2–A8 approval
requests.

This document contains **no remediation**. Phase 19 execution is gated item-by-item on human
approval (§2 of the Phase 19 mandate). Nothing in A2–A8 has been applied.

Scope of this document: baseline re-verification, findings carry-forward, and three evidence
corrections to the Phase 18 record (F-19-01, F-19-02, F-19-03).

---

## 1. Live baseline, re-measured (not quoted from Phase 18)

All measurements taken 2026-11-01 between 18:24 and 18:35 local (`13:04Z`), with the canonical
HOME pinned in the same process that opened each file.

### 1.1 HOME guard

```
HOME VERIFIED: <repo-root>\runtime\home
```

Every measurement below ran under that guard. The guard is asserted before any file read, not
after. (Recording the method because the Bash tool collapses `\\` in command strings; a literal
written inline can silently lose its backslashes and produce a false "HOME GUARD FAIL". The
canonical path is therefore built from character codes and compared, then echoed.)

### 1.2 Live state

| Item | Required by mandate §13 | Measured | Matches Phase 18? |
|---|---|---|---|
| `automaton.json` SHA-256 | unchanged | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | **yes — identical** |
| `state.db` size / mtime | unchanged | `512 000 B` / `2026-10-31T10:25:59.744Z` | yes |
| `state.db-wal` | — | `0 B`, mtime `2026-11-01T08:24:49.563Z` | yes |
| `state.db-shm` | — | `32 768 B`, mtime `2026-11-01T11:32:51.786Z` | yes (read-only WAL readers touch it) |
| live schema | 11 | `SELECT MAX(version) FROM schema_version` → **11** | yes |
| code schema | 13 | [src/state/schema.ts:8](../src/state/schema.ts#L8) `SCHEMA_VERSION = 13` | yes |
| tables | 38 | 38 | yes |
| V12/V13 tables | absent | `security_events`, `security_incidents`, `security_seals`, `treasury_authorizations` — **all absent** | yes |
| `integrity_check` | ok | `ok` | yes |
| `security.lockdown` | true | `true` | yes |
| `security.activationApproved` | false | `false` | yes |
| `security.allowedTools` | `[]` | `[]` | yes |
| `allowFinancialTools` / `allowHostShell` / `allowSelfModification` / `allowReplication` / `allowExternalExposure` | all false | all `false` | yes |
| `maxChildren` | 0 | `0` | yes |
| treasury limits | zero | all ten `treasuryPolicy` fields `0`; `x402AllowedDomains: []` | yes |
| wallet | not configured | no `wallet.json`; `walletAddress` = zero-length string | yes |
| credentials | none entered | `conwayApiKey`, `openaiApiKey`, `anthropicApiKey`, `sandboxId` = **zero-length strings** (measured as length only; no value read into any log) | yes |
| `CONWAY_ACTIVATION` / `CONWAY_ALLOW_WALLET_CREATION` | unset | unset in this process | yes |
| `registeredWithConway` | — | `false` | — |

Note for the record: `creatorAddress` is a non-empty 42-character identity address, not a secret and
not a credential field; it is reported as "present" only to keep the emptiness claim precise — the
four fields that would carry a key or token are empty.

### 1.3 Processes, services, tasks

| Check | Measured |
|---|---|
| Conway Windows service | none (`Get-Service` name/display match on *Conway* → empty) |
| Scheduled task matching `conway\|automaton` | `(none)` |
| Conway agent runtime process | **none** |
| `node.exe` running `dist/index.js` (PID 12652) | **not Conway** — parent is `powershell.exe -File …\TradingProjects\freellmapi\scripts\freellmapi-service.ps1`. Investigated because a bare `dist/index.js` command line looks like the Conway entry point; it is FreeLLMAPI's own service. Left untouched (§14). |
| Conway dashboard server | PID 22824 `runtime/node-v22.23.4-win-x64/node.exe … tsx/cli.mjs server/index.ts` + PID 22936 (its loader child), both under the Conway project root |

The "no agent runtime process" baseline therefore **holds**. The mandate's claim is verified, and the
one look-alike process is attributed rather than assumed.

### 1.4 Dashboard reachability — positive probes

| Probe | Result |
|---|---|
| `exec 3<>/dev/tcp/127.0.0.1/8787` | **OPEN** in every trial |
| `GET http://127.0.0.1:8787/` | **200**, 792 bytes (the token gate page; no token submitted, none printed) |
| `exec 3<>/dev/tcp/<host-lan-ip>/8787` (Wi-Fi interface) | **Connection refused** |

### 1.5 Socket-table behaviour (see F-19-03)

`netstat` and `Get-NetTCPConnection` were sampled against the same live listener — detail in §4.3.

---

## 2. Phase 18 findings carried forward — none dropped

| Finding | Severity | Phase 19 disposition | Gated on |
|---|---|---|---|
| F-18-01 `--status` migrates, ungated | High | **open** — documented in A1, code unchanged | **A3** |
| F-18-02 swallow-then-stamp in the runner | High | **open** — widened by F-19-02 | **A2** |
| F-18-03 inert audit chain + fail-open branch | High | **open** | **A5**, **A6** |
| F-18-04 wake loop armed on an unsatisfiable condition | Medium | **open** | **A12** (deferred, outside Phase 19) |
| F-18-05 unsatisfiable invariant-board rows | Medium | **open** | dashboard scope — separate approval (§11) |
| F-18-06 health reclassification keyed off error prose | Medium | **open** | dashboard scope — separate approval |
| F-18-07 `EMPTY` for absent sources + test asserting it | Low/Med | **open** | dashboard scope — separate approval |
| F-18-08 security layer untracked | Medium | **open** — re-measured (§3) | **A7** |
| F-18-09 wallet gate only in the launcher | Low | **open** — not in Phase 19 items | B3 |
| F-18-10 `rotate_audit_seal` bypasses `classifyRepair` | Low | **open** | **A6** |
| F-18-11 `MIGRATION_V10` lacks `IF NOT EXISTS` | Low | **open** | **A2** |
| F-18-12 `user_version` 0; read-only WAL readers touch `-shm` | Info/Low | **open**, informational — no code change proposed | — |
| F-18-13 `--configure` / `--pick-model` ungated | High | **open** — documented in A1, code unchanged | **A4** |
| F-18-14 at-rest ACL unverified | Medium (unverified) | **open** — README claim corrected in A1; the measurement itself still needs elevation | B1 |

No finding was regraded, merged away, or closed by documentation. Two closures are worth stating
explicitly because they are tempting: A1 corrected *doc prose only*; it closed **zero** findings.
F-18-14's *claim* is now honest, but the ACL is still unread and the finding stays open.

---

## 3. F-19-01 — the Phase 18 "seven append-only triggers" figure is wrong (six)

**Severity: Low, but it can cause a false NO-GO.**

Phase 18 records four places expecting **seven** append-only triggers after V12/V13
([`PHASE_18_MIGRATION_READINESS.md:191`](PHASE_18_MIGRATION_READINESS.md),
`PHASE_18_REMEDIATION_PLAN.md:56,142`, `PHASE_18_APPROVAL_LIST.md:35`), and the Phase 19 mandate
inherits the number verbatim (§4 "All seven expected append-only triggers exist").

Measured against the source that will actually run — `grep -n "CREATE TRIGGER"` over
[src/state/schema.ts:688-812](../src/state/schema.ts#L688), and over the whole file:

| Migration | Table | Triggers defined |
|---|---|---|
| V12 | `treasury_authorizations` | `treasury_authorizations_no_delete` |
| V12 | `security_events` | `security_events_no_update`, `security_events_no_delete` |
| V13 | `security_incidents` | `security_incidents_no_delete` |
| V13 | `security_seals` | `security_seals_no_update`, `security_seals_no_delete` |
| | **total** | **6** |

There is no seventh: the file-wide grep returns exactly those six names and nothing else. Accompanying
objects, counted for the same reason: **4 tables** and **12 indexes** (V12: 4 + 3; V13: 3 + 1 partial
unique + 1).

Consequence if uncorrected: an A2 test or the A9/A10 post-apply check written against "7" fails
permanently on a migration that succeeded, and the operator is handed a red result that means
nothing. **Phase 19 therefore specifies the acceptance criterion by name, not by count**: the six
trigger names above must all exist, and the check must enumerate `sqlite_master` rather than compare
an integer.

Why this is disclosed instead of fixed quietly: the mandate says not to reinterpret or downgrade a
Phase 18 finding. This is not a severity change — it is an arithmetic correction to a verification
criterion. The Phase 18 documents have **not** been edited; they are historical evidence, and their
hashes still refer to what was signed off. If the operator wants them annotated, that is a
documentation-only change and is listed in §5.3 as a decision, not performed here.

---

## 4. F-19-02 / F-19-03 — findings established while preparing A2–A8

### 4.1 F-19-02 — the swallow-then-stamp defect is not confined to V11 (Medium, widens A2)

Phase 18 named the V11 catch. Re-reading the whole migration list for the A2 plan found the same
pattern seven times across three migrations:

| Location | Statement | Catch |
|---|---|---|
| [src/state/database.ts:590-594](../src/state/database.ts#L590) | `MIGRATION_V4_ALTER` ×5 (`to_address`, `raw_content`, inbox `status`, `retry_count`, `max_retries`) | unbounded `catch { logger.debug(…skipped…) }` |
| [src/state/database.ts:617](../src/state/database.ts#L617) | `MIGRATION_V9_ALTER_CHILDREN_ROLE` | unbounded `catch { /* column may already exist */ }` |
| [src/state/database.ts:627](../src/state/database.ts#L627) | `MIGRATION_V11` (`ALTER TABLE children ADD COLUMN chain_type`) | unbounded `catch { /* column may already exist */ }` |

All seven discard every error class — lock, disk, syntax, constraint — and control then reaches the
version insert at `:644`, which stamps success for the whole migration. The V4 variants at least log
at debug; V9 and V11 log nothing. The defect is the same one F-18-02 describes, so this is a
**widening of an existing High finding's surface, not a new class**, and A2's blast radius is larger
than Phase 18 implied.

A2 therefore needs a scope decision from the operator (§5.1, A2-scope) rather than a silent choice by
the implementer: fix V11 only, or fix all seven ALTER-guarded catches consistently.

### 4.2 F-19-03 — `netstat` intermittently fails to enumerate the live listener (Low, operational)

Phase 18 reported that the port-8787 listener was "not visible in netstat". Re-measured with a
denominator, because a one-off absence is not actionable:

| Capture method | Captures | Showed `127.0.0.1:8787 … LISTENING` | Positive `/dev/tcp` probe in the same window |
|---|---|---|---|
| `netstat -ano -p tcp \| grep 8787` | 20 (idle, ~0.4 s apart) | **0** | connected, every trial |
| `netstat -ano -p tcp \| grep 8787` | 3 (during an in-flight HTTP request) | **0** (`ESTABLISHED` rows: 4) | connected |
| `netstat -an` / `netstat -ano -p tcp \| grep LISTENING` | 2 captures, minutes earlier | **2 — did show `LISTENING 22936`** | connected |
| `Get-NetTCPConnection -LocalPort 8787 -State Listen` | 1 | **no record** | connected |

So the row is enumerated **sometimes** and missing **usually**, while the socket is provably
accepting connections throughout. The Phase 18 conclusion was right and is now quantified: a socket
table on this host is not a reliable exposure instrument in **either** direction.

Corollary adopted into the corrected documentation ([docs/DASHBOARD_OPERATIONS.md](../docs/DASHBOARD_OPERATIONS.md)
§"Proving reachability"): never infer non-exposure from an empty socket table, never infer exposure
from a row until the owning PID is attributed, and use positive connection probes plus PID
attribution. `HEALTH_CHECK_DASHBOARD.bat` → `dashboard/scripts/status.mjs` already probes rather
than reads a table.

### 4.3 A4 write boundary is a single function (planning fact, no finding)

Both ungated commands funnel through one writer: `saveConfig`
([src/config.ts:180-197](../src/config.ts#L180)), called at
[configure.ts:329,334,339,344](../src/setup/configure.ts#L329) and
[model-picker.ts:80](../src/setup/model-picker.ts#L80). It does a single `writeFileSync` with
`mode: 0o600` and no partial-write path. That makes "validate at the actual write boundary, not only
in the menu" implementable at one choke point instead of five, and it is why the A4 request in
§5.1 is written as a guard inside `saveConfig` plus a menu-level refusal, rather than as prompt-by-prompt
checks.

### 4.4 A6 blast radius is 13 call sites (planning fact, no finding)

`tryAppendSecurityEvent` is called from 13 places, not the 3 modules Phase 18 named:
[tools.ts:3439,3488,3513,3667,3703](../src/agent/tools.ts#L3439) (5),
[mechanic.ts:190,208](../src/reliability/mechanic.ts#L190) (2),
[emergency-stop.ts:144,205](../src/security/emergency-stop.ts#L144) (2),
[tool-authorizer.ts:191](../src/security/tool-authorizer.ts#L191) (1),
[treasury-guard.ts:256,460,515](../src/security/treasury-guard.ts#L256) (3).
Any change to the append contract must be made at all 13 or via a typed result the callers consume —
this is the main cost driver in A6 and is priced into the request rather than discovered mid-edit.

---

### 4.5 F-19-04 — the ignore rules cannot support A7 as written (High, blocks A7)

While checking the §5 exclusion claim, `git add --dry-run` revealed that staging the review-scope
directories commits **~19 411 files that must never be in git, including the live operator token**:
`runtime/.pnpm-store/` (18 628 files — the rule reads `runtime/pnpm-store/` and the directory is
`.pnpm-store`, so it never matched), `runtime/npm-cache/` (783), `dashboard/state/dashboard.token`
(44 B), `dashboard/restore-targets/`, `runtime/model-test-home/.automaton/` (a second state tree;
credentials zero-length, lockdown true — no secret, but it must not be committed either).
Full evidence, the leak table and the proposed remedy in
[PHASE_19_GIT_CHANGE_CONTROL.md](PHASE_19_GIT_CHANGE_CONTROL.md) §4.

This is new, was not in Phase 18, and changes A7's shape: `.gitignore` must be fixed **before** any
staging, and staging must be an explicit allowlist rather than directory-wide.

## 5. Git baseline (F-18-08) — inspected, nothing staged, nothing committed

| Item | Measured |
|---|---|
| Repository | yes; branch `main`; HEAD `d8f8168` ("it's beautiful") |
| Working tree | **40 modified + 35 untracked** paths |
| `docs/` | untracked |
| `dashboard/` | untracked |
| `reports/` | untracked |
| `config/`, `src/` security/runtime additions | untracked |
| `.bat` wrappers (11) | untracked |
| `runtime/home` | **excluded** — `.gitignore:15 runtime/home/`; `git check-ignore -v` confirms both `state.db` and `automaton.json` resolve to that rule |
| Secret scanners available | `gitleaks`, `trufflehog`, `detect-secrets` — **none installed**; A8 must therefore use an in-repo deterministic scan over staged blobs (see §5.1 A8) |

The security layer remains outside version control. A7 is the item that closes it and A7 is
**unapproved**, so no `git add` was run and no commit exists. See
[PHASE_19_GIT_CHANGE_CONTROL.md](PHASE_19_GIT_CHANGE_CONTROL.md) for the exact proposed staging set.

---

## 6. Live-state invariants at the end of this document's work

A1 edited three files under `docs/`. After those edits, re-measured:

```
POST-A1 automaton.json sha256: 1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d
POST-A1 state.db size: 512000 mtime: 2026-10-31T10:25:59.744Z
MATCHES BASELINE: true
```

Every §13 invariant still holds; no prohibited §14 operation was performed; no migration ran; no
credential was entered; no wallet exists; activation remains false; nothing was pushed; the canonical
HOME is unchanged.

Writes made by Phase 19 so far, in full: `docs/WINDOWS_OPERATIONS_GUIDE.md`, `docs/README.md`,
`docs/DASHBOARD_OPERATIONS.md`, and the `reports/PHASE_19_*.md` files. Nothing else.

---

## 7. Recommendation at this point

| Decision | Recommendation | Basis |
|---|---|---|
| A1 documentation corrections | **COMPLETE, verified** | claims searched and gone; hashes recorded; live state byte-identical |
| A2–A8 implementation | **NOT STARTED — no approval recorded** | [PHASE_18_APPROVAL_LIST.md](PHASE_18_APPROVAL_LIST.md) §6 is blank; mandate §2 forbids inferring approval from the prompt |
| A7 git commit | **NOT READY — fix `.gitignore` first (F-19-04)** | directory-wide staging would commit the operator token and ~19 411 store files |
| A9 live V12/V13 migration | **OUTSIDE Phase 19**; and its acceptance criterion must be corrected first (F-19-01) | trigger count is 6, specified by name |
| Dashboard accuracy (F-18-05/06/07) | **NOT STARTED — separate approval required** | mandate §11: do not silently expand scope |
| Agent activation | **NO-GO** | F-18-01/02/03/13 all still open by code |
