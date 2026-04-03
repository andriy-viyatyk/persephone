# US-328: Create ExplorerEditorModel

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 2, Task 2.1)

## Goal

Extract Explorer state from PageModel into a new `ExplorerEditorModel` class — an EditorModel subclass that lives in `secondaryEditors[]` and registers `["explorer"]` as its panel. Also add a portal-based header mechanism to `CollapsiblePanel` so secondary editor components can render their own title and buttons in the panel header. Fix the `_pendingActivePanel` bug introduced by US-327.

This is the first step of making Explorer a proper secondary editor; wiring PageModel to create it dynamically and removing the old fields is a separate task (US-329, Phase 2.2).

## Background

Currently PageModel directly owns 6 Explorer-related fields:

```
PageModel (current)
├── treeProvider: ITreeProvider | null          // FileTreeProvider
├── treeState: TreeProviderViewSavedState       // tree expansion state
├── selectionState: TOneState<NavigationState>  // { selectedHref }
├── searchState: FileSearchState | undefined    // search panel state
├── activePanel: string = "explorer"            // which panel is expanded
├── pageNavigatorModel: PageNavigatorModel      // open/close/width/rootPath
├── _rootPath: string                           // initial root path
└── (methods: toggleNavigator, canOpenNavigator, openSearch, closeSearch,
     setSearchState, setSelectedHref, setTreeState, setActivePanel,
     ensurePageNavigatorModel, restoreSidebar, _saveState)
```

After this task, `ExplorerEditorModel` will own the Explorer-specific state. PageModel will still own the fields until US-329 moves the creation logic and removes them.

### Key files

- **PageModel:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts) — current owner of all Explorer state
- **PageNavigatorModel:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../src/renderer/ui/navigation/PageNavigatorModel.ts) — sidebar state (open/width/rootPath + navigateUp/makeRoot)
- **PageNavigator.tsx:** [src/renderer/ui/navigation/PageNavigator.tsx](../../src/renderer/ui/navigation/PageNavigator.tsx) — Explorer + Search UI component
- **EditorModel base:** [src/renderer/editors/base/EditorModel.ts](../../src/renderer/editors/base/EditorModel.ts) — base class to extend
- **FileTreeProvider:** [src/renderer/content/tree-providers/FileTreeProvider.ts](../../src/renderer/content/tree-providers/FileTreeProvider.ts) — tree data source
- **SecondaryEditorRegistry:** [src/renderer/ui/navigation/secondary-editor-registry.ts](../../src/renderer/ui/navigation/secondary-editor-registry.ts) — panel ID → component mapping
- **register-editors.ts:** [src/renderer/editors/register-editors.ts](../../src/renderer/editors/register-editors.ts) — registration site
- **CollapsiblePanelStack:** [src/renderer/components/layout/CollapsiblePanelStack.tsx](../../src/renderer/components/layout/CollapsiblePanelStack.tsx) — panel header rendering
- **ZipEditorModel:** [src/renderer/editors/zip/ZipEditorModel.ts](../../src/renderer/editors/zip/ZipEditorModel.ts) — reference pattern for secondary editor

### Reference pattern: ZipEditorModel

ZipEditorModel is the existing secondary editor pattern to follow:
- Extends `EditorModel<ZipEditorModelState>`
- Owns `treeProvider: ZipTreeProvider | null`
- Sets `this.secondaryEditor = ["zip-tree"]` in `restore()` and `setPage()`
- Overrides `beforeNavigateAway()` — conditionally keeps itself
- Overrides `onMainEditorChanged()` — reacts to navigation
- Has `getRestoreData()` / `applyRestoreData()` for persistence

ExplorerEditorModel follows the same pattern but:
- Registers `["explorer"]` (and `["explorer", "search"]` when search is open)
- **Never** becomes `mainEditor` — only lives in `secondaryEditors[]`
- Survives all navigation (`beforeNavigateAway` is a no-op — Explorer stays)
- Owns its own selection highlighting (reacts to `onMainEditorChanged`)

