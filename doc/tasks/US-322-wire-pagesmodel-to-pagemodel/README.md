# US-322: Wire PagesModel to PageModel

**Epic:** [EPIC-017](../../epics/EPIC-017.md) Phase 2.2–2.6
**Status:** Planned

## Goal

Replace `EditorModel` with `PageModel` as the primary entity in PagesModel and all consumers. After this task, every tab is a `PageModel` that contains an `EditorModel` as its `mainEditor`. NavigationData is eliminated — PageModel absorbs its role. The 10-step navigation transfer ceremony is simplified to `page.setMainEditor(newEditor)`.

This task combines epic phases 2.2–2.6 because they are atomic — no subset produces a working app.

## Background

### Current State (after US-321)

- `PagesModel.state` stores `pages: EditorModel[]`, `ordered: EditorModel[]`
- `PageModel` class exists but is standalone (not wired in)
- `EditorModel` has `page: PageModel | null`, `setPage()`, `onMainEditorChanged()` stubs
- `NavigationData` is the active runtime sidebar container

### Target State

- `PagesModel.state` stores `pages: PageModel[]`, `ordered: PageModel[]`
- Every tab has a `PageModel`. `PageModel.mainEditor` holds the `EditorModel`.
- `NavigationData` class is deleted — PageModel replaces it.
- `EditorModel` no longer has `navigationData`, `ownerPage`, `hasNavigator`, `ensureNavigationData()`.
- Tab identity = `page.id` (stable UUID that never changes).
- Navigation = `page.setMainEditor(newEditor)` + `page.notifyMainEditorChanged()`.
- `getStableKey` removed — `page.id` IS the stable key.
- `renderId` removed — no longer needed.
- `WindowState` format changes (page descriptors wrapping editor state).

## Implementation Plan

### Step 1: Change OpenFilesState to use PageModel

**File:** `src/renderer/api/pages/PagesModel.ts`

```typescript
// Before:
const defaultOpenFilesState = {
    pages: [] as EditorModel[],
    ordered: [] as EditorModel[],
    ...
};

// After:
import { PageModel } from "./PageModel";

const defaultOpenFilesState = {
    pages: [] as PageModel[],
    ordered: [] as PageModel[],
    leftRight: new Map<string, string>(),
    rightLeft: new Map<string, string>(),
};
```

Update all internal methods:

- `attachPage(page: PageModel)` — subscribe to `page.mainEditor.state` changes (for save debounce). Set `page.mainEditor.onClose` callback.
- `detachPage(page: PageModel)` — unsubscribe, clear callback.
- `removePage(page: PageModel)` — filter from arrays using `p !== page`.
- `closeFirstPageIfEmpty()` — check `page.mainEditor?.state.get()` for empty content.
- Events: `onShow` and `onFocus` change from `Subscription<EditorModel>` to `Subscription<PageModel>`.

Public API delegates: methods that accept/return `EditorModel` need updating:
- `addPage(page: EditorModel)` → internal creates PageModel wrapper, returns PageModel
- `focusPage(page: EditorModel)` → `focusPage(page: PageModel)`
- `activePage` returns PageModel
- `findPage()` returns PageModel
- etc.

### Step 2: Update PagesQueryModel

**File:** `src/renderer/api/pages/PagesQueryModel.ts`

All methods return `PageModel` instead of `EditorModel`:
- `findPage(pageId)` — searches `pages[]` by `page.id` (not `page.state.get().id`)
- `activePage` — returns last of `ordered[]` (already PageModel)
- `getGroupedPage()` / `getLeftGroupedPage()` — return PageModel
- `pages` getter — returns `PageModel[]`

### Step 3: Update PagesNavigationModel

**File:** `src/renderer/api/pages/PagesNavigationModel.ts`

- `showPage(pageId)` — finds in `ordered[]`, moves to end. Sends `onShow`/`onFocus` with PageModel.
- `showNext()`/`showPrevious()` — iterates `pages[]` (PageModel[]).
- `focusPage(page: PageModel)` — sends `onFocus` with PageModel.

### Step 4: Update PagesLayoutModel

**File:** `src/renderer/api/pages/PagesLayoutModel.ts`

