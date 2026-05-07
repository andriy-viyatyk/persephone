# US-499: TodoEditor — UIKit migration

## Status

**Plan ready for implementation.** Prerequisite [US-504](../US-504-uikit-ghost-and-hover-reveal/README.md) — which added ghost `Input`/`Textarea` variants, Panel `revealChildrenOnHover`, and child `hideUntilParentHover` — is implemented and staged. This task is purely a per-screen rewrite of `editors/todo/`; no UIKit changes here.

Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Todo editor surface to UIKit primitives. After this task:

- No imports from `components/basic|form|layout|overlay/` in `src/renderer/editors/todo/`.
- No `import styled from "@emotion/styled"` in any `editors/todo/` file
  (Rule 7 strict — `editors/` does NOT get the chrome exception).
- All chrome layout uses `Panel`; all primitives use UIKit components.

## Background

### Files in scope

```
src/renderer/editors/todo/
  TodoEditor.tsx                     ← root view
  components/TodoListPanel.tsx       ← left-pane (lists + tags)
  components/TodoItemView.tsx        ← right-pane row
```

Each of the three files defines an Emotion `styled.div` block (~100, ~95, ~175
lines respectively) — about 370 lines of `styled.*` chrome to remove. The
primitive imports total: 4 × `Button`, 1 × `TextField` + 1 × `TextAreaField`,
1 × `Splitter`, 2 × `WithPopupMenu` + `MenuItem`, 1 × `HighlightedTextProvider`,
plus icon imports (kept).

### UIKit primitives used (verified in `src/renderer/uikit/`)

All required primitives exist in UIKit. Features added by US-504 are marked
🆕; everything else is already in place.

| Primitive | File | Notes |
|---|---|---|
| `Panel` | `uikit/Panel/Panel.tsx` | direction/gap/padding/border/flex/min/max — no className/style on UIKit components. 🆕 `revealChildrenOnHover` (US-504) |
| `Button` | `uikit/Button/Button.tsx` | variants default / ghost / link / etc. 🆕 `hideUntilParentHover` (US-504) |
| `IconButton` | `uikit/IconButton/IconButton.tsx` | size sm/md, supports `title` (tooltip). 🆕 `hideUntilParentHover` (US-504) |
| `Input` | `uikit/Input/Input.tsx` | size sm/md, `endSlot` (single ReactNode), `width`/`minWidth`/`maxWidth`. 🆕 `variant: "default" \| "ghost"` (US-504) |
| `Textarea` | `uikit/Textarea/Textarea.tsx` | spreads `{...rest}`, exposes `getText()`/`clear()`/`focus()` ref methods. 🆕 `variant: "default" \| "ghost"` (US-504) |
| `Splitter` | `uikit/Splitter/Splitter.tsx` | controlled `value`+`onChange`; prop mapping per US-492 |
| `WithMenu` / `Menu` | `uikit/Menu/WithMenu.tsx` + `Menu.tsx` | render-prop signature matches `WithPopupMenu` |
| `MenuItem` (type) | `uikit/Menu/types.ts` | re-exports the same canonical `api/types/events.MenuItem` that the legacy `PopupMenu` re-exports — type is identical, no field changes |
| `Dot` | `uikit/Dot/Dot.tsx` | colored circle — `size` named/numeric, `color` semantic/raw, `bordered`, `selected`, optional `onClick`. 🆕 `hideUntilParentHover` (US-504) |

### Component coverage check (do we have everything we need?)

**Coverage: yes — all primitives in place once US-504 lands.** No UIKit
changes happen in this task.

