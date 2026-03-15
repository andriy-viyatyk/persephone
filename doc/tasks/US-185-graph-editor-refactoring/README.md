# US-185: Graph Editor — Architecture Refactoring

**Epic:** EPIC-006
**Status:** Planned
**Created:** 2026-03-15

## Goal

Refactor the graph editor to reduce class sizes, extract focused responsibilities, eliminate code duplication, and prepare the architecture for upcoming features (node groups, legend property highlighting).

## Background

The graph editor is ~5,000 lines across 12 files. It was built incrementally over 15 tasks (US-170 through US-184), and while individual pieces are well-implemented, the main `GraphViewModel` has grown into a God Object (1,122 lines, 8+ distinct responsibilities). `ForceGraphRenderer` (906 lines) also mixes several concerns. Upcoming features (node grouping, expanded legend) will add significant complexity — refactoring now prevents the codebase from becoming unmanageable.

### Current File Inventory

| File | LOC | Assessment |
|------|-----|------------|
| `GraphViewModel.ts` | 1,122 | **Needs refactoring** — too many responsibilities |
| `ForceGraphRenderer.ts` | 906 | **Moderate** — some extractable concerns |
| `GraphDetailPanel.tsx` | 1,091 | OK internally (sub-components), but has duplicated icon code |
| `GraphVisibilityModel.ts` | 501 | **Good** — focused, clean API |
| `GraphView.tsx` | 708 | OK — React orchestrator |
| `GraphLegendPanel.tsx` | 317 | OK — but has duplicated icon code |
| `GraphTuningSliders.tsx` | 133 | **Good** — small, focused |
| `GraphExpansionSettings.tsx` | 173 | **Good** — small, focused |
| `GraphTooltip.tsx` | 109 | **Good** — small, focused |
| `types.ts` | 102 | **Good** — clean types/utilities |
| `constants.ts` | 31 | **Good** |
| `index.ts` | 3 | OK |

### What's Already Well-Designed

- **GraphVisibilityModel** — well-isolated, focused BFS/visibility concern
- **Three-layer data architecture** — sourceData (clean) → visibility-filtered → renderer
- **Small UI components** — tooltip, sliders, expansion settings
- **types.ts** — clean shared types and utilities
- **Section headers** — code is well-organized within files

## Problems Identified

### Problem 1: GraphViewModel is a God Object (1,122 lines)

`GraphViewModel` handles **8+ distinct responsibilities**:

1. **Content parsing/serialization** — `parseContent()`, `serializeToHost()`, debounced JSON parsing
2. **Node CRUD** — `addNode()`, `deleteNode()`, `renameNode()`, `updateNodeProps()`
3. **Link operations** — `addLink()`, `deleteLink()`, `applyLinkedNodesUpdate()`
4. **Properties editing** — `applyPropertiesUpdate()`
5. **Search logic** — `setSearchQuery()`, `recomputeSearch()`, `matchNodeSearch()`, `revealAndSelectNode()`
6. **Context menu construction** — `handleContextMenu()`, menu items, action dispatch
7. **Legend data management** — `getLegendDescriptions()`, `setLegendDescription()`, `getNodeIdsByLegendFilter()`, `getPresentLevelsAndShapes()`
8. **Visibility orchestration** — `expandNode()`, `collapseNode()`, `resetVisibility()`, delegates to VisibilityModel
9. **Renderer coordination** — passes highlight sets, forwards events
10. **State management** — maintains `GraphViewState` observable

Adding node group management to this class would push it past 1,500 lines.

### Problem 2: Duplicated SVG Icon Code

Shape icon rendering is duplicated in two files:

- `GraphDetailPanel.tsx` (lines 949-997): `ShapeIcon`, `LevelIcon`, `starPoints()`, `hexPoints()`
- `GraphLegendPanel.tsx` (lines 17-85): `ShapeIcon`, `LevelIcon`, `starPoints()`, `hexPoints()`, `compassPoints()`

