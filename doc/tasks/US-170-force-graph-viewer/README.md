# US-170: Force Graph Viewer — Read-Only (Phase 1)

**Epic:** EPIC-006 (Graph Editor)
**Status:** Planned

## Goal

Add a new `graph-view` content-view editor that renders `.fg.json` files as interactive force-directed graphs on an HTML canvas. This is a read-only view (Phase 1) — the user can zoom, pan, drag nodes, click to select, and hover to highlight, but cannot modify the graph data.

## Background

### Source implementation

The `ForceGraph` component from `D:\projects\interactive-script` renders a D3 force simulation on a canvas element. Key features:
- D3 force simulation with center, charge, collide, forceX, forceY, and link forces
- Canvas-based rendering (not SVG) for performance
- Zoom via d3-zoom (scroll wheel, pinch)
- Node drag via d3-drag (left-click on node)
- Click to select a node (highlights its connections)
- Hover to highlight a node and its neighbors
- Labels shown for selected/hovered nodes and their neighbors (when zoom > 0.8)
- Color-coding by active/hovered state

### Editor pattern to follow

Follow the `mermaid-view` editor pattern (closest analogy — renders visual output from text content):
- `ContentViewModel` subclass that parses JSON content and manages graph state
- React component that renders the canvas and toolbar buttons
- Registration in `register-editors.ts` with `acceptFile` matching `.fg.json`
- Content-based detection via `isEditorContent`

### Data format

```json
{
  "type": "force-graph",
  "nodes": [{ "id": "string", "group": number }],
  "links": [{ "source": "nodeId", "target": "nodeId", "value": number }]
}
```

The `"type": "force-graph"` property follows the same convention as notebook (`"type": "note-editor"`), todo (`"type": "todo-editor"`), and link (`"type": "link-editor"`) editors — it enables reliable content-based detection without false positives.

## Implementation Plan

### Step 1: Add d3 dependencies

- [ ] `npm install d3 d3-zoom d3-drag`
- [ ] `npm install -D @types/d3 @types/d3-zoom @types/d3-drag`

### Step 2: Add graph color tokens

- [ ] Add `graph` section to `color.ts` (`/src/renderer/theme/color.ts`):
  ```
  graph: {
      background: "var(--color-graph-bg)",
      nodeDefault: "var(--color-graph-node-default)",
      nodeHighlight: "var(--color-graph-node-highlight)",
      nodeSelected: "var(--color-graph-node-selected)",
      nodeBorderDefault: "var(--color-graph-border-default)",
      nodeBorderHighlight: "var(--color-graph-border-highlight)",
      nodeBorderSelected: "var(--color-graph-border-selected)",
      linkDefault: "var(--color-graph-link-default)",
      linkSelected: "var(--color-graph-link-selected)",
      labelBackground: "var(--color-graph-label-bg)",
      labelText: "var(--color-graph-label-text)",
  }
  ```
- [ ] Add CSS variable values to ALL theme files in `/src/renderer/theme/themes/`:
  - `default-dark.ts`, `abyss.ts`, `monokai.ts`, `red.ts`, `solarized-dark.ts`, `tomorrow-night-blue.ts` (dark themes)
  - `light-modern.ts`, `quiet-light.ts`, `solarized-light.ts` (light themes)
  - Dark defaults: node=deepskyblue, highlight=limegreen, selected=lightpink, link=lightslategray
  - Light defaults: pick appropriately contrasting colors
- [ ] Add `ThemeDefinition` color mapping comments in `default-dark.ts`

### Step 3: Update shared types

- [ ] Add `"graph-view"` to `PageEditor` union in `/src/shared/types.ts`

### Step 4: Add `.fg.json` to specialized JSON patterns

- [ ] Add `/\.fg\.json$/i` to `SPECIALIZED_JSON_PATTERNS` in `/src/renderer/editors/register-editors.ts`
  - This prevents `grid-json` from auto-opening `.fg.json` files

### Step 5: Create graph editor files

Create `/src/renderer/editors/graph/` with:

- [ ] **`types.ts`** — Type definitions:
  ```typescript
  export interface GraphNode extends d3.SimulationNodeDatum {
      id: string;
      group?: number;
  }
  export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
      source: string | GraphNode;
      target: string | GraphNode;
      value?: number;
  }
  export interface GraphData {
      nodes: GraphNode[];
      links: GraphLink[];
  }
  export function linkIds(link: GraphLink): { source: string; target: string };
  ```

