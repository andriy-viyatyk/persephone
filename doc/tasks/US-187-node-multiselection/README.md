# US-187: Graph editor — Node multiselection

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Allow selecting multiple nodes via Ctrl+Click and batch-editing their properties (level, shape, custom properties) through the detail panel.

## Background

### Current selection system

- **Single selection**: Click a node → `ForceGraphRenderer.onClick` calls `setActiveId(nodeId)` → `GraphHighlightModel.setActiveId()` stores `activeId` + pre-computes `activeChild` (neighbor set).
- **Renderer**: `selectedId` getter returns `highlight.activeId`. `selectNode()` calls `setActiveId()`.
- **ViewModel**: `handleSelectionChanged(nodeId)` sets `state.selectedNode` (snapshot) + `state.linkedNodes`.
- **Detail panel**: Receives single `node: GraphNode | null` + `linkedNodes: GraphNode[]`.

### Key files

| File | Role |
|------|------|
| `ForceGraphRenderer.ts` | Canvas click handler, `setActiveId()`, rendering loop |
| `GraphHighlightModel.ts` | `activeId`, `activeChild`, color methods (`nodeColor`, `nodeBorderColor`, `labelTextColor`, `linkColor`) |
| `GraphViewModel.ts` | `handleSelectionChanged()`, `refreshSelectedNode()`, edit operations (`updateNodeProps`, `applyPropertiesUpdate`) |
| `GraphView.tsx` | Wires ViewModel state to `GraphDetailPanel` props |
| `GraphDetailPanel.tsx` | `InfoTab`, `PropertiesTab`, `LinksTab` sub-components |
| `GraphDataModel.ts` | `updateNodeProps()`, `applyPropertiesUpdate()` — source data mutations |

### Existing modifier key usage

- **Ctrl+Click on badge** → expand/deep-expand hidden neighbors (`onBadgeExpand`)
- **Alt+Click on node** → toggle link with selected node (`onAltClick`)

**Important**: Ctrl+Click on a **badge** ("+N" indicator) already has meaning. Multiselection Ctrl+Click only applies when clicking on a **node body** (no badge hit).

## Implementation plan

### Step 1: GraphHighlightModel — multi-selection state

**File:** `src/renderer/editors/graph/GraphHighlightModel.ts`

- Add `selectedIds: Set<string>` (replaces single `activeId` for multi-selection tracking).
- Keep `activeId` as "primary" selected node (the last one clicked) for backward compatibility with hover status hints.
- Add `selectedChildren: Set<string>` — union of all neighbors of all selected nodes.
- New methods:
  - `setSelectedIds(ids: Set<string>, links: GraphLink[])` — bulk set selection + recompute `selectedChildren`
  - `toggleSelected(id: string, links: GraphLink[])` — add/remove single node from selection
  - `clearSelection(links: GraphLink[])` — clear all, also clears `activeId`
  - `selectSingle(id: string, links: GraphLink[])` — clear multi + set single (same as current behavior)
- Update color methods:
  - `nodeColor()`: check `selectedIds.has(node.id)` instead of `node.id === this.activeId`
  - `nodeBorderColor()`: same — any selected node gets `borderSelected`
  - `labelTextColor()`: any selected node gets `nodeSelected` color
  - `linkColor()`: link is `linkSelected` (orange) if **either** endpoint is in `selectedIds`
  - The special green highlight for link between selected+hovered should check `selectedIds.has(source/target)`

### Step 2: ForceGraphRenderer — Ctrl+Click handling

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Modify `onClick`:
  - If `event.ctrlKey` and `node` (not a badge): call `highlight.toggleSelected(node.id, links)` → render → fire `onSelectionChanged` with updated selection info
  - If plain click: call `highlight.selectSingle(node?.id ?? "", links)` → render → fire callback
  - If click on empty (no node, no badge): `highlight.clearSelection(links)` → render → fire callback
- Update `selectedId` getter → `get selectedIds(): Set<string>` (or keep both for compatibility)
- Update `selectNode(nodeId)` → sets single selection (used by context menu)
- New callback: `onSelectionChanged` should pass `selectedIds: Set<string>` instead of single `nodeId: string`. But for backward compat, we can pass the full set and let ViewModel decide.
- Update rendering: label rendering should show labels for ALL selected nodes (not just one).
- Drag behavior: only drag the clicked node, not all selected (multiselection drag is complex and out of scope).

### Step 3: GraphViewModel — multi-selection state

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Change `handleSelectionChanged` to accept `Set<string>`:
  ```
  handleSelectionChanged(selectedIds: Set<string>): void
  ```
