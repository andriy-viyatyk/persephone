# US-182: Graph Settings Persistence, Expansion Options UI, Root Node

**Epic:** EPIC-006 (Force Graph Editor)
**Status:** Planned

## Goal

Persist physics tuning parameters (charge, distance, collide) to the graph JSON `options` object so they survive file save/reload. Add an "Expansion" tab in the toolbar for editing data-level options (rootNode, expandDepth, maxVisible). Rename `focus` → `rootNode` with backward compatibility. Add "Set as Root" context menu, root node visual distinction (level-1 rendering + 4-pointed compass star shape).

## Background

### Current state

**Physics sliders** (charge, distance, collide) exist in the "Settings" toolbar tab (`GraphTuningSliders.tsx`) but are transient — values are held in `ForceGraphRenderer._forceParams` and reset to defaults on every file open. Users lose their tuning when they close and reopen a graph.

**Data options** (`focus`, `expandDepth`, `maxVisible`) are defined in `GraphOptions` and stored in `data.options` in the JSON file. They're read by `GraphVisibilityModel` on load but have no UI for editing — users must manually edit the JSON.

### Key files involved

| File | What changes |
|------|-------------|
| `types.ts` | Rename `focus` → `rootNode` in `GraphOptions`, add physics fields |
| `GraphViewModel.ts` | Persist physics params, new expansion-options editing, "Set as Root", root node tracking |
| `GraphVisibilityModel.ts` | Accept `rootNode` (+ backward compat for `focus`) |
| `ForceGraphRenderer.ts` | Accept initial force params from options, root node shape/radius override |
| `GraphTuningSliders.tsx` | Report dirty state, possibly minor adjustments |
| `GraphView.tsx` | Add "Expansion" tab to toolbar, tab dirty-state gating |
| `GraphExpansionSettings.tsx` | **New file** — expansion settings panel (rootNode combo, expandDepth, maxVisible inputs) |
| `GraphDetailPanel.tsx` | No changes expected |
| `constants.ts` | No changes expected |

### Existing patterns to reuse

**ComboSelect** (`components/form/ComboSelect.tsx`) — Virtualized dropdown, supports `selectFrom` array, `getLabel`, `onChange`. Used elsewhere for selection from large lists. Will work well for node selection with `nodeLabel()` as label getter.

**Context menu** — `GraphViewModel.handleContextMenu()` (line 339-372) builds `MenuItem[]` and calls `showAppPopupMenu()`. Adding "Set as Root" is a one-line addition.

**Toolbar tabs** — `ToolbarPanel = "closed" | "settings" | "results"` in `GraphView.tsx`. Need to extend with `"expansion"` tab.

**Node rendering** — `ForceGraphRenderer.renderData()` calls `nodeRadius(d)` and `drawShape(ctx, d.shape, ...)` per node. Root node override needs to intercept both radius and shape at render time.

**Shape drawing** — `drawShape()` uses a switch on `NodeShape`. The 5-pointed star already uses the alternating outer/inner radius algorithm. A 4-pointed variant just changes `spikes = 5` → `spikes = 4`.

### Data flow for physics persistence

```
Current:
  File open → defaults (charge=-70, distance=40, collide=0.7) → simulation
  Slider change → immediate simulation update → lost on close

New:
  File open → read options.charge/distance/collide (or defaults) → simulation
  Slider change → immediate simulation update + save to sourceData.options → serialize to JSON
  File reopen → reads saved values from options
```

### Data flow for expansion settings

```
User edits rootNode/expandDepth/maxVisible in "Expansion" tab
  → values saved to sourceData.options immediately
  → serialize to JSON (file marked dirty)
  → NO recalculation of visibility model (deferred to next open)
  → label in tab or status indicates "applies on next open"
```

## Implementation Plan

### Step 1: Extend `GraphOptions` type

In `types.ts`:

```typescript
export interface GraphOptions {
    rootNode?: string;     // renamed from focus
    expandDepth?: number;
    maxVisible?: number;
    // Physics tuning (persisted)
    charge?: number;
    linkDistance?: number;
    collide?: number;
}
```

No backward compatibility needed — just rename everywhere.

### Step 2: Persist physics tuning to options

**In `GraphViewModel`:**

