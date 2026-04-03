# EPIC-019: Explorer as Secondary Editor + Multi-Panel Support

**Status:** Completed
**Created:** 2026-04-03
**Depends on:** EPIC-017 (completed)

## Overview

Refactor the Explorer (file tree + search) from a special-case sidebar managed by PageModel into a proper `ExplorerEditorModel` that lives in `secondaryEditors[]`. Extend `EditorModel.secondaryEditor` from `string` to `string[]` to support multi-panel editors (Explorer registers both "explorer" and "search" panels). This unifies sidebar panel management — PageModel becomes a pure orchestrator, and all panels use the same lifecycle, persistence, and rendering paths.

## Motivation

1. **Special-case complexity** — PageModel currently manages Explorer state directly: `treeProvider`, `selectionState`, `searchState`, `treeState`, `activePanel`. This is separate from the `secondaryEditors[]` path, creating two parallel management systems for sidebar panels.

2. **Explorer isn't always appropriate** — Currently Explorer is treated as "always present when sidebar exists." But for remote archives (`https://example.com/data.zip`), the Archive panel should appear without Explorer. Explorer should be created dynamically when a local root path can be detected.

3. **Shared selection doesn't work** — `selectionState` on PageModel is shared across all panels, but it doesn't work correctly (e.g., ZipSecondaryEditor doesn't highlight the clicked file). Each secondary editor should own its highlighting and react to `mainEditor` changes independently.

4. **Search is tightly coupled to Explorer** — Search lives as a sub-panel inside PageNavigator, coupled to the Explorer's tree provider. It should be a secondary panel of ExplorerEditorModel, reusing its search functionality.

## Target Architecture

### Multi-panel secondary editors

`EditorModel.secondaryEditor` changes from `string | undefined` to `string[] | undefined`. One editor model can register multiple sidebar panels. The `secondaryEditors[]` array on PageModel stays as `EditorModel[]` — no duplication. Each model appears once in the array but can render multiple panels.

```typescript
// Before: single panel
model.secondaryEditor = "zip-tree";

// After: multi-panel
model.secondaryEditor = ["zip-tree"];
// Explorer with search:
explorerModel.secondaryEditor = ["explorer"];
explorerModel.secondaryEditor = ["explorer", "search"];  // search opened
```

SecondaryEditorRegistry maps each panel ID to a React component. Rendering changes from:
```tsx
// Before: one panel per model
secondaryEditors.map(editor => <Panel id={editor.id} model={editor} panelId={editor.secondaryEditor} />)

// After: multiple panels per model
secondaryEditors.flatMap(editor =>
    editor.secondaryEditor.map(panelId => <Panel key={panelId} model={editor} panelId={panelId} />)
)
```

Each panel component receives the same model — the component decides what to render based on the `panelId`. Because the inner loop is per-model, all panels from the same model are naturally grouped together in the sidebar (Explorer + Search stay adjacent, ZipEditor panels stay adjacent, etc.).

### ExplorerEditorModel

A new `EditorModel` subclass that never becomes `mainEditor`. It owns:
- `treeProvider: FileTreeProvider` — the file tree
- `treeState: TreeProviderViewSavedState` — tree expansion state
- `searchState: FileSearchState` — search panel state
- Selection/highlighting — reacts to `onMainEditorChanged()` independently

Lifecycle:
- **Created dynamically** by PageModel when a local root path is detected (from mainEditor's file path or explicit folder open)
- **Survives navigation** — `beforeNavigateAway()` never clears `secondaryEditor` (Explorer is always-present once created)
- **Panels:** registers `["explorer"]` initially, adds `"search"` when search is opened
- **Dispose:** when page closes or Explorer is explicitly removed

### PageModel simplification

PageModel loses these fields (moved to ExplorerEditorModel):
- `treeProvider` → `ExplorerEditorModel.treeProvider`
- `selectionState` → each secondary editor manages its own
- `searchState` → `ExplorerEditorModel.searchState`
- `treeState` → `ExplorerEditorModel.treeState`
- `activePanel` → derived from which panels exist in `secondaryEditors[]`

PageModel keeps:
- `pageNavigatorModel` — pure layout container (open/close/width)
- `secondaryEditors[]` — all sidebar panels including Explorer
- `secondaryEditorsVersion` — reactivity counter
- Creation logic: detects when to create ExplorerEditorModel and adds it

### pageNavigatorModel

Becomes a pure layout container:
- `open: boolean` — sidebar visible/hidden
- `width: number` — sidebar width
- No rootPath, no navigation logic — that's ExplorerEditorModel's job

### Per-editor highlighting

Each secondary editor reacts to `onMainEditorChanged(newMainEditor)` and manages its own highlighting:
- `ExplorerEditorModel` — highlights file in tree if mainEditor has a local file path
- `ZipEditorModel` — highlights entry if mainEditor was opened from this archive (via `sourceLink.metadata.sourceId`)
- Future editors — same pattern

No shared `selectionState` on PageModel.

## Decisions

### A. secondaryEditor: string[] format
Array of panel IDs on each EditorModel. Each ID maps to a component in SecondaryEditorRegistry. Order in the array = order of panels in the sidebar (Explorer first, then Search, then other panels). The `secondaryEditors[]` array on PageModel remains `EditorModel[]` with no duplication — one model instance, multiple panels. The rendering loop nests: outer loop over models, inner loop over each model's panel IDs.

### B. Explorer creation trigger
PageModel creates ExplorerEditorModel when:
- `addEmptyPageWithNavPanel(folderPath)` — explicit folder open
- `navigatePageTo` / `openFile` — if mainEditor has a local file path and no Explorer exists yet
- `toggleNavigator()` — user clicks File Explorer button

PageModel does NOT create Explorer for:
- Remote URLs without local file backing
- Pages where sidebar only has Archive or other secondary editors

### C. Persistence format
ExplorerEditorModel saves/restores through the standard `secondaryEditors` persistence path (`SecondaryModelDescriptor[]`). No separate sidebar cache format. This is a breaking change — old sidebar cache is ignored (same approach as EPIC-017 Decision D).

### D. Search as secondary panel
Search is a panel ID (`"search"`) registered by ExplorerEditorModel. The search component receives the ExplorerEditorModel as its model and uses its tree provider and root path. Opening/closing search = adding/removing `"search"` from `secondaryEditor[]`.

## Resolved Concerns

### 1. `activePanel` fallback — RESOLVED: Track previous, fall back to first

No hardcoded `"explorer"` fallback. Track the previously expanded panel. When a panel is removed, expand the previous panel — if that doesn't exist, expand the first available panel from `secondaryEditors[].secondaryEditor[]`. In most cases Explorer will be the first panel and will expand naturally.

### 2. ScriptPanel direct state manipulation — RESOLVED: Use standard page-open flow

ScriptPanel's "Open in Script Panel Directory" should not directly manipulate `treeState`/`rootPath`. Instead, use the same logic as sidebar folder double-click or "Open in new Tab" context menu — open a new page with Explorer initialized to the proper root folder. No special ExplorerEditorModel interaction needed.

### 3. `toggleNavigator()` — RESOLVED: PageModel orchestrates

PageModel keeps `toggleNavigator(pipe)` as the single entry point. Toolbar buttons just call `page.toggleNavigator(pipe)`. Inside, PageModel orchestrates: finds or creates ExplorerEditorModel, initializes pageNavigatorModel for sidebar visibility. PageModel is the orchestrator — toolbars don't interact with ExplorerEditorModel directly.

### 4. `PageNavigatorModel` navigation methods — RESOLVED: Move to ExplorerEditorModel

`rootPath`, `navigateUp()`, `makeRoot()` move to ExplorerEditorModel. `reinitIfEmpty()` logic becomes `explorerModel.ensureRoot(pipe)` — called by PageModel's `toggleNavigator(pipe)` when the Explorer exists but has no root. PageNavigatorModel keeps only `open` and `width`.

### 5. `hasSidebar` — RESOLVED: `secondaryEditors.length > 0`

`hasSidebar` becomes `secondaryEditors.length > 0`. Adding any secondary editor (Explorer, Archive, etc.) automatically shows the sidebar. No explicit sidebar creation needed — the sidebar container (`pageNavigatorModel`) is created lazily when the first secondary editor is added.

### 6. Persistence format — RESOLVED: Simplified cache

New format: `{ open, width, expandedPanel, secondaryModelDescriptors[] }`. All Explorer fields (`rootPath`, `treeState`, `searchState`, `selectedHref`) move into ExplorerEditorModel's `getRestoreData()`/`applyRestoreData()`. `expandedPanel` preserves which panel was expanded across restarts. Breaking change — old cache format ignored.

### 7. `notifyMainEditorChanged()` — RESOLVED: Move to ExplorerEditorModel

Remove Explorer selection clearing from `PageModel.notifyMainEditorChanged()`. ExplorerEditorModel handles its own selection in `onMainEditorChanged()` — clears highlight when the new mainEditor wasn't opened from Explorer, highlights the file path when it was.

### 8. Panel ordering — RESOLVED: Creation order, no priority system

No sorting or priority mechanism. Panel order = `secondaryEditors[]` array order × each model's `secondaryEditor[]` panel order. Ensure ExplorerEditorModel is created first (before ZipEditorModel or other secondary editors) so Explorer panels appear at the top. If ordering issues arise later, revisit.

## Phased Implementation Plan

### Phase 1: Multi-Panel Support

Extend `secondaryEditor` to `string[]`. Update all consumers.

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1.1 | [US-327](../tasks/US-327-multi-panel-secondary-editor/README.md) Multi-panel secondaryEditor | Change `EditorModel.secondaryEditor` from `string` to `string[]`. Update getter/setter, PageModel add/remove logic, PageNavigator rendering (iterate panels per model), persistence (save/restore array), and all existing secondary editors (ZipEditorModel sets `["zip-tree"]`). | Done |

### Phase 2: ExplorerEditorModel

Extract Explorer state from PageModel into a new EditorModel subclass.

| # | Task | Description | Status |
|---|------|-------------|--------|
| 2.1 | [US-328](../tasks/US-328-create-explorer-editor-model/README.md) Create ExplorerEditorModel | New class with `treeProvider`, `treeState`, selection, search state. Registers `["explorer"]` panel. `beforeNavigateAway` keeps itself. Register "explorer" and "search" components in SecondaryEditorRegistry. Portal-based `headerRef` for panel headers. | Done |
| 2.2 | [US-329](../tasks/US-329-wire-pagemodel-to-explorer-editor-model/README.md) Wire PageModel to ExplorerEditorModel | PageModel creates ExplorerEditorModel dynamically, adds to `secondaryEditors[]`. Removed 6 Explorer fields + 6 methods from PageModel. PageNavigator rewritten. `alwaysRenderContent` + portal header timing fix. | Done |
| 2.3 | [US-330](../tasks/US-330-search-as-explorer-panel/README.md) Search as Explorer panel | Search panel expand/collapse via `expandSecondaryPanel` event. Persistence deferred to Phase 4. | Done |

### Phase 3: Per-Editor Highlighting

Remove shared `selectionState`. Each secondary editor manages its own.

| # | Task | Description | Status |
|---|------|-------------|--------|
| 3.1 | [US-331](../tasks/US-331-per-editor-highlighting/README.md) Per-editor highlighting | Added selectionState to ZipEditorModel, selectedHref in ZipSecondaryEditor. ExplorerEditorModel already done (US-328). selectionState removed from PageModel (US-329). | Done |

### Phase 4: Cleanup

| # | Task | Description | Status |
|---|------|-------------|--------|
| 4.1 | [US-332](../tasks/US-332-simplify-page-navigator-model/README.md) Simplify pageNavigatorModel | Removed rootPath, navigateUp, makeRoot, reinitIfEmpty, path import. Pure layout: open/close/width. | Done |
| 4.2 | [US-334](../tasks/US-334-explorer-search-state-persistence/README.md) Explorer/Search state persistence | Persist treeState, selectionState, searchState in ExplorerEditorModel's getRestoreData/applyRestoreData. | Done |
| 4.3 | [US-335](../tasks/US-335-update-documentation/README.md) Update documentation | Fixed pages-architecture.md, folder-structure.md, 6-page-architecture.mmd. All other docs current. | Done |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-327](../tasks/US-327-multi-panel-secondary-editor/README.md) | Multi-panel secondaryEditor | Done |
| [US-328](../tasks/US-328-create-explorer-editor-model/README.md) | Create ExplorerEditorModel | Done |
| [US-329](../tasks/US-329-wire-pagemodel-to-explorer-editor-model/README.md) | Wire PageModel to ExplorerEditorModel | Done |
| [US-330](../tasks/US-330-search-as-explorer-panel/README.md) | Search as Explorer panel | Done |
| [US-331](../tasks/US-331-per-editor-highlighting/README.md) | Per-editor highlighting | Done |
| [US-332](../tasks/US-332-simplify-page-navigator-model/README.md) | Simplify pageNavigatorModel | Done |
| [US-333](../tasks/US-333-replace-expand-panel-event/README.md) | Replace expandSecondaryPanel event with direct method | Done |
| [US-334](../tasks/US-334-explorer-search-state-persistence/README.md) | Explorer/Search state persistence | Done |
| [US-335](../tasks/US-335-update-documentation/README.md) | Update documentation | Done |
| [US-336](../tasks/US-336-improve-panel-highlighting/README.md) | Improve Explorer/Archive panel highlighting | Done |

## Notes

### 2026-04-03
- Epic created after completing EPIC-017 (Page/Editor Architecture Refactor)
- Motivated by the observation that Explorer is a special case in PageModel that could follow the same secondary editor pattern as ZipEditorModel
- Key insight: `secondaryEditor` needs to be `string[]` to support Explorer + Search as two panels from one model
- Breaking change: old sidebar cache format ignored on upgrade (same approach as EPIC-017)
- Each secondary editor owns its own highlighting — no shared selectionState
- Explorer is not "always present" — it's created dynamically when a local root path is available
