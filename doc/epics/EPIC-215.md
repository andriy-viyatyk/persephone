# EPIC-215: Linux native helpers and media (multiplatform phase 3)

## Status

**Status:** Active
**Created:** 2026-11-26

## Overview

This is phase 3 of the [multiplatform roadmap](../reviews/multiplatform-roadmap.md). Phase 2
([EPIC-214](EPIC-214.md)) made Persephone a working desktop app on Ubuntu 26.04 GNOME Wayland. Four features are
still switched off on Linux in `src/shared/platform-features.ts`, because each depends on Windows-only code:

| Feature | Linux today | Windows mechanism |
|---|---|---|
| Screen snip (`screen.snip`) | Hidden | `persephone-snip.exe` captures the screen with GDI and draws its own selection overlay (`src/main/snip-service.ts`, `snip-tool/src/capture.rs`, `overlay.rs`) |
| System audio and meeting transcript (`audio.computerCapture`, `audio.computerCancellation`) | Rejected with "supported on Windows only" | Electron display media with `audio: "loopback"` (`permission-policy-service.ts` `installAppDisplayMedia`); the grant and the capture check `process.platform` directly (`audio-service.ts` `validateCapture`, `voice-typing-handlers.ts` `armTranscriptLoopback`) |
| Mneme (`memory.mnemeSidecar`) | Hidden | `mneme.exe` sidecar (`src/main/mneme-service.ts`); the crate is mostly portable but has never been built on Linux |
| Background clipboard history (`clipboard.backgroundWatch`) | Only while Persephone is focused (US-2217) | `persephone-snip.exe clipboard-watch` |

Wayland does not let an app read the screen, system audio or the clipboard on its own; these go through the desktop
portal, PipeWire, or not at all. So the epic starts with a measurement task in the VM that picks the mechanism for
each feature before Codex plans anything.

Inputs: roadmap Phase 3, [inventory](../reviews/multiplatform-2026-11/inventory.md) items WIN-16 (second half), 18,
19, 33 and 34, and EPIC-214's out-of-scope list.

## Goals

- **Exit (roadmap Phase 3):** snip, the system-audio meeting transcript and Mneme work in the Ubuntu 26.04 VM on
  GNOME Wayland, checked against a short checklist.
- Each of the four features is either available on Linux, or stays marked not offered in `platformFeatures` with
  the reason stated in settings, MCP `$help` and the guides. Clipboard history is not offered on Linux (US-2224 decision 3).
- The Rust helpers Linux needs build on Linux from the same crates (`cfg` switches, roadmap decision 5), and the app
  finds them by platform-correct names, not `*.exe`.
