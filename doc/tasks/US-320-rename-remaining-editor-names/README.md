# US-320: Rename Remaining Editor Names for Consistency

**Epic:** EPIC-017 (Page/Editor Architecture Refactor) — Phase 1, Task 1.4
**Status:** Planned

## Goal

Rename the remaining EditorModel subclasses and file names that still use inconsistent patterns ("Viewer", "Inspector" without "Editor" suffix). This brings all page-editor models to a consistent `*EditorModel` naming pattern. Also rename `EditorCategory` string literal `"page-editor"` → `"standalone"` since "page" is being reclaimed for the container concept.

Pure mechanical rename — no behavior changes.

## Background

After US-317/318/319, most editors follow the `*EditorModel` pattern:
- `ZipEditorModel`, `BrowserEditorModel`, `CategoryEditorModel`, `AboutEditorModel`, `SettingsEditorModel`

But some page-editor models still use older naming:
- `ImageViewerModel` — in `ImageViewer.tsx` (model + view in one file)
- `PdfViewerModel` — in `PdfViewer.tsx` (model + view in one file)
- `McpInspectorModel` — in `McpInspectorModel.ts`

ContentViewModel subclasses (`GridViewModel`, `LogViewModel`, etc.) are **NOT renamed** — they correctly follow the `*ViewModel` pattern for content-view editors.

## Renames

### A. EditorModel subclass classes

| Current | New | File | Import count |
|---------|-----|------|-------------|
| `ImageViewerModel` | `ImageEditorModel` | `image/ImageViewer.tsx` | ~2 (internal) |
| `ImageViewerModelState` | `ImageEditorModelState` | same | ~1 |
| `PdfViewerModel` | `PdfEditorModel` | `pdf/PdfViewer.tsx` | ~2 (internal) |
| `PdfViewerModelState` | `PdfEditorModelState` | same | ~1 |
| `McpInspectorModel` | `McpInspectorEditorModel` | `mcp-inspector/McpInspectorModel.ts` | ~12 |
| `McpInspectorEditorState` | (already correct) | — | — |

### B. File renames

| Current | New |
|---------|-----|
| `mcp-inspector/McpInspectorModel.ts` | `mcp-inspector/McpInspectorEditorModel.ts` |

`ImageViewer.tsx` and `PdfViewer.tsx` contain both model and view in one file — renaming the file would be misleading. Keep the file names.

### C. EditorCategory literal

| Current | New | Notes |
|---------|-----|-------|
| `"page-editor"` | `"standalone"` | In `types.ts`, `register-editors.ts`, docs. "Page" is being reclaimed. "Standalone" describes these editors better — they stand alone with their own EditorModel. |

### D. Backward compat aliases to remove

| Alias | Location |
|-------|----------|
| `PdfPageModel` (if exists) | `pdf/PdfViewer.tsx` |
| `ImagePageModel` (if exists) | `image/ImageViewer.tsx` |
| Inline compat exports in `TextEditorView.tsx`, `TextToolbar.tsx`, etc. | Various text editor files |

### E. PagesLifecycleModel private methods

| Current | New | Notes |
|---------|-----|-------|
| `this.newEditorModel` (private method) | Keep — this is correctly named now | — |
| `newEditorModelFromState` (private method) | Keep | — |

## Implementation Plan

### Step 1: Rename classes and state types

Inside each file, rename class and state interface:
- `ImageViewerModel` → `ImageEditorModel`, `ImageViewerModelState` → `ImageEditorModelState`
- `PdfViewerModel` → `PdfEditorModel`, `PdfViewerModelState` → `PdfEditorModelState`
- `McpInspectorModel` → `McpInspectorEditorModel`

### Step 2: Rename McpInspectorModel file

```
git mv mcp-inspector/McpInspectorModel.ts → mcp-inspector/McpInspectorEditorModel.ts
```

Update all imports (~12 files).

### Step 3: Rename EditorCategory literal

In `types.ts`:
```typescript
// Before:
export type EditorCategory = "page-editor" | "content-view";
// After:
export type EditorCategory = "standalone" | "content-view";
```

Update `register-editors.ts` (~15 occurrences) and any consumers that check `category === "page-editor"`.

### Step 4: Remove stale compat aliases

Check and remove any remaining backward compat aliases (`PdfPageModel`, inline re-exports in text editor files).

### Step 5: Update documentation

Architecture docs, CLAUDE.md.

### Step 6: Verify build

```bash
npm run lint
npx tsc --noEmit
```

## Concerns

1. **"standalone" vs "page-editor"** — RESOLVED: Rename to `"standalone"`. Cleaner and avoids future confusion since "page" is being reclaimed for the container concept.

2. **ImageViewer.tsx / PdfViewer.tsx** — These files contain both model and view. The file names describe the editor feature, not the model class. Renaming them to `ImageEditorModel.tsx` would be misleading since they also contain the view component. Keep as-is.

3. **Inline compat aliases** — Files like `TextEditorView.tsx` still export `{ TextEditorView as TextFilePage }` at the bottom. These are dead code but harmless. Remove if easy, skip if not.

## Acceptance Criteria

- [ ] `ImageViewerModel` → `ImageEditorModel` + state renamed
- [ ] `PdfViewerModel` → `PdfEditorModel` + state renamed
- [ ] `McpInspectorModel` → `McpInspectorEditorModel` + file renamed
- [ ] EditorCategory `"page-editor"` → `"standalone"` (if decided yes)
- [ ] Stale compat aliases removed
- [ ] Documentation updated
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

## Files Changed Summary

| Area | Estimated files |
|------|----------------|
| Class/state renames | ~5 files (editor implementations) |
| McpInspector file rename + imports | ~12 files |
| EditorCategory literal (if renamed) | ~5 files |
| Compat alias removal | ~5 files |
| Documentation | ~5 files |
| **Total estimated** | **~25-30 files** |
