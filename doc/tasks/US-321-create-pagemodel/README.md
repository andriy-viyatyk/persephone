# US-321: Create PageModel Class

**Epic:** [EPIC-017](../../epics/EPIC-017.md) Phase 2.1
**Status:** Planned

## Goal

Create a new `PageModel` class that represents a tab — the stable container with a unique ID, sidebar state, and a main editor. Extract page-level concerns (NavigationData, pinned, sidebar, secondary editors) out of `EditorModel` into `PageModel`. This is the foundational step for Phase 2 — subsequent tasks (2.2–2.6) wire PageModel into PagesModel, rendering, tabs, and persistence.

## Background

### Current Architecture

Today, `EditorModel` plays two roles:
1. **Editor** — content, language, pipe, editor view, file I/O
2. **Page/tab container** — pinned state, NavigationData (sidebar, tree, search, secondary editors), stable React key (`renderId`), save/restore lifecycle

`NavigationData` is the actual "page context" that survives navigation, but it's owned by `EditorModel` as an optional property. During `navigatePageTo()`, NavigationData is manually transferred from the old EditorModel to the new one in a 10-step ceremony.

### What PageModel Will Own (extracted from EditorModel + NavigationData)

| Property | Currently lives in | Moves to PageModel |
|----------|-------------------|-------------------|
| Stable tab ID | `NavigationData.renderId` / editor UUID | `PageModel.id` (new stable UUID) |
| Pinned state | `IEditorState.pinned` | `PageModel.pinned` |
| NavigationData (all sidebar state) | `EditorModel.navigationData` | Absorbed into PageModel directly |
| Tree provider | `NavigationData.treeProvider` | `PageModel.treeProvider` |
| PageNavigatorModel (sidebar open/width) | `NavigationData.pageNavigatorModel` | `PageModel.pageNavigatorModel` |
| Selection state | `NavigationData.selectionState` | `PageModel.selectionState` |
| Tree expansion state | `NavigationData.treeState` | `PageModel.treeState` |
| Active panel | `NavigationData.activePanel` | `PageModel.activePanel` |
| Secondary editors | `NavigationData.secondaryModels[]` | `PageModel.secondaryEditors[]` |
| Search state | `NavigationData.searchState` | `PageModel.searchState` |
| Main editor reference | implicit (EditorModel IS the editor) | `PageModel.mainEditor` |

### What Stays in EditorModel

| Property | Why it stays |
|----------|-------------|
| `id` | Editor instance identity (internal, not tab identity) |
| `type`, `title`, `language`, `filePath` | Editor concerns |
| `content`, `pipe` | Content I/O |
| `editor` (EditorView) | Which view renders content |
| `modified` | Editor-level dirty flag |
| `sourceLink` | How this editor was opened |
| `secondaryEditor` | This editor's sidebar panel ID |
| `scriptData` | Script runtime storage |

### Fields Removed from IEditorState (deferred to US-322+)

These fields will be removed from `IEditorState` in subsequent tasks when PagesModel is rewired:
- `pinned` — moves to PageModel
- `hasNavigator` — PageModel always knows its own sidebar state

For this task, these fields remain in `IEditorState` for backward compatibility. PageModel reads them during construction but owns them going forward.

## Implementation Plan

### Step 1: Create PageModel class file

**File:** `src/renderer/api/pages/PageModel.ts` (new)

