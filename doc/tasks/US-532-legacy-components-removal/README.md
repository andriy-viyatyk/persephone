# US-532: Final `components/` sweep — empty the legacy folder

## Status

**Placeholder.** Final EPIC-025 close-out cleanup. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4. **Blocked on** every
per-screen migration in the dashboard PLUS the UIKit-primitive and
overlay infrastructure tasks listed under "Blocked on" below.

## Goal

Empty `src/renderer/components/` entirely. After this task, the
`src/renderer/components/` folder no longer exists — every subfolder
has either been migrated to UIKit (basic / form / layout / overlay /
TreeView / data-grid / virtualization) or relocated under user
review (icons / page-manager / file-search / tree-provider). No file
in the repository imports from `components/` paths.

This task does NOT migrate any new code — it is a final
verification + delete sweep. The migration of every subfolder is
tracked by its own per-folder task (see "Blocked on"). If a
non-trivial usage surfaces during prep, the migration of that usage
spawns a follow-up task; this task does not absorb implementation
work.

The scope expanded from the original "delete the four primitive
folders" after the audit in 2026-05 surfaced that the surrounding
folders (data-grid, virtualization, TreeView, icons, page-manager,
file-search, tree-provider) would either migrate into UIKit or get
reviewed individually by the user. Per that audit, US-532 became
the single end-of-epic sweep rather than a four-folder delete.

## Scope

### Primitive folders — delete (zero callers post-Phase 4)

After all per-screen migrations land and the UIKit primitives below
exist, these folders should be callerless and ready to delete in
this task:

- `src/renderer/components/basic/` (Button, Checkbox, Chip, Input,
  InputBase, OverflowTooltipText, PathInput, Radio, TextAreaField,
  TextField, Tooltip, CircularProgress, Breadcrumb,
  useHighlightedText, types) — already zero external callers as of
  the 2026-05 audit; can be deleted as soon as US-532 runs.
- `src/renderer/components/form/` (ComboSelect, ComboTemplate,
  List, ListMultiselect, SwitchButtons) — already zero external
  callers.
- `src/renderer/components/layout/` (CollapsiblePanelStack,
  Elements, Minimap, Splitter) — already zero external callers.
- `src/renderer/components/overlay/` (Popper, PopupMenu,
  WithPopupMenu) — callerless after US-535 (MenuItem flips) +
  US-509 (Grid editor chrome) + US-531 (showPopupMenu) all land.

### Composite folders — migrated to UIKit by their own tasks

- `src/renderer/components/data-grid/` — migrated to `uikit/DataGrid/`
  by [US-536](../US-536-uikit-datagrid/README.md). Delete the
  source folder here.
- `src/renderer/components/virtualization/` — migrated to
  `uikit/RenderGrid/` by
  [US-538](../US-538-uikit-rendergrid/README.md). Delete here.
- `src/renderer/components/TreeView/` — callerless after
  [US-537](../US-537-treeview-flip-restclient/README.md). Delete
  here.

### Remaining folders — user-reviewed individually

The following four folders are NOT addressed by any pre-US-532
migration task; the user will review each individually after the
migration set above completes, then either decide on a destination
(UIKit / `ui/` / `editors/*` / a new `shared/` home) or accept
keeping them in `components/` permanently:

- `src/renderer/components/icons/` (FileIcon, FolderIcon,
  LanguageIcon) — 12 callers
- `src/renderer/components/page-manager/` (AppPageManager,
  PageManager, GroupContainer, ImperativeSplitter) — 2 callers
- `src/renderer/components/file-search/` (FileSearch,
  FileSearchModel) — 2 callers
- `src/renderer/components/tree-provider/` (CategoryView,
  CategoryViewModel, TreeProviderItemIcon, TreeProviderView,
  TreeProviderViewModel, favicon-cache) — 18 callers; US-497
  migrates the `TreeProviderView` component itself, the rest stays
  for the user review

If the user keeps any of these folders in `components/` after
review, US-532 simply skips them. The task succeeds when every
folder listed under "Primitive" and "Composite" above is deletable
and deleted.

### Files to update (zero-or-tiny)

- `src/renderer/components/index.ts` — drop the sub-barrel exports
  for every folder this task deletes.
- Any straggler import that surfaces during the grep sweep — either
  fixed inline if trivial, or spun out as a follow-up task.

## Preconditions (must be true before this task starts)

For each folder to be deleted, verified via grep that no file in
`src/renderer/` (outside that folder itself) matches:

```
from "[^"]*components/<folder-name>
```

If any match remains, the corresponding per-screen / per-folder
task is reopened (or a new ad-hoc task is filed) and US-532 is
paused for that folder.

## Notes

- The Minimap component (in `components/layout/Minimap.tsx`) is used
  by MarkdownView — [US-480](../US-480-markdown-view-migration/README.md)
  must either migrate it or move it to UIKit (Storybook lighthouse
  pattern). Tracked there, not here.
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

- [ ] Every folder listed under "Primitive folders — delete" and
      "Composite folders — migrated to UIKit" above is deleted from
      the working tree.
- [ ] `src/renderer/components/index.ts` no longer references the
      deleted sub-barrels (or the file itself is deleted if empty).
- [ ] Repo-wide grep `from "[^"]*components/(basic|form|layout|overlay|TreeView|data-grid|virtualization)`
      returns zero matches (outside this task's own README).
- [ ] For folders the user opts to keep in `components/` after
      individual review (icons / page-manager / file-search /
      tree-provider): their callers continue to work; no other
      changes required.
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
- Phase: 4 close-out — final `components/` sweep
- Blocked on:
  - Every per-screen migration in the dashboard
  - [US-481](../US-481-uikit-menu-with-menu/README.md) — UIKit Menu
  - [US-530](../US-530-editor-base-chrome-migration/README.md) — Editor base chrome
  - [US-531](../US-531-show-popup-menu-migration/README.md) — showPopupMenu
  - [US-535](../US-535-menuitem-import-flips/README.md) — MenuItem caller flips
  - [US-536](../US-536-uikit-datagrid/README.md) — UIKit DataGrid
  - [US-537](../US-537-treeview-flip-restclient/README.md) — TreeView flip
  - [US-538](../US-538-uikit-rendergrid/README.md) — UIKit RenderGrid
  - User review of remaining folders (icons / page-manager /
    file-search / tree-provider) once everything above lands