| Todo need | UIKit component | Coverage |
|---|---|---|
| Two-pane layout with resizable splitter | `Panel` + `Splitter` | ✅ full |
| Vertical column chrome (left panel sections, item right-col) | `Panel` direction/gap | ✅ full |
| Section labels ("Lists", "Tags") and subtitle text in empty states | plain `<div style={...}>` (one-off chrome) | ✅ full |
| Single-line "add list" / "add tag" / quick-add input — normal chrome | `Input` (default variant) | ✅ full |
| Single-line in-place title input — transparent chrome, focus-only border | `Textarea singleLine variant="ghost"` | ✅ full (via US-504) |
| Multi-line item comment — transparent chrome, hover/focus-only border | `Textarea variant="ghost"` | ✅ full (via US-504) |
| In-place rename input (list/tag) — transparent chrome | `Input variant="ghost"` | ✅ full (via US-504) |
| Search input with clear `×` end button | `Input endSlot` | ✅ full |
| Right-click / context menus on list/tag items | `WithMenu` + `MenuItem[]` | ✅ full |
| Tag color dots (8px), color swatch (14px clickable), color-picker menu icons (10px) | `Dot` | ✅ full |
| "No-color" tag indicator (small circle outline) | `Dot color="neutral"` | ✅ full |
| Action buttons that fade-in on parent hover (item-actions, drag-handle, dates, "+ Add comment", "+ tag") | `Panel revealChildrenOnHover` + `hideUntilParentHover` (UIKit) / `data-visibility="parent-hover"` (plain HTML) | ✅ full (via US-504) |
| Drag-and-drop reorder with trait-based DnD | plain `<div>` with handlers | ✅ full (DnD logic untouched) |
| Virtualized item grid (`RenderFlexGrid`) | `components/virtualization/RenderGrid` (NOT in `components/basic|form|layout|overlay/`, so out-of-scope per task definition) | ✅ stays |

## Concerns — resolved before implementation

### C1 — Hover-reveal cascades use US-504's CSS data-attribute pattern

**Concern.** Both `TodoItemView` and `TodoListPanel` lean on CSS `:hover`
parent-to-child cascades to fade in action buttons:

| File | Cascade | Children revealed |
|---|---|---|
| `TodoItemView` | `&:hover .item-actions` | delete `IconButton` |
| `TodoItemView` | `&:hover .drag-handle` | drag-handle icon |
| `TodoItemView` | `&:hover .add-comment-btn` | "+ Add comment" link |
| `TodoItemView` | `&:hover .add-tag-btn` | "+ tag" link |
| `TodoItemView` | `&:hover .item-dates` | created/done date |
| `TodoListPanel` | `.list-item:hover .list-actions` | rename + delete `IconButton`s (and color picker `Dot` for tags) |

Inline styles cannot express parent-hover-driven visibility, and Rule 7
forbids `styled.div` in app code (`editors/` is not the chrome exception).

**Resolution.** Use the US-504 hover-reveal pattern — pure CSS, no React state:

- Wrap the row in `<Panel revealChildrenOnHover ...>`.
- Mark UIKit children that should hide-by-default with `hideUntilParentHover`
  (`<IconButton hideUntilParentHover ...>`, `<Dot hideUntilParentHover ...>`).
- Mark plain HTML children that should hide-by-default with the data
  attribute directly (`<span data-visibility="parent-hover" ...>` on
  drag-handle, "+ Add comment", "+ tag", item-dates).

This preserves the current UX exactly (opacity fade, layout-stable, also
reveals on keyboard `:focus-within`). No `useState`, no
`onMouseEnter`/`onMouseLeave`, no per-row hover plumbing.

### C2 — Inline-edit ghost chrome via US-504's `Textarea variant="ghost"`

**Concern.** UIKit `Textarea` default chrome (dark bg, gray border) is wrong
for the title and comment fields, which are inline-edit controls living
inside a list row.

**Resolution.** Use `<Textarea variant="ghost" ...>` (added by US-504).
Behavior: transparent at rest, gray border on hover, blue border on focus —
matches the current title and comment fields (modulo a minor visual delta on
the title field, which today has no hover border; the new hover border is a
small discoverability win).

Item title additionally wraps in a plain `<div style={{ opacity: item.done ? 0.6 : 1 }}>` to preserve the `.title-input.done` dim. Rule 7 allows
inline styles on plain HTML elements (just not on UIKit components).

### C3 — Inline-edit ghost chrome via US-504's `Input variant="ghost"`

**Concern.** Rename mode in `TodoListPanel` currently uses a styled
`TextField` whose `& input` selector ties the bg to the row — an unstyled
UIKit `Input` would visually pop instead of feeling inline.

**Resolution.** Use `<Input variant="ghost" size="sm" ...>` (added by US-504)
for both list and tag rename inputs. `Input` forwards `ref` to
`HTMLInputElement`, so `.focus()` works as before.