1. On `parseContent()`: after reading `sourceData.options`, pass physics values to renderer:
   ```typescript
   const opts = sourceData.options ?? {};
   const initialParams: Partial<ForceParams> = {};
   if (opts.charge !== undefined) initialParams.charge = opts.charge;
   if (opts.linkDistance !== undefined) initialParams.linkDistance = opts.linkDistance;
   if (opts.collide !== undefined) initialParams.collide = opts.collide;
   // Pass to renderer (new method or constructor param)
   ```

2. On `updateForceParams()`: also save to `sourceData.options`:
   ```typescript
   updateForceParams(params: Partial<ForceParams>): void {
       this.renderer.updateForceParams(params);
       // Persist to data options
       if (!this.sourceData!.options) this.sourceData!.options = {};
       Object.assign(this.sourceData!.options, params);
       this.serializeToHost();
   }
   ```

3. On `resetForceParams()`: clear physics keys from options (so defaults are used on next open):
   ```typescript
   resetForceParams(): void {
       this.renderer.resetForceParams();
       if (this.sourceData?.options) {
           delete this.sourceData.options.charge;
           delete this.sourceData.options.linkDistance;
           delete this.sourceData.options.collide;
       }
       this.serializeToHost();
   }
   ```

**In `ForceGraphRenderer`:**

Add method to set initial params without restarting simulation (called before first render):
```typescript
setInitialForceParams(params: Partial<ForceParams>): void {
    Object.assign(this._forceParams, params);
}
```

### Step 3: Backward-compatible `rootNode` rename in visibility model

**In `GraphVisibilityModel.determineFocusNode()`:**

Already reads `this.options.focus`. Change to read `this.options.rootNode`:
```typescript
if (this.options.rootNode && nodes.some((n) => n.id === this.options.rootNode)) {
    return this.options.rootNode;
}
```

**In `GraphViewModel.renameNode()`:**

Update reference from `options.focus` to `options.rootNode`.

### Step 4: Root node tracking in ViewModel

Add `rootNodeId` to view state (or as a derived getter) so the renderer and UI can identify the root node:

```typescript
// In GraphViewState or as a separate tracked value
get rootNodeId(): string | undefined {
    return this.visibilityModel.focusId || undefined;
}
```

The visibility model already exposes `focusId` after BFS computation. Expose this to the renderer so it can apply visual overrides.

### Step 5: Root node visual distinction in renderer

**In `ForceGraphRenderer.renderData()`** — node drawing section (line 758-767):

```typescript
graphData.nodes.forEach((d) => {
    if (dimming) ctx.globalAlpha = dimSet!.has(d.id) ? 1.0 : 0.15;
    const isRoot = d.id === this.rootNodeId;
    const r = isRoot ? levelRadii[0] : nodeRadius(d);           // level-1 radius
    const shape = isRoot ? "compass" : d.shape;                  // compass star shape
    this.drawShape(ctx, shape, d.x || 0, d.y || 0, r);
    // ... fill, stroke same as before
});
```

Also apply to label visibility — root node should always show label (like level 1-2 nodes):
```typescript
const isImportant = isRoot || (typeof d.level === "number" && d.level >= 1 && d.level <= 2);
```

And to badge position and collision radius — use the overridden `r`.

**Add "compass" shape to `drawShape()`:**

```typescript
case "compass": {
    const spikes = 4;
    const outerR = r * 1.2;
    const innerR = r * 0.4;
    for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;  // start from top
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = x + rad * Math.cos(angle);
        const py = y + rad * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    break;
}
```

This renders a 4-pointed star with spikes at N, E, S, W (compass rose pattern).

**Note:** `"compass"` is NOT added to `NodeShape` type — it's an internal rendering shape used only for root node visual override. The node's actual `shape` property remains unchanged.

**Root node ID propagation:** Add `rootNodeId: string` property to `ForceGraphRenderer`, set by ViewModel after BFS computation:
```typescript
set rootNodeId(id: string) { this._rootNodeId = id; this.scheduleRender(); }
```

### Step 6: "Set as Root" context menu

In `GraphViewModel.handleContextMenu()`, add to node context menu:

```typescript
const isRoot = nodeId === this.rootNodeId;
const items: MenuItem[] = [
    { label: "Add Child", onClick: () => this.addChild(nodeId) },
    { label: "Set as Root", onClick: () => this.setRootNode(nodeId), disabled: isRoot },
    { label: "Delete Node", onClick: () => this.deleteNode(nodeId) },
    // ... existing "Delete Link" submenu
];
```

