# US-171: Node Properties — title, level, shape

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Add `title`, `level`, and `shape` properties to graph nodes. Nodes render with display labels (title fallback to id), sizes based on level (1=largest, 5=smallest), and 6 shape types. Level 1-2 nodes always show labels.

## Background

### Current state
- `GraphNode` interface has only `id` (extends `SimulationNodeDatum`)
- All nodes render as circles with the same radius (`forceProperties.collide.radius = 6`)
- Labels show only for active/hovered/neighbor nodes at zoom > 0.8, using `d.id` as text
- `findNode()` hit-tests using a fixed radius
- `forceCollide` uses a single fixed radius for all nodes

### Key files
- [types.ts](../../../src/renderer/editors/graph/types.ts) — `GraphNode`, `GraphLink`, `GraphData`
- [ForceGraphRenderer.ts](../../../src/renderer/editors/graph/ForceGraphRenderer.ts) — D3 simulation + canvas rendering
- [GraphViewModel.ts](../../../src/renderer/editors/graph/GraphViewModel.ts) — JSON parsing → `GraphData`
- [constants.ts](../../../src/renderer/editors/graph/constants.ts) — `forceProperties` (collide radius = 6)

### Test data
- `D:\js-notepad-notes\temp\miserables.fg.json` — 77 nodes, none have title/level/shape yet

## Implementation Plan

### Step 1: Update types — `types.ts`

Add optional properties to `GraphNode`:

```typescript
export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "star" | "hexagon";

export interface GraphNode extends SimulationNodeDatum {
    id: string;
    title?: string;
    level?: number;   // 1-5, controls size (1=largest)
    shape?: NodeShape;
}
```

Add a helper to get the node display label and radius:

```typescript
export function nodeLabel(node: GraphNode): string {
    return node.title || node.id;
}

export function nodeRadius(node: GraphNode): number {
    // Level 1 = 14, Level 2 = 11, Level 3 = 8, Level 4 = 6, Level 5 = 4 (default)
    const radii = [14, 11, 8, 6, 4];
    const level = node.level;
    if (level != null && level >= 1 && level <= 5) return radii[level - 1];
    return 4; // invalid or missing level → treat as level 5 (smallest)
}
```

**Radius values rationale:** Current radius is 6. Nodes without a level (or with invalid level) are treated as level 5 (smallest, radius 4) — this ensures that the majority of "unimportant" nodes stay small while explicitly leveled nodes stand out. Level 1 nodes at radius 14 are ~3.5x a default node.

### Step 2: Update constants — `constants.ts`

The fixed `collide.radius` value (6) is no longer used for rendering or collision — it's replaced by per-node `nodeRadius()`. Keep the value as documentation of the old default, but it won't be referenced in code anymore. **No change needed** — we'll just stop referencing `forceProperties.collide.radius` in the renderer.

### Step 3: Shape drawing — `ForceGraphRenderer.ts`

Add a private `drawShape()` method that draws a node shape at (x, y) with given radius:

```typescript
private drawShape(ctx: CanvasRenderingContext2D, shape: NodeShape | undefined, x: number, y: number, r: number): void {
    ctx.beginPath();
    switch (shape) {
        case "square":
            ctx.rect(x - r, y - r, r * 2, r * 2);
            break;
        case "diamond":
            ctx.moveTo(x, y - r * 1.2);
            ctx.lineTo(x + r, y);
            ctx.lineTo(x, y + r * 1.2);
            ctx.lineTo(x - r, y);
            ctx.closePath();
            break;
        case "triangle":
            const h = r * 1.15;
            ctx.moveTo(x, y - h);
            ctx.lineTo(x + r, y + h * 0.6);
            ctx.lineTo(x - r, y + h * 0.6);
            ctx.closePath();
            break;
        case "star": {
            const spikes = 5;
            const outerR = r * 1.1;
            const innerR = r * 0.5;
            for (let i = 0; i < spikes * 2; i++) {
                const angle = (i * Math.PI) / spikes - Math.PI / 2;
                const rad = i % 2 === 0 ? outerR : innerR;
                if (i === 0) ctx.moveTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
                else ctx.lineTo(x + rad * Math.cos(angle), y + rad * Math.sin(angle));
            }
            ctx.closePath();
            break;
        }
        case "hexagon": {
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3 - Math.PI / 6;
                if (i === 0) ctx.moveTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
                else ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
            }
            ctx.closePath();
            break;
        }
        default: // "circle" or undefined
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            break;
    }
}
```

### Step 4: Update node rendering — `ForceGraphRenderer.ts`

In `renderData()`, replace the fixed-radius circle drawing with shape-aware drawing:

**Before:**
```typescript
ctx.beginPath();
ctx.arc(d.x || 0, d.y || 0, forceProperties.collide.radius, 0, 2 * Math.PI);
```

