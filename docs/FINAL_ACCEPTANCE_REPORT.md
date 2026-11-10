# FINAL ACCEPTANCE REPORT — Phase 14

**Project:** Conway Automaton — isolated Windows installation
**Install root:** `<repo-root>`
**Source:** `Conway-Research/automaton` @ `d8f816881fd24b6f5e3d616e59edec387a447667` (MIT)
**Report date:** 2026-10-31
**Final status:** **INSTALLED — ACTIVATION REQUIRES APPROVAL**

---

## 1. Acceptance summary

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | No protected environment modified | PASS | Environment audit; no changes to Ollama, FreeLLMAPI, OpenCode, Qoder, MCP, other projects, services, or startup |
| 2 | Source verified and pinned | PASS | [ENVIRONMENT_AUDIT](ENVIRONMENT_AUDIT.md), [SOURCE_VERIFICATION](SOURCE_VERIFICATION.md) |
| 3 | Isolated installation | PASS | Portable Node 22.23.4, project-local `HOME`, no system-wide packages |
| 4 | Dependencies installed safely | PASS | Frozen lockfile, limited build scripts, yaml/js-yaml overrides |
| 5 | Build succeeds | PASS | `tsc --noEmit` exit 0; `dist/` artifacts present |
| 6 | AI providers configured | PASS (placeholders) | No credential entered; routing documented |
| 7 | No production wallet imported | PASS | No `wallet.json`; zero address |
| 8 | No wallet created or funded | PASS | Verified absence; three gates |
| 9 | No real transactions | PASS | None executed; no funds |
| 10 | Spending disabled and verified in code | PASS | Lockdown financial rule; bootstrap/heartbeat guards |
| 11 | Treasury limits documented honestly | PASS | Enforced vs no-op matrix in [TREASURY_SECURITY](TREASURY_SECURITY.md) |
| 12 | Deny-by-default hardening | PASS | Empty allowlist; capability rules; activation gate |
| 13 | Local-only networking | PASS | No listener, no tunnel, no firewall change |
| 14 | Windows security controls intact | PASS | Defender/Firewall/SmartScreen untouched |
| 15 | Monitoring operational | PASS | Health and audit reports generated, both PASS |
| 16 | Backup and restore verified | PASS | Hash manifest, `quick_check ok`, disposable restore test |
| 17 | Operational scripts present | PASS | All seven `.bat` files |
| 18 | Documentation complete | PASS | This directory |
| 19 | No secrets in source/config/logs | PASS | Audit scan; all key fields empty |
| 20 | No automatic startup / service | PASS | None created |

---

## 2. Verification evidence (executed, not inferred)

| Check | Command | Observed result |
|---|---|---|
| Node runtime | `node --version` | `v22.23.4` |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | exit `0` |
| Security tests | `vitest run src/__tests__/security-lockdown.test.ts` | **16/16 passed** |
| Activation gate | `node dist/index.js --run` (flag false, env unset) | exit `2`, explicit block message |
| Wallet absence | `ls runtime/home/.automaton/wallet.json` | No such file |
| Status | `node dist/index.js --status` | exit `0`, state `setup`, 0 turns/children |
| Health | `node runtime/bin/health-check.mjs` | **PASS**, report written |
| Security audit | `node runtime/bin/security-audit.mjs` | **PASS**, report written |
| Backup | `node runtime/bin/backup.mjs` | 512,000-byte DB snapshot, SHA-256 manifest |
| Restore | `restore.mjs --from … --to runtime/tmp/restore-test` | hashes verified, `quick_check ok` |
| ACLs | `icacls runtime\home`, `icacls backups` | single user FullControl only |
| Listener | audit `netstat` filter | no Automaton listener |
| Logs | audit pattern scan | no credential patterns |

**Test-suite caveat:** the complete upstream suite does not finish cleanly on Windows
(1,380 passed / 22 failed in the broad run; `context-hardening` hangs; 21–22 failures
are POSIX-path assumptions). The security-specific suite passes. The project is not
claimed to have a green full suite.

---

## 3. Deliverables

### 3.1 Required scripts (all present, project root)

- `START_CONWAY.bat` — supervised start, two confirmations, preflight
- `STOP_CONWAY.bat` — PID-validated stop
- `RESTART_CONWAY.bat`
- `HEALTH_CHECK.bat`
- `BACKUP_CONWAY.bat`
- `OPEN_CONWAY_LOGS.bat`
- `SECURITY_AUDIT.bat`

