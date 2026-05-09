# US-506: Category editor — UIKit migration

## Status

**Placeholder** — not yet planned. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Category editor (folder/category browser) chrome to UIKit
primitives. After this task, `editors/category/CategoryEditor.tsx` no
longer imports from `components/basic|form|layout|overlay/` and contains
no `@emotion/styled` definitions.

The embedded `CategoryView` (from `components/tree-provider/`) is
**out of scope** — only the editor's own chrome changes.

## Scope

One rendering file:

- `src/renderer/editors/category/CategoryEditor.tsx`

`CategoryEditorModel.ts`, `FolderViewModeService.ts`, registration files
need no changes.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` root container | UIKit `Panel` |
| `components/basic/Button` (Toggle Navigator, view-mode toggle) | UIKit `IconButton` (or `SegmentedControl` for view-mode) |
| `components/layout/Elements.FlexSpace` | UIKit `Spacer` |
| `theme/color` direct read for chrome bg | drop — Panel default background |

## Notes

- View-mode toggle (`CategoryViewMode`) currently uses two Buttons; the
  classic UIKit substitute would be `SegmentedControl` with
  `ISegment[]`. Confirm during planning whether the existing two-button
  visual identity is preferred or if SegmentedControl is acceptable.
- Toolbar pattern is shared with Archive (US-505) and Explorer (US-507)
  — keep `IconButton` sizing/tooltip wording consistent across them.
- `CategoryView` itself stays as-is — likely scoped under a future
  CategoryView UIKit migration (or rolled into US-497 follow-up). Not
  this task.

## Test surface (manual smoke)

- Open a category page: layout renders, view-mode toggles work.
- Toggle Navigator button collapses/expands the navigator panel.
- Switch between view modes — selection persists per-folder via
  `folderViewModeService`.
- Click items in the embedded tree — opens linked content (unchanged
  behavior since `CategoryView` is unmodified).

## Acceptance criteria

- [ ] No `@emotion/styled` in `editors/category/CategoryEditor.tsx`.
- [ ] No imports from `components/basic|form|layout|overlay/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] View-mode toggle, navigator toggle, and tree navigation behave
      identically.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