### How CollapsiblePanel header rendering works today

`CollapsiblePanelStack` extracts props from `CollapsiblePanel` children and renders headers ([CollapsiblePanelStack.tsx:186-199](../../src/renderer/components/layout/CollapsiblePanelStack.tsx)):

```tsx
<div className="panel-header" onClick={() => handleToggle(panel.id)}>
    {!panel.buttons && (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />)}
    {panel.icon}
    {panel.title}
    {panel.buttons && (
        <>
            <span className="panel-spacer" />
            {panel.buttons}
        </>
    )}
</div>
```

When `buttons` is provided, chevron icons are hidden. When `title`/`buttons`/`icon` are all absent, only the click handler remains.

### How secondary panels are rendered today

In [PageNavigator.tsx:320-351](../../src/renderer/ui/navigation/PageNavigator.tsx), each secondary editor model produces a `CollapsiblePanel` with `title` from registry's `label` and `buttons` with a close button:

```tsx
secondaryEditors.flatMap((model) => {
    const panelIds = model.state.get().secondaryEditor;
    // ...
    return panelIds.map((panelId) => {
        const def = secondaryEditorRegistry.get(panelId);
        // ...
        return (
            <CollapsiblePanel
                key={`${model.id}-${panelId}`}
                id={panelId}
                title={def.label}
                buttons={panelButtons}
            >
                <LazySecondaryEditor model={model} editorId={panelId} />
            </CollapsiblePanel>
        );
    });
})
```

## Implementation Plan

### Step 1: Add `EditorType` for file-explorer

**File:** [src/shared/types.ts:1](../../src/shared/types.ts)

```typescript
// Before:
export type EditorType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage" | "zipFile";

// After:
export type EditorType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage" | "zipFile" | "fileExplorer";
```

### Step 2: Add `headerRef` portal to CollapsiblePanel

**File:** [src/renderer/components/layout/CollapsiblePanelStack.tsx](../../src/renderer/components/layout/CollapsiblePanelStack.tsx)

Add optional `headerRef` prop to `CollapsiblePanelProps`:

```typescript
// Before:
export interface CollapsiblePanelProps {
    id: string;
    title: ReactNode;
    children: ReactNode;
    icon?: ReactNode;
    buttons?: ReactNode;
}

// After:
export interface CollapsiblePanelProps {
    id: string;
    /** Panel header title. Omit when the child component portals its own header via headerRef. */
    title?: ReactNode;
    children: ReactNode;
    icon?: ReactNode;
    /** Action buttons at the right of the header. Omit when child portals via headerRef. */
    buttons?: ReactNode;
    /** Ref callback for the header container — child components can portal content here. */
    headerRef?: (el: HTMLDivElement | null) => void;
}
```

Update the header rendering in `CollapsiblePanelStack` to extract and pass `headerRef`, and render nothing in the header when `title`, `buttons`, and `icon` are all absent (the portal will fill it):

```tsx
// In CollapsiblePanelStack, update the panels extraction (line 140):
const panels: {
    id: string; title: ReactNode; content: ReactNode;
    icon?: ReactNode; buttons?: ReactNode;
    headerRef?: (el: HTMLDivElement | null) => void;
}[] = [];

Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === CollapsiblePanel) {
        const { id, title, children: content, icon, buttons, headerRef } = child.props as CollapsiblePanelProps;
        panels.push({ id, title, content, icon, buttons, headerRef });
    }
});

// In the render (line 186-199), pass headerRef and handle empty header:
<div
    className="panel-header"
    ref={panel.headerRef}
    onClick={() => handleToggle(panel.id)}
>
    {!panel.headerRef && !panel.buttons && (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />)}
    {panel.icon}
    {panel.title}
    {panel.buttons && (
        <>
            <span className="panel-spacer" />
            {panel.buttons}
        </>
    )}
</div>
```

When `headerRef` is provided and `title`/`buttons`/`icon` are omitted, the header div is empty — the secondary editor component portals its content there.

