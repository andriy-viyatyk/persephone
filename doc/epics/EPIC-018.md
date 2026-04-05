# EPIC-018: Secondary Editors — Content Applications

**Status:** Future
**Created:** 2026-04-02
**Updated:** 2026-04-04
**Depends on:** EPIC-016 (completed), EPIC-017 (completed), EPIC-019 (completed)

## Overview

Build concrete secondary editor applications on top of the infrastructure established in EPIC-016/017/019. The centerpiece is refactoring the Link editor so its sidebar panels (Categories, Tags, Hostnames) become secondary editors in `PageNavigator`, while its center area uses `CategoryView` — the same component that powers Explorer's folder view. This validates the "Everything is a Link" vision from EPIC-015: any `ITreeProvider` can render items as a list or tiles, whether backed by a file system, ZIP archive, or `.link.json` collection.

Additional goals include Browser bookmarks integration, archive format expansion, and new secondary editor types.

## "Everything is a Link" Vision

EPIC-012 established the 3-layer link pipeline: **parse → resolve → open**. EPIC-015 introduced `ITreeProvider` with `ITreeProviderItem` — a universal entry type compatible with `LinkItem`. EPIC-019 unified sidebar panels via `secondaryEditors[]` with multi-panel support.

The remaining piece: **CategoryView needs tile rendering** so it can display image previews for local files and link thumbnails for bookmarks. Once CategoryView supports tiles, the same component works everywhere:

| Use case | Provider | View mode |
|----------|----------|-----------|
| Explorer folder → click folder | `FileTreeProvider` | List (default), tiles for image folders |
| Archive → click folder | `ZipTreeProvider` | List |
| Link collection → click category | `LinkTreeProvider` | List or tiles (per-category preference) |
| Browser bookmarks → click folder | `LinkTreeProvider` | List or tiles |

All items are `ITreeProviderItem`. All navigation goes through `openRawLink`. CategoryView is the universal content viewer.

### Link collections as general-purpose infrastructure

The key motivation for putting Link panels into PageNavigator is that **link collections become reusable infrastructure**, not just a standalone editor feature. A `TextFileModel` can be created programmatically with `.link.json` content and opened as a new page showing the Categories panel in the sidebar. This enables:

- **Multi-file drop** — user drops files onto the app → TextFileModel created with link collection content → new page opens with Categories panel → user clicks through files one by one
- **AI agent results** — user asks the AI agent "show me files where ..." → agent searches/analyzes/prepares file list → shows a new Persephone page with Categories panel containing all matching files
- **Script output** — a script collects files/links → creates a link collection page → Categories panel shows results

In all these cases, the main content area shows whatever the user clicks on (text file, image, etc.), while the Categories panel in the sidebar provides navigation through the collection. No temp file needed — TextFileModel's unsaved-content cache handles persistence (see Decision K).

## Design Decisions

### A. CategoryView as universal content viewer

CategoryView currently renders only "list" mode. It already has `viewMode` prop and `CategoryViewMode` type with tile variants defined. Implementation adds tile rendering using a new `ItemTile` component.

CategoryView becomes a **controlled component** for state that parents need to persist:

```typescript
interface CategoryViewProps {
    provider: ITreeProvider;
    category: string;
    viewMode?: CategoryViewMode;          // controlled by parent
    onViewModeChange?: (mode) => void;    // parent persists
    selectedHref?: string;
    // ... click handlers, toolbar portal
}
```

The parent component (LinkEditor, CategoryEditor) owns the view mode and can save/restore it. CategoryView only renders — it doesn't persist anything.

### B. `imgSrc` on ITreeProviderItem

Add `imgSrc?: string` to `ITreeProviderItem`. Populated by:
- `FileTreeProvider` — auto-set to `item.href` when file is an image (by extension)
- `LinkTreeProvider` — from `LinkItem.imgSrc` (user-set preview image URL)
- `ZipTreeProvider` — could auto-set for image entries (future)

The `ItemTile` component renders:
1. `imgSrc` if present → show image
2. Item href is HTTP → show favicon (reuse favicon-cache, moved to shared location)
3. Fallback → file-type icon (same as list mode)