### 3.2 Required documentation (all present in `docs/`)

`README.md`, `INSTALLATION_REPORT.md`, `ENVIRONMENT_AUDIT.md`,
`SOURCE_VERIFICATION.md`, `AI_CONFIGURATION.md`, `AGENT_CONFIGURATION.md`,
`SECURITY_AUDIT.md`, `WALLET_SECURITY.md`, `TREASURY_SECURITY.md`,
`MONITORING_GUIDE.md`, `BACKUP_RECOVERY.md`, `WINDOWS_OPERATIONS_GUIDE.md`,
`TROUBLESHOOTING.md`, `FINAL_ACCEPTANCE_REPORT.md`.

Supporting artifacts: `config/automaton.template.json`,
`config/heartbeat.template.yml`, `runtime/bin/*.mjs` (preflight, health, audit,
backup, restore, rotate, stop), `reports/*.json`, `backups/2026-10-31_10-27-31/`.

---

## 4. Security posture

| Control | State |
|---|---|
| Activation (config + env) | Closed |
| Tool allowlist | Empty — all tools denied |
| Financial tools | Denied |
| Host shell / file write | Denied |
| Self-modification | Denied |
| Replication | Denied; `maxChildren: 0` |
| External exposure | Denied; no listener |
| Wallet | Absent |
| Provider credentials | Absent |
| Treasury | All zero; two fields not enforced (documented) |
| ACLs | Single-user FullControl |
| Backups | Redacted, wallet excluded |
| BitLocker | **Unverified** |

Residual risks R-S1…R-S6, R-W1, R-T1…R-T5, R-P1…R-P2 are recorded in
[SECURITY_AUDIT.md](SECURITY_AUDIT.md#5-consolidated-residual-risk-register).

---

## 5. Actions awaiting explicit human approval

None of these may be performed automatically:

| # | Action | Why approval is required |
|---|---|---|
| A1 | Set `activationApproved: true` and run the agent | Enables autonomy |
| A2 | Create a new experimental wallet | Generates a private key on disk |
| A3 | Fund a wallet / buy credits | Spends real money |
| A4 | Enter Conway/OpenAI/Anthropic keys | Credential entry and potential spend |
| A5 | Populate the tool allowlist | Grants capabilities |
| A6 | Enable financial tools / set nonzero treasury | Financial risk; see R-T1/R-T2 |
| A7 | Enable replication | Spawns children, bypasses treasury policy |
| A8 | Enable external exposure / tunnels / port forwarding | Network exposure |
| A9 | Install a service or startup entry | Persistence |
| A10 | Modify Windows security settings | Prohibited by task rules |

**No spending permission has been granted. Installation permission was not treated
as financial permission.**

---

## 6. Classification rationale

The requested final statuses were:

- `COMPLETE — SECURITY VERIFIED`
- `INSTALLED — ACTIVATION REQUIRES APPROVAL`
- `PARTIALLY COMPLETE — BLOCKERS DOCUMENTED`
- `FAILED — ROOT CAUSE DOCUMENTED`

**Selected: `INSTALLED — ACTIVATION REQUIRES APPROVAL`.**

Reasoning:

- The installation, build, hardening, monitoring, backup, restore, scripting, and
  documentation are complete and verified.
- The system is intentionally not activated: no wallet, no credentials, no tool
  allowlist, no financial capability, no external exposure.
- `COMPLETE — SECURITY VERIFIED` is **not** claimed because: the live agent has never
  run, no penetration test or soak test was performed, the full upstream suite is not
  green on Windows, BitLocker is unverified, and known upstream gaps remain
  (unencrypted wallet-at-rest, treasury fields that are no-ops, tools outside treasury
  policy).
- No blocker prevented the installation itself; activation is a deliberate human
  decision, not an installation failure.

---

## 7. How to proceed

1. Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) §5 and
   [TREASURY_SECURITY.md](TREASURY_SECURITY.md) §2 before granting any capability.
2. Decide the AI provider and approve credential entry, or leave inference unconfigured.
3. Decide whether to create a new experimental wallet (never the primary wallet).
4. If activating: set the config flag, run `START_CONWAY.bat`, type `APPROVED`, then
   grant capabilities one at a time and re-audit after each change.
5. Keep `BACKUP_CONWAY.bat` in the operating routine and back up `wallet.json`
   manually to encrypted storage if one is ever created.

---

**FINAL STATUS: INSTALLED — ACTIVATION REQUIRES APPROVAL**
