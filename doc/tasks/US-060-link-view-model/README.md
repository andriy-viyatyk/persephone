# US-060: LinkViewModel (Link ContentViewModel)

## Overview

Refactor `LinkEditorModel` (currently extends `TComponentModel`) into `LinkViewModel extends ContentViewModel<LinkEditorState>`.

This is **Task 7** in the content view models migration ([9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)).

## Current State

- `LinkEditorModel` lives in `LinkEditorModel.ts` (~775 lines)
- Extends `TComponentModel<LinkEditorState, LinkEditorProps>`
- Created via `useComponentModel(props, LinkEditorModel, defaultLinkEditorState)`
- **Read-write** — parses `.link.json` into structured data, CRUD operations serialize back to JSON
- Bidirectional sync: file content ↔ LinkEditorData (links array + display state)
- Has filtering (categories, tags, hostnames, search), view modes, pinned links, drag-and-drop
- Has selection state persistence (expanded panel, selected category/tag/hostname)
- Used in two contexts: standalone `.link.json` editor AND `BookmarksDrawer` (via `swapLayout` prop)
- Child components (`LinkItemList`, `LinkItemTiles`, `PinnedLinksPanel`) receive model as prop
- `EditLinkDialog` is independent (uses `TDialogModel`, receives data via function call)

## Design Decisions

### Host access mapping

| Current (TComponentModel) | New (ContentViewModel) |
|---------------------------|------------------------|
| `this.props.model` | `this.host` |
| `this.props.model.state.get().content` | via `onContentChanged(content)` |
| `this.props.model.state.get().id` | `this.host.id` |
| `this.props.model.changeContent(content, true)` | `this.host.changeContent(content, true)` |
| `this.props.swapLayout` | Handled by component (see below) |

### `swapLayout` prop — move to component responsibility

The `swapLayout` prop is used in the model for exactly ONE thing: skipping `initBrowserSelection()` when used inside `BookmarksDrawer` (keeps `selectedBrowser = ""` for monkey-patching).

**Solution:** Remove `swapLayout` from the model entirely. Default state already has `selectedBrowser: ""`. The standalone `LinkEditor` component calls `vm.initBrowserSelection()` explicitly when `swapLayout` is false. The BookmarksDrawer context simply doesn't call it — the default "" is exactly what it needs.

### `effect()` replacement

| Current `effect()` usage | ContentViewModel equivalent |
|-------------------------|----------------------------|
| Watch `props.model.state.get().content` → `updateContent()` | Base class `onContentChanged(content)` |
| Watch `state.filteredLinks` → `gridModel?.update({ all: true })` | Move to component `useEffect` (React rendering concern) |

### Selection state caching — switch to `host.stateStorage`

Current: `fs.getCacheFile(id, "link-editor")` / `fs.saveCacheFile(id, data, "link-editor")`

New: `this.host.stateStorage.getState(this.host.id, "link-editor")` / `this.host.stateStorage.setState(this.host.id, "link-editor", data)`

This ensures consistency with other view models and works correctly for both standalone pages and embedded contexts.

### Data sync loop prevention

Same `skipNextContentUpdate` pattern as Notebook/Todo ViewModels. When the model serializes data to JSON and calls `host.changeContent()`, the base class will call `onContentChanged()` with the new content. The flag prevents re-parsing our own changes.

### Debounce flush on dispose

Same as Notebook/Todo: call `this.onDataChangedDebounced.flush()` in `onDispose()` to ensure unsaved data is written before disposal.

### `containerElement` reference

Plain field set by the component via ref callback. Used for focus restoration after dialogs. Stays as plain field.

### `gridModel` reference

Grid update on `filteredLinks` change moves from model to component `useEffect`. Model keeps `setGridModel()` and `gridModel` field for the component to call.

### `pageModel` getter

Same as Notebook/Todo — provide `get pageModel(): TextFileModel` for script context access.

## Scope

### Files to create

| File | Purpose |
|------|---------|
| `src/renderer/editors/link-editor/LinkViewModel.ts` | ViewModel refactored from LinkEditorModel.ts |

### Files to modify

| File | Changes |
|------|---------|
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Replace `useComponentModel` with `useContentViewModel` + `useSyncExternalStore` |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | Update import `LinkEditorModel` → `LinkViewModel` |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | Update import `LinkEditorModel` → `LinkViewModel` |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | Update import `LinkEditorModel` → `LinkViewModel` |
| `src/renderer/editors/register-editors.ts` | Add `createViewModel` factory for `"link-view"` |

### Files to delete

| File | Reason |
|------|--------|
| `src/renderer/editors/link-editor/LinkEditorModel.ts` | Replaced by `LinkViewModel.ts` |

### Files unchanged

| File | Reason |
|------|--------|
| `linkTypes.ts` | Type definitions — no model dependency changes |
| `EditLinkDialog.tsx` | Independent dialog, uses `TDialogModel` — no changes needed |
| `favicon-cache.ts` | Service with no model dependency |

## Implementation Steps

### Step 1: Create LinkViewModel.ts

- [ ] Create `LinkViewModel extends ContentViewModel<LinkEditorState>`
- [ ] Move state type + default from `LinkEditorModel.ts`
- [ ] Replace all `this.props.model` → `this.host`
- [ ] Replace `this.props.model.state.get().id` → `this.host.id`
- [ ] Replace `this.props.model.changeContent()` → `this.host.changeContent()`
- [ ] Implement `onInit()`:
  - Subscribe to `this.state` for data change detection → `onDataChangedDebounced()`
  - Do NOT call `initBrowserSelection()` (moved to component)
