# US-515: Browser editor chrome — UIKit migration

## Status

**Placeholder** — not yet planned. Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration.

## Goal

Migrate the Browser editor's main chrome (root view, tabs strip,
bookmarks drawer) to UIKit primitives. After this task, the in-scope
files contain no `@emotion/styled` definitions and import nothing from
`components/basic|form|layout|overlay/`.

## Scope

Three rendering files:

- `src/renderer/editors/browser/BrowserEditorView.tsx` — top-level
  editor; URL bar, tabs strip host, webview host, bookmarks rail,
  splitter, find-bar slot.
- `src/renderer/editors/browser/BrowserTabsPanel.tsx` — multi-webview
  tabs strip with right-click context menu.
- `src/renderer/editors/browser/BookmarksDrawer.tsx` — collapsible
  bookmarks drawer with splitter.

## Files NOT changed (covered elsewhere)

- `src/renderer/editors/browser/BrowserDownloadsPopup.tsx` — **US-463**.
- `src/renderer/editors/browser/DownloadButton.tsx` — **US-463**.
- `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx` — **US-464**
  (blocked on US-468 ListBox).
- `src/renderer/editors/browser/TorStatusOverlay.tsx` — **US-462**.
- `src/renderer/editors/browser/BrowserWebviewModel.ts`,
  `BrowserUrlBarModel.ts` — pure model code; only `MenuItem` *type*
  imports from `components/overlay/PopupMenu` which is acceptable until
  US-481 lands.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` roots / chrome | UIKit `Panel` |
| `components/basic/Button` (URL bar buttons, tab close, etc.) | UIKit `IconButton` / `Button` |
| `components/basic/TextField` (URL bar) | UIKit `Input` (with start/end slots — US-471) |
| `components/basic/CircularProgress` (URL bar loading indicator) | UIKit `Spinner` |
| `components/layout/Splitter` | UIKit `Splitter` |
| `components/overlay/WithPopupMenu` | UIKit `WithMenu` (US-481) |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` |
| `theme/color` (chrome) | dropped — Panel tokens / Text colors |

Confirmed import inventory (current):
- `BrowserEditorView.tsx`: `@emotion/styled`,
  `components/basic/{Button,TextField,CircularProgress}`,
  `components/layout/Splitter`, `components/overlay/WithPopupMenu`,
  `theme/color`.
- `BrowserTabsPanel.tsx`: `@emotion/styled`,
  `components/basic/Button`, `components/overlay/PopupMenu` (type),
  `theme/color`.
- `BookmarksDrawer.tsx`: `@emotion/styled`,
  `components/layout/Splitter`, `theme/color`.

## Notes

- URL bar uses `TextField` with custom start/end slots (lock icon,
  reload icon, downloads button). Migration depends on **US-471 UIKit
  Input start/end slots** — verify the slot prop API supports the
  composition before starting.
- `WithPopupMenu` use depends on **US-481 UIKit Menu/WithMenu**.
  `BrowserTabsPanel` only imports the `MenuItem` *type*, but
  `BrowserEditorView.tsx` calls `WithPopupMenu` directly.
- `Splitter` use depends on **US-486 UIKit Splitter** (sidebar already
  migrated in US-489 — pattern established).
- Find-bar is rendered via the shared `BrowserFindBar` host (covered by
  **US-461** consolidation) — out of scope here; this task only touches
  chrome around it.
- Tab close button + drag-reorder behavior must be preserved.
- Coordinate with **US-461 (FindBar)** and **US-462 (TorStatusOverlay)**:
  if those land first, `BrowserEditorView` simply hosts the migrated
  children — no extra coupling.

## Test surface (manual smoke)

- Open the built-in browser: URL bar, tabs strip, webview render.
- Type a URL and press Enter: navigation works; loading spinner shows.
- Open a new tab; close a tab; right-click a tab for context menu
  (close, reopen, etc.).
- Toggle bookmarks drawer: opens / closes; splitter resizes.
- Add / remove a bookmark: persists across reload.
- Click a bookmark: navigates active tab.
- Find-bar opens (Ctrl+F) and overlays correctly (host unchanged).
- Downloads button (DownloadButton — US-463) and Tor overlay
  (TorStatusOverlay — US-462) render through unchanged portal targets.

## Acceptance criteria

- [ ] No `@emotion/styled` import in `BrowserEditorView.tsx`,
      `BrowserTabsPanel.tsx`, `BookmarksDrawer.tsx`.
- [ ] No imports from `components/basic|form|layout|overlay/` in those
      three files (type-only imports of `MenuItem` from overlay can stay
      until US-481 — flag in plan).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (above) passes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Dependencies

- **US-471** UIKit Input start/end slots (URL bar composition)
- **US-481** UIKit Menu / WithMenu (`WithPopupMenu` swap)
- **US-486** UIKit Splitter (root + bookmarks splitters)

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related (split-out browser surfaces):
  [US-461 FindBar](../US-461-shared-findbar-consolidation/README.md),
  [US-462 TorStatusOverlay](../US-462-tor-status-overlay-migration/README.md),
  [US-463 BrowserDownloadsPopup](../US-463-browser-downloads-migration/README.md),
  [US-464 UrlSuggestionsDropdown](../US-464-url-suggestions-dropdown-migration/README.md)