### C4 — Quick-add input is uncontrolled in legacy code; UIKit `Textarea` is controlled

**Concern.** `TodoEditor.tsx` uses `quickAddRef` to read text via `getText()`
and clear via `clear()` after submit — the legacy `TextAreaField` is
uncontrolled. UIKit `Textarea` requires a `value` prop (controlled).

**Resolution.** Track quick-add text in TodoEditor local state:

```tsx
const [quickAddText, setQuickAddText] = useState("");

const handleQuickAdd = useCallback(() => {
    const trimmed = quickAddText.trim();
    if (trimmed) {
        vm.addItem(trimmed);
        setQuickAddText("");
    }
}, [vm, quickAddText]);

<Textarea
    value={quickAddText}
    onChange={setQuickAddText}
    singleLine
    onKeyDown={handleQuickAddKeyDown}
    placeholder={isQuickAddDisabled ? "Select a list to add items..." : "Add new todo item..."}
    readOnly={isQuickAddDisabled}
/>
```

`quickAddRef` and `TextAreaFieldRef` are dropped. Net: -1 ref, +1 useState.

### C5 — `HighlightedTextProvider` is dead code in the todo subtree

**Concern.** `TodoEditor.tsx` wraps `<HighlightedTextProvider value={pageState.searchText}>` around the center panel, but no descendant calls
`useHighlightedText()` or `highlightText()`. `TodoItemView` and
`TodoListPanel` neither import nor consume the context. The legacy
`TextAreaField` and `TextField` don't read it either (only `components/form/List.tsx` and `components/data-grid/DataCell.tsx` consume it).
The provider is a no-op wrapper inherited from earlier search work.

**Resolution.** Delete the import and the wrapper. The `searchText` filter
already drives `filteredItems` in the view model — items not matching are
already hidden, so missing in-row highlight isn't a regression. If row-level
highlight is wanted later, add it via a small `highlight()` call at the
title render site (UIKit ships `uikit/shared/highlight.ts` for this).

### C6 — Search field `endButtons` (legacy array) → `endSlot` (single ReactNode)

**Concern.** Today's search field uses `endButtons={[<Button .../>]}` (array).
UIKit `Input.endSlot` is a single `ReactNode`.

**Resolution.** The Todo search has exactly one end button (Clear). Direct
swap:

```tsx
<Input
    value={pageState.searchText}
    onChange={vm.setSearchText}
    placeholder="Search..."
    endSlot={pageState.searchText
        ? <IconButton size="sm" icon={<CloseIcon />} title="Clear search" onClick={vm.clearSearch} />
        : null
    }
/>
```

The legacy code used `<SearchField>` styled extension to color the input text
blue (`& input { color: color.misc.blue }`). UIKit Input forbids
`styled(Input)` (Rule 7: no Emotion in app code, no `style`/`className` on
UIKit). Two options:

- **A — accept the visual delta.** Search input text uses default `color.text.dark`. Functional, slightly less prominent.
- **B — extend Input.** Add a `tone` or `color` prop. Out-of-scope; only one site uses this today.

**Decision: A.** No UIKit change for one-off colored search text.

### C7 — `Splitter` prop mapping (per US-492)

Direct mapping:

| Old | New |
|---|---|
| `type="vertical"` | `orientation="vertical"` |
| `initialWidth={pageState.leftPanelWidth}` | `value={pageState.leftPanelWidth}` (already controlled in VM) |
| `onChangeWidth={vm.setLeftPanelWidth}` | `onChange={vm.setLeftPanelWidth}` |
| `borderSized="right"` | `border="after"` |

Add `min={100}` (legacy used `minWidth: 100, maxWidth: "80%"` on the panel
itself, not on the splitter — keep those constraints on the panel via
`maxWidth="80%"` — Panel supports string width values).

### C8 — `WithPopupMenu` → `WithMenu` (render-prop callback rename)

Render-prop signatures match exactly. The legacy callback name is `openMenu`,
the UIKit one is `setOpen`. Both accept `Element | null`. Direct rename.

```tsx
// before
<WithPopupMenu items={tagMenuItems}>
    {(openMenu) => (
        <span onClick={(e) => { e.stopPropagation(); openMenu(e.currentTarget); }}>
            …
        </span>
    )}
</WithPopupMenu>

// after
<WithMenu items={tagMenuItems}>
    {(setOpen) => (
        <span onClick={(e) => { e.stopPropagation(); setOpen(e.currentTarget); }}>
            …
        </span>
    )}
</WithMenu>
```

