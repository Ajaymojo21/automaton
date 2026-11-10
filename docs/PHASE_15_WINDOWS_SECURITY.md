# Phase 15H — Windows Host Posture (Read-Only Audit Results)

**Scope:** what the host actually provides as protection for this install, measured from a
non-elevated session, and what could not be measured.
**Method:** read-only PowerShell cmdlets only, in a single scripted pass that exited 0. The
collector itself is an ephemeral scratch file (`%TEMP%\p15h_posture.ps1`), deliberately not
committed; the full captured output is in the repo and is the durable evidence. Nothing was
enabled, disabled, installed, reconfigured or elevated.
**Evidence:** [`../../reports/PHASE_15_WINDOWS_SECURITY.md`](../../reports/PHASE_15_WINDOWS_SECURITY.md),
raw capture in [`../../reports/PHASE_15_WINDOWS_POSTURE_RAW.txt`](../../reports/PHASE_15_WINDOWS_POSTURE_RAW.txt)

> **Standing prohibition observed:** no BitLocker recovery key was retrieved, displayed or stored.
> The commands that *would* reveal protectors (`manage-bde -protectors -get`,
> `Get-BitLockerVolume -KeyProtector`) were deliberately never run. Do not run them "just to
> check" and do not paste their output into this project.

---

## 1. Verified good

Host `<host-name>`, Windows 11 Home Single Language 10.0.26300 x64, LENOVO 83DV,
`HypervisorPresent = True`, session **non-admin**.

| Control | Measured state |
|---|---|
| Microsoft Defender | `AMServiceEnabled`, `AntivirusEnabled`, `RealTimeProtectionEnabled`, `BehaviorMonitorEnabled`, `NISEnabled` all `True`; service `WinDefend` Running/Automatic |
| Base Filtering Engine | `BFE` Running/Automatic (without it the firewall cannot enforce) |
| Windows Firewall | Enabled on Domain, Private **and** Public; default `BlockInbound,AllowOutbound` |
| UAC | `EnableLUA=1`, `PromptOnSecureDesktop=1`, `ConsentPromptBehaviorAdmin=5` (prompt for credential on the secure desktop) |
| Session privilege | non-admin — the agent cannot silently install a service or change ACLs |

`FullScanAge = 4294967295` (DWORD max) and empty `SignatureAge` / `IAVEnabled` /
`AutoUpdateEnabled` are **what an unprivileged process is allowed to see**. They are not evidence
that no scan has run or that definitions are stale. Do not read them as findings.

## 2. Verified absent (Conway contributes nothing to the host)

- No process whose executable path is inside `<repo-root>` was running.
- Conway listens on no port.
- No Conway/automaton scheduled task (`Get-ScheduledTask` name match returned empty).
- HKCU `Run` key and the Startup folder contain only pre-existing vendor entries (OneDrive,
  Adobe, Edge, Chrome auto-launch, `Ollama.lnk`). No Conway entry was added, and adding one
  remains prohibited without explicit approval.
- **No recovery-key material anywhere in the tree:** `grep -rE '\b[0-9]{6}(-[0-9]{6}){7}\b'`
  excluding `node_modules`, `.git` and `runtime` matched **0 files**; a filename search for
  `*recovery*`, `*.tpm`, `*fve*` matched only `docs/BACKUP_RECOVERY.md`.

## 3. UNVERIFIED — needs an elevated prompt, and is not a pass

| Item | Result from this session | Why |
|---|---|---|
| BitLocker volume state | `Get-BitLockerVolume` → *Access denied* on `root\cimv2\Security\MicrosoftVolumeEncryption`; `manage-bde -status` → *required resource was denied* | administrator rights |
| `Win32_EncryptableVolume` | *Invalid namespace* | not present on this SKU/build path |
| BitLocker event channels | all four `Microsoft-Windows-BitLocker-*/Operational` → "not an event log on the localhost" | no BitLocker client logging surface here |
| TPM ownership | `Get-Tpm` returned blank properties | admin-gated |
| Secure Boot | `Confirm-SecureBootUEFI` → "Unable to set proper privileges" | admin-gated |
| ASR rules / SmartScreen | `Get-MpPreference` ASR arrays empty, `EnableSmartScreen` blank | admin-gated |
| **Controlled folder access** | `EnableControlledFolderAccess = 0` — read successfully, and it is **off** | visible without elevation |

Carried forward from Phase 14 and re-confirmed: **disk encryption status on this machine is
UNVERIFIED.** Conway must not be assumed to sit on an encrypted volume — and it does not assume
it: the wallet is protected by its own AES-256-GCM/scrypt envelope
([PHASE_15_WALLET_ENCRYPTION.md](PHASE_15_WALLET_ENCRYPTION.md)) rather than by trusting the disk.

### How to close this gap (one command, by you, elevated)

```powershell
manage-bde -status        # status only
```

Read `Conversion Status` and `Percentage Encrypted` for `C:`. **Do not** run
`manage-bde -protectors -get` — that prints recovery passwords. If one ever appears on screen,
do not copy it into a file in this project.

