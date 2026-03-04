# US-062: NoteItemEditModel — Formal IContentHost Implementation

## Overview

Make `NoteItemEditModel` formally implement `IContentHost`, remove the unsafe `as unknown as TextFileModel` cast in `NoteItemActiveEditor`, and update `AsyncEditor` typing to accept `IContentHost`.

This is **Task 9** in the content view models migration ([9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)).

## Current State

### The duck-typing cast

`NoteItemEditModel` adapts notebook notes to look like `TextFileModel` so content-view editors (Grid, Markdown, SVG, etc.) can render note content. It manually replicates the interface but uses unsafe casts in two places:

```typescript
// NoteItemActiveEditor.tsx:39
model={model as unknown as TextFileModel}

// NoteItemEditModel.ts:321
return this._vmHost.acquire(editorId, this as any);
```

### What's already done (US-057)

`NoteItemEditModel` already has:
- `acquireViewModel()` / `releaseViewModel()` via `ContentViewModelHost` composition
- `stateStorage: EditorStateStorage` backed by notebook's per-note state
- `changeContent()`, `changeEditor()`, `changeLanguage()` methods
- `state: TComponentState<NoteItemEditState>` with `content`, `language`, `editor`
- `id: string` (note ID)

### What's missing for formal `implements IContentHost`

1. **`implements IContentHost` declaration** — class doesn't declare the interface
2. **`changeLanguage` signature mismatch** — takes `string` but IContentHost requires `string | undefined`
3. **`this as any` cast** in `acquireViewModel` — needed because class doesn't formally implement IContentHost
4. **`AsyncEditor` prop type** — requires `PageModel`, but `NoteItemEditModel` is not a `PageModel`
5. **`FileEditorPage` type constraint** — requires `T extends PageModel`, blocks `IContentHost`

## Design Decisions

### AsyncEditor accepts union type

`AsyncEditor` is used in two contexts:
1. **RenderEditor** — passes `PageModel` for page-editors (PDF, Image, Browser, Settings)
2. **ActiveEditor / NoteItemActiveEditor** — passes `TextFileModel` or `NoteItemEditModel` for content-views

Solution: Change `model: PageModel` to `model: PageModel | IContentHost`. Both usage contexts satisfied.

### FileEditorPage type widened

Current: `React.ComponentType<{ model: T extends PageModel }>` — blocks `IContentHost`.

New: `React.ComponentType<{ model: T extends PageModel | IContentHost }>`. Individual editors keep their specific prop type (`TextFileModel`); the widening only affects the pass-through layer.

### Individual editors unchanged

Content-view editors (GridEditor, MarkdownView, SvgView, etc.) keep `model: TextFileModel` in their prop types. They access TextFileModel-specific properties (portal refs, `filePath`, etc.) that aren't on `IContentHost`. The duck-typing at the AsyncEditor→Editor boundary already exists and continues to work through TypeScript's structural type system.

### Compatibility properties remain

`NoteItemEditModel` has compatibility properties (`filePath`, `title`, `encripted`, `noLanguage`, etc.) that aren't part of `IContentHost`. These stay for runtime compatibility — editors like MarkdownView access `filePath` which returns `undefined` (harmless for notebook notes).

## Scope

### Files to modify

| File | Changes |
|------|---------|
| `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` | Add `implements IContentHost`, fix `changeLanguage` signature, remove `this as any` |
| `src/renderer/editors/notebook/note-editor/NoteItemActiveEditor.tsx` | Remove `as unknown as TextFileModel` cast, remove unused `TextFileModel` import |
| `src/renderer/ui/app/AsyncEditor.tsx` | Change `model: PageModel` to `model: PageModel \| IContentHost` |
| `src/renderer/editors/types.ts` | Widen `FileEditorPage` constraint to accept `IContentHost` |

### Files unchanged

| File | Reason |
|------|--------|
| `IContentHost.ts` | Interface already defined correctly |
| `useContentViewModel.ts` | Already accepts `IContentHost` |
| `ContentViewModelHost.ts` | Already typed with `IContentHost` |
| Content-view editors (Grid, Markdown, SVG, etc.) | Keep `TextFileModel` prop type, no changes needed |
| `RenderEditor.tsx` | `PageModel` is part of the union, no changes |
| `ActiveEditor.tsx` | Already passes `TextFileModel` which satisfies union |

## Implementation Steps

### Step 1: Update NoteItemEditModel to formally implement IContentHost

- [ ] Add `implements IContentHost` to class declaration
- [ ] Fix `changeLanguage` parameter: `string` → `string | undefined`
- [ ] Remove `this as any` cast in `acquireViewModel()` — replace with `this`
- [ ] Verify TypeScript compiles without errors

### Step 2: Widen FileEditorPage type constraint

- [ ] Change `FileEditorPage<T extends PageModel = PageModel>` to `FileEditorPage<T extends PageModel | IContentHost = PageModel | IContentHost>`
- [ ] Add `IContentHost` import to `types.ts`

### Step 3: Update AsyncEditor prop type

- [ ] Change `model: PageModel` to `model: PageModel | IContentHost`
- [ ] Add `IContentHost` import

### Step 4: Remove cast in NoteItemActiveEditor

- [ ] Remove `as unknown as TextFileModel` cast — pass `model` directly
- [ ] Remove unused `TextFileModel` import

## Test Checklist

- [ ] Open notebook with notes — notes render correctly
- [ ] Switch note editor to Grid (JSON content) — grid renders in note
- [ ] Switch note editor to Markdown — markdown preview renders in note
- [ ] Switch back to Monaco — text editor works
- [ ] Edit content in Grid → switch to Monaco — changes preserved
- [ ] Notebook portal buttons (toolbar) — still functional
- [ ] Run script from note — executes correctly
- [ ] Open standalone text file — all content-views work (no regression)
- [ ] Open PDF/Image — page-editors still work via AsyncEditor

## Concerns

### 1. TypeScript structural compatibility at AsyncEditor→Editor boundary

**Status: Accepted**

`AsyncEditor` renders `<EditorModule.Editor model={model} />` where `model` is `PageModel | IContentHost` and `Editor` expects `TextFileModel`. This works through TypeScript's bivariant function parameter checking for React component props. Same pattern as the existing `PageModel` → `TextFileModel` passing.

### 2. MarkdownView accesses `filePath` not on IContentHost

**Status: Non-issue**

MarkdownView reads `model.state.use(s => s.filePath)` for relative image path resolution. `NoteItemEditModel`'s state doesn't have `filePath`, so it returns `undefined`. This is harmless — markdown images in notes just won't resolve relative paths. The `filePath` compatibility property on `NoteItemEditModel` (`get filePath(): string | undefined { return undefined; }`) covers direct property access.

### 3. Portal refs not on IContentHost

**Status: Non-issue**

Editors access `model.editorToolbarRefLast` etc. for portal rendering. These exist on both `TextFileModel` and `NoteItemEditModel` but aren't on `IContentHost`. Since individual editors keep their `TextFileModel` prop type, TypeScript doesn't complain. At runtime, NoteItemEditModel provides these properties.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- IContentHost defined: [US-053](../US-053-textfilemodel-icontent-host/)
- GridViewModel (first content-view in notebooks): [US-056](../US-056-grid-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
