# US-190: Group Management UI

**Epic:** EPIC-006 (Phase 3: Node Grouping)
**Status:** Done

## Goal

Add UI interactions for creating, modifying, and dissolving groups in the graph editor. Users can group selected nodes, edit group titles, add/remove members via Alt+Click, and ungroup via context menu — all without editing JSON.

## Key Design Principles

- **Group nodes are visual containers**, not real data nodes. They get a separate context menu (no Add Child, Set as Root, Delete Link).
- **Groups only have membership links** (group→member). All other links involving groups are calculated by pre-processing. No regular links to/from groups can be created via UI.
- **Single membership**: a node can belong to at most one group. When moving a node to a new group, silently remove from old group.
- **Group IDs**: auto-generated as `group-1`, `group-2`, etc.

## Background — Existing Code References

All files in `src/renderer/editors/graph/`:

| File | Key APIs used by this task |
|------|--------------------------|
| `GraphGroupModel.ts` | `rebuild(nodes, links)`, `getMembers(groupId): ReadonlySet<string>`, `getGroupOf(nodeId): string \| undefined`, `isGroup(nodeId): boolean`, `preprocess(nodes, links, rootId): PreprocessedGraph` |
| `GraphDataModel.ts` | `addNode(id?)`, `deleteNode(nodeId)`, `addLink(s, t)`, `deleteLink(s, t)`, `updateNodeProps(id, props)`, `generateNodeId()`, `linkExists(a, b)`, `sourceData: { nodes, links, options }` |
| `GraphViewModel.ts` | `rebuildAndRender()`, `serializeToHost()`, `handleAltClick(nodeId)` (line ~462), `handleContextMenu(nodeId, cx, cy)` (line ~434), `handleHoverChanged(nodeId, cx, cy)` (line ~281), `renderer.selectedIds`, `renderer.selectedId`, `renderer.selectNode(id)`, `groupModel`, `dataModel` |
| `GraphContextMenu.ts` | `ContextMenuActions` interface, `buildNodeContextMenu()`, `buildEmptyAreaContextMenu()` — both return `MenuItem[]` |
| `ForceGraphRenderer.ts` | `onClick` (line ~341): Alt+Click dispatches `onAltClick(nodeId)`, Ctrl+Click toggles multi-selection |
| `GraphView.tsx` | Line 703: `selectedNodes.filter((n) => !n.isGroup)` — filters groups out of detail panel (keep this) |
| `types.ts` | `GraphNode.isGroup?: boolean`, `linkIds(link): { source, target }`, `nodeLabel(node): string` |

**Dialog utilities:**
- `showInputDialog({ title, value })` from `ui/dialogs/InputDialog.tsx` — returns `{ value: string } | undefined`
- `showConfirmationDialog({ title, message })` from `ui/dialogs/ConfirmationDialog.tsx` — returns `"Yes" | "No"`
- `alertsBarModel.addAlert(message, "warning")` from `ui/dialogs/alerts/AlertsBar.tsx` — shows warning notification bar

## Implementation Plan

### Step 1: Data model helpers

**File: `GraphDataModel.ts`**

Add `generateGroupId(): string`:
```typescript
generateGroupId(): string {
    if (!this.sourceData) return "group-1";
    const existingIds = new Set(this.sourceData.nodes.map((n) => n.id));
    let i = 1;
    while (existingIds.has(`group-${i}`)) i++;
    return `group-${i}`;
}
```

No `createGroup()` method needed — the ViewModel will call `addNode()` + `updateNodeProps()` + `addLink()` directly, which is clearer.

**File: `GraphDataModel.ts`**

Add `removeAllNodeLinks(nodeId: string): void` — removes ALL links where source OR target is the given node. Used by Ungroup to clean up a group node completely:
```typescript
removeAllNodeLinks(nodeId: string): void {
    if (!this.sourceData) return;
    this.sourceData.links = this.sourceData.links.filter((link) => {
        const { source, target } = linkIds(link);
        return source !== nodeId && target !== nodeId;
    });
}
```

**File: `GraphGroupModel.ts`**

