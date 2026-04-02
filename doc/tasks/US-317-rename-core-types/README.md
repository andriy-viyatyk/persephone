# US-317: Rename Core Types (IPageState → IEditorState, PageType → EditorType, PageEditor → EditorView)

**Epic:** EPIC-017 (Page/Editor Architecture Refactor) — Phase 1, Task 1.1
**Status:** Planned

## Goal

Rename the three core type aliases in `shared/types.ts` and update all consumers. This is a pure mechanical rename — no behavior changes, no structural changes. It establishes the correct vocabulary for the Page/Editor architecture refactor.

## Background

Currently `IPageState` describes editor state (content, language, filePath, pipe), `PageType` discriminates editor types ("textFile", "zipFile"), and `PageEditor` identifies editor views ("monaco", "grid-json"). These names will conflict with the new `PageModel` (container) and `IPageState` (container state) being introduced in Phase 2. Renaming now avoids confusion during the rest of the epic.

### What gets renamed

| Current | New | Defined in | Consumers |
|---------|-----|-----------|-----------|
| `IPageState` | `IEditorState` | `src/shared/types.ts` | ~36 files |
| `PageType` | `EditorType` | `src/shared/types.ts` | ~13 files |
| `PageEditor` | `EditorView` | `src/shared/types.ts` | ~27 files |
| `WindowState.pages: Partial<IPageState>[]` | `WindowState.pages: Partial<IEditorState>[]` | `src/shared/types.ts` | ~3 files |
| `WindowPages.pages: Partial<IPageState>[]` | `WindowPages.pages: Partial<IEditorState>[]` | `src/shared/types.ts` | ~5 files |
| `PageDragData.page: Partial<IPageState>` | `PageDragData.page: Partial<IEditorState>` | `src/shared/types.ts` | ~4 files |
| `PageEditor` (in script API) | `EditorView` | `assets/editor-types/common.d.ts` + `src/renderer/api/types/common.d.ts` | ~4 files |

### What does NOT get renamed in this task

- `PageModel` class → `EditorModel` (separate task US-318)
- `EditorDefinition.pageType` field → `editorType` (separate task, after PageModel rename)
- String literal values like `"textFile"`, `"monaco"` — these stay as-is
- `ISourceLink` — stays (not page/editor specific)
- `EditorDefinition`, `EditorRegistry`, `EditorModule` — already correctly named
- File names — no file renames in this task

## Implementation Plan

### Step 1: Rename type definitions in `shared/types.ts`

**File:** `src/shared/types.ts`

```typescript
// Before:
export type PageType = "textFile" | "pdfFile" | ...
export type PageEditor = "monaco" | "grid-json" | ...
export interface IPageState { ... }
export interface WindowState { pages: Partial<IPageState>[]; ... }
export interface WindowPages { pages: Partial<IPageState>[]; ... }
export interface PageDragData { page?: Partial<IPageState>; ... }

// After:
export type EditorType = "textFile" | "pdfFile" | ...
export type EditorView = "monaco" | "grid-json" | ...
export interface IEditorState { ... }
export interface WindowState { pages: Partial<IEditorState>[]; ... }
export interface WindowPages { pages: Partial<IEditorState>[]; ... }
export interface PageDragData { page?: Partial<IEditorState>; ... }
```

### Step 2: Update all imports in `src/`

Find-replace in all files that import from `shared/types`:

- `IPageState` → `IEditorState` (in imports and all usages)
- `PageType` → `EditorType` (in imports and all usages)
- `PageEditor` → `EditorView` (in imports and all usages)

**Files to update (grouped by area):**

**Editors base + types** (~8 files):
- `src/renderer/editors/base/PageModel.ts` — `IPageState` import + generic constraint `<T extends IEditorState>`
- `src/renderer/editors/base/IContentHost.ts` — `PageEditor` → `EditorView`
- `src/renderer/editors/base/ContentViewModelHost.ts` — `PageEditor` → `EditorView`
- `src/renderer/editors/base/useContentViewModel.ts` — `PageEditor` → `EditorView`
- `src/renderer/editors/types.ts` — all three types
- `src/renderer/editors/registry.ts` — `PageEditor` → `EditorView`
- `src/renderer/editors/register-editors.ts` — `PageType` in `pageType` field annotations (if any explicit type annotations exist)

**Editor implementations** (~12 files):
- `src/renderer/editors/text/TextPageModel.ts` — `IPageState`, `PageEditor`
- `src/renderer/editors/text/TextToolbar.tsx` — `PageEditor`
- `src/renderer/editors/text/ActiveEditor.tsx` — `PageEditor`
- `src/renderer/editors/grid/GridEditor.tsx` — `PageEditor`
- `src/renderer/editors/zip/ZipPageModel.ts` — `IPageState`
- `src/renderer/editors/zip/index.ts` — `PageType`, `IPageState`
- `src/renderer/editors/browser/BrowserPageModel.ts` — `IPageState`
- `src/renderer/editors/browser/BrowserPageView.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/browser/BrowserBookmarks.ts` — `PageEditor`
- `src/renderer/editors/about/AboutPage.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/settings/SettingsPage.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/mcp-inspector/McpInspectorModel.ts` — `IPageState`
- `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/pdf/PdfViewer.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/image/ImageViewer.tsx` — `IPageState`, `PageType`
- `src/renderer/editors/category/CategoryPageModel.ts` — `IPageState`
- `src/renderer/editors/category/CategoryEditor.tsx` — `PageType`, `IPageState`
- `src/renderer/editors/notebook/note-editor/NoteItemActiveEditor.tsx` — `PageEditor`
- `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` — `PageEditor`

