# EPIC-017: Page/Editor Architecture Refactor

**Status:** Active
**Created:** 2026-04-02
**Depends on:** EPIC-016 Phase 1 (completed)

## Overview

Refactor the page/editor architecture so that names match their actual roles. Currently, `PageModel` plays two roles — it is both the page (tab with navigation, sidebar, pinned state) and the editor (content, language, file I/O). `NavigationData` is the actual long-lived "page" entity, but it's attached as a parasite to `PageModel`.

This epic renames `PageModel` → `EditorModel`, then introduces a proper `PageModel` that owns the browsing context and contains an `EditorModel` as its main content. The result is a clean architecture where a Page is a tab with stable identity, and an Editor is the replaceable content inside it.

## Motivation

1. **Naming confusion** — `PageModel` is really an editor. It has `content`, `language`, `pipe`, `editor` fields. Meanwhile, `NavigationData` is the actual page container but has a utility-sounding name.

2. **Dual role** — `PageModel` has both page concerns (`pinned`, `hasNavigator`) and editor concerns (`content`, `language`, `filePath`, `pipe`). This mixing makes it hard to reason about responsibilities.

3. **Ownership inversion** — The editor owns the page context (`page.navigationData`), but the page context outlives the editor and has a back-reference (`navigationData.ownerModel`). This bidirectional coupling causes the 10-step navigation transfer ceremony.

4. **Identity mismatch** — Tab identity is the editor's ID, which changes on navigation. This forced `renderId`, `getStableKey`, and `updateId()` workarounds.

5. **Empty page workaround** — `addEmptyPageWithNavPanel()` creates a fake TextFileModel just to host NavigationData.

## Target Architecture

### Naming

| Current | New | Role |
|---------|-----|------|
| `PageModel` | `EditorModel` | Base class for all editors (text, grid, zip, etc.) |
| `IPageState` | `IEditorState` | Editor state interface (content, language, filePath, pipe, etc.) |
| `PageType` | `EditorType` | Type discriminator ("textFile", "zipFile", etc.) |
| `PageEditor` | `EditorView` | View discriminator ("monaco", "grid-json", etc.) |
| `NavigationData` | → absorbed into `PageModel` | Long-lived page context |
| *(new)* `PageModel` | `PageModel` | Page = tab = stable container with navigation + editor |
| *(new)* `IPageState` | `IPageState` | Page state (id, pinned, mainEditor descriptor, sidebar state) |

### Structure

```
PageModel (stable ID, one per tab — the "page")
├── id: string                          // stable UUID — tab identity, cache key, React key
├── pinned: boolean                     // tab-level property
├── title: string                       // derived from mainEditor or custom
├── modified: boolean                   // derived from mainEditor
├── mainEditor: EditorModel | null      // the content (null = empty page with Explorer only)
├── secondaryEditors: EditorModel[]     // sidebar editor panels (ZipEditorModel, etc.)
├── treeProvider: ITreeProvider | null   // Explorer panel
├── selectionState                      // shared Explorer selection
├── searchState                         // search panel
├── pageNavigatorModel                  // sidebar open/close/width
├── activePanel: string                 // which panel is expanded
├── navigateTo(filePath)                // swaps mainEditor (simple!)
├── save()                              // saves mainEditor + secondaryEditors if needed
└── dispose()                           // disposes all owned resources

EditorModel (= current PageModel, renamed — the "editor")
├── id: string                          // editor instance identity
├── state: IEditorState                 // editor-specific state (language, content, filePath, pipe, etc.)
├── pipe: IContentPipe                  // content source
├── modified: boolean                   // has unsaved changes
├── restore() / dispose()               // editor lifecycle
├── beforeNavigateAway(newEditor)       // secondary survival check
├── secondaryEditor: string | undefined // registers in page's sidebar
└── getRestoreData() / applyRestoreData() // editor-only serialization
```

### Key Principles

1. **Page owns Editor** — `page.mainEditor` (not `editor.navigationData`). No more ownership inversion.
2. **Stable page identity** — `page.id` never changes during navigation. No `renderId`, no `getStableKey`, no `updateId()`.
3. **Navigation = editor swap** — `page.navigateTo()` replaces `mainEditor`. No transfer ceremony.
4. **Empty pages are natural** — A page with `mainEditor = null` shows just Explorer.
5. **Every tab is a page** — Even About/Settings have a PageModel wrapper. Uniform treatment.
6. **Public API shape preserved** — `app.pages.openFile(path)` still works. Script `page.content` still works (proxies to `mainEditor`).

## Decisions

### A. Script `page` object — RESOLVED: Stays flat

Scripts see `page.content`, `page.language`, etc. — these proxy to `page.mainEditor` under the hood. No breaking change for script authors. In the future, `page.secondaryEditors[]` can be exposed if needed.

### B. Public API shape — RESOLVED: Preserved

`app.pages.openFile(path)` creates a Page + Editor internally but the external API is unchanged. Internally it splits into "create page" and "create editor inside page."

### C. `page.id` — RESOLVED: Page (container) ID

`page.id` in scripts and MCP returns the stable page ID. Editor IDs are internal. This means `page.id` no longer changes on navigation — which is an improvement.

