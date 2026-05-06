# US-491: FolderItem + MenuBar left-panel list — UIKit migration

## Goal

Migrate the MenuBar left-rail folder list (the static + custom folders column rendered via
[`<List options={allFolders} rowRenderer={folderRowRenderer}>`](../../../src/renderer/ui/sidebar/MenuBar.tsx))
from the legacy [`components/form/List`](../../../src/renderer/components/form/List.tsx) to UIKit
[`ListBox`](../../../src/renderer/uikit/ListBox/ListBox.tsx). Rewrite
[`FolderItem.tsx`](../../../src/renderer/ui/sidebar/FolderItem.tsx) as a `renderItem`-driven row
component: drop the absolute-positioning logic (`top`/`height`/`itemMarginY`), replace
`OverflowTooltipText` + `components/basic/Tooltip` with UIKit `Tooltip` + CSS truncation, and
move the `.list-item` hover/selected styling that currently lives in `MenuBar.tsx` into
`FolderItem` itself (using `data-*` attributes per UIKit Rule 1).

After this task, both files contain zero imports from `components/form/`,
`components/basic/Tooltip`, or `components/basic/OverflowTooltipText`. Trait-based DnD
(`setTraitDragData` / `getTraitDragData` / `hasTraitDragData` with
`TraitTypeId.MenuFolder`) stays intact — it's row-local behavior that ListBox doesn't
care about.

## Background

### Current implementation

[`MenuBar.tsx:573-587`](../../../src/renderer/ui/sidebar/MenuBar.tsx) mounts:

```tsx
<List
    options={allFolders}                     // [...staticFolders, ...folders]
    getLabel={model.getFolderLabel}
    getSelected={model.getLeftItemsHovered}  // item.id === state.leftItemId
    onClick={model.setLeftItem}
    getIcon={model.getFolderIcon}
    selectedIcon={<ArrowRightIcon className="selected-icon" />}
    rowHeight={22}
    getContextMenu={model.getMenuFolderContextMenu}
    onContextMenu={model.onLeftPanelContextMenu}
    getTooltip={model.getFolderTooltip}
    rowRenderer={folderRowRenderer}          // wraps each row in <FolderItem/>
/>
```

`folderRowRenderer` ([`MenuBar.tsx:447-471`](../../../src/renderer/ui/sidebar/MenuBar.tsx))
returns `<FolderItem>` with these forwarded props:

