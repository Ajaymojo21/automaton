# SECURITY AUDIT — Phase 9

**Audit date:** 2026-10-31
**Scope:** `<repo-root>` (application + runtime home + backups)
**Posture:** deny-by-default, local-only, financially inert
**Overall audit result:** **PASS** (latest `SECURITY_AUDIT.bat`, exit 0)

> Scope limit: this is a configuration and code-path audit of an **inactive**
> installation. No live agent was run, no penetration test was performed, and no
> claim is made that the upstream project is secure for production or for
> autonomous financial operation.

---

## 1. Threat model

| Threat | Relevance here | Primary control |
|---|---|---|
| Unintended autonomy on start | High — upstream auto-generates a wallet and starts a ReAct loop | Dual-signal activation gate before identity/wallet init |
| Prompt-injected tool use | High — agent reads external content | Empty tool allowlist; injection defence upstream |
| Host compromise via `exec` | High — local mode runs host shell | `allowHostShell:false`; allowlist empty |
| Financial loss | High | Financial category denied; zero treasury; no wallet/funds |
| Self-modification | Medium | `self_mod` category denied |
| Replication / runaway children | Medium | Category denied; `maxChildren:0` |
| External exposure | Medium | Exposure tools denied; no listener |
| Credential leakage | High | No credentials stored; logs scanned for patterns; ACLs |
| Local user data theft | Medium | Single-user ACLs; backups exclude wallet; BitLocker **unverified** |
| Supply chain | Medium | Pinned commit, verified Node archive, frozen lockfile, limited build scripts |

Explicitly **out of scope**: kernel compromise, malicious administrator, physical
access, and vulnerabilities in the upstream codebase beyond the reviewed paths.

---

## 2. Controls implemented

### 2.1 Activation gate

`src/security/activation.ts` + `src/index.ts`.

- `checkActivation()` requires **both** `security.activationApproved === true` in the
  config and `CONWAY_ACTIVATION === "APPROVED"` in the environment.
- `requireActivation()` gates `--init`, `--provision`, `--setup`, and `--run`.
- `run()` no longer launches the setup wizard when config is missing; it refuses.
- The gate is checked **before** `getWallet()`, so an unapproved start cannot create
  a keypair.

**Executed evidence:**

```
$ node dist/index.js --run
ERROR main  Blocked "--run": runtime activation is not approved.
ERROR main  Reason: security.activationApproved is not true in automaton.json
exit code 2
$ test -f runtime/home/.automaton/wallet.json  -> absent
```

### 2.2 Deny-by-default tool policy

`src/agent/policy-rules/lockdown.ts`, registered first in `createDefaultRules()`
with priorities 10–11 so a denial cannot be overridden by a later allow.

| Rule | Category / names | Reason code |
|---|---|---|
| `lockdown.tool_allowlist` | all tools | `TOOL_NOT_ALLOWED` |
| `lockdown.financial` | `financial` | `FINANCIAL_DISABLED` |
| `lockdown.host_shell` | `exec`, `write_file` | `HOST_SHELL_DISABLED` |
| `lockdown.self_modification` | `self_mod` | `SELF_MODIFICATION_DISABLED` |
| `lockdown.replication` | `replication` | `REPLICATION_DISABLED` |
| `lockdown.external_exposure` | `expose_port`, `remove_port`, `register_domain` | `EXTERNAL_EXPOSURE_DISABLED` |

With an empty allowlist, the first rule alone denies every tool.

### 2.3 Spend guards

- Bootstrap `$5` top-up skipped under lockdown unless financial tools are enabled.
- Heartbeat `check_usdc_balance` returns `shouldWake:false` under lockdown.
- Treasury zero limits deny covered transfers; see
  [TREASURY_SECURITY.md](TREASURY_SECURITY.md) for the fields that are **not**
  enforced (`minimumReserveCents`, `transferCooldownMs`) and the tools outside the
  treasury policy (`topup_credits`, replication auto-top-up).

### 2.4 Fail-closed configuration

`normalizeSecurityConfig()` in `src/config.ts`:

- booleans accepted only when exactly `true`;
- allowlist accepts only strings;
- missing/invalid security block becomes `DEFAULT_SECURITY_CONFIG` (locked);
- `loadConfig()` returns `null` on parse failure rather than a partial config.

### 2.5 Filesystem and secrets

| Control | Evidence |
|---|---|
| `runtime/home` ACL | `<host-name>\<windows-user>:(OI)(CI)(F)` only |
| `backups` ACL | same single-user FullControl |
| Wallet file | absent; backups exclude it by design |
| Config credentials | all empty strings |
| Logs | scanned for OpenAI/EVM/JWT patterns; none found |
| Config writes | app uses mode `0600` |
| Backup config | credential-shaped keys redacted (`automaton.redacted.json`) |

BitLocker/device encryption status: **not verified** — the query returned
"Access denied". Do not assume disk encryption protects the wallet or config at rest.

### 2.6 Network

- No Automaton listener. `security-audit.mjs` inspects `netstat` for listeners owned
  by the runtime PID and would flag `0.0.0.0` / `[::]`.
- No firewall rule, port forward, tunnel, or public exposure was configured.
- `conwayApiUrl` is the only outbound target in the default config and no key exists.

### 2.7 Build and supply chain

