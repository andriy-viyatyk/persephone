# US-180: Graph Editor — Polish & Enhancements

**Epic:** EPIC-006
**Status:** Planned

## Goal

Add Ctrl+Click badge deep expand, an "Expand All" toolbar button with confirmation for large graphs, and minor polish items.

## Background

### Current badge expand flow

1. `ForceGraphRenderer.onClick` (line 326) detects badge hit via `findBadgeAt(event)`
2. Calls `this.onBadgeExpand(badgeNode.id)` — callback only passes `nodeId`, not modifier keys
3. `GraphViewModel.handleBadgeExpand` (line 395) calls `expandNode(nodeId)`
4. `GraphVisibilityModel.expand(nodeId)` (line 377) adds only direct hidden neighbors to `visibleIds`

### Key types/fields

- `GraphVisibilityModel.visibleIds: Set<string>` — current visible node IDs
- `GraphVisibilityModel.fullNodes: Map<string, ProcessedNode>` — all nodes with `neighbors: Set<string>`
- `ForceGraphRenderer.onBadgeExpand: ((nodeId: string) => void) | null` — badge click callback
- `GraphViewModel.expandNode(nodeId)` — expand + update renderer + recompute search

### Files involved

| File | What to change |
|------|---------------|
| `ForceGraphRenderer.ts` | Pass `ctrlKey` to `onBadgeExpand` callback |
| `GraphVisibilityModel.ts` | Add `expandDeep(nodeId)` and `expandAll()` methods |
| `GraphViewModel.ts` | Add `expandNodeDeep()`, `expandAll()`, update `handleBadgeExpand` |
| `GraphView.tsx` | Add "Expand All" button to toolbar |
| `icons.tsx` | Add `ExpandAllIcon` (mirrored CollapseAllIcon arrows) |

## Implementation Plan

### Step 1: Pass ctrlKey through badge expand callback

**File:** `ForceGraphRenderer.ts`

Change `onBadgeExpand` callback signature from `(nodeId: string) => void` to `(nodeId: string, deep: boolean) => void`.

In `onClick` (line 332):
```typescript
// Before:
this.onBadgeExpand(badgeNode.id);
// After:
this.onBadgeExpand(badgeNode.id, event.ctrlKey);
```

### Step 2: Add `expandDeep(nodeId)` to GraphVisibilityModel

**File:** `GraphVisibilityModel.ts`

Algorithm (discussed with user):
1. Snapshot `barrier = new Set(this.visibleIds)` — these are the "initially visible" nodes
2. BFS from `nodeId` through the full graph
3. For each neighbor:
   - If it was in `barrier` (already visible before this operation) → **do not enqueue** (treat as wall)
   - If it was hidden → add to `visibleIds` + enqueue for further expansion
4. Return `true` if any nodes were newly revealed

```typescript
expandDeep(nodeId: string): boolean {
    const pn = this.fullNodes.get(nodeId);
    if (!pn) return false;

    const barrier = new Set(this.visibleIds);
    const queue: string[] = [nodeId];
    let changed = false;

    while (queue.length > 0) {
        const current = queue.shift()!;
        const cpn = this.fullNodes.get(current);
        if (!cpn) continue;

        for (const neighborId of cpn.neighbors) {
            if (barrier.has(neighborId)) continue;     // was already visible — wall
            if (this.visibleIds.has(neighborId)) continue; // already revealed in this pass
            this.visibleIds.add(neighborId);
            changed = true;
            queue.push(neighborId);
        }
    }
    return changed;
}
```

**Key insight:** The `barrier` snapshot prevents traversal through nodes that were visible *before* the deep expand started. This means the expansion stays within the "hidden pocket" connected to the clicked badge node, and doesn't leak through existing visible nodes to other hidden regions.

### Step 3: Add `expandAll()` to GraphVisibilityModel

**File:** `GraphVisibilityModel.ts`

Simple — make all nodes visible:
```typescript
expandAll(): boolean {
    let changed = false;
    for (const id of this.fullNodes.keys()) {
        if (!this.visibleIds.has(id)) {
            this.visibleIds.add(id);
            changed = true;
        }
    }
    return changed;
}
```

Also expose total node count for the confirmation check:
```typescript
get totalNodeCount(): number {
    return this.fullNodes.size;
}
```

### Step 4: Wire up in GraphViewModel

**File:** `GraphViewModel.ts`