`MenuItem[]` type re-exports the same canonical `api/types/events.MenuItem`
that legacy `PopupMenu` re-exports — no field changes anywhere.

### C9 — `Dot` mappings

| Site | Today | After |
|---|---|---|
| Tag dot in left panel (8px) | `<span className="tag-dot" style={{ backgroundColor }} />` | `<Dot size="sm" color={tag.color} />` |
| No-color tag indicator (8px outline) | `<CircleIcon style={{ width: 8, height: 8, opacity: 0.3 }} />` | `<Dot size="sm" color="neutral" />` |
| Color swatch button content (14px, clickable, hover-revealed) | `<Button><span className="color-swatch" style={{ backgroundColor }} /></Button>` | `<Dot size={14} color={tag.color || color.text.light} bordered hideUntilParentHover onClick={(e) => setOpen(e.currentTarget)} title="Change color" />` (Dot owns the click — drop the wrapping Button) |
| Color-picker menu item icon (10px) | inline `<span style={{ width: 10, height: 10, … }} />` | `<Dot size={10} color={c.hex} />` |
| Item-row tag-badge dot (8px next to tag name) | `<span className="tag-dot" style={{ backgroundColor }} />` | `<Dot size="sm" color={tagDef.color} />` |

### C10 — Title and comment "done" / disabled visual state

`.title-input.done` applies `opacity: 0.6` when `item.done`. UIKit `Textarea`
exposes `disabled` (which dims the field) but the title field is still
editable when done — we don't want the input pointer-events disabled. Apply
the dim via `style={{ opacity: 0.6 }}` directly on a wrapping plain `<div>`
— Rule 7 allows inline styles on plain HTML elements, just not on UIKit
components.

### C11 — Files that need NO changes

- `src/renderer/editors/todo/TodoViewModel.ts` — already exposes
  `setSearchText`, `clearSearch`, `setSelectedList`, `setSelectedTag`,
  `setLeftPanelWidth`, `setItemHeight`, `getItemHeight`, `addItem`,
  `addList`, `renameList`, `deleteList`, `addTag`, `renameTag`, `deleteTag`,
  `updateTagColor`, `setItemTag`, `toggleItem`, `updateItemTitle`,
  `updateItemComment`, `addComment`, `removeComment`, `deleteItem`,
  `moveItem`. Imports may shift to type-only if the model no longer needs
  to import legacy components, but the file is logic-only — no edits.
- `src/renderer/editors/todo/todoTypes.ts` — type-only, untouched.
- `src/renderer/editors/todo/todoColors.ts` — `TAG_COLORS` palette, untouched.
- `src/renderer/components/basic/*`, `components/overlay/*` — left in place
  per epic policy (no removal until full migration done).
- `src/renderer/components/virtualization/RenderGrid/*` — kept; not part of
  the `components/basic|form|layout|overlay/` ban surface.
- All UIKit files — untouched in this task. UIKit additions live in US-504.

## Implementation plan

**Prerequisite:** [US-504](../US-504-uikit-ghost-and-hover-reveal/README.md)
must be merged before starting Step 1. After US-504 lands, this task is
purely a per-screen rewrite touching only `editors/todo/`.

### Step 1 — Migrate `TodoEditor.tsx`

File: `src/renderer/editors/todo/TodoEditor.tsx`