### C. Per-folder view mode persistence (Explorer)

When CategoryEditor shows a folder from Explorer, the view mode per folder path is persisted in a simple user-data file: `<persephone-user-folder>/data/folderViewMode.json` (or `.txt` with `path:mode` lines). This allows users to set "tiles" for an image folder and have it remembered.

### D. LinkEditor stays as main editor — no separate LinksEditorModel

**Key decision:** LinkEditor is NOT replaced by a new EditorModel. Instead:

- `TextFileModel` remains the main editor for `.link.json` files (unchanged)
- `LinkViewModel` (ContentViewModel) keeps all existing functionality
- `LinkViewModel` gains a `treeProvider: LinkTreeProvider` property — thin adapter over its internal state
- The **LinkEditor React component** is refactored to use CategoryView for center area and to register/unregister secondary editors based on context

This approach:
- Preserves all existing LinkEditor functionality (Browser integration, encryption, mode switching)
- Avoids duplicating state between LinkViewModel and a hypothetical LinksEditorModel
- Keeps the Browser context working identically to today

### E. LinkEditor renders in two contexts

The LinkEditor component detects its context and adapts layout:

**Browser context** (no `model.page`) — self-contained:
```
┌──────────┬──────────────────────┬──────────┐
│Categories│                      │  Pinned  │
│──────────│    CategoryView      │  Panel   │
│Tags      │   (list or tiles)    │          │
│──────────│                      │          │
│Hostnames │                      │          │
└──────────┴──────────────────────┴──────────┘
```

**Page context, PageNavigator open** — panels move to sidebar:
```
PageNavigator          │  Main Content Area
┌──────────────┐       │  ┌──────────────────────────────┐
│ Explorer     │       │  │                              │
│──────────────│       │  │     CategoryView      Pinned │
│ Categories   │       │  │    (list or tiles)    Panel  │
│──────────────│       │  │                              │
│ Tags         │       │  │                              │
│──────────────│       │  │                              │
│ Hostnames    │       │  └──────────────────────────────┘
└──────────────┘       │  (left panel hidden)
```

**Page context, PageNavigator closed** — same as Browser:
```
┌──────────┬──────────────────────┬──────────┐
│Categories│                      │  Pinned  │
│──────────│    CategoryView      │  Panel   │
│Tags      │   (list or tiles)    │          │
│──────────│                      │          │
│Hostnames │                      │          │
└──────────┴──────────────────────┴──────────┘
```

**JSON mode** (user switches to Monaco) — no panels at all:
```
┌────────────────────────────────────────────┐
│              Monaco Editor                  │
│            (plain JSON text)                │
└────────────────────────────────────────────┘
```
Secondary editors are removed from PageNavigator when switching to JSON mode.

### F. Secondary panels managed externally — no logic in TextFileModel

**Key principle:** TextFileModel has NO knowledge of link panels. The `secondaryEditor` property on TextFileModel is set by **external code** — either the LinkEditor React component or programmatic callers (scripts, drop handlers).

**How it works:**
- `TextFileModel` extends `EditorModel` which has the `secondaryEditor` setter — this is generic infrastructure, not link-specific
- When external code sets `model.secondaryEditor = ["link-category", ...]`, the setter calls `page.addSecondaryEditor(this)`, making TextFileModel both mainEditor and a secondary editor (Pattern B from [secondary-editors.md](doc/architecture/secondary-editors.md))
- PageNavigator renders panels for each `secondaryEditor` entry — the panel components receive `TextFileModel` as model
- Panel wrapper components call `useContentViewModel(model, "link-view")` to acquire the shared `LinkViewModel` instance (ref-counted)

**Who sets secondaryEditor:**

1. **LinkEditor React component** (normal `.link.json` browsing):
```
LinkEditor mounts (page context):
  → model.secondaryEditor = ["link-category", "link-tags"?, "link-hostnames"?]
  → page.expandPanel("link-category")

LinkEditor unmounts (or user switches to JSON mode):
  → model.secondaryEditor = undefined
  → panels removed from PageNavigator

Data changes (tags appear/disappear):
  → LinkEditor updates model.secondaryEditor array
```

