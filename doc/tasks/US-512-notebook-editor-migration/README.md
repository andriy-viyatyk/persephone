# US-512: Notebook editor — UIKit migration

## Status

**Ready for implementation — prerequisites delivered.** Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

Both prerequisite UIKit primitives have shipped:

- **[US-516](../US-516-uikit-breadcrumb/README.md)** — UIKit Breadcrumb
  primitive (used by the toolbar Categories / Tags trail). Exported from
  `src/renderer/uikit/Breadcrumb/`.
- **[US-517](../US-517-uikit-collapsible-panel-stack/README.md)** — UIKit
  CollapsiblePanelStack primitive (used by the sidebar Tags / Categories
  switcher). Exported from `src/renderer/uikit/CollapsiblePanelStack/`.

In addition, **[US-518](../../active-work.md)** added a new
`selectionStyle="accent"` to UIKit `ListBox` (filled selection background +
trailing chevron-right icon) — see C4, which now mirrors that visual style
in the `TagsListView` custom row renderer for sidebar consistency with the
Storybook left rail and MCP Inspector tool list.

This is the largest single per-screen migration in Phase 4 — about 800 lines
of `styled.*` chrome to remove across 5 files. One legacy component
(`TagsList`) has no UIKit equivalent and is inline-rewritten as
`notebook/TagsListView.tsx` per C4.

## Goal

Migrate the Notebook editor surface to UIKit primitives. After this task:

- No `import styled from "@emotion/styled"` in any file under
  `src/renderer/editors/notebook/`.
