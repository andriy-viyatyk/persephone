# US-188: Group node data model & rendering

**Epic:** EPIC-006 (Graph Editor)
**Status:** Planned

## Goal

Add `isGroup` property to nodes, render group nodes with a distinct shape, track group membership in a new `GraphGroupModel`, and exclude group nodes from detail-panel editing of level/shape. This task is data-model + rendering only — no link pre-processing (US-189) or grouping UI (US-190).

## Background

### Data format (from EPIC-006 Phase 3)

Group nodes have `isGroup: true`. Membership is defined by links from group→member:

```json
{
  "nodes": [
    { "id": "group-1", "title": "Components", "isGroup": true },
    { "id": "Button.tsx", "level": 3 },
    { "id": "Input.tsx", "level": 3 }
  ],
  "links": [
    { "source": "group-1", "target": "Button.tsx" },
    { "source": "group-1", "target": "Input.tsx" }
  ]
}
```

### Current architecture

**Node type system** (`src/renderer/editors/graph/types.ts`):
- `GraphNode` has: `id`, `title?`, `level?`, `shape?` (NodeShape), plus D3/system keys
- `NodeShape = "circle" | "square" | "diamond" | "triangle" | "star" | "hexagon"`
- Reserved keys: `CUSTOM_PROP_EXCLUDED_KEYS` set + `_$` prefix for system props
- `isReservedPropertyKey()` checks both sets
- `getCustomProperties()` enumerates non-reserved keys for tooltip/grid

**Root node pattern** (closest analog to group nodes):
- Root node ID stored in `options.rootNode`
- Renderer overrides shape to `"compass"` for root: `const shape = isRoot ? "compass" as const : d.shape` (ForceGraphRenderer.ts:691)
- Root gets larger radius via `effectiveNodeRadius()` (level-1 size = 14px)
- Root excluded from level/shape counting in `getPresentLevelsAndShapes()` (GraphDataModel.ts:290)
- Root has its own legend entry ("Root" row with compass icon)

**Shape rendering** (`src/renderer/editors/graph/shapeGeometry.ts`):
- `getShapePoints(shape, cx, cy, r)` returns polygon points or null (circle)
- `drawShape()` in renderer uses these points to draw on canvas
- Special handling: `"square"` uses `ctx.rect()` for pixel-crispness
- `"compass"` shape: 4-spike star via `compassPoints()`

**Shape icons** (`src/renderer/editors/graph/GraphIcons.tsx`):
- `ShapeIcon({ shape, size })` renders SVG for each shape + "root" (compass)
- Used in detail panel level/shape selectors and legend panel

**Pipeline**: `GraphDataModel` (source CRUD) → `GraphVisibilityModel` (BFS filtering) → `ForceGraphRenderer` (canvas)

**Detail panel** (`src/renderer/editors/graph/GraphDetailPanel.tsx`):
- Info tab: ID, Title, Level selector (1-5 icon buttons), Shape selector (6 shape icons)
- Multi-selection: hides ID/Title, shows batch level/shape editing
- Links tab disabled for multi-selection

**Legend panel** (`src/renderer/editors/graph/GraphLegendPanel.tsx`):
- Level tab: shows levels present in visible nodes
- Shape tab: shows shapes present in visible nodes
- Root gets separate row in both tabs
- `getPresentLevelsAndShapes()` skips root node in level/shape counting

**Tooltip** (`src/renderer/editors/graph/GraphTooltip.tsx`):
- Shows `title || id`, custom properties grid
- Uses `getCustomProperties(node)` — which uses `CUSTOM_PROP_EXCLUDED_KEYS`

**Context menu** (`src/renderer/editors/graph/GraphContextMenu.ts`):
- `buildNodeContextMenu()`: Add Child, Set as Root, Collapse, Delete Node, Delete Link
- `buildEmptyAreaContextMenu()`: Add Node

## Implementation plan

### Step 1: Extend GraphNode type

**File:** `src/renderer/editors/graph/types.ts`