2. **Programmatic callers** (multi-file drop, scripts, AI agent):
```
Create TextFileModel with .link.json content (modified: true)
  → model.secondaryEditor = ["link-category"]
  → open as new page with Categories panel expanded
```

In both cases, TextFileModel is unaware — it's just an EditorModel whose `secondaryEditor` property happens to be set.

**Panel wrapper pattern:**
```tsx
// Registered in secondary-editor-registry for "link-category"
function LinkCategoryWrapper({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    if (!vm) return null;
    return <LinkCategoryPanel vm={vm} headerRef={headerRef} />;
}
```

**Panel components are shared** between inline (Browser / navigator closed) and PageNavigator contexts. The same `LinkCategoryPanel`, `LinkTagsPanel`, `LinkHostnamesPanel` render in both places. When inline, they render inside LinkEditor's `CollapsiblePanelStack`. When in PageNavigator, they render as secondary editor panels with portal-based headers.

### G. Conditional panel visibility

Tags and Hostnames panels are shown only when relevant data exists:
- **"link-tags"** panel — visible when `LinkViewModel` data has any items with non-empty `tags[]`
- **"link-hostnames"** panel — visible when `LinkViewModel` data has any HTTP links

This applies in both contexts:
- **PageNavigator**: `model.secondaryEditor[]` array includes/excludes panel IDs based on data
- **Inline left panel**: same check — `model.secondaryEditor?.includes("link-tags")` controls rendering

If a `.link.json` file contains only local file paths with no tags, only the Categories panel is visible.

### H. Auto-expand on mount

When LinkEditor mounts in page context with PageNavigator open:
- Call `page.expandPanel("link-category")` to auto-expand the Categories panel
- This ensures the user immediately sees the relevant panel without searching for it
- After initial expansion, user is free to expand/collapse any panel

### I. Encrypted link files

`TextFileModel` already handles encryption via its content pipe (decrypt transformer). `LinkViewModel` receives the decrypted JSON content through the existing `onContentChanged()` flow — no separate decrypt handling needed.

### J. Link navigation through openRawLink

All link clicks from CategoryView go through `openRawLink` pipeline:
- HTTP links open in browser
- Local file paths open in appropriate editor
- Archive paths (`file.zip!entry`) open with archive handling
- cURL commands open as REST client requests

Since `openRawLink` handles any link type, `.link.json` collections can contain:
- HTTP/HTTPS URLs (traditional bookmarks)
- Local file paths (`C:\data\report.csv`)
- Archive entries (`C:\docs.zip!readme.txt`)
- cURL commands
- `tree-category://` links (folder navigation)

### K. Standalone link collections (programmatic creation)

For programmatic link collections (multi-file drop, AI agent results, script output):
- Create a `TextFileModel` with `language: "json"`, `title: "something.link.json"`, and the `.link.json` content
- Set `modified: true` — the existing cache mechanism automatically persists unsaved content, no temp file creation needed
- Set `secondaryEditor = ["link-category"]` — this adds the model to `PageModel.secondaryEditors[]`
- Open as a new page with Categories panel auto-expanded
- The content detection system auto-detects `link-view` mode → LinkEditor renders as main content with Categories panel in PageNavigator

No special temp-file logic required — TextFileModel's existing unsaved-content cache handles persistence.

**Open question for Phase 2:** When user clicks a link in the Categories panel, the page navigates to the clicked file. The original TextFileModel's `beforeNavigateAway()` clears `secondaryEditor` → panels disappear. But for standalone collections, the Categories panel should **survive navigation** (like ZipEditorModel's Archive panel survives when browsing archive entries). This likely requires TextFileModel to override `beforeNavigateAway()` — checking whether the new editor was opened from this collection via `sourceLink.metadata.sourceId`. Exact design to be resolved during Phase 2 task 2.2.

## Resolved Concerns

### 1. MainEditor in secondaryEditors[] — existing pattern, no guards needed

This is **not a new pattern** — `ZipEditorModel` already works this way. When a `.zip` file is opened, ZipEditorModel is both `mainEditor` and in `secondaryEditors[]` (shows "Archive" panel). PageModel is designed for this:

- **`setMainEditor()`** — calls `beforeNavigateAway()` on old mainEditor. If it clears `secondaryEditor`, it's removed. If not, it survives as secondary (line 126: `survivesAsSecondary = this.secondaryEditors.includes(oldEditor)`).
- **`notifyMainEditorChanged()`** — ZipEditorModel guards with `if (newMainEditor === this) return;`. TextFileModel doesn't override this (base is a no-op), so also safe.
- **`confirmSecondaryRelease()`** — checks `model.modified`. After first prompt, modified becomes false, so second check in `close()` is a no-op.
- **`dispose()`** — double-calls dispose on models in both arrays. Existing behavior with ZipEditorModel. EditorModel.dispose() is safe to call twice (pipe already null on second call).
- **Persistence** — `restoreSecondaryEditors()` has deduplication at line 390 (`desc.pageState.id === ownerEditor.id`).

No PageModel changes needed.

### 2. Mode switch (link-view → JSON) panel cleanup

When user switches to JSON mode, LinkEditor component unmounts. The `useEffect` cleanup clears `model.secondaryEditor = undefined` to remove panels from PageNavigator. Standard React lifecycle.

### 3. beforeNavigateAway and page navigation

Base `EditorModel.beforeNavigateAway()` clears `this.secondaryEditor = undefined`. When user navigates to a different file, link panels disappear. This is correct — panels are re-created when LinkEditor mounts for the next `.link.json` file.

TextFileModel could override `beforeNavigateAway` to keep panels alive (like ZipEditorModel does for archive entries), but for now the default behavior is what we want.

### 4. Persistence — transient panels

Link panels are transient — created by LinkEditor on mount, removed on unmount. On app restart, when `.link.json` restores and LinkEditor mounts, panels are re-created automatically. The sidebar cache will save TextFileModel as a secondary descriptor (same as ZipEditorModel), and `restoreSecondaryEditors()` deduplication handles it.

## Phases

### Phase 0: CategoryView Enhancement