| FolderItem prop | Source |
|---|---|
| `folder, index, style, selected` | from `OptionProps<MenuFolder>` (List's renderer ctx) |
| `onClick` | List's `optionClick` (forwards to `model.setLeftItem`) |
| `onDoubleClick` | `canOpenInTab(row) ? model.openFolderInTab : undefined` |
| `icon` | `model.getFolderIcon(row)` |
| `label` | `model.getFolderLabel(row)` |
| `selectedIcon` | `<ArrowRightIcon className="selected-icon" />` |
| `onSelectedIconClick` | `canOpenInTab(row) ? model.openFolderInTab : undefined` |
| `itemMarginY, getTooltip, getContextMenu` | from `OptionProps` (forwarded by List) |
| `canDrag, canDrop` | `!isStaticFolder(row)` for both |

[`FolderItem.tsx`](../../../src/renderer/ui/sidebar/FolderItem.tsx) (current, 222 lines) handles:

1. **Absolute positioning** — `style.top`, `style.height` adjusted by `itemMarginY` (legacy List
   passes a `style` with absolute coords; the row applies them). Removed in the migration —
   ListBox's wrapper `<div>` already owns positioning.
2. **HTML5 drag-and-drop** — `onDragStart` calls `setTraitDragData(TraitTypeId.MenuFolder, {id})`,
   `onDrop` calls `menuFolders.move(srcId, targetId)`. `dragEnterCount` ref disambiguates
   nested enter/leave so `isOver` flips reliably.
3. **Visual states via class names** — `clsx("list-item", {selected, dragging, "drag-over"})`.
   The hover/selected backgrounds live in `MenuBar.tsx`'s `.menu-bar-left .list-item` rules.
4. **Tooltip** — legacy `<Tooltip id delayShow={1500}>` from `components/basic/Tooltip`,
   anchored via `data-tooltip-id` on the row.
5. **Truncated text** — `<OverflowTooltipText className="item-text">` shows native title attr
   when text overflows.
6. **Selected-icon button** — when `selected && selectedIcon && onSelectedIconClick`, renders the
   icon wrapped in `<span className="selected-icon-button" onClick title="Open folder in new tab">`.

### What UIKit `ListBox` already provides

[`uikit/ListBox/types.ts`](../../../src/renderer/uikit/ListBox/types.ts) +
[`ListBox.tsx`](../../../src/renderer/uikit/ListBox/ListBox.tsx) +
[`ListBoxModel.ts`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts) already expose every
feature this migration needs:

- **`renderItem`** — `(ctx: ListItemRenderContext<T>) => React.ReactNode`. The wrapper `<div>`
  owns `style` (positioning) + `onClick` + `onMouseEnter` + `onContextMenu`. The renderItem
  result is dropped INSIDE that wrapper, so DnD handlers go on the inner element of FolderItem
  and the wrapper-level click/contextMenu still flow through `onChange` / `getContextMenu`.
  ([`ListBox.tsx:103-147`](../../../src/renderer/uikit/ListBox/ListBox.tsx))
- **`isSelected(source, idx)`** — predicate-driven selection; replaces legacy `getSelected`.
  Forwarded into `renderItem` via `ctx.selected`.
- **`getContextMenu(source, idx)`** — per-row menu via `ContextMenuEvent.fromNativeEvent(…, "generic")`.
- **`onContextMenu(e)`** — container-level menu handler invoked when no row populated the event.
  Replaces legacy `onContextMenu={model.onLeftPanelContextMenu}` (sidebar background "Add Folder").
- **`LIST_ITEM_KEY` trait** — `value` / `label` / `icon` / `section` accessors plug an arbitrary
  source type into ListBox without per-call accessor props. We use `value` + `label` only;
  `icon` is consumed by FolderItem directly (via the model's `getFolderIcon` closure), not by
  the default `<ListItem>` which we bypass with `renderItem`.
- **`variant: "select" | "browse"`** — soft-hover sidebar feel. Not used here because
  `renderItem` overrides the default `<ListItem>` and we ship FolderItem-local hover styling
  via `data-*` attributes (matches the rest of the chrome).

Key behavior: when `renderItem` is supplied, `getTooltip` is NOT invoked by ListBox
([`types.ts:91`](../../../src/renderer/uikit/ListBox/types.ts)). FolderItem must wire the
tooltip itself — by accepting a `tooltip` prop and rendering a UIKit `<Tooltip>` around the row.

### Reference migrations

- [US-490 (OpenTabsList)](../US-490-opentabslist-migration/README.md) — closest sibling. Used
  the **default `<ListItem>` renderer** with `LIST_ITEM_KEY` traits, `isSelected` predicate,
  `getTooltip`, `variant="browse"`. No DnD, no custom row.
- [US-479 (FileList)](../US-479-filelist-migration/README.md) — same pattern as US-490, plus a
  search bar.
- **This task is different**: FolderItem has DnD, a clickable selected-icon button, and
  per-row hover/selected styling baked into the chrome. Those require a custom `renderItem`
  rather than the default `<ListItem>`. There is no prior UIKit ListBox migration that
  exercises `renderItem` + DnD; this is the first.

### Files involved

| File | Role | Change |
|------|------|--------|
| [`src/renderer/ui/sidebar/FolderItem.tsx`](../../../src/renderer/ui/sidebar/FolderItem.tsx) | Row component | **Rewrite** — drop absolute-positioning logic; move `.list-item` hover/selected styling here via `data-*` attributes; replace `OverflowTooltipText` + legacy `Tooltip` with CSS truncation + UIKit `Tooltip`; preserve DnD logic verbatim |
| [`src/renderer/ui/sidebar/MenuBar.tsx`](../../../src/renderer/ui/sidebar/MenuBar.tsx) | Consumer | **Modify** — replace `<List rowRenderer=…>` with `<ListBox renderItem=…>`; add module-level `LIST_ITEM_KEY` traits for `MenuFolder`; remove the now-redundant `.menu-bar-left .list-item` CSS block; remove imports of `List` / `ListOptionRenderer` |
| [`doc/active-work.md`](../../active-work.md) | Dashboard | **Modify** — convert the US-491 line so the link still resolves; the task remains unchecked under EPIC-025 Phase 4 |

### Files NOT changed

- [`src/renderer/components/form/List.tsx`](../../../src/renderer/components/form/List.tsx) —
  legacy stays. Removed at the end of EPIC-025 once all consumers migrate (tracked by
  [US-492](../US-492-sidebar-integration-testing/README.md)).
- [`src/renderer/components/basic/OverflowTooltipText.tsx`](../../../src/renderer/components/basic/OverflowTooltipText.tsx) /
  [`Tooltip.tsx`](../../../src/renderer/components/basic/Tooltip.tsx) — still used by other
  components. Only FolderItem stops importing them.
- [`src/renderer/api/menu-folders.ts`](../../../src/renderer/api/menu-folders.ts) and
  [`MenuFolder`](../../../src/renderer/api/menu-folders.ts) — no shape changes. Still
  `{id?, name, path?, files?}`. Drag payload still serializes `{id}`.
- [`src/renderer/core/traits/dnd.ts`](../../../src/renderer/core/traits/dnd.ts),
  [`TraitRegistry.ts`](../../../src/renderer/core/traits/TraitRegistry.ts) — `TraitTypeId.MenuFolder`
  unchanged.
- [`src/renderer/uikit/ListBox/*`](../../../src/renderer/uikit/ListBox) — every needed feature is
  already in place from US-468 + US-484.
- [`src/renderer/components/layout/Splitter`](../../../src/renderer/components/layout/Splitter.tsx),
  the MenuBar toolbar buttons, the slide-in animation, the `.menu-bar-content` /
  `.menu-bar-header` / `.menu-bar-panel` CSS — out of scope (covered by US-451 / a later
  MenuBar polish task).
- The right-panel content (`OpenTabsList`, `RecentFileList`, `ToolsEditorsPanel`,
  `ScriptLibraryPanel`, `TreeProviderView`) — already migrated or out of scope.

## Implementation plan

### Step 1 — Add `MenuFolder` trait set in `MenuBar.tsx` (module-level)

Above the `MenuBarRoot` styled block, add a module-level `LIST_ITEM_KEY` trait set:

```ts
import { TraitSet, traited } from "../../core/traits/traits";
import { ListBox, LIST_ITEM_KEY } from "../../uikit";

const folderItemTraits = new TraitSet().add(LIST_ITEM_KEY, {
    value: (item: unknown) => (item as MenuFolder).id ?? "",
    label: (item: unknown) => (item as MenuFolder).name,
});
```

Notes:
- `value` falls back to `""` for the rare case `id` is undefined (it's always set after
  `menuFolders.add`, but `MenuFolder.id` is optional in the type signature). String values are
  fine — `IListBoxItem.value` accepts `string | number`.
- `label` returns the folder's `name`. The default `<ListItem>` consumes this for accessibility,
  but we bypass it via `renderItem`. Trait stays for the model's internal accessibility id
  derivation (`itemId(idx)` reads `resolved[idx]?.value` only — `label` is consumed only when
  the default `<ListItem>` is used). We still register `label` so future maintainers don't need
  to add it back if they drop `renderItem`.
- `icon` is **omitted** from the trait. Icons are folder-id-dependent (`getFolderIcon` switches on
  `folder.id`); keeping it inside MenuBar's model avoids duplicating that logic into the trait
  closure.

### Step 2 — Replace `<List>` with `<ListBox>` in `MenuBar.tsx`

Replace the `<List ...>` block at [`MenuBar.tsx:573-587`](../../../src/renderer/ui/sidebar/MenuBar.tsx)
with a `<ListBox<MenuFolder> ...>` that uses a `renderItem` returning `<FolderItem>`. Wrap the
items array with `traited(...)`.

```tsx
// before allFolders memo:
const tFolders = useMemo(
    () => traited(allFolders, folderItemTraits),
    [allFolders],
);

// inline (or above) the renderItem:
const folderRenderItem = useCallback(
    (ctx: ListItemRenderContext<MenuFolder>) => (
        <FolderItem
            folder={ctx.source}
            selected={ctx.selected}
            icon={model.getFolderIcon(ctx.source)}
            label={model.getFolderLabel(ctx.source)}
            tooltip={model.getFolderTooltip(ctx.source)}
            onDoubleClick={canOpenInTab(ctx.source) ? model.openFolderInTab : undefined}
            onSelectedIconClick={canOpenInTab(ctx.source) ? model.openFolderInTab : undefined}
            canDrag={!isStaticFolder(ctx.source)}
            canDrop={!isStaticFolder(ctx.source)}
        />
    ),
    [model],
);

// in JSX, replace the <List ...> block with:
<ListBox<MenuFolder>
    items={tFolders}
    rowHeight={22}
    isSelected={(folder) => folder.id === state.leftItemId}
    onChange={model.setLeftItem}
    getContextMenu={(folder) => {
        // Right-click activates the folder, matching legacy FolderItem.handleContextMenu
        // which called onClick(folder) before populating the menu.
        model.setLeftItem(folder);
        return model.getMenuFolderContextMenu(folder);
    }}
    onContextMenu={model.onLeftPanelContextMenu}
/>
```

Notes:
- `isSelected` is inline because `state.leftItemId` is read from `state` (the
  `model.state.use()` snapshot), so a `useCallback` would need `[state.leftItemId]` and gain
  nothing over an inline arrow. ListBox's force-rerender effect already lists `isSelected` in
  its deps ([`ListBoxModel.ts:233`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts)) — it
  will fire each render either way, but `RenderGrid.update({ all: true })` is cheap when the
  resolved array hasn't changed (cell render bypasses the cache).
- `onChange` is `model.setLeftItem` (a method on the class instance — stable identity across
  renders).
- `getContextMenu` activates the folder before returning items. This preserves the legacy
  behavior where right-click on a folder also selects it (the user expects to see the right
  panel switch to that folder when the context menu opens). The activation is a state mutation
  on the model — synchronous; the menu items are emitted on the same event tick.
- `onContextMenu={model.onLeftPanelContextMenu}` adds the "Add Folder" item when the user
  right-clicks the empty area of the list. ListBox's `onRootContextMenu` skips this when a row
  already populated the event ([`ListBoxModel.ts:152-155`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts)),
  so right-clicking a row never adds "Add Folder" to that row's menu.

Drop these imports from `MenuBar.tsx`:
```ts
import { List, ListOptionRenderer } from "../../components/form/List";
```

Add (already present? — check; if not, add):
```ts
import { ListBox, LIST_ITEM_KEY } from "../../uikit";
import { TraitSet, traited } from "../../core/traits/traits";
import type { ListItemRenderContext } from "../../uikit/ListBox";
```

`useCallback` is already imported. `MenuFolder` import already present.

### Step 3 — Remove the now-obsolete `.list-item` CSS block from `MenuBar.tsx`

The `.menu-bar-left .list-item { … }` block at
[`MenuBar.tsx:88-118`](../../../src/renderer/ui/sidebar/MenuBar.tsx) styles hover/selected
backgrounds via the `list-item` and `selected` class names that legacy FolderItem set. After the
migration FolderItem owns its own styling via `data-*` attributes (Step 4), so these rules
become dead.

Remove the entire `& .list-item: { … }` and `& .list-item.selected: { … }` blocks. Keep:
- The `.menu-bar-left` width/border/flex rules.
- The `.add-folder-button` rule (currently unused — there's no JSX with that class — but leave
  it; removing dead CSS is a separate cleanup).

After this step, the `.menu-bar-left` block looks like:

```ts
"& .menu-bar-left": {
    borderRight: `1px solid ${color.border.light}`,
    width: 40,
    flex: "1 1 40%",
    "& .add-folder-button": {
        fontSize: 13,
        color: color.text.light,
        "&:hover": {
            color: color.text.default,
        },
    },
},
```

### Step 4 — Rewrite `FolderItem.tsx`

Replace the entire file. The new shape:

- Drop `style`, `index`, `itemMarginY`, `getTooltip`, `getContextMenu` from `FolderItemProps`.
  Replaced by ListBox wrapper (`style`) and the parent's renderItem closure (`tooltip`,
  `getContextMenu`).
- Drop `onClick` from `FolderItemProps`. The wrapper `<div>` ListBox creates already routes
  click → `onChange` ([`ListBox.tsx:140`](../../../src/renderer/uikit/ListBox/ListBox.tsx)).
- Keep `onDoubleClick` — there's no equivalent on the wrapper `<div>`, and double-click is the
  "open folder in new tab" gesture for custom folders + Script Library.
- Drop `selectedIcon` from props. The arrow icon is rendered conditionally inside FolderItem
  when `selected` is true (avoids the prop indirection that legacy needed for List's generic
  cell renderer).
- Add `tooltip: React.ReactNode` prop. Wraps the row in UIKit `<Tooltip content={tooltip}>`.

Final props shape:

```ts
export interface FolderItemProps {
    folder: MenuFolder;
    selected: boolean;
    icon: React.ReactNode;
    label: React.ReactNode;
    tooltip?: React.ReactNode;
    onDoubleClick?: (folder: MenuFolder) => void;
    onSelectedIconClick?: (folder: MenuFolder, e: React.MouseEvent) => void;
    canDrag?: boolean;
    canDrop?: boolean;
}
```

DnD logic stays verbatim:
- `setTraitDragData(e.dataTransfer, TraitTypeId.MenuFolder, { id: folder.id })` on drag start
- `getTraitDragData(e.dataTransfer)` + `payload.typeId === TraitTypeId.MenuFolder` check on drop
- `dragEnterCount` ref + `setIsOver(true/false)` for the `drag-over` visual state
- `menuFolders.move(srcId, folder.id)` when target.id !== source.id

Visual state via `data-*` (Rule 1):

```tsx
const Root = styled.div(
    {
        display: "inline-flex",
        alignItems: "center",
        columnGap: 6,
        paddingLeft: 4,
        cursor: "pointer",
        color: color.text.default,
        overflow: "hidden",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",

        "&:hover": {
            backgroundColor: color.background.default,
        },
        "&[data-selected]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        "&[data-dragging]": {
            opacity: 0.5,
        },
        "&[data-drag-over]": {
            borderTop: `2px solid ${color.border.active}`,
        },

        "& > svg": {
            width: 16,
            height: 16,
            flexShrink: 0,
        },

        "& .item-text": {
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },

        "& .selected-icon": {
            color: color.text.light,
            width: 16,
            height: 16,
            marginRight: 6,
            flexShrink: 0,
        },
        "&[data-selected] .selected-icon": {
            color: color.icon.selection,
        },

        "& .selected-icon-button": {
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 3,
            cursor: "pointer",
            "&:hover": {
                backgroundColor: color.background.light,
            },
        },
    },
    { label: "FolderItem" },
);
```

Body (skeleton):

```tsx
export function FolderItem({
    folder, selected, icon, label, tooltip,
    onDoubleClick, onSelectedIconClick,
    canDrag = true, canDrop = true,
}: FolderItemProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);
    const dragEnterCount = useRef(0);

    // ... DnD handlers (verbatim from current implementation) ...

    const handleDoubleClick = useCallback(
        () => onDoubleClick?.(folder),
        [onDoubleClick, folder],
    );
    const handleSelectedIconClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onSelectedIconClick?.(folder, e);
        },
        [onSelectedIconClick, folder],
    );

    const row = (
        <Root
            data-type="folder-item"
            data-selected={selected || undefined}
            data-dragging={isDragging || undefined}
            data-drag-over={isOver || undefined}
            draggable={canDrag}
            onDragStart={handleFolderDragStart}
            onDragEnd={handleFolderDragEnd}
            onDragEnter={handleFolderDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleFolderDrop}
            onDoubleClick={handleDoubleClick}
        >
            {icon}
            <span className="item-text">{label}</span>
            {selected && (
                onSelectedIconClick ? (
                    <span
                        className="selected-icon-button"
                        onClick={handleSelectedIconClick}
                    >
                        <ArrowRightIcon className="selected-icon" />
                    </span>
                ) : (
                    <ArrowRightIcon className="selected-icon" />
                )
            )}
        </Root>
    );

    return tooltip ? <Tooltip content={tooltip}>{row}</Tooltip> : row;
}
```

Imports change to:

```ts
import styled from "@emotion/styled";
import { useCallback, useRef, useState } from "react";
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
import color from "../../theme/color";
import { Tooltip } from "../../uikit";
import { ArrowRightIcon } from "../../theme/icons";
import { menuFolders } from "../../api/menu-folders";
import type { MenuFolder } from "../../api/menu-folders";
```

Drop:
- `import clsx from "clsx";` — class-name composition no longer needed
- `import { useMemo } from "react";` — `id` (the `data-tooltip-id`) is gone
- `import { OverflowTooltipText } from "../../components/basic/OverflowTooltipText";`
- `import { Tooltip } from "../../components/basic/Tooltip";` — replaced by UIKit Tooltip
- `import type { MenuItem } from "../../components/overlay/PopupMenu";` — `getContextMenu` prop is gone
- `import { ContextMenuEvent } from "../../api/events/events";` — context menu now plumbed through
  ListBox's `getContextMenu` (handled in MenuBar)

The internal `id = useMemo(() => crypto.randomUUID(), [])` and the `data-tooltip-id` wiring are
gone — UIKit `<Tooltip>` uses floating-ui internally; no DOM-id linkage required.

### Step 5 — Wire the `.selected-icon-button` title attribute

Legacy: `title="Open folder in new tab"` on the wrapping span (native browser tooltip).
The new pattern wraps the entire row in UIKit Tooltip showing `model.getFolderTooltip(folder)`
(folder path / "Currently opened tabs" / etc.). The button's "Open folder in new tab" hint is
distinct content.

Decision: keep the native `title="Open folder in new tab"` on the `.selected-icon-button` span.
It coexists with the row-level UIKit Tooltip cleanly because:
- UIKit Tooltip is anchored to the row (the styled `Root`).
- The native `title` is anchored to the inner span and only appears after the OS-default delay
  (~700ms) on hover.
- They never conflict — the native tip explains the click action; the UIKit tip explains the
  folder identity.

This is two tooltips, but it matches the legacy UX exactly (legacy also showed the native
title on the button + the components/basic/Tooltip on the row).

### Step 6 — Delete `getMenuFolderContextMenu` activation behavior duplication

Currently `getMenuFolderContextMenu(folder)` returns items only — the activation
(`onClick(folder)`) lives inside FolderItem.handleContextMenu. After Step 2, activation moves
into MenuBar's `getContextMenu` closure. FolderItem no longer has `handleContextMenu`. The
ListBox wrapper's `onContextMenu` calls `model.onItemContextMenu` which calls our supplied
`getContextMenu(folder)` ([`ListBoxModel.ts:138-146`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts)) —
that's where the activation now happens.

No changes needed to `model.getMenuFolderContextMenu` itself.

### Step 7 — Dashboard update

In [`doc/active-work.md`](../../active-work.md), the entry already links to this README:

```
- [ ] [US-491: FolderItem + MenuBar left list — UIKit migration](tasks/US-491-folderitem-migration/README.md) *(Phase 4 — per-screen migration; blocked on US-484)*
```

Drop the stale `; blocked on US-484` annotation (US-484 is implemented). Keep the link and
phase annotation:

```
- [ ] [US-491: FolderItem + MenuBar left list — UIKit migration](tasks/US-491-folderitem-migration/README.md) *(Phase 4 — per-screen migration)*
```

### Step 8 — TypeScript + lint check

- `npx tsc --noEmit` — no new errors. Note: pre-existing project errors (unrelated to sidebar)
  may remain — filter by `FolderItem` / `MenuBar` / `OpenTabsList` to confirm we added zero.
- `npm run lint` — no new errors.

### Step 9 — Manual smoke test

Run `npm start`, open the menu bar (Ctrl+M / hamburger), exercise:

- **Initial render** — left rail shows: 🗔 Open Tabs · 🕘 Recent Files · ⊞ Tools & Editors ·
  Script Library + any user-added custom folders. The first item is selected by default
  (`leftItemId: openTabsId`).
- **Hover** — moving the pointer over a row darkens its background to `color.background.default`.
- **Click — static folder** — selects the folder; the right panel switches; the right-arrow
  appears on the selected row. For "Open Tabs" / "Recent Files" / "Tools & Editors" the arrow
  is a passive indicator. For "Script Library" the arrow is clickable (`title="Open folder in
  new tab"`).
- **Click — custom folder** — selects the folder; the right panel renders its file tree; the
  arrow is clickable.
- **Double-click — Script Library or custom folder** — calls `model.openFolderInTab`, which
  opens the folder as a new tab in the page area + closes the menu bar.
- **Double-click — Open Tabs / Recent Files / Tools & Editors** — does nothing (canOpenInTab
  is false; onDoubleClick is undefined).
- **Selected-icon click — Script Library or custom folder** — same as double-click. `e.stopPropagation()`
  prevents the parent row's onChange from firing twice (it'd be a no-op anyway since the row
  is already selected).
