# US-191: Graph Connectivity Model

**Epic:** EPIC-006 (Phase 3: Node Grouping)
**Status:** Planned

## Goal

Create a `GraphConnectivityModel` — a read-only query layer that bridges original source data and preprocessed visualization data. Provides reusable methods for real-data neighbor discovery, visual path finding, and group analysis. Designed to support **nested groups** (multi-level grouping) from the start.

This is an **architecture task** — create the model, wire it into the pipeline, and switch all existing neighbor-computation code to use it (eliminating duplicate implementations). Specific new features (path-aware link highlighting, "Highlight External Links" menu) will be done in follow-up tasks.

## Background

### The Two-Graph Problem

After group preprocessing, the graph editor maintains two graph representations:

1. **Original graph** (`sourceData`): All nodes and links as stored in JSON. Includes group→member membership links mixed with real data links.
2. **Preprocessed graph** (`PreprocessedGraph`): Membership links hidden, cross-group links split through group nodes, synthetic links deduplicated.

Neither graph alone answers common questions correctly:
- "What are the real-data neighbors of node X?" — Original graph includes membership links (wrong). Preprocessed graph routes through group nodes (wrong).
- "What is the visual path from X to Y?" — Only answerable from preprocessed graph, requires BFS.
- "Which members of group G have external connections?" — Requires comparing original graph (real links) against group membership.

Currently these questions are answered ad-hoc:
- `GraphDataModel.computeLinkedNodes()` / `getNeighborIdsFromSource()` — original graph, includes membership
- `GraphHighlightModel.computeNeighborIds()` — preprocessed links, includes group routing

### Nested Groups (Future Requirement)

The next phase will allow grouping nodes AND other groups into a new outer group. The connectivity model's API must accommodate this without redesign.

### Pipeline Position

Current pipeline in `rebuildAndRender()` (GraphViewModel.ts line 900):
```
sourceData → groupModel.rebuild() → groupModel.preprocess() → visibilityModel → renderer
```

New pipeline:
```
sourceData → groupModel.rebuild() → groupModel.preprocess() → connectivityModel.rebuild() → visibilityModel → renderer
```

## Design

### API

```typescript
export class GraphConnectivityModel {
    rebuild(
        nodes: GraphNode[],
        links: GraphLink[],
        preprocessed: PreprocessedGraph,
        groupModel: GraphGroupModel,
    ): void;

    // --- Real-data queries (original graph, membership links excluded) ---
    getRealNeighborIds(nodeId: string): ReadonlySet<string>;
    getRealNeighborNodes(nodeId: string, sourceNodes: GraphNode[], cleanNode: (n: GraphNode) => GraphNode): GraphNode[];

    // --- Processed-graph queries (for selection highlighting) ---
    getProcessedNeighborIds(nodeId: string): ReadonlySet<string>;

    // --- Visual path queries (preprocessed graph) ---
    getVisualPath(fromId: string, toId: string): string[];  // returns canonical link keys
    hasProcessedLink(key: string): boolean;
    linkKey(a: string, b: string): string;

    // --- Group analysis ---
    getMembersWithExternalLinks(groupId: string): Set<string>;
    getExternalConnections(groupId: string): Set<string>;
    getGroupChain(nodeId: string): string[];         // [immediateGroup, parentGroup, ...]
    getAllRealMembers(groupId: string): Set<string>;  // recursive for nested groups
}
```

### Internal Data Structures

```typescript
private realAdjacency = new Map<string, Set<string>>();       // original minus membership
private processedAdjacency = new Map<string, Set<string>>();  // from preprocessed links
private processedLinkSet = new Set<string>();                 // canonical keys for quick lookup
private groupModel: GraphGroupModel | null = null;
private groupIds = new Set<string>();
```

### Key Implementation Details

**Membership link detection** — XOR: exactly one endpoint is a group node:
```typescript
const sourceIsGroup = groupIds.has(source);
const targetIsGroup = groupIds.has(target);
const isMembership = sourceIsGroup !== targetIsGroup;
```

**Canonical link key** — Consistent ordering for undirected links:
```typescript
private canonicalKey(a: string, b: string): string {
    return a < b ? `${a}→${b}` : `${b}→${a}`;
}
```

**Nested group readiness** — For now, `getGroupChain()` returns at most 1 element and `getAllRealMembers()` delegates to `groupModel.getMembers()`. When nesting arrives, only implementation bodies change.

