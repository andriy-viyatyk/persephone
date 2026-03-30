# US-302: Secondary Provider Support in PageNavigator

**Status:** Planned
**Epic:** EPIC-015 (Phase 3)
**Depends on:** US-301 (panel headers), US-303 (link-utils), US-304 (persistence refactoring), US-292 (ZipTreeProvider)

## Goal

Enable PageNavigator to show a secondary tree provider panel (Archive/Links) when the user selects a zip file in the Explorer panel. The secondary panel appears collapsed below the Explorer panel. Expanding it creates the provider lazily (async), navigates to the provider's root, and shows its content in CategoryEditor. Only one panel is expanded at a time.

## Background

### Multi-Provider Architecture

NavigationData gets a **secondary provider descriptor** and lazy async provider creation:

```
NavigationData
  ├── treeProvider              // FileTreeProvider (primary, always present)
  ├── secondaryDescriptor       // { type, sourceUrl, label } | null
  ├── secondaryProvider         // ITreeProvider | null (lazy created)
  ├── activePanel               // "explorer" | "secondary"
  ├── selectionState            // explorer selection { selectedHref }
  ├── secondarySelectionState   // secondary selection { selectedHref }
  ├── activeProvider            // getter → treeProvider or secondaryProvider
  └── activeSelectionState      // getter → based on activePanel
```

### Secondary Provider Lifecycle

1. **Descriptor set** — user selects zip file → `secondaryDescriptor = { type: "zip", sourceUrl: "C:/data.zip", label: "Archive" }`
2. **Provider NOT created yet** — panel header appears but collapsed
3. **User clicks to expand** → calls `createSecondaryProvider()` (async)
   - For zip: creates `ZipTreeProvider(sourceUrl)` — fast (uses `archiveService` internally)
   - For link (future): reads file via pipe, may prompt password — truly async
   - Success → sets `secondaryProvider`, expands panel, auto-selects root
   - Failure → stays collapsed
4. **User selects different non-archive file** → `secondaryDescriptor = null`, `secondaryProvider?.dispose()`, `secondaryProvider = null`, panel disappears
5. **User selects another zip** → old secondary disposed, new descriptor set, panel shows collapsed

### Panel Switch Triggers Navigation

When user expands a panel:
- **Expanding Explorer** → page navigates to explorer's `selectionState.selectedHref`
- **Expanding Secondary** → page navigates to secondary's root (first open) or `secondarySelectionState.selectedHref` (subsequent)

This keeps the editor content always in sync with the active panel.

### CategoryEditor Integration

CategoryEditor currently reads `navigationData.treeProvider`. With multi-provider it uses `activeProvider` getter:

```typescript
// Before
const provider = navData?.treeProvider ?? null;

// After
const provider = navData?.activeProvider ?? null;
```

`activeProvider` returns `treeProvider` or `secondaryProvider` based on `activePanel`. CategoryEditor also uses `activeSelectionState` instead of `selectionState`. This way CategoryEditor automatically shows the correct provider's content when panels switch.

### tree-category:// Links with Secondary Provider

When user clicks a folder in the Archive panel:
1. ZipTreeProvider's `getNavigationUrl(item)` returns a `tree-category://` link with `{ type: "zip", url: sourceUrl, category: innerPath }`
2. Link fires through `openRawLink` → parser → `openLink` → category-view editor
3. CategoryEditor opens, reads `navData.activeProvider` → gets ZipTreeProvider (because secondary panel is active)
4. CategoryEditor displays the folder contents from ZipTreeProvider

When user switches back to Explorer panel:
1. PageNavigator fires `openRawLink` with the explorer's selected file href
2. Page navigates to the file, CategoryEditor is replaced by the file's editor

### ZipTreeProvider Construction

ZipTreeProvider takes only `sourceUrl` (local file path). It uses `archiveService` internally to read archive entries. No ContentPipe needed for local archives. The US-303 pipe utilities (`resolveUrlToPipeDescriptor`) are for future HTTP archive support.

