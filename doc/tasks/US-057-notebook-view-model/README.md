# US-057: NotebookViewModel (Notebook ContentViewModel)

## Status

**Status:** Planned
**Priority:** High
**Depends on:** US-052 (Foundation), US-053 (IContentHost), US-055 (TextViewModel — established pattern), US-056 (GridViewModel — second reference)

## Summary

Migrate `NotebookEditorModel` (extends `TComponentModel`) into `NotebookViewModel` (extends `ContentViewModel`). Register a factory for `"notebook-view"` in EditorRegistry. Update `NotebookEditor` component to use `useContentViewModel` hook. Update child components (`NoteItemViewModel`, `NoteItemEditModel`, `ExpandedNoteView`) to reference the new type.

This is **Task 4** from [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md).

## Why

- NotebookEditorModel is tied to React lifecycle (created/destroyed on mount/unmount via `useComponentModel`)
- Switching notebook→monaco→notebook re-parses the entire JSON each time (wasteful)
- No programmatic access — scripts cannot call `page.asNotebook().addNote()` (future goal)
- Inconsistent with TextViewModel and GridViewModel which already use ContentViewModel pattern
- `TComponentModel`'s `effect()` system is overkill — simple subscriptions suffice

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — full architecture (Task 4, NotebookViewModel section)
- [US-052](../US-052-content-view-models-foundation/) — ContentViewModel base, ContentViewModelHost, useContentViewModel
- [US-055](../US-055-text-view-model/) — TextViewModel pattern (first reference)
- [US-056](../US-056-grid-view-model/) — GridViewModel pattern (second reference)

## Acceptance Criteria

- [ ] `NotebookEditorModel` replaced by `NotebookViewModel extends ContentViewModel<NotebookViewState>`
- [ ] `createNotebookViewModel` factory registered for `"notebook-view"` in `register-editors.ts`
- [ ] `NotebookEditor` component uses `useContentViewModel(model, "notebook-view")` hook
- [ ] `NotebookEditor` no longer uses `useComponentModel` — no `TComponentModel` dependency
- [ ] Child components updated to reference `NotebookViewModel` type
- [ ] `NoteItemEditModel.runScript()` works correctly (accesses page model for script context)
- [ ] Content change loop prevented (editing notes doesn't trigger re-parse)
- [ ] App compiles with no errors
- [ ] All existing notebook functionality works unchanged (see test checklist)

## Design Decisions

### Content change loop prevention

When user edits a note: `updateNoteContent()` → state change → `onDataChangedDebounced()` → `host.changeContent(json)`. This triggers the base class content subscription, which calls `onContentChanged(content)`. Without protection, this would re-parse the content we just serialized.

**Solution:** Use `skipNextContentUpdate` flag (same pattern as current NotebookEditorModel). In `onDataChanged()`, set `skipNextContentUpdate = true` before calling `host.changeContent()`. In `onContentChanged()`, check and reset the flag:

```typescript
protected onContentChanged(content: string): void {
    if (this.skipNextContentUpdate) {
        this.skipNextContentUpdate = false;
        return;
    }
    this.loadData(content);
}
```

This preserves the exact current behavior.

### Replacing TComponentModel `effect()` with subscriptions

| Current `effect()` | ContentViewModel equivalent |
|--------------------|---------------------------|
| Watch host content → `updateContent()` | Base class auto-calls `onContentChanged()` |
| Watch filteredNotes → `gridModel?.update()` | Moved to `useEffect` in NotebookEditor component (React rendering concern) |
| Debounced serialize back to host | Subscribe to `this.state` in `onInit()` |

### `props.model` → `this.host` mapping

| Current (NotebookEditorModel) | New (NotebookViewModel) |
|-------------------------------|-------------------------|
| `this.props.model` | `this.host` |
| `this.props.model.state.get().content` | `this.host.state.get().content` |
| `this.props.model.changeContent()` | `this.host.changeContent()` |

### `NoteItemEditModel.runScript()` — accessing the page model

Currently `NoteItemEditModel.runScript()` does:
```typescript
const notebookPageModel = this.notebookModel.props.model;
await scriptRunner.runWithResult(notebookPageModel.id, script, notebookPageModel);
```

After migration, `NotebookViewModel` no longer has `props.model`. The host itself provides `id` and is the TextFileModel. The `NoteItemEditModel` needs access to the page model for `scriptRunner.runWithResult()`.

**Solution:** Add a `pageModel` getter on `NotebookViewModel` that exposes the host cast as the page model:
```typescript
get pageModel() {
    return this.host as unknown as TextFileModel;
}
```

Then `NoteItemEditModel.runScript()` becomes:
```typescript
const notebookPageModel = this.notebookModel.pageModel;
```

Note: This cast is safe — the host of a notebook editor can only ever be a TextFileModel. Task 9 will make `NoteItemEditModel` implement its own `IContentHost` for individual note items, but script execution will still need the *notebook's* page model (not the note item's host), so this getter will remain.