- [ ] **`constants.ts`** — Force simulation parameters (copy from source `forceProperties`)

- [ ] **`ForceGraphRenderer.ts`** — Canvas rendering logic (extracted from `ForceGraphModel`):
  - D3 simulation setup, zoom, drag
  - Canvas rendering (links, nodes, labels)
  - Node hit detection (findNode)
  - Active/hovered state management
  - `setCanvasRef`, `handleResize`, `updateData`, `dispose`
  - Uses color tokens from `color.graph.*`

- [ ] **`GraphView.tsx`** — React component:
  - Uses `useContentViewModel<GraphViewModel>(model, "graph-view")`
  - Renders a canvas element
  - Connects canvas ref to `ForceGraphRenderer`
  - Shows node count and link count info (optional, via toolbar portal)
  - Loading state while parsing

- [ ] **`GraphViewModel.ts`** — ContentViewModel subclass:
  - Parses JSON content into `GraphData` on init and content change
  - Creates/manages `ForceGraphRenderer` instance
  - Handles error state for invalid JSON
  - Debounced re-parse on content changes (like MermaidViewModel)

- [ ] **`index.ts`** — Exports `GraphView` and `GraphViewProps`

### Step 6: Register the editor

- [ ] Add `graph-view` registration in `/src/renderer/editors/register-editors.ts`:
  ```typescript
  editorRegistry.register({
      id: "graph-view",
      name: "Graph",
      pageType: "textFile",
      category: "content-view",
      acceptFile: (fileName) => {
          if (matchesPattern(fileName, /\.fg\.json$/i)) return 20;
          return -1;
      },
      validForLanguage: (languageId) => languageId === "json",
      switchOption: (languageId, fileName) => {
          if (languageId !== "json") return -1;
          if (isSpecializedJson(fileName)) return -1;
          return 10;  // available as switch option for any .json
      },
      isEditorContent: (languageId, content) => {
          if (languageId !== "json") return false;
          if (!content.includes('"type"')) return false;
          return /"type"\s*:\s*"force-graph"/.test(content) && content.includes('"nodes"');
      },
      loadModule: async () => {
          const [module, { createGraphViewModel }] = await Promise.all([
              import("./graph/GraphView"),
              import("./graph/GraphViewModel"),
          ]);
          return {
              Editor: module.GraphView,
              createViewModel: createGraphViewModel,
              newPageModel: textEditorModule.newPageModel,
              newEmptyPageModel: textEditorModule.newEmptyPageModel,
              newPageModelFromState: textEditorModule.newPageModelFromState,
          };
      },
  });
  ```

### Step 7: Test

- [ ] Open `miserables.fg.json` — should auto-open in graph-view
- [ ] Verify zoom (scroll wheel), pan (click-drag background), node drag
- [ ] Verify click-to-select highlights node and connected links
- [ ] Verify hover highlights node neighbors with labels
- [ ] Verify switching to Monaco editor and back preserves content
- [ ] Verify theme changes apply correct colors
- [ ] Verify resize handling (window resize, panel resize)
- [ ] Verify session restore (close and reopen the tab)

## Concerns / Open Questions

1. **d3 bundle size** — d3 is large. Editor is lazy-loaded via dynamic import, so d3 only loads when graph editor is opened. No impact on startup.
2. **Node coloring strategy** — Phase 1 reimplements existing coloring (active/hovered/default states only, no group-based colors). Group-based coloring and other highlighting modes (searched node, dirty node, property-based) are deferred to Phase 2+ as part of editing feature design.

## Acceptance Criteria

- [x] `.fg.json` files auto-open in graph-view editor
- [x] Force simulation renders nodes and links on canvas
- [x] Zoom, pan, and node drag work correctly
- [x] Click-to-select and hover-to-highlight work
- [x] Labels appear for selected/hovered nodes at sufficient zoom
- [x] Theme colors applied correctly (dark and light themes)
- [x] Editor switch dropdown shows "Graph" option for JSON files
- [x] `graph-view` listed in `PageEditor` type union
- [x] All graph color tokens defined in all theme files