- Add `isGroup?: boolean` to `GraphNode` interface
- Add `"isGroup"` to `CUSTOM_PROP_EXCLUDED_KEYS` set (so it doesn't appear in custom properties grid/tooltip)
- Add `"isGroup"` to `isReservedPropertyKey()` check (already covered by the set, but verify)

### Step 2: Group shape rendering — double circle

The group shape is a **double circle** (two concentric circles — inner filled, outer ring). This makes group nodes visually distinct while keeping the point-symmetric style of other shapes.

**Default border color**: dark blue (`color.graph.groupBorder` — new token). This helps distinguish the two circles from each other. The border switches to orange/green for selected/hovered states (same as other nodes).

**No new NodeShape value needed.** Group nodes don't have a user-selectable shape — the double-circle is always used when `isGroup: true`. The renderer checks `isGroup` directly (like root checks `isRoot`). This avoids polluting `NodeShape` with a non-user-selectable value.

**File:** `src/renderer/theme/color.ts` + theme files

- Add `color.graph.groupBorder` — a dark blue color for the outer ring of group nodes (e.g., `#3a6ea5` or similar). Must be defined in all themes.

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Update `drawShape()` signature: add `"group"` to the accepted shape union (alongside `"compass"`)
- Add `"group"` case: draw two concentric circles:
  ```typescript
  case "group":
      // Inner circle (filled by caller)
      ctx.arc(x, y, r * 0.65, 0, 2 * Math.PI);
      // Outer ring drawn separately after fill
      break;
  ```
- After `ctx.fill()` + `ctx.stroke()` for the main shape, draw the outer ring:
  ```typescript
  if (shape === "group") {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = isSelected ? colors.borderSelected
          : isHovered ? colors.borderHighlight
          : colors.groupBorder;  // dark blue default
      ctx.lineWidth = 2;
      ctx.stroke();
  }
  ```
- The inner circle border uses the same color logic as other nodes (selected/hovered/default)
- Add `groupBorder` to the `ResolvedColors` interface and resolution logic

**File:** `src/renderer/editors/graph/shapeGeometry.ts`

- Add `"group"` case to `getShapePoints()`: return `null` (like circle — uses `ctx.arc`)

**File:** `src/renderer/editors/graph/GraphIcons.tsx`

- Add `"group"` case to `ShapeIcon`:
  - Render two concentric SVG circles: inner filled, outer stroke-only with dark blue color
  - Inner radius ≈ 65% of outer radius (matching canvas proportions)

### Step 5: Create GraphGroupModel

**File:** `src/renderer/editors/graph/GraphGroupModel.ts` (NEW)

This is a **read-only analysis model** for US-188. It doesn't transform data yet (that's US-189). It only tracks membership for UI purposes (detail panel, context menu, tooltip).

```typescript
export class GraphGroupModel {
    /** Map from group node ID → Set of member node IDs */
    private groups = new Map<string, Set<string>>();
    /** Map from member node ID → group node ID (reverse lookup) */
    private memberOf = new Map<string, string>();

    /** Rebuild membership from source data. Call after any data change. */
    rebuild(nodes: GraphNode[], links: GraphLink[]): void {
        this.groups.clear();
        this.memberOf.clear();

        // Find all group nodes
        const groupIds = new Set<string>();
        for (const node of nodes) {
            if (node.isGroup) {
                groupIds.add(node.id);
                this.groups.set(node.id, new Set());
            }
        }

        // Find membership links: links FROM a group node TO a non-group node
        for (const link of links) {
            const { source, target } = linkIds(link);
            if (groupIds.has(source) && !groupIds.has(target)) {
                this.groups.get(source)!.add(target);
                this.memberOf.set(target, source);
            }
        }
    }

    /** Check if a node is a group node. */
    isGroup(nodeId: string): boolean {
        return this.groups.has(nodeId);
    }

    /** Get the group a node belongs to (undefined if not in any group). */
    getGroupOf(nodeId: string): string | undefined {
        return this.memberOf.get(nodeId);
    }

    /** Get all member IDs of a group node (empty set if not a group). */
    getMembers(groupId: string): ReadonlySet<string> {
        return this.groups.get(groupId) ?? EMPTY_SET;
    }

    /** Get all group node IDs. */
    get groupIds(): ReadonlySet<string> {
        // Derived from groups map keys
    }

    /** Get count of groups. */
    get groupCount(): number {
        return this.groups.size;
    }
}
```