- Update state:
  - `selectedNode: GraphNode | null` → `selectedNodes: GraphNode[]` (array of snapshots for all selected nodes)
  - Keep `linkedNodes` for single-selection Links tab (compute only when 1 node selected)
  - Add logic: if `selectedIds.size === 1`, compute `linkedNodes` as before; if >1, set `linkedNodes = []`
- Update `refreshSelectedNode()` → `refreshSelectedNodes()` — rebuild array from current `selectedIds`
- Update edit methods:
  - `updateNodeProps(nodeId, props)` — keep single-node API (called from Info tab for batch)
  - Add `updateMultiNodeProps(nodeIds: string[], props: Partial<GraphNode>)` — applies same props to all listed nodes
  - `applyPropertiesUpdate` — needs multi-node version for batch custom property updates

### Step 4: GraphViewState — state shape

**File:** `src/renderer/editors/graph/GraphViewModel.ts` (state definition)

- Change `selectedNode: null as GraphNode | null` → `selectedNodes: [] as GraphNode[]`
- Keep `linkedNodes: [] as GraphNode[]` (empty when multi-selected)
- Downstream consumers (GraphView.tsx) need adjustment

### Step 5: GraphView.tsx — wire multi-selection to detail panel

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Read `selectedNodes` from state instead of `selectedNode`
- Pass to `GraphDetailPanel`:
  - `nodes: GraphNode[]` (array, possibly empty)
  - `linkedNodes` (empty when multi-selected)
  - New callback: `onBatchUpdateProps(nodeIds: string[], props: Partial<GraphNode>)`
  - New callback: `onBatchApplyProperties(nodeIds: string[], propsToSet: Record<string, string>, keysToRemove: string[])`

### Step 6: GraphDetailPanel — multi-selection header & tab control

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx`

- Change prop `node: GraphNode | null` → `nodes: GraphNode[]`
- Derive:
  - `isMulti = nodes.length > 1`
  - `singleNode = nodes.length === 1 ? nodes[0] : null`
- **Header text**:
  - 0 nodes: "select node for edit" (current)
  - 1 node: node title (current)
  - N nodes: "N nodes selected"
- **Tab visibility**:
  - Links tab: visible only when single selection (`!isMulti`)
  - Info and Properties tabs: always visible
- **Panel expand/collapse**: same logic but based on `nodes.length > 0` instead of `!!node`

### Step 7: InfoTab — multi-selection mode

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx` (InfoTab component)

- Accept `nodes: GraphNode[]` instead of single `node`
- **Single mode** (1 node): current behavior — ID, Title, Level, Shape fields
- **Multi mode** (N nodes):
  - Hide ID and Title fields
  - Show info message: "Batch edit level and shape for N selected nodes"
  - **Level selector**:
    - If all nodes have same level → show that level as "selected" (current border style)
    - If mixed levels → no "selected" border; instead highlight each present level's icon with yellow/warning color (use `color.warning.text` or a new `info-icon-btn.mixed` CSS class)
    - Click a level → call `onBatchUpdateProps(nodeIds, { level: clickedLevel })` for all selected nodes
  - **Shape selector**: same logic as Level
  - Need new prop: `onBatchUpdateProps: (nodeIds: string[], props: Partial<GraphNode>) => void`

