# ENVIRONMENT AUDIT — PHASE 1

**Project:** Conway Automaton — Windows PC installation, configuration and security hardening
**Phase:** 1 of 14 — Complete System Discovery
**Audit timestamp:** 2026-10-31, approximately 14:35–14:41 local time (UTC+05:30)
**Workspace:** `<user-home>\Downloads\CONWAY AUTOMATON PROJECT`
**Planned install root:** `<repo-root>` (does not exist yet)
**Mode:** Read-only discovery. Nothing was installed, upgraded, uninstalled, reconfigured or restarted. No protected environment was modified. No credentials, keys, tokens or environment variables were read or printed.

> Evidence rule: every result below was produced by an executed command on this machine. Anything not executed is explicitly marked as *not verified*. No command, path, port or dependency has been assumed.

---

## 1. Executive summary

| Area | Finding | Status |
|---|---|---|
| Operating system | Windows 11 Home Single Language 26H2, build 26300.9711, x64 | Pass |
| CPU | Intel Core i7-13650HX, 14 cores / 20 threads | Pass |
| RAM | 31.71 GB total; 13.2 GB free at audit | Pass |
| Storage | 476.94 GB NVMe SSD; C: 221.36 GB free | Pass |
| GPU | NVIDIA GeForce RTX 4050 Laptop, 6 GB, driver 581.86, CUDA 13.0 | Pass |
| Git | 2.56.0.windows.3 | Pass |
| Node.js | v24.18.0 (x64, ABI 137) | Present — compatibility unverified |
| npm | 11.16.0 | Pass |
| pnpm | Not installed | Gap — corepack 0.35.0 available |
| Python | 3.14.6 default; 3.12 and 3.11 also installed | Present — compatibility unverified |
| Docker | Not installed (no client, no daemon) | Gap if officially required |
| WSL2 | WSL optional component **disabled**; VirtualMachinePlatform enabled; no distro | Gap if officially required — needs approval |
| PowerShell | 5.1.26100.9711 only (no PowerShell 7) | Note |
| Internet | GitHub, GitHub API, npm registry, PyPI reachable over HTTPS | Pass |
| Security controls | Defender real-time on; firewall enabled on all profiles; long paths enabled | Pass |
| Ports | 3001 and 11434 occupied by protected services; 3000/4000/5000/8000/8080/8081/8888/9000 free | Note |
| Install target | `<repo-root>` absent | Ready for Phase 3 creation |
| Protected AI environments | Not modified; baseline captured | Pass |

**Phase 1 verdict: COMPLETE.** Discovery evidence was captured on the live machine. There is no Phase 1 blocker, but the correct installation path (native vs WSL2 vs Docker) cannot be chosen until the official support matrix is verified in Phase 2.

---

## 2. Operating system

| Property | Value |
|---|---|
| Caption (`Win32_OperatingSystem`) | Microsoft Windows 11 Home Single Language |
| Edition ID | CoreSingleLanguage |
| Display version | 26H2 |
| Build | 26300.9711 |
| Architecture | AMD64 (x64) |
| Registry `ProductName` | Windows 10 Home Single Language (legacy value; caption and build identify Windows 11) |
| PowerShell | 5.1.26100.9711 |
| PowerShell 7 (`pwsh`) | Not installed |
| Long paths enabled | Yes (`LongPathsEnabled = 1`) |
| Developer Mode | Not enabled |
| Last boot | 2026-10-31 10:27:51 |

**Implications**

- This is a **Home** edition: no Group Policy Editor and no full Hyper-V role. Docker Desktop and WSL2 are still possible on Home, but require the WSL optional component and virtual machine platform.
- PowerShell 7 is absent. Any official script that requires `pwsh` will need PowerShell 7 installed (system-wide change, approval required) or a verified 5.1-compatible path.
- Long paths are enabled, which reduces `MAX_PATH` risk during npm/pnpm installs.

---

## 3. Hardware

### 3.1 CPU

| Property | Value |
|---|---|
| Model | 13th Gen Intel(R) Core(TM) i7-13650HX |
| Physical cores | 14 |
| Logical processors | 20 |
| Base/max clock reported | 2600 MHz |
| Architecture | x64 |

### 3.2 Memory

| Property | Value |
|---|---|
| Total physical RAM | 31.71 GB (32,476 MB visible) |
| Free physical RAM at audit | 13.2 GB |
| Hypervisor present | True |

