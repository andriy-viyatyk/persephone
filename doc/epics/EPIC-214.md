# EPIC-214: Linux desktop integration (multiplatform phase 2)

## Status

**Status:** Active
**Created:** 2026-11-26

## Overview

This is phase 2 of the [multiplatform roadmap](../reviews/multiplatform-roadmap.md). Phase 1
([EPIC-213](EPIC-213.md)) made the core work on Linux: the UI suite passes in WSL and in GitHub Actions. This epic
makes Persephone behave like a desktop application on Ubuntu: window and tray, a second launch handing files to the
running app, terminal and external tools, default browser and board shortcuts, the file clipboard and drag and drop,
notifications, theme and lock awareness, and settings that stop naming Windows tools.

WSL's GUI support is not a GNOME desktop, so the exit check runs in a Hyper-V Ubuntu 26.04 Desktop VM on GNOME
Wayland (roadmap decision 8). The first task sets that VM up and writes the checklist; the last task runs it. Work in
between is developed in WSL and checked in the VM.

Inputs: roadmap Phase 2, the [inventory](../reviews/multiplatform-2026-11/inventory.md) items WIN-7 to 11, 14 to 17,
30 and 31, and the [runtime findings](../reviews/multiplatform-2026-11/runtime-findings.md) R-4 to R-7. EPIC-213 also
left GNOME-only checks for this epic (see US-2219).

## Goals

- A manual checklist ([EPIC-214-checklist.md](EPIC-214-checklist.md)) passes in the VM on GNOME Wayland. This is the roadmap's Phase 2 exit.
- Closing the window never leaves a running app with no way back: close-to-tray applies only when a tray exists.
- A second `persephone <file>` opens the file in the running app, including with a named profile, and the handoff
  time is measured.
- Every desktop feature that Linux does not offer says so through `platformFeatures`, and the UI, settings, MCP
  `$help` and guides read it, instead of failing when used.
- Settings, their comments and defaults stop naming Windows executables on Linux.
- Windows behaviour does not change.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| [US-2211](../tasks/US-2211-linux-vm-and-checklist/README.md) | **VM and desktop checklist.** Set up a Hyper-V Ubuntu 26.04 Desktop VM (GNOME, Wayland session) that Claude controls over SSH (commands, files, repo sync, Persephone MCP through a tunnel), get a dev build into it, and write the Phase 2 checklist, one line per check, each naming the task that owns it | Claude, with the user for Hyper-V | Done |
| [US-2212](../tasks/US-2212-wayland-or-xwayland/README.md) | **Wayland or XWayland.** Run Electron natively on Wayland and through XWayland in the VM; compare window chrome, drag and drop, clipboard, screen capture and HiDPI. Record the choice and set the default switch. Decides details for US-2213, 2217 and 2218, so it runs early | Claude (measure), Codex (implement the switch) | Done |
| [US-2213](../tasks/US-2213-linux-window-and-tray/README.md) | **Window chrome, tray and close-to-tray.** Frameless window behaviour on GNOME (move, resize, snap, maximize); tray availability detected through `platformFeatures`; close-to-tray only when a tray is present, otherwise closing quits or minimizes (WIN-30, R-5) | Codex (plan + implement), Claude VM check | Planned |
| [US-2214](../tasks/US-2214-linux-single-instance/README.md) | **Single instance, file handoff and profiles.** Electron's single-instance lock and `second-instance` pass files and profiles to the running app; measure the handoff and decide whether a Linux launcher is needed (decision 4, WIN-7). Make the socket cleanup on quit synchronous if leftover sockets matter (R-6) | Codex (plan + implement), Claude VM check | Planned |
| [US-2215](../tasks/US-2215-terminal-vlc-tor/README.md) | **Terminal, VLC and Tor.** Terminal emulator detection and a configurable command with a working directory (WIN-10); VLC and Tor found on `PATH` and labelled without `.exe` (WIN-11); settings comments and defaults stop naming Windows tools (R-7) | Codex (plan + implement), Claude VM check | Active |
| US-2216 | **Default browser and board shortcuts.** Scheme handlers through `.desktop` files with `xdg-settings`/`xdg-mime`, the user's choice respected (WIN-8); board launchers as `.desktop` files with PNG icons and an escaped `Exec` line, replacing the Phase 0 gate (WIN-9, R-3) | Codex (plan + implement), Claude VM check | Planned |
| US-2217 | **File clipboard, drag and drop, clipboard history.** Copy, cut and paste of files through `text/uri-list` and the GNOME cut convention (WIN-15); drag out through Electron `startDrag`, drag in checked (WIN-17); clipboard history limits on Wayland, which allows no background clipboard reads (WIN-16, second half) | Codex (plan + implement), Claude VM check | Planned |
| US-2218 | **Notifications, theme, lock and virtual desktops.** Desktop notifications and OS theme following on GNOME; lock awareness and unseen-mode wording that does not say "Windows"; virtual-desktop placement and `--desktop` report themselves as not offered (WIN-31, WIN-14) | Codex (plan + implement), Claude VM check | Planned |
| US-2219 | **GNOME checks carried over from EPIC-213.** Shortcuts GNOME takes for itself (keymap, decision 7); the minimize-dependent tests (`desktop-awareness`, `minimized-page-visibility`) and whether they can drop their `windows` tag; emoji and icon glyphs on stock Ubuntu (R-4); a start under a CP1251 locale; font rendering; the microphone permission flow | Claude (VM checks), Codex fixes what they find | Planned |
| US-2220 | **Phase 2 exit run.** Run the US-2211 checklist in the VM on GNOME Wayland, record the results in this epic, and file anything that fails as a task | Claude | Planned |
| US-2221 | **Windows sign-in option on Linux.** Settings → Browser Profiles still shows the Windows website sign-in checkbox and its explanation ("send this device's Windows sign-in to Microsoft"); hide them where `browser.windowsSso` is not available (decision 4). Found in the US-2215 VM check | Claude | Planned |

