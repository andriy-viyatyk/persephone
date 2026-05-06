# US-496: ToolsEditorsPanel — UIKit migration

## Status

**Active** — part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen
migration. Together with US-495, this completes the Sidebar's panel-level
UIKit migration and unblocks US-492 (final integration testing).

## Goal

Migrate `ToolsEditorsPanel.tsx` to use UIKit primitives (`ListBox`,
`SectionItem`, `IconButton`, traits) for **all chrome where UIKit fits**, and
keep one small Emotion `styled.div` (~20 lines) for the row chrome that UIKit
does not express (hover background, drag-state visuals, visibility-on-hover
for the pin button). The drag handle "⋮⋮" glyph is **dropped** — pinned and
unpinned rows now share the same icon-first left edge and the whole pinned
row remains draggable.

After this task, all four list-style sidebar surfaces (FileList, OpenTabsList,
MenuBar left rail, ToolsEditorsPanel) consistently use `ListBox` with traits
+ optional `renderItem`.

## Background

### Current implementation (pre-migration)

`ToolsEditorsPanel.tsx` renders **two manually-constructed sections**:

1. **Pinned** — draggable `<div className="item-row">` rows with a
   "drag-handle" `<span>⋮⋮</span>` glyph, icon, label, and a filled-pin
   `<span onClick title>` button. Drag-reorder uses live `onDragOver` to swap
   positions in the `pinned-editors` setting via `onMove(dragIndex,
   hoverIndex)` and a module-level mutable index
   (`draggingPinnedEditorIndex`).
2. **All Editors & Tools** — non-draggable `<div>` rows with icon, label, and
   an outline-pin `<span onClick title>` button.

A `<div className="separator" />` sits between the two sections when both are
non-empty.

### Target structure (post-migration)

```
<ListBox<RowSource>                  ← UIKit (root, includes data-type="list-box")
  items={tRows}                       ← traited; mixes section markers + CreatableItem
  rowHeight={28}
  onChange={…}
  renderItem={(ctx) => …}
>
  ┌─ <SectionItem label="Pinned"> ─────────────┐  ← UIKit, auto-rendered for sections
  ├─ <RowStyled draggable data-dragging=… data-drag-over=…>  ← chrome-exception Emotion
  │     <span className="item-icon">{icon}</span>
  │     <span className="item-label">{label}</span>
  │     <span className="pin-button-wrapper">
  │       <IconButton size="sm" icon={<PinFilledIcon />} title="Unpin" onClick={…} />
  │                                              ← UIKit for the pin button
  │     </span>
  │  </RowStyled>
  ├─ … more pinned rows …
  ├─ <SectionItem label="All Editors & Tools">  ← UIKit, auto-rendered
  ├─ <RowStyled> (no drag, outline pin)         ← same chrome, simpler
  └─ … more unpinned rows …
```

### Why ListBox (consistency win)

All other list-style surfaces in the sidebar already use `ListBox`:

| Surface | Items | Sections |
|---------|-------|----------|
| RecentFileList → FileList | files | — |
| OpenTabsList | pages | per-window section rows |
| MenuBar left rail | folders | static + custom |
| **ToolsEditorsPanel** *(this task)* | creatable items | Pinned / All |

Same primitive, same trait pattern, same keyboard-nav surface. Section
support is provided directly by `ListBox` — the `<Divider />` between
sections in the current implementation goes away because `<SectionItem>`
itself is the visual division.

### What stays Emotion (chrome exception, justified)

A single `RowStyled = styled.div(...)` block (~20 lines) inside
`ToolsEditorsPanel.tsx`. It owns:

- **Layout** — flex, gap, padding (5px 12px doesn't match a token, kept as-is).
- **`cursor: pointer`** — UIKit `Panel` has no `cursor` prop, and `ListItem`'s
  hover behavior depends on ListBox's active-tracking (which we're not using).
- **Hover background** — same reason as cursor.
- **`&[data-dragging]` opacity** — no UIKit primitive exposes drag-state visuals.
- **`&[data-drag-over]` borderTop** — no UIKit primitive exposes drag-over visuals.
- **Visibility-on-hover** for the pin button (`& .pin-button-wrapper`
  default `opacity: 0` → `1` on row hover) — required to avoid showing a
  pin/unpin button on every row at all times (clutter).