### Portal refs stay on the TextFileModel

Portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`, `editorOverlayRef`) are NOT part of `IContentHost`. They're a React rendering concern. `NotebookEditor` continues to access them from the concrete `model` (TextFileModel) passed as a prop.

### `model.state.use()` removal

Currently `NotebookEditor` has `model.state.use()` at line 127 to subscribe to host content changes so that `useComponentModel`'s `effect()` system re-evaluates. After migration, the base `ContentViewModel` subscribes to host content directly — the component no longer needs this.

### `useSyncExternalStore` pattern (Rules of Hooks)

Same as GridEditor (US-056): cannot call `vm.state.use()` after `if (!vm) return null`. Use `useSyncExternalStore` unconditionally before the early return, with no-op subscribe and default state when vm is null.

### NoteItemViewModel stays as TComponentModel

`NoteItemViewModel` is a per-note-item UI model (manages editing state, wheel events, etc.). It is NOT a content view model — it doesn't own or manage file content. It stays as `TComponentModel`. Only its type reference changes from `NotebookEditorModel` to `NotebookViewModel`.

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/editors/notebook/NotebookViewModel.ts` | **NEW** — `NotebookViewModel extends ContentViewModel<NotebookViewState>`, all logic from NotebookEditorModel |
| `src/renderer/editors/notebook/NotebookEditor.tsx` | Replace `useComponentModel` with `useContentViewModel`. Remove `model.state.use()`. Use `useSyncExternalStore` pattern. |
| `src/renderer/editors/notebook/NoteItemViewModel.ts` | Change `NotebookEditorModel` → `NotebookViewModel` type in props |
| `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` | Change `NotebookEditorModel` → `NotebookViewModel` type |
| `src/renderer/editors/notebook/ExpandedNoteView.tsx` | Change `NotebookEditorModel` → `NotebookViewModel` type in props |
| `src/renderer/editors/notebook/index.ts` | Update exports — add NotebookViewModel, remove NotebookEditorModel |
| `src/renderer/editors/register-editors.ts` | Add `createViewModel` factory to notebook-view registration |
| `src/renderer/editors/notebook/NotebookEditorModel.ts` | **DELETE** after verification |

## Implementation Steps

### Step 1: Create NotebookViewModel

- [ ] Create `NotebookViewModel.ts` with `class NotebookViewModel extends ContentViewModel<NotebookViewState>`
- [ ] Constructor: `super(host, defaultNotebookViewState)`
- [ ] Move state shape (`defaultNotebookViewState`, `NotebookViewState` type, `ExpandedPanel` type)
- [ ] Move `getContentSearchText()` helper function
- [ ] Implement `onInit()`:
  - Subscribe to own state changes for debounced serialize back to host (`addSubscription`)
  - Process initial content: `loadData(this.host.state.get().content || "")`
- [ ] Implement `onContentChanged(content)`:
  - Skip if `skipNextContentUpdate` is true (self-change loop prevention)
  - Call `loadData(content)`
- [ ] Implement `onDispose()`:
  - Flush pending debounced save if needed
- [ ] Move all data methods: addNote, deleteNote, expandNote, collapseNote, addComment, updateNoteComment, removeComment
- [ ] Move all content update methods: getNote, updateNoteContent, updateNoteLanguage, updateNoteEditor, updateNoteTitle, updateNoteCategory, addNoteTag, removeNoteTag, updateNoteTag
- [ ] Move category methods: loadCategories, categoryItemClick, setSelectedCategory, getCategoryItemSelected, getCategorySize
- [ ] Move tag methods: loadTags, setSelectedTag, getTagSize
- [ ] Move search methods: setSearchText, clearSearch
- [ ] Move filtering: applyFilters with incremental search optimization
- [ ] Move drag-and-drop: categoryDrop, getCategoryDragItem, moveCategory
- [ ] Move height/state persistence: getNoteHeight, setNoteHeight, getNoteState, setNoteState
- [ ] Move UI state: setLeftPanelWidth, setExpandedPanel
- [ ] Remove `gridModel` ref from view model (moved to component)
- [ ] Add `pageModel` getter for script context access
- [ ] Replace `this.props.model` → `this.host` everywhere
- [ ] Export factory: `createNotebookViewModel(host: IContentHost) => new NotebookViewModel(host)`

### Step 2: Update NotebookEditor component

- [ ] Replace `useComponentModel(props, NotebookEditorModel, ...)` with `useContentViewModel<NotebookViewModel>(model, "notebook-view")`
- [ ] Remove `model.state.use()` (no longer needed)
- [ ] Use `useSyncExternalStore` unconditionally (Rules of Hooks pattern from US-056)
- [ ] Return null while VM is loading
- [ ] Remove `NotebookEditorProps` import if it only served the old pattern (check — it also includes `model: TextFileModel` so may stay)
- [ ] All `pageModel.xxx` → `vm.xxx`
- [ ] Own `gridModel` ref (via `useState`/`useCallback`) + `useEffect` watching filteredNotes → `gridModel?.update({ all: true })`
- [ ] Portal refs: continue accessing from `model` (TextFileModel)