- `moveTabByIndex()` — works with `pages[]` which is now PageModel[]. Uses `page.id` for grouping maps.
- `pinTab(pageId)` — finds page, sets `page.pinned = true` (on PageModel, not EditorModel state). Moves in array.
- `unpinTab(pageId)` — finds page, sets `page.pinned = false`. Moves in array.
- `group()`/`ungroup()` — already use string IDs, minimal changes.
- `fixCompareMode()` — needs to access `page.mainEditor` to check `compareMode` (TextFileModel-specific).

### Step 5: Update PagesLifecycleModel — Page creation

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Every method that creates/adds pages must now wrap EditorModel in PageModel:

**`addPage(editor: EditorModel)` → wraps in PageModel:**
```typescript
addPage = (editor: EditorModel, existingPage?: PageModel): PageModel => {
    const page = existingPage ?? new PageModel();
    page.mainEditor = editor;
    editor.setPage(page);
    // Check duplicate by editor ID (for existing page detection)
    const existingById = this.model.query.findPageByEditorId(editor.id);
    if (existingById) {
        this.model.navigation.showPage(existingById.id);
        return existingById;
    }
    this.model.attachPage(page);
    this.model.state.update((s) => {
        s.pages.push(page);
        s.ordered.push(page);
    });
    this.model.persistence.saveState();
    return page;
};
```

**`addEmptyPage()`** — creates TextFileModel, wraps in PageModel.

**`addEmptyPageWithNavPanel(folderPath)`** — creates PageModel with sidebar directly:
```typescript
addEmptyPageWithNavPanel = (folderPath: string): PageModel => {
    const emptyFile = newTextFileModel("");
    const page = new PageModel(undefined, folderPath);
    page.mainEditor = emptyFile as unknown as EditorModel;
    emptyFile.setPage(page);
    page.ensurePageNavigatorModel();
    this.model.attachPage(page);
    // ... add to state ...
    return page;
};
```

**`addEditorPage()`** — creates TextFileModel, wraps in PageModel.

**Factory helpers** (`createPageFromFile`, `newEditorModel`, `newEditorModelFromState`) — still return `EditorModel`. The caller wraps in `PageModel`.

### Step 6: Update PagesLifecycleModel — navigatePageTo

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

This is the BIG simplification. The 10-step ceremony becomes:

```typescript
navigatePageTo = async (pageId: string, newFilePath: string, options?) => {
    const page = this.model.query.findPage(pageId);
    if (!page || !page.mainEditor) return false;

    const oldEditor = page.mainEditor;
    const released = await oldEditor.confirmRelease();
    if (!released) return false;

    // Create new editor
    let newEditor: EditorModel;
    // ... (same file existence check + createPageFromFile logic) ...

    // Give old editor a chance to react (beforeNavigateAway)
    oldEditor.beforeNavigateAway(newEditor);

    // Check if old editor survives as secondary
    const survivesAsSecondary = page.secondaryEditors.includes(oldEditor);
    if (!survivesAsSecondary) {
        await oldEditor.dispose();
    }

    // Swap main editor
    page.mainEditor = newEditor;
    newEditor.setPage(page);

    // Auto-select preview editor
    // ... (same logic as current) ...

    // Notify secondary editors of new main editor
    page.notifyMainEditorChanged();

    // Register new editor's secondary panel if it has one
    const se = newEditor.state.get().secondaryEditor;
    if (se) {
        page.addSecondaryEditor(newEditor);
    }

    // Trigger UI update + save
    this.model.onShow.send(page);
    this.model.onFocus.send(page);
    this.model.persistence.saveState();
    return true;
};
```

**Key simplifications vs current:**
- No `replacePage()` — page stays in arrays, only mainEditor changes
- No NavigationData transfer — page IS the container
- No `updateId()` — page.id never changes
- No pinned state transfer — page owns pinned
- No `attachPage`/`detachPage` dance — page is already attached

### Step 7: Update PagesLifecycleModel — other methods

**`replacePage()`** — remove entirely. No longer needed since navigation doesn't swap pages in arrays.

**`openFile()`** — check for existing page by `page.mainEditor?.filePath`. Wraps new editor in PageModel.

**`openFileAsArchive()`** — creates PageModel with sidebar, sets ZipEditorModel as mainEditor.

**`closePage()` / `closeToTheRight()` / `closeOtherPages()`** — work with PageModel from `findPage()`.

**`movePageIn()`** — creates EditorModel from state, wraps in PageModel, adds to collection. Also restores sidebar from cache.

**`movePageOut()`** — serializes page (editor state + sidebar state) for transfer.

