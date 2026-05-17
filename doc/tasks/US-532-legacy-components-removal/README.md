# US-532: Legacy `components/{basic,form,layout,overlay}` removal

## Status

**Placeholder.** Final EPIC-025 close-out cleanup. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4. **Blocked on** every
per-screen migration in the dashboard PLUS [US-481](../US-481-uikit-menu-with-menu/README.md)
PLUS [US-530](../US-530-editor-base-chrome-migration/README.md) PLUS
[US-531](../US-531-show-popup-menu-migration/README.md).

## Goal

Delete the four legacy primitive folders (`basic`, `form`, `layout`,
`overlay`) under `src/renderer/components/`. After this task, no file
in the repository imports from those paths, the folders are gone,
and the surrounding components folders (`TreeView`, `file-search`,
`page-manager`, `tree-provider`, `data-grid`, `virtualization`,
`icons`) remain as the only non-UIKit shared components.

This task does NOT migrate any new code — it is a final
verification + delete sweep. If a non-trivial usage surfaces during
prep, the migration of that usage spawns a follow-up task; this
task does not absorb implementation work.

## Scope

Folders to delete after verifying zero remaining imports:

- `src/renderer/components/basic/` (Button, Checkbox, Chip, Input,
  InputBase, OverflowTooltipText, PathInput, Radio, TextAreaField,
  TextField, Tooltip, CircularProgress, Breadcrumb,
  useHighlightedText, types)
- `src/renderer/components/form/` (ComboSelect, ComboTemplate,
  List, ListMultiselect, SwitchButtons)
- `src/renderer/components/layout/` (CollapsiblePanelStack,
  Elements, Minimap, Splitter)
- `src/renderer/components/overlay/` (Popper, PopupMenu,
  WithPopupMenu)

Files to update (zero-or-tiny):

- `src/renderer/components/index.ts` — drop the four removed
  sub-barrel exports.
- Any straggler import that surfaces during the grep sweep — either
  fixed inline if trivial, or spun out as a follow-up task.

## Preconditions (must be true before this task starts)

Verified via grep that no file in `src/renderer/` (outside the
folders being deleted themselves) matches:

```
from "[^"]*components/(basic|form|layout|overlay)
```

If any match remains, the corresponding per-screen task is reopened
(or a new ad-hoc task is filed) and US-532 is paused.

## Notes

- The Minimap component (in `components/layout/Minimap.tsx`) is used
  by MarkdownView — [US-480](../US-480-markdown-view-migration/README.md)
  must either migrate it or move it to UIKit (Storybook lighthouse
  pattern). Tracked there, not here.
- The TreeView, file-search, page-manager, tree-provider, data-grid,
  virtualization, icons folders are intentionally retained — they
  hold higher-order composites that don't have a UIKit primitive
  counterpart and are tracked under their own per-component tasks
  (US-485 Tree, US-497 TreeProviderView, …).
- After deletion, run a full repo-wide grep one more time for any
  reference to the deleted module paths in:
  - `src/main/` (Electron main — shouldn't reference renderer
    components but worth grepping)
  - `assets/mcp-res-*.md` documentation
  - `doc/` and `docs/`
  - `qa/` and tests

## Test surface

- `npm start` — application boots, every menu / dialog / editor
  renders normally.
- `npm run lint` — clean (no new warnings, no new errors).
- `npx tsc --noEmit` — no new errors.
- `npm run dist` — production build succeeds (catches any stragglers
  the dev bundler tolerated).
- Quick UI smoke across high-traffic surfaces: open a Text page, a
  Grid page, a Notebook, the Browser editor, the LinkEditor, the
  Rest Client, the Settings page. All must render and respond to
  primary interactions.

## Acceptance criteria

- [ ] `src/renderer/components/basic/`, `form/`, `layout/`,
      `overlay/` directories are deleted from the working tree.
- [ ] `src/renderer/components/index.ts` no longer references the
      deleted sub-barrels.
- [ ] Repo-wide grep `from "[^"]*components/(basic|form|layout|overlay)`
      returns zero matches (outside this task's own README).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] `npm run dist` succeeds.
- [ ] Smoke test (see above) passes.
- [ ] No reference to deleted module paths in `assets/mcp-res-*.md`,
      `doc/standards/`, `docs/`, `qa/`, or `src/main/`.

This task does NOT run `/review`, `/document`, or `/userdoc` —
those run at EPIC-025 close. Practically: this IS the last task
before the epic closes, so the epic-close review immediately follows.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 close-out — final deletion
- Blocked on: every per-screen migration in the dashboard plus
  [US-481](../US-481-uikit-menu-with-menu/README.md),
  [US-530](../US-530-editor-base-chrome-migration/README.md),
  [US-531](../US-531-show-popup-menu-migration/README.md)
