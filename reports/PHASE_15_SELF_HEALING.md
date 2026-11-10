# Phase 15F — Health Guardian and Bounded Autonomous Mechanic

Date: 2026-10-31 · Install: `<repo-root>` (v0.2.1, commit `d8f8168`)
Status: implemented and unit-verified. **Self-healing is disabled in the live install.**

## Objective

Give the automaton a read-only health view of itself, and a mechanic that can
perform only a small, pre-classified set of maintenance repairs — never anything
that touches money, keys, permissions, or security controls.

## Components

| File | Role |
| --- | --- |
| `src/reliability/health-guardian.ts` | Eight read-only checks producing a `HealthReport` (`ok` / `degraded` / `critical`). Writes nothing. |
| `src/reliability/mechanic.ts` | Repair classifier and bounded executor. Three-way classification: `automatic`, `requires_approval`, `forbidden`. |
| `src/security/emergency-stop.ts` | Fail-safe marker + audit-trail state; engaged stop blocks heartbeat ticks and tool dispatch. |
| `src/security/audit-chain.ts` (`appendSecuritySeal`, `verifySeals`) | Append-only seals that anchor the chain head hash at a known sequence. |
| `src/heartbeat/tasks.ts` (`health_guardian`) | Builtin task that runs the guardian and mechanic each interval and stores the report in KV. |
| `src/types.ts`, `src/config.ts` | `security.selfHealingEnabled` (default `false`, opt-in only; normalization refuses any value but literal `true`). |

## Health checks

`emergency_stop`, `database_integrity` (`PRAGMA quick_check`), `schema_version`
(against `SCHEMA_VERSION` 13), `audit_chain` (chain + seal verification),
`treasury_reservations` (reserved longer than 10 minutes), `scheduler_leases`
(expired leases), `disk_space` (warn under 10 % free, fail under 3 %),
`wallet_storage` (fails if the wallet file exposes plaintext key material;
passes on an AES-256-GCM/scrypt envelope; reports only field **names**, never values).

The emergency-stop check reads two independent sources: the marker file under the
automaton directory and the audit trail (`system.emergency_stop` vs
`system.emergency_stop_cleared`). Either one engaged reports `fail`.

## Repair classification

Automatic (idempotent, no security or financial effect):
`prune_expired_leases`, `prune_dedup_keys`, `rotate_audit_seal`.

Requires a human: `release_stale_treasury_reservations`, `vacuum_database`,
`reencrypt_wallet`, `refresh_wallet_backup`, `investigate_audit_tamper`.

Forbidden — the mechanic will not accept these identifiers at all, and any
unknown identifier falls into this class by default:
anything matching wallet key material, private key / seed / mnemonic, financial
limits or treasury policy, authorising or signing transactions, disabling audit /
sandbox / security / authorization / lockdown / monitoring, granting permissions
or capabilities, replication or child spawning, exposing ports or tunnels,
changing Defender / Firewall / BitLocker / Windows security, ACL manipulation
(`icacls`, `takeown`), or credentials and API keys.

## Execution gates

`runMechanic` returns without touching anything unless **all** hold:

1. no emergency stop engaged (marker or audit trail),
2. `security.selfHealingEnabled === true` (or a human-run command passes `allowRepairs`),
3. the repair is classified `automatic`.

Financial and integrity findings are queued in `pendingApproval` instead of
executed. A seal is written only when the chain still verifies; a broken chain
queues `investigate_audit_tamper` and seals nothing. Every executed repair emits
`maintenance.repair` (LOW) or `maintenance.repair_failed` (MEDIUM) on the hash
chain.

## Seal design note

`security_seals.sequence` is the **chain sequence being anchored**, not a counter.
`verifySeals()` recomputes each sealed row's hash from its fields and ignores the
stored `hash` column, so an edit that leaves the hash column untouched is still
caught. Sealing an unchanged head is a no-op (the UNIQUE index makes it so).

## Evidence

| Check | Result |
| --- | --- |
| `tsc --noEmit` | exit 0 |
| `src/__tests__/phase15-self-healing.test.ts` | 40 passed / 40 |
| `phase15-tool-security.test.ts` (15D) | 16 passed / 16 |
| `phase15-sandbox.test.ts` (15E) | 46 passed / 46 |
| `phase15-treasury.test.ts` (15C) | 35 passed / 35 |
| `tools-security.test.ts` (legacy) | 71 passed / 71 |
| `heartbeat.test.ts` + `heartbeat-scheduler.test.ts` | 39 passed / 39 |

Command used: `./runtime/node-v22.23.4-win-x64/node.exe node_modules/vitest/vitest.mjs run <files>`
(portable Node 22.23.4 — the only ABI that loads `better-sqlite3` on this host).

Covered behaviours include: clean report is `ok`; engaged stop reports `critical`
and skips every mechanic action; a stuck reservation warns but is never released
automatically; a plaintext wallet fails without leaking its key; an encrypted
envelope passes; a rewritten chain is detected and quarantined from sealing;
3 automatic / 4 approval / 12 forbidden identifiers classify correctly; repairs
are recorded in the audit chain; the `confirm` hook can veto every repair.

## Residual risks

1. **Registry-backed checks are best-effort.** `disk_space` uses `fs.statfsSync`;
   where unavailable it returns `pass` rather than failing the whole report.
2. **No OS-level enforcement.** The mechanic bounds what repairs are possible in
   code; it does not and cannot prevent a process with write access to the
   install directory from doing anything else.
3. **The guardian observes, it does not prove liveness.** A crashed or never
   started process cannot report its own absence; Windows Task Scheduler entries
   (Phase 12/13) are the external watchdog.
4. **Wallet envelope detection is schema-based.** A future envelope format would
   be reported as `warn`, not `pass`; that is fail-safe but noisy.
5. **Sealing requires an existing chain.** Sealing an empty chain throws; the
   mechanic swallows that via `tryAppendSecuritySeal`, so a brand-new database has
   no seal until its first event.

## Constraint compliance

No wallet was created, no key generated, no activation gate changed, no service
installed, no Windows security setting touched. `activationApproved` remains
`false`, `CONWAY_ACTIVATION` and `CONWAY_ALLOW_WALLET_CREATION` remain unset,
`maxChildren` remains `0`, and `security.selfHealingEnabled` is `false` — the
mechanic is therefore inert in the live install even though it is tested.