The two implementations use slightly different parameters (S=16/R=6 vs S=14/R=5) but identical geometry math.

### Problem 3: Repeated Root Node Radius Pattern

This expression appears 6+ times in `ForceGraphRenderer.ts`:

```typescript
const r = this._rootNodeId && d.id === this._rootNodeId ? levelRadii[0] : nodeRadius(d);
```

Lines: 484, 581, 608, 806, 829, 864. Each copy is a maintenance risk — when node groups introduce group-level radius overrides, all 6 spots need updating.

### Problem 4: ForceGraphRenderer Mixes Multiple Concerns

`ForceGraphRenderer` (906 lines) combines:

- **D3 simulation management** (forces, ticks, restart)
- **Canvas rendering** (links, nodes, badges, labels — the `renderData` method alone is 130 lines)
- **Zoom/drag D3 behaviors**
- **Mouse event handling** (click, hover, context menu, dblclick)
- **Node/badge hit-testing** (coordinate transforms, distance checks)
- **Selection/hover state** (activeId, activeChild, hoveredId, hoveredChild, externalHoverId)
- **3 highlight layers** (searchMatches, highlightSet, legendHighlight) with intersection logic
- **Color resolution** (CSS variable → computed value)
- **Shape drawing** (7 shape paths)

This isn't as severe as GraphViewModel because canvas rendering naturally needs tight coupling. But the highlight/selection state + hit-testing can be separated.

### Problem 5: Context Menu Logic in ViewModel

`handleContextMenu()` in GraphViewModel builds menu items, maps actions to operations, and handles async confirmation dialogs. This is UI logic mixed with data operations — makes it harder to test and extend (e.g., adding "Group Selected" menu item).

## Implementation Plan

### Phase A: Extract Shared Icon Utilities (Low risk, quick win)

- [ ] **A1.** Create `graph-icons.tsx` — shared SVG icon components
  - Move `ShapeIcon`, `LevelIcon` to shared file
  - Accept `size` parameter (default 16) to handle the 16px/14px difference
  - Move `starPoints()`, `hexPoints()`, `compassPoints()` as exported helpers
  - Both `GraphDetailPanel.tsx` and `GraphLegendPanel.tsx` import from here
- [ ] **A2.** Deduplicate `starPoints`/`hexPoints` between canvas (`ForceGraphRenderer.drawShape`) and SVG icons
  - The geometry math is identical — share the point-generation functions
  - Canvas uses `ctx.moveTo/lineTo`, SVG uses `<polygon points>` — both consume `[x,y]` arrays
  - Create `shapeGeometry.ts` with pure functions returning point arrays
  - Both `ForceGraphRenderer.drawShape()` and SVG icons call the same geometry functions

### Phase B: Extract GraphDataModel (Core refactoring)

Extract the data layer from `GraphViewModel` into a focused `GraphDataModel` class:

- [ ] **B1.** Create `GraphDataModel.ts` — owns graph source data and CRUD operations
  - **Owns:** `sourceData` (nodes, links, options), node ID generation counter
  - **Methods moved from GraphViewModel:**
    - `addNode()`, `deleteNode()`, `renameNode()`, `updateNodeProps()`
    - `addLink()`, `deleteLink()`, `applyLinkedNodesUpdate()`, `applyPropertiesUpdate()`
    - `cleanNode()` (strip D3 sim properties)
    - Legend methods: `getLegendDescriptions()`, `setLegendDescription()`, `getNodeIdsByLegendFilter()`, `getPresentLevelsAndShapes()`
  - **Change notification:** Receives a `Subscription<void>` via constructor (created by ViewModel). Calls `onChanged.send()` after each mutation. ViewModel subscribes and orchestrates visibility + renderer update.
  - **Does NOT own:** visibility, rendering, serialization to host

