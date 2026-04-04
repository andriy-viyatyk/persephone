# US-354: Consolidate ILink Drag-Drop into LinkDragEvent

**Epic:** EPIC-018 (Link Editor Refactoring)  
**Status:** Planned  
**Predecessor to:** US-353 (Replace CategoryTree with TreeProviderView)

## Goal

Replace three separate drag-drop types (`LINK_DRAG`, `LINK_CATEGORY_DRAG`, `tree-provider-item`) with a single `LinkDragEvent` carrying `ILink[]`. This unifies drag-drop across FileTreeProvider, ZipTreeProvider, and LinkEditor/LinkTreeProvider, and prepares for future cross-editor and cross-window drag-drop.

## Background

### Current state — three drag types for ILink items

| Drag type | Payload | Source | Target | Handler |
|-----------|---------|--------|--------|---------|
| `LINK_DRAG` | `{ type, linkId: string }` | LinkItemList, LinkItemTiles (center area) | LinkCategoryPanel (CategoryTree) | `vm.categoryDrop()` → `moveLinkToCategory()` |
| `LINK_CATEGORY_DRAG` | `{ type, category: string }` | LinkCategoryPanel (CategoryTree) | LinkCategoryPanel (CategoryTree) | `vm.categoryDrop()` → `moveCategory()` |
| `"tree-provider-item"` | `{ type, node: TreeProviderNode }` | TreeProviderView | TreeProviderView | `model.moveItem()` → `provider.rename()` |

### Problems with current approach

1. **Three types for the same concept** — all carry ILink items but with different payload shapes
2. **Not interoperable** — can't drag from TreeProviderView (Explorer) to LinkCategoryPanel or vice versa
3. **Payload inconsistency** — `LINK_DRAG` carries `linkId`, `LINK_CATEGORY_DRAG` carries `category` string, `tree-provider-item` carries `TreeProviderNode`. None carries `ILink` directly.
4. **No array support** — each type carries a single item. Future multi-select drag needs arrays.

### Target state — single LinkDragEvent

```typescript
// New shared type
export const LINK_DRAG_TYPE = "link-drag";

export interface LinkDragEvent {
    type: typeof LINK_DRAG_TYPE;
    items: ILink[];
    /** Identifies the source (e.g., provider sourceUrl or model id). 
     *  Used to distinguish internal vs external drops. */
    sourceId?: string;
}
```

All ILink drag-drop uses this single type. `ILink.isDirectory` distinguishes files from categories. Drop handlers inspect `items[0].isDirectory` to decide between `moveToCategory` vs `moveLinkToCategory` operations.

### Files involved

**Drag sources (produce LinkDragEvent):**
- [src/renderer/editors/link-editor/LinkItemList.tsx](../../../src/renderer/editors/link-editor/LinkItemList.tsx) — center area list, currently `{ type: LINK_DRAG, linkId }`
- [src/renderer/editors/link-editor/LinkItemTiles.tsx](../../../src/renderer/editors/link-editor/LinkItemTiles.tsx) — center area tiles, currently `{ type: LINK_DRAG, linkId }`
- [src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx) — category tree, currently `{ type: LINK_CATEGORY_DRAG, category }`
- [src/renderer/components/tree-provider/TreeProviderView.tsx](../../../src/renderer/components/tree-provider/TreeProviderView.tsx) — explorer/archive tree, currently `{ type: "tree-provider-item", node }`

**Drop targets (consume LinkDragEvent):**
- [src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx) — CategoryTree accepts `LINK_DRAG` + `LINK_CATEGORY_DRAG`
- [src/renderer/components/tree-provider/TreeProviderView.tsx](../../../src/renderer/components/tree-provider/TreeProviderView.tsx) — TreeView accepts `"tree-provider-item"`

**View-only components (pass-through drag props):**
- [src/renderer/editors/link-editor/LinksList.tsx](../../../src/renderer/editors/link-editor/LinksList.tsx) — accepts `dragType` + `getDragItem` props
- [src/renderer/editors/link-editor/LinksTiles.tsx](../../../src/renderer/editors/link-editor/LinksTiles.tsx) — accepts `dragType` + `getDragItem` props