## Scope

### In scope
- New `GraphConnectivityModel` class with full API
- Pipeline wiring in `rebuildAndRender()`
- Switch `GraphHighlightModel` to use connectivity model (remove `computeNeighborIds()`)
- Switch Links tab and context menu to use `getRealNeighborNodes()` / `getRealNeighborIds()`
- Remove `GraphDataModel.computeLinkedNodes()` / `getNeighborIdsFromSource()`
- Implement `getGroupChain()` and `getAllRealMembers()` with single-level logic

### Out of scope (follow-up tasks)
- Path-aware link highlighting using `getVisualPath()` (needs `linkColor()` changes)
- "Highlight External Links" context menu action
- Actual nested group support in `GraphGroupModel`

## Resolved Concerns

### Two kinds of neighbor sets in GraphHighlightModel

Currently `GraphHighlightModel.computeNeighborIds()` uses preprocessed links for both selection AND hover. After refactoring:
- **Selection children** (`selectedChildren`, `activeChild`): from **processed graph** — visual links on canvas
- **Hover children** (`hoveredChild`): from **real graph** (original minus membership) — real data relationships

`GraphHighlightModel` stops computing neighbors. Callers pass pre-computed sets:

Current API:
```typescript
selectSingle(id: string, links: GraphLink[]): void;
toggleSelected(id: string, links: GraphLink[]): void;
setHoveredId(id: string, links: GraphLink[]): void;
setExternalHover(id: string, links: GraphLink[]): void;
clearSelection(links: GraphLink[]): void;
```

New API:
```typescript
selectSingle(id: string, neighbors: ReadonlySet<string>): void;
toggleSelected(id: string, getNeighbors: (nodeId: string) => ReadonlySet<string>): void;
setHoveredId(id: string, neighbors: ReadonlySet<string>): void;
setExternalHover(id: string, neighbors: ReadonlySet<string>): void;
clearSelection(): void;
```

`toggleSelected()` takes a callback because when a node is toggled OFF, we need neighbors for the *new* active node.

## Implementation Plan

### Step 1: Create `GraphConnectivityModel.ts`

**New file:** `src/renderer/editors/graph/GraphConnectivityModel.ts`

Full implementation of all methods from the API section. Key algorithms:

**`rebuild()`** — builds `realAdjacency` (original links minus membership, using XOR detection), `processedAdjacency` and `processedLinkSet` (from preprocessed output).

**`getVisualPath()`** — BFS on `processedAdjacency`. Short paths expected (1-3 hops single-level). Returns canonical link keys.

**`getMembersWithExternalLinks()`** — for each member of group, check if any real neighbor is outside the group.

**`getGroupChain()`** — walk `groupModel.getGroupOf()` up the chain (single-level: at most 1 step).

**`getAllRealMembers()`** — single-level: delegate to `groupModel.getMembers()` and filter out group nodes.

### Step 2: Wire into ViewModel pipeline

**File: `GraphViewModel.ts`**

1. Add property alongside other models:
   ```typescript
   private connectivityModel = new GraphConnectivityModel();
   ```

2. In `rebuildAndRender()` (line ~914), after `groupModel.preprocess()`:
   ```typescript
   const processed = this.groupModel.preprocess(nodes, links, rootId);
   this.connectivityModel.rebuild(nodes, links, processed, this.groupModel);
   ```

3. Set on renderer (same pattern as `syntheticLinkCounts`):
   ```typescript
   this.renderer.connectivityModel = this.connectivityModel;
   ```

### Step 3: Refactor `GraphHighlightModel`

**File: `GraphHighlightModel.ts`** (236 lines)

1. **Remove** private `computeNeighborIds()` method (lines 223-234).
2. **Remove** `import { GraphLink, linkIds }` — no longer needed.
3. Change method signatures:

**`selectSingle`** (line 85):
```typescript
// Before:
selectSingle(id: string, links: GraphLink[]): void {
    this.activeId = id;
    this.activeChild = id ? this.computeNeighborIds(id, links) : new Set();
    ...
}
// After:
selectSingle(id: string, neighbors: ReadonlySet<string>): void {
    this.activeId = id;
    this.activeChild = id ? new Set(neighbors) : new Set();
    this.selectedIds = id ? new Set([id]) : new Set();
    this.selectedChildren = this.activeChild;
}
```