**`duplicatePage()`** — clones editor state, creates new PageModel.

**`requireGroupedText()`** — returns `page.mainEditor` as TextFileModel.

**`showAboutPage()` / `showSettingsPage()` / `showBrowserPage()` / etc.** — create EditorModel, wrap in PageModel, add.

### Step 8: Update PagesPersistenceModel — new format

**File:** `src/renderer/api/pages/PagesPersistenceModel.ts`

**New WindowState format:**
```typescript
// New page descriptor (replaces flat IEditorState[]):
interface PageDescriptor {
    id: string;                         // Page stable ID
    pinned: boolean;                    // Page-level flag
    modified: boolean;                  // Aggregate (mainEditor OR secondaryEditors)
    hasSidebar: boolean;                // Whether sidebar exists
    editor: Partial<IEditorState>;      // mainEditor state
}

// WindowState:
{
    pages: PageDescriptor[];
    groupings?: [string, string][];
    activePageId?: string;
}
```

**`saveState()`:**
```typescript
const pageDescriptors = pages.map((page) => ({
    id: page.id,
    pinned: page.pinned,
    modified: page.modified,
    hasSidebar: page.hasSidebar,
    editor: page.mainEditor?.getRestoreData() ?? {},
}));
```

**`restoreState()`:**
```typescript
// Detect old format: old pages have "type" at top level, new format has "editor" object
const isOldFormat = data.pages[0]?.type && !data.pages[0]?.editor?.type;
if (isOldFormat) return; // Skip old format — app starts empty

for (const desc of data.pages) {
    const editor = await this.restoreModel(desc.editor);
    if (!editor) continue;
    const page = new PageModel(desc.id);
    page.pinned = desc.pinned ?? false;
    page.mainEditor = editor;
    editor.setPage(page);
    if (desc.hasSidebar) {
        await page.restoreSidebar();
        await page.restoreSecondaryEditors(editor);
    }
    models.push(page);
}
```

**`restoreModel()`** — stays the same (creates EditorModel from IEditorState).

### Step 9: Update Pages.tsx rendering

**File:** `src/renderer/ui/app/Pages.tsx`

```typescript
// Before:
function PageContent({ pageId }: { pageId: string }) {
    const page = pagesModel.query.findPage(pageId);  // was EditorModel
    // ... access page.navigationData, page.id, etc.
}

// After:
function PageContent({ pageId }: { pageId: string }) {
    const page = pagesModel.query.findPage(pageId);  // now PageModel
    if (!page) return null;
    const editor = page.mainEditor;
    // ... render sidebar from page directly, editor from page.mainEditor
}
```

**Remove `getStableKey`** — `page.id` is the stable key. No more `navigationData?.renderId`.

**`NavigationWrapper`** receives PageModel instead of EditorModel:
```typescript
function NavigationWrapper({ page }: { page: PageModel }) {
    const hasSidebar = page.hasSidebar;  // or page.pageNavigatorModel !== null
    if (!hasSidebar) return null;
    return <NavigationContent page={page} />;
}
```

**`NavigationContent`** uses PageModel directly (not NavigationData):
```typescript
function NavigationContent({ page }: { page: PageModel }) {
    const navModel = page.ensurePageNavigatorModel();
    // ...
    return <PageNavigator page={page} />;
}
```

### Step 10: Update PageTab.tsx and PageTabs.tsx

**File:** `src/renderer/ui/tabs/PageTab.tsx`

PageTab receives `PageModel` instead of `EditorModel`:
```typescript
interface PageTabProps {
    model: PageModel;   // was EditorModel
    pinnedLeft?: number;
}
```

Tab reads properties from PageModel + mainEditor:
```typescript
// title, filePath, language, type, etc. from page.mainEditor.state
// pinned from page.pinned (not from editor state)
// modified from page.modified (aggregate)
// id from page.id (stable)
```

Active page check:
```typescript
// Before:
tabModel.isActive = pagesModel.activePage === model || pagesModel.groupedPage === model;
// After (same pattern, just PageModel identity):
tabModel.isActive = pagesModel.activePage === model || pagesModel.groupedPage === model;
```

Context menu actions use `page.id` and delegate to `page.mainEditor` for editor-specific operations.

**File:** `src/renderer/ui/tabs/PageTabs.tsx`