### Step 8: PropertiesTab — multi-selection mode

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx` (PropertiesTab component)

This is the most complex part.

- Accept `nodes: GraphNode[]` instead of single `node`
- **Collect all custom properties** from all selected nodes (union of all keys)
- **Row generation**:
  - For each property key across all nodes:
    - Collect all values from nodes that have this key
    - If all nodes have the same value → show that value
    - If values differ or key is missing in some nodes → show empty value
  - Each row gets `_isChanged: boolean` (not shown in grid, internal tracking)
- **Field name coloring**:
  - If all nodes have same value for this key → normal color
  - If values differ or key missing in some → show field name in yellow (`color.warning.text`). Use `onCellClass` callback to return a CSS class for the "key" column.
- **Status message under the grid** (when a row is focused/selected):
  - If all nodes have same value: "All nodes have the same value"
  - If values differ: `Values: "val1", "val2", ...` (show first 2 unique values + ", ..." if more)
  - Show this in a small text area below the grid, above the Apply/Cancel buttons
- **Edit tracking**:
  - When user edits a cell in a row, mark that row as `_isChanged = true`
  - On Apply: only send properties from rows where `_isChanged === true`
  - Unchanged rows preserve whatever values each node currently has (different values stay different)
- **Single-selection optimization**: this `_isChanged` tracking approach also works well for single node — only apply rows the user actually touched. This is a behavior improvement for single-node too.
- **Apply handler**:
  - New callback: `onBatchApplyProperties(nodeIds: string[], propsToSet: Record<string, string>, keysToRemove: string[])`
  - Only include changed rows in `propsToSet`
  - `keysToRemove`: rows that were deleted AND marked as changed (or rows deleted from original)

### Step 9: GraphDataModel — batch operations

**File:** `src/renderer/editors/graph/GraphDataModel.ts`

- Add `updateMultiNodeProps(nodeIds: string[], props: Partial<GraphNode>)`:
  - For each nodeId, find node in `sourceData.nodes` and apply props (same as single `updateNodeProps` but in a loop)
- Add `applyBatchPropertiesUpdate(nodeIds: string[], propsToSet: Record<string, string>, keysToRemove: string[])`:
  - For each nodeId, apply the same `propsToSet` and `keysToRemove` to each node

### Step 10: Context menu adjustments

**File:** `src/renderer/editors/graph/GraphContextMenu.ts`

- Right-click on node: if the clicked node is NOT in the current selection, replace selection with just this node (current behavior)
- Right-click on a selected node (in multi-selection): keep the multi-selection, show context menu for the clicked node only
- "Delete" in context menu: only deletes the right-clicked node (not all selected). Bulk delete could be a future feature.
- Alt+Click: toggles link between the right-clicked node and the primary selected node (keep current behavior, don't try to link all selected)

### Step 11: Tooltip & status hint adjustments

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Tooltip: show for hovered node as usual (no change)
- Status hint for Alt+Click: show only when exactly 1 node is selected (not multi). When multi-selected and hovering, don't show link hint.

## Concerns / Open questions

### 1. Ctrl+Click conflict with badge expand
Ctrl+Click on a **badge** currently does deep-expand. The onClick handler checks badges first, so this should not conflict — badge click returns early before reaching the node selection logic. **Resolution**: Already handled by existing priority order in `onClick`.

### 2. Drag behavior with multi-selection
Should dragging one selected node drag all selected nodes together? This is complex (D3 drag needs to move all nodes, physics interactions change). **Recommendation**: Keep single-node drag for now. Only the clicked node moves during drag, regardless of multi-selection. Future enhancement.

### 3. Properties tab `_isChanged` tracking — single node regression
Currently, for single node, Apply sends ALL properties (including unchanged ones). With `_isChanged` tracking, Apply would only send changed rows. This is actually **better** behavior (no unintended overwrites), but it's a subtle change. Should be fine.

### 4. How to handle context menu "Delete" with multi-selection
Options: (a) Delete only the right-clicked node, (b) Delete all selected nodes, (c) Show both options.
**Recommendation**: (a) Delete only the right-clicked node. Bulk delete is a separate feature. Keep it simple.

### 5. Keyboard shortcuts
Should we add Ctrl+A (select all visible), Escape (clear selection)? Not in this task scope, but good to note for future.

### 6. Existing `onSelectionChanged` callback type change
Currently `onSelectionChanged: ((nodeId: string) => void) | null`. Changing to pass `Set<string>` is a breaking change for the internal API. Need to update all callers.

### 7. Detail panel state reset on selection change
When selection changes (especially multi to single or vice versa), the panel needs to reset dirty state, active tab, etc. The existing `useEffect` on `node?.id` handles this for single node — need equivalent for multi.

## Acceptance criteria

- [ ] Ctrl+Click toggles node selection (adds/removes from selection set)
- [ ] Plain click resets to single selection (or deselects if clicking empty area)
- [ ] All selected nodes show selection highlight (same style as current single selection)
- [ ] Links from any selected node to their children show orange color
- [ ] Panel header shows "N nodes selected" when multiple nodes selected
- [ ] Links tab hidden when multiple nodes selected
- [ ] Info tab: ID/Title hidden in multi-mode, replaced with info message
- [ ] Info tab: Level icons — unified selection when all same, yellow highlight when mixed
- [ ] Info tab: Shape icons — same behavior as Level
- [ ] Info tab: clicking Level/Shape applies to all selected nodes
- [ ] Properties tab: shows union of custom properties from all selected nodes
- [ ] Properties tab: shows value when all nodes agree, empty when values differ
- [ ] Properties tab: yellow field name for mixed/missing values
- [ ] Properties tab: status message under grid showing value summary for focused row
- [ ] Properties tab: only changed rows are applied (preserves differing values in unchanged fields)
- [ ] Properties tab: `_isChanged` tracking works for single-node selection too
- [ ] Context menu on selected node in multi-selection preserves the selection
- [ ] Alt+Click hint only shown when exactly 1 node selected
- [ ] No regression in single-selection behavior
