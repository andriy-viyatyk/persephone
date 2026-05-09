# US-507: Explorer + Search secondary editors — UIKit migration

## Status

**Placeholder** — not yet planned. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Explorer and Search secondary editors (right-panel file tree
and search) to UIKit primitives. After this task, no file under
`src/renderer/editors/explorer/` imports from
`components/basic|form|layout|overlay/`.

The embedded `TreeProviderView` (US-497) and `FileSearch`
(`components/file-search/` — separate UIKit task TBD) are **out of
scope**. This task migrates only the chrome around them — header
controls portalled into `headerRef`, container layout.

## Scope

Two rendering files:

- `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx`
- `src/renderer/editors/explorer/SearchSecondaryEditor.tsx`

`ExplorerEditorModel.ts` needs no changes.

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` (header controls — Up, Refresh, Collapse, Search, Close) | UIKit `IconButton` |
| Inline `style=` on header span | UIKit `Text` with `truncate` |
| Plain `<div>` containers | UIKit `Panel` |

## Notes

- Both editors use `createPortal(headerContent, headerRef.current)` to
  inject controls into the secondary-editor header. The portal pattern
  stays — only the inner JSX migrates to UIKit.
- Header pattern is shared with other secondary editors that have
  already migrated (sidebar). Match their `IconButton` size and tooltip
  conventions.
- `FileSearch` (in `components/file-search/`) is referenced by
  `SearchSecondaryEditor` — keep the embed unchanged; its own UIKit
  migration is a separate task (not yet created).

## Test surface (manual smoke)

- Open Explorer secondary panel: tree renders for current root.
- Header buttons: Up navigates parent dir, Refresh rebuilds, Collapse
  All collapses tree, Search toggles to Search panel.
- Header label shows current root basename and full path on hover.
- Open Search secondary panel: search input + results work.
- Click a search result: opens file at line / highlights query.
- Header Close in Search returns to Explorer.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in
      `editors/explorer/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Header controls behave identically; portalled rendering still
      works for both panels.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related: [US-497](../US-497-treeproviderview-migration/README.md) — `TreeProviderView` itself migrates separately