Add helper to remove a single membership link from source data. This model doesn't own source data, so it needs the links array passed in:
```typescript
/** Remove the membership link for a node (the link from its group to it). Returns true if found. */
static removeMembershipLink(links: GraphLink[], nodeId: string, groupId: string): GraphLink[] {
    return links.filter((link) => {
        const { source, target } = linkIds(link);
        return !(source === groupId && target === nodeId);
    });
}
```

### Step 2: Context menu entries

**File: `GraphContextMenu.ts`**

Add new `buildGroupNodeContextMenu()` function — **completely separate** from `buildNodeContextMenu()`:

```typescript
export function buildGroupNodeContextMenu(
    groupId: string,
    hasVisibilityFilter: boolean,
    actions: ContextMenuActions,
): MenuItem[] {
    return [
        { label: "Edit Title", onClick: () => actions.editGroupTitle(groupId) },
        { label: "Collapse", onClick: () => actions.collapseNode(groupId), disabled: !hasVisibilityFilter },
        { label: "Ungroup", onClick: () => actions.ungroupNode(groupId), startGroup: true },
        { label: "Delete Group", onClick: () => actions.deleteGroup(groupId) },
    ];
}
```

Extend `ContextMenuActions` interface with new actions:
```typescript
export interface ContextMenuActions {
    // existing:
    addNode: (worldX: number, worldY: number) => void;
    addChild: (parentId: string) => void;
    deleteNode: (nodeId: string) => void;
    deleteLink: (sourceId: string, targetId: string) => void;
    setRootNode: (nodeId: string) => void;
    collapseNode: (nodeId: string) => void;
    // new:
    editGroupTitle: (groupId: string) => void;
    ungroupNode: (groupId: string) => void;
    deleteGroup: (groupId: string) => void;
    groupSelected: () => void;
    removeFromGroup: (nodeId: string) => void;
}
```

Modify `buildNodeContextMenu()` — add two new optional params and conditional items:
- **`isInGroup: string | undefined`** — if the node belongs to a group, show "Remove from Group"
- **`multiSelectedNonGroupCount: number`** — if ≥ 2, show "Group Selected"

Add to the items array:
```typescript
if (multiSelectedNonGroupCount >= 2) {
    items.push({ label: "Group Selected", onClick: () => actions.groupSelected(), startGroup: true });
}
if (isInGroup) {
    items.push({ label: "Remove from Group", onClick: () => actions.removeFromGroup(nodeId) });
}
```

**File: `GraphViewModel.ts`**

Modify `handleContextMenu()` (line ~434):
- Check if right-clicked node is a group (`dataModel.sourceData.nodes.find(n => n.id === nodeId)?.isGroup`)
- If yes: call `buildGroupNodeContextMenu()` instead of `buildNodeContextMenu()`
- If no: call `buildNodeContextMenu()` with additional params:
  - `isInGroup`: `groupModel.getGroupOf(nodeId)`
  - `multiSelectedNonGroupCount`: count of `renderer.selectedIds` that are not group nodes

Update `contextMenuActions` getter to include all new actions.

### Step 3: "Group Selected Nodes" action

**File: `GraphViewModel.ts`** — new async method `groupSelectedNodes()`.

Three cases based on selection content:

**Case A: All selected nodes are regular (≥ 2, no groups)**
1. Get `selectedIds` from `renderer.selectedIds`.
2. For each node: if `groupModel.getGroupOf(id)` returns a group, remove the membership link from `dataModel.sourceData.links`.
3. `const groupId = dataModel.generateGroupId()`.
4. Push `{ id: groupId, isGroup: true }` to `dataModel.sourceData.nodes`.
5. For each selected ID: push `{ source: groupId, target: id }` to `dataModel.sourceData.links`.
6. `const result = await showInputDialog({ title: "Group Title", value: "" })`.
7. If result: `dataModel.updateNodeProps(groupId, { title: result.value })`.
8. `rebuildAndRender()` → `serializeToHost()`.
9. `renderer.selectNode(groupId)`.