**Order:** US-2211 first; nothing can be checked without the VM. US-2212 next, because the Wayland choice changes how
US-2213, 2217 and 2218 are built. US-2213 to US-2219 are then independent of each other. US-2220 is last.

## Epic-level decisions

From roadmap §4 and §9, plus EPIC-212 and EPIC-213. Only the ones this epic relies on are listed.

1. **The newest Ubuntu only:** 26.04 LTS, x86_64, GNOME on Wayland. No X11 session testing (roadmap decision 9.1);
   XWayland is tested only as a way to run Electron inside the Wayland session (US-2212).
2. **Exit checks run in the VM, not WSL** (roadmap decision 8). WSL stays the development environment and the place
   the UI suite runs locally.
3. **Platform logic goes through the platform layer.** `src/shared/platform.ts` and `platformFeatures`; each
   OS-facing owner keeps its job and gets per-platform collaborators beside it, for example `terminal-launcher.ts`
   with a Linux collaborator (refactoring guardrails 3 and 4). The `process.platform` allowlist only shrinks.
4. **Not offered is data.** A feature Linux cannot match (roadmap §3: virtual-desktop placement, Windows website
   sign-in, Mark-of-the-Web, background clipboard reads on Wayland) is marked in `platformFeatures`, and the UI hides
   or explains it. Nothing fails at the moment of use.
5. **The launcher and console wrapper stay Windows-only** (roadmap decision 4), unless US-2214 measures a slow
   handoff.
6. **Live Linux checks are Claude's** (roadmap decision 9.5). Codex briefs leave runtime and VM checks out.
7. **Windows behaviour must not change.** Every task passes `npm run typecheck`, `npm run lint` and the affected
   `test:ui` areas on Windows, and the Linux CI job stays green. The full Windows suite runs once before the epic
   closes.
8. **No user-visible Linux release** until Phase 4. User guides change only where Windows wording or behaviour
   changes, for example settings labels that stop saying `.exe`.

## Out of scope (later phases)

- Snip, system-audio capture and transcripts, Mneme on Linux: Phase 3.
- The clipboard watcher's Linux backend, if US-2217 keeps history limited to while Persephone is focused: Phase 3.
- Packaging (`.deb`, AppImage), AppArmor and release CI: Phase 4.

## Concerns

- **VM setup needs the user.** Enabling Hyper-V and creating the VM need administrator rights on the user's laptop.
  US-2211 prepares the steps; the user runs the parts that need elevation.
- **Driving the VM.** Claude reaches the dev app's MCP port inside the VM over the Hyper-V network, so MCP has to listen
  beyond localhost there. US-2211 decides how, keeping the default (localhost only) unchanged everywhere else.
- **Wayland limits** may make some checks "not offered" rather than "works". That is accepted (roadmap decision 9.2)
  as long as the feature says so.

## Notes

- 2026-11-26: Created from roadmap Phase 2, the inventory, runtime findings R-4 to R-7 and the open items EPIC-213
  left for the VM.
- 2026-11-26: The VM exists (US-2211): installed unattended, controlled over SSH and `scripts/linux-vm/vm.ps1`,
  dev build running in GNOME Wayland and reachable over MCP. First findings are in the US-2211 document; the main one
  is that the main window never shows on native Wayland (`ready-to-show` does not fire for a hidden window), which
  US-2213 owns.
- 2026-11-26: US-2212 decided **native Wayland** (Electron's default; no switch in code). It matches XWayland on
  window chrome, clipboard, drag in and capture, and is sharp at fractional scaling where XWayland is soft. Its startup
  show bug and the missing window position go to US-2213; clipboard writes dropped without recent input go to
  US-2217. `--ozone-platform=x11` stays as a documented fallback.
- The user's customer project is never named in these documents.