- [ ] **B2.** Refactor `GraphViewModel` to delegate to `GraphDataModel`
  - ViewModel creates `Subscription<void>`, passes it to DataModel constructor, subscribes to it
  - React components access DataModel directly via `vm.dataModel` (public readonly property)
  - Parsing (`parseContent`) stays in ViewModel (bridge between content host and data model)
  - Serialization (`serializeToHost`) stays in ViewModel
  - State management stays in ViewModel

**Expected result:** GraphViewModel drops from ~1,122 to ~700 lines. GraphDataModel is ~400 lines, focused purely on data manipulation.

### Phase C: Extract GraphSearchModel (Search concern)

- [ ] **C1.** Create `GraphSearchModel.ts` — owns search state and matching logic
  - **Owns:** `searchQuery`, `searchResults`, `searchInfo`, debounce timer
  - **Methods moved from GraphViewModel:**
    - `setSearchQuery()`, `recomputeSearch()`, `matchNodeSearch()`
    - `revealAndSelectNode()` (coordinates with VisibilityModel)
    - `revealHiddenMatches()`
  - **Dependencies:** receives DataModel and VisibilityModel references via constructor (read access to nodes, hidden/visible state)
  - **Change notification:** Receives a `Subscription` via constructor. Sends search state changes so ViewModel can update renderer highlights.

- [ ] **C2.** Refactor `GraphViewModel` to delegate search to `GraphSearchModel`
  - ViewModel creates SearchModel, passes DataModel + VisibilityModel + Subscription
  - React components access SearchModel directly via `vm.searchModel` (public readonly property)
  - Search-related state fields move to SearchModel
  - ViewModel subscribes and forwards highlight sets to renderer/HighlightModel

**Expected result:** GraphViewModel drops to ~550 lines. GraphSearchModel is ~200 lines.

### Phase D: Extract Context Menu Builder

- [ ] **D1.** Create `GraphContextMenu.ts` — builds context menu items
  - **Moved from GraphViewModel:** `handleContextMenu()` menu construction logic
  - Pure function: `buildContextMenu(nodeId, hasSelection, selectedId) → MenuItem[]`
  - Action handlers still call back to ViewModel/DataModel for actual operations
  - Makes it easy to add "Group Selected", "Ungroup" items later

### Phase E: ForceGraphRenderer Cleanup (Optional, lower priority)

These extractions are beneficial but less critical than B/C:

- [ ] **E1.** Extract `effectiveNodeRadius()` helper to `types.ts`
  - Encapsulates the root-node radius override logic
  - Signature: `effectiveNodeRadius(node: GraphNode, rootNodeId: string): number`
  - Replaces the 6 inline ternary expressions in ForceGraphRenderer
  - Also usable in VisibilityModel if needed