- No imports from `components/basic|form|layout|overlay/` in any file under
  `src/renderer/editors/notebook/`. Both `Breadcrumb` and
  `CollapsiblePanelStack` are migrated to their UIKit equivalents (delivered
  by **US-516** and **US-517**, this task's prerequisites).
- All chrome layout uses UIKit `Panel`; all primitives use UIKit components
  (`Button`/`IconButton`/`Input`/`Textarea`/`PathInput`/`Splitter`/`Tree`/
  `WithMenu`/`SegmentedControl`).

## Background

### Files in scope

```
src/renderer/editors/notebook/
  NotebookEditor.tsx                         ← root view, splitter, sidebar host, portals
  NoteItemView.tsx                           ← list-row note item (largest — ~520 lines)
  ExpandedNoteView.tsx                       ← full-detail expanded note view
  note-editor/NoteItemToolbar.tsx            ← per-note toolbar (lang menu, run buttons, segmented)
  note-editor/MiniTextEditor.tsx             ← thin styled wrapper around Monaco editor
  notebook/TagsListView.tsx (NEW)            ← inline-rewrite of components/basic/TagsList (see C4)
```

### UIKit primitives used (verified in `src/renderer/uikit/`)

| Primitive | File | Notes |
|---|---|---|
| `Panel` | `Panel/Panel.tsx` | direction/gap/padding/border/flex/min/max + `revealChildrenOnHover` (US-504) |
| `Button` | `Button/Button.tsx` | variants default / primary / ghost / link / danger; `icon` + label |
| `IconButton` | `IconButton/IconButton.tsx` | size sm/md, supports `title` (Tooltip) |
| `Input` | `Input/Input.tsx` | size sm/md, `endSlot` (single ReactNode), `variant: ghost` |
| `Textarea` | `Textarea/Textarea.tsx` | `value`/`onChange(string)`, `singleLine`, `variant: ghost` |
| `PathInput` | `PathInput/PathInput.tsx` | hierarchical-path autocomplete, size sm/md |
| `Splitter` | `Splitter/Splitter.tsx` | controlled `value`/`onChange`; orientation/side/border/min/max |
| `WithMenu` / `Menu` | `Menu/WithMenu.tsx` + `Menu.tsx` | render-prop signature matches `WithPopupMenu` |
| `MenuItem` (type) | `Menu/types.ts` | re-exports `api/types/events.MenuItem` (same canonical type) |
| `SegmentedControl` | `SegmentedControl/SegmentedControl.tsx` | replaces `SwitchButtons` — accepts `ISegment[]` |
| `Tree` | `Tree/Tree.tsx` | virtualized; `traitTypeId`/`getDragData`/`acceptsDrop`/`canTraitDrop`/`onTraitDrop` (US-488) |
| `highlight()` | `shared/highlight.ts` | pure function; replaces `highlightText()` from `components/basic/useHighlightedText` |

### Coverage check — components that need UIKit primitives

| Legacy primitive | Used in | Strategy |
|---|---|---|
| `components/basic/Breadcrumb` | `NotebookEditor.tsx` (toolbar portal — Categories / Tags trail) | **Migrate to UIKit `Breadcrumb`** (shipped via **[US-516](../US-516-uikit-breadcrumb/README.md)**). C2. |
| `components/layout/CollapsiblePanelStack` | `NotebookEditor.tsx` (sidebar — switches between Tags and Categories) | **Migrate to UIKit `CollapsiblePanelStack`** (shipped via **[US-517](../US-517-uikit-collapsible-panel-stack/README.md)**). C3. |
| `components/basic/TagsList` | `NotebookEditor.tsx` (sidebar Tags panel) | **Inline-rewrite** as `notebook/TagsListView.tsx`, built on UIKit `Panel` + plain HTML rows. This is one-of-a-kind drill-down nav (NOT the `TagsInput` pattern), so it stays notebook-internal. C4. |

### Confirmed import inventory (current)

- `NotebookEditor.tsx`: `@emotion/styled`, `components/basic/{Breadcrumb,Button,TagsList,TextField,useHighlightedText}`, `components/layout/{CollapsiblePanelStack,Splitter}`, `components/TreeView` (CategoryTree), `components/virtualization/RenderGrid` (kept), `theme/color`.
- `NoteItemView.tsx`: `@emotion/styled`, `components/basic/{Button,PathInput,TextAreaField,useHighlightedText}`, `theme/color`.
- `ExpandedNoteView.tsx`: `@emotion/styled`, `components/basic/{Button,PathInput,TextAreaField}`, `theme/color`.
- `note-editor/NoteItemToolbar.tsx`: `@emotion/styled`, `components/basic/Button`, `components/form/SwitchButtons`, `components/overlay/{WithPopupMenu,PopupMenu}`.
- `note-editor/MiniTextEditor.tsx`: `@emotion/styled` only.

## Concerns — resolved before implementation

### C1 — `HighlightedTextProvider` Context → port to UIKit (keep Context, swap rendering to `uikit/shared/highlight()`)

**Concern.** `NotebookEditor.tsx` wraps the center panel in
`<HighlightedTextProvider value={pageState.searchText}>`. `NoteItemView`
consumes the Context via `useHighlightedText()` and calls
`highlightText(searchText, value)` for category, tags, title, and comment.
`useHighlightedText` lives under `components/basic/`, which is in the ban
list. The hook also feeds `editorConfig.highlightText` for the embedded
Monaco editor (in `MiniTextEditor`'s `useEffect`).

**Resolution.** The Context pattern is sound — it is an established
cross-cutting pattern in the codebase (LinkEditor, data-grid, form/List
also consume the same Provider). Keep the pattern but move the Provider
and hook into UIKit so they can be imported alongside the existing
`highlight()` rendering function.

1. **Extend `uikit/shared/highlight.ts`** — add `HighlightedTextProvider`
   and `useHighlightedText` alongside the existing pure `highlight()`
   function:
   ```ts
   // uikit/shared/highlight.ts (additions)
   import { createContext, useContext } from "react";

   const HighlightedTextContext = createContext<string | undefined>(undefined);

   export const HighlightedTextProvider = HighlightedTextContext.Provider;

   export function useHighlightedText(): string | undefined {
       return useContext(HighlightedTextContext);
   }
   ```
   File extension can stay `.ts` — `createContext` is a plain JS call,
   no JSX needed here.
2. **`NotebookEditor.tsx`** — drop the legacy import, keep the same
   `<HighlightedTextProvider value={pageState.searchText}>` wrapper, just
   imported from `uikit/shared/highlight`:
   ```tsx
   // before
   import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";

   // after
   import { HighlightedTextProvider } from "../../uikit/shared/highlight";
   ```
3. **`NoteItemView.tsx`** — drop the legacy import, keep the same
   `useHighlightedText()` call shape:
   ```tsx
   // before
   import { highlightText, useHighlightedText } from "../../components/basic/useHighlightedText";

   // after
   import { highlight, useHighlightedText } from "../../uikit/shared/highlight";
   ```
   Then replace each `highlightText(searchText, text)` call with
   `highlight(text, searchText)` — **note the argument order flips**, and
   matched substrings render in `<strong>` (not a styled
   `<span class="highlighted-text">`). The visual delta — bold instead of
   colored span — is acceptable. If we later want the same blue tint, a
   small `notebook/highlight.tsx` wrapper can call
   `uikit/shared/highlight()` and post-process the result to color the
   `<strong>` elements; not needed for v1.
4. **`editorConfig.highlightText`** stays — that flow goes through
   `EditorConfigProvider` (in `editors/base/`), not `useHighlightedText`.
   The hook's return value is still passed into `EditorConfigProvider`'s
   config object in `NoteItemView` (already does this — verify).
5. **`model.searchText = searchText;`** line in `NoteItemView` (which
   forwards it to `editModel`) — unchanged, still reads from the hook.
6. **`ExpandedNoteView.tsx`** — also call `useHighlightedText()` directly
   (sits under the same `<HighlightedTextProvider>` in the React tree). No
   prop threading needed.

The legacy `components/basic/useHighlightedText.tsx` exports
`highlightText`, `HighlightedTextProvider`, `useHighlightedText`, AND
`searchMatch` (a separate matching helper). The legacy file stays in place
for now — other consumers (LinkEditor, data-grid, form/List) still depend
on it. The UIKit version is a **parallel implementation**, not a
replacement; the two coexist until those other subsystems migrate (their
swap will be one-line, since the UIKit names match the legacy names).
`searchMatch` is not part of this port — it is a different helper and stays
in the legacy file. Notebook's `model.hasSearchMatch(value)` already uses
its own logic in `NoteItemViewModel` — does not import from
`useHighlightedText.tsx`. Confirmed.

### C2 — `Breadcrumb` → UIKit `Breadcrumb` (shipped via US-516)

**Resolution.** **[US-516](../US-516-uikit-breadcrumb/README.md)** added
`Breadcrumb` to UIKit. The swap is direct:

```tsx
// before (legacy)
import { Breadcrumb } from "../../components/basic/Breadcrumb";

// after
import { Breadcrumb } from "../../uikit/Breadcrumb";
```

The UIKit `Breadcrumb` API matches the legacy almost 1:1: `rootLabel`,
`value`, `onChange`, `separators`, `trailingParentSeparator`. Differences:
- `className` prop dropped — Notebook doesn't pass one.
- `size: "sm" | "md"` added; default `"md"` matches today's `fontSize: 13`
  closely. Notebook will use `size="sm"` for the toolbar trail (smaller
  visual weight in the toolbar slot).
- New optional `separatorContent` prop — Notebook does not need it.

### C3 — `CollapsiblePanelStack` → UIKit `CollapsiblePanelStack` (shipped via US-517)

**Resolution.** **[US-517](../US-517-uikit-collapsible-panel-stack/README.md)**
added `CollapsiblePanelStack` (and `CollapsiblePanel`) to UIKit. The swap
is direct:

```tsx
// before (legacy)
import {
    CollapsiblePanel,
    CollapsiblePanelStack,
} from "../../components/layout/CollapsiblePanelStack";

// after
import {
    CollapsiblePanel,
    CollapsiblePanelStack,
} from "../../uikit/CollapsiblePanelStack";
```

API matches the legacy, with one breaking change: `style` prop is replaced
by explicit `width` / `minWidth` / `maxWidth` props (Rule 7). Notebook's
current call site:

```tsx
// before
<CollapsiblePanelStack
    className="left-panel"
    style={{ width: pageState.leftPanelWidth }}
    activePanel={pageState.expandedPanel}
    setActivePanel={vm.setExpandedPanel}
>

// after
<CollapsiblePanelStack
    activePanel={pageState.expandedPanel}
    setActivePanel={vm.setExpandedPanel}
    width={pageState.leftPanelWidth}
    minWidth={100}
    maxWidth="80%"
>
```

The `min/max` constraints are lifted off the legacy `.left-panel` styled
selector and onto the UIKit prop surface. Visual outcome unchanged.

### C4 — `TagsList` → inline-rewrite as `notebook/TagsListView.tsx`, built on UIKit `ListBox`

**Concern.** `components/basic/TagsList` is a drill-down navigator (top-level
tags + subcategories, sticky back-header). It is NOT the same as UIKit
`TagsInput` — `TagsList` is a **filter selector** (single-select, vertical,
read-only navigation with counts and drill-down), while `TagsInput` is an
**entity-attribute editor** (multi-value, horizontal pills, add/remove).
Layout, selection model, edit affordances, and hierarchy treatment all
differ — these are two different components, not variants of one.

Only one consumer in the codebase: Notebook.

**Resolution.** **Inline-rewrite** the component into
`src/renderer/editors/notebook/TagsListView.tsx`, **built on top of UIKit
`ListBox`** rather than plain HTML rows. `ListBox` already covers the
single-select scrollable-vertical-list need, with a custom `renderItem`
hook that lets us compose `chevron + name + count` per row.

**Visual alignment with US-518 `selectionStyle="accent"`.** US-518 added the
sidebar convention (filled background + trailing chevron-right icon) to
`ListBox`. The drill-in chevron and back-header in TagsList preclude using
the default `<ListItem>` directly, so a custom `renderItem` is still
required — but the custom renderer **mirrors** the accent visuals
(`backgroundColor: color.background.selection` / `color: color.text.selection`
on selected rows) so the Notebook sidebar reads the same as the Storybook
left rail and MCP Inspector tool list. `selectionStyle` is ignored by
`ListBox` when `renderItem` is supplied — the visual is owned by the
renderer.

#### Why `ListBox` is a clean fit

| Feature needed by TagsList | Provided by `ListBox` |
|---|---|
| Vertical scrollable column | ✅ root + virtualization via RenderGrid |
| Single-select via `onChange(value)` | ✅ `value` / `onChange`, or `isSelected` predicate |
| Custom row layout (chevron + name + count) | ✅ `renderItem(ctx)` |
| Search highlighting (future) | ✅ `searchText` prop on default `<ListItem>` |
| Soft sidebar hover (vs. loud "select" hover) | ✅ `variant="browse"` |
| Section rows | ✅ `section: true` (not used here — back-header is interactive) |
| Empty / loading states | ✅ `emptyMessage`, `loading` |
| Type-safe item shape | ✅ `IListBoxItem` (extend with our extra fields) |

**Selection nuance.** The legacy `TagsList` treats parents as "selected when
the current value starts with the parent's prefix" (e.g. `value="release:1.0.1"`
selects the `release:` parent row in addition to the leaf row). UIKit
`ListBox`'s default value-based selection is exact-match only, so we use the
`isSelected` predicate to express the prefix rule.

#### Component shape

```ts
// notebook/TagsListView.tsx
import { ListBox, type IListBoxItem, type ListItemRenderContext } from "../../uikit/ListBox";
import { Panel } from "../../uikit/Panel";
import { ChevronLeftIcon, ChevronRightIcon } from "../../theme/icons";
import color from "../../theme/color";
import { useEffect, useMemo, useState } from "react";

export interface TagsListViewProps {
    tags: string[];
    value: string;
    onChange: (value: string) => void;
    getCount?: (tag: string) => number | undefined;
    separator?: string;        // default ":"
    rootLabel?: string;        // default "All"
}

interface TagItem extends IListBoxItem {
    value: string;             // full tag value (e.g. "release:1.0.1" or "release:")
    name: string;              // display text (post-separator part for children, raw for top-level)
    count?: number;
    hasChildren?: boolean;     // for top-level rows
    isAll?: boolean;           // for the "All" pseudo-row
    isBack?: boolean;          // for the drilled-in back header
}
```

#### State machine

The same two-state machine as the legacy:

```ts
const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

// Sync with external value changes (e.g. Breadcrumb navigation in the toolbar
// portal) — same effect as the legacy.
useEffect(() => {
    if (!value) setExpandedCategory(null);
    else if (value.includes(separator)) {
        const parentName = value.slice(0, value.indexOf(separator));
        setExpandedCategory(parentName);
    } else setExpandedCategory(null);
}, [value, separator]);
```

#### Items computed per state

`items: TagItem[]` is computed via `useMemo` based on `expandedCategory`:

- **Top-level (`expandedCategory === null`)** — same parsing logic as the
  legacy `useMemo` that splits raw `tags: string[]` into simple tags and
  category groups. Then the array is:
  1. `{ value: "", name: rootLabel, isAll: true, count: getCount?.("") }`
  2. ...sorted simple tags + category groups, each with `hasChildren` set.

- **Drilled-in (`expandedCategory !== null`)** — parent's children sub-list:
  1. `{ value: expandedCategory + separator, name: expandedCategory, isBack: true, count: getCount?.(expandedCategory + separator) }`
  2. ...children, each `{ value: fullTag, name: childPart }`, alphabetically.

#### Render

```tsx
const renderItem = (ctx: ListItemRenderContext<TagItem>): React.ReactNode => {
    const item = ctx.source;
    return (
        <div
            data-selected={ctx.selected || undefined}
            style={{
                display: "flex", alignItems: "center", height: "100%",
                paddingLeft: 8, paddingRight: 8,
                // Mirror UIKit ListBox `selectionStyle="accent"` visuals
                // (filled selection background) — see US-518.
                backgroundColor: ctx.selected ? color.background.selection : undefined,
                color: ctx.selected ? color.text.selection : color.text.light,
            }}
        >
            {/* Leading slot — chevron-back / chevron-right / spacer */}
            {item.isBack ? (
                <span
                    onClick={(e) => { e.stopPropagation(); setExpandedCategory(null); }}
                    style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 4, cursor: "pointer" }}
                >
                    <ChevronLeftIcon style={{ width: 12, height: 12 }} />
                </span>
            ) : item.hasChildren ? (
                <span
                    onClick={(e) => { e.stopPropagation(); setExpandedCategory(item.name); onChange(item.value); }}
                    style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 4, cursor: "pointer" }}
                >
                    <ChevronRightIcon style={{ width: 12, height: 12 }} />
                </span>
            ) : (
                <span style={{ width: 16, marginRight: 4 }} />
            )}

            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
            </span>

            {item.count !== undefined && (
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                    {item.count}
                </span>
            )}
        </div>
    );
};

// Selection predicate — exact match OR "value starts with this row's parent prefix"
const isSelected = (item: TagItem): boolean => {
    if (item.value === value) return true;
    if (item.value.endsWith(separator) && value.startsWith(item.value)) return true;
    return false;
};

return (
    <Panel direction="column" flex={1} overflow="hidden" width="100%">
        <ListBox
            items={items}
            isSelected={isSelected}
            onChange={(item) => onChange(item.value)}
            renderItem={renderItem}
            variant="browse"
            rowHeight={28}
        />
    </Panel>
);
```

Key choices vs. legacy plain-HTML rewrite:

- **`variant="browse"`** — soft hover background instead of the loud
  selection-style highlight, matching the legacy sidebar feel.
- **`isSelected` predicate** — handles the "parent prefix selection" rule
  cleanly without conflating `value` shape.
- **Custom `renderItem`** — composes the chevron-left / chevron-right /
  spacer leading slot, label, and count. The chevron's `onClick` calls
  `e.stopPropagation()` so the row body's natural click (which fires
  `ListBox.onChange`) doesn't double-fire when the user clicks the chevron.
