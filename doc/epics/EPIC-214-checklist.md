# EPIC-214 checklist: Linux desktop on GNOME Wayland

The Phase 2 exit check from the [multiplatform roadmap](../reviews/multiplatform-roadmap.md). Each line is run by
hand in the `persephone-vm` Ubuntu 26.04 VM (GNOME, Wayland session; see
[linux-development.md](../linux-development.md#ubuntu-vm-desktop-checks)), with a dev build started through
`vm.ps1 app-start`. The owning task makes the line pass; [US-2220](EPIC-214.md) runs the whole list at the end and
records the result.

**Result values:** `pass`, `fail` (file a task), or `not offered` (Linux cannot do it, and the app says so through
`platformFeatures` instead of failing; roadmap decision 9.2).

## Session and window

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 1 | The app runs as a native Wayland client by default (US-2212), and `--ozone-platform=x11` still starts it through XWayland | US-2212 | pass (US-2212) |
| 2 | Starting the app shows the main window, rendered, without any MCP or main-process help | US-2213 | pass (US-2213; re-seen on every restart in the exit run) |
| 3 | The window moves by its title area, resizes from every edge, snaps to half screen with Super+Left/Right | US-2213 | pass (US-2213) |
| 4 | Maximize, restore and minimize from the window buttons; double-clicking the title area maximizes | US-2213 | pass (US-2213) |
| 5 | The dock shows Persephone's icon, not a generic one, and the window groups under it | US-2213 | pass (US-2213, dev desktop entry) |
| 6 | HiDPI: at 200% scaling the window, text and icons are sharp and correctly sized | US-2212 | pass (US-2212) |

## Tray and closing

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 7 | The tray icon appears (AppIndicator), and its menu opens and works | US-2213 | pass (US-2213) |
| 8 | With a tray: closing the window keeps the app running, and the tray brings the window back | US-2213 | pass (US-2213) |
| 9 | Without a tray (AppIndicator extension off): closing the window quits or minimizes; it never leaves an unreachable app | US-2213 | pass after fix (US-2213) |

## Single instance and profiles

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 10 | `persephone <file>` while the app runs opens the file in the running window; no second app starts | US-2214 | pass (US-2214; re-run in the exit run after the `launchOperands` change: 305 ms) |
| 11 | The same with a named profile reaches that profile's instance | US-2214 | pass (US-2214; re-run in the exit run) |
| 12 | Handoff time is measured and recorded in US-2214 | US-2214 | pass (US-2214) |
| 13 | After quit, and after a killed process, the next start works and leaves no stale socket in the way | US-2214 | pass (US-2214) |

## Terminal and external tools

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 14 | "Open in terminal" opens GNOME's terminal in the right folder; a custom terminal command in settings is used | US-2215 | pass (US-2215) |
| 15 | VLC and Tor are found on `PATH` when installed, and reported as missing (not failing) when not | US-2215 | pass (US-2215) |
| 16 | Settings and their comments name no `.exe`, `pwsh`, `cmd` or `mneme.exe` on Linux | US-2215 | pass (US-2215) |

## Browser and board shortcuts

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 17 | Setting Persephone as the default browser registers it through `xdg-settings`; a link from another app opens in it | US-2216 | pass after fix (US-2216) |
| 18 | Another browser set as default afterwards is respected, and Persephone does not take it back | US-2216 | pass (US-2216) |
| 19 | A board shortcut creates a `.desktop` launcher with the board's icon; it starts the board, also with spaces in the path | US-2216 | pass after fix (US-2216) |

## Clipboard and drag and drop

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 20 | Copy files in Persephone, paste in Files (Nautilus); and the reverse | US-2217 | pass (US-2217) |
| 21 | Cut files in Persephone and paste in Files moves them; the reverse too | US-2217 | pass (US-2217) |
| 22 | Drag a file from Persephone to Files and to the desktop; drag a file from Files into Persephone | US-2217 | pass (US-2217) |
| 23 | Clipboard history records copies made while Persephone is focused, and the settings say what Wayland does not allow | US-2217 | pass (US-2217) |

## Notifications, theme, lock

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 24 | A desktop notification appears in GNOME's notification list, and clicking it focuses the app | US-2218 | pass after [US-2222](../tasks/US-2222-notification-click-focus/README.md): shown with app name and icon; a click restores the app and shows the source tab (GNOME and Windows) |
| 25 | Switching GNOME between light and dark changes the app theme when it follows the OS | US-2218 | not applicable: no OS-follow theme mode on any platform (backlog) |
| 26 | Locking the screen is detected; unseen-mode text does not say "Windows" | US-2218 | pass after fix (US-2218) |
| 27 | Virtual-desktop placement and `--desktop` report themselves as not offered | US-2218 | pass after fix (US-2218) |

## Carried over from EPIC-213

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 28 | App shortcuts that GNOME takes for itself are listed, and none of the app's main shortcuts is lost | US-2219 | pass; GNOME takes Ctrl+Shift+Alt+Up/Down (Monaco copy line) (US-2219) |
| 29 | `desktop-awareness` and `minimized-page-visibility` behave on GNOME; their `windows` tag is kept or dropped accordingly | US-2219 | pass on GNOME; `windows` tag kept for WSLg/Xvfb (US-2219) |
| 30 | Emoji and icon glyphs render on stock Ubuntu (no missing-glyph boxes) | US-2219 | pass (US-2219) |
| 31 | The app starts and opens a CP1251 file under a CP1251 locale | US-2219 | pass (US-2219) |
| 32 | Font rendering in the editor and UI is comparable to Windows | US-2219 | pass (US-2219) |
| 33 | The microphone permission flow asks, records and can be denied | US-2219 | pass (US-2219) |

## Whole epic

| # | Check | Owner | Result |
|---|-------|-------|--------|
| 34 | Every feature marked not offered is hidden or explained in the UI, settings, MCP `$help` and guides | US-2220 | pass: virtual-desktop placement, Windows website sign-in, Mneme sidecar and background clipboard history are hidden or explained (US-2215, 2217, 2218, 2221) |
| 35 | The Linux CI job is green and the full Windows suite passes once | US-2220 | Windows half passes: full suite 559 passed, 11 skipped, 1 flaky (published audio-player M3U, passed on rerun). Linux half run in the VM instead of CI (CI is now manual only), production build on GNOME Wayland: 542 passed, 3 failed, 28 skipped. Fixed in tests: settings checkbox (close-to-tray hides without a tray host), window position (Linux restores size only), Tor setup (Linux opens the page). Board-catalog install passed on rerun (flaky). Wake-word synthetic recording: test made platform-neutral (US-2223), passes on both |
