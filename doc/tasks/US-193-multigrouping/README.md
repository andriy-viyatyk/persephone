# US-193: Multigrouping (Nested Group Hierarchy)

## Goal

Enable multi-level grouping so that groups can contain sub-groups, forming a tree hierarchy. Users can create sub-groups within existing groups, nest groups inside other groups, and the graph visualization correctly handles link routing through multiple levels of nesting.

## Status

**Planned** | Epic: EPIC-006

## Background

### Current State

Single-level grouping works (US-188 through US-192):
- Nodes can belong to at most one group via membership links (`group→member`)
- `groupSelectedNodes()` in `GraphViewModel` (line 627) handles 3 cases:
  - **Case A**: All regular nodes → create new group
  - **Case B**: 1 group + regular nodes → add to existing group
  - **Case C**: 2+ groups selected → **rejected with warning** (line 642)
- Alt+Click between two group nodes → **no-op** (line 542: `if (selectedIsGroup && clickedIsGroup) return;`)
- `GraphGroupModel.rebuild()` (line 28) only detects membership when exactly one endpoint is a group (XOR check, lines 50-56)
- `GraphGroupModel.preprocess()` (line 95) uses `groupOf()` helper that only returns immediate parent for non-group nodes

### Already Nested-Group Ready

- **`GraphConnectivityModel.getGroupChain()`** (line 187) — walks up group hierarchy recursively
- **`GraphConnectivityModel.getAllRealMembers()`** (line 202) — recursively collects non-group leaf members through sub-groups via `collectRealMembers()` (line 213)
- **Data model**: Membership stored as links — a group node can be a member of another group

### Dialog API

`showConfirmationDialog({ title, message, buttons })` supports custom button arrays (e.g., `["Add to Group", "Create New Group", "Cancel"]`) and returns the button text clicked. `showInputDialog({ title, message, value })` returns `{ button: "OK"|"Cancel", value: string }`. Both imported from `../../ui/dialogs/`.

## Resolved Concerns

1. **Group-to-group link direction**: Links are undirected. In `rebuild()`, use two-phase approach: first process non-group membership (unambiguous), then group-to-group links with cycle detection to determine parent/child direction.

2. **Visual nesting indicators**: Not needed. All groups look the same regardless of nesting depth.

3. **Ungroup behavior**: Delete group node and its links. If ungrouped group had a parent, re-link members to that parent. Sub-groups stay intact with their internal membership links.

4. **Preprocessing algorithm**: Use LCA (Lowest Common Ancestor) approach with ancestor chains. Single-pass, no mutation. Build `originalToVisualLinks` map as byproduct for O(1) path highlighting.

## Implementation Plan

### Step 1: Update `GraphGroupModel.rebuild()` to support group-as-member

**File**: `src/renderer/editors/graph/GraphGroupModel.ts`

**Current code** (lines 28-66): Membership detection uses XOR — exactly one endpoint must be a group.

**Replace with** two-phase approach:

```typescript
rebuild(nodes: GraphNode[], links: GraphLink[]): void {
    this.groups.clear();
    this.memberOf.clear();

    // Phase 1: Collect group IDs (same as current)
    const groupIds = new Set<string>();
    for (const node of nodes) {
        if (node.isGroup) {
            groupIds.add(node.id);
            this.groups.set(node.id, new Set());
        }
    }
    if (groupIds.size === 0) return;

    // Phase 2a: Process links where exactly one endpoint is a group (same as current)
    for (const link of links) {
        const { source, target } = linkIds(link);
        if (groupIds.has(source) && !groupIds.has(target)) {
            this.groups.get(source)!.add(target);
            if (!this.memberOf.has(target)) this.memberOf.set(target, source);
        } else if (groupIds.has(target) && !groupIds.has(source)) {
            this.groups.get(target)!.add(source);
            if (!this.memberOf.has(source)) this.memberOf.set(source, target);
        }
    }

    // Phase 2b: Process group-to-group links
    // Try source-as-parent first; if cycle, try target-as-parent; if both cycle, skip.
    for (const link of links) {
        const { source, target } = linkIds(link);
        if (!groupIds.has(source) || !groupIds.has(target)) continue;
        if (this.memberOf.has(source) && this.memberOf.get(source) === target) continue;
        if (this.memberOf.has(target) && this.memberOf.get(target) === source) continue;
        if (this.memberOf.has(target) && this.memberOf.has(source)) continue;

        if (!this.memberOf.has(target)) {
            if (!this.wouldCreateCycleInternal(source, target)) {
                this.groups.get(source)!.add(target);
                this.memberOf.set(target, source);
                continue;
            }
        }
        if (!this.memberOf.has(source)) {
            if (!this.wouldCreateCycleInternal(target, source)) {
                this.groups.get(target)!.add(source);
                this.memberOf.set(source, target);
            }
        }
    }
}
```