**`toggleSelected`** (line 93):
```typescript
// Before:
toggleSelected(id: string, links: GraphLink[]): void { ... }
// After:
toggleSelected(id: string, getNeighbors: (nodeId: string) => ReadonlySet<string>): void {
    if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
    } else {
        this.selectedIds.add(id);
    }
    if (this.selectedIds.has(id)) {
        this.activeId = id;
        this.activeChild = new Set(getNeighbors(id));
    } else if (this.selectedIds.size > 0) {
        const last = [...this.selectedIds].pop()!;
        this.activeId = last;
        this.activeChild = new Set(getNeighbors(last));
    } else {
        this.activeId = "";
        this.activeChild = new Set();
    }
    // Recompute union of neighbors for all selected nodes
    const children = new Set<string>();
    for (const nodeId of this.selectedIds) {
        for (const neighborId of getNeighbors(nodeId)) {
            if (!this.selectedIds.has(neighborId)) {
                children.add(neighborId);
            }
        }
    }
    this.selectedChildren = children;
}
```

**`clearSelection`** (line 115):
```typescript
// Before: clearSelection(links: GraphLink[]): void { this.selectSingle("", links); }
// After:
clearSelection(): void { this.selectSingle("", new Set()); }
```

**`setHoveredId`** (line 137):
```typescript
// Before: setHoveredId(id: string, links: GraphLink[]): void { ... }
// After:
setHoveredId(id: string, neighbors: ReadonlySet<string>): void {
    this.hoveredId = id;
    this.hoveredChild = id ? new Set(neighbors) : new Set();
}
```

**`setExternalHover`** (line 143):
```typescript
// Before: setExternalHover(id: string, links: GraphLink[]): void { ... }
// After:
setExternalHover(id: string, neighbors: ReadonlySet<string>): void {
    this.externalHoverId = id;
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.hoveredChild = id ? new Set(neighbors) : new Set();
}
```