### 3.3 GPU

| Property | Value |
|---|---|
| Discrete GPU | NVIDIA GeForce RTX 4050 Laptop GPU |
| Discrete VRAM (nvidia-smi) | 6141 MiB (~6 GB) |
| NVIDIA driver | 581.86 |
| CUDA version | 13.0 |
| Integrated GPU | Intel(R) UHD Graphics |
| Intel driver | 32.0.101.7026 |
| WDDM | Yes |

Note: WMI `AdapterRAM` reports 4,293,918,720 bytes for the NVIDIA GPU; this is a known 32-bit WMI reporting artifact. `nvidia-smi` reports 6141 MiB, which is treated as authoritative.

### 3.4 Storage

| Volume | Type | Size | Used | Free |
|---|---|---|---|---|
| C: | KIOXIA KBG60ZNT512G NVMe SSD, NTFS | 475.11 GB | 253.75 GB | 221.36 GB |

---

## 4. Toolchain

| Tool | Version | Location / status |
|---|---|---|
| Git | 2.56.0.windows.3 | `C:\Program Files\Git\cmd\git.exe` |
| Node.js | v24.18.0 (x64, ABI 137, V8 13.6.233.17-node.50) | `C:\Program Files\nodejs\node.exe` |
| npm | 11.16.0 | `C:\Program Files\nodejs\npm.cmd` |
| pnpm | **not installed** | `INFO: Could not find "pnpm"` |
| yarn | **not installed** | `command not found` |
| bun | **not installed** | `command not found` |
| corepack | 0.35.0 | Bundled with Node 24 |
| Python (default) | 3.14.6 | `C:\Python314\python.exe` (first on PATH) |
| Python (launcher) | 3.12, 3.11 also registered | `py -0p` |
| pip | 26.2.1 (Python 3.14 user site) | `C:\Python314\Scripts\pip.exe` |
| nvm | **not installed** | `nvm` not found |
| winget | 1.29.380 | Available |
| Chocolatey | 2.7.3 | Available |
| Scoop | **not installed** | `command not found` |
| Visual Studio Build Tools | 2026 | `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` |
| `cl.exe` on PATH | No | Normal for Build Tools installations |
| npm global prefix | `<user-home>\AppData\Roaming\npm` | User-scoped |
| npm registry | `https://registry.npmjs.org/` | Default |
| Git HTTP proxy | Not configured | Direct connection |

**Implications**

- Node 24 is current-generation; whether Conway Automaton supports it must be verified in Phase 2. A pinned LTS runtime may be required and will be isolated if so.
- pnpm is absent. If officially required, the least invasive options are corepack activation or a project-local installation; both will be evaluated in Phase 4. No change was made now.
- Python 3.14 is very new. Phase 2 must confirm whether the project needs Python at all and, if so, which version. Python 3.12/3.11 are available as fallbacks.
- Visual Studio Build Tools 2026 are present, which is the usual prerequisite for native Node addons on Windows. No compiler was invoked.

---

## 5. Virtualization and container runtime

### 5.1 WSL

| Check | Result |
|---|---|
| `wsl.exe` present | Yes |
| Default WSL version | 2 |
| Installed distributions | None |
| `Microsoft-Windows-Subsystem-Linux` optional feature | **Disabled** (`InstallState = 2`) |
| `VirtualMachinePlatform` optional feature | Enabled (`InstallState = 1`) |
| Full Hyper-V | Not available/reported (Windows Home) |
| `HypervisorPresent` | True |
| `wslservice` process | Running |

`wsl --status` reported:

```text
Default Version: 2
WSL1 is not supported with your current machine configuration.
Please enable the "Windows Subsystem for Linux" optional component to use WSL1.
```

### 5.2 Docker

| Check | Result |
|---|---|
| Docker CLI | Not installed (`docker: command not found`) |
| Docker daemon | Not installed / not reachable |
| Docker contexts | None |
| Docker Desktop | Not detected |

**Implications**

- A **native Windows installation** avoids enabling new Windows features, but is only acceptable if officially supported in Phase 2.
- A **WSL2-based installation** requires enabling the WSL optional component (administrator, reboot likely) and installing a distribution. This is a system-wide change and must be approved before execution.
- A **Docker-based installation** requires installing Docker Desktop (system-wide) or a Docker engine inside WSL2. Docker Desktop installation is a system-wide change and must be approved.
- No virtualization feature was changed in Phase 1.