**Add new methods** to `GraphGroupModel`:

```typescript
/** Check if adding childId as member of parentGroupId would create a cycle. */
wouldCreateCycle(parentGroupId: string, childId: string): boolean {
    return this.wouldCreateCycleInternal(parentGroupId, childId);
}

private wouldCreateCycleInternal(parentId: string, childId: string): boolean {
    let current = parentId;
    while (true) {
        if (current === childId) return true;
        const parent = this.memberOf.get(current);
        if (!parent) return false;
        current = parent;
    }
}
```

### Step 2: Update `GraphGroupModel.preprocess()` for multi-level routing

**File**: `src/renderer/editors/graph/GraphGroupModel.ts`

**Replace** the `PreprocessedGraph` interface (line 5) and `preprocess()` method (lines 95-171).

#### PreprocessedGraph Type — add `originalToVisualLinks`

```typescript
export interface PreprocessedGraph {
    nodes: GraphNode[];
    links: GraphLink[];
    syntheticLinkCounts: Map<string, number>;
    /** Maps original real-data link key → array of visual link keys it was split into.
     *  For unsplit links (intra-group, external), the array contains the original key itself.
     *  Used for O(1) path highlighting instead of BFS. */
    originalToVisualLinks: Map<string, string[]>;
}
```

#### Core Concept — LCA-based routing

For any real data link between nodes A and B:
1. Build ancestor chain for each: `[A, G_a1, G_a2, ...]` and `[B, G_b1, G_b2, ...]`
2. Find LCA — deepest group containing both
3. Generate synthetic links from each node up to LCA, plus bridge between the two sides
4. Track `originalToVisualLinks` mapping as byproduct

#### Implementation

