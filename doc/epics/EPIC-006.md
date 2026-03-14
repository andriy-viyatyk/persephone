# EPIC-006: Graph Editor (Force Graph)

## Status

**Status:** Active
**Created:** 2026-03-12

## Overview

Add a new force-graph editor for `.fg.json` files. The editor renders interactive force-directed graphs using D3 force simulation on an HTML canvas. The implementation is based on `GraphView` from the `interactive-script` project but will be enhanced over time with full editing capabilities.

## Goals

- **Phase 1 (View Only):** Reimplement the existing `ForceGraph` renderer as a content-view editor in js-notepad, associated with `.fg.json` files *(Done)*
- **Phase 2 (Enhanced Rendering + Interactions):** Node differentiation (title, level, shape), search, tooltips, collapse/expand, context menu, detail panel, editing interactions

## Data Format

`.fg.json` files contain a force graph structure:

```json
{
  "type": "force-graph",
  "nodes": [
    { "id": "AppRoot", "title": "Application Root", "level": 1, "shape": "diamond" },
    { "id": "PageA", "title": "Page A", "level": 2 },
    { "id": "ButtonX", "level": 4, "description": "Primary action button" }
  ],
  "links": [
    { "source": "AppRoot", "target": "PageA" },
    { "source": "PageA", "target": "ButtonX" }
  ],
  "options": {
    "rootNode": "AppRoot",
    "expandDepth": 3,
    "maxVisible": 500,
    "charge": -70,
    "linkDistance": 40,
    "collide": 0.7
  }
}
```

**Core properties** (required):
- `type` — `"force-graph"` (required, used for content-based editor detection)
- `nodes[].id` — unique string identifier
- `links[].source` / `links[].target` — node IDs

**Presentation properties** (optional, affect rendering):
- `nodes[].title` — display label (falls back to `id` if absent)
- `nodes[].level` — integer 1-5, controls node size (1 = largest/most important)
- `nodes[].shape` — `circle` (default), `square`, `diamond`, `triangle`, `star`, `hexagon`

**Custom properties** (optional, user-defined):
- Any other key-value pairs on nodes (e.g., `description`, `version`, `owner`)
- Displayed in tooltip and detail panel

**Options** (optional):
- `options.rootNode` — root node ID for BFS expansion. Default: first node with lowest level, or first node. Visually distinguished with compass star shape and level-1 size.
- `options.expandDepth` — BFS depth from root for initial expansion. Default: unlimited.
- `options.maxVisible` — max initially visible nodes. Default: 500.
- `options.charge` — force charge strength. Default: -70.
- `options.linkDistance` — link distance. Default: 40.
- `options.collide` — collide force strength (0-1). Default: 0.7.

**Not using node colors** — colors are reserved for selection/hover states to avoid confusion.

## Source Reference

