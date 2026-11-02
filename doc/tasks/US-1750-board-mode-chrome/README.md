# US-1750: Board-mode chrome: locked board tab and app controls

Epic: [EPIC-136: Boards as standalone apps](../../epics/EPIC-136.md)

## Goal

Make the locked board tab the board-mode window's identity surface and keep it first and immovable. Keep ordinary-window chrome and tab behavior unchanged.

## Background

US-1749 is implemented and committed as `2fae0099`. `src/renderer/api/window.ts` exposes `appWindow.isBoardMode` and `appWindow.boardRoot`; `src/renderer.ts::bootstrap()` opens `encodePersephoneBoardLink(appWindow.boardRoot)` after `app.initPages()` and `app.initEvents()`. The board is an ordinary `PageModel` in the renderer's `pagesModel`.

`MainPageView::buildHeader()` composes the board-mode header without a separate identity block: the always-visible locked board tab carries the board icon and name. It is flush left; when it is the only page, it is styled inactive without a border or background. Reuse the existing tab roots and window controls and leave a draggable spacer before the system buttons. The new-page (+) button is absent in board windows and Ctrl+N is ignored. The toolbar on the locked board page also hides File Explorer, which would open the normal app sidebar.

The menu bar is mounted in `MainPageView`'s content and controlled through `MenuBarView`; board mode must not expose it through the header or its menu-bar keyboard/model paths. The current top-right status region contains the quick-settings `...` button, Mneme and MCP indicators; autoload, zoom, recording and right-pinned controls are also app-level chrome and must not leak into board mode.

`PageTabsView::updateTabs()` projects `state.pages` to the left/main strip by excluding right-pinned pages; its `KeyedList` updates as `pagesModel.state` changes. The right-pinned view is separately represented by the reused `rightPageTabs.root`. The locked tab remains visible even as the only page; other tabs and right-pinned tabs appear with their usual layout when opened. `PagesPersistenceModel.applyState()` also calls `PagesLayoutModel.sortByPinSide()` when restoring ordinary persisted windows; board-mode restore/persistence is skipped by US-1749 and the transient lock marker is not serialized. `PageTabView` owns each tab's close button, context menu, native tab drag payload, cross-window drop payload and reorder events. `PagesLayoutModel` currently puts left-pinned pages before unpinned pages in `sortByPinSide()` and pin insertion; the board-first rule must override those pin zones. `PagesLifecycleModel::closePage()` delegates to `PageModel.close()`, while `closeOtherPages()` and `closeToTheRight()` iterate and close pages themselves. A UI-only disabled control would therefore not protect scripting or direct page API callers.

`PageModel` has a runtime-only transient key-value store (`setTransient` / `getTransient`) that survives editor navigation on the same page object. `PagesQueryModel.findPageByBoardRoot()` finds a board page by its main editor's `boardRoot`, but that stops identifying it once the page navigates to another editor. At board startup, use that query while the original board editor is present and mark the matching page transiently with the launched root. Compare roots using `fpNormalizeForCompare`; retain that marker through navigation and cross-window serialized page transfer must not recreate a locked board marker in a normal window. This gives the board page a durable identity without treating another board opened later as the window's locked tab.

`src/renderer/api/internal/KeyboardService.ts` handles Ctrl+W and Ctrl+F4 by calling `focusedPage.close()` after preventing the browser default; it ignores the returned promise/result. There is no toast or error on refusal: the page simply stays open. The locked board page should likewise remain open silently for Ctrl+W/Ctrl+F4. `PageTabView::handleContextMenu()` adds close, close-other, close-to-right, pin/unpin and open-in-new-window actions. `PageCollectionWrapper` exposes `pages.closePage`, `moveTab`, `pinTab` and `unpinTab` to scripts/MCP. Today `closePage` returns `Promise<boolean>` (`false` for an unknown page or refused close); `moveTab`, `pinTab`, and `unpinTab` return `void`. Refuse locked-page operations at these shared APIs: close returns `false`; move/pin/unpin are no-ops and retain their `void` contract. Bulk close actions must skip the locked page even when it is not the context-menu anchor.

