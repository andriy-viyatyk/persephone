# US-296: Create PageNavigator Component

**Status:** Complete
**Epic:** EPIC-015 (Phase 3, Task 3.1)

## Goal

Create `PageNavigator` — a new component that replaces `NavigationPanel`. Built from scratch with only the functionality we need. Uses `TreeProviderView` + `FileTreeProvider` for file browsing. Opens files through `api.events.openRawLink` pipeline instead of direct `navigatePageTo` calls.

Old `NavigationPanel` kept untouched as reference and fallback.

## Background

### Current NavigationPanel

NavigationPanel is a complex component (~516 lines) with:
- Header toolbar (Navigate Up, Search in Files, Collapse All, Refresh, Close)
- FileExplorer component (old tree view)
- Content search (NavigationSearchModel, SearchResultsPanel, Splitter, filterPaths)
- Archive-specific logic (isArchiveRoot, archive banner, archive badge, .asar handling)
- File navigation via `pagesModel.navigatePageTo(pageId, filePath)`
- Root path management (navigate up, make root)
- State persistence via NavPanelModel (cache file)
- Scroll position preservation

### What PageNavigator will be

A simpler component with:
- Header toolbar: Move Up (when `provider.navigable`), Collapse All, Refresh, Close
- `TreeProviderView` with `FileTreeProvider`
- File opening through `api.events.openRawLink` pipeline (not direct `navigatePageTo`)
- State persistence (expanded paths, scroll position)
- `getExtraMenuItems` for app-level context menu items (Open in New Tab, Open in New Window, Show in File Explorer, Make Root)

### What's NOT included (removed vs NavigationPanel)

- Content search — returns in Phase 5 as CategoryView search
- Archive-specific logic — archives treated as regular files, ZipTreeProvider comes in task 3.2
- Direct `pagesModel.navigatePageTo` calls — replaced by openRawLink pipeline
- `filterPaths` — not needed without content search
- Search highlighting sync to Monaco — not needed without content search

### New approach: openRawLink pipeline for file navigation

Instead of `pagesModel.navigatePageTo(pageId, filePath)`, PageNavigator sends the raw link through the full pipeline:

```typescript
app.events.openRawLink.sendAsync(new RawLinkEvent(
    item.href,
    undefined,   // target editor (auto-resolved)
    { pageId }   // metadata: navigate THIS page, not open new tab
));
```

This requires enhancing `RawLinkEvent` to accept optional `target` and `metadata` (currently it only accepts `raw: string`). The Layer 1 parsers pass these through to `OpenLinkEvent`, and the open handler uses `metadata.pageId` to navigate the current page instead of opening a new tab.

This means PageNavigator doesn't need to know about page models, text file models, or editor types — it just sends raw links through the pipeline.

## Implementation Plan

### Step 1: Enhance RawLinkEvent with target and metadata

**Files:**
- `src/renderer/api/events/events.ts` — update `RawLinkEvent` class
- `src/renderer/api/types/io.events.d.ts` — update `IRawLinkEvent` interface
- `src/renderer/content/parsers.ts` — update all parsers to pass through `event.target` and `event.metadata`

```typescript
// events.ts — updated RawLinkEvent
export class RawLinkEvent extends BaseEvent {
    constructor(
        public readonly raw: string,
        public target?: string,
        public metadata?: ILinkMetadata,
    ) {
        super();
    }
}
```

```typescript
// io.events.d.ts — updated IRawLinkEvent
export interface IRawLinkEvent extends IBaseEvent {
    readonly raw: string;
    target?: string;
    metadata?: ILinkMetadata;
}
```

Each Layer 1 parser merges incoming target/metadata into the `OpenLinkEvent` it creates:

```typescript
// File parser — pass through target and metadata
await app.events.openLink.sendAsync(new OpenLinkEvent(
    filePath,
    event.target,
    event.metadata,
));

// cURL parser — merge cURL metadata with caller metadata (caller overrides)
const callerMeta = event.metadata ?? {};
await app.events.openLink.sendAsync(new OpenLinkEvent(
    parsed.url,
    event.target,
    { ...metadata, ...callerMeta },
));
```

Existing call sites (`new RawLinkEvent(filePath)`) are unaffected — `target` and `metadata` are optional.

### Step 2: Context menu via event channel + onContextMenu callback

**Three-layer context menu architecture:**

1. **TreeProviderView** adds generic items: Copy Path, Rename (writable), Delete (writable)
2. **Event channel** `app.events.treeProviderContextMenu` — registered handlers add type-specific items based on `item.href`
3. **`onContextMenu` prop** — parent component (PageNavigator) adds/modifies final items before menu is shown

**Step 2a: Define new event channel**

File: `src/renderer/api/events/AppEvents.ts`

```typescript
/** Context menu event for tree provider items. */
readonly treeProviderContextMenu = new EventChannel<ContextMenuEvent<ITreeProviderItem>>();
```

**Step 2b: Register default context menu handlers**

