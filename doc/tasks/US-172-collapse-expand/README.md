# US-172: Collapse/expand with BFS + options

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Parse `options` from JSON data (`focus`, `expandDepth`, `maxVisible`), compute BFS discovery order from focus node, filter visible nodes/links, draw "+" indicators on nodes with hidden neighbors, and support Ctrl+Click to expand/collapse subtrees.

## Background

### Current state
- `GraphData` has `nodes` and `links` — no `options` field
- `GraphViewModel.parseContent()` deep-copies the full graph and passes it to `ForceGraphRenderer.updateData()`
- The renderer stores a single `graphData` and renders all nodes/links
- No concept of visibility filtering or collapse/expand
- `onClick` handler just sets `activeId` for selection highlighting
- D3 drag uses `filter: event.button === 0` — Ctrl+Click would also trigger drag (needs fix)
- Test data: 77 nodes / 254 links (well under default 500 maxVisible)

### Key files
- [types.ts](../../../src/renderer/editors/graph/types.ts) — `GraphNode`, `GraphLink`, `GraphData`, helper functions
- [ForceGraphRenderer.ts](../../../src/renderer/editors/graph/ForceGraphRenderer.ts) — D3 simulation + canvas rendering (532 lines)
- [GraphViewModel.ts](../../../src/renderer/editors/graph/GraphViewModel.ts) — JSON parsing → `GraphData`, passes to renderer
- [GraphView.tsx](../../../src/renderer/editors/graph/GraphView.tsx) — React component
- [constants.ts](../../../src/renderer/editors/graph/constants.ts) — `forceProperties`

### D3 link resolution
After `d3.forceLink()` processes links, it replaces string IDs in `source`/`target` with object references to the actual `GraphNode` objects. This means we cannot store the "full graph" links as-is after D3 processes them — we need to keep a separate copy of the original link data (before D3 mutates it). The existing `linkIds()` helper already handles both forms.

### JSON format (from EPIC-006)
```json
{
  "type": "force-graph",
  "nodes": [...],
  "links": [...],
  "options": {
    "focus": "AppRoot",
    "expandDepth": 3,
    "maxVisible": 500
  }
}
```

## Architecture

### Design principles

1. **Renderer is "dumb"** — it draws what it receives, no visibility knowledge
2. **Separate sub-model** — `GraphVisibilityModel` owns full graph, BFS, visibility state, expand/collapse
3. **System properties on nodes** — runtime-computed values (`_$showIndex`, `_$hiddenCount`) stored directly on `GraphNode` objects with a `_$` prefix to avoid collision with user custom properties
4. **Two-layer state** — full graph (computed once) + visible graph (recomputed on expand/collapse)

### System property prefix

Runtime-computed properties use the `_$` prefix, defined as a constant:

```typescript
// in types.ts
export const SYS_PREFIX = "_$";
```

System properties added to `GraphNode`:
- `_$showIndex` — BFS discovery order (number)
- `_$hiddenCount` — count of hidden neighbors (number, 0 if none)

These are stripped when displaying custom properties in tooltips/detail panel (US-174/US-176) by filtering out keys starting with `_$`.

### Component composition

```
GraphViewModel
  ├─ ForceGraphRenderer       (canvas rendering, D3 simulation, mouse events)
  └─ GraphVisibilityModel     (BFS, full graph, visibility, expand/collapse)  ← NEW
```

### Data flow

```
parseContent():
  JSON.parse()
  → visibilityModel.setFullGraph(nodes, links, options)
  → visibleGraph = visibilityModel.getVisibleGraph()
  → renderer.updateData(visibleGraph)      // deep copy with _$hiddenCount set

Ctrl+Click on node "X":
  renderer.onCtrlClick(nodeId)
  → vm.handleCtrlClick(nodeId)
    → visibilityModel.toggle(nodeId)       // expand or collapse
    → visibleGraph = visibilityModel.getVisibleGraph()
    → renderer.updateData(visibleGraph)    // preserves positions of existing nodes
```

### Preprocessed node data in `GraphVisibilityModel`

The visibility model preprocesses the raw data into efficient structures:

```typescript
interface ProcessedNode {
    node: GraphNode;            // reference to original node object
    showIndex: number;          // BFS discovery order
    neighbors: Set<string>;     // precomputed adjacency (fast lookup)
}
```

Full graph stored as `Map<string, ProcessedNode>` — O(1) lookup by ID, adjacency pre-baked, no repeated link scanning.

## Implementation Plan

### Step 1: Update types — `types.ts`

