# EPIC-100 — Investigation notes: moving the Force Graph editor out of the app into a board

> Read-only investigation. Nothing was changed. Written 2026-09-12.
>
> Goal being scoped: remove the built-in `graph-view` editor from `C:\projects\persephone` and
> re-implement it as a board in `C:\projects\persephone-boards`, following the pattern already
> proven by the **Todo** board.

---

## 1. The built-in force-graph editor

### 1.1 Files and size

All of it lives in `C:\projects\persephone\src\renderer\editors\graph\` — **29 files, 8,569 LOC**
(24 `.ts` + 5 `.css`).

| File | LOC | Role |
|---|---:|---|
| `ForceGraphRenderer.ts` | 899 | Canvas renderer + d3-force simulation + zoom/drag/hit-testing |
| `GraphEditor.ts` | 855 | Editor model (`TextHostEditorModel` subclass), orchestration, serialization, parse |
| `GraphBodyView.ts` | 789 | Body view: canvas host, body toolbar, panel tabs, search, selection menu, keyboard |
| `GraphDetailPanelView.ts` | 732 | Right-hand selected-node panel: Info / Properties / Links tabs (two data grids) |
| `GraphLegendPanelView.ts` | 716 | Left legend panel: Selection / Level / Shape tabs, highlight filters, descriptions |
| `GraphVisibilityModel.ts` | 526 | BFS visibility: initial visible set, expand / expandDeep / collapse / expandAll |
| `GraphDataModel.ts` | 415 | Source-data CRUD, legend descriptions, `cleanNode`, legend filters |
| `GraphGroupActionsModel.ts` | 379 | Interactive grouping: group/ungroup/reparent/alt-click link toggle, cycle checks |
| `GraphTooltipView.ts` | 283 | Hover tooltip card, markdown build, Copy / Open buttons |
| `GraphGroupModel.ts` | 258 | Read-only group index; link preprocessing (membership hiding, cross-group splitting) |
| `GraphMutationModel.ts` | 232 | Add/delete node/child/link, delete selected, copy/open markdown, open grid, extract |
| `index.ts` | 239 | `GraphEditorView`, page toolbar contributions, footer, `graphModule` export |
| `GraphExpansionSettingsView.ts` | 230 | Root / Expand Depth / Max Visible panel |
| `GraphHighlightModel.ts` | 216 | Layered highlight compositing (search / legend / altKey / external hover) |
| `GraphConnectivityModel.ts` | 206 | Real vs. processed adjacency indexes |
| `GraphContextMenu.ts` | 198 | Node / group / empty-area context menus + selection menu builders |
| `GraphSearchModel.ts` | 170 | Multi-word AND search over label + custom properties; reveal hidden |
| `GraphTooltipModel.ts` | 147 | Hover → tooltip state machine |
| `GraphTuningSlidersView.ts` | 151 | Charge / Distance / Collide sliders + Reset |
| `types.ts` | 163 | `GraphNode` / `GraphLink` / `GraphOptions` / custom-prop + markdown-link helpers |
| `GraphIcons.ts` | 90 | Level and shape SVG icons for legend/detail panel |
| `shapeGeometry.ts` | 83 | Polygon point generation for the six node shapes |
| `constants.ts` | 30 | `forceProperties` defaults |
| CSS (5 files) | 444 | `GraphBody.css`, `GraphDetailPanel.css`, `GraphLegendPanel.css`, `GraphTooltip.css`, `GraphTuningSliders.css` |

**Outside that folder**, the editor also owns:

- `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts` — **521 LOC** scripting/MCP facade
- `src/renderer/api/types/graph-editor.d.ts` — **248 LOC** IntelliSense typings
  (mirrored at `assets/editor-types/graph-editor.d.ts`)
- `assets/guides/editors/graph.md`, `assets/guides/formats/graph.md`,
  `assets/guides/examples/greek-gods.fg.json`
- `qa/surfaces/editors/graph.md`

**Total owned footprint ≈ 9,350 LOC + docs.**

### 1.2 npm dependencies

From `C:\projects\persephone\package.json`:

| Package | Version | Where used |
|---|---|---|
| `d3` | `^7.9.0` | `ForceGraphRenderer.ts` (`import * as d3`) |
| `d3-zoom` | `^3.0.0` | canvas zoom behavior |
| `d3-drag` | `^3.0.0` | node drag behavior |
| `@types/d3`, `@types/d3-zoom`, `@types/d3-drag` | dev | typings |
| `av-grid` | `2.6.1` | **indirect** — via `src/renderer/uikit/DataGrid/DataGridView.ts` (`import { AVGrid, CALLBACK_OPTION_KEYS } from "av-grid"`), used by the detail panel's Links and Properties grids |

The actual d3 API surface used is small and tree-shakeable:
`d3.forceSimulation`, `forceLink`, `forceManyBody`, `forceCollide`, `forceCenter`, `forceX`,
`forceY`, `d3.select`, `d3.zoomIdentity`, plus `d3-zoom`'s `zoom()` and `d3-drag`'s `drag()`.
That is **`d3-force` + `d3-selection` + `d3-zoom` + `d3-drag` only** — the full `d3` barrel import
is a convenience, not a requirement. A board can vendor these four packages (~60 KB minified) and
does not need all of d3.

`av-grid` is published standalone on npm (the app pins `2.6.1`), so a board can vendor the same
version and get pixel-identical grids. Persephone themes av-grid through CSS variables written by
`src/renderer/theme/p-vars.ts` and `src/renderer/theme/global-styles.ts` — a board must reproduce
that variable mapping or ship the equivalent CSS.

### 1.3 Full user-facing feature set (acceptance criteria for the board)

#### Page toolbar (right side, contributed to `TextChromeView`)
- **Open in Drawing Editor** (`graph-open-in-draw`) — snapshots the canvas to PNG, wraps it in an
  Excalidraw JSON document (`buildExcalidrawJsonWithImage`) and opens a new `draw-view` page named
  `<file>.excalidraw`.
- **Copy Image to Clipboard** (`graph-copy-image`) — `canvas.toBlob` → `navigator.clipboard.write`
  as `image/png`.
- Both are hidden while loading or on parse error.
- Standard chrome: page navigation, editor **Switch** widget (Graph ↔ Monaco ↔ Grid), Ctrl+S save,
  dirty dot.

#### Body toolbar
- **Force tuning** toggle (`graph-settings`) — opens the Physics panel.
- **Grouping toggle** (`graph-toggle-grouping`) — enable/disable group rendering; disabled when the
  graph has no group nodes; shown struck-through when disabled; **persisted** per host.
- **Reset view** (`graph-reset-view`) — recompute BFS visibility and restart the simulation.
- **Expand all** (`graph-expand-all`) — disabled unless visibility filtering is active; shows a
  confirmation dialog ("This graph has N nodes. Expanding all may cause performance issues.").
- **Search box** (`graph-search`, placeholder "Search nodes…") with inline **clear** button
  (`graph-search-clear`).
- **Search info** label: `N visible / M hidden / T total`, plus two link-buttons —
  `[+N hidden]` (reveal hidden matches) and `[select all]` / `[add to selection]`.
- **Selection info** button (`graph-selection-menu`) — "N selected", opens the selection menu.

#### Panel tabs (below the body toolbar)
Three tabs — **Physics** (`graph-panel-physics`), **Expansion** (`graph-panel-expansion`),
**Results** (`graph-panel-results`).

- **Physics panel**: sliders **Charge** (`tuning-charge`, −200…0, step 1), **Distance**
  (`tuning-link-distance`, 10…200, step 1), **Collide** (`tuning-collide`, 0…1, step 0.05), each
  with a live numeric readout, plus **Reset** (`tuning-reset`). Values persist into
  `options.charge` / `options.linkDistance` / `options.collide`; Reset deletes them.
- **Expansion panel**: **Root Node** combo-select (`graph-expansion-root`, filterable, with an
  "(auto — lowest level)" entry), **Expand Depth** input (`graph-expansion-depth`, placeholder
  "∞ (unlimited)", min 1), **Max Visible** input (`graph-expansion-max`, placeholder
  "500 (default)", min 10), and the note "Depth and max visible apply when file is reopened".
  Enter or blur commits; invalid values revert.
- **Results panel**: search-result list (capped at `MAX_DISPLAYED_RESULTS`), each row showing the
  node label plus the matched property key/value with highlighted match spans; keyboard
  ↑/↓/Enter navigation from the search box; clicking a result reveals and selects the node.

#### Canvas (HTML `<canvas>`, d3-force)
- Force-directed layout: link, many-body (charge), collide, center forces; `forceX`/`forceY`
  available but disabled by default (`constants.ts` `forceProperties`).
- **Pan + wheel zoom** (d3-zoom; built-in dblclick-zoom disabled), **node drag** (d3-drag).
- **Six node shapes**: circle, square, diamond, triangle, star, hexagon (`shapeGeometry.ts`).
- **Five levels** sizing nodes by importance (radii `[14, 11, 8, 6, 4]`); root and group nodes get
  the level-1 radius.
- **Group rendering**: group nodes drawn with a distinct border; membership links hidden;
  cross-group links re-routed/split with synthetic-link counts.
- **Hidden-neighbor badges**: a node with hidden neighbors draws a count badge; click = expand one
  level, **Ctrl+click** = deep expand.
- **Labels**: always drawn for highlighted nodes; "important" labels appear when zoomed in.
- **Highlight layers** composited by `GraphHighlightModel`: search matches, legend filter, Shift-key
  neighbor highlight, external hover (from the Links grid), selection, hover.
- **Empty state hint**: "Right-click → Add Node to start building the graph".
- **Loading spinner** and **parse-error panel** branches.

#### Mouse / keyboard interaction
| Gesture | Effect |
|---|---|
| Click node | select (replaces selection) |
| **Ctrl+click** node | add/remove from selection (multi-select) |
| **Alt+click** node | toggle a link between the single selected node and the clicked node; with groups, add/remove group membership (rejects cycles with a warning alert) |
| **Double-click** node | expand the detail panel |
| Right-click node / group / empty area | context menu (below) |
| Drag node | reposition (pins during drag) |
| Wheel | zoom; drag background = pan |
| Hover node | tooltip card |
| **Shift (hold)** | highlight the selection's neighbors; released/window-blur clears |
| **Ctrl+F** | focus the search box |
| **Ctrl+A** | select all visible nodes |
| **↑ / ↓ / Enter** in search | navigate and pick search results |
| **Escape** in search | close the open panel, else clear the search |

#### Context menus
**Node** (`buildNodeContextMenu`):
`Open <property>` / `Open link…` submenu (markdown links found in custom string properties) ·
**Add Child** · **Set as Root** (disabled when already root) · **Collapse** (disabled when no
visibility filter) · **Select children** · **Delete Node** / **Delete N Nodes** ·
**Delete Link to…** submenu (one entry per real neighbor) · **Group Selected** (≥2 selected) ·
**Remove from Group** (when in a group). Group items hidden when grouping is off.

**Group node** (`buildGroupNodeContextMenu`):
**Edit Title** · **Collapse** · **Select members** · **Select members deep** ·
**Delete (Ungroup)** · **Delete with Children** · **Group Selected** (≥2 selected).

**Empty area**: **Add Node** (placed at the clicked world position).

**Selection menu** (from the "N selected" button, `buildSelectionMenu`):
**Select children** · **Select members** · **Select members deep** · **Highlight** ·
**Copy (markdown)** · **Open (markdown)** (new `md-view` page) · **Open in grid** (new `grid-json`
page named `<title>.grid.json`) · **Group Selected** · **Extract** · **Extract with children**
(both open a new `graph-view` page containing the induced subgraph) · **Delete N Nodes**.

#### Selected-node detail panel (right, `graph-detail-panel`)
- Collapsible via `graph-detail-toggle`; header shows the node title or "N nodes selected".
- **Info tab** (`graph-detail-tab-info`): editable **ID** (`graph-detail-id`, with duplicate-ID
  validation error) and **Title** (`graph-detail-title`); **Level** icon row (5 buttons) and
  **Shape** icon row (6 buttons) supporting multi-select batch apply with mixed-state rendering.
- **Properties tab** (`graph-detail-tab-properties`): editable **av-grid** data grid of custom
  properties (Name / Value), add/delete rows, reserved-key validation, dirty state with
  **Apply** / status message.
- **Links tab** (`graph-detail-tab-links`, single selection only): editable av-grid of neighbor
  nodes with columns **ID / Title / Level (dropdown) / Shape (dropdown)** plus any extra
  properties; add/delete rows to create/remove links; focusing a row drives **external hover**
  highlighting on the canvas; sorting and filtering disabled, row height 24.

#### Legend panel (left, `graph-legend-panel`)
- Collapsible (`graph-legend-toggle`, chevron ▼/▲); title "Legend".
- Tabs **Selection** (`graph-legend-tab-selection`), **Level** (`graph-legend-tab-level`), **Shape**
  (`graph-legend-tab-shape`).
- **Selection** tab filters: *Selected*, *Selected with children*, *Not selected*.
- **Level** / **Shape** tabs: checkbox rows for each level/shape actually present in the visible
  graph, plus **Root** and **Group** rows; checking rows highlights the matching nodes (dims the
  rest); each row has an editable **description** input (placeholder "Description…") persisted to
  `options.legend.levels` / `options.legend.shapes`.
- Shows "Search highlighting is active" when search highlighting takes precedence.

#### Hover tooltip
- Card with the node title (with clickable markdown links rendered inline), the node id in code
  style when a title exists, and all custom properties (value truncated at 100 chars, full value in
  `title=`).
- Two buttons: **Copy as Markdown** (with a check-mark confirmation) and **Open in new page**
  (opens a `md-view` page with the generated markdown).
- Suppressed while dragging, while a popup menu is open, and during zoom.

#### Footer (page status bar)
- Records count: `N nodes`, or `N of M nodes` when visibility filtering is active.
- A warning/status hint area (italic, warning color).

#### Persistence
- **File content** — every edit re-serializes the whole document to the host with
  `JSON.stringify(json, null, 4)`, preserving `type` and any unknown top-level keys
  (`originalJson` spread). Host content changes re-parse after a 400 ms debounce; the editor's own
  writes are skipped by the base class's echo guard.
- **In-file options** — root node, expand depth, max visible, the three physics values and the
  legend descriptions all live in `options` and are therefore saved to the file.
- **Host editor settings** — `groupingEnabled` rides `host.editorSettings["graph-view"]`
  (`mirrorHostSettings`), surviving Graph↔Monaco switches and app restarts.
- **Not persisted** (view-derived, stripped from `getRestoreData`): error, loading, search query
  and results, tooltip, selection, status hint.

#### Alerts / dialogs used
- `alertsBarModel.addAlert(..., "warning")` for: circular group hierarchy, grouping nodes from
  different groups, grouping groups with different parents, extract-groups-only.
- `showConfirmationDialog` for: Expand All, Delete N Nodes, Ungroup, Delete group with children,
  and the 3-button "Group Options" (Add to Group / Create New Group / Cancel).
- `showInputDialog` for the group title.

---

## 2. The `.fg.json` data format

```jsonc
{
  "type": "force-graph",          // content-detection marker; preserved verbatim on save
  "nodes": [
    {
      "id": "node-1",             // string, required, unique
      "title": "My Node",         // optional display label (defaults to id)
      "level": 1,                 // optional 1..5 — visual importance; 1 largest, 5 smallest
      "shape": "circle",          // optional: circle|square|diamond|triangle|star|hexagon
      "isGroup": false,           // optional — true makes this a group container node
      "anyCustomKey": "any value" // any extra property: shown in tooltip/detail, searchable
    }
  ],
  "links": [
    { "source": "node-1", "target": "node-2" }   // string ids both sides
  ],
  "options": {
    "rootNode": "node-1",        // BFS root
    "expandDepth": 3,            // BFS depth limit from root (applied on reopen)
    "maxVisible": 500,           // hard ceiling on visible nodes; default 500 (applied on reopen)
    "charge": -70,               // d3 many-body strength
    "linkDistance": 40,          // d3 link distance (px)
    "collide": 0.7,              // d3 collide strength 0..1
    "legend": {
      "levels": { "1": "Core modules", "root": "Entry point" },
      "shapes": { "circle": "TypeScript", "diamond": "React" }
    }
  }
}
```

Conventions and reserved keys:

- A link **from a group node** to another node means **membership** (target is a member of source),
  not a visual edge. Everything else is a normal edge.
- **Indexed properties**: a key ending `#N` (`function#1`, `class#2`) is displayed with the suffix
  stripped, allowing repeated logical keys.
