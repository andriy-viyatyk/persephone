# US-1450: Pin Built-in editors and Registered boards by drag-and-drop

## Status

**Status:** Implemented in working tree; follow-up increment in progress  
**Priority:** Medium  
**Epic:** None  
**Started:** 2026-09-18  

This document records the reviewed implementation plan and its drag-out follow-up. Product changes
are kept in the working tree for user testing, and `doc/active-work.md` is intentionally unchanged
by this increment.

## Goal

Allow a Built-in item or a Registered board in the Tools & Editors lists to be dragged into the
Pinned rail and inserted at the indicated position. Keep the existing live reorder behavior for
already-pinned rows, prevent duplicate pins, and support both the Tools & Editors page and the
header Tools & Editors panel. Dragging a pinned row to the Built-in or Registered boards tab body
removes that pin; every other drop location is inert.

## Background

### Current pin model

`src/renderer/ui/sidebar/pinned-items.ts` stores one ordered `string[]` in the
`pinned-editors` setting. `encodePin()`/`decodePin()` represent built-in items as their editor ID
and boards as `board:<absoluteRoot>`. The module currently exposes:

- `addPin(ref)`, which appends only when the encoded ref is not already present.
- `removePin(ref)`, which filters the encoded ref out.
- `movePin(dragIndex, hoverIndex)`, which removes one array entry and inserts it at the supplied
  index.
- `isPinned(ref)`, which checks the exact encoded string.

There is no insert-at-index operation. The new operation belongs in this module because both the
drag target and the existing pin buttons must use the same encoding and duplicate rules.

### Existing Pinned rail behavior

`src/renderer/ui/sidebar/PinnedRailView.ts` creates the drop rows in `createRow()` and owns the
drag handlers. A pinned row sends `TraitTypeId.PinnedEditor` with `{ index }` from `onDragStart()`.
`onDragOver()` reads the hovered row index, calls `movePin(draggingPinnedIndex, hoverIndex)`, and
updates the module-scope `draggingPinnedIndex` sentinel. This is deliberately live: each accepted
`dragover` persists the reordered array synchronously and `refresh()` rebuilds row indices.

Every rail `dragenter` and `dragover` currently requires both trait data and
`draggingPinnedIndex >= 0`, so a drag from another component is rejected. The rail's `drop` handler
only prevents the browser default and clears its visual flags; it does not currently interpret a
foreign payload.

`PinnedRailView.refresh()` currently sets `root.hidden` when the stored array is empty. The rail
root has the only explicit hiding rule in `src/renderer/ui/sidebar/PinnedRail.css`:
`[data-type="tools-editors-pinned"][hidden] { display: none; }`. No parent code hides or sizes it
conditionally. `ToolsHubView` appends the vertical rail as a sibling of the main column, and
`ToolsEditorsPanelView` appends the horizontal rail as a direct child before its tabs and body.

`PinnedRail.css` already uses `data-drag-over` with a `border-top` and
`--color-border-active` for row feedback, and uses `data-dragging` for opacity. That is the
application's existing insertion-indicator convention for this rail.

### Drag origins

`src/renderer/ui/sidebar/BuiltinEditorsListView.ts` creates a `ListBoxView<RowSource>`. Its
`createRowTraits()` maps source records to `LIST_ITEM_KEY` traits, and
`src/renderer/uikit/ListBox/types.ts` already includes `IListBoxItem.drag?: ListItemDragProps`.
`ListBoxView.itemProps()` forwards `item.drag`, and `ListItemView` attaches the six native drag
listeners and sets `draggable` from `drag.draggable`. Sections must remain non-draggable. The
Built-in refresh already filters out editor IDs found in `pinned-editors`, so a successfully pinned
editor will disappear from this list after the setting change.