### Step 3: Update SecondaryEditorProps to include headerRef

**File:** [src/renderer/ui/navigation/secondary-editor-registry.ts](../../src/renderer/ui/navigation/secondary-editor-registry.ts)

```typescript
// Before:
export interface SecondaryEditorProps {
    model: EditorModel;
}

// After:
export interface SecondaryEditorProps {
    model: EditorModel;
    /** Portal target for the panel header. Render title, buttons, etc. into this element. */
    headerRef: HTMLDivElement | null;
}
```

### Step 4: Update LazySecondaryEditor to accept and pass headerRef

**File:** [src/renderer/ui/navigation/LazySecondaryEditor.tsx](../../src/renderer/ui/navigation/LazySecondaryEditor.tsx)

Add `headerRef` prop and pass it to the loaded component:

```typescript
interface LazySecondaryEditorProps {
    model: EditorModel;
    editorId: string;
    headerRef: HTMLDivElement | null;  // Add
}

// In render, pass headerRef to the component:
<Component model={model} headerRef={headerRef} />
```

### Step 5: Update PageNavigator secondary panel rendering

**File:** [src/renderer/ui/navigation/PageNavigator.tsx:320-351](../../src/renderer/ui/navigation/PageNavigator.tsx)

Use a `headerRefs` ref to track header elements per panel, and pass them through:

```tsx
// Add at component top:
const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});

// Update secondary editor rendering:
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
```

Note: `title` and `buttons` are no longer passed from PageNavigator — the secondary editor component portals them. The `label` from `SecondaryEditorDefinition` becomes a fallback only (not used for portaled panels).

### Step 6: Update ZipSecondaryEditor to portal its header

**File:** `src/renderer/editors/zip/ZipSecondaryEditor.tsx` (or similar)

The existing ZipSecondaryEditor needs to portal its title ("Archive") and close button into the header. Read the file first to understand its current structure, then add:

```tsx
import { createPortal } from "react-dom";

export default function ZipSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    // ... existing content ...

    // Portal header content
    const isActivePagePanel = model === model.page?.mainEditor;
    const headerContent = (
        <>
            Archive
            <span style={{ flex: "1 1 auto" }} />
            {!isActivePagePanel && (
                <Button type="icon" size="small" title="Close"
                    onClick={(e) => { e.stopPropagation(); model.page?.removeSecondaryEditor(model); }}>
                    <CloseIcon width={14} height={14} />
                </Button>
            )}
        </>
    );

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            {/* ... existing tree content ... */}
        </>
    );
}
```

### Step 7: Create ExplorerEditorModel class

**New file:** `src/renderer/editors/explorer/ExplorerEditorModel.ts`