- **Right-click on a row** — selects the row (right-panel updates) and opens its context menu
  (Open Tabs: nothing — the array is empty; Recent Files: "Clear Recent Files"; Script Library:
  "Change Library Folder" + "Open in Explorer" + "Unlink Library"; custom folder: "Remove
  Folder" + "Show in File Explorer").
- **Right-click on empty area** — opens the background menu with "Add Folder" only.
- **Add a custom folder** — pick a folder via the dialog → it appears at the end of the list
  → it's selected automatically (no, actually: legacy doesn't auto-select; only the right
  panel switches when you click it).
- **DnD between custom folders** — drag custom folder A onto custom folder B → A moves to B's
  position; the JSON file persists.
- **DnD onto a static folder** — should silently fail (canDrop=false on static folders —
  `onDragEnter` early-returns; no `drag-over` border).
- **DnD across windows** — open a second window, drag a custom folder from window A onto
  window B's matching custom folder → moves on the receiving side (legacy behavior; since the
  payload carries only `{id}` and `menuFolders` is global state with file-watcher sync, this
  works without extra plumbing).
- **Theme cycling** — switch dark / light-modern / monokai. Hover background, selected
  background + foreground, arrow color, drag-over border all follow the theme.
- **DevTools** — row has `data-type="folder-item"`, `data-selected` (when selected),
  `data-dragging` / `data-drag-over` (during DnD). Wrapper from ListBox has the cell positioning
  `style={top, left, width, height}`. Container is `data-type="list-box"`.