## 4. Network exposure observed (host facts, not Conway's)

| Port | Bind | Owner |
|---|---|---|
| 139 | `<host-lan-ip>` | `System` (SMB) |
| 445 | `::` | `System` (SMB) |
| 3001 | `::` | `C:\Program Files\nodejs\node.exe` — another tool, not Conway |
| 20128 | `0.0.0.0` | `C:\Program Files\nodejs\node.exe` — another tool, not Conway |
| 5040 | `0.0.0.0` | `svchost.exe` |
| 3457, 3601, 20131, 42050, 49535, 61884 | loopback only | other tooling / Ollama / Qoder / OneDrive |

**One finding from the second capture pass, recorded for the operator and explicitly *not*
remediated** (the owner is on the do-not-touch list):

- `node.exe` has two enabled inbound **Allow** firewall rules — TCP and UDP, `LocalPort: Any`,
  `RemoteIP: Any`, program `C:\program files\nodejs\node.exe` — scoped to the Public profile;
- the active Wi-Fi profile **is** Public (`Get-NetConnectionProfile`);
- therefore that exception, not the default, governs: any `node.exe` listener bound to a
  non-loopback address is reachable from the LAN, and port 3001 qualifies.

This is an inference from bind + rule + program match, **not a demonstrated connection** — a
same-host probe against its own LAN address does not traverse the firewall path. Conway changes
nothing about it.

**Correction recorded, because it matters:** at 22:30 the progress log asserted that PID 15168 on
3001 was a *stale Conway build*. That claim was wrong and is retracted. Ownership was then proved
by **parentage, not by port**: PID 15168's parent (PID 9516) is
`TradingProjects\freellmapi\scripts\freellmapi-service.ps1`, its executable is outside this repo,
and a `Win32_Process` command-line scan for "Conway" matched only the scanning shell itself. The
mistake and its correction are logged in
[`../../reports/PHASE_15_PROGRESS.md`](../../reports/PHASE_15_PROGRESS.md) under "Wrong-claim log".

### Conway-side consequences of that exposure

1. **Never bind Conway to 3001** — the port is occupied by another tool on this host.
2. `src/registry/agent-card.ts:124` calls `server.listen(port)` with no host argument and sends
   `Access-Control-Allow-Origin: *` (line 98). On Windows that binds all interfaces. It is
   **dormant** — `allowExternalExposure` is `false`, the network-exposure path denies it, and no
   agent card server runs in the live install — but it is a real residual risk if activation ever
   enables the registry. Any future listener must bind an explicit loopback address.

## 5. How the Conway controls relate to this audit

| Phase 15 control | Enforcement point | Executed test evidence |
|---|---|---|
| The mechanic may not touch Defender / Firewall / BitLocker / SmartScreen / ACLs | `FORBIDDEN_PATTERNS` in `src/reliability/mechanic.ts`; unknown ids default to forbidden | `phase15-self-healing.test.ts` — 12 forbidden identifiers classify `forbidden` (40/40) |
| The shell cannot retrieve a recovery key even when `shell_execution` is granted | `validateShellCommand` blocks `manage-bde -protectors` and the `*-BitLocker` cmdlets (finding F2) | `phase15-sandbox.test.ts` + `phase15-penetration.test.ts` |
| The sandbox never reads user documents, browser credentials, other AI configs or wallet paths | `isProtectedPath` + `confineToRoot` | `phase15-sandbox.test.ts` — 46/46 incl. `Documents`, `Desktop`, `.ssh`, `.aws`, `.qoder/mcp.json`, Chrome `Login Data` |
| The emergency stop cannot be cleared or bypassed by the agent | `clearEmergencyStop` requires a named human; guards in `daemon.ts` and `executeTool` | `phase15-incident-response.test.ts` — 26/26 incl. zero ticks while engaged |
| No public endpoint | `allowExternalExposure=false` + `network.public_endpoint` denial path | `phase15-tool-security.test.ts`, `phase15-incident-response.test.ts` |

## 6. Recommendations — each needs your explicit decision

1. Verify disk encryption once, manually, elevated (§3). Status only.
2. Because Controlled Folder Access is **off** and encryption is unverified: keep the wallet
   envelope passphrase-managed, keep backups out of `%USERPROFILE%` shares, and treat SMB
   exposure (139/445) as hostile-network-adjacent.
3. If autonomous operation is ever activated, re-run this audit **elevated** to close the
   BitLocker / TPM / Secure Boot evidence gap.
4. Leave the other tools' all-interface listeners alone. If LAN exposure matters, it is the owner
   projects' configuration to change, not Conway's, and not this phase's.

## 7. Status

15H is complete **as a read-only audit**: two categories verified good, one verified absent, and
the disk-encryption question honestly recorded as unverifiable from an unprivileged session. It
contributes residual risk **R-1** to the phase verdict — see
[PHASE_15_OVERVIEW.md](PHASE_15_OVERVIEW.md).
