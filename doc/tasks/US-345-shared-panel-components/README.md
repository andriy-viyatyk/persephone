# US-345: Shared Panel Components

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.2
**Status:** Planned

## Goal

Extract the Categories, Tags, and Hostnames panels from LinkEditor into shared components that can render both inline (inside LinkEditor) and as secondary editor panels (in PageNavigator). The panel components must support two navigation behaviors depending on context.

## Background

### Current LinkEditor panel rendering

`LinkEditor.tsx` (lines 365-412) renders three panels in a `CollapsiblePanelStack`:

```tsx
<CollapsiblePanelStack
    className="left-panel"
    style={{ width: pageState.leftPanelWidth }}
    activePanel={pageState.expandedPanel}
    setActivePanel={vm.setExpandedPanel}
>
    <CollapsiblePanel id="tags" title="Tags">
        <TagsList tags={pageState.tags} value={pageState.selectedTag}
            onChange={vm.setSelectedTag} getCount={vm.getTagCount} />
    </CollapsiblePanel>
    <CollapsiblePanel id="hostnames" title="Hostnames">
        <TagsList tags={pageState.hostnames} value={pageState.selectedHostname}
            onChange={vm.setSelectedHostname} getCount={vm.getHostnameCount}
            separator={"\0"} rootLabel="All" />
    </CollapsiblePanel>
    <CollapsiblePanel id="categories" title="Categories">
        <CategoryTree categories={pageState.categories} separators="/\"
            rootLabel="All" rootCollapsible={false}
            onItemClick={vm.categoryItemClick} getSelected={vm.getCategoryItemSelected}
            getLabel={getTreeItemLabel} refreshKey={pageState.selectedCategory}
            dropTypes={[LINK_DRAG, LINK_CATEGORY_DRAG]} onDrop={vm.categoryDrop}
            dragType={LINK_CATEGORY_DRAG} getDragItem={vm.getCategoryDragItem} />
    </CollapsiblePanel>
</CollapsiblePanelStack>
```

### Two contexts with different navigation behavior

**Context A — LinkEditor is the main editor** (`.link.json` file opened):
- Sub-case A1: PageNavigator closed → panels render inline in LinkEditor
- Sub-case A2: PageNavigator open → panels render as secondary editors, hidden in LinkEditor
- **Navigation:** Clicking a category/tag/hostname should NOT go through `openRawLink`. It should filter the content directly in LinkEditor's center area (current behavior). This is because LinkEditor itself is the main content viewer.

**Context B — LinkEditor model is a secondary editor only** (future: programmatic link collection):
- TextFileModel with `.link.json` content is added directly as a secondary editor to a PageModel where the main editor is NOT LinkEditor
- **Navigation:** Clicking a category should go through `openRawLink` → resolves to `tree-category://` link → CategoryEditor handles it. This is because the main content area shows whatever the user navigates to, not the link collection itself.

### How to detect the context

The secondary editor wrapper receives `model: EditorModel` (the TextFileModel). It can check:
```typescript
const isMainEditor = model.page?.mainEditor === model;
```
- If `true` → Context A (LinkEditor is main editor, use direct filtering)
- If `false` → Context B (external collection, use `openRawLink`)

This check is effectively a one-time initialization. When a `.link.json` is the main editor and the user navigates away, the secondary editors are removed (via `EditorModel.beforeNavigateAway()` clearing `secondaryEditor`). So the mode doesn't need to switch dynamically.

### Secondary editor registration pattern

Existing pattern from `ExplorerSecondaryEditor.tsx`:
1. Component receives `{ model, headerRef }: SecondaryEditorProps`
2. Type-cast `model` to specific type (e.g., `ExplorerEditorModel`)
3. Portal header content into `headerRef` via `createPortal`
4. Render main panel content below