Add `GraphOptions` interface, `options` field to `GraphData`, and system prefix:

```typescript
export const SYS_PREFIX = "_$";

export interface GraphOptions {
    focus?: string;        // Initial focus node ID
    expandDepth?: number;  // BFS depth limit from focus
    maxVisible?: number;   // Hard ceiling on visible nodes (default 500)
}

export interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
    options?: GraphOptions;  // NEW
}
```

Add system property declarations to `GraphNode` (TypeScript optional fields):

```typescript
export interface GraphNode extends SimulationNodeDatum {
    id: string;
    title?: string;
    level?: number;
    shape?: NodeShape;
    _$showIndex?: number;       // runtime: BFS discovery order
    _$hiddenCount?: number;     // runtime: count of hidden neighbors
}
```

### Step 2: Create `GraphVisibilityModel` — new file `GraphVisibilityModel.ts`

New file: `src/renderer/editors/graph/GraphVisibilityModel.ts`

```typescript
import { GraphData, GraphNode, GraphLink, GraphOptions, linkIds } from "./types";

interface ProcessedNode {
    node: GraphNode;
    showIndex: number;
    neighbors: Set<string>;
}

export class GraphVisibilityModel {
    private fullNodes = new Map<string, ProcessedNode>();
    private fullLinkPairs: Array<{ source: string; target: string }> = [];
    private visibleIds = new Set<string>();
    private options: GraphOptions = {};
    private focusId = "";
    private _active = false;  // true when filtering is needed

    get active(): boolean { return this._active; }

    // =========================================================================
    // Public API
    // =========================================================================

    /** Process raw graph data. Returns true if filtering is active. */
    setFullGraph(nodes: GraphNode[], links: GraphLink[], options?: GraphOptions): boolean {
        this.options = options ?? {};
        const maxVisible = this.options.maxVisible ?? 500;

        // Small graph optimization: no filtering needed
        if (nodes.length <= maxVisible) {
            this._active = false;
            this.fullNodes.clear();
            return false;
        }

        this._active = true;

        // Extract link ID pairs (D3-mutation-safe)
        this.fullLinkPairs = links.map((link) => linkIds(link));

        // Build adjacency
        const adjacency = new Map<string, Set<string>>();
        for (const node of nodes) adjacency.set(node.id, new Set());
        for (const { source, target } of this.fullLinkPairs) {
            adjacency.get(source)?.add(target);
            adjacency.get(target)?.add(source);
        }

        // Determine focus node
        this.focusId = this.determineFocusNode(nodes);

        // BFS from focus — assigns showIndex to all reachable nodes
        const showIndexMap = this.computeBFS(nodes, adjacency);

        // Store processed nodes
        this.fullNodes.clear();
        for (const node of nodes) {
            this.fullNodes.set(node.id, {
                node,
                showIndex: showIndexMap.get(node.id) ?? Infinity,
                neighbors: adjacency.get(node.id) ?? new Set(),
            });
        }

        // Initial visible set: first maxVisible nodes by BFS order
        const sorted = [...this.fullNodes.entries()]
            .sort((a, b) => a[1].showIndex - b[1].showIndex);
        this.visibleIds = new Set(sorted.slice(0, maxVisible).map(([id]) => id));

        return true;
    }

    /** Build a visible graph with _$showIndex and _$hiddenCount set on nodes. */
    getVisibleGraph(): GraphData {
        const nodes: GraphNode[] = [];
        for (const id of this.visibleIds) {
            const pn = this.fullNodes.get(id);
            if (!pn) continue;
            const node = pn.node;
            node._$showIndex = pn.showIndex;
            node._$hiddenCount = this.countHiddenNeighbors(id);
            nodes.push(node);
        }

        const links: GraphLink[] = this.fullLinkPairs
            .filter(({ source, target }) =>
                this.visibleIds.has(source) && this.visibleIds.has(target))
            .map(({ source, target }) => ({ source, target }));

        return { nodes, links, options: this.options };
    }

    /** Expand or collapse a node. Returns true if visibility changed. */
    toggle(nodeId: string): boolean {
        const pn = this.fullNodes.get(nodeId);
        if (!pn) return false;

        const hiddenCount = this.countHiddenNeighbors(nodeId);
        if (hiddenCount > 0) {
            return this.expand(nodeId);
        } else {
            return this.collapse(nodeId);
        }
    }

    /** Reset to initial visibility state. */
    reset(): void {
        const maxVisible = this.options.maxVisible ?? 500;
        const sorted = [...this.fullNodes.entries()]
            .sort((a, b) => a[1].showIndex - b[1].showIndex);
        this.visibleIds = new Set(sorted.slice(0, maxVisible).map(([id]) => id));
    }

    // =========================================================================
    // BFS
    // =========================================================================

    private computeBFS(nodes: GraphNode[], adjacency: Map<string, Set<string>>): Map<string, number> {
        const showIndexMap = new Map<string, number>();
        if (!this.focusId) return showIndexMap;

        const queue: string[] = [this.focusId];
        showIndexMap.set(this.focusId, 0);
        let index = 1;

        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            const depth = showIndexMap.get(nodeId)!;

            if (this.options.expandDepth !== undefined && depth >= this.options.expandDepth) continue;

            for (const neighborId of adjacency.get(nodeId) || []) {
                if (!showIndexMap.has(neighborId)) {
                    showIndexMap.set(neighborId, index++);
                    queue.push(neighborId);
                }
            }
        }

        // Handle disconnected components: assign remaining nodes
        for (const node of nodes) {
            if (!showIndexMap.has(node.id)) {
                showIndexMap.set(node.id, index++);
            }
        }

        return showIndexMap;
    }

    private determineFocusNode(nodes: GraphNode[]): string {
        // 1. Explicit focus from options
        if (this.options.focus && nodes.some((n) => n.id === this.options.focus)) {
            return this.options.focus!;
        }

        // 2. Node with lowest level (most important)
        let best = "";
        let bestLevel = Infinity;
        for (const node of nodes) {
            const level = typeof node.level === "number" ? node.level : Infinity;
            if (level < bestLevel) {
                bestLevel = level;
                best = node.id;
            }
        }
        if (best) return best;

        // 3. First node
        return nodes[0]?.id ?? "";
    }

    // =========================================================================
    // Expand / Collapse
    // =========================================================================

    private expand(nodeId: string): boolean {
        const pn = this.fullNodes.get(nodeId);
        if (!pn) return false;

        let changed = false;
        for (const neighborId of pn.neighbors) {
            if (!this.visibleIds.has(neighborId)) {
                this.visibleIds.add(neighborId);
                changed = true;
            }
        }
        return changed;
    }

    private collapse(nodeId: string): boolean {
        const pn = this.fullNodes.get(nodeId);
        if (!pn) return false;

        const clickedIndex = pn.showIndex;

        // BFS from clicked node: only follow visible nodes with showIndex > clickedIndex
        const toHide = new Set<string>();
        const queue: string[] = [];

        for (const neighborId of pn.neighbors) {
            const npn = this.fullNodes.get(neighborId);
            if (npn && npn.showIndex > clickedIndex && this.visibleIds.has(neighborId)) {
                queue.push(neighborId);
            }
        }

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (toHide.has(current)) continue;
            toHide.add(current);

            const cpn = this.fullNodes.get(current);
            if (!cpn) continue;
            for (const neighborId of cpn.neighbors) {
                const npn = this.fullNodes.get(neighborId);
                if (npn && npn.showIndex > clickedIndex && this.visibleIds.has(neighborId) && !toHide.has(neighborId)) {
                    queue.push(neighborId);
                }
            }
        }

        for (const id of toHide) this.visibleIds.delete(id);
        return toHide.size > 0;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private countHiddenNeighbors(nodeId: string): number {
        const pn = this.fullNodes.get(nodeId);
        if (!pn) return 0;
        let count = 0;
        for (const neighborId of pn.neighbors) {
            if (!this.visibleIds.has(neighborId)) count++;
        }
        return count;
    }
}
```