```typescript
preprocess(nodes: GraphNode[], links: GraphLink[], rootNodeId: string): PreprocessedGraph {
    const empty: PreprocessedGraph = {
        nodes, links, syntheticLinkCounts: new Map(), originalToVisualLinks: new Map(),
    };
    if (this.groups.size === 0) return empty;

    // 1. Build effective memberOf map (exclude root from membership)
    const effectiveMemberOf = new Map(this.memberOf);
    if (rootNodeId) effectiveMemberOf.delete(rootNodeId);

    // 2. Build effective groups map (remove root from its group's member set)
    const effectiveGroups = new Map<string, Set<string>>();
    for (const [groupId, members] of this.groups) {
        const copy = new Set(members);
        if (rootNodeId) copy.delete(rootNodeId);
        effectiveGroups.set(groupId, copy);
    }

    // Helper: get ancestor chain [immediateGroup, parentGroup, ...] (excludes node itself)
    const getAncestorChain = (id: string): string[] => {
        const chain: string[] = [];
        let current = id;
        while (true) {
            const parent = effectiveMemberOf.get(current);
            if (!parent) break;
            chain.push(parent);
            current = parent;
        }
        return chain;
    };

    // 3. Classify links and collect output
    const syntheticMap = new Map<string, GraphLink>();
    const syntheticCounts = new Map<string, number>();
    const outputLinks: GraphLink[] = [];
    const originalToVisualLinks = new Map<string, string[]>();

    const canonicalKey = (a: string, b: string): string =>
        a < b ? `${a}→${b}` : `${b}→${a}`;

    let currentVisualKeys: string[] = [];

    const addSynthetic = (source: string, target: string): void => {
        if (source === target) return;
        const key = canonicalKey(source, target);
        currentVisualKeys.push(key);
        const existing = syntheticCounts.get(key) ?? 0;
        syntheticCounts.set(key, existing + 1);
        if (!syntheticMap.has(key)) {
            syntheticMap.set(key, { source, target });
        }
    };

    for (const link of links) {
        const { source, target } = linkIds(link);

        // Rule 1: Membership link — skip
        if (this.groups.has(source) && effectiveGroups.get(source)?.has(target)) continue;
        if (this.groups.has(target) && effectiveGroups.get(target)?.has(source)) continue;

        const originalKey = canonicalKey(source, target);
        currentVisualKeys = [];

        // Build full paths: [node, immediateGroup, parentGroup, ...]
        const sAncestors = getAncestorChain(source);
        const tAncestors = getAncestorChain(target);
        const sPath = [source, ...sAncestors];
        const tPath = [target, ...tAncestors];

        // Find LCA: first node in tPath that also appears in sPath
        const sSet = new Set(sPath);
        let lca: string | null = null;
        let lcaIndexInT = -1;
        for (let i = 0; i < tPath.length; i++) {
            if (sSet.has(tPath[i])) {
                lca = tPath[i];
                lcaIndexInT = i;
                break;
            }
        }
        let lcaIndexInS = -1;
        if (lca !== null) {
            lcaIndexInS = sPath.indexOf(lca);
        }

        // Determine routing
        if (sAncestors.length === 0 && tAncestors.length === 0) {
            // Neither in any group → keep as-is (Rule 5: External)
            outputLinks.push(link);
            currentVisualKeys.push(originalKey);
        } else if (sAncestors.length > 0 && tAncestors.length > 0 && sAncestors[0] === tAncestors[0]) {
            // Same immediate group → keep as-is (Rule 2: Intra-group)
            outputLinks.push(link);
            currentVisualKeys.push(originalKey);
        } else {
            // Route through group hierarchy
            const sTrimmed = lca !== null ? sPath.slice(0, lcaIndexInS) : sPath;
            const tTrimmed = lca !== null ? tPath.slice(0, lcaIndexInT) : tPath;

            // Synthetic links along source side (ascending)
            for (let i = 0; i < sTrimmed.length - 1; i++) {
                addSynthetic(sTrimmed[i], sTrimmed[i + 1]);
            }
            // Synthetic links along target side (ascending)
            for (let i = 0; i < tTrimmed.length - 1; i++) {
                addSynthetic(tTrimmed[i], tTrimmed[i + 1]);
            }
            // Bridge between tops of both sides
            const sTop = sTrimmed[sTrimmed.length - 1];
            const tTop = tTrimmed[tTrimmed.length - 1];
            if (sTop !== tTop) {
                addSynthetic(sTop, tTop);
            }
        }

        originalToVisualLinks.set(originalKey, currentVisualKeys);
    }

    // 4. Add deduplicated synthetic links to output
    for (const [, link] of syntheticMap) {
        outputLinks.push(link);
    }

    return { nodes, links: outputLinks, syntheticLinkCounts: syntheticCounts, originalToVisualLinks };
}
```

#### Verification Against Examples

**Example 1: Nodes in different top-level groups** — `G1:[A,B]`, `G2:[C,D]`, link A→C
- sPath=[A,G1], tPath=[C,G2], LCA=none
- sTrimmed=[A,G1], tTrimmed=[C,G2], bridge G1→G2
- Visual: A→G1, G1→G2, G2→C ✓
- Map: `"A→C"` → `["A→G1", "G1→G2", "C→G2"]`

**Example 2: Node in sub-group → external** — `G1:[G2,X]`, `G2:[A,B]`, link A→E
- sPath=[A,G2,G1], tPath=[E], LCA=none
- sTrimmed=[A,G2,G1], tTrimmed=[E], bridge G1→E
- Visual: A→G2, G2→G1, G1→E ✓
- Map: `"A→E"` → `["A→G2", "G1→G2", "E→G1"]`

**Example 3: Different sub-groups, same parent** — `G1:[G2,G3]`, `G2:[A]`, `G3:[B]`, link A→B
- sPath=[A,G2,G1], tPath=[B,G3,G1], LCA=G1
- sTrimmed=[A,G2], tTrimmed=[B,G3], bridge G2→G3
- Visual: A→G2, G2→G3, G3→B ✓
- Map: `"A→B"` → `["A→G2", "B→G3", "G2→G3"]`

**Example 4: Same sub-group (intra-group)** — `G1:[G2]`, `G2:[A,B]`, link A→B
- sAncestors[0]===tAncestors[0] (both G2) → keep as-is ✓
- Map: `"A→B"` → `["A→B"]`

