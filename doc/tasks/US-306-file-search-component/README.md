# US-306: FileSearch Component

**Status:** Planned
**Epic:** EPIC-015 (Phase 4)
**Depends on:** US-305 (CollapsiblePanelStack expand history)

## Goal

Create a standalone `FileSearch` component that provides file content search with progressive results. Reuses the existing main-process search service (`search-service.ts`) and IPC channels. The component is self-contained — receives `folder`, `state`, `onStateChange` props — making it reusable in PageNavigator and potentially as a standalone `.search.json` editor in the future.

## Background

### Existing infrastructure (reusable as-is)

| Module | Location | Role | Changes needed |
|---|---|---|---|
| `search-service.ts` | `src/main/search-service.ts` | Main process: iterative directory walk, picomatch globs, streaming results | None |
| `search-ipc.ts` | `src/ipc/search-ipc.ts` | IPC channel names + default constants (extensions, exclude patterns, max file size) | None |
| Settings | `search-extensions`, `search-max-file-size` | User-configurable search parameters | None |

### Existing code to extract/adapt

| Module | Location | Lines | What to extract |
|---|---|---|---|
| `NavigationSearchModel.ts` | `src/renderer/ui/navigation/` | 296 | Search state management, IPC communication, debounced search, search ID system, cancellation |
| `SearchResultsPanel.tsx` | `src/renderer/ui/navigation/` | 212 | Result display: expandable file groups, match line highlighting, context window |

### New component design

```
FileSearch (standalone component)
  ├── FileSearchModel          — state + IPC (extracted from NavigationSearchModel)
  ├── FileSearchInput          — query input + filter toggle + include/exclude patterns
  ├── FileSearchResults        — virtualized results (adapted from SearchResultsPanel)
  └── FileSearchStatus         — progress bar / "X matches in Y files" / "Searching..."
```

Props:
```typescript
interface FileSearchProps {
    /** Root folder to search in */
    folder: string;
    /** Optional subfolder scope (from "Search in folder" context menu) */
    searchFolder?: string;
    /** Restored state (query, results, filters) */
    state?: FileSearchState;
    /** Called when state changes (for persistence) */
    onStateChange?: (state: FileSearchState) => void;
    /** Called when user clicks a search result */
    onResultClick?: (filePath: string, lineNumber?: number) => void;
}
```

### State persistence

Unlike the old NavigationSearchModel (which lost state on restart), the new FileSearch persists its state via `onStateChange`. NavigationData saves it to the cache file. On restore, the last query and results are shown (no re-search needed — results are stored).

```typescript
interface FileSearchState {
    query: string;
    includePattern: string;
    excludePattern: string;
    showFilters: boolean;
    /** Flat array of file + line rows (full result, not filtered) */
    results: SearchResultRow[];
    totalMatches: number;
    totalFiles: number;
    /** Folder being searched (may differ from root if scoped) */
    searchFolder?: string;
}
```

## Implementation Plan

### Step 1: Create FileSearchModel

Extract from `NavigationSearchModel.ts` into `src/renderer/components/file-search/FileSearchModel.ts`:

Core responsibilities:
- State management via `TComponentState<FileSearchInternalState>`
- Search ID system (increment counter, ignore stale results)
- Debounced search (500ms) with immediate search via Enter
- IPC communication: send `SearchChannel.start`, listen for `result`/`progress`/`complete`/`error`
- Auto-cancel previous search on new request
- Cleanup IPC listeners on dispose

Key differences from NavigationSearchModel:
- **No dependency on NavPanelModel** — standalone, receives `rootPath` as prop
- **Supports `searchFolder` scope** — can search a subfolder
- **Emits state changes** via callback for persistence
- **Can restore state** (query, results) from saved data

### Step 2: Create FileSearchResults component

`src/renderer/components/file-search/FileSearchResults.tsx` — virtualized results using RenderGrid:

**Data model:**
```typescript
type SearchResultRow =
    | { type: "file"; filePath: string; matchedLinesCount: number; expanded: boolean }
    | { type: "line"; filePath: string; lineNumber: number; lineText: string; matchStart: number; matchLength: number };
```

Two arrays maintained by the model:
- `fullResult: SearchResultRow[]` — complete flat list (file + line rows interleaved)
- `filteredResult: SearchResultRow[]` — display list (collapsed files have lines removed)

When IPC streams a `FileSearchResult`, append a file row + its line rows to `fullResult`. Rebuild `filteredResult` based on expanded states.

**RenderGrid integration:**
- `rowCount = filteredResult.length`
- `renderCell(p)` → check `filteredResult[p.row].type`:
  - `"file"` → render: collapse/expand chevron + filename + parent dir name + match count badge
  - `"line"` → render: indented line number + highlighted match text (60-char context window)
- Row height: ~22px for both types

**Interactions:**
- File row collapse/expand button click → toggle `expanded`, rebuild `filteredResult`, refresh grid
- File row click → `onResultClick(filePath)`
- Line row click → `onResultClick(filePath, lineNumber)`

### Step 3: Create FileSearch component