```typescript
import { TOneState } from "../../core/state/state";
import type { EditorModel } from "../../editors/base";
import type { ITreeProvider } from "../types/io.tree";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import { PageNavigatorModel } from "../../ui/navigation/PageNavigatorModel";
import type { IContentPipe } from "../types/io.pipe";
import { fs } from "../fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { expandSecondaryPanel } from "../../core/state/events";
import { fpDirname } from "../../core/utils/file-path";

export interface NavigationState {
    selectedHref: string | null;
}

/** Serialized descriptor for a secondary editor model (for persistence). */
export interface SecondaryModelDescriptor {
    pageState: Partial<import("../../../shared/types").IEditorState>;
}

/** Persisted sidebar state (cache file). */
interface PageSidebarSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
    selectedHref?: string | null;
    activePanel?: string;
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
    searchState?: FileSearchState;
    // Backward compat: old NavigationData format
    rootFilePath?: string;
    currentFilePath?: string;
    fileExplorerState?: { expandedPaths?: string[]; selectedFilePath?: string };
}

/**
 * PageModel — one per tab. Stable identity that survives navigation.
 *
 * Owns the browsing context (sidebar, tree, search, secondary editors)
 * and contains a mainEditor (EditorModel) as its content.
 */
export class PageModel {
    /** Stable page UUID — tab identity, React key, cache key. Never changes. */
    readonly id: string;

    /** Tab pinned state. */
    pinned = false;

    /** The primary editor (content). Null = empty page with Explorer only. */
    mainEditor: EditorModel | null = null;

    // ── Sidebar state (absorbed from NavigationData) ─────────────────

    treeProvider: ITreeProvider | null = null;
    pageNavigatorModel: PageNavigatorModel | null = null;
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });
    treeState: TreeProviderViewSavedState | undefined = undefined;
    activePanel: string = "explorer";
    searchState: FileSearchState | undefined = undefined;

    // ── Secondary editors ────────────────────────────────────────────

    secondaryEditors: EditorModel[] = [];
    readonly secondaryEditorsVersion = new TOneState({ version: 0 });
    pendingSecondaryDescriptors: SecondaryModelDescriptor[] | undefined = undefined;
    private _pendingActivePanel: string | undefined = undefined;

    // ── Internal ─────────────────────────────────────────────────────

    private _rootPath: string;
    private _cacheName = "nav-panel"; // backward compat cache file name
    private _skipSave = false;
    private _unsubscribe: (() => void) | undefined = undefined;
    private _expandSub: { unsubscribe: () => void } | undefined = undefined;

    constructor(id?: string, rootPath?: string) {
        this.id = id ?? crypto.randomUUID();
        this._rootPath = rootPath ?? "";
        this._expandSub = expandSecondaryPanel.subscribe((modelId) => {
            if (modelId && this.secondaryEditors.some((m) => m.id === modelId)) {
                this.setActivePanel(modelId);
                this.secondaryEditorsVersion.update((s) => { s.version++; });
            }
        });
    }

    // ── Derived properties ───────────────────────────────────────────

    /** Display title — delegates to mainEditor, or "Empty" for empty pages. */
    get title(): string {
        return this.mainEditor?.title ?? "Empty";
    }

    /** Aggregate modified flag: true if mainEditor OR any secondary editor is modified. */
    get modified(): boolean {
        if (this.mainEditor?.modified) return true;
        return this.secondaryEditors.some((m) => m.modified);
    }

    // ── Selection ────────────────────────────────────────────────────

    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        this._saveStateDebounced();
    }

    // ── Tree state ───────────────────────────────────────────────────

    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
        this._saveStateDebounced();
    }

    setActivePanel(panel: string): void {
        this.activePanel = panel;
        this._saveStateDebounced();
    }

    // ── Search ───────────────────────────────────────────────────────

    openSearch(folder?: string): void {
        this.activePanel = "search";
        if (!this.searchState || (folder && this.searchState.searchFolder !== folder)) {
            this.searchState = {
                query: this.searchState?.query ?? "",
                includePattern: this.searchState?.includePattern ?? "",
                excludePattern: this.searchState?.excludePattern ?? "",
                showFilters: this.searchState?.showFilters ?? false,
                searchFolder: folder ?? "",
                results: [],
                totalMatches: 0,
                totalFiles: 0,
            };
        }
        this._saveStateDebounced();
    }

    closeSearch(): void {
        this.searchState = undefined;
        if (this.activePanel === "search") {
            this.activePanel = "explorer";
        }
        this._saveStateDebounced();
    }

    setSearchState = (state: FileSearchState): void => {
        this.searchState = state;
        this._saveStateDebounced();
    };

    // ── Root path ────────────────────────────────────────────────────

    get rootPath(): string {
        return this.pageNavigatorModel?.state.get().rootPath || this._rootPath;
    }

    // ── PageNavigatorModel ───────────────────────────────────────────

    ensurePageNavigatorModel(): PageNavigatorModel {
        if (!this.pageNavigatorModel) {
            this.pageNavigatorModel = new PageNavigatorModel(this._rootPath);
            this._unsubscribe = this.pageNavigatorModel.state.subscribe(() => {
                if (!this._skipSave) {
                    this._saveStateDebounced();
                }
            });
        }
        return this.pageNavigatorModel;
    }

    // ── Navigator toggle ─────────────────────────────────────────────

    toggleNavigator(pipe?: IContentPipe | null, filePath?: string): void {
        if (this.treeProvider || this.pageNavigatorModel) {
            if (filePath) {
                this.pageNavigatorModel?.reinitIfEmpty(fpDirname(filePath));
            }
            this.ensurePageNavigatorModel().toggle();
            return;
        }

        let rootPath = this._rootPath;
        if (pipe?.provider.type === "file" && pipe.provider.sourceUrl) {
            rootPath = fpDirname(pipe.provider.sourceUrl);
        } else if (filePath) {
            rootPath = fpDirname(filePath);
        }

        if (!rootPath) return;

        this._rootPath = rootPath;
        this.ensurePageNavigatorModel().toggle();
    }

    canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean {
        if (this.treeProvider) return true;
        if (this.pageNavigatorModel) return true;
        if (pipe?.provider.type === "file") return true;
        if (filePath) return true;
        return false;
    }

    // ── Secondary editor lifecycle ───────────────────────────────────

    addSecondaryEditor(model: EditorModel): void {
        if (this.secondaryEditors.includes(model)) return;
        this.secondaryEditors.push(model);
        model.setPage(this);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    removeSecondaryEditor(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.setPage(null);
        model.dispose();
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    removeSecondaryEditorWithoutDispose(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.setPage(null);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    findSecondaryEditor(editorId: string): EditorModel | undefined {
        return this.secondaryEditors.find((m) => m.id === editorId);
    }

    async confirmSecondaryRelease(): Promise<boolean> {
        for (const model of this.secondaryEditors) {
            if (!model.modified) continue;
            const released = await model.confirmRelease();
            if (!released) return false;
        }
        return true;
    }

    /** Notify secondary editors that the main editor changed (navigation).
     *  Calls onMainEditorChanged() on each secondary editor.
     *  Secondary editors may clear their secondaryEditor to opt out. */
    notifyMainEditorChanged(): void {
        // Clear Explorer selection if the new editor wasn't opened from Explorer
        const sourceId = this.mainEditor?.state.get().sourceLink?.metadata?.sourceId;
        if (sourceId !== "explorer") {
            this.selectionState.update((s) => { s.selectedHref = null; });
        }
        // Notify secondary editors — they may clear their secondaryEditor
        for (const m of [...this.secondaryEditors]) {
            m.onMainEditorChanged(this.mainEditor);
        }
        // Clean up models that cleared their secondaryEditor
        const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor);
        if (removed.length > 0) {
            for (const m of removed) {
                const idx = this.secondaryEditors.indexOf(m);
                if (idx >= 0) this.secondaryEditors.splice(idx, 1);
                if (this.activePanel === m.id) {
                    this.activePanel = "explorer";
                }
                m.dispose();
            }
            this.secondaryEditorsVersion.update((s) => { s.version++; });
        }
    }

    /** Restore secondary editor models from pending descriptors. */
    async restoreSecondaryEditors(ownerEditor: EditorModel): Promise<void> {
        const descriptors = this.pendingSecondaryDescriptors;
        if (!descriptors?.length) {
            this._pendingActivePanel = undefined;
            return;
        }
        this.pendingSecondaryDescriptors = undefined;

        const { pagesModel } = await import("./index");

        for (const desc of descriptors) {
            if (desc.pageState.id === ownerEditor.id) {
                this.secondaryEditors.push(ownerEditor);
                continue;
            }

            try {
                const model = await pagesModel.lifecycle.newEditorModelFromState(desc.pageState);
                model.applyRestoreData(desc.pageState as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                await model.restore();
                this.secondaryEditors.push(model);
            } catch (err) {
                console.warn("[PageModel] Failed to restore secondary editor:", err);
            }
        }

        if (this._pendingActivePanel) {
            const modelExists = this.secondaryEditors.some((m) => m.id === this._pendingActivePanel);
            if (modelExists) {
                this.activePanel = this._pendingActivePanel;
            }
            this._pendingActivePanel = undefined;
        }

        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }

    // ── Persistence ──────────────────────────────────────────────────

    /** Restore sidebar state from cache. */
    async restoreSidebar(): Promise<void> {
        const data = await fs.getCacheFile(this.id, this._cacheName);
        const saved = parseObject(data) as PageSidebarSavedState | undefined;
        if (saved) {
            const rootPath = saved.rootPath || saved.rootFilePath || "";
            const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
                ? {
                    expandedPaths: saved.fileExplorerState.expandedPaths,
                    selectedHref: saved.fileExplorerState.selectedFilePath,
                }
                : undefined);

            this._skipSave = true;
            const navModel = this.ensurePageNavigatorModel();
            navModel.setStateQuiet({
                open: saved.open ?? true,
                width: saved.width ?? 240,
                rootPath,
            });
            this._skipSave = false;

            this.treeState = treeState;
            this.selectionState.set({ selectedHref: saved.selectedHref ?? null });
            this._rootPath = rootPath;
            this.searchState = saved.searchState;

            if (saved.secondaryModelDescriptors?.length) {
                this.pendingSecondaryDescriptors = saved.secondaryModelDescriptors;
            }

            const restoredPanel = saved.activePanel ?? "explorer";
            if (restoredPanel === "search" && !this.searchState) {
                this.activePanel = "explorer";
            } else if (restoredPanel !== "explorer" && restoredPanel !== "search") {
                this.activePanel = "explorer";
                this._pendingActivePanel = restoredPanel;
            } else {
                this.activePanel = restoredPanel;
            }
        }
    }

    /** Save sidebar state to cache. */
    private _saveState = async (): Promise<void> => {
        for (const model of this.secondaryEditors) {
            await model.saveState?.();
        }
        const navState = this.pageNavigatorModel?.state.get();
        const saved: PageSidebarSavedState = {
            open: navState?.open ?? true,
            width: navState?.width ?? 240,
            rootPath: navState?.rootPath ?? this._rootPath,
            treeState: this.treeState,
            selectedHref: this.selectionState.get().selectedHref,
            activePanel: this.activePanel,
            secondaryModelDescriptors: this.secondaryEditors.length > 0
                ? this.secondaryEditors.map((m) => ({ pageState: m.getRestoreData() }))
                : undefined,
            searchState: this.searchState,
        };
        await fs.saveCacheFile(this.id, JSON.stringify(saved), this._cacheName);
    };

    private _saveStateDebounced = debounce(this._saveState, 300);

    async flushSave(): Promise<void> {
        await this._saveState();
    }

    /** Save all state (sidebar + editor caches). Called before app quit. */
    async saveState(): Promise<void> {
        await this._saveState();
        await this.mainEditor?.saveState();
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this._expandSub?.unsubscribe();
        this._expandSub = undefined;
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        for (const model of this.secondaryEditors) {
            model.dispose();
        }
        this.secondaryEditors = [];
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
        // Dispose main editor
        await this.mainEditor?.dispose();
        this.mainEditor = null;
    }
}
```