**Example 5: Node in sub-group → sibling node** — `G1:[G2,X]`, `G2:[A]`, link A→X
- sPath=[A,G2,G1], tPath=[X,G1], LCA=G1
- sTrimmed=[A,G2], tTrimmed=[X], bridge G2→X
- Visual: A→G2, G2→X ✓
- Map: `"A→X"` → `["A→G2", "G2→X"]`

**Example 6: 3-level nesting** — `G1:[G2,G3]`, `G2:[G4]`, `G4:[A]`, `G3:[B]`, link A→B
- sPath=[A,G4,G2,G1], tPath=[B,G3,G1], LCA=G1
- sTrimmed=[A,G4,G2], tTrimmed=[B,G3], bridge G2→G3
- Visual: A→G4, G4→G2, G2→G3, G3→B ✓
- Map: `"A→B"` → `["A→G4", "G2→G4", "G2→G3", "B→G3"]`

### Step 3: Update `GraphViewModel.groupSelectedNodes()`

**File**: `src/renderer/editors/graph/GraphViewModel.ts`

**Replace** the current `groupSelectedNodes()` method (lines 627-709) with new multi-case logic.

**Current code structure** to preserve: the method starts by classifying `selectedIds` into `groupIds` and `regularIds` arrays (lines 630-639). Keep this classification, replace everything after it.