**Case B: Exactly 1 group node + regular nodes**
1. Identify the group node ID and the regular node IDs.
2. `const result = await showConfirmationDialog({ title: "Add to Group", message: "Add N nodes to group 'X'?" })`.
3. If `result !== "Yes"`: return.
4. For each regular node: remove old membership if any, add link `{ source: groupId, target: nodeId }`.
5. `rebuildAndRender()` → `serializeToHost()`.

**Case C: 2+ group nodes**
1. `alertsBarModel.addAlert("Cannot group: more than one group node is selected.", "warning")`.
2. Return (do nothing).

**Import needed:** `import { alertsBarModel } from "../../ui/dialogs/alerts/AlertsBar"` and `import { showInputDialog } from "../../ui/dialogs/InputDialog"`.

### Step 4: "Ungroup" and "Delete Group" operations

**File: `GraphViewModel.ts`**

**`async ungroupNode(groupId: string)`:**
1. Get node from `dataModel.sourceData.nodes`, verify `isGroup === true`.
2. Get member count: `groupModel.getMembers(groupId).size`.
3. Get group label: `nodeLabel(node)`.
4. `const result = await showConfirmationDialog({ title: "Ungroup", message: "Ungroup '${label}'? ${count} member nodes will be ungrouped." })`.
5. If `result !== "Yes"`: return.
6. `dataModel.removeAllNodeLinks(groupId)` — removes ALL links (membership + any extras).
7. `dataModel.sourceData.nodes = dataModel.sourceData.nodes.filter(n => n.id !== groupId)`.
8. Clear selection: `renderer.selectNode("")`.
9. `rebuildAndRender()` → `serializeToHost()`.

**`async deleteGroup(groupId: string)`:**
1. Get node, verify `isGroup === true`.
2. Get member IDs: `[...groupModel.getMembers(groupId)]`.
3. Get group label: `nodeLabel(node)`.
4. `const result = await showConfirmationDialog({ title: "Delete Group", message: "Delete group '${label}' and its ${count} member nodes?" })`.
5. If `result !== "Yes"`: return.
6. For each member ID: `dataModel.deleteNode(memberId)` (removes node + its links).
7. `dataModel.deleteNode(groupId)` (removes group node + remaining links).
8. Clear selection: `renderer.selectNode("")`.
9. `rebuildAndRender()` → `serializeToHost()`.

### Step 5: "Edit Title" for group nodes

**File: `GraphViewModel.ts`** — new async method `editGroupTitle(groupId: string)`.

1. Get current title: `dataModel.sourceData.nodes.find(n => n.id === groupId)?.title ?? ""`.
2. `const result = await showInputDialog({ title: "Group Title", value: currentTitle })`.
3. If result: `updateNodeProps(groupId, { title: result.value })` (existing method handles rebuild + serialize).

### Step 6: Alt+Click group membership toggle

**File: `GraphViewModel.ts`** — modify `handleAltClick(nodeId)` (currently line ~462).

Current code toggles a regular link between selectedId and nodeId. Replace with:

```typescript
private handleAltClick(nodeId: string): void {
    if (this.renderer.selectedIds.size !== 1) return;
    const selectedId = this.renderer.selectedId;
    if (!selectedId || selectedId === nodeId) return;
    if (!this.dataModel.sourceData) return;

    const selectedNode = this.dataModel.sourceData.nodes.find(n => n.id === selectedId);
    const clickedNode = this.dataModel.sourceData.nodes.find(n => n.id === nodeId);
    if (!selectedNode || !clickedNode) return;

    const selectedIsGroup = !!selectedNode.isGroup;
    const clickedIsGroup = !!clickedNode.isGroup;

    // Both groups → no-op
    if (selectedIsGroup && clickedIsGroup) return;

    // One is group, other is regular → toggle membership
    if (selectedIsGroup || clickedIsGroup) {
        const groupId = selectedIsGroup ? selectedId : nodeId;
        const memberId = selectedIsGroup ? nodeId : selectedId;
        const isMember = this.groupModel.getGroupOf(memberId) === groupId;

        if (isMember) {
            // Remove membership link
            this.dataModel.deleteLink(groupId, memberId);
        } else {
            // Remove from old group if any
            const oldGroup = this.groupModel.getGroupOf(memberId);
            if (oldGroup) {
                this.dataModel.deleteLink(oldGroup, memberId);
            }
            // Add membership link (direction: group → member)
            this.dataModel.addLink(groupId, memberId);
        }
        this.rebuildAndRender();
        this.serializeToHost();
        return;
    }

    // Neither is group → existing link toggle
    const exists = this.dataModel.linkExists(selectedId, nodeId);
    if (exists) {
        this.deleteLink(selectedId, nodeId);
    } else {
        this.addLink(selectedId, nodeId);
    }
}
```

