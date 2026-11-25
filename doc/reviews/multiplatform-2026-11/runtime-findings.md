# Multiplatform runtime findings: 2026-11

This is the runtime addendum to the static [inventory](inventory.md). It records what actually happened when the
development build ran on Linux in EPIC-212.

- **Environment:** WSL Ubuntu 26.04.1 LTS with WSLg (Chromium runs on X11 through XWayland), the dev build
  (`npm start`) as a normal user, driven over MCP.
- **Sources:**
  - [US-2198](../../tasks/US-2198-linux-dev-environment/README.md): bring-up, findings F1–F12;
  - [US-2200](../../tasks/US-2200-linux-startup-blockers/README.md): startup blockers;
  - [US-2201](../../tasks/US-2201-linux-runtime-discovery/README.md): this pass, 2026-11-25.
- **Not covered:** a real GNOME Wayland session, the packaged app and AppArmor. Those wait for the Hyper-V VM and
  Phase 4.

## Summary

- **Works:**
  - **Startup and data:** the dev build starts; the data folder comes from Electron.
  - **Files and editors:**
    - files open, edit and save;
    - Monaco and the grid, Markdown, Mermaid, HTML, SVG, image and archive editors all load;
    - the Windows-1251 fallback decodes;
    - the folder view loads.
  - **Browser, boards and scripting:**
    - the browser editor loads a web page;
    - boards open as a tab and in their own window;
    - shell commands from scripts run through `/bin/sh`.
  - **System:**
    - MCP works;
    - the Unix socket and its crash recovery work.
- **Broken and new (not in the inventory):**
  - the UI test runner cannot launch the app on Linux (R-1);
  - any open native dialog breaks every window-routed MCP call (R-2).
- **Confirmed from the inventory:**
  - WIN-9: the board shortcut API isn't gated (R-3);
  - WIN-29: emoji/icon glyph coverage (R-4);
  - WIN-30: close-to-tray (R-5).

## Findings

