# US-293: Create TreeProviderView Component

**Status:** Complete
**Epic:** EPIC-015 (Phase 2, Task 2.1)

## Goal

Create `TreeProviderView` — a new reusable component that renders any `ITreeProvider` as a tree view. This replaces the data layer of `FileExplorer` with the `ITreeProvider` interface while preserving the same UX (lazy loading, expand/collapse, context menus, drag-drop, search, file operations).

Built from scratch (not refactoring FileExplorer). Old FileExplorer kept as reference and fallback.

## Background

### Current FileExplorer architecture

`FileExplorer` combines data loading and UI in one component:
- **Model** (`FileExplorerModel.tsx`): calls `fs.listDirWithTypes()`, builds `FileTreeItem` tree, manages expand state, file operations (create/rename/delete/move)
- **View** (`FileExplorer.tsx`): renders `TreeView<FileTreeItem>`, search bar, context menus, drag-drop

### What TreeProviderView changes

TreeProviderView separates the data source from the view:
- **Data** comes from `ITreeProvider` (passed as prop) — any provider works (file, zip, link, future providers)
- **View** renders `TreeView<ITreeProviderItem>` with the same UX as FileExplorer
- **Show/hide links toggle** — new feature: control whether leaf items appear in the tree

### Key reusable pieces from existing code

| Existing | Reuse in TreeProviderView |
|---|---|
| `TreeView` component | Direct reuse — same `<TreeView>` with different item type |
| `TreeViewModel` / `TreeViewRef` | Direct reuse — expand/collapse, scroll, virtualization |
| Context menu pattern | Adapt — use `ITreeProvider` methods instead of `app.fs` |
| Drag-drop pattern | Adapt — use `ITreeProvider.rename()` / `moveToCategory()` |
| Search pattern | Adapt — quick search on loaded items (content search comes in Phase 5) |

## Implementation Plan

### Step 0: Add `rootPath` to `ITreeProvider` interface

File: `src/renderer/api/types/io.tree.d.ts`

Add `rootPath` property — the path to pass to `list()` for root-level listing:

```typescript
interface ITreeProvider {
    // ... existing properties ...
    /** Path to pass to list() for root-level listing. */
    readonly rootPath: string;
}
```

Update implementations:
- `FileTreeProvider`: `get rootPath() { return this.sourceUrl; }` — absolute OS path
- `ZipTreeProvider`: `get rootPath() { return ""; }` — empty string for archive root

This lets TreeProviderView call `provider.list(provider.rootPath)` without knowing the provider type.

### Step 1: Define the component's item type

TreeProviderView works with `ITreeProviderItem` but needs to extend it for tree rendering:

```typescript
// Internal tree node — wraps ITreeProviderItem with tree structure
interface TreeProviderNode extends TreeItem<TreeProviderNode> {
    data: ITreeProviderItem;
    /** undefined = not loaded (lazy), [] = empty folder */
    items?: TreeProviderNode[];
}
```

This matches `FileTreeItem` pattern: `items: undefined` means lazy-not-loaded, `items: []` means empty.

### Step 2: Create `TreeProviderViewModel.ts`

File: `src/renderer/components/tree-provider/TreeProviderViewModel.ts`

Model class extending `TComponentModel<TreeProviderViewState, TreeProviderViewProps>`.

Split into focused submodules if the model grows large (follow AVGrid/Browser editor pattern):
- **Core model** — tree building, lazy loading, expand state, display tree computation
- **Operations mixin** — context menus, create/rename/delete, drag-drop
- **Search mixin** — search state, filtering logic

Keep as single class initially, extract only if it exceeds ~300 lines.

**State:**
```typescript
interface TreeProviderViewState {
    tree: TreeProviderNode | null;          // Full tree (root + loaded children)
    displayTree: TreeProviderNode | null;   // Filtered tree (for search)
    searchText: string;
    searchVisible: boolean;
    error: string | null;
}
```

**Props:**
```typescript
interface TreeProviderViewProps {
    provider: ITreeProvider;
    /** Show leaf items in tree (true) or directories only (false). Default: true */
    showLinks?: boolean;
    onItemClick?: (item: ITreeProviderItem) => void;
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    onFolderDoubleClick?: (item: ITreeProviderItem) => void;
    selectedHref?: string;
    initialState?: TreeProviderViewSavedState;
    onStateChange?: (state: TreeProviderViewSavedState) => void;
    refreshKey?: string | number;
}
```