### Step 2: Add new methods to EditorModel

**File:** `src/renderer/editors/base/EditorModel.ts`

Add three new members alongside existing `ownerPage`/`setOwnerPage` (which stay for now):

```typescript
// After line 29 (ownerPage property):

/** Reference to the containing PageModel (for both main and secondary editors).
 *  Set via setPage(). Available after PageModel wiring (EPIC-017 Phase 2). */
page: PageModel | null = null;

// After setOwnerPage method (line 39):

/** Called when this editor is placed into or removed from a PageModel.
 *  Base implementation stores the reference. Subclasses can override to react. */
setPage(page: PageModel | null): void {
    this.page = page;
}

/** Called on secondary editors when the page's main editor changes (navigation).
 *  Base implementation is a no-op. Override in subclasses to react
 *  (e.g., ZipEditorModel checks if new main editor was opened from this archive). */
onMainEditorChanged(_newMainEditor: EditorModel | null): void {
    // Override in subclasses
}
```

**Import needed** (type-only to avoid circular dependency):
```typescript
import type { PageModel } from "../../api/pages/PageModel";
```

### Step 3: Export from pages barrel

**File:** `src/renderer/api/pages/index.ts` — add export:
```typescript
export { PageModel } from "./PageModel";
```

### Step 4: Add `hasSidebar` convenience getter

