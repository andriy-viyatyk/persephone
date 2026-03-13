# US-174: Node tooltips (HTML overlay)

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Show an HTML tooltip overlay when hovering over a graph node. The tooltip displays the node's title, id, and any custom (user-defined) properties. It appears after a ~500ms delay and hides immediately on mouse leave.

## Background

### Current state

- **Hover detection** already works: `ForceGraphRenderer.onMouseMove()` calls `findNodeAt()` then `setHoveredId()`. The hovered node ID and neighbor set are tracked (`hoveredId`, `hoveredChild`), and the canvas re-renders with highlight colors.
- **The ViewModel has no visibility into hover state.** The renderer keeps `hoveredId` private — there's no callback to the ViewModel when the hovered node changes.
- **Drag detection** exists: `isDraggingNode` flag is set during D3 drag events. Tooltips should not appear during drag.
- **Mouse coordinates** are available in `onMouseMove` as `event.clientX`/`event.clientY` (screen coords). The renderer doesn't currently store them.
- **Existing tooltip component** (`src/renderer/components/basic/Tooltip.tsx`): uses `react-tooltip` library, portaled to `document.body`. It's designed for anchor-based hover (not canvas elements), so **not directly usable** here — we need a manually positioned overlay.

### GraphNode custom properties

Nodes can have any key-value pairs beyond the known properties. To display custom properties in the tooltip, we need to filter out:
- **Core**: `id`
- **Presentation**: `title`, `level`, `shape`
- **D3 simulation**: `x`, `y`, `vx`, `vy`, `fx`, `fy`, `index`
- **System**: any key starting with `_$` (`_$showIndex`, `_$hiddenCount`)

Everything else is a custom property to display.

### Pattern to follow

The tooltip is an **HTML div overlay** positioned absolutely over the canvas. Similar to how the toolbar is positioned (`position: absolute; top/left`) inside `GraphViewRoot`, but the tooltip is positioned at the cursor.

Since the tooltip content changes based on hover state (which comes from the renderer), the flow is:
1. Renderer detects hover change → calls callback to ViewModel
2. ViewModel applies delay (500ms) → updates state with hovered node info + mouse position
3. React re-renders → tooltip overlay appears at mouse position

## Implementation plan

### Step 1: Add hover callback from renderer to ViewModel

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add public callback field: `onHoverChanged: ((nodeId: string, clientX: number, clientY: number) => void) | null = null`
- Modify `setHoveredId()`: after setting `hoveredId` and `hoveredChild`, call `this.onHoverChanged?.(id, this._lastClientX, this._lastClientY)`
- Store mouse screen coordinates in `onMouseMove`: `this._lastClientX = event.clientX; this._lastClientY = event.clientY` (before the hover detection)
- Add private fields: `_lastClientX = 0`, `_lastClientY = 0`

### Step 2: Add tooltip state to GraphViewState

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add to `defaultGraphViewState`:
  ```typescript
  tooltipNode: null as GraphNode | null,  // The full node object (for property display)
  tooltipPos: null as { x: number; y: number } | null,  // Screen coordinates
  ```
- Add private field: `_tooltipTimer: ReturnType<typeof setTimeout> | undefined`
- Add cleanup in constructor subscriptions: `this.addSubscription(() => clearTimeout(this._tooltipTimer))`
- Wire callback in `onInit()`: `this.renderer.onHoverChanged = (nodeId, cx, cy) => this.handleHoverChanged(nodeId, cx, cy)`

### Step 3: Implement hover delay logic in ViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `handleHoverChanged(nodeId: string, clientX: number, clientY: number)`:
  ```
  - Clear any pending tooltip timer
  - If nodeId is empty OR isDraggingNode:
    - Immediately hide tooltip: state.update → tooltipNode = null, tooltipPos = null
    - Return
  - Start 500ms timer:
    - Find the node object from renderer.getNodes() by ID
    - If found: state.update → tooltipNode = node, tooltipPos = { x: clientX, y: clientY }
  ```
- Need to expose `isDraggingNode` from renderer — add public getter: `get isDragging(): boolean { return this.isDraggingNode; }`

### Step 4: Create tooltip overlay component

**File:** `src/renderer/editors/graph/GraphTooltip.tsx` (new file)