**Key methods:**
- `buildTree()` — call `provider.list(rootPath)` to get root children, build `TreeProviderNode` tree
- `loadChildrenIfNeeded(path)` — lazy load on expand via `provider.list(path)`
- `onExpandChange(id, expanded)` — trigger lazy load, save expand state
- `computeDisplayTree()` — apply search filter + showLinks filter
- `onItemClick(item)` — delegate to props callback
- `onItemContextMenu(item, e)` — build context menu from provider capabilities

**Saved state:**
```typescript
interface TreeProviderViewSavedState {
    expandedPaths: string[];
    selectedHref?: string;
}
```

### Step 3: Create `TreeProviderView.tsx`

File: `src/renderer/components/tree-provider/TreeProviderView.tsx`

Component using `useComponentModel(props, TreeProviderViewModel, defaultState)`:

```
┌─────────────────────────────────────┐
│ TreeProviderView                     │
│ ┌─────────────────────────────────┐ │
│ │ TreeView<TreeProviderNode>      │ │
│ │  - Lazy load on expand          │ │
│ │  - Show/hide links toggle       │ │
│ │  - Context menus                │ │
│ │  - Drag-drop (if writable)      │ │
│ │  - Selected item highlighting   │ │
│ │  - File/folder icons            │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Search bar (Ctrl+F)             │ │
│ │  - Quick filter on item names   │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**TreeView props mapping:**
```typescript
<TreeView<TreeProviderNode>
    root={state.displayTree}
    getId={(node) => node.data.href}
    getLabel={(node) => node.data.name}           // with search highlighting
    getIcon={(node) => <TreeProviderItemIcon item={node.data} />}
    getHasChildren={(node) => node.data.isDirectory}
    getSelected={(node) => node.data.href === selectedHref}
    onItemClick={model.onItemClick}
    onItemDoubleClick={model.onItemDoubleClick}
    onItemContextMenu={model.onItemContextMenu}
    onExpandChange={model.onExpandChange}
    initialExpandMap={model.initialExpandMap}
    rootCollapsible={false}
/>
```

### Step 4: Create `TreeProviderItemIcon` component

File: `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx`

A single component that resolves the icon for any `ITreeProviderItem` based on its `href` and `isDirectory`:

```typescript
function TreeProviderItemIcon({ item }: { item: ITreeProviderItem }) {
    if (item.isDirectory) return <FolderIcon />;

    const href = item.href;
    if (href.startsWith("http://") || href.startsWith("https://")) {
        // Check URL pathname for a file extension (ignore hostname like ".com")
        try {
            const ext = path.extname(new URL(href).pathname).toLowerCase();
            if (ext) {
                return <FileTypeIcon fileName={item.name} width={16} height={16} />;
            }
        } catch { /* invalid URL — fall through to favicon */ }
        return <FaviconIcon url={href} />;
    }

    // Local file or archive entry — resolve by file name
    return <FileTypeIcon fileName={item.name} width={16} height={16} />;
}
```

Resolution order:
1. `isDirectory` → `FolderIcon`
2. HTTP/HTTPS `href` with file extension in URL pathname → `FileTypeIcon` (e.g., `/data.json` → JSON icon)
3. HTTP/HTTPS `href` without extension → favicon (e.g., `http://google.com` → site favicon)
4. Everything else (local file, archive entry) → `FileTypeIcon` (language → file pattern → system icon → default)

Examples:
```
http://my.site.net/data.json   → URL pathname "/data.json"    → ext ".json" → FileTypeIcon
http://cdn.com/styles.css?v=2  → URL pathname "/styles.css"   → ext ".css"  → FileTypeIcon
http://google.com              → URL pathname "/"              → no ext      → favicon
http://example.com/api/users   → URL pathname "/api/users"    → no ext      → favicon
C:\projects\file.ts            → local file                   → FileTypeIcon
archive.zip!word/document.xml  → archive entry                → FileTypeIcon
```

This component is provider-agnostic — the `ITreeProviderItem` has everything needed to determine the icon. No difference between FileTreeProvider, ZipTreeProvider, or future LinkTreeProvider items.

### Step 5: Show/hide links toggle

When `showLinks = false`, the display tree filters out non-directory items:

```typescript
function filterDirectoriesOnly(node: TreeProviderNode): TreeProviderNode {
    return {
        ...node,
        items: node.items
            ?.filter(child => child.data.isDirectory)
            .map(filterDirectoriesOnly),
    };
}
```

Applied in `computeDisplayTree()` after search filtering.

### Step 6: Context menus

Context menu items depend on `provider.writable` and item type:

**File context menu (when provider.writable):**
- Copy Path
- Rename... → calls `provider.rename()`
- Delete → calls `provider.deleteItem()`

