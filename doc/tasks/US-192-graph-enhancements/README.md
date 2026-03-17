# US-192: Graph Editor — Ongoing Enhancements

## Goal

Ongoing tracking task for incremental graph editor improvements. Each enhancement is logged below as it's requested, implemented, and completed.

## Status

**In Progress** | Epic: EPIC-006

## Enhancements

| # | Description | Status | Notes |
|---|-------------|--------|-------|
| 1 | Selection highlights full visual path to real neighbors | Done | For grouped nodes: node→group→outside_node path all orange. Uses `getVisualPath()` from `GraphConnectivityModel`. |
| 2 | Links tab hover: fix child neighbor highlighting + green path | Done | Only selected node's children get green borders. Child node gets green fill. Full visual path highlighted green (through group nodes). |
| 3 | Detail panel: don't auto-collapse when clicking a node | Done | Clicking a node keeps detail panel open and updates selection. Clicking empty space or toolbar panel open still collapses. |
| 4 | Legend Selection tab: "Selected with children" option | Done | Highlights selected nodes + union of processed (visual) and real (original) neighbors. |
| 5 | Shift key: "selected with children" quick highlight | Done | Hold Shift to dim non-selected/non-children nodes. Separate `"altKey"` highlight layer. Clears on release or window blur. |

<!--
Add new enhancements as rows to the table above.
Status: Planned / In Progress / Done
-->

## Implementation Notes

Key files for graph editor changes:
- `src/renderer/editors/graph/GraphView.tsx` — Main component (toolbar, tooltip, detail panel)
- `src/renderer/editors/graph/GraphViewModel.ts` — ContentViewModel, orchestration
- `src/renderer/editors/graph/GraphDataModel.ts` — Source data, CRUD, legend
- `src/renderer/editors/graph/GraphSearchModel.ts` — Search logic
- `src/renderer/editors/graph/GraphGroupModel.ts` — Group membership + link preprocessing
- `src/renderer/editors/graph/GraphConnectivityModel.ts` — Query layer (real/processed neighbors, paths)
- `src/renderer/editors/graph/GraphHighlightModel.ts` — Highlight layers, selection, hover, colors
- `src/renderer/editors/graph/GraphVisibilityModel.ts` — BFS visibility filtering
- `src/renderer/editors/graph/ForceGraphRenderer.ts` — D3 force simulation + canvas rendering
- `src/renderer/editors/graph/GraphDetailPanel.tsx` — Detail panel (Info/Links/Properties tabs)
- `src/renderer/editors/graph/GraphLegendPanel.tsx` — Legend panel
- `src/renderer/editors/graph/GraphContextMenu.ts` — Context menu builders
- `src/renderer/editors/graph/GraphTuningSliders.tsx` — Force tuning sliders
- `src/renderer/editors/graph/GraphExpansionSettings.tsx` — Expansion settings
- `src/renderer/editors/graph/types.ts` — Types (GraphNode, GraphLink, etc.)