- [ ] **E2.** Extract `GraphHighlightModel` from ForceGraphRenderer
  - Pure class managing all highlight/selection state
  - **Named highlight layers:** internally stores `Map<string, Set<string>>` (e.g., `"search"`, `"legend"`, `"linksTab"`)
  - **API:** `setLayer(name, ids)`, `clearLayer(name)` — each source (search, legend, links tab) manages its own layer independently
  - **Query:** `isHighlighted(nodeId): boolean` — checks all active layers. `computeDimSet(): Set<string> | null` — returns intersection of all active layers (for renderer's alpha dimming pass)
  - **Selection/hover state:** `activeId`, `activeChild`, `hoveredId`, `hoveredChild`, `externalHoverId` with `setActiveId()`, `setHoveredId()`, `setExternalHover()`
  - **Neighbor computation:** `getNeighborIds(nodeId)` moves here (needs link data reference)
  - ForceGraphRenderer owns a `GraphHighlightModel` instance, delegates all highlight queries to it
  - Simplifies renderer: replaces 3 separate `Set<string>` fields + inline intersection logic with single `highlightModel.computeDimSet()` call

## Refactoring Options

### Option 1: Full Refactoring (Phases A → E) — Recommended

Extract all 4 classes + shared utilities. Maximum preparation for future features.

**Pros:**
- GraphViewModel drops to ~550 lines (from 1,122) — clean orchestrator
- Each class has a single clear responsibility
- Easy to add node groups (GraphDataModel handles group data, ContextMenu adds group items)
- Easy to add legend property highlighting (SearchModel + DataModel already provide the infrastructure)
- Eliminates all code duplication

**Cons:**
- More files to navigate (adds ~5 new files)
- Communication overhead between classes (events, callbacks)
- Risk of over-engineering if future features don't materialize

### Option 2: Minimal Refactoring (Phases A + B only)

Extract shared icons + GraphDataModel only. Addresses the biggest pain point.

**Pros:**
- Simpler change, lower risk
- GraphViewModel still drops to ~700 lines
- Enough for node group feature (data model is the key extraction)

**Cons:**
- Search logic (200+ lines) stays in ViewModel
- Context menu stays in ViewModel
- Another refactoring round needed when features pile up

### Option 3: Icons + Search Only (Phases A + C)

Quick wins: deduplicate icons, extract search (which is self-contained).

**Pros:**
- Very low risk — search is already a separable concern
- Immediate code quality improvement
- Good first step before committing to larger refactoring

**Cons:**
- Doesn't address the core problem (CRUD + data in ViewModel)
- Doesn't prepare well for node groups

### Recommendation

**Option 1 (Full)**, implemented in the listed order (A → B → C → D → E). Each phase is independently shippable and testable. If time is limited, stop after Phase B — that's where the biggest structural improvement happens. Phase E is optional and should be evaluated after the others.

## Concerns — Resolved

1. **GraphDataModel change notification pattern** — Use `Subscription<D>` from `core/state/events.ts` for standalone events (e.g., `onDataChanged`). Use `state.subscribe()` if we need reactive state. The `Subscription` class is already used throughout the app and provides typed, clean pub/sub.

2. **Circular dependencies** — GraphDataModel receives a `Subscription` instance via constructor (created and owned by GraphViewModel). DataModel calls `subscription.send(event)` to notify changes. GraphViewModel subscribes. DataModel has zero knowledge of ViewModel — clean one-way dependency.

3. **Phase E (HighlightState)** — Extract a `GraphHighlightModel` pure class that:
   - Internally maintains named highlight sets (`highlightedBySearch`, `highlightedByLegend`, `highlightedByLinksTab`)
   - Exposes `setLayer(name, ids)` / `clearLayer(name)` to add/remove highlighting per source
   - Exposes `isHighlighted(nodeId): boolean` that checks all active layers (intersection when multiple active)
   - Exposes `computeDimSet(): Set<string> | null` for the renderer's alpha pass
   - Also manages selection/hover state (`activeId`, `hoveredId`, neighbor sets)
   - This simplifies ForceGraphRenderer — it just asks `highlightModel.isHighlighted(id)` instead of managing 3 separate `Set<string>` fields with intersection logic

4. **Testing** — Manual testing after refactoring. No automated tests planned for this task.

5. **Submodel access from React components** — Components access sub-models directly as ViewModel properties: `vm.dataModel.someMethod()`, `vm.searchModel.setQuery()`. No need to duplicate wrapper methods in ViewModel. ViewModel exposes sub-models as public readonly properties.

## Implementation Reference

All graph editor files are in `/src/renderer/editors/graph/`.

### Key dependency: Subscription class

Import from `../../core/state/events`:

```typescript
import { Subscription } from "../../core/state/events";
// Usage:
const onChanged = new Subscription<void>("graph-data-changed");
onChanged.subscribe(() => { /* handle change */ });
onChanged.send(); // fire event (no data for void)
```

### Phase A — Exact changes

**A1. Create `graph-icons.tsx`:**

From `GraphDetailPanel.tsx` move (lines 945-1007):
- `ShapeIcon` component (currently accepts `{ shape: NodeShape }`)
- `LevelIcon` component (currently accepts `{ level: number }`)
- `starPoints()`, `hexPoints()` helper functions
- Constants: `S`, `C`, `R`

From `GraphLegendPanel.tsx` move (lines 13-85):
- `ShapeIcon` component (currently accepts `{ shape: NodeShape | "root" }`)
- `LevelIcon` component (currently accepts `{ level: number | "root" }`)
- `starPoints()`, `hexPoints()`, `compassPoints()` helper functions

**Merge into unified components:**
- `ShapeIcon({ shape, size? })` — where `shape: NodeShape | "root"`, `size` defaults to 16
- `LevelIcon({ level, size? })` — where `level: number | "root"`, `size` defaults to 16
- Export `starPoints()`, `hexPoints()`, `compassPoints()` as named exports
- `GraphDetailPanel.tsx` uses `<ShapeIcon shape={shape} />` (size 16, default)
- `GraphLegendPanel.tsx` uses `<ShapeIcon shape={shape} size={14} />` (size 14)

**A2. Create `shapeGeometry.ts`:**

Extract from `ForceGraphRenderer.ts` `drawShape()` method (lines 691-758):
- `getShapePoints(shape, x, y, r): [number, number][]` — returns array of [x,y] points
- Handles: square, diamond, triangle, star, compass, hexagon (circle is special — no points)
- `ForceGraphRenderer.drawShape()` calls `getShapePoints()` then does `ctx.moveTo/lineTo`
- SVG icons in `graph-icons.tsx` call the same for `<polygon points>` generation

### Phase B — Exact method mapping

**Methods moving from `GraphViewModel` to `GraphDataModel`:**

| Method | Lines | Notes |
|--------|-------|-------|
| `addNode(worldX, worldY)` | 733-745 | DataModel version won't take world coords — those are renderer concern. DataModel just does `addNode(id?)` → returns id. ViewModel handles position hint. |
| `deleteNode(nodeId)` | 747-763 | Move as-is. Doesn't clear renderer selection — ViewModel does that. |
| `addChild(parentId)` | 790-800 | Move as-is minus renderer/rebuild/serialize calls. |
| `addLink(sourceId, targetId)` | 765-773 | Move as-is minus rebuild/serialize. |
| `deleteLink(sourceId, targetId)` | 775-788 | Move as-is minus rebuild/serialize. |
| `renameNode(oldId, newId)` | 691-727 | Complex — touches visibility model and renderer. DataModel handles only sourceData mutation (rename in nodes, links, options.rootNode). Returns boolean. ViewModel handles visibility, renderer position, rebuild. |
| `updateNodeProps(nodeId, props)` | 672-689 | DataModel mutates node. ViewModel handles rebuild/serialize/refresh. |
| `applyPropertiesUpdate(nodeId, propsToSet, keysToRemove)` | 962-982 | Move data mutation. ViewModel handles rebuild/serialize/refresh. |
| `applyLinkedNodesUpdate(selectedNodeId, rows, originalIds)` | 994-1036 | Move data mutation (including `removeLinkSmart`, `applyRowPropsToNode`). ViewModel handles rebuild/serialize/refresh. |
| `cleanNode(node)` | 934-942 | Move as-is (pure function on data). |
| `computeLinkedNodes(nodeId)` | 944-950 | Move as-is. |
| `generateNodeId()` | 1083-1089 | Move as-is. |
| `linkExists(aId, bId)` | 1091-1097 | Move as-is. |
| `getNeighborIdsFromSource(nodeId)` | 1099-1108 | Move as-is. |
| `getNodeLabel(nodeId)` | 1110-1113 | Move as-is. |
| `removeLinkSmart(aId, bId)` | 1043-1065 | Move as-is (private helper). |
| `applyRowPropsToNode(node, row)` | 1068-1077 | Move as-is (private helper). |
| `getLegendDescriptions()` | 262-264 | Move as-is. |
| `setLegendDescription(tab, key, value)` | 267-299 | Move data mutation. ViewModel handles serialize. |
| `getNodeIdsByLegendFilter(filter)` | 302-332 | Needs visible nodes — receives them as parameter or reads from renderer. |
| `getPresentLevelsAndShapes()` | 335-353 | Same — needs visible nodes. |

**Methods staying in `GraphViewModel`:**
- `onInit()`, `onContentChanged()`, `onDispose()` — lifecycle
- `parseContent()`, `parseDebounced()` — parsing
- `serializeToHost()` — serialization
- `rebuildAndRender()` — orchestration pipeline
- `refreshColors()` — theme delegation
- `updateForceParams()`, `resetForceParams()` — force tuning (reads/writes options + delegates to renderer)
- `setRootNode()`, `getExpansionOptions()`, `updateExpansionOptions()`, `getAllNodes()` — expansion UI
- `handleHoverChanged()`, `clearTooltip()`, `updateStatusHint()` — tooltip
- `handleSelectionChanged()`, `refreshSelectedNode()` — selection state
- `handleBadgeExpand()`, `expandNode()`, `expandNodeDeep()`, `collapseNode()`, `expandAll()`, `resetVisibility()` — visibility orchestration
- `setHighlightSet()`, `setExternalHover()`, `setLegendHighlight()` — highlight delegation
- Properties: `hasVisibilityFilter`, `totalNodeCount`, `recordsCount`, `isEmpty`, `rootNodeId`

**GraphDataModel constructor:**
```typescript
class GraphDataModel {
    private onChanged: Subscription<void>;
    sourceData: SourceData | null = null;   // public — ViewModel reads it for serialize/parse

    constructor(onChanged: Subscription<void>) {
        this.onChanged = onChanged;
    }
    // ... methods
}
```

**ViewModel wiring pattern:**
```typescript
// In GraphViewModel:
private _dataChangedSub = new Subscription<void>("graph-data-changed");
readonly dataModel = new GraphDataModel(this._dataChangedSub);

protected onInit(): void {
    this.addSubscription(
        this._dataChangedSub.subscribe(() => this.onDataChanged()).unsubscribe
    );
    // ...
}

private onDataChanged(): void {
    this.rebuildAndRender();
    this.serializeToHost();
    this.refreshSelectedNode();
}
```

**Note on `rebuildAndRender` / `serializeToHost`:** Some DataModel mutations need different rebuild parameters (anchorNodeId, newNodePositions, ensureVisible). The DataModel's `onChanged` event is too coarse for this. Two approaches:
- **Option A (simpler):** DataModel methods don't fire `onChanged`. Instead, ViewModel calls DataModel method, then explicitly calls `rebuildAndRender()` + `serializeToHost()` itself. DataModel is a passive data store.
- **Option B:** `Subscription<DataChangeEvent>` with details about what changed.

**Recommend Option A** — ViewModel calls are already structured this way. DataModel is just a data container with mutation methods. No event firing needed. Remove the `Subscription` from DataModel constructor — it's not needed.

### Phase C — Exact method mapping

**Move from `GraphViewModel` to `GraphSearchModel`:**

| Method/Field | Lines | Notes |
|-------------|-------|-------|
| `matchNodeSearch()` (module-level fn) | 56-87 | Move as-is (pure function, currently not a class method) |
| `setSearchQuery(query)` | 359-362 | Owns searchQuery state |
| `recomputeSearch()` | 394-438 | Needs visible nodes from renderer + hidden nodes from visibility model |
| `revealAndSelectNode(nodeId)` | 380-392 | Needs visibility model + renderer |
| `revealHiddenMatches()` | 364-378 | Needs visibility model + renderer |

**Search state types to move:** `SearchInfo`, `SearchPropertyMatch`, `SearchResult` interfaces (lines 13-35).

**GraphSearchModel dependencies:**
- Reads `renderer.getNodes()` for visible nodes
- Reads `visibilityModel.getHiddenNodes()`, `.isNodeVisible()`, `.revealPaths()`, `.getVisibleGraph()` for hidden node handling
- Calls `renderer.setSearchMatches()` to update canvas highlighting
- Calls `renderer.selectNode()` for revealAndSelect
- Calls `renderer.updateVisibleData()` after revealing hidden nodes

**Simplest approach:** Pass renderer + visibilityModel references to SearchModel constructor. SearchModel directly calls them.

**State fields removed from GraphViewState:** `searchQuery`, `searchInfo`, `searchResults`. SearchModel maintains its own `TOneState` or exposes these as plain properties that ViewModel reads when building state.

**Alternative (simpler):** SearchModel doesn't own state. It just has methods that ViewModel calls, and ViewModel keeps the state fields. This avoids splitting the state object. SearchModel is a logic helper, not a state owner.

### Phase D — Exact changes

**Create `GraphContextMenu.ts`:**

Move from `GraphViewModel.handleContextMenu()` (lines 584-620) + `handleAltClick()` (lines 626-637):

```typescript
// GraphContextMenu.ts
import type { MenuItem } from "../../components/overlay/PopupMenu";

interface ContextMenuActions {
    addNode: (worldX: number, worldY: number) => void;
    addChild: (parentId: string) => void;
    deleteNode: (nodeId: string) => void;
    deleteLink: (sourceId: string, targetId: string) => void;
    setRootNode: (nodeId: string) => void;
    collapseNode: (nodeId: string) => void;
}

export function buildNodeContextMenu(
    nodeId: string,
    neighborIds: string[],
    getNodeLabel: (id: string) => string,
    isRoot: boolean,
    hasVisibilityFilter: boolean,
    actions: ContextMenuActions,
): MenuItem[] { ... }

export function buildEmptyAreaContextMenu(
    worldX: number, worldY: number,
    actions: ContextMenuActions,
): MenuItem[] { ... }
```

ViewModel's `handleContextMenu()` becomes:
```typescript
private handleContextMenu(nodeId: string, clientX: number, clientY: number): void {
    this.clearTooltip();
    const items = nodeId
        ? buildNodeContextMenu(nodeId, this.dataModel.getNeighborIdsFromSource(nodeId), ...)
        : buildEmptyAreaContextMenu(worldX, worldY, ...);
    showAppPopupMenu(clientX, clientY, items);
}
```

### Phase E — Exact changes

**E1. Add to `types.ts`:**
```typescript
export function effectiveNodeRadius(node: GraphNode, rootNodeId: string): number {
    return rootNodeId && node.id === rootNodeId ? levelRadii[0] : nodeRadius(node);
}
```

Replace all 6 occurrences in `ForceGraphRenderer.ts`.

**E2. Create `GraphHighlightModel.ts`:**
```typescript
export class GraphHighlightModel {
    private layers = new Map<string, Set<string>>();

    activeId = "";
    activeChild = new Set<string>();
    hoveredId = "";
    hoveredChild = new Set<string>();
    externalHoverId = "";
    hoveredBadgeNodeId = "";

    setLayer(name: string, ids: Set<string> | null): void { ... }
    clearLayer(name: string): void { ... }
    computeDimSet(): Set<string> | null { ... } // intersection logic from renderData

    setActiveId(id: string, links: GraphLink[]): void { ... } // computes activeChild
    setHoveredId(id: string, links: GraphLink[]): void { ... } // computes hoveredChild
    setExternalHover(id: string, links: GraphLink[]): void { ... }

    nodeColor(node: GraphNode, colors: ResolvedColors): string { ... }
    nodeBorderColor(node: GraphNode, colors: ResolvedColors): string { ... }
    linkColor(link: GraphLink, colors: ResolvedColors): string { ... }

    clearSelectionIf(nodeIds: Set<string>): void { ... } // clear active/hovered if not in set
}
```

ForceGraphRenderer replaces:
- Fields: `activeId`, `activeChild`, `hoveredId`, `hoveredChild`, `externalHoverId`, `hoveredBadgeNodeId`, `searchMatches`, `highlightSet`, `legendHighlight` → single `highlight: GraphHighlightModel`
- `setActiveId()` → `highlight.setActiveId(id, this.graphData.links)`
- `setHoveredId()` → `highlight.setHoveredId(id, this.graphData.links)`
- `setSearchMatches()` → `highlight.setLayer("search", ids)`
- `setHighlightSet()` → `highlight.setLayer("linksTab", ids)`
- `setLegendHighlight()` → `highlight.setLayer("legend", ids)`
- `renderData()` dim logic → `highlight.computeDimSet()`
- Color methods → `highlight.nodeColor()`, `highlight.linkColor()`, etc.

### Call sites to update in React components

**GraphView.tsx:**
After Phase B, these calls route through `vm.dataModel`:
- `vm.updateNodeProps(...)` → `vm.dataModel.updateNodeProps(...)` then ViewModel rebuilds (or keep wrapper)
- `vm.renameNode(...)` → stays on `vm` (complex orchestration)
- `vm.applyLinkedNodesUpdate(...)` → stays on `vm` (orchestration)
- `vm.applyPropertiesUpdate(...)` → stays on `vm` (orchestration)

After Phase C, search calls route through `vm.searchModel`:
- `vm.setSearchQuery(...)` → `vm.searchModel.setSearchQuery(...)`
- `vm.revealAndSelectNode(...)` → `vm.searchModel.revealAndSelectNode(...)`
- `vm.revealHiddenMatches()` → `vm.searchModel.revealHiddenMatches()`

**GraphLegendPanel.tsx:**
After Phase B:
- `vm.getLegendDescriptions()` → `vm.dataModel.getLegendDescriptions()`
- `vm.setLegendDescription(...)` → `vm.dataModel.setLegendDescription(...)` (ViewModel handles serialize)
- `vm.getNodeIdsByLegendFilter(...)` → `vm.dataModel.getNodeIdsByLegendFilter(...)`
- `vm.getPresentLevelsAndShapes()` → `vm.dataModel.getPresentLevelsAndShapes()`

**GraphExpansionSettings.tsx:**
- `vm.getExpansionOptions()` — stays on vm
- `vm.getAllNodes()` — stays on vm (or move to dataModel)
- `vm.setRootNode(...)` — stays on vm
- `vm.updateExpansionOptions(...)` — stays on vm

**GraphTuningSliders.tsx:**
- `vm.renderer.forceParams` — no change
- `vm.updateForceParams(...)` — stays on vm
- `vm.resetForceParams()` — stays on vm

### New files created by this task

| File | Phase | Purpose |
|------|-------|---------|
| `graph-icons.tsx` | A | Shared ShapeIcon, LevelIcon, geometry helpers |
| `shapeGeometry.ts` | A | Pure shape point generation (optional — can be in graph-icons.tsx) |
| `GraphDataModel.ts` | B | Source data ownership + CRUD + legend data |
| `GraphSearchModel.ts` | C | Search query, matching, results |
| `GraphContextMenu.ts` | D | Context menu item builders |
| `GraphHighlightModel.ts` | E | Highlight layers + selection/hover state |

## Acceptance Criteria

- [ ] No duplicated SVG icon/geometry code between DetailPanel and LegendPanel
- [ ] `GraphViewModel` is under 600 lines
- [ ] New `GraphDataModel` class owns all node/link CRUD and legend data operations
- [ ] New `GraphSearchModel` class owns search query, matching, and results
- [ ] Context menu construction is in its own module
- [ ] Root node radius pattern is not repeated inline
- [ ] All existing functionality works identically (manual testing: add/delete/rename nodes, search, legend, expand/collapse, context menu, detail panel)
- [ ] No new runtime dependencies introduced
