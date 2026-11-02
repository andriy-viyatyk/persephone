# US-1751: Create a Windows shortcut for a board

Epic: [EPIC-136: Boards as standalone apps](../../epics/EPIC-136.md)

## Goal

Let a user create a Windows `.lnk` for a board from each existing board context menu. The shortcut launches that board through the Persephone launcher and carries the same taskbar identity and icon as its board-mode window.

## Background

US-1749 and US-1750 are implemented in commits `2fae0099` and `695ac176`. `src/main/open-window.ts::OpenWindow` already receives `boardRoot`, sets the board window's AppUserModelID to `Persephone.Board.` plus the lowercase normalized absolute-root SHA-256 hex digest, and exposes `boardWindowIconPath(boardRoot)`. `boardWindowIconPath()` points to Electron's `userData/board-icons/<hash>.ico`. The ICO is created only when `OpenWindow.updateBoardIdentity()` receives the board icon from the renderer; a board that has never been opened has no ICO yet.

`src/renderer/ui/app/MainPageView.ts::refreshBoardIdentity()` loads the normalized manifest, resolves the localized display name with `boardDisplayText()`, renders the icon at 256×256 through a canvas, and sends `{ displayName, iconDataUrl }` to `api.setBoardWindowIdentity()`. Its private `renderBoardIcon()` uses `resolveBoardIcon()` and falls back to rasterizing the `BoardIcon` SVG. Main then writes a PNG-backed ICO through the private `pngBackedIco()` helper and sets the BrowserWindow icon/AppUserModelID. Both renderer rasterization and main-side ICO writing need shared implementations because the shortcut action may run from a normal window before any board window has initialized its icon.

`src/main/browser-registration.ts::getLauncherPath()` returns `persephone-launcher.exe` beside `app.getPath("exe")` when that file exists. In development, where there is no launcher beside `electron.exe`, it returns `app.getPath("exe")` itself. The shortcut target must use this function so its behavior matches the board window's existing `relaunchCommand` in both environments. Electron's `shell.writeShortcutLink()` accepts a target, a string `args`, description, icon and `appUserModelId`; its return value is `false` if it cannot create the link.

### Verified board context-menu inventory

1. `src/renderer/ui/sidebar/EditorsTreeView.ts::contextMenu()` delegates board rows to `boardContextItems()`. This is the Tools & Editors Editors tree. Its board items currently include update (when available), copy path, open folder and remove from trusted boards; category assignment is added by `contextMenu()`.
2. `src/renderer/editors/explorer/BoardsSecondaryView.ts::ensureBoardsBody()` supplies `getBoardContextMenu()` to `src/renderer/editors/board/BoardsTreeView.ts`. That menu currently has open in new tab, copy path, open board folder and delete/remove.
3. `src/renderer/editors/board/BoardEditorModel.ts::onGetMenuItems()` adds board-specific items to the board page tab context menu assembled by `src/renderer/ui/tabs/PageTabView.ts::handleContextMenu()`. It currently adds copy board path and open board folder after the host editor's items.

`rg` confirmed `BoardsSecondaryView` is the only construction site for `BoardsTreeView`. The board toolbar's “more” menu is not a context menu and is outside this action's listed surfaces.

The existing save-dialog path is `app.fs.showSaveDialog()` (`src/renderer/api/fs.ts`), typed by `ISaveDialogOptions` in `src/renderer/api/types/fs.d.ts` and implemented in main by `showSaveFileDialog()` in `src/ipc/main/dialog-handlers.ts`. It accepts `defaultPath` and `filters`; `CommonFolder` includes `desktop`, but an explicit full `defaultPath` takes precedence over remembered location. The native Windows Save dialog remains navigable to Desktop and owns its overwrite confirmation. Use a full default path in the board folder, `<display name>.lnk`, and a `.lnk` filter. Do not pre-check or replace that flow.

The existing typed IPC path is `src/ipc/api-types.ts::Endpoint` / `MainApi`, `src/ipc/renderer/api.ts::ApiCalls`, and `src/ipc/main/core-handlers.ts::Controller`, where `setBoardWindowIdentity` is an example of sender-resolved main-process work. `src/renderer/api/ui.ts` exposes `ui.notify()` for the existing toast mechanism; English UI strings belong in `src/shared/i18n/en/shell.ts`.

## Implementation Plan