**Folder context menu (when provider.writable):**
- New File... → calls `provider.addItem()` (if implemented)
- New Folder... → calls `provider.mkdir()`
- Copy Path
- Rename... → calls `provider.rename()` (not root)
- Delete → calls `provider.deleteItem()` (not root)

**Read-only provider (e.g., ZipTreeProvider):**
- Copy Path only

Context menus are built dynamically by checking which optional methods exist on the provider.

### Step 7: Drag-drop

Only enabled when `provider.writable`:
- **Drag**: files and folders (except root)
- **Drop target**: folders only
- **Action**: calls `provider.rename(oldPath, newFolderPath + "/" + name)`
- **canDrop**: prevent dropping onto self or own children

### Step 8: Search

Quick search (name filtering) — same pattern as FileExplorer:
- Search bar at bottom, toggle via Ctrl+F
- Text < 3 chars: shallow search (expanded folders only)
- Text ≥ 3 chars: deep search (entire loaded tree, auto-expand all)
- Space-separated words: all must match
- Search highlighting in labels via `highlightText()` utility

### Step 9: Ref API

```typescript
interface TreeProviderViewRef {
    refresh(): void;
    showSearch(): void;
    hideSearch(): void;
    collapseAll(): void;
    getState(): TreeProviderViewSavedState;
    getScrollTop(): number;
    setScrollTop(value: number): void;
}
```

Same API as FileExplorerRef for drop-in compatibility.

### Step 10: Create `index.ts`

File: `src/renderer/components/tree-provider/index.ts`

Export component, types, and ref interface.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/api/types/io.tree.d.ts` | Add `rootPath` property to `ITreeProvider` |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Add `rootPath` getter |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Add `rootPath` getter |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | **NEW** — main component |
| `src/renderer/components/tree-provider/TreeProviderViewModel.ts` | **NEW** — model with tree management, lazy loading, context menus |
| `src/renderer/components/tree-provider/TreeProviderItemIcon.tsx` | **NEW** — universal icon resolver (folder/file/favicon by href) |
| `src/renderer/components/tree-provider/index.ts` | **NEW** — exports |

## Files NOT Changed

- `src/renderer/components/file-explorer/` — old component kept as reference
- `src/renderer/components/TreeView/` — reused as-is, no modifications
- `src/renderer/components/icons/LanguageIcon.tsx` — `FileTypeIcon` reused as-is
- `src/renderer/ui/navigation/NavigationPanel.tsx` — integration comes in Phase 3

## Resolved Concerns

1. **~~Root path handling across providers~~** — **Resolved: add `rootPath` to `ITreeProvider`.** Each provider returns the path for root listing. FileTreeProvider returns `sourceUrl`, ZipTreeProvider returns `""`. View calls `provider.list(provider.rootPath)`. See Step 0.

2. **~~Item identity (getId)~~** — **Resolved.** Using `href` as unique ID. Unique within each provider (file paths, archive paths).

3. **~~Component size~~** — **Resolved: split into submodules if needed.** Follow AVGrid/Browser editor pattern. Start as single model class, extract operations mixin and search mixin if it exceeds ~300 lines.

4. **~~Icons~~** — **Resolved: `TreeProviderItemIcon` component.** A single component that resolves the icon for any `ITreeProviderItem` based solely on the item's `href` and `isDirectory`. No `getIcon` prop needed — the item has everything: `isDirectory` → folder icon, HTTP `href` → favicon, file `href` → `FileTypeIcon` (language → pattern → system icon → default). Provider-agnostic — works the same for all providers.

5. **~~File operations~~** — **Resolved: follow existing pattern.** Use `ui.inputDialog()` / `ui.confirmDialog()` for dialogs. Call provider methods after confirmation. Refresh affected subtree after operation.

## Acceptance Criteria

- [ ] `TreeProviderView` component renders a tree from any `ITreeProvider`
- [ ] Lazy loading: children loaded on folder expand via `provider.list()`
- [ ] Show/hide links toggle: when false, only directories appear in tree
- [ ] Search: quick filter on item names (shallow < 3 chars, deep ≥ 3 chars)
- [ ] Context menus: adapts to `provider.writable` and available methods
- [ ] Drag-drop: move files/folders via `provider.rename()` (when writable)
- [ ] State persistence: expand paths + selection via `initialState`/`onStateChange`
- [ ] Ref API: `refresh()`, `showSearch()`, `collapseAll()`, `getState()`, scroll methods
- [ ] Works with FileTreeProvider (tested with a local directory)
- [ ] Works with ZipTreeProvider (tested with a ZIP file)
- [ ] Uses Model-View pattern (`TComponentModel`)
- [ ] Single root styled component with nested classes
- [ ] No hardcoded colors — uses color tokens
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
