# US-295: Create CategoryView Component

**Status:** Complete
**Epic:** EPIC-015 (Phase 2, Task 2.2)

## Goal

Create `CategoryView` — the content area component that displays `ITreeProviderItem[]` for a selected category (folder) using list or tile view modes. Inspired by the Link editor's main panel but built from scratch as a reusable component.

This is the companion to `TreeProviderView`: the tree sidebar shows the folder hierarchy, `CategoryView` shows the contents of the selected folder. Together they form the "Page = Link Browser" architecture.

## Background

### Current Link editor content area

The Link editor's content area has:
- **List mode** (`LinkItemList.tsx`): virtualized via `RenderGrid`, row height 28px, single column. Shows favicon, title, pin icon, action buttons.
- **Tiles mode** (`LinkItemTiles.tsx`): virtualized via `RenderGrid`, dynamic column count based on container width. 4 tile sizes (landscape/portrait × normal/big).
- **View mode switching**: dropdown button in toolbar, persisted per category.
- **Footer**: shows filtered/total link count.
- **Search**: field in toolbar, filters by title.

### What CategoryView reuses

| From Link editor | Reuse in CategoryView |
|---|---|
| `RenderGrid` virtualization | Direct reuse — same component |
| List layout (28px rows) | Adapt — show `TreeProviderItemIcon` + name + size/date |
| Tiles layout (dynamic columns) | Adapt — show icon + name, optional preview |
| View mode switching | Adapt — same 5 modes, toolbar dropdown |
| Quick search | Adapt — filter by item name |
| Click/double-click/context menu | Adapt — use `ITreeProvider` methods |

### What's different from Link editor

| Aspect | Link editor | CategoryView |
|---|---|---|
| Data source | Static `LinkEditorData` (all items in memory) | `ITreeProvider.list(category)` (one directory at a time) |
| Items | `LinkItem` (bookmarks with favicon) | `ITreeProviderItem` (files, folders, links) |
| Icons | Favicons for all items | `TreeProviderItemIcon` (folder/file/favicon depending on href) |
| Folders in content | Never shown | Shown as tiles/rows (`isDirectory` items) — clicking navigates into folder |
| Pinned panel | Built-in | Separate task (Phase 4) |
| Tags/Hostnames sidebar | Built-in | Separate tasks (Phase 4) |

## Implementation Plan

### Step 1: Define types and state

File: `src/renderer/components/tree-provider/CategoryViewModel.ts`

```typescript
// All modes defined for future use. Only "list" is implemented initially.
export type CategoryViewMode =
    | "list"
    | "tiles-landscape"
    | "tiles-landscape-big"
    | "tiles-portrait"
    | "tiles-portrait-big";

export interface CategoryViewProps {
    provider: ITreeProvider;
    /** Category path to display items for */
    category: string;
    /** Called when user clicks a non-directory item */
    onItemClick?: (item: ITreeProviderItem) => void;
    /** Called when user double-clicks a non-directory item */
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    /** Called when user clicks/double-clicks a directory item (navigate into) */
    onFolderClick?: (item: ITreeProviderItem) => void;
    /** Currently selected item href */
    selectedHref?: string;
    /** View mode. Default: "list" */
    viewMode?: CategoryViewMode;
    /** Called when view mode changes (for external persistence) */
    onViewModeChange?: (mode: CategoryViewMode) => void;
}

export interface CategoryViewState {
    items: ITreeProviderItem[];
    filteredItems: ITreeProviderItem[];
    searchText: string;
    loading: boolean;
    error: string | null;
}
```

### Step 2: Create `CategoryViewModel`

Model class extending `TComponentModel<CategoryViewState, CategoryViewProps>`:

**Key methods:**
- `loadItems()` — calls `provider.list(category)`, updates state
- `setSearchText(text)` — filters items by name match
- `onItemClick(item)` — delegates to `onItemClick` or `onFolderClick` based on `isDirectory`
- `onItemContextMenu(item, e)` — builds context menu (Copy Path, Rename, Delete when writable)
- `computeFilteredItems()` — apply search filter on loaded items

**Lifecycle:**
- On mount / category change → `loadItems()`
- On provider change → `loadItems()`

### Step 3: Create `CategoryView.tsx`

File: `src/renderer/components/tree-provider/CategoryView.tsx`

Layout:

```
┌────────────────────────────────────────────┐
│ Search...                  (toolbar row)   │
├────────────────────────────────────────────┤
│                                            │
│ Content area (RenderGrid)                  │
│  - List mode: rows with icon + name        │
│                                            │
├────────────────────────────────────────────┤
│ X of Y items                   (footer)    │
└────────────────────────────────────────────┘
```

