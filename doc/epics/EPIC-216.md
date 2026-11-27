# EPIC-216: Linux packaging, release and docs (multiplatform phase 4)

## Status

**Status:** Active
**Created:** 2026-11-27

## Overview

This is phase 4, the last building phase, of the [multiplatform roadmap](../reviews/multiplatform-roadmap.md).
Phases 0–3 ([EPIC-212](EPIC-212.md) to [EPIC-215](EPIC-215.md)) brought the development build to parity on Ubuntu
26.04 GNOME Wayland. Nothing has been shipped for Linux yet: every build and release path is still Windows-only.

| Area | Today | File |
|---|---|---|
| Package targets | NSIS and ZIP only; `dist`, `dist:zip` and `dist:publish` pass `--win` | `electron-builder.yml` `win:`, `package.json` scripts |
| Native module | koffi keeps only `win32_x64`; only that binary is unpacked from the asar | `electron-builder.yml` `files`, `asarUnpack` |
| Rust helpers | `extraFiles` lists four `.exe` files at the top level, so every platform would try to bundle them | `electron-builder.yml` `extraFiles` |
| Install integration | `build/installer.nsh` writes "Open with" verbs, the optional `Persephone.Document` type and shortcuts | `build/installer.nsh` |
| DRM signing | `afterSign: scripts/vmp-sign.mjs` picks the `.exe` and runs Castlabs EVS when `VMP_SIGN=true` | `scripts/vmp-sign.mjs` |
| Update notice | Reads GitHub's latest release and links its page (`html_url`); no per-platform asset | `src/main/version-service.ts` |
| Release CI | One `windows-latest` job builds the three crates, VMP-signs and publishes a draft | `.github/workflows/publish.yml` |
| Release process | Windows assets only | `doc/standards/release-process.md`, `.claude/skills/release/` |

Inputs: roadmap Phase 4, [inventory](../reviews/multiplatform-2026-11/inventory.md) items WIN-1 to WIN-5 and
WIN-37, roadmap decision 6 and user decision 6 (Debian), and the "Out of scope" lists of EPIC-214 and EPIC-215.

## Goals

- **Exit (roadmap Phase 4):** a `.deb` (the AppImage was dropped, decision 1), built by the release workflow next to the Windows assets,
  install on a clean Ubuntu 26.04 VM and a clean Debian 13 VM and pass the install checklist. The first Linux release
  itself is published through the normal release process when the user asks (decision 2).
- The Linux packages carry everything the development build has: the Linux `koffi` binary, `mneme` and
  `persephone-snip`, the app's `.desktop` entry and icons. Nothing Windows-only (the launcher, `persephone-test.exe`,
  `installer.nsh`) leaks into them.
- Chromium's sandbox works in both formats on Ubuntu 26.04's AppArmor rules, with no `--no-sandbox` (roadmap
  decision 6).
