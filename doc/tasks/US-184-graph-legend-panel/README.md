# US-184: Graph Editor — Legend Panel

## Goal

Add a collapsible legend panel to the bottom-left corner of the graph editor that lets users annotate what each node level and shape means, and selectively highlight nodes by level or shape.

## Background

### Existing highlighting system

The graph editor already has a two-layer dimming system in `ForceGraphRenderer.renderData()` (line 764-770):
- `searchMatches: Set<string> | null` — set by search
- `highlightSet: Set<string> | null` — set by Links tab in detail panel

When either is active, non-matching nodes render at `globalAlpha = 0.15` (dimmed). When both are active, they're intersected. The legend panel will use `searchMatches` (via `setSearchMatches`) for its highlighting, since the legend is conceptually a "filter/search" feature. However, `searchMatches` is currently controlled by the search system. We need a clean approach — see Implementation Plan.

### Graph data format

The legend descriptions should persist in the graph JSON's `options` field. Current `GraphOptions` interface ([types.ts:22-30](src/renderer/editors/graph/types.ts#L22-L30)):
```typescript
interface GraphOptions {
    rootNode?: string;
    expandDepth?: number;
    maxVisible?: number;
    charge?: number;
    linkDistance?: number;
    collide?: number;
}
```

### Node levels and shapes

