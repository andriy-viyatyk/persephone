# US-175: Context menu + basic editing

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Add right-click context menu to the graph canvas and implement basic graph editing operations: add/delete nodes, add/delete links, and serialize all changes back to JSON. This transforms the graph editor from read-only visualization to an interactive editor.

## Background

### Current state

- **Graph is read-only.** `GraphViewModel.parseContent()` reads JSON → passes to renderer. There is no write-back path (`host.changeContent()` is never called).
- **Click/hover interactions exist.** `ForceGraphRenderer` has `onClick` (select node), `onMouseMove` (hover), drag behavior, and badge click expansion.
- **No `onContextMenu` handler.** The canvas element in `GraphView.tsx` only has `onClick` and `onMouseMove`. Right-click currently shows the global default context menu (Copy/Paste/Inspect via `GlobalEventService`).
- **`showAppPopupMenu(x, y, items)`** is the standard API for context menus. Import: `import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu"`. Takes screen coordinates and `MenuItem[]`.
- **`MenuItem` interface** (from `PopupMenu.tsx`): `{ label, onClick?, disabled?, icon?, startGroup?, hotKey?, items? (submenus) }`.

### Write-back pattern (from other editors)

Other content-view editors (todo, notebook, link) use the **skip-flag pattern** to serialize changes:

```typescript
private skipNextContentUpdate = false;

protected onContentChanged(content: string): void {
    if (this.skipNextContentUpdate) {
        this.skipNextContentUpdate = false;
        return;
    }
    this.loadData(content);
}

private serializeToHost(): void {
    this.skipNextContentUpdate = true;
    const content = JSON.stringify(data, null, 4);
    this.host.changeContent(content, true);
}
```

This prevents infinite loops: writing content triggers `onContentChanged`, which the flag skips.

### Three-layer data architecture

The core design insight is maintaining **three layers of data** with clear separation:

```
Layer 1: sourceData {nodes, links, options}     ← clean, editable, serializable
    ↓ transform (visibility model creates new node objects with _$ props)
Layer 2: preparedData {nodes with _$, links}    ← visibility-filtered, has _$ props
    ↓ feed to renderer
Layer 3: renderer nodes {x, y, vx, vy, ...}    ← D3 simulation positions
```

- **Layer 1 (sourceData):** The parsed JSON object. Never has `_$` or D3 properties. This is what we edit and serialize back. `JSON.stringify(sourceData)` produces clean JSON — no stripping needed.
- **Layer 2 (preparedData):** Output of `GraphVisibilityModel.getVisibleGraph()`. Creates **shallow copies** of source nodes with `_$showIndex` and `_$hiddenCount` added. Source nodes are never mutated.
- **Layer 3 (renderer):** D3 simulation adds `x`, `y`, `vx`, `vy`, `fx`, `fy`, `index` to the Layer 2 copies.

**Key point:** `getVisibleGraph()` already creates shallow copies (`{ ...pn.node, _$showIndex, _$hiddenCount }`). It never writes `_$` properties back to the original node objects. This means Layer 1 stays clean naturally.

For the **inactive case** (small graphs, no filtering), `parseContent()` currently does `JSON.parse(JSON.stringify(graphData))` to create a deep copy for the renderer. This also keeps Layer 1 clean.

### Position preservation on rebuild

When the data changes (edit or external), we rebuild Layer 2 from Layer 1 and update the renderer. To preserve node positions:

- `ForceGraphRenderer.updateVisibleData(graphData, anchorNodeId?)` already does this:
  - Saves `{x, y, vx, vy}` for all existing nodes by ID before update
  - Restores them on matching nodes after update
  - Places new nodes near `anchorNodeId` with ±10px random offset

Currently `parseContent()` always uses `updateData()` (full reset — positions lost). For editing, we'll use `updateVisibleData()` instead on subsequent updates to preserve positions.

### Coordinate systems

