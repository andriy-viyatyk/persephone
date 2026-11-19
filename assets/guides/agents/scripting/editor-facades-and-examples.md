---
title: "Editor Facades and Examples"
audience: "agent"
summary: "How do scripts access editor facades and apply the practical examples?"
---

# Editor Facades and Examples

## Editor Facades

Specialized access to page content through typed editor facades. Read `page.editor` synchronously, inspect its `id`, and use the narrowed facade. Use `page.editorSwitches.switchTo(id)` to change editors; facades are stateless and need no release.

### `page.editor` when `id === "monaco"` — Monaco text editor

```javascript
const text = page.editor;
text.editorMounted          // boolean — true when Monaco is visible
text.getSelectedText()      // Current selection
text.insertText("hello")    // Insert at cursor
text.replaceSelection("x")  // Replace selection
text.revealLine(42)         // Scroll to line
text.setHighlightText("q")  // Highlight occurrences
text.getCursorPosition()    // { lineNumber, column }
text.wordWrap              // boolean — page-local persisted wrapping state
text.toggleWordWrap()      // Toggle wrapping for this Text Editor page
```

### `page.editor` when `id` is `"grid-json"`, `"grid-csv"`, or `"grid-jsonl"` — Grid data editor

```javascript
const grid = page.editor;
grid.rows                            // All row data as objects; ignores search and column filters
grid.rowKeys                         // Row keys in the same order as rows
grid.columns                         // Column definitions [{ key, name }]
grid.rowCount                        // Number of rows
grid.editCell(columnKey, rowKey, value)
grid.addRows(count?, insertIndex?)   // Returns new rows
grid.deleteRows(rowKeys)
grid.addColumns(count?, insertBeforeKey?)
grid.deleteColumns(columnKeys)
grid.setSearch(text)                 // Filter rows
grid.clearSearch()
```

### `page.editor` when `id === "link-view"` — Link collection

```javascript
const le = page.editor;
le.links                             // [{ id, url, title, category, tags, pinned }]
le.addLink(url, title?, category?)
le.deleteLink(id)
le.updateLink(id, { title?, category?, url? })
```

### `page.editor` when `id === "browser-view"` — Browser page

```javascript
const browser = page.editor;
browser.url                          // Current URL (read-only)
browser.title                        // Page title (read-only)
browser.navigate(url)                // Navigate or search
browser.back() / browser.forward() / browser.reload()
```

### Preview facades: `md-view`, `svg-view`, `html-view`, and `mermaid-view`

Preview facades for rendered content. Check `viewMounted` / `loading` before accessing.

The **Mermaid** and **SVG** preview facades (and the **Image viewer** facade `editor`) can save
their rendered image to a file as PNG. This rasterises the diagram exactly as Persephone renders it
(fonts and text included), then writes the PNG. Use it to obtain a viewable image of a diagram:

```
// Render a mermaid page, save the PNG to a temp file, then read it back as an image.
const m = page.editor;
const file = await m.savePngToFile("D:/tmp/diagram.png");   // returns the written path

// Also available on SVG and Image pages:
page.editor.savePngToFile("D:/tmp/image.png");
page.editor.savePngToFile("D:/tmp/photo.png");
```

To simply *look at* an image page through the agent surface, narrow `page.editor.id` to
`"image-view"` and call `read()`. It returns `{ type: "image", data, mimeType: "image/png", width,
height, originalWidth, originalHeight }`; MCP `call` renders that as metadata text plus a native
image block. It works for inactive pages, defaults to a 2048-pixel maximum longer side, and accepts
a positive-integer `maxDimension`. An explicit `maxLength` still applies before image conversion, so
set it to about 1.4 times the PNG byte size plus overhead when needed; an empty or partial result
means it was too low. `read()` does not write a file, while `savePngToFile` remains the way to put
the image on disk.

### `page.editor` when `id === "video-view"` — Video/audio facade

```javascript
const media = page.editor;
media.source                 // Submitted source, or undefined before one is loaded
media.format                 // "mp4", "m3u8", or "audio"
media.playerState            // Loading/playback/error state
media.mediaMounted           // Whether a live media element is attached
media.currentTime            // Live position, or undefined before mount
await media.submitUrl(source)
await media.play()
media.pause()
media.seek(seconds)
media.toggleMute()
await media.openInVlc()
```

Live media getters are undefined before a media element is mounted. Playback, source, and VLC
actions can affect an open page that is not currently visible; use them deliberately.

### `page.editor` when `id === "file-diff"` — File Diff facade

```javascript
const diff = page.editor;
diff.from       // Selected original revision, or undefined while loading
diff.to         // Selected modified revision, or undefined while loading
diff.hasStaged  // Whether staged changes were detected, or undefined while loading
diff.readOnly   // Whether the selected modified revision is not the working tree
```

The revision picker controls are exposed through `diff.elements`; the File History sidebar is
available through `page.panels`, not duplicated in the editor facade.

### Excalidraw board pages

Excalidraw pages now expose the board facade through `page.editor`; the old `draw-view` editor id,
`IDrawEditor`, and `DrawEditorFacade` are gone. To create a **new** drawing page with an image:

```
await app.pages.addDrawPage(dataUrl, "Screenshot.excalidraw");
```


## Practical Examples

### Transform JSON data

```javascript
const data = JSON.parse(page.content);
const filtered = data.filter(item => item.status === "active");
page.grouped.language = "json";
page.grouped.editorSwitches.switchTo("grid-json");
return filtered;
```

### Read and write files

```javascript
const input = await app.fs.read("C:/data/input.csv");
const lines = input.split("\n").filter(l => l.includes("important"));
await app.fs.write("C:/data/filtered.csv", lines.join("\n"));
app.ui.notify(`Kept ${lines.length} lines`, "success");
```

### Create a page with content

```javascript
const page = app.pages.addEditorPage("monaco", "json", "API Response", JSON.stringify({ users: [] }, null, 2));
```

### Interactive script with dialog

```javascript
const name = await app.ui.input("Enter project name:");
if (name) {
    const folder = await app.fs.commonFolder("documents");
    await app.fs.write(`${folder}/${name.value}/README.md`, `# ${name.value}`);
    app.ui.notify(`Created ${name.value}`, "success");
}
```

### Grid manipulation

```javascript
const grid = page.editor;
grid.addColumns(1);  // Add a column
const newCol = grid.columns[grid.columns.length - 1];
grid.rowKeys.forEach(rowKey => {
    grid.editCell(newCol.key, rowKey, "calculated");
});
```

