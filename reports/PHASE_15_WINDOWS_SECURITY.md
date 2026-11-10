# Phase 15H — Windows and BitLocker Security Posture (Read-Only Audit)

Date: 2026-10-31 · Host: `<host-name>` · Session: **non-elevated**
(`IsAdmin = False`, user `<windows-user>`)
Raw evidence: `reports/PHASE_15_WINDOWS_POSTURE_RAW.txt` (collected with
`p15h_posture.ps1`, read-only cmdlets only, exit 0)

## Ground rules observed

* Every query was read-only. Nothing was enabled, disabled, installed,
  reconfigured or elevated.
* **No recovery key was retrieved, displayed or stored.** Volume queries selected
  status properties only (`ProtectionStatus`, `ConversionStatus`,
  `EncryptionMethod`, `LockStatus`). The commands that *would* reveal protectors
  (`manage-bde -protectors -get`, `Get-BitLockerVolume -KeyProtector`,
  `Get-BitLockerFeatureStatus` output piping) were deliberately never run.
* Windows Defender, Firewall, SmartScreen, UAC and BitLocker settings were not
  modified — they were only read, and this was already prohibited by the phase
  brief.
* No other project or AI tool's configuration was read or altered; process and
  port lookups were limited to identifying owners of listeners.

## Verified host facts

| Item | Value | Source |
| --- | --- | --- |
| OS | Microsoft Windows 11 Home Single Language, 10.0.26300, x64 | `Win32_OperatingSystem` |
| Firmware/virtualisation | LENOVO 83DV, x64-based PC, `HypervisorPresent = True` | `Win32_ComputerSystem` |
| Microsoft Defender | `AMServiceEnabled=True`, `AntivirusEnabled=True`, `RealTimeProtectionEnabled=True`, `BehaviorMonitorEnabled=True`, `NISEnabled=True` | `Get-MpComputerStatus` |
| Defender service | `WinDefend` Running / Automatic; `BFE` Running / Automatic | `Get-Service` |
| Controlled folder access | `EnableControlledFolderAccess = 0` (**off**) | `Get-MpPreference` |
| Windows Firewall | Domain / Private / Public all `Enabled = True` (inbound and outbound `NotConfigured`, i.e. vendor defaults) | `Get-NetFirewallProfile` |
| UAC | `EnableLUA=1`, `PromptOnSecureDesktop=1`, `ConsentPromptBehaviorAdmin=5` (prompt for credential on the secure desktop) | `HKLM\...\Policies\System` |
| Session privilege | non-admin | `WindowsPrincipal` |

`FullScanAge = 4294967295` (DWORD max) and empty `SignatureAge` / `IAVEnabled` /
`AutoUpdateEnabled` values are what an unprivileged process is allowed to see —
they are **not** evidence that no scan has run or that definitions are stale.

## Not verifiable without elevation (and not attempted)

| Item | Observed result | Why |
| --- | --- | --- |
| BitLocker volume state | `Get-BitLockerVolume` → `Access denied` on `root\cimv2\Security\MicrosoftVolumeEncryption`; `manage-bde -status` → `ERROR: An attempt to access a required resource was denied` | Both need administrator rights |
| `Win32_EncryptableVolume` namespace | `Invalid namespace root\Microsoft\Windows\BitLocker` | Not present on this SKU/build path |
| BitLocker event channels | All four `Microsoft-Windows-BitLocker-*/Operational` channels: "not an event log on the localhost" | No BitLocker client logging surface on this installation |
| TPM | `Get-Tpm` returned blank properties | Cmdlet is admin-gated |
| Secure Boot | `Confirm-SecureBootUEFI` → "Unable to set proper privileges. Access was denied." | Admin-gated |
| ASR rules / SmartScreen state | `Get-MpPreference` ASR arrays empty; `EnableSmartScreen` blank | Admin-gated |

Conclusion carried forward from Phase 14 unchanged and now re-confirmed:
**disk encryption status on this machine remains UNVERIFIED.** Conway must not be
assumed to sit on an encrypted volume, and it does not assume it — the wallet is
additionally protected by its own AES-256-GCM/scrypt envelope (Phase 15B) rather
than by trusting the disk.

## Recovery-key hygiene check (Conway tree)

`grep -rE '\b[0-9]{6}(-[0-9]{6}){7}\b'` across the install, excluding
`node_modules`, `.git` and `runtime`, matched **0 files**. A filename search for
`*recovery*`, `*.tpm`, `*fve*` matched only `docs/BACKUP_RECOVERY.md` (our own
documentation). No key material, protector blob or recovery password is stored in
the repository or its reports.

## Network exposure observations

Listeners found at audit time (owners resolved via `Get-NetTCPConnection` +
`Win32_Process.ExecutablePath`):