- **No sticky CSS needed** — the back-row is just the first item in the
  drilled-in items array. ListBox's scroll container starts at row 0; the
  back row stays at the top because there's nothing above it. (If the
  children list later grows long enough to warrant a sticky header that
  pins on scroll, swap to a separate plain `<div>` above the ListBox —
  out of scope for v1.)
- **No virtualization concerns** — typical notebooks have a small number of
  tags; ListBox handles virtualization free regardless.

The component is ~340 lines today; expected UIKit-based version ~180–200
lines (most of the savings come from replacing 70 lines of `styled.div`
descendants with 0 lines of custom CSS — ListBox owns all the chrome).

- Update `NotebookEditor.tsx` to import `TagsListView` from `./TagsListView`
  instead of `components/basic/TagsList`. Delete the original import.

### C5 — `CategoryTree` → UIKit `<Tree>` with a local `buildCategoryTreeItems` helper

**Concern.** `components/TreeView/CategoryTree.tsx` wraps `TreeView` and
builds tree items from a flat `categories: string[]`. UIKit `<Tree>` accepts
`ITreeItem[]` directly, supports trait DnD via `traitTypeId` + `getDragData`
+ `acceptsDrop` + `canTraitDrop` + `onTraitDrop` (US-488), and supports
`isSelected` predicate selection (matching today's `getSelected`).

**Resolution.** Replace `<CategoryTree>` with `<Tree>` and a small local
helper.

1. Add a helper next to the editor:
   ```ts
   // notebook/category-tree.ts (NEW)
   import type { ITreeItem } from "../../uikit/Tree";
   import { splitWithSeparators } from "../../core/utils/utils";

   export interface CategoryItem extends ITreeItem {
       value: string;            // full category path (used as ITreeItem.value)
       category: string;         // alias = value
       size?: number;            // count badge
       items?: CategoryItem[];
   }

   export function buildCategoryTreeItems(
       categories: string[],
       getSize: (category: string) => number | undefined,
       rootLabel: string = "All",
       separators: string = "/\\",
   ): CategoryItem[] {
       /* same logic as components/TreeView/CategoryTree's buildRoot,
          except returns array of ITreeItem-compatible nodes; root "All"
          becomes a single top-level item with value="" and label includes
          its size; children are sorted by name */
       …
   }
   ```
2. In `NotebookEditor.tsx`, replace:
   ```tsx
   <CategoryTree
       categories={pageState.categories}
       separators="/\"
       rootLabel="All"
       rootCollapsible={false}
       onItemClick={vm.categoryItemClick}
       getSelected={vm.getCategoryItemSelected}
       getLabel={getTreeItemLabel}
       refreshKey={pageState.selectedCategory}
       traitTypeId={TraitTypeId.NotebookCategory}
       getDragData={vm.getCategoryDragData}
       acceptsDrop
       canTraitDrop={canCategoryTraitDrop}
       onTraitDrop={vm.categoryTraitDrop}
   />
   ```
   with:
   ```tsx
   <Tree
       items={categoryTreeItems}                // memoized via buildCategoryTreeItems
       isSelected={isCategorySelected}          // wraps vm.getCategoryItemSelected
       onChange={(item) => vm.categoryItemClick(item)}
       traitTypeId={TraitTypeId.NotebookCategory}
       getDragData={(item, level) => vm.getCategoryDragData(item, level)}
       acceptsDrop
       canTraitDrop={(target, payload) => canCategoryTraitDrop(target, payload)}
       onTraitDrop={(target, payload) => vm.categoryTraitDrop(target, payload)}
       defaultExpandAll
   />
   ```
3. The label is rendered as the tree row's `label` field (a `ReactNode`):
   `<><span style={{ flex: 1 }}>{name || "All"}</span>{size !== undefined && <span style={{ margin: "0 4px", fontSize: 12 }}>{size}</span>}</>`.
4. Drop the `categoryItemClick(item: CategoryTreeItem)` signature shim if
   needed — UIKit `Tree.onChange` passes the source item, which is our
   `CategoryItem` (extends `ITreeItem`), so callbacks should work directly
   after a small adapter cast (or update `NotebookViewModel` callback
   signatures to accept the new item shape — both options are valid; pick
   the smaller diff).

**Note.** This removes `components/TreeView` from the import surface. That
folder's removal is NOT a Phase 4 acceptance criterion (it's not in the
`components/basic|form|layout|overlay/` ban list), but cleaning up the only
consumer is good hygiene.