- The direct `process.platform` checks for computer audio move into `platformFeatures`; the allowlist shrinks.
- Windows behaviour does not change.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| US-2224 | **Capture mechanisms on GNOME Wayland.** Measure in the VM and record a decision per feature: **snip** — the portal Screenshot call in interactive mode (GNOME's own region picker) versus a portal ScreenCast frame through `desktopCapturer` plus Persephone's own selection overlay, including how the portal consent dialog behaves on repeat use; **system audio** — whether Electron 44's display media gives loopback audio on Linux, whether Chromium lists PipeWire/PulseAudio monitor sources as audio inputs, and which one gives a usable reference for echo cancellation; **background clipboard** — whether any supported route exists on GNOME Wayland (for example a helper on XWayland), or the limit is final. Also install and check the Rust toolchain in WSL and the VM. Decisions go into this epic; implementation tasks below are adjusted from them | Claude | Done 2026-11-26 (decisions below) |
| [US-2225](../tasks/US-2225-linux-rust-helpers/README.md) | **Linux builds of the Rust helpers.** `mneme` and `snip-tool` build on Linux (US-2224 decision 4: for `mneme` only `build.rs` needs the `winres` step skipped off Windows; `snip-tool` needs its Win32 modules behind `cfg`), the helper subcommands Linux does not use left out. One place resolves helper executable names per platform (roadmap decision 1: executable names belong to `platform.ts`), used by `snip-service.ts`, `clip-service.ts`, `mneme-service.ts` and the native-dialog tracker. Build steps added to `doc/linux-development.md`. Windows builds unchanged | Codex (plan + implement), Claude VM check | Done 2026-11-27 (VM: both crates build; snip stub exits 1) |
| [US-2226](../tasks/US-2226-mneme-linux/README.md) | **Mneme on Linux.** US-2224 found the Linux binary already builds and embeds on the CPU. What remains: model provisioning under the Linux data folder, the sidecar started and stopped by `mneme-service.ts`, `memory.mnemeSidecar` on for Linux, and settings text that no longer says Mneme is unavailable. Check that full-text and vector search on the same corpus return the same top results as on Windows, and run the `--with mneme` UI tests in the VM (WIN-34) | Codex (plan + implement), Claude VM check | Planned |
| [US-2227](../tasks/US-2227-snip-linux/README.md) | **Screen snip on Linux.** Per US-2224 decision 1: a Linux backend in `snip-tool` calls the portal Screenshot with `interactive: true`, waits for the `Response` signal on its own bus connection, reads the returned file, writes the PNG to stdout like the Windows tool, and deletes the file. A response code other than 0 means cancelled: exit with no output, so `startScreenSnip` returns `null`. "Snip" hides Persephone's windows first as on Windows; "Snip Persephone" does not. `screen.snip` on for Linux (WIN-18, 33) | Codex (plan + implement), Claude VM check | Planned |
| [US-2228](../tasks/US-2228-linux-system-audio/README.md) | **System audio and meeting transcript on Linux.** Per US-2224 decision 2 this is mostly removing gates: `audio.computerCapture` on for Linux, and the `process.platform` checks in `permission-policy-service.ts` (`installAppDisplayMedia`), `audio-service.ts` (`validateCapture`) and `voice-typing-handlers.ts` (`armTranscriptLoopback`) read `platformFeatures` instead. Computer-audio cancellation uses the same loopback track as its reference; its delay tuning in `echo-tuning.ts` was measured on Windows, so the task measures it in the VM with a PipeWire route from the output into the virtual microphone, and leaves `audio.computerCancellation` off with its reason if it cannot be verified (WIN-19) | Codex (plan + implement), Claude VM check | Planned |
| [US-2229](../tasks/US-2229-hide-clipboard-history-linux/README.md) | **Hide clipboard history on Linux.** Per US-2224 decision 3: a platform feature for clipboard history, off on Linux, read by the settings (the `clipboard.enabled` entry and its section), header quick settings, the MCP `clipboard` node and its help, and the clipboard guide, which says why. `clipboard-service.ts` does not start history on Linux, and the focus-only Linux sampler from US-2217 (`clipboard-history-linux.ts` and its wiring) is removed. A Linux profile that had `clipboard.enabled: true` simply has no history. The file clipboard (`clip-service-linux.ts`) is untouched (WIN-16) | Codex (plan + implement), Claude VM check | Done 2026-11-27 (Windows and VM suites pass) |
| US-2230 | **Phase 3 exit run.** A short checklist in the VM on GNOME Wayland (snip, transcript with system audio, Mneme, clipboard history hidden), the full UI suite on Windows and in the VM, and failures filed as tasks | Claude | Planned |

**Order:** US-2224 (done) decided how US-2227 to US-2229 are built. US-2225 can run alongside it, and US-2226 and
US-2227 need it. US-2226 to US-2229 are then independent of each other. US-2230 is last.

## Capture decisions (US-2224, measured 2026-11-26)

Measured in `persephone-vm`: Ubuntu 26.04, GNOME Shell 50.1 on Wayland, PipeWire 1.6.2 with its PulseAudio server,
Electron 44 (the repo's pinned build), Rust 1.100 already installed. The probes were throwaway scripts outside the
repo.

1. **Snip: the portal Screenshot call in interactive mode.**
   - `org.freedesktop.portal.Screenshot.Screenshot` with `interactive: true` opens GNOME's own screenshot UI
     (Selection, Screen, Window). The `Response` signal returns code 0 and a `file://` URI of a PNG of exactly the
     selected region (a 500×340 drag gave a 501×341 image). Escape returns code 2 and no URI.
   - No permission dialog in this mode. Side effects: GNOME saves the PNG under `~/Pictures/Screenshots/` and also
     puts it on the clipboard.
   - The `Response` signal is sent only to the caller's own bus connection, so `gdbus call` plus `gdbus monitor` cannot
     catch it. The caller must keep its connection open and subscribe before calling. This is why snip needs a small
     native client (US-2227 puts it in `snip-tool`, roadmap decision 5) rather than a spawned `gdbus`.
   - Rejected: non-interactive mode plus Persephone's own selection overlay. It is fast (0.16 s, full screen
     1920×1080), but the first call shows a global "Allow Apps to Take Screenshots?" dialog. Persephone would also need
     its own full-screen overlay window, which Wayland does not let an app place, per monitor.
   - Rejected: a ScreenCast frame through `desktopCapturer`. GNOME's "Share Screen" picker appears on every call,
     because Chromium keeps no restore token.
2. **System audio: Electron's display-media loopback works on Linux as it is.**
   - The display-media handler answered with `{ video: request.frame, audio: "loopback" }`, the same answer
     Persephone gives on Windows. `getDisplayMedia({ video: true, audio: true })` then returned an audio track named
     "System audio".
   - It carried a 440 Hz tone played through `pw-play` (peak RMS 0.141) and was silent without it (RMS 0). No portal
     dialog appeared, because the video is the app's own frame.
   - Chromium does not list PipeWire monitor sources (`Monitor of Dummy Output`) among `enumerateDevices()` audio
     inputs, so the loopback track is the only route, and it is enough.
   - VM note: the VM's default source is `auto_null.monitor` (no sound card). Chromium's "Default" input fails with
     "Could not start audio source"; the "Virtual Mic" device works.
3. **Background clipboard: no supported route on GNOME Wayland, so clipboard history is hidden on Linux.**
   - Mutter 50 offers no data-control protocol, neither `zwlr_data_control` nor `ext_data_control`: `wayland-info`
     lists only `wl_data_device_manager` and primary selection. `wl-paste --watch` refuses.
   - An X11 client on XWayland can read the current clipboard types by polling. But it gets no XFixes owner-change
     events for copies made in Wayland apps, and there is no `TIMESTAMP` target. Detecting a change would mean fetching
     other apps' clipboard content every poll. That depends on a leniency of the XWayland bridge rather than an API,
     and does in the background exactly what Wayland withholds. Rejected.
   - The focus-only history from US-2217 records only copies made while Persephone is focused. A catch-up on focus
     would still keep only the last outside copy per absence.
   - **User decision (2026-11-26):** clipboard history is meant to be a clipboard manager that records everything
     copied. Partial history is confusing, so it is hidden on Linux rather than offered in a reduced form. The file
     clipboard (copy, cut and paste of files, US-2217) is a separate feature and stays.

4. **Mneme and the toolchain: the crate already builds and runs on Linux once `build.rs` skips `winres`.**
   - In the VM, `mneme/build.rs` panics in `winres` ("Failed to compile Windows resources"). With the resource step
     skipped for non-Windows targets (tried in the VM copy only), `cargo build --release` finishes. The result is a
     28 MB `mneme` with ONNX Runtime linked statically, depending only on libc, libm, libgcc_s and libstdc++.
   - `mneme model-update` downloaded and verified the model under `~/.config/persephone/data/mneme/models/`.
     `mneme embed` ran on the CPU provider and returned a 768-dimension unit vector. No DirectML or Windows DLL
     question exists on Linux.
   - `snip-tool` was not built: its `main.rs` and modules are Win32 code, and US-2225 puts them behind `cfg`.
   - Toolchain: Rust 1.100 was already in the VM (`~/.cargo/bin`, on the login-shell PATH). It is now installed in
     WSL too, with rustup's minimal profile. US-2225 documents both in `doc/linux-development.md`.

## Epic-level decisions

From roadmap §4 and §9 and the earlier phases. Only the ones this epic relies on are listed.

1. **The newest Ubuntu only:** 26.04 LTS, x86_64, GNOME on Wayland. Debian is checked in Phase 4, not here.
2. **Checks run in the VM** (`persephone-vm`, see `doc/linux-development.md`), not in WSL: WSL has no portal,
   PipeWire session or GNOME clipboard behaviour worth measuring.
3. **Use the desktop's own consent.** Screen and audio capture go through the portal or PipeWire as the desktop
   intends; no workaround that bypasses a consent dialog, and no `--no-sandbox` or disabled security setting.
4. **Rust helpers are per-platform builds of one crate** (roadmap decision 5). A helper that is missing or fails to
   start never crashes the app: it reports the failure through its feature's existing status path (for Mneme, the
   sidecar status error and the start-failure notification), the same as a missing helper on Windows.
   `platformFeatures` holds what a platform offers, not runtime health (decided at US-2226 review, 2026-11-27).