```typescript
async groupSelectedNodes(): Promise<void> {
    if (!this.dataModel.sourceData) return;

    const selectedIds = [...this.renderer.selectedIds];
    const nodes = this.dataModel.sourceData.nodes;

    const groupIds: string[] = [];
    const regularIds: string[] = [];
    for (const id of selectedIds) {
        const node = nodes.find((n) => n.id === id);
        if (node?.isGroup) groupIds.push(id);
        else if (node) regularIds.push(id);
    }

    // Determine parent groups of regular nodes
    const uniqueRegularParents = new Set<string | undefined>();
    for (const id of regularIds) {
        uniqueRegularParents.add(this.groupModel.getGroupOf(id));
    }

    // CASE 1: Only regular nodes (no groups selected)
    if (groupIds.length === 0) {
        if (regularIds.length < 2) return;

        if (uniqueRegularParents.size > 1) {
            alertsBarModel.addAlert("Cannot group: selected nodes belong to different groups.", "warning");
            return;
        }

        const parentGroup = [...uniqueRegularParents][0]; // undefined if top-level

        const result = await showInputDialog({ title: "Group Title", message: "Enter a title for the group:", value: "" });
        if (result?.button !== "OK") return;

        for (const id of regularIds) {
            const oldGroup = this.groupModel.getGroupOf(id);
            if (oldGroup) this.dataModel.deleteLink(oldGroup, id);
        }

        const newGroupId = this.dataModel.generateGroupId();
        this.dataModel.sourceData.nodes.push({ id: newGroupId, isGroup: true });
        for (const id of regularIds) {
            this.dataModel.sourceData.links.push({ source: newGroupId, target: id });
        }
        // Nest inside parent group if nodes were in one
        if (parentGroup) {
            this.dataModel.sourceData.links.push({ source: parentGroup, target: newGroupId });
        }

        if (result.value) this.dataModel.updateNodeProps(newGroupId, { title: result.value });

        // Position at centroid of selected members
        const renderedNodes = this.renderer.getNodes();
        let cx = 0, cy = 0, count = 0;
        for (const id of regularIds) {
            const rn = renderedNodes.find((n) => n.id === id);
            if (rn?.x != null && rn?.y != null) { cx += rn.x; cy += rn.y; count++; }
        }
        const posHint = count > 0 ? new Map([[newGroupId, { x: cx / count, y: cy / count }]]) : undefined;

        this.rebuildAndRender(undefined, posHint, [newGroupId]);
        this.serializeToHost();
        this.renderer.selectNode(newGroupId);
        return;
    }

    // CASE 2: Exactly 1 group + regular nodes
    if (groupIds.length === 1 && regularIds.length > 0) {
        const groupId = groupIds[0];
        const groupNode = nodes.find((n) => n.id === groupId);
        const groupTitle = nodeLabel(groupNode ?? { id: groupId });

        const choice = await showConfirmationDialog({
            title: "Group Options",
            message: `Add ${regularIds.length} node(s) to group "${groupTitle}", or create a new group containing all selected?`,
            buttons: ["Add to Group", "Create New Group", "Cancel"],
        });

        if (choice === "Add to Group") {
            for (const id of regularIds) {
                const oldGroup = this.groupModel.getGroupOf(id);
                if (oldGroup) this.dataModel.deleteLink(oldGroup, id);
                this.dataModel.addLink(groupId, id);
            }
            this.rebuildAndRender();
            this.serializeToHost();
        } else if (choice === "Create New Group") {
            const result = await showInputDialog({ title: "Group Title", message: "Enter a title for the group:", value: "" });
            if (result?.button !== "OK") return;

            const oldParent = this.groupModel.getGroupOf(groupId);

            const newGroupId = this.dataModel.generateGroupId();
            this.dataModel.sourceData.nodes.push({ id: newGroupId, isGroup: true });

            // Move existing group into new group
            if (oldParent) this.dataModel.deleteLink(oldParent, groupId);
            this.dataModel.sourceData.links.push({ source: newGroupId, target: groupId });

            // Move regular nodes into new group
            for (const id of regularIds) {
                const oldGroup = this.groupModel.getGroupOf(id);
                if (oldGroup) this.dataModel.deleteLink(oldGroup, id);
                this.dataModel.sourceData.links.push({ source: newGroupId, target: id });
            }

            // Nest under old parent if existed
            if (oldParent) {
                this.dataModel.sourceData.links.push({ source: oldParent, target: newGroupId });
            }

            if (result.value) this.dataModel.updateNodeProps(newGroupId, { title: result.value });

            const renderedNodes = this.renderer.getNodes();
            let cx = 0, cy = 0, count = 0;
            for (const id of [...regularIds, groupId]) {
                const rn = renderedNodes.find((n) => n.id === id);
                if (rn?.x != null && rn?.y != null) { cx += rn.x; cy += rn.y; count++; }
            }
            const posHint = count > 0 ? new Map([[newGroupId, { x: cx / count, y: cy / count }]]) : undefined;

            this.rebuildAndRender(undefined, posHint, [newGroupId]);
            this.serializeToHost();
            this.renderer.selectNode(newGroupId);
        }
        return;
    }

    // CASE 3: Multiple groups selected (with or without regular nodes)
    if (groupIds.length >= 2) {
        const groupParents = new Set(groupIds.map((id) => this.groupModel.getGroupOf(id)));
        if (groupParents.size > 1) {
            alertsBarModel.addAlert("Cannot group: selected groups belong to different parent groups.", "warning");
            return;
        }

        // Validate regular nodes are from same level
        const selectedGroupSet = new Set(groupIds);
        for (const id of regularIds) {
            const nodeParent = this.groupModel.getGroupOf(id);
            if (nodeParent && !selectedGroupSet.has(nodeParent) && nodeParent !== [...groupParents][0]) {
                alertsBarModel.addAlert("Cannot group: selected nodes belong to different groups.", "warning");
                return;
            }
        }

        const result = await showInputDialog({ title: "Group Title", message: "Enter a title for the group:", value: "" });
        if (result?.button !== "OK") return;

        const newGroupId = this.dataModel.generateGroupId();
        this.dataModel.sourceData.nodes.push({ id: newGroupId, isGroup: true });

        for (const gId of groupIds) {
            const oldParent = this.groupModel.getGroupOf(gId);
            if (oldParent) this.dataModel.deleteLink(oldParent, gId);
            this.dataModel.sourceData.links.push({ source: newGroupId, target: gId });
        }
        for (const id of regularIds) {
            const oldGroup = this.groupModel.getGroupOf(id);
            if (oldGroup) this.dataModel.deleteLink(oldGroup, id);
            this.dataModel.sourceData.links.push({ source: newGroupId, target: id });
        }

        const commonParent = [...groupParents][0]; // undefined if top-level
        if (commonParent) {
            this.dataModel.sourceData.links.push({ source: commonParent, target: newGroupId });
        }

        if (result.value) this.dataModel.updateNodeProps(newGroupId, { title: result.value });

        const renderedNodes = this.renderer.getNodes();
        let cx = 0, cy = 0, count = 0;
        for (const id of selectedIds) {
            const rn = renderedNodes.find((n) => n.id === id);
            if (rn?.x != null && rn?.y != null) { cx += rn.x; cy += rn.y; count++; }
        }
        const posHint = count > 0 ? new Map([[newGroupId, { x: cx / count, y: cy / count }]]) : undefined;

        this.rebuildAndRender(undefined, posHint, [newGroupId]);
        this.serializeToHost();
        this.renderer.selectNode(newGroupId);
        return;
    }

    // CASE 4: Only 1 group, no regular nodes → nothing to do
}
```

