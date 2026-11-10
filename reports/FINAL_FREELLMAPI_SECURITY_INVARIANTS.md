# Phase 20 — Final Security Invariants Report

Canonical runtime HOME: `<repo-root>\runtime\home`
Baseline probe: `runtime/tmp/p20-baseline-invariants.log` (UTC `2026-11-04T04:32Z` window)
Close probe: `runtime/tmp/p20-close-invariants.log` from `runtime/tmp/p20-close-probe.mjs`
(`c0d333d2221e415d94815173fe40420bb592aca2eb8a830596981d14a188c633`), UTC `2026-11-04T04:55Z`
Process/schedule probe: `runtime/tmp/p20-no-schedule-no-process.log`, UTC `2026-11-04T05:09:07Z → 05:10:06Z`

## 1. Objective

Prove by re-measurement — not by repeating last phase's numbers — that every §13 invariant still holds
after all Phase 20 activity, that the live database was not touched (§19 step 15), and that Conway made
no change to the FreeLLMAPI tree (§19 step 16).

## 2. Scope

Read-only hash comparison, a read-only SQLite open, a filesystem scan of both trees, and two
identifier-only process/task queries. No configuration write, no migration, no activation, no request.

## 3. Approval reference

Mandate §13 (invariants must remain unchanged) and §19 step 14/15/16. Read-only inspection needs no
approval (§3). The elevated read-only Windows posture check (Phase 19 item **B1**) is still **not
approved and was not run**; nothing here required elevation, and `manage-bde -protectors -get` was never
run (§14).

## 4. Files inspected

`runtime/home/.automaton/automaton.json`, `state.db` (+`-wal`, `+shm`), `config/inference-providers.template.json`,
`runtime/home/.automaton/inference-providers.json`, `src/inference/provider-registry.ts`,
`src/inference/inference-client.ts`, `src/agent/loop.ts`, `src/conway/http-client.ts`, `wallet.json`
(absence check), the FreeLLMAPI tree (`<freellmapi-root>`, metadata
only), plus `reports/PHASE_19_APPROVAL_RECORD.md` and `reports/PHASE_18_APPROVAL_LIST.md` for the
approval state quoted elsewhere.

## 5. Files modified

Only this report, the two probe scripts and their logs in `runtime/tmp/`. **No invariant-bearing file was
modified**, which is the point of the report and is shown in §7.

## 6. Files not modified

`automaton.json`, `state.db`/`-wal`/`-shm`, the template, the deployed provider config, all four
security-relevant source files, `dashboard/**`, and every file of the Conway tree except the additive
test file described in `FINAL_FREELLMAPI_SECURITY_AUDIT.md` §5.

## 7. Before / after hashes

| File | Baseline | Close | Verdict |
|---|---|---|---|
| `runtime/home/.automaton/automaton.json` | `1c10ecc569222aeb3d66b12133ce5a92399115e2636e6178396b2127df4c966d` | identical | unchanged |
| `runtime/home/.automaton/state.db` | `2a8aeb3494f1507a352f591c5ef40b7320813e18796b077b01448582619efbba` | identical | unchanged |
| `config/inference-providers.template.json` | `a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` | identical | unchanged |
| `runtime/home/.automaton/inference-providers.json` | `a126c4e02077ab7deecee585fc0f7019dc91d770b50a645cf573f75646e73855` | identical; **byte-for-byte equal to the template** (§9) | unchanged |
| `src/inference/provider-registry.ts` | `b5542260fbce0a7f4cdc933d5ca6287f7554ed6e8422add5f01b064259f20718` | identical | unchanged |
| `src/inference/inference-client.ts` | `ca0616619fdc3cacea56643123ea968c47c6dd133644e71c01c9fac79c28863c` | identical | unchanged |
| `src/agent/loop.ts` | `e97c18871565541395c3becfdf763b5e0cf9be6e1ac12a888e9883a82a79d83f` | identical | unchanged |
| `src/conway/http-client.ts` | `d9b2fc4cb509af81426e82b349b38d726b48740cbcb82db304c6471859911070` | identical | unchanged |

Recomputed again at `2026-11-04T05:07Z` after all §12 item runs — still identical, so the regression
activity itself mutated nothing.

## 8. RED test evidence

Not applicable: invariants are measured by hash and by read-only query, not by a test-first change.
The nearest analogue is item A of `FINAL_FREELLMAPI_REGRESSION.md` §8 — 13 P-6 obligations red **because
the fix is unapproved**, which is exactly the state this section requires (source untouched).

## 9. GREEN test evidence

