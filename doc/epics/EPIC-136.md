# EPIC-136: Boards as standalone apps

## Status

**Status:** Completed 2026-11-03
**Created:** 2026-11-02
**Completed:** —

## Overview

A board can run in its own Persephone window that looks like a standalone program: the board's
icon and name appear on its locked tab, with no sidebar, MCP/Mneme indicators or `...` menu, and
with its own taskbar entry. The user starts it by double-clicking a Windows shortcut (`.lnk`) that
Persephone creates in the board folder, on the desktop, or wherever the user saves it.

The window is **not** a new kind of host. It is an ordinary Persephone window running the full
app in a **board mode**, so the board keeps everything Persephone offers: it can open text,
Markdown, grids, dialogs, and any other page. The locked board tab is always shown flush left;
when it is the only page, it is drawn without a tab border or background. The board tab can't be
closed or dragged. Closing the window closes the board.

## Goals

- `persephone.exe --board <folder>` (through `persephone-launcher.exe`) opens the board in a
  board-mode window, or focuses that board's window if one is already open.
- Board-mode windows look like the board's own app: its icon, name and taskbar entry.
- A board can create a Windows shortcut that launches it this way.

## Design decisions (2026-11-02, agreed with the user)

1. **Same window class, board mode.** A board window is an `OpenWindow` created with a board
   root. The renderer reads the mode at startup. No separate preload, bundle or board runtime.
   This sidesteps the main risk of a dedicated host window: the board bridge, ports and Node
   script services already work in every Persephone window.
2. **Chrome.**
   - The top bar hides the sidebar button, the MCP and mneme indicators, and the `...` menu.
   - The locked board tab carries the board icon and name and sits flush left. When it is the
     only page, it is styled as inactive with no border or background.
   - The tab strip is always present for the locked board tab; other page tabs appear beside it.
     The new-page button is hidden and Ctrl+N is ignored in board windows.
   - The locked board tab can't be closed, reordered or dragged out. The File Explorer button is
     hidden on its toolbar.
3. **Closing the window closes the board.** Other pages in the window that have unsaved changes
   get the usual save prompt.
4. **No session persistence.**
   - A board window is never written to `openWindows.json` and doesn't save or restore its
     pages through `windowStates`.
   - Only its bounds are remembered, per board root.
   - After a restart, a board window comes back only when its shortcut is launched again.
5. **Outside opens never land in a board window.**
   - Files and URLs from Explorer, the launcher, `second-instance` or another window go to a
     normal Persephone window.
   - `OpenWindows.mainWindow` and every routing path must skip board windows.
   - If no normal window is open, one is created (restoring the normal session).
6. **Pages the board opens stay in the board window.**
7. **One window per board.** Launching a board that already has a window focuses it.
8. **Cold start with `--board`.**
   - Persephone not running + a board shortcut opens **only** the board window.
   - The normal session is restored when Persephone is next launched without `--board`.
     *(Recommended default; the task doc should confirm `restoreState()` can be deferred safely.)*
9. **Tabs between windows.**
   - Tabs can be dragged out of a board window, except the board tab.
   - Tabs dropped into a board window are accepted.
10. **Taskbar identity.**
    - The window uses the board's name as its title and the board's icon.
    - It gets its own AppUserModelID (derived from the board root), so it gets its own taskbar
      button instead of grouping under Persephone.
11. **Trust happens in the board window.**
    - An untrusted board launched by shortcut or link still opens its board-mode window.
    - The trust dialog is shown in that window, so the user never has to open the board in a
      normal window first.
    - Trusting there runs the board in place. Declining closes the board window.
    - Launching never trusts a board automatically.
12. **Agent/MCP access** stays as it is: the board is still a page in a window.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1749 | Board-mode window: `--board` launch, routing, lifetime, bounds | Done |
| US-1750 | Board-mode chrome: locked board tab and app controls | Done |
| US-1751 | Create a Windows shortcut for a board | Done |
| US-1752 | External `persephone-board://` protocol registration | Dropped (2026-11-02) |

Order: US-1749 → US-1750 → US-1751.

- **US-1749** can be tested without the chrome: the window opens with the board as an ordinary
  page.
- **US-1751** depends only on US-1749's launch argument.

### Scope notes

- **US-1749 (main process + renderer bootstrap):**
  - `LaunchInput` kind `board`, parsed from `--board <path>` in `parseLaunchArguments`
    (`src/main/utils.ts`). Check that the Rust launcher forwards the flag.
  - `OpenWindows` board-window registry: excluded from `saveState`, `mainWindow` and routing;
    focus-existing per board root.
  - A mode flag to the renderer, e.g. via `additionalArguments`, like the language arguments in
    `open-window.ts`.
  - Renderer startup that skips session restore and opens the board page.
  - Per-board bounds and the AppUserModelID.
  - Cold-start behavior, and quit/close-to-tray rules when only board windows remain.
- **US-1750 (renderer shell):**
  - Board-mode header with the locked board tab as the identity surface, window buttons, and
    hidden sidebar button, indicators and `...` menu.
  - Board tab locked first, not closable and not draggable.
  - Locked board tab always shown and flush left; inactive styling when it is the only page.
  - New-page button hidden, Ctrl+N ignored, and File Explorer hidden on the locked board page.
  - Window title and icon follow board metadata changes (`onBoardDisplayTextChanged`,
    `subscribeBoardIconChanges`).
- **US-1751:**
  - "Create shortcut…" in the board's right-click menu (Tools & Editors tree, and wherever else
    the board's menu appears).
  - Electron `shell.writeShortcutLink` pointing at `persephone-launcher.exe --board "<root>"`.
  - The shortcut's `appUserModelId` must equal the board window's `setAppDetails` `appId`
    (same derivation from the board root). Otherwise a pinned shortcut and its running window
    show as two separate taskbar buttons.
  - Reuse the stable per-board `.ico` created by US-1750 for the window/taskbar icon. US-1751
    uses that same icon file for the shortcut so both identities remain aligned.
  - Save location: a save dialog defaulting to the board folder, with a Desktop option.

## Notes

### 2026-11-02
- First proposal was a dedicated board window. The user rejected it because a board must be
  able to reuse every Persephone page type. A board mode for the normal window keeps that for free.
- External `persephone-board://` registration is not part of board-mode launch. Existing in-app
  links continue to open boards through Persephone's internal content scheme.
- US-1751 extended at the user's request. Dev builds (`npm start`) target the installed
  Persephone's launcher, so dev-created shortcuts open boards in the running dev instance.
