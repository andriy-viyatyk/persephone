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

```
+---------------------------------------------------------------------+
| [Page nav] [Breadcrumb]                [Search] [Add Note] [Switch] |  Notebook toolbar: breadcrumb at left, actions and switch at right
+---------------------------------------------------------------------+
| [Categories]  | [Note card: title  tags…       [Expand] [Delete]]   |  sidebar panels on the left; note cards fill the body to their
| [Tags]        | [Note card: title  tags…       [Expand] [Delete]]   |  right, each card's tag area on its title row after the title
+---------------------------------------------------------------------+
```

A note's **tags** are the chips on its own title row, between the title and the Expand and Delete
buttons at the card's right edge; click there to add or edit one. The **Tags** panel in the left
sidebar *filters* the collection by tag — it does not assign tags to a note.

### User-facing label → `elements` name

- Breadcrumb → `notebook-breadcrumb`
- Search → `notebook-search`
- Clear search → `notebook-search-clear`
- Add Note → `notebook-add-note`
- Expanded note collapse → `notebook-expanded-collapse`
- Delete → `note-delete`
- Expand → `note-expand`
- Tag area → `note-tags`
- Language → `note-language`
- Note editor switch → `note-editor-switch`
- Run script → `note-run-script`
- Run all → `note-run-all-script`
- Page navigation and Editor switch → no entry: shared shell controls
- Note text and embedded editor internals → no entry: repeated editor content

### When search is active

```
+---------------------------------------------------------------------+
| [Search]                                             [Clear]        |  active Notebook search row with clear at the right edge
+---------------------------------------------------------------------+
```

### When a note is expanded

```
+---------------------------------------------------------------------+
| [Note editor]                                     [Collapse]        |  expanded note overlay with collapse at top-right
| [Language] [Note editor switch] [script actions]                    |  embedded note editor controls at top-left
+---------------------------------------------------------------------+
```

### When a note card is mounted

```
+---------------------------------------------------------------------+
| [Note card]                                    [Delete] [Expand]    |  note-card actions grouped at the top-right
| [Language] [Note editor switch]                                     |  note-editor controls at the top-left
+---------------------------------------------------------------------+
```

### When a script note has a selection

```
+---------------------------------------------------------------------+
| [Language] [Note editor switch] [Run script] [Run all]              |  script note editor actions grouped at the top-left
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: shared shell controls are owned by the common chrome.
- Note text and embedded editor internals → no entry: repeated editor content
- Categories/Tags sidebar panel nodes → no entry: panel-owned content

## Notes

Each note has a title, content editor, language, category, tags, and optional comment. JSON and CSV
notes can use Monaco or Grid; Markdown and SVG notes can use their preview; JavaScript and TypeScript
notes have script run actions. Search covers title, category, tags, comments, and note content.

Click the expand action to edit a note at full size; **Escape** or the collapse action returns to the
list without losing its editor state. Delete asks for confirmation. Drag a note to a category, drag
categories to change their hierarchy, and drag a file or link onto a category to create a note.

## Categories, tags, and navigation

Categories use `/` paths and appear in the **Categories** sidebar with counts. Tags are flat or
`prefix:value` labels such as `env:dev`.

**To tag a note, click the tag area on that note's title row** — the chips sit after the title and
before the Expand and Delete buttons at the card's right edge — and type the tag; autocomplete
offers existing ones. The **Tags** sidebar panel lists every tag in the collection and filters by
it; it is not where a tag is assigned. The toolbar breadcrumb
shows the active category or tag; click a segment to move upward or the root to clear the filter.
Autocomplete assists category and tag editing, and the search filter combines with category/tag
filters.

## Agent API

Use `pages.addEditorPage("notebook-view", "json", title, content)` for a notebook page. After
narrowing `page.editor.id`, the `NotebookEditor` facade exposes note snapshots and note operations.
Verified page elements include `notebook-breadcrumb`, `notebook-search`, `notebook-search-clear`,
`notebook-add-note`, `notebook-expanded-collapse`, `note-delete`, `note-expand`, `note-language`,
`note-tags`, `note-editor-switch`, `note-run-script`, and `note-run-all-script`. The repeated
`note-tags` target is the stable tag area; individual chips are not addressed. The detailed format
is in [Notebook format](../formats/notebook.md).

## Errors and limits

Notebook expects valid JSON with a `notes` collection and note content in the documented shape. A
`.note.json` suffix alone selects the editor by filename; content detection additionally requires
both the `note-editor` type marker and `notes` property. Invalid JSON or an incompatible note shape
can leave the page in an error state.
