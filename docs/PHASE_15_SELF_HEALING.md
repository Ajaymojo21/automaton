# Phase 15F — Health Guardian and Bounded Autonomous Mechanic (Operator Guide)

**Control:** a read-only health view of the install, plus a repair executor that can perform only
three pre-classified maintenance actions and refuses everything else by identifier.
**Status:** implemented, 40 tests executed. **Self-healing is OFF in the live install** —
`security.selfHealingEnabled` is `false`, so the mechanic performs nothing.
**Evidence:** [`../../reports/PHASE_15_SELF_HEALING.md`](../../reports/PHASE_15_SELF_HEALING.md)
**Code:** [`src/reliability/health-guardian.ts`](../src/reliability/health-guardian.ts),
[`src/reliability/mechanic.ts`](../src/reliability/mechanic.ts),
[`src/security/emergency-stop.ts`](../src/security/emergency-stop.ts),
builtin task `health_guardian` in [`src/heartbeat/tasks.ts`](../src/heartbeat/tasks.ts)

---

## 1. The eight health checks

`runHealthChecks` writes nothing. It returns a `HealthReport` of `ok` / `degraded` / `critical`.

| Check | What it looks at | Failure meaning |
|---|---|---|
| `emergency_stop` | the marker file under the automaton directory **and** the audit trail (`system.emergency_stop` vs `system.emergency_stop_cleared`) | either source engaged → `fail`; an unreadable marker counts as engaged |
| `database_integrity` | `PRAGMA quick_check` | structural damage |
| `schema_version` | current version against `SCHEMA_VERSION` (13) | an un-migrated or rolled-back database |
| `audit_chain` | `verifySecurityChain` + `verifySeals` | tampered or broken history — the most serious finding here |
| `treasury_reservations` | rows in `reserved` older than 10 minutes | a crash between reserve and commit |
| `scheduler_leases` | expired leases | a worker died mid-task |
| `disk_space` | `fs.statfsSync`; warn under 10 % free, fail under 3 % | the database cannot keep writing |
| `wallet_storage` | whether the wallet file exposes plaintext key material | **fails on a plaintext wallet**, passes on the AES-256-GCM envelope; reports field *names*, never values |

Why two independent sources for the stop: the marker lives under the process `HOME`, so a daemon
started with a different `HOME` could miss it. The audit trail is the durable second source, and
`isEmergencyStopActive` consults both.

## 2. Repair classification — three buckets

**Automatic** (idempotent, no security or financial effect — the only three the mechanic may do
on its own):
`prune_expired_leases` · `prune_dedup_keys` · `rotate_audit_seal`

**Requires a named human:**
`release_stale_treasury_reservations` · `vacuum_database` · `reencrypt_wallet` ·
`refresh_wallet_backup` · `investigate_audit_tamper`

**Forbidden — the mechanic will not even accept these identifiers:**
anything matching wallet key material, private key / seed / mnemonic · financial limits or
treasury policy · authorising or signing transactions · disabling audit, sandbox, security,
authorization, lockdown or monitoring · granting permissions or capabilities · replication or
child spawning · exposing ports or tunnels · changing Defender, Firewall, BitLocker, SmartScreen
or Windows security · ACL manipulation (`icacls`, `takeown`) · credentials and API keys.

**An unknown repair identifier defaults to `forbidden`.** That is the important property: the
list does not have to be updated for a novel request to be refused. 12 forbidden identifiers are
asserted to classify correctly, alongside 3 automatic and 4 approval-required.

## 3. The three execution gates

`runMechanic` returns without touching anything unless **all** hold:

1. no emergency stop engaged (marker **or** audit trail);
2. `security.selfHealingEnabled === true` — or a human-run command that explicitly passes
   `allowRepairs`;
3. the repair is classified `automatic`.

Everything else is queued into `pendingApproval` rather than executed. In particular, financial
and integrity findings are *reported and deferred*, never auto-fixed.

A seal is written only while the chain still verifies. A broken chain queues
`investigate_audit_tamper` and seals nothing — the mechanic will not launder a suspicious history
into a clean-looking seal.

Every executed repair emits `maintenance.repair` (LOW) or `maintenance.repair_failed` (MEDIUM)
onto the hash chain. A `confirm` hook can veto every repair; a test asserts that.

