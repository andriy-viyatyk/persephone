# US-346: Extract LinksList and LinksTiles as View-Only Components

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, predecessor to Task 1.3
**Status:** Planned

## Goal

Extract the rendering logic from `LinkItemList` and `LinkItemTiles` into reusable view-only components (`LinksList` and `LinksTiles`) that accept an array of items to display. This separates the data-rendering concern from the LinkEditor-specific wiring, enabling reuse in both the current LinkEditor center area and (future) the refactored architecture.

## Background

### Current structure

`LinkItemList.tsx` and `LinkItemTiles.tsx` are tightly coupled to `LinkViewModel`:
- They receive `links: LinkItem[]`, `model: LinkViewModel`, `selectedLinkId`, `pinnedLinkIds`
- They call `vm.openLink()`, `vm.showLinkDialog()`, `vm.selectLink()`, `vm.deleteLink()`, `vm.togglePinLink()`, `vm.isLinkPinned()` directly
- They build context menus inline with link-specific actions
- They handle drag-drop with `LINK_DRAG` type

### Target structure

Extract view-only components that:
- Accept `items: ITreeProviderItem[]` (or `LinkItem[]`) and render them
- Expose callbacks for clicks, context menus, drag events instead of calling ViewModel directly
- Accept an `onGetAdditionalIcon?: (item) => ReactNode` callback for pin indicators and similar decorations
- Keep all styling and rendering logic intact

The existing `LinkItemList` and `LinkItemTiles` become thin wrappers that wire the view-only components to `LinkViewModel`.

## Implementation Plan

### Step 1: Create `LinksList` component

**File:** `src/renderer/editors/link-editor/LinksList.tsx` (new)

Extract from `LinkItemList.tsx`:
- `RenderGrid` rendering with `ROW_HEIGHT=28`
- Row component with favicon, title, action buttons
- Favicon preloading via `useFavicons`
- Search text highlighting via `useHighlightedText`

**Props:**
```typescript
interface LinksListProps {
    links: LinkItem[];
    selectedLinkId?: string;
    onLinkClick?: (link: LinkItem) => void;
    onLinkDoubleClick?: (link: LinkItem) => void;
    onContextMenu?: (link: LinkItem, event: React.MouseEvent) => void;
    /** Callback to get additional icon(s) for a link row (e.g., pin indicator) */
    onGetAdditionalIcon?: (link: LinkItem) => React.ReactNode;
    /** Drag type for react-dnd. When set, rows are draggable. */
    dragType?: string;
    /** Build drag item data for a link */
    getDragItem?: (link: LinkItem) => unknown;
}
```

### Step 2: Create `LinksTiles` component

**File:** `src/renderer/editors/link-editor/LinksTiles.tsx` (new)

Extract from `LinkItemTiles.tsx`:
- `RenderGrid` tile rendering with responsive columns
- `ItemTile`-based rendering
- View mode dimensions

**Props:**
```typescript
interface LinksTilesProps {
    links: LinkItem[];
    viewMode: LinkViewMode;
    selectedLinkId?: string;
    onLinkClick?: (link: LinkItem) => void;
    onLinkDoubleClick?: (link: LinkItem) => void;
    onContextMenu?: (link: LinkItem, event: React.MouseEvent) => void;
    onGetAdditionalIcon?: (link: LinkItem) => React.ReactNode;
    dragType?: string;
    getDragItem?: (link: LinkItem) => unknown;
}
```

### Step 3: Refactor `LinkItemList` to use `LinksList`

**File:** `src/renderer/editors/link-editor/LinkItemList.tsx` (modify)

Becomes a thin wrapper:
```tsx
export function LinkItemList({ links, model, selectedLinkId, pinnedLinkIds }: LinkItemListProps) {
    const handleClick = useCallback((link: LinkItem) => model.selectLink(link.id), [model]);
    const handleDoubleClick = useCallback((link: LinkItem) => model.showLinkDialog(link.id), [model]);
    const handleContextMenu = useCallback((link: LinkItem, e: React.MouseEvent) => {
        // Build context menu with Edit, Open, Copy, Pin, Delete...
    }, [model]);
    const getAdditionalIcon = useCallback((link: LinkItem) => {
        return pinnedLinkIds.has(link.id) ? <PinFilledIcon .../> : null;
    }, [pinnedLinkIds]);

    return (
        <LinksList
            links={links}
            selectedLinkId={selectedLinkId}
            onLinkClick={handleClick}
            onLinkDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onGetAdditionalIcon={getAdditionalIcon}
            dragType={LINK_DRAG}
            getDragItem={(link) => ({ type: LINK_DRAG, linkId: link.id })}
        />
    );
}
```

### Step 4: Refactor `LinkItemTiles` to use `LinksTiles`

**File:** `src/renderer/editors/link-editor/LinkItemTiles.tsx` (modify)

Same pattern — becomes a thin wrapper delegating to `LinksTiles`.

## Concerns — All RESOLVED

### 1. Props type: `LinkItem[]` vs `ITreeProviderItem[]`

The view components work with `LinkItem[]` since they need `id` (for selection, pinning) and link-specific fields. `ITreeProviderItem` doesn't have `id`. Keeping `LinkItem[]` is correct — these are LinkEditor-specific view components, not generic tree provider views.

### 2. Context menu architecture

The view components expose `onContextMenu: (link, event) => void` — the parent builds the menu. This aligns with the event channel approach planned for the main refactoring task (US-348): the parent can dispatch to `treeProviderContextMenu` event channel or build items directly.

## Acceptance Criteria

- [ ] `LinksList` renders identically to current `LinkItemList` center area
- [ ] `LinksTiles` renders identically to current `LinkItemTiles` center area
- [ ] `LinkItemList` and `LinkItemTiles` are thin wrappers using the new components
- [ ] Pin indicator works via `onGetAdditionalIcon`
- [ ] Drag-drop works via `dragType` + `getDragItem`
- [ ] Context menu works via `onContextMenu` callback
- [ ] No visual regressions in LinkEditor
- [ ] No TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/LinksList.tsx` | **New** — View-only list component |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | **New** — View-only tiles component |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Refactor to thin wrapper over LinksList |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Refactor to thin wrapper over LinksTiles |