`src/renderer/components/file-search/FileSearch.tsx` — combines model + input + results:

```tsx
<FileSearchRoot>
    <div className="search-input-area">
        <TextField value={query} onChange={model.setQuery} onKeyDown={handleKeyDown} />
        <Button onClick={model.toggleFilters}><FilterIcon /></Button>
        {showFilters && (
            <>
                <TextField value={includePattern} onChange={model.setIncludePattern} placeholder="Include (e.g. *.ts)" />
                <TextField value={excludePattern} onChange={model.setExcludePattern} placeholder="Exclude (e.g. node_modules)" />
            </>
        )}
    </div>
    <div className="search-status">
        {isSearching ? `Searching... ${filesSearched} files` : `${totalMatches} matches in ${totalFiles} files`}
    </div>
    <div className="search-results">
        <FileSearchResults results={results} query={query} onMatchClick={handleMatchClick} />
    </div>
</FileSearchRoot>
```

### Step 4: Handle state persistence

FileSearch calls `onStateChange` when search completes or state changes:
```typescript
// After search completes:
onStateChange?.({
    query: state.query,
    includePattern: state.includePattern,
    excludePattern: state.excludePattern,
    showFilters: state.showFilters,
    results: state.results,
    totalMatches: state.totalMatches,
    totalFiles: state.totalFiles,
    searchFolder: state.searchFolder,
});
```

On mount with `state` prop: restore query and results without re-searching. User sees last search results immediately.

### Step 5: Keyboard shortcuts

- **Enter** in query input → immediate search (bypass debounce)
- **Escape** in query input → clear query if non-empty, or blur input
- **Ctrl+Shift+F** (handled by parent PageNavigator, not FileSearch) → open search panel + focus input

### Step 6: Export and index

Create `src/renderer/components/file-search/index.ts` barrel export:
```typescript
export { FileSearch } from "./FileSearch";
export type { FileSearchProps, FileSearchState } from "./FileSearch";
```

## Resolved Concerns

### 1. Result virtualization — RenderGrid with flat array

Use RenderGrid from the start. Build two arrays:
- `fullResult` — complete search results as a flat array of two item types:
  ```typescript
  type SearchResultRow =
      | { type: "file"; filePath: string; matchedLinesCount: number; expanded: boolean }
      | { type: "line"; filePath: string; lineNumber: number; lineText: string; matchStart: number; matchLength: number };
  ```
- `filteredResult` — display array built from `fullResult` by including file rows always and line rows only when the file is expanded.

In RenderGrid `renderCell`: check `filteredResult[row].type` → render file entry (with collapse/expand button + filename + match count) or line entry (with line number + highlighted match text).

On collapse/expand: toggle `expanded` flag on the file row, rebuild `filteredResult`, refresh the grid.

Click behavior:
- **File row click** → navigate to file
- **Line row click** → navigate to file + scroll to line (`revealLine`)

### 2. IPC listener cleanup — search ID system

Each FileSearch instance generates unique search IDs. Results with mismatched IDs are ignored. This handles multiple instances sharing the same IPC channels.

### 3. Re-search vs restore — display saved results

Display saved results on mount. No auto-re-search. User presses Enter or clicks Refresh button to re-search. Same as VSCode behavior.

### 4. searchFolder scope display — in panel header

Display folder name in the Search panel header (set by parent PageNavigator via title prop):
```
Search [components]   <refresh button> <close button>
```

- `"Search [folderName]"` label is truncatable with ellipsis if PageNavigator is narrow
- Full folder path shown in hover tooltip over the label
- Panel header uses CollapsiblePanel's `title` prop (ReactNode) and `buttons` prop

## Files Created

| File | Description |
|---|---|
| `src/renderer/components/file-search/FileSearch.tsx` | Main component: input + filters + status + results |
| `src/renderer/components/file-search/FileSearchModel.ts` | State management, IPC communication, search logic |
| `src/renderer/components/file-search/FileSearchResults.tsx` | Result display: expandable file groups, match highlighting |
| `src/renderer/components/file-search/index.ts` | Barrel export |

## Files NOT Changed

- `src/main/search-service.ts` — reused as-is
- `src/ipc/search-ipc.ts` — reused as-is
- `src/renderer/ui/navigation/NavigationSearchModel.ts` — kept as reference (old code)
- `src/renderer/ui/navigation/SearchResultsPanel.tsx` — kept as reference (old code)
- `src/renderer/ui/navigation/PageNavigator.tsx` — integration is a separate task (US-4.3)

## Acceptance Criteria

- [ ] FileSearch renders: query input, filter toggle, include/exclude patterns, status, results
- [ ] Search triggers on debounce (500ms) and immediately on Enter
- [ ] Progressive results stream in while searching
- [ ] File groups expandable with match line highlights
- [ ] Click on match line calls `onResultClick(filePath, lineNumber)`
- [ ] State persists via `onStateChange` callback
- [ ] Restores saved state (query + results) on mount
- [ ] Search cancels when query changes or component unmounts
- [ ] Scoped search (`searchFolder` prop) works correctly
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
