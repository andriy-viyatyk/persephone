# US-340: CategoryView Tile Modes

**Epic:** EPIC-018 (Phase 0, Task 0.4)
**Status:** Planned

## Goal

Implement tile rendering in CategoryView for all `CategoryViewMode` variants. When `viewMode !== "list"`, render items using `ItemTile` in a responsive multi-column grid. Add a view mode toggle button to the toolbar area.

## Background

### Current state

- `CategoryView.tsx` renders **list mode only**: single-column `RenderGrid` with `ROW_HEIGHT = 28` rows
- `CategoryViewMode` type already defined in `CategoryViewModel.tsx` (line 18): `"list" | "tiles-landscape" | "tiles-landscape-big" | "tiles-portrait" | "tiles-portrait-big"`
- `CategoryViewProps` already has `viewMode?: CategoryViewMode` and `onViewModeChange?` (lines 38-40)
- `ItemTile` component and `TILE_DIMENSIONS` created in US-339
- `useFavicons` hook available in `favicon-cache.ts` (now in `components/tree-provider/`)
- View mode icons already exist in `icons.tsx`: `ViewListIcon`, `ViewLandscapeIcon`, `ViewLandscapeBigIcon`, `ViewPortraitIcon`, `ViewPortraitBigIcon`

### Reference implementation

`LinkItemTiles.tsx` (`src/renderer/editors/link-editor/LinkItemTiles.tsx`) shows how to render tiles in RenderGrid:
- Uses `onResize` callback to track grid width
- Calculates column count: `Math.max(1, Math.floor(gridWidth / dims.cellWidth))`
- Calculates row count: `Math.ceil(items.length / colCount)`
- Cell index: `row * colCount + col`
- Uses `columnWidth` as fixed number (not `"100%"`)

### Toolbar portal

CategoryView currently portals only a search `TextField` into `toolbarPortalRef`. The view mode button needs to be added alongside it. The parent (`CategoryEditor`) provides a single `<div>` portal target (line 76). Both search and view mode button should render into this portal.

### Favicon preloading

In tile mode, `useFavicons(filteredItems)` should be called to trigger favicon loading for HTTP items. This returns a version counter that causes re-render when favicons become available. Only needed in tile mode — list mode uses `TreeProviderItemIcon` which calls `getFaviconPathSync` synchronously.

## Implementation Plan

### Step 1: Add view mode toggle to toolbar portal

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Add a view mode dropdown button next to the search field in the portal content. Use `showAppPopupMenu` to show a popup menu with all 5 modes (same pattern as `LinkEditor.tsx` lines 238-247).

Import the view mode icons and add constants:

```typescript
import {
    ViewListIcon, ViewLandscapeIcon, ViewLandscapeBigIcon,
    ViewPortraitIcon, ViewPortraitBigIcon,
} from "../../theme/icons";
import { showAppPopupMenu } from "../overlay/PopupMenu";

const VIEW_MODE_LABELS: Record<CategoryViewMode, string> = {
    "list": "List",
    "tiles-landscape": "Landscape",
    "tiles-landscape-big": "Landscape (Large)",
    "tiles-portrait": "Portrait",
    "tiles-portrait-big": "Portrait (Large)",
};

const VIEW_MODE_ICONS: Record<CategoryViewMode, React.ReactNode> = {
    "list": <ViewListIcon />,
    "tiles-landscape": <ViewLandscapeIcon />,
    "tiles-landscape-big": <ViewLandscapeBigIcon />,
    "tiles-portrait": <ViewPortraitIcon />,
    "tiles-portrait-big": <ViewPortraitBigIcon />,
};

const VIEW_MODE_ORDER: CategoryViewMode[] = [
    "list", "tiles-landscape", "tiles-landscape-big",
    "tiles-portrait", "tiles-portrait-big",
];
```

The portal element becomes:
```tsx
const toolbarElement = (
    <>
        {searchElement}
        {props.onViewModeChange && (
            <Button type="icon" size="small" title="View Mode" onClick={handleViewModeMenu}>
                {VIEW_MODE_ICONS[viewMode]}
            </Button>
        )}
    </>
);
```

The view mode button is only shown when `onViewModeChange` is provided — this lets parents opt in to tile mode. Without `onViewModeChange`, CategoryView stays list-only (no button visible).

### Step 2: Add tile rendering branch

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

When `viewMode !== "list"`, render tiles instead of list rows:

1. Track grid width via `onResize` callback and `useState<RenderSizeOptional>`
2. Compute column/row counts from `TILE_DIMENSIONS[viewMode]` and grid width
3. Render `ItemTile` in each cell with `row * colCount + col` indexing
4. Call `useFavicons(filteredItems)` to preload favicons (only in tile mode)

