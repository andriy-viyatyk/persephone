# US-315: ZipPageModel + ZipSecondaryEditor

**Status:** Planned
**Epic:** EPIC-016 (Phase 1.5)
**Created:** 2026-04-01
**Depends on:** US-316 (PageNavigator secondary editor rendering)

## Goal

Create a dedicated page-editor for ZIP archives (`ZipPageModel` + `ZipPageView`). The main content area renders `TreeProviderView` showing the archive tree. The model sets `secondaryEditor = "zip-tree"` and registers a `ZipSecondaryEditor` sidebar component that duplicates the same tree view. The secondary editor survives page navigation via `beforeNavigateAway()`.

## Background

### Current archive flow

Archives are currently opened via `openFileAsArchive()` which creates an **empty text page** with NavigationData rooted at the archive path. The archive tree appears as a "secondary provider" panel in PageNavigator (lazy `ZipTreeProvider`). This works but has no dedicated page model — the page is just an empty `TextFileModel` with a sidebar.

### New design

A proper `ZipPageModel` (page-editor) owns a `ZipTreeProvider` and renders `TreeProviderView` as its main content. It also registers as a secondary editor so the same tree appears in the PageNavigator sidebar. When the user clicks a file in the tree, the page navigates to that file, but the `ZipPageModel` survives as a secondary editor (via `beforeNavigateAway` + `sourceLink.metadata.sourceId` check).

### Key pattern: CategoryEditor

`CategoryEditor` is the closest existing pattern — a page-editor that renders `CategoryView` (which uses a tree provider). Key differences:
- CategoryEditor gets its provider from `navigationData.activeProvider`
- ZipPageModel will own its own `ZipTreeProvider` directly
- CategoryEditor renders a flat category view; ZipPageView renders a full tree view

### Key code locations

| What | File |
|---|---|
| CategoryPageModel | `src/renderer/editors/category/CategoryPageModel.ts` |
| CategoryEditor | `src/renderer/editors/category/CategoryEditor.tsx` |
| ZipTreeProvider | `src/renderer/content/tree-providers/ZipTreeProvider.ts` |
| TreeProviderView component | `src/renderer/components/tree-provider/TreeProviderView.tsx` |
| Secondary editor registry | `src/renderer/ui/navigation/secondary-editor-registry.ts` |
| LazySecondaryEditor | `src/renderer/ui/navigation/LazySecondaryEditor.tsx` |
| Editor registration | `src/renderer/editors/register-editors.ts` |
| Open as archive | `src/renderer/api/pages/PagesLifecycleModel.ts:270-289` |
| PageNavigator secondary panel | `src/renderer/ui/navigation/PageNavigator.tsx` |
| Open handler (Layer 3) | `src/renderer/content/open-handler.ts` |
| Archive file detection | `src/renderer/core/utils/file-path.ts` (`isArchiveFile`, `ARCHIVE_EXTENSIONS`) |
| PageModel base | `src/renderer/editors/base/PageModel.ts` |
| Shared types | `src/shared/types.ts` |

## Implementation Plan

### Step 1: Add types

**File:** `src/shared/types.ts`

```typescript
// Add to PageType union:
export type PageType = "textFile" | ... | "categoryPage" | "zipFile";

// Add to PageEditor union:
export type PageEditor = "monaco" | ... | "category-view" | "zip-view";
```

### Step 2: Create ZipPageModel

**File:** `src/renderer/editors/zip/ZipPageModel.ts` (new)

