# US-058: TodoViewModel (Todo ContentViewModel)

## Summary

Migrate `TodoEditorModel` (TComponentModel) to `TodoViewModel` extending `ContentViewModel<TodoEditorState>`. This is **Task 5** from the [content view models architecture](../../future-architecture/migration/9.content-view-models.md).

**Pattern reference:** US-057 (NotebookViewModel) — nearly identical migration.

## Status: Planned

## Acceptance Criteria

- [ ] `TodoEditorModel.ts` replaced by `TodoViewModel.ts` extending `ContentViewModel<TodoEditorState>`
- [ ] `TodoEditor` uses `useContentViewModel<TodoViewModel>(model, "todo-view")` instead of `useComponentModel`
- [ ] `createTodoViewModel` factory registered in `register-editors.ts`
- [ ] Child components (`TodoListPanel`, `TodoItemView`) updated to reference `TodoViewModel`
- [ ] `gridModel?.update()` moved from model to `useEffect` in component
- [ ] All todo functionality works: CRUD, lists, tags, search, drag-drop, height persistence
- [ ] Zero TypeScript errors, no regressions

## Design Decisions

### Identical pattern to NotebookViewModel (US-057)

The migration follows the exact same pattern:

| Aspect | Before | After |
|--------|--------|-------|
| Base class | `TComponentModel<TodoEditorState, TodoEditorProps>` | `ContentViewModel<TodoEditorState>` |
| Constructor | Receives `props` (TComponentModel pattern) | Receives `host: IContentHost` |
| Content sync | `effect()` watching `model.state.get().content` | `onContentChanged(content)` hook |
| Lifecycle | `init()` / `dispose()` | `onInit()` / `onContentChanged()` / `onDispose()` |
| Component hook | `useComponentModel()` | `useContentViewModel<TodoViewModel>(model, "todo-view")` |
| TextFileModel access | `this.props.model` | `this.host` (via `IContentHost`) + `pageModel` getter for casting |
| Factory | None | `createTodoViewModel(host)` |

### Self-change loop prevention

Same `skipNextContentUpdate` flag pattern as NotebookViewModel.

### Replacing TComponentModel `effect()` with subscriptions

| Current `effect()` | ContentViewModel equivalent |
|--------------------|---------------------------|
| Watch host content -> `updateContent()` | Base class auto-calls `onContentChanged()` |
| Watch filteredItems/tags -> `gridModel?.update()` | Moved to `useEffect` in TodoEditor component (React rendering concern) |
| Debounced serialize back to host | Subscribe to `this.state` in `onInit()` |

### `gridModel?.update({ all: true })` — moved to component

Same decision as US-057. This is a React rendering concern (forces `RenderFlexGrid` to re-render). Move to `useEffect` in `TodoEditor` watching `filteredItems` and `tags`.

### `props.model` -> `this.host` mapping

| Current (TodoEditorModel) | New (TodoViewModel) |
|---------------------------|---------------------|
| `this.props.model` | `this.host` |
| `this.props.model.state.get().content` | `this.host.state.get().content` |
| `this.props.model.state.get().id` | `this.host.id` |
| `this.props.model.changeContent(content, true)` | `this.host.changeContent(content, true)` |

### Selection state caching — switch to `stateStorage`

Currently uses `fs.getCacheFile()` / `fs.saveCacheFile()` directly. Switch to `this.host.stateStorage.getState()` / `setState()` for consistency with GridViewModel. The default `stateStorage` on TextFileModel delegates to the same `fs` calls, so behavior is identical — but using the abstraction keeps all editors consistent and future-proof.

### Debounced save flush on dispose

Same as US-057: call `onDataChanged()` directly in `onDispose()` to flush pending 300ms debounce.

### Smart serialization comparison

TodoEditorModel compares only content-relevant parts (`items`, `lists`, `tags`) — NOT UI state (`state` which contains heights). This prevents ResizeObserver height measurements from marking the file as modified. This logic stays exactly the same.

### `model.state.use()` removal

Currently `TodoEditor` calls `model.state.use()` at line 120 to subscribe to host content changes for `effect()` re-evaluation. After migration, `ContentViewModel` subscribes to host content directly — the component no longer needs this.

### Portal refs stay on the TextFileModel

Portal refs (`editorToolbarRefFirst`, `editorToolbarRefLast`, `editorFooterRefLast`) are NOT part of `IContentHost`. `TodoEditor` continues to access them from the concrete `model` (TextFileModel) passed as a prop.

## Files to Modify

| File | Change |
|------|--------|
| `editors/todo/TodoEditorModel.ts` | DELETE — replaced by TodoViewModel.ts |
| `editors/todo/TodoViewModel.ts` | CREATE — new ContentViewModel subclass |
| `editors/todo/TodoEditor.tsx` | Update to `useContentViewModel` + `useSyncExternalStore` |
| `editors/todo/components/TodoListPanel.tsx` | Type: `TodoEditorModel` -> `TodoViewModel` |
| `editors/todo/components/TodoItemView.tsx` | Type: `TodoEditorModel` -> `TodoViewModel` |
| `editors/register-editors.ts` | Add `createViewModel: createTodoViewModel` |

## Implementation Steps

### Step 1: Create TodoViewModel