### C6 — `SwitchButtons` → `<SegmentedControl>` (reshape items upstream)

**Concern.** `NoteItemToolbar` calls
```tsx
<SwitchButtons options={switchOptions.options} value={editor || "monaco"} onChange={model.changeEditor} getLabel={switchOptions.getOptionLabel} style={{ margin: 1 }} />
```
UIKit `SegmentedControl` does not accept `getLabel` / `style` (Rule 3 — no
accessor props; Rule 7 — no `style` on UIKit components).

**Resolution.** Pre-shape items at the call site:
```tsx
const segments: ISegment[] = useMemo(
    () => switchOptions.options.map((opt) => ({
        value: opt,                             // EditorView id (string)
        label: switchOptions.getOptionLabel(opt),
    })),
    [switchOptions]
);
```
Then:
```tsx
<SegmentedControl items={segments} value={editor || "monaco"} onChange={(v) => model.changeEditor(v as EditorView)} size="sm" />
```
Drop the `style={{ margin: 1 }}` — visually negligible.

### C7 — `WithPopupMenu` → `<WithMenu>` (direct rename)

Same pattern as US-499 C8: render-prop signatures match exactly. Legacy
callback name is `setOpen` (e.g., for `language` button) → keep `setOpen`.
`MenuItem[]` type re-exports the same canonical type.

### C8 — `Splitter` (legacy) → UIKit `Splitter`

Direct mapping (per US-486 / US-499):

| Old | New |
|---|---|
| `type="vertical"` | `orientation="vertical"` |
| `initialWidth={pageState.leftPanelWidth}` | `value={pageState.leftPanelWidth}` |
| `onChangeWidth={vm.setLeftPanelWidth}` | `onChange={vm.setLeftPanelWidth}` |
| `borderSized="right"` | `border="after"` |

Add `min={100}` to honor the legacy `minWidth: 100` constraint that today
sits on the panel itself.

### C9 — `TextField` (search field) → `<Input endSlot={…}>` (per US-499 C6)

The search field in the toolbar portal:
```tsx
<Input
    value={pageState.searchText}
    onChange={vm.setSearchText}
    placeholder="Search..."
    endSlot={pageState.searchText
        ? <IconButton size="sm" icon={<CloseIcon />} title="Clear search" onClick={vm.clearSearch} />
        : null}
    size="sm"
/>
```
The legacy `SearchField` styled extension colored the input text blue. Same
decision as US-499 C6: **drop the blue tint**; small visual delta acceptable.

### C10 — `TextAreaField` (note comment) → `<Textarea variant="ghost">`

Both `NoteItemView` and `ExpandedNoteView` use `TextAreaField` for the
comment field with `className="comment-field"` and inline-edit styling. Swap
direct:
```tsx
<Textarea
    variant="ghost"
    value={note.comment}
    onChange={(v) => model.handleCommentChange(v)}
    onBlur={...}
    placeholder="Add a comment..."
    maxHeight={160}
/>
```
The legacy CSS adds `font-style: italic` and `color: text.light`. UIKit
`Textarea` doesn't expose font-style. Two options:
- **A** (chosen): wrap in plain `<div style={{ fontStyle: "italic", color: color.text.light }}>` — Rule 7 allows inline style on plain HTML.
- **B**: add a `tone` prop to UIKit `Textarea`. Out of scope; one-off.

Same wrapper carries the `searchMatch` color (`color.misc.blue`) when
`model.hasSearchMatch(comment)` returns truthy.

### C11 — `<Button size="small" type="raised|flat|icon">` → UIKit primitives

| Legacy | New |
|---|---|
| `<Button type="raised" size="small" style={{ borderColor: color.border.active }}>` (Add Note) | `<Button variant="primary" size="sm" icon={<PlusIcon />}>Add Note</Button>` (drop the inline borderColor — primary variant already has its own emphasis) |
| `<Button type="icon" size="small">` (clear search, etc.) | `<IconButton size="sm" icon={<X />} title="…" />` |
| `<Button type="flat" size="small">` (Expand, Delete, Collapse) | `<IconButton size="sm" icon={<…>} title="…" variant="ghost" />` if available; else default IconButton |

UIKit `IconButton` already covers small icon-only buttons. Verify in
implementation that `IconButton` accepts a `variant="ghost"` for the flat
variant (`uikit/IconButton/IconButton.tsx`); if not, default IconButton
chrome is acceptable.

### C12 — Raw `<input className="title-input">` → `<Input variant="ghost" size="sm">`

Both `NoteItemView` and `ExpandedNoteView` use raw `<input type="text">` for
the note title with a `.title-input` styled selector. Replace with UIKit
`<Input variant="ghost" size="sm">`. The `searchMatch` blue-tint applied via
`.title-input.search-match` is replaced with a wrapping plain `<div style={{ color: searchMatch ? color.misc.blue : undefined }}>` (Rule 7
allows inline style on plain HTML).

The legacy CSS `font-weight: 500` on `.title-input` is currently a single
weight delta; UIKit Input doesn't expose font-weight. Acceptable visual
delta — drop.

### C13 — `PathInput` (legacy) → UIKit `<PathInput size="sm">`

Direct swap. `className="tag-path-input"` and `className="path-input"`
descendant overrides (controlling padding / fontSize / minWidth / maxWidth)
are dropped — UIKit `PathInput` size variants give us a similar small
inline form factor.

The legacy code also has explicit `.path-input-field` overrides nested in
the styled root. These mirror the `size="sm"` defaults closely; the `minWidth`
constraint (legacy 80–200px) is replaced by a `width: 120` (or similar)
prop. Verify in implementation pass.

### C14 — NoteItemView focus/hover/searching cascades — track via React state + inline styles

**Concern.** `NoteItemViewRoot` styled definition has ~270 lines of CSS with
intricate cascades that cannot be expressed via UIKit Panel props alone:

| Cascade | Effect | Trigger |
|---|---|---|
| `&:focus-within .note-indicator` | dot turns blue, line turns blue | item gains keyboard or programmatic focus |
| `&:focus-within .content-area::before { opacity: 0 }` | content overlay disappears | focus-within |
| `&.searching .toolbar-hover-content { opacity: 1 }` | hover toolbar always visible | searchText prop is non-empty |
| `&:hover:not(:has(...)) .toolbar-hover-content` | hover toolbar opacity 1 | mouse hover (excluding deactivation area) |
| `&.dragging { opacity: 0.5 }` | dragging visual | already tracked via `useState<isDragging>` |
| `&:focus-within .switch-button.active` | language segment colors flip | focus-within |

UIKit `<Panel revealChildrenOnHover>` handles **only** the visibility-fade
case (toolbar-hover-content + editor-extras), and only when paired with
`data-visibility="parent-hover"` on children. The other cascades (color
swaps, overlay opacity) are **style** changes, not visibility changes.