```typescript
// Simple construction for local archives
const provider = new ZipTreeProvider(sourceUrl);
```

### Archive Detection

`file-path.ts` has `isArchiveFile(filePath)` checking against `ARCHIVE_EXTENSIONS`:
`.zip`, `.docx`, `.xlsx`, `.pptx`, `.jar`, `.war`, `.epub`, `.odt`, `.ods`, `.odp`

This includes Office document formats (`.docx`, `.xlsx`) which are technically ZIP but users don't typically browse as archives.

### NavigationData Transfer

`navigatePageTo` in `PagesLifecycleModel` transfers the entire `navigationData` object from old to new page model (lines 373-457). Since secondary provider state lives on NavigationData, it transfers automatically — no special handling needed.

## Implementation Plan

### Step 1: Define SecondaryDescriptor type

```typescript
// In NavigationData.ts or a shared types file
export interface SecondaryDescriptor {
    type: string;       // "zip", "link" (future)
    sourceUrl: string;  // path to archive or .link.json
    label: string;      // "Archive", "Links"
}
```

### Step 2: Add secondary provider state to NavigationData

New properties:
```typescript
secondaryDescriptor: SecondaryDescriptor | null = null;
secondaryProvider: ITreeProvider | null = null;
readonly secondarySelectionState = new TOneState<NavigationState>({ selectedHref: null });
activePanel: "explorer" | "secondary" = "explorer";
```

New getters:
```typescript
get activeProvider(): ITreeProvider | null {
    return this.activePanel === "secondary"
        ? this.secondaryProvider
        : this.treeProvider;
}

get activeSelectionState(): TOneState<NavigationState> {
    return this.activePanel === "secondary"
        ? this.secondarySelectionState
        : this.selectionState;
}
```

New methods:
```typescript
setSecondaryDescriptor(desc: SecondaryDescriptor | null): void {
    if (this.secondaryDescriptor?.sourceUrl === desc?.sourceUrl) return; // same file
    this.secondaryProvider?.dispose?.();
    this.secondaryProvider = null;
    this.secondaryDescriptor = desc;
    this.secondarySelectionState.set({ selectedHref: null });
    if (!desc && this.activePanel === "secondary") {
        this.activePanel = "explorer";
    }
}

clearSecondary(): void {
    this.setSecondaryDescriptor(null);
}

async createSecondaryProvider(): Promise<ITreeProvider | null> {
    const desc = this.secondaryDescriptor;
    if (!desc) return null;
    if (this.secondaryProvider) return this.secondaryProvider;

    switch (desc.type) {
        case "zip": {
            const { ZipTreeProvider } = await import("../../content/tree-providers/ZipTreeProvider");
            this.secondaryProvider = new ZipTreeProvider(desc.sourceUrl);
            return this.secondaryProvider;
        }
        case "link":
            // Phase 4 — not implemented yet
            return null;
        default:
            return null;
    }
}

setActivePanel(panel: "explorer" | "secondary"): void {
    this.activePanel = panel;
    // Persist
    this.pageNavigatorModel?.saveState();
}
```

Update `dispose()` to clean up secondary provider.

### Step 3: Persist secondary state in NavigationData

After US-304, NavigationData owns the cache file. Add secondary fields to the saved state:

```typescript
// Additional fields in NavigationData's saveState():
activePanel: this.activePanel,
secondaryDescriptor: this.secondaryDescriptor,
secondarySelectedHref: this.secondarySelectionState.get().selectedHref,
secondaryFileExplorerState: this.secondaryFileExplorerState,
```

On restore: load secondary descriptor and tree expansion state. Reset `activePanel` to "explorer". Provider is NOT restored — recreated lazily when user clicks to expand. Navigate to Explorer's `selectedHref`.

### Step 4: Change CollapsiblePanel `title` from `string` to `ReactNode`

This allows passing loading indicators after the title text:
```tsx
<CollapsiblePanel title={<>Archive <CircularProgress /></>} ... />
```

