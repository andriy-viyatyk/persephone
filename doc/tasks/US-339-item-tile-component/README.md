# US-339: ItemTile Component

**Epic:** EPIC-018 (Phase 0, Task 0.3)
**Status:** Planned

## Goal

Create a reusable `ItemTile` component in `components/tree-provider/` that renders a single tile card for any `ITreeProviderItem`. This is the building block for tile view modes in CategoryView and eventually replaces the link-specific `TileCell` in `LinkItemTiles.tsx`.

## Background

### Existing tile rendering

`LinkItemTiles.tsx` (`src/renderer/editors/link-editor/LinkItemTiles.tsx`) already has a complete tile implementation for `LinkItem` objects. Key design elements to reuse:

- **Tile structure:** image area (top) + title area (bottom)
- **Tile dimensions per view mode** (line 27-32):
  ```typescript
  const TILE_DIMENSIONS: Record<Exclude<LinkViewMode, "list">, TileDimensions> = {
      "tiles-landscape":     { cellWidth: 252, cellHeight: 192, imageHeight: 144 },
      "tiles-landscape-big": { cellWidth: 372, cellHeight: 276, imageHeight: 216 },
      "tiles-portrait":      { cellWidth: 168, cellHeight: 276, imageHeight: 216 },
      "tiles-portrait-big":  { cellWidth: 252, cellHeight: 408, imageHeight: 336 },
  };
  ```
- **Image source priority:** `imgSrc` → favicon (for HTTP links) → fallback icon
- **Styling:** border with rounded corners, hover effect, selection highlight, clamp title to 2 lines

### CategoryViewMode

`CategoryViewModel.tsx` already defines `CategoryViewMode` with the same variants as `LinkViewMode`:
```typescript
export type CategoryViewMode = "list" | "tiles-landscape" | "tiles-landscape-big" | "tiles-portrait" | "tiles-portrait-big";
```

### Image rendering for ITreeProviderItem

- `item.imgSrc` — set by `FileTreeProvider` for image files (US-337), by future `LinkTreeProvider` from `LinkItem.imgSrc`
- HTTP links — favicon from `favicon-cache.ts` (now in `components/tree-provider/`)
- Archive entries — `imgSrc` set by `ZipTreeProvider` for image entries (US-337), but rendering from archive paths needs `file://` prefix for local files

### View mode icons

Already exist in `icons.tsx` (line 1070-1124): `ViewListIcon`, `ViewLandscapeIcon`, `ViewLandscapeBigIcon`, `ViewPortraitIcon`, `ViewPortraitBigIcon`.

## Implementation Plan

### Step 1: Create `TILE_DIMENSIONS` constant

**File:** `src/renderer/components/tree-provider/ItemTile.tsx` (new)

Extract the dimensions table from `LinkItemTiles.tsx`. Use `CategoryViewMode` instead of `LinkViewMode`:

```typescript
import type { CategoryViewMode } from "./CategoryViewModel";

interface TileDimensions {
    cellWidth: number;
    cellHeight: number;
    imageHeight: number;
}

export const TILE_DIMENSIONS: Record<Exclude<CategoryViewMode, "list">, TileDimensions> = {
    "tiles-landscape":     { cellWidth: 252, cellHeight: 192, imageHeight: 144 },
    "tiles-landscape-big": { cellWidth: 372, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait":      { cellWidth: 168, cellHeight: 276, imageHeight: 216 },
    "tiles-portrait-big":  { cellWidth: 252, cellHeight: 408, imageHeight: 336 },
};
```

Export `TILE_DIMENSIONS` so CategoryView can use it for grid layout calculations.

### Step 2: Create `ItemTile` component

**File:** `src/renderer/components/tree-provider/ItemTile.tsx`

Props:
```typescript
interface ItemTileProps {
    item: ITreeProviderItem;
    imageHeight: number;
    isSelected?: boolean;
    searchText?: string;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
}
```

Rendering structure (adapted from `TileCell` in `LinkItemTiles.tsx`):
```
┌─────────────────────┐
│                     │
│   Image Area        │  height = imageHeight
│   (imgSrc/favicon/  │
│    file-type icon)  │
│                     │
├─────────────────────┤
│ [icon] File name    │  title area, 2-line clamp
└─────────────────────┘
```

**Image source priority:**
1. `item.imgSrc` → render `<img>` (use `file://` prefix for local paths, no prefix for HTTP)
2. HTTP href without imgSrc → favicon via `getFaviconPathSync(getHostname(item.href))`
3. Fallback → `TreeProviderItemIcon` (same icon as list mode, but larger: 32x32)

**Styling:** Port the tile styling from `LinkItemTilesRoot` in `LinkItemTiles.tsx` (lines 38-176) into a styled component. Simplify by removing link-editor-specific elements:
- Remove `tile-pin-icon` (link-specific)
- Remove `tile-actions` overlay buttons (link-specific; CategoryView uses context menus)
- Remove `tile-open-link` button
- Keep: `tile-inner` border/selection/hover, `tile-image` centering, `tile-title` clamp

**Title area:** Show file-type icon (16x16 `TreeProviderItemIcon`) + name with optional search highlighting via `highlightText()`.

### Step 3: Handle image src for different provider types

In ItemTile, determine the `<img src>` value:
- Local file paths (e.g., `D:\photos\img.jpg`) → no prefix needed in Electron (file protocol is default)
- Archive paths (e.g., `D:\archive.zip::images/photo.png`) → these won't work as `<img src>` directly. For now, skip rendering images from archives (just show the file-type icon fallback). Archive image thumbnails can be added later when the archive content pipe supports blob URLs.
- HTTP/HTTPS URLs → use directly as `src`

```typescript
function getImageSrc(item: ITreeProviderItem): string | null {
    if (!item.imgSrc) return null;
    // Archive paths (contain "::") can't be rendered as <img src>
    if (item.imgSrc.includes("::")) return null;
    return item.imgSrc;
}
```

### Step 4: Favicon preloading

The existing `useFavicons` hook (in `favicon-cache.ts`) accepts `Array<{ href: string }>` and returns a version counter. CategoryView will need to call this for the visible items when in tile mode, to trigger favicon loading and re-render when favicons become available. This integration happens in CategoryView (task 0.4), not in ItemTile itself — ItemTile just reads from the sync cache.

### No changes needed

| File | Reason |
|------|--------|
| `CategoryView.tsx` | Tile rendering integration is task 0.4 |
| `CategoryViewModel.tsx` | No model changes needed for ItemTile |
| `LinkItemTiles.tsx` | Will be cleaned up in Phase 1 (task 1.7) |
| `icons.tsx` | View mode icons already exist |

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/components/tree-provider/ItemTile.tsx` | **New** — ItemTile component + TILE_DIMENSIONS constant |

## Concerns

- **Archive image rendering:** Archive paths (`archive.zip::path/to/image.png`) can't be used as `<img src>`. For now, fall back to file-type icon for archive images. This can be improved later with blob URLs from the content pipe.
- **Image loading errors:** `<img>` should have an `onError` handler to hide broken images gracefully (show fallback icon instead).

## Acceptance Criteria

- [ ] `ItemTile` component renders a tile card for any `ITreeProviderItem`
- [ ] Image rendering: `imgSrc` (local file / HTTP) → favicon → file-type icon fallback
- [ ] `TILE_DIMENSIONS` exported for use by CategoryView
- [ ] Tile styling matches existing link tile design (border, selection, hover, title clamp)
- [ ] Archive paths in `imgSrc` fall back to icon (no broken image)
- [ ] `onError` handler on `<img>` hides broken images gracefully