**Resolution.** Track `isFocused` and `isHovered` in component state on the
NoteItemView root. Apply inline styles to dependent elements based on these
flags. Net: ~3 new `useState`s in `NoteItemView`.

```tsx
const [isFocused, setIsFocused] = useState(false);
const [isHovered, setIsHovered] = useState(false);
const isSearching = Boolean(searchText);

const handleFocus = () => setIsFocused(true);
const handleBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsFocused(false);
};
const handleMouseEnter = () => setIsHovered(true);
const handleMouseLeave = () => setIsHovered(false);

// Note indicator dot — color follows isFocused
<div style={{
    position: "absolute",
    left: 4, top: 12, bottom: 8,
    width: 16,
    color: isFocused ? color.misc.blue : color.text.light,
    cursor: "grab",
    transition: "color 0.5s ease",
}}>
    <CircleIcon style={{ width: 16, height: 16 }} />
    <div style={{           // ::after vertical line
        position: "absolute",
        left: "50%", top: 16, bottom: 0, width: 1,
        backgroundColor: isFocused ? color.misc.blue : color.background.light,
        transition: "background-color 0.5s ease",
    }} />
</div>

// Toolbar-hover-content — opacity follows hover OR searching
<div style={{
    display: "flex", alignItems: "center", gap: 8, flex: 1,
    opacity: (isHovered || isSearching) ? 1 : 0,
    transition: "opacity 0.15s ease",
}}>…</div>
```

The complex `&:hover:not(:has(.deactivation-area:hover))` selector — meaning
"hover doesn't count when the deactivation area is being hovered" —
translates to: the deactivation area's own `onMouseEnter` calls
`setIsHovered(false)`. Two non-overlapping handlers (note item +
deactivation area) suffice; don't need `:has()` polyfill.

**Plain HTML `<div style={...}>` is Rule 7 compliant** — the rule forbids
`style=` only on UIKit components. The replaced root and its inner divs
are plain HTML.

### C15 — Wrap `<NoteItemToolbar>`'s `ToolbarRoot` styled.div → plain `<div>` or `<Panel>`

`NoteItemToolbar.tsx` has two small styled roots:
```tsx
const ToolbarRoot = styled.div({ display: "flex", alignItems: "center", gap: 4, flex: 1 });
const EditorToolbarSlot = styled.div({ display: "flex", alignItems: "center", gap: 4 });
```
Replace with `<Panel direction="row" align="center" gap="xs" flex={1}>` and
`<Panel direction="row" align="center" gap="xs">` respectively. Both ports
preserve current spacing / alignment.

### C16 — `MiniTextEditor` styled root → plain `<div style={...}>`

`MiniTextEditor.tsx` has one tiny styled root:
```tsx
const MiniTextEditorRoot = styled.div({
    position: "relative",
    "&.fill-container": { flex: "1 1 auto", overflow: "hidden" },
});
```
Replace with a plain `<div style={...}>` and inline conditional logic — no
state needed; the className → conditional inline style direct swap.

### C17 — Files that need NO changes

- `NoteItemViewModel.ts` — pure model code; already exposes
  `setRefs`/`handleDeactivate`/`handleCategoryClick`/etc. The `searchText`
  field stays (set externally from the new prop instead of the Context hook).
- `NoteItemEditModel.ts` — model.
- `NoteItemActiveEditor.tsx` — verified: no `styled` imports, no chrome
  primitive imports, just renders MiniTextEditor or AsyncEditor.
- `NotebookViewModel.ts` — pure model code.
- `notebookTypes.ts` — types.
- `index.ts` — re-exports.
- `editors/base/*` — kept; UIKit migration for editor base infrastructure
  is out of scope for this task.
- `components/virtualization/RenderGrid/*` — kept; not part of the legacy
  ban surface.
- `components/basic/Breadcrumb`, `components/layout/CollapsiblePanelStack`,
  `components/basic/useHighlightedText` — kept (per C2/C3, plus the Context
  consumer `useHighlightedText` itself stays since Notebook drops use of
  it but other consumers — `data-grid/DataCell.tsx`, `form/List.tsx` —
  still depend on it).

## Implementation plan

### Step 1 — Migrate `NotebookEditor.tsx` (root, splitter, sidebar host, search portal, Add Note button)

File: `src/renderer/editors/notebook/NotebookEditor.tsx`