- **Markdown links in string properties** (`[text](href)`) are detected and offered in the node
  context menu and rendered clickable in the tooltip; bare paths become `file:///…`.
- **Reserved / excluded property keys** (never treated as custom): `id`, `title`, `level`, `shape`,
  `isGroup`, `x`, `y`, `vx`, `vy`, `fx`, `fy`, `index`, plus anything prefixed `_$`
  (`SYS_PREFIX`; runtime-only fields `_$showIndex`, `_$hiddenCount`).
- Save format is 4-space-indented JSON; unknown top-level keys are preserved.
- Detection: filename `*.fg.json` (matcher priority 20), **or** JSON content containing
  `"type": "force-graph"` and `"nodes"` (content-detection priority 60, exposes the Graph switch).

---

## 3. Coupling to Persephone internals — the "simple one-file editor" claim

**The claim is refuted.** It is not one file and not dependency-free: it is 29 files / 8,569 LOC
inside the folder, plus a 521-LOC scripting facade and a 248-LOC `.d.ts`, and it reaches into
**eight** distinct Persephone subsystems.

### 3.1 Editor base classes / lifecycle
- `GraphEditor extends TextHostEditorModel<GraphEditorState, void, GraphQueueEvent>`
  (`editors/base/TextHostEditorModel.ts`, 346 LOC → `editors/base/EditorModel.ts`, 376 LOC).
  Uses `adoptHost`, `onHostExtracted`, `subscribeHostContent`, `writeToHost` (with echo guard),
  `mirrorHostSettings`, `getRestoreData`, `dispose`.