## Concerns / open questions

All resolved before implementation.

### 1. RESOLVED — `getTooltip` not invoked when `renderItem` is set

UIKit ListBox skips its own tooltip wiring when `renderItem` is supplied
([`types.ts:91-93`](../../../src/renderer/uikit/ListBox/types.ts)). FolderItem must wire
the tooltip itself.

**Resolution:** add `tooltip?: React.ReactNode` to `FolderItemProps`; render UIKit `<Tooltip
content={tooltip}>{row}</Tooltip>` only when tooltip is truthy. MenuBar passes
`tooltip={model.getFolderTooltip(folder)}` from inside the renderItem closure. No `getTooltip`
prop on `<ListBox>`.

### 2. RESOLVED — Right-click activation behavior

Legacy `FolderItem.handleContextMenu` calls `onClick?.(folder, index, e)` BEFORE pushing menu
items, so right-click selects the row.

UIKit ListBox's `onItemContextMenu` calls `props.getContextMenu(source, idx)` only — does NOT
call `onChange` ([`ListBoxModel.ts:138-146`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts)).

**Resolution:** activate the folder inside MenuBar's `getContextMenu` closure (Step 2 above).
The activation is a state mutation on the model class; the menu items are returned from the
same call. Both happen in the same event tick, matching legacy UX.