1. Replace import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../components/basic/Button";
   import { TextField } from "../../components/basic/TextField";
   import { TagsList } from "../../components/basic/TagsList";
   import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
   import { CategoryTree, CategoryTreeItem } from "../../components/TreeView";
   import { Splitter } from "../../components/layout/Splitter";

   // add
   import { Panel } from "../../uikit/Panel";
   import { Input } from "../../uikit/Input";
   import { Button } from "../../uikit/Button";
   import { IconButton } from "../../uikit/IconButton";
   import { Splitter } from "../../uikit/Splitter";
   import { Tree } from "../../uikit/Tree";
   import type { ITreeItem } from "../../uikit/Tree";
   import { TagsListView } from "./TagsListView";
   import { buildCategoryTreeItems, type CategoryItem } from "./category-tree";
   import { Breadcrumb } from "../../uikit/Breadcrumb";
   import { CollapsiblePanel, CollapsiblePanelStack } from "../../uikit/CollapsiblePanelStack";
   import { HighlightedTextProvider } from "../../uikit/shared/highlight";
   ```
   The `HighlightedTextProvider` import path moves from
   `components/basic/useHighlightedText` to `uikit/shared/highlight`
   (per C1) — the JSX usage and the wrapped subtree are unchanged.
2. Delete `NotebookEditorRoot` and `SearchField` styled-component blocks.
3. Replace `<NotebookEditorRoot>` with
   `<Panel direction="row" flex={1} overflow="hidden">`.
4. Left-side `<CollapsiblePanelStack>` (UIKit) — replace the legacy
   `className="left-panel" style={{ width: ... }}` props with the typed
   UIKit props (per C3):
   ```tsx
   <CollapsiblePanelStack
       activePanel={pageState.expandedPanel}
       setActivePanel={vm.setExpandedPanel}
       width={pageState.leftPanelWidth}
       minWidth={100}
       maxWidth="80%"
   >
   ```
   The legacy `.left-panel` styled selector also set `backgroundColor: color.background.dark` — the UIKit primitive's default chrome covers
   panel-header backgrounds; the panel-content background defaults to
   `color.background.default`. Confirm visual parity at implementation time;
   if the sidebar needs the darker fill, wrap the stack in a
   `<Panel background="dark">` with the matching width/min/max props moved
   onto the wrapper.
5. Inside `<CollapsiblePanel id="tags">`, replace the `<TagsList>` block:
   ```tsx
   <CollapsiblePanel id="tags" title="Tags">
       <Panel direction="row" flex={1} overflow="hidden" width="100%">
           <TagsListView
               tags={pageState.tags}
               value={pageState.selectedTag}
               onChange={vm.setSelectedTag}
               getCount={vm.getTagSize}
           />
       </Panel>
   </CollapsiblePanel>
   ```
6. Inside `<CollapsiblePanel id="categories">`, replace `<CategoryTree>` per C5:
   ```tsx
   const categoryTreeItems = useMemo(
       () => buildCategoryTreeItems(pageState.categories, vm.getCategorySize),
       [pageState.categories, pageState.categoriesSize, vm.getCategorySize],
   );
   const isCategorySelected = useCallback(
       (item: CategoryItem) => vm.getCategoryItemSelected(item as unknown as CategoryTreeItem),
       [vm, pageState.selectedCategory],
   );
   ...
   <CollapsiblePanel id="categories" title="Categories">
       <Panel direction="column" flex={1} overflow="hidden" paddingLeft="xs">
           <Tree
               items={categoryTreeItems}
               isSelected={isCategorySelected}
               onChange={(item) => vm.categoryItemClick(item as unknown as CategoryTreeItem)}
               traitTypeId={TraitTypeId.NotebookCategory}
               getDragData={(item, level) => vm.getCategoryDragData(item as unknown as CategoryTreeItem, level)}
               acceptsDrop
               canTraitDrop={(target, payload) => canCategoryTraitDrop(target as unknown as CategoryTreeItem, payload)}
               onTraitDrop={(target, payload) => vm.categoryTraitDrop(target as unknown as CategoryTreeItem, payload)}
               defaultExpandAll
           />
       </Panel>
   </CollapsiblePanel>
   ```
7. Replace `<Splitter type="vertical" initialWidth={pageState.leftPanelWidth} onChangeWidth={vm.setLeftPanelWidth} borderSized="right" />` with:
   ```tsx
   <Splitter
       orientation="vertical"
       value={pageState.leftPanelWidth}
       onChange={vm.setLeftPanelWidth}
       border="after"
       min={100}
   />
   ```
8. Keep the `<HighlightedTextProvider>` wrapper per C1 (now imported from
   `uikit/shared/highlight` instead of `components/basic/useHighlightedText`).
   Center panel:
   ```tsx
   <HighlightedTextProvider value={pageState.searchText}>
       <Panel direction="column" flex={1} overflow="hidden" position="relative">
           {allNotes.length === 0 ? (
               <Panel direction="column" flex={1} align="center" justify="center" gap="md" padding="md">
                   <Text size="xl">Notes</Text>
                   <Text color="light">No notes yet</Text>
                   <Text color="light">Click "Add Note" to create your first note</Text>
               </Panel>
           ) : notes.length === 0 ? (
               <Panel direction="column" flex={1} align="center" justify="center" padding="md">
                   <Text color="light">No notes match the current filter</Text>
               </Panel>
           ) : (
               <RenderFlexGrid … />     // unchanged
           )}
       </Panel>
   </HighlightedTextProvider>
   ```
   `NoteItemView` and `ExpandedNoteView` consume `searchText` via
   `useHighlightedText()` from `uikit/shared/highlight` — no extra prop
   threading.
9. Replace the toolbar portal contents:
   ```tsx
   {Boolean(model.editorToolbarRefLast) && createPortal(
       <>
           <Button variant="primary" size="sm" icon={<PlusIcon />} title="Add Note" onClick={vm.addNote}>
               Add Note
           </Button>
           <Input
               size="sm"
               value={pageState.searchText}
               onChange={vm.setSearchText}
               placeholder="Search..."
               endSlot={pageState.searchText
                   ? <IconButton size="sm" icon={<CloseIcon />} title="Clear search" onClick={vm.clearSearch} />
                   : null}
           />
       </>,
       model.editorToolbarRefLast
   )}
   ```
   The Breadcrumb portal stays unchanged (C2).
10. Footer portal remains unchanged (`<span>` with note count).

### Step 2 — Add `notebook/category-tree.ts` helper

File: `src/renderer/editors/notebook/category-tree.ts` (NEW)

Port `buildRoot` from `components/TreeView/CategoryTree.tsx`, returning
`CategoryItem[]` (ITreeItem-extending) instead of the legacy `CategoryTreeItem`
shape. The shape is structurally compatible — `value`, `category`, `items`
are present on both. Add the `label` field as a ReactNode (rendered name +
size badge) so UIKit Tree's default `<TreeItem>` renderer shows correctly.

### Step 3 — Add `notebook/TagsListView.tsx` (inline rewrite of `TagsList`, ListBox-based)

File: `src/renderer/editors/notebook/TagsListView.tsx` (NEW)

Port `components/basic/TagsList.tsx` onto UIKit `ListBox` per **C4**. Same
external API — `tags`, `value`, `onChange`, `getCount`, `separator`,
`rootLabel` — minus `className` (Rule 7). Expected ~180–200 lines.

Implementation outline:

1. Item shape — `TagItem extends IListBoxItem` with the extra fields
   `name`, `count`, `hasChildren`, `isAll`, `isBack` (per C4).
2. `useState<string | null>(null)` for `expandedCategory`. Sync effect
   with the external `value` (same logic as legacy: drill into parent when
   `value.includes(separator)`).
3. `useMemo` computes `items: TagItem[]` based on `expandedCategory`:
   - Top-level: `[All row, ...sorted simpleGroups + categoryGroups]`.
     Reuse the same parsing logic from the legacy `useMemo` —
     `categoryGroups: Map<string, TagGroup>`, `childrenMap`,
     `categoryGroups.get(parent)!.hasChildren = true`. Then map to
     `TagItem[]`.
   - Drilled-in: `[Back row for parent, ...sorted children]`.
4. `isSelected(item)` predicate per C4 — exact match OR
   `item.value.endsWith(separator) && value.startsWith(item.value)`.
5. `renderItem(ctx)` per C4 — leading chevron-back / chevron-right /
   spacer slot, name (`<span>` with ellipsis), trailing count.
6. Render:
   ```tsx
   <Panel direction="column" flex={1} overflow="hidden" width="100%">
       <ListBox
           items={items}
           isSelected={isSelected}
           onChange={(item) => onChange(item.value)}
           renderItem={renderItem}
           variant="browse"
           rowHeight={28}
       />
   </Panel>
   ```

No new UIKit work — `ListBox` and `Panel` already in place. No `styled.div`
in the file; row visuals are inline-styled plain HTML inside the
`renderItem` callback (Rule 7 compliant).

#### Files imported

```tsx
import { useEffect, useMemo, useState } from "react";
import { ListBox, type IListBoxItem, type ListItemRenderContext } from "../../uikit/ListBox";
import { Panel } from "../../uikit/Panel";
import { ChevronLeftIcon, ChevronRightIcon } from "../../theme/icons";
import color from "../../theme/color";
```

No imports from `components/basic|form|layout|overlay/`.

### Step 4 — Migrate `NoteItemView.tsx` (largest file — focus / hover / searching state)

File: `src/renderer/editors/notebook/NoteItemView.tsx`

1. Replace import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../components/basic/Button";
   import { PathInput } from "../../components/basic/PathInput";
   import { TextAreaField } from "../../components/basic/TextAreaField";
   import { highlightText, useHighlightedText } from "../../components/basic/useHighlightedText";

   // add
   import { Panel } from "../../uikit/Panel";
   import { IconButton } from "../../uikit/IconButton";
   import { Input } from "../../uikit/Input";
   import { Textarea } from "../../uikit/Textarea";
   import { PathInput } from "../../uikit/PathInput";
   import { highlight, useHighlightedText } from "../../uikit/shared/highlight";
   ```
2. Keep `useHighlightedText()` call shape — only the import path changes
   (per C1). No prop addition to `NoteItemViewProps`.
3. Delete `NoteItemViewRoot` styled definition.
4. Add `useState`s for `isFocused` and `isHovered`. Keep the
   `useHighlightedText()` hook call — `searchText` still flows in via
   Context.
