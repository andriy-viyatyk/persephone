# US-307: Search Panel in PageNavigator

**Status:** Planned
**Epic:** EPIC-015 (Phase 4)
**Depends on:** US-305 (CollapsiblePanelStack expand history), US-306 (FileSearch component)

## Goal

Integrate the FileSearch component into PageNavigator as a collapsible "Search" panel between Explorer and secondary (Archive) panels. Add search entry points: search icon on Explorer header and "Search in folder" context menu on folders.

## Background

### Current PageNavigator panel layout

```
┌─────────────────────────┐
│ Explorer  [↑] [⊟][↻][✕]│  ← always present
│ │ TreeProviderView      │ │
├─────────────────────────┤
│ Archive         [⊟] [↻]│  ← conditional (when zip selected)
└─────────────────────────┘
```

### Target layout with Search panel

```
┌─────────────────────────┐
│ Explorer [↑][🔍][⊟][↻][✕]│  ← search icon added
│ │ TreeProviderView      │ │
├─────────────────────────┤
│ Search [components] [↻][✕]│ ← conditional (when opened)
│ │ FileSearch            │ │
├─────────────────────────┤
│ Archive         [⊟] [↻]│  ← conditional (when zip selected)
└─────────────────────────┘
```

### Search panel behavior

- **Not visible by default** — appears when user opens search
- **Two entry points:**
  1. Search icon button in Explorer panel header → opens search for Explorer's root folder
  2. Right-click folder in Explorer → "Search in folder" → opens search scoped to that folder
- **Panel header:** `Search [folderName]` with ellipsis on overflow + full path tooltip. Buttons: Refresh (re-run search) + Close (hide search panel)
- **`activePanel` treats "search" === "explorer"** — expanding Search doesn't change the active provider. Page stays on whatever was last navigated to.
- **State persisted** in NavigationData → survives app restart with saved query + results
- **Close** clears search state and hides the panel

### Search result navigation

When user clicks a search result:
- **File row** → navigate to file (via `openRawLink` with `pageId`)
- **Line row** → navigate to file + scroll to line (`revealLine` in metadata + `highlightText`)
- Search panel stays expanded with results visible
- Explorer tree does NOT auto-expand/select the file (only when user manually expands Explorer)

## Implementation Plan

### Step 1: Add search state to NavigationData

Add to `NavigationData`:
```typescript
/** Whether search panel is visible. */
searchOpen = false;
/** Persisted search state (query, results, filters). */
searchState: FileSearchState | undefined = undefined;
```

Add to `NavigationSavedState`:
```typescript
searchOpen?: boolean;
searchState?: FileSearchState;
```

Update `_saveState()` to include search fields. Update `restore()` to restore them.

Methods:
```typescript
openSearch(folder?: string): void {
    this.searchOpen = true;
    if (folder) {
        // Scoped search — update searchState folder
        this.searchState = { ...(this.searchState ?? defaultSearchState), searchFolder: folder };
    }
    this._saveStateDebounced();
}

closeSearch(): void {
    this.searchOpen = false;
    this.searchState = undefined;
    this._saveStateDebounced();
}

setSearchState(state: FileSearchState): void {
    this.searchState = state;
    this._saveStateDebounced();
}
```

### Step 2: Add search icon to Explorer buttons

In PageNavigator's `explorerButtons`, add a search icon button before Collapse All:

```tsx
<Button
    type="icon"
    size="small"
    title="Search"
    onClick={handleOpenSearch}
>
    <SearchIcon width={14} height={14} />
</Button>
```

Handler:
```typescript
const handleOpenSearch = useCallback(() => {
    navigationData.openSearch(rootPath);
}, [navigationData, rootPath]);
```

### Step 3: Add "Search in folder" context menu

In PageNavigator's `handleContextMenu`, add a "Search in folder" item for directories:

```typescript
if (item?.isDirectory) {
    event.items.push({
        label: "Search in Folder",
        icon: <SearchIcon />,
        onClick: () => navigationData.openSearch(item.href),
    });
}
```

This can also be added to `tree-context-menus.tsx` as a global handler, but since it needs access to `navigationData`, it's simpler to add in PageNavigator's `handleContextMenu`.

### Step 4: Render Search panel in CollapsiblePanelStack

Between Explorer and Secondary panels:

```tsx
<CollapsiblePanelStack
    activePanel={navigationData.activePanel}
    setActivePanel={handleSetActivePanel}
    style={{ flex: "1 1 auto" }}
>
    <CollapsiblePanel id="explorer" title="Explorer" buttons={explorerButtons}>
        <TreeProviderView ... />
    </CollapsiblePanel>
    {navigationData.searchOpen && (
        <CollapsiblePanel
            id="search"
            title={searchTitle}
            buttons={searchButtons}
        >
            <FileSearch
                folder={rootPath}
                state={navigationData.searchState}
                onStateChange={navigationData.setSearchState}
                onResultClick={handleSearchResultClick}
            />
        </CollapsiblePanel>
    )}
    {secondaryDescriptor && (
        <CollapsiblePanel id="secondary" ...>...</CollapsiblePanel>
    )}
</CollapsiblePanelStack>
```