The §13 set is green in the sense that every invariant holds, verified by the close probe output quoted
in §14 below. In addition the suite contains invariant-enforcing tests that pass unchanged:
`src/__tests__/runtime/home-guard.test.ts`, `src/__tests__/security-lockdown.test.ts`,
`src/__tests__/security/phase16-live-model-preflight.test.ts` (all green in
`runtime/tmp/p20-regression-items.log`, items F and G, exit 0).

## 10. Regression results

No regression failure was caused by, or concealed from, this section: 88 files / 2 175 tests / 0 failed,
twice, exit 0 (§11 of the regression report).

## 11. Real inference status

`BLOCKED_NO_CREDENTIAL` + `BLOCKED_APPROVAL`. The only outbound connections this phase made were:
(a) TCP connect probes to `127.0.0.1:3001`, `[::1]:3001`, `localhost:3001`, `<host-lan-ip>:3001` and
`127.0.0.1:8787`, each destroyed immediately without sending a byte
(`p20-exposure-probe.mjs:1-4`, read-only observation required by §10), and (b) the redirect experiment's
**own** in-process servers bound to `127.0.0.1` on ephemeral ports (`p20-redirect.log`, last line:
"Both probe servers were bound to 127.0.0.1 on ephemeral ports and are now closed").
No HTTP inference request was sent to any provider. No OpenAI or Groq endpoint was contacted. No
credential was read, copied, exported, printed or stored.

## 12. Fallback status

`MOCK_FALLBACK = VERIFIED` (17 tests, `p20-fallback-tests.log`, exit 0); `REAL_FALLBACK = NOT TESTED`.
No fallback run reached a real provider, so no real provider availability is claimed.

## 13. Invariant-by-invariant result

