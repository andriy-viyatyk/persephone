# US-329: Wire PageModel to ExplorerEditorModel

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 2, Task 2.2)

## Goal

Wire PageModel to dynamically create `ExplorerEditorModel` (from US-328) and add it to `secondaryEditors[]`. Remove Explorer-specific state from PageModel. Update PageNavigator to render Explorer and Search panels exclusively through the secondary editor system (portaled headers from US-328). After this task, Explorer is a regular secondary editor — no special-case code in PageModel.

## Background

After US-328, `ExplorerEditorModel` exists as a class with secondary panel registrations ("explorer" and "search"), but is not used at runtime. PageModel still owns all Explorer state directly (treeProvider, selectionState, searchState, treeState, etc.) and PageNavigator reads from `page.*` directly.

### Current state (PageModel fields to remove)

```
PageModel (lines 73-87)
├── treeProvider: ITreeProvider | null           → ExplorerEditorModel.treeProvider
├── selectionState: TOneState<NavigationState>   → ExplorerEditorModel.selectionState
├── treeState: TreeProviderViewSavedState        → ExplorerEditorModel.treeState
├── searchState: FileSearchState | undefined     → ExplorerEditorModel.searchState
├── activePanel: string = "explorer"             → derived from secondaryEditors[]
├── _rootPath: string                            → ExplorerEditorModel constructor arg
```

```
PageModel methods to remove:
├── setSelectedHref()      → ExplorerEditorModel.setSelectedHref()
├── setTreeState()         → ExplorerEditorModel.setTreeState()
├── openSearch()           → ExplorerEditorModel.openSearch()
├── closeSearch()          → ExplorerEditorModel.closeSearch()
├── setSearchState()       → ExplorerEditorModel.setSearchState
├── rootPath getter        → ExplorerEditorModel.rootPath
```

```
PageModel methods to update:
├── toggleNavigator()      → creates ExplorerEditorModel if needed
├── canOpenNavigator()     → checks for ExplorerEditorModel or ability to create one
├── notifyMainEditorChanged() → remove Explorer selection clearing (ExplorerEditorModel.onMainEditorChanged handles it)
├── dispose()              → remove treeProvider disposal (ExplorerEditorModel.dispose handles it)
├── restoreSidebar()       → restore ExplorerEditorModel from descriptors or old format
├── _saveState()           → remove Explorer fields, ExplorerEditorModel persists via secondaryEditors
```

### Key files

- **PageModel:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts) — main target
- **PageNavigator.tsx:** [src/renderer/ui/navigation/PageNavigator.tsx](../../src/renderer/ui/navigation/PageNavigator.tsx) — UI that reads Explorer state from `page.*`
- **PageNavigatorModel:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../src/renderer/ui/navigation/PageNavigatorModel.ts) — sidebar layout (open/width/rootPath)
- **ExplorerEditorModel:** [src/renderer/editors/explorer/ExplorerEditorModel.ts](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) — the target model
- **PagesLifecycleModel:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../src/renderer/api/pages/PagesLifecycleModel.ts) — `addEmptyPageWithNavPanel`, `newEditorModelFromState`
- **ScriptPanel:** [src/renderer/editors/text/ScriptPanel.tsx](../../src/renderer/editors/text/ScriptPanel.tsx) — sets `page.treeState` directly (line 340)
- **Pages.tsx:** [src/renderer/ui/app/Pages.tsx](../../src/renderer/ui/app/Pages.tsx) — `NavigationWrapper` checks `hasSidebar`

### Callers of Explorer state on PageModel

All references to `page.treeProvider`, `page.selectionState`, `page.searchState`, `page.treeState`, `page.openSearch`, `page.closeSearch`, `page.setSearchState`, `page.setSelectedHref`, `page.setTreeState`:

| File | Lines | What it does |
|------|-------|-------------|
| [PageNavigator.tsx](../../src/renderer/ui/navigation/PageNavigator.tsx) | 51, 73-80, 85, 88, 100, 105, 121-124, 135, 145, 152, 156, 183, 200, 262, 315-316 | Reads/writes all Explorer fields from `page.*` |
| [ScriptPanel.tsx](../../src/renderer/editors/text/ScriptPanel.tsx) | 340 | Sets `page.treeState` directly for "Open in Script Panel Directory" |

