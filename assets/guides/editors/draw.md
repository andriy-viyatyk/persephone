---
title: "Excalidraw Board"
audience: both
summary: "The bundled Excalidraw board for drawing, annotation, screen snips, and image export."
---

# Excalidraw Board

The bundled Excalidraw board provides an editable canvas for shapes, arrows, freehand marks, text,
images, and annotations. It is a board rather than a built-in editor, so it can be enabled,
disabled, or replaced independently of Persephone.

## How to Open

Open a `.excalidraw` file, choose **Excalidraw** from **Tools & Editors → Built-in**, or use an
image, SVG, Mermaid, or HTML preview's **Edit Image**, **Open in Drawing**, or **Convert to
Excalidraw** action. The board is bundled with Persephone and does not require a trust prompt.

If Excalidraw is disabled, right-click it in **Tools & Editors → Built-in** and choose **Enable**.
If no replacement handles the requested image or diagram action, Persephone shows **No image editor
is registered** or **No diagram editor is registered** and tells you how to restore the capability.

## Layout

The Persephone toolbar above the board contains these board controls:

- **Theme** — switch the Excalidraw canvas between light and dark themes.
- **Copy Image** — copy the current drawing to the clipboard as an image.
- **Save as file** — save the drawing as SVG or PNG.
- **Open in new tab** — open an SVG or image export in another Persephone tab.
- **Screen Snip** — capture a screen region and insert it into the drawing.

The Excalidraw canvas below the toolbar contains the normal Excalidraw drawing tools, selection,
zoom, libraries, and canvas controls.

## Libraries

Use Excalidraw's **Library** controls to browse for a `.excalidrawlib` library. When you return to
Persephone, confirm before adding it; accepted items are merged with your existing library.
Configure the location at **Settings → Editors → Excalidraw → Library folder**.

## Scripting

`app.pages.addDrawPage(dataUrl, title?)` is still the supported way to create a new Excalidraw
page with an image. A page opened in Excalidraw now exposes the board facade through
`pages[i].editor`; the old `IDrawEditor`, `DrawEditorFacade`, and `draw-view` editor id no longer
exist. Board-specific methods are available from the board's own facade/model as described in the
[Board guide](./board.md) and [scripting API](../scripting/api/page.md#editor-facades).

To route an image data URL through the general link API, request the capability rather than the
removed editor id:

```javascript
await app.openRawLink(imageDataUrl, { editor: "image.edit" });
```

This is equivalent to `app.pages.addDrawPage(imageDataUrl)`. A normal image file or an
`.excalidraw` file continues to use its ordinary content route.

## Errors and limits

Excalidraw documents are drawing scenes, not arbitrary image or SVG source. Edit the source in its
viewer, then send the rendered result to this board for annotation.
