# Phase 16B — Windows Host Security Verification

**Date:** 2026-11-01 · verification executed **13:45–13:50 IST** (all commands re-run this session;
the 11:41 capture in `reports/PHASE_16_WINDOWS_POSTURE_RAW.txt` was read in full and used only to
check that nothing had drifted)
**Host:** <host-name> · Lenovo model 83DV · Windows 11 Home Single Language, build 10.0.26300
**Account:** `<windows-user>` on `<host-name>`, workgroup (not domain-joined)
**Mode:** **strictly read-only.** No Windows security setting was changed. No BitLocker protector
or recovery key was queried, displayed, copied or stored. `manage-bde -protectors -get` was **not**
attempted. Defender, Firewall, TPM, Secure Boot and BitLocker states are reported as observed only.

Raw verbatim evidence for the 11:41 pass: `reports/PHASE_16_WINDOWS_POSTURE_RAW.txt` (18 982 B).
That file is retained; nothing was deleted.

---

## 1. Verdicts

| # | Item | Command(s) | Verdict | Measured value |
|---|---|---|---|---|
| 1 | **BitLocker / drive encryption** | `manage-bde -status` | **UNVERIFIED — BLOCKED (needs elevation)** | `ERROR: An attempt to access a required resource was denied. Check that you have administrative rights on the computer.` Tool version 10.0.26100 |
| 2 | **TPM presence / ownership** | `Get-Tpm`; `Get-CimInstance -Namespace root\cimv2\Security\MicrosoftTpm -ClassName Win32_Tpm` | **UNVERIFIED — BLOCKED** | `Administrator privilege is required to execute this command.` / `Get-CimInstance : Access denied` (HRESULT 0x80041003). The unnamespaced class is in `root\cimv2` → `Invalid class`, which is why the namespaced form is the correct one to retry elevated |
| 3 | **Secure Boot (on/off)** | `HKLM\SYSTEM\CurrentControlSet\Control\SecureBoot\State` | **VERIFIED — ENABLED** | `UEFISecureBootEnabled = 1`, `PolicyPublisher {77fa9abd-0359-4d32-bd60-28f4e78f784b}`, `PolicyVersion 1`. Re-read this session: `1` |
| 3b | Secure Boot UEFI variables (PK/KEK/db/dbx) | `Confirm-SecureBootUEFI` | **UNVERIFIED — BLOCKED** | needs `SeTcbPrivilege`: `Unable to set proper privileges. Access was denied.` The registry flag above is a *state* read, not a mock-up of the cmdlet |
| 4 | **Defender real-time protection** | `Get-MpComputerStatus` | **VERIFIED — ON** | `AMServiceEnabled=True RealTime=True AV=True NIS=True Ioav=True Behavior=True Tamper=True Mode=Normal` |
| 4b | Defender signature currency | same | **VERIFIED** | `AntivirusSignatureVersion 1.463.68.0`, `SigAge=0`, `Updated 11/01/2026 02:56:31` |
| 4c | Defender threat history | `Get-MpThreatDetection`, `Get-MpThreat` | **VERIFIED — empty at this scope** | `detections=0 threats=0` |
| 4d | **Defender exclusions / ASR exclusions** | `Get-MpPreference` | **UNVERIFIED — BLOCKED** | every exclusion field returns `{N/A: Must be an administrator to view exclusions}`. **A hidden admin-only exclusion cannot be excluded from this evidence** — this is the one item whose absence of finding means least |
| 5 | **Windows Firewall profiles** | `netsh advfirewall show allprofiles state` | **VERIFIED** | Domain / Private / Public all `State ON` |
| 5b | Firewall default policy | `netsh advfirewall show allprofiles firewallpolicy` | **VERIFIED** | all three `BlockInbound,AllowOutbound` |
| 5c | **Standing Node.js inbound exposure** | `Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime"` + application/port filters | **VERIFIED — 2 enabled inbound ALLOW rules** | `Program = C:\program files\nodejs\node.exe`, `Profile = Public`, `LocalPort = Any` for TCP and UDP each |
| 6 | **Elevation state of this session** | `whoami /groups` (System32 binary — Git Bash's coreutils `whoami` shadows the shell builtin and was the reason the first capture needed re-running) | **VERIFIED — NOT elevated** | `BUILTIN\Administrators … Group used for deny only`; `Mandatory Label\Medium Mandatory Level S-1-16-8192` |
| 6b | Token privileges | `whoami /priv` | **VERIFIED** | only `SeShutdownPrivilege` (Disabled), `SeChangeNotifyPrivilege` (Enabled), `SeUndockPrivilege`, `SeIncreaseWorkingSetPrivilege`, `SeTimeZonePrivilege`. **No** `SeDebug`, `SeTcb`, `SeBackup`, `SeRestore`, `SeSecurity` |
| 7 | **Administrators membership** | `net localgroup Administrators` | **VERIFIED** | members: `Administrator`, `<windows-user>` |
| 8 | Related services | `Get-Service WinDefend, MpsSvc, BDESVC, KeyIso` | **VERIFIED** | `WinDefend Running/Automatic`, `MpsSvc Running/Automatic`, `BDESVC Running/Manual`, `KeyIso Running/Manual` |
| 9 | Hyper-V VMMS service | `Get-Service vmms` | **VERIFIED — absent** | `Cannot find any service with service name 'vmms'` (consistent with Home SKU) |

---

## 2. Correction to the Phase 15 framing of R-1

Phase 15 recorded R-1 as "no administrator rights". **That is wrong in a way that changes the
remedy.** Measured above: the account **is** a member of the local `Administrators` group (item 7),
and every token is **UAC-filtered to Medium integrity with the Administrators SID marked
"Group used for deny only"** (item 6). The correct statement is: this is not a standard-user
machine, it is an administrator machine running filtered.

Practical consequence: the blocked items in §1 are blocked by *session elevation*, not by account
rights. **One elevated run of the read-only commands closes 4 of them** (BitLocker status, TPM
state, Defender exclusion lists, Secure Boot UEFI variables) and no code change, install, or
approval-beyond-UAC is needed. That is why R-1 stays OPEN-but-trivially-closable rather than
"environmental dead end", and it is also why **R-15 (project root writable by `Authenticated
Users`) is the more serious of the two** — closing it needs the same single elevation.

---

## 3. Operator instruction (elevated, read-only)

Run **as administrator** in an elevated `cmd.exe` or PowerShell window and paste the output back.
Nothing here mutates state.

```
manage-bde -status
Get-Tpm
Get-CimInstance -Namespace "root\cimv2\Security\MicrosoftTpm" -ClassName Win32_Tpm
Get-MpPreference | Select-Object ExclusionPath,ExclusionProcess,ExclusionExtension,ExclusionIpAddress,AttackSurfaceReductionRules_Ids,AttackSurfaceReductionRules_Actions
Confirm-SecureBootUEFI
icacls "<repo-root>"
```

**Explicitly out of scope, by project rule — do not run these, and this agent will not:**

- `manage-bde -protectors -get` or any protector/recovery-key disclosure command. Recovery keys are
  secrets; §6 forbids retrieving, displaying, copying or storing them.
- Any command that *changes* state: `manage-bde -on/-off/-forceoff`, `Enable/Disable-BitLocker`,
  `Set-MpPreference`, `netsh advfirewall set`, `bcdedit`, TPM ownership or clearing, Secure Boot
  configuration. This phase does not enable or disable any of them.

`icacls` on the project root is included because R-15 is the same elevation trip, not a separate
one — reading the ACL is the precondition for deciding whether to tighten it.

Note on `Confirm-SecureBootUEFI`: it requires `SeTcbPrivilege`, which a normal elevated
Administrator token does **not** hold (measured here: the privilege is absent from `whoami /priv`
altogether). Expect it to fail even in the elevated window — that is not a finding about Secure
Boot, whose on/off state is already VERIFIED from the registry. The db/dbx/PK/KEK detail would need
a SYSTEM context, which is out of scope for this project and not requested.

---

## 4. What this means for Conway

**Encryption at rest for the state tree is UNVERIFIED, not assumed adequate.** Conway stores an
encrypted wallet keystore and `state.db`. If the volume is unencrypted, the keystore's protection
ends at the file system ACL — which is itself world-writable for the project root (R-15). Neither
is claimable as safe from this session; both stay open until §3 is run.

**The host is not a hardened agent sandbox, and this verification does not make it one.** Real-time
protection with Tamper Protection ON, and a Medium-IL filtered token, are the two facts that most
reduce accidental-malware risk; they are not isolation from the agent's own actions. R-4 stands
unchanged: application-level controls are not OS-level isolation.

**Firewall: one genuinely standing exposure, and it does not extend to Conway's runtime.** The two
`Node.js JavaScript Runtime` allow rules are scoped by `Program =
C:\program files\nodejs\node.exe` with `LocalPort = Any` on the **Public** profile. Conway's pinned
runtime is `<repo-root>\runtime\node-v22.23.4-win-x64\node.exe`, which does not
match that path, so it is **not** covered by the rule and gets default `BlockInbound` behavior.
Relevant to Phase 17 §25: binding the dashboard to `127.0.0.1` needs **no** firewall rule and gains
none, which is the desired outcome. The existing rule is a pre-configured exposure for *system*
Node, unrelated to Conway and not touched (§2).

**Non-local listeners observed on the host at 13:47** (read-only, unchanged, none of them Conway):

| Local address | Port | PID | Process |
|---|---|---|---|
| `::` (all interfaces, IPv6) | 3001 | 12652 | `node` — the FreeLLMAPI listener, observed and left untouched per §2 |
| `<host-lan-ip>` | 54375 | 18720 | `Qoder` |
| `<host-lan-ip>` | 63057 | 21496 | `chrome` |

Conway itself has **no listener** — there was no Conway process, and port `8787` (planned for the
Phase 17 dashboard) returned `8787: no listener`.

---

## 5. Items that remain open after this phase

| Item | Status | Why it is not closable from here |
|---|---|---|
| BitLocker volume protection | **UNVERIFIED** | elevation only (§3 line 1) |
| TPM presence/ownership/readiness | **UNVERIFIED** | elevation only (§3 lines 2–3) |
| Defender exclusion lists | **UNVERIFIED** | elevation only (§3 line 4) — the only item where "nothing found" would not prove "nothing hidden" |
| Secure Boot UEFI variables | **UNVERIFIED** | `SeTcbPrivilege`; on/off flag **is** VERIFIED |
| Project root `Authenticated Users:(M)` (R-15) | **OPEN, needs elevation + approval** | an ACL change is a host security setting; §2/§13 forbid making it automatically |
| Windows services / auto-start | not touched | §29 item 12 |

Nothing in this phase was marked resolved without a fresh verification result: §1 states VERIFIED
only where a command produced the value, and UNVERIFIED where it produced an access error.