- `TextFileModel` (`editors/text/TextEditorModel.ts`) is the content host.
- `TextChromeView` (`editors/base/TextChromeView.ts`, 535 LOC) supplies the page chrome and accepts
  `rightToolbarContributions` + `footerContributions`.
- `EditorModule` / `editorRegistry` registration (`editors/base/editorRegistry.ts`).
- `ComponentQueue` (`core/state/ComponentQueue.ts`) for the `focus` event.

### 3.2 State primitives
`TComponentState`, `TOneState` (`core/state/state.ts`), `TComponentModel` +
`createComponentModelDriver` (`core/state/model.ts`) — used by the body, expansion settings, legend
and both detail-panel grids.

### 3.3 UIKit (≈5,000 LOC of shared components)
`Button`, `IconButton`, `Input`, `Slider`, `Select` (+`SelectModel`, `ListBox/types`), `Spinner`,
`Panel/panel-style`, `Text/text-style`, `Menu/attach-menu`, **`DataGrid`** (the av-grid shim),
`shared/vanilla-view`, `shared/subtree-swap`, `shared/slots`, `shared/keyed-list`,
`shared/highlight`, `shared/overlayLayer`, and `alertsBarModel`.

### 3.4 Dialogs / popups (app shell)
`ui/dialogs/ConfirmationDialog`, `ui/dialogs/InputDialog`,
`ui/dialogs/poppers/showPopupMenu` (`showAppPopupMenu` / `closeAppPopupMenu`).

### 3.5 Theme
- `theme/color` — **14 dedicated graph tokens**: `--color-graph-bg`, `-node-default`,
  `-node-highlight`, `-node-selected`, `-border-default`, `-border-highlight`, `-border-selected`,
  `-link-default`, `-link-selected`, `-label-bg`, `-label-text`, `-group-border`,
  `-node-special`, `-border-special`. These must be reproduced by the board.
- `theme/themes` `resolveColor()` — the canvas renderer resolves CSS variables to concrete colors
  because `CanvasRenderingContext2D` cannot consume `var(...)`.
- `theme/theme-state` — re-resolve on theme change (`refreshColors`).
- `theme/icons` (`createIconComponentElement`), `theme/language-icons` (`DrawIcon`).

### 3.6 Pages / cross-editor integration
`api/pages` `pagesModel.addEditorPage(...)` is called in **five** places, creating pages in **four
other editors**: `md-view` (tooltip Open, selection Open-markdown), `grid-json` (Open in grid),
`graph-view` (Extract / Extract with children), `draw-view` (Open in Drawing Editor).
`editors/draw/drawExport.buildExcalidrawJsonWithImage` is imported directly — a cross-editor import.