`src/renderer/ui/sidebar/TrustedBoardsListView.ts` creates
`src/renderer/editors/board/BoardsTreeView.ts`, which wraps `src/renderer/uikit/Tree/TreeView.ts`.
`TreeView` already supports `traitTypeId`, `getDragData`, `onDragStartOverride`, and row drop
handling through `src/renderer/uikit/Tree/TreeDndModel.ts`. `TreeView` sets the pooled cell
wrapper's `draggable` property and forwards drag events to `TreeDndModel`; the row view exposes
`data-dragging` and `data-drop-active`, and `src/renderer/uikit/Tree/TreeItem.css` already styles
those attributes. `BoardsTreeView.projectNodes()` produces folder nodes and board leaf nodes with
`kind: "board"` and the absolute board `root`; only board leaves should produce pin payloads.

The boards list deliberately does not filter pinned boards. `TrustedBoardsListView.trailingElement()`
therefore continues to show a filled pin button for an already-pinned board. The existing
`togglePin()` uses the same exact `PinnedRef` encoding as the rail.

### Two hosts and dismissal behavior

The same `BuiltinEditorsListView`, `TrustedBoardsListView`, and `BoardsTreeView` classes are used
in both hosts:

- `src/renderer/editors/tools-hub/ToolsHubView.ts` mounts the `PinnedRailView` with
  `layout: "vertical"` beside the page body.
- `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` mounts it with `layout: "horizontal"` in
  the header panel. The panel is selected by `src/renderer/ui/sidebar/MenuBarView.ts`.

The `layout` value changes the rail container placement only. `PinnedRail.css` keeps the rail and
its rows in a column in both modes; there is no horizontal row-axis implementation to special-case
for index calculation.

`MenuBarView` closes the header surface from a click on the backdrop, while clicks inside
`menu-bar-content` stop propagation. It has no drag handler that dismisses the panel. The drag
operation will therefore remain inside the panel while the pointer moves from a source row to the
rail. The source row's normal `onClose` behavior remains unchanged for click/open actions; a
successful pin drop must not call `onClose`.

### Trait payload infrastructure and feedback conventions

`src/renderer/core/traits/dnd.ts` serializes `{ typeId, data }` under
`application/persephone-trait`; `setTraitDragData()` also sets `effectAllowed` to `move`.
`getTraitDragData()` reads that envelope, while `hasTraitDragData()` is only a type-presence check
for `dragenter`/`dragover`. `src/renderer/core/traits/TraitRegistry.ts` maps IDs to `TraitSet`s,
but the rail can directly inspect its own known payload and does not need a trait capability.
`TraitTypeId.PinnedEditor` already exists and is currently used by the rail without a registry
registration. `TreeDndModel` likewise serializes the configured ID and does not resolve it through
the registry. Consequently this task will keep the existing type ID and use a discriminated data
payload; it will not add a second enum member or a registry entry.

UIKit's existing DnD feedback is split by component contract: `TreeDndModel` drives
`data-dragging`/`data-drop-active` on `TreeItem`, and `PinnedRail.css`/`FolderItem.css` use
`data-drag-over` with a top border. `ListBox` exposes native drag callbacks but has no drop model.
The implementation will reuse those existing attributes and tokens, with no hardcoded colors and
no new generic component.

## Implementation Plan

### 1. Define the compatible pin payload and indexed insertion

Update `src/renderer/ui/sidebar/pinned-items.ts` with a shared serializable payload type used by
all three app views:

```ts
export type PinnedDragData =
    | { kind: "reorder"; index: number; ref: PinnedRef }
    | { kind: "source"; ref: PinnedRef };
```

The existing rail payload changes from an untagged `{ index }` to the `"reorder"` branch. Built-in
and board sources send the `"source"` branch. The drop target must validate `kind`, the ref shape,
and the expected numeric index before mutating settings; malformed or unrelated trait payloads are
ignored.

Add `insertPin(ref, index)` beside `addPin()` and `movePin()` with these exact semantics:

1. Encode the ref with `encodePin()`.
2. Copy `getPinnedStrings()` and remove every existing occurrence of the encoded ref, if any. The
   normal model is already unique because `addPin()` rejects duplicates, but filtering all matches
   makes the insertion operation itself incapable of preserving a duplicate legacy value.
3. If the first existing occurrence was before the requested position, decrement the requested
   position because removal shortened the prefix.
4. Clamp the resulting position to the new array bounds and insert the encoded ref once.
5. Do not write the setting when the encoded array is already in the requested order.

This means a new ref is inserted once, while an already-pinned board is moved to the requested
position rather than duplicated. It also gives a board dragged from the Registered boards list a
useful result even though that source remains visible after the drop.

Before:

```ts
export function addPin(ref: PinnedRef): void {
    const s = encodePin(ref);
    const cur = getPinnedStrings();
    if (!cur.includes(s)) setPinnedStrings([...cur, s]);
}
```

After (planned shape):

```ts
export type PinnedDragData =
    | { kind: "reorder"; index: number; ref: PinnedRef }
    | { kind: "source"; ref: PinnedRef };

export function insertPin(ref: PinnedRef, index: number): void {
    const encoded = encodePin(ref);
    const current = [...getPinnedStrings()];
    const existingIndex = current.indexOf(encoded);
    if (existingIndex >= 0) {
        current.splice(existingIndex, 1);
        // The persisted model is normally unique; filter any stale duplicate as a final guard.
        for (let i = current.length - 1; i >= 0; i--) {
            if (current[i] === encoded) current.splice(i, 1);
        }
    }
    const adjustedIndex = existingIndex >= 0 && existingIndex < index ? index - 1 : index;
    current.splice(Math.max(0, Math.min(adjustedIndex, current.length)), 0, encoded);
    if (current.join("\u0000") !== getPinnedStrings().join("\u0000")) setPinnedStrings(current);
}
```

The exact equality helper may be written without `join()`; the important contract is one encoded
entry and no setting write for a no-op. `addPin()` remains the append operation used by buttons.

### 2. Add a short-lived source-drag announcement for empty-rail visibility

Create `src/renderer/ui/sidebar/pinned-drag-session.ts` as an app-local DOM-event helper. It must
announce `{ ref }` at the start of a Built-in or board source drag and self-terminate the session:
the start operation registers a one-shot `document` `dragend` listener in the capture phase, and
that listener ends the session even when the source is a `TreeView` whose internal
`TreeDndModel.onDragEnd()` has no app-level callback. A Built-in source may also announce the end
from its own `onDragEnd` as a convenience, but that callback is not required for correctness and
no `onDragEnd` prop is to be added to `uikit/Tree`. `PinnedRailView` listens on the document and
stores only the transient active ref; the serialized `DataTransfer` payload remains authoritative
at `drop`.

This signal is required by the verified empty-rail behavior: a `display: none` rail cannot receive
`dragenter`, and the rail has no occupied layout area from which it could reveal itself. Do not
make the rail permanently visible merely to solve that bootstrapping problem. On a source drag
start, each mounted rail instance records the active-session flag and calls `refresh()`;
`refresh()` must compute `root.hidden = storedPins.length === 0 && !sourceSessionActive`. Ending
the session calls `refresh()` again, so every writer of the rail projection observes the same flag
rather than relying on a one-off `hidden` attribute write. The session's document capture listener,
a drop cleanup, and disposal all end the transient state; the capture listener is the required path
for aborted board drags.

Revealing the rail can reflow the source list under the cursor: the vertical rail is a fixed 240px
column with a left border, while the horizontal rail has `max-height: 50%`. Accept this layout cost
and reveal at `dragstart`, before the pointer moves, never on first `dragenter`. It is expected to
be rare because `src/renderer/ui/sidebar/tools-editors-registry.ts` defines six
`DEFAULT_PINNED_EDITORS`; an empty rail means the user deliberately unpinned everything.

