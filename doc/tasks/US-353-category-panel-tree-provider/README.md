# US-353: Replace CategoryTree with TreeProviderView in LinkCategoryPanel

**Epic:** EPIC-018 (Link Editor Refactoring)  
**Status:** Planned

## Goal

Replace the custom `CategoryTree` component in `LinkCategoryPanel` with `TreeProviderView` backed by `LinkTreeProvider`. This unifies the category tree rendering across all providers (Explorer, Archive, Links) and enables two display modes: "categories only" (current behavior when LinkEditor is the main editor) and "categories with links" (for future use when LinkEditor is a secondary-only editor, e.g., dropped files list).

## Background

### Current implementation

`LinkCategoryPanel` ([src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx)) uses `CategoryTree` — a component that builds a tree from a flat array of category strings. It provides:

- Custom label rendering with category name + link count
- Drag-drop via unified `LINK_DRAG_TYPE` / `LinkDragEvent` (consolidated in US-354)
- Selection highlighting via `getSelected` callback
- `useOpenRawLink` flag for Context A (filter) vs Context B (navigate) behavior

`CategoryTree` ([src/renderer/components/TreeView/CategoryTree.tsx](../../../src/renderer/components/TreeView/CategoryTree.tsx)) is a general-purpose component also used by `NotebookEditor`. It builds tree nodes from flat category strings like `"dev/tools"`.

### Target implementation

`TreeProviderView` ([src/renderer/components/tree-provider/TreeProviderView.tsx](../../../src/renderer/components/tree-provider/TreeProviderView.tsx)) is the standard tree component used by Explorer and Archive panels. It:

- Takes an `ITreeProvider` and calls `list()` to load children lazily
- Has built-in search (Ctrl+F)
- Has drag-drop (when `provider.writable === true`)
- Has context menu integration via `linkContextMenu` event channel
- Already has a `showLinks` prop (when `false`, calls `filterDirectoriesOnly()` to hide non-directory items)
- Renders labels via `getLabel` callback (currently shows `node.data.title` only)

`LinkTreeProvider` ([src/renderer/editors/link-editor/LinkTreeProvider.ts](../../../src/renderer/editors/link-editor/LinkTreeProvider.ts)) already returns directory items with `size: count` (number of links in that sub-category), which can be used for the count label.

### What's missing in TreeProviderView

1. **Count label on directory nodes** — TreeProviderView shows only `node.data.title`. For the link categories panel, we need to also show the link count (from `node.data.size`). Need a `getLabel` prop override.

2. **Selection sync** — TreeProviderView uses `selectedHref` for highlight. LinkCategoryPanel highlights the "selected category" which maps to the current filter path. Should work via `selectedHref` prop.

3. **Click behavior** — TreeProviderView's `onItemClick` fires for all items. In "categories only" mode, clicking a category should filter the center area (or navigate via `openRawLink`). The existing `onItemClick` / `onFolderDoubleClick` callbacks should suffice.

4. **Root label** — CategoryTree shows "All" as root. TreeProviderView's root node title comes from `provider.displayName` (file basename). Need a `rootLabel` prop override.

5. **"Categories only" mode** — The existing `showLinks` prop (when `false`) already hides leaf items via `filterDirectoriesOnly()`. This is exactly what we need. For "categories with links" mode, `showLinks={true}` shows both.

6. **Drag-drop** — Already unified via US-354. TreeProviderView uses `LINK_DRAG_TYPE` / `LinkDragEvent` natively. No work needed.

## Investigation: Drag-drop

**Resolved:** Drag-drop consolidation is handled by predecessor task US-354. After US-354, all ILink drags use a single `LinkDragEvent` type (`LINK_DRAG_TYPE`). TreeProviderView already uses it natively. No custom drag props needed on TreeProviderView for this task.

## Investigation: Count label

**Resolved:** Add a `getLabel` prop to `TreeProviderViewProps`. When provided, it overrides the default label renderer. When omitted, the built-in label with search highlighting is used. The parent (`LinkCategoryPanel`) provides a custom label that shows category name + link count from `item.size`.

## Implementation Plan

### Step 1: Extend TreeProviderView with getLabel and rootLabel props

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

Add to `TreeProviderViewProps`:
```typescript
/** Override label rendering. When omitted, default title + search highlight is used. */
getLabel?: (item: ILink, searchText: string) => React.ReactNode;

/** Override root node label. When omitted, uses provider.displayName. */
rootLabel?: string;
```

**File:** `src/renderer/components/tree-provider/TreeProviderView.tsx`

- Wire `getLabel` prop: if provided, call `props.getLabel(node.data, state.searchText)` instead of the inline label
- Wire `rootLabel`: when building the root node, use `rootLabel` as title instead of `provider.displayName`

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

- In `buildTree()`, when creating the root node, check `this.props.rootLabel` and use it as the root title if provided

### Step 2: Replace CategoryTree with TreeProviderView in LinkCategoryPanel

**File:** `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx`

Before (current state after US-354):
```tsx
<CategoryTree
    categories={pageState.categories}
    separators="/\"
    rootLabel="All"
    rootCollapsible={false}
    onItemClick={handleItemClick}
    getSelected={vm.getCategoryItemSelected}
    getLabel={getTreeItemLabel}
    refreshKey={pageState.selectedCategory}
    dropTypes={[LINK_DRAG_TYPE]}
    onDrop={handleDrop}
    dragType={LINK_DRAG_TYPE}
    getDragItem={handleGetDragItem}
/>
```

After:
```tsx
<TreeProviderView
    provider={vm.treeProvider}
    showLinks={!categoriesOnly}
    selectedHref={pageState.selectedCategory}
    onItemClick={handleItemClick}
    getLabel={getTreeItemLabel}
    rootLabel="All"
/>
```

