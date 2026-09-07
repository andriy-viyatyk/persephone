---
title: "Drawing Editor"
audience: both
summary: "Excalidraw drawing canvas for editable shapes, annotation, screen snips, and export."
editorId: "draw-view"
---

# Drawing Editor

Drawing Editor hosts an Excalidraw canvas for shapes, arrows, freehand marks, text, self-hosted fonts,
and annotations. Its canvas theme is independent of the app theme.

## How to Open

Open a `.excalidraw` file or send an image, SVG, Mermaid diagram, HTML capture, or screen snip to the
Drawing Editor. Agents can create a drawing content page with
`pages.addEditorPage("draw-view", "json", title, content)`.

## Layout

```
+---------------------------------------------------------------------+
| [Nav]                  [Theme] [Copy] [Save] [Open] [Snip] [Switch] |  shared toolbar: page navigation left, Draw actions and switch right
+---------------------------------------------------------------------+
| [Excalidraw canvas]                                                 |  Excalidraw canvas below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Theme, Copy image, Save, Open in new tab, and Screen Snip → no entry: Draw has no static `elements` list by design
- Page navigation and Editor switch → no entry: shell-owned controls
- Excalidraw tools and canvas → no entry: editor-internal/third-party content

### When the Excalidraw canvas and toolbar are mounted

```
+---------------------------------------------------------------------+
| [Theme] [Copy] [Save] [Open] [Snip]                                 |  visible Draw toolbar content, not addressable facade controls
+---------------------------------------------------------------------+
| [Excalidraw canvas]                                                 |  Excalidraw canvas below the toolbar
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Draw toolbar controls — no entry: `DrawEditorFacade` publishes no static elements inventory.
- Excalidraw tools and canvas — no entry: editor-internal/third-party content.

## Drawing and export

The canvas supports the normal Excalidraw drawing workflow, custom shape libraries, and a Screen Snip
action that inserts a captured region directly into the drawing. Export drawings as 2x PNG or SVG to
the clipboard, a file, or a new tab. Other viewers use this editor for annotation: an SVG, Mermaid
diagram, image, or rendered HTML capture can arrive as drawing content.

## Agent API

After narrowing `page.editor.id` to `draw-view`, the `DrawEditor` facade exposes canvas count, mount
state, image insertion, and export operations. It has no static UI elements inventory, so this guide
describes user actions and facade methods without assigning names to canvas controls.

## Errors and limits

Drawing content is an Excalidraw document, not arbitrary image or SVG source. Use the viewer that
produced an image for source editing, then send its rendered result to Drawing Editor for annotation.