For link panels, the wrapper needs to:
1. Acquire `LinkViewModel` via `useContentViewModel(model as TextFileModel, "link-view")`
2. Subscribe to `vm.state` for reactive updates
3. Render the panel content (CategoryTree / TagsList)
4. Portal header (panel title + optional buttons) into `headerRef`

### `useContentViewModel` — shared LinkViewModel instance

`useContentViewModel(host, "link-view")` returns a ref-counted `LinkViewModel` instance. Multiple callers (LinkEditor + panel wrappers) share the same instance. On mount it calls `host.acquireViewModel()`, on unmount it calls `host.releaseViewModel()`.

## Implementation Plan

### Step 1: Create `LinkCategoryPanel` component

**File:** `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` (new)

This component renders the Categories tree. It accepts `LinkViewModel` and navigation mode:

```typescript
interface LinkCategoryPanelProps {
    vm: LinkViewModel;
    /** When true, category clicks go through openRawLink pipeline (Context B).
     *  When false, category clicks filter content directly (Context A). */
    useOpenRawLink: boolean;
}
```

Extract from LinkEditor lines 394-411:
- `CategoryTree` with `categories`, `separators`, `rootLabel`, `rootCollapsible`
- `onItemClick` — conditional behavior:
  - Context A: `vm.categoryItemClick(item)` (direct filtering, current behavior)
  - Context B: `app.events.openRawLink.sendAsync(new RawLinkEvent(vm.treeProvider.getNavigationUrl(...), ...))` (go through pipeline)
- `getSelected`, `getLabel`, `refreshKey`, drag-drop props (same in both contexts)
- Wrapper `div.category-tree-container` with flex styling

```tsx
export function LinkCategoryPanel({ vm, useOpenRawLink }: LinkCategoryPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    const handleItemClick = useCallback((item: CategoryTreeItem) => {
        if (useOpenRawLink) {
            // Context B: navigate through pipeline
            const navUrl = vm.treeProvider.getNavigationUrl({
                name: item.category.split("/").pop() || "",
                href: item.category,
                category: "",
                tags: [],
                isDirectory: true,
            });
            app.events.openRawLink.sendAsync(new RawLinkEvent(navUrl));
        } else {
            // Context A: filter directly
            vm.categoryItemClick(item);
        }
    }, [vm, useOpenRawLink]);

    const getTreeItemLabel = useCallback((item: CategoryTreeItem) => {
        const name = splitWithSeparators(item.category, "/\\").pop() || "";
        const size = vm.getCategoryCount(item.category);
        return (
            <>
                <span className="category-label-name">{name || "All"}</span>
                {size !== undefined && <span className="category-label-size">{size}</span>}
            </>
        );
    }, [vm, pageState.categoriesSize]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="category-tree-container">
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
        </div>
    );
}
```

### Step 2: Create `LinkTagsPanel` component

**File:** `src/renderer/editors/link-editor/panels/LinkTagsPanel.tsx` (new)

Simpler component — tags filtering always happens on the LinkViewModel side (no navigation difference):

```tsx
interface LinkTagsPanelProps {
    vm: LinkViewModel;
}

export function LinkTagsPanel({ vm }: LinkTagsPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    return (
        <div className="tags-list-container">
            <TagsList
                tags={pageState.tags}
                value={pageState.selectedTag}
                onChange={vm.setSelectedTag}
                getCount={vm.getTagCount}
            />
        </div>
    );
}
```

### Step 3: Create `LinkHostnamesPanel` component

**File:** `src/renderer/editors/link-editor/panels/LinkHostnamesPanel.tsx` (new)

Same pattern as Tags:

```tsx
interface LinkHostnamesPanelProps {
    vm: LinkViewModel;
}

export function LinkHostnamesPanel({ vm }: LinkHostnamesPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    return (
        <div className="tags-list-container">
            <TagsList
                tags={pageState.hostnames}
                value={pageState.selectedHostname}
                onChange={vm.setSelectedHostname}
                getCount={vm.getHostnameCount}
                separator={"\0"}
                rootLabel="All"
            />
        </div>
    );
}
```