The helper is app-specific state transport, not a UIKit primitive. It must not alter settings or
introduce a color/style contract.

### 3. Make Built-in rows drag sources

Update `src/renderer/ui/sidebar/BuiltinEditorsListView.ts`:

- Import `TraitTypeId`, `setTraitDragData`, the `PinnedDragData` type, and the source-drag session
  helper.
- Extend `createRowTraits()` with a `drag` accessor. Section markers return a non-draggable
  descriptor; `CreatableItem` rows return `draggable: true` with `onDragStart` and `onDragEnd`.
- On start, stop propagation, set the row's `data-dragging` attribute, announce the editor
  `PinnedRef`, and serialize `{ kind: "source", ref: { kind: "editor", id } }` using
  `TraitTypeId.PinnedEditor`.
- On end, remove the source row's `data-dragging` attribute and end the transient session. Do not
  mutate `pinned-editors` from the source's drag handlers.

The existing `tools-editor-row[data-dragging]` rule in `PinnedRail.css` supplies the same opacity
feedback already used by pinned rows; `ListItem.css` and the generic ListBox DnD API do not need
new styling or drop behavior.

Before:

```ts
const traits = new TraitSet().add(LIST_ITEM_KEY, {
    value: ..., label: ..., icon: ..., rowClass: () => "tools-editor-row",
    trailingElement: ..., trailingVisibility: ..., section: ...,
});
```

After (planned shape):

```ts
const traits = new TraitSet().add(LIST_ITEM_KEY, {
    value: ..., label: ..., icon: ..., rowClass: () => "tools-editor-row",
    trailingElement: ..., trailingVisibility: ..., section: ...,
    drag: (source: unknown) => isSection(source as RowSource)
        ? { draggable: false }
        : createEditorPinDrag((source as CreatableItem).id),
});
```

`createEditorPinDrag()` is a local helper in the view or the app-local session module; it must keep
the row-specific event handlers serializable-free and must not pin until a rail drop succeeds.

### 4. Enable board-leaf dragging only for the Registered boards surface

Do not enable DnD for every `BoardsTreeView` consumer: the same class is also used by
`src/renderer/editors/explorer/BoardsSecondaryView.ts` and `src/renderer/editors/board/BoardToolbar.ts`.
Extend `BoardsTreeViewProps` in `src/renderer/editors/board/BoardsTreeView.ts` with optional
board-drag callbacks/data providers. In `treeProps()`:

- Supply `traitTypeId: TraitTypeId.PinnedEditor` and `getDragData` only when the optional board
  pin-drag provider is present.
- Return `null` for folder nodes and return `{ kind: "source", ref: { kind: "board", root } }`
  for board leaves.
- Use `onDragStartOverride` to announce the board ref only when `node.kind === "board"` before
  returning `false`, allowing the existing `TreeDndModel.onDragStart()` path to serialize the
  payload and paint the tree's `data-dragging` state. The guard is necessary because the override
  is invoked for folder rows too; `TreeDndModel.canDragRow()` sees the configured DnD callbacks
  and `TreeView.ts` therefore sets folder wrappers' DOM `draggable` property even though the later
  `getDragData()` null gate cancels their `dragstart`.

Update `src/renderer/ui/sidebar/TrustedBoardsListView.ts` to provide those optional callbacks in
its `treeProps()` only. Keep `BoardsTreeView`'s explorer and toolbar consumers unchanged. Keep the
existing trailing pin button and `pinnedRoots` refresh logic unchanged except for sharing the same
`PinnedRef`/payload helper.

Before:

```ts
return {
    name: this.props.name,
    items: this.projectNodes(),
    defaultExpandAll: true,
    ...
};
```

After (planned shape):