Per Rule 7 chrome exception, this is allowed in `src/renderer/ui/sidebar/`.
Justification: every reason for keeping Emotion here is a behavior
that UIKit primitives genuinely don't express, not a styling preference.

### What gets dropped

- **Drag handle "⋮⋮" glyph** — was a leading slot only on pinned rows. Causes
  pinned/unpinned rows to start at different left edges, creating visual
  asymmetry. The whole pinned row is `draggable` — user grabs the row body
  to drag. Drag-and-drop works exactly the same; only the visual hint is
  gone.
- **`<div className="separator" />`** — sections do the visual division.
- **Module-level `let draggingPinnedEditorIndex = -1`** — preserved verbatim.
  Moves with the file.

### DnD infrastructure (preserved verbatim)

- `TraitTypeId.PinnedEditor` already registered.
- `setTraitDragData(e.dataTransfer, TraitTypeId.PinnedEditor, { index })` on
  drag start.
- `hasTraitDragData(e.dataTransfer)` on dragEnter / dragOver.
- Live reorder via `onMove(dragIndex, hoverIndex)` updates settings + ref
  during dragOver.

### ListBox internal behavior (relevant facts)

From `ListBoxModel.ts`:

- **`onItemClick(idx)`** fires `onChange(source)` on non-section non-disabled
  rows. Sections are skipped automatically.
- **`onItemMouseEnter(idx)`** calls `onActiveChange?.(idx)` — **no-op when
  `onActiveChange` is not provided**. We don't pass it, so mouse-enter
  tracking is inert. No interference with our drag handlers.
- **Sections** render via `<SectionItem>` automatically when `item.section
  === true`. The wrapper for section rows has **no** `onClick` — sections are
  inert. ✓
- **Custom `renderItem`** — when supplied, its return value is rendered
  inside ListBox's wrapper `<div>` which carries `onClick` /
  `onContextMenu`. Drag handlers attached to our renderItem content fire
  normally (browser drag events are independent of the wrapper's mouse
  handlers).

### Files NOT changed in this task

- `src/renderer/ui/sidebar/tools-editors-registry.ts` — unchanged.
- `src/renderer/api/settings.ts` — `pinned-editors` key unchanged.
- `src/renderer/core/traits/TraitRegistry.ts` — `TraitTypeId.PinnedEditor`
  already exists.
- `src/renderer/ui/sidebar/MenuBar.tsx` — `ToolsEditorsPanel`'s prop surface
  is unchanged.
- `src/renderer/theme/icons.tsx` — `PinIcon` / `PinFilledIcon` unchanged.
- `src/renderer/uikit/**` — **no UIKit changes** required.

### Rules that apply

- **Rule 1 (`data-*` for state)** — row uses `data-dragging` / `data-drag-over`.
  Root ListBox already carries `data-type="list-box"`.
- **Rule 7 (no Emotion outside UIKit, with chrome exception for sidebar)** —
  the single `RowStyled` block falls under the chrome exception with the
  justification above.

## Implementation plan

### Step 1 — Define the row source type and section markers

In `ToolsEditorsPanel.tsx`:

```ts
type SectionMarker = { kind: "section"; label: string };
type RowSource = CreatableItem | SectionMarker;

const isSection = (x: RowSource): x is SectionMarker =>
    "kind" in x && x.kind === "section";
```

### Step 2 — Trait that distinguishes sections from rows

```ts
const rowTraits = new TraitSet().add(LIST_ITEM_KEY, {
    value: (item) => {
        const it = item as RowSource;
        return isSection(it) ? `section-${it.label}` : it.id;
    },
    label: (item) => (item as RowSource).label,
    icon: (item) => {
        const it = item as RowSource;
        return isSection(it) ? undefined : it.icon;
    },
    section: (item) => isSection(item as RowSource),
});
```

### Step 3 — Build the flat items array