1. Replace the import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../components/basic/Button";
   import { TextField } from "../../components/basic/TextField";
   import { TextAreaField, TextAreaFieldRef } from "../../components/basic/TextAreaField";
   import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
   import { Splitter } from "../../components/layout/Splitter";

   // add
   import { Panel } from "../../uikit/Panel/Panel";
   import { Input } from "../../uikit/Input/Input";
   import { Textarea } from "../../uikit/Textarea/Textarea";
   import { IconButton } from "../../uikit/IconButton/IconButton";
   import { Splitter } from "../../uikit/Splitter/Splitter";
   ```
2. Delete `TodoEditorRoot` and `SearchField` styled-components blocks (the entire
   ~100 lines of CSS-in-JS).
3. Convert the search portal:
   ```tsx
   <Input
       value={pageState.searchText}
       onChange={vm.setSearchText}
       placeholder="Search..."
       endSlot={pageState.searchText
           ? <IconButton size="sm" icon={<CloseIcon />} title="Clear search" onClick={vm.clearSearch} />
           : null}
   />
   ```
4. Replace `<TodoEditorRoot>` with `<Panel direction="row" flex="1 1 auto" overflow="hidden">`.
5. Left panel: `<Panel direction="column" minWidth={100} maxWidth="80%" overflow="hidden" background="default" width={pageState.leftPanelWidth}>` — Panel supports string `maxWidth`.
6. Splitter:
   ```tsx
   <Splitter
       orientation="vertical"
       value={pageState.leftPanelWidth}
       onChange={vm.setLeftPanelWidth}
       border="after"
       min={100}
   />
   ```
7. Drop `<HighlightedTextProvider>` wrapper (per C5). Replace with the center
   panel directly: `<Panel direction="column" flex="1 1 auto" overflow="hidden">`.
8. Quick-add row → `<Panel direction="row" gap="xs" paddingX="sm" paddingY="xs" align="center" shrink={false}>` containing:
   - `<Textarea value={quickAddText} onChange={setQuickAddText} singleLine onKeyDown={handleQuickAddKeyDown} placeholder readOnly={isQuickAddDisabled} />` *(default variant — quick-add is a normal-chrome input, not inline-edit)*
   - `<IconButton size="sm" icon={<PlusIcon />} title="Add item" onClick={handleQuickAdd} disabled={isQuickAddDisabled} />`
9. Empty-state and "no match" panels → plain `<div style={...}>` — these are
   one-off centered chrome blocks; inline-style on plain HTML is Rule 7
   compliant.
10. `<RenderFlexGrid>` block — untouched (not part of the legacy ban set).
11. Footer portal — untouched (`<span>{count}</span>`).
12. Remove `quickAddRef` and `TextAreaFieldRef` import; add `useState` for
    `quickAddText`.
13. Verify the file no longer imports from `components/basic|form|layout|overlay/` and has no `import styled from "@emotion/styled"`.

### Step 2 — Migrate `TodoListPanel.tsx`

File: `src/renderer/editors/todo/components/TodoListPanel.tsx`

1. Replace the import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../../components/basic/Button";
   import { TextField } from "../../../components/basic/TextField";
   import { WithPopupMenu } from "../../../components/overlay/WithPopupMenu";
   import { MenuItem } from "../../../components/overlay/PopupMenu";

   // add
   import { Panel } from "../../../uikit/Panel/Panel";
   import { Input } from "../../../uikit/Input/Input";
   import { IconButton } from "../../../uikit/IconButton/IconButton";
   import { WithMenu } from "../../../uikit/Menu/WithMenu";
   import { Dot } from "../../../uikit/Dot/Dot";
   import type { MenuItem } from "../../../uikit/Menu/types";
   ```
2. Delete `TodoListPanelRoot` styled block.
3. Add-list row (top): `<Panel direction="row" gap="xs" paddingX="sm" paddingY="xs" align="center" shrink={false}>` containing `<Input value={newListName} onChange={setNewListName} onKeyDown={handleAddListKeyDown} placeholder="New list..." />` and `<IconButton size="sm" icon={<PlusIcon />} title="Add list" onClick={handleAddList} disabled={!newListName.trim()} />`.
4. Section labels → plain `<div style={{ fontSize: 13, color: color.text.light, opacity: 0.6, padding: "6px 8px 2px", textTransform: "uppercase", textAlign: "center" }}>`.
5. List rows — each row is a small plain `<div>` (owns hover/selected background via React state) wrapping a `<Panel>` (owns flex layout + hover-reveal of action buttons). Per C12:

   ```tsx
   <div
       onMouseEnter={() => setHovered(true)}
       onMouseLeave={() => setHovered(false)}
       onClick={() => vm.setSelectedList(listName)}
       style={{
           cursor: "pointer",
           backgroundColor: selected
               ? color.background.selection
               : hovered
                   ? color.background.light
                   : "transparent",
       }}
   >
       <Panel direction="row" align="center" gap="xs" paddingX="sm" minHeight={28} revealChildrenOnHover>
           {/* row content with `hideUntilParentHover` IconButtons + Dot */}
       </Panel>
   </div>
   ```

   Each row owns one `useState<boolean>` for `hovered` (background only — action-button reveal is pure CSS). `selected` is drilled in from props.
