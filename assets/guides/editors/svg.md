---
title: "SVG Preview"
audience: both
summary: "Live SVG preview with zoom, raster export, clipboard copy, and Drawing Editor handoff."
editorId: "svg-view"
---

# SVG Preview

SVG Preview renders an SVG while keeping the source available in Text Editor. It supports live
updates, zoom and pan, PNG export, clipboard copy, and annotation handoff.

## How to Open

Open an `.svg` file and choose **Preview** in the page toolbar. The file opens in Text Editor first
so source edits can be made before switching to the preview. A script-created page can use
`pages.addEditorPage("svg-view", "xml", title, content)`.

## Layout

```
+---------------------------------------------------------------------+
| [Nav] [Compare]                 [Open] [Save] [Copy] [Switch]       |  toolbar: compare at left; SVG actions and switch at right
+---------------------------------------------------------------------+
| [SVG preview]                                                       |  rendered SVG preview below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Compare → `text-compare-left`
- Open in Drawing → `svg-open-draw`
- Save → `svg-save`
- Copy → `svg-copy`
- Page navigation and Editor switch → no entry: shell-owned controls
- Rendered SVG internals → no entry: generated preview content

### When the rendered SVG preview is visible

```
+---------------------------------------------------------------------+
| [SVG preview]                                                       |  rendered SVG preview below the toolbar
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shell-owned controls are addressed by the shared chrome.
- Rendered SVG internals — no entry: generated preview content.

## Preview actions

The preview reflects unsaved SVG edits. Use zoom and pan, **Save as PNG**, **Copy**, or **Open in
Drawing Editor** to place the rendered SVG in an Excalidraw canvas.

## Agent API

After narrowing `page.editor.id` to `svg-view`, the SVG facade exposes preview/export state and the
verified elements `text-compare-left`, `svg-open-draw`, `svg-save`, and `svg-copy`.

## Errors and limits

Malformed SVG may fail to render while the source remains available in Text Editor. PNG export is a
rasterization of the current rendered SVG; editing the source does not directly edit the exported PNG.