```typescript
import { TComponentState } from "../../core/state/state";
import { PageModel, getDefaultPageModelState } from "../base";
import type { IPageState } from "../../../shared/types";
import { ZipTreeProvider } from "../../content/tree-providers/ZipTreeProvider";

export interface ZipPageModelState extends IPageState {
    type: "zipFile";
    /** Archive source URL (path to the .zip file). */
    archiveUrl: string;
}

export class ZipPageModel extends PageModel<ZipPageModelState> {
    /** Tree provider for browsing archive contents. Owned by this model. */
    treeProvider: ZipTreeProvider | null = null;

    constructor(state?: TComponentState<ZipPageModelState>) {
        super(state ?? new TComponentState(getDefaultZipPageModelState()));
        this.noLanguage = true;
        this.getIcon = () => /* archive icon */;
    }

    /** Initialize from archive path. Creates ZipTreeProvider and sets secondaryEditor. */
    initFromArchive(archiveUrl: string): void {
        const fpBasename = require("../../core/utils/file-path").fpBasename;
        this.treeProvider = new ZipTreeProvider(archiveUrl);
        this.state.update((s) => {
            s.title = fpBasename(archiveUrl);
            s.archiveUrl = archiveUrl;
        });
    }

    async restore(): Promise<void> {
        await super.restore();
        // Recreate ZipTreeProvider from persisted archiveUrl
        const archiveUrl = this.state.get().archiveUrl;
        if (archiveUrl && !this.treeProvider) {
            const { ZipTreeProvider } = await import(
                "../../content/tree-providers/ZipTreeProvider"
            );
            this.treeProvider = new ZipTreeProvider(archiveUrl);
        }
        // Set secondaryEditor AFTER navigationData is ready (super.restore sets it up)
        // This adds this model to navigationData.secondaryModels[]
        if (this.treeProvider) {
            this.secondaryEditor = "zip-tree";
        }
    }

    /**
     * Navigation survival: keep this model as secondary editor if the new page
     * was opened from this archive (sourceLink.metadata.sourceId matches).
     */
    beforeNavigateAway(newModel: PageModel): void {
        const sourceId = newModel.state.get().sourceLink?.metadata?.sourceId;
        if (sourceId === this.id) {
            // File opened from this archive — keep zip tree in sidebar
            return;
        }
        // Unrelated navigation — remove from sidebar
        this.secondaryEditor = undefined;
    }

    async dispose(): Promise<void> {
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        await super.dispose();
    }

    applyRestoreData(data: Partial<ZipPageModelState>): void {
        super.applyRestoreData(data as any);
        if (data.archiveUrl) {
            this.state.update((s) => { s.archiveUrl = data.archiveUrl!; });
        }
    }

    getRestoreData(): Partial<ZipPageModelState> {
        return {
            ...super.getRestoreData(),
            archiveUrl: this.state.get().archiveUrl,
        };
    }
}
```

**Key decisions:**
- `archiveUrl` persisted in state — used to recreate `ZipTreeProvider` on restore
- `secondaryEditor = "zip-tree"` set in `restore()` after `super.restore()` (which sets up NavigationData)
- `beforeNavigateAway` checks `newModel.sourceLink?.metadata?.sourceId === this.id`
- `treeProvider` is a direct property, NOT stored in NavigationData's secondary provider system

### Step 3: Create ZipPageView (main content)

**File:** `src/renderer/editors/zip/ZipPageView.tsx` (new)

The main content area renders `TreeProviderView` with the model's `treeProvider`. When user clicks an item:
- **File:** opens via `openRawLink` with metadata `{ pageId, sourceId: model.id }`. The `sourceId` ensures `beforeNavigateAway` can identify files opened from this archive.
- **Directory:** navigates to `tree-category://` link (same as current ZipTreeProvider behavior).

```typescript
export function ZipPageView({ model }: { model: ZipPageModel }) {
    const provider = model.treeProvider;
    const pageId = model.id;

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url, undefined, { pageId, sourceId: model.id },
        ));
    }, [provider, pageId, model.id]);

    // Toolbar with collapse/refresh buttons
    // TreeProviderView with provider
}
```

**Toolbar:** Collapse All, Refresh buttons (like PageNavigator secondary panel). No "Navigate Up" (zip tree has fixed root). No "Close Panel" (this IS the main content).

### Step 4: Create ZipSecondaryEditor (sidebar component)

**File:** `src/renderer/editors/zip/ZipSecondaryEditor.tsx` (new)