**Note**: `alertsBarModel` is imported at the top of `GraphViewModel.ts` (line 9: `import { alertsBarModel } from "../../ui/AlertsBar";`).

### Step 4: Update `handleAltClick()` for group-to-group membership

**File**: `src/renderer/editors/graph/GraphViewModel.ts` (lines 528-571)

**Replace** the block at line 541-542:
```typescript
// Before:
if (selectedIsGroup && clickedIsGroup) return;
```

**With**:
```typescript
// Both groups → toggle group membership (selected becomes parent of clicked)
if (selectedIsGroup && clickedIsGroup) {
    const clickedParent = this.groupModel.getGroupOf(nodeId);

    if (clickedParent === selectedId) {
        // Clicked is already a member of selected → remove
        this.dataModel.deleteLink(selectedId, nodeId);
    } else if (this.groupModel.getGroupOf(selectedId) === nodeId) {
        // Selected is a member of clicked → remove (reverse)
        this.dataModel.deleteLink(nodeId, selectedId);
    } else {
        // Add clicked as member of selected (with cycle check)
        if (this.groupModel.wouldCreateCycle(selectedId, nodeId)) {
            alertsBarModel.addAlert("Cannot add: would create circular group hierarchy.", "warning");
            return;
        }
        if (clickedParent) {
            this.dataModel.deleteLink(clickedParent, nodeId);
        }
        this.dataModel.addLink(selectedId, nodeId);
    }
    this.rebuildAndRender();
    this.serializeToHost();
    return;
}
```

### Step 5: Update `ungroupNode()` and `deleteGroupNode()`

**File**: `src/renderer/editors/graph/GraphViewModel.ts`

#### `ungroupNode()` — replace lines 720-738

Members get promoted to parent group (if any):

```typescript
async ungroupNode(groupId: string): Promise<void> {
    if (!this.dataModel.sourceData) return;
    const node = this.dataModel.sourceData.nodes.find((n) => n.id === groupId);
    if (!node?.isGroup) return;

    const members = [...this.groupModel.getMembers(groupId)];
    const parentGroup = this.groupModel.getGroupOf(groupId);
    const label = nodeLabel(node);

    let message = `Ungroup "${label}"?`;
    if (parentGroup) {
        message += ` ${members.length} member(s) will be moved to the parent group.`;
    } else {
        message += ` ${members.length} member(s) will become top-level nodes.`;
    }

    const result = await showConfirmationDialog({ title: "Ungroup", message });
    if (result !== "Yes") return;

    // Remove all links from this group node (membership to members + link from parent)
    this.dataModel.removeAllNodeLinks(groupId);

    // Promote members to parent group
    if (parentGroup) {
        for (const memberId of members) {
            this.dataModel.addLink(parentGroup, memberId);
        }
    }

    // Delete the group node
    this.dataModel.sourceData.nodes = this.dataModel.sourceData.nodes.filter((n) => n.id !== groupId);

    this.renderer.selectNode("");
    this.rebuildAndRender();
    this.serializeToHost();
}
```

#### `deleteGroupNode()` — replace lines 740-762

Recursive cascade deletes all descendants:

```typescript
async deleteGroupNode(groupId: string): Promise<void> {
    if (!this.dataModel.sourceData) return;
    const node = this.dataModel.sourceData.nodes.find((n) => n.id === groupId);
    if (!node?.isGroup) return;

    const allMembers = this.connectivityModel.getAllRealMembers(groupId);
    const allSubGroups = this.collectAllSubGroups(groupId);
    const label = nodeLabel(node);

    let message: string;
    if (allSubGroups.length > 0) {
        message = `Delete group "${label}" and all ${allMembers.size + allSubGroups.length} descendants (${allMembers.size} nodes, ${allSubGroups.length} sub-groups)?`;
    } else {
        message = `Delete group "${label}" and its ${allMembers.size} member node(s)?`;
    }

    const result = await showConfirmationDialog({ title: "Delete Group", message });
    if (result !== "Yes") return;

    for (const id of allMembers) {
        this.dataModel.deleteNode(id);
        this.clearRootIfDeleted(id);
    }
    for (const id of allSubGroups) {
        this.dataModel.deleteNode(id);
        this.clearRootIfDeleted(id);
    }
    this.dataModel.deleteNode(groupId);
    this.clearRootIfDeleted(groupId);

    this.renderer.selectNode("");
    this.rebuildAndRender();
    this.serializeToHost();
}
```