```tsx
getContextMenu={(folder) => {
    model.setLeftItem(folder);
    return model.getMenuFolderContextMenu(folder);
}}
```

This is idiomatic enough that it's documented as the canonical pattern for "context-menu
activates the row" in any future migration.

### 3. RESOLVED — Background context menu still works

`onContextMenu` on `<ListBox>` is invoked when no row populated the event. The legacy
`onLeftPanelContextMenu` adds "Add Folder" only when `e.nativeEvent.contextMenuEvent` was not
already populated. ListBox enforces the same precedence at the model level
([`ListBoxModel.ts:152-155`](../../../src/renderer/uikit/ListBox/ListBoxModel.ts)) — if a row
fired `onItemContextMenu` first and pushed items, `onContextMenu` (the prop) is not invoked.

This means the `onLeftPanelContextMenu` body's own `if (!e.nativeEvent.contextMenuEvent)` guard
is now redundant. Keep the guard anyway — it's defensive and the cost is one branch per
right-click event.

### 4. RESOLVED — Removing the `.list-item` CSS in MenuBar

The `.menu-bar-left .list-item` and `.list-item.selected` rules become dead after the migration
(FolderItem no longer sets `class="list-item"`). Removing them is mandatory — leaving them
in place would cause a future maintainer to wonder why they don't match anything.

