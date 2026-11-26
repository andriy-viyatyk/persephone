# Persephone multiplatform roadmap — Ubuntu first

**Date:** 2026-11-25 · **Code reviewed at:** `0ab65e57` (branch `upcoming-v5.0.22`) · **Status:** open questions
answered 2026-11-25 (§9). The phases become epics one at a time, like the [refactoring roadmap](refactoring-roadmap.md).

**Goal:** Persephone runs on Ubuntu with the same features as on Windows, or close equivalents, so it can reach
Linux developers. macOS is out of scope, but every decision here keeps a later macOS port possible.

**Evidence base:** [multiplatform-2026-11/inventory.md](multiplatform-2026-11/inventory.md) lists 38 Windows
dependencies (`WIN-1` … `WIN-38`). Each entry gives a file reference, today's Linux outcome, the Linux approach and a
size estimate. The inventory comes from reading the code; nothing has run on Linux yet. Phase 0 adds the runtime
findings.

---

## 1. Verdict

The port is realistic, and most of the app needs no change:

- **Electron and the runtime.** The pinned Castlabs Electron `v44.9.3+wvcus` publishes a `linux-x64` build (checked:
  the release asset downloads).
- **Libraries and editor code.** `koffi` ships Linux binaries. Monaco, the editors, scripting, boards, the browser
  editor, MCP and the test host are plain Electron/Node code.
- **Existing non-Windows branches.** A good share of the code already has them:
  - process trees in `command-runner.ts`;
  - case-preserving paths in `board-file-access.ts`, `path-watch-service.ts` and `board-root.ts`;
  - second-instance argument handling in `main-setup.ts`.

The work falls into four groups:

1. **Windows assumptions in shared code paths.** File URLs, path recognition, browser file-access grants, the
   launcher pipe and taskbar-identity calls (WIN-6, 22–26, 38). These are bugs on Linux, not missing features, and
   most are small.
2. **Desktop integration.** Window chrome, tray, single-instance launch, terminal, default browser, board shortcuts,
   clipboard files and drag and drop (WIN-7–10, 15–17, 30, 31). Each needs a Linux implementation of an existing
   feature.
3. **Native helpers.** The Rust launcher and snip tool are Win32 code. Mneme is mostly portable. Audio loopback and
   screen capture need PipeWire and the desktop portal (WIN-18, 19, 32–34).
4. **Packaging and release.** Linux targets, Ubuntu's AppArmor sandbox restriction, Linux builds in CI and update
   notices (WIN-1–5, 37).

**Size:** five epics of roughly 4–8 tasks each. Phases 0 and 1 give a usable Linux developer build. Phases 2–4 bring
it to parity and ship it.

---

## 2. Scope

| In scope | Out of scope (for now) |
|---|---|
| **The newest Ubuntu LTS only**, currently 26.04 LTS, x86_64, GNOME on Wayland (GNOME has no X11 session since Ubuntu 25.10). The target moves to each new LTS | Older Ubuntu releases (22.04, 24.04) and X11 sessions |
| Other x86_64 distributions that can run the AppImage: they may work, but are not tested or supported | macOS builds, signing and notarization (but see §8) |
| Publishing on GitHub Releases | Other channels: an apt repository, Flathub, the AUR |
| | ARM64 Linux (Raspberry Pi, ARM laptops) |
| Development in WSL2 and testing in a Hyper-V Ubuntu VM on the user's laptop | Flatpak and Snap (their sandboxes fight Persephone's file and process access) |
| Linux CI on GitHub Actions (`ubuntu-latest`, Xvfb) | Azure DevOps pipelines for web-app testing (the user deferred them) |

---

## 3. Feature parity target

"Fully capable" means each Windows feature gets one of four outcomes. A feature marked **not offered** is hidden
from the UI. Its `$help` says why, and its MCP call fails with a clear "not available on Linux" error rather than a
generic one.

