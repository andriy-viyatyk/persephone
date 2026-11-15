---
title: "Mermaid Diagram Viewer"
audience: both
summary: "Mermaid diagram preview with theme toggle, image export, and Excalidraw conversion."
editorId: "mermaid-view"
---

# Mermaid Diagram Viewer

Mermaid Viewer renders diagrams from Mermaid source with zoom, pan, theme, look, and layout choices,
image export, and two different Excalidraw handoffs.

## How to Open

Open a `.mmd` or `.mermaid` file and choose **Mermaid** in the toolbar. A content page can use
`pages.addEditorPage("mermaid-view", "mermaid", title, content)`. On a new or extensionless page,
choose **Mermaid** from the tab's language menu and then choose **Mermaid** in the toolbar.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Back][Forward] [Theme] [Look] [Layout] [Open] [Convert] [Save] [Copy] [Switch] | toolbar: navigation left; Mermaid actions and editor switch right
+---------------------------------------------------------------------+
| [Mermaid diagram]                                                   |  rendered Mermaid preview below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Theme → `mermaid-theme`
- Look → `mermaid-look`; menu choices: Classic (`mermaid-look-classic`), Neo (`mermaid-look-neo`), Hand-drawn (`mermaid-look-handDrawn`)
- Layout → `mermaid-layout`; menu choices: Dagre (`mermaid-layout-dagre`), ELK (`mermaid-layout-elk`)
- Open in Drawing → `mermaid-open-draw`
- Convert to Excalidraw → `mermaid-convert-excalidraw`
- Save → `mermaid-save`
- Copy → `mermaid-copy`
- Page navigation and Editor switch → no entry: shell-owned controls
- Generated Mermaid SVG/image internals → no entry: generated preview content

### When a comparable page is grouped on the left

```
+---------------------------------------------------------------------+
| [Compare with left page]                                           | available when a comparable page is grouped on the left
+---------------------------------------------------------------------+
```

Compare maps to `text-compare-left`. The menu choices show a check on the current Look or Layout.

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

All Mermaid diagram types render with live, debounced updates. Use **Theme** to switch the diagram's
light or dark theme independently of the app theme. **Look** selects Classic, Neo, or Hand-drawn;
**Layout** selects Dagre or ELK. Each page saves its own Look and Layout choices and rerenders as soon
as you change one. New pages start with Classic and Dagre. These choices apply only to Mermaid
Viewer pages; Mermaid diagrams in Markdown Preview and Log View keep the Classic look and Dagre
layout. **Copy** places the rendered diagram on the clipboard and **Save as PNG** rasterizes it with
Persephone's renderer.

**Convert to Excalidraw** turns flowchart, sequence, and class diagrams into individually editable
shapes. **Open in Drawing** embeds any diagram type as one flat image for annotation; state,
ER, Gantt, pie, and git-graph diagrams use this image route when native conversion is unavailable.
When no board provides the requested capability, Persephone shows **No image editor is registered**
for the flat-image route or **No diagram editor is registered** for native conversion, with a
suggestion to enable Excalidraw or install a replacement.

## Agent API

After narrowing `page.editor.id` to `mermaid-view`, the facade exposes rendering and export state.
Verified elements include `text-compare-left`, `mermaid-theme`, `mermaid-open-draw`,
`mermaid-convert-excalidraw`, `mermaid-save`, and `mermaid-copy`. `savePngToFile(filePath)` renders
on demand, including when the page is not the active tab.

## Errors and limits

Invalid Mermaid syntax or a diagram type that cannot be converted natively produces a render or
conversion error; use the flat-image Drawing route for supported rendering without shape conversion.
