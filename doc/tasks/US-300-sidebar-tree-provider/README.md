# US-300: Replace FileExplorer with TreeProviderView in Sidebar

**Status:** Planned
**Epic:** EPIC-015 (Phase 3)
**Depends on:** US-293 (TreeProviderView), US-291 (FileTreeProvider)

## Goal

Replace the old `FileExplorer` component with `TreeProviderView` + `FileTreeProvider` in the sidebar's MenuBar (user folders) and ScriptLibraryPanel. This is the last migration step before the old FileExplorer can be removed in Phase 7.

## Background

### Current state

The sidebar uses `FileExplorer` in two places:

1. **MenuBar.tsx** (line ~477) — when a user-added folder is selected in the left panel, renders `<FileExplorer rootPath={folder.path} .../>` in the right panel.
2. **ScriptLibraryPanel.tsx** (line ~86) — renders `<FileExplorer rootPath={libraryPath} .../>` for the script library folder.

Both use identical patterns:
- Props: `rootPath`, `enableFileOperations`, `showOpenInNewTab={false}`, `initialState`, `onStateChange`, `onFileClick`
- File click: `app.events.openRawLink.sendAsync(new RawLinkEvent(filePath))` then `props.onClose?.()`
- State persistence: `FileExplorerSavedState` stored in `MenuBarModel.expandStateMap`
- Ref: `FileExplorerRef` for `refresh()`, `showSearch()`, `collapseAll()`

### TreeProviderView API (replacement)

`TreeProviderView` already supports everything needed:

| FileExplorer feature | TreeProviderView equivalent |
|---|---|
| `rootPath` | `provider` (pass `new FileTreeProvider(rootPath)`) |
| `enableFileOperations` | Automatic — checks `provider.writable` (FileTreeProvider is writable) |
| `showOpenInNewTab={false}` | No such prop — context menu always shows "Open in New Tab" via event channel. Need to suppress or not add it. |
| `initialState: FileExplorerSavedState` | `initialState: TreeProviderViewSavedState` (same shape: `{ expandedPaths }`) |
| `onStateChange` | Same pattern, different type |
| `onFileClick(filePath)` | `onItemClick(item)` — item has `item.href` for the file path |
| `ref.refresh()` | `ref.refresh()` |
| `ref.showSearch()` | `ref.showSearch()` |
| `ref.collapseAll()` | `ref.collapseAll()` |

### Key differences to handle

1. **FileTreeProvider instance management**: Each folder needs its own `FileTreeProvider` instance. These should be created once and reused (not recreated on every render). MenuBarModel can hold a `Map<string, FileTreeProvider>`.

2. **State type change**: `expandStateMap` changes from `Map<string, FileExplorerSavedState>` to `Map<string, TreeProviderViewSavedState>`. Both have `expandedPaths: string[]` — the shape is compatible.

3. **Ref type change**: `fileExplorerRef` changes from `FileExplorerRef` to `TreeProviderViewRef`. The ref API is a superset (adds `revealItem`).

4. **Item click callback**: FileExplorer fires `onFileClick(filePath: string)`. TreeProviderView fires `onItemClick(item: ITreeProviderItem)`. The handler just needs `item.href` instead of `filePath`.

5. **Context menu "Open in New Tab"**: FileExplorer has `showOpenInNewTab={false}` prop. TreeProviderView doesn't have this prop — it always shows writable context menus. For sidebar usage, we may want to suppress "Open in New Tab" since the sidebar's purpose is to open files in the current tab. However, the context menu is event-driven (`app.events.treeProviderContextMenu`), so existing subscribers already add "Open in New Tab" items. **Decision needed**: keep or suppress "Open in New Tab" in sidebar? Current FileExplorer explicitly disables it with `showOpenInNewTab={false}`.

6. **`app.events.fileExplorer.itemContextMenu`**: FileExplorer fires `app.events.fileExplorer.itemContextMenu` on right-click. TreeProviderView fires `app.events.treeProviderContextMenu` instead. Any subscribers to the old event for sidebar items will stop receiving events. Need to check if any code subscribes specifically for sidebar FileExplorer events.

## Implementation Plan

### Step 1: Update MenuBar.tsx — replace FileExplorer with TreeProviderView

In `MenuBarModel`:
- Change `expandStateMap` type from `Map<string, FileExplorerSavedState>` to `Map<string, TreeProviderViewSavedState>`
- Change `fileExplorerRef` type from `FileExplorerRef` to `TreeProviderViewRef`
- Add `providerMap = new Map<string, FileTreeProvider>()` to cache providers
- Add helper `getProvider(folderId, folderPath)` that returns cached or creates new `FileTreeProvider`

In `renderRightList` callback (line ~473):
```typescript
// Before
<FileExplorer
    ref={model.setFileExplorerRef}
    key={folder.id}
    id={`sidebar-${folder.id}`}
    rootPath={folder.path}
    enableFileOperations
    showOpenInNewTab={false}
    initialState={model.expandStateMap.get(folder.id!)}
    onStateChange={(s) => model.expandStateMap.set(folder.id!, s)}
    onFileClick={(filePath) => {
        app.events.openRawLink.sendAsync(new RawLinkEvent(filePath));
        props.onClose?.();
    }}
/>

// After
<TreeProviderView
    ref={model.setFileExplorerRef}
    key={folder.id}
    provider={model.getProvider(folder.id!, folder.path)}
    initialState={model.expandStateMap.get(folder.id!)}
    onStateChange={(s) => model.expandStateMap.set(folder.id!, s)}
    onItemClick={(item) => {
        if (!item.isDirectory) {
            app.events.openRawLink.sendAsync(new RawLinkEvent(item.href));
            props.onClose?.();
        }
    }}
/>
```

