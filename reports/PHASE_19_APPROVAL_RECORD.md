# Phase 19 — Approval Record and A2–A8 Requests

Status of this record at writing time: **no approval has been recorded for any of A2–A8, and no code
change from A2–A8 has been applied.**

Authority basis: the Phase 19 mandate §2 — "Do not assume that running this prompt automatically
approves every item… For A2-A8, do not infer approval from this prompt… Stop before applying
unapproved changes… Do not fabricate approval records." The pre-existing record
([`PHASE_18_APPROVAL_LIST.md`](PHASE_18_APPROVAL_LIST.md) §6) was inspected at 18:30Z and is **blank
in every row** — no `Y`, no signer, no date. So approval is absent for all seven items and is
requested here.

Each item below is a **request**, with the exact change, its impact, its test plan, and its rollback.
Mark the decision box; do not sign the set as a block if any sub-decision is unresolved — three items
(A2, A4, A6) carry explicit design choices that change what gets built.

---

## 0. What is already done without approval, and why that is legal

**A1 — documentation corrections only** (mandate §2 TIER 0: "No human approval required").

| File | Change | SHA-256 after |
|---|---|---|
| `docs/WINDOWS_OPERATIONS_GUIDE.md` | `--status` no longer called a "read-only snapshot"; new §3.1 (measured write behaviour, gate map, read-only alternatives) and §3.2 (ungated `--pick-model` / `--configure` table); "Status without starting" retitled "…without starting the agent" with the write caveat | `f8721043338a800b0d75b006c3d667c064c5fc210cf02c26fcd97ae1428cee7c` (8 040 B) |
| `docs/README.md` | isolation table ACL rows changed to **NOT VERIFIED** with the evidence boundary and the libuv `666` trap; Phase 17 evidence row corrected to **10 files / 97 tests** (re-executed, not inherited); the three-claim passage rewritten to show what was corrected vs what still awaits approval | `f7b30ab6b3f53609f4e6652dbe39112761fc1015aa74b758b31f1231fbc25bdd` (19 041 B) |
| `docs/DASHBOARD_OPERATIONS.md` | new §"Proving reachability: probe, do not read a socket table" with the 26-capture measurement and the one-directional rule | `05105d205b28db72c935ffd3a750453470351ac6da7c10ff55596b369f81ce56` (13 017 B) |

Post-A1 proof of non-mutation: `automaton.json` `1c10ecc5…966d` and `state.db` `512 000 B` /
`2026-10-31T10:25:59.744Z` — byte-identical to the baseline (§1.2 of the audit). A1 closed **zero**
findings; F-18-01 and F-18-13 remain open in code.

**Deliberately not done under A1** — the same two claim patterns survive in eight other docs, outside
the mandate's named A1 files, so correcting them is a scope decision, not a typo fix:
`AI_CONFIGURATION.md:142`, `AGENT_CONFIGURATION.md:126`, `FINAL_ACCEPTANCE_REPORT.md:52,103`,
`INSTALLATION_REPORT.md:172`, `SECURITY_AUDIT.md:27,97,173`, `TROUBLESHOOTING.md:324`,
`WALLET_SECURITY.md:120`, and `MONITORING_GUIDE.md:152` ("`--status` prints a compact snapshot").
**Decision D-0:** approve a follow-up A1b batch for these nine locations, or leave them and accept
that the ACL/`--status` misstatement persists elsewhere. Recommended: approve A1b — documentation-only,
no approval-gated semantics, and it removes the contradictions the corrected files now point at.

---

## 1. A2 — Migration runner hardening (mandate §4)