- Commit pinned: `d8f816881fd24b6f5e3d616e59edec387a447667`.
- Portable Node archive hash matched `SHASUMS256.txt`.
- `pnpm install --frozen-lockfile`; install scripts limited to `better-sqlite3` and
  `esbuild`.
- Overrides: `yaml 2.8.3`, `js-yaml 3.15.2`.
- Upstream CI does not gate on `pnpm audit` (`|| true`); audit findings must be
  tracked manually.

---

## 3. Audit evidence (latest run)

From `reports/security-audit-latest.json` (2026-10-31T11:03:47Z), exit 0:

| Finding ID | Detail |
|---|---|
| `security.lockdown` | lockdown enabled |
| `security.activation` | `activationApproved=false` (expected at rest) |
| `security.allowedTools` | allowlist empty (all tools denied) |
| `wallet.present` | no wallet file |
| `db.integrity` | `quick_check ok` |
| `db.policy_denials` | 0 denied tool calls recorded (agent never ran) |
| `logs.secret` | no credential patterns found in logs |
| `network.listeners` | automaton not running |
| `activation.env` | `CONWAY_ACTIVATION` token absent |

Health check from the same timestamp: **PASS** (process not running expected,
config found, lockdown enabled, 0 allow-listed tools, no wallet, DB ok,
220.1 GB free, logs directory present, activation token absent).

### 3.1 Test evidence

| Test scope | Result |
|---|---|
| `src/__tests__/security-lockdown.test.ts` | **16/16 passed** (re-run 2026-10-31 16:37 local) |
| TypeScript `tsc --noEmit` | exit 0 |
| Security-related batch (prior run) | 426 passed / 21 failed — failures are Windows path/platform assumptions in upstream tests, not security assertions |
| Full suite (prior run) | 1,380 passed / 22 failed across 58 of 65 files; one file hangs (`context-hardening`), one harness file 4/5 |

The 16 security tests cover the activation matrix, fail-closed normalisation,
allowlist behaviour, and each lockdown capability rule.

---

## 4. ACL incident (must read before changing permissions)

During hardening, an `icacls` command with `/inheritance:r` and a grant string that
did not correctly quote the username (`<windows-user>`, containing a space)
produced an **empty DACL**. Read access to `runtime/home` and `backups` was lost
("Permission denied").

**Repair:** granted the correctly quoted principal per file:

```
icacls "<file>" /grant "<windows-user>:F"
```

then iterated every file under both trees. Final ACL is a single FullControl ACE for
the current user, verified by `icacls` above.

**Lesson:** never apply `/inheritance:r` to a tree without first verifying the exact
principal string and testing on one file. Use the full `DOMAIN\user` form. Do not
"fix" an ACL problem by granting `Everyone` or `BUILTIN\Users`.

---

## 5. Consolidated residual risk register

| ID | Risk | Severity | Current mitigation | Residual |
|---|---|---|---|---|
| R-S1 | GitHub org not verified; provenance corroborated, not signed | Medium | Commit pinned; source reviewed | Accept |
| R-S2 | Dev-toolchain advisories (vitest/vite) | Low | Dev-only; no dev server exposed | Accept |
| R-S3 | `simple-git` 3.30.0 critical advisories installed | Medium | Unused; tool not allow-listed | Accept while inactive; remove/upgrade before activation |
| R-S4 | Post-release `main` snapshot, not a signed release | Medium | Pinned commit | Accept |
| R-S5 | Windows unsupported upstream | High | Local-only, lockdown, no shell tool | Accept for supervised use only |
| R-S6 | Transitive advisory fixes need overrides | Medium | yaml/js-yaml overrides applied | Re-audit after updates |
| R-W1 | Wallet key stored unencrypted at rest | High (if funded) | No wallet; ACL; manual encrypted backup required | Must address before funding |
| R-T1 | `topup_credits` not covered by treasury policy | High (if financial enabled) | Financial category denied | Must address before enabling financial tools |
| R-T2 | Replication auto-top-up bypasses treasury policy | High (if replication enabled) | Replication category denied; `maxChildren:0` | Keep replication off |
| R-T3 | x402 hourly/daily envelope ineffective (spend recorded as 0) | Medium | Per-payment cap + empty domain allowlist | Rely on per-payment cap |
| R-T4 | `minimumReserveCents` and `transferCooldownMs` are no-ops | Medium | Zero limits block positive transfers | Do not rely on these fields |
| R-T5 | `quarantine` has no human approval channel; it is a hard block | Low | Behaviour is fail-closed | Documented |
| R-P1 | Full test suite does not complete cleanly on Windows | Low | Security suite passes; platform failures documented | Accept |
| R-P2 | BitLocker/device encryption unverified | Medium | ACLs | Verify before storing secrets |

---

## 6. What is *not* proven

To avoid overstating the audit:

- No live agent turn was executed (activation is closed), so runtime behaviour under
  a real model has not been observed.
- No external penetration test, fuzzing, or adversarial prompt suite was run.
- No long-duration soak test of the heartbeat or memory usage was performed.
- BitLocker status could not be read.
- Upstream tests are not Windows-compatible in full; "1,380 passed" is not the same
  as "the suite is green".

These are stated as blockers to any claim of production readiness.

---

## 7. Phase verdict

**COMPLETE — HARDENED FOR INACTIVE USE.** The installation is deny-by-default,
local-only, and financially inert. Critical controls (activation gate, empty
allowlist, financial denial, no wallet, no credentials) were verified by execution,
not inferred. Production readiness is **not** claimed.