### 3.7 Scripting / MCP / agent surface
- `scripting/api-wrapper/GraphEditorFacade.ts` (521 LOC) — ~30 methods:
  `nodes`, `links`, `nodeCount`, `linkCount`, `getNode`, `selectedIds`, `selectedNodes`, `select`,
  `addToSelection`, `clearSelection`, `getNeighborIds`, `getVisualNeighborIds`, `getGroupOf`,
  `getGroupMembers`, `getGroupMembersDeep`, `getGroupChain`, `isGroup`, `search`, `resetView`,
  `resetVisibility`, `expandAll`, `toggleGrouping`, `setSearchQuery`, `revealHiddenMatches`,
  `revealAndSelectNode`, `selectSearchResults`, `updateForceParams`, `resetForceParams`,
  `updateExpansionOptions`, `openInDrawingEditor`, `copyImageToClipboard`, `bfs`, `getComponents`.
- `scripting/api-wrapper/PageWrapper.ts` wires the facade into `page.editor`.
- `api/types/graph-editor.d.ts` + `assets/editor-types/graph-editor.d.ts` (IntelliSense).
- `qa/surfaces/editors/graph.md` — QA scenarios G.1–G.4+ tied to `elements` names.
- The whole `elements` / `data-name` contract (≈30 stable names) documented in
  `assets/guides/editors/graph.md`.

### 3.8 Registration touch points (the removal checklist)
| File | What it holds |
|---|---|
| `src/renderer/editors/register-editors.ts` | `{ id: "graph-view", name: "Graph", guidePath: "editors/graph", hasContentHost: true, load: … }` |
| `src/renderer/editors/base/editor-matchers.ts` | `acceptFile` (`*.fg.json`, prio 20), `switchOption`, `validForLanguage: json`, `detectsContent` (`"type":"force-graph"` + `"nodes"`) |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Tools & Editors hub entry "Force Graph" → `addEditorPage("graph-view", "json", "untitled.fg.json")` |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | facade dispatch |
| `src/renderer/api/types/{graph-editor,common,page}.d.ts` | typings |
| `assets/editor-types/{graph-editor,common,page}.d.ts` | shipped typings |
| `assets/guides/editors/graph.md`, `editors/index.md`, `formats/graph.md`, `examples/greek-gods.fg.json`, `agents/pages.md`, `scripting/api/{index,page}.md`, `scripting/index.md`, `mcp-setup.md`, `whats-new.md` | guides corpus |
| `doc/architecture/{editors,folder-structure,key-files,scripting}.md`, `doc/standards/editor-guide.md` | developer docs |
| `qa/surfaces/editors/graph.md` | QA surface |
| `README.md` | feature list |

**Conclusion:** the "simple, self-contained" intuition holds only for the *rendering core*
(`ForceGraphRenderer` + models ≈ 3,400 LOC, whose only external deps are d3 and 14 color tokens).
Everything around it — panels, grids, dialogs, menus, cross-editor page creation, the agent facade,
and the `elements` contract — is Persephone-shaped and has to be rebuilt or re-bridged.

---

## 4. The boards system

Sources: the in-app guide `guides.agents.boards` (bridge **v1.4.0**), `assets/board-template/`,
`assets/demo-board/`, `boards-assets/manifest.json`, `src/board-shim.ts`,
`src/main/board-protocol-service.ts`, `src/renderer/editors/board/*`,
`src/renderer/theme/p-vars.ts`, and `C:\projects\persephone-boards`.

### 4.1 What a board is

A board is a **self-contained static web app** served from a locked-down, cross-origin
`board://<host>` iframe. Persephone injects into `<head>`, before any author asset:
a `<style>` with the resolved `--p-*` palette (themed first paint), `window.__persephoneBoot`, and
the **bridge shim** defining `window.persephone` synchronously. A folder is a board iff it contains
`board-manifest.json`. Trust lives in an app-side registry, never in the board; manifest
custom-editor fields are honored **only when trusted**.

### 4.2 Folder layout

```
<board-root>/
  board-manifest.json    REQUIRED — the only thing that makes the folder a board
  index.html             main-view entry (default `html` for every declared view)
  app.js                 conventional entry — a plain classic <script>, not a module
  board-base.css         shipped by the scaffold into every board; linked FIRST
  style.css              optional
  icon.svg               optional board icon
  lib/                   VENDORED third-party libs + LICENSE + VERSION.txt
  scripts/               optional backend scripts (.js/.mjs/.py/.ps1/.sh) — real OS processes
  <view>.html/.js        optional dedicated secondary-view files
  CLAUDE.md              board-specific author notes
  WHATS-NEW.md           catalog requirement; ships inside the release ZIP
  screenshot.png         catalog requirement, 1120x700; excluded from the ZIP
  ui.log                 runtime, written by Persephone — the board's black box
  versions-manifest.json machine-written by the publish script — never hand-edit
```

Catalog repo: `boards/<id>/` one folder per board, `boards-manifest.json` at the root
(machine-written), `develop` → `main` merge triggers the GitHub Action that zips, releases, and
rewrites the manifests. The board's own `board-manifest.json` `version` is the publish trigger.

### 4.3 `board-manifest.json` fields

Authoritative types: `src/renderer/editors/board/board-manifest.ts`.

| Field | Meaning |
|---|---|
| `schemaVersion` | required, currently `1` |
| `name` / `description` / `author` / `repository` | metadata; `name` falls back to the folder name |
| `version` | semver; **single source of truth for publishing** (`<id>-v<version>` release tag) |
| `minAppVersion` | app-compat gate — use instead of runtime feature checks |
| `standalone` | openable with no file / pinnable. Derived when absent: no `fileMasks` → `true` |
| `screenshot` | bare file name only (no separators, `..`, or scheme) |
| `fileMasks` | globs matched against the **basename**; `"fg.json"` / `".fg.json"` coerce to `"*.fg.json"` |
| `folderMasks` | narrows `fileMasks` to certain parent folders (path-suffix anchored) |
| `editorPriority` | position on the editor ladder (monaco 0, md 10, compound-name grids **20**, draw 50, viewers 100, category 200). A board becomes the **default** only if it **strictly outranks** the best built-in claimant; ties go to the built-in. A board is *always* a switch option regardless. |
| `editorName` | editor-switch label |
| `editorKind` | `"simple"` (board gets a path via `getFilePath()`, does its own I/O) or `"content-host"` (Persephone owns the pipe; board uses `persephone.host.*`) |
| `editorSources` | `"local"` (default) or `"any"` (archive entries and http(s), materialized to a local cache file) |
| `secondaryViews` | `[{ id, html?, title? }]` sidebar panels; `html` defaults to `index.html` (branch on `persephone.view`) |

**Gotcha:** the manifest is **not** covered by `editor.reload()` — it is cached at trust time.
Changing `fileMasks` / `editorPriority` requires toggling trust off/on or restarting the app.

### 4.4 External libraries — vendor, never CDN

The CSP is a response header on every board document (`BOARD_CSP`,
`src/main/board-protocol-service.ts`):

```
default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self'; media-src 'self' blob:; frame-src 'self'; worker-src 'self'
```

- **No CDN, ever** — remote `<script>`, `<link>`, `@import`, `fetch`, fonts and images are blocked,
  and the failure is **silent in the UI** (the violation lands in `ui.log`).
- **No npm / no bundler / no `package.json` inside a board.** You vendor prebuilt files into
  `lib/` and reference them relatively: `<script src="./lib/d3.min.js">`.