```typescript
import { TComponentState, TOneState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ITreeProvider } from "../../api/types/io.tree";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import type { NavigationState } from "../../api/pages/PageModel";

export interface ExplorerEditorModelState extends IEditorState {
    type: "fileExplorer";
    /** Root path for the file tree. */
    rootPath: string;
}

export function getDefaultExplorerEditorModelState(): ExplorerEditorModelState {
    return {
        ...getDefaultEditorModelState(),
        type: "fileExplorer",
        title: "Explorer",
        rootPath: "",
    } as ExplorerEditorModelState;
}

export class ExplorerEditorModel extends EditorModel<ExplorerEditorModelState> {
    /** File tree data source. Created lazily when rootPath is available. */
    treeProvider: ITreeProvider | null = null;

    /** Tree expansion state — persisted, restored from cache. */
    treeState: TreeProviderViewSavedState | undefined = undefined;

    /** Selection state — reactive. Explorer component subscribes for highlight. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    /** Search panel state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    constructor(rootPath?: string) {
        super(new TComponentState(getDefaultExplorerEditorModelState()));
        this.noLanguage = true;
        this.skipSave = true;  // Explorer has no file content to save
        if (rootPath) {
            this.state.update((s) => { s.rootPath = rootPath; });
        }
    }

    get rootPath(): string {
        return this.state.get().rootPath;
    }

    // ── Selection ────────────────────────────────────────────────────

    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
    }

    // ── Tree state ───────────────────────────────────────────────────

    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
    }

    // ── Search ───────────────────────────────────────────────────────

    openSearch(folder?: string): void {
        const rootPath = this.rootPath;
        const searchFolder = folder || rootPath;
        if (!this.searchState || (folder && this.searchState.searchFolder !== folder)) {
            this.searchState = {
                query: this.searchState?.query ?? "",
                includePattern: this.searchState?.includePattern ?? "",
                excludePattern: this.searchState?.excludePattern ?? "",
                showFilters: this.searchState?.showFilters ?? false,
                searchFolder,
                results: [],
                totalMatches: 0,
                totalFiles: 0,
            };
        }
        // Add "search" to panel list if not already present
        if (!this.secondaryEditor?.includes("search")) {
            this.secondaryEditor = ["explorer", "search"];
        }
    }

    closeSearch(): void {
        this.searchState = undefined;
        // Remove "search" from panel list
        if (this.secondaryEditor?.includes("search")) {
            this.secondaryEditor = ["explorer"];
        }
    }

    setSearchState = (state: FileSearchState): void => {
        this.searchState = state;
    };

    // ── Root navigation ──────────────────────────────────────────────

    navigateUp(): void {
        const { fpDirname } = require("../../core/utils/file-path");
        const rootPath = this.rootPath;
        const parent = fpDirname(rootPath);
        if (parent === rootPath) return;
        this.treeState = undefined;
        this.state.update((s) => { s.rootPath = parent; });
    }

    makeRoot(newRoot: string): void {
        if (newRoot.toLowerCase() === this.rootPath.toLowerCase()) return;
        this.treeState = undefined;
        this.state.update((s) => { s.rootPath = newRoot; });
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    /** Explorer never navigates away — always survives as secondary. */
    beforeNavigateAway(_newModel: EditorModel): void {
        // No-op: Explorer always stays
    }

    /** React to main editor changes — clear selection when not from Explorer. */
    onMainEditorChanged(newMainEditor: EditorModel | null): void {
        const sourceId = newMainEditor?.state.get().sourceLink?.metadata?.sourceId;
        if (sourceId !== "explorer") {
            this.selectionState.update((s) => { s.selectedHref = null; });
        }
    }

    // ── Persistence ──────────────────────────────────────────────────

    getRestoreData(): Partial<ExplorerEditorModelState> {
        return {
            ...super.getRestoreData(),
            rootPath: this.rootPath,
        };
    }

    applyRestoreData(data: Partial<ExplorerEditorModelState>): void {
        super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.rootPath) {
            this.state.update((s) => { s.rootPath = data.rootPath!; });
        }
    }

    async restore(): Promise<void> {
        await super.restore();
        if (this.rootPath && this.page) {
            this.secondaryEditor = this.searchState
                ? ["explorer", "search"]
                : ["explorer"];
        }
    }

    setPage(page: import("../../api/pages/PageModel").PageModel | null): void {
        super.setPage(page);
        if (page && this.rootPath && !this.secondaryEditor?.length) {
            this.secondaryEditor = this.searchState
                ? ["explorer", "search"]
                : ["explorer"];
        }
    }

    async dispose(): Promise<void> {
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        await super.dispose();
    }
}
```

### Step 8: Create ExplorerSecondaryEditor component

**New file:** `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx`

This component renders the Explorer tree view and portals its header (title + buttons) into the CollapsiblePanel header via `headerRef`.