5. Restructure render tree per C14 — outer plain `<div style={…}>` with
   focus / hover / dragging conditional styling, inner content per the
   layout map below:

   ```text
   <div style={{ display: "flex", flexDirection: "column", … opacity: isDragging ? 0.5 : 1 }}
        ref={model.setRefs} tabIndex={0}
        onFocus={…} onBlur={…} onMouseEnter={…} onMouseLeave={…}>
     ├── <div className="deactivation-area" onClick onMouseEnter={() => setIsHovered(false)} />
     ├── <div className="note-indicator" draggable …>
     │     ├── <CircleIcon style={{…color follows isFocused…}} />
     │     └── <div style={{ ::after line, color follows isFocused }} />
     ├── <Panel direction="row" align="center" gap="sm" paddingX="xs" revealChildrenOnHover={!isSearching}>
     │     ├── <div style={{display:"flex", gap:8, opacity: (isHovered || isSearching) ? 1 : 0}}>
     │     │     ├── Category — `<span>` or `<PathInput size="sm" width={120}>` (editingCategory)
     │     │     ├── Tags container — `<div style={…flex-direction: row-reverse, overflow}>`
     │     │     │     ├── Add-tag PathInput (when addingTag)
     │     │     │     └── Tag spans / edit PathInputs (reversed)
     │     │     ├── Spacer
     │     │     ├── Date <span>
     │     │     ├── Expand — <IconButton size="sm" />
     │     │     └── Delete — <IconButton size="sm" />
     ├── <Panel direction="row" align="center" gap="xs" paddingX="xs" marginBottom={2}>
     │     └── <NoteItemToolbar model={model.editModel}>
     │           └── <div style={{opacity: item.done ? 0.6 : 1}}>
     │                 <Input variant="ghost" size="sm" value={note.title} onChange={…} />
     ├── <div className="content-area" style={{
     │       border: ..., transition, position: "relative" }}>
     │     └── <div style={{ ::before overlay, opacity: isFocused ? 0 : 0.5 }} />
     │     └── <EditorStateStorageProvider><EditorConfigProvider …><NoteItemActiveEditor … /></EditorConfigProvider></EditorStateStorageProvider>
     └── <div className="comment-section">
           ├── if comment !== undefined: <Textarea variant="ghost" maxHeight={160}/>
           └── else: <span style={{opacity:isHovered?1:0,…}} onClick>+ Add comment</span>
   </div>
   ```

   Highlights:
   - `highlight(text, searchText)` replaces `highlightText(searchText, text)`
     in three places (category, tags, body display).
   - The category badge keeps its inline span — replace
     `className="category"` with `style={{ padding: "2px 6px", backgroundColor: color.background.light, borderRadius: 3, cursor: "pointer" }}`.
   - Tag badges similarly. Tag delete `<X>` icon stays inside the span;
     reveal/hover via inline conditional opacity.
   - Add-tag `<PlusIcon>` button → keep as `<span>` with hover style;
     `<IconButton>` is overkill for a 12px icon-on-pill control.
   - The drag handle (`note-indicator`) keeps its native HTML5
     `draggable`/`onDragStart`/`onDragEnd` — UIKit doesn't replace this.

6. The `NoteItemActiveEditor` and the `EditorConfigProvider` wrapping is
   unchanged. The `searchText` prop is already routed through
   `editorConfig.highlightText`; just verify the wrapper passes
   `highlightText: searchText` (it does, already).

### Step 5 — Migrate `ExpandedNoteView.tsx`

File: `src/renderer/editors/notebook/ExpandedNoteView.tsx`

Smaller scope than NoteItemView (no list-row hover dance, always shown
as a full-detail overlay).

1. Replace import block parallel to Step 4.
2. Delete `ExpandedNoteViewRoot` styled definition.
3. Restructure render tree — outer plain `<div>` (always-blue dot indicator
   line — inline style), then header `<Panel direction="row">` for
   category/tags/date/Collapse, editor-toolbar `<Panel direction="row">`
   for the language/title/extras, content `<Panel flex={1}>`, and a footer
   comment `<Panel direction="column">`.
4. Replace the legacy `<Button type="flat" size="small">Collapse</Button>`
   with `<IconButton size="sm" icon={<WindowRestoreIcon />} title="Collapse (Esc)" />`.
5. Replace `<TextAreaField>` with `<Textarea variant="ghost" maxHeight={160}>`
   wrapped in italic+light `<div style={{...}}>` per C10.
6. Consume `searchText` via `useHighlightedText()` from
   `uikit/shared/highlight` (per C1 — same Context as `NoteItemView`).
   Apply `highlight(text, searchText)` for category/tags/title/comment.
7. The four `useState`s for category/tag editing stay; just call sites
   move to UIKit `PathInput`.

### Step 6 — Migrate `note-editor/NoteItemToolbar.tsx`

File: `src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx`

1. Replace import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../../components/basic/Button";
   import { SwitchButtons } from "../../../components/form/SwitchButtons";
   import { WithPopupMenu } from "../../../components/overlay/WithPopupMenu";
   import { MenuItem } from "../../../components/overlay/PopupMenu";

   // add
   import { Panel } from "../../../uikit/Panel";
   import { IconButton } from "../../../uikit/IconButton";
   import { SegmentedControl, type ISegment } from "../../../uikit/SegmentedControl";
   import { WithMenu } from "../../../uikit/Menu";
   import type { MenuItem } from "../../../uikit/Menu";
   ```
2. Delete `ToolbarRoot` and `EditorToolbarSlot` styled definitions.
3. Reshape `switchOptions.options` → `ISegment[]` per C6.
4. Replace `<SwitchButtons>` with `<SegmentedControl>` (drop
   `style={{ margin: 1 }}`).
5. Replace `<Button type="icon">` (run-script, run-all, language) with
   `<IconButton size="sm" />`.
6. Replace `<WithPopupMenu>` with `<WithMenu>` — same render-prop signature.
7. Replace `<ToolbarRoot>` with `<Panel direction="row" align="center" gap="xs" flex={1}>`.
8. Replace `<EditorToolbarSlot>` with `<Panel direction="row" align="center" gap="xs">`
   plus a `ref={...}` callback (Panel forwards refs).

### Step 7 — Migrate `note-editor/MiniTextEditor.tsx`

File: `src/renderer/editors/notebook/note-editor/MiniTextEditor.tsx`

1. Drop `import styled from "@emotion/styled";`.
2. Delete `MiniTextEditorRoot` styled definition.
3. Replace with plain `<div style={...}>`:
   ```tsx
   <div style={fillContainer
       ? { position: "relative", flex: "1 1 auto", overflow: "hidden" }
       : { position: "relative", height: contentHeight }}>
       <Editor … />
   </div>
   ```

### Step 8 — Verify

1. `npx tsc --noEmit` — no new type errors.
2. `npm run lint` — clean.
3. Manual smoke test (see Test surface below).
4. Confirm:
   ```bash
   # Should produce ZERO matches (Emotion):
   grep -RE "from \"@emotion/styled\"" src/renderer/editors/notebook/

   # Should produce ZERO matches (form/overlay/virtualization-of-basic):
   grep -RE "components/(form|overlay)" src/renderer/editors/notebook/
   grep -RE "components/basic/(Button|TextField|TextAreaField|TagsList|PathInput|useHighlightedText)" src/renderer/editors/notebook/

   # Should ALSO produce ZERO matches (legacy Breadcrumb / CollapsiblePanelStack
   # now removed per C2/C3 — UIKit equivalents are imported from uikit/ instead):
   grep -RE "components/basic/Breadcrumb" src/renderer/editors/notebook/
   grep -RE "components/layout/CollapsiblePanelStack" src/renderer/editors/notebook/
   ```

## Test surface (manual smoke)

- Open a `.notebook.json` file: notes render in the list panel (one card per note).
- Sidebar — Tags panel: top-level tags listed with counts; clicking one
  filters notes; drilling into a `parent:` tag shows children + sticky back
  header; back button returns to top.
- Sidebar — Categories panel: tree shows hierarchical categories; clicking
  a category filters notes; drag-drop a note onto a category reassigns it;
  drag-drop a category onto another category nests it.
- Toggle between Tags and Categories panel via headers — only one expanded
  at a time, history-based back.
- Splitter resizes between sidebar and notes; sidebar honors `min=100`
  and `maxWidth: 80%`.
- Toolbar Breadcrumb — Categories panel shows "Categories > path > to >
  selected"; Tags panel shows "Tags > release > 1.0.1"; clicking a segment
  navigates.
- "Add Note" — primary button creates a new note at the top of the list.
- Search field — typing filters the notes; clicking the X clears the search;
  matched substrings render in `<strong>` (per `uikit/shared/highlight`)
  inside category/tag/title/comment/body.
- Note item — clicking gives focus; the dot turns blue, the line turns blue,
  the content overlay disappears, the toolbar appears. Mouse-leaving keeps
  the focus state; clicking outside (or on the deactivation area on the
  right edge) deactivates.
- Note item — hover shows the toolbar (category/tags/date/Expand/Delete);
  searching shows the toolbar regardless of hover.
- Note item — click "+" to add a tag → inline PathInput; pressing Enter or
  blurring with text adds the tag. Click an existing tag → inline
  PathInput; clearing it removes the tag; editing renames it. Click the
  category badge → inline PathInput.
- Note item — title input typing updates the title; bold style on done;
  clicking inside the editor focuses Monaco (or the alternative editor).
- Note item — drag the note indicator dot → the note is draggable; drop
  on a category in the sidebar reassigns its category.
- Note item — comment field shows on hover when empty (+ Add comment); when
  present, shows as ghost Textarea; clearing and blurring removes it.
- Note item — language menu (LanguageIcon button) opens; selecting a
  language updates the editor.
- Note item — for `JavaScript`/`TypeScript`, run-script + run-all-script
  buttons appear.
- Note item — SegmentedControl appears when alternative editors exist for
  the current language (e.g., grid-json for JSON).
- Note item — Expand opens the ExpandedNoteView overlay; Collapse / Esc
  returns to list.
- ExpandedNoteView — full-screen detail; same edit affordances; comment
  section at the bottom; Esc collapses (when no inline edit is active).
- Footer — shows `N notes` or `M of N notes`.
- Theme — light/dark themes render correctly.

## Acceptance criteria

- [ ] No `import styled from "@emotion/styled"` in any file under
      `src/renderer/editors/notebook/`.
- [ ] No imports from `components/basic|form|layout|overlay/` in any file
      under `src/renderer/editors/notebook/`. Both `Breadcrumb` and
      `CollapsiblePanelStack` are imported from `uikit/` (post US-516/517,
      both shipped).
- [ ] No imports from `components/TreeView` (replaced via UIKit Tree per C5).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test passes (see Test surface).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/notebook/NotebookEditor.tsx` | strip `styled.div`, swap Button/TextField/Splitter/CategoryTree/TagsList for UIKit equivalents (TagsListView local, Tree+helper local), re-import `HighlightedTextProvider` from `uikit/shared/highlight` (per C1) |
| `src/renderer/editors/notebook/NoteItemView.tsx` | strip `styled.div` (~270 lines), swap all primitives, add `useState` for focus/hover (per C14), `useHighlightedText()` + `highlight()` from `uikit/shared/highlight` |
| `src/renderer/editors/notebook/ExpandedNoteView.tsx` | strip `styled.div` (~218 lines), swap all primitives, consume `useHighlightedText()` from `uikit/shared/highlight` |
| `src/renderer/uikit/shared/highlight.ts` | **EXTENDED** — add `HighlightedTextProvider` + `useHighlightedText` (Context port from legacy `components/basic/useHighlightedText`, per C1) |
| `src/renderer/editors/notebook/note-editor/NoteItemToolbar.tsx` | strip styled, swap Button → IconButton, SwitchButtons → SegmentedControl, WithPopupMenu → WithMenu |
| `src/renderer/editors/notebook/note-editor/MiniTextEditor.tsx` | strip styled, plain `<div style={...}>` |
| `src/renderer/editors/notebook/TagsListView.tsx` | **NEW** — inline rewrite of `components/basic/TagsList` using UIKit Panel + plain HTML rows |
| `src/renderer/editors/notebook/category-tree.ts` | **NEW** — `buildCategoryTreeItems(categories, getSize)` helper |