Enhance CategoryView with tile rendering and externalized state. Test with Explorer before touching LinkEditor. This phase benefits all providers immediately — Explorer gets image folder previews.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 0.1 | [US-337](../tasks/US-337-add-imgsrc-to-tree-provider-item/README.md) | Add `imgSrc` to `ITreeProviderItem` | Add `imgSrc?: string` field to `ITreeProviderItem` in `io.tree.d.ts`. Update `FileTreeProvider.list()` to set `imgSrc = item.href` for image files (detect by extension: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico`). Update script type definitions in `assets/editor-types/io.d.ts`. | Done |
| 0.2 | [US-338](../tasks/US-338-move-favicon-cache/README.md) | Move favicon-cache to shared location | Move `favicon-cache.ts` from `editors/link-editor/` to `components/tree-provider/` (or `core/utils/`). Update imports in LinkEditor. This utility is needed by `ItemTile` for HTTP link favicons. | Done |
| 0.3 | [US-339](../tasks/US-339-item-tile-component/README.md) | `ItemTile` component | New component in `components/tree-provider/ItemTile.tsx`. Renders a single tile card: image area (top) + name area (bottom). Image sources: `imgSrc` → favicon for HTTP → file-type icon fallback. Tile dimension constants (cell width/height, image height) per view mode. Responsive column calculation. | Done |
| 0.4 | [US-340](../tasks/US-340-categoryview-tile-modes/README.md) | CategoryView tile modes | Implement tile rendering in CategoryView for all `CategoryViewMode` variants. When `viewMode !== "list"`, render items using `ItemTile` in a responsive grid (`RenderGrid` with calculated column count). Add view mode toggle buttons to toolbar area (via `toolbarPortalRef`). | Done |
| 0.5 | [US-341](../tasks/US-341-explorer-folder-editor-view-mode/README.md) | Rename CategoryEditor → ExplorerFolderEditor + view mode | Full rename (classes, files, editorType, registry ID). `FolderViewModeService` with hierarchical inheritance. Per-folder view mode persistence in `folderViewMode.json`. | Done |
| 0.6 | [US-342](../tasks/US-342-test-in-explorer/README.md) | Test in Explorer — fixes and adjustments | Toolbar layout, root collapse guard, click behavior (select vs navigate), ".." parent navigation, first tile switch fix. | Done | Test: navigate to image folder → switch to tile mode → see image previews. Switch between view modes. Verify persistence across navigation and restart. Verify list mode is unchanged. | Planned |

### Phase 1: Link Editor Refactoring

Refactor LinkEditor to use CategoryView for center area and register secondary editors in page context. Keep Browser integration working identically.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 1.1 | [US-344](../tasks/US-344-link-tree-provider/README.md) | `LinkTreeProvider` | `ITreeProvider` implementation as thin adapter over `LinkViewModel` internal state. `list()` returns items filtered by category. `addItem()` → `vm.addLink()`. `deleteItem()` → `vm.deleteLink()`. `hasTags = true`, `hasHostnames = true`, `pinnable = true`. `writable = true`, `navigable = false`. Created by `LinkViewModel` on init, exposed as `vm.treeProvider`. | Done |
| 1.2 | [US-345](../tasks/US-345-shared-panel-components/README.md) | Shared panel components | Extract `LinkCategoryPanel`, `LinkTagsPanel`, `LinkHostnamesPanel` from current LinkEditor left panel code. These components accept `LinkViewModel` as prop and render identically in both inline and PageNavigator contexts. Category panel uses `TreeProviderView` (links hidden) or `CategoryTree`. Tags/Hostnames panels use `TagsList`. Register wrapper components in `secondary-editor-registry` for `"link-category"`, `"link-tags"`, `"link-hostnames"`. Each wrapper calls `useContentViewModel(model, "link-view")` to get shared LinkViewModel. | Done |
| 1.3a | [US-346](../tasks/US-346-link-editor-categoryview/README.md) | Extract LinksList / LinksTiles | Extract view-only `LinksList` and `LinksTiles` components from `LinkItemList`/`LinkItemTiles`. Accept callbacks for clicks, context menus, drag, pin icons. Predecessor to 1.3a-2 and 1.3b. | Done |
| 1.3a-2 | [US-350](../tasks/US-350-ilink-type-consolidation/README.md) | ILink type consolidation | Rename `ITreeProviderItem.name` → `title`. Define `ILink` as unified type. `LinkItem extends ILink`. Eliminate mapping between the two types. ~15 files, mechanical rename. | Done |
| 1.3a-3 | [US-349](../tasks/US-349-categoryview-uses-linkslist/README.md) | CategoryView uses LinksList / LinksTiles | Replaced `CategoryViewRow` and `ItemTile` inside `CategoryView` with `LinksList`/`LinksTiles`. No type mapping (ILink unification). `getId`/`selectedId`/`onDoubleClick` props. Optional action buttons for writable providers. `TreeProviderItemIcon` for icons. Rich tooltips in Explorer/Archive. | Done | Replace `CategoryViewRow` and `ItemTile` inside `CategoryView` with `LinksList`/`LinksTiles`. Gains rich tooltips, favicons, open-link button. Generalize selection (`getId` prop). Optional action buttons for writable providers. | Planned |
| 1.3b | [US-348](../tasks/US-348-link-editor-refactoring/README.md) | LinkEditor refactoring | Removed browser selector. Renamed `treeProviderContextMenu` → `linkContextMenu`. Registered HTTP link handler. Refactored context menus to event channel pattern. | Done |
| 1.4 | [US-351](../tasks/US-351-secondary-editor-registration/README.md) | Secondary editor registration | LinkEditor registers panels in PageNavigator via `pageNavigatorToggled` event. Panel expansion sync via `panelExpanded` event. Pattern B guard in `removeSecondaryEditorWithoutDispose`. Conditional inline panels. | Done | LinkEditor component manages `model.secondaryEditor` directly: sets `["link-category", ...]` on mount (page context), clears on unmount (useEffect cleanup) or JSON mode switch. Auto-expands `"link-category"` via `page.expandPanel()`. Inline left panel hidden when PageNavigator is open. Inline left panel visible when PageNavigator is closed or no page (Browser). Uses Pattern B from secondary-editors architecture — mainEditor appears in secondaryEditors[], but registration is driven by the React component, not by TextFileModel itself. | Planned |
| 1.5 | — | Pinned links panel | No changes needed — PinnedLinksPanel works as-is. | Done |
| 1.6 | — | Verify feature parity | Verified: Browser (blank page + bookmarks drawer) works. Page context: JSON↔Links, PageNavigator open/closed, secondary panels, conditional Tags/Hostnames all working. | Done |
| 1.7 | [US-352](../tasks/US-352-cleanup-unify-link-actions/README.md) | Clean up and unify link actions | Unified double-click → open link. Removed "open" buttons. Deleted `ItemTile.tsx`. PinnedLinksPanel: selection highlight, TreeProviderItemIcon, aligned styles. | Done |

### Phase 2: Link Collections as Infrastructure

Make link collections a general-purpose building block. Enable programmatic creation of link collection pages with Categories panel in the sidebar.

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 2.0a | [US-354](../tasks/US-354-link-drag-consolidation/README.md) | Consolidate ILink drag-drop into LinkDragEvent | Replace `LINK_DRAG` + `LINK_CATEGORY_DRAG` + `tree-provider-item` with single `LinkDragEvent` carrying `ILink[]` + `sourceId`. Unified drag-drop across FileTreeProvider, ZipTreeProvider, and LinkEditor. Prerequisite for 2.0b. | Done |
| 2.0b | [US-353](../tasks/US-353-category-panel-tree-provider/README.md) | Replace CategoryTree with TreeProviderView in LinkCategoryPanel | Replace custom `CategoryTree` with `TreeProviderView` + `LinkTreeProvider`. Added `getLabel` and `rootLabel` props to TreeProviderView. Added `hasSubDirectories`/`hasItems` to ILink. Two modes via `categoriesOnly` prop. | Done |
| 2.1 | — | Browser editor integration review | Verified: BlankPageLinks and BookmarksDrawer work with refactored LinkEditor. Browser context (no `model.page`) renders self-contained layout with inline panels. No adjustments needed. | Done |
| 2.2 | [US-355](../tasks/US-355-standalone-link-collection/README.md) | Standalone link collection page | `app.pages.openLinks((ILink | string)[], title?)` — creates TextFileModel as Pattern A secondary editor with `.link.json` content. Categories panel in sidebar; clicking navigates the page. Passes `pageId` in `RawLinkEvent` metadata. | Done |
| 2.3 | — | Multi-file drop handler | When multiple files are dropped onto the app (or a page), create a link collection with links to those files (preserving folder structure as categories). Open via standalone link collection helper (2.2). User clicks through files one by one in the main content area. | Planned |
| 2.4 | — | Expose LinkTreeProvider in script `io` namespace | `io.LinkTreeProvider` + helper to create and open a link collection page from a script. Script type definitions. Enables: `const links = [...]; io.openLinkCollection(links);` | Planned |
| 2.5 | — | Content search for link collections | Instant in-memory search by title/href/tags. Uses existing `ITreeProvider.search()` interface. | Planned |
| 2.6 | — | DOMSecondaryEditor | Secondary editor for HTML content (TextPageModel). Scrapes DOM resources (images, scripts, styles, media). Each resource type as a category. | Planned |

### Phase 3: Archive Expansion

| # | Task | Title | Description | Status |
|---|------|-------|-------------|--------|
| 3.1 | [US-343](../tasks/US-343-provider-agnostic-folder-editor/README.md) | Make folder editor provider-agnostic | CategoryEditor scans `page.secondaryEditors[]` for matching `treeProvider.type` + `sourceUrl`. Renamed back to CategoryEditor. PageModel notifies mainEditor on secondary changes. Works with Explorer and Archive panels. | Done |
| 3.2 | — | Adopt libarchive-wasm | Replace `jszip` with `libarchive-wasm` (WASM-based, MIT). Supports RAR v4/v5, 7z, TAR, gzip, bzip2, lzma/xz, cab, ISO. Generalize `ZipTreeProvider` to `ArchiveTreeProvider`. Update `ARCHIVE_EXTENSIONS` and `isArchiveFile()`. | Planned |

## Architecture Reference

### Case 1: .link.json file opened in a page (Links mode)

```
PageModel
  ├── mainEditor: TextFileModel ←──────── ALSO in secondaryEditors[]
  │   ├── ContentViewModelHost
  │   │   └── "link-view" → LinkViewModel (ref-counted, shared)
  │   │       └── treeProvider: LinkTreeProvider
  │   └── secondaryEditor: ["link-category", "link-tags"?, "link-hostnames"?]
  ├── secondaryEditors: EditorModel[]
  │   ├── ExplorerEditorModel           // ["explorer"] or ["explorer", "search"]
  │   └── TextFileModel (same instance) // ["link-category", ...]
  ├── pageNavigatorModel                // pure layout: open/width
  └── expandPanel(panelId)
```

PageNavigator panel wrappers call `useContentViewModel(model, "link-view")` to get the shared LinkViewModel. Same instance as LinkEditor uses (ref-counted).

### Case 2: .link.json file in JSON mode

```
PageModel
  ├── mainEditor: TextFileModel         // secondaryEditor: undefined
  ├── secondaryEditors: EditorModel[]
  │   └── ExplorerEditorModel           // ["explorer"]
  │   (no link panels — cleared when LinkEditor unmounted)
  ├── pageNavigatorModel
  └── ...
```

### Case 3: Standalone link collection (multi-file drop, script, AI agent)

```
PageModel
  ├── mainEditor: TextFileModel         // unsaved .link.json content (modified: true)
  │   └── LinkViewModel → LinkTreeProvider
  │   └── secondaryEditor: ["link-category"]
  ├── secondaryEditors: EditorModel[]
  │   └── TextFileModel (same instance) // ["link-category"]
  ├── pageNavigatorModel                // open, "link-category" expanded
  └── ...
```

No temp file needed — TextFileModel's unsaved-content cache handles persistence. LinkEditor renders with Categories panel in PageNavigator. Main content area shows whatever the user clicks from the collection.

### Case 4: Browser context (no page, self-contained)

TextFileModel has no `page` — LinkEditor renders all panels inline. No secondary editors registered.

## Notes

### 2026-04-04 (v2)
- **Eliminated LinksNavigatorModel** — external code (LinkEditor component / programmatic callers) sets `secondaryEditor` on TextFileModel directly
- Confirmed this is an existing pattern (ZipEditorModel already does it) — **no PageModel guards needed**
- Removed task 1.0 (PageModel guards) — unnecessary
- Simplified Resolved Concerns section — all concerns already handled by existing design
- Updated architecture diagrams to show TextFileModel as both mainEditor and secondary

### 2026-04-04 (v1)
- Resolved design questions from discussion:
  - **No separate LinksEditorModel** — LinkEditor component stays as main editor (content-view of TextFileModel)
  - **LinkViewModel gains `treeProvider`** — thin `LinkTreeProvider` adapter over internal state
  - **Dual-context rendering** — inline panels (Browser / navigator closed) vs PageNavigator panels (page context / navigator open)
  - **CategoryView gets externalized state** — parent controls viewMode, CategoryView is pure renderer
  - **Per-folder view mode persistence** — simple JSON file in user data folder
  - **Conditional panels** — Tags/Hostnames shown only when data contains tags/HTTP links
  - **Auto-expand** — `page.expandPanel("link-category")` on LinkEditor mount
- Phase 0 expanded with detailed tasks for CategoryView enhancement
- Phase 1 rewritten to match refactoring approach (no replacement, refactoring in-place)
- Phase 2 simplified — Browser integration is mostly a verification task since LinkEditor stays the same component

### 2026-04-03
- Epic updated to reflect completed EPIC-017 and EPIC-019 architecture
- Added Phase 0 (Foundation) for tile mode + imgSrc
- Removed RegexSecondaryEditor from Phase 2 (moved to backlog)

### 2026-04-02
- Split from EPIC-016 (Phases 2, 3, 4 moved here as Phases 1, 2, 3)
- Originally planned after EPIC-017 — both EPIC-017 and EPIC-019 now completed