```tsx
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { RawLinkEvent, ContextMenuEvent } from "../../api/events/events";
import { app } from "../../api/app";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ExplorerEditorModel } from "./ExplorerEditorModel";
import { Button } from "../../components/basic/Button";
import {
    CollapseAllIcon,
    FolderUpIcon,
    RefreshIcon,
    SearchIcon,
    CloseIcon,
} from "../../theme/icons";
import { fpBasename, fpDirname } from "../../core/utils/file-path";

export default function ExplorerSecondaryEditor({ model: rawModel, headerRef }: SecondaryEditorProps) {
    const model = rawModel as ExplorerEditorModel;
    const rootPath = model.rootPath;
    const treeProviderRef = useRef<TreeProviderViewRef>(null);

    // Create/update FileTreeProvider
    const provider = useMemo(() => {
        if (!rootPath) return null;
        if (model.treeProvider && (model.treeProvider as FileTreeProvider).sourceUrl !== rootPath) {
            model.treeProvider.dispose?.();
            model.treeProvider = null;
        }
        if (!model.treeProvider) {
            model.treeProvider = new FileTreeProvider(rootPath);
        }
        return model.treeProvider;
    }, [rootPath, model]);

    const initialState = useMemo((): TreeProviderViewSavedState | undefined => {
        return model.treeState;
    }, []); // Only on mount

    const { selectedHref } = model.selectionState.use();

    useEffect(() => {
        if (selectedHref) {
            treeProviderRef.current?.revealItem(selectedHref);
        }
    }, [selectedHref]);

    const pageId = model.page?.id ?? "";

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const current = model.selectionState.get().selectedHref;
        if (current?.toLowerCase() === item.href.toLowerCase()) return;
        model.setSelectedHref(item.href);
        const url = model.treeProvider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url,
            undefined,
            { pageId, sourceId: "explorer" },
        ));
    }, [pageId, model]);

    const handleStateChange = useCallback((state: TreeProviderViewSavedState) => {
        model.setTreeState(state);
    }, [model]);

    const handleContextMenu = useCallback((event: ContextMenuEvent<ITreeProviderItem>) => {
        const item = event.target;
        if (item?.isDirectory && provider?.navigable) {
            const rootLower = rootPath.toLowerCase();
            if (item.href.toLowerCase() !== rootLower) {
                event.items.push({
                    startGroup: true,
                    label: "Make Root",
                    onClick: () => model.makeRoot(item.href),
                });
            }
            event.items.push({
                label: "Search in Folder",
                icon: <SearchIcon width={14} height={14} />,
                onClick: () => model.openSearch(item.href),
            });
        }
    }, [provider, rootPath, model]);

    // ── Header buttons ──────────────────────────────────────────────

    const parentPath = fpDirname(rootPath);
    const canNavigateUp = parentPath !== rootPath && rootPath !== "";

    const headerContent = (
        <>
            Explorer
            <span className="panel-spacer" />
            {provider?.navigable && (
                <Button type="icon" size="small"
                    title={canNavigateUp ? `Up to ${fpBasename(parentPath)}` : "Already at root"}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.navigateUp(); }}
                    disabled={!canNavigateUp}
                >
                    <FolderUpIcon width={14} height={14} />
                </Button>
            )}
            <Button type="icon" size="small" title="Search"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.openSearch(); }}>
                <SearchIcon width={14} height={14} />
            </Button>
            <Button type="icon" size="small" title="Collapse All"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); treeProviderRef.current?.collapseAll(); }}>
                <CollapseAllIcon width={14} height={14} />
            </Button>
            <Button type="icon" size="small" title="Refresh"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); treeProviderRef.current?.refresh(); }}>
                <RefreshIcon width={14} height={14} />
            </Button>
            <Button type="icon" size="small" title="Close Panel"
                onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    // Close the sidebar — TODO: will be wired in US-329
                    model.page?.pageNavigatorModel?.close();
                }}>
                <CloseIcon width={14} height={14} />
            </Button>
        </>
    );

    if (!provider) return null;

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            <TreeProviderView
                ref={treeProviderRef}
                key={rootPath}
                provider={provider}
                selectedHref={selectedHref ?? undefined}
                onItemClick={handleItemClick}
                onItemDoubleClick={handleItemClick}
                onContextMenu={handleContextMenu}
                initialState={initialState}
                onStateChange={handleStateChange}
            />
        </>
    );
}
```