**List mode rendering (single RenderGrid cell):**
```
┌──────────────────────────────────────────┐
│ Icon │ Name                              │
│16×16 │ (truncated, search highlighted)   │
└──────────────────────────────────────────┘
```
- Row height: 28px
- Icon: `<TreeProviderItemIcon item={item} />`
- Name: with search highlighting, truncated with ellipsis
- Folder items shown with folder icon, clicking navigates into them
- Uses `fitToWidth: true` with `columnWidth = () => "100%" as Percent`

**Tiles mode (future — not implemented in this task):**

Tiles rendering needs a `<TreeProviderItemTile>` component that handles:
- `imgSrc` for link items (Link editor bookmarks)
- Image preview for image files (.jpg, .png, .webp)
- Icon-only fallback for other items

This is a separate enhancement. For the initial implementation, only list mode is functional. The `viewMode` prop and `onViewModeChange` callback are defined in the interface but the view mode selector UI is not rendered until tiles mode is implemented.

### Step 4: Folder navigation in content

When `isDirectory` items appear in the item list (they always do — CategoryView shows both folders and files):
- **Clicking a folder** → calls `onFolderClick(item)` → parent updates the selected category
- **Visual distinction** — folder items show `FolderIcon`, bold name or different styling to stand out
- **Folders first** — items come pre-sorted from the provider (folders first, then files by extension)

This creates a Windows Explorer-like experience: folders and files together in the content area, click a folder to navigate into it.

### Step 5: Search

Quick search in the toolbar:
- Filters `items` by name match (case-insensitive, space-separated words)
- Applied on already-loaded items (no provider call)
- Shows "X of Y items" in footer when filtered
- Search highlighting via `highlightText()` utility

### Step 6: Context menus

Items get context menus based on `provider.writable` and item type:

**File items:**
- Copy Path
- Rename... (when writable + `provider.rename`)
- Delete (when writable + `provider.deleteItem`)

**Folder items:**
- Open (navigate into)
- Copy Path
- Rename... (when writable + `provider.rename`)
- Delete (when writable + `provider.deleteItem`)

### Step 7: Update exports

File: `src/renderer/components/tree-provider/index.ts`

Add `CategoryView` exports.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/components/tree-provider/CategoryView.tsx` | **NEW** — main component with list/tiles rendering |
| `src/renderer/components/tree-provider/CategoryViewModel.ts` | **NEW** — model with item loading, search, context menus |
| `src/renderer/components/tree-provider/index.ts` | Add CategoryView exports |

## Files NOT Changed

- `src/renderer/editors/link-editor/` — old component, kept as reference
- `src/renderer/components/tree-provider/TreeProviderView.tsx` — integration with CategoryView comes in Phase 3 (NavigationPanel)
- `src/renderer/components/virtualization/RenderGrid/` — reused as-is

## Resolved Concerns

1. **~~View mode persistence~~** — **Resolved.** For initial implementation (FileTreeProvider), only list mode. Tiles mode will need a `<TreeProviderItemTile>` component that can show `imgSrc` for links, image previews for image files (.jpg, .png), and icon-only for other items. Tile rendering is a separate enhancement — prop-driven `viewMode` design supports it when ready.

2. **~~Tiles without images~~** — **Resolved.** Show `TreeProviderItemIcon` for now. Image preview for image files (.jpg, .png) can be added as a separate task.

3. **~~Size/date in list mode~~** — **Resolved: don't show size/mtime in list mode.** Keep list mode simple (icon + name). For tiles mode (future), size/mtime can be fetched lazily via `provider.stat()` for visible tiles only — virtualized rendering means only a handful of tiles need metadata at any time.

4. **~~Component integration~~** — **Resolved.** Standalone now. Real testing on first integration (Phase 3).

5. **~~RenderGrid column width for list~~** — **Resolved.** Use `fitToWidth: true` with `columnWidth = () => "100%" as Percent`. RenderGrid automatically resizes columns with `%` to match grid width — no additional calculation needed.

## Acceptance Criteria

- [ ] `CategoryView` component renders items from `provider.list(category)`
- [ ] List mode: virtualized rows (28px) with icon and name, `fitToWidth: true`
- [ ] Quick search filters items by name with highlighting
- [ ] Folder items shown in content, clicking navigates (calls `onFolderClick`)
- [ ] Context menus adapt to `provider.writable`
- [ ] Footer shows item count (filtered/total)
- [ ] Uses `TreeProviderItemIcon` for all item icons
- [ ] Uses `RenderGrid` for virtualization
- [ ] `viewMode` prop and `onViewModeChange` callback defined (tiles rendering is future)
- [ ] Uses Model-View pattern (`TComponentModel`)
- [ ] Single root styled component with nested classes
- [ ] No hardcoded colors — uses color tokens
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