```ts
return {
    name: this.props.name,
    items: this.projectNodes(),
    traitTypeId: this.props.getBoardDragData ? TraitTypeId.PinnedEditor : undefined,
    getDragData: (node: BoardTreeNode) => node.kind === "board" && node.root
        ? this.props.getBoardDragData?.(node.root) ?? null
        : null,
    onDragStartOverride: (node: BoardTreeNode, _level: number, event: DragEvent) => {
        if (node.kind === "board" && node.root) this.props.onBoardDragStart?.(node.root, event);
        return false;
    },
    defaultExpandAll: true,
    ...
};
```

The final callback names may be shortened, but the optional gating and board-only behavior are
required so unrelated board trees do not become pin drag sources.

### 5. Make the rail accept foreign source drops without changing live reorder

Update `src/renderer/ui/sidebar/PinnedRailView.ts` as follows:

- Keep the module-scope `draggingPinnedIndex` sentinel and the existing live `movePin()` path for
  the `"reorder"` payload. Its current persistence-on-`dragover` behavior is not part of this
  task's redesign.
- Add a foreign source ref/drop-index state that is never represented by
  `draggingPinnedIndex`. A foreign `dragenter`/`dragover` must not call `insertPin()` or
  `addPin()`.
- Accept only the active app source session for visual feedback. On a row, set the existing
  `data-drag-over` flag and use that row's current `PinnedRow.index` as the insertion index. The
  indicator is a top border, so the foreign item is inserted before the hovered row in both rail
  layouts.
- Register `dragenter`, `dragover`, `dragleave`, and `drop` listeners on `this.scroll` (and on any
  explicit empty-zone element if the CSS gives that zone its own node) through `this.listen()` in
  the view lifecycle. These listeners are released with the view. If the pointer is over the
  rail/scroll background rather than a row, use the current pin count as an append index. This is
  also the index for the empty rail's drop zone. The background `dragover` must call
  `event.preventDefault()` for an accepted source drag; otherwise the browser will not dispatch a
  `drop` event. Clear row flags when moving between rows and clear all transient state on
  `dragleave`, `drop`, `dragend`, and disposal.
- On `drop`, read `getTraitDragData(event.dataTransfer)`, require `typeId === TraitTypeId.PinnedEditor`,
  require `data.kind === "source"`, validate the `PinnedRef`, and call `insertPin(ref, dropIndex)`.
  A `"reorder"` payload continues to be handled by the existing row reorder path; no foreign
  branch may call `removePin()`.
- Keep the existing pin-button `removePin()` action as the only rail-local unpin action.

The rail's row handler must stop propagation or otherwise distinguish row drops from scroll
background drops so one gesture produces one setting mutation. The foreign branch must clear its
indicator before the setting refresh causes row recycling.

The drop-only foreign model has a deliberate cancellation property:

| Foreign-drag choice | Effect if the user drags out or presses Escape |
| --- | --- |
| Provisional insertion on first `dragenter` | A missing rollback would silently pin the source; this is rejected. |
| Insert only from `onDrop` | No setting changes occur, and the transient rail reveal/indicator is cleared; this is chosen. |

For an already-pinned row dragged within the rail, the existing live reorder remains: abandoning
that gesture after one or more `dragover` moves leaves the already-persisted reorder. That is an
existing behavior and is distinct from the new foreign-source path.

### 6. Reveal and style an empty drop zone without changing host layout contracts

Update `src/renderer/ui/sidebar/PinnedRail.css` only for the transient empty/drop state:

- Preserve the scoped `[hidden]` counter-rule and both existing layout selectors.
- Give the empty rail a real hit area while a source session is active, using the existing spacing/
  size CSS variables rather than a hardcoded dimension.
- Reuse `data-drag-over` and `--color-border-active` for the empty/background indicator; do not add
  a separate feedback vocabulary or a hardcoded color.
- Keep the existing row top-border indicator and `data-dragging` opacity rules.