Already included in the PageModel class (Step 1):

```typescript
/** Whether this page has an active sidebar (navigator, search, or secondary panels). */
get hasSidebar(): boolean {
    return this.pageNavigatorModel !== null;
}
```

## Concerns / Open Questions

### A. NavigationData coexistence — RESOLVED: Standalone

This task creates PageModel as a standalone class with no runtime usage. NavigationData continues to function as-is. Subsequent tasks (US-322+) will wire PageModel into PagesModel, rendering, and replace NavigationData.

### B. Editor ↔ PageModel references — RESOLVED: `page` property + two hooks

Every editor (mainEditor and secondaryEditors[]) gets a reference to its containing PageModel:

**EditorModel changes (deferred to wiring task US-322+):**
- `ownerPage: EditorModel | null` → `page: PageModel | null` — reference to containing page
- `setOwnerPage(model: EditorModel | null)` → `setPage(page: PageModel | null)` — called when editor is placed into a page. Base stores the reference. Subclasses can override to react.
- New method: `onMainEditorChanged(newMainEditor: EditorModel | null): void` — called on secondary editors when PageModel swaps mainEditor. Base implementation is no-op. Subclasses override to react.

**Two distinct hooks for secondary editors:**
1. **`setPage(page)`** — "you've been placed in/removed from this page" (called once when added to secondaryEditors[], or when removed)
2. **`onMainEditorChanged(editor)`** — "the main editor in your page just changed" (called on every navigation)