### Step 9: Create SearchSecondaryEditor component

**New file:** `src/renderer/editors/explorer/SearchSecondaryEditor.tsx`

Portals "Search [folder]" title + close button into the header, renders FileSearch as content.

```tsx
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { FileSearch } from "../../components/file-search";
import { RawLinkEvent } from "../../api/events/events";
import { app } from "../../api/app";
import type { ILinkMetadata } from "../../api/types/io.events";
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ExplorerEditorModel } from "./ExplorerEditorModel";
import { Button } from "../../components/basic/Button";
import { CloseIcon } from "../../theme/icons";
import { fpBasename } from "../../core/utils/file-path";

export default function SearchSecondaryEditor({ model: rawModel, headerRef }: SecondaryEditorProps) {
    const model = rawModel as ExplorerEditorModel;
    const rootPath = model.rootPath;
    const pageId = model.page?.id ?? "";

    const searchFolder = model.searchState?.searchFolder || rootPath;
    const searchFolderName = fpBasename(searchFolder);

    const handleSearchResultClick = useCallback((filePath: string, lineNumber?: number) => {
        model.setSelectedHref(filePath);
        const metadata: ILinkMetadata = { pageId };
        if (lineNumber) {
            metadata.revealLine = lineNumber;
            metadata.highlightText = model.searchState?.query;
        }
        app.events.openRawLink.sendAsync(new RawLinkEvent(filePath, undefined, metadata));
    }, [pageId, model]);

    const headerContent = (
        <>
            <span title={searchFolder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Search [{searchFolderName}]
            </span>
            <span className="panel-spacer" />
            <Button type="icon" size="small" title="Close Search"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.closeSearch(); }}>
                <CloseIcon width={14} height={14} />
            </Button>
        </>
    );

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            <FileSearch
                folder={rootPath}
                state={model.searchState}
                onStateChange={model.setSearchState}
                onResultClick={handleSearchResultClick}
            />
        </>
    );
}
```

### Step 10: Create barrel export

**New file:** `src/renderer/editors/explorer/index.ts`

```typescript
export { ExplorerEditorModel, getDefaultExplorerEditorModelState } from "./ExplorerEditorModel";
export type { ExplorerEditorModelState } from "./ExplorerEditorModel";
```

### Step 11: Register "explorer" and "search" in SecondaryEditorRegistry

**File:** [src/renderer/editors/register-editors.ts](../../src/renderer/editors/register-editors.ts) — add after the "zip-tree" registration (line 654):

```typescript
secondaryEditorRegistry.register({
    id: "explorer",
    label: "Explorer",
    loadComponent: () => import("./explorer/ExplorerSecondaryEditor"),
});

secondaryEditorRegistry.register({
    id: "search",
    label: "Search",
    loadComponent: () => import("./explorer/SearchSecondaryEditor"),
});
```

### Step 12: Fix `_pendingActivePanel` bug (US-327 regression)