### D. Backward compatibility — RESOLVED: Graceful ignore, no migration

Breaking change. Version bumps to **3.0.1**. Release notes warn users to save modifications before upgrading. No migration code. Old cache files remain in user data folder for manual recovery.

**Restore behavior with old data:** The saved `WindowState` format changes from flat `IPageState[]` to page descriptors containing editor state. The new `restoreState()` must detect old-format data and skip it gracefully:

```typescript
// In new restoreState():
const data = parseObject(await appFs.getDataFile(openFilesNameTemplate));
if (!data?.pages?.length) return;

// Detect old format: old pages have "type" at top level (e.g., "textFile")
// New format has "editor" object containing the editor state
const isOldFormat = data.pages[0]?.type && typeof data.pages[0]?.type === "string"
    && !data.pages[0]?.editor?.type;  // old: editor is a string; new: editor is an object
if (isOldFormat) {
    // Old format — skip. App starts with empty window.
    // User's first save overwrites with new format.
    return;
}
```

This way:
- First launch after upgrade: empty window (old state ignored)
- As user opens files, new-format state is saved automatically
- Old cache files (NavigationData, editor caches) become orphaned but harmless
- No migration logic, no compatibility shims

### E. Pages without editors (About, Settings)

Every tab has a PageModel, even trivial ones. The overhead is minimal and it keeps all code paths uniform.

### F. Grouped pages — Page-level

Grouping maps use page IDs (stable). Compare mode groups two pages. Cleaner than current design.

### G. `beforeNavigateAway` — Editor decides, Page orchestrates

The editor model knows its semantics (ZipEditorModel checks sourceId). The page calls `mainEditor.beforeNavigateAway(newEditor)` and handles the result (keep/remove secondary).

### H. PageModel `modified` flag — RESOLVED: Aggregate flag

