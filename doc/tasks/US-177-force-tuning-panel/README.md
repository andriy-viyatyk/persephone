# US-177: Force Tuning Panel

**Epic:** EPIC-006 (Graph Editor)
**Status:** Planned

## Goal

Redesign the graph editor toolbar into a unified top-left panel with a gear icon, reset view icon, and search input in a single row. Clicking the gear icon expands a collapsible panel below with force simulation sliders (charge, link distance, collide) for real-time tuning.

## Background

### Current toolbar layout

The toolbar is `position: absolute; top: 8; left: 8` with `display: flex; gap: 4`. Current elements left-to-right:

1. **Search wrap** (`.graph-search-wrap`) — 160px input with clear button overlay
2. **Search info** (`.graph-search-info`) — "N / total" text, conditional on `searchQuery`
3. **Reset View** (`.graph-toolbar-btn`) — button, conditional on `vm.hasVisibilityFilter`

All styled with `color.graph.labelBackground` background, `color.graph.labelText` text, `color.border.default` borders.

### Proposed new layout

```
┌─────────────────────────────────────────────┐
│ [⚙]  [↺]  [Search nodes...___________]     │  ← always-visible row
└─────────────────────────────────────────────┘
  │
  ▼ (expanded when gear clicked)
┌─────────────────────────────────────────────┐
│ Charge    ──────●────── -70                 │
│ Distance  ────●──────── 40                  │
│ Collide   ──────●────── 0.7                 │
│                                   [Reset]   │
└─────────────────────────────────────────────┘
```

**Row elements** (left to right):
1. **Gear icon button** — toggles the expandable panel below
2. **Reset View icon button** — same function as current "Reset View" text button, but always visible as an icon (disabled/dimmed when `!hasVisibilityFilter`)
3. **Search input** — same search functionality as current, with clear button and search info

**Expandable panel** (below the row):
- Opens/closes with gear icon click
- Contains 3 range sliders for force parameters
- "Reset" button to restore defaults
- State is transient — not saved to JSON or page state

### Force simulation parameters

Current defaults in `constants.ts`:

```typescript
charge.strength: -70     // Repulsion force between nodes (negative = repel)
link.distance: 40        // Preferred distance between linked nodes
collide.strength: 0.7    // How strongly nodes avoid overlap
```

These are the three most user-visible parameters. Other parameters (`center`, `forceX`, `forceY`, `distanceMin/Max`, `iterations`) are less useful for manual tuning and should stay at defaults.

### How forces are applied

`ForceGraphRenderer` has:
- `applyPositionForces(width, height)` — sets charge, collide, center, forceX/Y forces on simulation
- `initializeForces(links)` — calls `applyPositionForces` + sets link force + restarts simulation
- `updatePositionForces()` — calls `applyPositionForces` + restarts simulation (safe for resize)

All force values are read from the `forceProperties` constant object at call time. Currently there's no way to change these at runtime.

### Available icons

- `SettingsIcon` — gear icon, 24px, exists in `icons.tsx`
- `RefreshIcon` — circular arrow icon, 24px, exists in `icons.tsx`

## Implementation plan

### Step 1: Add force parameter update method to ForceGraphRenderer

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add a new public method `updateForceParams(params)` that:
  - Accepts partial force overrides: `{ charge?: number; linkDistance?: number; collide?: number }`
  - Updates the corresponding values in a local `_forceParams` instance field (not the global `forceProperties` constant)
  - Calls existing `updatePositionForces()` pattern — recreate forces with new values and `simulation.alpha(1).restart()`
  - For link distance: need to update the existing link force's `.distance()` setter (don't recreate link force)
- Add `_forceParams` field initialized from `forceProperties` defaults on construction
- Modify `applyPositionForces` and `initializeForces` to read from `_forceParams` instead of the global constant
- Add a `resetForceParams()` method that resets `_forceParams` to defaults and restarts

**Important:** The collide force uses `nodeRadius(d) + 1` as base radius, then `strength` controls how rigidly nodes separate. The slider should control the `strength` multiplier (0.0 to 1.0), not the radius.

### Step 2: Add force tuning methods to GraphViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `updateForceParams(params)` — delegates to `this.renderer.updateForceParams(params)`
- Add `resetForceParams()` — delegates to `this.renderer.resetForceParams()`
- No state changes needed — force params are transient, not in `GraphViewState`

### Step 3: Redesign toolbar into unified panel

**File:** `src/renderer/editors/graph/GraphView.tsx`

Restructure the toolbar JSX. The current `.graph-toolbar` div becomes the unified panel container.

**New structure:**
```tsx
<div className="graph-toolbar">
    {/* Always-visible row */}
    <div className="graph-toolbar-row">
        <button className="graph-icon-btn" onClick={toggleTuning} title="Force tuning">
            <SettingsIcon width={14} height={14} />
        </button>
        <button
            className={`graph-icon-btn ${!vm.hasVisibilityFilter ? "disabled" : ""}`}
            onClick={() => vm.resetVisibility()}
            title="Reset view"
            disabled={!vm.hasVisibilityFilter}
        >
            <RefreshIcon width={14} height={14} />
        </button>
        <div className="graph-search-wrap">
            {/* ... existing search input, clear button ... */}
        </div>
        {searchInfo && (
            <span className="graph-search-info">{/* ... existing ... */}</span>
        )}
    </div>

    {/* Expandable tuning panel */}
    {tuningOpen && (
        <div className="graph-tuning-panel">
            <GraphTuningSliders vm={vm} />
        </div>
    )}
</div>
```