Update callback wiring in `onInit()`:
```typescript
this.renderer.onBadgeExpand = (nodeId: string, deep: boolean) => this.handleBadgeExpand(nodeId, deep);
```

Update `handleBadgeExpand`:
```typescript
private handleBadgeExpand(nodeId: string, deep: boolean): void {
    if (deep) {
        this.expandNodeDeep(nodeId);
    } else {
        this.expandNode(nodeId);
    }
}
```

Add `expandNodeDeep`:
```typescript
expandNodeDeep(nodeId: string): void {
    if (!this.visibilityModel.active) return;
    const changed = this.visibilityModel.expandDeep(nodeId);
    if (!changed) return;
    const visibleGraph = this.visibilityModel.getVisibleGraph();
    this.renderer.updateVisibleData(visibleGraph, nodeId);
    this.recomputeSearch();
    this.clearTooltip();
}
```

Add `expandAll` (called from toolbar):
```typescript
expandAll(): void {
    if (!this.visibilityModel.active) return;
    const changed = this.visibilityModel.expandAll();
    if (!changed) return;
    const visibleGraph = this.visibilityModel.getVisibleGraph();
    this.renderer.updateVisibleData(visibleGraph);
    this.recomputeSearch();
    this.clearTooltip();
}
```

Expose total count for confirmation dialog:
```typescript
get totalNodeCount(): number {
    return this.visibilityModel.totalNodeCount;
}
```

### Step 5: Add ExpandAllIcon

**File:** `icons.tsx`

Create `ExpandAllIcon` — visually the reverse of `CollapseAllIcon` (arrows pointing outward/down instead of right):
```typescript
export const ExpandAllIcon = createIcon(16)(
    <>
        <path d="M6.5 1.5L3 4.5L6.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M7 4.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M6.5 8.5L3 11.5L6.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M7 11.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
);
```

(CollapseAll has arrows pointing right `3→6.5`; ExpandAll mirrors them pointing left `6.5→3`)

### Step 6: Add "Expand All" button to toolbar

**File:** `GraphView.tsx`

Add after the Reset View button (line ~440), before search:
```tsx
<button
    className={`graph-icon-btn${!vm.hasVisibilityFilter ? " disabled" : ""}`}
    onClick={handleExpandAll}
    title="Expand all nodes"
    disabled={!vm.hasVisibilityFilter}
>
    <ExpandAllIcon width={14} height={14} />
</button>
```

Add handler with confirmation dialog for large graphs:
```typescript
const handleExpandAll = useCallback(async () => {
    if (vm.totalNodeCount > 1000) {
        const confirmed = await app.ui.confirm(
            `This graph has ${vm.totalNodeCount} nodes. Expanding all may cause performance issues. Continue?`,
            { title: "Expand All Nodes" }
        );
        if (!confirmed) return;
    }
    vm.expandAll();
}, [vm]);
```

## Concerns

### 1. Confirmation dialog API
Need to verify how `app.ui.confirm()` works (or the equivalent confirmation mechanism available in the graph view context). The graph editor is a content-view, so we need a non-blocking confirm approach.

**Resolution needed:** Check how other editors show confirmation dialogs. Likely use `window.confirm()` or the app's dialog system.

### 2. Icon design
The mirrored CollapseAllIcon may not be visually intuitive as "Expand All". Alternative: use a different concept entirely (e.g., unfold icon, or a tree-expand icon).

**Suggestion:** Implement the mirrored version first, evaluate visually, adjust if needed.

### 3. Deep expand + position preservation
When many nodes appear at once from deep expand, they all cluster near the anchor node. The D3 simulation should spread them out, but it may look jarring with a large hidden pocket.

**Mitigation:** This is the same behavior as the existing single expand — just more nodes. The simulation handles it naturally.

## Acceptance Criteria

- [ ] Ctrl+Click on badge expands the hidden subtree connected to that node (stops at previously-visible nodes)
- [ ] Regular badge click still works as before (single-level expand)
- [ ] "Expand All" button appears in toolbar when visibility filter is active
- [ ] "Expand All" button is disabled when visibility filter is inactive
- [ ] Clicking "Expand All" on graphs with >1000 nodes shows confirmation dialog
- [ ] Confirmation dialog warns about performance impact
- [ ] User can cancel the expand all operation
- [ ] After expand all, all nodes are visible and search is recomputed
- [ ] ExpandAllIcon is added to icons.tsx
