# US-181: Graph Search Enhancement — Multi-word, Custom Properties, Results Panel

**Epic:** EPIC-006 (Force Graph Editor)
**Status:** Done

## Goal

Enhance the graph search to support multi-word queries matching across title and custom properties, and add an expandable search results panel with highlighted matches, visibility indicators, and keyboard navigation.

## Background

### Current search behavior (US-173)

The search currently:
- Matches only `title` (fallback to `id`) — `nodeLabel(node)` via `GraphViewModel.recomputeSearch()` (line 161-187)
- Uses single substring match: `nodeLabel(node).toLowerCase().includes(query)`
- Shows match count in toolbar: `"visible / total (+N hidden)"`
- Dims non-matching nodes on canvas to `alpha = 0.15`
- "(+N hidden)" clickable link reveals hidden matches via BFS paths

### Key files involved

| File | What changes |
|------|-------------|
| `GraphViewModel.ts` | Search matching logic, search state, new search results data |
| `GraphView.tsx` | Toolbar restructure, new search results panel, toolbar tabs |
| `GraphTuningSliders.tsx` | No changes (moves into a tab) |
| `ForceGraphRenderer.ts` | Minor: `selectNode()` already exists, may need `getNodes()` |
| `GraphVisibilityModel.ts` | `getHiddenMatchingIds()` updated for multi-word + properties |
| `types.ts` | `nodeLabel()` unchanged, add shared `getCustomProperties()` here |
| `useHighlightedText.tsx` | Reuse `highlightText()` for result highlighting, `searchMatch()` pattern for AND matching |

### Existing patterns to reuse

**Custom property extraction** — Used in `GraphTooltip.tsx:61-69`:
```typescript
const EXCLUDED_KEYS = new Set([
    "id", "title", "level", "shape",
    "x", "y", "vx", "vy", "fx", "fy", "index",
]);
function getCustomProperties(node: GraphNode): Array<[string, string]> {
    for (const [key, value] of Object.entries(node)) {
        if (EXCLUDED_KEYS.has(key) || key.startsWith(SYS_PREFIX)) continue;
        // ...
    }
}
```
Also in `GraphDetailPanel.tsx:785-800` (`PROPERTY_EXCLUDED_KEYS`, `extractCustomProperties`).

**Node selection** — `renderer.selectNode(nodeId)` (ForceGraphRenderer line 239) → `setActiveId()` → triggers `onSelectionChanged` callback → ViewModel `handleSelectionChanged` updates `selectedNode` + `linkedNodes` state.

**Toolbar expand/collapse** — Currently `tuningOpen` state + `.expanded` CSS class. Canvas click sets `setTuningOpen(false)`. Toolbar has `opacity: 0.5` when idle, `1` on hover/expanded/focus-within.

**Visibility model** — `visibilityModel.active` is true when graph uses BFS filtering (large graphs with `maxVisible`). Hidden nodes are those in `fullNodes` but not in `visibleIds`.

**`useHighlightedText.tsx`** (`components/basic/useHighlightedText.tsx`) — Existing utility with two key functions:
- `highlightText(substring, text, className?)` — Splits `substring` by spaces into words, recursively highlights each word in `text`, wraps matches in `<span className="highlighted-text">`. Global CSS applies `color.misc.blue`.
- `searchMatch(obj, substringsLower, getProps)` — Multi-word AND matching: returns true if ALL substrings appear across ANY of the property getter functions. Used by link editor, notebook, file list, etc.

### Data flow for new search

```
searchQuery (from input)
    ↓ split into words (space-separated, trimmed, lowercased)
    ↓ for each node (visible + hidden):
    │   ↓ build searchable text: title/id + custom property names + values
    │   ↓ check ALL words match (AND logic) against any of these texts
    │   ↓ record which fields matched which words (for highlighting)
    ↓ produce SearchResult[] with match details
    ↓ update renderer highlight set (same as before — matchIds)
    ↓ update state.searchResults for UI
    ↓ UI renders scrollable result list in toolbar panel
```

## Implementation Plan

### Step 1: Define search result types

Add to `GraphViewModel.ts` (near existing `SearchInfo` interface):

```typescript
/** A matched custom property in a search result. */
interface SearchPropertyMatch {
    key: string;
    value: string;
}

/** A node that matched the search query. */
interface SearchResult {
    nodeId: string;
    label: string;          // nodeLabel(node) — always shown
    visible: boolean;       // whether node is currently visible on canvas
    matchedProps: SearchPropertyMatch[];  // custom properties that matched (empty if only title matched)
}
```

Update `GraphViewState`:
```typescript
searchResults: SearchResult[] | null;  // null = no active search
```

### Step 2: Implement multi-word + property search in `recomputeSearch()`

**Existing utility to reuse:** `searchMatch()` from `useHighlightedText.tsx` already implements multi-word AND matching:
```typescript
searchMatch(obj, substringsLower, getProps)
// Returns true if ALL substrings match across ANY of the property getters
```

Replace the current single-match logic:

1. **Split query into words:** `query.split(/\s+/).filter(Boolean)` — each word lowercased
2. **For each node** (both visible and all nodes if visibility active):
   a. Get `label = nodeLabel(node)`
   b. Get custom properties via shared `getCustomProperties(node)`
   c. Build text fields array: `[label, ...propKeys, ...propValues]`
   d. Use `searchMatch` or equivalent AND logic: every word must appear in at least one text field
   e. If matched, determine which custom properties contributed to the match (any word appears in key or value) → build `matchedProps[]`
3. **Collect match IDs** for renderer dimming (same as before)
4. **Build `searchResults[]`** sorted: visible matches first, then hidden, alphabetical within each group
5. **Update `searchInfo`** counts as before

**Note:** `searchMatch` from `useHighlightedText.tsx` takes getter functions, which works well. However, we also need to know *which* properties matched for the result display, so we'll implement a custom matching function that returns both the match boolean and the matched property details.

### Step 3: Update `GraphVisibilityModel.getHiddenMatchingIds()`

Change from single substring match to multi-word + property match (same logic as Step 2). Extract the node-matching function into a shared helper (e.g., in `types.ts` alongside `getCustomProperties`) used by both ViewModel and VisibilityModel.

### Step 4: Restructure toolbar with internal tabs

**Current toolbar structure:**
```
┌─────────────────────────────────────────┐
│ [⚙] [↺] [Search input...    ×] N/total │  ← toolbar-row
│ ┌─────────────────────────────────────┐ │
│ │ Tuning sliders (when expanded)      │ │  ← GraphTuningSliders
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**New toolbar structure:**
```
┌─────────────────────────────────────────┐
│ [⚙] [↺] [Search input...    ×] N/total │  ← toolbar-row (unchanged)
│ ┌─[Settings]──[Results (N)]───────────┐ │  ← tab bar (only when expanded)
│ │                                     │ │
│ │ Settings: tuning sliders            │ │  ← tab content
│ │   — or —                            │ │
│ │ Results: scrollable search results  │ │
│ │                                     │ │
│ ├─────────────────────────────────────┤ │
│ │ M/N nodes  (+K hidden)              │ │  ← status bar (results tab only)
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

The status bar at the bottom of the results tab shows `"M/N nodes"` with `"(+K hidden)"` as a clickable link for bulk reveal. This replaces the inline `searchInfo` display in the toolbar row when the results panel is open (the toolbar row still shows the count when panel is closed).

**State changes in `GraphView.tsx`:**
- Replace `tuningOpen: boolean` with `toolbarPanel: "closed" | "settings" | "results"`
- Gear icon toggles "settings" panel
- When search has results, auto-switch to "results" tab
- When input gains focus and results exist, expand to "results"
- Canvas click → collapse panel (`toolbarPanel = "closed"`)
- Toolbar gets `.expanded` class when `toolbarPanel !== "closed"`

**Tab bar component** (inline in GraphView):
- Two small tabs: "Settings" and "Results (N)" where N = match count
- Active tab highlighted with `color.graph.nodeHighlight` bottom border
- Tabs only visible when panel is expanded

### Step 5: Build search results list component

Create `GraphSearchResults` component (in `GraphView.tsx` or new file `GraphSearchResults.tsx`).

**Props:**
```typescript
interface GraphSearchResultsProps {
    results: SearchResult[];
    selectedIndex: number;
    onSelect: (nodeId: string) => void;
    onHoverChange: (nodeId: string) => void;
}
```

**Rendering each result row:**
```
┌───────────────────────────────────┐
│ Node Title (highlighted matches)  │  ← always shown, bold
│ propKey: propValue                │  ← only if property matched
│ anotherKey: anotherValue          │  ← only if property matched
└───────────────────────────────────┘
```

- Title line always shown; highlight matching substrings with `color.graph.nodeHighlight` background
- Property lines only shown when that property matched; property key in lighter color/opacity, value in normal color; highlight matching substrings in either
- Hidden nodes: entire row at `opacity: 0.5`
- Selected row (keyboard navigation): background highlight
- Hover: light background highlight

**Highlight rendering:** Use existing `highlightText(query, text)` from `useHighlightedText.tsx`. It already splits query by spaces, highlights each word recursively, and wraps matches in `<span className="highlighted-text">`. Global CSS in `GlobalStyles.tsx` colors these `color.misc.blue`. No custom highlight logic needed.

**Status bar** at bottom of results panel: `"M/N nodes (+K hidden)"` — the `(+K hidden)` part is clickable to bulk-reveal all hidden matches.

**Max height:** Results panel should have `max-height` (e.g., 300px) with `overflow-y: auto`.

### Step 6: Keyboard navigation for search results

In the search input's `onKeyDown` handler:

- **ArrowDown**: Move `selectedIndex` down (wrap or clamp)
- **ArrowUp**: Move `selectedIndex` up (wrap or clamp)
- **Enter**: Select the currently highlighted result → call `onSelectResult(nodeId)`
- **Escape**: If panel open → close panel; if already closed → clear search

**`onSelectResult(nodeId)` flow:**
1. If node is hidden → call `revealSingleNode(nodeId)` to reveal via BFS path
2. Call `renderer.selectNode(nodeId)` → triggers selection, updates detail panel
3. No camera panning — user drags/zooms manually if needed