### Callers of toggleNavigator / canOpenNavigator

| File | What it does |
|------|-------------|
| [TextToolbar.tsx](../../src/renderer/editors/text/TextToolbar.tsx) | `model.page?.canOpenNavigator(pipe, filePath)` / `toggleNavigator(pipe, filePath)` |
| [PdfViewer.tsx](../../src/renderer/editors/pdf/PdfViewer.tsx) | Same pattern |
| [ImageViewer.tsx](../../src/renderer/editors/image/ImageViewer.tsx) | Same pattern |
| [CategoryEditor.tsx](../../src/renderer/editors/category/CategoryEditor.tsx) | `page?.toggleNavigator()` |
| [ZipEditorView.tsx](../../src/renderer/editors/zip/ZipEditorView.tsx) | `model.page?.toggleNavigator()` |

These callers don't need to change — `toggleNavigator` and `canOpenNavigator` stay on PageModel but their internals change.

### How `newEditorModelFromState` resolves types

[PagesLifecycleModel.ts:70-86](../../src/renderer/api/pages/PagesLifecycleModel.ts) — looks up editor registry by `state.type`. `"fileExplorer"` is not registered in the editor registry (it's not a main editor), so it falls through to the default Monaco editor — which is wrong. Need to add special handling.

### `hasSidebar` — EPIC-019 Decision 5

Per EPIC-019: `hasSidebar` becomes `secondaryEditors.length > 0`. Currently `hasSidebar` returns `this.pageNavigatorModel !== null`. After this task, it should return `this.secondaryEditors.length > 0` — any secondary editor (Explorer, Archive, etc.) automatically shows the sidebar.

## Implementation Plan

### Step 1: Add ExplorerEditorModel to `newEditorModelFromState`

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts:70-86](../../src/renderer/api/pages/PagesLifecycleModel.ts)

Add a special case for `"fileExplorer"` before the registry lookup:

```typescript
newEditorModelFromState = async (
    state: Partial<IEditorState>
): Promise<EditorModel> => {
    if (state.type && PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type]) {
        state = { ...state, type: PagesLifecycleModel.PAGE_TYPE_MIGRATIONS[state.type] };
    }
    // ExplorerEditorModel — not in editor registry (secondary-only)
    if (state.type === "fileExplorer") {
        const { ExplorerEditorModel } = await import("../../editors/explorer");
        return new ExplorerEditorModel();
    }
    // ... rest unchanged
};
```

### Step 2: Add helper to find/create ExplorerEditorModel on PageModel

**File:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts)

Add a helper method and a convenience getter:

```typescript
/** Find the ExplorerEditorModel in secondaryEditors, if any. */
findExplorer(): EditorModel | undefined {
    return this.secondaryEditors.find(
        (m) => m.state.get().type === "fileExplorer"
    );
}

/** Create and add an ExplorerEditorModel with the given rootPath. */
async createExplorer(rootPath: string): Promise<EditorModel> {
    const { ExplorerEditorModel } = await import("../../editors/explorer");
    const explorer = new ExplorerEditorModel(rootPath);
    this.addSecondaryEditor(explorer);
    return explorer;
}
```

### Step 3: Rewrite `toggleNavigator`

**File:** [src/renderer/api/pages/PageModel.ts:319-340](../../src/renderer/api/pages/PageModel.ts)

```typescript
async toggleNavigator(pipe?: IContentPipe | null, filePath?: string): Promise<void> {
    const existing = this.findExplorer();
    if (existing || this.pageNavigatorModel) {
        // Explorer exists — just toggle sidebar visibility
        this.ensurePageNavigatorModel().toggle();
        return;
    }

    // Derive root path
    let rootPath = "";
    if (pipe?.provider.type === "file" && pipe.provider.sourceUrl) {
        rootPath = fpDirname(pipe.provider.sourceUrl);
    } else if (filePath) {
        rootPath = fpDirname(filePath);
    }
    if (!rootPath) return;

    // Create Explorer + ensure sidebar is visible
    await this.createExplorer(rootPath);
    this.ensurePageNavigatorModel();
}
```

Note: `toggleNavigator` becomes `async` since `createExplorer` uses dynamic import. All callers already ignore the return value, so this is safe.

### Step 4: Update `canOpenNavigator`