### Step 6: Integrate GraphGroupModel into GraphViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `readonly groupModel = new GraphGroupModel()` property
- Call `groupModel.rebuild(nodes, links)` in `rebuildAndRender()` — right after `this.dataModel.sourceData` is available, before visibility model
- Pipeline becomes: `parse → groupModel.rebuild() → visibilityModel → renderer`

### Step 7: Renderer — group node rendering

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

In the node rendering loop (line ~687):

```typescript
graphData.nodes.forEach((d) => {
    const isRoot = rootId !== "" && d.id === rootId;
    const isGroupNode = !!d.isGroup;
    const r = effectiveNodeRadius(d, rootId);

    // Shape priority: root → group → user shape → circle
    const shape = isRoot ? "compass" as const
        : isGroupNode ? "group" as const
        : d.shape;

    this.drawShape(ctx, shape, d.x || 0, d.y || 0, r);
    // ... fill + stroke as before
});
```

- Group node radius: use level 1 size (14px) by default — group nodes are visually important. Update `effectiveNodeRadius()` to handle `isGroup`:
  ```typescript
  export function effectiveNodeRadius(node: GraphNode, rootNodeId: string): number {
      if (rootNodeId && node.id === rootNodeId) return nodeRadius({ level: 1 });
      if (node.isGroup) return nodeRadius({ level: 1 });
      return nodeRadius(node);
  }
  ```
- Group node labels: always show (like level 1-2 nodes). In the label rendering loop (~line 754), add `isGroupNode` to the `isImportant` check:
  ```typescript
  const isGroupNode = !!d.isGroup;
  const isImportant = isRoot || isGroupNode || (typeof d.level === "number" && d.level >= 1 && d.level <= 2);
  ```
- Group node font size: use level-1 font size (14px) since group nodes are conceptually top-level

### Step 8: Legend panel — group shape support

**File:** `src/renderer/editors/graph/GraphDataModel.ts`

- Update `getPresentLevelsAndShapes()`: skip group nodes from level counting (like root). Group nodes should appear as "Group" entry in the Shape tab:
  ```typescript
  for (const node of visibleNodes) {
      if (rootId !== "" && node.id === rootId) { hasRoot = true; continue; }
      if (node.isGroup) { shapes.add("group"); continue; }
      // ... existing level/shape logic
  }
  ```
- Update `getNodeIdsByLegendFilter()`: handle `"group"` shape in the shapes filter

**File:** `src/renderer/editors/graph/GraphLegendPanel.tsx`

- No changes needed — the legend already enumerates shapes from `presentShapes`. Adding `"group"` to `NodeShape` and the `ALL_SHAPES` array is sufficient.
- Update `ALL_SHAPES` constant to include `"group"`:
  ```typescript
  const ALL_SHAPES: NodeShape[] = ["circle", "square", "diamond", "triangle", "star", "hexagon", "group"];
  ```

### Step 9: Detail panel — filter out group nodes before passing

**Design decision:** Group nodes are filtered out from the `selectedNodes` array **before** passing to the detail panel. The panel never sees group nodes. This means:
- No group-specific logic needed inside `GraphDetailPanel`
- If only group nodes are selected, the panel shows "select node for edit" (empty state)
- If mix of group + regular nodes selected, panel shows only the regular nodes

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Filter group nodes when computing panel props:
  ```typescript
  const panelNodes = selectedNodes.filter(n => !n.isGroup);
  ```