### Step 3: Parse `options` in `GraphViewModel.parseContent()` — `GraphViewModel.ts`

Add import and field:

```typescript
import { GraphVisibilityModel } from "./GraphVisibilityModel";

// In constructor or field:
readonly visibilityModel = new GraphVisibilityModel();
```

Update `parseContent()`:

```typescript
private parseContent(): void {
    const content = this.host.state.get().content;
    if (!content.trim()) {
        this.state.update((s) => { s.graphData = null; s.error = ""; s.loading = false; });
        return;
    }

    try {
        const json = JSON.parse(content);
        const graphData: GraphData = {
            nodes: Array.isArray(json.nodes) ? json.nodes : [],
            links: Array.isArray(json.links) ? json.links : [],
            options: json.options,
        };

        this.state.update((s) => { s.graphData = graphData; s.error = ""; s.loading = false; });

        // Compute visibility (modifies nodes with _$ properties)
        const filtering = this.visibilityModel.setFullGraph(graphData.nodes, graphData.links, graphData.options);

        // Deep copy for D3 mutation safety
        const copy: GraphData = filtering
            ? this.visibilityModel.getVisibleGraph()
            : JSON.parse(JSON.stringify(graphData));

        this.renderer.updateData(copy);
    } catch (e: any) {
        this.state.update((s) => { s.error = e.message || "Invalid JSON"; s.loading = false; });
    }
}
```