**File:** [src/renderer/api/pages/PageModel.ts:343-349](../../src/renderer/api/pages/PageModel.ts)

```typescript
canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean {
    if (this.findExplorer()) return true;
    if (this.pageNavigatorModel) return true;
    if (pipe?.provider.type === "file") return true;
    if (filePath) return true;
    return false;
}
```

Replace `this.treeProvider` check with `this.findExplorer()`.

### Step 5: Remove Explorer-specific fields from PageModel

**File:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts)

Remove these fields:
- `treeProvider: ITreeProvider | null` (line 76)
- `selectionState` (line 80)
- `treeState` (line 82)
- `activePanel` (line 85)
- `searchState` (line 87)

Remove these methods:
- `setSelectedHref()` (lines 234-237)
- `setTreeState()` (lines 242-245)
- `setActivePanel()` (lines 248-251)
- `openSearch()` (lines 256-271)
- `closeSearch()` (lines 274-280)
- `setSearchState` (lines 283-286)
- `rootPath` getter (lines 291-293)

Remove Explorer-specific type imports at the top (`ITreeProvider`, `TreeProviderViewSavedState`, `FileSearchState`).

### Step 6: Update `notifyMainEditorChanged`

**File:** [src/renderer/api/pages/PageModel.ts:409-432](../../src/renderer/api/pages/PageModel.ts)

Remove the Explorer selection clearing — ExplorerEditorModel.onMainEditorChanged() handles this now:

```typescript
notifyMainEditorChanged(): void {
    // Notify secondary editors — they may clear their secondaryEditor
    for (const m of [...this.secondaryEditors]) {
        m.onMainEditorChanged(this.mainEditor);
    }
    // Clean up models that cleared their secondaryEditor during notification
    const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor?.length);
    if (removed.length > 0) {
        for (const m of removed) {
            const idx = this.secondaryEditors.indexOf(m);
            if (idx >= 0) this.secondaryEditors.splice(idx, 1);
            if (m.secondaryEditor?.includes(this.activePanel) || this.activePanel === m.id) {
                this.activePanel = "explorer";
            }
            m.dispose();
        }
        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }
}
```

Wait — `this.activePanel` is being removed from PageModel. The fallback logic needs rethinking. After this task, `activePanel` doesn't exist on PageModel. The `CollapsiblePanelStack` tracks its own active panel state (in PageNavigator's local state). The removal fallback should fire `expandSecondaryPanel` or just let CollapsiblePanelStack handle it naturally.

**Decision:** Keep `activePanel` on PageModel for now — it's still needed by PageNavigator as a persistent value (restored from cache). It will be simplified in Phase 4 but removing it now is too disruptive. Only remove Explorer-specific state fields.

Revised: keep `activePanel` and `setActivePanel()` on PageModel.

### Step 7: Update `hasSidebar`