`ToolsHubView` and `ToolsEditorsPanelView` do not add a competing hidden assumption: both append a
normal `PinnedRailView` root and let its own `hidden` state remove it from flex layout. The vertical
rail's fixed width and the horizontal rail's `max-height: 50%` remain valid when the transient empty
zone is shown. The header panel's `overflow: hidden` clips its content but does not suppress drag
events within the content; `MenuBarView` only closes on backdrop clicks or Escape.

### 7. Preserve both surfaces and support deliberate drag-out unpin

Because the source classes are shared, the new source props and rail drop behavior should be
enabled in both `ToolsHubView` and `ToolsEditorsPanelView` without adding a host-only prop gate. The
host tab-body element is the only drag-out target: it accepts a pinned-row reorder payload only on
the Built-in and Registered boards tabs and calls `removePin(ref)` after validating the ref.
Search, Tools, the rail, and all other drop locations remain inert for unpinning.

The pinned row starts an `"unpin"` session while retaining the existing live reorder path. Its
session cleanup and the helper's capture-phase `dragend` backstop clear host feedback; cancellation
or a drop outside the two accepted tab bodies never calls `removePin()`.

### 8. Verification scope

No unit tests or test harnesses are to be added. After implementation approval, use the repository's
existing lint/build checks and manual interaction verification for:

- empty rail in the vertical page and horizontal header panel;
- insertion before a hovered row and append on the empty/background zone;
- Built-in filtering after a successful drop;
- duplicate-board move rather than duplicate creation;
- Escape/cancellation outside the two accepted tab bodies leaves the pin unchanged;
- drag a pinned row onto Built-in or Registered boards in both hosts to remove that pin;
- existing live reorder and unpin button behavior;
- header panel staying open through a successful drag drop.

## Concerns / Open Questions

All requested design questions are resolved by source evidence:

- **Foreign drop timing:** use drop-only insertion. Provisional insertion would require rollback
  for `dragleave` and Escape, and no current pin-state transaction exists. Drop-only leaves
  `pinned-editors` untouched until a valid `drop`.
- **Insertion index:** a hovered rail row's current `PinnedRow.index` is the index before that row,
  matching the existing `data-drag-over` top-border indicator. Both `layout: "vertical"` and
  `layout: "horizontal"` use the same column of rows; the layout name changes container placement,
  not row ordering. The rail/scroll background appends at `getPinnedStrings().length`.
- **Empty rail:** `[hidden]` on `PinnedRailView.root` is the only verified suppression mechanism.
  A source-drag announcement must set the active-session input, call `refresh()`, and expose a
  token-sized empty zone before the pointer reaches the rail. `refresh()` must keep the rail shown
  while that flag is active and hide it again when the self-terminating session ends. No parent
  layout change is required. The resulting vertical/horizontal reflow is accepted because the
  reveal happens at `dragstart`, before pointer movement, and the default list ships six pins.
- **Both surfaces:** enable both. The classes are shared, the header content intercepts clicks but
  has no drag dismissal, and a drop must not invoke the source views' `onClose` callbacks.
- **Duplicates/already-pinned boards:** `insertPin()` removes the existing encoded ref before
  insertion and adjusts the target index, so a board dragged from its still-visible source row
  moves its existing pin and cannot create a second entry. Built-in rows are already filtered when
  pinned.
- **Payload compatibility:** keep `TraitTypeId.PinnedEditor` and add the `kind` discriminant.
  Existing reorder consumers can be updated to emit `kind: "reorder"`; no second trait ID is
  needed. `TraitRegistry`/`resolveTraits` is not involved because the target directly validates
  the payload, and `dnd.ts` already serializes arbitrary JSON data.
- **Drag-out:** a pinned row announces an `"unpin"` session and carries its ref in the reorder
  payload. Only the two host tab bodies accept that mode, and only after validating
  `TraitTypeId.PinnedEditor`, `kind: "reorder"`, and the serialized ref. Rail reorder, all other
  tabs, and all other drop locations remain inert; session cleanup never removes a pin.