- Pass `panelNodes` (not `selectedNodes`) to `GraphDetailPanel` as the `nodes` prop
- Also filter `nodeIds` in batch callbacks (`onBatchUpdateProps`, `onBatchApplyProperties`) to exclude group node IDs — or rely on the panel never sending group IDs since it never receives them

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx`

- **No changes needed** — the panel already handles empty `nodes` array as "no selection"

**Single group node tooltip/info:** When a single group node is selected, the panel shows empty state. The user can still see group info via hover tooltip ("Group · N members"). This is sufficient for US-188. More group-specific panel UI (member list, edit title) comes in US-190.

### Step 10: Tooltip — show group info

**File:** `src/renderer/editors/graph/GraphTooltip.tsx`

- When hovering a group node, show member count in tooltip:
  - Add optional `memberCount?: number` prop
  - Display "Group · N members" below the title (before custom properties)

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- When building tooltip info, include member count:
  ```typescript
  if (node) {
      const memberCount = this.groupModel.isGroup(node.id)
          ? this.groupModel.getMembers(node.id).size : undefined;
      this.state.update((s) => {
          s.tooltip = { node: { ...node }, x: clientX, y: clientY, memberCount };
      });
  }
  ```

**File:** `src/renderer/editors/graph/GraphViewModel.ts` (TooltipInfo interface)

- Add `memberCount?: number` to `TooltipInfo`

### Step 11: Context menu — adjust for group nodes

**File:** `src/renderer/editors/graph/GraphContextMenu.ts`

- When right-clicking a group node:
  - Keep: "Add Child" (adds member to group), "Set as Root", "Collapse", "Delete Node", "Delete Link"
  - No changes needed for US-188 — context menu works the same. More group-specific actions (Ungroup, Edit Title) come in US-190.

### Step 12: Search — include isGroup in searchable properties

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Check how search works. If search checks `getCustomProperties()`, then `isGroup` is already excluded (Step 1 adds it to excluded keys). This is correct — users search by title/id, not by `isGroup` flag.
- No changes needed unless search should match "group" keyword → defer to future enhancement.

### Step 13: Serialization — preserve isGroup

**File:** `src/renderer/editors/graph/GraphDataModel.ts`

- `cleanNode()` strips `_$` prefixed keys and D3 sim keys. `isGroup` has no prefix so it's already preserved in serialization. Verify this is the case.
- `addNode()` creates `{ id }` — group nodes won't be created via addNode in US-188 (that's US-190). But verify no code strips `isGroup` during serialization.

## Concerns / Resolved decisions

### 1. Group shape visual — **double circle** (resolved)

Double circle chosen: two concentric circles — inner filled, outer ring with dark blue default border. Border color switches to orange/green for selected/hovered states.

### 2. Group node radius — **always level-1 (14px)** (resolved)

Static radius, ignoring `level` property. May adjust to 15-16px later if needed for visibility.

### 3. effectiveNodeRadius interaction with root

A node could theoretically be both root AND group (`isGroup: true` + `options.rootNode === id`). Priority:
- Root shape takes precedence (compass shape) — root is always visually distinct
- Group radius still applies (level 1)
- Edge case unlikely in practice

### 4. Group nodes in detail panel — **filtered out** (resolved)

Group nodes are filtered out from `selectedNodes` before passing to the detail panel. Panel never sees group nodes — no group-specific logic needed inside the panel. If only group nodes are selected, panel shows empty state ("select node for edit").

### 5. Membership links visibility (resolved)

In US-188, membership links render as normal links. Pre-processing comes in US-189. Acceptable for manual JSON testing.

### 6. isGroup property editing — **excluded** (resolved)

`isGroup` added to `CUSTOM_PROP_EXCLUDED_KEYS` — not editable in Properties tab. Users edit JSON directly for testing. UI management comes in US-190.

## Acceptance criteria

- [ ] `GraphNode` type includes `isGroup?: boolean`
- [ ] `isGroup` excluded from custom properties enumeration (tooltip, properties grid)
- [ ] Group shape renders as double circle on canvas (inner filled + outer ring)
- [ ] Outer ring uses dark blue default border, orange/green for selected/hovered
- [ ] Group shape icon renders as double circle in SVG (legend)
- [ ] `GraphGroupModel` tracks membership (group→members, member→group)
- [ ] Group model rebuilt on every data change
- [ ] Group nodes use level-1 radius (14px) regardless of `level` property
- [ ] Group node labels always shown (like level 1-2 nodes)
- [ ] Group nodes excluded from level counting in legend
- [ ] Group shape appears in legend Shape tab when present
- [ ] Detail panel: group nodes filtered out — panel sees empty state for group-only selection
- [ ] Detail panel: mixed selection (group + regular) shows only regular nodes
- [ ] Tooltip shows "Group · N members" for group nodes
- [ ] `isGroup` preserved in JSON serialization
- [ ] Membership links still render normally (pre-processing is US-189)
- [ ] No regression in existing node rendering, selection, or editing