The `.add-folder-button` rule is currently unused but stays — removing dead rules unrelated to
this migration is out of scope. Track in a separate tidy task if it persists.

### 5. RESOLVED — `canDrag={false}` and `draggable` attribute

When `canDrag` is false (static folders), the legacy code sets `draggable={canDrag}` (so
`draggable={false}`) on the row, which is the correct HTML5 way to suppress dragging.

The new code keeps the same: `<Root draggable={canDrag} ...>`. No further guard needed in
`handleFolderDragStart` (legacy has one — `if (!canDrag) { e.preventDefault(); return; }`).
Keep that guard for symmetry — it's cheap, and `e.preventDefault` is a safety net if a future
caller ignores the `draggable` attribute.

### 6. RESOLVED — `dragEnterCount` ref pattern

The `dragEnterCount` ref disambiguates nested `dragenter`/`dragleave` events fired by descendant
elements (icon SVG, label span). Without it, hovering the cursor over the icon while dragging
would fire `dragleave` on the row and erase `isOver` even though the cursor never left the row.

This is canonical HTML5 DnD plumbing and has nothing to do with ListBox. Keep the ref + the
`onDragEnter` increment + `onDragLeave` decrement verbatim.

### 7. RESOLVED — `onClick` prop drop on FolderItem

The ListBox wrapper `<div>` already wires `onClick` → `model.onItemClick(idx)` → `props.onChange(folder)`
([`ListBox.tsx:140`](../../../src/renderer/uikit/ListBox/ListBox.tsx)). FolderItem doesn't need
to receive an `onClick` prop. Single click on the row routes to MenuBar's
`onChange={model.setLeftItem}`.

The selected-icon button still needs `e.stopPropagation()` so its click doesn't bubble up and
re-trigger `onChange` (which would be a no-op, but stopping the bubble is cleaner).

### 8. RESOLVED — UIKit Tooltip with double-click + drag

UIKit Tooltip wraps its child via `React.cloneElement` and overrides `onMouseEnter`,
`onMouseLeave`, `onFocus`, `onBlur`, `onKeyDown` ([`Tooltip.tsx:135-161`](../../../src/renderer/uikit/Tooltip/Tooltip.tsx)).
It does NOT override `onClick`, `onDoubleClick`, `onDrag*`, `onContextMenu`. Those still fire
from the wrapped child.

Confirmed safe. The wrapped element is FolderItem's `Root` which holds all the drag/double-click
handlers; Tooltip injects mouse-enter/leave on top to drive its own open state.

### 9. RESOLVED — `<Tooltip content={undefined}>` short-circuits