| Port | Bind | Owner |
| --- | --- | --- |
| 139 | `<host-lan-ip>` | `System` (SMB) |
| 445 | `::` | `System` (SMB) |
| 3001 | `::` | `C:\Program Files\nodejs\node.exe` (another tool — not Conway) |
| 20128 | `0.0.0.0` | `C:\Program Files\nodejs\node.exe` (another tool — not Conway) |
| 5040 | `0.0.0.0` | `svchost.exe` |
| 3457, 3601, 20131, 49535, 61884, 42050 | loopback only | other tooling / Ollama / Qoder / OneDrive |

* **Conway contributes nothing to this.** No process whose executable path is
  inside `<repo-root>` was running at audit time (a scan of
  every `node.exe` process path returned none), Conway listens on no port, and no
  Conway/automaton scheduled task exists (`Get-ScheduledTask` name match returned
  empty).
* The HKCU `Run` key and the Startup folder contain only pre-existing vendor
  entries (OneDrive, Adobe, Edge, Google Chrome auto-launch, `Ollama.lnk`). No
  Conway entry was added, and adding one remains prohibited without explicit
  approval.
* The all-interface listeners on 3001 and 20128 belong to other projects on this
  machine. They are recorded because they widen the local attack surface that
  Conway shares a user profile with — they are **not** ours to change, and we
  changed nothing.
* **Re-verified 22:55 after a wrong claim was retracted.** PID 15168 on 3001 was
  briefly mis-reported in the progress log as a Conway process. Ownership was then
  proved by parentage, not by port: its parent (PID 9516) is
  `TradingProjects\freellmapi\scripts\freellmapi-service.ps1`, its executable is
  `C:\Program Files\nodejs\node.exe` outside this repo, and a `Win32_Process`
  command-line scan for "Conway" matched only the scanning shell itself. The
  conclusions above stand.
* **New fact from the same re-check (operator-relevant, out of Conway's scope):**
  `node.exe` has two enabled inbound **Allow** firewall rules — TCP and UDP,
  `LocalPort: Any`, `RemoteIP: Any`, Program `C:\program files\nodejs\node.exe` —
  scoped to the Public profile, and the active Wi-Fi profile *is* Public
  (`Get-NetConnectionProfile`). All three profiles are ON with
  `BlockInbound,AllowOutbound`, so this exception, not the default, governs. Any
  `node.exe` listener bound to a non-loopback address is therefore reachable from
  the LAN; port 3001 qualifies. This is an inference from bind + rule + program
  match, **not** a demonstrated connection — a same-host test against its own LAN
  address does not traverse the firewall path. Not ours to fix; recorded for the
  operator.

## How the Conway controls relate to this audit

| Phase 15 control | Enforcement point | Test evidence |
| --- | --- | --- |
| Mechanic may not touch Defender / Firewall / BitLocker / SmartScreen / ACLs | `FORBIDDEN_PATTERNS` in `src/reliability/mechanic.ts`; unknown repair ids default to forbidden | `phase15-self-healing.test.ts` — 12 forbidden identifiers classify as `forbidden` |
| Sandbox never reads user documents, browser credentials, other AI configs or production wallet paths | `isProtectedPath` + `confineToRoot` in `src/security/sandbox.ts` | `phase15-sandbox.test.ts` — 46 tests incl. `Documents`, `Desktop`, `.ssh`, `.aws`, `.qoder`, `Chrome\User Data` |
| Emergency stop cannot be cleared or bypassed by the agent | `clearEmergencyStop` requires a named human; guards in `daemon.ts` and `executeTool` | `phase15-incident-response.test.ts` — 26 tests incl. zero ticks while engaged |
| No public endpoint exposure | `security.allowExternalExposure=false` and the `network_exposure` incident/`network.public_endpoint` denial path | `phase15-tool-security.test.ts`, `phase15-incident-response.test.ts` |

## Recommendations (each needs explicit human approval)

1. **Verify disk encryption once, manually, in an elevated prompt:**
   `manage-bde -status` (status only). Do **not** run `manage-bde -protectors -get`;
   if a recovery password appears on screen, do not copy it into any file here.
2. Because **Controlled Folder Access is off** and encryption is unverified, keep
   the wallet envelope passphrase-managed and keep backups out of `%USERPROFILE%`
   shares; treat SMB exposure (139/445) as hostile-network-adjacent.
3. If autonomous operation is ever activated, an operator should re-run this audit
   elevated to close the BitLocker/TPM/Secure Boot evidence gap.
4. Leave the other tools' all-interface listeners alone; if LAN exposure matters,
   it is the owner projects' configuration to change, not Conway's.

## Status

15H complete as a **read-only audit**. Two facts are verified-good (Defender real
time + behavior monitoring + network protection on; firewall enabled on all
profiles; UAC at default secure-desktop prompt), one is verified-absent (no
recovery-key material in the Conway tree; no Conway autostart, task, process or
listener), and the disk-encryption question is honestly recorded as unverifiable
from an unprivileged session.
