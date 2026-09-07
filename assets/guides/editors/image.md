---
title: "Image Viewer"
audience: both
summary: "Image viewer with zoom, pan, clipboard paste, format-preserving save, and Drawing Editor handoff."
editorId: "image-view"
---

# Image Viewer

Image Viewer opens raster images with zoom, pan, fit-to-window, clipboard copy, and save choices.

## How to Open

Open `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, or `.ico`. A script can use
`app.pages.openFile(path)` to open an image; Image Viewer is a specialized route rather than a
general `pages.addEditorPage` target.

## Layout

```
+---------------------------------------------------------------------+
| [Save] [Open] [Copy]                                                |  image actions grouped on the right side of the toolbar
+---------------------------------------------------------------------+
| [Image viewport]                                                    |  rendered image below the toolbar
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Save → `image-save`
- Open in Drawing → `image-open-draw`
- Copy → `image-copy`
- Image viewport and native image controls → no entry: rendered content and OS-owned surfaces

### When the image save popup is open

```
+---------------------------------------------------------------------+
| [Save as PNG] [Save original]                                       |  image save popup beside the toolbar
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Image save destination controls — no entry: native save dialog controls.
- Image viewport — no entry: rendered content rather than a facade control.

## Viewing and transfer

Zoom with the mouse wheel or zoom actions, pan while zoomed, and reset to fit-to-window. Copy uses
PNG data. **Save as .png** re-encodes; **Save original** preserves source bytes. **Open in Drawing
Editor** sends the image to Excalidraw for annotation.

`Ctrl+V` can open a bitmap clipboard image in a new Image Viewer tab, unless a focused text field or
grid owns the paste. HTML-only clipboard content can open in HTML Preview; plain text is not
intercepted.

## Agent API

After narrowing `page.editor.id` to `image-view`, the Image facade exposes image state and save
operations. Verified elements are `image-save`, `image-open-draw`, and `image-copy`; the save API can
write PNG data to a file.

## Errors and limits

Unsupported or corrupt image data cannot be rendered. Saving as PNG changes the encoding; use Save
original when byte-for-byte preservation matters.
