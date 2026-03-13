# US-176: Detail Panel — Panel shell + Info tab

**Epic:** EPIC-006 (Graph Editor)
**Status:** Planned

## Goal

Add a collapsible detail panel overlay to the graph editor that shows and edits properties of the selected node. This task implements the panel shell (positioning, collapse/expand, tab bar) and the Info tab (id, title, level, shape fields). The Links and Properties tabs are placeholders — implemented in US-178 and US-179.

## Background

### Current state

- **No panel exists.** The graph view has: canvas (full size), toolbar (absolute top-left, z-index 1), tooltip (fixed position portal, z-index 10, pointer-events: none).
- **Selection lives in renderer only.** `ForceGraphRenderer.selectedId` stores the active node ID. There is **no `onSelectionChanged` callback** — selection is only used internally for canvas highlighting and edit operations. `GraphViewState` has no selection field.
- **Editing operations exist.** `GraphViewModel` has `addNode`, `deleteNode`, `addLink`, `deleteLink`, `addChild` — all operate on `sourceData` (Layer 1), call `rebuildAndRender()` + `serializeToHost()`.
- **No node property editing.** There is no way to change a node's `id`, `title`, `level`, or `shape` after creation.

### Layout for the panel

`GraphViewRoot` uses `position: relative` with flex column layout. The toolbar is `position: absolute; top: 8; left: 8`. The panel should be `position: absolute; top: 8; right: 8` — mirroring the toolbar on the opposite side.

The panel should be inside `GraphViewRoot` (not a portal) so it stays within the editor bounds and doesn't interfere with other windows or editors.

### Form components available

- **`ComboSelect`** (`/src/renderer/components/form/ComboSelect.tsx`) — dropdown with `selectFrom`, `value`, `onChange`, `getLabel`. Good for shape (6 options) and level (1-5).
- **`TextField`** (`/src/renderer/components/basic/TextField.tsx`) — text input with optional label. Good for id and title fields.
- **`InputBase`** (`/src/renderer/components/basic/InputBase.tsx`) — minimal styled input, base for custom inputs.

### Node data structure

```typescript
interface GraphNode {
    id: string;           // required, unique identifier
    title?: string;       // display label (falls back to id)
    level?: number;       // 1-5, controls node size
    shape?: NodeShape;    // "circle" | "square" | "diamond" | "triangle" | "star" | "hexagon"
    // ... custom properties (displayed in tooltip, edited in US-179)
}
```

### Selection change detection

The renderer has `onHoverChanged` callback fired from `setHoveredId()` — but **no equivalent for selection**. Need to add:

```typescript
// In ForceGraphRenderer:
onSelectionChanged: ((nodeId: string) => void) | null = null;

// In setActiveId():
private setActiveId(id: string): void {
    this.activeId = id;
    this.activeChild = id ? this.getNeighborIds(id) : new Set();
    this.renderData();
    this.onSelectionChanged?.(id);  // NEW
}
```

### Write-back for node property edits

A new method is needed on `GraphViewModel` to update node properties:

```typescript
updateNodeProperty(nodeId: string, key: string, value: unknown): void {
    const node = this.sourceData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    node[key] = value;
    this.rebuildAndRender();
    this.serializeToHost();
}
```

For **ID rename**, it's more complex — all links referencing the old ID must be updated too.

## Implementation plan

### Step 1: Add selection changed callback to ForceGraphRenderer

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add callback field: `onSelectionChanged: ((nodeId: string) => void) | null = null`
- Call it from `setActiveId()` (only when value actually changes, like `setHoveredId` pattern)

### Step 2: Add selected node to GraphViewState

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `selectedNode: GraphNode | null` to `defaultGraphViewState`
- Wire `renderer.onSelectionChanged` in `onInit()`:
  ```typescript
  this.renderer.onSelectionChanged = (nodeId) => {
      this.state.update((s) => {
          s.selectedNode = nodeId
              ? { ...(this.sourceData?.nodes.find(n => n.id === nodeId) || null) }
              : null;
      });
  };
  ```
- The panel reads `selectedNode` from state — it's a **snapshot copy** of the source node, so the panel can safely read it without worrying about mutation.