**Add new helper** to `GraphViewModel` (after `deleteGroupNode`):

```typescript
/** Collect all sub-group IDs recursively (depth-first). */
private collectAllSubGroups(groupId: string): string[] {
    const result: string[] = [];
    const members = this.groupModel.getMembers(groupId);
    for (const memberId of members) {
        if (this.groupModel.isGroup(memberId)) {
            result.push(memberId);
            result.push(...this.collectAllSubGroups(memberId));
        }
    }
    return result;
}
```

### Step 6: Update context menus

**File**: `src/renderer/editors/graph/GraphContextMenu.ts`

**`buildNodeContextMenu()`** (line 34): Replace parameter `multiSelectedNonGroupCount?: number` with `multiSelectedCount?: number`. Update condition at line 55:

```typescript
// Before:
if (multiSelectedNonGroupCount !== undefined && multiSelectedNonGroupCount >= 2) {

// After:
if (multiSelectedCount !== undefined && multiSelectedCount >= 2) {
```

**`buildGroupNodeContextMenu()`** (line 66): Add `multiSelectedCount` parameter and "Group Selected" item:

```typescript
export function buildGroupNodeContextMenu(
    groupId: string,
    hasVisibilityFilter: boolean,
    actions: ContextMenuActions,
    multiSelectedCount?: number,
): MenuItem[] {
    const items: MenuItem[] = [
        { label: "Edit Title", onClick: () => actions.editGroupTitle(groupId) },
        { label: "Collapse", onClick: () => actions.collapseNode(groupId), disabled: !hasVisibilityFilter },
        { label: "Ungroup", onClick: () => actions.ungroupNode(groupId), startGroup: true },
        { label: "Delete Group", onClick: () => actions.deleteGroup(groupId) },
    ];
    if (multiSelectedCount !== undefined && multiSelectedCount >= 2) {
        items.push({ label: "Group Selected", onClick: () => actions.groupSelected(), startGroup: true });
    }
    return items;
}
```

**Update call sites** in `GraphViewModel.ts` where these builders are invoked — pass `this.renderer.selectedIds.size` as `multiSelectedCount`.

### Step 7: Update `GraphConnectivityModel.rebuild()` membership detection

**File**: `src/renderer/editors/graph/GraphConnectivityModel.ts` (lines 43-53)

**Replace** the XOR membership check:

```typescript
// Before (line 49):
const isMembership = sourceIsGroup !== targetIsGroup;

// After:
let isMembership = false;
if (sourceIsGroup !== targetIsGroup) {
    isMembership = true;
} else if (sourceIsGroup && targetIsGroup) {
    isMembership = this.groupModel!.getGroupOf(source) === target
                || this.groupModel!.getGroupOf(target) === source;
}
```

`this.groupModel` is stored at line 35 from the `rebuild()` parameter.

### Step 8: Replace `getVisualPath()` BFS with `originalToVisualLinks` lookup

**File**: `src/renderer/editors/graph/GraphConnectivityModel.ts`

**Add field** (after line 19):
```typescript
private originalToVisualLinks = new Map<string, string[]>();
```

**In `rebuild()`** (after the processedAdjacency loop, around line 62), add:
```typescript
this.originalToVisualLinks = preprocessed.originalToVisualLinks;
```

**Add method** (after `getProcessedNeighborIds()`):
```typescript
/** Get visual link keys for a real-data link between two nodes. O(1) lookup. */
getVisualLinkKeys(fromId: string, toId: string): string[] {
    return this.originalToVisualLinks.get(this.canonicalKey(fromId, toId)) ?? [];
}
```

**Remove** these methods/fields (no external callers confirmed via grep):
- `getVisualPath()` (line 101) — replaced by `getVisualLinkKeys()`
- `processedLinkSet` (line 19) — only used by `hasProcessedLink()`
- `hasProcessedLink()` (line 136) — no external callers
- `linkKey()` (line 141) — no external callers

**Keep**: `processedAdjacency` and `getProcessedNeighborIds()` — used by `GraphLegendPanel.tsx` line 79.

**File**: `src/renderer/editors/graph/ForceGraphRenderer.ts` (lines 662-700)

**Replace** `computeSelectedLinkKeys()` and `computeHoveredLinkKeys()`:

