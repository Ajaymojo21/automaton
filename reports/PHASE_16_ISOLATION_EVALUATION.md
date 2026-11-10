# Phase 16A.3 — OS-Level Isolation Evaluation (Windows 11 Home SL, non-elevated)

**Scope:** research and evaluation only. Nothing was installed, enabled, created persistently, or
modified on this host. Exactly one new file exists as a result of this pass: this report.
**Subject:** stronger isolation for Conway Automaton beyond the Phase 15 application-level sandbox
(documented residual risk **R-4**: "not an OS-level sandbox … because that needs administrator
rights"). R-4 is *half wrong* — see Option 1.
**Threat model under evaluation:** an LLM agent with `shell_execution` granted, prompt-injected or
misbehaving, already able to run arbitrary commands **as user `<windows-user>`** in this session;
Phase 15 controls (path confinement, command deny list, env scrubbing) are bypassable by anything
with code execution in the Node process itself.

---

## Method

### Host identity actually executed (not assumed)

```text
> powershell: Get-CimInstance Win32_OperatingSystem
Caption        : Microsoft Windows 11 Home Single Language
Version        : 10.0.26300
BuildNumber    : 26300
OSArchitecture : 64-bit

> reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v EditionID
    EditionID    REG_SZ    CoreSingleLanguage
```

Token state of the current session (decisive for every option below):

```text
> & $env:windir\System32\whoami.exe /groups | Select-String "Mandatory Label|Administrators|Deny Only"
NT AUTHORITY\Local account and member of Administrators group  Well-known group  S-1-5-114  Group used for deny only
BUILTIN\Administrators  Alias  S-1-5-32-544  Group used for deny only
Mandatory Label\Medium Mandatory Level  Label  S-1-16-8192

> [Security.Principal.WindowsPrincipal] … IsInRole(Administrator)
IsInRole(Administrator): False
```

**Finding:** the interactive account `<windows-user>` *is* a member of BUILTIN\Administrators,
but every Conway/Qoder process runs with a **UAC-filtered, Medium-IL token** in which
Administrators is deny-only. All "non-admin" statements below mean this filtered token.
It also means: **a dedicated standard account is a real boundary, while running Conway "as this
user" is not** — UAC elevation is one prompt (or one UAC bypass) away of full admin.

### Executed read-only commands (all captured)

| Probe | Result summary |
|---|---|
| `net user`, `Get-LocalUser`, `Get-LocalGroup`, `net localgroup …` | enumeration works without elevation |
| `icacls <path>` (display form only, no `/save`, no grants) | see Option 3 |
| `Get-Acl … .Owner` | user owns all three probed trees |
| `wsl --status`, `wsl -l -v`, `wsl --version` | see Option 4 |
| `docker --version`, `where docker`, `ls "C:\Program Files\Docker"` | not installed |
| `Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM` | **hard error:** `The requested operation requires elevation.` |
| `Get-CimInstance Win32_OptionalFeature -Filter …` (alternative, non-admin) | returned nothing for all probed names — this class is not a usable substitute on this host; feature state therefore NOT TESTABLE without elevation |
| `Get-CimInstance Win32_ComputerSystem` → `HypervisorPresent` | `True` |
| `Win32_DeviceGuard` → `SecurityServicesRunning`, `VBSStatus` | `{2}` (HVCI/memory integrity on), `2` (VBS running) |
| `Get-Service vmcompute,HvHost,vmms` | `vmcompute` and `HvHost` **Running** (Manual); `vmms` absent |
| `Test-Path C:\Windows\System32\WindowsSandbox*`, `C:\Program Files\Windows Sandbox` | both absent (Windows Sandbox payload not on disk) |
| `node.exe --version`, `process.versions` | v22.23.4, `modules: 127`, `napi: 10`, win-x64 bundled runtime |
| `find node_modules -name '*.node'`, header check of `better_sqlite3.node` | Windows PE (`MZ`), win32-x64 only |
| `CreateJobObjectW` P/Invoke probe (PowerShell `Add-Type`, in-memory; handle created and immediately closed — no persistent state, no process assigned) | `CreateJobObjectW SUCCESS … ok=True` |

### Deliberately NOT executed

- `New-LocalUser` / `net user … /add` — would create an account. **A methodology note:** one probe
  invoked `New-LocalUser -Name "zz-test" -ErrorAction Stop` expecting an immediate access-denied;
  PowerShell instead began an interactive secure-string prompt and the command was killed at
  timeout. Verified afterwards: `CONFIRMED: zz-test does NOT exist`. No account was created.
  Account-creation privilege is therefore reported from documented behaviour + the observed
  prompt, **not** as a captured access-denied error (blocker named: task constraint against state change).
- `wsl --install`, any `icacls` grant/deny, `sc create`, `schtasks`, firewall, Defender, BitLocker
  commands — all state-changing; **would require explicit approval**, none run.
- Job-object *assignment* of a real process (would change process state; creation probe only).

### Files read for grounding

`<repo-root>\package.json`,
`<repo-root>\src\security\sandbox.ts`
(`confineToRoot`, `isProtectedPath`, `validateShellCommand`, `scrubEnvironment`),
`<repo-root>\docs\PHASE_15_SANDBOX.md` (esp. §7 "What this sandbox does not do").

---

## Option 1 — Windows Job Objects

**What it is:** a kernel object grouping processes; supports per-job and total CPU-time limits,
per-process/job memory limits, `KILL_ON_JOB_CLOSE` (children die with the parent), breakaway
control, and (legacy, separate API) UI restrictions. The pattern for Node is: spawn child
suspended → `AssignProcessToJobObject` → resume, plus `SetInformationJobObject` before spawn.

**Privilege needed — empirically tested:** `CreateJobObjectW` **succeeds from this non-elevated
Medium-IL token** (verbatim: `CreateJobObjectW SUCCESS (handle created and closed as current user, ok=True)`).
Standard limit flags (memory/CPU/kill-on-close) require only a handle to the job. Admin is needed
only for: the deprecated `JOBOBJECT_SECURITY_LIMIT_*` (UI restriction) flags, and
`JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` semantics requiring `SeIncreaseBasePriorityPrivilege`-class
rights — none of which Conway needs. **Phase 15's R-4 statement "a Job Object … needs
administrator rights" is incorrect for the parts that matter here.**

**Availability on Home SL:** yes — Job Objects are a base Win32 feature, not edition-gated.

**What it protects against in Conway's threat model:** runaway resource consumption by agent-spawned
children (the Phase 15 §9.6 "no resource limits" gap), orphaned/zombie processes surviving a Conway
crash (kill-on-close), agent attempts to escape containment by creating breakaway jobs (a
non-privileged process cannot create a job with breakaway permissions it does not have).

**What it does NOT protect against:** the filesystem, the network, other users' data, registry,
credentials — job objects bound *resources and lifetime*, not *access rights*. An injected agent
inside the job still reads everything this user can read. It also only covers children **Conway
itself spawns**; anything already detached is out of reach.

**Practical for a non-admin?** The mechanism yes; **from Node.js no built-in path exists.**
`node:child_process` exposes no Job Object API. Dependency check performed on the live install:
top-level `node_modules` contains no ffi/native-binding package; the pnpm store's only matches for
`ffi|koffi|ref-napi|win32|job|container|sandbox` are platform binaries of build tooling
(`@esbuild/win32-x64` ×2, `@rollup/rollup-win32-x64-gnu`, `@rollup/rollup-win32-x64-msvc`) — none
usable for Job Objects. **A new dependency would be needed** (e.g. a small N-API addon or an FFI
package like `koffi`). No such package is installed and this task did not authorize adding one.

**Verdict:** `Available on this host for a non-admin: PARTIAL` — the OS mechanism works today
un-elevated (proven); using it from Conway requires a new native dependency → operator approval.

---

## Option 2 — Dedicated restricted Windows account

**What it is:** a separate standard (non-Administrator) local user under which Conway runs.
This is the only option in this list that gives an **OS-enforced identity boundary against the
user's own data**: NTFS ACLs then deny the agent anything outside its profile, *even with
arbitrary code execution as that account*. This machine already demonstrates the pattern:
`CodexSandboxOffline` / `CodexSandboxOnline` accounts + `CodexSandboxUsers` group exist
(verified by `net user`, `Get-LocalUser`, `net localgroup CodexSandboxUsers`), and the Documents
folder carries an explicit `(OI)(CI)(RX)` grant to `CodexSandboxUsers`.

**Privilege needed:** enumeration — none (all queries above ran un-elevated). **Creation —
elevation**: `New-LocalUser`/`net user /add` require an elevated token (and the account needs to
be kept out of Administrators). Running *as* that account needs either interactive sign-in, `runas`
(prompts for password; `/savecred` writes to Windows Credential Manager — a state change), or a
scheduled task/service — all out of scope and each needing setup beyond the non-admin's rights to
register non-interactive logon types.

**Availability on Home SL:** yes — local users and groups are fully supported on Home/Home SL
(only *Microsoft account* management and AD join differ).

**Protection:** strong against exactly what Phase 15 cannot stop: code execution as the Conway user
reading `<user-home>\*`, browser profiles, `.ssh`, wallets — because those ACLs are
enforced by the kernel at open() time, not by sandbox.ts. Against the *host OS* it is still
weaker: kernel privilege-escalation exploits and anything world-readable remain reachable.

**Not protected:** the current account's own data if Conway runs *in* that account (i.e. it helps
only if the boundary is chosen correctly); network egress; other users' access **into** the Conway
project — which today is wide (see Option 3: `Authenticated Users:(M)` on the project root means
*any local account, including sandbox accounts, can modify Conway's own code*).

**Practical for a non-admin?** Query and plan: yes. Implement: **no** — one-time elevation is
required to create the account; afterwards the non-admin can own/harden its folders.

**Verdict:** `Available on this host for a non-admin: NO` (usable only after a single elevated
setup step performed by the operator).

---

## Option 3 — Filesystem ACL restrictions (icacls)

Executed display-only queries (verbatim):

```text
<repo-root>\runtime\home
    <host-name>\<windows-user>:(OI)(CI)(F)          ← sole entry; inheritance already stripped

<repo-root>
    BUILTIN\Administrators:(I)(OI)(CI)(F)
    NT AUTHORITY\SYSTEM:(I)(OI)(CI)(F)
    BUILTIN\Users:(I)(OI)(CI)(RX)
    NT AUTHORITY\Authenticated Users:(I)(M)
    NT AUTHORITY\Authenticated Users:(I)(OI)(CI)(IO)(M)   ← ANY local account has Modify on the project

<user-home>\Documents
    <host-name>\CodexSandboxUsers:(OI)(CI)(RX)
    NT AUTHORITY\SYSTEM:(I)(OI)(CI)(F)
    BUILTIN\Administrators:(I)(OI)(CI)(F)
    <host-name>\<windows-user>:(I)(OI)(CI)(F)
```

Ownership confirmed via `Get-Acl`: `<host-name>\<windows-user>` owns `<projects-root>`,
the project tree and `runtime\home`.

**What it is:** NTFS discretionary ACLs — the kernel-enforced read/write boundary checked on every
file open, independent of any application logic.

**Privilege needed:** a non-admin **can** rewrite DACs on files they own (owners hold implicit
WRITE_DAC), so restricting *this user's own* trees — `runtime\home`, the project, profile folders —
needs **no elevation**. System locations (`C:\Windows`, program files, other users' profiles) are
not owner-writable in practice and require elevation + `SeRestorePrivilege`-class rights.

**Real findings for Conway:**
1. **Weak point found:** `Authenticated Users:(M)` inherited on the project lets every local
   account — including `CodexSandboxOffline/Online` — tamper with Conway's source, `dist/`, and
   `node_modules`. A prompt-injected agent that escapes sandbox.ts but is confined to *any*
   authenticated identity can still poison Conway's code. Fix = one `icacls … /inheritance:r` +
   explicit grants; owner-only, no elevation. **State-changing → not performed; would require explicit approval.**
2. ACLs only *deny other identities*. While Conway runs as the primary user (today), ACLs on
   Documents etc. do not constrain the agent at all — same identity. ACL hardening and Option 2
   are two halves of one solution.
3. `runtime\home` is already the model of what correct confinement looks like (single F entry).

**Not protected against:** same-user code execution (the main threat today), volume shadow copies,
backup operators, kernel exploits, registry, network.

**Verdict:** `Available on this host for a non-admin: YES` for the user-owned trees
(`<projects-root>\**`, own profile folders); `NO` for system locations.

---

## Option 4 — WSL2

Executed:

```text
> wsl --status   (decoded from UTF-16)
Default Version: 2
WSL1 is not supported with your current machine configuration. Please enable the
"Windows Subsystem for Linux" optional component to use WSL1.

> wsl -l -v
Windows Subsystem for Linux has no installed distributions.

> wsl --version
WSL version: 3.0.3.0
Kernel version: 6.18.54.1-1
WSLg version: 1.0.79
Windows version: 10.0.26300.9818
```

Plus: `HypervisorPresent = True`, `vmcompute` and `HvHost` services Running (Manual start).

**What it is:** full Linux userland in a lightweight Hyper-V utility VM. The Linux process cannot
touch Windows files unless a `drvfs` mount is created; Windows↔Linux file access is the boundary
to engineer carefully.

**Availability on Home SL:** yes — WSL2 is supported on Home; the WSL 3.x Store engine is already
installed and the VM platform is live here. **No distro is installed**, and installing one
(`wsl --install <distro>`) is a software installation → **would require explicit approval**; on
this build the engine-side feature enabling appears already done (kernel + WSLg report real
versions), so distro install may not even need elevation — NOT TESTABLE without state change.

**better-sqlite3 under WSL — reasoned from verified artifacts:** the installed binary
`node_modules/better-sqlite3@11.10.0/build/Release/better_sqlite3.node` is a Windows PE
(header `MZ`), compiled against NODE_MODULE_VERSION **127** / win32-x64 (per bundled
node v22.23.4 `process.versions.modules`). A Linux Node under WSL cannot load a PE image —
**no, it would not work without a rebuild** (or platform-specific prebuilt download) inside the
distro, which additionally needs a Linux toolchain (python/make/g++) and a separate
`npm/pnpm install` there. That is two installs, both out of scope.

**Protects against:** Windows-profile filesystem access from the agent (if it runs Linux-side with
no `/mnt/c` mount), Windows-targeted persistence mechanisms (Run keys, scheduled tasks, service
installation), the entire `validateShellCommand` deny list becomes irrelevant because those
binaries aren't there. **Does not protect against:** the classic WSL escape surface —
`drvfs`/`/mnt/c` mounts expose the Windows filesystem **with the starting user's full ACL rights**
(so as today's user: everything Phase 15 tried to protect, unless mounts are disabled or a
dedicated Windows account per Option 2 owns the files); localhost networking is shared with the
host; WSLg/DCOM channels exist; memory dumps of the VM live on the host filesystem.

**Practical for non-admin:** partially — engine present; the install steps and mount policy are
operator-approval items. Migration cost is the real problem: Conway's whole win32 native stack
must be rebuilt and revalidated Linux-side.

**Verdict:** `Available on this host for a non-admin: PARTIAL` (platform ready, distro absent;
installation and full isolation require elevation/approval and a native-module rebuild).

---

## Option 5 — Docker

Executed: `docker --version` → `command not found`; `C:\Program Files\Docker` → does not exist;
no `docker.exe` anywhere on PATH. **Docker Desktop is not installed and no daemon is running.**

**What it is (here):** Docker Desktop on Windows runs containers inside a WSL2 (or Hyper-V) VM.
Isolation is genuinely VM-backed — *but the caveat the user prompt correctly flags is the mount*:
bind-mounting `C:\` into a container (Docker Desktop's file sharing exposes drives; `:ro` still
exposes every file *the Windows user can read*, and read-only is a per-mount flag the agent can be
told to ignore by simply not using the constrained image) is the escape surface, on top of the
fundamental one: **anything with access to the Docker socket (`//./pipe/docker_engine`, group-wise
open to the user) is root-equivalent on the host VM and can launch a privileged container with
`-v C:\:/host`** — i.e. it trusts whoever it trusts, which is exactly Conway's threat shape.

**Privilege:** Docker Desktop installation requires elevation (adds a user group, hooks WSL,
installs a service). Runs on Windows 11 Home with the WSL2 backend — Home SL is not excluded —
but it is an install → **would require explicit approval.**

**Protects against (if done properly):** arbitrary Windows code execution by the agent (it lands
in a container instead), most persistence, most credential theft — provided no host mounts and no
socket are passed in. **Not protected:** anything deliberately mounted; egress networking (needs
`--network=none` policy); the host filesystem via an over-shared bind.

**Practical for non-admin today:** no. Not installed; install needs elevation; per-run socket/mount
discipline is a hard operational burden for a runtime whose tools include shell access.

**Verdict:** `Available on this host for a non-admin: NO` (not installed; install = elevation + approval).

---

## Option 6 — Windows Sandbox (Containers-DisposableClientVM)

**What it is:** ephemeral, kernel-isolated desktop container from a live Windows image; every
launch is fresh, everything discarded.

**Edition:** **not available on Home / Home SL** — Microsoft ships it on Pro/Enterprise/Education
only. Empirically consistent here: `Test-Path C:\Windows\System32\WindowsSandbox*` → nothing;
`C:\Program Files\Windows Sandbox` → absent. The non-admin feature query failed with
`The requested operation requires elevation.` (captured verbatim, Option 6 evidence that even
*reading* state via that cmdlet needs admin on this host; the `Win32_OptionalFeature` CIM fallback
returned no rows — NOT TESTABLE).

**Also unfit even where it exists:** it is an interactive GUI desktop with no automation API and
no persistence — Conway is a long-running headless runtime with a SQLite state file; a
disposable-VM model does not map onto it.

**Verdict:** `Available on this host for a non-admin: NO` — blocked twice: edition (Home SL) and elevation.

---

## Option 7 — AppContainer / Application Guard / other

- **Windows Defender Application Guard (WDAG):** deprecated/discontinued on Windows 11 24H2+ and
  Enterprise-only to begin with; not present on this Home SL host. The disabled
  `WDAGUtilityAccount` visible in `Get-LocalUser` is a built-in template artifact, not evidence of
  the feature. Verdict: **NO**.
- **AppContainer / capability SID sandboxing** (the mechanism Edge and the Codex sandbox accounts
  use; note the *observed* `CodexSandboxUsers:(OI)(CI)(RX)` ACL on Documents is that pattern):
  launching into an AppContainer needs a native `CreateProcess` with a `PROC_THREAD_ATTRIBUTE_
  CAPABILITY_SID`/`SECURITY_CAPABILITIES` config — **new native dependency** (same blocker as
  Option 1). File access then requires explicit `icacls` grants to the container SID, which the
  owner can do on their own files. Powerful, but a substantial engineering lift for the current
  Node runtime. Verdict: **PARTIAL — mechanism present in OS, not reachable without a dependency + code.**
- **Restricted-token child processes** (`CreateRestrictedToken`, no elevation needed for one's own
  token): would deny-by-default the SID list that grants access to the user's profile. Same
  Node-native-binding blocker. Worth revisiting bundled with an Option 1 addon. Verdict: **PARTIAL (dependency-bound).**
- **A second local Windows VM via Hyper-V Manager:** Home SL lacks the full Hyper-V role (only the
  store/VM-platform subset that WSL2 uses); creation needs elevation. Verdict: **NO**.
- **Sandboxie-Plus / third-party sandboxes:** require kernel-driver installation → elevation,
  plus installing privileged components is forbidden by the master prompt. Verdict: **NO** for this
  project's constraints.
- **bubblewrap/firejail:** Linux-only — become relevant only if Option 4 materializes; inside WSL2
  they add a userspace layer the Windows agent cannot influence from outside.

---

## Option 8 — Where the boundary really is

Phase 15's `confineToRoot`, `isProtectedPath`, `validateShellCommand` and `scrubEnvironment` all
run **inside the same process, at the same privilege, with the same access token as the code they
are meant to police**. An attacker who has code execution in Conway's Node process can simply not
call those functions: `import fs from "node:fs"; fs.readFileSync(path.join(os.homedir(), ".ssh/id_rsa"))`
touches none of the four guards (they wrap tool dispatch, not the runtime); regex deny-listing of a
command string is defeated by any equivalent encoding the shell accepts; `CONWAY_*` secrets already
loaded are in the process heap, reachable by the same code. A guard is only a boundary if it is
enforced by something the guarded code cannot modify — i.e. a different trust domain. **Only
kernel-enforced objects move that boundary: NTFS ACLs against a different identity (Options 2+3),
job/restricted tokens tied to the process object rather than app logic (Options 1/7), or a
hypervisor boundary (Options 4/5).** Everything else is friction, not a wall. The single most
important sentence for Phase 16B: **an identity change (dedicated standard account) is the
cheapest real boundary available on this machine; ACLs without an identity change are theatre,
and a job object without an identity change only caps resources.**

---

## Recommendation (ranked by security gain vs practical cost)

### (i) Implementable now — no elevation, no new dependency (needs operator sign-off only because it changes state)
1. **Kill the `Authenticated Users:(M)` write on the Conway project tree** (Option 3, finding 1) —
   `icacls "<repo-root>" /inheritance:r` then explicit grants to owner +
   `SYSTEM` only. Owner rights, no elevation. Removes tampering by every other local account.
   *Not executed in this pass — ACL modification is a state change; would require explicit approval.*
2. **Harden remaining user-owned trees** to `runtime\home`-style single-owner ACLs (same rights).
3. **Correct the R-4 wording in the Phase 15 doc** (Option 1 evidence): basic Job Objects do *not*
   need administrator rights; only UI-limit/security-limit flags and breakaway grants do.
4. **Stop describing the account as neutral:** document that Conway runs from an Administrators-
   member (UAC-filtered) account — the current app sandbox plus this fact means "no isolation from
   admin" is the honest label.

### (ii) Requires elevation once, or a new native dependency → operator approval required
5. **Dedicated standard Windows account for Conway** (Option 2) — the best security gain per unit
   of disruption on this host. One elevated `New-LocalUser`, then non-admin ACL work to move
   runtime state. Combine with (i).1–2 so even the boundary's contents are sane.
6. **Job Objects via a small N-API/koffi dependency** (Option 1) — closes the Phase 15 §9.6
   resource-limit gap and kill-on-close; *not* an access boundary; dependency policy must allow it.
   AppContainer/restricted tokens (Option 7) ride on the same dependency investment and are the
   follow-on if deeper in-session containment is ever wanted.
7. **WSL2 with a distro + rebuilt better-sqlite3** (Option 4) — genuine VM boundary, but needs the
   install approved, a Linux native-toolchain rebuild, `/mnt/c` left unmounted (or Option 5's
   account boundary in place), and the full stack revalidated. Highest migration cost in tier (ii).
8. **Docker Desktop** (Option 5) — only with `--network=none`, zero host bind mounts, no socket
   pass-through; install needs elevation; the mount/socket caveats above are load-bearing, not
   footnotes.

### (iii) Cannot be done on this Windows edition at all (Home Single Language, build 26300)
- Windows Sandbox (Option 6) — edition-gated + elevation-gated; verified absent from disk.
- WDAG (Option 7) — discontinued and Enterprise-gated.
- Full Hyper-V role / standalone Windows VM; any privileged kernel-component sandbox (Sandboxie-class).
- Any *reading* of optional-feature state via `Get-WindowsOptionalFeature -Online` without elevation
  (captured error), so on Home SL these features cannot even be audited by the runtime user.

---

## Claims we are not allowed to make

- **"Conway is sandboxed" ≠ OS isolation.** Phase 15 is an application-level guard rail inside the
  same trust domain; it stops accidents and casual misuse, not code execution. The master prompt's
  prohibition stands: app-level sandboxing must never be described as, or relied upon as, OS-level
  isolation.
- We may not claim the deny list is an allow list, that `scrubEnvironment` protects process memory,
  or that protected-path checks survive a direct `fs`/`net` call by in-process code.
- We may not claim "Job Objects need administrator rights" — empirically false for the standard
  limits (probe output above); equally we may not claim a Job Object provides filesystem isolation
  (it does not).
- We may not claim running Conway as `<windows-user>` is a least-privilege position: the account
  is a (filtered) Administrator.
- No claim in tiers (ii)/(iii) of "this is protecting us today" — none is active on this host now.

*Report generated read-only; the only system change made in this pass is the creation of this file.*