The secondary sidebar component. Receives `ZipPageModel` via props, renders `TreeProviderView` with the same `treeProvider`. Functionally identical to `ZipPageView` but without the toolbar (PageNavigator provides panel header buttons).

```typescript
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ZipPageModel } from "./ZipPageModel";

export default function ZipSecondaryEditor({ model }: SecondaryEditorProps) {
    const zipModel = model as ZipPageModel;
    const provider = zipModel.treeProvider;
    // ... TreeProviderView rendering same as ZipPageView but compact
}
```

PageNavigator already renders secondary model panels via `LazySecondaryEditor` (US-316). Once registered in the secondary editor registry, this component will be rendered automatically when `ZipPageModel` sets `secondaryEditor = "zip-tree"`.

### Step 5: Create EditorModule (index.ts)

**File:** `src/renderer/editors/zip/index.ts` (new)

Standard `EditorModule` pattern:

```typescript
const zipEditorModule: EditorModule = {
    Editor: ZipPageView,
    newPageModel: async (filePath?: string) => {
        const { ZipPageModel } = await import("./ZipPageModel");
        const model = new ZipPageModel();
        if (filePath) model.initFromArchive(filePath);
        return model;
    },
    newEmptyPageModel: async (pageType) => {
        if (pageType !== "zipFile") return null;
        const { ZipPageModel } = await import("./ZipPageModel");
        return new ZipPageModel();
    },
    newPageModelFromState: async (state) => {
        const { ZipPageModel } = await import("./ZipPageModel");
        const model = new ZipPageModel();
        model.applyRestoreData(state as any);
        return model;
    },
};
export default zipEditorModule;
```

### Step 6: Register zip-view editor + zip-tree secondary editor

**File:** `src/renderer/editors/register-editors.ts`

Register the page-editor:
```typescript
editorRegistry.register({
    id: "zip-view",
    name: "Archive",
    pageType: "zipFile",
    category: "page-editor",
    acceptFile: (fileName) => {
        if (!fileName) return -1;
        return isArchiveFile(fileName) ? 100 : -1;
    },
    loadModule: async () => {
        const module = await import("./zip/index");
        return module.default;
    },
});
```

Register the secondary editor:
```typescript
import { secondaryEditorRegistry } from "../ui/navigation/secondary-editor-registry";

secondaryEditorRegistry.register({
    id: "zip-tree",
    label: "Archive",
    loadComponent: () => import("./zip/ZipSecondaryEditor"),
});
```

### Step 7: Pass `sourceId` when opening files from archive tree

When files are opened from either `ZipPageView` or `ZipSecondaryEditor`, the metadata must include `sourceId: zipModel.id`. This metadata flows through the content pipeline:

1. `openRawLink` event with `{ pageId, sourceId }` metadata
2. Parsers → Resolvers → `openContent` event preserves metadata
3. Open handler builds `sourceLink` — `pageId` is stripped (ephemeral), `sourceId` is kept
4. `navigatePageTo()` sets `sourceLink` on new model early (already implemented in US-314)
5. `ZipPageModel.beforeNavigateAway(newModel)` checks `newModel.sourceLink?.metadata?.sourceId`

**No changes needed in open-handler.ts** — `sourceId` is not in the ephemeral strip list, so it passes through `buildSourceLink()` into `sourceLink.metadata`.

### Step 8: Update `openFileAsArchive()`

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Replace the current empty-page-with-nav-panel approach:

```typescript
openFileAsArchive = async (filePath: string): Promise<PageModel> => {
    const isAsar = filePath.toLowerCase().endsWith(".asar");
    const archiveRoot = isAsar ? filePath : filePath + "!";

    // Check if already open as archive
    const existing = this.model.state.get().pages.find(
        (p) => p.state.get().type === "zipFile"
            && (p.state.get() as any).archiveUrl === filePath
    );
    if (existing) {
        this.model.navigation.showPage(existing.state.get().id);
        return existing;
    }

    // Create ZipPageModel via editor registry (dynamic import)
    const editorDef = editorRegistry.getById("zip-view");
    if (!editorDef) throw new Error("zip-view editor not registered");
    const module = await editorDef.loadModule();
    const page = await module.newPageModel(filePath);

    // Create NavigationData with archive root for explorer sidebar
    const navData = new NavigationData(archiveRoot);
    navData.ensurePageNavigatorModel();
    navData.updateId(page.state.get().id);
    navData.flushSave();
    page.navigationData = navData;
    page.state.update((s) => { s.hasNavigator = true; });

    // secondaryEditor is set during restore() — but restore() was NOT called
    // because newPageModel calls initFromArchive, not restore. Set it explicitly.
    // Actually: initFromArchive doesn't set secondaryEditor. We need restore() to run.
    // But addEmptyPageWithNavPanel pattern skips restore to avoid race condition.
    // Solution: set secondaryEditor after NavigationData is attached.
    (page as any).secondaryEditor = "zip-tree";

    this.addPage(page);
    this.model.closeFirstPageIfEmpty();
    return page;
};
```

**Concern — restore race:** The current `addEmptyPageWithNavPanel()` intentionally skips `restore()` to avoid a race condition. `ZipPageModel` similarly needs NavigationData attached BEFORE `secondaryEditor` is set (the setter calls `navigationData.addSecondaryModel()`). The sequence must be:
1. Create ZipPageModel + initFromArchive (creates provider, sets title)
2. Create and attach NavigationData
3. Set `secondaryEditor = "zip-tree"` (adds to secondaryModels[])
4. `addPage()` to show

On restore (app restart), `restore()` handles this correctly:
1. `super.restore()` creates NavigationData from cache
2. `restoreSecondaryModels(this)` deduplicates (reuses this instance)
3. `secondaryEditor = "zip-tree"` is already in state (persisted)

### Step 9: Handle `.asar` archives

`.asar` archives use Electron's native fs patching (no ZipTreeProvider). They currently go through `openFileAsArchive` with the plain path as root.

**Decision:** Keep the current `.asar` handling separate — it doesn't use ZipTreeProvider. Add an early return in `openFileAsArchive` for `.asar` that uses the old empty-page-with-nav-panel approach. Only `.zip` and other ARCHIVE_EXTENSIONS use the new ZipPageModel.

```typescript
openFileAsArchive = async (filePath: string): Promise<PageModel> => {
    // .asar: Electron native fs — use simple nav panel (no ZipTreeProvider)
    if (filePath.toLowerCase().endsWith(".asar")) {
        return this._openAsarArchive(filePath);
    }
    // ZIP-based archives: use ZipPageModel
    return this._openZipArchive(filePath);
};
```

## Files Changed Summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `"zipFile"` to `PageType`, `"zip-view"` to `PageEditor` |
| `src/renderer/editors/zip/ZipPageModel.ts` | **New** — ZipPageModel with ZipTreeProvider, beforeNavigateAway, restore |
| `src/renderer/editors/zip/ZipPageView.tsx` | **New** — Main content: toolbar + TreeProviderView |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | **New** — Sidebar component: TreeProviderView (compact) |
| `src/renderer/editors/zip/index.ts` | **New** — EditorModule (newPageModel, newPageModelFromState, etc.) |
| `src/renderer/editors/register-editors.ts` | Register `zip-view` editor + `zip-tree` secondary editor |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Update `openFileAsArchive` to create ZipPageModel for ZIP archives |

### Step 10: Remove old secondary provider system

Now that PageNavigator renders secondary editors from `secondaryModels[]` (US-316), and ZipPageModel replaces the standalone ZipTreeProvider, the old secondary provider system can be removed.

**File:** `src/renderer/ui/navigation/PageNavigator.tsx`

Remove:
- `secondaryDescriptor`, `secondaryProvider`, `secondarySelectedHref` variables
- `secondaryInitialState` useMemo
- `secondaryTreeRef` ref
- `handleSecondaryItemClick`, `handleSecondaryCollapseAll`, `handleSecondaryRefresh`, `handleSecondaryStateChange` handlers
- `secondaryButtons`, `secondaryTitle` render variables
- The `{secondaryDescriptor && <CollapsiblePanel id="secondary" ...>}` block
- Archive detection in `handleItemClick` (`isArchiveFile` → `setSecondaryDescriptor`)
- `isArchiveFile` import