```typescript
private computeSelectedLinkKeys(): void {
    const cm = this.connectivityModel;
    const keys = new Set<string>();
    if (cm && this.highlight.selectedIds.size > 0) {
        for (const nodeId of this.highlight.selectedIds) {
            for (const realNeighborId of cm.getRealNeighborIds(nodeId)) {
                for (const key of cm.getVisualLinkKeys(nodeId, realNeighborId)) {
                    keys.add(key);
                }
            }
        }
    }
    this.highlight.selectedLinkKeys = keys;
}

private computeHoveredLinkKeys(): void {
    const cm = this.connectivityModel;
    const hoveredId = this.highlight.hoveredId;
    const keys = new Set<string>();
    if (cm && hoveredId && this.highlight.selectedIds.size > 0) {
        for (const nodeId of this.highlight.selectedIds) {
            if (!cm.getRealNeighborIds(nodeId).has(hoveredId)) continue;
            for (const key of cm.getVisualLinkKeys(nodeId, hoveredId)) {
                keys.add(key);
            }
        }
    }
    this.highlight.hoveredLinkKeys = keys;
}
```

## Files That Do NOT Need Changes

- `GraphHighlightModel.ts` — works with link keys, unchanged
- `GraphDetailPanel.tsx` — uses `getRealNeighborNodes()` and `setExternalHover()`, unchanged
- `GraphView.tsx` — passes data to sub-components, unchanged
- `GraphDataModel.ts` — CRUD operations, unchanged
- `GraphSearchModel.ts` — search logic, unchanged
- `GraphVisibilityModel.ts` — BFS visibility, unchanged (uses processedAdjacency indirectly)
- `GraphTuningSliders.tsx` — force tuning UI, unchanged
- `GraphExpansionSettings.tsx` — expansion settings UI, unchanged
- `types.ts` — no type changes needed

## Acceptance Criteria

- [ ] Selecting nodes within a group and clicking "Group nodes" creates a sub-group inside that group
- [ ] Selecting 2+ groups creates a new parent group containing them
- [ ] Selecting 1 group + nodes offers choice: "Add to group" or "Create new group"
- [ ] Nodes from different groups cannot be grouped together (warning shown)
- [ ] Circular group hierarchies are prevented (warning shown)
- [ ] A node belongs to at most one group; moving to another group auto-removes from current
- [ ] Link preprocessing correctly routes through multiple group levels (verified via examples 1-6)
- [ ] Visual paths (orange selection paths, green hover paths) work through nested groups
- [ ] Links tab highlighting works through nested groups
- [ ] Ungroup promotes members to parent group (or top-level)
- [ ] Delete group cascades to all descendants (sub-groups + their members)
- [ ] Alt+Click works for group-to-group membership toggling (with cycle check)
- [ ] Legend, search, shift-key highlighting all still work correctly
- [ ] Test with miserables.fg.json: create sub-groups within existing groups, verify rendering

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/graph/GraphGroupModel.ts` | `rebuild()`: two-phase with cycle check for group-to-group. `preprocess()`: full rewrite — LCA-based multi-level routing + `originalToVisualLinks` map. `PreprocessedGraph` type: add `originalToVisualLinks`. Add `wouldCreateCycle()`/`wouldCreateCycleInternal()`. |
| `src/renderer/editors/graph/GraphViewModel.ts` | `groupSelectedNodes()`: 4 cases. `handleAltClick()`: group-to-group toggle. `ungroupNode()`: promote to parent. `deleteGroupNode()`: recursive cascade. Add `collectAllSubGroups()`. |
| `src/renderer/editors/graph/GraphConnectivityModel.ts` | `rebuild()`: group-to-group membership detection; store `originalToVisualLinks`. Add `getVisualLinkKeys()`. Remove `getVisualPath()`, `processedLinkSet`, `hasProcessedLink()`, `linkKey()`. |
| `src/renderer/editors/graph/ForceGraphRenderer.ts` | `computeSelectedLinkKeys()` and `computeHoveredLinkKeys()`: use `getVisualLinkKeys()` instead of `getVisualPath()`. |
| `src/renderer/editors/graph/GraphContextMenu.ts` | `buildNodeContextMenu()`: `multiSelectedNonGroupCount` → `multiSelectedCount`. `buildGroupNodeContextMenu()`: add `multiSelectedCount` + "Group Selected" item. |