- You *may* download at author time from `script.execute` (full Node) and commit the result.
- **WASM allowed, `eval()` not.**
- Workers, `blob:`/`data:` media, and same-origin nested frames are allowed.

**Recommended-components catalog**: `C:\projects\persephone\boards-assets\manifest.json` —
`av-grid`, `tabulator`, `chartjs`, `flatpickr`, `tom-select`, `markdown`, `mermaid`, `split`,
`sortablejs`, `tippy`, `dialog`. Each entry has `vendor.{css,js}` CDN URLs for author-time download,
a Persephone `skin.file`, and `loadOrder`. **`av-grid` is the catalog default grid and needs no
skin** — its `--avg-*` tokens fall back to `--p-*`, so a theme switch re-tints with zero JS.
That is exactly the grid the Graph detail panel uses today.

### 4.5 The board API — `window.persephone` (bridge 1.4.0)

Defined in `src/board-shim.ts`; typings `src/renderer/editors/board/board-api.d.ts`.
There is **no** `app` / `page` / `io` / `ai` global in a board.

- **Identity**: `version`, `view` (`"main"` or a secondary view id, known synchronously).
- **Processes**: `execute(cmd, opts)`, `executeNode(script, args, opts)` (bundled Node 24) returning
  a handle with `on("stdout"|"stderr"|"exit"|"error")`, `getText()`, `getJson(pattern)`,
  `getBytes()`, `write()`, `endStdin()`, `kill()`. `setBoardBusy()`, `getBoardBusy()`, `getJobs()`.
- **Files**: `getFilePath()`, `readFile(path, {encoding: "utf8"|"base64"|"binary"})`,
  `writeFile(path, data, {encoding})`.
- **Dialogs**: `openFileDialog`, `saveFileDialog`, `openFolderDialog`.
- **In-app**: `openRawLink(href, { editor })` — opens a new Persephone page, optionally requesting
  an editor id (`"md-view"`, `"draw-view"`, `"grid-json"`…). An image `data:` URL with
  `{ editor: "draw-view" }` opens a new editable Excalidraw drawing (recipe:
  `persephone-boards/how-to/open-image-in-drawing-editor.md`). External `<a>` clicks are
  auto-routed. `notify(msg, "info"|"success"|"warning"|"error")` = toast.
  `setStatusText(text)` = the page footer for a content-host board.
  `call(path, { args, value, maxLength, timeoutMs })` = resolve the AiVision tree **rooted at the
  page hosting this board** (same paths as the MCP `call` tool).
- **Content host** (`editorKind: "content-host"` only): `persephone.host.getContent()`,
  `setContent(text)` (marks modified + schedules autosave; echo-guarded for your own frame),
  `onContentChange(cb)`, `getLanguage()`, `save()`. **Ctrl+S already saves** with no board code.
- **Shared state across frames**: `persephone.state.init(defaults, { restorableKeys })`, `get()`,
  `set()`, `merge()`, `onChange()`; `persephone.setSecondaryViews([...])`.
- **Board env vars**: `persephone.var.get/set/list/show` — namespaced per board.
- **Theme**: `persephone.theme` (load-time snapshot — goes stale), `getTheme()`, `tokens` /
  `getTokens()`, `onThemeChange(cb)` (fires once immediately, then on every switch).
- **AiVision**: `persephone.aiVision.expose(root)` (main frame only) → publishes the board's model
  at `pages[i].editor.app`; returns `{ describe, refresh, dispose, notify }`.
  `persephone.aiVision.createElements([{ name, purpose, where, selector, view, reveal }])` →
  the named-control contract an agent can `highlight(...)`.
- **Clipboard**: the frame is a secure context with clipboard permission —
  `navigator.clipboard.write([new ClipboardItem({...})])` and `writeText` work directly.
  `canvas.toBlob`, `crypto.randomUUID`, `FileReader`, `performance` all work.
- **Context menu**: a default native menu is built in; `e.preventDefault()` on `contextmenu` to
  render your own.

**Not available to boards**: `window.confirm` / `window.prompt` (blocked — use an in-board overlay),
navigation, page/tab collections, a menu-registration or command-palette API, a settings API,
`main.*` / `windows[i].*` through `persephone.call`.

### 4.6 Persisting content

`editorKind: "content-host"` (`src/renderer/editors/board/BoardContentEditorModel.ts`) composes the
same `TextFileModel` / `IContentHost` that backs Monaco and Grid: `skipSave = false`,
`modified` delegates to the host, `CONTENT_HOST_TRAIT.extractContentHost()` lets the host
**transfer to Monaco and back with no reload and no data loss**. `host.setContent(text)` behaves
like a Monaco keystroke (dirty dot + autosave cache); Ctrl+S / `host.save()` writes through the
pipe (encoding, encryption, cache). This is the mode the Graph board must use — it is exactly the
mode the current Graph editor already relies on (`TextHostEditorModel`).

The Todo board's idiom (`boards/todo/app.js`): a 300 ms debounced `writeSoon()` for free-text
edits, immediate `writeNow()` for discrete actions, and a `lastWritten` baseline so a no-op write
never falsely marks the page modified.

### 4.7 Theme colors

Persephone resolves its palette to concrete hex per theme and injects a `<style>` on `<html>`
before first paint, re-pushing on every theme switch. Contract:
`src/renderer/theme/p-vars.ts` (`P_VAR_SOURCES`) and
`src/renderer/editors/board/board-theme.ts` (`computeBoardThemePalette`, `BOARD_TOKEN_VARS`).

Color vars: `--p-bg`, `--p-panel`, `--p-bg-dark`, `--p-overlay`, `--p-hover`, `--p-tree-selection`,
`--p-border`, `--p-border-light`, `--p-text`, `--p-text-muted`, `--p-text-strong`, `--p-accent`,
`--p-accent-text`, `--p-accent-hover`, `--p-selection-bg`, `--p-selection-text`, `--p-link`,
`--p-error`, `--p-success`, `--p-warning`, `--p-scrollbar`, `--p-scrollbar-thumb`, `--p-shadow`.
Metric vars: `--p-space-*`, `--p-gap-*`, `--p-radius-*`, `--p-size-*`, `--p-font-*`,
`--p-font-base`, `--p-font-family`.

**There are no `--p-graph-*` tokens.** The 14 graph colors in §3.5 have no board equivalent — see
§5.

For canvas drawing (which cannot consume `var(...)`), a board uses `persephone.getTheme()` and
re-reads on `onThemeChange` — the direct analogue of today's `resolveColor()` + `themeState`.

`board-base.css` (71 lines in the current variant) ships into every board and is linked first:
resets, themed focus ring and scrollbars, Persephone-look checkboxes, and the opt-in `.p-*` chrome
layer — `.p-toolbar` (30px, `--p-bg-dark`, `data-orientation="vertical"`), `.p-btn`
(`primary|ghost|danger|link|selected|icon|sm|md|on-dark`), `.p-input`, `.p-select`, `.p-sep`,
`.p-spacer`, `.p-toolbar-title`. This is how a board looks native without importing UIKit.

### 4.8 File-type registration