**After:**
```typescript
const r = nodeRadius(d);
this.drawShape(ctx, d.shape, d.x || 0, d.y || 0, r);
```

### Step 5: Update label rendering — `ForceGraphRenderer.ts`

Two changes in the label section:

1. **Use `nodeLabel(d)` instead of `d.id`** for display text
2. **Always show labels for level 1-2 nodes** (not just active/hovered/neighbor)
3. **Use `nodeRadius(d)` for label offset** instead of fixed `forceProperties.collide.radius`

```typescript
if (transform.k > 0.8) {
    graphData.nodes.forEach((d) => {
        const isHighlighted = d.id === activeState.activeId ||
            d.id === activeState.hoveredId ||
            activeState.activeChild.has(d.id) ||
            activeState.hoveredChild.has(d.id);
        const isImportant = d.level != null && d.level >= 1 && d.level <= 2;

        if (isHighlighted || isImportant) {
            const labelText = nodeLabel(d);
            const r = nodeRadius(d);
            const labelX = (d.x || 0) + r + 4;
            // ... rest unchanged, using labelX based on per-node radius
        }
    });
}
```

### Step 6: Update `forceCollide` — `ForceGraphRenderer.ts`

In `applyPositionForces()`, change collide radius from fixed to per-node:

**Before:**
```typescript
d3.forceCollide<GraphNode>()
    .strength(forceProperties.collide.strength)
    .radius(forceProperties.collide.radius)
```

**After:**
```typescript
d3.forceCollide<GraphNode>()
    .strength(forceProperties.collide.strength)
    .radius((d) => nodeRadius(d) + 1)  // +1 for small gap between nodes
```

### Step 7: Update `findNode()` hit-testing — `ForceGraphRenderer.ts`

Use per-node radius for hit detection:

**Before:**
```typescript
return Math.sqrt(dx * dx + dy * dy) <= forceProperties.collide.radius;
```

**After:**
```typescript
return Math.sqrt(dx * dx + dy * dy) <= nodeRadius(node);
```

### Step 8: Update `GraphViewModel.parseContent()` — `GraphViewModel.ts`

Preserve `title`, `level`, `shape` when parsing nodes:

**Before:**
```typescript
const graphData: GraphData = {
    nodes: Array.isArray(json.nodes) ? json.nodes : [],
    links: Array.isArray(json.links) ? json.links : [],
};
```

This already works — `json.nodes` objects retain all their properties when assigned to `GraphData.nodes`. The `GraphNode` interface just adds optional typing. **No change needed here.** The deep copy via `JSON.parse(JSON.stringify())` also preserves these primitive properties.

### Step 9: Update test data

Add `title`, `level`, and `shape` to a few key nodes in `miserables.fg.json` so we can visually verify:
- Set "Valjean" to level 1 with title "Jean Valjean" (the protagonist)
- Set a few important characters to level 2
- Add different shapes to a few nodes for visual testing

## Concerns / Open Questions

### 1. Font size scaling with level
Currently labels use a fixed implicit font size (canvas default ~10px). Should level 1-2 nodes also have larger label text? **Recommendation:** No, keep font size uniform — larger node + always-visible label is enough differentiation. We can revisit later if needed.

### 2. Collision radius vs visual radius
D3 `forceCollide` uses circular collision regardless of shape. A square with radius 8 has corners at ~11.3px from center. This means shapes like diamond/star will have slightly more space than their visual bounds, and squares will have very slight overlap at corners. **This is acceptable** — the visual difference is imperceptible at typical graph scales, and the original implementation in interactive-script didn't support shapes at all.

### 3. Default level for nodes without `level` — RESOLVED
Nodes without `level` or with invalid level (<1 or >5) are treated as **level 5** (smallest, radius 4). This makes un-leveled nodes small and unobtrusive, while explicitly leveled nodes naturally stand out.

### 4. Dead code cleanup
Line 78 of `GraphView.tsx` has dead code: `{!loading && graphData && !error && null}`. Should clean it up as part of this task.

## Acceptance Criteria

- [ ] `GraphNode` type includes optional `title`, `level`, `shape` properties
- [ ] `NodeShape` type exported from types.ts
- [ ] `nodeLabel()` and `nodeRadius()` helpers in types.ts
- [ ] Nodes render with correct shapes (circle, square, diamond, triangle, star, hexagon)
- [ ] Node size varies by level (1=largest, 5=smallest, default=level 3)
- [ ] `forceCollide` uses per-node radius
- [ ] Hit-testing (`findNode`) uses per-node radius
- [ ] Labels show `title` (fallback to `id`)
- [ ] Level 1-2 nodes always show labels at zoom > 0.8 (not just on hover/select)
- [ ] Label offset accounts for per-node radius
- [ ] Test data updated with a few title/level/shape examples
- [ ] Dead code on GraphView.tsx line 78 removed