**File:** `src/renderer/ui/navigation/PageNavigator.tsx` — `handleSetActivePanel`

Remove the `panelId === "secondary"` branch (lazy provider creation).

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Remove:
- `secondaryDescriptor` property and `SecondaryDescriptor` interface
- `secondaryProvider` property
- `secondarySelectionState` and `secondaryTreeState`
- `setSecondaryDescriptor()`, `clearSecondary()`, `createSecondaryProvider()` methods
- `setSecondarySelectedHref()`, `setSecondaryTreeState()` methods
- `activeProvider` and `activeSelectionState` getters (they reference secondaryProvider)
- Secondary descriptor persistence in `_saveState()` and `restore()`
- `SecondaryDescriptor` export

Keep backward-compat: ignore `secondaryDescriptor` in saved state during `restore()` (don't crash on old cache files that have it).

**File:** `src/renderer/ui/navigation/NavigationData.ts` — `NavigationSavedState`

Keep the `secondaryDescriptor`, `secondarySelectedHref`, `secondaryTreeState` fields in the interface (for reading old cache files) but stop writing them.

**File:** `src/renderer/editors/category/CategoryEditor.tsx`

Change `navigationData.activeProvider` → `navigationData.treeProvider` (always the FileTreeProvider). CategoryEditor now only serves Explorer directory browsing (`type: "file"` category links). Archive directory browsing is handled by ZipPageModel's own tree.

## Files Changed Summary (Updated)

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `"zipFile"` to `PageType`, `"zip-view"` to `PageEditor` |
| `src/renderer/editors/zip/ZipPageModel.ts` | **New** — ZipPageModel with ZipTreeProvider, beforeNavigateAway, restore |
| `src/renderer/editors/zip/ZipPageView.tsx` | **New** — Main content: toolbar + TreeProviderView |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | **New** — Sidebar component: TreeProviderView (compact) |
| `src/renderer/editors/zip/index.ts` | **New** — EditorModule (newPageModel, newPageModelFromState, etc.) |
| `src/renderer/editors/register-editors.ts` | Register `zip-view` editor + `zip-tree` secondary editor |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Update `openFileAsArchive` to create ZipPageModel for ZIP archives |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Remove old secondary provider panel, archive detection, lazy provider creation |
| `src/renderer/ui/navigation/NavigationData.ts` | Remove secondary provider fields/methods, activeProvider getter (keep in saved state interface for compat) |
| `src/renderer/editors/category/CategoryEditor.tsx` | Use `treeProvider` directly instead of `activeProvider` |

## Files NOT Changed

| File | Why |
|---|---|
| `open-handler.ts` | No changes — `sourceId` metadata already passes through `buildSourceLink()` |
| `ZipTreeProvider.ts` | Reused as-is — owned by ZipPageModel instead of NavigationData |
| `LazySecondaryEditor.tsx` | Already implemented in US-316 |

## Concerns

### 1. Removing old secondary provider system — clean cutover

This task removes the old `secondaryDescriptor`/`secondaryProvider` system from PageNavigator and NavigationData (Step 10). This is safe because:
- PageNavigator now renders secondary panels from `secondaryModels[]` via the registry (US-316)
- ZipPageModel replaces the standalone ZipTreeProvider
- Old cache files with `secondaryDescriptor` are silently ignored (backward compat in NavigationSavedState)

The archive detection in `handleItemClick` (`isArchiveFile` → `setSecondaryDescriptor`) is removed. Archive files opened from the explorer tree now go through the normal content pipeline and create a ZipPageModel.

### 2. Opening archives — old path vs new path

Currently opening a `.zip` file from the OS (double-click, drag-drop) goes through `openFile()` which resolves to `monaco` editor (shows binary gibberish). The user must right-click → "Open as Archive". With `zip-view` registered with `acceptFile` returning 100 for archive extensions, opening a `.zip` file would now create a ZipPageModel automatically.

**This is the desired behavior.** Archive files should open as archives, not as text. The `acceptFile` priority of 100 ensures this.

### 3. NavigationData for ZipPageModel

ZipPageModel needs NavigationData for two reasons:
- The sidebar (PageNavigator) requires it to render
- `secondaryEditor` setter calls `navigationData.addSecondaryModel(this)`

On first open: `openFileAsArchive()` creates NavigationData manually (same pattern as `addEmptyPageWithNavPanel`).
On restore: `super.restore()` creates NavigationData from cache.

### 4. Deduplication on restore

When ZipPageModel is the active page, it's in both `WindowState.pages[]` and `NavigationData.secondaryModels[]`. On restore:
1. `PagesPersistenceModel` creates ZipPageModel from `pages[]`
2. `ZipPageModel.restore()` → `super.restore()` → `NavigationData.restoreSecondaryModels(this)`
3. Descriptor ID matches `this.id` → reuses existing instance (no duplicate)

This is the exact deduplication pattern designed in US-314.

### 5. CategoryEditor dependency on activeProvider — Resolved

`CategoryEditor` currently uses `navigationData.activeProvider` which delegates between `treeProvider` (Explorer) and `secondaryProvider` (old zip system). After removing the old secondary system, `activeProvider` no longer needs this delegation.

**Decision:** Simplify CategoryEditor to use `navigationData.treeProvider` directly (the FileTreeProvider / Explorer). Archive directory browsing is no longer CategoryEditor's responsibility — ZipPageModel handles its own tree. `tree-category://` links with `type: "zip"` won't route to CategoryEditor anymore; only `type: "file"` links will. Remove the `activeProvider`/`activeSelectionState` getters from NavigationData.

### 6. Editor icon

ZipPageModel needs an archive icon. Use a RAR-style icon (universally recognized as "archive") — find a suitable SVG icon from an open-source icon set (e.g., Material Design, Lucide, Tabler) or create a minimal one. Add as `ArchiveIcon` in the icons module.

## Acceptance Criteria

- [ ] `"zipFile"` added to `PageType`, `"zip-view"` added to `PageEditor`
- [ ] `ZipPageModel` extends `PageModel` with `archiveUrl`, owns `ZipTreeProvider`
- [ ] `ZipPageModel.beforeNavigateAway(newModel)` checks `sourceLink.metadata.sourceId`
- [ ] `ZipPageModel.restore()` recreates `ZipTreeProvider` and sets `secondaryEditor`
- [ ] `ZipPageView` renders toolbar + `TreeProviderView` as main content
- [ ] Clicking a file in `ZipPageView` opens it via `openRawLink` with `sourceId` metadata
- [ ] Clicking a directory navigates to `tree-category://` link
- [ ] `ZipSecondaryEditor` renders `TreeProviderView` (registered as "zip-tree" in secondary editor registry)
- [ ] `zip-view` registered in editor registry as page-editor with archive file acceptance
- [ ] `openFileAsArchive()` creates `ZipPageModel` for ZIP archives (`.asar` keeps old approach)
- [ ] Opening a `.zip` file directly (not via "Open as Archive") creates `ZipPageModel`
- [ ] Archive browsing + file opening works end-to-end (main content tree + sidebar tree)
- [ ] ZipSecondaryEditor rendered in PageNavigator sidebar via LazySecondaryEditor (US-316 infra)
- [ ] Old secondary provider system removed (secondaryDescriptor, secondaryProvider, createSecondaryProvider, archive detection in handleItemClick)
- [ ] Old cache files with secondaryDescriptor don't crash on restore
- [ ] CategoryEditor uses `treeProvider` directly (Explorer only, no more activeProvider delegation)
- [ ] Persists across app restart (archiveUrl + NavigationData + secondaryEditor restored)
- [ ] TypeScript compiles cleanly
