# US-2219: GNOME checks carried over from EPIC-213

Epic: [EPIC-214](../../epics/EPIC-214.md). Owner: Claude (VM checks). Status: checks done, no fixes needed.

## Goal

Run the checks EPIC-213 could not run in WSL or CI because they need a real GNOME desktop
([checklist](../../epics/EPIC-214-checklist.md) rows 28–33), and file what fails.

## Setup

`persephone-vm`: Ubuntu 26.04, GNOME on Wayland, Electron native Wayland, dev build (`npm start`). Real key and
pointer input through `scripts/linux-vm/ptr.sh` (ydotool), app state through the VM MCP tunnel.

## Results (Claude, 2026-11-26)

| Row | Check | Result |
|-----|-------|--------|
| 28 | Shortcuts GNOME takes | **Pass, with one known loss.** Real keypresses reach the app for every keymap entry tried: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+N, Ctrl+W, Ctrl+Alt+] and Ctrl+Alt+[ (theme cycle). Monaco's Linux bindings avoid GNOME's: add cursor below is Shift+Alt+Down on Linux and works. GNOME takes Ctrl+Shift+Alt+Up/Down (move window to workspace), which Monaco uses on Linux for "copy line up/down", so those two editor commands are reachable only through the command palette (F1). VS Code on GNOME has the same loss; not fixed. Other GNOME bindings without Super that the app does not use: Alt+F2/F4/F6/F7/F8/F10, Alt+Space, Alt+Esc, Alt+\` (switch group), Ctrl+Alt+Up/Down (workspace), Ctrl+Alt+Tab, Ctrl+Alt+F1–F12 (session), Ctrl+Alt+Delete, Print. |
| 29 | Minimize-dependent tests | **Pass.** `BrowserWindow.minimize()` works on GNOME Wayland (`minimize` and `restore` events fire, `isMinimized()` is accurate). `core/desktop-awareness` and `core/unseen-mode` pass in the VM (3/3) with the `windows` tag removed locally. The tag stays: WSLg and Xvfb in CI still ignore `minimize()`, and the runner has no tag for "a real window manager". |
| 30 | Emoji and icon glyphs | **Pass.** Color emoji (Noto Color Emoji), skin tones, flags, arrows, math and keyboard symbols, box drawing and Cyrillic render in Monaco and the Markdown preview with no missing-glyph boxes. Cosmetic only: in proportional Markdown text, `❌` takes the text-presentation glyph (a plain ×). |
| 31 | CP1251 locale | **Pass.** With `LANG=LC_ALL=uk_UA.CP1251` the app starts (`app.getLocale()` = `uk`) and a multi-line Windows-1251 file opens as `windows-1251` with correct text. A one-line sample made mostly of rare letters (Ґ, Є, Ї) was guessed as Big5 by jschardet before the locale fallback is consulted; that detection path is identical on Windows, so it is not a Linux defect. |
| 32 | Font rendering | **Pass.** The app stack resolves to Ubuntu Mono (installed on stock Ubuntu), the Linux counterpart of Consolas on Windows; UI and editor text is sharp at the VM's scale. |
| 33 | Microphone permission | **Pass.** With a virtual PipeWire source (the VM has no audio input), a `localhost` page calling `getUserMedia` shows Persephone's "wants permission to access Microphone" bar. Block gives `NotAllowedError` and is stored per origin; Allow records audio (`MediaRecorder`, 16 KB in 1.5 s). |

## Follow-ups

None filed. The Monaco copy-line loss (row 28) and the jschardet short-sample guess (row 31) are recorded here and
need no task.