**Drag type constants:**
- [src/renderer/editors/link-editor/linkTypes.ts](../../../src/renderer/editors/link-editor/linkTypes.ts) — defines `LINK_DRAG`, `LINK_CATEGORY_DRAG`
- [src/renderer/components/tree-provider/TreeProviderView.tsx](../../../src/renderer/components/tree-provider/TreeProviderView.tsx) — defines `TREE_PROVIDER_DRAG` (local const)

**Drop handlers (business logic):**
- [src/renderer/editors/link-editor/LinkViewModel.ts](../../../src/renderer/editors/link-editor/LinkViewModel.ts) — `categoryDrop()`, `moveLinkToCategory()`, `moveCategory()`, `getCategoryDragItem()`
- [src/renderer/components/tree-provider/TreeProviderViewModel.tsx](../../../src/renderer/components/tree-provider/TreeProviderViewModel.tsx) — `moveItem()` → `provider.rename()`

### Not in scope

- `LINK_PIN_DRAG` — internal to PinnedLinksPanel reordering, not ILink-related
- `NOTE_DRAG` / `CATEGORY_DRAG` — NotebookEditor, not ILink-related
- OS file drops — future task, these are native events not react-dnd

## Implementation Plan

### Step 1: Define LinkDragEvent type

**File:** `src/renderer/editors/link-editor/linkTypes.ts`

Add:
```typescript
export const LINK_DRAG_TYPE = "link-drag";

export interface LinkDragEvent {
    type: typeof LINK_DRAG_TYPE;
    items: ILink[];
    /** Source identifier — provider sourceUrl, model id, or undefined for external. */
    sourceId?: string;
}
```

Remove `LINK_DRAG` and `LINK_CATEGORY_DRAG` constants.

### Step 2: Update LinksList / LinksTiles drag props

**Files:** `src/renderer/editors/link-editor/LinksList.tsx`, `src/renderer/editors/link-editor/LinksTiles.tsx`

Currently:
```typescript
dragType?: string;
getDragItem?: (link: ILink) => unknown;
```

Change to simpler pattern — since all drags are now `LINK_DRAG_TYPE`, the parent just controls whether drag is enabled and what `sourceId` to use:
```typescript
/** Enable drag. When set, items are draggable with this sourceId in LinkDragEvent. */
dragSourceId?: string;
```

The `useDrag` hook inside `LinksListRow` becomes:
```typescript
const [{ isDragging }, drag] = useDrag({
    type: LINK_DRAG_TYPE,
    item: { type: LINK_DRAG_TYPE, items: [link], sourceId: dragSourceId } as LinkDragEvent,
    canDrag: !!dragSourceId,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});
```

### Step 3: Update LinkItemList / LinkItemTiles wrappers

**Files:** `src/renderer/editors/link-editor/LinkItemList.tsx`, `src/renderer/editors/link-editor/LinkItemTiles.tsx`

Currently:
```tsx
dragType={LINK_DRAG}
getDragItem={(link) => ({ type: LINK_DRAG, linkId: link.id })}
```

After:
```tsx
dragSourceId={vm.treeProvider.sourceUrl}
```

### Step 4: Update TreeProviderView drag

**File:** `src/renderer/components/tree-provider/TreeProviderView.tsx`

Replace `TREE_PROVIDER_DRAG` with `LINK_DRAG_TYPE`.

Current `getDragItem`:
```typescript
return { type: TREE_PROVIDER_DRAG, node };
```

After:
```typescript
return {
    type: LINK_DRAG_TYPE,
    items: [node.data],
    sourceId: props.provider.sourceUrl,
} as LinkDragEvent;
```

Update `dropTypes`:
```typescript
dropTypes={writable ? [LINK_DRAG_TYPE] : undefined}
```

### Step 5: Update TreeProviderViewModel drop handler

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

Current `moveItem` receives `(sourceNode: TreeProviderNode, targetNode: TreeProviderNode)` — it uses `sourceNode.data.href` for rename.

The `onDrop` in TreeProviderView currently:
```typescript
const onDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    if (dragItem.node) {
        model.moveItem(dragItem.node, dropNode);
    }
}, [model]);
```

