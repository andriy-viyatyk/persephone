# US-508: Draw editor — UIKit migration

## Status

**Placeholder** — not yet planned. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Draw editor (Excalidraw canvas wrapper) chrome to UIKit
primitives. After this task, `editors/draw/DrawView.tsx` contains no
`@emotion/styled` definitions and imports nothing from
`components/basic|form|layout|overlay/`.

The Excalidraw component itself, library adapter, and export logic
(`drawExport.ts`, `drawLibrary.ts`) are **out of scope** — only the
toolbar and shell migrate.

## Scope

One rendering file:

- `src/renderer/editors/draw/DrawView.tsx`

`DrawViewModel.ts`, `drawExport.ts`, `drawLibrary.ts` need no changes.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` (DrawViewRoot, toolbar containers) | UIKit `Panel` |
| `components/basic/Button` (theme toggle, copy, download, snip, new-window) | UIKit `IconButton` |
| `components/basic/CircularProgress` (loading spinner) | UIKit `Spinner` (verify name in UIKit) |
| `components/overlay/WithPopupMenu` + `MenuItem` (menus) | UIKit `WithMenu` + `Menu.MenuItem` |

## Notes

- Theme toggle (Sun/Moon) flips Excalidraw between light/dark — keep
  the `THEME` import from `@excalidraw/excalidraw` and the
  `isCurrentThemeDark()` integration; only the surrounding `Button`
  becomes `IconButton`.
- Export menu (Copy / Download as SVG / Download as PNG) uses
  `WithPopupMenu` — migrate to `WithMenu`. Verify `MenuItem` shape
  matches UIKit `Menu.MenuItem`.
- Library button opens Excalidraw library — third-party UI inside
  the canvas; not affected.
- `createPortal` usage (if any) for in-canvas overlays is unaffected
  by this migration.
- Editor uses `useSyncExternalStore` for view state — model code
  unchanged.

## Test surface (manual smoke)

- Open a `.draw` file: Excalidraw loads with previous content.
- Theme toggle button switches Excalidraw light/dark — matches app
  theme.
- Export menu: Copy puts SVG in clipboard; Download as SVG/PNG saves
  files.
- Snip tool button launches Rust snip integration (unchanged).
- New-window button opens canvas in a new window.
- Library imports/exports work.
- Loading state shows spinner before Excalidraw mounts.

## Acceptance criteria

- [ ] No `@emotion/styled` in `editors/draw/DrawView.tsx`.
- [ ] No imports from `components/basic|form|layout|overlay/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] All toolbar actions (theme, copy, download, snip, new-window,
      library) work identically.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