- **Board-session cleanup:** `TreeView` exposes no app-level `onDragEnd`; its internal
  `TreeDndModel.onDragEnd()` is not a source-view callback. The app-local session helper therefore
  owns a one-shot capture-phase `document` `dragend` listener registered at session start. The
  board `onDragStartOverride` only starts the session for board nodes; it does not need a matching
  Tree prop to end it.
- **Folder DOM draggability:** because `TreeDndModel.canDragRow()` gates only on configured DnD
  callbacks and not on `getDragData()`, folder wrappers are expected to have DOM `draggable=true`.
  Their `dragstart` is canceled when `getDragData()` returns `null`, and the payload gate remains
  the enforcement of board-only pin dragging. This is intentional and should not be re-litigated
  as a requirement to change UIKit.
- **Feedback convention:** use `data-drag-over`/top border for rail insertion, `data-dragging` for
  source opacity, and existing Tree `data-dragging`/`data-drop-active` for board-source feedback.
  `ListBox` already exposes the needed native drag callbacks; no fourth UIKit DnD style is needed.

There are no unresolved product questions blocking implementation. The only implementation detail
to preserve during coding is the distinction between a transient source-session announcement and
the authoritative serialized drop payload.

## Acceptance Criteria

- [ ] Built-in `CreatableItem` rows are draggable in both Tools & Editors hosts; section rows are
      not draggable; the source row receives existing `data-dragging` feedback and no setting is
      changed at drag start.
- [ ] Registered board leaf rows are draggable in the Tools & Editors Registered boards tab in
      both hosts; folder rows do not produce pin payloads; other `BoardsTreeView` consumers do not
      become pin drag sources.
- [ ] A valid foreign source drop inserts exactly one encoded `PinnedRef` at the indicated index,
      and a drop on the empty/background zone appends at the end (index zero when empty).
- [ ] The foreign item is not persisted on `dragenter` or `dragover`; dragging out or pressing
      Escape leaves `pinned-editors` unchanged and removes the transient empty-rail reveal and
      indicator.
- [ ] The row insertion indicator reuses `data-drag-over`, the existing active-border token, and
      the existing top-border convention; no hardcoded colors are introduced.
- [ ] An already-pinned board dragged from Registered boards moves its existing pin to the target
      position and never creates a duplicate. Built-in rows disappear through their existing
      pinned-item filter after a successful drop.
- [ ] Existing pinned-row live reorder remains functional, including the module-scope sentinel,
      synchronous `movePin()` refresh, and current row feedback.
- [ ] The Pinned rail's pin button still unpins; dragging a pinned row to Built-in or Registered
      boards unpins it, while the rail, Search, Tools, and every other drop location do not.
- [ ] The rail becomes a drop target while empty in both vertical and horizontal layouts without
      remaining permanently visible when no pinable drag is active.
- [ ] The header Tools & Editors panel stays open during a drag inside its content and after a
      successful pin drop unless an existing source action explicitly closes it.
- [ ] `TraitTypeId.PinnedEditor` remains the only payload ID; the `kind` discriminant separates
      reorder and source payloads, and no new trait registry registration is added.
- [ ] `MenuBarView.ts`, UIKit ListBox/Tree DnD primitives,
      `src/renderer/core/traits/TraitRegistry.ts`, and
      `src/renderer/core/traits/dnd.ts` remain unchanged unless implementation review finds a
      source-level contradiction with the verified contracts above.
- [ ] No unit tests, test harnesses, or commit is created; `doc/active-work.md` remains untouched
      by this increment.

## Files Changed

### This planning task

| File | Change |
| --- | --- |
| `doc/tasks/US-1450-pin-by-drag/README.md` | Verified investigation, resolved design decisions, implementation plan, concerns, and acceptance criteria. |

`doc/active-work.md` is intentionally not changed because the request explicitly reserves it for
the user-maintained dashboard.

### Planned implementation touch set