After — adapt to LinkDragEvent payload:
```typescript
const onDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    const linkDrag = dragItem as unknown as LinkDragEvent;
    if (linkDrag.items?.length) {
        model.moveItems(linkDrag.items, dropNode);
    }
}, [model]);
```

Update `moveItem` → `moveItems` to accept `ILink[]` and a target node:
```typescript
moveItems = async (sourceItems: ILink[], targetNode: TreeProviderNode) => {
    const { provider } = this.props;
    const targetDir = targetNode.data.isDirectory
        ? targetNode
        : findParent(this.state.get().tree, targetNode.data.href);
    if (!targetDir) return;

    // For single item: use rename (file move) or moveToCategory (link move)
    if (sourceItems.length === 1) {
        const source = sourceItems[0];
        if (provider.moveToCategory) {
            // Link provider path: moveToCategory
            const targetCategory = this.getListPath(targetDir);
            await provider.moveToCategory([source.href], targetCategory);
        } else if (provider.rename) {
            // File provider path: rename
            const targetPath = this.getListPath(targetDir);
            const newPath = targetPath
                ? targetPath + "/" + source.title
                : source.title;
            const bt = await ui.confirm(
                `Move "${source.title}" to "${targetDir.data.title}/"?`,
                { title: "Move", buttons: ["Move", "Cancel"] },
            );
            if (bt !== "Move") return;
            await provider.rename(source.href, newPath);
        }
    } else {
        // Multi-item: use moveToCategory if available (future)
        if (provider.moveToCategory) {
            const targetCategory = this.getListPath(targetDir);
            await provider.moveToCategory(sourceItems.map(i => i.href), targetCategory);
        }
    }
    await this.buildTree();
};
```

The key distinction: `provider.moveToCategory` (LinkTreeProvider) vs `provider.rename` (FileTreeProvider). The handler checks which is available. This is clean because:
- `LinkTreeProvider` has `moveToCategory` but no `rename`
- `FileTreeProvider` has `rename` but no `moveToCategory`
- Both paths work through the same `moveItems` method

### Step 6: Update LinkCategoryPanel drop handling

**File:** `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx`

Currently:
```tsx
<CategoryTree
    dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]}
    onDrop={vm.categoryDrop}
    dragType={LINK_CATEGORY_DRAG}
    getDragItem={vm.getCategoryDragItem}
/>
```

After (still CategoryTree until US-353 replaces it):
```tsx
<CategoryTree
    dropTypes={[LINK_DRAG_TYPE]}
    onDrop={handleDrop}
    dragType={LINK_DRAG_TYPE}
    getDragItem={handleGetDragItem}
/>
```

Where:
```typescript
const handleDrop = useCallback((dropItem: CategoryTreeItem, dragItem: DragItem) => {
    const linkDrag = dragItem as unknown as LinkDragEvent;
    if (!linkDrag.items?.length) return;
    const item = linkDrag.items[0];
    if (item.isDirectory) {
        vm.moveCategory(item.href, dropItem.category);
    } else {
        // Find link by href, move to category
        const link = vm.state.get().data.links.find(l => l.href === item.href);
        if (link) vm.moveLinkToCategory(link.id, dropItem.category);
    }
}, [vm]);

const handleGetDragItem = useCallback((item: CategoryTreeItem): DragItem | null => {
    if (!item.category) return null;
    return {
        type: LINK_DRAG_TYPE,
        items: [{
            title: item.category.split("/").pop() || "",
            href: item.category,
            category: "",
            tags: [],
            isDirectory: true,
        }],
        sourceId: vm.treeProvider.sourceUrl,
    } as unknown as DragItem;
}, [vm]);
```

### Step 7: Update LinkViewModel — remove old drag methods

**File:** `src/renderer/editors/link-editor/LinkViewModel.ts`

- Remove `categoryDrop` method (replaced by inline handler in LinkCategoryPanel)
- Remove `getCategoryDragItem` method (replaced by inline handler)
- Keep `moveLinkToCategory` and `moveCategory` — still needed as business logic