---

## 6. Network connectivity

| Endpoint | Result | Latency |
|---|---|---|
| `https://github.com` | HTTP 200 | 0.46 s |
| `https://api.github.com` | HTTP 200 | 0.15 s |
| `https://registry.npmjs.org` | HTTP 200 | 0.15 s |
| `https://pypi.org/simple/` | HTTP 200 | 12.41 s (slow, functional) |
| DNS resolution | `github.com` → 20.207.73.82 | Router DNS `reliance.reliance` |

**Implications**

- Required public sources are reachable. GitHub API access works, which supports Phase 2 verification of repository metadata, releases, advisories and commits.
- PyPI latency was high in one sample. If Python dependencies are required, installation should use retries and a generous timeout.
- No HTTP proxy is configured for Git or npm.

---

## 7. Listening ports and processes

### 7.1 Relevant listening ports

| Address:Port | PID | Process | Classification |
|---|---|---|---|
| `:::3001` | 15168 | node.exe | **Protected — user-declared FreeLLMAPI endpoint; not contacted** |
| `127.0.0.1:3002` | 20888 | node | Other local node service |
| `127.0.0.1:3457` | 21236 | node | Other local node service |
| `127.0.0.1:3601` | 17888 | node | Other local node service |
| `127.0.0.1:11434` | 13708 | ollama.exe | **Protected — existing Ollama; read-only model listing only** |
| `0.0.0.0:20128` | 18000 | node | Other local node service |
| `127.0.0.1:20131` | 18000 | node | Other local node service |
| `127.0.0.1:20132` | 18000 | node | Other local node service |
| `127.0.0.1:49535` | 13236 | ollama app.exe | **Protected — Ollama desktop helper** |
| `127.0.0.1:49375` | 23324 | opencode-cli.exe | **Protected — OpenCode** |
| `127.0.0.1:53941` | 8896 | OpenCode.exe | **Protected — OpenCode** |
| `127.0.0.1:57517` | 8896 | OpenCode.exe | **Protected — OpenCode** |
| `127.0.0.1:58955` | 8896 | OpenCode.exe | **Protected — OpenCode** |
| `127.0.0.1:61884` | 28912 | Qoder.exe | **Protected — Qoder** |
| `135`, `139`, `445`, `5040`, `7680`, `49664`–`49672`, `50131`, `42050` | system services / OneDrive | Windows services | OS-owned |

### 7.2 Port availability for a future isolated service

| Port | State |
|---|---|
| 3000 | Free |
| 4000 | Free |
| 5000 | Free |
| 8000 | Free |
| 8080 | Free |
| 8081 | Free |
| 8888 | Free |
| 9000 | Free |
| 3001 | **Occupied (protected)** |

**Implications**

- Conway Automaton must **not** bind port 3001 or 11434, and must not reuse the running services.
- The final port choice will be based on the verified official defaults. If the default conflicts with 3001, an isolated override will be configured and documented. No port was changed in Phase 1.

### 7.3 Process baseline

| Process family | Count |
|---|---|
| node | 41 |
| Qoder | 13 |
| OpenCode | 6 |
| opencode-cli | 1 |
| ollama | 1 |
| ollama app | 1 |
| wslservice | 1 |

Top RAM consumers at audit: Memory Compression 1,374 MB; `opencode-cli` 829 MB; ChatGPT Classic 674 MB; Defender (`MsMpEng`) 449 MB; OpenCode 447 MB; explorer 382 MB.

### 7.4 Local Ollama inventory (read-only)

The local Ollama API (`GET /api/tags`) returned:

| Model | Parameters | Quantization | Context |
|---|---|---|---|
| `qwen3:8b` | 8.2B | Q4_K_M | 40,960 |
| `qwen2.5-coder:1.5b` | 1.5B | Q4_K_M | 32,768 |
| `qwen2.5-coder:7b` | 7.6B | Q4_K_M | 32,768 |

No model was loaded, pulled, modified or deleted. This inventory is context only; Phase 2 must confirm whether Conway supports local inference and whether it can use an independent Ollama endpoint without altering the existing installation.

---

## 8. Protected AI environment baseline

The following were detected and are treated as **immutable** for this project. No configuration, service, model or process belonging to them was modified.

