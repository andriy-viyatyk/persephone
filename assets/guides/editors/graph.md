---
title: "Graph View"
audience: both
summary: "Interactive force-directed graph viewer for graph JSON with search, grouping, editing, and export."
editorId: "graph-view"
---

# Graph View

Graph View displays a force-directed graph from structured JSON. Nodes and edges can be inspected,
grouped, searched, tuned, and exported as an image.

## How to Open

Open a `.fg.json` file, or provide JSON containing `"type": "force-graph"` and `"nodes"`. The
content marker can expose the Graph switch without the special suffix. Agents can create a JSON page
with `pages.addEditorPage("graph-view", "json", title, content)`.

## Layout

```
+---------------------------------------------------------------------+
| [Nav]                                  [Open] [Copy] [Switch]       |  toolbar: graph actions at the right of the page toolbar
+---------------------------------------------------------------------+
| [Force] [Grouping] [Reset] [Expand] [Search] [Clear] [Selection]    |  graph controls across the body toolbar
+---------------------------------------------------------------------+
| [Canvas]                                      [Detail] [Legend]     |  graph canvas with conditional detail and legend panels
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Open in Drawing → `graph-open-in-draw`
- Copy image → `graph-copy-image`
- Force tuning → `graph-settings`
- Grouping → `graph-toggle-grouping`
- Reset view → `graph-reset-view`
- Expand all → `graph-expand-all`
- Search → `graph-search`
- Search clear → `graph-search-clear`
- Selection menu → `graph-selection-menu`
- Physics → `graph-panel-physics`
- Expansion → `graph-panel-expansion`
- Results → `graph-panel-results`
- Charge → `tuning-charge`
- Link distance → `tuning-link-distance`
- Collide → `tuning-collide`
- Reset → `tuning-reset`
- Selected-node detail panel → `graph-detail-panel`
- Collapse → `graph-detail-toggle`
- ID → `graph-detail-id`
- Title → `graph-detail-title`
- Links grid → `graph-links-grid`
- Properties grid → `graph-properties-grid`
- Info → `graph-detail-tab-info`
- Properties → `graph-detail-tab-properties`
- Links → `graph-detail-tab-links`
- Legend panel → `graph-legend-panel`
- Legend toggle → `graph-legend-toggle`
- Selection → `graph-legend-tab-selection`
- Level → `graph-legend-tab-level`
- Shape → `graph-legend-tab-shape`
- Root → `graph-expansion-root`
- Depth → `graph-expansion-depth`
- Maximum visible nodes → `graph-expansion-max`
- Page navigation and Editor switch → no entry: shared shell controls
- Graph nodes, links, canvas gestures, and legend icon content → no entry: graph content or editor-internal interaction

### When the Physics panel is open

```
+---------------------------------------------------------------------+
| [Physics] [Expansion] [Results]                                     |  panel tabs at the top of the Physics state surface
+---------------------------------------------------------------------+
| [Charge]                                                            |  in the Physics panel, first tuning row
| [Link distance]                                                     |  in the Physics panel, second tuning row
| [Collide]                                                           |  in the Physics panel, third tuning row
| [Reset]                                                             |  in the Physics panel, bottom-right
+---------------------------------------------------------------------+
```

### When the Expansion panel is open

```
+---------------------------------------------------------------------+
| [Physics] [Expansion] [Results]                                     |  panel tabs at the top of the Expansion state surface
+---------------------------------------------------------------------+
| [Root]                                                              |  in the Expansion panel, Root field
| [Depth]                                                             |  in the Expansion panel, Depth field
| [Max nodes]                                                         |  in the Expansion panel, maximum-visible-nodes field
+---------------------------------------------------------------------+
```

### When the Results panel is open

```
+---------------------------------------------------------------------+
| [Physics] [Expansion] [Results]                                     |  panel tabs at the top of the Results state surface
+---------------------------------------------------------------------+
| [Search results]                                                    |  graph search results content
+---------------------------------------------------------------------+
```

### When nodes are selected

```
+---------------------------------------------------------------------+
| [Canvas]                                      [Detail]              |  graph canvas with selected-node detail at the right
+---------------------------------------------------------------------+
```

### When the selected-node detail panel is expanded

```
+---------------------------------------------------------------------+
| [Detail]                                             [Collapse]     |  selected-node detail header
+---------------------------------------------------------------------+
| [Info] [Properties] [Links]                                         |  detail panel tabs
+---------------------------------------------------------------------+
| [ID] [Title]                                                        |  expanded graph detail panel, Info tab
| [Links grid]                                                        |  expanded graph detail panel, Links tab
| [Properties grid]                                                   |  expanded graph detail panel, Properties tab
+---------------------------------------------------------------------+
```

### When the graph legend is open

```
+---------------------------------------------------------------------+
| [Canvas] [Legend panel]                                             |  graph canvas with the legend at the left
+---------------------------------------------------------------------+
| [Legend toggle] [Selection] [Level] [Shape]                         |  legend header and state tabs
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shared shell controls are addressed by the common chrome.
- Graph canvas gestures and graph node/link content — no entry: editor-internal or repeated graph content.
- Legend icon content — no entry: editor-internal legend content; the stable legend tabs are listed above.
- Detail-grid Apply/Cancel controls — no entry: add stable names only if live review shows own controls that the schema draws individually.

## Graph interaction

Use search to find nodes, adjust graph settings and force tuning, toggle grouping, reset the view,
expand all nodes, and inspect selected-node details and the legend. The graph can open in Drawing
Editor or copy its image for use elsewhere.

## Agent API

After narrowing `page.editor.id` to `graph-view`, the `GraphEditor` facade exposes graph state,
selection, tuning, and export operations. Its verified elements include `graph-open-in-draw`,
`graph-copy-image`, `graph-settings`, `graph-toggle-grouping`, `graph-reset-view`,
`graph-expand-all`, `graph-search`, and `graph-search-clear`, plus the selection, tuning, detail,
and legend controls declared by the facade. See [Graph format](../formats/graph.md) for the data
shape.

## Errors and limits

Graph content must be valid JSON with the force-graph type marker and `nodes` for content detection.
Malformed data or missing nodes cannot produce a useful graph.