| §13 invariant | Baseline | Close | Status |
|---|---|---|---|
| `security.lockdown` | `true` | `true` | VERIFIED |
| `security.activationApproved` | `false` | `false` | VERIFIED |
| `security.allowedTools.length` | `0` | `0` | VERIFIED |
| `allowFinancialTools` | `false` | `false` | VERIFIED |
| `allowHostShell` | `false` | `false` | VERIFIED |
| `allowSelfModification` | `false` | `false` | VERIFIED |
| `allowReplication` | `false` | `false` | VERIFIED |
| `allowExternalExposure` | `false` | `false` | VERIFIED |
| `maxChildren` (top level) | `0` | `0` | VERIFIED |
| treasury numeric limits | 9 total, **0 non-zero** | 9 total, **0 non-zero** | VERIFIED |
| `treasuryPolicy.x402AllowedDomains.length` | `0` | `0` | VERIFIED |
| credential fields in config (`conwayApiKey`, `openaiApiKey`, `anthropicApiKey`, `walletAddress`, `sandboxId`) | length `0` each (lengths only, values never read) | length `0` each | VERIFIED |
| `wallet.json` present | `false` | `false` | VERIFIED — no wallet created or funded |
| any transaction | none | none | VERIFIED (§14 item 4/5 never reachable: financial tools off) |
| agent process running | — | `MATCHES` empty for every node.exe; `--run`, `heartbeat`, `agent/loop`, `wallet` flags `False` on all four non-node matches (they are this session's own `bash.exe` probes) | VERIFIED — agent inactive |
| scheduled task | — | `MATCH_COUNT=0` for `conway|automaton|heartbeat` in `schtasks /query` | VERIFIED — none created |
| heartbeat / self-healing / migration runner | inactive | inactive | VERIFIED |
| live schema | **11** (`schema_version` MAX, 10 rows) | **11** | VERIFIED — V12/V13 never applied live |
| V12/V13 tables absent | `treasury_authorizations`, `security_events`, `security_incidents`, `security_seals` | still absent | VERIFIED |
| `CONWAY_ACTIVATION` | unset | unset | VERIFIED |
| `CONWAY_MIGRATION_APPROVAL` / `CONWAY_MIGRATION_ALLOW_CANONICAL` | unset | unset | VERIFIED |
| `FREELLMAPI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` | unset (`length 0`) | unset | VERIFIED — no credential was introduced this phase |
| canonical HOME preserved, process-scoped HOME only | `runtime\home` exists, used read-only | same | VERIFIED — global Windows `HOME` never modified (still `<user-home>` in this shell) |
| migration reports written this phase | 0 | 0 | VERIFIED |

## 14. Live database integrity (§19 step 15)

`state.db` 512 000 B, mtime `2026-10-31T10:25:59.744Z` at both probes; hash `2a8aeb34…efbba` at both.
`-wal` **0 B**, `-shm` **32 768 B**. Read-only open: `PRAGMA integrity_check` → `ok`, 38 tables, schema
11. Post-probe: size unchanged `true`, mtime unchanged `true`.

Two disclosures:
- **`-shm` mtime moves.** Opening the database read-only lets SQLite rebuild the WAL index, so
  `state.db-shm` shows an mtime inside this window (`find … -newermt 2026-11-04` returned exactly that
  one path). Content-affecting facts did not change: db hash, db size, db mtime and `-wal` length are all
  identical. Claiming "no file in the home was touched" would be false; the true claim is "the database
  itself is byte-identical".
- **`PRAGMA user_version` reads 0** while the recorded version lives in the `schema_version` table
  (`MAX(version) = 11`). The first close probe printed `schema 0` from the pragma; the script was
  corrected and re-run, and the current log carries both numbers. Recorded as F-20-10 in the audit —
  historical readings are not overwritten.

**No unexpected live database modification was detected, so §17's stop-and-preserve clause was not
triggered.**

## 15. FreeLLMAPI preservation (§19 step 16)

| Measurement | Baseline | Close |
|---|---|---|
| root exists | `true` | `true` |
| files scanned (excluding `node_modules`, `.git`, `dist`) | 1 529 | 1 555 |
| newest mtime | `2026-11-04T04:32:28.726Z` (`server/data/freeapi.db-wal`) | 11–12 files newer than that baseline |

Conway wrote **nothing** into that tree: no command in this phase targeted it, the only contact was the
TCP connect probe above (no bytes), and the newer files are all FreeLLMAPI's own artefacts —
`docs/reports/*` (Septor output-token and provider-adapter reports), `server/src/db/migrate/defaults.ts`,
a new `20261104_000001_septor_output_tokens.ts` migration, its round-trip test, and FreeLLMAPI's own
backend logs and `freeapi.db-wal`. Attribution: **another process is working in that project
concurrently** (recorded as F-20-09). §10's prohibition was respected — the service was not modified,
restarted, reconfigured, and its env, keys, provider config, database, model settings, routing, port and
Ollama integration were left alone. This report does **not** claim FreeLLMAPI's tree is unchanged; it
claims Conway did not change it, and the concurrent activity is disclosed so no downstream consumer
mistakes one for the other.

## 16. Residual findings

- **F-20-07** (exposure): FreeLLMAPI answers on `<host-lan-ip>:3001` as well as loopback, so it is not
  loopback-bound. Conway cannot fix that and §10 forbids trying. Operator decision.
- **F-20-09** (concurrent external writes into FreeLLMAPI during the audit window): informational here,
  but it means FreeLLMAPI-side facts re-verified in a later phase may differ from this snapshot.
- **F-20-01/02/03/05** remain open because the source change is unapproved; every invariant held, so the
  gap is a *known unfixed hole*, not a regression.
- Nothing in §14's prohibited list occurred: no activation, no `--run`, no wallet creation or funding, no
  transaction, no financial tool, no live V12/V13, no self-healing/replication enablement, no Windows
  service, no scheduled task, no public/LAN exposure of Conway, no firewall/Defender/global-env change,
  no git commit/tag/push, no secret printed.

## 17. Rollback instructions

Three separate categories, per §17.

**A. P-6 source change — nothing to roll back.** No source file was modified; the hashes in §7 prove it.
If a future approved P-6 change must be reverted: restore **only** `src/inference/provider-registry.ts`
and the new `src/inference/provider-url.ts` from the snapshots in §7 of this report (and delete the added
file), then re-run `tsc` and the §12 items. `src/conway/http-client.ts` was never a target and must not
be reverted wholesale, because that would revert unrelated work.

**B. Provider configuration — one file.** Roll back by deleting **only**
`runtime/home/.automaton/inference-providers.json`; the template stays as the reference copy. After
deletion `ProviderRegistry.fromConfig` falls back to the built-in HTTPS defaults, and because ≥1 parsed
provider *replaces* the list (F-20-04), a partial edit is not equivalent to a removal — remove the whole
file or none of it.

**C. Test/report artefacts.** `src/__tests__/inference/freellmapi-fallback.test.ts` is the only shipped-tree
addition (`rm` → 87 files / 2 158 tests). `runtime/tmp/**` (`.gitignore:18`) holds the RED file, the
probes and every `.log` cited here; **delete the logs only after these reports are superseded.**
`dist/**` (`.gitignore:2`) regenerates deterministically from unmodified source.
No credentials were created, so there is nothing to rotate; §17 forbids deleting or rotating any
FreeLLMAPI credential as a rollback step, and this phase did neither.

## 18. Final GO / NO-GO

**GO** on security invariants: all §13 invariants re-measured and unchanged; live schema still V11; no
wallet, no process, no schedule, no credential, no DB mutation.
**NO-GO** on activation readiness — unchanged from Phase 19, and for the same reason: the P-6 URL
validation gap is still open, and it is open because it is unapproved, not because it was fixed and
failed.