Update imports: remove `FileExplorer, FileExplorerRef, FileExplorerSavedState`, add `TreeProviderView, TreeProviderViewRef, TreeProviderViewSavedState` and `FileTreeProvider`.

### Step 2: Update ScriptLibraryPanel.tsx

Change props interface:
```typescript
// Before
interface ScriptLibraryPanelProps {
    onClose?: () => void;
    explorerRef?: (ref: FileExplorerRef | null) => void;
    expandState?: FileExplorerSavedState;
    onExpandStateChange?: (state: FileExplorerSavedState) => void;
}

// After
interface ScriptLibraryPanelProps {
    onClose?: () => void;
    explorerRef?: (ref: TreeProviderViewRef | null) => void;
    expandState?: TreeProviderViewSavedState;
    onExpandStateChange?: (state: TreeProviderViewSavedState) => void;
}
```

Replace FileExplorer usage:
```typescript
// Before
<FileExplorer
    ref={props.explorerRef}
    key={libraryPath}
    id="sidebar-script-library"
    rootPath={libraryPath}
    enableFileOperations
    showOpenInNewTab={false}
    initialState={props.expandState}
    onStateChange={props.onExpandStateChange}
    onFileClick={(filePath) => {
        app.events.openRawLink.sendAsync(new RawLinkEvent(filePath));
        props.onClose?.();
    }}
/>

// After
<TreeProviderView
    ref={props.explorerRef}
    key={libraryPath}
    provider={scriptLibraryProvider}
    initialState={props.expandState}
    onStateChange={props.onExpandStateChange}
    onItemClick={(item) => {
        if (!item.isDirectory) {
            app.events.openRawLink.sendAsync(new RawLinkEvent(item.href));
            props.onClose?.();
        }
    }}
/>
```

Need to manage `FileTreeProvider` instance for library path. Use `useMemo` or `useRef` keyed by `libraryPath`.

### Step 3: Check `app.events.fileExplorer.itemContextMenu` subscribers

Search for subscribers to `app.events.fileExplorer.itemContextMenu`. If any sidebar-specific logic subscribes to this event, it needs to switch to `app.events.treeProviderContextMenu`.

### Step 4: Verify context menu behavior

After replacing, test right-click on files and folders in sidebar. Verify:
- File operations (rename, delete, new file/folder) work
- "Copy Path" works
- "Show in Explorer" works (if available via treeProviderContextMenu subscribers)
- No unwanted "Open in New Tab" items appear (or decide to keep them)

### Step 5: Check NavigationPanel.tsx

NavigationPanel.tsx still uses FileExplorer but it's the **old** navigation panel. PageNavigator has replaced it. Verify NavigationPanel is still rendered somewhere or if it's now dead code.

## Resolved Concerns

1. **"Open in New Tab" in sidebar context menu**: FileExplorer suppressed it with `showOpenInNewTab={false}`. TreeProviderView doesn't have this prop — "Open in New Tab" comes from `content/tree-context-menus.tsx` event channel subscriber (for both files and folders). **Decision:** Allow it — useful functionality.

2. **"Show in File Explorer"**: Verified — `content/tree-context-menus.tsx` (lines 37, 61) adds "Show in File Explorer" to `treeProviderContextMenu` for both files and folders. Works automatically.

3. **FileTreeProvider caching in MenuBar**: Provider instances cached in `Map<string, FileTreeProvider>` in MenuBarModel. Created once per folder, reused across re-renders.

4. **Drag-drop**: TreeProviderView supports it when `provider.writable`. FileTreeProvider is writable. Works automatically.

5. **NavigationPanel.tsx is dead code**: No imports found outside its own file. PageNavigator fully replaced it. Leave for Phase 7 cleanup — useful as reference.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/sidebar/MenuBar.tsx` | Replace FileExplorer with TreeProviderView, update types, add provider caching |
| `src/renderer/ui/sidebar/ScriptLibraryPanel.tsx` | Replace FileExplorer with TreeProviderView, update types |

## Files NOT Changed

- `src/renderer/components/file-explorer/` — kept for now (removed in Phase 7)
- `src/renderer/ui/navigation/NavigationPanel.tsx` — reviewed but not changed (deferred)
- `src/renderer/components/tree-provider/TreeProviderView.tsx` — already has all needed features

## Acceptance Criteria

- [ ] MenuBar sidebar folders use TreeProviderView + FileTreeProvider
- [ ] ScriptLibraryPanel uses TreeProviderView + FileTreeProvider
- [ ] File click in sidebar opens file in current tab
- [ ] Folder expand/collapse state persists across sidebar open/close
- [ ] Context menu works (file operations, copy path)
- [ ] Search (Ctrl+F) works in sidebar
- [ ] Drag-drop file moving works
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