## Files NOT changed

- `src/renderer/editors/notebook/NotebookViewModel.ts` — pure model.
- `src/renderer/editors/notebook/NoteItemViewModel.ts` — pure model.
- `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` — pure model.
- `src/renderer/editors/notebook/note-editor/NoteItemActiveEditor.tsx` — clean already.
- `src/renderer/editors/notebook/notebookTypes.ts` — types.
- `src/renderer/editors/notebook/index.ts` — re-exports only.
- `src/renderer/components/basic/Breadcrumb.tsx` — kept in place (the legacy stays until its other callers — LinkEditor, future CategoryEditor — migrate to UIKit Breadcrumb; epic-wide cleanup pass removes it).
- `src/renderer/components/layout/CollapsiblePanelStack.tsx` — kept in place (the legacy stays until LinkEditor and PageNavigator migrate; epic-wide cleanup pass removes it).
- `src/renderer/components/basic/useHighlightedText.tsx` — kept (other consumers still depend on it; Notebook drops its own usage and imports the parallel UIKit version from `uikit/shared/highlight` per C1).
- `src/renderer/components/basic/TagsList.tsx` — kept in place but no longer imported by Notebook (only consumer); will be removed at epic close per the epic-wide cleanup pass.
- `src/renderer/components/TreeView/*` — kept in place but no longer imported by Notebook (will be removed by **US-497** TreeProviderView migration when its other consumers are migrated).
- `src/renderer/components/virtualization/RenderGrid/*` — kept; not part of the legacy ban surface.
- All `src/renderer/uikit/` files — UIKit additions are NOT in scope for this task; this is a pure consumer migration.

## Open questions for the user

These items have a working answer in the plan, but the user may want to
adjust before implementation begins:

1. **C1 — `<strong>` vs. blue tint for highlight?** *(rendering only; the
   Context port is settled — keep `HighlightedTextProvider` /
   `useHighlightedText`, just imported from `uikit/shared/highlight`.)*
   The plan uses `uikit/shared/highlight()` which renders matches in
   `<strong>`. The legacy used a blue color span. If the visual delta
   matters, a small `notebook/highlight.tsx` wrapper can re-style the
   `<strong>` with `color: misc.blue`. Default in plan: accept the bold
   delta.

2. **C9 — search input text color?**
   Same call as US-499 C6: drop the legacy blue tint. Visual delta only.

3. **C14 — `:focus-within` cascade via React state?**
   The plan tracks `isFocused`/`isHovered` in component state and applies
   inline styles. Alternative: extend UIKit Panel with a
   `revealChildrenOnFocus` / `data-focus-within` cascade so the styling can
   be expressed via CSS. The Panel extension is its own task; it would
   simplify NoteItemView significantly. Recommend deferring the Panel
   extension and going with React-state.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- **Prerequisites (delivered):**
  - [US-516 UIKit Breadcrumb primitive](../US-516-uikit-breadcrumb/README.md)
  - [US-517 UIKit CollapsiblePanelStack primitive](../US-517-uikit-collapsible-panel-stack/README.md)
- Same-pattern precedent: [US-499 TodoEditor migration](../US-499-todoeditor-migration/README.md)
- UIKit primitives:
  - [US-470 Textarea](../US-470-uikit-textarea/README.md)
  - [US-471 Input + slots](../US-471-uikit-input-slots/README.md)
  - [US-474 PathInput](../US-474-uikit-pathinput/README.md)
  - [US-481 Menu / WithMenu](../US-481-uikit-menu-with-menu/README.md)
  - [US-485 Tree](../US-485-uikit-tree/README.md)
  - [US-486 Splitter](../US-486-uikit-splitter/README.md)
  - [US-488 Tree DnD](../US-488-uikit-tree-dnd/README.md)
  - [US-504 Ghost variants + hover-reveal](../US-504-uikit-ghost-and-hover-reveal/README.md)
  - US-518 ListBox `selectionStyle="accent"` (visual reference for C4 `TagsListView` custom renderer — filled selection background)
- Related deferred items: US-347 (Category Breadcrumb).