Entirely declarative in the manifest: `fileMasks` (+ `folderMasks`) + `editorPriority` +
`editorName` + `editorKind` + `editorSources`, honored only when trusted.
`getBoardEditorAssociation(manifest)` maps manifest → association;
`matchesBoardMasks(path, fileMasks, folderMasks)` does the matching; the board gets a virtual
editor id `board-editor:<root>`.

Lifecycle APIs (via `script.execute` → `app.boards.*`, mirrored on MCP as `boards.*`):
`createBoard`, `createDemoBoard`, `openBoard`, `registerBoard` (shows the user a trust dialog),
`unregisterBoard`, `renameBoard`, `searchPublished`, `getPublishedVersions`, `downloadPublished`,
`installPublished`, `uninstallBoard`, `checkPublishedUpdates`.

### 4.9 Reference boards

Published catalog (`C:\projects\persephone-boards\boards-manifest.json`): `drawio-viewer`,
`excel-viewer`, `pdf-viewer`, `pe-viewer`, `powerpoint-viewer`, `sqlite-viewer`, `todo`,
`word-viewer`.

**`todo` — the canonical migration reference** (`boards/todo/`):

| File | LOC |
|---|---:|
| `app.js` | 1,350 |
| `style.css` | 231 |
| `index.html` | 59 |
| `board-base.css` | 71 (shipped scaffold) |
| `CLAUDE.md` | 112 |
| `WHATS-NEW.md` | 23 |
| `icon.svg`, `screenshot.png`, `versions-manifest.json`, `ui.log` | — |

Manifest: `schemaVersion 1`, `version 1.1.0`, `minAppVersion 5.0.1`,
`fileMasks: ["*.todo.json"]`, `editorPriority: 200`, `editorName: "Todo"`,
`editorKind: "content-host"`, `secondaryViews: [{ id: "lists", title: "Lists & Tags" }]`.
No `package.json`, no bundler, no vendored library at all — hand-written classic-script JS.

Structure: **one `index.html` + one `app.js` serve both frames**, branched on
`const role = P.view || "main"`; the HTML holds `#main-root` and `#lists-root` and `start()` hides
one. Only the main view calls
`P.state.init({selectedList:"",selectedTag:"",searchText:""}, {restorableKeys:["selectedList","selectedTag"]})`;
every frame reads via `onChange` and writes via `merge`. `load()` subscribes to `onContentChange`
**before** awaiting `getContent()` so a mid-flight push is not missed, then baselines `lastWritten`.
It round-trips `.todo.json` byte-compatibly with the old built-in editor
(`{type:"todo-editor", lists, tags, items, state}`, 4-space JSON, `state` preserved untouched).
Its AiVision model (`app.js` ~340–700) exposes a `TodoApp` root with indexable `lists`/`tags`/
filtered items, three writable selection properties, 13 methods with `signature` + `caution`, and
seven `data-name` controls across both frames via `aiVision.createElements`.

**`sqlite-viewer` — the most non-trivial simple board** (`app.js` 415, `index.html` 227,
`tables.js` 62, `tables.html` 68, `scripts/db-server.mjs` 180, `lib/` with vendored Tabulator
6.5.1 + skin + `vec0.dll` + LICENSE + VERSION.txt). It shows the vendoring pattern (UMD global +
one classic `app.js`), a resident backend process over JSON lines, and a secondary view
coordinated purely through `persephone.state.*`.

### 4.10 Documented board limitations

No remote network at runtime (silent failures, logged to `ui.log`) · no `eval()` · no npm/bundler
inside the board · no auto-reload on file change (use the in-board Reload button or
`pages[i].editor.reload()`) · the manifest is not covered by reload · a board never navigates ·
`persephone.call` cannot reach `main.*` / `windows[i].*` · `aiVision.expose` is main-frame only and
derives indexed shape once (call `remote.refresh()` after an async load) · agent `notify` ≤512
chars, ≤5/min · spawned processes die on unload unless `setBoardBusy(true)` · backend `scripts/`
are **not** sandboxed (full OS privileges — the trust review surface) · no `window.confirm`/`prompt`.

---

## 5. Gaps — what the board API appears unable to do

Ordered by risk. Each is a candidate for an object-model enhancement in the epic plan.

### 5.1 No graph color tokens (must-fix, low effort)
The 14 `--color-graph-*` tokens (§3.5) have no `--p-*` counterpart, and `p-vars.ts` only exports
the general palette. The board must either (a) derive its graph palette from the `--p-*` set and
`persephone.getTheme().isDark`, accepting a visual change across the 10 themes, or (b) Persephone
adds a `--p-graph-*` family to `P_VAR_SOURCES` / `BOARD_TOKEN_VARS`. **Option (b) is the only way
to keep per-theme fidelity.** The canvas path itself is fine — `getTheme()` + `onThemeChange` is
the exact analogue of `resolveColor()` + `themeState`.

### 5.2 No app dialogs (must-fix, medium effort)
The editor uses `showConfirmationDialog` (5 sites, including a **3-button** "Group Options" dialog)
and `showInputDialog` (group title). Boards have **no dialog API and no `window.confirm`/`prompt`**
— the documented answer is an in-board overlay. That means re-implementing a modal component
(~150 LOC) in the board, and per the Todo lesson, **agent-facing actions must not block on it**
(the `*Core` split: `deleteGroupCore(id)` for agents, `deleteGroup(id)` for the UI).

### 5.3 No app popup-menu API (must-fix, medium effort)
`showAppPopupMenu(x, y, items)` backs four context menus with nested submenus, separators,
disabled/invisible items and icons. A board gets only the default native context menu; it must
`preventDefault()` and hand-roll a submenu-capable popup menu (~200 LOC) styled from `--p-*`.
Nothing in `board-base.css`'s `.p-*` layer covers menus.

### 5.4 No alerts bar (small)
`alertsBarModel.addAlert(msg, "warning")` (4 sites) → `persephone.notify(msg, "warning")` is a
direct, documented substitute. **No gap.**

### 5.5 No UIKit (medium effort, mostly mechanical)
Slider, Select (filterable combo), Input, Button, IconButton, Spinner, Panel, Text, keyed-list,
highlight, subtree-swap — all must be rebuilt from `.p-*` classes plus plain DOM. The filterable
**Select** used by the Expansion panel's Root Node picker is the only non-trivial one; the catalog
offers `tom-select` for exactly this.

### 5.6 The two editable data grids (medium — solved, but needs vendoring)
The Links and Properties tabs use `uikit/DataGrid`, a shim over **`av-grid` 2.6.1** with editable
cells, add/delete rows, dropdown cell options, per-cell classes, focus-change callbacks and a
custom context menu. `av-grid` is the boards catalog's **default grid**, published standalone, and
needs no skin (its `--avg-*` tokens fall back to `--p-*`). So the grid itself ports cleanly — but
the board must re-derive the ~300 LOC of shim behavior (the `DataGridView` option tiering) that
Persephone's DataGrid provides today.