Note: when filtering is active, `getVisibleGraph()` returns a new graph with fresh link objects (not yet mutated by D3), so no additional deep copy is needed. When not filtering, the existing deep copy via `JSON.parse(JSON.stringify())` is used.

### Step 4: Wire Ctrl+Click callback — `GraphViewModel.ts`

In constructor or `onInit()`:

```typescript
protected onInit(): void {
    this.addSubscription(() => clearTimeout(this._parseTimer));

    this.renderer.onCtrlClick = (nodeId: string) => this.handleCtrlClick(nodeId);

    this.parseContent();
}

private handleCtrlClick(nodeId: string): void {
    if (!this.visibilityModel.active) return;

    const changed = this.visibilityModel.toggle(nodeId);
    if (!changed) return;

    const visibleGraph = this.visibilityModel.getVisibleGraph();
    this.renderer.updateVisibleData(visibleGraph);
}
```

Add `resetVisibility()` and `hasVisibilityFilter`:

```typescript
get hasVisibilityFilter(): boolean {
    return this.visibilityModel.active;
}

resetVisibility(): void {
    if (!this.visibilityModel.active) return;
    this.visibilityModel.reset();
    const visibleGraph = this.visibilityModel.getVisibleGraph();
    this.renderer.updateVisibleData(visibleGraph);
}
```

### Step 5: Renderer changes — `ForceGraphRenderer.ts`

**5a. Add callback and new update method:**

```typescript
// After existing private fields (line 69):
onCtrlClick: ((nodeId: string) => void) | null = null;
```

Add `updateVisibleData()` — like `updateData()` but preserves existing node positions:

```typescript
/** Update with new visible data, preserving positions of existing nodes. */
updateVisibleData(graphData: GraphData): void {
    // Save positions of current nodes
    const positions = new Map<string, { x: number; y: number; vx?: number; vy?: number }>();
    for (const node of this.graphData.nodes) {
        if (node.x !== undefined && node.y !== undefined) {
            positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
        }
    }

    // Find a reference position for new nodes (position of the Ctrl+Clicked node)
    // New nodes without positions will be placed near center by D3
    for (const node of graphData.nodes) {
        const pos = positions.get(node.id);
        if (pos) {
            node.x = pos.x;
            node.y = pos.y;
            node.vx = pos.vx;
            node.vy = pos.vy;
        }
    }

    this.graphData = graphData;

    // Clear selection if the selected node is no longer visible
    if (this.activeId && !graphData.nodes.some((n) => n.id === this.activeId)) {
        this.activeId = "";
        this.activeChild = new Set();
    }
    if (this.hoveredId && !graphData.nodes.some((n) => n.id === this.hoveredId)) {
        this.hoveredId = "";
        this.hoveredChild = new Set();
    }

    if (this.simulation) {
        this.simulation.nodes(graphData.nodes);
        this.initializeForces(graphData.links);
    }
}
```

**5b. Update onClick handler** (line 130):

```typescript
onClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const node = this.findNodeAt(event);

    if (event.ctrlKey && node && this.onCtrlClick) {
        this.onCtrlClick(node.id);
        return;
    }

    this.setActiveId(node?.id ?? "");
};
```

**5c. Prevent drag on Ctrl+Click** — in `addDrag()` (line 274):

Change filter from:
```typescript
.filter((event) => event.button === 0)
```
To:
```typescript
.filter((event) => event.button === 0 && !event.ctrlKey)
```

**5d. Draw "+" badges in `renderData()`** — after drawing nodes (after line 479), before labels:

```typescript
// Draw "+" badges on nodes with hidden neighbors
if (transform.k > 0.5) {
    const c = this.colors;
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    graphData.nodes.forEach((d) => {
        const hiddenCount = d._$hiddenCount ?? 0;
        if (hiddenCount > 0) {
            const r = nodeRadius(d);
            const badgeX = (d.x || 0) + r * 0.7;
            const badgeY = (d.y || 0) - r * 0.7;
            const badgeR = Math.max(5, 3 + String(hiddenCount).length * 2);

            ctx.beginPath();
            ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
            ctx.fillStyle = c.nodeHighlight;
            ctx.fill();
            ctx.strokeStyle = c.borderHighlight;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = c.labelText;
            ctx.fillText(`+${hiddenCount}`, badgeX, badgeY);
        }
    });
}
```