- The update notice links the download for the user's platform and format.
- User docs say "Windows and Linux": install steps, Linux notes in the guides, README and site.
- Windows packaging and release do not change.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| US-2233 | **Clean install VMs.** A second Hyper-V VM with Debian 13 (GNOME on Wayland), built and driven like `persephone-vm` (SSH key, `vm.ps1` parameters, real input with ydotool). A clean Ubuntu 26.04 VM with no development tools, so a missing runtime library in the packages is not hidden by the dev setup. Each gets a Hyper-V checkpoint "clean" to revert to before every install check. `vm.ps1` gains a VM-name parameter for every command and its `sync` uses Git Bash's `tar`, not WSL's (the EPIC-215 run found `bash -c` resolves to WSL). Documented in `doc/linux-development.md`. Only one VM runs at a time (host memory, see Concerns) | Claude | Not started |
| [US-2234](../tasks/US-2234-linux-package-targets/README.md) | **Linux package targets.** `electron-builder.yml`: `linux:` with `deb` and `AppImage` (x64), artifact names, category, `executableName`, the `.desktop` entry named after `desktopName` (`com.viyatyk.persephone.desktop`, matching the dev entry's `StartupWMClass`), icons from `assets/icon.png` at the sizes the spec needs, and `MimeType` lines for "Open With" (decided in the plan: Windows claims no extensions, so only a generic text and folder set). Per-platform `files`/`asarUnpack` for koffi (`linux_x64` on Linux, `win32_x64` on Windows). `extraFiles` split into `win:` (the four `.exe`) and `linux:` (`mneme`, `persephone-snip`). `.deb` dependencies checked with `dpkg-shlibdeps` against the built binaries. `npm run dist:linux` builds both formats in WSL or the VM. Default-browser registration keeps its own runtime handler (`linux-browser-registration.ts`), so the packaged entry claims no URL schemes | Codex (plan + implement), Claude VM check | Not started |
| [US-2235](../tasks/US-2235-sandbox-apparmor/README.md) | **Sandbox and AppArmor.** Measure in the clean Ubuntu VM first: does the `.deb` start with electron-builder's setuid `chrome-sandbox` under Ubuntu 26.04's unprivileged-user-namespace restriction, and does the AppImage start at all. Then implement what the measurement picks: for the `.deb`, a postinst that sets the sandbox mode and, if needed, installs an AppArmor profile for `/opt/<app>/persephone` (the way Chrome and VS Code ship one); for the AppImage, a clear first-run message with the documented fix if it cannot start sandboxed. Never `--no-sandbox` (WIN-37) | Claude measures; Codex (plan + implement); Claude VM check | Not started |
| US-2236 | **Per-platform signing hook and Linux Widevine.** `scripts/vmp-sign.mjs` returns early on Linux (VMP signing exists only for Windows and macOS) with a log line, and keeps its Windows `.exe` selection unchanged. Claude checks Widevine in the packaged Linux build on one DRM test page (L3, no VMP) and records which kind of site refuses; the result goes into the release notes and the browser guide as a known limit (WIN-2, 5) | Codex (implement), Claude VM check | Not started |
| [US-2237](../tasks/US-2237-update-notice-per-platform/README.md) | **Update notice per platform.** `version-service.ts` picks the asset for the running platform and format from the release's `assets` (Windows: the setup `.exe`; Linux: the `.deb`, or the AppImage when `process.env.APPIMAGE` is set) and the notice links that file, falling back to the release page when the asset is missing. The format check is a platform rule in `platform.ts` or a per-platform collaborator, not a new `process.platform` branch (WIN-4) | Codex (plan + implement), Claude check | Not started |
| [US-2238](../tasks/US-2238-release-workflow-matrix/README.md) | **Release workflow matrix.** `publish.yml` gains an `ubuntu-latest` job: builds `mneme` and `snip-tool` for Linux, runs `npm ci`, `build-prod` and `electron-builder --linux --publish always` into the same draft release, and removes its auto-update files (`latest-linux.yml`) the same way the Windows job removes `latest.yml`. The Windows job is unchanged. `doc/standards/release-process.md` and the `release` skill list the Linux assets and the Linux install check. Run once through `workflow_dispatch` on a branch to a throwaway draft, which Claude deletes | Codex (plan + implement), Claude CI check | Not started |
| US-2239 | **Linux docs.** User guides: Linux notes in the pages the [inventory](../reviews/multiplatform-2026-11/inventory.md) "Guide references" lists (paths, shortcuts, commands); `getting-started.md` install steps for both formats; the not-offered features (§3 of the roadmap) stated where users look for them; a `whats-new.md` entry. Repository README: "Windows and Linux" with download notes. The site (separate repository) gets the same wording and is checked with the user before publishing. `npm run guides:check` passes; new UI text, if any, is translated at epic close | Codex (plan + implement) | Not started |
| US-2240 | **Phase 4 exit run (done 2026-11-27, see Notes).** In both clean VMs, from the "clean" checkpoint: install the `.deb` from the CI test draft and run the install checklist (start, dock icon and window grouping, file handoff from Files and the terminal, default browser, tray fallback on plain GNOME, snip, Mneme, transcript, uninstall leaves settings). Run the UI suite against the installed Ubuntu build with `--app`. On Windows, build the installer and check that it is unchanged. Failures are filed as tasks; Debian-only failures are fixed if small, otherwise listed as known limits in the release notes | Claude | Not started |

**Order:** US-2234 first; everything else needs a package. US-2233 can run alongside it. US-2235 and US-2236 need
US-2234. US-2237 and US-2239 are independent and can run any time. US-2238 needs US-2234 to US-2236. US-2240 is
last.

## Epic-level decisions

From roadmap §4 and §9 and the earlier phases. Only the ones this epic relies on are listed.

1. **Formats (roadmap decision 6, narrowed 2026-11-27):** the `.deb` is the only Linux format and installs to
   `/opt`; built by electron-builder, x86_64 only. The AppImage was built and dropped by user decision (US-2235): on
   Ubuntu it cannot keep the sandbox, and it needs `libfuse2`. No Flatpak, Snap or apt repository.
2. **Nothing is published by this epic.** GitHub Releases only (user decision 4), and the first Linux release goes
   out through the `release` skill when the user asks, after US-2240. CI test runs publish only to a throwaway draft
   that is deleted.
3. **Targets:** the newest Ubuntu LTS (26.04) is supported; Debian 13 is install-checked (user decision 6). Other
   Debian-based distributions may install the `.deb` but are not tested.
4. **The sandbox stays on.** No `--no-sandbox` and no disabled security setting in either format; where Ubuntu's
   AppArmor rules need a profile, the package ships one.
5. **Windows packaging and release must not change.** Every task that touches `electron-builder.yml`,
   `vmp-sign.mjs` or `publish.yml` builds the Windows installer and confirms the same assets.
6. **Live Linux checks are Claude's** (roadmap decision 9.5). Codex briefs leave VM and runtime checks out.
7. **Platform logic goes through the platform layer.** New platform rules live in `platform.ts`,
   `platformFeatures` or a per-platform collaborator; the `process.platform` allowlist only shrinks. Build scripts
   under `scripts/` are outside the app and may check the platform directly.

## Out of scope

- ARM64, other desktops (KDE, Xfce), Flatpak, Snap, an apt repository, the AUR.
- An automatic updater: the update notice stays a notice that links the download.
- Code signing of Linux packages (GPG-signed `.deb` or AppImage signatures); GitHub Releases is the channel.
- macOS (roadmap Phase 5 is rules only).
- Computer-audio echo cancellation on Linux (EPIC-215: stays off until checked on real hardware).

## Concerns

- **Host memory.** Two extra VMs on the laptop that already runs `persephone-vm`, WSL and Persephone. The EPIC-215
  run lost background jobs to memory pressure. Only one VM runs at a time, and each gets a fixed memory size.
- **Cookie encryption on Linux.** The `enableCookieEncryption` fuse uses DPAPI on Windows. On Linux, Chromium uses the
  desktop keyring (GNOME Keyring through libsecret) and falls back to a fixed key when no keyring answers. US-2240
  checks that cookies survive a restart in the installed build on both VMs; the guide states the fallback.
- **AppImage and AppArmor.** Ubuntu restricts unprivileged user namespaces, which an AppImage's sandbox needs, and an
  AppImage cannot install an AppArmor profile itself. If US-2235 finds no clean route, the AppImage ships with a
  documented one-time fix, or is dropped from the first release by user decision. **Resolved 2026-11-27: dropped.**
- **Building on Windows.** electron-builder builds Linux packages reliably only on Linux. `dist:linux` runs in WSL,
  the VM or CI, not in the Windows checkout.
- **Widevine without VMP.** Some streaming sites refuse Linux Chromium without VMP; this is documented, not fixed.
- **The release skill.** Its steps assume Windows assets only; US-2238 updates it, and the first Linux release is the
  first real run of that change.

## Notes

- 2026-11-27: Created from roadmap Phase 4, the inventory and the EPIC-214 and EPIC-215 out-of-scope lists.
- The user's customer project is never named in these documents.
- 2026-11-27 (run 1): US-2233 clean VMs built (`persephone-clean`, `persephone-debian`, both with a `clean`
  checkpoint); `vm.ps1` takes `-Vm` and syncs with Git Bash's `tar`. US-2234 packages build; a platform-level
  `files` list packed the whole repository (fixed, koffi rule uses `${platform}_${arch}`), and Windows output is
  identical to before. `mneme` built on Ubuntu 26.04 needs glibc 2.43 and fails on Debian 13, so release packages
  are built on Ubuntu 24.04 (US-2238 gate at 2.39). US-2235: the `.deb` is sandboxed on Ubuntu 26.04 and Debian 13
  (builder `postinst` AppArmor profile); the AppImage needs `libfuse2` on both, and on Ubuntu its `AppRun` adds
  `--no-sandbox`: user decision pending. US-2236: `vmp-sign.mjs` returns early on Linux (the hook does not run for
  Linux targets anyway); a Widevine-protected stream (Shaka "Angel One", L3, no VMP) plays in the packaged `.deb` on
  Debian 13. US-2237 implemented. US-2238 workflow written; the dispatch check to a throwaway draft is pending.
  Autologin VMs show GNOME's "Choose password for new keyring" prompt on first start, and the browser page waits
  for it; with a normal password login the login keyring opens with the session.
- 2026-11-27 (exit run, US-2240): CI-built `persephone-5.0.23-ci.us2238.1-linux-amd64.deb` (US-2238 dispatch).
  Clean Ubuntu 26.04: installs; sandboxed; dock icon grouped; tray item registered; `file://` and second-instance
  handoff; default-browser registration (`/opt/persephone/persephone %u`) and `xdg-open` handoff; cookies survive a
  restart (GNOME Keyring); Mneme starts and connects; uninstall removes `/opt/persephone`, the AppArmor profile and
  the desktop entry and keeps `~/.config/persephone`. Clean Debian 13: installs, sandboxed, `mneme` runs (glibc
  gate works), file argument opens, uninstall clean. UI suite with `--app` in the dev VM: 401 passed, 146 failed,
  30 skipped; the board and browser failures ran while GNOME's locked-keyring prompt blocked browser pages (dev VM
  autologin). After unlocking, `--rerun-failed`: 128 of 146 pass; the guides test differs because the guides were
  edited after the CI build; 17 board-bridge failures followed one main-process SIGILL crash, and `--area
  boards/bridge` then passed 18/18 (filed as US-2242). Windows assets unchanged (file and asar listings identical;
  CI produced the usual setup and ZIP).