Drag-drop works natively — TreeProviderView uses `LinkDragEvent` (consolidated in US-354) for all drags/drops. Links dragged from center area and categories dragged within the tree all use `LINK_DRAG_TYPE`. The drop handler in `TreeProviderViewModel.moveItems()` dispatches to `provider.moveToCategory()` (LinkTreeProvider) automatically.

Remove the `handleDrop`, `handleGetDragItem` callbacks and the `DragItem` import — TreeProviderView handles drag-drop internally. Also remove `CategoryTree`, `CategoryTreeItem` imports.

The `categoriesOnly` prop replaces the current implicit always-categories-only behavior. When `true` (default for main editor), `showLinks={false}` hides leaf items. When `false` (future secondary-only mode), `showLinks={true}` shows links inside categories.

Update `LinkCategoryPanelProps`:
```typescript
interface LinkCategoryPanelProps {
    vm: LinkViewModel;
    useOpenRawLink: boolean;
    /** When true, shows only category folders. When false, shows categories + links. Default: true. */
    categoriesOnly?: boolean;
}
```

Adapt `handleItemClick` — TreeProviderView's `onItemClick` receives `ILink` (not `CategoryTreeItem`). The category path is `item.href`:
```tsx
const handleItemClick = useCallback((item: ILink) => {
    if (useOpenRawLink) {
        const navUrl = vm.treeProvider.getNavigationUrl(item);
        app.events.openRawLink.sendAsync(new RawLinkEvent(navUrl));
    } else {
        vm.setSelectedCategory(item.href);
    }
}, [vm, useOpenRawLink]);
```

Note: `vm.categoryItemClick(item)` just calls `setSelectedCategory(item.category)`. Since `ILink` directory items from `LinkTreeProvider` have `href = categoryPath`, we use `item.href` directly. The `categoryItemClick` method and `getCategoryItemSelected` on LinkViewModel (which use `CategoryTreeItem`) become unused and can be removed.

Custom label with count:
```tsx
const getTreeItemLabel = useCallback((item: ILink, searchText: string) => {
    const label = searchText ? highlightText(searchText, item.title) : item.title;
    return (
        <>
            <span className="category-label-name">{label}</span>
            {item.isDirectory && item.size !== undefined && (
                <span className="category-label-size">{item.size}</span>
            )}
        </>
    );
}, []);
```

### Step 3: Update LinkCategorySecondaryEditor

**File:** `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx`

Pass `categoriesOnly` based on `isMainEditor`:
```tsx
<LinkCategoryPanel
    vm={vm}
    useOpenRawLink={!isMainEditor}
    categoriesOnly={isMainEditor}
/>
```

### Step 4: Update LinkEditor inline panel

**File:** `src/renderer/editors/link-editor/LinkEditor.tsx`

The inline `<LinkCategoryPanel>` already passes `useOpenRawLink={false}`. Add `categoriesOnly={true}` (or rely on default).

### Step 5: Handle root label

Add `rootLabel?: string` to `TreeProviderViewProps`. When provided, the root node's title is overridden to this value instead of `provider.displayName`. Applied in `buildTree()` when creating the root `TreeProviderNode`.

`LinkCategoryPanel` passes `rootLabel="All"` to match current CategoryTree behavior.

### Step 6: Verify NotebookEditor is unaffected

`NotebookEditor` uses `CategoryTree` with its own `NotebookViewModel` callbacks. This task does NOT migrate NotebookEditor — it continues using `CategoryTree`. A separate future task could create a `NotebookTreeProvider` if desired.

### Step 7: (Optional) Clean up CategoryTree references

After this task, `CategoryTree` will only be used by `NotebookEditor`. No deletion needed yet — it's still a valid component for simple category-from-strings use cases.

## Concerns / Open Questions

1. **Async list() vs sync CategoryTree:** CategoryTree builds synchronously from flat strings. TreeProviderView calls `provider.list()` async. LinkTreeProvider's `list()` is sync under the hood (in-memory state) wrapped in `Promise` — microtask delay, imperceptible. By design, works fine.

2. **Watch/refresh:** TreeProviderView subscribes to `provider.watch()` → `buildTree()`. Need to verify it's responsive enough compared to current React re-render path.

3. **Context menu:** TreeProviderView fires context menus through `linkContextMenu` event channel. CategoryTree had none. This is an improvement — needs verification.

4. **Drag-drop:** Handled by predecessor US-354. No concerns for this task.

## Acceptance Criteria

- [ ] `LinkCategoryPanel` renders using `TreeProviderView` + `LinkTreeProvider` instead of `CategoryTree`
- [ ] Category nodes show link count next to the name (same as before)
- [ ] Root node shows "All" label
- [ ] Category selection filters the center area (Context A) or navigates via openRawLink (Context B)
- [ ] Drag-drop works: links from center area can be dropped on categories, categories can be reordered
- [ ] `showLinks={false}` (categories-only mode) hides leaf link items in the tree
- [ ] `showLinks={true}` (categories-with-links mode) shows both categories and links
- [ ] No regression in Explorer or Archive tree views
- [ ] NotebookEditor continues to work with `CategoryTree` (unchanged)

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Add `getLabel`, `rootLabel` to `TreeProviderViewProps`. Apply `rootLabel` in `buildTree()`. |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Wire `getLabel` prop override |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Replace `CategoryTree` with `TreeProviderView`, add `categoriesOnly` prop. Remove `handleDrop`/`handleGetDragItem`/`DragItem` import. Adapt `handleItemClick` to `ILink`. |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | Pass `categoriesOnly` based on `isMainEditor` |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Minor: pass `categoriesOnly` to inline panel (or rely on default) |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Remove `categoryItemClick`, `getCategoryItemSelected` (no longer used after CategoryTree removal) |