**Status hints** — modify `handleHoverChanged()` (line ~281). In the section where it computes status hint (line ~291-300), add group-aware logic:

```typescript
// When hovering a non-group node while a group is selected:
if (selectedNode?.isGroup && !hoveredNode?.isGroup) {
    const isMember = this.groupModel.getGroupOf(nodeId) === selectedId;
    this.updateStatusHint(isMember
        ? `Alt+Click to remove from "${label}"`
        : `Alt+Click to add to "${label}"`);
}
// When hovering a group node while a regular node is selected:
else if (!selectedNode?.isGroup && hoveredNode?.isGroup) {
    const isMember = this.groupModel.getGroupOf(selectedId) === nodeId;
    const groupLabel = nodeLabel(hoveredNode);
    this.updateStatusHint(isMember
        ? `Alt+Click to remove from "${groupLabel}"`
        : `Alt+Click to add to "${groupLabel}"`);
}
```

### Step 7: "Remove from Group" context menu action

**File: `GraphViewModel.ts`** — new method `removeFromGroup(nodeId: string)`.

1. Get group: `this.groupModel.getGroupOf(nodeId)`.
2. If no group: return.
3. `this.dataModel.deleteLink(groupId, nodeId)` — removes the membership link (direction: group→member).
4. `this.rebuildAndRender()` → `this.serializeToHost()`.

## Files NOT changed

- `GraphView.tsx` — no changes (existing `isGroup` filter on detail panel stays)
- `GraphDetailPanel.tsx` — no changes
- `ForceGraphRenderer.ts` — no changes (Alt+Click already dispatches `onAltClick`)
- `GraphHighlightModel.ts` — no changes
- `types.ts` — no changes

## Acceptance Criteria

1. **Group creation:** Multi-select 2+ regular nodes → right-click → "Group Selected" → creates group with membership links, prompts for title
2. **Add to group:** Select 1 group + regular nodes → right-click → "Group Selected" → confirmation → adds nodes to existing group
3. **Multi-group warning:** Select 2+ groups → right-click → "Group Selected" → warning alert, no action
4. **Ungroup:** Right-click group → "Ungroup" → confirmation → removes group node + links, preserves members
5. **Delete Group:** Right-click group → "Delete Group" → confirmation → removes group + members + all links
6. **Group context menu:** Separate menu (Edit Title, Collapse, Ungroup, Delete Group) — no Add Child, Set as Root, Delete Link
7. **Edit title:** Right-click group → "Edit Title" → InputDialog changes group title
8. **Alt+Click membership:** Select group → Alt+Click regular node → toggle add/remove from group
9. **Alt+Click between groups:** No-op (groups cannot have direct links)
10. **Alt+Click status hint:** Footer shows "Alt+Click to add/remove from [group]" when hovering
11. **Single membership:** Moving a node to a new group silently removes from old group
12. **Remove from Group:** Right-click member node → "Remove from Group" → removes membership link
13. **Pre-processing sync:** All operations trigger `rebuildAndRender()` so link pre-processing stays correct

## Files Changed Summary

| File | Change |
|------|--------|
| `GraphDataModel.ts` | `generateGroupId()`, `removeAllNodeLinks()` |
| `GraphContextMenu.ts` | New `buildGroupNodeContextMenu()`, extended `ContextMenuActions`, new conditional items in `buildNodeContextMenu()` |
| `GraphViewModel.ts` | `groupSelectedNodes()`, `ungroupNode()`, `deleteGroup()`, `editGroupTitle()`, `removeFromGroup()`, modified `handleAltClick()`, modified `handleHoverChanged()`, modified `handleContextMenu()`, extended `contextMenuActions` |