Update `CollapsiblePanelProps.title` type and rendering in `CollapsiblePanelStack`.

### Step 5: Update PageNavigator to render secondary panel

Replace the single `CollapsiblePanel` with conditional two panels:

```tsx
<CollapsiblePanelStack
    activePanel={navigationData.activePanel}
    setActivePanel={handleSetActivePanel}
    style={{ flex: "1 1 auto" }}
>
    <CollapsiblePanel id="explorer" title="Explorer" buttons={explorerButtons}>
        <TreeProviderView
            ref={treeProviderRef}
            provider={provider}
            selectedHref={selectedHref ?? undefined}
            onItemClick={handleItemClick}
            ...
        />
    </CollapsiblePanel>
    {secondaryDescriptor && (
        <CollapsiblePanel
            id="secondary"
            title={secondaryLoading ? <>{secondaryDescriptor.label} <CircularProgress /></> : secondaryDescriptor.label}
            buttons={secondaryButtons}
        >
            {secondaryProvider ? (
                <TreeProviderView
                    ref={secondaryTreeRef}
                    provider={secondaryProvider}
                    selectedHref={secondarySelectedHref ?? undefined}
                    onItemClick={handleSecondaryItemClick}
                    ...
                />
            ) : null}
        </CollapsiblePanel>
    )}
</CollapsiblePanelStack>
```

Secondary panel buttons: Collapse All + Refresh (no Close, no Navigate Up — ZipTreeProvider is not navigable).

`secondaryLoading` is a local state set with a 200ms delay — if `createSecondaryProvider()` resolves within 200ms, no loading indicator shown.

### Step 6: Handle panel switch with async provider creation

```typescript
const handleSetActivePanel = useCallback(async (panelId: string) => {
    if (panelId === navigationData.activePanel) return;

    if (panelId === "secondary") {
        // Lazy create provider
        const provider = await navigationData.createSecondaryProvider();
        if (!provider) return; // creation failed, stay on current panel
    }

    navigationData.setActivePanel(panelId as "explorer" | "secondary");

    // Navigate to the active panel's selection
    const activeProvider = navigationData.activeProvider;
    if (!activeProvider) return;

    const sel = navigationData.activeSelectionState.get().selectedHref;
    if (sel) {
        // Resolve href → navigation URL via provider
        const url = await activeProvider.getNavigationUrlByHref(sel);
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
    } else if (panelId === "secondary") {
        // First time opening secondary — navigate to root
        const rootUrl = await activeProvider.getNavigationUrlByHref(activeProvider.rootPath);
        app.events.openRawLink.sendAsync(new RawLinkEvent(rootUrl, undefined, { pageId }));
    }
}, [navigationData, pageId]);
```

### Step 7: Detect archive files on item click

In PageNavigator's `handleItemClick`, after setting selection and navigating:

```typescript
// After existing navigation logic:
if (!item.isDirectory) {
    if (isArchiveFile(item.href)) {
        navigationData.setSecondaryDescriptor({
            type: "zip",
            sourceUrl: item.href,
            label: "Archive",
        });
    } else {
        navigationData.clearSecondary();
    }
}
```

Uses `isArchiveFile` from `file-path.ts`.

### Step 8: Secondary panel item click handler

```typescript
const handleSecondaryItemClick = useCallback((item: ITreeProviderItem) => {
    const current = navigationData.secondarySelectionState.get().selectedHref;
    if (current?.toLowerCase() === item.href.toLowerCase()) return;
    navigationData.setSecondarySelectedHref(item.href);
    const url = navigationData.secondaryProvider?.getNavigationUrl(item) ?? item.href;
    app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
}, [pageId, navigationData]);
```

Need to add `setSecondarySelectedHref` to NavigationData (similar to `setSelectedHref` but for secondary).

### Step 9: Update CategoryEditor

```typescript
// Before
const provider = navData?.treeProvider ?? null;

// After
const provider = navData?.activeProvider ?? null;
```