```tsx
const viewMode = props.viewMode ?? "list";
const isTileMode = viewMode !== "list";

// Track grid size for tile column calculation
const [gridSize, setGridSize] = useState<RenderSizeOptional>({ width: undefined, height: undefined });

// Favicon preloading for tile mode
const faviconVersion = useFavicons(isTileMode ? filteredItems : EMPTY_ARRAY);

// Tile grid layout
const tileLayout = useMemo(() => {
    if (!isTileMode) return null;
    const dims = TILE_DIMENSIONS[viewMode as Exclude<CategoryViewMode, "list">];
    const colCount = gridSize.width
        ? Math.max(1, Math.floor(gridSize.width / dims.cellWidth))
        : 1;
    const rowCount = filteredItems.length > 0
        ? Math.ceil(filteredItems.length / colCount)
        : 0;
    return { dims, colCount, rowCount };
}, [isTileMode, viewMode, gridSize.width, filteredItems.length]);
```

The RenderGrid section becomes conditional:
```tsx
{isTileMode && tileLayout ? (
    <RenderGrid
        ref={gridRef}
        rowCount={tileLayout.rowCount}
        columnCount={tileLayout.colCount}
        rowHeight={tileLayout.dims.cellHeight}
        columnWidth={tileLayout.dims.cellWidth}
        renderCell={renderTileCell}
        onResize={setGridSize}
    />
) : (
    <RenderGrid
        ref={gridRef}
        rowCount={filteredItems.length}
        columnCount={1}
        rowHeight={ROW_HEIGHT}
        columnWidth={FULL_WIDTH}
        renderCell={renderCell}
        fitToWidth
    />
)}
```

### Step 3: Add `renderTileCell` callback

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

```typescript
const renderTileCell = useCallback(
    (p: RenderCellParams) => {
        if (!tileLayout) return null;
        const index = p.row * tileLayout.colCount + p.col;
        const item = filteredItems[index];
        if (!item) return <div key={p.key} style={p.style} />;

        const isSelected = item.href === props.selectedHref;
        return (
            <div key={p.key} style={p.style} className="cv-tile-cell">
                <ItemTile
                    item={item}
                    imageHeight={tileLayout.dims.imageHeight}
                    isSelected={isSelected}
                    searchText={state.searchText}
                    onClick={() => model.onItemClick(item)}
                    onDoubleClick={() => model.onItemDoubleClick(item)}
                    onContextMenu={(e) => model.onItemContextMenu(item, e)}
                />
            </div>
        );
    },
    [filteredItems, tileLayout, props.selectedHref, state.searchText, model, faviconVersion],
);
```

### Step 4: Add tile cell padding style

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Add to `CategoryViewRoot` styled component:
```typescript
"& .cv-tile-cell": {
    boxSizing: "border-box",
    padding: 4,
},
```

### Step 5: Reset grid on view mode or items change

**File:** `src/renderer/components/tree-provider/CategoryView.tsx`

Add a `useEffect` to scroll to top and update when items or view mode change:
```typescript
useEffect(() => {
    gridRef.current?.scrollToRow(0);
    gridRef.current?.update({ all: true });
}, [filteredItems, viewMode]);
```

Update the existing `useEffect` that depends on `filteredItems` and `selectedHref` to also depend on `faviconVersion` for tile mode re-renders.

### No changes needed

| File | Reason |
|------|--------|
| `CategoryViewModel.tsx` | Props already defined, no model logic needed |
| `ItemTile.tsx` | Already complete (US-339) |
| `CategoryEditor.tsx` | View mode state/persistence is task 0.5 |
| `LinkEditor.tsx` | Unaffected; has its own view mode implementation |
| `icons.tsx` | View mode icons already exist |

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/components/tree-provider/CategoryView.tsx` | Add tile rendering, view mode toggle button, favicon preloading, tile cell styling |

## Concerns

- **Grid update timing:** `LinkItemTiles` uses `setTimeout(0)` inside `useMemo` to trigger `gridRef.current?.update({ all: true })` after layout changes. This is a workaround for RenderGrid not auto-updating on column count changes. May need the same pattern here — test and add if tiles don't render correctly after resize.
- **Empty cells:** When `items.length` is not a multiple of `colCount`, the last row has empty cells. `renderTileCell` handles this by returning an empty `<div>` when index is out of bounds.

## Acceptance Criteria

- [ ] CategoryView renders tiles when `viewMode` is any tile variant
- [ ] Responsive column calculation based on grid width and tile dimensions
- [ ] View mode toggle button appears in toolbar portal (only when `onViewModeChange` is provided)
- [ ] Popup menu shows all 5 modes with icons, current mode highlighted
- [ ] Favicons preload in tile mode for HTTP items
- [ ] Search filtering works in tile mode
- [ ] Selection highlighting works in tile mode
- [ ] Context menus work on tiles (same as list mode)
- [ ] Grid scrolls to top on view mode change
- [ ] List mode rendering is completely unchanged
