# US-499: TodoEditor — UIKit migration

## Status

**Placeholder** — pickup after sidebar arc closes. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Todo editor surface to UIKit primitives. After this task, no file
under `src/renderer/editors/todo/` imports from
`components/basic|form|layout|overlay/`.

## Scope

Three rendering files (the model file `TodoViewModel.ts` may need import-only
updates):

- `src/renderer/editors/todo/TodoEditor.tsx`
- `src/renderer/editors/todo/components/TodoListPanel.tsx`
- `src/renderer/editors/todo/components/TodoItemView.tsx`

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` | UIKit `Button` / `IconButton` (per icon-only vs labeled) |
| `components/basic/TextField` | UIKit `Input` |
| `components/basic/TextAreaField` | UIKit `Textarea` |
| `components/layout/Splitter` | UIKit `Splitter` (prop mapping — see US-492 README for old→new prop table) |
| `components/overlay/WithPopupMenu` | UIKit `WithMenu` |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` |
| `components/basic/useHighlightedText.HighlightedTextProvider` | UIKit `shared/highlight` (verify; this provider has no direct UIKit equivalent — may stay until a UIKit highlight context primitive lands or be inlined per-row using `searchText` prop on lists) |

## Notes

- `HighlightedTextProvider` is a React Context that distributes `searchText` to descendants for inline highlighting. UIKit's `ListBox` accepts `searchText` as a prop and does row-level highlighting in `TreeItem`/`ListItem`. Decide at pickup: drop the provider and pass `searchText` via list/tree props, OR keep the provider until a UIKit highlight-context primitive is added.
- `Splitter` prop mapping per US-492: `type`→`orientation`, `initialWidth`→`value` (controlled), `onChangeWidth`→`onChange`, `borderSized="right"`→`border="after"` (or `none` for chrome-overridden cases).
- Drag-reorder of todo items (if present) — preserve trait-based DnD.

## Test surface (manual smoke)

- Two-pane layout (TodoListPanel + TodoItemView) resizes via Splitter.
- Adding / editing / completing / deleting a todo works.
- Right-click context menus on items work.
- Search highlights matching text in todo titles.
- Keyboard navigation (arrow / Enter / Esc) preserved.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/todo/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test passes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