**ZipEditorModel example (after wiring):**
```typescript
onMainEditorChanged(newMainEditor: EditorModel | null): void {
    if (!newMainEditor || newMainEditor === this) return;
    // Read sourceLink via page reference
    if (this._isOpenedFromThisArchive(newMainEditor)) {
        setTimeout(() => expandSecondaryPanel.send(this.id), 0);
    } else {
        this.secondaryEditor = undefined;
    }
}
```

**For this task (US-321):** We add the new methods to EditorModel as stubs alongside the old ones (no removal yet). This lets PageModel compile and call the correct API. The old `ownerPage`/`setOwnerPage` remain until the wiring task migrates all callers.

**EditorModel additions (this task):**
```typescript
// New: reference to containing PageModel (for both main and secondary editors)
page: PageModel | null = null;

// New: called when editor is placed into / removed from a page
setPage(page: PageModel | null): void {
    this.page = page;
}

// New: called on secondary editors when the main editor changes (navigation)
// Base: no-op. Subclasses override to react.
onMainEditorChanged(_newMainEditor: EditorModel | null): void {
    // Override in subclasses (e.g., ZipEditorModel)
}
```

The old `ownerPage`/`setOwnerPage` stay until the wiring task. ZipEditorModel's override of `setOwnerPage` also stays — it will be migrated to `onMainEditorChanged` in the wiring task.

### C. Cache file compatibility

PageModel uses the same cache file name (`nav-panel`) and same format (`PageSidebarSavedState ≈ NavigationSavedState`). This means:
- Old NavigationData cache files will be readable by PageModel
- PageModel cache files will be readable by old NavigationData (if rollback needed)
- No migration needed

### D. `_saveState` recursion guard — RESOLVED: Not needed

NavigationData had a recursion guard: `if (model.navigationData === this) continue` when flushing secondary model caches. PageModel doesn't have this issue because secondary editors reference `page` (the PageModel) — `saveState()` on secondary editors won't recurse back through PageModel's `_saveState`.

## Acceptance Criteria

- [ ] `PageModel` class exists in `src/renderer/api/pages/PageModel.ts`
- [ ] Exported from `src/renderer/api/pages/index.ts`
- [ ] All sidebar state from NavigationData is represented (tree, selection, search, active panel, secondary editors)
- [ ] `restoreSidebar()` reads old NavigationData cache format (backward compat)
- [ ] `dispose()` cleans up all resources
- [ ] `saveState()` persists sidebar + delegates to main editor
- [ ] Secondary editor lifecycle methods present (add, remove, restore, notifyMainEditorChanged)
- [ ] `title` and `modified` delegate to mainEditor
- [ ] EditorModel has `page: PageModel | null`, `setPage()`, `onMainEditorChanged()` stubs
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] No runtime usage yet — class is created but not wired into PagesModel

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | **New** — PageModel class |
| `src/renderer/editors/base/EditorModel.ts` | Add `page`, `setPage()`, `onMainEditorChanged()` stubs |
| `src/renderer/api/pages/index.ts` | Add `PageModel` export |

## Files NOT Changed

| File | Why |
|------|-----|
| `src/renderer/ui/navigation/NavigationData.ts` | Stays as-is until wiring task |
| `src/renderer/api/pages/PagesModel.ts` | No wiring yet |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | No wiring yet |
| `src/renderer/ui/app/Pages.tsx` | No rendering changes yet |
| `src/renderer/editors/zip/ZipEditorModel.ts` | `setOwnerPage` stays; `onMainEditorChanged` override deferred to wiring task |
| `src/shared/types.ts` | `IEditorState` unchanged |