Implement `setRootNode()`:
```typescript
setRootNode(nodeId: string): void {
    if (!this.sourceData) return;
    if (!this.sourceData.options) this.sourceData.options = {};
    this.sourceData.options.rootNode = nodeId;
    // Update renderer visual
    this.renderer.rootNodeId = nodeId;
    // Serialize (file becomes dirty)
    this.serializeToHost();
    // Do NOT rebuild visibility — applies on next open
}
```

**Key decision:** Setting root does NOT re-expand the graph. It just saves the option and updates the visual indicator. The actual BFS recomputation happens when the file is reopened.

### Step 7: Extend toolbar with "Expansion" tab

Update `ToolbarPanel` type in `GraphView.tsx`:

```typescript
type ToolbarPanel = "closed" | "settings" | "results" | "expansion";
```

Add third tab in the tab bar (between "Settings" and "Results"):

```
┌─[Physics]──[Expansion]──[Results (N)]──────┐
```

**Tab naming rationale:** "Physics" for charge/distance/collide (simulation forces), "Expansion" for rootNode/expandDepth/maxVisible (BFS expansion parameters).

Rename the existing "Settings" tab to "Physics" to clarify its purpose. The gear icon in the toolbar row continues to toggle "Physics" tab (same behavior as before, just renamed).

**Tab switching:**
- Gear icon → toggles "Physics" tab (renamed from "Settings")
- Search focus with results → "Results" tab (existing behavior)
- New icon or gear long-press or dropdown? → For simplicity, clicking the gear icon cycles through "Physics" and "Expansion", or we add a second small icon. **Proposed:** Keep the gear icon for Physics. Add a small tree/expand icon (or reuse the existing `↺` button area) for Expansion tab. Alternatively: just show the tab bar whenever toolbar is expanded, and user clicks the tab they want.

**Simpler approach:** When toolbar is expanded (any tab), all tab labels are visible and clickable. The gear icon opens "Physics" (current behavior). No new icon needed — user discovers "Expansion" tab when they open the toolbar.

### Step 8: Build `GraphExpansionSettings` component

Create new file `src/renderer/editors/graph/GraphExpansionSettings.tsx`:

```typescript
interface GraphExpansionSettingsProps {
    vm: GraphViewModel;
}
```

**Layout:**
```
┌─────────────────────────────────────────────┐
│ Root Node   [ComboSelect: node title ▼]     │
│ Expand Depth [number input, placeholder=∞]  │
│ Max Visible  [number input, default=500]    │
│                                             │
│ ℹ Changes apply when file is reopened       │
└─────────────────────────────────────────────┘
```

**Root Node ComboSelect:**
- `selectFrom`: all node IDs from `sourceData.nodes`
- `getLabel`: `nodeLabel(node)` — shows title with fallback to ID
- `value`: current `sourceData.options?.rootNode`
- `onChange`: calls `vm.setRootNode(nodeId)` — this one applies immediately (visual indicator changes)
- Include an empty/clear option: "(auto — lowest level)" to unset rootNode

**Expand Depth input:**
- Number input, min=1, no max
- Empty = unlimited (undefined)
- On change: save to `sourceData.options.expandDepth`, serialize, do NOT rebuild

**Max Visible input:**
- Number input, min=10, default placeholder "500"
- On change: save to `sourceData.options.maxVisible`, serialize, do NOT rebuild

**"Changes apply when file is reopened" note:**
- Small info text at bottom of the panel
- Applies to expandDepth and maxVisible (rootNode visual applies immediately, but BFS recomputation is deferred)

### Step 9: ViewModel methods for expansion options

Add to `GraphViewModel`:

```typescript
updateExpansionOptions(patch: Partial<Pick<GraphOptions, "expandDepth" | "maxVisible">>): void {
    if (!this.sourceData) return;
    if (!this.sourceData.options) this.sourceData.options = {};
    Object.assign(this.sourceData.options, patch);
    // Clean up undefined values
    if (patch.expandDepth === undefined) delete this.sourceData.options.expandDepth;
    if (patch.maxVisible === undefined) delete this.sourceData.options.maxVisible;
    this.serializeToHost();
}
```

### Step 10: Expose expansion options state to UI

