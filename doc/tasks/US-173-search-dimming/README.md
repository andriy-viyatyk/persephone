# US-173: Search with node dimming

**Epic:** EPIC-006 (Graph Editor)
**Status:** Done

## Goal

Add a search input to the graph toolbar that filters-as-you-type: matching nodes (by `title` or `id`) stay at full opacity while non-matching nodes and their links are rendered at reduced opacity (dimmed). Clear search restores everything to full opacity. When visibility filtering is active, show count of hidden matches with a clickable link that reveals them along the shortest path to the focus node.

## Background

### Current state

- Graph toolbar is an absolute-positioned `div` at top-left with a "Reset View" button (only shown when visibility filtering is active)
- Toolbar styles: `.graph-toolbar` (flex row, gap 4, z-index 1) and `.graph-toolbar-btn` (themed button)
- All canvas rendering happens in `ForceGraphRenderer.renderData()` — nodes, links, badges, labels drawn in sequence
- Node colors are determined by `nodeColor()`, `nodeBorderColor()`, `linkColor()` helper methods based on active/hovered state
- `nodeLabel()` returns `title || id` — same logic for search matching
- `GraphViewModel` state (`GraphViewState`) currently has: `graphData`, `error`, `loading`
- The renderer has no concept of "dimming" — it's either full opacity or not rendered
- `GraphVisibilityModel` has full graph adjacency (`fullNodes` map with neighbor sets), focus node ID, and visible set

### Pattern to follow

Dimming is purely a **renderer concern** — the search term produces a `Set<string>` of matching node IDs, and the renderer uses canvas `globalAlpha` to dim non-matching elements. No need for a separate model class.

The search input lives in the React component (`GraphView.tsx`) and the matching set is passed to the renderer.

### Similar implementations

- Markdown editor has search in `MarkdownViewModel` state, but that's for text search (different use case)
- The visibility model filters nodes in/out — search dimming is different: all nodes stay visible, just at different opacities

## Implementation plan

### Step 1: Add search state to GraphViewState

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `searchQuery: string` and `searchInfo: { visible: number; hidden: number; total: number } | null` to `defaultGraphViewState`
- Add `setSearchQuery(query: string)` method on `GraphViewModel`
  - Updates `state.searchQuery`
  - Computes matching node IDs: case-insensitive substring match on `nodeLabel(node)` for **visible** nodes (currently rendered)
  - If visibility filtering is active, also counts matches in **hidden** nodes (full graph minus visible set)
  - Updates `state.searchInfo` with `{ visible, hidden, total }` counts
  - Passes the `Set<string>` of matching visible IDs to `renderer.setSearchMatches(matchIds)`
  - Empty query → pass `null` to renderer (no dimming), set `searchInfo = null`

### Step 2: Add dimming support to ForceGraphRenderer

**File:** `src/renderer/editors/graph/ForceGraphRenderer.ts`

- Add private field: `searchMatches: Set<string> | null = null`
- Add public method: `setSearchMatches(matchIds: Set<string> | null): void`
  - Stores the set, calls `renderData()` to re-render
- Modify `renderData()`:
  - If `searchMatches` is not null, use `ctx.globalAlpha` to dim non-matching elements:
    - Before drawing each link: set `globalAlpha = 0.15` if neither source nor target is in `searchMatches`, else `1.0`
    - Before drawing each node: set `globalAlpha = 0.15` if node is not in `searchMatches`, else `1.0`
    - Before drawing each badge: same dimming logic as its parent node
    - Before drawing each label: same dimming logic as its parent node
  - Reset `globalAlpha = 1.0` after each section
- Dimming value: `0.15` (very faint but still visible for context). Not a theme color — it's a fixed opacity multiplier.

### Step 3: Add "reveal hidden matches" to GraphVisibilityModel

**File:** `src/renderer/editors/graph/GraphVisibilityModel.ts`

- Add public method: `revealPaths(targetIds: string[]): boolean`
  - For each target node ID that is hidden (not in `visibleIds`):
    - BFS backwards from target to focus node on the **full graph** adjacency
    - Record the shortest path (sequence of node IDs)
  - Make all nodes along all discovered paths visible (add to `visibleIds`)
  - Return `true` if any new nodes became visible
