# US-349: CategoryView Uses LinksList / LinksTiles for Rendering

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.3a-3
**Depends on:** US-346 (extracted LinksList/LinksTiles), US-350 (ILink type consolidation)
**Status:** Planned

## Goal

Replace `CategoryViewRow` and `ItemTile` rendering inside `CategoryView` with `LinksList` and `LinksTiles`. Since both `ITreeProviderItem` and `LinkItem` are now the same `ILink` type (US-350), no mapping is needed — `CategoryView` passes its `filteredItems: ILink[]` directly to `LinksList`/`LinksTiles`.

## Background

After US-350, the type situation is simple:
- `ILink` is the universal item type (`title`, `href`, `category`, `tags`, `isDirectory`, `id?`, `size?`, `mtime?`, `imgSrc?`)
- `LinkItem extends ILink` adds required `id`
- `ITreeProviderItem` is a deprecated alias for `ILink`
- `CategoryView` already works with `ILink[]` (from `provider.list()`)

`LinksList`/`LinksTiles` currently accept `LinkItem[]` (requires `id`). Changing them to accept `ILink[]` makes them universal — `CategoryView` can pass items directly without any conversion.

## Implementation Plan

### Step 1: Change LinksList/LinksTiles to accept `ILink[]`

**Files:** `src/renderer/editors/link-editor/LinksList.tsx`, `src/renderer/editors/link-editor/LinksTiles.tsx`

- Change `links: LinkItem[]` → `links: ILink[]` in props
- Rename `selectedLinkId` → `selectedId`
- Add `getId?: (link: ILink) => string` prop. Default: `link.id ?? link.href`
- Selection check: `getId(link) === selectedId`
- All callbacks change from `(link: LinkItem)` → `(link: ILink)`
- Add `onDoubleClick?: (link: ILink) => void` prop. When provided, row/tile double-click calls it. When not provided, calls `onEdit` (current behavior).

**Inner components** (`LinksListRow`, `LinksTileCell`):
- Change `link: LinkItem` → `link: ILink`
- `useDrag` item: use `getId(link)` instead of `link.id`
- Double-click handler: `onDoubleClick ? onDoubleClick(link) : onEdit?.(link)`

### Step 2: Make action buttons optional

**Files:** `src/renderer/editors/link-editor/LinksList.tsx`, `src/renderer/editors/link-editor/LinksTiles.tsx`

When `onEdit` is not provided, hide the Edit button. When `onDelete` is not provided, hide the Delete button. When neither is provided, hide the actions container.

### Step 3: Change LinkTooltip to accept `ILink`

**File:** `src/renderer/editors/link-editor/LinkTooltip.tsx`

Change `link: LinkItem` → `link: ILink`. Only uses `title`, `href`, `imgSrc` — all present on `ILink`.

### Step 4: Update LinkItemList/LinkItemTiles wrappers

**Files:** `src/renderer/editors/link-editor/LinkItemList.tsx`, `src/renderer/editors/link-editor/LinkItemTiles.tsx`

- Update prop passing: `selectedId={selectedLinkId}`
- No `getId` needed — default (`link.id ?? link.href`) works since LinkItems always have `id`
- All callbacks already cast properly (LinkItem is ILink)
- No `onDoubleClick` — uses default behavior (calls `onEdit`)

### Step 5: Replace CategoryView rendering with LinksList/LinksTiles

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Replace list-mode `RenderGrid` + `renderCell` + `CategoryViewRow`:
```tsx
<LinksList
    links={filteredItems}
    selectedId={props.selectedHref ?? undefined}
    getId={(link) => link.href}
    searchText={state.searchText}
    onSelect={(link) => model.onItemClick(link)}
    onDoubleClick={(link) => model.onItemDoubleClick(link)}
    onEdit={provider.writable && provider.rename
        ? (link) => model.renameItem(link) : undefined}
    onDelete={provider.writable && provider.deleteItem
        ? (link) => model.deleteItemAction(link) : undefined}
    onContextMenu={(e, link) => model.onItemContextMenu(link, e)}
    onGridModel={handleGridModel}
/>
```