Original implementation from `D:\projects\interactive-script\webview-ui\src\`:
- `controls/ForceGraph/ForceGraph.tsx` — React canvas component
- `controls/ForceGraph/ForceGraphModel.ts` — D3 simulation, zoom, drag, rendering
- `controls/ForceGraph/types.ts` — Node, Link, GraphData types
- `controls/ForceGraph/constants.ts` — Force simulation parameters
- `components/GraphView/GraphView.tsx` — View wrapper
- `components/GraphView/GraphViewModel.ts` — Data loading

Sample data file: `D:\js-notepad-notes\temp\miserables.fg.json`

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-170 | Force Graph viewer — read-only (Phase 1) | Done |
| US-171 | Node properties: title, level, shape | Done |
| US-172 | Collapse/expand with BFS + options | Done |
| US-173 | Search with node dimming | Done |
| US-174 | Node tooltips (HTML overlay) | Done |
| US-175 | Context menu + basic editing (add/delete/link) | Done |
| US-176 | Detail panel — panel shell + Info tab | Done |
| US-177 | Force tuning panel (charge, link distance, collide sliders) | Done |
| US-178 | Detail panel — Links tab (AVGrid) | Done |
| US-179 | Detail panel — Properties tab (AVGrid) | Done |
| US-181 | Graph search enhancement — multi-word, properties, results panel | Done |
| US-182 | Graph settings persistence, expansion UI, root node | Done |
| US-180 | Graph editor — polish & enhancements | Done |
| US-183 | Graph editor — adjustments & fixes | Done |
| US-184 | Graph editor — Legend panel | Done |

## Phase 2 — Planned Scope

### US-171: Node properties — title, level, shape

- Add `title`, `level`, `shape` to `GraphNode` type
- Render `title` (fallback to `id`) as label text
- Size nodes by `level` (1=largest, 5=smallest) using per-node radius in `forceCollide`
- Draw shapes: circle (default), square, diamond, triangle, star, hexagon
- Always show labels for level 1-2 nodes (not just on hover/select)

### US-172: Collapse/expand with BFS + options

- Parse `options` from JSON (`rootNode`, `expandDepth`, `maxVisible`)
- Defaults: `rootNode` = first node with lowest level or first node; `expandDepth` = undefined; `maxVisible` = 500
- BFS from root node, assign `_$showIndex` to every node
- `GraphVisibilityModel` sub-model: BFS, adjacency, expand/collapse, visible set
- Only pass visible nodes/links to D3 simulation (shallow copies to avoid immer freeze)
- Draw "+" badge on nodes with hidden neighbors (clickable, with hover highlight)
- **Badge click** → expand (reveal hidden neighbors near clicked node)
- Collapse deferred to context menu (US-175)
- Small graphs (total <= maxVisible) render entirely, no filtering needed
- Toolbar: "Reset View" button

### US-173: Search with node dimming

- Search input field (in toolbar or floating)
- Filter-as-you-type: match against `title` (fallback to `id`)
- Non-matching nodes rendered at reduced opacity (dimming)
- Matching nodes keep full opacity, preserving their selection/hover state
- Clear search restores all nodes to full opacity

### US-174: Node tooltips (HTML overlay)

- HTML `div` overlay positioned at cursor (not canvas-drawn)
- Show after ~500ms hover delay, hide on mouse leave
- Display: `title`, `id`, and list of custom properties (key-value pairs)
- Do not show `level`, `shape` in tooltip (visual from the node itself)
- Account for zoom/pan transform when positioning

### US-175: Context menu + basic editing (add/delete/link)

- **Right-click empty area** → "Add node" (creates node at click position, generates ID)
- **Right-click node** → "Add child" (creates linked node), "Delete" (removes node + its links)
- **Alt+Click** node → toggle link with currently selected node (no-op if clicking selected node)
- All edits serialize back to JSON content via `host.changeContent()`
- Editing changes reflected immediately in canvas

### US-176: Detail panel — panel shell + Info tab

- Collapsible overlay panel at top-right corner
- Collapsed: only header with node title visible; expanded: full editing UI
- Tab bar (Info / Links / Properties) — only Info tab implemented, others placeholder
- **Info tab** — edit id, title, level (dropdown 1-5), shape (dropdown)
- Updates when selection changes (click node)
- Editing in panel immediately updates canvas rendering and JSON content

### US-177: Force tuning panel (charge, link distance, collide sliders)

- Collapsible panel at top-left corner, triggered by a gear/sliders icon button
- 2-3 range sliders: charge strength, link distance, collide strength
- Sliders adjust forces in real-time (simulation restarts on change)
- "Reset" button to restore defaults
- Panel state is transient — not saved to JSON

### US-178: Detail panel — Links tab (AVGrid)

- Links tab with AVGrid showing connected links (neighbor ID, direction)
- Add link row — type a node ID, validates target exists, prevents duplicates/self-links
- Delete link rows (Ctrl+Delete)
- Copy/paste support from Excel — bulk-add links by pasting node IDs
- Changes immediately update canvas + JSON

### US-179: Detail panel — Properties tab (AVGrid)

- Properties tab with AVGrid (key, value columns) for custom node properties
- Shows all non-core properties (excludes id, title, level, shape, _$ runtime props)
- Add/delete property rows
- Copy/paste range of key-value pairs from spreadsheet
- Inline editing — double-click cell to edit
- Changes immediately update canvas + JSON

### US-180: Graph editor — polish & enhancements

Final polish task for the epic. Known items:
- "Expand All" button on toolbar
- Ctrl+Click on badge → recursive expand all children
- Additional items TBD from review and testing

### Interactions summary

| Action | Behavior |
|--------|----------|
| Click node | Select, highlight neighbors, update detail panel |
| Ctrl+Click "+" node | Expand hidden neighbors |
| Ctrl+Click visible node | Collapse subtree behind node |
| Alt+Click node | Toggle link with selected node |
| Right-click empty area | Context menu: "Add node" |
| Right-click node | Context menu: "Add child", "Delete" |
| Hover node (500ms) | Show tooltip |

## Discovery — Design Discussion (2026-03-12)

### Use Cases

- **Dependency graphs** — application components, module imports, package dependencies
- **Knowledge graphs** — entities with relationships (e.g., people, concepts, systems)
- **Read-only visualization** — embedding in LogView or other editors for generated output

### Node Properties (Three Tiers)

**Core** (required for graph structure):
- `id` — unique string identifier (required)
- `links[].source` / `links[].target` — node IDs (required)

**Presentation** (affect rendering):
- `title` — display label (falls back to `id` if absent)
- `level` — integer 1-5, controls node size (1 = largest/most important)
- `shape` — `circle` (default), `square`, `diamond`, `triangle`, `star`, `hexagon`
- `color` — optional custom fill color override

**Custom** (user-defined, displayed in panel/tooltip):
- Arbitrary key-value pairs, stored alongside core/presentation properties
- Shown in detail panel and tooltip

**Link presentation properties** (future consideration):
- `style` — solid (default), dashed, dotted
- `thickness` — line weight
- `label` — text displayed on the link
- `directed` — boolean, show arrowhead

### Node Differentiation

- **Size by level** — D3 `forceCollide` accepts per-node radius function, so different sizes work naturally with physics
- **Shapes** — canvas can draw circle, square, diamond, triangle, star, hexagon; collision radius stays circular (D3 limitation) but visually works fine
- **Border style** — dashed vs solid for different node categories
- **Icons/letters inside nodes** — single-letter labels (e.g., "C" for component, "M" for module)
- **Always-visible labels** for level 1-2 nodes (currently labels only show on hover/select)

### Coloring Strategy

Concern: selection/hover colors override node colors, making them indistinguishable.

**Layered approach:**
1. **Fill color** = node's own color (by category, custom, or default)
2. **Border/ring** = selection state (thick colored ring for selected, different ring for hovered)
3. **Dimming** = search (non-matched nodes go semi-transparent, preserving node colors)

The dimming approach for search is better than coloring matches — similar to VS Code minimap highlighting.

### Search

- Filter-as-you-type: dim non-matching nodes
- Auto-center/zoom to matched nodes
- Next/prev match navigation for multiple results

### Tooltips

- HTML overlay `div` positioned at cursor (not drawn on canvas) — allows rich formatting, text selection
- Show after ~500ms hover delay
- Display: title, id, level, shape, and list of custom properties

### Context Menus

- HTML overlay via existing `showPopupMenu` infrastructure
- Map canvas coordinates to screen coordinates (already have transform math in `findNode`)
- Node context menu: "Edit", "Link with...", "Unlink", "Delete", "Add child"
- Empty area context menu: "Add node"

### Detail Panel (Collapsible Overlay)

- Attached to a corner (top-right or bottom-right)
- Collapsed: only header visible; expanded: full editing UI
- Updates when selection changes
- Sub-tabs:
  - **Info** — edit id, title, level, shape, color
  - **Links** — AVGrid with linked node names (supports Excel copy-paste for bulk operations)
  - **Properties** — custom key-value pairs editor

### Editing Interactions

- **Right-click empty area** → "Add node" → panel expands with generated id
- **Right-click node** → context menu (edit, link, unlink, delete)
- **Click node** → select, panel updates with node info
- **Ctrl+Click** → toggle link between clicked node and selected node
- **Alt+Drag** from node to node → create link (rubber-band visual feedback)
- **Shift+Click** → add to multi-selection
- Editing in panel immediately updates the canvas rendering

### Architecture — Read-only vs Editable

**Submodel composition** (like Browser editor):

```
ForceGraphRenderer          — canvas drawing, zoom, pan (exists)
GraphSimulationModel        — D3 forces, node physics
GraphInteractionModel       — hover, select, search, tooltip
GraphEditModel              — add/remove/edit nodes & links, undo/redo
GraphViewModel              — composes above, serializes to JSON
```

Read-only mode: omit `GraphEditModel`. For LogView embedding: use `ForceGraphRenderer` + `GraphSimulationModel` directly.

### Performance & Large Graphs

D3 force simulation on canvas handles ~1000 nodes well; beyond that, performance degrades. More importantly, graphs with too many visible nodes are not useful for human analysis — it becomes impossible to trace paths and understand dependencies. The graph should be a tool for understanding, not decoration.

**Design principle:** Keep visible node count manageable (under ~1000) via collapse/expand. WebGL (e.g., Cosmograph/cosmos) could handle 100k+ nodes but offers less flexibility for custom shapes, tooltips, and editing interactions. Not needed for our use cases.

**Other rendering optimizations** (complement collapse/expand):
- **Level-of-detail** — at low zoom, render distant nodes as simple dots (no labels, simpler shapes). Partially done already (labels at zoom > 0.8).
- **Viewport culling** — only draw nodes visible in the current viewport. D3 still simulates all but canvas skips off-screen nodes.

### Collapse/Expand Design

#### Data options

Optional `options` object in the JSON data provides hints for the initial view:

```json
{
  "type": "force-graph",
  "nodes": [...],
  "links": [...],
  "options": {
    "rootNode": "MainComponent",
    "expandDepth": 3,
    "maxVisible": 200
  }
}
```

- `rootNode` — ID of the root node for BFS expansion. If not provided, use the node with lowest level, or first node. Visually distinguished with compass star shape.
- `expandDepth` — BFS depth from root node for initial expansion. If omitted, expand until `maxVisible` is reached.
- `maxVisible` — hard ceiling on initially visible nodes (default: 200). `expandDepth` is a soft limit; `maxVisible` always wins.
- Both are optional and work independently or together.

**Small graphs** (total nodes <= maxVisible) render entirely — no collapse, no configuration needed. Collapse/expand only activates for larger graphs.

#### BFS collection algorithm

1. Start from root node, assign `showIndex = 0`
2. BFS: iterate over level 1 neighbors → assign `showIndex = 1, 2, 3, ...`, then level 2, etc.
3. Stop when `maxVisible` is reached OR `expandDepth` levels are exhausted (whichever comes first)
4. Every node in the full graph gets a `showIndex` (BFS discovery order) — this is computed once on data load
5. Only nodes collected within the limit are passed to D3 simulation and rendered

#### Visual indicators

- Nodes with hidden neighbors show a "+" indicator (small circle or icon)
- Hidden neighbor count could be shown as a badge (e.g., "+5")

#### Expand interaction (Ctrl+Click on "+" node)

- Reveal hidden direct neighbors of the clicked node
- Newly revealed nodes may also show "+" if they have their own hidden neighbors
- Allow exceeding `maxVisible` — the limit is for initial load only, user expansion is intentional

#### Collapse interaction (Ctrl+Click on visible node without "+")

Collapse hides the "subtree behind" the clicked node using cascading hide:

```
collapse(clickedNode):
    toHide = set()
    queue = [neighbors of clickedNode where showIndex > clickedNode.showIndex]
    while queue not empty:
        n = dequeue
        if n in toHide: continue
        toHide.add(n)
        for neighbor of n where showIndex > clickedNode.showIndex:
            queue.add(neighbor)
    hide all nodes in toHide
    clickedNode now shows "+" indicator