- Algorithm: standard BFS from focus node, but only record paths to the requested targets. Since we have full adjacency, this is a single BFS pass from focus — stop once all targets are found or queue exhausted.
  - Actually simpler: BFS from focus, build parent map, then for each target trace back parent chain to focus → all nodes in chain become visible.

- Add public method: `getHiddenMatchingIds(query: string): string[]`
  - Iterates `fullNodes`, returns IDs of hidden nodes (not in `visibleIds`) whose `nodeLabel()` matches the query
  - Used by ViewModel to count hidden matches and supply IDs for `revealPaths()`

### Step 4: Add search input to GraphView toolbar

**File:** `src/renderer/editors/graph/GraphView.tsx`

- Restructure toolbar: always visible (not just when `hasVisibilityFilter`)
- Layout: search input + search info on the left, "Reset View" button on the right (when visible)
- Add new CSS classes to `GraphViewRoot`:
  - `.graph-search-input` — styled input with theme colors (`color.graph.labelText`, `color.graph.labelBackground`, border from `color.graph.nodeBorderDefault`)
  - Small, compact: ~160px wide, same height as toolbar button
  - `.graph-search-info` — span showing match info, same font size as toolbar button
  - `.graph-search-reveal` — clickable span/link for "+N hidden" part
- Search info display logic:
  - No search → nothing shown
  - Search active, no visibility filtering → "5 / 42" (visible matches / total visible nodes)
  - Search active, visibility filtering active, hidden matches exist → "5 / 42 (+2 hidden)" where "+2 hidden" is clickable
  - Search active, visibility filtering active, no hidden matches → "5 / 42"
- Wire `onChange` to `vm.setSearchQuery(value)`
- Wire click on "+N hidden" to `vm.revealHiddenMatches()`
- Add `onKeyDown` handler: Escape key clears the input

### Step 5: Add revealHiddenMatches to ViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Add `revealHiddenMatches()` method:
  - Gets hidden matching IDs from `visibilityModel.getHiddenMatchingIds(searchQuery)`
  - Calls `visibilityModel.revealPaths(hiddenIds)`
  - Gets updated visible graph from `visibilityModel.getVisibleGraph()`
  - Passes to `renderer.updateVisibleData(visibleGraph)`
  - Recomputes search matches against new visible set (since revealed nodes are now visible and matching)

### Step 6: Handle data/visibility changes during active search

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

- Extract `recomputeSearch()` helper that runs the search logic (compute matches, update info, pass to renderer)
- Call `recomputeSearch()` from:
  - `setSearchQuery()` — user typed
  - `parseContent()` — data changed (only if query is non-empty)
  - `resetVisibility()` — after resetting visible set
  - `handleBadgeExpand()` — after expanding a node

## Concerns / Open questions

1. **Dimming opacity value (0.15)** — Design choice. Too low makes nodes invisible; too high defeats the purpose. 0.15 seems like a good balance. Will try and adjust if needed.

2. **Keyboard shortcut to focus search?** — Not in scope for this task. Can be added later.

3. **Path-reveal algorithm complexity** — Single BFS from focus node builds parent map for the entire full graph, then trace back from each target. O(V+E) — same as what we already do for initial visibility. For ~1000 node ceiling this is instant.

4. **Revealed nodes become visible permanently** — After clicking "+N hidden", those nodes (and path nodes) join the visible set. The user can "Reset View" to go back. This is consistent with how badge expand works.

## Acceptance criteria

- [ ] Search input visible in graph toolbar area (always, not just during filtering)
- [ ] Filter-as-you-type: case-insensitive substring match on `title` (fallback `id`)
- [ ] Non-matching nodes rendered at reduced opacity (~0.15)
- [ ] Non-matching links rendered at reduced opacity (link dimmed if neither endpoint matches)
- [ ] Links between a matching and non-matching node: full opacity (at least one endpoint matches)
- [ ] Matching nodes keep full opacity with normal selection/hover state
- [ ] Match info shown: "N / total" format
- [ ] When visibility filtering active and hidden matches exist: "+N hidden" shown and clickable
- [ ] Clicking "+N hidden" reveals hidden matching nodes along shortest paths to focus
- [ ] Escape key clears search
- [ ] Clear search restores all nodes to full opacity
- [ ] Dimming works correctly with visibility filtering (expand/collapse)
- [ ] Data changes during search recompute matches
- [ ] Theme colors used for input styling (no hardcoded colors)
