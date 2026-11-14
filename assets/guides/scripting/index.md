---
title: "Scripting"
audience: "both"
summary: "How do users run JavaScript or TypeScript scripts and work with their output?"
---

# Scripting

persephone lets you run JavaScript and TypeScript to transform and process content. TypeScript is fully supported â€” type annotations are stripped automatically before execution.

## Quick Start

1. Open a file with JavaScript or TypeScript code (or set the language accordingly)
2. Press `F5` to run
3. Output appears in a new grouped tab

## Running Scripts

### Run File Content
- Set file language to JavaScript or TypeScript
- Press `F5` to run the entire file (works with both `.js` and `.ts` files)
- Or select text and press `F5` to run selection

### Script Panel
- Open Script Panel from toolbar or context menu
- The Script Panel uses TypeScript by default â€” write plain JavaScript or add type annotations as you like
- Press `F5` in Script Panel to run

#### Script Selector & Save

The Script Panel toolbar includes a **script selector dropdown** and a **Save button** for managing reusable scripts:

- **Script selector** â€” lists saved scripts from your Script Library under `script-panel/{language}/` and `script-panel/all/` folders. Scripts from the "all" folder are shown with an "all/" prefix. Select a script to load its content into the editor, or choose "(unsaved script)" for ad-hoc editing.
- **Save button** â€” saves the current script to the library:
  - **Ad-hoc scripts:** Opens a dialog where you enter a filename and choose the target folder (current language folder or "all" for shared scripts)
  - **Library scripts:** Directly overwrites the file when content has been modified
  - Folders are created automatically if they don't exist
  - Overwrite confirmation is shown when saving an ad-hoc script with an existing filename
- **Ctrl+S** shortcut works when the Script Panel editor is focused

## The `page` Object

Scripts have access to [`page`](./api/page.md) representing the current file:

```javascript
// Read content
const text = page.content;

// Write content
page.content = "new content";

// Get/set language
console.log(page.language);  // "javascript"
page.language = "json";

// Get/set editor type
await page.editorSwitches.switchTo("grid-json");  // Switch to grid view

// Inspect or point at this page's tab
console.log(page.tab.title, page.tab.modified);
await page.tab.highlight("page-tab");

// Custom data storage
page.data.myValue = 123;
```

Some editors can show their page before content restoration finishes. If a script needs the
restored content, await `page.ready`; it rejects if that attempt fails or is cancelled:

```javascript
try {
    await page.ready;
    console.log(page.content);
} catch (error) {
    console.log("Page content did not finish loading", error);
}
```

For a page backed by a content pipe, `page.pipe` exposes its primary pipe and live provider and
transformer status. The [Page API](./api/page.md#content-restore-and-pipe-status) documents both.

### Editor Facades

`page.editor` is the current editor facade. It is read-only and exposes `id` and `name`; narrow on
the id before using editor-specific operations. Use `page.editorSwitches.switchTo(id)` to change
editors.

```javascript
const editor = page.editor;
if (editor.id === "grid-json") editor.addRows(5);
await page.editorSwitches.switchTo("monaco");
```

Facades are stateless wrappers â€” nothing needs to be released. Event subscriptions made via `app.events` are still auto-unsubscribed when the script completes. See the [page API reference](api/page-editor-facades.md#editor-facades) for the full list and detailed documentation.

The same `page.editor` surface is available for the Video Player (`video-view`) and File Diff
(`file-diff`) editors. Video scripts can inspect playback state or control playback; File Diff
scripts can inspect the selected revisions and whether the modified side is read-only. Values that
depend on a mounted editor or repository initialization may be `undefined` until that state is
ready. The rendered `html` values on Markdown and HTML previews and the `svg` value on SVG previews
are likewise `undefined` when their backing host is unavailable; their `viewMounted` properties
distinguish that state from genuinely empty content. Mermaid's state-backed `svgUrl` uses `""`
while it is loading or after a render error.

For two grouped, comparable pages, compare mode is available from the pages collection:

```javascript
const pair = app.pages.compare.pairs[0];
if (pair) {
    app.pages.compare.enter(pair.leftPageId);
    // ...inspect or update the compared pages...
    app.pages.compare.exit(pair.rightPageId);
}
```

`app.pages.compare.enter()` and `exit()` accept either page ID in the pair and report an error when
the pair is missing, not comparable, or not currently in compare mode.

## Grouped Pages (Output)

When a script runs, the result is displayed in a grouped (side-by-side) output page:

- **On success:** The return value is written to the output page
- **On error:** The error message and submitted-script stack frames are displayed; renderer-internal frames are filtered
- **No return value:** Shows "undefined"

```javascript
// Return value is written to grouped page
return { result: "data" };
```

You can configure the output page before returning:

```javascript
// Set language and editor type for the output
page.grouped.language = "json";
await page.grouped.editorSwitches.switchTo("grid-json");
return result.recordset;
```

## Output Suppression

Sometimes you want full control over script output â€” for example, when writing to `page.grouped.content` directly or when using dialogs to display results. There are two ways to prevent the default output behavior:

### Writing to `page.grouped.content` directly

When you assign to `page.grouped.content`, the default output is automatically suppressed. The grouped page shows exactly what you wrote:

```javascript
// Default output is suppressed â€” grouped page shows your content
page.grouped.content = "Custom output";
page.grouped.language = "json";
```

### Using `preventOutput()`

Call the global `preventOutput()` function to explicitly suppress default output:

```javascript
// Show results in a dialog instead of the grouped page
const data = JSON.parse(page.content);
await app.ui.textDialog({
    title: "Results",
    text: JSON.stringify(data, null, 2),
    options: { language: "json" },
});
preventOutput();
```

### Error handling with suppressed output

When output is suppressed and a script error occurs, the error is shown in a text dialog instead of the grouped page. This keeps error details visible even when the grouped page is not used for output.
