# US-055: TextViewModel (Monaco ContentViewModel)

## Status

**Status:** Planned
**Priority:** High
**Depends on:** US-052 (Foundation), US-053 (IContentHost), US-054 (Decomposition)

## Summary

Refactor `TextEditorModel` (extends `TModel`) into `TextViewModel` (extends `ContentViewModel`). Register a factory for `"monaco"` in EditorRegistry. Update TextEditor component to use `useContentViewModel` hook. Migrate all external consumers of `model.editor.*` to use delegate methods on TextFileModel.

This is **Task 2** from [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — the first concrete editor migrated to the ContentViewModel pattern.

## Why

- TextEditorModel is the last page-owned editor model not following the ContentViewModel pattern
- Unifying all editor models under ContentViewModel enables script API (`page.asText()`)
- Consistent lifecycle (acquire/release) across all editors
- Required before migrating content-view editors (Grid, Notebook, etc.) — establishes the pattern for the primary editor

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — full architecture document (Task 2)
- [US-052](../US-052-content-view-models-foundation/) — ContentViewModel base class, ContentViewModelHost, useContentViewModel hook
- [US-053](../US-053-textfilemodel-icontent-host/) — TextFileModel implements IContentHost

## Acceptance Criteria

- [ ] `TextEditorModel` refactored to `TextViewModel extends ContentViewModel<TextEditorState>`
- [ ] `createViewModel` factory registered for `"monaco"` in `register-editors.ts`
- [ ] `TextEditor` component uses `useContentViewModel(model, "monaco")` hook
- [ ] `TextToolbar` migrated — no direct `model.editor` access
- [ ] External consumers migrated to TextFileModel delegate methods
- [ ] TextFileModel removes eager `editor = new TextEditorModel(this)` creation
- [ ] `ContentViewModelHost` exposes `tryGet(editorId)` for synchronous cached access
- [ ] Pending operations (revealLine, setHighlightText) work when called before Monaco mounts
- [ ] App compiles with no errors
- [ ] All existing functionality works unchanged (see test checklist)

## Design Decisions

### Monaco doesn't parse content — `onContentChanged()` is a no-op

Unlike Grid/Notebook/Todo which parse JSON, Monaco displays raw text. The `<Editor>` React component receives content via props from `host.state`. `TextViewModel.onContentChanged()` is an empty implementation — content sync is handled by React's rendering of the Monaco `<Editor value={content}>` prop.

### External callers use TextFileModel delegate methods

NavigationPanel, PagesLifecycleModel, TextFileActionsModel, TextFileEncryptionModel all call `model.editor.revealLine()`, `model.editor.focusEditor()`, etc. synchronously. Since TextViewModel is now lazy (async acquire), these callers can't access it directly.

**Solution:** Add flat delegate methods on TextFileModel with pending support:

```typescript
// TextFileModel — new delegates
focusEditor() {
    const vm = this._vmHost.tryGet("monaco") as TextViewModel | undefined;
    vm?.focusEditor();
}

revealLine(lineNumber: number) {
    const vm = this._vmHost.tryGet("monaco") as TextViewModel | undefined;
    if (vm) { vm.revealLine(lineNumber); }
    else { this._pendingRevealLine = lineNumber; }
}

setHighlightText(text: string | undefined) {
    const vm = this._vmHost.tryGet("monaco") as TextViewModel | undefined;
    if (vm) { vm.setHighlightText(text); }
    else { this._pendingHighlightText = text; }
}

getSelectedText(): string {
    const vm = this._vmHost.tryGet("monaco") as TextViewModel | undefined;
    return vm?.getSelectedText() ?? "";
}
```

The `acquireViewModel` override applies pending operations when TextViewModel is first created:

```typescript
async acquireViewModel(editorId: PageEditor) {
    const vm = await this._vmHost.acquire(editorId, this);
    if (editorId === "monaco") {
        if (this._pendingRevealLine !== null) {
            (vm as TextViewModel).pendingRevealLine = this._pendingRevealLine;
            this._pendingRevealLine = null;
        }
        if (this._pendingHighlightText !== undefined) {
            (vm as TextViewModel).pendingHighlightText = this._pendingHighlightText;
            this._pendingHighlightText = undefined;
        }
    }
    return vm;
}
```

### ContentViewModelHost needs `tryGet()` method

New synchronous method on ContentViewModelHost to return a cached view model without changing ref count:

```typescript
tryGet(editorId: PageEditor): ContentViewModel<any> | undefined {
    return this._viewModels.get(editorId)?.vm;
}
```

Used by TextFileModel delegate methods for synchronous access.

### TextToolbar — tryGet, no extra ref

TextToolbar should NOT acquire its own ref to TextViewModel. It only needs `hasSelection` when Monaco is actually mounted (and TextEditor has already acquired the ref). If Monaco isn't mounted, there's obviously no selection.

**Approach:** Use `tryGet` to peek at the existing TextViewModel without incrementing refs. If it doesn't exist, `hasSelection = false`.

The conditional hook problem (`state.use()` can't be called conditionally) is solved with a small utility hook:

```typescript
// useOptionalModelState — always calls useSyncExternalStore, handles null model
function useOptionalModelState<T, R>(
    state: TOneState<T> | null | undefined,
    selector: (s: T) => R,
    defaultValue: R,
): R {
    return useSyncExternalStore(
        state ? (cb) => state.subscribe(cb) : () => () => {},
        state ? () => selector(state.get()) : () => defaultValue,
    );
}
```

TextToolbar usage:
```typescript
const textVm = model.getTextViewModel(); // tryGet — no ref, returns null if not created
const hasSelection = useOptionalModelState(textVm?.state, s => s.hasSelection, false);
```

TextFileModel exposes a simple getter:
```typescript
getTextViewModel(): TextViewModel | null {
    return this._vmHost.tryGet("monaco") as TextViewModel | null;
}
```

**Only TextEditor component acquires/releases the ref.** TextToolbar is a passive observer.

### Two lifecycles: ContentViewModel vs Monaco DOM

TextViewModel stays alive as long as any consumer holds a ref. Monaco's DOM element can be destroyed (TextEditor unmounts on editor switch) while TextViewModel is still alive.

**Handling:**
- TextViewModel tracks Monaco state: `editorRef` is set on mount, cleared on Monaco disposal
- Methods like `focusEditor()`, `revealLine()` gracefully no-op when `editorRef` is null
- The `pendingRevealLine`/`pendingHighlightText` fields store deferred operations
- When Monaco remounts (user switches back), `handleEditorDidMount()` applies pending ops

### Remove `model.editor` property

TextFileModel's `editor = new TextEditorModel(this)` is removed. The `editor` submodel is replaced by:
1. ContentViewModelHost manages TextViewModel lifecycle (lazy, ref-counted)
2. TextFileModel delegate methods provide synchronous access to common operations
3. React components use `useContentViewModel` hook

The `model.editor` property is removed entirely — no getter, no backward compatibility. All consumers are migrated in this task.

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/editors/text/TextEditor.tsx` | Refactor TextEditorModel → TextViewModel (ContentViewModel). Update React component to use `useContentViewModel`. |
| `src/renderer/editors/text/TextPageModel.ts` | Remove `editor` submodel. Add delegate methods (focusEditor, revealLine, setHighlightText, getSelectedText). Add pending fields. Override acquireViewModel. |
| `src/renderer/editors/text/TextToolbar.tsx` | Use `tryGet` via `model.getTextViewModel()` + `useOptionalModelState` hook. Remove `model.editor` access. |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Change `model.editor.getSelectedText()` → `model.getSelectedText()` |
| `src/renderer/editors/text/TextFileEncryptionModel.ts` | Change `model.editor.focusEditor()` → `model.focusEditor()` |
| `src/renderer/editors/text/ActiveEditor.tsx` | Pass `model` (IContentHost) — TextEditor now acquires via hook |
| `src/renderer/editors/base/ContentViewModelHost.ts` | Add `tryGet(editorId)` method |
| `src/renderer/editors/register-editors.ts` | Register `createViewModel` factory for `"monaco"` |
| `src/renderer/features/navigation/NavigationPanel.tsx` | Change `page.editor.focusEditor()` → `page.focusEditor()`, same for revealLine/setHighlightText |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Change `editor.revealLine()` / `editor.setHighlightText()` → model delegates |

## Implementation Steps

### Step 1: Add `tryGet()` to ContentViewModelHost
- [ ] Add `tryGet(editorId): ContentViewModel<any> | undefined` method
- [ ] Export from base/index.ts if needed

### Step 2: Refactor TextEditorModel → TextViewModel
- [ ] Rename class `TextEditorModel` → `TextViewModel`
- [ ] Change base class from `TModel<TextEditorState>` to `ContentViewModel<TextEditorState>`
- [ ] Replace constructor: `super(host, defaultTextEditorState)` instead of `super(new TComponentState(...))`
- [ ] Replace `private pageModel: TextFileModel` with `protected host: IContentHost` (from base class)
- [ ] Implement `onInit()` — move focus subscription setup here
- [ ] Implement `onContentChanged()` — empty (Monaco gets content via React props)
- [ ] Implement `onDispose()` — move cleanup logic here (wheel, selection, decorations, focus)
- [ ] Replace `this.pageModel.changeContent()` with `this.host.changeContent()`
- [ ] Use `addSubscription()` for focus subscription cleanup
- [ ] Keep Monaco-specific methods: handleEditorDidMount, focusEditor, revealLine, setHighlightText, getSelectedText, setupWheelZoom, setupSelectionListener
- [ ] Export `createTextViewModel` factory function

### Step 3: Register factory in EditorRegistry
- [ ] Add `createViewModel: createTextViewModel` to Monaco editor registration in `register-editors.ts`
- [ ] Ensure module is cached properly for sync factory access

### Step 4: Update TextEditor React component
- [ ] Use `useContentViewModel<TextViewModel>(model, "monaco")` hook
- [ ] Return null (or loading state) while TextViewModel is being acquired
- [ ] Remove manual `init()` / `dispose()` calls (hook handles lifecycle)
- [ ] Pass `host.state` content/language to Monaco `<Editor>` (unchanged)
- [ ] TextEditor prop changes from `model: TextFileModel` to `model: IContentHost`

### Step 5: Update TextFileModel
- [ ] Remove `editor = new TextEditorModel(this)` submodel
- [ ] Remove `this.editor.dispose()` from dispose()
- [ ] Add pending fields: `_pendingRevealLine`, `_pendingHighlightText`
- [ ] Add delegate methods: `focusEditor()`, `revealLine()`, `setHighlightText()`, `getSelectedText()`
- [ ] Override `acquireViewModel()` to apply pending operations for "monaco"
- [ ] Remove `editor` from barrel export if exported

### Step 6: Migrate TextToolbar
- [ ] Add `getTextViewModel()` getter on TextFileModel (returns `tryGet("monaco")`)
- [ ] Create `useOptionalModelState` utility hook (always calls useSyncExternalStore, handles null)
- [ ] Replace `model.editor.state.use()` with `useOptionalModelState(model.getTextViewModel()?.state, ...)`
- [ ] No extra ref — TextToolbar is a passive observer of existing TextViewModel

### Step 7: Migrate internal consumers
- [ ] `TextFileActionsModel.ts`: `model.editor.getSelectedText()` → `model.getSelectedText()`
- [ ] `TextFileEncryptionModel.ts`: `model.editor.focusEditor()` → `model.focusEditor()`

### Step 8: Migrate external consumers
- [ ] `NavigationPanel.tsx`: `page.editor.focusEditor()` → `page.focusEditor()`
- [ ] `NavigationPanel.tsx`: `page.editor.revealLine()` → `page.revealLine()`
- [ ] `NavigationPanel.tsx`: `page.editor.setHighlightText()` → `page.setHighlightText()`
- [ ] `PagesLifecycleModel.ts`: `editor.revealLine()` → model delegate
- [ ] `PagesLifecycleModel.ts`: `editor.setHighlightText()` → model delegate

### Step 9: Verify
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Manual test checklist (see below)

## Test Checklist

### Monaco Editor
- [ ] Open text file — Monaco loads, cursor blinks
- [ ] Type content — changes reflected in state
- [ ] Ctrl+S saves file
- [ ] F5 runs script (with selection: runs selected; without: runs all)
- [ ] Ctrl+Mouse Wheel zoom works
- [ ] Selection tracking works (Run Selected button appears when text selected)

### Editor Switching
- [ ] Open JSON file — switch from Monaco to Grid and back
- [ ] Content preserved on each switch
- [ ] Monaco re-focuses properly after switch back
- [ ] No errors in console during switch

### Navigation Panel
- [ ] Ctrl+Shift+F opens search in navigation panel
- [ ] Click search result — Monaco reveals the correct line
- [ ] Search highlighting appears in Monaco
- [ ] Close search — highlights cleared
- [ ] Close nav panel → Monaco focuses

### File Open with Reveal
- [ ] Open file from navigation panel search result — line revealed correctly
- [ ] Open file with highlight text — decorations applied

### Encryption
- [ ] Encrypt file — after dialog, Monaco re-focuses
- [ ] Decrypt file — after dialog, Monaco re-focuses

### General
- [ ] No errors in DevTools console during all operations
- [ ] Multiple windows work correctly
- [ ] Open multiple text files — each has independent TextViewModel

## Concerns

### 1. ScriptPanelModel parallel structure (NOT in scope)

`ScriptPanelModel` has the same structure as TextEditorModel — it's a `TModel` with Monaco instance, init/dispose, selection tracking. It is NOT migrated in this task because:
- ScriptPanel is always tied to TextFileModel (not a content-view editor)
- It doesn't need the ContentViewModel pattern (no script API for the script panel itself)
- Migrating it would add complexity without clear benefit

### 2. NoteEditorModel parallel (NOT in scope)

`NoteEditorModel` in notebook notes has the same pattern as TextEditorModel. It will be addressed in Task 9 (NoteItemEditModel — IContentHost) when the notebook note system is formalized.

### 3. TextToolbar reactivity when TextViewModel is created after toolbar renders

TextToolbar renders before TextEditor (both children of TextPageView). On first render, `getTextViewModel()` returns null → `hasSelection = false`. When TextEditor mounts and creates TextViewModel, TextToolbar doesn't automatically re-render. However, TextToolbar already subscribes to `model.state` (for language, editor, filePath, title) — the next state change triggers a re-render that picks up the TextViewModel. In practice, this is nearly immediate.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- IContentHost: [US-053](../US-053-textfilemodel-icontent-host/)
- Decomposition: [US-054](../US-054-textfilemodel-decomposition/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
- Next tasks: Grid (Task 3), Notebook (Task 4), etc.