**Pages API** (~4 files):
- `src/renderer/api/pages/PagesModel.ts` — `IPageState`, `PageEditor`
- `src/renderer/api/pages/PagesLifecycleModel.ts` — `IPageState`, `ISourceLink`, `PageEditor`, `PageType`
- `src/renderer/api/pages/PagesPersistenceModel.ts` — `IPageState`, `WindowState`
- `src/renderer/api/pages/PagesLayoutModel.ts` — check if imports these types

**UI** (~3 files):
- `src/renderer/ui/app/RenderEditor.tsx` — `PageType`
- `src/renderer/ui/navigation/NavigationData.ts` — `IPageState`
- `src/renderer/ui/sidebar/OpenTabsList.tsx` — `IPageState`, `WindowPages`

**Scripting** (~2 files):
- `src/renderer/scripting/api-wrapper/PageWrapper.ts` — `PageEditor`
- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` — `PageEditor`

**IPC** (~2 files):
- `src/ipc/api-types.ts` — `IPageState`, `PageDragData`, `WindowPages`
- `src/ipc/renderer/renderer-events.ts` — `IPageState`

**Main process** (~1 file):
- `src/main/open-windows.ts` — `IPageState`, `WindowPages`

### Step 3: Update script API type definitions

**File:** `src/renderer/api/types/common.d.ts`
- `PageEditor` → `EditorView`

**File:** `assets/editor-types/common.d.ts`
- `PageEditor` → `EditorView`

**Files that import `PageEditor` from `common.d.ts`:**
- `src/renderer/api/types/page.d.ts` — import + usage
- `src/renderer/api/types/pages.d.ts` — import + usage (`addEditorPage` param)
- `assets/editor-types/page.d.ts` — import + usage
- `assets/editor-types/pages.d.ts` — import + usage

### Step 4: Update `_imports.txt`

**File:** `assets/editor-types/_imports.txt`
- Check if `PageEditor` is referenced, update if so

### Step 5: Verify build

```bash
npm run lint
npm start  # quick smoke test
```

## Concerns

1. **Generic constraints cascade** — `PageModel<T extends IPageState>` becomes `PageModel<T extends IEditorState>`. All subclasses that pass specific state types (e.g., `TextPageModel extends PageModel<ITextPageState>`) will work as-is because their state interfaces extend `IPageState`/`IEditorState`. Those sub-interfaces (`ITextPageState`, `IBrowserPageState`, etc.) do NOT need renaming in this task — they don't have "Page" in their name or they'll be handled when the class itself is renamed.

2. **EditorDefinition.pageType field** — This field references `PageType` (now `EditorType`). The field annotation changes from `pageType: PageType` to `pageType: EditorType`. The field NAME `pageType` stays for now (renamed to `editorType` in a later task when PageModel → EditorModel rename happens, to avoid touching register-editors.ts twice).

3. **String literal values unchanged** — The actual values like `"textFile"`, `"monaco"`, `"grid-json"` do NOT change. Only the type alias names change. This means serialized data (JSON files, cache) is unaffected.

4. **No file renames** — Files like `PageModel.ts` keep their names. File renames happen in the next task (US-318).

## Acceptance Criteria

- [ ] `IPageState` → `IEditorState` in `shared/types.ts` and all consumers
- [ ] `PageType` → `EditorType` in `shared/types.ts` and all consumers
- [ ] `PageEditor` → `EditorView` in `shared/types.ts` and all consumers
- [ ] `WindowState`, `WindowPages`, `PageDragData` updated to use `IEditorState`
- [ ] Script API `.d.ts` files updated (`PageEditor` → `EditorView`)
- [ ] `npm run lint` passes
- [ ] Application starts and basic functionality works (open file, switch editors, navigate)

## Files Changed Summary

| File | Change |
|------|--------|
| `src/shared/types.ts` | Rename type definitions |
| `assets/editor-types/common.d.ts` | `PageEditor` → `EditorView` |
| `src/renderer/api/types/common.d.ts` | `PageEditor` → `EditorView` |
| `assets/editor-types/page.d.ts` | Update import |
| `assets/editor-types/pages.d.ts` | Update import |
| `src/renderer/api/types/page.d.ts` | Update import |
| `src/renderer/api/types/pages.d.ts` | Update import |
| ~36 `.ts`/`.tsx` files | Update `IPageState` → `IEditorState` in imports + usages |
| ~13 `.ts`/`.tsx` files | Update `PageType` → `EditorType` in imports + usages |
| ~27 `.ts`/`.tsx` files | Update `PageEditor` → `EditorView` in imports + usages |

**Total: ~48 files** (many files import multiple types, so distinct file count is lower than sum)
