# US-500: TextEditor chrome — UIKit migration

## Status

**Placeholder** — pickup after sidebar arc closes. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the chrome around the Monaco-backed text editor to UIKit primitives.
The Monaco editor instance itself is **not** in scope — only the surrounding
toolbar, footer, and side panels. After this task, no chrome file under
`src/renderer/editors/text/` imports from
`components/basic|form|layout|overlay/`.

## Scope

Five rendering files (the model files `TextEditorModel.ts`,
`TextFileIOModel.ts`, etc. need no changes):

- `src/renderer/editors/text/TextEditorView.tsx` — outer chrome layout
- `src/renderer/editors/text/TextToolbar.tsx` — top toolbar
- `src/renderer/editors/text/TextFooter.tsx` — bottom status bar
- `src/renderer/editors/text/ScriptPanel.tsx` — collapsible script panel (right side)
- `src/renderer/editors/text/EncryptionPanel.tsx` — encryption password panel

## Old → UIKit primitives

| Old | New |
|---|---|
| `components/basic/Button` | UIKit `Button` / `IconButton` |
| `components/basic/TextField` | UIKit `Input` |
| `components/layout/Elements.FlexSpace` | UIKit `Spacer` |
| `components/layout/Splitter` | UIKit `Splitter` (prop mapping per US-492) |
| `components/form/SwitchButtons` | UIKit `SegmentedControl` |
| `components/form/ComboSelect` | UIKit `Select` |

## Notes

- This is the central editor; visual regressions are highly visible. Plan a thorough manual smoke test pass.
- `TextToolbar` toggles (word wrap, encoding, line endings, language) are good `SegmentedControl` candidates. Verify each toggle's controlled value semantics — `SwitchButtons` may have used a different active-state representation.
- `ComboSelect` for language picker → UIKit `Select`. Verify search/filter behavior parity (`Select` has searchable mode).
- `ScriptPanel` Splitter — sits between Monaco and the right-side panel. Verify the Splitter `value`/`onChange` is wired to the model's panel-width state.
- Active layout uses Rule 7 chrome where styled.div surrounds Monaco. Likely keep the Monaco-host `<div>` as styled chrome (Monaco needs a non-flex stable container) and convert only the toolbar/footer/panel surfaces.

## Test surface (manual smoke)

- Open a text file: toolbar buttons (save / new / search / wrap / etc.) work.
- Footer shows correct line/col, encoding, language, line-endings; clicking footer toggles open settings.
- Language picker filters and switches Monaco's mode.
- Encryption panel: enter password → file decrypts; wrong password shows error.
- Script panel: open / collapse / drag-resize via Splitter; run script.
- All toolbar tooltips appear on hover.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/text/`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Monaco editor still renders, scrolls, and edits without regression.
- [ ] All toolbar/footer/panel features verified per smoke test surface.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