**File:** [src/renderer/api/pages/PageModel.ts:211-213](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
get hasSidebar(): boolean {
    return this.pageNavigatorModel !== null;
}

// After:
get hasSidebar(): boolean {
    return this.secondaryEditors.length > 0 || this.pageNavigatorModel !== null;
}
```

Per EPIC-019 Decision 5: any secondary editor shows the sidebar. Keep `pageNavigatorModel` check as fallback for the transition.

### Step 8: Update persistence — `restoreSidebar` and `_saveState`

**File:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts)

The `PageSidebarSavedState` format changes — remove Explorer-specific fields:

```typescript
interface PageSidebarSavedState {
    open: boolean;
    width: number;
    activePanel?: string;
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
    // Removed: rootPath, treeState, selectedHref, searchState
    // These are now inside ExplorerEditorModel's getRestoreData()
}
```

**`restoreSidebar()`** — handle old format migration:

```typescript
async restoreSidebar(): Promise<void> {
    const data = await fs.getCacheFile(this.id, this._cacheName);
    const saved = parseObject(data) as PageSidebarSavedState | undefined;
    if (!saved) return;

    // Restore sidebar layout
    this._skipSave = true;
    const navModel = this.ensurePageNavigatorModel();
    navModel.setStateQuiet({
        open: saved.open ?? true,
        width: saved.width ?? 240,
    });
    this._skipSave = false;

    // Migrate old format: if rootPath exists at top level, create ExplorerEditorModel descriptor
    if ((saved as any).rootPath && !saved.secondaryModelDescriptors?.some(
        (d) => d.pageState.type === "fileExplorer"
    )) {
        const oldRootPath = (saved as any).rootPath as string;
        const explorerDesc: SecondaryModelDescriptor = {
            pageState: {
                id: crypto.randomUUID(),
                type: "fileExplorer",
                title: "Explorer",
                modified: false,
                rootPath: oldRootPath,
                // Carry over old Explorer state
                ...(saved as any).treeState ? {} : {},
            } as any,
        };
        // Store old state as scriptData for manual migration if needed
        saved.secondaryModelDescriptors = [
            explorerDesc,
            ...(saved.secondaryModelDescriptors ?? []),
        ];
    }

    // Restore secondary editor model descriptors (actual creation deferred)
    if (saved.secondaryModelDescriptors?.length) {
        this.pendingSecondaryDescriptors = saved.secondaryModelDescriptors;
    }

    // Restore activePanel
    const restoredPanel = saved.activePanel ?? "explorer";
    if (restoredPanel !== "explorer" && restoredPanel !== "search") {
        this.activePanel = "explorer";
        this._pendingActivePanel = restoredPanel;
    } else {
        this.activePanel = restoredPanel;
    }
}
```

**`_saveState()`** — simplified:

```typescript
private _saveState = async (): Promise<void> => {
    for (const model of this.secondaryEditors) {
        await model.saveState?.();
    }
    const navState = this.pageNavigatorModel?.state.get();
    const saved: PageSidebarSavedState = {
        open: navState?.open ?? true,
        width: navState?.width ?? 240,
        activePanel: this.activePanel,
        secondaryModelDescriptors: this.secondaryEditors.length > 0
            ? this.secondaryEditors.map((m) => ({ pageState: m.getRestoreData() }))
            : undefined,
    };
    await fs.saveCacheFile(this.id, JSON.stringify(saved), this._cacheName);
};
```

### Step 9: Update `dispose()`

**File:** [src/renderer/api/pages/PageModel.ts:564-587](../../src/renderer/api/pages/PageModel.ts)

Remove `treeProvider` disposal (ExplorerEditorModel handles it via secondaryEditors loop):

```typescript
async dispose(): Promise<void> {
    this._expandSub?.unsubscribe();
    this._expandSub = undefined;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    // Dispose all secondary editors (includes ExplorerEditorModel)
    for (const model of this.secondaryEditors) {
        model.setPage(null);
        model.dispose();
    }
    this.secondaryEditors = [];
    this.pageNavigatorModel?.dispose();
    this.pageNavigatorModel = null;
    // Dispose main editor
    if (this.mainEditor) {
        this.mainEditor.setPage(null);
        await this.mainEditor.dispose();
        this.mainEditor = null;
    }
}
```

### Step 10: Rewrite PageNavigator to use ExplorerEditorModel

**File:** [src/renderer/ui/navigation/PageNavigator.tsx](../../src/renderer/ui/navigation/PageNavigator.tsx)

This is the biggest change. The Explorer and Search panels currently render inline in PageNavigator reading from `page.*`. After this task, they are rendered via the secondary editor system (as "explorer" and "search" panels from ExplorerEditorModel, portaled via headerRef from US-328).

The entire Explorer panel (`<CollapsiblePanel id="explorer">...TreeProviderView...</CollapsiblePanel>`) and Search panel (`<CollapsiblePanel id="search">...FileSearch...</CollapsiblePanel>`) are **removed** from PageNavigator. They will be rendered automatically by the `secondaryEditors.flatMap(...)` loop because ExplorerEditorModel registers `["explorer"]` (and optionally `["explorer", "search"]`).

PageNavigator becomes much simpler — just the CollapsiblePanelStack with secondary editor panels:

```tsx
export function PageNavigator({ page }: PageNavigatorProps) {
    const navModel = page.ensurePageNavigatorModel();
    const { version: _secondaryVersion } = page.secondaryEditorsVersion.use();
    const secondaryEditors = page.secondaryEditors;
    const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [activePanel, setActivePanelLocal] = useState(page.activePanel);

    // Sync local activePanel when PageModel changes
    useEffect(() => {
        if (page.activePanel !== activePanel) {
            setActivePanelLocal(page.activePanel);
        }
    }, [page.activePanel, _secondaryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSetActivePanel = useCallback((panelId: string) => {
        if (panelId === activePanel) return;
        page.setActivePanel(panelId);
        setActivePanelLocal(panelId);
    }, [page, activePanel]);

    return (
        <PageNavigatorRoot>
            <CollapsiblePanelStack
                activePanel={activePanel}
                setActivePanel={handleSetActivePanel}
                style={{ flex: "1 1 auto" }}
            >
                {secondaryEditors.flatMap((model) => {
                    const panelIds = model.state.get().secondaryEditor;
                    if (!panelIds?.length) return [];
                    return panelIds.map((panelId) => {
                        const def = secondaryEditorRegistry.get(panelId);
                        if (!def) return null;
                        const refKey = `${model.id}-${panelId}`;
                        return (
                            <CollapsiblePanel
                                key={refKey}
                                id={panelId}
                                headerRef={(el) => { headerRefs.current[refKey] = el; }}
                            >
                                <LazySecondaryEditor
                                    model={model}
                                    editorId={panelId}
                                    headerRef={headerRefs.current[refKey] ?? null}
                                />
                            </CollapsiblePanel>
                        );
                    });
                })}
            </CollapsiblePanelStack>
        </PageNavigatorRoot>
    );
}
```

This removes ~200 lines of Explorer/Search-specific code from PageNavigator.

### Step 11: Update `addEmptyPageWithNavPanel`

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts:139-143](../../src/renderer/api/pages/PagesLifecycleModel.ts)

```typescript
// Before:
addEmptyPageWithNavPanel = (folderPath: string): PageModel => {
    const page = new PageModel(undefined, folderPath);
    page.ensurePageNavigatorModel();
    return this.addPage(null, page);
};

// After:
addEmptyPageWithNavPanel = async (folderPath: string): Promise<PageModel> => {
    const page = new PageModel();
    await page.createExplorer(folderPath);
    page.ensurePageNavigatorModel();
    return this.addPage(null, page);
};
```

Becomes async. Check all callers — they already ignore the return value or can await.

### Step 12: Update ScriptPanel

**File:** [src/renderer/editors/text/ScriptPanel.tsx:335-344](../../src/renderer/editors/text/ScriptPanel.tsx)

ScriptPanel's "Open in Script Panel Directory" currently sets `page.treeState` directly. Per EPIC-019 Resolved Concern 2, this should use the standard page-open flow instead:

```typescript
// Before:
if (page && scriptPanelDir) {
    const navModel = page.ensurePageNavigatorModel();
    navModel.state.update((s) => { s.rootPath = scriptPanelDir; s.open = true; });
    const fileDir = fpDirname(selectedScript);
    page.treeState = {
        expandedPaths: [scriptPanelDir, fileDir],
        selectedHref: selectedScript,
    };
}

// After:
if (page && scriptPanelDir) {
    // Use standard flow — open empty page with Explorer
    pagesModel.addEmptyPageWithNavPanel(scriptPanelDir);
}
```

Wait — this changes behavior (opens new tab instead of reusing current). Let me reconsider. The current code reuses the current page's sidebar. After the change, ExplorerEditorModel is in `secondaryEditors[]`. We can find or create it:

```typescript
if (page && scriptPanelDir) {
    let explorer = page.findExplorer();
    if (!explorer) {
        explorer = await page.createExplorer(scriptPanelDir);
    }
    page.ensurePageNavigatorModel();
    // TODO: set tree state on explorer model if needed
}
```

Actually, let's keep it simple: ScriptPanel should use `addEmptyPageWithNavPanel` as it does in the else branch. Both branches open a new page. This matches EPIC-019 Resolved Concern 2.

### Step 13: Remove PageNavigatorModel rootPath (partial — Phase 4 prep)

Per EPIC-019, `PageNavigatorModel` should eventually become pure layout (open/width only). For now, keep `rootPath` on PageNavigatorModel since ExplorerEditorModel has its own `rootPath` and PageNavigatorModel is still used for sidebar open/close/width. The `rootPath` on PageNavigatorModel becomes unused — we can remove it when we simplify PageNavigatorModel in Phase 4.

**Decision:** Don't modify PageNavigatorModel in this task. Leave `rootPath` in place (read but not used meaningfully). Phase 4 will clean it up.

## Concerns

### 1. `toggleNavigator` becomes async — RESOLVED: Safe

All callers already ignore the return value. Making it async means the first click creates ExplorerEditorModel via dynamic import, which is fast (already bundled, just deferred). No UI jank expected.

### 2. `addEmptyPageWithNavPanel` becomes async — RESOLVED: Check callers

Callers: MenuBar (line 409), ScriptPanel (line 347), tree-context-menus (line 31). All are event handlers — making them async is safe. Return type changes from `PageModel` to `Promise<PageModel>`, but callers don't use the return value (except ScriptPanel which uses the synchronous path now).

### 3. Old cache format migration — RESOLVED: Create ExplorerEditorModel descriptor

When `restoreSidebar()` finds old-format data with `rootPath` at the top level, it creates an `ExplorerEditorModel` descriptor and appends it to `secondaryModelDescriptors`. The explorer's `treeState`, `selectionState`, and `searchState` won't survive the migration (they were stored at PageModel level, not in the descriptor). This is acceptable — same approach as EPIC-017 Decision D.

### 4. ScriptPanel direct state manipulation — RESOLVED: Use standard flow

Per EPIC-019 Resolved Concern 2, ScriptPanel should use `addEmptyPageWithNavPanel` instead of directly manipulating tree state. Both code paths now open a new page.

### 5. `activePanel` stays on PageModel — RESOLVED: Keep for now

`activePanel` is still needed as persistent state for sidebar panel selection. Removing it requires rethinking how panel selection is tracked across persist/restore. Phase 4 will address this.

## Acceptance Criteria

- [ ] `ExplorerEditorModel` is created dynamically by PageModel when Explorer is needed
- [ ] `toggleNavigator()` creates ExplorerEditorModel instead of setting `_rootPath`
- [ ] `canOpenNavigator()` checks for ExplorerEditorModel
- [ ] `addEmptyPageWithNavPanel()` creates page with ExplorerEditorModel
- [ ] Explorer/Search panels removed from PageNavigator inline code
- [ ] Explorer/Search render through secondary editor system (portaled headers)
- [ ] `treeProvider`, `selectionState`, `treeState`, `searchState` removed from PageModel
- [ ] `setSelectedHref`, `setTreeState`, `openSearch`, `closeSearch`, `setSearchState`, `rootPath` removed from PageModel
- [ ] `notifyMainEditorChanged()` no longer clears Explorer selection directly
- [ ] `newEditorModelFromState` handles `"fileExplorer"` type
- [ ] Old cache format migrated (rootPath at top level → ExplorerEditorModel descriptor)
- [ ] `hasSidebar` returns `secondaryEditors.length > 0 || pageNavigatorModel !== null`
- [ ] ScriptPanel updated
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | Remove Explorer fields/methods, add findExplorer/createExplorer, rewrite toggleNavigator/canOpenNavigator, update persistence/dispose/hasSidebar |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Remove inline Explorer/Search panels (~200 lines), simplify to secondary-editor-only rendering |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | `newEditorModelFromState` handles `"fileExplorer"`, `addEmptyPageWithNavPanel` becomes async |
| `src/renderer/editors/text/ScriptPanel.tsx` | Use `addEmptyPageWithNavPanel` for both paths |
| `src/renderer/api/pages/PagesModel.ts` | Update `addEmptyPageWithNavPanel` signature (async) |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Already complete from US-328 |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Already complete from US-328 |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | Already complete from US-328 |
| `src/renderer/editors/register-editors.ts` | Already registered from US-328 |
| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Already has headerRef from US-328 |
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | Already has headerRef from US-328 |
| `src/renderer/ui/navigation/LazySecondaryEditor.tsx` | Already passes headerRef from US-328 |
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Stays until Phase 4 |
| `src/renderer/editors/text/TextToolbar.tsx` | Callers don't change (toggleNavigator stays) |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Same |
| `src/renderer/editors/image/ImageViewer.tsx` | Same |
| `src/renderer/editors/category/CategoryEditor.tsx` | Same |
| `src/renderer/editors/zip/ZipEditorView.tsx` | Same |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | Already portals header from US-328 |
| `src/shared/types.ts` | No changes |
