# US-189: Group Link Pre-processing

**Epic:** EPIC-006 (Graph Editor — Phase 3: Node Grouping)
**Status:** Planned
**Depends on:** US-188 (Group node data model & rendering) — Done

## Goal

Transform source links into visualization-ready links by routing cross-group connections through group nodes, hiding membership links, and preserving intra-group links. This is the core algorithm that makes group nodes functional — without it, groups are just visual markers with no effect on the graph topology.

## Pipeline Overview

### Before (current)

```
GraphDataModel.sourceData { nodes, links, options }
    → GraphGroupModel.rebuild(nodes, links)           // builds membership maps
    → GraphVisibilityModel.setFullGraph(nodes, links)  // BFS, expand/collapse
    → ForceGraphRenderer                               // D3 + canvas
```

### After (with pre-processing)

```
GraphDataModel.sourceData { nodes, links, options }
    → GraphGroupModel.rebuild(nodes, links)            // builds membership maps
    → GraphGroupModel.preprocess(nodes, links, rootId) // returns { nodes, links, syntheticLinkCounts }
    → GraphVisibilityModel.setFullGraph(processedNodes, processedLinks)  // BFS on PROCESSED graph
    → ForceGraphRenderer                               // D3 + canvas with per-link distance
```

**Key principle:** Source data is never modified. Pre-processing is a pure transformation that produces visualization-ready data. All editing operations (add/delete node/link, rename, etc.) still operate on `GraphDataModel.sourceData`.

## Link Classification Rules

For each source link, classify it using the **effective membership map** (which excludes the root node — see Root Node Rule below):

| # | Category | Condition | Action |
|---|----------|-----------|--------|
| 1 | **Membership** | Source is a group node AND target is a member of that group (or vice versa) | **Remove** (do not include in output) |
| 2 | **Intra-group** | Both endpoints belong to the **same** group | **Keep as-is** |
| 3 | **Cross-group** | One endpoint is in a group, the other is outside all groups | **Split**: emit `member→group` + `group→outsideNode` |
| 4 | **Inter-group** | Endpoints are in **different** groups | **Split**: emit `node→group1` + `group1→group2` + `group2→node` |
| 5 | **External** | Neither endpoint is in any group | **Keep as-is** |

**Classification order matters**: Check membership first (rule 1), then intra-group (rule 2), then the rest.

### Root Node Rule

The root node (`options.rootNode`) is **excluded from group membership** during pre-processing only. The `preprocess()` method builds its own "effective membership" map by copying the group model's `memberOf` map and removing the root node ID. This means:

- `GraphGroupModel.rebuild()` still records the root as a member (used for tooltip `memberCount`, legend, etc.)
- `preprocess()` treats the root as "outside all groups"
- A group→root membership link becomes a **regular visible link** (it's not a membership link in the effective map, and the group node is a group while root is "outside" → cross-group rule → `group→root` kept, plus potentially a `member→group` synthetic if another member links to root)
- When the user changes root to another node, the old root re-enters its group on next `rebuildAndRender()`

### Synthetic Link Deduplication

When splitting produces duplicate synthetic links, keep only one. Use a **canonical key** for deduplication: sort the two IDs alphabetically so `A→B` and `B→A` map to the same key (links are undirected).

Example — nodes A, B, C in group G, all linking to external node X:
- Original: A↔X, B↔X, C↔X
- After split: `A↔G`, `B↔G`, `C↔G` (3 member→group links) + `G↔X` (1 deduplicated group→outside link, count=3)

Track the **count** of original links each deduplicated synthetic link replaces → stored in `syntheticLinkCounts` map.

### Force Adjustment for Group↔Group Links

When many original links between two groups compress into one synthetic group↔group link, use D3 per-link distance to keep them closer:

```
distance = baseDistance / log2(count)
```

Apply **only** to links where **both** endpoints are group nodes (group↔group). Regular synthetic links (group↔regular node) use normal distance.

## Implementation Plan

### Step 1: Add `preprocess()` to GraphGroupModel

**File:** `src/renderer/editors/graph/GraphGroupModel.ts`

Add the following interface and method:

```typescript
export interface PreprocessedGraph {
    nodes: GraphNode[];                     // Same array as input (unchanged)
    links: GraphLink[];                     // Transformed links for visualization
    syntheticLinkCounts: Map<string, number>; // canonicalKey → count of originals replaced
}
```

**Method signature:**
```typescript
preprocess(nodes: GraphNode[], links: GraphLink[], rootNodeId: string): PreprocessedGraph
```

**Algorithm:**

```
1. Build effective memberOf map:
   - Copy this.memberOf (from rebuild())
   - Remove rootNodeId entry (root is outside all groups)

2. Build effective groups map:
   - Copy this.groups (from rebuild())
   - For the group that contained rootNodeId, remove rootNodeId from its member set

3. For each source link (source, target):
   a. Get effective group of source (effectiveGroupOf(source)) and target (effectiveGroupOf(target))
      - Group nodes themselves are NOT "in" any group — they ARE groups
      - effectiveGroupOf returns: the group ID if the node is a member, undefined otherwise

   b. Check if this is a membership link:
      - source is a group AND target is in that group's effective members → SKIP
      - target is a group AND source is in that group's effective members → SKIP

   c. Classify remaining links:
      - sourceGroup === targetGroup && sourceGroup !== undefined → INTRA-GROUP: keep as-is
      - sourceGroup !== undefined && targetGroup !== undefined && sourceGroup !== targetGroup → INTER-GROUP:
          emit: source↔sourceGroup, sourceGroup↔targetGroup, targetGroup↔target
      - sourceGroup !== undefined && targetGroup === undefined → CROSS-GROUP:
          emit: source↔sourceGroup, sourceGroup↔target
      - sourceGroup === undefined && targetGroup !== undefined → CROSS-GROUP:
          emit: source↔targetGroup, targetGroup↔target
      - sourceGroup === undefined && targetGroup === undefined → EXTERNAL: keep as-is

4. Deduplicate all output links:
   - Use Map<canonicalKey, GraphLink> where canonicalKey = sorted [id1, id2].join("→")
   - For synthetic links, count duplicates in syntheticLinkCounts
   - Kept-as-is links (intra-group, external) are added directly (no dedup needed — they're original unique links)

5. Return { nodes (same input array), links (deduped output), syntheticLinkCounts }
```

**Important edge cases:**
- Self-links (source === target): pass through as external
- Group→externalNode link (group is source, target is NOT a member): this is NOT a membership link. The group node itself has `effectiveGroupOf(group) === undefined` (it's a group, not a member). So it's external → keep as-is.
- Link between two group nodes: both have `effectiveGroupOf === undefined` → external → keep as-is

### Step 2: Wire into GraphViewModel.rebuildAndRender()

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

**Current code** (in `rebuildAndRender()`, around line 660):

```typescript
const { nodes, links, options } = this.dataModel.sourceData;
this.groupModel.rebuild(nodes, links);

let filtering: boolean;
if (this.isFirstLoad) {
    filtering = this.visibilityModel.setFullGraph(nodes, links, options);
} else {
    filtering = this.visibilityModel.updateGraph(nodes, links, ensureVisible);
}

const copy: GraphData = filtering
    ? this.visibilityModel.getVisibleGraph()
    : { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })), options };
```

**Change to:**

```typescript
const { nodes, links, options } = this.dataModel.sourceData;
this.groupModel.rebuild(nodes, links);

// Pre-process links for visualization (hide membership, split cross-group)
const rootId = options?.rootNode ?? "";
const processed = this.groupModel.preprocess(nodes, links, rootId);

let filtering: boolean;
if (this.isFirstLoad) {
    filtering = this.visibilityModel.setFullGraph(processed.nodes, processed.links, options);
} else {
    filtering = this.visibilityModel.updateGraph(processed.nodes, processed.links, ensureVisible);
}

const copy: GraphData = filtering
    ? this.visibilityModel.getVisibleGraph()
    : { nodes: processed.nodes.map((n) => ({ ...n })), links: processed.links.map((l) => ({ ...l })), options };

// Pass synthetic link counts to renderer for per-link force distance
this.renderer.syntheticLinkCounts = processed.syntheticLinkCounts;
```

**Also store** `processed.syntheticLinkCounts` on the renderer so `initializeForces` can use it.

### Step 3: Per-link distance in ForceGraphRenderer

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

**3a.** Add property:
```typescript
syntheticLinkCounts: Map<string, number> | null = null;
```

**3b.** Modify `initializeForces()` — change `forceLink.distance()` from flat value to function:

```typescript
// Current:
.distance(this._forceParams.linkDistance)

// New:
.distance((link: GraphLink) => {
    if (!this.syntheticLinkCounts || this.syntheticLinkCounts.size === 0) {
        return this._forceParams.linkDistance;
    }
    const { source, target } = linkIds(link);
    const key = source < target ? `${source}→${target}` : `${target}→${source}`;
    const count = this.syntheticLinkCounts.get(key);
    if (count && count > 1) {
        return this._forceParams.linkDistance / Math.log2(count);
    }
    return this._forceParams.linkDistance;
})
```

**3c.** Same change in `applyTunedForces()` where link distance is updated:

```typescript
// Current:
linkForce.distance(this._forceParams.linkDistance);

// New:
linkForce.distance((link: GraphLink) => {
    // Same logic as above
});
```

**Note:** The canonical key in the renderer must use the same format as in `preprocess()` — sorted alphabetically, joined with `→`.

### Step 4: No changes to GraphVisibilityModel

The visibility model receives `nodes[]` and `links[]` and builds adjacency from them. After pre-processing, it receives the transformed links. BFS traversal naturally goes through group nodes because they now have synthetic links connecting them to external nodes and to member nodes (via cross-group splits).

No code changes needed in this file.

### Step 5: No changes to tooltips or detail panel

- **Tooltip** `memberCount`: Uses `groupModel.getMembers()` which reads from `rebuild()` data (not affected by `preprocess()`). Works correctly.
- **Detail panel Links tab**: Uses `dataModel.computeLinkedNodes()` which reads source data. Shows real links including membership links. Correct.
- **Hover neighbor highlighting**: Uses rendered links (processed). Hovering a group won't highlight members (membership links hidden). This is acceptable.

### Step 6: No changes to graphs without groups

When no group nodes exist, `preprocess()` returns the original links unchanged and an empty `syntheticLinkCounts`. The pipeline behaves identically to before.

## Files Changed (Summary)

| File | Change |
|------|--------|
| `src/renderer/editors/graph/GraphGroupModel.ts` | Add `PreprocessedGraph` interface, add `preprocess()` method |
| `src/renderer/editors/graph/GraphViewModel.ts` | Wire `preprocess()` into `rebuildAndRender()`, pass counts to renderer |
| `src/renderer/editors/graph/ForceGraphRenderer.ts` | Add `syntheticLinkCounts` property, per-link distance function in `initializeForces()` and `applyTunedForces()` |

**No changes to:** `GraphVisibilityModel.ts`, `GraphDataModel.ts`, `GraphView.tsx`, `GraphHighlightModel.ts`, `GraphDetailPanel.tsx`, `GraphTooltip.tsx`, `GraphLegendPanel.tsx`, `types.ts`

## Acceptance Criteria

1. **Membership links hidden**: Links from group→member are not rendered
2. **Intra-group links preserved**: Links between members of the same group render normally
3. **Cross-group links split**: A link from a group member to an outside node appears as two links routing through the group node
4. **Inter-group links split**: A link between members of different groups routes through both group nodes
5. **Deduplication**: Multiple cross-group links to the same target produce only one synthetic group→target link
6. **Force adjustment**: Group↔group synthetic links with high count use shorter distance (log2 scale)
7. **Root exclusion**: Root node is never treated as a group member during pre-processing, even if a membership link exists. The membership link (group→root) stays visible.
8. **Source data unchanged**: All edits still operate on original source data; pre-processing is visualization-only
9. **BFS works correctly**: Expand/collapse traverses the processed graph naturally through group node hubs
10. **No regressions**: Graphs without group nodes behave identically to before