For "Add node at click position":
- Right-click gives screen coordinates (`event.clientX`, `event.clientY`)
- Canvas coordinates = screen - `canvas.getBoundingClientRect().left/top`
- World coordinates = `transform.invertX/Y(canvasCoords)` — these are what D3 simulation uses for `node.x`, `node.y`
- New nodes need world coordinates so they appear at the click position

### Node ID generation

Need a strategy for generating unique IDs for new nodes:
- Must not collide with existing IDs
- Should be human-readable (not UUIDs) since users see them in JSON
- Proposed: `"node-N"` where N increments from 1, skipping existing IDs

## Implementation plan

### Step 1: Refactor GraphViewModel to maintain sourceData (Layer 1)

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

Introduce the clean source data layer:

- Add `private sourceData: { nodes: GraphNode[]; links: GraphLink[]; options?: GraphOptions } | null = null` — the parsed JSON data, never has _$ or D3 properties
- Add `private originalJson: Record<string, unknown> = {}` — full parsed JSON to preserve extra top-level properties (`type`, any custom properties user added)
- Add `private isFirstLoad = true` — controls whether to use `updateData` (first) or `updateVisibleData` (subsequent)
- Modify `parseContent()`:
  ```
  1. JSON.parse(content) → save as this.originalJson
  2. Extract nodes/links/options → save as this.sourceData (clean copy)
  3. Run pipeline: rebuildAndRender()
  ```
- Add `private rebuildAndRender(anchorNodeId?: string)`:
  ```
  1. visibilityModel.setFullGraph(sourceData.nodes, sourceData.links, sourceData.options)
  2. Get visible graph: if filtering active → getVisibleGraph(), else deep copy of sourceData
  3. If isFirstLoad → renderer.updateData(copy), set isFirstLoad = false
     Else → renderer.updateVisibleData(copy, anchorNodeId)   // preserves positions!
  4. recomputeSearch()
  5. clearTooltip()
  ```
- Add serialization:
  - `private skipNextContentUpdate = false`
  - Modify `onContentChanged()` to check skip flag
  - Add `private serializeToHost()`:
    ```
    this.skipNextContentUpdate = true;
    const json = { ...this.originalJson, nodes: this.sourceData.nodes, links: this.sourceData.links };
    if (this.sourceData.options) json.options = this.sourceData.options;
    this.host.changeContent(JSON.stringify(json, null, 4), true);
    ```
  No stripping of any properties — sourceData is already clean.

### Step 2: Add context menu callback from renderer

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add callback field: `onContextMenu: ((nodeId: string, clientX: number, clientY: number) => void) | null = null`
- Add `onContextMenu` event handler (bound arrow function, for React):
  ```typescript
  onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      const node = this.findNodeAt(event);
      this.onContextMenu?.(node?.id ?? "", event.clientX, event.clientY);
  };
  ```
- Add `screenToWorld` public method for coordinate conversion:
  ```typescript
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
      if (!this.canvas) return { x: 0, y: 0 };
      const rect = this.canvas.getBoundingClientRect();
      return {
          x: this.transform.invertX(clientX - rect.left),
          y: this.transform.invertY(clientY - rect.top),
      };
  }
  ```
- Note: The renderer only does hit-testing and forwards the event. All menu logic lives in the ViewModel.

### Step 3: Add editing operations to GraphViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

All methods operate on `this.sourceData` (Layer 1), then call `rebuildAndRender()` + `serializeToHost()`.