### Step 8: Update canDrop in TreeProviderView

Current `canDrop` prevents dropping on self by comparing `dragItem.node?.data.href`:
```typescript
const canDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    if (!writable) return false;
    if (dragItem.node?.data.href === dropNode.data.href) return false;
    return true;
}, [writable]);
```

After — compare using LinkDragEvent items:
```typescript
const canDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    if (!writable) return false;
    const linkDrag = dragItem as unknown as LinkDragEvent;
    if (linkDrag.items?.length === 1 && linkDrag.items[0].href === dropNode.data.href) return false;
    return true;
}, [writable]);
```

## Files NOT changed

- `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` — uses `LINK_PIN_DRAG`, unrelated
- `src/renderer/editors/notebook/` — uses `NOTE_DRAG`/`CATEGORY_DRAG`, unrelated
- `src/renderer/components/tree-provider/CategoryView.tsx` — no drag-drop
- `src/renderer/components/tree-provider/CategoryViewModel.tsx` — no drag-drop

## Concerns / Open Questions

1. **`categoryDrop` in LinkViewModel uses `linkId` not `href`:** Current `LINK_DRAG` carries `linkId` (the internal ID). The new `LinkDragEvent` carries `ILink` with `href`. For LinkEditor links, the drop handler needs to find the link by `href` (or by `id` if present on the ILink). Since `LinkItem extends ILink` with required `id`, and `LinkItemList`/`LinkItemTiles` work with `LinkItem`, the dragged `ILink` will have `id` set. We can use `item.id ?? findByHref(item.href)` pattern.

2. **Category drag from CategoryTree:** Currently `getCategoryDragItem` creates a `DragItem` from a `CategoryTreeItem`. After consolidation, it creates a `LinkDragEvent` with a synthetic `ILink` (isDirectory=true, href=category path). This works because the drop handler checks `isDirectory` to dispatch to `moveCategory`.

3. **TreeProviderView's `moveItem` confirmation dialog:** Currently shows "Move X to Y?" for file operations. For link operations (via `moveToCategory`), no confirmation is shown (matches current LinkEditor behavior). The `moveItems` method handles both paths.

4. **Future: multi-select drag.** The `items: ILink[]` array supports this from day one. Current UI only drags single items. When multi-select is added, drop handlers already accept arrays.

## Acceptance Criteria

- [ ] Single `LINK_DRAG_TYPE` constant replaces `LINK_DRAG`, `LINK_CATEGORY_DRAG`, and `TREE_PROVIDER_DRAG`
- [ ] `LinkDragEvent` type with `items: ILink[]` and optional `sourceId`
- [ ] Drag from LinkEditor center area → drop on CategoryTree works (link moves to category)
- [ ] Drag category in CategoryTree → drop on another category works (category renamed)
- [ ] Drag in TreeProviderView (Explorer) → drop on folder works (file moved)
- [ ] No regression in Explorer file drag-drop
- [ ] No regression in Archive tree (ZipTreeProvider is read-only, no drag)

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/linkTypes.ts` | Add `LINK_DRAG_TYPE` + `LinkDragEvent`. Remove `LINK_DRAG`, `LINK_CATEGORY_DRAG`. |
| `src/renderer/editors/link-editor/LinksList.tsx` | Replace `dragType`/`getDragItem` props with `dragSourceId`. Build `LinkDragEvent` internally. |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | Same as LinksList. |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Replace `dragType={LINK_DRAG}` + `getDragItem` with `dragSourceId={vm.treeProvider.sourceUrl}`. |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Same as LinkItemList. |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Update drop types to `[LINK_DRAG_TYPE]`. New inline drop/drag handlers using `LinkDragEvent`. |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Remove `categoryDrop`, `getCategoryDragItem`. Keep `moveLinkToCategory`, `moveCategory`. |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Replace `TREE_PROVIDER_DRAG` with `LINK_DRAG_TYPE`. Build `LinkDragEvent` in `getDragItem`. Update `canDrop`. |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Replace `moveItem` with `moveItems(items: ILink[], targetNode)`. Dispatch to `provider.moveToCategory` or `provider.rename`. |
