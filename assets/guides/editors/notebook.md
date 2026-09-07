---
title: "Notebook Editor"
audience: both
summary: "Structured notes in `.note.json` files with code, categories, tags, and full-text search."
editorId: "notebook-view"
---

# Notebook Editor

Notebook stores notes in a structured JSON document. Each note has its own editor, while categories,
tags, comments, and full-text search organize the collection.

## Getting Started

1. Create or save a file with the `.note.json` suffix; Notebook opens automatically.
2. A JSON page with `"type": "note-editor"` and `"notes"` can also expose the Notebook switch.
3. Choose **Add Note** to create a note in the current category or tag context.

## Layout

## Notes

Each note has a title, content editor, language, category, tags, and optional comment. JSON and CSV
notes can use Monaco or Grid; Markdown and SVG notes can use their preview; JavaScript and TypeScript
notes have script run actions. Search covers title, category, tags, comments, and note content.

Click the expand action to edit a note at full size; **Escape** or the collapse action returns to the
list without losing its editor state. Delete asks for confirmation. Drag a note to a category, drag
categories to change their hierarchy, and drag a file or link onto a category to create a note.

## Categories, tags, and navigation

Categories use `/` paths and appear in the **Categories** sidebar with counts. Tags are flat or
`prefix:value` labels such as `env:dev` and appear in the **Tags** sidebar. The toolbar breadcrumb
shows the active category or tag; click a segment to move upward or the root to clear the filter.
Autocomplete assists category and tag editing, and the search filter combines with category/tag
filters.

## Agent API

Use `pages.addEditorPage("notebook-view", "json", title, content)` for a notebook page. After
narrowing `page.editor.id`, the `NotebookEditor` facade exposes note snapshots and note operations.
Verified page elements include `notebook-breadcrumb`, `notebook-search`, `notebook-search-clear`,
`notebook-add-note`, `notebook-expanded-collapse`, `note-delete`, `note-expand`, `note-language`,
`note-editor-switch`, `note-run-script`, and `note-run-all-script`. The detailed format is in
[Notebook format](../formats/notebook.md).

## Errors and limits

Notebook expects valid JSON with a `notes` collection and note content in the documented shape. A
`.note.json` suffix alone selects the editor by filename; content detection additionally requires
both the `note-editor` type marker and `notes` property. Invalid JSON or an incompatible note shape
can leave the page in an error state.