The `GraphExpansionSettings` component needs to read current options. Options are available via `vm.sourceData.options` but that's not reactive. Two approaches:

**Approach A:** Add `expansionOptions` to `GraphViewState` and update it when options change:
```typescript
expansionOptions: { rootNode?: string; expandDepth?: number; maxVisible?: number } | null;
```

**Approach B:** Read directly from ViewModel (simpler, since expansion settings component mounts only when tab is open):
```typescript
const opts = vm.getExpansionOptions();
// Returns { rootNode, expandDepth, maxVisible } from sourceData.options
```

**Recommended:** Approach B — since the component is only shown when the tab is open, and changes go through the ViewModel, direct reading is simpler. Use local state in the component initialized from ViewModel on mount.

### Step 11: Node list for ComboSelect

The ComboSelect needs the full node list (not just visible nodes). Add to ViewModel:

```typescript
getAllNodes(): GraphNode[] {
    return this.sourceData?.nodes ?? [];
}
```

Sort alphabetically by `nodeLabel()` for the dropdown.

### Step 12: Styling

Add to `GraphViewRoot` styled component in `GraphView.tsx`:

```css
/* Expansion settings */
.expansion-settings { padding: 8px; font-size: 11px; }
.expansion-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.expansion-label { width: 80px; flex-shrink: 0; opacity: 0.8; }
.expansion-input { flex: 1; }
.expansion-note { font-size: 10px; opacity: 0.5; font-style: italic; padding-top: 4px; }
```

ComboSelect and number inputs should use the app's existing form styling (from `components/form/`).

## Resolved Decisions

1. **Tab naming** — Rename "Settings" → "Physics", new tab = "Expansion". Both are concise and descriptive.
2. **Root node on small graphs** — Works regardless of visibility model state. Track `rootNodeId` independently in ViewModel. When root is cleared (set to undefined), fall back to existing auto-selection logic (lowest level number, then first node) for BFS but do NOT highlight that auto-selected node as root visually.
3. **Backward compatibility** — No backward compat needed. Rename `focus` → `rootNode` everywhere. Update the one test file (`D:\js-notepad-notes\temp\miserables.fg.json`) to use `rootNode`.
4. **Collision radius** — Override collision radius too, so the root node gets proper spacing. Pass `rootNodeId` to the collision radius callback.
5. **Compass shape** — Render-only, internal to `ForceGraphRenderer`. Not added to `NodeShape` type, no SVG icon needed.
6. **"Set as Root" on current root** — Disabled (grayed out) in context menu.
7. **Input validation** — Validate on blur or Enter. Allow free typing.

## Acceptance Criteria

- [ ] Physics tuning (charge, distance, collide) persisted to `options` in JSON
- [ ] Opening a file with saved physics values restores them in sliders and simulation
- [ ] Reset button clears physics from options (next open uses defaults)
- [ ] `focus` field renamed to `rootNode` in code, types, and JSON output
- [ ] Test file `miserables.fg.json` updated to use `rootNode`
- [ ] "Expansion" tab added to toolbar (alongside Physics/Results)
- [ ] Expansion tab shows: Root Node (ComboSelect), Expand Depth, Max Visible
- [ ] Root Node combo lists all nodes with title (fallback to ID), sorted alphabetically
- [ ] Changing expansion settings saves to JSON but does NOT recalculate graph
- [ ] Info text "applies on next open" shown in expansion tab
- [ ] "Set as Root" context menu item on node right-click
- [ ] Setting root updates visual immediately (compass shape + level-1 size)
- [ ] Root node rendered with 4-pointed compass star shape (N/S/E/W spikes)
- [ ] Root node rendered with level-1 radius regardless of actual level
- [ ] Root node label always visible (like level 1-2 nodes)
- [ ] Root node visual works for both small graphs (no visibility filtering) and large graphs
- [ ] Compass shape is internal renderer concept — not added to user-selectable `NodeShape`
- [ ] Collision radius overridden for root node (level-1 size for proper spacing)
- [ ] Clearing root node removes visual highlight (auto-selected BFS root not highlighted)
- [ ] "Set as Root" disabled when right-clicking the current root node
- [ ] "Settings" tab renamed to "Physics"
- [ ] Expansion settings validated on blur/Enter
- [ ] EPIC-006 data format docs updated to reflect `rootNode` and physics options