Replace tile-mode `RenderGrid` + `renderTileCell` + `ItemTile`:
```tsx
<LinksTiles
    links={filteredItems}
    viewMode={viewMode as Exclude<CategoryViewMode, "list">}
    selectedId={props.selectedHref ?? undefined}
    getId={(link) => link.href}
    onSelect={(link) => model.onItemClick(link)}
    onDoubleClick={(link) => model.onItemDoubleClick(link)}
    onEdit={...same...}
    onDelete={...same...}
    onContextMenu={(e, link) => model.onItemContextMenu(link, e)}
    onGridModel={handleGridModel}
/>
```

No `toLink()` mapping — `filteredItems` is already `ILink[]`.

### Step 6: Make CategoryViewModel methods public

**File:** `src/renderer/components/tree-provider/CategoryViewModel.tsx`

Change `private renameItem` → `renameItem` and `private deleteItemAction` → `deleteItemAction`.

### Step 7: Update CategoryViewModel method signatures

**File:** `src/renderer/components/tree-provider/CategoryViewModel.tsx`

`onItemContextMenu` currently accepts `(item: ITreeProviderItem, e: React.MouseEvent)`. Since `LinksList` calls `onContextMenu(e, link)` (event first, item second), we need to match the parameter order in the CategoryView callback wrapper:
```tsx
onContextMenu={(e, link) => model.onItemContextMenu(link, e)}
```

### Step 8: Handle grid model lifecycle

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Replace direct `gridRef` with `onGridModel` callback:
```typescript
const gridModelRef = useRef<RenderGridModel | null>(null);
const handleGridModel = useCallback((gm: RenderGridModel | null) => {
    gridModelRef.current = gm;
}, []);
```

Update `useEffect` calls that use `gridRef.current` to use `gridModelRef.current`.

### Step 9: Clean up CategoryView

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Remove:
- `CategoryViewRow` component, `CategoryViewRowProps`, `useItemHandlers`
- `TreeProviderItemIcon` import
- Inline `renderCell` / `renderTileCell` callbacks
- Row/tile styles from `CategoryViewRoot`: `cv-row`, `cv-row-cell`, `cv-tile-cell`, `cv-row-icon`, `cv-row-name`, `cv-row-name-folder`
- `ItemTile` import and `TILE_DIMENSIONS` import (now in LinksTiles)

## Concerns

### 1. Folder bold text — RESOLVED

`CategoryViewRow` renders folders with bold font-weight. `LinksListRow` doesn't distinguish.

**Resolution:** Add conditional bold class on title span when `link.isDirectory` is true. Small CSS addition in `LinksList`.

### 2. Double-click behavior — RESOLVED

LinkEditor: double-click = edit dialog. CategoryView: double-click = navigate/open. Solved by `onDoubleClick` prop override.

### 3. `onGridModel` notification timing — RESOLVED

`LinksList`/`LinksTiles` notify via `onGridModel` callback. The ref is set after first render, same as the current `gridRef` pattern. `useEffect` calls that need the grid model use `gridModelRef.current`.

## Acceptance Criteria

- [ ] `LinksList`/`LinksTiles` accept `ILink[]` (not just `LinkItem[]`)
- [ ] CategoryView list mode uses `LinksList`
- [ ] CategoryView tile mode uses `LinksTiles`
- [ ] Rich tooltip on hover in CategoryView
- [ ] Open-link button works
- [ ] Edit/Delete buttons show only for writable providers
- [ ] Selection by href works in CategoryView
- [ ] No mapping/conversion between types
- [ ] No regressions in LinkEditor or Explorer/Archive
- [ ] No TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/LinksList.tsx` | Accept `ILink[]`, add `getId`, `selectedId`, `onDoubleClick`, optional buttons |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | Same changes |
| `src/renderer/editors/link-editor/LinkTooltip.tsx` | Accept `ILink` instead of `LinkItem` |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Update prop names |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Update prop names |
| `src/renderer/components/tree-provider/CategoryView.tsx` | Replace rendering, remove CategoryViewRow, clean up styles |
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | Make `renameItem`/`deleteItemAction` public |