When `tooltip` is undefined / null / "" / false, UIKit Tooltip suppresses itself and renders the
trigger unwrapped ([`Tooltip.tsx:122-163`](../../../src/renderer/uikit/Tooltip/Tooltip.tsx)).
We can pass `model.getFolderTooltip(folder)` unconditionally — for static folders without a
defined tooltip (none today: every static folder returns a string from `getFolderTooltip`) the
tooltip simply suppresses itself.

The conditional `tooltip ? <Tooltip>{row}</Tooltip> : row` in the FolderItem skeleton (Step 4)
is still slightly cheaper because it avoids cloneElement when there's no tooltip. Keep the
conditional.

### 10. RESOLVED — `state.leftItemId` reactivity

`state` comes from `model.state.use()` at the top of MenuBar's render
([`MenuBar.tsx:436`](../../../src/renderer/ui/sidebar/MenuBar.tsx)) — any change to
`leftItemId` triggers a render. The new `isSelected={(folder) => folder.id === state.leftItemId}`
closure reads `state.leftItemId` directly; it's evaluated by ListBox's force-rerender effect
when the prop identity changes (every render — but RenderGrid's cell render is cheap enough
that this is fine).

### 11. RESOLVED — `tFolders` identity stability

`tFolders = useMemo(() => traited(allFolders, folderItemTraits), [allFolders])`. `allFolders`
itself is `useMemo([...staticFolders, ...folders], [folders])`, so its identity changes only
when `folders` changes. `tFolders` then changes only when allFolders does. ListBox's resolved
memo recomputes only when items changes — matches FileList / OpenTabsList patterns.

### 12. RESOLVED — UIKit Rule 7 chrome exception

`MenuBar.tsx` and `FolderItem.tsx` both sit under `src/renderer/ui/sidebar/` (chrome exception).
Local Emotion is permitted for chrome layout. We're not passing `style=` or `className=` to
UIKit components (would be a TS error). The `Root` styled `<div>` inside FolderItem is
chrome-local — fine.

### 13. RESOLVED — Selected-icon-button accessibility

Legacy: a `<span>` with `onClick` and `title=`. Not a real button — keyboard navigation can't
focus it; screen readers announce it as a label.

This is pre-existing and out of scope. Migrating to UIKit `IconButton` would change the visual
size (its built-in padding + size variants don't match the legacy bare 16x16 arrow exactly) and
alter the chrome footprint — which the user has explicitly scoped out of this task.

Keep the `<span>` exactly as legacy had it. Track an a11y improvement (real `<button>` with
proper focus styling) in a follow-up if needed.

### 14. RESOLVED — `OverflowTooltipText` drop is safe

Legacy showed two tooltips:
- the OS-default `title=` from `<OverflowTooltipText>` after ~600ms when the folder name
  overflowed (custom folders with long names);
- the components/basic `<Tooltip>` after 1500ms with the path / static-folder description.

After migration:
- CSS truncation (`text-overflow: ellipsis`) still applies — same visual shape on overflow.
- UIKit Tooltip shows the same path / description after 600ms (its default `delayShow`).
- The "name on overflow" native tip is gone.

Net: one tooltip instead of two. The remaining tooltip is the more informative one (path).
Acceptable — the user already accepted equivalent simplifications in the OpenTabsList (US-490)
and FileList (US-479) migrations.

### 15. RESOLVED — UIKit Tooltip `delayShow` default of 600ms vs legacy 1500ms

Legacy `<Tooltip id delayShow={1500}>` had a 1.5-second hover delay. UIKit Tooltip defaults to
600ms.

Fast tooltip = better UX in a sidebar that the user is browsing. Per US-490 / US-479 we
already standardized on 600ms. Keep the default.

### 16. RESOLVED — Drop-target placement (top vs middle vs bottom)

Legacy `drag-over` shows a `borderTop: 2px solid color.border.active`. Visually this signals
"I will be dropped ABOVE this row". `menuFolders.move(srcId, targetId)` uses
`splice(targetIndex, 0, ...)` — insert at target index, shifting target downward. Matches the
top-border indicator.

Keep this verbatim — it's existing UX, not part of the migration.

### 17. RESOLVED — `keyboardNav` default

Legacy List has no keyboard nav (no Tab / Arrow handling on the rail). UIKit ListBox defaults
to `keyboardNav={false}` — match. The folder list is a mouse-driven sidebar; arrow-key
navigation between folders is not part of any flow.

### 18. RESOLVED — `activeIndex` not used

Without keyboard nav and with hover styling driven by CSS `:hover`, there's no need to maintain
`activeIndex`. Skip it.

If a later task (US-451 polish?) adds keyboard nav, that'd be the right time to introduce
`activeIndex` + `[data-active]` styling alongside `:hover`.

### 19. RESOLVED — `useEffect` fallback when selected folder is removed

[`MenuBar.tsx:441-445`](../../../src/renderer/ui/sidebar/MenuBar.tsx) has a fallback effect
that selects the first static folder if the currently selected folder is gone. This is
unchanged — depends on `folders` only, doesn't touch the list rendering.

### 20. RESOLVED — Custom folders without `id`

`MenuFolder.id` is optional in the type, but `menuFolders.add()` always assigns
`crypto.randomUUID()` ([`menu-folders.ts:82-89`](../../../src/renderer/api/menu-folders.ts)).
Static folders ([`MenuBar.tsx:161-166`](../../../src/renderer/ui/sidebar/MenuBar.tsx)) all have
hardcoded ids. So `folder.id` is effectively always defined.

The trait's `value: (item: unknown) => (item as MenuFolder).id ?? ""` defends against the type
signature; the `?? ""` will never be hit in practice. Unique enough — even the empty fallback
would only collide with another empty-id folder, which the data layer never creates.

## Acceptance criteria

1. `src/renderer/ui/sidebar/MenuBar.tsx` contains zero imports from `components/form/`. The
   legacy `List` and `ListOptionRenderer` are no longer referenced.
2. `src/renderer/ui/sidebar/FolderItem.tsx` contains zero imports from
   `components/basic/Tooltip`, `components/basic/OverflowTooltipText`, `components/overlay/PopupMenu`,
   `api/events/events`, `clsx`, and `useMemo`.
3. `MenuBar.tsx` imports `ListBox`, `LIST_ITEM_KEY` from `../../uikit` and `TraitSet`, `traited`
   from `../../core/traits/traits`. A module-level `folderItemTraits` trait set is declared
   with `value` and `label` accessors.
4. The `<List>` block at the legacy `MenuBar.tsx:573-587` is replaced by a `<ListBox<MenuFolder>>`
   with `items={tFolders}`, `rowHeight={22}`, `isSelected`, `onChange`, `getContextMenu`,
   `onContextMenu`, `renderItem`. No `style=` or `className=` on `<ListBox>`.
5. The `.menu-bar-left .list-item { ... }` and `.list-item.selected { ... }` CSS blocks are
   removed from `MenuBar.tsx`.
6. `FolderItem.tsx` no longer accepts `index`, `style`, `onClick`, `selectedIcon`,
   `itemMarginY`, `getTooltip`, `getContextMenu` props. It accepts `tooltip` instead.
7. `FolderItem.tsx`'s root element is a styled `<div>` with `data-type="folder-item"`,
   `data-selected={selected || undefined}`, `data-dragging={isDragging || undefined}`,
   `data-drag-over={isOver || undefined}`. No `class=` for state — `clsx` is removed.
8. Hover background, selected background, dragging opacity, and drag-over top-border are
   defined inside `FolderItem.tsx`'s `Root` styled block (chrome-local Emotion per Rule 7
   exception).