| Environment | Evidence | Protection status |
|---|---|---|
| FreeLLMAPI (`localhost:3001`) | Port 3001 listening, PID 15168 (`node.exe`) | Protected — not contacted, not modified |
| Ollama | PID 13708 + desktop helper PID 13236; models listed above | Protected — read-only inventory only |
| OpenCode | PIDs 8896 (GUI) and 23324 (CLI) | Protected — not contacted, not modified |
| Qoder | PID 28912 plus 13 processes | Protected — not modified |
| OmniRoute / OmniRoad | Not probed in Phase 1 | No change made |
| TradingAgents projects | Not probed in Phase 1 | No change made |
| ADRE-RN projects | Not probed in Phase 1 | No change made |
| Paperclip | Not probed in Phase 1 | No change made |
| Existing MCP servers | Not probed in Phase 1 | No change made |
| Existing Windows services / startup | Only OS-owned listening services observed | No change made |
| Existing unrelated environment variables | Deliberately not read | No change made |

Deliberate limitation: protected projects were not searched or hashed in Phase 1. This avoids reading credentials or triggering file watchers. A read-only checksum baseline can be added later if you want drift detection.

---

## 9. Security posture

| Control | Observed state |
|---|---|
| Microsoft Defender antivirus service | Enabled |
| Defender real-time protection | Enabled |
| Defender signature version | 1.463.52.0 |
| Windows Firewall — Domain profile | Enabled |
| Windows Firewall — Private profile | Enabled |
| Windows Firewall — Public profile | Enabled |
| Firewall default inbound action | `NotConfigured` on all profiles (effective policy not audited in this phase) |
| Long paths | Enabled |
| Developer Mode | Disabled |

No security control was disabled, relaxed or bypassed. All later phases must preserve these settings.

Not verified in Phase 1 (requires elevation or a separate audit): Defender attack-surface-reduction rules, Controlled Folder Access, SmartScreen reputation settings, BitLocker status, UAC configuration, installed security products, Windows Update state.

---

## 10. Workspace and planned installation location

| Path | State |
|---|---|
| `<user-home>\Downloads\CONWAY AUTOMATON PROJECT` | Exists; was empty before this report |
| `...\reports\` | Created by this phase for audit output |
| `<projects-root>` | Does not exist |
| `<repo-root>` | Does not exist |
| npm global prefix | `<user-home>\AppData\Roaming\npm` |

The planned install root will be created during Phase 3 only after the official repository and supported installation method are verified. Reports currently live in the workspace so that the installation directory remains untouched until Phase 3.

---

## 11. Dependency requirements — pending Phase 2

The exact dependency set is **not asserted in this phase**. The master prompt forbids assuming undocumented commands, versions and repositories, and Phase 2 exists specifically to verify them against official sources.

The following categories will be confirmed from the verified official repository and documentation:

1. Supported Windows versions and architectures.
2. Supported Node.js major version and package manager (npm/pnpm/yarn) with lockfile.
3. Native build prerequisites (MSVC, Windows SDK, node-gyp, Python).
4. Database or persistent storage requirements (SQLite/Postgres/Redis/etc.).
5. Container or WSL2 support, if any.
6. Required AI providers, authentication method and model identifiers.
7. Wallet/key-management libraries and storage mechanism.
8. Treasury/payment dependencies and supported networks/tokens.
9. Service ports, bind addresses and configuration files.
10. Required environment variables and their secret/non-secret split.
11. Install scripts and post-install hooks that must be reviewed before execution.
12. License, release version, current commit and known vulnerabilities.

Until that verification is complete, the environment is judged **present but not yet matched** to the project.

---

## 12. Risk register for subsequent phases

| ID | Risk | Evidence | Mitigation / gate |
|---|---|---|---|
| R1 | Official install may require WSL2 or Docker | WSL feature disabled; no distro; Docker absent; Windows Home | Determine support in Phase 2; enabling WSL2 / installing Docker Desktop requires explicit approval and likely reboot |
| R2 | Node 24 may be newer than supported | Node v24.18.0 installed | Phase 2 checks supported engines; pin an isolated runtime if needed |
| R3 | Python 3.14 may break tooling | Default Python 3.14.6 | Confirm whether Python is required; use isolated 3.11/3.12 environment if so |
| R4 | pnpm may be required but is absent | `pnpm` not found; corepack 0.35.0 present | Verify package manager in Phase 2; use corepack or project-local install in Phase 4 |
| R5 | Port 3001 is occupied by protected FreeLLMAPI | PID 15168 listening on 3001 | Never use 3001; verify Conway default port and configure an isolated port if needed |
| R6 | Reusing the existing Ollama installation could violate isolation | Ollama on 11434 with 3 models | Treat as read-only reference; only use an independent configuration if officially supported |
| R7 | Official scripts may assume PowerShell 7 | Only PowerShell 5.1 installed | Inspect scripts in Phase 2; install pwsh only with approval if required |
| R8 | 6 GB VRAM limits local model size | RTX 4050 Laptop, 6141 MiB | Prefer remote API or smaller quantized models if local inference is required |
| R9 | Elevated operations may be needed | Windows Home; system-wide tools absent | Request approval before any system-wide install or security change |
| R10 | Official project identity is unverified | Phase 2 not yet executed | Verify repository, release, commit and license before cloning or running anything |

No risk in this register has been acted on. All are informational for the next phase.

---

## 13. Evidence appendix

Commands were executed read-only. Key commands and captured results:

```text
# OS
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  ProductName: Windows 10 Home Single Language (legacy)
  Edition: CoreSingleLanguage
  DisplayVersion: 26H2
  Build: 26300.9711
