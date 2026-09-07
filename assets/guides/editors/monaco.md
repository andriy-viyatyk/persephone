---
title: "Text Editor"
audience: both
summary: "Monaco-powered text editing for code, plain text, scripts, and file content."
editorId: "monaco"
---

# Text Editor

Text Editor is the Monaco-powered default and fallback for text and unrecognized file content. It
provides syntax highlighting, IntelliSense, find/replace, multi-cursor editing, folding, minimap,
column selection, and `Ctrl+Y` line deletion. Markdown and HTML text pages also support converted
clipboard paste with `Ctrl+Shift+V`.

## How to Open

Open any text file or choose **Text Editor** from the page toolbar. It is the default for ordinary
text and the fallback when no specialized matcher accepts a file. Agents can create a content page
with `pages.addEditorPage("monaco", language, title, content)`.

## Layout

## Compare Mode

Compare is a grouped-page mode, not a separate registry editor id. Open two files, `Ctrl`-click the
second tab to group them, then choose **Compare**. The Monaco diff view compares the pair side by side.

## Script Panel

The Script Panel runs JavaScript or TypeScript against the page content. Run a selection or the full
script, choose a script, save or open scripts, and direct output to a grouped page. See [Scripting](../scripting/index.md)
for the `page`, `app`, and `io` objects.

## Agent API

After narrowing `page.editor.id` to `monaco`, the Text Editor facade exposes the text-editor state
and script surface. Verified page elements include `text-compare-left`, `text-run-script`,
`text-run-all-script`, `text-show-resources`, `text-toggle-script`, `script-panel-splitter`,
`script-run`, `script-run-all`, `script-select`, `script-save`, `script-open-tab`, and
`script-close`. Use [the page API](../scripting/api/page.md) for the facade members.

## Errors and limits

Binary content is not rendered as useful text; it produces a warning and should use the matching
viewer or a published board. Compare requires two grouped pages. Script errors are reported by the
script panel and do not change the source unless the script writes through the page API.