### Step 3: Register factory

- [ ] Add `createNotebookViewModel` import in `loadModule` for notebook-view registration
- [ ] Use parallel `Promise.all` pattern (same as grid registrations)

### Step 4: Update child components

- [ ] `NoteItemViewModel.ts`: Change props type `notebookModel: NotebookEditorModel` → `notebookModel: NotebookViewModel`
- [ ] `NoteItemEditModel.ts`: Change constructor/field type `notebookModel: NotebookEditorModel` → `notebookModel: NotebookViewModel`
- [ ] `NoteItemEditModel.runScript()`: Update `this.notebookModel.props.model` → `this.notebookModel.pageModel`
- [ ] `ExpandedNoteView.tsx`: Change props type `notebookModel: NotebookEditorModel` → `notebookModel: NotebookViewModel`

### Step 5: Update barrel exports

- [ ] `notebook/index.ts`: export `NotebookViewModel`, `createNotebookViewModel`
- [ ] Remove `NotebookEditorModel` export

### Step 6: Delete NotebookEditorModel.ts

- [ ] Remove `NotebookEditorModel.ts` after all references are updated
- [ ] Verify no imports remain

### Step 7: Verify

- [ ] `npx tsc --noEmit` — zero errors
- [ ] Manual test checklist (see below)

## Test Checklist

### Notebook CRUD

- [ ] Open `.note.json` file — notebook view renders
- [ ] Data loads correctly (notes, categories, tags)
- [ ] Add note — appears at top
- [ ] Delete note — confirmation dialog, note removed
- [ ] Edit note title — updates
- [ ] Edit note content — changes persist
- [ ] Change note language — works
- [ ] Switch note editor (monaco, grid, markdown) — works

### Categories

- [ ] Categories panel shows all categories with counts
- [ ] Click category — filters notes
- [ ] Breadcrumb navigation — works
- [ ] Drag note to category — changes category
- [ ] Drag category to category — reparents with confirmation
- [ ] New note inherits selected category

### Tags

- [ ] Tags panel shows all tags with counts
- [ ] Click tag — filters notes
- [ ] Add tag to note — works
- [ ] Remove tag from note — works
- [ ] Edit tag — works
- [ ] New note inherits selected tag

### Search

- [ ] Type in search field — filters notes
- [ ] Multi-word search (AND condition) — works
- [ ] Search highlights in notes
- [ ] Clear search — shows all notes
- [ ] Incremental search optimization (growing text) — works

### Expanded Note View

- [ ] Click expand — note opens in overlay
- [ ] All editing works in expanded view (title, category, tags, content, comment)
- [ ] Escape closes expanded view
- [ ] Editor state storage works in expanded view

### Editor Switching

- [ ] Notebook → Monaco → Notebook: content preserved
- [ ] No errors in console during switches
- [ ] Notes state preserved after switch back

### Virtualization

- [ ] Scrolling through many notes — smooth, no flicker
- [ ] Note heights persist across remounts
- [ ] filteredNotes change updates grid

### Footer

- [ ] Notes count shows correctly (`N notes` or `M of N notes`)
- [ ] Updates when filtering changes visible notes

### Empty State

- [ ] New empty notebook file — shows "No notes yet" message

### Script Execution

- [ ] Run script in note — works (uses notebook page context)

### General

- [ ] No errors in DevTools console
- [ ] Multiple windows work correctly
- [ ] Multiple notebook tabs work independently

## Concerns

### 1. Debounced save flush on dispose — Resolved

Flush pending debounced save in `onDispose()` by calling `onDataChanged()` directly. Same approach as GridViewModel.

### 2. `NoteItemEditModel.runScript()` — page model access — Resolved

Casting the NotebookViewModel host to TextFileModel via a `pageModel` getter is acceptable — the host of a notebook editor can only ever be a TextFileModel. Task 9 will make NoteItemEditModel implement its own IContentHost for individual note items, but that's a separate concern — script execution always needs the *notebook's* page model (not the note item's host).

### 3. `gridModel?.update({ all: true })` — moved to component — Resolved

This is a React rendering concern (forces `RenderFlexGrid` to re-render when filtered notes change). Move it to a `useEffect` in `NotebookEditor` that watches `filteredNotes` — it doesn't belong in the view model.

### 4. `lastSerializedData` identity check — Resolved

Implement and test manually. Reference equality should work since state updates create new references.

### 5. NoteItemView `notebookModel` prop stability — Resolved

`useContentViewModel` returns the same instance across renders (ref-counted). If instability is observed, fix it to be stable.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- TextViewModel (first reference): [US-055](../US-055-text-view-model/)
- GridViewModel (second reference): [US-056](../US-056-grid-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
- Next tasks: Todo (Task 5), Markdown (Task 6), etc.
- Future: Task 9 (NoteItemEditModel → IContentHost) will clean up the `pageModel` bridge