| File | Planned responsibility |
| --- | --- |
| `src/renderer/ui/sidebar/pinned-items.ts` | Shared discriminated payload type and deduplicating `insertPin(ref, index)`. |
| `src/renderer/ui/sidebar/pinned-drag-session.ts` | App-local transient source-drag announcement used to reveal empty rails and clear cancellation state. |
| `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` | Built-in source drag descriptors, payload creation, and source visual/session cleanup. |
| `src/renderer/ui/sidebar/TrustedBoardsListView.ts` | Opt the Registered boards tree into board-leaf pin dragging. |
| `src/renderer/editors/board/BoardsTreeView.ts` | Optional board-only drag plumbing passed to UIKit `TreeView`; preserve other consumers. |
| `src/renderer/editors/tools-hub/ToolsHubView.ts` | Built-in/Registered boards tab-body unpin target and feedback cleanup. |
| `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` | Built-in/Boards tab-body unpin target and feedback cleanup. |
| `src/renderer/ui/sidebar/PinnedRailView.ts` | Foreign drag acceptance, row/background drop-index tracking, valid-drop insertion, empty reveal, and cleanup while preserving live reorder. |
| `src/renderer/ui/sidebar/PinnedRail.css` | Token-based empty/drop feedback and host unpin-target outline. |

### Files that need no changes

| File or area | Reason |
| --- | --- |
| `src/renderer/ui/sidebar/MenuBarView.ts` and `src/renderer/ui/sidebar/MenuBar.css` | Header dismissal is click/Escape based; no drag dismissal was found. |
| `src/renderer/uikit/ListBox/types.ts` | `IListBoxItem.drag` and `ListItemDragProps` already provide the required native source API. |
| `src/renderer/uikit/ListBox/ListBoxView.ts` and `src/renderer/uikit/ListBox/ListItemView.ts` | Existing forwarding and native listeners already support the planned Built-in source descriptors. |
| `src/renderer/uikit/ListBox/ListItem.css` | Source opacity can reuse the app's existing `.tools-editor-row[data-dragging]` rule; ListBox has no new drop target. |
| `src/renderer/uikit/Tree/types.ts`, `TreeView.ts`, `TreeDndModel.ts`, `TreeItemView.ts`, and `TreeItem.css` | Existing trait drag plumbing and `data-dragging`/`data-drop-active` feedback are sufficient. |
| `src/renderer/core/traits/TraitRegistry.ts` and `src/renderer/core/traits/dnd.ts` | Existing `PinnedEditor` envelope and direct payload reads are sufficient; no new trait ID or registry capability is needed. |
| `src/renderer/ui/sidebar/TrustedBoardsListView.ts`'s pin-button/remove-board logic | Existing pin toggling and untrust cleanup remain the source of truth; only tree drag props are added. |
| Test files and test harnesses | Explicitly out of scope for this project task. |

## Follow-up increment: drag pinned rows out to unpin (2026-09-18)

Testing changed the original step-7 decision: dragging a pinned rail row back into the Built-in or
Registered boards tab body now removes the row's pin for consistency with pinning. The session
helper carries `{ ref, mode }`, with `mode: "pin"` reserved for incoming source drags and
`mode: "unpin"` reserved for pinned-row reorder drags. This mode gate is required so the rail does
not mistake its own reorder gesture for a foreign source and insert a duplicate.

The host bodies are the drop targets because they cover the tab whitespace; the list roots are
`display: contents` and have no drop box. They accept only an active unpin session on the Built-in
or Registered boards tab, validate the serialized pinned ref, and clear their token-based inset
outline on re-entry, drop, session end, or disposal. No other drop target unpins.

Testing also found and fixed three related defects in the already-implemented pinning flow:

- the rail scroll box now uses `flex: 1 1 auto`, so whitespace below the rows belongs to the box;
- background drop listeners moved from the scroll box to the rail root with a not-inside-a-row
  guard;
- the append indicator became a bottom border on the last row instead of a top border on the
  scroll box.