- Accepts props: `node: GraphNode`, `pos: { x: number; y: number }`
- Styled with `GraphTooltipRoot` — single root styled component with nested class selectors
- Styling:
  - `position: fixed` (uses screen coordinates from `clientX/clientY`)
  - `z-index: 10` (above canvas but below modals)
  - Background: `color.graph.labelBackground`
  - Text: `color.graph.labelText`
  - Border: `1px solid ${color.border.default}`
  - Border radius: 4px
  - Padding: 8px
  - Font size: 12px
  - Max width: 300px
  - Pointer events: none (so tooltip doesn't interfere with mouse)
  - Box shadow: `0 2px 8px ${color.shadow.default}`
- Layout:
  - **Title line**: `node.title || node.id` in bold (`.tooltip-title`)
  - **ID line** (only if `title` exists): `node.id` in smaller, muted text (`.tooltip-id`)
  - **Custom properties**: key-value list (`.tooltip-props` table or dl)
    - Each row: key (muted) + value
    - Values: stringify non-string values with `JSON.stringify()` for objects/arrays, `String()` for primitives
    - Skip if no custom properties
- Viewport clamping:
  - Position tooltip 12px right and 12px below cursor
  - Use `useRef` + `useLayoutEffect` to measure tooltip dimensions after render
  - Clamp so tooltip doesn't overflow viewport edges
  - If tooltip would go off right edge, show to the left of cursor instead
  - If tooltip would go off bottom edge, show above cursor instead

### Step 5: Render tooltip in GraphView

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Import `GraphTooltip` (dynamic import not needed — it's tiny and part of the graph editor)
- Destructure `tooltipNode` and `tooltipPos` from `pageState`
- Render after the canvas (inside the `<>` fragment, after toolbar):
  ```tsx
  {tooltipNode && tooltipPos && (
      <GraphTooltip node={tooltipNode} pos={tooltipPos} />
  )}
  ```

### Step 6: Handle edge cases

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- **Data change while tooltip visible**: In `parseContent()`, clear tooltip state (the node reference may become stale)
- **Visibility change**: In `resetVisibility()` and `handleBadgeExpand()`, clear tooltip (node may be hidden/changed)
- Helper: `private clearTooltip()` that clears timer + sets `tooltipNode = null, tooltipPos = null`

## Concerns / Open questions

1. **Fixed vs absolute positioning** — Using `position: fixed` with `clientX/clientY` is simplest since we have screen coordinates. No need to account for canvas offset or scroll. The tooltip has `pointer-events: none` so it won't intercept mouse events.

2. **Tooltip during drag/zoom** — Should be suppressed. When drag starts, `isDraggingNode` becomes true. The hover callback should check this and hide/prevent tooltip. Also hide tooltip on zoom in/out (D3 zoom events). D3 drag captures mouse events so `onMouseMove` won't fire during drag anyway.

3. **Custom property value display** — Values could be anything: strings, numbers, booleans, arrays, objects. Proposed approach:
   - `string` / `number` / `boolean` → display as-is
   - `null` / `undefined` → skip or show "null"
   - `object` / `array` → `JSON.stringify(value)` truncated to ~100 chars
   - This keeps the tooltip compact. The detail panel (US-176) will show full values.

4. **Tooltip flicker when moving between nodes** — Clear tooltip immediately on hover change (no fade), then restart the 500ms timer for the new node. This prevents showing stale tooltip for the wrong node.

5. **Node object reference** — The renderer's `graphData.nodes` may be replaced on data updates. Storing the node object in state is fine since immer will freeze a snapshot. But we should clear tooltip on data changes (Step 6) to avoid showing stale data.

6. **Performance** — The `onHoverChanged` callback fires on every `setHoveredId()` call, which happens on every mouse move over a node. But the ViewModel only updates React state after the 500ms timer, so there's no excessive re-rendering.

## Acceptance criteria

- [ ] Tooltip appears after ~500ms hover delay on a node
- [ ] Tooltip shows node title (or id if no title) as header
- [ ] Tooltip shows node id (when title is present) as secondary text
- [ ] Tooltip shows custom properties as key-value pairs
- [ ] Known properties (level, shape) and D3/system properties are excluded
- [ ] Tooltip hides immediately when mouse leaves the node
- [ ] Tooltip does not appear during node drag
- [ ] Tooltip stays within viewport bounds (clamped positioning)
- [ ] Tooltip uses theme colors (no hardcoded values)
- [ ] Tooltip has `pointer-events: none` (doesn't block mouse events)
- [ ] Data changes clear tooltip
- [ ] Visibility changes clear tooltip
- [ ] No tooltip flicker when moving between nodes