| Feature | Windows today | Linux target | Notes / inventory |
|---|---|---|---|
| Editors, scripting, grids, markdown, compare, archives | ✓ | **Same** | Path fixes in Phase 1 (WIN-22–24) |
| Browser editor, profiles, automation, AI vision, web-app tests | ✓ | **Same** | File-access grants (WIN-25); Widevine without verified-media-path (VMP) signing, so some streaming sites may refuse |
| Boards, board windows, board Node scripts | ✓ | **Same** | Board data folder (WIN-12) and the test sandbox (WIN-13) |
| MCP server, agent tools, guides | ✓ | **Same** | Guides need Linux paths and commands (inventory "Guide references"). Works in WSL, except while a native dialog is open (R-2) |
| Integration test runner (`--test`) | ✓ | **Same** | On Linux the app binary writes to the console, so no console-wrapper `.exe` is needed (WIN-32, 35). Today the test host can't launch the app on Linux (R-1) |
| Single instance, opening files into the running app, named profiles | ✓ | **Same** | Electron second-instance or a Unix socket (WIN-6, 7, 38) |
| "Open terminal here" | ✓ | **Same** | Detect `x-terminal-emulator`, `gnome-terminal`, `konsole` and others; configurable (WIN-10) |
| File associations, "Open with", installer shortcuts | ✓ | **Equivalent** | `.desktop` file and MIME types from the `.deb`; the AppImage offers integration on first run (WIN-3) |
| Default browser registration | ✓ | **Equivalent** | `xdg-settings` and `.desktop` scheme handlers (WIN-8) |
| Board desktop shortcuts | ✓ | **Equivalent** | Per-board `.desktop` launchers with PNG icons (WIN-9) |
| Tray, close-to-tray | ✓ | **Equivalent** | StatusNotifier where available; close-to-tray only when a tray is detected (WIN-30) |
| Custom window chrome | ✓ | **Equivalent** | Test frameless windows on GNOME Wayland; native frame as fallback (WIN-30) |
| File copy/cut between Persephone and the file manager | ✓ | **Equivalent** | `text/uri-list` plus the GNOME cut convention (WIN-15) |
| Clipboard history | ✓ | **Equivalent / limited** | Works while Persephone is focused. A Wayland session doesn't let background apps watch the clipboard (WIN-16) |
| Drag files out to the file manager | ✓ | **Equivalent** | Electron `startDrag` (WIN-17) |
| Screen snip | ✓ | **Equivalent** | Desktop-portal Screenshot API, with the system's consent dialog (WIN-18) |
| Microphone, voice typing | ✓ | **Same** | Chromium microphone; check the device permission flow |
| System-audio capture, meeting transcript | ✓ | **Equivalent** | PipeWire/PulseAudio monitor source or portal ScreenCast audio (WIN-19) |
| VLC, Tor | ✓ | **Same** | Find `vlc` and `tor` on PATH; platform-neutral labels (WIN-11) |
| Mneme (local search sidecar) | ✓ | **Same** | Linux build of the crate with CPU ONNX Runtime (WIN-34) |
| Unseen mode, lock awareness | ✓ | **Same / limited** | `setBackgroundThrottling` is cross-platform. Lock events depend on the session (WIN-31) |
| Virtual-desktop placement (`--desktop`) | ✓ | **Not offered** | Wayland has no API for placing a window on a workspace (WIN-14). Accepted 2026-11-25 |
| Windows sign-in for websites (Microsoft accounts) | ✓ | **Not offered** | It relies on a Windows-only sign-in service. Revisit only if Linux users ask (WIN-20). Accepted 2026-11-25 |
| Mark-of-the-Web on downloads | ✓ | **Not offered** | Linux has no equivalent; document it (WIN-21) |

---

## 4. Decisions

These hold for every epic in this roadmap. Each epic restates the ones it relies on.