```ts
const allRows = useMemo<RowSource[]>(() => {
    const out: RowSource[] = [];
    if (pinnedItems.length > 0) {
        out.push({ kind: "section", label: "Pinned" });
        out.push(...pinnedItems);
    }
    if (unpinnedItems.length > 0) {
        out.push({ kind: "section", label: "All Editors & Tools" });
        out.push(...unpinnedItems);
    }
    return out;
}, [pinnedItems, unpinnedItems]);

const tRows = useMemo(() => traited(allRows, rowTraits), [allRows]);
```

### Step 4 — Define `RowStyled` (chrome exception)

```ts
const RowStyled = styled.div({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px",
    cursor: "pointer",
    color: color.text.default,
    fontSize: 13,
    "&:hover":             { background: color.background.light },
    "&[data-dragging]":    { opacity: 0.4 },
    "&[data-drag-over]":   { borderTop: `2px solid ${color.border.active}` },

    "& .item-label": {
        flex: "1 1 auto",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .item-icon": {
        display: "inline-flex",
        width: 18,
        height: 18,
        flexShrink: 0,
        "& svg": { width: 16, height: 16 },
    },

    "& .pin-button-wrapper":       { display: "inline-flex", opacity: 0, flexShrink: 0 },
    "&:hover .pin-button-wrapper": { opacity: 1 },
}, { label: "ToolsEditorsRow" });
```

### Step 5 — `PinnedRow` and `UnpinnedRow`

Both render `RowStyled` with the same shape. Differences: `PinnedRow` has
`draggable`, drag handlers, and uses `<PinFilledIcon />`; `UnpinnedRow` has
none of that and uses `<PinIcon />`.

```tsx
function PinnedRow({ item, index, onUnpin, onMove }: {
    item: CreatableItem;
    index: number;
    onUnpin: (id: string) => void;
    onMove: (dragIndex: number, hoverIndex: number) => void;
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    const handleDragStart = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        draggingPinnedEditorIndex = index;
        setTraitDragData(e.dataTransfer, TraitTypeId.PinnedEditor, { index });
        setIsDragging(true);
    }, [index]);

    const handleDragEnd = useCallback(() => {
        draggingPinnedEditorIndex = -1;
        setIsDragging(false);
        setIsOver(false);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (hasTraitDragData(e.dataTransfer) &&
            draggingPinnedEditorIndex >= 0 &&
            draggingPinnedEditorIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsOver(true);
        }
    }, [index]);

    // Live reorder during dragOver — matches React-DnD's hover() behavior
    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (draggingPinnedEditorIndex >= 0 && draggingPinnedEditorIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onMove(draggingPinnedEditorIndex, index);
            draggingPinnedEditorIndex = index;
        }
    }, [index, onMove]);

    const handleDragLeave = useCallback(() => setIsOver(false), []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
    }, []);

    const handleUnpin = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onUnpin(item.id);
    }, [onUnpin, item.id]);

    return (
        <RowStyled
            data-type="tools-editor-row"
            data-dragging={isDragging || undefined}
            data-drag-over={isOver || undefined}
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <span className="item-icon">{item.icon}</span>
            <span className="item-label">{item.label}</span>
            <span className="pin-button-wrapper">
                <IconButton
                    size="sm"
                    icon={<PinFilledIcon />}
                    title="Unpin"
                    onClick={handleUnpin}
                />
            </span>
        </RowStyled>
    );
}

function UnpinnedRow({ item, onPin }: {
    item: CreatableItem;
    onPin: (id: string) => void;
}) {
    const handlePin = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onPin(item.id);
    }, [onPin, item.id]);

    return (
        <RowStyled data-type="tools-editor-row">
            <span className="item-icon">{item.icon}</span>
            <span className="item-label">{item.label}</span>
            <span className="pin-button-wrapper">
                <IconButton
                    size="sm"
                    icon={<PinIcon />}
                    title="Pin to menu"
                    onClick={handlePin}
                />
            </span>
        </RowStyled>
    );
}
```

### Step 6 — Replace the panel body with ListBox

```tsx
return (
    <ListBox<RowSource>
        items={tRows}
        rowHeight={28}
        onChange={(source) => {
            if (!isSection(source)) {
                source.create();
                onClose?.();
            }
        }}
        renderItem={(ctx) => {
            if (isSection(ctx.source)) return null;  // sections rendered by ListBox
            const src = ctx.source;
            const pIdx = pinnedItems.indexOf(src);
            return pIdx >= 0
                ? <PinnedRow item={src} index={pIdx} onUnpin={handleUnpin} onMove={handleMove} />
                : <UnpinnedRow item={src} onPin={handlePin} />;
        }}
    />
);
```