6. Inside each list row's content area: `<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ... }}>{listName}</span>`.
7. Action buttons revealed on hover: `<IconButton hideUntilParentHover size="sm" icon={<RenameIcon />} title="Rename list" onClick={(e) => handleStartListRename(e, listName)} />` and the matching delete button.
8. List count: plain `<span style={{ flexShrink: 0, fontSize: 11, opacity: 0.7 }}>{renderCount(listCounts[listName])}</span>`.
9. Rename mode (when `renamingList === listName`): `<Input variant="ghost" size="sm" ref={renameListInputRef} value={renameListValue} onChange={setRenameListValue} onKeyDown={handleListRenameKeyDown} onBlur={handleListRenameSubmit} onClick={(e) => e.stopPropagation()} />`. Forwards `ref` to `HTMLInputElement`, so `.focus()` works.
10. Tag rows mirror list rows. Color-picker trigger: `<Dot size={14} bordered hideUntilParentHover color={tag.color || color.text.light} onClick={(e) => { e.stopPropagation(); setOpen(e.currentTarget); }} title="Change color" />` — Dot owns the click, no wrapping Button.
11. "No color" leading dot: `<Dot size="sm" color="neutral" />`.
12. `getColorMenuItems` — replace inline `<span style={{ width: 10, height: 10, ... }} />` with `<Dot size={10} color={c.hex} />`.
13. Add-tag row (bottom) — same shape as add-list row.
14. Verify no imports from `components/basic|form|layout|overlay/` and no
    `import styled from "@emotion/styled"`.

### C12 — Row hover background + selected background (Panel doesn't expose these)

**Concern.** Each list/tag row needs three things: flex layout, action-button
reveal on hover, and a row-wide background color that switches between
transparent / hover / selected. Panel covers the first two via
`revealChildrenOnHover` (US-504), but doesn't expose `hoverBackground` /
`selectedBackground` props.