### 5.7 Cross-editor page creation is only partially covered (needs verification)
The editor calls `pagesModel.addEditorPage(editorId, language, title, content)` in five places to
create **in-memory, untitled** pages in `md-view`, `grid-json`, `graph-view` and `draw-view`.
A board has:
- `persephone.openRawLink(href, { editor })` — opens a **href**, not in-memory content. For the
  drawing case there is a documented recipe (an image `data:` URL + `{ editor: "draw-view" }`), and
  a `data:text/markdown` URL may cover the markdown cases, but **that is not documented and must be
  verified**; very large graphs would blow up a `data:` URL.
- `persephone.call("pages...")` — **explicitly scoped to the page hosting the board**, so
  `pages.addEditorPage(...)` is *not* reachable.

**This is the clearest object-model gap.** Five features depend on it: tooltip "Open in new page",
selection "Open (markdown)", "Open in grid", "Extract" / "Extract with children" (which must create
a *new `.fg.json` graph page*), and "Open in Drawing Editor". Candidate enhancement: a bridge
method such as `persephone.openContent({ editor, language, title, content })`, or widening
`persephone.call` to reach `pages.addEditorPage`.

### 5.8 Image export (probably fine, verify)
`canvas.toDataURL` / `toBlob` and `navigator.clipboard.write([new ClipboardItem(...)])` are
confirmed to work in a board frame, so **Copy Image** ports directly. **Open in Drawing Editor**
needs both the Excalidraw-document construction (today imported from
`editors/draw/drawExport.buildExcalidrawJsonWithImage` — the board must reimplement that JSON
shape, it is not exported anywhere a board can reach) and the documented
`openRawLink(dataUrl, { editor: "draw-view" })` recipe. Feasible, but it is a reimplementation.

### 5.9 Page toolbar contributions (small — accept a change)
Today the two image buttons sit in the **page toolbar** next to the editor switch via
`TextChromeView.rightToolbarContributions`. A board cannot contribute to Persephone's page toolbar;
it must put them in its own in-frame `.p-toolbar`. Cosmetic, but it changes the documented layout
and the `elements` contract.

### 5.10 Footer status (solved)
`persephone.setStatusText(text)` gives a content-host board the page footer — covers the
"N of M nodes" record count and the warning hint. **No gap.**

### 5.11 `editorSettings` slot for `groupingEnabled` (small)
`mirrorHostSettings` persists `groupingEnabled` in `host.editorSettings["graph-view"]` — i.e.
outside the file, per host, across restarts. A board's equivalent is
`persephone.state.init({ groupingEnabled: true }, { restorableKeys: ["groupingEnabled"] })`, which
persists into the page descriptor. Close enough; slight semantic difference (page-scoped, not
host-scoped).

### 5.12 Keyboard shortcuts (verify)
Ctrl+F, Ctrl+A and Shift-hold are `document`-level listeners inside the frame — those work.
Ctrl+S is already handled by the shim. The one to verify: whether the app intercepts Ctrl+F
(Find) before the board frame sees it.

### 5.13 Agent surface parity (large, but this is the point)
The 521-LOC `GraphEditorFacade` and the ~30 `data-name` elements must be reproduced as an
`aiVision.expose(TodoApp-style root)` + `aiVision.createElements([...])` model, published at
`pages[i].editor.app` instead of `pages[i].editor`. EPIC-098 proved this works and is arguably
*better* (a weak agent drove the Todo board in 14 calls). But it is a rewrite, and the existing
guides (`assets/guides/editors/graph.md`, `formats/graph.md`) and QA surface
(`qa/surfaces/editors/graph.md`) all address `editor.*`, not `editor.app.*` — they must be rewritten
or retired.

Carry-over lessons recorded in EPIC-098 for exactly this migration:
1. an agent-facing destructive action **must not block on an in-board confirm dialog** — split
   `xxxCore()` (agent) from `xxx()` (UI);
2. a UI action whose affordance is "select something first" needs an **explicit argument** for an
   agent (`addChild(parentId)`, `groupSelected(ids)`);
3. a descriptor's **prose is search text** — member summaries must use the words a person would
   type.

### 5.14 Size / effort estimate
Todo went from a built-in editor to **1,350 LOC of `app.js` + 231 CSS + 59 HTML**. Graph is
roughly **6× the built-in size** and adds a canvas renderer, a physics simulation, two editable
grids and a popup-menu system. A realistic board is **4,000–6,000 LOC** plus vendored
`d3-force`/`d3-selection`/`d3-zoom`/`d3-drag` and `av-grid`. The pure-model layer
(`GraphVisibilityModel`, `GraphDataModel`, `GraphGroupModel`, `GraphConnectivityModel`,
`GraphSearchModel`, `GraphHighlightModel`, `shapeGeometry`, `types` ≈ 1,900 LOC) and
`ForceGraphRenderer` (899 LOC) are **framework-free and port almost verbatim** once the 14 colors
and the `d3` import style are resolved — that is ~2,800 of the 8,569 LOC already solved.

### 5.15 The `.fg.json` / `type: force-graph` content-detection loss
The built-in matcher also fires on **content** (`"type":"force-graph"` + `"nodes"` in any JSON),
which is how an agent-generated untitled JSON page gets a Graph switch entry. A board declares only
`fileMasks` — **there is no content-detection field in `board-manifest.json`**. Extracted subgraphs,
`pages.addEditorPage("graph-view", …)` output, and any pasted graph JSON would lose the switch.
This is a real behavioral regression and a second candidate object-model enhancement
(a manifest `contentMasks` / `detectsContent` regex).

---

## 6. The removal template — how the built-in Todo editor was deleted

The built-in Todo editor **no longer exists** in `C:\projects\persephone`. It was removed in
**commit `a2692189` — "US-893: remove the built-in Todo editor"** (2026-07-22):
**53 files changed, 48 insertions, 2,712 deletions.** That commit is the template for the eventual
Graph cleanup. A second, more recent precedent is **EPIC-047** (the PDF viewer), whose task
sequence is the better model for the *whole* migration.

### 6.1 EPIC-047's task sequence (recommended shape for EPIC-FG)

1. Board v1, local files only — *the v1 board is the CSP/feasibility spike, not a throwaway.*
2. Widen `BOARD_CSP` / the object model for what v1 proved necessary.
3. Non-local source support, if needed.
4. Board v2.
5. **Parity verification against the built-in, over a written checklist, *before* anything is
   deleted.** (§1.3 of this document is that checklist.)
6. Publish to the catalog.
7. Remove the built-in.

### 6.2 Files to delete outright
- `src/renderer/editors/graph/` — all 29 files.
- `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts`.
- `src/renderer/api/types/graph-editor.d.ts`.
- `assets/editor-types/graph-editor.d.ts` (build-artifact mirror) **and** its line in
  `assets/editor-types/_imports.txt`.
- `assets/guides/editors/graph.md`, `assets/guides/formats/graph.md`,
  `assets/guides/examples/greek-gods.fg.json`.
- `qa/surfaces/editors/graph.md`.