### Step 4: Create secondary editor wrappers

Three wrapper components that bridge `SecondaryEditorProps` → panel components via `useContentViewModel`.

**File:** `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` (new)

```tsx
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import type { LinkViewModel } from "../LinkViewModel";
import { LinkCategoryPanel } from "./LinkCategoryPanel";

export default function LinkCategorySecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    const isMainEditor = model.page?.mainEditor === model;

    if (!vm) return null;

    return (
        <>
            {headerRef && createPortal(<>Categories</>, headerRef)}
            <LinkCategoryPanel vm={vm} useOpenRawLink={!isMainEditor} />
        </>
    );
}
```

**File:** `src/renderer/editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` (new)

```tsx
export default function LinkTagsSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    if (!vm) return null;
    return (
        <>
            {headerRef && createPortal(<>Tags</>, headerRef)}
            <LinkTagsPanel vm={vm} />
        </>
    );
}
```

**File:** `src/renderer/editors/link-editor/panels/LinkHostnamesSecondaryEditor.tsx` (new)

```tsx
export default function LinkHostnamesSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    if (!vm) return null;
    return (
        <>
            {headerRef && createPortal(<>Hostnames</>, headerRef)}
            <LinkHostnamesPanel vm={vm} />
        </>
    );
}
```

### Step 5: Register secondary editors

**File:** `src/renderer/editors/register-editors.ts` (modify)

Add three registrations after the existing `"search"` registration (around line 666):

```typescript
secondaryEditorRegistry.register({
    id: "link-category",
    label: "Categories",
    loadComponent: () => import("./link-editor/panels/LinkCategorySecondaryEditor"),
});

secondaryEditorRegistry.register({
    id: "link-tags",
    label: "Tags",
    loadComponent: () => import("./link-editor/panels/LinkTagsSecondaryEditor"),
});

secondaryEditorRegistry.register({
    id: "link-hostnames",
    label: "Hostnames",
    loadComponent: () => import("./link-editor/panels/LinkHostnamesSecondaryEditor"),
});
```

### Step 6: Refactor LinkEditor to use shared panels

**File:** `src/renderer/editors/link-editor/LinkEditor.tsx` (modify)

Replace the inline panel rendering (lines 366-412) with the shared components:

```tsx
<CollapsiblePanelStack
    className="left-panel"
    style={{ width: pageState.leftPanelWidth }}
    activePanel={pageState.expandedPanel}
    setActivePanel={vm.setExpandedPanel}
>
    <CollapsiblePanel id="tags" title="Tags">
        <LinkTagsPanel vm={vm} />
    </CollapsiblePanel>
    <CollapsiblePanel id="hostnames" title="Hostnames">
        <LinkHostnamesPanel vm={vm} />
    </CollapsiblePanel>
    <CollapsiblePanel id="categories" title="Categories">
        <LinkCategoryPanel vm={vm} useOpenRawLink={false} />
    </CollapsiblePanel>
</CollapsiblePanelStack>
```

Also:
- Add imports for `LinkCategoryPanel`, `LinkTagsPanel`, `LinkHostnamesPanel`
- Remove the inline `getTreeItemLabel` callback (moved to `LinkCategoryPanel`)
- Remove now-unused imports: `CategoryTree`, `CategoryTreeItem`, `splitWithSeparators`, `LINK_DRAG`, `LINK_CATEGORY_DRAG` (check if used elsewhere in the file first — `LINK_DRAG` may be used by `LinkItemList`)

### Step 7: Move styles to panel files

The panel container styles are currently in `LinkEditorRoot` styled component (lines 51-76). Move them to the panel files as local styled components:

- **`LinkCategoryPanel.tsx`** — gets a styled root with `category-tree-container` styles (`flex: 1, display: flex, overflow: hidden, fontSize: 13, paddingLeft: 4`) plus `category-label-name` and `category-label-size` styles for the tree item labels.
- **`LinkTagsPanel.tsx`** / **`LinkHostnamesPanel.tsx`** — each gets a styled root with `tags-list-container` styles (`flex: 1, display: flex, overflow: hidden, width: 100%`).
- **`LinkEditorRoot`** — remove the moved styles (`& .category-tree-container`, `& .tags-list-container`, `& .category-label-name`, `& .category-label-size`). Keep `& .tree-cell` if still used by other parts of LinkEditor, otherwise remove too.

## Concerns — All RESOLVED

### 1. Styles — RESOLVED

Each panel file defines its own small styled component for its elements (standard project pattern — each component file has local styles). Parent components (LinkEditor, PageNavigator) may adjust child styles via class names but do not provide the full styling. Move relevant styles from `LinkEditorRoot` (`category-tree-container`, `tags-list-container`, `category-label-name`, `category-label-size`) into the panel files.

### 2. State subscription — RESOLVED

Use `useSyncExternalStore` matching LinkEditor's existing pattern. Note: `useOptionalState` from `src/renderer/core/state/state.ts` exists for cases where the state may be null, but here `vm` is always non-null (guarded by wrapper). Consider `useOptionalState` if needed elsewhere.

### 3. Drag-drop — RESOLVED

Keep drag-drop enabled in both contexts. `categoryDrop` modifies the link collection data owned by LinkViewModel, independent of which main editor is showing.

### 4. Panel styling scope — RESOLVED

Panels own their styles via local styled components. Parent components may adjust but don't provide full styling.

## Acceptance Criteria

- [ ] `LinkCategoryPanel`, `LinkTagsPanel`, `LinkHostnamesPanel` components created
- [ ] Secondary editor wrappers created and registered (`link-category`, `link-tags`, `link-hostnames`)
- [ ] LinkEditor refactored to use shared panel components (inline rendering)
- [ ] When `useOpenRawLink=false` (Context A): category clicks filter content directly in LinkEditor
- [ ] When `useOpenRawLink=true` (Context B): category clicks go through `openRawLink` pipeline
- [ ] `isMainEditor` check works: `model.page?.mainEditor === model`
- [ ] `useContentViewModel` properly acquires/releases shared `LinkViewModel` in wrappers
- [ ] Drag-drop works in Categories panel (both contexts)
- [ ] Panel styles work in both inline (LinkEditor) and secondary (PageNavigator) contexts
- [ ] No regressions: LinkEditor looks and works identically to current behavior

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | **New** — Categories panel component |
| `src/renderer/editors/link-editor/panels/LinkTagsPanel.tsx` | **New** — Tags panel component |
| `src/renderer/editors/link-editor/panels/LinkHostnamesPanel.tsx` | **New** — Hostnames panel component |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | **New** — Secondary editor wrapper for Categories |
| `src/renderer/editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` | **New** — Secondary editor wrapper for Tags |
| `src/renderer/editors/link-editor/panels/LinkHostnamesSecondaryEditor.tsx` | **New** — Secondary editor wrapper for Hostnames |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Refactor to use shared panel components |
| `src/renderer/editors/register-editors.ts` | Register three new secondary editors |

### Files NOT changed

- `src/renderer/editors/link-editor/LinkViewModel.ts` — no changes (panels consume existing API)
- `src/renderer/editors/link-editor/LinkTreeProvider.ts` — no changes (used by LinkCategoryPanel in Context B)
- `src/renderer/editors/link-editor/linkTypes.ts` — no changes
- `src/renderer/ui/navigation/secondary-editor-registry.ts` — no changes (existing interface sufficient)
- `src/renderer/ui/navigation/PageNavigator.tsx` — no changes (existing rendering loop handles new panels)
- `src/renderer/editors/base/EditorModel.ts` — no changes
- `src/renderer/editors/category/CategoryEditor.tsx` — no changes (handles `tree-category://` links already)