- [x] Add a translated `Create shortcut…` item to all three verified board context-menu locations: `EditorsTreeView.boardContextItems()`, `BoardsSecondaryView.getBoardContextMenu()`, and `BoardEditorModel.onGetMenuItems()`. Give it a stable menu item `id`. Each handler should pass the relevant board root to one shared renderer action. Do not add it to unrelated board toolbar menus.
- [x] Extract the current 256×256 rasterization from `MainPageView.renderBoardIcon()` / `boardGlyphImage()` into a board icon renderer helper, for example `src/renderer/editors/board/board-window-icon.ts::renderBoardIconDataUrl(root)`. It must keep the current `resolveBoardIcon()` load/decode behavior, center-fit the image on a transparent canvas, and fall back to the `BoardIcon` SVG glyph. Use the helper both from `MainPageView.refreshBoardIdentity()` and from the shortcut action so unopened boards produce the same icon data.
- [x] In the shared shortcut action, resolve the normalized manifest and display name with the existing `readNormalizedBoardManifest()`, `ensureBoardDisplayText()`, `boardDisplayText()`, and `boardMetadataKeys.name` flow used by `MainPageView`. Use the manifest name or `fpBasename(root)` as the display-name fallback. Suggest `<safe display name>.lnk` under the board root through `app.fs.showSaveDialog({ defaultPath, filters: [{ name, extensions: ["lnk"] }] })`. Remove Windows-forbidden filename characters, trim trailing dots and spaces, and if the result is empty or whitespace use the sanitized folder basename, then `Board`. Apply this to the suggested filename only; keep the board display name intact for the shortcut description. A cancelled dialog is a no-op.
- [x] Add a typed main-process endpoint for creating the link through Electron `shell.writeShortcutLink()`. Wire its endpoint and request type in `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts`; bind it through `bindEndpoint` and derive the calling BrowserWindow from `event.sender`, following `setBoardWindowIdentity` and the existing save dialog handler. The request must include the selected link path, board root, display name and rasterized PNG data URL; do not send a renderer-computed AppUserModelID or ICO path as authoritative identity.
- [x] Factor the root hash, stable icon path, launch-argument root normalization, and PNG-backed ICO writer out of `src/main/open-window.ts` into a shared main helper, for example `src/main/board-window-identity.ts`. Preserve the exact current digest input: `path.normalize(path.resolve(boardRoot)).toLowerCase()`, SHA-256 hex. Add a helper such as `boardRootForLaunchArgs(root)` that applies `path.resolve(root)` and removes trailing path separators except when the resolved path is a drive root such as `C:\\`. Keep this launch-argument normalization separate from `boardIdentityHash()` so the identity digest input remains unchanged. Have both `OpenWindow` relaunch-command construction sites in `src/main/open-window.ts` (`constructor` and `updateBoardIdentity()`) and the shortcut args use this helper. Have `boardWindowIconPath()` / `OpenWindow.updateBoardIdentity()` use the shared identity/ICO helpers and have the new shortcut handler write the provided renderer PNG through the same writer before using the resulting `.ico`. The helper should create the parent directory as `updateBoardIdentity()` currently does.
- [x] Build the shortcut details in main with `target: getLauncherPath()`, `args: --board "<boardRootForLaunchArgs(root)>"` (Electron's `ShortcutDetails.args` is a string), `description: displayName`, `icon: boardWindowIconPath(root)`, and `appUserModelId: "Persephone.Board." + boardIdentityHash(root)`. Use the shared root hash so the shortcut's ID is byte-for-byte the same value as `OpenWindow`'s `setAppDetails({ appId })`. Use `shell.writeShortcutLink(linkPath, "create", details)` after writing the ICO. If it returns `false`, report failure; do not silently report success. After a successful write, call `shell.readShortcutLink(linkPath)` and verify its `target`, `args`, `description`, `icon`, and `appUserModelId` against the expected details before reporting success.

  Before, `MainPageView` owns the only renderer rasterizer and `OpenWindow.updateBoardIdentity()` owns the only main-side ICO writer:

  ```ts
  // MainPageView.ts
  const iconDataUrl = await this.renderBoardIcon(root);
  await api.setBoardWindowIdentity({ displayName, iconDataUrl });
  ```

  After, the board icon rasterizer and PNG-backed ICO writer are each shared by the board-window identity path and the shortcut creation path:

  ```ts
  const iconDataUrl = await renderBoardIconDataUrl(root);
  await api.createBoardShortcut({ boardRoot: root, linkPath, displayName, iconDataUrl });
  ```
- [x] Report success with `ui.notify(..., "success")`; report thrown errors and a `false` result with the existing notification mechanism and `errMessage()`. Add only the required English messages to `src/shared/i18n/en/shell.ts`. Keep cancellation silent.
- [x] Do not expose this as a `boards.*` scripting/MCP method. The action is a user-invoked native Windows shell operation with a user-selected destination; adding a script/API surface would permit trusted board automation to create OS shortcuts and requires a separate privilege/design decision. The three UI context menus cover the supported user entry points.

## Concerns

- A development shortcut is not runnable: `getLauncherPath()` returns `electron.exe` when the launcher is absent, and `electron.exe --board <root>` starts bare Electron without the Persephone app path. The board window's relaunch command has the same limitation in dev. This is a known limitation and needs no workaround. Verify a written development `.lnk` by calling `shell.readShortcutLink(linkPath)` and checking `target`, `args`, `description`, `icon`, and `appUserModelId`. A real double-click launch test requires the installed build.
- Board metadata can provide a display name that is not a legal Windows filename. Remove forbidden characters and trailing dots/spaces from the suggested `.lnk` filename. If sanitizing the display name leaves it empty, use the sanitized folder basename; if that is also empty, use `Board`. Do not change the description or visible board name.
- A board root ending in a backslash can break the quoted Windows command-line argument because the backslash escapes the closing quote. Resolve the root and strip trailing separators unless it is a drive root before composing launch args. Apply this one helper to shortcut args and both `OpenWindow` relaunch-command construction sites. Do not alter the hash helper's current normalized-root input.
- The per-board icon path does not exist until an icon has been rendered and written. Always rasterize the board icon from renderer sources and write it with the shared main-side PNG-backed ICO writer before asking `shell.writeShortcutLink()` to reference it; do not assume `boardWindowIconPath()` exists merely because the board is registered or trusted.
- Keep the shortcut ID coupled to the window's `setAppDetails` ID through the shared SHA-256 helper. A second hash implementation or a different normalization/casing rule would split pinned shortcut and running-window taskbar identities.
- The save dialog returns no path when cancelled. Its own overwrite confirmation owns replacement behavior; the shortcut handler should not delete the existing `.lnk` first or add a second confirmation.
- Do not add a `boards.*` API method for this task. If a later user request requires automation, decide separately how an unattended OS shortcut write should be authorized.

## Acceptance Criteria

- [ ] `Create shortcut…` appears in the board row context menus in the Tools & Editors Editors tree and Explorer Boards tree, and in the board page tab context menu.
- [ ] Each surface uses the same action and the same localized board display name used by the board window identity.
- [ ] The Save dialog opens at `<board root>/<safe display name>.lnk`; forbidden characters and trailing dots/spaces are removed. If the sanitized display name is empty, use the folder basename, then `Board`. It filters for `.lnk`, allows navigation to Desktop, and cancellation does not create a link.
- [ ] Saving over an existing link follows the native Windows save dialog's own overwrite confirmation; the main process writes with `shell.writeShortcutLink(..., "create", ...)` only after the dialog returns a path.
- [ ] The `.lnk` target is `getLauncherPath()`; its arguments launch `--board "<boardRootForLaunchArgs(root)>"`; its description is the board display name. After writing, `shell.readShortcutLink(linkPath)` confirms the target, args, description, icon and `appUserModelId` match the expected details.
- [ ] The shortcut `appUserModelId` is exactly `Persephone.Board.` plus the SHA-256 digest used by `boardIdentityHash()` for the board window's `setAppDetails({ appId })`.
- [ ] Launch args use one shared resolved-root helper that removes trailing separators except for drive roots. `OpenWindow`'s constructor and `updateBoardIdentity()` relaunch commands use the same helper; the board identity hash input remains unchanged.
- [ ] The shortcut icon is the stable per-board `.ico` at `boardWindowIconPath(root)`, written before the shortcut is created even when the board has never been opened. Window identity refresh and shortcut creation use the same renderer rasterizer and main ICO writer.
- [ ] A successful write reports success; a failed write or rejected operation reports failure through `ui.notify()`. Dialog cancellation is silent.
- [ ] No `boards.*` scripting/MCP shortcut action is added. New visible strings are sourced from `src/shared/i18n/en/*.ts`.
- [ ] In dev, a written shortcut is read back with `shell.readShortcutLink(linkPath)` and its target, args, description, icon and `appUserModelId` are checked. A real double-click launch is verified in an installed build; the dev shortcut and board-window relaunch command are documented as non-runnable because their target falls back to bare `electron.exe`.
- [ ] No unit tests are added for this task.

## Files that need no changes

| File | Reason |
|---|---|
| `src/main/browser-registration.ts` | `getLauncherPath()` already returns the installed launcher path and falls back to `app.getPath("exe")` in dev. |
| `src/renderer/api/fs.ts`, `src/renderer/api/types/fs.d.ts`, `src/ipc/main/dialog-handlers.ts` | The existing save dialog accepts a full `defaultPath` and extension filters and is parented to the calling BrowserWindow. |
| `src/renderer/editors/board/board-icon-cache.ts` | `resolveBoardIcon()` already locates `icon.svg`, `icon.png`, or `icon.ico` and exposes refresh signals. |
| `src/renderer/editors/board/board-glyph-element.ts` | `createBoardGlyphElement()` already supplies the board icon or BoardIcon fallback for DOM surfaces. |
| `src/renderer/editors/board/board-display-text.ts` | `boardDisplayText()`, `ensureBoardDisplayText()`, and `boardMetadataKeys.name` already resolve and refresh localized board display names. |
| `src/renderer/api/boards.ts`, `src/renderer/api/types/boards.d.ts`, `src/renderer/api/mcp/board-open-board.ts`, `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Keep this user-invoked OS shortcut action out of scripting/MCP as described above. |

## Files Changed Summary

| Area | Planned files |
|---|---|
| Task links | `doc/active-work.md`, `doc/epics/EPIC-136.md` |
| Context menus and shared renderer action | `src/renderer/ui/sidebar/EditorsTreeView.ts`, `src/renderer/editors/explorer/BoardsSecondaryView.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, new `src/renderer/editors/board/board-window-icon.ts`, new `src/renderer/editors/board/board-shortcut.ts` |
| Shortcut IPC and native shell write | `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts`, new `src/main/board-window-identity.ts`, `src/main/open-window.ts` |
| English UI copy | `src/shared/i18n/en/shell.ts` |

## Implementation notes (live verification, 2026-11-02)

- **`iconIndex` is required.** Electron `shell.writeShortcutLink()` writes the icon only when
  `iconIndex` is present too. With `icon` alone the shortcut gets no icon, and `readShortcutLink`
  returns an empty `icon`. The read-back check caught this on the first live run.
  `createBoardShortcut` now passes `iconIndex: 0`.
- **Verified live (dev build, Tools & Editors → Create shortcut… → Desktop):**
  - The success notification shows.
  - Read-back gives: target `getLauncherPath()` (electron.exe in dev), args
    `--board "C:\projects\persephone-boards\boards\audio-player"`, description `Audio Player`,
    icon `userData/board-icons/<hash>.ico` with index 0, and an appUserModelId identical to the
    board window's `Persephone.Board.<hash>`.
  - The shortcut shows the board icon in Explorer.
- **Not verified:**
  - A double-click launch, which needs the installed build.
  - The Explorer Boards panel and board tab menu entries, which use the same shared action.
- **Dev builds use the installed launcher.** `getBoardLauncherPath()` in
  `src/main/board-window-identity.ts` is the target for shortcuts and for the board window's
  relaunch command.
  - A packaged build uses `getLauncherPath()`.
  - A dev build looks up the installed Persephone through electron-builder's fixed uninstall key,
    `de6947fe-4b42-50ca-ab55-d20f314ae2b2` (HKCU, then HKLM), and uses its
    `persephone-launcher.exe`. Dev and installed builds share one launcher pipe, so the board opens
    in the dev instance while it runs and in the installed one otherwise.
  - Without an installed copy, it falls back to `getLauncherPath()`.
  - The default-browser registration keeps `getLauncherPath()`.
  - Verified 2026-11-02: with this branch's launcher copied over the installed 5.0.16 one, a
    dev-created Desktop shortcut targets the installed launcher, and double-clicking it opened the
    board window in the running dev instance.