File: `src/renderer/content/tree-context-menus.ts` (NEW)

Register at bootstrap (same pattern as `registerRawLinkParsers()`):

```typescript
export function registerTreeContextMenuHandlers(): void {
    // File handler — for local file paths
    app.events.treeProviderContextMenu.subscribe(async (event) => {
        const item = event.target;
        if (!item || item.href.startsWith("http")) return;
        // Add: Show in File Explorer, Open in New Tab, Open in New Window
        // Re-fire on fileExplorer.itemContextMenu for script compatibility
    });

    // Link handler — for HTTP URLs (future, when LinkTreeProvider exists)
    app.events.treeProviderContextMenu.subscribe(async (event) => {
        const item = event.target;
        if (!item || !item.href.startsWith("http")) return;
        // Add: Open in Browser, Open in Browser (Incognito)
    });
}
```

**Step 2c: TreeProviderView fires event + calls onContextMenu**

```typescript
// In TreeProviderViewModel
onItemContextMenu = async (node: TreeProviderNode, e: React.MouseEvent) => {
    const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "tree-provider-item");
    ctxEvent.target = node.data;

    // 1. Add generic items (Copy Path, Rename, Delete)
    ctxEvent.items.push(...this.getGenericMenuItems(node));

    // 2. Fire event channel — handlers add type-specific items
    await app.events.treeProviderContextMenu.sendAsync(ctxEvent);

    // 3. Parent callback — final additions/modifications
    this.props.onContextMenu?.(ctxEvent);
};
```

**Step 2d: Add `onContextMenu` prop to TreeProviderView**

```typescript
interface TreeProviderViewProps {
    // ... existing props ...
    /** Called after generic + event channel items are added. Parent can add/modify items. */
    onContextMenu?: (event: ContextMenuEvent<ITreeProviderItem>) => void;
}
```

PageNavigator uses `onContextMenu` to add "Make Root":

```typescript
const handleContextMenu = useCallback((event: ContextMenuEvent<ITreeProviderItem>) => {
    const item = event.target;
    if (item?.isDirectory && provider.navigable) {
        event.items.push({
            label: "Make Root",
            onClick: () => model.makeRoot(item.href),
        });
    }
}, [provider, model]);
```

### Step 3: Create PageNavigator model

File: `src/renderer/ui/navigation/PageNavigatorModel.ts`

Manages state persistence (similar to NavPanelModel but simpler):

```typescript
interface PageNavigatorState {
    open: boolean;
    width: number;
    rootPath: string;      // FileTreeProvider root
}

interface PageNavigatorSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
}

class PageNavigatorModel {
    state: TComponentState<PageNavigatorState>;
    treeState: TreeProviderViewSavedState | undefined;
    id: string | undefined;

    constructor(rootPath: string) { /* ... */ }

    restore(id: string): Promise<void>;    // Load from cache
    setTreeState(state: TreeProviderViewSavedState): void;
    setWidth(width: number): void;
    toggle(): void;
    close(): void;
    navigateUp(): void;        // rootPath = dirname(rootPath)
    makeRoot(path: string): void;  // rootPath = path
}
```

### Step 4: Create PageNavigator component

File: `src/renderer/ui/navigation/PageNavigator.tsx`

```
┌─────────────────────────────────┐
│ [↑] [⟳] [≡] [×]    (toolbar)  │
├─────────────────────────────────┤
│                                 │
│  TreeProviderView               │
│  (FileTreeProvider)             │
│                                 │
│                                 │
└─────────────────────────────────┘
```

Toolbar buttons:
- **Move Up** `[↑]` — only when `provider.navigable` and `dirname(rootPath) !== rootPath`. Calls `model.navigateUp()` which changes `rootPath` → new FileTreeProvider created.
- **Collapse All** `[≡]` — calls `treeProviderRef.collapseAll()`
- **Refresh** `[⟳]` — calls `treeProviderRef.refresh()`
- **Close** `[×]` — calls `model.close()`

File opening — through the full raw link pipeline:
```typescript
const handleItemClick = useCallback((item: ITreeProviderItem) => {
    app.events.openRawLink.sendAsync(new RawLinkEvent(
        item.href,
        undefined,
        { pageId }
    ));
}, [pageId]);
```

Folder double-click (when `provider.navigable`):
```typescript
const handleFolderDoubleClick = useCallback((item: ITreeProviderItem) => {
    if (provider.navigable) {
        model.makeRoot(item.href);
    }
}, [provider, model]);
```

Extra context menu items (passed to TreeProviderView via `getExtraMenuItems`):
- **Make Root** (folders only, when `provider.navigable`)
- **Open in New Tab** — `app.events.openRawLink.sendAsync(new RawLinkEvent(item.href))`
- **Open in New Window** — `pagesModel.openPathInNewWindow(item.href)`
- **Show in File Explorer** — `api.showItemInFolder(item.href)` (files) / `api.showFolder(item.href)` (folders)

