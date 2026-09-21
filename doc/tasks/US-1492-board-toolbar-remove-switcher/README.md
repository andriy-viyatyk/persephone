# US-1492: Remove the board toolbar's click-to-switch popover

**Status:** Complete  ·  **Epic:** [EPIC-112](../../epics/EPIC-112.md)

## Goal

Remove the board path text slot's click-to-switch popover and all code that exists only to render or
maintain it. Leave the slot as a plain, truncated board-path label and preserve board switching through
the sidebar Boards list and Explorer Boards panel.

This is EPIC-112 D4a. It is a prerequisite for the board-settable toolbar text work in US-1494, so
the toolbar must no longer treat arbitrary board-provided text as a board-switch trigger.

## Background

### Current toolbar implementation

[`BoardToolbarView`](../../../src/renderer/editors/board/BoardToolbar.ts) currently combines the
toolbar's surviving controls with a local board switcher:

- `BoardSwitcherContentProps` and the non-exported `BoardSwitcherContentView` (lines 25-70) wrap a
  `BoardsTreeView` in a 360px by 320px panel for the popover. A repository search finds no other
  consumer of `BoardSwitcherContentView`; it is safe to delete with the popover.
- `pathText` is appended to `pathPanel` as the wide middle slot. `onMount()` listens for its click
  and subscribes to trusted-board changes so the switcher list can be refreshed.
- The popover-only fields are `popover`, `switcherContent`, `explorerRoot`, `boards`, `canSwitch`,
  and `open` (current lines 87-93). `boardRoot` is not popover-only: it supplies the displayed path,
  the File Explorer button's navigator root, update detection, and Board Info.
- The popover-only methods are `createPopover`, `popoverProps`, `handlePathClick`, `closePopover`,
  `openBoard`, and `getScopedBoards` (current lines 217-285). `onDispose()` cleanup for
  `switcherContent`/`popover` and the matching branches in `sync()` also die with them.
- `getScopedBoards()` filters `boardTrust.listPaths()` by `sourceLink.explorerRoot`, using normalized
  equality or a normalized descendant prefix. The popover therefore never contained more boards than
  the global trusted-board list.

The catalog and install-registry refresh plumbing is not all switcher-only. `sync()` also calls
`listBoardUpdates()` to maintain the Properties button's update dot. Therefore the following remain:

- `publishedBoards` and `boardInstallRegistry` imports;
- their `subscribeCatalog`/`subscribeInstalled` subscriptions; and
- their `load()` calls, which satisfy `listBoardUpdates()`'s requirement that the catalog and install
  registry be loaded before synchronous update checks.

Only `boardTrust`'s toolbar subscription is popover-only and should be removed. `app` and
`createLinkData` also remain because `openProperties()` and `openLog()` still use them;
`fpNormalizeForCompare` remains because update detection still compares normalized board roots.

### Board switching remains available

The sidebar's [`TrustedBoardsListView`](../../../src/renderer/ui/sidebar/TrustedBoardsListView.ts#L243)
passes `boardTrust.listPaths()` without a workspace-root filter to the same `BoardsTreeView` used by
the old popover. The Explorer's Boards secondary view also remains available. Thus the sidebar list is
a strict superset of the popover's `getScopedBoards()` result; only the popover's workspace-scoped
convenience disappears.

`BoardsTreeView` itself must not be removed. It still serves the sidebar and Explorer Boards surfaces.
Likewise, the trailing `SwitchWidgetView` in `BoardToolbarView` and the `[Switch]` editor-switch
control described in the board layout are unrelated to the removed path popover and survive.

### Text-slot styling after removal

The text slot currently re-applies `hoverUnderline: this.canSwitch`. `Text.css` makes that attribute
both underlined-on-hover and pointer-cursor text. Once the popover is gone, `sync()` must pass
`hoverUnderline: false` unconditionally. `resolveTextAttributes()`/`applyTextAttributes()` should
remain in use so the slot continues to be styled as `size: "sm"`, `color: "light"`, and
`truncate: true`; the false value removes `data-hover-underline`, the pointer cursor, and the hover
underline while preserving truncation and the existing light path-label appearance.

### Documentation inventory

The source-backed switcher references found across `assets/guides/` and `qa/` are:

| File and current lines | Current reference | Disposition |
|---|---|---|
| [`assets/guides/editors/board.md:59-65`](../../../assets/guides/editors/board.md#L59) | “When the board toolbar switch menu is open” layout showing board switch choices | Remove the section. |
| [`assets/guides/editors/board.md:69`](../../../assets/guides/editors/board.md#L69) | Drawn-controls entry saying the board toolbar switch menu has no `elements` entry | Remove the entry. Keep the separate `board-toolbar-properties` entry and the editor-switch documentation. |
| [`assets/guides/boards.md:288`](../../../assets/guides/boards.md#L288) | In-board toolbar instructions say to click the path label to open the boards-switcher popover | Remove the switcher instruction; retain the Boards-panel and scripting routes. |
| [`assets/guides/boards.md:304`](../../../assets/guides/boards.md#L304) | Board path label description says it opens the popover when opened from a Boards panel | Rewrite as a non-interactive full-path label; do not describe the path as a switch control. |
| [`assets/guides/boards.md:308`](../../../assets/guides/boards.md#L308) | Description of the boards-switcher popover tree | Remove. |
| [`assets/guides/boards.md:1164`](../../../assets/guides/boards.md#L1164) | Quick-reference row for switching boards from inside a board via the popover | Remove the row; the adjacent sidebar, script, Explorer, reload, log, and Properties rows remain. |
| [`assets/guides/whats-new.md:112-113`](../../../assets/guides/whats-new.md#L112) | Shipped Version 5.0.3 note says the board's own toolbar list matched the Tools & Editors list | Leave unchanged: this is a historical changelog claim about what that release shipped. |
| [`assets/guides/whats-new.md:860-869`](../../../assets/guides/whats-new.md#L860) | Shipped Version 4.0.7 toolbar table says the path label opens the boards-switcher popover | Leave unchanged: this is a historical changelog claim about what that release shipped. |
| [`assets/guides/whats-new.md:13`](../../../assets/guides/whats-new.md#L13) | Version 5.0.4 (Upcoming) has the current-release notes | Add a removal note: the board path no longer opens a switcher; use the Boards panel or Explorer Boards panel to switch boards. |
| [`qa/surfaces/editors/boards.md:94-95`](../../../qa/surfaces/editors/boards.md#L94) | Says the board switcher is not an `elements` entry because it is portalled | Remove this obsolete assertion and replace the scenario wording with the post-removal behavior if a QA assertion is needed. |

The nearby QA assertion at [`qa/surfaces/editors/boards.md:92`](../../../qa/surfaces/editors/boards.md#L92),
`highlight("board-toolbar-properties")`, survives: Properties is a real toolbar control and is not
the removed switcher. The `[Switch]` in `assets/guides/editors/board.md:25` is the editor switch and
also survives. Other generic editor-switch references found by the search are not board-path popover
references and must not be removed.

## Implementation Plan

1. Update `src/renderer/editors/board/BoardToolbar.ts`.

   - Delete `BoardSwitcherContentProps` and `BoardSwitcherContentView`.
   - Remove the popover-only imports: `boardTrust`, `encodePersephoneBoardLink`,
     `PopoverView`/`PopoverViewProps`, and `BoardsTreeView`. Keep `publishedBoards`,
     `boardInstallRegistry`, `listBoardUpdates`, `app`, `createLinkData`, and
     `fpNormalizeForCompare` for update-dot, properties, log, and update-comparison behavior.
   - Delete the `popover`, `switcherContent`, `explorerRoot`, `boards`, `canSwitch`, and `open`
     fields. Keep `boardRoot` and the surviving control fields.
   - In `onMount()`, remove the path-text click listener and `boardTrust.subscribePaths(this.sync)`.
     Keep the published-catalog and install-registry subscriptions and loads because they refresh the
     Properties update dot and initialize the data consumed by `listBoardUpdates()`.
   - Change the model binding to observe only `state.boardRoot`; do not remove
     `sourceLink.explorerRoot` from shared state or from any other model. It is only the
     `BoardToolbarView` field/mapping that becomes unnecessary here.
   - Reduce `onDispose()` to the surviving update-dot cleanup. Remove switcher-content and popover
     release logic.
   - In `sync()`, retain board-root assignment, path text assignment, update detection, Properties
     button refresh, and update-dot lifecycle. Remove explorer-root/board-list derivation and all
     popover/content create, update, and teardown branches.
   - Make the text style plain and stable:

     ```ts
     // Before
     applyTextAttributes(this.pathText, resolveTextAttributes({
         size: "sm", color: "light", truncate: true, hoverUnderline: this.canSwitch,
     }));

     // After
     applyTextAttributes(this.pathText, resolveTextAttributes({
         size: "sm", color: "light", truncate: true, hoverUnderline: false,
     }));
     ```

     This preserves the slot's existing size, color, and truncation while ensuring it has neither
     switcher cursor nor hover underline.
   - Delete `createPopover`, `popoverProps`, `handlePathClick`, `closePopover`, `openBoard`, and
     `getScopedBoards`. Do not alter `openProperties()` or `openLog()`.

2. Update the user-facing and QA documentation listed in the inventory above. Remove all claims that
   clicking the board path opens a board list from the current guides and QA surface, while preserving
   the editor switch, Properties control, sidebar Boards list, Explorer Boards panel, and
   script-based `app.boards.openBoard()` routes. The documentation changes must not imply that
   `board-toolbar-properties` was removed. Leave the two switcher statements in the shipped sections
   of `assets/guides/whats-new.md` unchanged because that file is a complete historical changelog;
   add this new bullet under `## Version 5.0.4 (Upcoming)` instead:

   ```md
   - **Board path switching now uses the Boards panels:** clicking the board path no longer opens a
     switcher; use the **Boards** panel or the Explorer **Boards** panel to switch boards.
   ```

3. The EPIC-112 dashboard entry in [`doc/active-work.md`](../../active-work.md#L67) is already the
   required link to this README. Do not search for or recreate a plain-text entry, add a duplicate,
   or modify the EPIC-112 task-table link.

4. Verify the implementation with targeted searches and the project's normal lint/type checks:
   `BoardSwitcherContentView`, `board-toolbar-switcher`, `board-toolbar-boards`,
   `handlePathClick`, `getScopedBoards`, `canSwitch`, and `switcherContent` must have no remaining
   references in `BoardToolbar.ts`; `BoardSwitcherContentView` must have no repository consumer;
   and `BoardToolbar.ts` must retain the update-dot catalog/registry subscriptions and loads. Inspect
   the rendered toolbar or the relevant surface QA flow to confirm the path is not clickable, no
   popover is mounted, the editor switch still renders, Properties still highlights, and sidebar
   board switching still opens a board.

## Concerns

- `publishedBoards` and `boardInstallRegistry` look related to board discovery, but removing their
  subscriptions or loads would regress update-dot initialization and refresh because
  `listBoardUpdates()` reads both models synchronously. They are deliberately retained.
- `explorerRoot` remains a valid property of source-link state and is still used by board-opening
  flows elsewhere. Only the toolbar's popover-specific field and state mapping are removed.
- `BoardsTreeView` is shared infrastructure, not dead code. Its `baseRoot` single-root mode is used
  by the Explorer Boards panel, while the sidebar's `TrustedBoardsListView` supplies the complete
  `boardTrust.listPaths()` set without the toolbar's filter.
- The toolbar's `SwitchWidgetView` is the editor-switch control, not the path popover. It remains in
  the DOM and in the board guide's toolbar layout. `board-toolbar-properties` likewise survives.
- US-1492 does not implement US-1494's board-settable text/fallback or any new tooltip contract. It
  only removes the obsolete interaction and makes the existing path slot visually non-interactive;
  later text-slot work must build on that plain-label state.

## Acceptance Criteria

1. `BoardToolbarView` has no `BoardSwitcherContentView`, popover state, path-click handler, scoped
   board list, or board-open callback, and no dead imports remain.
2. `publishedBoards`/`boardInstallRegistry` loading and subscriptions remain so the Properties update
   dot still detects catalog updates; `boardRoot`, Properties, Log, Reload, File Explorer, and the
   editor switch continue to work.
3. The path slot still displays `boardRoot`, remains `size: "sm"`, light-colored, and truncated, but
   has `hoverUnderline: false` and no pointer/underline affordance. Clicking it does not mount or
   open any popover.
4. `BoardSwitcherContentView` has no other consumer, while shared `BoardsTreeView` remains used by
   the sidebar/Explorer board lists.
5. Board switching remains possible from the sidebar Boards list and Explorer Boards panel; those
   lists expose at least the boards formerly returned by `getScopedBoards()`.
6. The two switch-menu references in `assets/guides/editors/board.md`, all four switcher references
   in `assets/guides/boards.md`, and the obsolete QA note in `qa/surfaces/editors/boards.md` are
   removed or rewritten as inventoried. The two shipped switcher references in
   `assets/guides/whats-new.md` remain unchanged, and a new Version 5.0.4 (Upcoming) note records
   that the board path no longer opens a switcher and directs users to the Boards panels. The
   `board-toolbar-properties` QA assertion and editor-switch documentation remain.
7. The EPIC-112 entry in `doc/active-work.md` links to this README, no commit is created, and no
   implementation is performed as part of task authoring.

## Files Changed Summary

| File | Change |
|---|---|
| `doc/tasks/US-1492-board-toolbar-remove-switcher/README.md` | This investigation, implementation plan, source/member/import inventory, documentation inventory, concerns, and acceptance criteria. |
| `src/renderer/editors/board/BoardToolbar.ts` | Remove the board-path click switcher and its local content/state/imports; retain update-dot data loading and all surviving toolbar controls. |
| `assets/guides/editors/board.md` | Remove the open-switch-menu layout and drawn switch-menu entry; preserve the editor switch and surviving toolbar controls. |
| `assets/guides/boards.md` | Remove/rewrite all four board-path switcher instructions. |
| `assets/guides/whats-new.md` | Add the US-1492 removal note under Version 5.0.4 (Upcoming); leave the two shipped release entries unchanged. |
| `qa/surfaces/editors/boards.md` | Remove the obsolete portalled-board-switcher assertion while retaining the Properties assertion. |
| `doc/active-work.md` | Already updated during task authoring: the EPIC-112 US-1492 entry is linked; no further dashboard edit is needed. |
| `doc/epics/EPIC-112.md` | No change; its US-1492 task-table link already points to this README. |
| `src/renderer/editors/board/BoardsTreeView.ts` | No change; shared by the sidebar and Explorer Boards surfaces. |
| `src/renderer/ui/sidebar/TrustedBoardsListView.ts` | No change; it renders the unfiltered `boardTrust.listPaths()` list through `BoardsTreeView`. |
| `src/renderer/editors/explorer/BoardsSecondaryView.ts` | No change; the Explorer Boards panel remains a board-switching route. |
| `src/renderer/editors/board/BoardEditorModel.ts` and shared source-link state | No change; `explorerRoot` remains valid outside the removed toolbar popover. |