**Decision.** Wrap each `<Panel revealChildrenOnHover>` in a small plain
`<div>` that owns the row background. Plain HTML allows `style={...}` (Rule
7 forbids it only on UIKit components), so the wrapper sets `cursor`,
`backgroundColor`, and the `onClick` for selection. Each row carries one
`useState<boolean>` for `hovered`, set via `onMouseEnter`/`onMouseLeave` —
used only for the background color, not for action-button visibility (those
still reveal via Panel's pure-CSS rule, per C1).

This keeps the hover-reveal plumbing minimal: zero React state per child
button, one `useState` per row for background only. A future task may add
`hoverBackground`/`selectedBackground` props to Panel and remove the
wrapping div — out of scope here.

### Step 3 — Migrate `TodoItemView.tsx`

File: `src/renderer/editors/todo/components/TodoItemView.tsx`

1. Replace the import block:
   ```tsx
   // remove
   import styled from "@emotion/styled";
   import { Button } from "../../../components/basic/Button";
   import { TextAreaField } from "../../../components/basic/TextAreaField";
   import { WithPopupMenu } from "../../../components/overlay/WithPopupMenu";
   import { MenuItem } from "../../../components/overlay/PopupMenu";

   // add
   import { Panel } from "../../../uikit/Panel/Panel";
   import { Textarea } from "../../../uikit/Textarea/Textarea";
   import { IconButton } from "../../../uikit/IconButton/IconButton";
   import { WithMenu } from "../../../uikit/Menu/WithMenu";
   import { Dot } from "../../../uikit/Dot/Dot";
   import type { MenuItem } from "../../../uikit/Menu/types";
   ```
2. Delete `TodoItemRoot` styled block (~175 lines).
3. Root: outer plain `<div>` owns the drag visual states (`isDragging` → `opacity: 0.4`; `isOver` → `backgroundColor: color.background.light`) plus the DnD ref/handlers; inner `<Panel revealChildrenOnHover>` owns the row layout + hover-reveal of action buttons. Panel forbids `style`/`className`, so the drag visuals can't go directly on it.

   ```tsx
   <div
       ref={setNodeRef}
       onDragEnter={...}
       onDragOver={...}
       onDragLeave={...}
       onDrop={...}
       style={{
           opacity: isDragging ? 0.4 : 1,
           backgroundColor: isOver ? color.background.light : undefined,
       }}
   >
       <Panel
           revealChildrenOnHover
           position="relative"
           width="100%"
           paddingTop="xs"
           paddingBottom="xs"
           paddingLeft="xxxl"
           paddingRight="sm"
       >
           {/* checkbox col, two-col content, item-actions */}
       </Panel>
   </div>
   ```

   The drag-handle lives inside Panel and reveals on Panel hover via `data-visibility="parent-hover"` — independent of the outer drag wrapper.

4. Checkbox col: plain `<div style={{ position: "absolute", left: 8, top: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>` containing the checkbox `<span>` and (when `isDraggable`) the drag-handle `<span data-visibility="parent-hover" style={{ cursor: "grab", color: color.icon.light }} draggable onDragStart onDragEnd>`.
5. Two-col content: `<Panel direction="row" gap="sm" minHeight={26}>`.
6. Title input wrapped in plain `<div style={{ opacity: item.done ? 0.6 : 1, flex: 1, minWidth: 0 }}>`:
   ```tsx
   <Textarea
       variant="ghost"
       singleLine
       value={item.title}
       onChange={handleTitleChange}
       onKeyDown={handleTitleKeyDown}
       placeholder="(untitled)"
   />
   ```
7. Comment field:
   ```tsx
   item.comment !== null
       ? <Textarea variant="ghost" value={item.comment} onChange={handleCommentChange} onBlur={handleCommentBlur} placeholder="Add a comment..." maxHeight={120} />
       : <span data-visibility="parent-hover" style={{ fontSize: 11, cursor: "pointer", color: color.text.light }} onClick={handleAddComment}>+ Add comment</span>
   ```
   The "+ Add comment" affordance reveals at full opacity on row hover (Panel's `revealChildrenOnHover` toggles `data-visibility="parent-hover"` from `opacity: 0` to `opacity: 1`). Legacy used a 0.5 baseline that would require a second wrapping span to layer with the parent-hover toggle — not worth it; the small visual delta is acceptable.
8. Right column: `<Panel direction="column" align="end" minWidth={100} shrink={false}>`.
9. Right top: `<Panel direction="row" align="center" gap="xs" alignSelf="stretch">`.
10. Tag section — `<WithMenu items={tagMenuItems}>` with the render-prop content adapted: `(setOpen) => item.tag ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: color.text.light }} onClick={(e) => { e.stopPropagation(); setOpen(e.currentTarget); }}><Dot size="sm" color={tagDef?.color ?? "neutral"} />{item.tag}</span> : <span data-visibility="parent-hover" style={{ fontSize: 11, cursor: "pointer", color: color.text.light }} onClick={(e) => { e.stopPropagation(); setOpen(e.currentTarget); }}>+ tag</span>`.
11. Item-actions (delete): `<IconButton hideUntilParentHover size="sm" icon={<DeleteIcon />} title="Delete item" onClick={handleDelete} />`.
12. Item dates: `<span data-visibility="parent-hover" style={{ fontSize: 11, color: color.text.light, whiteSpace: "nowrap", height: 20, lineHeight: "20px", alignSelf: "flex-start" }} title={...}>{dateInfo}</span>`.
13. `tagMenuItems` MenuItem icon: replace inline `<span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: tag.color }} />` with `<Dot size="sm" color={tag.color} />`.
14. Verify no imports from `components/basic|form|layout|overlay/` and no
    `import styled from "@emotion/styled"`.

### Step 4 — Verify

1. `npx tsc --noEmit` — no new type errors.
2. `npm run lint` — clean.
3. Manual smoke test (see Test surface below).
4. Confirm zero matches for ban-list imports:
   ```bash
   grep -rE "components/(basic|form|layout|overlay)" src/renderer/editors/todo/
   grep -rE "from \"@emotion/styled\"" src/renderer/editors/todo/
   ```
   Both must return no matches.

## Test surface (manual smoke)

- Two-pane layout resizes via Splitter; left panel obeys `min=100` and `maxWidth: 80%`.
- Search input shows clear `×` button only when text is present; clicking clears.
- Quick-add: typing + Enter adds an item; pressing Enter on an empty/whitespace
  input is a no-op; "Select a list to add items..." placeholder appears with
  no list selected; the input is read-only in that case.
- Add list / add tag rows: button disabled until trimmed text is non-empty;
  Enter submits; field clears on success.
- Selecting "All", a named list, "All Tags", a named tag — toggles
  `pageState.selectedList` / `selectedTag` correctly.
- List rename: rename `IconButton` enters edit mode → ghost `Input` appears
  in place of the row text → blur or Enter commits; Esc cancels. Same for
  tag rename.
- Tag color swatch: the 14px Dot appears on row hover; clicking opens the
  color-picker menu; "No color" item clears `tag.color`; selecting a color
  updates the swatch.
- Hover state: list-actions (rename/delete) appear only on row hover;
  tag color-swatch appears on row hover; item delete + dates + drag-handle
  appear only on item hover; "+ Add comment" appears on item hover. Keyboard
  focus also reveals these (via `:focus-within` from US-504).
- Row background: hover bg appears on each list/tag row; selected bg persists
  on the active list/tag.
- Item title: ghost chrome at rest → hover border → blue border on focus →
  typing updates `item.title`; Enter / Esc blurs. Done items render at
  60% opacity.
- Item comment: clicking "+ Add comment" reveals a multi-line ghost Textarea;
  blurring with empty text removes the comment.
- Item tag: "+ tag" or current-tag badge opens the tag menu; selecting "No
  tag" clears the assignment.
- Item delete: trash IconButton (hidden until row hover) removes the item.
- Drag-and-drop: undone items are draggable; dropping reorders within the
  current filter; trying to drop a done item over an undone item is blocked
  (existing VM behavior); drag visuals (`opacity: 0.4` on dragging,
  `backgroundColor` on hover-target) work.
- Done separator: appears between undone and done sections; updating an
  item's `done` flips it to/from the bottom group; the separator hides when
  one of the groups is empty.
- Footer: shows `N items` or `M of N items` based on filter.
- Theme switch: light/dark themes render correctly (no hard-coded colors).

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in any file
      under `src/renderer/editors/todo/`.
- [ ] No `import styled from "@emotion/styled"` in any file under
      `src/renderer/editors/todo/`.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke test passes (see Test surface).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/todo/TodoEditor.tsx` | strip `styled.div`, swap Button/TextField/TextAreaField/Splitter for UIKit, drop `HighlightedTextProvider`, controlled quick-add |
| `src/renderer/editors/todo/components/TodoListPanel.tsx` | strip `styled.div`, swap Button/TextField/WithPopupMenu for UIKit, hover-reveal via Panel + `hideUntilParentHover` / `data-visibility`, swap color circles for `Dot`, ghost `Input` for rename |
| `src/renderer/editors/todo/components/TodoItemView.tsx` | strip `styled.div`, swap Button/TextAreaField/WithPopupMenu for UIKit, hover-reveal via Panel + `hideUntilParentHover` / `data-visibility`, swap tag dots for `Dot`, ghost `Textarea` for title/comment |

## Files NOT changed

- `src/renderer/editors/todo/TodoViewModel.ts` — already exposes everything the view needs.
- `src/renderer/editors/todo/todoTypes.ts` — type-only.
- `src/renderer/editors/todo/todoColors.ts` — palette data.
- `src/renderer/components/basic/*`, `components/overlay/*`, `components/layout/Splitter` — left in place (epic-wide cleanup happens after all migrations).
- `src/renderer/components/virtualization/RenderGrid/*` — virtualized grid stays; not part of the legacy ban surface.
- All `src/renderer/uikit/` files — UIKit additions live in US-504, not here.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- **Blocked on:** [US-504 UIKit ghost variants + hover-reveal](../US-504-uikit-ghost-and-hover-reveal/README.md)
- Related primitives: [US-503 Dot](../US-503-uikit-dot/README.md), [US-486 Splitter](../US-486-uikit-splitter/README.md), [US-481 Menu](../US-481-uikit-menu-with-menu/README.md)
- Same-pattern precedent: [US-498 Settings page migration](../US-498-settings-page-migration/README.md)
