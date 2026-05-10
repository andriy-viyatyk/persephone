# US-512: Notebook editor — UIKit migration

## Status

**Placeholder** — not yet planned. Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration.

## Goal

Migrate the Notebook editor surface (notebook with note items, expanded
note view, mini text editor for notes) to UIKit primitives. After this
task, no file under `src/renderer/editors/notebook/` imports from
`components/basic|form|layout|overlay/` and no `@emotion/styled`
definitions remain.

## Scope

Five rendering files:

- `src/renderer/editors/notebook/NotebookEditor.tsx` — notebook root,
  filter chrome, splitter between list and detail, collapsible side
  panels.
- `src/renderer/editors/notebook/NoteItemView.tsx` — list-row note item.
- `src/renderer/editors/notebook/ExpandedNoteView.tsx` — full-detail
  expanded note panel (path input, body textarea, action buttons).
- `src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx` —
  per-note toolbar (formatting, popup menu).
- `src/renderer/editors/notebook/note-editor/MiniTextEditor.tsx` —
  styled wrapper around the inline note text input.

## Files NOT changed

- `src/renderer/editors/notebook/note-editor/NoteItemActiveEditor.tsx` —
  no chrome imports (verified).
- `src/renderer/editors/notebook/NotebookEditorModel.ts` — pure model.
- `src/renderer/editors/notebook/notebookTypes.ts` — types.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` roots | UIKit `Panel` |
| `components/basic/Button` | UIKit `Button` / `IconButton` |
| `components/basic/TextField` | UIKit `Input` |
| `components/basic/TextAreaField` | UIKit `Textarea` |
| `components/basic/PathInput` | UIKit `PathInput` (US-474) |
| `components/basic/Breadcrumb` | UIKit equivalent (or keep until breadcrumb primitive lands — see Notes) |
| `components/basic/TagsList` | UIKit `TagsInput` (US-475) — read-only mode |
| `components/basic/useHighlightedText` (`HighlightedTextProvider`, `highlightText`) | keep — used inside content rendering, not chrome |
| `components/layout/CollapsiblePanelStack` (`CollapsiblePanel`, `CollapsiblePanelStack`) | UIKit `Panel` stack with custom collapse handling, OR keep until a UIKit collapsible-stack primitive lands |
| `components/layout/Splitter` | UIKit `Splitter` |
| `components/form/SwitchButtons` | UIKit `SegmentedControl` |
| `components/overlay/WithPopupMenu` | UIKit `WithMenu` |
| `components/overlay/PopupMenu.MenuItem` (type) | UIKit `Menu.MenuItem` |
| `theme/color` reads (chrome) | dropped — Panel tokens / Text colors |

Confirmed import inventory (current): `@emotion/styled`,
`components/basic/{Breadcrumb,Button,TagsList,TextField,TextAreaField,PathInput,useHighlightedText}`,
`components/layout/{CollapsiblePanelStack,Splitter}`,
`components/form/SwitchButtons`,
`components/overlay/{WithPopupMenu,PopupMenu}`,
`theme/color`.

## Notes

- The `useHighlightedText` hook lives under `components/basic/` but is a
  hook used inside note rendering, not a chrome primitive. Verify whether
  Phase 4 rules apply or whether it's exempt as content-rendering
  infrastructure (see how MarkdownView migration US-480 handled it).
- Verify `Breadcrumb` migration: check whether US-475 / US-487 introduced
  a UIKit primitive, or whether the legacy Breadcrumb is the only option.
  If no UIKit replacement exists, scope this task to **defer Breadcrumb
  swap** and call it out as a follow-up — flag in plan.
- `CollapsiblePanelStack` is a layout primitive used in several editors
  (Notebook, Browser bookmarks, etc.). If no UIKit equivalent exists,
  this task may need to compose Panels manually OR defer the stack swap
  with explicit rationale.
- `MiniTextEditor.tsx` is a thin styled wrapper around a contentEditable
  / textarea — the only thing to migrate is the styled root.

## Test surface (manual smoke)

- Open a `.notebook.json` file: notes render in the list panel.
- Click a note: detail / expanded view populates.
- Edit body in mini text editor — changes save back.
- Path input completes hierarchical paths.
- Tags display correctly on notes.
- Filter / search highlights matches.
- Collapse / expand side panels.
- Splitter resizes between list and detail.
- Note toolbar's popup menu (formatting / actions) opens and items click.
- SegmentedControl tab switching (if present in toolbar) works.

## Acceptance criteria

- [ ] No `@emotion/styled` import or usage in any file in scope.
- [ ] No imports from `components/basic|form|layout|overlay/` in any file
      in scope (Breadcrumb / CollapsiblePanelStack / useHighlightedText
      exceptions documented in plan if unavoidable).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Round-trip: load a notebook, edit a note, save — file persists.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related: [US-474 PathInput primitive](../US-474-uikit-pathinput/README.md),
  [US-475 Tag/TagsInput primitive](../US-475-uikit-tag/README.md),
  [US-481 UIKit Menu/WithMenu](../US-481-uikit-menu-with-menu/README.md)