### Step 5: Search panel header title and buttons

Title: `Search [folderName]` — truncatable with ellipsis, full path in tooltip:
```tsx
const searchFolder = navigationData.searchState?.searchFolder || rootPath;
const searchFolderName = path.basename(searchFolder);
const searchTitle = (
    <span title={searchFolder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Search [{searchFolderName}]
    </span>
);
```

Buttons: Refresh + Close:
```tsx
const searchButtons = (
    <>
        <Button type="icon" size="small" title="Refresh Search" onClick={handleRefreshSearch}>
            <RefreshIcon width={14} height={14} />
        </Button>
        <Button type="icon" size="small" title="Close Search" onClick={handleCloseSearch}>
            <CloseIcon width={14} height={14} />
        </Button>
    </>
);
```

### Step 6: Search result click handler

```typescript
const handleSearchResultClick = useCallback((filePath: string, lineNumber?: number) => {
    const metadata: ILinkMetadata = { pageId };
    if (lineNumber) {
        metadata.revealLine = lineNumber;
        metadata.highlightText = navigationData.searchState?.query;
    }
    app.events.openRawLink.sendAsync(new RawLinkEvent(filePath, undefined, metadata));
}, [pageId, navigationData]);
```

### Step 7: Update activePanel handling

`activePanel` type changes from `"explorer" | "secondary"` to `"explorer" | "search" | "secondary"`.

When search panel is expanded: treat as "explorer" for provider purposes:
```typescript
get activeProvider(): ITreeProvider | null {
    return this.activePanel === "secondary"
        ? this.secondaryProvider
        : this.treeProvider;  // "explorer" and "search" both use primary provider
}
```

When `handleSetActivePanel` is called with `"search"`:
- No provider creation needed
- No navigation — the page stays on whatever was last shown
- Just expand the search panel

### Step 8: Auto-expand search panel on open

When `openSearch()` is called, set `activePanel` to `"search"` so the panel auto-expands:
```typescript
openSearch(folder?: string): void {
    this.searchOpen = true;
    this.activePanel = "search";
    if (folder) {
        this.searchState = { ...(this.searchState ?? emptySearchState), searchFolder: folder };
    }
    this._saveStateDebounced();
}
```

### Step 9: Filter toggle button on search input

The FileSearch component has `showFilters` state for include/exclude patterns. We should add a filter toggle button. This can be added in two ways:
- (a) Inside FileSearch component itself (next to the query input)
- (b) In the search panel header buttons

Option (a) is better — keeps it self-contained within FileSearch. Add a small filter icon button next to the search input in `FileSearch.tsx`.

## Concerns

### 1. activePanel type expansion — affects NavigationData persistence

Adding `"search"` to `activePanel` type requires updating:
- `NavigationData.activePanel` type
- `NavigationSavedState.activePanel` type
- `setActivePanel()` method
- `handleSetActivePanel` in PageNavigator
- Panel switch navigation logic (search panel = no navigation)

This is straightforward but touches multiple places.

### 2. Search panel close vs hide

When user clicks Close on search panel:
- (a) Clear search state entirely (query, results, filters) — fresh next time
- (b) Just hide the panel, preserve state — user can reopen and see previous results

Per the design decision: close clears state and hides. If user wants persistent results, they can use the future `.search.json` editor.

### 3. Filter toggle button placement

FileSearch component currently has `showFilters` state but no UI button to toggle it. Need to add a small filter button. Options:
- Inside the search input area (e.g., icon button at the end of the query TextField)
- As a separate row below the query input

Keep it simple — a small icon button at the right of the query input field.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | Add searchOpen, searchState, openSearch(), closeSearch(), setSearchState(). Expand activePanel type. Update persistence. |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Add search icon to Explorer buttons, render Search panel, search result click handler, "Search in folder" context menu |
| `src/renderer/components/file-search/FileSearch.tsx` | Add filter toggle button to query input area |

## Files NOT Changed

- `src/renderer/components/file-search/FileSearchModel.ts` — standalone, no changes
- `src/renderer/components/layout/CollapsiblePanelStack.tsx` — already supports 3+ panels with history
- `src/renderer/content/tree-context-menus.tsx` — "Search in folder" added in PageNavigator instead (needs NavigationData access)

## Acceptance Criteria

- [ ] Search icon button appears in Explorer panel header
- [ ] Clicking search icon opens Search panel for root folder
- [ ] Right-click folder → "Search in folder" opens Search panel scoped to that folder
- [ ] Search panel shows between Explorer and Archive panels
- [ ] Search panel header: "Search [folderName]" with ellipsis + tooltip
- [ ] Refresh button in header re-runs search
- [ ] Close button hides panel and clears state
- [ ] Clicking file result navigates to file
- [ ] Clicking line result navigates to file + scrolls to line + highlights query text
- [ ] Search state persists across app restart (query + results restored)
- [ ] Expanding Search panel doesn't change the active provider
- [ ] CollapsiblePanelStack expand history works with 3 panels
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