Note: `renderItem` returning `null` for sections is safe because ListBox
short-circuits and renders `<SectionItem>` itself before reaching
`renderItem` (see `ListBox.tsx` `if (item.section) { return <SectionItem
…/>; }` early branch).

### Step 7 — Final imports

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import styled from "@emotion/styled";
import { TraitTypeId, setTraitDragData, hasTraitDragData, getTraitDragData } from "../../core/traits";
import { TraitSet, traited } from "../../core/traits/traits";
import color from "../../theme/color";
import { settings } from "../../api/settings";
import { CreatableItem, DEFAULT_PINNED_EDITORS, getCreatableItems } from "./tools-editors-registry";
import { PinIcon, PinFilledIcon } from "../../theme/icons";
import { ListBox, LIST_ITEM_KEY, IconButton } from "../../uikit";
import type { ListItemRenderContext } from "../../uikit/ListBox";
```

Drop:
- `React` (only `useCallback/useMemo/useRef/useState` needed).
- `getTraitDragData` is no longer referenced — drop from import. (Cross-check: original code used it in the panel-level handler that's gone.)

### Step 8 — Verify

```bash
npx tsc --noEmit
npx eslint src/renderer/ui/sidebar/ToolsEditorsPanel.tsx
```

Expect: no new errors.

Manual smoke (covered fully in US-492):

1. Open ToolsEditors panel — Pinned section header above pinned rows;
   "All Editors & Tools" section header above unpinned rows.
2. Hover a row — soft hover background; pin button fades in.
3. Click pin button on an unpinned row — moves to pinned list, settings
   persisted; row click is **not** triggered (no page created).
4. Click unpin button on a pinned row — moves to unpinned list, settings
   persisted; row click is **not** triggered.
5. Drag-reorder a pinned row — live reorder during dragOver, persists on
   drop; dragged row at 40% opacity; drop target shows top border.
6. Drag a row over a section header — no drop (sections inert).
7. Click a row body — page is created and panel closes.
8. Section headers are not clickable.
9. Visual: pinned and unpinned rows share the same left edge (no drag
   handle gap).
10. Theme cycle (Light/Dark) — colors look right.

## Concerns

### C1 — Should we use UIKit `ListBox` despite the small list size? *(RESOLVED: yes)*

Earlier this task argued against ListBox (max ~25 items → virtualization
wasted; heterogeneous chrome → renderItem-everywhere defeats ListBox's
value-add). On reconsideration, **the consistency benefit outweighs
those costs**:

- All four sidebar list surfaces use the same primitive.
- Sections are handled natively (`<SectionItem>`) — no separator div.
- Mouse-enter / click / context-menu wiring shared with siblings.
- ~25-item virtualization overhead is negligible.

The heterogeneous chrome is handled cleanly via `renderItem` branching on
`pinnedItems.indexOf(src)`. The original "live drag-over reorder is brittle
with onMouseEnter" worry was misplaced — `onItemMouseEnter` is a no-op when
`onActiveChange` isn't provided (we don't pass it).

### C2 — IconButton size vs. existing pin span *(RESOLVED — accept delta)*

UIKit `IconButton size="sm"` is `controlSm` (24px) vs. the original 20×20.
Row height bumps from ~26px → ~30px. Acceptable per the migration's
"consistency over fidelity" stance.

### C3 — Pin button click bubbling *(RESOLVED)*

`handleUnpin` and `handlePin` already call `e.stopPropagation()` to prevent
the wrapper's `onClick` from firing `source.create()`. Same pattern as
today, just attached to UIKit `IconButton.onClick` instead of a `<span>`'s.

### C4 — Module-level mutable `draggingPinnedEditorIndex` *(RESOLVED — preserved)*

Required for the live-reorder semantics (one row's `dragOver` reads the
sibling row's drag index). Preserved verbatim. Refactoring to a useRef would
require lifting the index to a shared parent — out of scope.

### C5 — Drop drag handle "⋮⋮" *(RESOLVED — dropped)*

Pinned rows previously started at a different left edge than unpinned rows
because of the leading drag handle. Dropping it aligns both lists. The whole
pinned row is `draggable={true}` — user can grab anywhere on the row to
initiate drag. `cursor: grab` cue and `userSelect: none` go away with the
glyph; visibility-on-hover wrapper for the drag handle is removed.

### C6 — Section header visual delta *(RESOLVED — accept consistency win)*

| Aspect | Before (hand-rolled) | After (UIKit `<SectionItem>`) |
|--------|----------------------|-------------------------------|
| Font | 11px, bold, uppercase, letter-spacing 0.5 | default size (~14px), regular weight, no transform |
| Color | `text.light` | `text.light` (same) |
| Alignment | left-aligned with 12px left padding | centered |
| Position | tight on the row above | inline as a row (rowHeight 28) |

Result: section headers will look exactly like OpenTabsList's window-row
section headers. Acceptable consistency win.

### C7 — Row variant *(RESOLVED — N/A with custom renderItem)*

ListBox `variant` only affects the default `<ListItem>` renderer. With
`renderItem` supplied, it's ignored. Not passed.

### C8 — Active-row tracking *(RESOLVED — not used)*

`activeIndex` / `onActiveChange` are not passed. ListBox's
`onItemMouseEnter` is a no-op without `onActiveChange`. Mouse-hover styling
comes from `RowStyled`'s `:hover` — does not depend on ListBox active
tracking.

### C9 — Row keyboard nav *(RESOLVED — not used)*

`keyboardNav` defaults to `false`. The panel doesn't currently support
keyboard nav, and adding it is out of scope.

### C10 — Section markers as `RowSource` adds an `any`-like shape *(RESOLVED)*

`isSection` type-guard narrows correctly. The trait accessors cast via
`item as RowSource` — same pattern OpenTabsList uses (`item as ListItem`).
TypeScript-clean.

### C11 — `getTraitDragData` import is unused after migration *(RESOLVED)*

Confirmed during implementation — drop from imports. The current code uses
it in a panel-level drop handler that doesn't exist after migration (drops
happen only on the row).

## Acceptance criteria

- [ ] Pinned and unpinned rows render with the same left edge (icon-first;
  no drag handle).
- [ ] Section headers use `<SectionItem>` (auto-rendered by ListBox).
- [ ] Pinned section appears only when ≥1 pinned item; "All Editors & Tools"
  section appears only when ≥1 unpinned item.
- [ ] No `<Divider />` between sections.
- [ ] Pin/unpin buttons are real `<button>` elements via UIKit
  `IconButton size="sm"` — keyboard focusable, tooltip via `title`.
- [ ] Pin-button visibility-on-hover preserved (hidden until row hover).
- [ ] Class-based row state replaced with `data-dragging` /
  `data-drag-over` (Rule 1).
- [ ] Drag-reorder still works: drag a pinned row, hover over another pinned
  row → live reorder; drop persists order in `pinned-editors` setting.
- [ ] Pin button click updates `pinned-editors` and does **not** trigger
  the row click.
- [ ] Click on row body creates the page and calls `onClose?.()`.
- [ ] Click on a section header does nothing (inert).
- [ ] No new imports from `components/basic/` or `components/form/`.
- [ ] Only one `styled.*` block in the file (`RowStyled`).
- [ ] `npx tsc --noEmit` shows no new errors.
- [ ] `npx eslint src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` is clean.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | Full rewrite. Use UIKit `ListBox` with section markers via traits. Custom `renderItem` returns `PinnedRow` / `UnpinnedRow`. Single chrome-exception `RowStyled` (~20 lines) owns hover, cursor, drag-state visuals, and pin-button visibility-on-hover. Drag handle dropped. `<Divider />` removed (sections do the division). All other chrome via UIKit primitives (`IconButton`, `SectionItem` auto-rendered). DnD via `TraitTypeId.PinnedEditor` preserved verbatim. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Sibling: [US-495](../US-495-scriptlibrarypanel-migration/README.md)
- Related: [US-497](../US-497-treeproviderview-migration/README.md) — TreeProviderView migration
- Blocks: [US-492](../US-492-sidebar-integration-testing/README.md)