### Step 5: Create FileTreeProvider on rootPath change

```typescript
const provider = useMemo(() => {
    return new FileTreeProvider(rootPath);
}, [rootPath]);
```

When `model.navigateUp()` or `model.makeRoot()` changes rootPath, a new provider is created and TreeProviderView rebuilds.

### Step 6: State persistence

- `model.treeState` — saved/restored via `initialState` / `onStateChange` on TreeProviderView
- Persistence to cache file via `model.restore(id)` / debounced save
- No scroll position restoration — future page container redesign will prevent remounting

### Step 7: Wire into Pages layout

For now, PageNavigator will coexist with NavigationPanel. We need to decide where to render it. Options:
- Replace NavigationPanel usage in `Pages.tsx` directly
- Or add a flag/setting to switch between old and new

**Resolution: replace directly in Pages.tsx.** The old NavigationPanel code stays in its files as reference. Pages.tsx switches from `<NavigationPanel>` to `<PageNavigator>`. If something breaks, we can revert the one-line change.

**Note:** This also requires updating `NavPanelModel` references in page models to use `PageNavigatorModel`. Or we can keep `NavPanelModel` temporarily and have `PageNavigator` accept it as a prop (adapter pattern). **Decision needed during implementation.**

## Files Changed

| File | Change |
|---|---|
| `src/renderer/api/events/events.ts` | Add `target` and `metadata` to `RawLinkEvent` constructor |
| `src/renderer/api/types/io.events.d.ts` | Add `target` and `metadata` to `IRawLinkEvent` interface |
| `src/renderer/content/parsers.ts` | All parsers pass through `event.target` and `event.metadata` to `OpenLinkEvent` |
| `src/renderer/api/events/AppEvents.ts` | Add `treeProviderContextMenu` event channel |
| `src/renderer/content/tree-context-menus.ts` | **NEW** — default context menu handlers (file items, link items) |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Add `onContextMenu` prop |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Fire event channel + call `onContextMenu` in context menu handler |
| `src/renderer/ui/navigation/PageNavigator.tsx` | **NEW** — main component |
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | **NEW** — state management, persistence |
| `src/renderer/ui/app/Pages.tsx` | Swap NavigationPanel → PageNavigator |

## Files NOT Changed

- `src/renderer/ui/navigation/NavigationPanel.tsx` — kept as reference
- `src/renderer/ui/navigation/nav-panel-store.ts` — kept (NavPanelModel still used by other code)
- `src/renderer/ui/navigation/NavigationSearchModel.ts` — kept as reference
- `src/renderer/ui/navigation/SearchResultsPanel.tsx` — kept as reference
- `src/renderer/components/file-explorer/` — kept as reference

## Concerns

1. **NavPanelModel vs PageNavigatorModel:** Multiple places create `NavPanelModel` (TextToolbar, ImageViewer, PdfViewer, PagesLifecycleModel). Creating a new `PageNavigatorModel` means updating all these creation points. **Resolution options:** (a) Update all creation points to use PageNavigatorModel. (b) Keep NavPanelModel temporarily, have PageNavigator accept it as prop and extract what it needs. (c) Make PageNavigatorModel compatible with NavPanelModel interface. **Decision: option (a) — update creation points. It's a find-and-replace, not complex logic. NavPanelModel creation sites just need to create PageNavigatorModel instead.**

2. **~~openRawLink pipeline with pageId~~** — **Resolved.** `RawLinkEvent` enhanced with optional `target` and `metadata`. Parsers pass them through to `OpenLinkEvent`. The open handler already checks `metadata.pageId` and calls `navigatePageTo` if present (EPIC-012 design). Verify during implementation.

3. **Backward compatibility for cache files:** Old pages have NavPanelModel state in cache. New PageNavigatorModel reads a different format. **Resolution: PageNavigatorModel.restore() checks for old NavPanelModel format and migrates. Both store expandedPaths — same structure.**

4. **~~Scroll position across navigation~~** — **Resolved: not implemented.** Future page container redesign will prevent remounting on navigation, making scroll restoration unnecessary. Out of scope for this epic.

## Acceptance Criteria

- [ ] `PageNavigator` component renders TreeProviderView with FileTreeProvider
- [ ] Header toolbar: Move Up (when navigable), Collapse All, Refresh, Close
- [ ] File click opens through `api.events.openRawLink` pipeline with `pageId` metadata
- [ ] Folder double-click → Make Root (when navigable)
- [ ] Move Up navigates to parent directory
- [ ] Context menu 3-layer architecture: generic (Copy Path, Rename, Delete) → event channel (Show in File Explorer, Open in New Tab, Open in New Window) → parent (Make Root)
- [ ] `app.events.treeProviderContextMenu` event channel with default file handler
- [ ] State persistence (expanded paths, root path, width)
- [ ] Content search NOT included (returns in Phase 5)
- [ ] Archive logic NOT included (comes in task 3.2)
- [ ] Old NavigationPanel kept untouched
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
