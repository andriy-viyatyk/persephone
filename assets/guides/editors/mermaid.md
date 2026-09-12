---
title: "Mermaid Diagram Viewer"
audience: both
summary: "Mermaid diagram preview with theme toggle, image export, and Excalidraw conversion."
editorId: "mermaid-view"
---

# Mermaid Diagram Viewer

Mermaid Viewer renders diagrams from Mermaid source with zoom, pan, theme selection, image export,
and two different Drawing Editor handoffs.

## How to Open

Open a `.mmd` or `.mermaid` file and choose **Mermaid** in the toolbar. A content page can use
`pages.addEditorPage("mermaid-view", "mermaid", title, content)`. On a new or extensionless page,
choose **Mermaid** from the tab's language menu and then choose **Mermaid** in the toolbar.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Compare] [Theme] [Open] [Convert] [Save] [Copy] [Switch]     |  toolbar: compare at left; Mermaid actions and switch at right
+---------------------------------------------------------------------+
| [Mermaid diagram]                                                   |  rendered Mermaid preview below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Theme → `mermaid-theme`
- Open in Drawing → `mermaid-open-draw`
- Convert to Excalidraw → `mermaid-convert-excalidraw`
- Save → `mermaid-save`
- Copy → `mermaid-copy`
- Page navigation and Editor switch → no entry: shell-owned controls
- Generated Mermaid SVG/image internals → no entry: generated preview content

### When Mermaid rendering is loading or has an error

```
+---------------------------------------------------------------------+
| [Loading or render error]                                           |  rendered Mermaid preview state
+---------------------------------------------------------------------+
```

### When an image action is requested

```
+---------------------------------------------------------------------+
| [Mermaid diagram]                                                   |  generated Mermaid preview content
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Generated Mermaid SVG/image internals — no entry: generated preview content.

## Rendering and export

All Mermaid diagram types render with live, debounced updates. The light/dark diagram theme is
independent of the app theme. **Copy** places the rendered diagram on the clipboard and **Save as
PNG** rasterizes it with Persephone's renderer.

**Convert to Excalidraw** turns flowchart, sequence, and class diagrams into individually editable
shapes. **Open in Drawing Editor** embeds any diagram type as one flat image for annotation; state,
ER, Gantt, pie, and git-graph diagrams use this image route when native conversion is unavailable.

## Agent API

After narrowing `page.editor.id` to `mermaid-view`, the facade exposes rendering and export state.
Verified elements include `text-compare-left`, `mermaid-theme`, `mermaid-open-draw`,
`mermaid-convert-excalidraw`, `mermaid-save`, and `mermaid-copy`. `savePngToFile(filePath)` renders
on demand, including when the page is not the active tab.

## Errors and limits

Invalid Mermaid syntax or a diagram type that cannot be converted natively produces a render or
conversion error; use the flat-image Drawing route for supported rendering without shape conversion.