| # | Finding | Inventory | Phase |
|---|---------|-----------|-------|
| R-1 | **Fixed in US-2203.** **The UI test suite can't launch its app on Linux.** `npm run test:ui` starts the controller, and the controller forks the test host as an Electron `utilityProcess` (`src/main/test-mode/controller.ts:65`). The test host then spawns the app (`src/test-host/launcher.ts:90`), which dies at once with `FATAL: Zygote process exited prematurely` (SIGTRAP). With `ELECTRON_DISABLE_SANDBOX=1` it gets further, then fails with `GPU process launch failed: error_code=1002`. The same command line started from a shell works (MCP comes up). So Chromium child processes can't start from inside a utility process on Linux. The runner's `--attach` needs an app retained by an earlier `--open` run. `--open` launches the app directly from `integration-test/lib/launcher.mjs`, not through the utility host, so it may work; that wasn't tried (corrected by US-2203). The Windows suite is unaffected. **Cause (US-2203):** Electron's main process sets `CHROME_DESKTOP`, and the spawned app inherits it and dies. The launcher now removes it on Linux, and `core/smoke` passes in WSL. | new (WIN-35 is the executable path, not this) | **1**, first item: nothing else in the Phase 1 exit can be measured until the host can launch the app. Likely fix: on Linux the controller starts the test host as a plain Node child (`child_process.fork` with `ELECTRON_RUN_AS_NODE`) instead of a utility process. |
| R-2 | **Fixed in US-2202.** **Any open native dialog makes MCP unusable on Linux.** `ownerHwnd` (`src/main/native-dialog-tracker.ts:72-74`) reads an 8-byte HWND (`readBigUInt64LE(0)`) from `getNativeWindowHandle()`, but on Linux that is a 4-byte X11 window id. `getNativeDialogAttention` runs on every window-routed MCP call while a dialog is tracked (`src/main/mcp/tools/call-tools.ts`), so every renderer-routed call fails with "Attempt to access memory outside buffer bounds" until the dialog closes. The main-process `windows` root still answers. Seen after `boards.createShortcut` without a `linkPath` opened a save dialog. The dialog helper (`dialog-info` / `dialog-cancel`) is `persephone-snip.exe` anyway, so on Linux the tracker should report "a dialog is open" without inspecting it. | new | **1** (small, high impact: blocks agents and the UI suite whenever a dialog is up) |
| R-3 | `boards.createShortcut` (MCP and script) is not gated: on Linux it reaches the Windows `.lnk` flow. US-2199 hides only the UI. | WIN-9 | 2 (board `.desktop` launchers); a quick gate can land with R-2 |
| R-4 | A glyph on the demo board's counter button renders as a missing-character box. The WSL image has `fonts-noto-core` but no emoji font. Stock Ubuntu Desktop ships `fonts-noto-color-emoji`, so check it in the VM before treating it as a defect. Body text, code and Cyrillic look right. | WIN-29 | 1 (font check), likely no code change |
| R-5 | `window.close-to-tray` is on by default. Closing the window left the process running, still serving MCP and the socket. Whether WSLg showed a tray icon to bring it back was not checked. On stock GNOME there is no tray. | WIN-30, US-2198 F10 | 2: close-to-tray only when a tray is detected |
| R-6 | The socket cleanup on quit is asynchronous. A SIGTERM quit removed `persephone.sock`. A dev instance stopped by `timeout` (SIGTERM during startup) left `persephone-t2201.sock` behind. The stale-socket reclaim at the next start covers it (verified after `kill -9`). | WIN-6 | 2: make the unlink synchronous on `will-quit` if it matters |
| R-7 | `appSettings.json` comments and defaults name Windows tools (`tor.exe`, `vlc.exe`, `pwsh`/`cmd`, `mneme.exe`). | WIN-10, 11, US-2198 F9 | 2 (settings and i18n) |
| R-8 | `fpNormalizeForCompare` and `comparePathKey` treat `\` as a separator on every platform. On Linux, a name containing a backslash compares equal to a nested path. This is rare and did not block anything. | WIN-24 | 1 (paths) |
| R-9 | `app.proc.execute` already runs through `/bin/sh` on Linux (Node's default shell), and `$0` reports `/bin/sh`. The roadmap's "default shell is `/bin/sh`" item is already true for `app.proc`. Check the module-service environment separately. | — | 1: narrow the item |
| R-10 | An unknown-charset file with Windows-1251 bytes decoded correctly. The encoding fallback did not misfire here, but the system locale was not varied. | WIN-27 | 1: keep, lower priority |

## Checked and working

| Area | Result |
|------|--------|
| Text files | Open by POSIX path and by `file:///` URL (with `%20` and `%23`), edit, save, and the disk content matches. A relative path is rejected with a clear message. |
| Editors | `.json` and `.csv` open in Monaco and switch to `grid-json` / `grid-csv`. `.md` opens in `md-view`. `.mmd` switches to `mermaid-view`, `.html` to `html-view` and `.svg` to `svg-view`. `.png` opens in `image-view` and `.zip` in `archive-view`. An archive entry (`arch.zip!readme.md`) opens. |
| Folder view | `pages.openFolder` opens the Explorer folder page. |
| Browser editor | `https://example.com` loads ("Example Domain"). |
| Boards | `boards.createDemoBoard`, `boards.list`, `boards.openBoard` (tab) and `boards.openBoardWindow` (own window) all work. The board UI and its sidebar view render. |
| Scripting | `script.execute` works. `app.proc.execute` runs `uname`, `ls` and pipes through `/bin/sh`. |
| Git | `git` 2.53 runs from scripts; `git init` and `status` work in the walk folder. |
| Single instance | An `OPEN <path>` message over `$XDG_RUNTIME_DIR/persephone.sock` opens the file. A stale socket is reclaimed after `kill -9`. |
| MCP | Every check above ran over MCP from Windows to WSL (port 7875). |
| Startup log | Clean apart from Widevine, Vite and Node deprecation warnings. |

## Not checked in this pass

| Area | Why |
|------|-----|
| Clipboard history, file copy/cut, drag out | History is off by default and its watcher is Windows-only (US-2199 gate). The file clipboard and drag-out are gated the same way. Phase 2 work. |
| Screen snip, Mneme, system audio, voice typing, Windows SSO | Gated off on Linux by US-2199/US-2200; Phase 3. |
| Microphone permission flow | WSLg audio is not representative; check in the VM. |
| Terminal, VLC, Tor, default browser, board shortcuts | Terminal is hidden by the US-2199 gate. The others are Phase 2 desktop integration (the shortcut gap is R-3). |
| Named profiles, `--test --attach`, second launch through Electron's lock | `--test` is blocked by R-1. The other two need a launcher-less command line; check in the VM. |
| Tray icon, notifications, lock awareness, theme following the OS | WSLg is not a GNOME session. VM check (Phase 2). |
| Native Wayland | WSLg runs Chromium on XWayland (US-2198 F4). |