**Target:** [src/state/database.ts:571-648](../src/state/database.ts#L571),
[src/state/schema.ts:661-669](../src/state/schema.ts#L661) · **Closes:** F-18-02, F-18-11, F-19-02
**Findings addressed:** 3 · **Reversible:** yes (code only; no live database is touched)

### Proposed change

**(a) Replace message-free tolerance with schema-verified tolerance.** New internal helper, used by
every ALTER-guarded statement:

```ts
function applyAlterOrVerifyColumn(db, sql, table, column): void {
  try { db.exec(sql); return; }
  catch (error) {
    if (!isDuplicateColumnError(error)) throw;          // lock, disk, syntax, constraint: rethrow
    const has = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column);
    if (!has) throw new MigrationVerificationError(...); // tolerated message but column absent → fail
  }
}
```

`isDuplicateColumnError` accepts only a `SqliteError` whose message matches
`/^duplicate column name: /i`. `SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_IOERR*`, `SQLITE_CORRUPT` and
SQL-syntax errors rethrow and abort the enclosing transaction, so the version row is never written.

Note why the second check exists: SQLite reports both *duplicate column* and *syntax error* under the
generic `SQLITE_ERROR` code, so the error **code** cannot discriminate. Tolerance is therefore
confirmed against `pragma_table_info`, not against prose — which is also what mandate §4.C asks for.

**(b) Scope decision D-1 — which catches get fixed.** Seven unbounded catches exist
(F-19-02), not one: `database.ts:590-594` (5 × V4 ALTER), `:617` (V9), `:627` (V11).

| Option | What changes | Cost | Risk |
|---|---|---|---|
| **A2-min** | V11 only, as Phase 18 named | lowest | leaves 6 identical defects; the mandate's §4.A wording ("only tolerate the specifically expected duplicate-column condition") is satisfied only for one of seven sites |
| **A2-full (recommended)** | all seven via the helper | slightly larger diff, same helper | uniform; no site can swallow a lock or disk error |

**(c) `MIGRATION_V10` idempotency** — add `IF NOT EXISTS` to
`CREATE TABLE knowledge_store` ([schema.ts:665](../src/state/schema.ts#L665)). F-18-11.

**(d) Version integrity: assert the schema, do not stamp from `MAX(version)`.** Replace
[database.ts:110-118](../src/state/database.ts#L110) (`INSERT OR REPLACE … VALUES (13, datetime('now'))`)
with a verification step that, before recording any version, checks the objects that version is
supposed to have created. For 13 that set is **4 tables, 6 triggers, 12 indexes — enumerated by name**
(see F-19-01: the Phase 18 "seven triggers" figure is wrong; the check must not compare an integer):

```
treasury_authorizations_no_delete, security_events_no_update, security_events_no_delete,
security_incidents_no_delete, security_seals_no_update, security_seals_no_delete
```

If any required object is absent → throw; no version row. `INSERT OR REPLACE` becomes
`INSERT … ON CONFLICT(version) DO NOTHING` so an existing `applied_at` is never overwritten —
overwriting it is what made the Phase 18 "is row 13's timestamp genuine?" check necessary.

**(e) Transaction safety** — keep the per-migration transaction at
[database.ts:640-647](../src/state/database.ts#L640) (it is correct: a throw inside `m.apply()` rolls
back the version insert), and add the verification inside the same transaction so a migration that
applied DDL but failed verification cannot record success.

### Impact assessment

`createDatabase` is the open path for **every** writer: `--status`, `--run`, `--configure` (`:220`),
`--pick-model` (`:34`), the heartbeat daemon, the mechanic, and the test suite fixtures. A stricter
runner converts previously-silent failures into hard startup failures — that is the intent, but it is
an availability change, and the honest risk is: **if any real database has a genuinely broken V4/V9/V11
object, it will now refuse to open instead of limping.** The live V11 database was checked for
exactly this: `children.chain_type` exists (13th column, Phase 18 §4), so A2 should not break it;
this must be re-proved by test, not by that citation.

Tests today: `grep -rl "applyMigrations\|MIGRATION_V11" src/__tests__ dashboard/tests` → **nothing**
(F-18-02's "no test covers it"). A2 adds the first coverage for this code.

### Test plan (mandate §4.E, all 8, disposable fixtures only)

1. V12+V13 apply to an isolated V11 fixture copy — both succeed, `MAX(version)` → 13.
2. All **four** expected tables exist by name.
3. All **six** expected triggers exist by name (criterion corrected per F-19-01).
4. A non-duplicate error propagates: inject a lock/disk-shaped failure and assert it throws.
5. A failed migration receives **no** `schema_version` row.
6. A subsequent attempt retries and converges.
7. An existing `children.chain_type` does not cause a false failure (tolerance path works).
8. The version cannot advance when a required object is absent — drop a trigger from a fixture,
   assert the run throws and version stays put.

Plus: `MIGRATION_V10` re-run onto a database that already has `knowledge_store` converges instead of
throwing. **Never** the live `state.db` — every fixture is a copy in a temp directory.

### Rollback

`git checkout` of the two files (once A7 makes that possible; before A7, keep a pre-A2 byte copy of
`src/state/database.ts` and `src/state/schema.ts` and restore it). No live data is involved.

**Decision D-2 (A2): approve / reject / approve with scope = min or full.**

---

## 2. A3 — Read-only `--status` and an explicit migration command (mandate §5)

**Target:** [src/index.ts:154-157,191-228](../src/index.ts#L154),
[src/state/database.ts:80-118](../src/state/database.ts#L80) · **Closes:** F-18-01 · **Reversible:** yes

### Proposed change

**(a) Two clearly distinguishable opens.**

```ts
export function openDatabaseReadOnly(dbPath: string): ReadOnlyDatabase
// new Database(path, { readonly: true, fileMustExist: true }) + busy_timeout
// throws if the file is absent; cannot create, cannot write, cannot migrate

export function createDatabase(dbPath: string): AutomatonDatabase   // unchanged: read-write + migrate
```

The read-only handle mirrors the pattern already proven in
[dashboard/server/db.ts:24-34](../../dashboard/server/db.ts#L24), which documents the reason in its
own comment: `readonly + fileMustExist` is the whole guarantee, and `createDatabase` is on the Phase 16
DANGER LIST and never imported by the console.

**(b) `--status` becomes genuinely read-only.** `showStatus()` currently calls seven typed getters on
the `AutomatonDatabase` interface ([index.ts:201-207](../src/index.ts#L201)). Replace with
`readStatusSnapshot(dbPath)` issuing the same seven as plain `SELECT`s on the read-only handle
(`agent_state`, turn count, installed tools, heartbeat entries, active skills, children, registry).
Behavioural contract: never calls `applyMigrations`, never creates tables, never writes a row, never
updates `schema_version`, never silently creates a database, and **fails safely with a clear message
when the database is absent** instead of creating one.

**(c) Migration behind an explicit command**, e.g. `--migrate-schema`, which:
requires an approval gate (its own env token — **not** `CONWAY_ACTIVATION`; mandate: it "never
enables agent activation"); verifies canonical HOME in-process; resolves and verifies the target
database path; runs `integrity_check` before any DDL; refuses unexpected paths; writes an auditable
report to `reports/migration-<timestamp>.json` (before/after version, object names created, duration —
no row data, no secrets); and exits non-zero on any failure.

### Impact assessment — read this before approving

- Today `--status` is how the docs tell operators to "check on things"; after A3 it no longer
  migrates, so **schema advancement becomes impossible by accident** — but also impossible by
  habit. The only route to V12/V13 becomes the explicit command, which is currently unapproved, so
  **the live database stays at V11 until A9 is separately approved.** That is the intended posture
  (mandate: A9 is outside Phase 19), not an oversight.
- `--status` output could change if a getter's SQL differs from the interface's; the tests below
  compare field-for-field against today's output to prevent silent semantic drift.
- Any other caller keeps `createDatabase`, so runtime behaviour of the agent path is unchanged.
- Docs: [§3.1 of the operations guide](../docs/WINDOWS_OPERATIONS_GUIDE.md) documents *today's*
  write behaviour. Once A3 lands, that section must be updated again — A3's test plan includes the
  doc correction, so the doc cannot lead the code.

### Test plan (mandate §5.C, on a disposable V11 copy)

1. `--status` leaves schema at **11**.
2. Database **mtime unchanged**.
3. Database **SHA-256 unchanged** where the read-only SQLite environment permits (the WAL `-shm`
   caveat of F-18-12 is asserted explicitly rather than glossed).
4. No migration applied: the four V12/V13 tables remain absent after `--status`.
5. `--status` against a **missing** database fails cleanly and **does not create one**.
6. `--migrate-schema` **refuses** without the approval token and writes nothing.
7. `--migrate-schema` with the token operates **only** on its disposable fixture; asserts it never
   receives the canonical path unless a separate explicit override is present, and that the refusal
   path is reachable by tests, not by comments.
8. Output-equivalence test: post-A3 `--status` reports the same 12 fields as pre-A3 on the same fixture.
9. Activation independence: with `CONWAY_ACTIVATION` unset and `activationApproved:false`,
   `--status` still succeeds (read-only) — proving the split did not accidentally gate reads.

**Explicitly out of scope:** no run of the new command against the live database. The live file is
opened read-only for verification only.

### Rollback

Restore the two files; `--status` returns to migrating behaviour. No data effect either way.

**Decision D-3 (A3): approve / reject.** If approved, also confirm the command name `--migrate-schema`
and that its token is a distinct variable rather than an activation variable.

---

## 3. A4 — Approval gates on `--configure` and `--pick-model` (mandate §6)

**Target:** [src/config.ts:180-197](../src/config.ts#L180) (write boundary),
[src/index.ts:166,172](../src/index.ts#L166),
[src/setup/configure.ts:329,334,339,344](../src/setup/configure.ts#L329),
[src/setup/model-picker.ts:80](../src/setup/model-picker.ts#L80) · **Closes:** F-18-13 · **Reversible:** yes

### Proposed change — validate at the boundary, not in the menu

`saveConfig` is the **single** writer both commands funnel through (§4.3 of the audit), so the gate
belongs there. Design:

```
classifySensitiveChanges(before, after) -> string[]    // field paths only, never values
saveConfig(config, ctx?)                               // now guarded
  - compute the diff against the on-disk config
  - if any changed path is sensitive (credential fields, treasuryPolicy.*, maxChildren,
    relay/rpc endpoints, model/provider fields that gate execution, security.*)
      -> require an explicit approval token (exact value match; empty / malformed /
         unexpected rejected), else throw ConfigApprovalRequired
  - write to <path>.tmp then rename  (atomic; no partial config on failure)
  - never print or log a value: field names and a count only
```

Sensitive path set, mapped to the §29 prohibition list as Phase 18 did: credentials
(`conwayApiKey`, `openaiApiKey`, `anthropicApiKey`) → §6; `treasuryPolicy.*` → §9/§10;
`maxChildren` → §10; `security.*` → §1/§14; relay/RPC endpoints → §11; provider/model selection where it
enables execution → §6. Menu-level refusal is added too (so an operator gets a clean message, not a
stack), but the boundary check is what a bypass cannot get around.

### Impact assessment

- **A setup tool that refuses to write is still a setup tool** — the operator must be able to approve.
  Two designs are possible and they are **not** equivalent:

| Option | Mechanism | Consequence |
|---|---|---|
| **A4-boundary (recommended)** | env/argument token validated inside `saveConfig`; interactive confirmation in the menu | an inactive system can still be configured deliberately; internal callers cannot bypass |
| **A4-activation** | `requireActivation()` on `--configure` / `--pick-model` | simpler diff, but **makes configuration impossible without activation**, which is backwards for a system that must be configured *before* any activation decision — Phase 18 flagged this as the reason the wizard is gated and these are not |

- Other `saveConfig` callers (`--init`, `--provision`, `--setup`, runtime writes) inherit the guard.
  If any of them writes a sensitive path during normal operation it will now need the token. That
  list must be enumerated by the implementer before coding, and is the main unknown in this item —
  it is why the test plan includes a direct internal-invocation test rather than trusting the CLI.
- Atomic rename changes the file's inode; anything watching `automaton.json` by path still works.

### Test plan (mandate §6)

1. `--configure` refuses a sensitive change with no approval.
2. `--pick-model` refuses a protected change with no approval.
3. Direct CLI invocation cannot bypass the gate (no menu path).
4. **Internal function invocation** — `saveConfig(...)` called straight from a test, bypassing both
   commands, still refuses. This is the test that proves the boundary is the gate.
5. Rejections for empty token, wrong token, malformed token, unexpected extra token.
6. `automaton.json` is **byte-identical** after every refused attempt (hash, not mtime).
7. Non-sensitive changes still succeed with the token, and with no token if the diff classifies as
   non-sensitive — the classification function is tested directly.
8. No secret value appears in stdout, stderr, logs, or the test report: assert against a redaction
   scan of captured output, using a canary value that must not be found.
9. Partial-write failure (temp written, rename blocked) leaves the original intact.

**No real API credential is entered anywhere in this work.** Tests use canary strings in disposable
config files under a temp HOME.

### Rollback

Restore `saveConfig` + the two command files. No data effect if no config was written.

**Decision D-4 (A4): approve A4-boundary, or A4-activation, or reject.** The Phase 18 recommendation
was per-field confirmation; that is a **third** option and is listed for the operator to choose.

---

## 4. A5 — Emergency stop fails closed (mandate §7)

**Target:** [src/security/emergency-stop.ts:84-107](../src/security/emergency-stop.ts#L84)
· **Closes:** part of F-18-03 · **Reversible:** yes · **§29 item 14 (autonomy safety)**

### Proposed change

The asymmetry today is one line: `if (!hasEvents) return false;` at `:89` (absent table ⇒ "not
engaged" — **fail-open**), versus `catch { return true; }` at `:98` (query error ⇒ engaged —
fail-closed). Missing data is the one case handled leniently, and it is the case that is true on the
live V11 database.

Replace the boolean with a discriminated result and make unavailability fail closed:

```ts
type StopBasis = "marker" | "audit-trail" | "unavailable";
readEmergencyStopState(db?) -> { engaged: boolean; basis: StopBasis; reason?: string }
// table absent  -> { engaged: true, basis: "unavailable", reason: "security_events absent (pre-V12 schema)" }
// db unreadable -> { engaged: true, basis: "unavailable", ... }
// empty table   -> { engaged: false, basis: "audit-trail" }   // present and genuinely empty is NOT failure
// last event = system.emergency_stop -> engaged
// last event = …_cleared             -> not engaged
```

`isEmergencyStopActive` keeps its boolean signature for existing callers but returns `true` when
`basis === "unavailable"`. A pre-V12 database is never reported as a healthy, fully verified security
state. The emergency stop is **not** disabled by anything in this change.

### Impact assessment — the availability cost is real and must be read before approving

`isEmergencyStopActive` is consulted by the agent tool choke point
([tools.ts:3437](../src/agent/tools.ts#L3437)), the heartbeat daemon
([daemon.ts:121,140](../src/heartbeat/daemon.ts#L121)), the health guardian
([health-guardian.ts:339](../src/reliability/health-guardian.ts#L339)) and the mechanic
([mechanic.ts:144](../src/reliability/mechanic.ts#L144)). On **today's V11 database**, failing closed
means the emergency stop reads as **permanently engaged** until V12/V13 land: the agent would refuse
tool execution and the daemon would idle.

With activation false, `allowedTools: []`, `maxChildren: 0` and no agent process running, **nothing
observable changes on the live install today** — the consequence lands only if someone activates
before applying the migration. Which is precisely the ordering this phase exists to prevent. If the
operator wants the window closed rather than hardened, the alternative is to approve A5 together with
A9 — and A9 is outside Phase 19 (§ mandate: separate approval), so the default here is: **A5 alone,
fail closed, window documented.**

### Test plan (mandate §7, 5 cases)

1. Missing `security_events` table → engaged, `basis:"unavailable"`, no throw.
2. Unreadable database (corrupt/locked) → engaged, fail closed.
3. Valid table, no emergency-stop event → not engaged, `basis:"audit-trail"`.
4. Valid table with `system.emergency_stop` as the latest relevant row → engaged.
5. Corrupt/incomplete audit data (e.g. rows present but sequence broken) → engaged, classified.
Plus: the cleared-event case must not be swallowed by the new fail-closed branch, and a genuinely
empty table must read not-engaged — otherwise the change merely converts an empty-but-valid audit
trail into a permanent halt, which would be a different bug.

### Rollback

Restore the file; behaviour returns to fail-open on absent table. No data involved.

**Decision D-5 (A5): approve / reject / defer pending A9.**

---

## 5. A6 — Audit chain and tool authorizer cannot silently lose records (mandate §8)

**Target:** [src/security/audit-chain.ts:165-185,323-335](../src/security/audit-chain.ts#L165),
[src/security/tool-authorizer.ts:185-209](../src/security/tool-authorizer.ts#L185),
[src/reliability/mechanic.ts:190,208,244](../src/reliability/mechanic.ts#L190) and the 13 call sites
(§4.4 of the audit) · **Closes:** F-18-03 (runtime half), F-18-10 · **Reversible:** yes · **§29 14**

### Proposed change

**(a) Typed append result instead of `null`.**

```ts
appendSecurityEventResult(db, input, now?) ->
  | { ok: true; row: SecurityEventRow }
  | { ok: false; persisted: false; severity: …; error: <redacted classification> }
```

For `severity` in `{HIGH, CRITICAL}` a `!ok` result is a **hard failure**: the helper rethrows, or the
caller must handle it and cannot proceed. `LOW`/`INFO`/`MEDIUM`/`MAY` may stay best-effort **only**
because the result explicitly distinguishes persisted from dropped — a caller can no longer mistake
`null` for success, which is exactly today's bug
([audit-chain.ts:183](../src/security/audit-chain.ts#L183)). Error context is preserved as a
classification + truncated message with the existing redaction applied; **no secret, no credential,
no full SQL parameters**.

**(b) Tool authorizer: no silent proceed without its durable record.** `decide()` currently appends
and then returns the decision regardless of the append outcome
([tool-authorizer.ts:190-208](../src/security/tool-authorizer.ts#L190)). Change to: if a durable
record is required for the decision (deny, and any HIGH/CRITICAL event) and the append fails → return
a **deny** carrying `reasonCode: "AUDIT_UNAVAILABLE"`. Default-deny is preserved; **no tool
permission is widened**; `allowedTools` stays `[]` throughout (Phase 18 §4 note: A6 is what makes a
non-empty `allowedTools` meaningful later).

**(c) The seal goes through the repair path.** `rotate_audit_seal` is declared but never dispatched
and the real seal write at [mechanic.ts:244](../src/reliability/mechanic.ts#L244) bypasses
`classifyRepair`. Route the seal append through `runRepair` so `classifyRepair` and the confirmation
hook apply, and dispatch `rotate_audit_seal` through the same gate. F-18-10.

**(d) All 13 `tryAppendSecurityEvent` call sites** are visited. The security-relevant ones
(tools.ts × 5, tool-authorizer, emergency-stop × 2, treasury-guard × 3) must consume the typed result;
mechanic × 2 may stay best-effort only with the persisted/dropped distinction explicit. This is the
cost driver of A6: it is a cross-module change, not a two-file patch.

### Impact assessment

- **On the live V11 database, `security_events` does not exist.** After A6, every HIGH/CRITICAL audit
  append attempt becomes a hard failure instead of a silent `null`. Today those code paths are
  reachable only through the agent runtime, which is not running and cannot start (activation false,
  `allowedTools: []`). So the blast radius on the **live** system is nil, and the effect appears the
  moment anyone activates — which is the correct order: **no activation until the audit chain
  actually persists.**
- The health guardian's `audit_chain` row will still fail (that is F-18-03's honest reading), and the
  dashboard must not be made to look greener as part of this work.
- Risk of over-tightening: a HIGH event on a purely observational path could now abort an operation
  that previously continued. Each of the 13 sites is classified in the implementation PR; if a site's
  severity is disputed, the default is to keep it a hard failure and document it.

### Test plan (mandate §8.D)

1. HIGH append failure → hard failure, caller cannot proceed, original error class preserved.
2. CRITICAL append failure → same.
3. LOW append failure → returns `{ok:false, persisted:false}`, caller distinguishes it.
4. Successful append → `{ok:true, row}` with hash chain intact.
5. Authorizer: deny decision still recorded; when the record cannot be written → decision is **deny**
   with `AUDIT_UNAVAILABLE`, and permissions are not widened.
6. Authorizer default-deny preserved for an unknown tool.
7. Seal append through `runRepair`: `classifyRepair` invoked, confirmation hook invoked, forbidden
   classification refused.
8. `rotate_audit_seal` is dispatched through the gate (not dead code).
9. Redaction: a canary secret placed in event details never reaches logs or thrown messages.
No real tool execution, no financial operation, no wallet.

### Rollback

Restore the four files. The 13 call sites revert together; a partial revert would not typecheck, which
is a useful safety property to note.

**Decision D-6 (A6): approve / reject / approve for (a)(b) only, deferring the seal routing (c).**

---

## 6. A7 — Git baseline and commit (mandate §9)

**Target:** the git index · **Closes:** F-18-08 · **Reversible:** yes before push; **push is a
separate consent**

Measured starting point: branch `main`, HEAD `d8f8168`, **40 modified + 35 untracked**. `docs/`,
`dashboard/`, `reports/`, `config/` and the 11 `.bat` wrappers are all **untracked** — the entire
security layer has no version-control baseline, which is why "reviewable" and "reproducible" are
currently unclaimable.

### Proposed procedure (no step of it runs without this approval)

1. `git status` full inspection; classify every path into: source / runtime state / reports /
   generated / secrets.
2. Confirm exclusions are enforced, not assumed. Measured now: `.gitignore:15 runtime/home/`, and
   `git check-ignore -v` resolves **both** `runtime/home/.automaton/state.db` and
   `automaton.json` to that rule. Re-verify at staging time.
3. Build an **explicit** file list — no `git add -A`, no `git add .`.
4. Run **A8** against exactly the staged blobs.
5. Review `git diff --cached --stat` and `git diff --cached` in full; confirm no unrelated file, no
   `runtime/home` path, no database/WAL/SHM, no log, no token file.
6. Commit with a descriptive message; tag only if the operator approves the tag.
7. **No push.** Mandate: "Do not push to any remote without separate explicit consent."

### Proposed staging set

| Include | Reason |
|---|---|
| `src/**` (all modified + untracked source) | the security layer; F-18-08's named scope |
| `config/` | named review scope |
| `dashboard/` **excluding** `dashboard/node_modules/`, `dashboard/dist/`, `dashboard/logs/`, `dashboard/state/`, `dashboard/restore-targets/` | named scope; the excluded directories hold build output, audit logs, the **operator token** and restore material |
| the 11 `.bat` wrappers | named scope, "approved Windows .bat wrappers" |
| `docs/**` | including the three A1-corrected files |
| `reports/PHASE_1[6-9]*.md` and the Phase 17/18 evidence files | the evidence chain the mandate depends on |
| `package.json`, `pnpm-lock.yaml`, `.gitignore` | modified; needed for a reproducible build |

| **Never staged** (mandate §9) | present in the tree? |
|---|---|
| `runtime/home/**` | yes — **gitignored, verified** |
| `**/.env` with secrets | not found; re-scan at staging |
| wallet files | `wallet.json` absent |
| API credentials | four fields are zero-length |
| database files, `-wal`, `-shm` | present under `runtime/home` — ignored |
| logs containing secrets | `logs/`, `dashboard/logs/` — exclude |
| private keys | none; scanned for |
| local backups | `backups/` — exclude |
| operator tokens | `dashboard/state/dashboard.token` — **must be excluded**; it exists |

**Open item for A7 (do not wave it away):** `dashboard/node_modules/` and the pnpm store are large;
whether they are ignored must be verified before staging, and `runtime/npm-cache` (273 MB) certainly
should be. The implementer must show the `git status` output proving the set, not assert it.

### Test plan

`git status --porcelain` after commit shows no staged-anything leftovers in the included paths;
`git show --stat HEAD` lists exactly the approved set; `git ls-files runtime/home` returns **empty**;
`git ls-files | grep -i "token\|wallet\|\.env\|state\.db"` returns empty.

**Decision D-7 (A7): approve staging set as listed / modify the list / reject. Tag: yes/no. Push: no
(default, and requires separate consent).**

---

## 7. A8 — Secret scan of the exact staged set (mandate §10)

**Runs only after D-7 fixes the staged set.** Measured: `gitleaks`, `trufflehog` and
`detect-secrets` are **not installed** on this machine, so the scan cannot depend on fetching a
third-party binary into an unrelated environment. Proposal: a project-local scanner script that reads
**staged blobs** via `git show :<path>` — not the working tree — so what is scanned is exactly what
would be committed.

Checks: `sk-[A-Za-z0-9…]{20,}`, `sk-ant-…`, `sk-proj-…`, JWTs (`eyJ…` triple), PEM blocks
(`BEGIN … PRIVATE KEY`), 64-hex private-key-looking strings, `x-apisecret`, credential-bearing URLs
(`://user:pass@`), Solana/EVM key shapes, `wallet.json` content, and any SQLite magic header
(`SQLite format 3`) inside a blob.

A clean scan reports: the exact staged file list, scanner used (this script, by path and hash), number
of files scanned, findings with severity, false-positive disposition, final PASS/FAIL. **Values are
never printed — only file, line, and finding type.** If a real secret is found: stop, do not commit,
do not print it, request human review.

Baseline for comparison: the Phase 18 pattern scan over `reports/`, `docs/` and
`runtime/home/.automaton` for `sk-…` / `sk-ant-…` / `BEGIN PRIVATE KEY` returned **no matching
files**, and the three credential fields measured zero-length — so a clean A8 is the expected result,
but it must still be executed and captured.

**Decision D-8 (A8): approve the scanner approach / require installing a named third-party scanner
(which is itself an environment change) / reject.**

---

## 8. Explicitly outside Phase 19 execution

| Item | Why |
|---|---|
| **A9 — apply V12/V13 to the live database** | mandate §2: "OUTSIDE Phase 19 execution. It requires a separate explicit approval." Also: its acceptance criterion must first be corrected to the six named triggers (F-19-01) |
| A10 — post-apply read-only verification | part of A9 |
| A11 / F-18-05, F-18-06, F-18-07 — dashboard display fixes | mandate §11: not in the approved scope; requires its own impact assessment and approval request. The five-label rule (`VERIFIED / NOT VERIFIED / UNKNOWN / EMPTY / NOT APPLICABLE / FAIL`) and "never label unavailable as VERIFIED" apply to whatever is approved |
| A12 — scheduling `health_guardian` / `security_monitor` | arms the F-18-04 wake loop; Phase 18 recommended deferring, and §14 prohibits it here |
| Any activation, wallet, credential, transaction, exposure, service, scheduled task, Windows security change, global env change, unrelated AI environment | mandate §13/§14 — prohibited, not merely unapproved |

---

## 9. Approval record — to be completed by a human

Signing an row authorises **only** that item, at the scope written in its conditions column.
An entry here authorises no §14/§8 item, never implies activation, and never implies push consent.

| # | Item | Approved? (Y/N) | By | Date | Scope / conditions chosen |
|---|---|---|---|---|---|
| A1 | Documentation corrections | **executed under TIER 0 — no approval required** | operator (mandate §2/§3) | 2026-11-01 | three named files; hashes in §0 |
| A1b | Same doc corrections in the other 9 locations | | | | D-0 |
| A2 | Migration runner hardening | **Y** | operator, answered interactively in the Qoder session (see the record note below) | 2026-11-01 | **"A2 + A3 (runner + read-only status)"** selected from the option list. D-1 was **delegated to the agent** ("DECIDE IT YOUR SELF IS THE BEST OF MY KNOWLEDGE"); the agent chose **A2-full** (all seven catches) and that choice is disclosed, not presented as an operator decision. D-2 satisfied by the A2 selection |
| A3 | Read-only `--status` + explicit `--migrate-schema` | **Y** | operator, same interactive answer | 2026-11-01 | D-3 approved. Command name `--migrate-schema` and a **separate** token variable (`CONWAY_MIGRATION_APPROVAL`, with a second `CONWAY_MIGRATION_ALLOW_CANONICAL` for the live tree) are the approved design in §2 of this record, so the confirmation D-3 asked for is carried by that design; a second confirmation gate was **not** folded into agent activation, per mandate §2 |
| A4 | Config write-boundary gate | **N — not approved** | operator | 2026-11-01 | D-4 was offered and delegated; it became **moot** because A4 itself was not selected. `--configure` therefore remains an ungated write (F-19-04 open) |
| A5 | Emergency stop fail-closed | **N — not approved** | operator | 2026-11-01 | D-5 unanswered; §4 availability cost not accepted |
| A6 | Audit chain + authorizer + seal | **N — not approved** | operator | 2026-11-01 | D-6 unanswered; the 13 `tryAppendSecurityEvent` call sites stay unmodified |
| A7 | Git commit of the listed set | **N — not approved** | operator | 2026-11-01 | **No commit, no tag, no push.** The F-19-04 staging hazard (19 424 files, `dashboard/state/dashboard.token`) is therefore still live |
| A8 | Secret scan of staged blobs | **N — not approved** | operator | 2026-11-01 | Depends on A7; nothing was staged, so nothing was scanned |
| A9 | Live V12/V13 migration | **N — outside Phase 19, never requested** | — | — | Live schema still **11**; `CONWAY_MIGRATION_ALLOW_CANONICAL` never set |
| A11 | Dashboard display fixes | **N** | — | — | needs its own request (§8) |
| A12 | Schedule guardians | **N** | — | — | deferred |
| B1 | Elevated read-only ACL/Defender/firewall check | **N** | — | — | never run; `manage-bde -protectors -get` never run |

### How the A2/A3 approval was actually recorded

The operator's answer arrived as a **selection in an interactive question inside the agent
session**, not as a signature in this file. That is the approval this phase acted on; it is
reproduced as literally as it can be:

- items approved: `A2 + A3 (runner + read-only status)`;
- D-1 (A2 scope): `DECIDE IT YOUR SELF IS THE BEST OF MY KNOWLEDGE` → agent chose A2-full;
- D-4 (A4 design): `DECIDE YOUR SELF IN BEST OF YOUR KNOWLEDGE AND EXPERIENCE` → moot, A4 not approved.

No approval record was fabricated for A4–A8 or A9, and no §14 prohibition was lifted by the A2/A3
answer. If the operator wants a signed line in a file rather than a session answer, these two rows
should be re-confirmed by hand.

### Scope disclosed after the fact: what "A3" ended up covering

The A3 approval covered the read-only `--status` handle and the gated `--migrate-schema` command. After
it was implemented, the security-review pass found **two defects in that new code itself** — **F-19-08**
(a case-sensitive `startsWith` behind a deliberately case-insensitive home guard, which let the live
tree be reached with one token instead of two) and **F-19-09** (containment compared path *spellings*,
so a directory junction could move the write outside the sandbox and was not recognised as canonical).
Both were fixed **inside the same approved A3 scope**, test-first, on the reasoning that the approval
was for a *working* gate and neither change widened what the command can do — they only narrowed it.

That interpretation is the operator's to reject. It is recorded here rather than in a footnote because
it means code changed after the approval answer, and because the alternative — shipping a gate known to
be bypassable — would have made the approval itself meaningless. Evidence for both closures is in
`PHASE_19_SECURITY_VERIFICATION.md` §2 and `PHASE_19_TEST_RESULTS.md` rows 27–32. Three further
defects found by the same review (**F-19-10**, **F-19-11**, **F-19-12**) were **not** fixed, on the
same logic in reverse: closing them needs new code with no test yet proving the need, so they are
recorded as open instead.

Until every code row above carries a human `Y`, Phase 19 classification is
**A2 and A3 executed and verified; A1 complete; A4–A8 still C — BLOCKED (awaiting approval)**, with
A9 outside the phase.