```typescript
// Before:
{state.pages?.map((page) => {
    const pageState = page.state.get();
    // ... reads pageState.pinned, pageState.id
    return <PageTab key={pageState.id} model={page} />;
})}

// After:
{state.pages?.map((page) => {
    // ... reads page.pinned, page.id
    return <PageTab key={page.id} model={page} />;
})}
```

### Step 11: Update PageNavigator.tsx

**File:** `src/renderer/ui/navigation/PageNavigator.tsx`

PageNavigator receives `PageModel` instead of `NavigationData`:
```typescript
// Before:
interface PageNavigatorProps {
    navigationData: NavigationData;
    pageId: string;
}

// After:
interface PageNavigatorProps {
    page: PageModel;
}
```

All internal accesses change from `navigationData.X` to `page.X` (since PageModel absorbed NavigationData's API).

### Step 12: Update RenderEditor.tsx

**File:** `src/renderer/ui/app/RenderEditor.tsx`

RenderEditor receives `EditorModel` (the mainEditor from PageModel):
```typescript
// May receive page.mainEditor instead of the page itself
// Check current implementation and adapt
```

### Step 13: Update AppPageManager

**File:** `src/renderer/components/page-manager/AppPageManager.tsx`

- `getStableKey` prop removed — page IDs are already stable.
- `pageIds` still comes from `pages.map(p => p.id)` — same pattern, just page.id instead of editor.id.

### Step 14: Update EditorModel — remove page concerns

**File:** `src/renderer/editors/base/EditorModel.ts`

Remove:
- `navigationData: NavigationData | null` — PageModel owns sidebar now
- `ownerPage: EditorModel | null` — replaced by `page: PageModel | null`
- `setOwnerPage(model)` — replaced by `setPage(page)` and `onMainEditorChanged()`
- `needsNavigatorRestore` — PageModel handles restore
- `ensureNavigationData()` — PageModel has `ensurePageNavigatorModel()`
- `hasNavigator` reads/writes in `restore()`, `getRestoreData()`, `applyRestoreData()`
- `pinned` getter — PageModel owns pinned now

Keep:
- `page: PageModel | null` (already added in US-321)
- `setPage(page)` (already added in US-321)
- `onMainEditorChanged()` (already added in US-321)
- All editor concerns: id, type, title, content, language, filePath, pipe, modified, editor, sourceLink, secondaryEditor, scriptData

`restore()` simplifies — no NavigationData creation:
```typescript
async restore(): Promise<void> {
    // Editor-specific restore only. Sidebar restore is PageModel's job.
}
```

`dispose()` simplifies — no NavigationData disposal:
```typescript
async dispose(): Promise<void> {
    this.pipe?.dispose();
    this.pipe = null;
    await fs.deleteCacheFiles(this.state.get().id);
}
```

`getRestoreData()` simplifies — no `hasNavigator` flag:
```typescript
getRestoreData(): Partial<T> {
    const data = JSON.parse(JSON.stringify(this.state.get()));
    if (this.pipe) data.pipe = this.pipe.toDescriptor();
    return data;
}
```

### Step 15: Update IEditorState — remove page concerns

**File:** `src/shared/types.ts`

Remove from `IEditorState`:
- `pinned?: boolean` — moved to PageModel
- `hasNavigator?: boolean` — no longer needed

These were page-level concerns that now live on PageModel.

### Step 16: Update TextToolbar.tsx and similar editor UI

**File:** `src/renderer/editors/text/TextToolbar.tsx`

Currently accesses `model.navigationData` for the File Explorer button:
```typescript
// Before:
if (model.navigationData?.canOpenNavigator(model.pipe, filePath) || filePath) {
    // ...
    model.ensureNavigationData(fpDirname(filePath || ""));
    model.navigationData!.toggleNavigator(model.pipe, filePath);
}

// After — delegate to page:
if (model.page?.canOpenNavigator(model.pipe, filePath) || filePath) {
    // ...
    model.page!.toggleNavigator(model.pipe, filePath);
}
```

### Step 17: Update script wrappers

**File:** `src/renderer/scripting/api-wrapper/PageWrapper.ts`

PageWrapper constructor changes to accept PageModel:
```typescript
// Before:
constructor(private readonly model: EditorModel, ...)

// After:
constructor(private readonly page: PageModel, ...) {
    // Delegate editor properties to page.mainEditor
}

get id() { return this.page.id; }  // stable page ID
get title() { return this.page.title; }
get modified() { return this.page.modified; }
get pinned() { return this.page.pinned; }
// Editor-specific:
get content() { return this.page.mainEditor?.state.get().content ?? ""; }
get language() { return this.page.mainEditor?.language; }
// etc.
```

**File:** `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`

`wrap()` now receives PageModel (since pagesModel returns PageModel):
```typescript
private wrap(page: PageModel | undefined): PageWrapper | undefined {
    return page ? new PageWrapper(page, this.releaseList) : undefined;
}
```

### Step 18: Update MCP handler

**File:** `src/renderer/api/mcp-handler.ts`

Page lookups return PageModel. Access editor properties through `page.mainEditor`:
```typescript
// get_pages: serialize from page.mainEditor.state
// get_page_content: page.mainEditor.state.get().content
// execute_script: pass page.mainEditor to script runner
// set_page_content: page.mainEditor.changeContent()
```

### Step 19: Update ZipEditorModel

**File:** `src/renderer/editors/zip/ZipEditorModel.ts`

Migrate `setOwnerPage()` override to `onMainEditorChanged()`:
```typescript
// Before:
setOwnerPage(model: EditorModel | null): void {
    super.setOwnerPage(model);
    if (!model || model === this) return;
    if (this._isOpenedFromThisArchive(model)) {
        setTimeout(() => expandSecondaryPanel.send(this.id), 0);
    } else {
        this.secondaryEditor = undefined;
    }
}

// After:
onMainEditorChanged(newMainEditor: EditorModel | null): void {
    if (!newMainEditor || newMainEditor === this) return;
    if (this._isOpenedFromThisArchive(newMainEditor)) {
        setTimeout(() => expandSecondaryPanel.send(this.id), 0);
    } else {
        this.secondaryEditor = undefined;
    }
}
```

The `secondaryEditor` setter on EditorModel also needs updating — it currently calls `this.navigationData?.addSecondaryModel(this)`. After this task, it should call `this.page?.addSecondaryEditor(this)`.

### Step 20: Delete NavigationData

**File:** `src/renderer/ui/navigation/NavigationData.ts` — DELETE

All functionality absorbed into PageModel. Also remove:
- `NavigationData` import from `EditorModel.ts`
- `NavigationData` import from `PagesLifecycleModel.ts`
- `NavigationData` import from `Pages.tsx`
- Any other imports

### Step 21: Update main process (if needed)

**File:** `src/main/open-windows.ts`

The main process reads serialized `WindowState` from disk. The format changes:
```typescript
// Before: pages[].modified, pages[].pinned (flat IEditorState)
// After: pages[].modified, pages[].pinned (PageDescriptor — same top-level fields)
```

Since we keep `modified` and `pinned` at the top level of PageDescriptor, the main process check **stays the same**:
```typescript
if (!wState?.pages.some((p) => p.modified || p.pinned)) {
    removeWindow = true;
}
```

No changes needed to `open-windows.ts` or `window-states.ts`.

## Concerns / Open Questions

### A. Scope — why combine 2.2–2.6?

These epic phases are atomic. Changing `pages: EditorModel[]` to `pages: PageModel[]` breaks every consumer simultaneously. There is no working intermediate state between "EditorModel is the page" and "PageModel wraps EditorModel."

### B. EditorModel.secondaryEditor setter — RESOLVED

The setter currently calls `this.navigationData?.addSecondaryModel(this)`. After migration:
```typescript
set secondaryEditor(value: string | undefined) {
    const prev = this.state.get().secondaryEditor;
    if (prev === value) return;
    this.state.update((s) => { s.secondaryEditor = value; });
    if (value) {
        this.page?.addSecondaryEditor(this);
    } else {
        this.page?.removeSecondaryEditorWithoutDispose(this);
    }
}
```

### C. EditorModel.confirmRelease — RESOLVED

Currently checks `this.navigationData?.confirmSecondaryRelease()`. After migration, the page handles this:
```typescript
// On EditorModel — just checks own unsaved changes:
async confirmRelease(closing?: boolean): Promise<boolean> {
    // No secondary check here — PageModel does that in its own close flow
    return true;  // Base: no unsaved changes concept. TextFileModel overrides.
}
```

PageModel's close flow: check `confirmSecondaryRelease()` + `mainEditor.confirmRelease(true)`.

### D. onClose callback — RESOLVED

Currently `EditorModel.onClose` is set by `attachPage()`. After migration, `PageModel` needs a close mechanism. Option: PageModel gets its own `close()` method that PagesModel calls. The `onClose` callback moves from EditorModel to PageModel, or PagesModel manages the close flow directly.

Simplest: `attachPage` sets `page.mainEditor.onClose` → triggers `detachPage(page) + removePage(page) + page.dispose()`. The page's dispose handles everything.

### E. Backward compat for restore — RESOLVED (EPIC-017 decision)

Old-format WindowState (flat IEditorState[]) is detected and skipped. App starts with empty window on first launch after upgrade. No migration code.

### F. Script `page.id` changes meaning

Currently `page.id` returns the editor's UUID (changes on navigation). After this task, `page.id` returns the stable page UUID (never changes). This is an **improvement** — scripts that cache `page.id` now get stable references. Documented as a breaking change in version 3.0.1.

## Acceptance Criteria

- [ ] `PagesModel.state` stores `PageModel[]` in `pages` and `ordered` arrays
- [ ] Every tab creation wraps EditorModel in PageModel
- [ ] `navigatePageTo()` swaps `page.mainEditor` instead of replacing pages in arrays
- [ ] `NavigationData.ts` deleted — PageModel replaces it
- [ ] EditorModel cleaned: no `navigationData`, `ownerPage`, `setOwnerPage`, `hasNavigator`, `ensureNavigationData`
- [ ] `IEditorState` cleaned: no `pinned`, `hasNavigator`
- [ ] `getStableKey` / `renderId` removed — `page.id` is the stable key
- [ ] Persistence saves new PageDescriptor format with old-format detection
- [ ] Pages.tsx / PageTab.tsx / PageTabs.tsx render from PageModel
- [ ] PageNavigator receives PageModel instead of NavigationData
- [ ] Script wrappers (PageWrapper, PageCollectionWrapper) adapted
- [ ] MCP handler adapted
- [ ] ZipEditorModel uses `onMainEditorChanged()` instead of `setOwnerPage()`
- [ ] TextToolbar File Explorer button delegates to `page`
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] App launches, tabs work, navigation works, sidebar works, persistence works

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PagesModel.ts` | `pages: PageModel[]`, events, attachPage/detachPage/removePage |
| `src/renderer/api/pages/PagesQueryModel.ts` | Return PageModel from all methods |
| `src/renderer/api/pages/PagesNavigationModel.ts` | Work with PageModel[] |
| `src/renderer/api/pages/PagesLayoutModel.ts` | Pin/unpin on PageModel, array ops on PageModel[] |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Wrap editors in PageModel, simplify navigatePageTo, remove replacePage |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | New PageDescriptor format, old-format detection |
| `src/renderer/api/pages/PageModel.ts` | Minor adjustments as needed during wiring |
| `src/renderer/editors/base/EditorModel.ts` | Remove navigationData/ownerPage/hasNavigator/ensureNavigationData |
| `src/shared/types.ts` | Remove `pinned`, `hasNavigator` from IEditorState |
| `src/renderer/ui/app/Pages.tsx` | Render from PageModel, remove getStableKey |
| `src/renderer/ui/tabs/PageTab.tsx` | Receive PageModel, read from page + mainEditor |
| `src/renderer/ui/tabs/PageTabs.tsx` | Iterate PageModel[], read page.id/page.pinned |
| `src/renderer/ui/app/RenderEditor.tsx` | Receive mainEditor from PageModel |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Receive PageModel instead of NavigationData |
| `src/renderer/components/page-manager/AppPageManager.tsx` | Remove getStableKey prop |
| `src/renderer/editors/text/TextToolbar.tsx` | Delegate sidebar to `model.page` |
| `src/renderer/editors/zip/ZipEditorModel.ts` | Migrate setOwnerPage → onMainEditorChanged |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Wrap PageModel, delegate to mainEditor |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Wrap PageModel returns |
| `src/renderer/api/mcp-handler.ts` | Access page.mainEditor for editor properties |
| `src/renderer/ui/navigation/NavigationData.ts` | **DELETE** |

## Files NOT Changed

| File | Why |
|------|-----|
| `src/main/open-windows.ts` | Reads serialized state — `modified`/`pinned` stay at top level |
| `src/main/window-states.ts` | Reads serialized state — format compatible |
| `src/ipc/` | IPC carries serialized IEditorState, not live objects |
| `assets/editor-types/` | Script API types unchanged (page.content still works) |