9. The folder name uses CSS truncation (`flex: 1 1 auto; min-width: 0; white-space: nowrap;
   overflow: hidden; text-overflow: ellipsis`) instead of `<OverflowTooltipText>`.
10. The row is wrapped in `<Tooltip content={tooltip}>` from UIKit when `tooltip` is truthy.
11. DnD logic — `onDragStart` setting `setTraitDragData(TraitTypeId.MenuFolder, {id})`,
    `onDrop` reading the payload and calling `menuFolders.move(srcId, folder.id)`, the
    `dragEnterCount` ref pattern — is preserved verbatim.
12. The selected arrow icon (`<ArrowRightIcon className="selected-icon">`) appears on the
    selected row. When `onSelectedIconClick` is provided, the icon is wrapped in
    `<span className="selected-icon-button" onClick title="Open folder in new tab">` — clicking
    it stops propagation and invokes the callback.
13. Right-clicking a row activates that folder (right panel switches) AND opens the row's
    context menu — both occur on the same event.
14. Right-clicking the empty area below the rows opens the background menu with "Add Folder"
    only.
15. `npx tsc --noEmit` — no new errors.
16. `npm run lint` — no new errors.
17. Manual smoke test (Step 9 above) passes.
18. The dashboard entry in [`doc/active-work.md`](../../active-work.md) drops the stale
    `; blocked on US-484` annotation; the link to this README is preserved.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [`src/renderer/ui/sidebar/FolderItem.tsx`](../../../src/renderer/ui/sidebar/FolderItem.tsx) | Rewrite | Drop absolute-positioning logic; move hover/selected styling here via `data-*`; replace `OverflowTooltipText` + legacy `Tooltip` with CSS truncation + UIKit `Tooltip`; preserve DnD logic verbatim |
| [`src/renderer/ui/sidebar/MenuBar.tsx`](../../../src/renderer/ui/sidebar/MenuBar.tsx) | Modify | Replace `<List rowRenderer=…>` with `<ListBox renderItem=…>`; add module-level `LIST_ITEM_KEY` traits; remove the now-redundant `.menu-bar-left .list-item` CSS block; remove imports of `List` / `ListOptionRenderer` |
| [`doc/active-work.md`](../../active-work.md) | Modify | Drop stale "blocked on US-484" annotation on the US-491 line |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md) — Phase 4 per-screen migration
- Built on: [US-468](../US-468-uikit-listbox/README.md) (UIKit ListBox V1) +
  [US-484](../US-484-uikit-listbox-extensions/README.md) (sections, predicate selection,
  tooltip, variant, custom `renderItem` integration) — both implemented
- Reference migrations:
  - [US-479](../US-479-filelist-migration/README.md) — FileList (uses default `<ListItem>`)
  - [US-490](../US-490-opentabslist-migration/README.md) — OpenTabsList (uses default `<ListItem>`)
- This task: first sidebar migration to use a custom `renderItem` + DnD on the row.
- Sibling tasks (US-479 split):
  - [US-490](../US-490-opentabslist-migration/README.md) — OpenTabsList (done)
  - [US-492](../US-492-sidebar-integration-testing/README.md) — Final sidebar integration testing