The renderer reads `_$hiddenCount` directly from node objects — no visibility knowledge needed. Zero per-frame computation.

### Step 6: Reset button in GraphView — `GraphView.tsx`

Add toolbar styles to `GraphViewRoot`:

```typescript
"& .graph-toolbar": {
    position: "absolute",
    top: 8,
    left: 8,
    display: "flex",
    gap: 4,
    zIndex: 1,
},
"& .graph-toolbar-btn": {
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    border: `1px solid ${color.graph.nodeBorderDefault}`,
    borderRadius: 3,
    backgroundColor: color.graph.labelBackground,
    color: color.graph.labelText,
    "&:hover": {
        backgroundColor: color.graph.nodeHighlight,
    },
},
```

In JSX, after canvas:

```tsx
<canvas ... />
{vm.hasVisibilityFilter && (
    <div className="graph-toolbar">
        <button className="graph-toolbar-btn" onClick={() => vm.resetVisibility()}>
            Reset View
        </button>
    </div>
)}
```

### Step 7: Update test data

Add `options` to `miserables.fg.json`:

```json
{
  "type": "force-graph",
  "options": {
    "focus": "Valjean",
    "expandDepth": 2,
    "maxVisible": 30
  },
  "nodes": [...],
  "links": [...]
}
```

With `maxVisible: 30`, only ~30 of the 77 nodes will be initially visible, enabling collapse/expand testing.

Also create a larger test file (200+ nodes) via script for stress testing.

## Resolved Concerns

### 1. Ctrl+Click vs drag — RESOLVED
Add `!event.ctrlKey` to drag filter. Users lose Ctrl+drag (no current use). Acceptable tradeoff.

### 2. React button visibility — RESOLVED
Show "Reset View" button whenever `visibilityModel.active` is true (i.e., graph loaded with filtering). Harmless when nothing to reset.

### 3. Performance of hidden count in render loop — RESOLVED
Hidden counts are precomputed in `getVisibleGraph()` and stored as `_$hiddenCount` on each node. The render loop just reads the property. Zero per-frame computation.

### 4. Node position when expanding — RESOLVED
`updateVisibleData()` preserves positions of existing nodes. New nodes get D3's default random placement, then settle via simulation. Acceptable for now; can add "place near parent" optimization later if needed.

### 5. Collapse of focus node — RESOLVED
Allow it. "Reset View" provides recovery.

### 6. Disconnected components — RESOLVED
After main BFS, remaining unreachable nodes get incrementing showIndex. They'll be at the end of the visible order but included.

### 7. System property prefix — RESOLVED
Use `_$` prefix (constant `SYS_PREFIX = "_$"`). Properties `_$showIndex` and `_$hiddenCount` on `GraphNode`. Tooltip/detail panel (US-174/US-176) will filter out keys starting with `_$`.

## Acceptance Criteria

- [ ] `GraphOptions` interface (`focus`, `expandDepth`, `maxVisible`) in `types.ts`
- [ ] `SYS_PREFIX` constant and `_$showIndex`, `_$hiddenCount` on `GraphNode`
- [ ] `options` field added to `GraphData`
- [ ] `GraphVisibilityModel` created as separate sub-model
- [ ] `options` parsed from JSON in `GraphViewModel.parseContent()`
- [ ] BFS computes `showIndex` for all nodes (including disconnected components)
- [ ] Focus node determined: explicit `options.focus` → lowest level node → first node
- [ ] Small graphs (nodes ≤ `maxVisible`) render entirely, no filtering
- [ ] Large graphs filtered: only `maxVisible` nodes by BFS order initially visible
- [ ] `expandDepth` limits initial BFS depth
- [ ] "+" badge drawn on nodes with hidden neighbors, showing count (e.g., "+5")
- [ ] "+" badge visible at zoom > 0.5
- [ ] Ctrl+Click on "+" node reveals hidden direct neighbors (expand)
- [ ] Ctrl+Click on visible node hides subtree behind it (collapse via cascading BFS)
- [ ] Ctrl+Click does NOT trigger node dragging
- [ ] Node positions preserved during expand/collapse
- [ ] Collapsed selection cleared (if selected node gets hidden)
- [ ] `resetVisibility()` restores initial visible set
- [ ] "Reset View" button shown when filtering is active
- [ ] Test data updated with `options` for testing