CategoryEditor's `handleNavigate` already uses `provider?.getNavigationUrl(item)` which will automatically use the correct provider.

For selection sync, CategoryEditor needs to call the right selection setter:
```typescript
// Before
navData?.setSelectedHref(item.href);

// After — set selection on the active provider's selection state
navData?.activeSelectionState.set({ selectedHref: item.href });
```

### Step 10: Separate refs for each TreeProviderView

```typescript
const treeProviderRef = useRef<TreeProviderViewRef>(null);
const secondaryTreeRef = useRef<TreeProviderViewRef>(null);
```

Explorer buttons use `treeProviderRef.current?.collapseAll()` etc.
Secondary buttons use `secondaryTreeRef.current?.collapseAll()` etc.

### Step 11: State persistence for secondary TreeProviderView

Secondary panel needs its own expansion state saved/restored:

```typescript
const handleSecondaryStateChange = useCallback((state: TreeProviderViewSavedState) => {
    navModel.setSecondaryFileExplorerState({
        expandedPaths: state.expandedPaths,
        selectedFilePath: state.selectedHref,
    });
}, [navModel]);
```

## Resolved Concerns

### 1. Archive extensions — use broad detection

Use `isArchiveFile` as-is — show Archive panel for all formats our ZipTransformer can open (`.zip`, `.docx`, `.xlsx`, `.pptx`, `.jar`, `.war`, `.epub`, `.odt`, `.ods`, `.odp`). Formats like `.7z` and `.rar` use different compression algorithms and are NOT in `ARCHIVE_EXTENSIONS` — they won't show the Archive panel unless we add ZipTransformer support for them later.

### 2. "Open as Archive" context menu — defer

No context menu item in this task. User opens the archive by expanding the secondary panel. A future "Open Archive in separate tab" menu item (opens new tab with ZipTreeProvider in PageNavigator) is tracked separately — see epic Phase 8 (Polishing).

### 3. Async panel expand — delayed loading indicator

Show `CircularProgress` indicator with a delay: if provider creation takes longer than 200ms, show CircularProgress after the panel label (not before — placing it before the label would cause a title jump on every fast zip expansion).

Implementation: CollapsiblePanel's `title` prop changes from `string` to `ReactNode` so we can pass `<>Archive <CircularProgress /></>` when loading. The loading state is managed in PageNavigator — set a `secondaryLoading` flag, start a 200ms timer, clear on provider creation complete.

### 4. Panel switch navigation — resolve through ITreeProvider

Use the provider to resolve the navigation URL from `selectedHref`:
- Find the item in the provider by its href (provider knows its items)
- Call `provider.getNavigationUrl(item)` to construct the URL
- Fire through `openRawLink`

For first-time secondary panel open with no `selectedHref`: use the provider's root path as the selected item and navigate to it (shows CategoryEditor with root contents).

On panel switch, call `provider.getNavigationUrlByHref(selectedHref)` to construct the URL. No changes needed to `NavigationState` — the provider resolves everything from the href. See concern #7 for details.

### 5. CollapsiblePanelStack — conditional children

Will verify during testing that panel removal is handled gracefully. `setSecondaryDescriptor(null)` resets `activePanel` to "explorer" before the panel disappears, so CollapsiblePanelStack should always have a valid `activePanel`.

### 6. Secondary panel tree state — no cross-session restore for reselection

When user selects another file and the secondary panel closes, its tree state is lost. Re-selecting the same zip starts fresh.

However, **full app restart persistence is required**: if the secondary panel was expanded with a file selected, it should still be expanded with the same file selected after restart. This is handled by NavPanelModel persistence (Step 3) — `secondaryDescriptor`, `activePanel`, `secondarySelectedHref`, and `secondaryFileExplorerState` are saved to cache and restored on restart. On restore, the panel header shows but the provider is recreated lazily when the user clicks to expand (or immediately if `activePanel` was "secondary").

