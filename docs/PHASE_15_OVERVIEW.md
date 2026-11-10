# Phase 15 — Security Remediation: Overview and Residual Risks

**Scope:** production-grade security remediation and autonomous reliability for the
isolated Conway Automaton install at `<repo-root>` (upstream v0.2.1,
commit `d8f816881fd24b6f5e3d616e59edec387a447667`).
**Completed:** 2026-10-31, checkpoints 15A–15M. Closure re-verification 2026-11-01 10:55 IST.
**Final status:** **B — PHASE 15 PARTIALLY COMPLETE, RESIDUAL RISKS DOCUMENTED.**

This is the entry point. Read it first, then the specific control document. Every claim
here is backed by an executed check in [`../reports/`](../reports); nothing is asserted
from configuration alone.

---

## What Phase 15 changed

Phase 14 delivered a working, isolated installation. Phase 15 started from the premise
that **installation success is not production security**, re-audited the source without
trusting earlier conclusions, and closed the gaps it found.

| Sub-phase | Deliverable | Control document | Evidence |
|---|---|---|---|
| 15A | Fresh gap audit — 24 gaps, 9 carried over from Phase 14 | this document | `reports/PHASE_15_GAP_ANALYSIS.md` |
| 15B | Encrypted wallet storage at rest | [PHASE_15_WALLET_ENCRYPTION.md](PHASE_15_WALLET_ENCRYPTION.md) | `…/PHASE_15_WALLET_ENCRYPTION.md` |
| 15C | Centralized treasury enforcement | [PHASE_15_TREASURY_ENFORCEMENT.md](PHASE_15_TREASURY_ENFORCEMENT.md) | `…/PHASE_15_TREASURY_ENFORCEMENT.md` |
| 15D | Capability-based tool permissions, default deny | [PHASE_15_TOOL_PERMISSIONS.md](PHASE_15_TOOL_PERMISSIONS.md) | `…/PHASE_15_TOOL_SECURITY.md` |
| 15E | Agent sandboxing | [PHASE_15_SANDBOX.md](PHASE_15_SANDBOX.md) | `…/PHASE_15_SANDBOX_SECURITY.md` |
| 15F | Health guardian + bounded autonomous mechanic | [PHASE_15_SELF_HEALING.md](PHASE_15_SELF_HEALING.md) | `…/PHASE_15_SELF_HEALING.md` |
| 15G | Incident response and emergency stop | [PHASE_15_INCIDENT_RESPONSE.md](PHASE_15_INCIDENT_RESPONSE.md) | `…/PHASE_15_INCIDENT_RESPONSE.md` |
| 15H | Windows host posture (read-only) | [PHASE_15_WINDOWS_SECURITY.md](PHASE_15_WINDOWS_SECURITY.md) | `…/PHASE_15_WINDOWS_SECURITY.md` + `…_POSTURE_RAW.txt` |
| 15I | Adversarial testing, 7 classes / 54 cases | [PHASE_15_PENETRATION_TESTING.md](PHASE_15_PENETRATION_TESTING.md) | `…/PHASE_15_PENETRATION_TEST.md` |
| 15J | Bounded soak / reliability | [PHASE_15_SOAK_TESTING.md](PHASE_15_SOAK_TESTING.md) | `…/PHASE_15_SOAK_TEST.md` + `…_SOAK_RAW.json` |
| 15K | Backup and restore validation | [PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md) | `…/PHASE_15_BACKUP_TEST.md` + `…_BACKUP_RAW.json` |
| 15L | Regression and acceptance, full suite green | this document | `…/PHASE_15_REGRESSION_ACCEPTANCE.md` |
| 15M | Documentation | all of the above | `reports/PHASE_15_PROGRESS.md` |

Continuous checkpoint log, including two retracted claims and their corrections:
[`../reports/PHASE_15_PROGRESS.md`](../reports/PHASE_15_PROGRESS.md).

---

## Gaps closed, by the original gap id

| Gap | What it meant | Where it stands |
|---|---|---|
| G-01 | private key in plaintext `wallet.json` | **closed** — AES-256-GCM envelope, scrypt KDF, AAD-bound metadata |
| G-02 | `minimumReserveCents` declared, never enforced | **closed** — enforced in `TreasuryGuard.authorize` |
| G-03 | `transferCooldownMs` never read at runtime | **closed** — enforced |
| G-04 | `topup_credits` and replication auto-top-up bypassed treasury | **closed** — both out-of-band purchases now go through the guard |
| G-10 | no monthly spending window | **closed** |
| G-11 | no per-agent / per-child budget | **closed** |
| G-12 | check-then-spend race | **closed** — reserve/commit/release inside one `immediate()` transaction |
| G-13 | no replay or duplicate prevention | **closed** — idempotency key, seen-before denies |
| G-14 | x402 spend recorded as 0 cents | **closed** |
| G-16 | policy skipped when no engine/context supplied | **partially closed** — the loop always supplies context (F8); the engine parameter is still optional (F7, see residual R-3) |
| G-17 | Windows path confinement compared with `"/"` | **closed** — `confineToRoot` uses `path.relative` + realpath |
| G-18 | no symlink/junction escape check on writes | **closed** |
| G-05 | no live agent execution ever ran | **not closed by design** — activation gates stay shut |
| G-06 | no penetration test | **closed** — 54 adversarial cases |
| G-07 | no soak test | **closed** — 3 000-iteration bounded soak |
| G-08 | BitLocker status unverified | **still unverified** — needs elevation (R-1) |
| G-09 | 21–22 Windows test failures, suite hang | **closed** — 1 913/1 913, suite terminates |