**File:** [src/renderer/api/pages/PageModel.ts:470](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
const modelExists = this.secondaryEditors.some((m) => m.id === this._pendingActivePanel);
if (modelExists) {

// After:
const panelExists = this.secondaryEditors.some(
    (m) => m.secondaryEditor?.includes(this._pendingActivePanel!)
);
if (panelExists) {
```

This fixes the deferred activePanel restore. After US-327, `activePanel` stores panel IDs (like `"zip-tree"`), not model IDs. The old check `m.id === panelId` always failed because model IDs are UUIDs.

## What This Task Does NOT Do

This task creates ExplorerEditorModel, the portal header mechanism, and the secondary editor components. It does **not**:

- Wire PageModel to create ExplorerEditorModel (that's US-329, Phase 2.2)
- Remove Explorer state from PageModel (that's US-329, Phase 2.2)
- Change the Explorer/Search panels in PageNavigator.tsx to use ExplorerEditorModel (that's US-329, Phase 2.2)
- Simplify PageNavigatorModel (that's Phase 4)
- Implement per-editor highlighting for ZipEditorModel (that's Phase 3)

After this task, ExplorerEditorModel and the portal mechanism exist and are registered, but aren't used at runtime until US-329 wires them in.

## Resolved Concerns

### 1. Explorer panel buttons — RESOLVED: Portal-based header rendering

The CollapsiblePanel gets a `headerRef` callback prop. The panel header div is passed via ref to the secondary editor component, which uses `createPortal()` to render its title, buttons, and icons into the header. No mini toolbars — the header looks exactly like today, but content comes from the component.

### 2. `type: "textFile"` for Explorer — RESOLVED: Add `"fileExplorer"` EditorType

A dedicated `"fileExplorer"` type is clearer. The unused type doesn't cause problems — no switch statements need updating because ExplorerEditorModel never becomes mainEditor (so it's never resolved by the editor registry).

### 3. Search panel close — RESOLVED: SearchSecondaryEditor portals its own close button

The SearchSecondaryEditor portals a close button into its header. Clicking it calls `model.closeSearch()` which removes `"search"` from `secondaryEditor[]` — the panel disappears. Simple, self-contained.

### 4. `_pendingActivePanel` uses model ID, not panel ID — RESOLVED: Fix in this task

Bug from US-327. The check `m.id === this._pendingActivePanel` compares UUID model IDs against panel IDs like `"zip-tree"`. Fixed to use `m.secondaryEditor?.includes(panelId)`.

## Acceptance Criteria

- [ ] `"fileExplorer"` added to `EditorType` union
- [ ] `CollapsiblePanel` supports `headerRef` prop; header renders empty when title/buttons/icon absent
- [ ] `SecondaryEditorProps` includes `headerRef: HTMLDivElement | null`
- [ ] `LazySecondaryEditor` passes `headerRef` to loaded component
- [ ] PageNavigator passes `headerRef` to secondary editor panels (no more `title`/`buttons` from PageNavigator)
- [ ] ZipSecondaryEditor portals its header content (title + close button)
- [ ] `ExplorerEditorModel` class exists in `src/renderer/editors/explorer/`
- [ ] Owns `treeProvider`, `treeState`, `selectionState`, `searchState`
- [ ] Has `openSearch()` / `closeSearch()` that modify `secondaryEditor[]` array
- [ ] Has `navigateUp()` / `makeRoot()` for root navigation
- [ ] `beforeNavigateAway()` is a no-op (Explorer always survives)
- [ ] `onMainEditorChanged()` clears selection when not from Explorer
- [ ] `"explorer"` and `"search"` registered in SecondaryEditorRegistry
- [ ] `ExplorerSecondaryEditor` portals header (title + 5 buttons) and renders TreeProviderView
- [ ] `SearchSecondaryEditor` portals header (title + close) and renders FileSearch
- [ ] `_pendingActivePanel` bug fixed — uses panel ID check
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `"fileExplorer"` to EditorType |
| `src/renderer/components/layout/CollapsiblePanelStack.tsx` | Add `headerRef` prop, pass ref to header div |
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | Add `headerRef` to SecondaryEditorProps |
| `src/renderer/ui/navigation/LazySecondaryEditor.tsx` | Accept and pass `headerRef` |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Use `headerRefs` for secondary panels, remove inline title/buttons |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | Portal header content via headerRef |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | **New** — ExplorerEditorModel class |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | **New** — Explorer tree panel with portaled header |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | **New** — Search panel with portaled header |
| `src/renderer/editors/explorer/index.ts` | **New** — barrel export |
| `src/renderer/editors/register-editors.ts` | Register "explorer" and "search" panels |
| `src/renderer/api/pages/PageModel.ts` | Fix `_pendingActivePanel` panel ID check (line 470) |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Stays until Phase 4 |
| `src/renderer/editors/base/EditorModel.ts` | No changes needed |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | No wiring yet (US-329) |
| `src/renderer/api/pages/PagesQueryModel.ts` | No changes needed |