## New Concerns (from second review)

### 7. Panel switch navigation — resolved: add `getNavigationUrlByHref` to ITreeProvider

Add a new method to `ITreeProvider` that resolves a raw href to a navigation URL:

```typescript
interface ITreeProvider {
    /** Resolve a stored href back to a navigation URL.
     *  For files returns href. For directories returns tree-category:// link. */
    getNavigationUrlByHref(href: string): Promise<string>;
}
```

Implementations:
- **FileTreeProvider**: calls `stat(href)` → if directory, `encodeCategoryLink(...)`, else `href`
- **ZipTreeProvider**: calls `stat(href)` → same logic

Panel switch becomes:
```typescript
const url = await provider.getNavigationUrlByHref(selectedHref);
app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
```

No stub items, no `isDirectory` in `NavigationState`, no manual checks. The provider encapsulates everything.

### 8. NavPanelModel persistence — resolved: move to NavigationData (US-304)

Persistence moves from NavPanelModel to NavigationData in a separate preparatory task (US-304). NavigationData owns the cache file and persists all navigation state — including secondary provider fields. NavPanelModel becomes a pure reactive state container without save/restore logic. Same cache file name for backward compatibility.

This makes US-302's persistence trivial: just add secondary fields to NavigationData's `saveState()` — no cross-object sync needed.

### 9. App restart restore — resolved: always start with Explorer expanded

On restore: restore `secondaryDescriptor` from cache so the panel header appears. Reset `activePanel` to "explorer" and navigate to Explorer's `selectedHref`. The secondary panel shows collapsed — user clicks to re-expand and recreate ZipTreeProvider.

This avoids:
- Async provider creation during restore
- Password dialogs for encrypted files (future LinkTreeProvider)
- Complex "page without Explorer" scenarios

The TextPageModel-driven detection approach (where the editor detects file type and initiates secondary provider creation) is deferred to Phase 4 when LinkTreeProvider needs encryption support. For US-302, detection stays in PageNavigator (simple extension check for zip files).

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | Add SecondaryDescriptor, secondaryProvider, secondarySelectionState, activePanel, activeProvider getter, createSecondaryProvider(), setSecondaryDescriptor(), clearSecondary() |
| `src/renderer/ui/navigation/nav-panel-store.ts` | Add activePanel, secondaryDescriptor, secondarySelectedHref, secondaryFileExplorerState to persisted state |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Render secondary panel, archive detection on item click, panel switch logic, separate refs and handlers |
| `src/renderer/editors/category/CategoryEditor.tsx` | Use activeProvider + activeSelectionState instead of treeProvider + selectionState |

| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Change `title` prop from `string` to `ReactNode` (for loading indicator) |
| `src/renderer/api/types/io.tree.d.ts` | Add `getNavigationUrlByHref(href)` to ITreeProvider interface |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Implement `getNavigationUrlByHref` |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Implement `getNavigationUrlByHref` |

## Files NOT Changed
- `src/renderer/components/tree-provider/TreeProviderView.tsx` — no changes needed
- `src/renderer/components/tree-provider/CategoryView.tsx` — no changes needed

## Acceptance Criteria

- [ ] Selecting a .zip file in Explorer shows a collapsed "Archive" panel below
- [ ] Clicking the Archive panel header creates ZipTreeProvider and expands the panel
- [ ] Archive panel shows the archive's directory tree
- [ ] Clicking files in the Archive tree opens them (archive path like `file.zip!inner/doc.txt`)
- [ ] Clicking folders in the Archive tree opens CategoryEditor with folder contents
- [ ] Explorer panel collapses when Archive expands (and vice versa)
- [ ] Expanding Explorer navigates back to the explorer's selected file
- [ ] Selecting a non-archive file hides the Archive panel
- [ ] CategoryEditor shows the correct provider based on active panel
- [ ] Secondary state persists across page navigation (navigatePageTo)
- [ ] Secondary tree expansion state persists in NavPanelModel cache
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
