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
