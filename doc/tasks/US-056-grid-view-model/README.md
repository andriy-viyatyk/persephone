# US-056: GridViewModel (Grid ContentViewModel)

## Status

**Status:** Done
**Priority:** High
**Depends on:** US-052 (Foundation), US-053 (IContentHost), US-055 (TextViewModel — established pattern)

## Summary

Migrate `GridPageModel` (extends `TComponentModel`) into `GridViewModel` (extends `ContentViewModel`). Register a factory for `"grid-json"` and `"grid-csv"` in EditorRegistry. Update `GridEditor` component to use `useContentViewModel` hook. Update `CsvOptions` to reference the new type.

This is **Task 3** from [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — the first content-view editor with real content parsing migrated to ContentViewModel.

## Why

- GridPageModel is tied to React lifecycle (created/destroyed on mount/unmount via `useComponentModel`)
- Switching grid→monaco→grid re-parses the entire JSON/CSV each time (wasteful)
- No programmatic access — scripts cannot call `page.asGrid().addRow()` (future goal)
- Inconsistent with TextViewModel which already uses ContentViewModel pattern
- `TComponentModel`'s `effect()` system is overkill — simple subscriptions suffice

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — full architecture (Task 3, GridViewModel section)
- [US-052](../US-052-content-view-models-foundation/) — ContentViewModel base, ContentViewModelHost, useContentViewModel
- [US-055](../US-055-text-view-model/) — TextViewModel pattern (reference implementation)

## Acceptance Criteria

- [ ] `GridPageModel` replaced by `GridViewModel extends ContentViewModel<GridPageState>`
- [ ] `createGridViewModel` factory registered for both `"grid-json"` and `"grid-csv"` in `register-editors.ts`
- [ ] `GridEditor` component uses `useContentViewModel(model, editorId)` hook
- [ ] `GridEditor` no longer uses `useComponentModel` — no `TComponentModel` dependency
- [ ] `CsvOptions` updated to use `GridViewModel` type
- [ ] State persistence works (columns, focus, search, filters, sort, CSV options saved/restored)
- [ ] Self-change loop prevented (editing cells doesn't trigger re-parse)
- [ ] Auto-focus logic handled properly (grid focuses on mount)
- [ ] App compiles with no errors
- [ ] All existing grid functionality works unchanged (see test checklist)

## Design Decisions

### Single GridViewModel for both JSON and CSV

Both `"grid-json"` and `"grid-csv"` use the same `GridViewModel` class. The editor type is read from `this.host.state.get().editor` at runtime to determine parsing mode (JSON vs CSV). The same factory works for both registrations.

### Content change loop prevention

When the user edits a cell: `editRow()` → `onDataChanged()` → `getContentToSave()` → `this.host.changeContent(content)`. This triggers the base class content subscription, which calls `onContentChanged(content)`. Without protection, this would re-parse the content we just serialized.

**Solution:** Track last serialized content in `changedContent` field. In `onContentChanged()`, skip if content matches `changedContent`:

```typescript
protected onContentChanged(content: string): void {
    if (this.changedContent !== content) {
        this.updateGridDataFromContent(content);
        this.changedContent = content;
    }
}
```

This matches the current GridPageModel behavior.

### Replacing TComponentModel `effect()` with subscriptions

| Current `effect()` | ContentViewModel equivalent |
|--------------------|-----------------------------|
| Watch host content → `updateContent()` | Base class auto-calls `onContentChanged()` |
| Watch csvDelimiter/csvWithColumns → `reload()` | Subscribe to `this.state` in `onInit()`, check for changes |
| Watch page focus → `pageFocused()` | Subscribe to `pagesModel.onFocus` via `addSubscription()` |

### State storage from IContentHost

Currently `GridPageModel` receives `stateStorage` via `props.stateStorage` (from React context `useEditorStateStorage()`). After migration, it reads from `this.host.stateStorage` (IContentHost already provides this).

This eliminates the React context dependency for state storage.

### Auto-focus moves to component

`disableAutoFocus` is a rendering/UX hint (comes from `useEditorConfig()` React context). The GridViewModel doesn't need to know about it. The auto-focus call (`gridRef.focusGrid()`) moves to the `GridEditor` component after mount.

### Portal refs stay on concrete model

Portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`) are NOT part of `IContentHost`. They're a React rendering concern. `GridEditor` continues to access them from the concrete model (TextFileModel) passed as a prop.

The component receives `model` (which is TextFileModel, implementing IContentHost), uses it both for portal refs and for `useContentViewModel(model, editorId)`.

### `gridRef` lifecycle — same pattern as TextViewModel's `editorRef`

`GridViewModel.gridRef` (reference to AVGridModel) is set by the React component after the `<AVGrid>` mounts. It may be null when the component is unmounted. Methods like `recordsCount` and `pageFocused` gracefully handle null gridRef.

### `restoreState()` timing — Option A (preserve exact behavior)

`restoreState()` is async (reads from storage). In `onInit()`, content is parsed first with defaults, then `restoreState()` runs asynchronously (not awaited) and merges saved state on top:

```typescript
protected onInit(): void {
    // subscriptions setup...

    // Parse with defaults first
    const content = this.host.state.get().content || "";
    this.detectCsvDelimiter(content);
    this.loadGridData(content);
    this.loaded = true;

    // Restore merges on top asynchronously
    this.restoreState();
    // → if csvDelimiter/csvWithColumns differ, state subscription triggers reload()
}
```

This preserves the exact current GridPageModel behavior:
1. Grid loads immediately with detected/default settings
2. Saved column widths, focus, search, filters merge when restore completes
3. If CSV delimiter/withColumns differ from saved → state subscription triggers `reload()` (rare double-parse, same as today)

### `props.model` → `this.host` mapping

| Current (GridPageModel) | New (GridViewModel) |
|------------------------|---------------------|
| `this.props.model` | `this.host` |
| `this.props.model.state.get().editor` | `this.host.state.get().editor` |
| `this.props.model.state.get().content` | `this.host.state.get().content` |
| `this.props.model.id` | `this.host.id` |
| `this.props.model.changeContent()` | `this.host.changeContent()` |
| `this.props.stateStorage` | `this.host.stateStorage` |
| `this.props.disableAutoFocus` | Removed (moved to component) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/editors/grid/GridViewModel.ts` | **NEW** — `GridViewModel extends ContentViewModel<GridPageState>`, all logic from GridPageModel |
| `src/renderer/editors/grid/GridEditor.tsx` | Replace `useComponentModel` with `useContentViewModel`. Remove `GridPageProps`. Simplify to `{ model: TextFileModel }`. Handle auto-focus in component. |
| `src/renderer/editors/grid/components/CsvOptions.tsx` | Change `GridPageModel` → `GridViewModel` type |
| `src/renderer/editors/grid/index.ts` | Update exports — add GridViewModel, remove GridPageModel |
| `src/renderer/editors/register-editors.ts` | Add `createViewModel` factory to both grid-json and grid-csv registrations |
| `src/renderer/editors/grid/GridPageModel.ts` | **DELETE** after verification |

## Implementation Steps

### Step 1: Create GridViewModel

- [ ] Create `GridViewModel.ts` with `class GridViewModel extends ContentViewModel<GridPageState>`
- [ ] Constructor: `super(host, defaultGridPageState)`
- [ ] Move state shape (`defaultGridPageState`, `GridPageState` type) to GridViewModel.ts
- [ ] Implement `onInit()`:
  - Subscribe to own state changes for debounced save (`addSubscription`)
  - Call `restoreState()` (async, not awaited)
  - Subscribe to `pagesModel.onFocus` via `addSubscription`
  - Subscribe to own state for csvDelimiter/csvWithColumns change detection → `reload()`
  - Process initial content: `detectCsvDelimiter()` + `loadGridData()`
- [ ] Implement `onContentChanged(content)`:
  - Skip if content === `changedContent` (self-change loop prevention)
  - Call `updateGridDataFromContent(content)`
- [ ] Implement `onDispose()`:
  - Call `saveState()` synchronously (or debounced flush)
- [ ] Move all data methods: editRow, onAddRows, onDeleteRows, setColumns, onAddColumns, onDeleteColumns, onUpdateRows
- [ ] Move all state methods: setFocus, setSearch, clearSearch, setFilters
- [ ] Move serialization: getJsonContent, getCsvContent, getContentToSave, onDataChanged
- [ ] Move CSV methods: setDelimiter, toggleWithColumns, detectCsvDelimiter
- [ ] Move content methods: loadGridData, updateGridDataFromContent, parseContent, initEmptyPage, reload
- [ ] Move state persistence: saveState, saveStateDebounced, restoreState
- [ ] Move pageFocused, recordsCount, onGetOptions
- [ ] Replace `this.props.model` → `this.host` everywhere
- [ ] Replace `this.props.stateStorage` → `this.host.stateStorage`
- [ ] Remove `disableAutoFocus` handling (moved to component)
- [ ] Export factory: `createGridViewModel(host: IContentHost) => new GridViewModel(host)`

### Step 2: Update GridEditor component

- [ ] Replace `useComponentModel(mergedProps, GridPageModel, ...)` with `useContentViewModel<GridViewModel>(model, editorId)`
- [ ] Get `editorId` from `model.state.use(s => s.editor)` or read once
- [ ] Return null while VM is loading
- [ ] Move auto-focus logic to component (call `vm.gridRef?.focusGrid()` after mount if `!editorConfig.disableAutoFocus`)
- [ ] Remove `GridPageProps` interface — simplify to `{ model: TextFileModel }`
- [ ] Remove `useEditorStateStorage()` import (storage now from IContentHost)
- [ ] Portal refs: continue accessing from `model` (TextFileModel)
- [ ] All `pageModel.xxx` → `vm.xxx`

### Step 3: Register factory

- [ ] Add `createGridViewModel` import in `loadModule` for grid-json registration
- [ ] Add `createGridViewModel` import in `loadModule` for grid-csv registration
- [ ] Use `Object.create` pattern if needed (or direct spread if safe)

### Step 4: Update CsvOptions

- [ ] Change `import { GridPageModel }` → `import { GridViewModel }`
- [ ] Update `CsvOptionsModel.gridModel` type: `GridPageModel` → `GridViewModel`
- [ ] Update `showCsvOptions` parameter type

### Step 5: Update barrel exports

- [ ] `grid/index.ts`: export `GridViewModel`, `createGridViewModel`
- [ ] Remove `GridPageModel` export (or keep as deprecated alias temporarily)

### Step 6: Delete GridPageModel.ts

- [ ] Remove `GridPageModel.ts` after all references are updated
- [ ] Verify no imports remain

### Step 7: Verify

- [ ] `npx tsc --noEmit` — zero errors
- [ ] Manual test checklist (see below)

## Test Checklist

### Grid JSON

- [ ] Open `.json` file — switch to Grid view
- [ ] Data loads correctly (columns, rows, types)
- [ ] Edit cells — changes reflect in text when switching to Monaco
- [ ] Add/delete rows — content updates
- [ ] Add/delete columns — content updates
- [ ] Sort columns — works
- [ ] Filter rows — works
- [ ] Search text — highlights matches
- [ ] Edit Columns dialog — rename, hide, change type
- [ ] Column resize — widths persist

### Grid CSV

- [ ] Open `.csv` file — Grid view renders
- [ ] CSV delimiter auto-detected
- [ ] CSV Options dialog — change delimiter, toggle header row
- [ ] Edit cells — CSV content updates correctly
- [ ] Delimiter change triggers correct re-parse

### Editor Switching

- [ ] Grid → Monaco → Grid: content preserved, grid state (columns, widths) restored
- [ ] Grid → Markdown Preview → Grid: works correctly
- [ ] No errors in console during switches
- [ ] Grid focuses after switch back

### State Persistence

- [ ] Close and reopen file — grid remembers: column widths, focus position, search, filters, sort, CSV options
- [ ] State persists across editor switches

### Notebook Context

- [ ] If grid is used in notebook notes — verify it still works
- [ ] (May be N/A if notebook doesn't use grid currently)

### Footer

- [ ] Records count shows correctly (`N rows` or `M of N rows`)
- [ ] Updates when filtering changes visible rows

### Empty State

- [ ] New empty JSON file → Grid view shows one empty row with column "a"

### General

- [ ] No errors in DevTools console
- [ ] Multiple windows work correctly
- [ ] Multiple grid tabs work independently

## Concerns

### 1. Auto-focus timing in component

Currently `GridPageModel.loadGridData()` calls `gridRef.focusGrid()` via `Promise.resolve().then()`. After migration, the component handles auto-focus. Need to ensure the timing is right — `gridRef` must be available (AVGrid mounted) before calling `focusGrid()`. May need a `useEffect` with `vm.gridRef` dependency or a callback after grid mounts.

### 2. `restoreState()` and `loadGridData()` ordering — Resolved

**Decision: Option A** — don't await `restoreState()`. Parse content first with defaults, then restore merges on top asynchronously. Same behavior as current GridPageModel. See "restoreState() timing" in Design Decisions.

### 3. `editorId` stability — Resolved

`ActiveEditor` uses `key={editor}`, so when editor changes the old component unmounts and a new one mounts. The `editorId` is stable for the component's entire lifetime.

### 4. ColumnsOptions dialog — no changes needed

`ColumnsOptions` takes `AVGridModel` (gridRef) and an `onUpdateRows` callback — it doesn't reference `GridPageModel` directly. No changes needed.

### 5. `onDataChanged()` called from AVGrid component

AVGrid calls `onDataChanged` callback after batch operations (copy-paste, etc.). This works unchanged because it's passed as a prop from GridEditor: `onDataChanged={vm.onDataChanged}`.

### 6. `onVisibleRowsChanged` refresh hack in GridEditor

The current GridEditor has a `setRefresh(new Date().getTime())` hack to re-render the footer's `recordsCount` when visible rows change. This stays in the component — it's a React rendering concern, not a model concern.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- TextViewModel (pattern reference): [US-055](../US-055-text-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
- Next tasks: Notebook (Task 4), Todo (Task 5), etc.
