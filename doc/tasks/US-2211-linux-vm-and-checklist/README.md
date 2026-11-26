# US-2211: Ubuntu VM with agent control, and the Phase 2 checklist

Epic: [EPIC-214](../../epics/EPIC-214.md). Owner: Claude, with the user for the one elevated step.

## Goal

A Hyper-V Ubuntu 26.04 Desktop VM (GNOME on Wayland) that Claude controls fully from Windows: start, stop and reset
it, run shell commands, read and edit files, sync the repo, start a dev build in the GNOME session, and drive that
build over MCP. Then the Phase 2 checklist, written from the epic goals.

## Background

- Hyper-V is already enabled on the laptop (WSL2 runs on it; `vmms` is running). 31 GB RAM, 16 logical CPUs.
- The user's account is not in the local **Hyper-V Administrators** group, so `Get-VM` is denied. Adding it is the
  only step that needs elevation; after it, every Hyper-V cmdlet works without elevation.
- Windows ships the OpenSSH client (`C:\WINDOWS\System32\OpenSSH\ssh.exe`).
- The WSL setup (`doc/linux-development.md`) is the model for the dev environment inside the VM: a Linux checkout,
  Node 24, `npm ci`, and `node node_modules/electron/install.js`.

## Design: control channel

**SSH, not a custom service.** The user asked for a tool on both sides that lets Claude edit files and run commands
in the VM. OpenSSH already is that tool: `ssh persephone-vm '<command>'` runs any command, `scp`/`rsync` copy files,
and a key-only login on the Hyper-V internal network is far safer than a new listener we would have to authenticate
and harden ourselves. No new code is needed on either side.

- **Persephone's MCP** stays localhost-only inside the VM. An SSH tunnel (`ssh -L 7875:localhost:7875 persephone-vm`; the port number must match, because the MCP server checks the Host header)
  brings it to Windows, so the existing MCP helpers work unchanged. This resolves the epic concern about MCP
  listening beyond localhost.
- **GUI session:** the VM user logs in automatically to GNOME on Wayland. Commands that must run inside that session
  (starting the dev app) run through `systemd-run --user` with the session's `WAYLAND_DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`,
  so the app appears on the real desktop.
- **Reset:** a Hyper-V checkpoint `clean` after setup; restoring it gives a known state for installer checks (Phase 4).
- **Later:** if Persephone itself should offer "run this on a Linux machine" to agents, that is a separate feature
  idea built on the same SSH channel; not part of this task.

## Plan

1. **User (once, elevated PowerShell):** `Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "$env:USERDOMAIN\$env:USERNAME"`,
   then sign out and back in. If corporate policy forbids local group changes, fall back to the user running the
   VM-creation script elevated (step 3) and the start/stop commands as needed.
2. **ISO:** `ubuntu-26.04.1-desktop-amd64.iso` from releases.ubuntu.com, SHA256 checked, in
   `%USERPROFILE%\VMs\iso\`.
3. **Create the VM** (Claude, PowerShell): Generation 2, name `persephone-vm`, 4 vCPU, 8 GB dynamic memory, 80 GB
   dynamic VHDX under `%USERPROFILE%\VMs\persephone-vm\`, `Default Switch` (NAT; the host reaches the guest as
   `persephone-vm.mshome.net`), Secure Boot with the `MicrosoftUEFICertificateAuthority` template, ISO as first boot
   device, enhanced session off (the check must see the real GNOME session).
4. **Install Ubuntu:** try an unattended install (autoinstall.yaml: user `dev`, hostname `persephone-vm`,
   `openssh-server`, Claude's public key, automatic login). If the desktop installer cannot be pointed at it without
   console input, the user clicks through the installer (about 5 minutes) and runs one bootstrap command Claude
   gives them. Claude tells the user exactly which.
5. **SSH:** key `~/.ssh/persephone-vm` (ed25519, no passphrase, used only for this VM); `~/.ssh/config` host alias
   `persephone-vm`; password login disabled in the guest.
6. **Dev environment in the VM:** Node 24, build tools, `git`, the repo synced from Windows (rsync over SSH, the same
   excludes as the WSL `sync.sh`), the `persephone-boards` checkout, `npm ci`, Electron install. Start `npm start`
   in the GNOME session and reach MCP through the tunnel.
7. **Checkpoint** `clean` (after step 5, before the dev setup) and `dev-ready` (after step 6).
8. **Agent notes:** a short Claude-side reference (commands for start/stop/checkpoint, run, sync, start app, tunnel)
   so later sessions do not rediscover them. Developer doc: a "Linux VM" section in `doc/linux-development.md`.
9. **Checklist:** `doc/epics/EPIC-214-checklist.md`, one line per check from the epic goals and US-2219, each naming
   its owning task.

## Concerns

- **Corporate policy** may block the group change or Hyper-V use by a non-admin; step 1 has a fallback.
- **Default Switch IP changes on reboot;** the `mshome.net` name follows it. If name resolution fails, read the IP
  with `Get-VMNetworkAdapter` and pass it to SSH.
- **No PII:** the VM holds only synthetic test data; the VM password is generated locally and given to the user,
  never written to the repo.

## Acceptance criteria

- [x] `ssh persephone-vm 'uname -a'` works from Windows without a password.
- [x] Claude can start, stop and restore the VM from Windows without elevation.
- [x] A dev build runs in the VM's GNOME Wayland session and answers MCP through the tunnel.
- [x] Checkpoint `dev-ready` exists (no `clean` one: the setup ran straight through; a fresh install is the reset).
- [ ] The checklist exists and every line names its owning task.

## Progress (2026-11-26)

- Done: steps 1–8. The VM was installed unattended (8 minutes). The control layer is [`scripts/linux-vm/vm.ps1`](../../../scripts/linux-vm/vm.ps1) and [`mcp-call.mjs`](../../../scripts/linux-vm/mcp-call.mjs); the setup is documented in [linux-development.md](../../linux-development.md#ubuntu-vm-desktop-checks).
- Deviations from the plan: the Default Switch DHCP does not answer on this host, so the VM uses a static address (`<switch network>.50`) instead of `persephone-vm.mshome.net`; `vm.ps1 fix-network` re-addresses it after a host reboot. The tunnel keeps port 7875.
- Open: step 9, the checklist.

## Findings for later tasks

- **Main window never shows on native Wayland (US-2213).** `open-window.ts` creates the window with `show: false` and shows it on `ready-to-show`. On native Wayland a hidden window never paints, so the event never fires: the app runs, MCP answers, the tray icon appears, and `windows[0].focus()` does not help. `BrowserWindow.show()` from the main process displays a correctly rendered window.
- **Generic dock icon (US-2213/US-2216).** The dock shows a gear: no `.desktop` entry matches the app id.
- **Tray exists on stock Ubuntu** through the AppIndicator extension (relevant to R-5, US-2213).
- **Electron runs as a native Wayland client by default** here (ozone/wayland in the log), with `drmGetDevices2` errors and no GPU (US-2212).
- **Chromium setuid sandbox** must be root-owned after `npm ci` (Ubuntu 26.04 AppArmor), as in CI; Phase 4 packaging must set it.
