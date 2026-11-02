# EPIC-136: Boards as standalone apps

## Status

**Status:** Active
**Created:** 2026-11-02
**Completed:** —

## Overview

A board can run in its own Persephone window that looks like a standalone program: the board's
icon and name in a plain title bar, no sidebar, no MCP/mneme indicators, no `...` menu, and its
own taskbar entry. The user starts it by double-clicking a Windows shortcut (`.lnk`) that
Persephone creates in the board folder, on the desktop, or wherever the user saves it.

The window is **not** a new kind of host. It is an ordinary Persephone window running the full
app in a **board mode**, so the board keeps everything Persephone offers: it can open text,
Markdown, grids, dialogs, and any other page. When the board opens a page, the tab bar appears.
The board's own tab is always first and can't be closed or dragged. Closing the window closes
the board.

## Goals

- `persephone.exe --board <folder>` (through `persephone-launcher.exe`) opens the board in a
  board-mode window, or focuses that board's window if one is already open.
- Board-mode windows look like the board's own app: its icon, name and taskbar entry.
- A board can create a Windows shortcut that launches it this way.
- Optionally, `persephone-board://` links from outside Persephone open trusted boards the same way.

## Design decisions (2026-11-02, agreed with the user)

1. **Same window class, board mode.** A board window is an `OpenWindow` created with a board
   root. The renderer reads the mode at startup. No separate preload, bundle or board runtime.
   This sidesteps the main risk of a dedicated host window: the board bridge, ports and Node
   script services already work in every Persephone window.
2. **Chrome.**
   - The top bar hides the sidebar button, the MCP and mneme indicators, and the `...` menu.
   - It shows the board icon and name, with minimize, maximize and close.
   - The tab bar appears only while more than one page is open.
   - The board tab is always first, can't be closed, and can't be reordered or dragged out.
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
    - The same applies to US-1752 links.
12. **Agent/MCP access** stays as it is: the board is still a page in a window.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1749](../tasks/US-1749-board-mode-window/README.md) | Board-mode window: `--board` launch, routing, lifetime, bounds | Planned |
| US-1750 | Board-mode chrome: title bar, locked board tab, tab bar on demand | Planned |
| US-1751 | Create a Windows shortcut for a board | Planned |
| US-1752 | `persephone-board://` links from outside Persephone (trusted boards only) | Planned (optional) |

Order: US-1749 → US-1750 → US-1751 → US-1752.

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
  - Board-mode title bar (icon, name, window buttons; hidden sidebar button, indicators and
    `...` menu).
  - Board tab locked first, not closable and not draggable.
  - Tab bar shown only with more than one page.
  - Window title and icon follow board metadata changes (`onBoardDisplayTextChanged`,
    `subscribeBoardIconChanges`).
- **US-1751:**
  - "Create shortcut…" in the board's right-click menu (Tools & Editors tree, and wherever else
    the board's menu appears).
  - Electron `shell.writeShortcutLink` pointing at `persephone-launcher.exe --board "<root>"`.
  - The shortcut's `appUserModelId` must equal the board window's `setAppDetails` `appId`
    (same derivation from the board root). Otherwise a pinned shortcut and its running window
    show as two separate taskbar buttons.
  - The board icon converted to `.ico`; decide where the `.ico` lives so the shortcut keeps
    working.
  - Save location: a save dialog defaulting to the board folder, with a Desktop option.
- **US-1752:**
  - HKCU registration like `PersephoneURL` in `src/main/browser-registration.ts`.
  - Only boards already in the trust registry open; anything else shows the trust dialog or is
    refused.
  - Decide whether the external link names a path or a registry name; the existing internal
    `persephone-board://` encoding is base64 JSON.

## Notes

### 2026-11-02
- First proposal was a dedicated board window. The user rejected it because a board must be
  able to reuse every Persephone page type. A board mode for the normal window keeps that for free.