1. **One platform layer, owned per concern.**
   - `src/shared/platform.ts` is a pure module (no Electron) with the platform identity and the rules that differ:
     path case sensitivity, separator, the primary modifier key, executable names.
   - Each OS-facing main-process owner keeps its job and gets per-platform collaborators beside it: for example
     `terminal-launcher.ts` with `terminal/win32.ts` and `terminal/linux.ts`. The inventory's "Natural platform
     boundaries" section lists these owners.
   - New `process.platform` checks are allowed only in those two places. An ESLint `no-restricted-syntax` rule
     enforces this, with the existing 43 checks on an allowlist that only shrinks.
   - This follows refactoring guardrails 3 and 4: one owner per rule and no growth in large files.
2. **Feature availability is data, not a guess.**
   - One table, `platformFeatures`, says what the current system supports. It sits next to `platform.ts` in the main
     process and reaches the renderer through the object model.
   - The UI, settings, MCP `$help` and guides read it. Nothing checks the platform to decide whether to show a menu
     item.
3. **Paths use Node's own semantics.**
   - `file-path.ts` stays the single renderer path module. It stops turning `\` into `/` on POSIX systems, where a
     backslash is a legal filename character.
   - File URLs go through `fileURLToPath` and `pathToFileURL`. The file-access policy in `src/main` uses the native
     `path` module, not `path.win32`.
   - The data folder always comes from Electron (`app.getPath`), never from `APPDATA` or `LOCALAPPDATA`.
4. **The launcher and console wrapper are Windows-only.**
   - On Linux, Electron's single-instance lock and `second-instance` event already hand arguments to the running app,
     and the Electron binary writes to the console. So `persephone --test` behaves like `persephone-test.exe`.
   - Phase 2 measures how long that handoff takes. A Linux launcher, or a Unix socket in `$XDG_RUNTIME_DIR`, is added
     only if it's slow.
5. **Rust helpers are per-platform builds of one crate**, with code for each OS behind `cfg` switches. A missing
   helper turns its feature off through `platformFeatures`; it never crashes.
6. **The `.deb` is the main Ubuntu format; the AppImage is the portable one.**
   - The `.deb` installs to `/opt` with Chromium's setuid sandbox, which Ubuntu's AppArmor rules allow.
   - The AppImage needs an AppArmor profile or the user's consent. Running without the sandbox (`--no-sandbox`) is
     not the fix.
   - Both formats are built by electron-builder.
7. **Keyboard shortcuts go through one keymap with a primary modifier**: Ctrl on Windows and Linux, Cmd later on
   macOS. Labels come from the same keymap, and shortcuts the desktop takes for itself are checked on GNOME.
8. **Testing has three layers:**
   - WSL2 (Ubuntu, with its GUI support) for development;
   - the integration suite on Linux under Xvfb, both in WSL and in GitHub Actions;
   - a Hyper-V Ubuntu Desktop VM for desktop integration and installer checks.

   Tests that need Windows declare `requires: ["windows"]`. They report "skipped" on Linux, the same way `desktop`
   tests do on a locked screen.
9. **Develop from a separate checkout inside WSL's Linux file system**, for example `~/persephone`. `node_modules`
   holds platform-specific binaries, and `/mnt/c` is slow. The Windows checkout stays as it is.
10. **No user-visible Linux release until Phase 4 is done.** Phases 0–3 ship nothing to users; the Windows release
    cadence is unchanged.

---

## 5. Phases

### Phase 0 — Linux bring-up and the platform layer ([EPIC-212](../epics/EPIC-212.md))

**Exit:** `npm start` works in WSL, the main window opens, and files open, edit and save. The inventory gains a
runtime-findings addendum.

- Development environment: a Linux setup guide (Node, build tools, the WSL checkout), and `scripts/dev.mjs` and the
  build scripts working on Linux.
- Fix what blocks startup:
  - guard `setAppUserModelId` and `setAppDetails` (WIN-38);
  - add the renderer's data-folder fallback (WIN-26);
  - make the pipe server platform-aware (WIN-6);
  - when the mneme or snip binary is missing, turn the feature off.
- Create `src/shared/platform.ts`, `platformFeatures` and the ESLint rule (decisions 1–2).
- Runtime discovery pass: walk through every editor and main feature in WSL and record what breaks. Done 2026-11-25:
  [`multiplatform-2026-11/runtime-findings.md`](multiplatform-2026-11/runtime-findings.md); Phases 1–2 below are
  adjusted from it.

### Phase 1 — Core parity ([EPIC-213](../epics/EPIC-213.md))

**Exit:** the integration suite runs on Linux under Xvfb, and every test without `requires: ["windows"]` passes.

Adjusted from the [runtime findings](multiplatform-2026-11/runtime-findings.md) (2026-11-25):

- **First:** the test host must be able to launch the app on Linux (R-1). Today it runs as an Electron
  `utilityProcess`, and Chromium children can't start from there. Start it as a plain Node child on Linux. Nothing
  else in the exit can be measured until this works.
- The native-dialog tracker must stop reading a Windows HWND on Linux (R-2). Today any open file dialog breaks every
  window-routed MCP call. Gate `boards.createShortcut` in the same change (R-3).

- Paths and files: file-URL and path recognition (WIN-22, 23), separators (WIN-24), browser file-access grants
  (WIN-25), case-sensitive comparisons in the clipboard and elsewhere (WIN-16), and the board data folder and test
  sandbox environment (WIN-12, 13).
- Text: the encoding fallback becomes locale-aware with UTF-8 as the default (WIN-27). Lower priority: a
  Windows-1251 file already decoded correctly in WSL (R-10).
- Fonts with Linux alternatives, checked for layout (WIN-29). Check emoji and icon glyphs on stock Ubuntu Desktop; the
  WSL image lacked an emoji font (R-4).
- Keymap with a primary modifier and its labels (WIN-28, decision 7).
- The module-service environment uses Linux variables. `app.proc` already runs through `/bin/sh` on Linux (R-9).
- Backslash as a separator in path comparison keys (`fpNormalizeForCompare`, `comparePathKey`) only on Windows (R-8,
  WIN-24).
- Test runner and suite: find the Linux binary (WIN-35), make fixtures portable, and tag the tests that need
  Windows (WIN-36).
- GitHub Actions job: build plus the suite on `ubuntu-latest` (development only, no release yet).

### Phase 2 — Desktop integration (epic)

**Exit:** a manual checklist passes in a Hyper-V Ubuntu 26.04 VM, on GNOME Wayland.

- Window chrome, tray and close-to-tray fallback (WIN-30). Close-to-tray is on by default, and closing the window
  leaves a running app with no window (R-5).
- Single instance, opening files into the running app, profiles; measure the handoff (WIN-7, decision 4). The Unix
  socket already works, including stale-socket reclaim (US-2200). Make its cleanup on quit synchronous if leftover
  sockets matter (R-6).
- Terminal detection and settings (WIN-10); VLC and Tor (WIN-11).
- Default browser and scheme handlers (WIN-8); board `.desktop` shortcuts (WIN-9).
- File clipboard and drag and drop (WIN-15, 17); clipboard history limits on Wayland (WIN-16).
- Notifications, theme, lock and unseen-mode wording (WIN-31). `--desktop` reports itself as not offered (WIN-14).
- Decide whether Electron runs as a native Wayland app or through XWayland (the X11 compatibility layer), by testing
  chrome, drag and drop, clipboard and screen capture in both.
- Settings and i18n: platform-neutral labels, and Linux options in the terminal settings. The `appSettings.json`
  comments and defaults name `tor.exe`, `vlc.exe`, `pwsh`/`cmd` and `mneme.exe` (R-7).

### Phase 3 — Native helpers and media (epic)

**Exit:** snip, system-audio transcript and mneme work on Ubuntu 26.04 (Wayland).

- Snip: screen capture through the desktop portal. Either a Linux backend in `snip-tool`, or Electron
  `desktopCapturer` with portal support if that proves enough. The epic decides with a short test of both (WIN-18,
  33).
- System-audio capture through PipeWire/PulseAudio monitor sources; transcript loopback permission (WIN-19).
- Mneme Linux build, ONNX Runtime packaging and a check that search results match Windows (WIN-34).
- The clipboard watcher's Linux backend, if Phase 2 kept history limited to while Persephone is focused (WIN-16).

### Phase 4 — Packaging, release and docs (epic)

**Exit:** Persephone's first Linux release, `.deb` and AppImage, is published next to the Windows build. Installing
it on a fresh Ubuntu 26.04 VM passes the checklist. Published on GitHub Releases only.

- electron-builder Linux targets, the Linux `koffi` binary, Linux helpers in `extraFiles`, and the `.desktop` file,
  MIME types and icons (WIN-1, 3).
- Sandbox and AppArmor for both formats (WIN-37, decision 6).
- Signing hooks per platform: skip VMP signing on Linux, and check Linux Widevine on one streaming test site (WIN-2,
  5).
- Version check chooses the asset for the current platform; the update notice links the right file (WIN-4).
- CI release matrix; update `doc/standards/release-process.md`.
- Docs:
  - Linux notes in the guides listed in the inventory;
  - README and site: "Windows and Linux";
  - `getting-started.md` install steps;
  - `whats-new.md` entry.

### Phase 5 — macOS readiness (rules, no epic)

Nothing is built. The rules in §8 apply from Phase 0 onwards.

---

## 6. Order and dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 4
                 └────► Phase 3 ──┘
```