---

## Residual risks — read these before activating

**R-1 · Disk encryption, TPM and Secure Boot are unverified.**
`Get-BitLockerVolume` returns *Access denied* for a non-administrator, and the same for
TPM ownership and Secure Boot state. They are recorded as **UNVERIFIED**, not as passed.
You must run `manage-bde -status` once from an elevated prompt. Do **not** run
`manage-bde -protectors -get` — that reveals recovery keys, which this project never
retrieves, displays or stores.

**R-2 · Restore is proved structurally, not against real data.**
A live database does exist — `runtime/home/.automaton/state.db`, which is where the `.bat`
wrappers point `HOME` — but it is schema V11 and its only non-empty table is `schema_version`;
the Phase 15 tables (V12 `treasury_authorizations`, V13 `security_incidents`/`security_seals`)
have never been applied to it because the remediated build has not run. The only archive that
could be validated is likewise nearly empty. So the restore mechanism, the V10→V13 migration,
chain verification and integrity checks all work — but **no real user data has been demonstrated
surviving a restore**. Re-run `scripts/phase15-backup-validate.ts` after the first real cycle.
Its `livePathsUntouched` verdict also had to be fixed first; see
[PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md) §4.

**R-3 · `policyEngine` is still an optional parameter in `executeTool`.**
A caller that omits it skips the policy layer; treasury, authorizer and sandbox still
apply. All call sites in the repository do pass it, and a test pins what survives without
it. Making it required is a signature change across the dispatch surface, deliberately not
taken under a closed activation gate.

**R-4 · The sandbox is application-level, not an OS sandbox.**
No job object, no syscall restriction, no capability drop, because that needs
administrator rights. `isProtectedPath`/`confineToRoot` stop accidental and casual
escapes, not a determined attacker who already has code execution in the process.

**R-5 · Self-healing is inert by design.** `security.selfHealingEnabled` defaults to
`false` and normalization accepts only the literal `true`. Until you opt in, the mechanic
performs nothing, automatic or approval-gated.

**R-6 · Session spend tracking can fail open after commit (F5).** Accepted, not fixed:
the alternative — treating a commit as unspendable — is worse. Compensated by the DB-side
caps and the audit chain.

**R-7 · Both 15L product fixes are unverified on POSIX.** The protected-path resolution
and the token-estimation window were developed and measured on Windows. The POSIX branch
of the new platform test has never executed anywhere.

**R-8 · One load-dependent test timeout exists.** `heartbeat.test.ts` exceeded the 30 s
default once in two full-suite runs and passed 4/4 executions in isolation. `testTimeout`
was left at the default on purpose; a saturated machine can trip it again.

**R-9 · Nothing here has ever run against a live model.** No provider credential is
configured, so every control was tested through mocks and the real dispatch path, not
through a real ReAct turn. A model that behaves unexpectedly is untested territory.

**R-10 · Every `~` path in the config resolves through `HOME`, not the Windows profile.**
`resolvePath()` ([`../../src/config.ts:201`](../src/config.ts#L201)) is
`process.env.HOME || "/root"`. The `.bat` wrappers set `HOME` to `runtime\home`, which is what makes
this install isolated. Launch the same binary from an ambient shell with no `HOME` and every
`~`-relative path — database, config, heartbeat, skills, wallet, emergency-stop marker — lands
under `C:\root\.automaton\`, a *different* state tree than the one you are auditing. This bit the
Phase 15K validator (see [PHASE_15_BACKUP_VALIDATION.md](PHASE_15_BACKUP_VALIDATION.md) §4) and it
will bite any manual command you run outside the wrappers. Always set
`HOME=<repo-root>\runtime\home`, or use the `.bat` entry points.

---

## What was not touched

No wallet created or funded · no credits purchased · no API credential entered · no
blockchain transaction · no autonomous execution activated · no replication enabled · no
public endpoint · no Windows service or scheduled task installed · no Windows security
setting changed · no firewall rule added or removed · no recovery key retrieved,
displayed or stored · `activationApproved` still `false` · `CONWAY_ACTIVATION` and
`CONWAY_ALLOW_WALLET_CREATION` still unset · `maxChildren` still `0`.

OmniRoute/OmniRoad, FreeLLMAPI, Ollama, OpenCode, Qoder global configuration, existing MCP
servers, TradingAgents, ADRE-RN and Paperclip AI were not read for secrets or modified.
Two Phase 15 findings concern FreeLLMAPI and the host network and are reported, **not**
remediated, because they are outside Conway's ownership — see
[PHASE_15_WINDOWS_SECURITY.md](PHASE_15_WINDOWS_SECURITY.md).

## Why status B and not A

A claims "security remediation verified". Two verification targets could not be reached
from this account (R-1), one was only half-proved (R-2), one known bypass path remains
open by choice (R-3), and no control has ever faced a live model (R-9). Passing 1 913
tests and 54 adversarial cases is evidence the controls work as designed; it is not
evidence of zero vulnerabilities.