Board metadata and icon sources already exist. `boardDisplayText(root, manifest, boardMetadataKeys.name, fallback)` resolves the localized display name; `onBoardDisplayTextChanged(listener)` reports the changed root. `createBoardGlyphElement(root, size)` returns an `<img>` for a resolved `icon.svg`/PNG/ICO path or the `BoardIcon` SVG glyph fallback. `subscribeBoardIconChanges()` signals cache probes and invalidations. A renderer subscription should filter both notifications by the launched board root and refresh the native window identity.

`index.html` has `<title>Persephone</title>`, and Electron's installed declaration for `BrowserWindowConstructorOptions.title` says that if the HTML `<title>` is set it overrides that option. Keep the native BrowserWindow title synchronized by setting `document.title` to the board display name in the renderer and refreshing it on `onBoardDisplayTextChanged`; no title IPC or `BrowserWindow.setTitle()` call is needed. There is no current renderer-to-main API for changing an icon. `src/ipc/api-types.ts::Endpoint`, `MainApi`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts::Controller` are the existing typed IPC path. Electron's installed declarations accept `NativeImage | string` for `BrowserWindow.setIcon()` and expose `nativeImage.createFromDataURL()`. Send a 256x256 PNG data URL for the board icon from renderer to main (rasterize the custom SVG image or `BoardIcon` glyph in the renderer); add a board-window icon IPC endpoint, validate that the sender is a board-mode window, and convert the data URL with `nativeImage.createFromDataURL()` before `BrowserWindow.setIcon()`. For Windows taskbar identity, wrap the 256x256 PNG bytes in a single-entry ICO container (ICONDIR plus ICONDIRENTRY plus PNG bytes) and write it to a stable per-board `.ico` under userData, keyed by the same normalized-root SHA-256 identity used by `appId`. Update `setAppDetails()` with the existing `appId`, relaunch command, the display name as `relaunchDisplayName`, and this `.ico` as `appIconPath`. US-1751 must reuse this same `.ico` path as the shortcut icon. This replaces the US-1749 decision to leave `appIconPath` unset for the US-1751 shortcut hand-off; keep the existing app ID and relaunch command unchanged. The display name in the icon IPC payload is display-only and may update `relaunchDisplayName`; main must still validate the sender against the registered board `OpenWindow` and derive its board root from that record. See [Electron `nativeImage`](https://www.electronjs.org/docs/latest/api/native-image) and [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window).

## Implementation Plan

- [x] Add board-mode header state to `src/renderer/ui/app/MainPageView.ts` and `src/renderer/ui/app/MainPage.css`. Branch on `appWindow.isBoardMode`; the locked board tab is the identity surface, so do not add a separate board icon/name block. Keep that tab flush left and visible in the single-page state with inactive styling (no border/background). Hide the sidebar/menu button, status indicators, quick settings, autoload, zoom, recording controls and other app-level controls. Ensure the page-area `MenuBarView` is closed. In `src/renderer/api/menu-bar.ts`, make `open()`, `toggle()` and `openLegacy()` no-ops in board mode so the script-facing `app.window.menuBar` API cannot reopen hidden app chrome; keep normal mode behavior intact. Hide the new-page (+) button and ignore Ctrl+N. Keep the header drag surface and no-drag buttons; leave normal mode unchanged.

  Before: `buildHeader()` unconditionally appends menu, tabs, utility controls, system buttons and indicators for every window.

  ```ts
  this.header.append(this.menuButton, this.pageTabs.root);
  this.header.append(this.autoloadWrap, this.buildZoomButton(), this.recordingControls,
      minimizeButton, this.toggleWindowButton, closeButton);
  this.header.append(this.statusIndicators);
  ```

  After: ordinary mode keeps its existing composition; board mode places the always-visible locked `pageTabs.root` flush left, followed by `rightPageTabs.root`, a draggable spacer, then minimize, maximize/restore and close. The locked tab carries the board icon/name, and when it is the only page it has inactive styling with no border or background. The new-page button is hidden.

  ```ts
  if (appWindow.isBoardMode) {
      this.header.append(this.pageTabs.root, this.rightPageTabs.root,
          this.dragSpacer, minimizeButton, this.toggleWindowButton, closeButton);
  } else {
      // Keep the current normal-window header composition.
  }
  ```

- [x] Keep the locked board tab visible in the left strip in board mode, and style it inactive without border/background when it is the sole page. Keep it first and flush left as pages open, close or change pin side. Hide the right-pinned tab root when it has no tabs. Keep normal-window tab behavior unchanged.

- [x] Mark the launch board page during `src/renderer.ts::bootstrap()` after `openRawLink.sendAsync(...)` completes: resolve it with `pagesModel.query.findPageByBoardRoot(appWindow.boardRoot)` and set a transient locked-board-root marker on that `PageModel`. Add a shared page helper or equivalent in `src/renderer/api/pages/PageModel.ts` to identify the marker/root. The marker stays on the `PageModel` as its editor changes, which is how the launched board tab survives navigation. Do not infer lock identity from the current editor after navigation, and do not mark other board pages opened later.

- [x] Enforce the locked page in `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, and `src/renderer/api/pages/PagesLayoutModel.ts`. `PageModel.close()` must refuse the marked page and return `false` before confirmation or `onClose`. `PagesLifecycleModel.closePage()` thereby exposes `false` to `PageCollectionWrapper.closePage()` and scripts/MCP. Make `closeOtherPages()` and `closeToTheRight()` skip the locked page while continuing to close other eligible pages. Keep pinning and unpinning other pages allowed, but ensure the locked page sorts ahead of every pin zone: `zone()` returns `-1` for the locked board page, `sortByPinSide()` places it first, and pin insertion uses `lockedBoardCount + leftPinnedCount` so it preserves index zero. Audit every page-order projection and index calculation, including `PageTabsView.updateTabs()` / `currentPages`, `PageTabsView.pinnedLeft()`, `PagesLayoutModel.moveTabByIndex()` / grouping adjacency math, and `PageTabView` drop target insertion math; the board tab must remain index 0 in the left strip. Refuse `moveTab`/`moveTabByIndex` when the source is locked or a move would place another tab before it; pin/unpin of the locked page is a no-op. Keep the public `moveTab`, `pinTab`, and `unpinTab` return type `void`; refusal is a no-op, not an exception. Preserve the existing handling of right-pinned tabs and normal pages.

- [x] Protect all tab UI paths in `src/renderer/ui/tabs/PageTabView.ts` and `src/renderer/ui/tabs/PageTab.css`. For the marked page, omit/disable the close control and omit close, close-other, close-to-right, pin/unpin and open-in-new-window context actions as applicable. Prevent native drag start and outside-window drag-out for the locked page; prevent it being accepted as a reorder source or a cross-window move source. Keep the locked tab first. Keep ordinary tab controls and context menus unchanged. Apply the same lock checks in `src/renderer/api/pages/PagesModel.ts` / cross-window `movePageOut()` paths if those methods are the routes used by the tab drag source; do not rely only on a hidden drag affordance. In `src/renderer/editors/board/BoardToolbar.ts`, hide File Explorer on the locked board page.

- [x] Make all close paths honor the lock. In `src/renderer/api/internal/KeyboardService.ts`, Ctrl+W and Ctrl+F4 may continue calling `focusedPage.close()` because the model-level guard returns `false`; confirm no separate app menu/native accelerator bypasses that call. The board mode hides `MenuBarView`, but its commands and scripting APIs still go through the guarded page methods. Ensure close-other and close-to-right do not indirectly close the board page when invoked on another tab.

- [x] Add a typed board icon update IPC through `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts`. The request carries the display name and a 256x256 PNG data URL; the handler resolves `BrowserWindow.fromWebContents(event.sender)`, looks up `openWindows.findByWindow(window)`, refuses non-board windows, converts the PNG data URL to `NativeImage`, updates the native window icon, writes a single-image PNG-backed ICO file to the stable board-icon path, and calls `setAppDetails()` with the existing `appId`/relaunch command and the supplied display name as `relaunchDisplayName`. Validate the data URL/size. Renderer must not send a board root for main to trust as identity; the existing `OpenWindow.boardRoot` and `appWindow.boardRoot` define which board this IPC updates. The display name affects presentation only.

- [x] Implement board identity refresh in `src/renderer/ui/app/MainPageView.ts`. Load the normalized manifest for `appWindow.boardRoot`, initialize the display name using `boardDisplayText(..., boardMetadataKeys.name, fallback)`, set `document.title` to that display name, and refresh it on matching `onBoardDisplayTextChanged` events. Subscribe to `subscribeBoardIconChanges`, filtering to the launched root. Resolve the board icon through `resolveBoardIcon()` and rasterize either that image or the `BoardIcon` SVG fallback to a 256x256 PNG data URL; send the PNG and display name through the icon-only IPC whenever either value changes. The locked board tab renders the in-window icon/name; main uses the same data to update native/taskbar identity. Check async work against the view/window lifetime and latest icon request so stale probes cannot overwrite newer metadata.

- [x] Update `src/main/open-window.ts` for native icon refresh. `OpenWindow` already receives `boardRoot` and calls `BrowserWindow.setAppDetails()` with the derived board AppUserModelID, launcher relaunch command and basename display name; retain that identity and avoid changing normal-window construction. On icon IPC, update the live BrowserWindow icon, wrap the supplied PNG bytes in a one-entry ICO container and write it to a stable per-board `.ico` in userData keyed by the same normalized-root SHA-256 hash used by `appId`. Then call `setAppDetails()` with the existing `appId` and relaunch command, the IPC display name as `relaunchDisplayName`, and this `.ico` as `appIconPath`. Overwrite that same file when the icon changes. Do not store the cache inside the board folder or shortcut target. `US-1751` must use this same `.ico` path for the created shortcut. Keep old normal-window behavior unchanged.

  Before: `OpenWindow` sets a static BrowserWindow icon and the board AppUserModelID/relaunch metadata; no code changes the native icon after renderer startup, and its `relaunchDisplayName` is the board folder basename.

  After: renderer sets `document.title`; board renderer sends a validated display name and raster PNG through a board-only IPC; main updates the native/taskbar icon and `relaunchDisplayName`. Normal windows do not call this endpoint.

  ```ts
  // Main process, after validating the sender's OpenWindow.boardRoot:
  const icon = nativeImage.createFromDataURL(request.iconDataUrl);
  browserWindow.setIcon(icon);
  await fs.promises.writeFile(boardIconPath, pngBackedIco(icon.toPNG()));
  browserWindow.setAppDetails({ ...existingBoardAppDetails, appIconPath: boardIconPath });
  ```

## Concerns

- Electron's `BrowserWindow.setIcon()` type accepts `NativeImage | string`, and `nativeImage.createFromDataURL()` is present in the installed Electron declarations. The board's custom icon cache is file-path based and can return SVG, while `createBoardGlyphElement()` can return an SVG DOM element. Rasterize in the renderer and send PNG data rather than assuming Electron can decode the project's SVG/glyph representation directly. Windows `appIconPath` is a relaunch icon resource, so write an ICO container containing the 256x256 PNG (ICONDIR, one ICONDIRENTRY, then PNG bytes); use the same stable per-board `.ico` for the later shortcut task.
- The board lock needs an explicit transient marker on the original startup `PageModel`. `findPageByBoardRoot()` is useful only before its main editor navigates away; a later board page in the same window is not the launched board and must remain ordinary.
- `PageCollectionWrapper.closePage()` returns boolean, but script `moveTab`, `pinTab`, and `unpinTab` are `void`. Preserve those contracts and make refused operations no-ops; keep their scripting descriptions accurate about board-mode restrictions.
- A keyboard shortcut and bulk close can bypass tab buttons. Enforce the invariant at the page/layout APIs and audit cross-window drag source handling, not just `PageTabView` visibility.
- Normal-window behavior is a strict regression boundary. All changed UI and model branches must be conditional on board mode/locked marker; keep normal window title/icon, tab bar visibility, shortcuts, context menu and drag behavior as they work now.

## Acceptance Criteria

- [ ] The always-visible locked board tab is flush left and carries the board icon/name. When it is the only page it appears inactive without a border or background. The header hides the menu/sidebar control, MCP and Mneme indicators, quick-settings menu, autoload, zoom, recording and other app-level controls; window controls remain available.
- [ ] The board header retains a working window drag region; all actionable controls remain clickable and do not initiate a window drag.
- [ ] The locked board tab remains visible when it is the only page. Other pages use the existing tab layout; the board tab remains first and flush left. The right-pinned tab root is hidden when empty.
- [ ] The new-page (+) button is hidden and Ctrl+N is ignored in board windows. File Explorer is hidden on the locked board page's toolbar.
- [ ] The launched board page remains first after its editor navigates to another file/editor. It cannot be closed, reordered, dragged outside the window, moved into another window, pinned or unpinned.
- [ ] Pinning/unpinning other pages remains allowed and never moves a page ahead of the locked board tab; the board is first in `sortByPinSide()`, the renderer's main-strip projection, persistence ordering, and every move/drop index calculation.
- [ ] Ctrl+W, Ctrl+F4, tab close, context-menu close actions, close-others, close-to-right, scripting/MCP `pages.closePage`, `moveTab`, `pinTab`, `unpinTab`, and cross-window tab movement cannot close, move, reorder or pin/unpin the locked board page. `pages.closePage(boardPageId)` returns `false`; move/pin/unpin attempts return `void` and do nothing.
- [ ] `document.title` and the native BrowserWindow title follow the localized board display name and later metadata changes. The window and taskbar icon follow the board's custom SVG/PNG/ICO icon or fall back to the board glyph, including later icon cache invalidations/changes. The stable `.ico` under userData is keyed by the board-root hash, and US-1751 reuses it for the shortcut.
- [ ] Refusing Ctrl+W/Ctrl+F4 on the locked board tab leaves it open without a toast or error; Ctrl+W's existing ignored `PageModel.close()` result remains silent.
- [ ] Ordinary windows retain today's header contents, persistent tab strip, tab operations, native title/icon, keyboard shortcuts, and drag behavior.

## Files that need no changes

| File | Reason |
|---|---|
| `src/renderer/api/window.ts` | US-1749 already exposes the read-only `appWindow.isBoardMode` and `appWindow.boardRoot` values required by this task. |
| `src/renderer/editors/board/board-display-text.ts` | Existing `boardDisplayText`, `boardMetadataKeys.name`, and `onBoardDisplayTextChanged` supply localized board naming and updates. |
| `src/renderer/editors/board/board-glyph-element.ts` | Existing `createBoardGlyphElement()` renders the resolved board image or fallback `BoardIcon` glyph for the in-window title. |
| `src/renderer/editors/board/board-icon-cache.ts` | Existing `resolveBoardIcon` and `subscribeBoardIconChanges` expose icon resolution and refresh signals; add rasterization/IPC at the window identity owner. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Board model already exposes the board root through its editor state; window identity is based on the launch root and the existing page query. |
| `src/renderer/api/pages/PagesQueryModel.ts` | Existing `findPageByBoardRoot()` locates the initial board page before it navigates; the new durable lock marker belongs on `PageModel`. |
| `index.html` | Its existing `<title>Persephone</title>` is set dynamically through `document.title`; no HTML change is needed. |
| `src/main/open-windows.ts` | Existing `findByWindow()` resolves a BrowserWindow to its `OpenWindow`, including board windows, for validating the new IPC sender. |

## Files Changed Summary

| Area | Planned files |
|---|---|
| Board-mode shell and conditional tabs | `src/renderer/ui/app/MainPageView.ts`, `src/renderer/ui/app/MainPage.css`, `src/renderer/api/menu-bar.ts`, `src/renderer/ui/sidebar/MenuBarView.ts`, `src/renderer/ui/sidebar/MenuBar.css`, `src/renderer/ui/tabs/PageTabsView.ts`, `src/renderer/ui/tabs/RightPageTabsView.ts`, `src/renderer/ui/tabs/PageTabs.css`, `src/renderer/ui/tabs/PageTabView.ts`, `src/renderer/ui/tabs/PageTab.css` |
| Locked-page identity and operation guards | `src/renderer.ts`, `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/pages/PagesModel.ts`, `src/renderer/api/pages/PagesLayoutModel.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/api/internal/KeyboardService.ts`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` |
| Native board window icon identity | `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts`, `src/main/open-window.ts` |