### Step 7: Focus/blur behavior

- **Input focus** (click into search): If there are search results, expand toolbar to "results" tab
- **Input blur** (click on canvas): Collapse toolbar panel. But keep search query active (nodes still dimmed)
- **Gear icon click**: Toggle "settings" tab (independent of search state)
- Canvas click handler already calls `setTuningOpen(false)` → change to `setToolbarPanel("closed")`

### Step 8: Reveal single hidden node

Currently `revealHiddenMatches()` reveals ALL hidden matches. For clicking a single search result, we need a way to reveal just one node.

Add to `GraphViewModel`:
```typescript
revealSingleNode(nodeId: string): void {
    if (!this.visibilityModel.active) return;
    if (this.visibilityModel.isVisible(nodeId)) return;
    const changed = this.visibilityModel.revealPaths([nodeId]);
    if (!changed) return;
    const visibleGraph = this.visibilityModel.getVisibleGraph();
    this.renderer.updateVisibleData(visibleGraph);
    this.recomputeSearch();
}
```

### Step 9: Styling

Add to `GraphViewRoot` styled component:

```css
/* Tab bar */
.toolbar-tabs { display: flex; border-bottom: 1px solid border; }
.toolbar-tab { padding: 2px 8px; font-size: 11px; cursor: pointer; border-bottom: 2px solid transparent; }
.toolbar-tab.active { border-bottom-color: nodeHighlight; }

/* Search results */
.search-results { max-height: 300px; overflow-y: auto; }
.search-result-row { padding: 4px 8px; cursor: pointer; font-size: 11px; line-height: 1.4; }
.search-result-row:hover, .search-result-row.keyboard-selected { background: rgba(...); }
.search-result-row.hidden-node { opacity: 0.5; }
.search-result-title { font-weight: 600; }
.search-result-prop { opacity: 0.8; }
.search-result-prop-key { opacity: 0.7; }  /* lighter property key */
.search-status-bar { padding: 4px 8px; font-size: 11px; border-top: 1px solid border; }
/* .highlighted-text class already defined globally in GlobalStyles.tsx (color.misc.blue) */
.search-no-results { padding: 8px; font-size: 11px; opacity: 0.5; text-align: center; }
```

### Step 10: Performance considerations

- **Debounce search?** Current search runs synchronously on every keystroke. With property search, the iteration is heavier. For graphs with hundreds of nodes, this should still be fast (<5ms). No debounce needed unless profiling shows issues.
- **Result limit:** Cap displayed results at ~100 rows. Show "and N more..." label if truncated.
- **Shared helper:** Extract the custom-property-extraction and matching logic into a shared function (used by tooltip, detail panel, and search). Consider putting it in `types.ts` or a new `graph-utils.ts`.

## Resolved Decisions

1. **Auto-switch to Results tab** — Yes. When search query is non-empty and results exist, auto-switch from Settings to Results. User can still click Settings tab manually.
2. **Show only matching nodes** — Yes. Results panel shows only nodes that match the query.
3. **AND logic** — All words must match (AND). Each word can match in a different field (e.g., "my" in title, "note" in a property value).
4. **No camera panning** — Clicking a result just selects the node (and reveals if hidden). No auto-pan/zoom. User can drag/zoom manually.
5. **Property display format** — Always show `key: value` for property matches. Property key shown with lighter color/opacity. Highlight the matching part (whether in key or value or both).
6. **Shared helper** — Extract `getCustomProperties()` to a shared location (e.g., `types.ts`). Tooltip, detail panel, and search all use it.
7. **Bulk reveal link** — Keep "(+N hidden)" clickable link. Move it to the bottom of the results panel (below the result list), as a summary/status bar: `"M/N nodes (+K hidden)"` with (+K hidden) clickable. Results appear right under the input for immediate access.

## Acceptance Criteria

- [ ] Search matches against title (fallback to id) AND custom property names AND values
- [ ] Multi-word search: all words must match (AND logic), each word can match in different fields
- [ ] Toolbar expands to show search results panel when search is active
- [ ] Results panel shows: title (always) + matched property lines (key: value)
- [ ] Matched substrings are highlighted in results
- [ ] Visible nodes show at full opacity in results; hidden nodes at reduced opacity
- [ ] Clicking a result selects the node (reveals if hidden)
- [ ] Keyboard navigation: ArrowUp/Down to navigate results, Enter to select
- [ ] Toolbar has two internal tabs: "Settings" (tuning sliders) and "Results (N)"
- [ ] Input focus with existing results → expand panel to results tab
- [ ] Canvas click → collapse toolbar panel (search query preserved, dimming stays)
- [ ] Gear icon → toggle settings tab
- [ ] Escape in search input → close panel (or clear search if panel already closed)
- [ ] Results capped at ~100 with "and N more..." if truncated
- [ ] Status bar at bottom of results: "M/N nodes (+K hidden)" with clickable bulk reveal
- [ ] Property keys displayed in lighter color/opacity in result rows
- [ ] Shared `getCustomProperties()` helper extracted and used by tooltip, detail panel, and search
- [ ] Search dimming on canvas still works as before