**`clearSelectionIf`** (line 151) — no change needed (doesn't use links).

**`clearAll`** (line 174) — no change needed (doesn't use links).

### Step 4: Update `ForceGraphRenderer` callers

**File: `ForceGraphRenderer.ts`** (842 lines)

Add property:
```typescript
connectivityModel: GraphConnectivityModel | null = null;
```

Helper to get neighbor lookups (add as private methods):
```typescript
private getProcessedNeighbors(id: string): ReadonlySet<string> {
    return this.connectivityModel?.getProcessedNeighborIds(id) ?? new Set();
}
private getRealNeighbors(id: string): ReadonlySet<string> {
    return this.connectivityModel?.getRealNeighborIds(id) ?? new Set();
}
```

Update each call site:

**Line 196** — `setExternalHover()`:
```typescript
// Before:
setExternalHover(id: string): void {
    if (this.highlight.hoveredId === id && this.highlight.externalHoverId === id) return;
    this.highlight.setExternalHover(id, this.graphData.links);
    this.renderData();
}
// After:
setExternalHover(id: string, neighbors: ReadonlySet<string>): void {
    if (this.highlight.hoveredId === id && this.highlight.externalHoverId === id) return;
    this.highlight.setExternalHover(id, neighbors);
    this.renderData();
}
```

**Line 224-227** — `addToSelection()`:
```typescript
// Before:
const links = this.graphData.links;
for (const id of nodeIds) {
    if (!this.highlight.selectedIds.has(id)) {
        this.highlight.toggleSelected(id, links);
    }
}
// After:
const getNeighbors = (nid: string) => this.getProcessedNeighbors(nid);
for (const id of nodeIds) {
    if (!this.highlight.selectedIds.has(id)) {
        this.highlight.toggleSelected(id, getNeighbors);
    }
}
```

**Line 350-351** — Ctrl+Click toggle:
```typescript
// Before:
this.highlight.toggleSelected(node.id, this.graphData.links);
// After:
const getNeighbors = (nid: string) => this.getProcessedNeighbors(nid);
this.highlight.toggleSelected(node.id, getNeighbors);
```

**Line 635** — `setActiveId()`:
```typescript
// Before:
this.highlight.selectSingle(id, this.graphData.links);
// After:
this.highlight.selectSingle(id, this.getProcessedNeighbors(id));
```

**Line 642** — `setHoveredId()`:
```typescript
// Before:
this.highlight.setHoveredId(id, this.graphData.links);
// After:
this.highlight.setHoveredId(id, this.getRealNeighbors(id));
```

### Step 5: Update `GraphViewModel` callers

**File: `GraphViewModel.ts`** (1031 lines)

**Line 207** — `setExternalHover()`:
```typescript
// Before:
setExternalHover(id: string): void {
    this.renderer.setExternalHover(id);
}
// After:
setExternalHover(id: string): void {
    const neighbors = id ? this.connectivityModel.getRealNeighborIds(id) : new Set<string>();
    this.renderer.setExternalHover(id, neighbors);
}
```

**Line 506** — context menu `getNeighborIdsFromSource()`:
```typescript
// Before:
const items = buildNodeContextMenu(
    nodeId,
    this.dataModel.getNeighborIdsFromSource(nodeId),
    ...
);
// After:
const items = buildNodeContextMenu(
    nodeId,
    [...this.connectivityModel.getRealNeighborIds(nodeId)],
    ...
);
```
Note: `buildNodeContextMenu` expects `string[]`, so spread the set.

### Step 6: Switch Links tab data source

**File: `GraphViewModel.ts`**

**Line 586** — `handleSelectionChanged()`:
```typescript
// Before:
s.linkedNodes = this.dataModel.computeLinkedNodes(id);
// After:
s.linkedNodes = this.connectivityModel.getRealNeighborNodes(
    id, this.dataModel.sourceData!.nodes, (n) => this.dataModel.cleanNode(n),
);
```

**Line 606** — `refreshSelectedNodes()`:
```typescript
// Same change as line 586
```

### Step 7: Remove dead code from `GraphDataModel`

**File: `GraphDataModel.ts`** (432 lines)

Remove these methods (no remaining callers):
- `computeLinkedNodes()` (lines 327-333)
- `getNeighborIdsFromSource()` (lines 371-380)

**Keep:**
- `linkExists()` — used by Alt+Click link toggle in `handleAltClick()` and context menu status hints
- `cleanNode()` — used as callback in `getRealNeighborNodes()`

### Step 8: TypeScript compilation check

Run `npx tsc --noEmit` to verify no type errors after all changes.

## Files NOT Changed

- `GraphGroupModel.ts` — no changes
- `GraphVisibilityModel.ts` — no changes
- `GraphDetailPanel.tsx` — no changes (receives `linkedNodes` from ViewModel, same prop interface)
- `GraphContextMenu.ts` — no changes (already accepts `string[]` for neighborIds)
- `GraphSearchModel.ts` — no changes
- `GraphView.tsx` — no changes
- `types.ts` — no changes

## Acceptance Criteria

1. `GraphConnectivityModel` class exists with full API (real, processed, group analysis, nested-ready)
2. `rebuild()` called in `rebuildAndRender()` after `groupModel.preprocess()`
3. `GraphHighlightModel.computeNeighborIds()` removed — all neighbor lookups via connectivity model
4. Selection highlighting uses processed-graph neighbors
5. Hover highlighting uses real-graph neighbors (no group nodes in hover set)
6. Links tab shows real-data neighbors only (no group membership links)
7. Context menu "Delete Link" submenu shows real-data links only (no membership links)
8. `GraphDataModel.computeLinkedNodes()` and `getNeighborIdsFromSource()` removed
9. `getGroupChain()` / `getAllRealMembers()` work for single-level groups
10. `npx tsc --noEmit` passes clean
11. No regressions

## Files Changed Summary

| File | Change |
|------|--------|
| `GraphConnectivityModel.ts` | **NEW** — real/processed adjacency, path finding, group analysis, nested-group-ready API |
| `GraphHighlightModel.ts` | Remove `computeNeighborIds()`, remove `GraphLink`/`linkIds` imports, change API from `links: GraphLink[]` to `neighbors: ReadonlySet<string>` / callback |
| `ForceGraphRenderer.ts` | Add `connectivityModel` property, add helper methods, update 5 call sites to pass neighbor sets |
| `GraphViewModel.ts` | Add `connectivityModel` property, wire in pipeline, switch `linkedNodes` + context menu to connectivity model, update `setExternalHover()` |
| `GraphDataModel.ts` | Remove `computeLinkedNodes()`, `getNeighborIdsFromSource()` |
