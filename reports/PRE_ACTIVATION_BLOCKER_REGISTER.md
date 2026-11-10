# Pre-Activation Readiness Audit — Blocker Register

## Blockers

### B-1 — Database at V11, code expects V13
- **Severity:** CRITICAL
- **Description:** The live database is at schema V11 while the code expects V13. Four tables
  (`treasury_authorizations`, `security_events`, `security_incidents`, `security_seals`) are absent.
  The audit chain cannot be verified.
- **Evidence:** `demo-db.json` (liveUserVersion=0, liveSchemaVersion=11, codeSchemaVersion=13, 38 tables,
  37 empty); health guardian `audit_chain: fail (no such table: security_events)`.
- **Impact:** No audit trail, no treasury authorization tracking, no incident/seal records.
- **Root cause:** Migrations V12/V13 have never been applied to the production database.
- **Remediation:** Take a backup, run `--migrate-schema` with `CONWAY_MIGRATION_APPROVAL=APPROVED`
  and `CONWAY_MIGRATION_ALLOW_CANONICAL=APPROVED`, verify integrity, re-run health guardian.
- **Test evidence:** Migration tested on disposable copy: V11→V13, 4 tables/12 indexes/6 triggers/50 columns,
  integrity ok.
- **Remaining risk:** Rollback is not supported; operator must take a backup first.
- **Operator approval required:** YES (migration approval env vars).

### B-2 — No approval surface for `requires_approval` repairs
- **Severity:** HIGH
- **Description:** The mechanic classifies repairs as `requires_approval`, but no queue, UI, CLI, or
  record type exists for an approval decision. Such repairs can only sit unexecuted.
- **Evidence:** `mechanic.ts` returns `pending: 0`; no approval table or endpoint exists.
- **Impact:** Self-healing cannot progress beyond `automatic` repairs.
- **Root cause:** Feature not implemented.
- **Remediation:** Design and implement an approval queue with operator-facing review.
- **Test evidence:** `runMechanic` refuses with `skippedReason` (tested).
- **Remaining risk:** None — the system fails closed.
- **Operator approval required:** YES (design decision).

### B-3 — Real inference never tested
- **Severity:** HIGH
- **Description:** No credential present; no real inference request made. Latency, cost, model
  identity, and answer quality are all NOT MEASURED.
- **Evidence:** `FREELLMAPI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` all ABSENT; FreeLLMAPI probe
  returned 401.
- **Impact:** Cannot verify the inference layer end-to-end.
- **Root cause:** No credential supplied; no explicit authorisation given.
- **Remediation:** Supply credential via process env, obtain explicit authorisation, run with spend ceiling.
- **Test evidence:** Mock inference: 3 files / 94 tests / 0 failures.
- **Remaining risk:** None — the system fails closed (401 → non-retryable → surfaced).
- **Operator approval required:** YES (credential + authorisation).

### B-4 — F-1 latent risk in non-locked-down configs
- **Severity:** MEDIUM
- **Description:** Under lockdown, all treasury limits are now zero (remediated). But
  `DEFAULT_TREASURY_POLICY` retains non-zero defaults for the three extra keys, so a manually
  constructed non-locked-down config would inherit them.
- **Evidence:** `types.ts` DEFAULT has 100000/200000/50000; `normalizeSecurityConfig` forces lockdown=true
  via config file, so the only path is programmatic construction.
- **Impact:** Low in practice (lockdown is always true via config), but the default is not fail-closed.
- **Root cause:** DEFAULT represents non-locked-down production defaults.
- **Remediation:** Either zero the three keys in DEFAULT, or document that non-locked-down configs
  must explicitly set them.
- **Test evidence:** `f1-treasury-fail-closed.test.ts` (9 tests) verifies lockdown path.
- **Remaining risk:** Low.
- **Operator approval required:** NO (code-level decision).

### B-5 — Failover classifier narrow
- **Severity:** MEDIUM
- **Description:** Only 429/500/503 walk the provider order. Timeout, connection error, 401, and
  empty-200 abort the tier without failover.
- **Evidence:** `inference-client.ts:413-416` (`isRetryableError`); characterisation tests.
- **Impact:** Provider failures outside the retryable set are not survivable.
- **Root cause:** Design decision (documented behaviour).
- **Remediation:** Widen `isRetryableError` if resilience is required; re-baseline tests.
- **Test evidence:** 17 fallback tests, all passing.
- **Remaining risk:** None — behaviour is documented and tested.
- **Operator approval required:** NO.

### B-6 — No telemetry baseline
- **Severity:** LOW
- **Description:** No uptime, success rate, latency, or accuracy series exists. Any performance
  claim would be invented.
- **Evidence:** No telemetry exporter in the codebase; `metric_snapshots` table empty.
- **Impact:** Cannot measure or compare performance.
- **Root cause:** Feature not implemented.
- **Remediation:** Add a metrics collection and reporting layer.
- **Test evidence:** N/A.
- **Remaining risk:** None.
- **Operator approval required:** NO.

### B-7 — 37 of 38 tables empty
- **Severity:** INFORMATIONAL
- **Description:** Only `schema_version` holds rows. The system has never executed a turn.
- **Evidence:** `demo-db.json` (populatedTables: schema_version only).
- **Impact:** None — expected for an unaudited system.
- **Root cause:** System never activated.
- **Remediation:** N/A — this is the expected state.
- **Test evidence:** N/A.
- **Remaining risk:** None.
- **Operator approval required:** NO.

### B-8 — No approval surface for repairs
- **Severity:** HIGH
- **Description:** Same as B-2 (duplicate entry for tracking).
- **Evidence:** `mechanic.ts` returns `pending: 0`.
- **Impact:** Self-healing cannot progress.
- **Root cause:** Feature not implemented.
- **Remediation:** Implement approval queue.
- **Test evidence:** Mechanic refusal tested.
- **Remaining risk:** None — fails closed.
- **Operator approval required:** YES.

### B-9 — Endpoint URL validation gap (SSRF)
- **Severity:** MEDIUM
- **Description:** Operator-set endpoint URLs (`conwayApiUrl`, `ollamaBaseUrl`) are not validated
  against private-IP blocklists.
- **Evidence:** `src/index.ts` uses `config.conwayApiUrl` directly; no validation step.
- **Impact:** If config is attacker-controlled, SSRF possible.
- **Root cause:** Not implemented.
- **Remediation:** Add P-6-style URL validation for operator-set endpoints.
- **Test evidence:** N/A.
- **Remaining risk:** Low (config is operator-controlled).
- **Operator approval required:** NO.

### B-10 — Backup manifests may include wallet files
- **Severity:** LOW
- **Description:** Backup manifests include file lists; if a wallet file existed, it would be included.
- **Evidence:** `backup-verify.test.ts` checks manifest integrity, not content redaction.
- **Impact:** Potential key material in backups.
- **Root cause:** No exclusion list for sensitive files.
- **Remediation:** Add wallet file exclusion to backup manifest generation.
- **Test evidence:** Not tested.
- **Remaining risk:** Low (no wallet exists currently).
- **Operator approval required:** NO.