**Styling changes:**
- `.graph-toolbar` — change from horizontal flex to vertical flex (`flexDirection: "column"`)
- `.graph-toolbar-row` — new class, horizontal flex row (what `.graph-toolbar` currently is)
- `.graph-icon-btn` — new class for icon-only toolbar buttons (square, same height as search input)
- `.graph-icon-btn.disabled` — dimmed opacity, no pointer events
- Remove the old `.graph-toolbar-btn` text button style (replaced by icon button)
- `.graph-tuning-panel` — expandable area below the row

**State:** `tuningOpen` is a local `useState(false)` in GraphView — transient, not persisted.

### Step 4: Create GraphTuningSliders component

**File:** `src/renderer/editors/graph/GraphTuningSliders.tsx` (new)

A simple component with three range sliders and a reset button.

**Props:**
```typescript
interface GraphTuningSlidersProps {
    vm: GraphViewModel;
}
```

**Sliders:**

| Label | Parameter | Range | Default | Step |
|-------|-----------|-------|---------|------|
| Charge | `charge` (strength) | -200 to 0 | -70 | 1 |
| Distance | `linkDistance` | 10 to 200 | 40 | 1 |
| Collide | `collide` (strength) | 0 to 1 | 0.7 | 0.05 |

Each slider shows: label, range input, current value text.

**Behavior:**
- `onChange` on range inputs calls `vm.updateForceParams({ charge: value })` etc.
- Changes apply immediately — simulation restarts with new parameters in real-time
- "Reset" button calls `vm.resetForceParams()` and resets local slider state

**Local state:** The component tracks current values in local `useState` (initialized from defaults). On reset, both the local state and renderer params are restored.

**Styling:**
- Single `GraphTuningSlidersRoot` styled component with nested classes
- Background matches toolbar: `color.graph.labelBackground`
- Range inputs styled with accent color `color.graph.nodeHighlight`
- Compact layout: label and value on same line, slider below
- "Reset" button matches `.graph-icon-btn` style, aligned right
- Chromium-only range input styling via `::-webkit-slider-runnable-track` and `::-webkit-slider-thumb`

### Step 5: Update GraphViewRoot styles

**File:** `src/renderer/editors/graph/GraphView.tsx`

Update the `GraphViewRoot` styled component:
- `.graph-toolbar` — becomes column container with fixed width, background, border, border-radius, shadow
- `.graph-toolbar-row` — flex row with `alignItems: "center"`, gap 4
- `.graph-search-input` — change from `width: 160` to `flex: 1` (fill available space)
- `.graph-icon-btn` — 24x24 square button, flex center, transparent background, icon color `color.graph.labelText`, hover: `color.graph.nodeHighlight` border
- `.graph-icon-btn.disabled` — `opacity: 0.3`, `pointer-events: none`
- `.graph-tuning-panel` — padding, border-top separator
- Keep search clear/info/reveal styles as-is

### Step 6: Wire everything in GraphView

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Add `const [tuningOpen, setTuningOpen] = useState(false)`
- Add `toggleTuning` callback
- Import `SettingsIcon`, `RefreshIcon` from icons
- Import `GraphTuningSliders` (static import, it's inside the same editor)
- Replace current toolbar JSX with new structure

## Resolved concerns

1. **Slider responsiveness** — Try without debounce first. If per-pixel `onChange` causes performance issues, add a single shared debounce for all slider changes.

2. **Toolbar visual change** — Keep semi-transparent feel using `color.graph.labelBackground`.

3. **Reset View icon visibility** — Always visible, disabled/dimmed when not applicable.

4. **Tuning panel width** — Define a fixed width for the toolbar panel. Search input fills available space after icon buttons (use `flex: 1` instead of fixed `width: 160`). Sliders fit within the same fixed width.

5. **Range input styling** — Chromium-only (Electron). Use `::-webkit-slider-*` pseudo-elements for full control over track/thumb appearance. No need for cross-browser fallbacks.

## Acceptance criteria

- [ ] Toolbar redesigned: gear icon → reset view icon → search input in a single row
- [ ] Gear icon toggles expandable tuning panel below
- [ ] Reset View is an icon button (always visible, disabled when no visibility filter)
- [ ] Tuning panel has 3 sliders: Charge (-200 to 0), Distance (10 to 200), Collide (0 to 1)
- [ ] Moving a slider immediately updates the force simulation in real-time
- [ ] "Reset" button in tuning panel restores all sliders to defaults
- [ ] Force parameters are transient — not saved to JSON or page state
- [ ] Existing search functionality unchanged (input, clear, info, reveal hidden)
- [ ] Existing graph features work: selection, tooltip, context menu, drag, zoom, detail panel
- [ ] Toolbar styling consistent with existing graph theme colors
- [ ] `ForceGraphRenderer` reads force params from instance field, not global constant
