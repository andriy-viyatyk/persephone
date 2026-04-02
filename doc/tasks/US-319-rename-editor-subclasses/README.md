# US-319: Rename Editor Subclasses and EditorModule Interface

**Epic:** EPIC-017 (Page/Editor Architecture Refactor) — Phase 1, Task 1.3
**Status:** Planned

## Goal

Rename editor subclasses that still have "Page" in their name, rename the `EditorModule` interface methods (`newPageModel` → `newEditorModel`), rename `EditorDefinition.pageType` → `editorType`, and clean up related state interface names. Pure mechanical rename — no behavior changes.

## Renames

### A. Editor subclass classes + files

| Current class | New class | Current file | New file | Import count |
|--------------|-----------|-------------|----------|-------------|
| `ZipPageModel` | `ZipEditorModel` | `zip/ZipPageModel.ts` | `zip/ZipEditorModel.ts` | ~5 |
| `CategoryPageModel` | `CategoryEditorModel` | `category/CategoryPageModel.ts` | `category/CategoryEditorModel.ts` | ~2 |
| `BrowserPageModel` | `BrowserEditorModel` | `browser/BrowserPageModel.ts` | `browser/BrowserEditorModel.ts` | ~11 |
| `AboutPageModel` | `AboutEditorModel` | (inside `AboutPage.tsx`) | (same file) | ~2 |
| `SettingsPageModel` | `SettingsEditorModel` | (inside `SettingsPage.tsx`) | (same file) | ~1 |

**NOT renamed** (no "Page" in name):
- `TextFileModel` — already correctly named (represents a text file editor)
- `McpInspectorModel` — no "Page"
- `PdfViewerModel` — no "Page"
- `ImageViewerModel` — no "Page"

### B. State interfaces

| Current | New | Location |
|---------|-----|----------|
| `ZipPageModelState` | `ZipEditorModelState` | `zip/ZipEditorModel.ts` |
| `CategoryPageModelState` | `CategoryEditorModelState` | `category/CategoryEditorModel.ts` |
| `BrowserPageState` | `BrowserEditorState` | `browser/BrowserEditorModel.ts` |
| `AboutPageModelState` | `AboutEditorModelState` | `about/AboutPage.tsx` |
| `SettingsPageModelState` | `SettingsEditorModelState` | `settings/SettingsPage.tsx` |
| `McpInspectorPageState` | `McpInspectorEditorState` | `mcp-inspector/McpInspectorModel.ts` |
| `TextFilePageModelState` | `TextFileEditorModelState` | `text/TextPageModel.ts` |
| `PdfViewerModelState` | (keep — no "Page") | — |
| `ImageViewerModelState` | (keep — no "Page") | — |

### C. Helper functions

| Current | New | Location |
|---------|-----|----------|
| `getDefaultZipPageModelState` | `getDefaultZipEditorModelState` | `zip/ZipEditorModel.ts` |
| `getDefaultTextFilePageModelState` | `getDefaultTextFileEditorModelState` | `text/TextPageModel.ts` |
| `newBrowserPageModel` | `newBrowserEditorModel` | `browser/BrowserEditorModel.ts` |

### D. EditorModule interface methods (cross-cutting)

In `src/renderer/editors/types.ts`:
```typescript
// Before:
newPageModel(filePath?: string): Promise<EditorModel>;
newEmptyPageModel(pageType: EditorType): Promise<EditorModel | null>;
newPageModelFromState(state: Partial<IEditorState>): Promise<EditorModel>;

// After:
newEditorModel(filePath?: string): Promise<EditorModel>;
newEmptyEditorModel(editorType: EditorType): Promise<EditorModel | null>;
newEditorModelFromState(state: Partial<IEditorState>): Promise<EditorModel>;
```