```

This uses the BFS `showIndex` to determine direction: only hide nodes "further from root" (higher showIndex) than the clicked node. Cascading ensures no orphaned visible nodes remain disconnected from the focus.

**Edge case — shared nodes:** If node C is reachable from both A and B, and user collapses B, C gets hidden (its showIndex > B's). Node A then shows "+" because its neighbor C is now hidden. User can re-expand C from A.

#### Toolbar controls

- "Show All" button (with warning if > 1000 nodes)
- "Reset View" — return to initial collapse state (re-run BFS from root node with original options)
- Right-click node → "Set as Root" — set this node as the root for BFS expansion

#### Architecture notes

- Collapse state is **transient** — not saved to JSON. Only `options.rootNode`/`expandDepth`/`maxVisible`/physics params are persisted.
- The full graph is always in memory; collapse only affects which nodes/links are passed to the D3 simulation.
- `showIndex` is computed once per data load (O(n) BFS), stored as a `Map<string, number>`.

### Reference Applications

- **Obsidian** — knowledge graph view, closest to our use case. Search highlighting, zoom, node sizing. Read-only.
- **Neo4j Browser** — graph database explorer. Colored nodes by label, expandable relationships, property panel on selection.
- **Gephi** — desktop graph visualization. Level-based sizing, multiple layouts, filters.

### Reference Open Source Projects

- **[force-graph](https://github.com/vasturiano/force-graph)** — 2D/3D force graph on D3. Node shapes, link arrows, tooltips, click handlers. Mature API, good feature reference.
- **[cosmograph](https://cosmograph.app/)** (`@cosmograph/cosmos`) — GPU-accelerated, handles millions of nodes.
- **[reagraph](https://github.com/reaviz/reagraph)** — React + WebGL graph. Clustering, selections, context menus.
- **[Sigma.js](https://www.sigmajs.org/)** — WebGL renderer, handles large graphs. Node shapes, search, hover panels.
- **[Cytoscape.js](https://js.cytoscape.org/)** — full graph theory library. Compound nodes, multiple layouts, extensive styling.

### Open Questions

1. ~~Should we invest in collapse/expand before editing?~~ **Resolved:** Yes, collapse/expand is a view-layer concern (transient state, not saved to JSON). Designed with BFS showIndex approach — doesn't block editing work.
2. Is undo/redo needed from the start, or can it be added later?
3. Should the detail panel be part of the graph editor or a reusable component?
4. For LogView embedding — what data would scripts generate as force graphs? What's the API shape?
5. ~~Performance ceiling?~~ **Resolved:** Stay under ~1000 visible nodes via collapse/expand. Larger graphs are not useful for human analysis. WebGL (Cosmograph) explored and rejected — less flexible for our editing/interaction needs.

## Notes

### 2026-03-12
- Phase 1 (US-170) complete — read-only force graph viewer with zoom, pan, drag, click-to-select, hover-to-highlight
- Discovery phase started — exploring editing capabilities, node differentiation, performance strategies
- Using `d3`, `d3-zoom`, `d3-drag` dependencies (lazy-loaded with editor)
- US-171 complete — `NodeShape` type, `title`/`level`/`shape` optional properties on `GraphNode`; `nodeLabel()` and `nodeRadius()` helpers; `drawShape()` for 6 shapes; per-node radius in collision/hit-testing; always-visible labels for level 1-2 nodes