- **Levels**: 1-5 (defined in `levelRadii = [14, 11, 8, 6, 4]` at [types.ts:88](src/renderer/editors/graph/types.ts#L88))
- **Shapes**: `"circle" | "square" | "diamond" | "triangle" | "star" | "hexagon"` ([types.ts:6](src/renderer/editors/graph/types.ts#L6))
- **Root node**: Rendered as compass star shape with level-1 size. Not a separate level or shape — it's a specific node designated by `options.rootNode`. In both the Level and Shape tabs, root should appear as an extra entry.

### Existing toolbar pattern

The top-left toolbar ([GraphView.tsx:463-563](src/renderer/editors/graph/GraphView.tsx#L463-L563)) uses:
- Absolute positioning, `opacity: 0.5` by default, `1.0` on hover/expanded
- Expandable with internal tabs (Physics, Expansion, Results)
- Green border highlight when expanded
- `width: 280px`

The legend panel should follow the same visual language but positioned at bottom-left.

### Styling pattern

Single styled root component (`GraphViewRoot`) with nested class-based styles — per project convention.

## Implementation Plan

### Step 1: Extend `GraphOptions` with legend data

**File:** [src/renderer/editors/graph/types.ts](src/renderer/editors/graph/types.ts)

Add legend fields to `GraphOptions`:
```typescript
interface GraphOptions {
    // ... existing fields ...
    legend?: {
        levels?: Record<string, string>;  // e.g. { "1": "Core services", "root": "Entry point" }
        shapes?: Record<string, string>;  // e.g. { "diamond": "React components", "root": "Entry point" }
    };
}
```

Key: level number as string (`"1"` through `"5"`) or `"root"`. For shapes: shape name or `"root"`.
Value: user-typed description string.

The `"root"` entry in both `levels` and `shapes` maps refers to the same node (the root node). Its description should be shared — editing in one tab updates the other. Store once under `levels.root` (canonical), and read/write from both tabs.

### Step 2: Add `legendHighlight` to `ForceGraphRenderer`

**File:** [src/renderer/editors/graph/ForceGraphRenderer.ts](src/renderer/editors/graph/ForceGraphRenderer.ts)

Add a third highlight layer:
```typescript
private legendHighlight: Set<string> | null = null;

setLegendHighlight(ids: Set<string> | null): void {
    this.legendHighlight = ids;
    this.renderData();
}
```

Update the dimming merge logic in `renderData()` (line 767-770) to include all three layers:
```typescript
// Merge all active highlight layers (intersection when multiple active)
const layers = [searchMatches, highlightSet, legendHighlight].filter(Boolean) as Set<string>[];
let dimSet: Set<string> | null = null;
if (layers.length === 1) {
    dimSet = layers[0];
} else if (layers.length > 1) {
    dimSet = new Set([...layers[0]].filter((id) => layers.every((s) => s.has(id))));
}
const dimming = dimSet !== null;
```

### Step 3: Add `setLegendHighlight` to `GraphViewModel`

**File:** [src/renderer/editors/graph/GraphViewModel.ts](src/renderer/editors/graph/GraphViewModel.ts)

Add pass-through method (similar to `setHighlightSet`):
```typescript
setLegendHighlight(ids: Set<string> | null): void {
    this.renderer.setLegendHighlight(ids);
}
```

Add helper to get visible nodes by level/shape/root:
```typescript
getNodeIdsByFilter(filter: { levels?: number[]; shapes?: NodeShape[]; includeRoot?: boolean }): Set<string> {
    // Iterate visible nodes, collect IDs matching any of the given levels/shapes/root
}
```

Add methods to read/write legend descriptions (updates options and serializes):
```typescript
getLegendDescriptions(): { levels: Record<string, string>; shapes: Record<string, string> } { ... }
setLegendDescription(tab: "levels" | "shapes", key: string, value: string): void { ... }
```

### Step 4: Create `GraphLegendPanel.tsx` component

**File:** `src/renderer/editors/graph/GraphLegendPanel.tsx` (new)

A self-contained component following `GraphDetailPanel` / toolbar patterns.

**Props:**
```typescript
interface GraphLegendPanelProps {
    vm: GraphViewModel;
}
```

**Layout (collapsed):**
- Bottom-left corner, absolute positioned
- Small bar showing "Legend" text with expand chevron
- Semi-transparent (opacity 0.5), full on hover

**Layout (expanded):**
- Expands upward from bottom-left
- Two tabs: "Level" and "Shape"
- Width ~240px, max height ~300px
- Green border when expanded (same as toolbar)

**Level tab content:**
Each row for levels present in the graph + root (if root node exists):
```
[checkbox] Level N  [________________]
[checkbox] Root     [________________]
```
- Checkbox: toggles highlighting for that level
- "Level N": label (N = 1-5), "Root" for root node
- Text input: free-form description, persisted to `options.legend.levels["N"]`
- Visual indicator: small filled circle sized by level radius (inline SVG or styled div)

**Shape tab content:**
Each row for shapes present in the graph + root:
```
[checkbox] ◇ Diamond  [________________]
[checkbox] ✦ Root     [________________]
```
- Checkbox: toggles highlighting for that shape
- Shape icon: small inline SVG of the shape
- Text input: description, persisted to `options.legend.shapes["shapeName"]`

**Only show levels/shapes that exist in the current graph data** — scan visible nodes to determine which levels (1-5) and shapes are actually used.

**Root entry behavior:**
- Appears in both tabs (if root node exists)
- Description is shared — editing in either tab updates both
- Stored canonically in `options.legend.levels.root`

**Highlighting logic:**
- When the legend panel is expanded AND the active tab has checked checkboxes:
  - Collect node IDs matching any checked level/shape/root
  - Call `vm.setLegendHighlight(nodeIds)`
- When panel is collapsed or no checkboxes are checked:
  - Call `vm.setLegendHighlight(null)` to clear

### Step 5: Add styles to `GraphViewRoot`

**File:** [src/renderer/editors/graph/GraphView.tsx](src/renderer/editors/graph/GraphView.tsx)

Add legend panel styles in `GraphViewRoot` styled component:
```css
"& .graph-legend": {
    position: "absolute",
    bottom: 8,
    left: 8,
    width: 240,
    backgroundColor: color.graph.background,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    zIndex: 1,
    opacity: 0.5,
    transition: "opacity 0.15s",
    "&:hover, &.expanded": { opacity: 1 },
    "&.expanded": { borderColor: color.graph.nodeHighlight },
}
// ... nested styles for rows, checkboxes, inputs, tabs
```

### Step 6: Integrate in `GraphView`

**File:** [src/renderer/editors/graph/GraphView.tsx](src/renderer/editors/graph/GraphView.tsx)

Add `<GraphLegendPanel vm={vm} />` inside the `<>` fragment, after the detail panel (around line 580).

### Step 7: Persist legend on input change

When user types in a description input:
- Debounce (300ms) the update
- Call `vm.setLegendDescription(tab, key, value)`
- ViewModel updates `sourceData.options.legend` and serializes via `host.changeContent()`

## Concerns / Open Questions

1. **Highlight layer interaction**: When legend highlighting is active AND search is also active, they intersect (only nodes matching both are fully visible). Is this the desired behavior? Alternative: legend could override search. **Recommendation**: intersection is consistent with existing behavior.

2. **Root description sharing**: The root node appears in both Level and Shape tabs. Should editing the description in one tab instantly update the other? **Recommendation**: Yes, store once, display in both.

3. **Empty graph / no levels**: If the graph has no nodes, or all nodes have the same level, should the legend still show? **Recommendation**: Only show levels/shapes actually present. If only one level exists, still show it (user might want to document it).

4. **Panel collapse clears highlighting**: When user collapses the legend panel, should checkboxes remain checked (and highlighting re-activate on expand)? Or should collapsing clear everything? **Resolved**: Collapsing clears highlighting (calls `setLegendHighlight(null)`), but checkbox state is preserved so re-expanding restores it.

5. **No auto-collapse**: Unlike the toolbar (which collapses on canvas click), the legend panel only collapses/expands on explicit user click on its header. This lets users keep the legend visible while interacting with the graph. **Resolved**: Agreed.

## Acceptance Criteria

- [ ] Legend panel appears at bottom-left corner of graph editor
- [ ] Collapsed by default, semi-transparent, full opacity on hover
- [ ] Clicking expands upward with "Level" and "Shape" tabs
- [ ] Level tab shows rows for each level present in graph + root (if exists)
- [ ] Shape tab shows rows for each shape present in graph + root (if exists)
- [ ] Each row has: checkbox, visual indicator (level circle / shape icon), label, text input
- [ ] Checking checkboxes highlights matching nodes (others dimmed at 15% opacity)
- [ ] Highlighting only active when panel is expanded and active tab has checked items
- [ ] Description text inputs persist to `options.legend` in the graph JSON
- [ ] Root node entry appears in both tabs with shared description
- [ ] Collapsing panel clears highlighting but preserves checkbox state
- [ ] Visual style matches existing toolbar (opacity, border, colors)
