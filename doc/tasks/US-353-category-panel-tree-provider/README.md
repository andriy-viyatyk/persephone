# US-353: Replace CategoryTree with TreeProviderView in LinkCategoryPanel

**Epic:** EPIC-018 (Link Editor Refactoring)  
**Status:** Planned

## Goal

Replace the custom `CategoryTree` component in `LinkCategoryPanel` with `TreeProviderView` backed by `LinkTreeProvider`. This unifies the category tree rendering across all providers (Explorer, Archive, Links) and enables two display modes: "categories only" (current behavior when LinkEditor is the main editor) and "categories with links" (for future use when LinkEditor is a secondary-only editor, e.g., dropped files list).

## Background

### Current implementation

`LinkCategoryPanel` ([src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx)) uses `CategoryTree` — a component that builds a tree from a flat array of category strings. It provides:

- Custom label rendering with category name + link count
- Drag-drop for links (`LINK_DRAG`) and categories (`LINK_CATEGORY_DRAG`)
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

1. **Count label on directory nodes** — TreeProviderView shows only `node.data.title`. For the link categories panel, we need to also show the link count (from `node.data.size`). This should be a generic capability — a `getLabel` prop override or a built-in option to show `size` next to directory names.

2. **Drag-drop type mismatch** — TreeProviderView uses its own `"tree-provider-item"` drag type internally. LinkCategoryPanel currently accepts `LINK_DRAG` and `LINK_CATEGORY_DRAG` drops. The TreeProviderView drag-drop needs to be extensible to accept external drag types (links dragged from the center area onto a category).

3. **Selection sync** — TreeProviderView uses `selectedHref` for highlight. LinkCategoryPanel highlights the "selected category" which maps to the current filter path. This should work via `selectedHref` prop.

4. **Click behavior** — TreeProviderView's `onItemClick` fires for all items. In "categories only" mode, clicking a category should filter the center area (or navigate via `openRawLink`). The existing `onItemClick` / `onFolderDoubleClick` callbacks should suffice.

5. **Root label** — CategoryTree shows "All" as root. TreeProviderView shows whatever `list("")` returns as the root node (using `provider.rootPath`). LinkTreeProvider has `rootPath = ""`, and `list("")` returns sub-categories. The root node's title comes from `displayName`. We may need a way to override the root label or set `displayName` to "All" for this use case.

6. **"Categories only" mode** — The existing `showLinks` prop (when `false`) already hides leaf items via `filterDirectoriesOnly()`. This is exactly what we need for the current LinkEditor use case where the center area shows links. For the future "categories with links" mode, `showLinks={true}` will show both.

## Investigation: Drag-drop

**Resolved:** Drag-drop consolidation is handled by predecessor task US-354. After US-354, all ILink drags use a single `LinkDragEvent` type (`LINK_DRAG_TYPE`). TreeProviderView already uses it natively. No custom drag props needed on TreeProviderView for this task.

## Investigation: Count label

`TreeProviderView` currently renders labels inline:

```tsx
const getLabel = useCallback((node: TreeProviderNode) => (
    <span className="tpv-item-label" title={node.data.href}>
        {state.searchText
            ? highlightText(state.searchText, node.data.title)
            : node.data.title
        }
    </span>
), [state.searchText]);
```

### Option A: Add a `getLabel` prop to TreeProviderViewProps

Allow parent to fully override the label renderer. This is the most flexible but loses the built-in search highlighting.

### Option B: Add a `showItemCount` prop

When `true`, render `node.data.size` next to the title for directory nodes. Simple, but specific to this use case.

### Option C: Add an `itemExtra` render prop  

Allow parent to inject extra content after the title. E.g., `renderExtra?: (item: ILink) => React.ReactNode`. Parent provides the count badge.

**Recommended: Option A (`getLabel` prop)**. It's the standard pattern — `TreeView` already supports `getLabel`. `TreeProviderView` just needs to expose it as an optional override. When not provided, the built-in label (with search highlighting) is used. When provided, the parent has full control.

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

Before:
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
    dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]}
    onDrop={vm.categoryDrop}
    dragType={LINK_CATEGORY_DRAG}
    getDragItem={vm.getCategoryDragItem}
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

Drag-drop works natively — after US-354 consolidation, TreeProviderView uses `LinkDragEvent` for all drags/drops. Links dragged from center area and categories dragged within the tree all use `LINK_DRAG_TYPE`. The drop handler in `TreeProviderViewModel.moveItems()` dispatches to `provider.moveToCategory()` (LinkTreeProvider) automatically.

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

`LinkTreeProvider.displayName` is currently the file basename. For the category panel, the root should show "All" (matching current behavior).

Options:
- Add a `rootLabel` prop to `TreeProviderView` that overrides `displayName` for the root node
- OR set `LinkTreeProvider.displayName = "All"` (but this breaks other uses like Archive panel title)
- OR add a `rootLabel` prop on `TreeProviderViewProps` — when provided, the root node's label shows this instead of `displayName`

**Recommended:** Add `rootLabel?: string` to `TreeProviderViewProps`. When provided, the root node's title is overridden to this value. This is clean and doesn't affect other uses.

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
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Replace `CategoryTree` with `TreeProviderView`, add `categoriesOnly` prop |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | Pass `categoriesOnly` based on `isMainEditor` |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Minor: pass `categoriesOnly` to inline panel (or rely on default) |