## 4. Configuration

```jsonc
"security": {
  "selfHealingEnabled": false   // normalization accepts only the literal true
}
```

`normalizeSecurityConfig` treats any other value — `"1"`, `1`, `"yes"`, a typo — as `false`.
Enabling autonomous repair is therefore an explicit, unambiguous act, and it is item 8 on the
list of operations this phase was not authorised to perform.

## 5. Running the guardian yourself

The guardian is a library call, not a subcommand — `runHealthChecks` is synchronous and takes a
live database handle plus the loaded config, exactly as the heartbeat task calls it
([`src/heartbeat/tasks.ts:721`](../src/heartbeat/tasks.ts#L721)):

```bash
cd <repo-root>
./runtime/node-v22.23.4-win-x64/node.exe node_modules/tsx/dist/cli.mjs -e '
  const { createDatabase } = await import("./src/state/schema.ts");
  const { loadConfig } = await import("./src/config.ts");
  const { runHealthChecks } = await import("./src/reliability/health-guardian.ts");
  const db = createDatabase();
  console.log(JSON.stringify(runHealthChecks({ db: db.raw, config: loadConfig() }), null, 2));'
```

Open the database only when the runtime is stopped, or against a copy — `better-sqlite3` holds a
write lock and a second connection to the live file while the agent is running is a self-inflicted
contention. The zero-risk path is to let the `health_guardian` heartbeat task run it each interval
and store the report in KV (`last_health_report`), or to use the external `HEALTH_CHECK.bat`
wrapper from Phase 13, which needs no activation and opens nothing in-process.

## 6. Seal design, and why it was changed

`appendSecuritySeal` originally anchored a **seal counter**. It now anchors the **chain sequence**
being sealed, and is a no-op when the head has not changed (the UNIQUE index makes that
enforced). `verifySeals()` recomputes each sealed row's hash from its fields and **ignores the
stored `hash` column**, so an edit that leaves that column intact is still caught.

Read that as: a seal is an independent anchor over a named point in history, not a second copy of
the value an attacker would have to edit.

## 7. Verifying the control yourself

```bash
cd <repo-root>
N=./runtime/node-v22.23.4-win-x64/node.exe
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-self-healing.test.ts      # 40/40
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-incident-response.test.ts # 26/26
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-tool-security.test.ts     # 16/16
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-sandbox.test.ts           # 46/46
$N node_modules/vitest/vitest.mjs run src/__tests__/phase15-treasury.test.ts          # 35/35
$N node_modules/vitest/vitest.mjs run src/__tests__/tools-security.test.ts            # 71/71
$N node_modules/vitest/vitest.mjs run src/__tests__/heartbeat.test.ts src/__tests__/heartbeat-scheduler.test.ts  # 39/39
node node_modules/typescript/bin/tsc --noEmit                                          # exit 0
```

Representative assertions: a clean report is `ok`; an engaged stop reports `critical` **and skips
every mechanic action**; a stuck reservation warns but is never released automatically; a
plaintext wallet fails without leaking its key; an encrypted envelope passes; a rewritten chain is
detected and quarantined from sealing; repairs are recorded on the audit chain.

## 8. Residual risks

1. **`disk_space` is best-effort.** Where `fs.statfsSync` is unavailable the check returns `pass`
   rather than failing the whole report.
2. **No OS-level enforcement.** The mechanic bounds what repairs are *possible in code*. It cannot
   stop a process that has write access to the install directory from doing anything else.
3. **The guardian observes; it does not prove liveness.** A crashed or never-started process
   cannot report its own absence. The external watchdog is the Windows Task Scheduler entries from
   Phases 12/13, not this.
4. **Envelope detection is schema-based.** A future wallet format reports `warn`, not `pass` —
   fail-safe, but noisy.
5. **Sealing an empty chain throws**, and `tryAppendSecuritySeal` swallows it. A brand-new
   database therefore has no seal until its first event.
6. **Self-healing is inert right now**, which is correct for an unactivated install — but it also
   means none of the automatic repairs have ever run against real state. If you enable it, do so
   knowing the first execution is unproven in production conditions.