- [ ] Create `TodoViewModel.ts` with `class TodoViewModel extends ContentViewModel<TodoEditorState>`
- [ ] Constructor: `super(host, defaultTodoEditorState)`
- [ ] Move state shape (`defaultTodoEditorState`, `TodoEditorState` type)
- [ ] Implement `onInit()`:
  - Subscribe to own state changes for debounced serialize back to host (`addSubscription`)
  - Process initial content: `loadData(this.host.state.get().content || "")`
- [ ] Implement `onContentChanged(content)`:
  - Skip if `skipNextContentUpdate` is true (self-change loop prevention)
  - Call `loadData(content)`
- [ ] Implement `onDispose()`:
  - Flush pending debounced save by calling `onDataChanged()` directly
- [ ] Move all methods from TodoEditorModel (data, lists, tags, items, search, filtering, height, UI state)
- [ ] Replace `this.props.model` -> `this.host` everywhere
- [ ] Replace `this.props.model.state.get().id` -> `this.host.id`
- [ ] Replace `fs.getCacheFile`/`fs.saveCacheFile` -> `this.host.stateStorage.getState`/`setState` (consistency with GridViewModel)
- [ ] Remove `gridModel` field and `setGridModel` method (moved to component)
- [ ] Remove `stateChangeSubscription` field (replaced by `addSubscription`)
- [ ] Add `pageModel` getter for potential script context access
- [ ] Export factory: `createTodoViewModel(host: IContentHost) => new TodoViewModel(host)`

### Step 2: Update TodoEditor component

- [ ] Replace `useComponentModel(props, TodoEditorModel, defaultTodoEditorState)` with `useContentViewModel<TodoViewModel>(model, "todo-view")`
- [ ] Remove `model.state.use()` (no longer needed)
- [ ] Use `useSyncExternalStore` unconditionally (Rules of Hooks pattern from US-056/US-057)
- [ ] Return null while VM is loading
- [ ] All `pageModel.xxx` -> `vm.xxx`
- [ ] Own `gridModel` ref (via `useRef`/`useCallback`) + `useEffect` watching filteredItems and tags -> `gridModel?.update({ all: true })`
- [ ] Portal refs: continue accessing from `model` (TextFileModel)

### Step 3: Register factory

- [ ] Add `createTodoViewModel` import in `loadModule` for todo-view registration
- [ ] Use parallel `Promise.all` pattern (same as notebook registration)

### Step 4: Update child components

- [ ] `TodoListPanel.tsx`: change `pageModel: TodoEditorModel` -> `TodoViewModel` (import + type)
- [ ] `TodoItemView.tsx`: change `pageModel: TodoEditorModel` -> `TodoViewModel` (import + type)

### Step 5: Cleanup

- [ ] Delete `TodoEditorModel.ts`
- [ ] Verify: `tsc --noEmit` passes
- [ ] Verify: `npm run lint` clean (pre-existing warnings OK)

## Test Checklist

### Basic CRUD
- [ ] Create new todo item via quick-add
- [ ] Toggle item done/undone
- [ ] Edit item title
- [ ] Delete item (with confirmation)
- [ ] Add/edit/remove comment on item

### Lists
- [ ] Create new list
- [ ] Rename list (items update)
- [ ] Delete list (items deleted, with confirm)
- [ ] Filter by list
- [ ] "All" shows all items

### Tags
- [ ] Create new tag
- [ ] Rename tag (items update)
- [ ] Change tag color
- [ ] Delete tag (removed from items, with confirm)
- [ ] Assign/remove tag on items
- [ ] Filter by tag

### Search
- [ ] Text search filters items
- [ ] Clear search restores items
- [ ] Multi-word AND search
- [ ] Search + list filter combined

### Drag & Drop
- [ ] Reorder undone items
- [ ] Warning when no list selected
- [ ] Warning when tag filter active

### State Persistence
- [ ] Item heights persisted (ResizeObserver)
- [ ] Selected list/tag restored on reopen
- [ ] Left panel width persisted

### Editor Switching
- [ ] Switch to Monaco and back preserves content
- [ ] Edit in Monaco, switch to todo-view — changes reflected

### General
- [ ] No errors in DevTools console
- [ ] Multiple todo tabs work independently
- [ ] Empty state (no items) displays correctly
- [ ] Separator between done/undone items

## Concerns

### 1. No embedded editors — simpler than Notebook

Unlike NotebookViewModel (which needed NoteItemEditModel partial IContentHost for embedded grid/markdown), TodoEditor has pure functional child components with no embedded content-view editors. No Task 9 concerns.

### 2. Smart serialization comparison

The `onDataChanged()` method compares `items`, `lists`, `tags` references individually (not the whole `data` object) to avoid marking the file modified when only heights change. This pattern transfers directly — same code, just `this.props.model` -> `this.host`.

### 3. Selection state cache — switch to `stateStorage` — Resolved

Switch from direct `fs.getCacheFile()`/`fs.saveCacheFile()` to `this.host.stateStorage.getState()`/`setState()`. The default implementation on TextFileModel delegates to the same `fs` calls, so behavior is identical. This keeps all editors consistent (same approach as GridViewModel) and enables custom storage contexts (e.g., if todo items ever get embedded in notebook notes).

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- TextViewModel (first reference): [US-055](../US-055-text-view-model/)
- GridViewModel (second reference): [US-056](../US-056-grid-view-model/)
- NotebookViewModel (direct pattern): [US-057](../US-057-notebook-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