**Files implementing these methods (~13):**
- `src/renderer/editors/register-editors.ts` (newPageModel, newEmptyPageModel for text editors)
- `src/renderer/editors/zip/index.ts`
- `src/renderer/editors/category/CategoryEditor.tsx`
- `src/renderer/editors/about/AboutPage.tsx`
- `src/renderer/editors/settings/SettingsPage.tsx`
- `src/renderer/editors/pdf/PdfViewer.tsx`
- `src/renderer/editors/image/ImageViewer.tsx`
- `src/renderer/editors/browser/BrowserPageView.tsx`
- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx`

**Files calling these methods (~3):**
- `src/renderer/api/pages/PagesLifecycleModel.ts`
- `src/renderer/api/pages/PagesPersistenceModel.ts`
- `src/renderer/ui/navigation/NavigationData.ts`

### E. EditorDefinition.pageType field

In `src/renderer/editors/types.ts`:
```typescript
// Before:
pageType: EditorType;
// After:
editorType: EditorType;
```

**Files referencing `.pageType` (~3 + register-editors with 25 occurrences):**
- `src/renderer/editors/register-editors.ts` — 25 occurrences (all editor registrations)
- `src/renderer/ui/app/RenderEditor.tsx`
- `src/renderer/api/pages/PagesLifecycleModel.ts`
- `src/renderer/api/pages/PagesPersistenceModel.ts`

### F. Other renames

| Current | New | Notes |
|---------|-----|-------|
| `FileEditorPage<T>` | `FileEditorComponent<T>` | Type alias in `types.ts` — "Page" misleading |
| `EditorPageModule` | `EditorViewModule` | Interface in `types.ts` — "Page" misleading |
| `TextFilePageModel` (compat alias) | Remove | In `text/index.ts` line 29 — backward compat alias |
| `PdfPageModel` (compat alias) | Remove if exists | Check `pdf/PdfViewer.tsx` |

### G. Text editor file rename

| Current file | New file |
|-------------|----------|
| `text/TextPageModel.ts` | `text/TextEditorModel.ts` |
| `text/TextPageView.tsx` | `text/TextEditorView.tsx` |

## Implementation Plan

### Step 1: Rename types.ts interfaces and type aliases

Update `src/renderer/editors/types.ts`:
- `FileEditorPage` → `FileEditorComponent`
- `EditorPageModule` → `EditorViewModule`
- `EditorModelCreations` methods: `newPageModel` → `newEditorModel`, etc.
- `EditorDefinition.pageType` → `editorType`

### Step 2: Update EditorModule method implementations

Bulk replace across all ~13 implementing files:
- `newPageModel` → `newEditorModel`
- `newEmptyPageModel` → `newEmptyEditorModel`
- `newPageModelFromState` → `newEditorModelFromState`
- `pageType:` → `editorType:` in register-editors.ts (25 occurrences)
- `.pageType` → `.editorType` in consumer files

### Step 3: Rename subclass files (git mv)

- `zip/ZipPageModel.ts` → `zip/ZipEditorModel.ts`
- `category/CategoryPageModel.ts` → `category/CategoryEditorModel.ts`
- `browser/BrowserPageModel.ts` → `browser/BrowserEditorModel.ts`
- `text/TextPageModel.ts` → `text/TextEditorModel.ts`
- `text/TextPageView.tsx` → `text/TextEditorView.tsx`

### Step 4: Rename classes, state interfaces, and helper functions

Inside each file:
- Class names (e.g., `ZipPageModel` → `ZipEditorModel`)
- State interfaces (e.g., `ZipPageModelState` → `ZipEditorModelState`)
- Helper functions (e.g., `getDefaultZipPageModelState` → `getDefaultZipEditorModelState`)

### Step 5: Update all imports

Bulk replace import references across all consuming files.

### Step 6: Clean up barrel exports

- `text/index.ts` — update exports, remove `TextFilePageModel` compat alias
- `zip/index.ts` — update import path
- `browser/` — update any barrel exports

### Step 7: Update documentation

Architecture docs, standards docs, CLAUDE.md.

### Step 8: Verify build

```bash
npm run lint
npx tsc --noEmit
```

## Concerns

1. **TextFileModel stays** — The class `TextFileModel` is well-named (it IS a text file editor model). Only the file `TextPageModel.ts` → `TextEditorModel.ts` and the state `TextFilePageModelState` → `TextFileEditorModelState` change.

2. **register-editors.ts is dense** — 25 `pageType:` occurrences. Bulk sed with word boundary should handle it cleanly.

3. **`newPageModel` in PagesLifecycleModel** — The method `newPageModel` is a private helper in `PagesLifecycleModel` that calls `module.newPageModel()`. Both the interface method and the caller rename. But there's also `this.newPageModel` as a local method — need to rename that too.

4. **Backward compat aliases** — `TextFilePageModel`, `PdfPageModel` aliases should be removed (no backward compat per EPIC-017 decision).

5. **`newTextFileModel` / `isTextFileModel`** — These stay since `TextFileModel` class stays.

## Acceptance Criteria

- [ ] All "Page" subclass names renamed to "Editor" pattern
- [ ] All state interfaces with "Page" renamed
- [ ] `EditorModule` interface methods renamed (`newEditorModel`, etc.)
- [ ] `EditorDefinition.pageType` → `editorType`
- [ ] `FileEditorPage` → `FileEditorComponent`, `EditorPageModule` → `EditorViewModule`
- [ ] Files renamed via `git mv`
- [ ] Barrel exports and backward compat aliases cleaned up
- [ ] All imports updated
- [ ] Documentation updated
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

## Files Changed Summary

| Area | Estimated files |
|------|----------------|
| File renames (git mv) | 5 files |
| Class/interface/function renames | ~15 files (editor implementations) |
| Import updates | ~50 files |
| `register-editors.ts` | 25+ edits (pageType → editorType) |
| `PagesLifecycleModel.ts` | method renames + field access |
| Documentation | ~10 files |
| **Total estimated** | **~80 files** |