- **`addNode(worldX: number, worldY: number): string`**
  - Generate unique ID: `"node-1"`, `"node-2"`, etc. (check against existing IDs in sourceData.nodes)
  - Push `{ id }` to `sourceData.nodes` (clean — no x/y, D3 will use the position from updateVisibleData's anchor placement)
  - Call `rebuildAndRender(newNodeId)` — anchor placement puts new node near worldX/worldY
  - Actually: `updateVisibleData` places new nodes near `anchorNodeId` (existing node), not at arbitrary coordinates. For empty-area "Add Node", there's no anchor node. **Solution:** set initial `x`/`y` on the new node in sourceData temporarily, or add a `newNodePositions` hint map to the renderer. Simplest: add `x`/`y` to source node — they'll be stripped naturally when D3 creates its copy. Wait — they won't, because sourceData stays clean. **Better solution:** after `rebuildAndRender()`, manually set `fx`/`fy` on the renderer's copy of the new node, then release after simulation stabilizes. Or: add an optional `newNodeHints: Map<string, {x, y}>` parameter to `updateVisibleData` for initial positions of brand-new nodes.
  - Call `serializeToHost()`
  - Return the new node ID

- **`deleteNode(nodeId: string): void`**
  - Remove node from `sourceData.nodes`
  - Remove all links where source or target matches nodeId from `sourceData.links`
  - Call `rebuildAndRender()` + `serializeToHost()`

- **`addLink(sourceId: string, targetId: string): void`**
  - Check link doesn't already exist (in either direction) in `sourceData.links`
  - Push `{ source: sourceId, target: targetId }` to `sourceData.links`
  - Call `rebuildAndRender()` + `serializeToHost()`

- **`deleteLink(sourceId: string, targetId: string): void`**
  - Remove matching link from `sourceData.links`
  - Call `rebuildAndRender()` + `serializeToHost()`

- **`addChild(parentId: string): string`**
  - Push new node to `sourceData.nodes`
  - Push link to `sourceData.links`
  - Call `rebuildAndRender(parentId)` — anchor = parent, so new node appears near parent
  - Call `serializeToHost()`
  - Return new node ID

### Step 4: Wire context menu in GraphView and ViewModel

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Add `onContextMenu={vm.renderer.onContextMenu}` to the canvas element

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Import: `import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu"`
- Wire in `onInit()`: `this.renderer.onContextMenu = (nodeId, cx, cy) => this.handleContextMenu(nodeId, cx, cy)`
- Add `handleContextMenu(nodeId: string, clientX: number, clientY: number)`:
  ```
  - Clear tooltip
  - If nodeId is empty (right-click on empty area):
    - Compute world coordinates via renderer.screenToWorld(clientX, clientY)
    - Show menu: [{ label: "Add Node", onClick: () => this.addNode(worldX, worldY) }]
  - If nodeId is set (right-click on node):
    - Select the node (renderer.setActiveId — needs to be exposed or done via callback)
    - Build menu items:
      - "Add Child" → this.addChild(nodeId)
      - "Delete Node" → this.deleteNode(nodeId)
      - --- (separator via startGroup) ---
      - "Delete Link ▸" submenu: for each connected node in sourceData.links, show "→ [neighborLabel]" → this.deleteLink(nodeId, neighborId)
    - Show menu via showAppPopupMenu(clientX, clientY, items)
  ```

### Step 5: Add Alt+Click link toggle

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add callback: `onAltClick: ((nodeId: string) => void) | null = null`
- Modify `onClick`:
  ```typescript
  onClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
      // Badge click takes priority
      const badgeNode = this.findBadgeAt(event);
      if (badgeNode && this.onBadgeExpand) {
          this.onBadgeExpand(badgeNode.id);
          return;
      }

      const node = this.findNodeAt(event);

      // Alt+Click → toggle link with selected node
      if (event.altKey && node && this.onAltClick) {
          this.onAltClick(node.id);
          return;
      }

      this.setActiveId(node?.id ?? "");
  };
  ```

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Wire in `onInit()`: `this.renderer.onAltClick = (nodeId) => this.handleAltClick(nodeId)`
- Add `handleAltClick(nodeId: string)`:
  ```
  - Get current activeId from renderer
  - If no activeId or activeId === nodeId → do nothing (can't self-link)
  - Check if link exists between activeId and nodeId
  - If exists → deleteLink(activeId, nodeId)
  - If not → addLink(activeId, nodeId)
  ```
- Need to expose `activeId` from renderer: add `get selectedId(): string { return this.activeId; }`

### Step 6: Handle new node positioning

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

The challenge: `updateVisibleData` places new nodes near `anchorNodeId`, but for "Add Node" on empty area there's no anchor — we want the node at the click position (world coordinates).

- Add optional parameter to `updateVisibleData`: `newNodePositions?: Map<string, { x: number; y: number }>`
- When restoring positions, check `newNodePositions` first for new nodes:
  ```typescript
  // In updateVisibleData, when setting positions for new nodes:
  if (newNodePositions?.has(node.id)) {
      const pos = newNodePositions.get(node.id)!;
      node.x = pos.x;
      node.y = pos.y;
  } else if (anchorNode) {
      node.x = anchorNode.x + (Math.random() - 0.5) * 20;
      node.y = anchorNode.y + (Math.random() - 0.5) * 20;
  }
  ```
- `rebuildAndRender()` passes `newNodePositions` when available (set by `addNode()`)

### Step 7: Handle edge cases

- **Visibility filtering active + add node:** New node added to sourceData. After `rebuildAndRender()`, visibility model re-runs. If graph is large, new disconnected node may not be visible. Call `visibilityModel.revealPaths([newNodeId])` to ensure visibility.
- **Delete last node:** Allow — results in empty graph `{ nodes: [], links: [] }`.
- **Self-links:** Prevent `addLink(a, a)`.
- **Duplicate links:** Check both directions (a→b and b→a) before adding.
- **Context menu during drag:** D3 drag captures events, shouldn't happen naturally.
- **External content change:** `onContentChanged` → `parseContent()` re-parses into fresh `sourceData`, then `rebuildAndRender()` uses `updateVisibleData` (not first load) → positions preserved for unchanged nodes.

## Concerns / Open questions

1. **Position preservation on external edit** — Using `updateVisibleData` for subsequent parses (not just edits) means external JSON edits also preserve positions. This is a UX improvement: editing one node's title in JSON won't cause the whole graph to re-layout. Only structural changes (add/remove nodes/links) would cause partial re-layout for affected nodes.

2. **`addNode` on empty area positioning** — `updateVisibleData`'s anchor mechanism works for "Add Child" (anchor = parent). For "Add Node" on empty area, we need to pass world coordinates explicitly. Step 6 adds a `newNodePositions` hint map. Alternative: could we just set `x`/`y` on the sourceData node temporarily and strip them before serialize? No — we want sourceData to stay clean.

3. **Alt+Click for link toggle** — Needs `activeId` exposed from renderer. Simple getter.

4. **Undo/redo** — Not in scope. `changeContent()` pushes to Monaco's undo stack, so Ctrl+Z in the text editor undoes graph edits. Visual undo deferred to later.

5. **"Delete Link" submenu UX** — For nodes with many connections, the submenu could be long. Acceptable for now — the detail panel (US-176) will provide a better link editing experience later.

6. **`isFirstLoad` flag** — Ensures first parse uses `updateData` (full simulation init with auto-centering), subsequent parses use `updateVisibleData` (position-preserving). Reset to `true` only on dispose.

## Acceptance criteria

- [ ] Right-click on empty area shows context menu with "Add Node"
- [ ] "Add Node" creates a node at the click position with a generated ID
- [ ] Right-click on a node shows context menu with "Add Child", "Delete Node", "Delete Link ▸"
- [ ] "Add Child" creates a new linked node near the parent
- [ ] "Delete Node" removes the node and all its links
- [ ] "Delete Link ▸" submenu lists connected nodes; clicking one removes that link
- [ ] All edits serialize back to JSON via `host.changeContent()`
- [ ] JSON is clean — no D3 or _$ properties in serialized output
- [ ] Serialized JSON preserves original structure (`type`, `options`, custom node properties)
- [ ] Skip-flag prevents re-parsing own changes
- [ ] Alt+Click on a node toggles link with currently selected node
- [ ] Self-links and duplicate links are prevented
- [ ] New nodes appear at correct position (world coordinates)
- [ ] Existing node positions are preserved after edits (not full re-layout)
- [ ] External content changes also preserve positions (position-preserving rebuild)
- [ ] Graph visualization updates immediately after each edit
- [ ] Existing features (search, tooltip, visibility, drag) continue to work