### Step 3: Add node property update methods to GraphViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- **`updateNodeProps(nodeId: string, props: Partial<GraphNode>): void`**
  - Finds node in `sourceData.nodes` by ID
  - Merges props: `Object.assign(node, props)`
  - Handles special cases:
    - If `level` is set to `undefined`/empty → delete the property (revert to default)
    - If `shape` is set to `"circle"` or empty → delete the property (it's the default)
    - If `title` is empty → delete the property (falls back to id)
  - Calls `rebuildAndRender()` + `serializeToHost()`
  - Updates `selectedNode` in state with new snapshot

- **`renameNode(oldId: string, newId: string): boolean`**
  - Validates: `newId` is non-empty, not same as `oldId`, not already taken
  - Updates `node.id` in `sourceData.nodes`
  - Updates all links in `sourceData.links` where source or target matches `oldId`
  - Updates `options.focus` if it matches `oldId`
  - Calls `renderer.selectNode(newId)` to keep selection on renamed node
  - Calls `rebuildAndRender()` + `serializeToHost()`
  - Returns `true` on success, `false` on validation failure

### Step 4: Create GraphDetailPanel component

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx` (new)

A single styled root component with nested class-based styles.

**Panel structure:**
```
GraphDetailPanelRoot (position: absolute, top: 8, right: 8)
├── div.panel-header (always visible)
│   ├── span.panel-title (node title or "select node for edit")
│   └── span.panel-chevron (expand/collapse indicator, hidden when no selection)
├── div.panel-body (only visible when expanded AND node selected)
│   ├── div.panel-tabs
│   │   ├── button.panel-tab.active  "Info"
│   │   ├── button.panel-tab         "Links"
│   │   └── button.panel-tab         "Properties"
│   ├── div.panel-content
│   │   └── Info tab content (or placeholder for other tabs)
│   └── div.panel-resizer (bottom-left corner drag handle)
```

**Panel props:**
```typescript
interface GraphDetailPanelProps {
    node: GraphNode | null;
    onUpdateProps: (nodeId: string, props: Partial<GraphNode>) => void;
    onRenameNode: (oldId: string, newId: string) => boolean;
}
```

**Panel states (three visual modes):**

1. **No selection** — Only header visible. Text: "select node for edit". Half-transparent (`opacity: 0.5`), `pointer-events: none` (not clickable). Panel remembers its `wasExpanded` flag internally.

2. **Collapsed (node selected)** — Only header visible. Shows node title (or id). Full opacity, clickable. Click header → expand. Chevron indicator points down.

3. **Expanded (node selected)** — Header + body visible. Shows tabs and content. Click header → collapse. Chevron indicator points up. Resizer in bottom-left corner.

**State transitions:**
- No selection → node selected: if `wasExpanded` is true → expand; otherwise stay collapsed
- Node selected → different node selected: panel stays in current mode (expanded/collapsed), content updates
- Node selected → no selection: collapse, but remember `wasExpanded` flag
- First time a node is selected: `wasExpanded` defaults to `true` (auto-expand on first use)

**Sizing & resize:**
- Default size: 240px wide × 300px tall (content area)
- Minimum size: 200px × 200px
- Maximum size: 90% of editor width × 90% of editor height
- Resizer: bottom-left corner drag handle (diagonal grip icon)
- Resize only available when expanded
- Size state is local (`useState`) — persisting to page state deferred to US-180

**Styling guidelines:**
- Background: `color.background.default`
- Border: `1px solid ${color.border.default}`
- Border radius: 4px
- Box shadow: `color.shadow.default`
- z-index: 1 (same as toolbar — both are above canvas but below popups)
- Font size: 12px (matching toolbar and tooltip)
- Header: compact, single line, with chevron icon on the right
- Tab bar: simple horizontal buttons with active underline/highlight
- Tab style matching the graph toolbar buttons (small, compact)
- Resizer: small triangle or grip dots in bottom-left corner, `cursor: sw-resize`

**Info tab fields:**
- **ID** — TextField, commit on blur or Enter. Calls `onRenameNode`. Show validation error if ID is taken.
- **Title** — TextField, commit on blur or Enter. Calls `onUpdateProps({ title })`.
- **Level** — ComboSelect with options `[1, 2, 3, 4, 5]` plus empty option (for "default"). Calls `onUpdateProps({ level })`.
- **Shape** — ComboSelect with options `["circle", "square", "diamond", "triangle", "star", "hexagon"]`. Calls `onUpdateProps({ shape })`.

**Behavior:**
- Fields update immediately on select/blur — no "Save" button
- ID field validates on commit (not on every keystroke) — if invalid, revert to original value
- Tab state is local (React `useState`), not persisted

### Step 5: Add panel-related state to GraphViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `selectedNode: GraphNode | null` to `defaultGraphViewState` (default: `null`)
- No `panelVisible` in view model state — the panel is always rendered; its expand/collapse is managed locally in the component based on selection state

### Step 6: Wire everything in GraphView

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Import `GraphDetailPanel`
- Read `selectedNode` from `pageState`
- Always render the panel (it handles its own visibility states internally):
  ```tsx
  <GraphDetailPanel
      node={pageState.selectedNode}
      onUpdateProps={(nodeId, props) => vm.updateNodeProps(nodeId, props)}
      onRenameNode={(oldId, newId) => vm.renameNode(oldId, newId)}
  />
  ```
- No toggle button needed — the panel header is always visible at top-right

### Step 7: Handle edge cases

- **Node deleted while panel is open:** Selection clears → `selectedNode` becomes null → panel transitions to "no selection" mode (half-transparent, remembers `wasExpanded`)
- **Node renamed externally (JSON edit):** `onContentChanged` re-parses → `selectedNode` snapshot is stale. Need to refresh: if `selectedNode.id` still exists in new sourceData, update snapshot; otherwise clear selection.
- **Panel and tooltip overlap:** Tooltip uses `pointer-events: none` and `position: fixed` (portal), so it renders above the panel and doesn't interact. Panel uses `position: absolute` within the editor. No conflict.
- **Panel doesn't steal canvas focus:** The panel contains form inputs, so clicking on them will take focus from canvas. This is expected — keyboard shortcuts for the graph shouldn't fire while typing in the panel. The canvas gets focus back when clicked.
- **Resize beyond editor bounds:** Clamp panel dimensions to 90% of the editor's width/height. On window resize, re-clamp if necessary.
- **Resizer interaction:** Use `mousedown` → `mousemove` → `mouseup` pattern (not D3 drag). The resizer is in the bottom-left corner — dragging left increases width, dragging down increases height.

## Concerns / Open questions

1. **ID rename complexity** — Renaming a node ID requires updating all links and `options.focus`. Resolved: yes, update all references.

2. **Field commit strategy** — Resolved: commit on blur/Enter for text fields (id, title); commit immediately for dropdowns (level, shape).

3. **Resizer direction** — Bottom-left corner means dragging left increases width (panel anchored to right edge). This is slightly unconventional (most resizers are bottom-right). But it's the natural corner given the panel is anchored top-right. Should work fine since the cursor changes to `sw-resize` which communicates the direction.

4. **Panel size persistence** — Deferred to US-180. For now, size resets to default on each editor open. Acceptable for initial implementation.

## Acceptance criteria

- [ ] `ForceGraphRenderer` has `onSelectionChanged` callback, fired when selection changes
- [ ] `GraphViewState` includes `selectedNode`
- [ ] Detail panel header always visible at top-right corner of graph editor
- [ ] No selection: header shows "select node for edit", half-transparent, not clickable
- [ ] Node selected: header shows node title, clickable to expand/collapse
- [ ] Expand/collapse state remembered: selecting a new node preserves expanded state; deselecting → re-selecting restores it
- [ ] First-time auto-expand: panel auto-expands when a node is first selected
- [ ] Tab bar shows Info / Links / Properties tabs; only Info is functional
- [ ] Info tab shows editable fields: ID, Title, Level, Shape
- [ ] Editing title/level/shape immediately updates canvas rendering and JSON
- [ ] Renaming node ID updates all links and options.focus
- [ ] ID rename validates: non-empty, unique, reverts on failure
- [ ] Resizer in bottom-left corner of expanded panel
- [ ] Panel respects max size: 90% of editor width/height
- [ ] Panel has minimum size: 200px × 200px
- [ ] Deleting a node transitions panel to "no selection" state
- [ ] External content changes update the panel if selected node still exists
- [ ] Uses existing form components (ComboSelect, TextField)
- [ ] Single styled root component with nested class-based styles
- [ ] All colors from color tokens — no hardcoded values
- [ ] Existing features (search, tooltip, context menu, drag, zoom) continue to work
