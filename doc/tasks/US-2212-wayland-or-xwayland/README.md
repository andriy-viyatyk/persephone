# US-2212: Wayland or XWayland

Epic: [EPIC-214](../../epics/EPIC-214.md). Owner: Claude (measurement). Status: measured, decision recorded.

## Goal

Decide whether Persephone runs on GNOME as a native Wayland client or through XWayland (the X11 compatibility
layer), by running the same dev build both ways in the `persephone-vm` VM and comparing the things the epic depends
on: window chrome, startup, HiDPI, clipboard, drag and drop and screen capture.

## Background

- Electron 44 picks the display backend itself: in a Wayland session it runs as a native Wayland client
  (`--ozone-platform-hint=auto` is the default). Persephone sets no ozone switch (`src/main` has none).
- XWayland is forced with the Chromium switch `--ozone-platform=x11`; `npm start -- --ozone-platform=x11` passes it
  through `scripts/dev.mjs` (arguments after `--` reach Electron).
- The window is frameless with app-drawn title buttons. `open-window.ts` creates it with `show: false` and shows it
  on `ready-to-show`.

## Method

Ubuntu 26.04, GNOME Shell 50.1 (Wayland session), XWayland 24.1, no GPU (Hyper-V), screen 1920x1080. Each mode was
started with `vm.ps1 app-start` or `app-start x11`. The checks used real input through ydotool
([`ptr.sh`](../../../scripts/linux-vm/ptr.sh)), window state read with `main.script.execute`
(`BrowserWindow.getBounds()/isMaximized()/isMinimized()`), full-resolution VM screenshots, and an X11 client
(`xclip`) plus the Files app (Nautilus) as the other side of clipboard and drag-and-drop checks.

## Results

| Check | Native Wayland | XWayland |
|-------|----------------|----------|
| Window appears at startup | **No.** `ready-to-show` never fires for the hidden window; the app runs with no window until `BrowserWindow.show()` is called | Yes |
| Window position known to the app | **No.** Wayland gives clients no global position: `getBounds()` reports x=16, y=10 for a window at about x=484; the compositor places new windows (centred) | Yes |
| Maximize / restore buttons, double-click on the title area | Pass | Pass |
| Move by dragging the title area | Pass | Pass |
| Resize from the window edge | Pass | Pass (the grab zone is only a few pixels wide) |
| Super+Left/Right snap, GNOME snap assistant | Pass | Pass |
| Minimize button, restore from the dock | Pass | Pass |
| Dock icon | Generic gear (no `.desktop` match) | Same |
| 200% scaling | Sharp, correct sizes, follows a live change | Sharp |
| 150% (fractional) scaling | **Sharp** | **Soft.** GNOME gives XWayland scale 2 and shrinks the result |
| Text clipboard, both directions with other apps | Pass | Pass |
| File clipboard (`text/uri-list`, `x-special/gnome-copied-files`) reaching Files; paste copies the file | Pass | Pass |
| App writes the clipboard without recent input to its window | **Dropped silently.** GNOME accepts a selection only after the user interacted with the window | Accepted |
| Drag a file from Files into Persephone (opens it) | Pass | Pass |
| Drag a file out of Persephone | Not testable: no Linux implementation yet (US-2217) | Same |
| Screen capture (`desktopCapturer.getSources`) | GNOME's "Share Screen" picker; one chosen source is returned | Same picker, same result (Chromium uses the portal in a Wayland session either way) |

## Decision

**Native Wayland, Electron's default. No switch in code.** It matches XWayland on window chrome, clipboard, drag in
and capture, and is clearly better at fractional scaling, which most laptop screens use. GNOME no longer ships an X11
session, so Wayland is where the platform goes. Its two problems are fixable or acceptable:

- **Startup show** is a bug in Persephone, owned by US-2213: on Wayland, show the window without waiting for
  `ready-to-show` (or with a short fallback timer).
- **No window position** is how Wayland works. US-2213 restores the saved size on Linux and leaves placement to
  GNOME; saved positions are not applied there (maximized state is not saved on any platform today).

**Fallback:** `--ozone-platform=x11` runs the app through XWayland if a user hits a Wayland problem. It needs no code;
it is documented in [linux-development.md](../../linux-development.md) and, in Phase 4, can go into the `.desktop` file
as an alternative action.

## Consequences for other tasks

- **US-2213:** the startup show and the position rule above; the dock icon needs a `.desktop` file whose name matches
  the app id (`StartupWMClass`).
- **US-2217:** a clipboard write from a script, MCP call or board while the window has not had input is dropped on
  Wayland. User copies (keyboard, menu) are unaffected. Agent-facing clipboard writes should report this rather than
  claim success, and the clipboard-history design must assume no background access either way.
- **US-2218 / Phase 3:** screen capture always goes through the system picker; there is no silent capture on GNOME
  in either mode.
- **US-2219:** `minimized-page-visibility` can rely on `isMinimized()` when minimizing through the app's button;
  minimizing from GNOME (Super+H) still needs checking.

## Acceptance criteria

- [x] Both modes run in the VM from the same build, and every check above has a result for each.
- [x] The choice and its reasons are recorded, with the consequences assigned to their tasks.
- [x] The fallback is documented.

## Files changed

| File | Change |
|------|--------|
| `doc/tasks/US-2212-wayland-or-xwayland/README.md` | This document |
| `scripts/linux-vm/ptr.sh` | New: real pointer and key input in the VM (ydotool) |
| `scripts/linux-vm/vm.ps1` | `app-start x11`; `input-setup`; full-resolution screenshots; `pkill` no longer kills its own SSH command |
| `doc/linux-development.md` | VM command table: `app-start x11`, `input-setup`, `ptr.sh`; XWayland fallback |
| `doc/epics/EPIC-214.md`, `doc/epics/EPIC-214-checklist.md`, `doc/active-work.md` | Decision noted; checklist line 1 reworded |

No application code changes.