5. **Platform logic goes through the platform layer.** `platform.ts` and `platformFeatures`; each owner
   (`snip-service.ts`, `audio-service.ts`, `mneme-service.ts`, `clipboard-service.ts`) keeps its job and gets
   per-platform collaborators beside it (refactoring guardrails 3 and 4). The `process.platform` allowlist only
   shrinks.
6. **Not offered is data.** Anything that stays unavailable is marked in `platformFeatures`, and the UI, settings,
   MCP `$help` and guides say why.
7. **Live Linux checks are Claude's** (roadmap decision 9.5). Codex briefs leave runtime and VM checks out.
8. **Windows behaviour must not change.** Every task passes `npm run typecheck`, `npm run lint`, `cargo build
   --release` for a touched crate on Windows, and the affected `test:ui` areas. GitHub Linux CI runs only on demand.
9. **No user-visible Linux release** until Phase 4. Helpers are built for development here; packaging them
   (`extraFiles`, the `.deb` and AppImage) is Phase 4.

## Out of scope

- Packaging the helpers and ONNX Runtime into the `.deb` and AppImage, AppArmor, release CI: Phase 4.
- The Rust launcher and console wrapper stay Windows-only (roadmap decision 4; EPIC-214 measured no need).
- Windows voice typing (`speech.windowsVoiceTyping`) and Windows website sign-in stay not offered.
- Window recording is not in scope; it already captured on Wayland in the US-2212 comparison.

## Concerns

- **Snip leaves GNOME side effects.** The interactive portal saves the PNG under `~/Pictures/Screenshots/` and copies
  it to the clipboard. US-2227 deletes the file it was handed (Windows snip leaves no file); the clipboard copy is
  GNOME's and stays.
- **Echo-cancellation tuning.** The loopback reference exists on Linux, but the delay tuning was measured on Windows
  and the VM has no real speaker or microphone. US-2228 may have to leave cancellation off.
- **ONNX Runtime on Linux.** The prebuilt runtime may need a newer glibc or extra libraries; Ubuntu 26.04 is new
  enough, but the result shapes what Phase 4 has to ship.
- **The UI suite.** Tests for these features use fake devices and may carry `windows` tags; each task says which tags
  it can drop.

## Notes

- 2026-11-26: Created from roadmap Phase 3, the inventory and EPIC-214's out-of-scope list.
- 2026-11-26: US-2224 measured in the VM (decisions above): interactive portal for snip, Electron loopback for system
  audio as it is, no background clipboard watcher (clipboard history is hidden on Linux, user decision), Mneme builds and embeds on Linux. US-2227
  to US-2229 rewritten from them; all three got smaller.
- The user's customer project is never named in these documents.