Get-CimInstance Win32_OperatingSystem
  Caption: Microsoft Windows 11 Home Single Language

# CPU / memory / GPU
Get-CimInstance Win32_Processor
  Name: 13th Gen Intel(R) Core(TM) i7-13650HX; Cores: 14; Logical: 20
Get-CimInstance Win32_ComputerSystem
  HypervisorPresent: True; TotalPhysicalMemory: 31.71 GB
nvidia-smi
  NVIDIA-SMI 581.86; Driver 581.86; CUDA 13.0; RTX 4050 Laptop; 6141 MiB

# Storage
Get-Volume / Get-PhysicalDisk
  C: NTFS 475.11 GB, 221.36 GB free; KIOXIA NVMe SSD

# Toolchain
git --version        -> 2.56.0.windows.3
node --version       -> v24.18.0
npm --version        -> 11.16.0
pnpm --version       -> not found
corepack --version   -> 0.35.0
python --version     -> Python 3.14.6
py -0p               -> 3.14, 3.12, 3.11
pip --version        -> pip 26.2.1
powershell $PSVersionTable.PSVersion -> 5.1.26100.9711
winget --version     -> 1.29.380
choco --version      -> 2.7.3
VS Build Tools 2026  -> C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools

# Virtualization / containers
wsl --status         -> Default Version: 2; no distributions installed
Win32_OptionalFeature:
  VirtualMachinePlatform            InstallState = 1 (enabled)
  Microsoft-Windows-Subsystem-Linux InstallState = 2 (disabled)
docker --version     -> command not found

# Network
curl https://github.com          -> HTTP 200 (0.46 s)
curl https://api.github.com      -> HTTP 200 (0.15 s)
curl https://registry.npmjs.org  -> HTTP 200 (0.15 s)
curl https://pypi.org/simple/    -> HTTP 200 (12.41 s)

# Ports (selected)
Get-NetTCPConnection -State Listen
  3001  node (PID 15168)   PROTECTED
  11434 ollama (PID 13708) PROTECTED
  3000/4000/5000/8000/8080/8081/8888/9000 -> free

# Security
Get-MpComputerStatus -> AMServiceEnabled True, RealTimeProtectionEnabled True
Get-NetFirewallProfile -> Domain/Private/Public Enabled True
LongPathsEnabled -> 1
```

---

## 14. Phase 1 conclusion

- **Phase 1 status: COMPLETE.**
- **Changes made:** only this report and its `reports\` directory. No software installed, no services changed, no existing AI environment touched.
- **Environment readiness:** hardware and core toolchain are sufficient for a Node-based agent platform. The main open questions are official OS/runtime support, the required package manager, and whether WSL2 or Docker is required.
- **Next phase:** Phase 2 — Official Source Verification. It will identify and verify the official repository, documentation, license, current commit, release, dependency list, known vulnerabilities and installation requirements. No installation will occur in Phase 2.

If you have the original article URL or the exact official repository URL, provide it before Phase 2 to eliminate any chance of identifying the wrong project. Otherwise Phase 2 will locate and cross-verify the official source independently.