- [ ] Implement `onContentChanged(content)` → calls `updateContent(content)`
- [ ] Implement `onDispose()`:
  - Flush debounced data: `this.onDataChangedDebounced.flush()`
  - Cleanup: `this.containerElement = null`
- [ ] Switch selection state caching from `fs.getCacheFile`/`fs.saveCacheFile` → `this.host.stateStorage`
- [ ] Remove `swapLayout`/`this.props.swapLayout` reference from `initBrowserSelection()` — make it a simple public method
- [ ] Add `pageModel` getter for script context access
- [ ] Export factory: `createLinkViewModel(host: IContentHost) => new LinkViewModel(host)`

### Step 2: Update LinkEditor component

- [ ] Replace `useComponentModel(props, LinkEditorModel, defaultLinkEditorState)` with `useContentViewModel<LinkViewModel>(model, "link-view")`
- [ ] Subscribe to ViewModel state via `useSyncExternalStore` (unconditional, with noop fallback)
- [ ] Remove `model.state.use()` line (no longer needed — `onContentChanged` handles content sync)
- [ ] Add `useEffect` for `gridModel?.update({ all: true })` when `filteredLinks` changes
- [ ] Add `useEffect` or inline call for `vm.initBrowserSelection()` when `!swapLayout`
- [ ] Update `pageModel.xxx` → `vm.xxx` references
- [ ] Handle `vm === null` (loading state) — return null before render
- [ ] Keep `model` prop for portal refs access (editorToolbarRefFirst, editorToolbarRefLast, editorFooterRefLast)

### Step 3: Update child components

- [ ] `LinkItemList.tsx` — change import `LinkEditorModel` → `LinkViewModel`
- [ ] `LinkItemTiles.tsx` — change import `LinkEditorModel` → `LinkViewModel`
- [ ] `PinnedLinksPanel.tsx` — change import `LinkEditorModel` → `LinkViewModel`

### Step 4: Register factory in register-editors.ts

- [ ] Add parallel import of `LinkViewModel` in `"link-view"` loadModule
- [ ] Add `createViewModel: createLinkViewModel` to the module return

### Step 5: Delete LinkEditorModel.ts

- [ ] Delete `src/renderer/editors/link-editor/LinkEditorModel.ts`

## Test Checklist

- [ ] Open `.link.json` file — links display correctly
- [ ] Add, edit, delete links — changes persist to file
- [ ] Category tree — filtering, drag-drop links to categories, move categories
- [ ] Tags panel — filtering by tags
- [ ] Hostnames panel — filtering by hostname
- [ ] Search — text search filters links
- [ ] View modes — list, tiles (4 variants), switch between them
- [ ] Pinned links — pin/unpin, reorder, panel appears/disappears
- [ ] Browser selector — OS default, internal, incognito, profiles
- [ ] Context menu on links — edit, open, copy URL, pin/unpin, delete
- [ ] Selection state persists — close and reopen file, category/tag/panel restored
- [ ] Switch to Monaco editor and back — state preserved
- [ ] BookmarksDrawer — link editor works with `swapLayout`, browser selector stays as ""
- [ ] Favicons load correctly in both list and tile views
- [ ] Toolbar breadcrumbs update based on panel/selection
- [ ] Footer shows link count

## Concerns

### 1. `swapLayout` prop not available in ContentViewModel

**Status: Resolved**

ContentViewModel doesn't have props. The `swapLayout` flag only affects `initBrowserSelection()` in the model. Solution: make `initBrowserSelection()` a public method called by the component. Default state `selectedBrowser: ""` is exactly what BookmarksDrawer needs, so it simply doesn't call it.

### 2. Async `restoreSelectionState` with stateStorage

**Status: Resolved**

`EditorStateStorage.getState()` returns `Promise<string | undefined>` — same signature as `fs.getCacheFile()`. The `restoreSelectionState` is already async, so switching to `this.host.stateStorage.getState()` is a direct replacement.

### 3. State subscription for data change detection

**Status: Resolved**

Current code subscribes to ALL state changes to detect data modifications via `onDataChangedDebounced`. The debounced handler compares `data !== this.lastSerializedData` to only serialize when actual link data changed (not on filter/search changes). Same subscription pattern works in `onInit()` via `this.state.subscribe()` + `addSubscription()`.

### 4. Grid update on filteredLinks change

**Status: Resolved**

Move `gridModel?.update({ all: true })` from model `effect()` to component `useEffect`. Same pattern as Grid (US-056), Notebook (US-057), and Todo (US-058).

### 5. `model.state.use()` in component for content sync

**Status: Resolved**

Line 171 in `LinkEditor.tsx`: `model.state.use()` subscribes to file content changes to trigger TComponentModel effect re-evaluation. With ContentViewModel, `onContentChanged()` handles this internally. This line can be removed.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- TextViewModel (first reference): [US-055](../US-055-text-view-model/)
- GridViewModel (second reference): [US-056](../US-056-grid-view-model/)
- NotebookViewModel (complex reference): [US-057](../US-057-notebook-view-model/)
- TodoViewModel (similar migration): [US-058](../US-058-todo-view-model/)
- MarkdownViewModel (previous migration): [US-059](../US-059-markdown-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