### 6.3 Registration / wiring sites to edit
| File | What to remove |
|---|---|
| `src/renderer/editors/register-editors.ts` | the `graph-view` registry entry |
| `src/renderer/editors/base/editor-matchers.ts` | `EDITOR_MATCHERS["graph-view"]` **and** the `/\.fg\.json$/i` entry in `SPECIALIZED_JSON_PATTERNS` (dropping it makes `grid-json` a switch option for `.fg.json`) |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | the `targetEditorId === "graph-view"` construction branch + imports (verify — Graph may not have one) |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | `asGraph()` + both imports |
| `src/renderer/api/types/page.d.ts` | the `asGraph(force?)` declaration + `import type` line |
| `src/renderer/api/types/common.d.ts` | `"graph-view"` in the `EditorView` union |
| `src/renderer/theme/language-icons.ts` | the `GraphIcon` component (check other users first) |
| `src/renderer/components/icons/LanguageIcon.tsx` | the `filePatternIcons` entry for `/\.fg\.json$/i` |
| `src/renderer/core/traits/TraitRegistry.ts` | any `TraitTypeId` member the graph editor owns |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | the "Force Graph" creatable entry + icon import |
| `src/main/mcp-http-server.ts` | **four** places: the guide-resource entry, the `read_guide` `z.enum` member *and* its description bullet, the `create_page` description's editor list, the `execute_script` description's facade list |
| `src/renderer/editors/*/` stale comments | anything naming `GraphEditor` as a pattern exemplar (Todo's removal had to fix `FileDiffEditor.ts`) |

### 6.4 Docs to update (`/document`)
`doc/architecture/editors.md` (the editor table + the "native VanillaView bodies" sentence at
line ~108 and the priority-ladder table at ~488), `folder-structure.md`, `key-files.md`,
`scripting.md`, `standards/editor-guide.md`, and any `doc/architecture/diagrams/*.mmd` that names
the editor.

### 6.5 User docs to update (`/userdoc`)
`assets/guides/editors/index.md`, `agents/pages.md`, `scripting/index.md`,
`scripting/api/index.md`, `scripting/api/page.md`, `mcp-setup.md`, root `README.md`, and a
**Breaking Changes** entry in `assets/guides/whats-new.md` pointing users at the board.

### 6.6 Degradations to accept explicitly (the Todo/PDF precedent)
Todo's removal was approved with four recorded decisions (C1–C4); the Graph equivalents are:
- `.fg.json` falls back to **Monaco** (raw JSON) for users without the board; the board declares a
  `minAppVersion`.
- Dropping `.fg.json` from `SPECIALIZED_JSON_PATTERNS` offers **grid-json** as a switch option.
- `.fg.json` shows the generic JSON icon until the board is installed (the board's `icon.svg` then
  wins via `editorPriority`).
- Persisted `graph-view` tabs are dropped on upgrade; saved links with `target: "graph-view"` get
  **no remap**; `page.asGraph()` is removed with **no alias**. (EPIC-047 accepted exactly these
  rather than shipping compat code.)
- The content-detection switch for `"type":"force-graph"` JSON is lost (§5.15) unless the manifest
  gains a content-detection field.

---

## 7. Todo vs. Graph — the delta that is the real risk

| Dimension | Todo board | Graph board |
|---|---|---|
| Built-in size removed | 2,712 deleted lines (8 files) | ~9,350 lines (29 files + facade + typings) |
| Board size | 1,350 LOC `app.js` + 231 CSS + 59 HTML, **one IIFE** | realistically 4,000–6,000 LOC |
| Vendored libraries | **none** | `d3-force` + `d3-selection` + `d3-zoom` + `d3-drag`, and `av-grid` 2.6.1 for the two detail grids — all must be downloaded at author time and committed into `lib/` with LICENSE + VERSION.txt |
| Rendering | plain DOM | **`<canvas>` + a live physics simulation** with hit-testing, zoom/pan transforms, per-frame drawing |
| Theme | CSS `--p-*` only; `getTheme()` never used | **`getTheme()` / `onThemeChange()` are mandatory** — a canvas cannot consume `var(...)`; and the 14 graph colors have no `--p-*` equivalent (§5.1). The `boards-assets` `chart-theme.js` / `mermaid-theme.js` JS-adapter pattern is the precedent |
| Grids | none | two editable av-grid instances with dropdown cells, add/delete rows, dirty/Apply state |
| Menus | none (a `.confirm-overlay` only) | four context menus with nested submenus + a selection menu — must be hand-rolled (§5.3) |
| Dialogs | one in-board confirm overlay | five confirmations (one **3-button**) + one input dialog (§5.2) |
| Cross-editor output | none | five `addEditorPage` calls into `md-view` / `grid-json` / `graph-view` / `draw-view` — **the one hard object-model gap (§5.7)** |
| Secondary views | one (`lists`) | optional — the detail and legend panels could stay in-frame, or move to sidebar panels |
| Agent surface | 13 methods, 7 elements | ~30 facade methods, ~30 elements |
| Performance | trivial | `maxVisible` default 500, BFS visibility, an "expand all" confirmation for large graphs — the simulation must stay smooth inside an iframe |

**Biggest risks, ranked**

1. **Cross-editor page creation (§5.7)** — no board API creates an in-memory page in another
   editor. Five user-facing features depend on it. Needs an object-model enhancement or a
   documented `data:`-URL workaround that has never been verified.
2. **Graph color tokens (§5.1)** — 14 tokens with no `--p-*` counterpart; without a
   `--p-graph-*` family the board's look diverges from the app across 10 themes.
3. **Context menus + dialogs (§5.2, §5.3)** — ~350 LOC of shell functionality that must be
   rebuilt inside the frame, and the EPIC-098 `*Core` split must be applied so agent-facing
   destructive actions never block on an overlay.
4. **Canvas performance inside a board iframe** — never proven for a continuous d3-force
   simulation; the PDF board's "v1 is the spike" model exists exactly for this.
5. **Content detection loss (§5.15)** — a behavioral regression with no current manifest field.

**What is *not* risky:** the pure model layer + renderer (~2,800 LOC) is framework-free and ports
almost verbatim; `av-grid` is the boards catalog's default grid and needs no skin; clipboard image
export works in a board frame; `content-host` + `persephone.host.*` is a direct replacement for
`TextHostEditorModel`; `setStatusText` covers the footer; `notify` covers the alerts bar.

### 7.1 Boards-repo process rules that apply
- `develop` is the working branch, `main` is published; **the merge is the publish trigger**.
- `boards/<id>/board-manifest.json` `version` is the only trigger; a version releases exactly once.
- **Never hand-edit** `boards-manifest.json` or any `versions-manifest.json`.
- Every board needs a `WHATS-NEW.md` whose top heading equals the manifest `version`, and a
  1120×700 `screenshot.png`.
- Scaffold with the `create_board` MCP tool (auto-trusted) — never hand-create the folder.
- Read `guides.agents.boards` **first**; do not design by reverse-engineering existing boards.
- Task tracking in the boards repo is `BT-XXX` under `C:\projects\persephone-boards\doc\`.
- Iterate: edit → `pages[i].editor.reload()` → `browser_*` → screenshot → **check `ui.log` before
  declaring it working**. A manifest change needs untrust/retrust or an app restart.

### 7.2 Open item noted in passing
The Todo board folder is at **1.1.0 / `minAppVersion 5.0.1`** while the published catalog still
advertises **1.0.2**. Publishing it (merge `develop` → `main`) is still an open backlog item and
should not be confused with Graph work.