The main process reads saved `WindowState` to check if a closing window has unsaved work ([open-windows.ts:60](src/main/open-windows.ts#L60): `pages.some(p => p.modified || p.pinned)`). This runs on serialized JSON, not live objects.

**Decision:** `PageModel` stores its own `modified` and `pinned` flags at the top level of the serialized page descriptor. `modified` is an aggregate: `true` if `mainEditor.modified` OR any `secondaryEditors[].modified`. This keeps the main process check simple — it reads the same top-level fields without knowing about the internal editor structure.

```typescript
// PageModel serialization (new format):
{
    id: "page-uuid",
    pinned: true,
    modified: true,           // aggregate: mainEditor OR secondaryEditors
    editor: { ... },          // mainEditor state (IEditorState)
    secondaryEditors: [ ... ] // secondary editor descriptors
}
```

The aggregate `modified` is updated reactively whenever the main editor or any secondary editor changes its modified state. The main process checker stays essentially the same: `pages.some(p => p.modified || p.pinned)` — just reading from the new format.

## Impact Analysis (~270 files affected)

### The Big Rename (~250 files, mechanical)

| Rename | Estimated files |
|--------|----------------|
| `PageModel` → `EditorModel` | ~73 files |
| `IPageState` → `IEditorState` | ~26 files |
| `PageType` → `EditorType` | ~20 files |
| `PageEditor` → `EditorView` | ~25 files |
| Import path changes (`editors/base`) | ~73 files |
| `shared/types.ts` consumers | ~43 files |

Most of this is find-replace. The rename does not change behavior — it establishes the correct vocabulary for the architectural changes that follow.

### Structural Changes (~30 files, significant)

| Area | What changes |
|------|-------------|
| New `PageModel` class | Absorbs NavigationData + container concerns |
| `PagesModel` + submodels | `pages[]` stores `PageModel[]`. IDs are page IDs. |
| `Pages.tsx` / rendering | `<Page />` component. `getStableKey` removed. |
| `PageTab` / `TabStrip` | Read from PageModel (title/icon delegate to mainEditor) |
| `navigatePageTo()` | Simplified to `page.setMainEditor(newEditor)` |
| Persistence | Page saves itself + its editor(s) as a unit |
| Multi-window transfer | Serialize entire page (editor + sidebar + secondary) |
| `addEmptyPageWithNavPanel()` | Becomes natural: page with no editor |

### API Surface (~15 files, thin wrappers)

| Area | What changes |
|------|-------------|
| `PageWrapper.ts` | `page.content` → `page.mainEditor.content` under the hood |
| `PageCollectionWrapper.ts` | `findPage()` returns page wrapper. IDs are page IDs. |
| `mcp-handler.ts` | `pageId` = page ID. Internal lookup adapts. |
| `page.d.ts` / `pages.d.ts` | `IPage.id` is stable page ID. Mostly unchanged externally. |
| IPC layer | `showWindowPage(windowIndex, pageId)` — pageId is stable |
| Main process | `open-windows.ts` checks `p.modified \|\| p.pinned` on serialized state — format changes but fields stay at top level. `window-states.ts` reads new format. |

## Phased Implementation Plan

### Phase 1: The Great Rename

Pure renaming — no behavior changes. Establishes correct vocabulary.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 1.1 | — | Rename core types | In `shared/types.ts`: `IPageState` → `IEditorState`, `PageType` → `EditorType`, `PageEditor` → `EditorView`. Update all ~43 importing files. | Planned |
| 1.2 | — | Rename PageModel → EditorModel | Rename class, file (`PageModel.ts` → `EditorModel.ts`), update `editors/base/index.ts` export, update all ~73 importing files. Rename subclass type params (e.g., `extends TDialogModel<T extends IEditorState>`). | Planned |
| 1.3 | — | Rename editor subclasses | `TextPageModel` → `TextEditorModel` (file + class). Same for all `*PageModel` in editors: `ZipPageModel`, `BrowserPageModel`, `CategoryPageModel`, `McpInspectorModel` (already named without "Page" — keep). Rename `TextFileModel` → `TextEditorModel` (or `TextFileEditorModel`). Update `isTextFileModel()` → `isTextEditorModel()`. | Planned |
| 1.4 | — | Rename ViewModel files (optional) | Consider renaming `GridViewModel`, `LogViewModel`, `NotebookEditorModel`, etc. to consistent `*EditorModel` pattern. Only if it improves clarity — some already have good names. | Planned |

### Phase 2: Introduce PageModel

Create the new PageModel and wire it into the system. NavigationData logic moves into PageModel.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 2.1 | — | Create PageModel class | New class: stable ID, `mainEditor: EditorModel \| null`, owns sidebar state (from NavigationData). Lifecycle: create, dispose, save/restore. Extract `pinned` from IEditorState into PageModel. | Planned |
| 2.2 | — | Wire PagesModel to PageModel | `pages[]` stores `PageModel[]`. Submodel queries use page IDs. `attachPage()`/`detachPage()` work with pages. `findPage()` returns PageModel. Grouping maps use page IDs. | Planned |
| 2.3 | — | Page rendering | `Pages.tsx`: `<Page />` component receives PageModel. Renders PageNavigator + main editor. `getStableKey` removed — page.id is the key. `AppPageManager` uses page IDs directly. | Planned |
| 2.4 | — | Tab rendering | `PageTab` reads from PageModel. Title/icon/modified delegate to `page.mainEditor`. Pinned state from page directly. | Planned |
| 2.5 | — | Secondary editors owned by page | `secondaryEditors[]` on PageModel. `ownerPage`/`setOwnerPage()` removed from EditorModel. Secondary editors reference page. | Planned |
| 2.6 | — | Page persistence | Page saves itself (sidebar state + main editor + secondary descriptors) to cache keyed by page.id. `WindowState` stores page descriptors. No `updateId()`, no `hasNavigator` flag. No backward compat. | Planned |

### Phase 3: Simplify Navigation

With page owning the context, navigation becomes an editor swap.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 3.1 | — | Simplify navigatePageTo | Replace 10-step transfer with `page.setMainEditor(newEditor)`. Page notifies secondary editors. No NavigationData transfer. | Planned |
| 3.2 | — | Empty pages | Remove `addEmptyPageWithNavPanel()`. Page with `mainEditor = null` renders empty content + Explorer. | Planned |
| 3.3 | — | Multi-window transfer | `movePageOut()`/`movePageIn()` serialize entire page. Page ID preserved. No `updateId()`. | Planned |

### Phase 4: Cleanup & API

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 4.1 | — | Clean up EditorModel | Remove `navigationData`, `ownerPage`, `setOwnerPage()`, `needsNavigatorRestore`, `hasNavigator`, `ensureNavigationData()`. Simplify `restore()`, `dispose()`, `getRestoreData()`. | Planned |
| 4.2 | — | Update script API wrappers | `PageWrapper` proxies `page.content` → `mainEditor`. `page.id` returns page ID. `PageCollectionWrapper` adapted. | Planned |
| 4.3 | — | Update MCP handler | `pageId` = page ID. Lookup adapts. | Planned |
| 4.4 | — | Remove workarounds | Delete `renderId`, `getStableKey`, `updateId()`. Remove `NavigationData` class (absorbed into PageModel). | Planned |
| 4.5 | — | Update documentation | pages-architecture.md, architecture diagrams, CLAUDE.md key files table, editor-guide.md. | Planned |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| — | (Tasks will be assigned US-IDs when work begins) | Planned |

## Notes

### 2026-04-02
- Epic created after completing EPIC-016 Phase 1
- Motivated by complexity observed during ZipPageModel implementation (US-315)
- EPIC-018 planned after this epic — PageModel may simplify secondary editor ownership
- **Decision: Rename-first approach.** Start by renaming PageModel → EditorModel to establish correct vocabulary before introducing new PageModel.
- **Decision: No backward compat.** Version 3.0.1. Old saved state ignored on first launch (format detection, not migration). New state saved on first user interaction.
- **Decision: Script API stays flat.** `page.content` proxies to mainEditor. No breaking change for scripts.
- **Decision: Public API shape preserved.** `app.pages.openFile()` still works.
- **Decision: page.id = stable page ID.** No longer changes on navigation.
- **Rename scope:** ~270 files affected, mostly mechanical find-replace.
