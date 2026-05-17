# US-531: `showPopupMenu` — UIKit Menu migration

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
per-screen migration. **Blocked on** [US-481](../US-481-uikit-menu-with-menu/README.md)
(UIKit Menu + WithMenu).

## Goal

Migrate the app-level popup-menu API (`showAppPopupMenu` /
`closeAppPopupMenu`) and its dependent `TPopperModel` type from the
legacy `components/overlay/{Popper,PopupMenu,WithPopupMenu}` primitives
to UIKit Menu. After this task, no file in `src/renderer/ui/dialogs/poppers/`
imports from `components/overlay/`, and the `MenuItem` type that ~10
callers re-import via this barrel is sourced from `uikit/Menu`.

## Scope

Two rendering / infrastructure files in `ui/dialogs/poppers/`:

- `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` — `showAppPopupMenu`
  / `closeAppPopupMenu` API. Renders `<PopupMenu>` inside a `ReactDOM.createPortal`
  with a virtual anchor at `(x, y)`. Adds default Copy/Paste/Inspect items
  based on the current selection / focused element / clipboard state.
- `src/renderer/ui/dialogs/poppers/types.ts` — re-exports
  `PopperPosition` from `components/overlay/Popper`.

Downstream callers (no source changes if `MenuItem` type re-export is
preserved at the migrated boundary):

- `src/renderer/editors/browser/BrowserWebviewModel.ts`
- `src/renderer/editors/browser/BrowserUrlBarModel.ts`
- `src/renderer/editors/shared/link-open-menu.tsx`
- `src/renderer/editors/rest-client/RestClientEditor.tsx`
- `src/renderer/editors/rest-client/RequestBuilder.tsx`
- `src/renderer/editors/rest-client/ResponseViewer.tsx`
- `src/renderer/editors/graph/GraphView.tsx`
- `src/renderer/editors/graph/GraphViewModel.ts`
- `src/renderer/editors/graph/ForceGraphRenderer.ts`
- `src/renderer/editors/link-editor/LinkEditor.tsx`
- `src/renderer/components/tree-provider/CategoryView.tsx`
- `src/renderer/components/data-grid/AVGrid/model/ContextMenuModel.tsx`
- `src/renderer/api/internal/GlobalEventService.ts`
- `src/renderer/ui/dialogs/index.ts`

These callers may still need to flip their `MenuItem` import path from
`components/overlay/PopupMenu` to wherever the migrated type lives
(`uikit/Menu` or a re-export from `ui/dialogs/poppers`). Decision to
defer in this task or split caller flips into [US-532](../US-532-legacy-components-removal/README.md)
to be made at planning time.

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/overlay/PopupMenu.PopupMenu` (component) | UIKit `Menu` (US-481) |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` (US-481) |
| `components/overlay/Popper.Popper` (transitive in PopupMenu) | UIKit `Popover` (US-466 — already landed) |
| `components/overlay/Popper.PopperProps` (config struct) | UIKit `PopoverProps` subset |
| `components/overlay/Popper.PopperPosition` | UIKit `PopoverProps` positioning subset (already shape-matched per `uikit/Popover/PopoverModel.ts:18` comment) |
| `components/overlay/WithPopupMenu` | UIKit `WithMenu` (US-481) — only relevant if any showPopupMenu caller transitively re-exports this; callers already migrate individually under their per-screen tasks |

## Notes

- The default Copy / Paste / Inspect logic in `AppPopupMenuModel.addDefaultMenus`
  is **not** migration-sensitive — it manipulates `state.items` (an
  array of `MenuItem`-shaped objects). As long as UIKit `Menu.MenuItem`
  has the same fields (`label`, `onClick`, `icon`, `startGroup`,
  optional `disabled` / `submenu`), this logic ports unchanged.
- `overlayRegistry.register(el)` (suppresses page-level Tooltips while
  the menu is open) wraps the menu in a portal `<div ref={overlayRef}>`.
  Keep this wrapper; UIKit `Menu` mounts inside it the same way.
- The virtual-anchor pattern (`VirtualElement.getBoundingClientRect()`
  returning a zero-size rect at `(x, y)`) is supported by `@floating-ui`,
  which both legacy Popper and UIKit Popover use. No anchor-API change.
- `defaultOffset = [8, 0]`. Verify UIKit Popover accepts the same
  `[crossAxis, mainAxis]` offset shape or translate accordingly.
- `previouslyFocused?.focus()` after close is preserved (focus
  restoration is independent of menu primitive).

## Risk surface

- **`MenuItem` shape parity.** If UIKit `Menu.MenuItem` differs from
  legacy `PopupMenu.MenuItem` (e.g. `startGroup` renamed to
  `divider`), every caller's static menu definitions need touch-up.
  Investigate during US-481 review and capture the diff in this task's
  plan before implementation.
- **Submenu support.** Legacy `PopupMenu` supports nested submenus
  used by Browser context menu (Open in browser → list of profiles).
  Confirm UIKit `Menu` parity before migration.
- **Right-click in `<webview>`.** `showAppPopupMenu` is called from
  `BrowserWebviewModel` via IPC after a right-click inside the embedded
  webview. The `closePopper(showAppPopupMenuId)` "close existing before
  showing new" pattern at the top of `showAppPopupMenu` must be
  preserved — DOM click-outside doesn't fire for webview-originating
  right-clicks.

## Test surface (manual smoke)

- Right-click in a text page: app-default popup menu appears with
  Copy / Paste / Inspect items based on selection / focus / clipboard.
- Right-click in an editable area (Input/Textarea/contentEditable):
  Paste item appears; click it — clipboard content inserts at cursor;
  `input` event fires.
- Right-click selected text in any page: Copy item appears with the
  separator; click — text in clipboard.
- Right-click on a graph node / log row / browser tab / link-editor
  item: caller-supplied menu items render in addition to defaults.
- Right-click inside a `<webview>` (browser editor): menu still
  appears at the click coordinate; old menu auto-closes if a second
  right-click fires.
- Multi-screen: menu appears at correct coordinates on a non-primary
  monitor (verify `(x, y)` are window-relative).
- Tooltip suppression: page tooltips do NOT appear while the menu is
  open (`overlayRegistry` integration).
- Focus restoration: previously-focused element regains focus after
  menu closes.

## Acceptance criteria

- [ ] No imports from `components/overlay/` in
      `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` or
      `types.ts`.
- [ ] `MenuItem` (type) and the `showAppPopupMenu` /
      `closeAppPopupMenu` API names are preserved.
- [ ] All ~14 downstream callers compile (with their `MenuItem`
      import paths flipped if the type's source location changes).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test (see above) passes for at least: text page,
      editable input, graph node, browser webview, browser URL bar.

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the epic's deferred-review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration (overlay infrastructure)
- Blocked on: [US-481](../US-481-uikit-menu-with-menu/README.md) (UIKit Menu + WithMenu)
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md) (legacy folder deletion)
- Related: [US-466](../US-466-uikit-popover/README.md) (UIKit Popover — already landed)