- Phases 2 and 3 can overlap, because they touch different owners.
- Phase 4 needs Phase 3. There is no early Linux preview: the first Linux release ships at full parity (user decision
  2026-11-25). Packaging tasks may still be prototyped early, but nothing is published before Phase 4 is done.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WSL's GUI support behaves differently from a real GNOME desktop | Bugs found late | Decision 8: every Phase 2 and 4 exit check runs in the Hyper-V VM, not WSL |
| Wayland limits (no window placement, no background clipboard, portal consent dialogs) | Some features can't match Windows | §3 labels them limited or not offered; `platformFeatures` makes it explicit |
| Ubuntu's AppArmor rules block Chromium's sandbox (since 24.04) | AppImage fails to start | `.deb` first; AppImage profile in Phase 4 |
| Castlabs Linux Widevine has no VMP | Some DRM streaming sites refuse | Accept and document it; Persephone is a developer notepad |
| The same feature must now be tested twice | Ongoing cost | Linux CI suite from Phase 1; `requires` tags keep skips explicit |
| `process.platform` checks spread again | Platform logic scattered across the code | ESLint rule and allowlist (decision 1) |
| Paths with backslashes or case-only differences | Data loss risk in file operations | Phase 1 path fixes come with tests for those names |

---

## 8. macOS readiness rules

These cost little now and avoid a rewrite later:

- every OS difference goes through `platform.ts` and `platformFeatures`, which have a `darwin` slot from the start;
- shortcuts use the primary modifier, never a hard-coded Ctrl;
- paths go through `file-path.ts` and Node's `path` and `url` modules;
- Rust helpers are organised with `cfg` switches, not per-OS forks;
- a new feature with OS-specific behaviour states its Linux outcome, and from now on its macOS outcome, in its task
  document.

---

## 9. User decisions (2026-11-25)

1. **Ubuntu version:** the newest Ubuntu only, which is currently 26.04 LTS. The user's WSL distribution is already
   26.04.1 LTS. No 22.04 or 24.04 support, so no build against an older glibc and no X11 session testing.
2. **Parity gaps:** accepted. Windows website sign-in, virtual-desktop placement and Mark-of-the-Web are not offered
   on Linux (§3).
3. **No Linux preview:** the first Linux release ships at full parity, after Phase 4.
4. **Distribution:** GitHub Releases only.
5. **Live Linux checks stay with Claude for now.** Why Codex can't start Persephone (on Windows, and possibly in WSL)
   is a separate question to look at later. Until then, task briefs for Codex leave runtime checks to Claude.
