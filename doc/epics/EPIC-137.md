# EPIC-137: Notebook moves to a published board

## Status

**Status:** Active
**Created:** 2026-11-05

## Overview

The built-in Notebook editor (`src/renderer/editors/notebook/`, ~4,100 lines, plus a scripting
facade, two core secondary views and a translated catalog) is a standalone tool for one narrow
purpose. Rebuild it as a **published content-host board** in `persephone-boards`, then delete the
built-in editor from the core. The board keeps the parts that are actually used and drops the rest.
This follows the same route as the Todo board (EPIC-044), the PDF viewer (EPIC-047) and the REST
client (EPIC-121).

## Goals

- `.note.json` files open in a **Notebook board** that reads and writes the **existing file
  format** unchanged, so every current notebook opens without conversion.
- Keep: notes with title, category, tags and comment; full-text search; category and tag
  navigation; code/text editing with syntax highlighting; Markdown preview; a grid view for JSON
  array notes.
- Drop (user-accepted): Monaco, script execution, HTML preview, Mermaid, SVG preview, and the
  `INotebookEditor` scripting facade.
- **No virtualization.** Render notes in pages and load more on scroll. Never write UI state into
  the file just because the user is viewing or scrolling.
- Remove the built-in editor and everything in the core that exists only to serve it.

## Design

### Board shape (template: the Todo board)

| Aspect | Decision |
|---|---|
| Location | `persephone-boards/boards/notebook/`, published through the catalog (not bundled) |
| Kind | `editorKind: "content-host"`; Persephone owns the file and the board uses `persephone.host.*`; Ctrl+S works through the shim |
| Association | `fileMasks: ["*.note.json"]`, `editorPriority: 200`, `editorName: "Notebook"` |
| Sidebar | One secondary view, `{ id: "nav", title: "Categories & Tags" }`, like Todo's "Lists & Tags". Selection syncs through `persephone.state.*` |
| Libraries | **CodeMirror 6** (the REST client board's esbuild-bundle pattern, which already themes against `--p-*`); catalog **markdown** (marked + highlight.js + `markdown.css` skin) for preview; catalog **av-grid** for the grid (JSON arrays only) |
| Agents | `persephone.aiVision.expose` model at `pages[i].editor.app`, replacing the old facade (EPIC-098 / EPIC-121 pattern) |
| i18n | Board `lang/` folder; seed the English source from `src/shared/i18n/en/notebook.ts` and reuse existing translations where the keys carry over |

### Main view

- **Toolbar:** category/tag breadcrumb, search box (matches title, category, tags, comment and
  content), **Add Note**.
- **Note card:**
  - title;
  - tag chips with autocomplete;
  - category field with autocomplete; this replaces dragging a note onto a category;
  - language picker;
  - view toggle;
  - expand and delete;
  - optional comment;
  - content area.
- **Content by view:**
  - **Code** (default for every language): a CodeMirror editor with auto height up to a maximum
    card height. Highlighting for JS/TS, JSON, Markdown, HTML, CSS, XML, YAML and SQL. Any other
    `language` value is shown as plain text and kept unchanged in the file.
  - **Preview** (Markdown notes): marked output. Click or toggle to edit.
  - **Grid** (JSON array-of-objects notes only): av-grid with in-cell editing that writes back to
    the note content as 4-space JSON. Column types (string, number, boolean) come from the values,
    and edits keep each value's type. CSV notes have no grid; they stay in Code view. Content that
    isn't an array of objects falls back to Code with a notice.
- **Expanded note:** one note fills the body. Escape or collapse returns to the list at the same
  scroll position.

### Paged list instead of virtualization

- Render the first **30** notes of the filtered, sorted list. A sentinel at the end
  (IntersectionObserver) appends the next 30 as it comes into view. A "Load more (N left)" button
  is the fallback, and agents can drive it.
- Changing the search, category or tag resets the list to the first page.
- Only rendered cards own a CodeMirror instance. Rendered cards are never unmounted while scrolling,
  so heights don't jump and editor state isn't lost.
- **Card heights, scroll position and other view state are never written to the file.** The built-in
  editor stores `contentHeight` in `data.state[noteId]`, which is a likely cause of the file turning
  "modified" during scroll. Per-page view state, if any is needed, goes to
  `persephone.state` (restorable keys) or `persephone.pageState`.
- Watch item: 30 CodeMirror instances on first paint. If that measures slow, render cards
  read-only (highlighted static HTML) and mount the editor on focus. Measure first; don't build it
  up front.

### File-format compatibility

- Read `{ type: "note-editor", notes: [...], state: {...} }` exactly as today. Every write
  **preserves fields the board does not understand**, on the root and on each note.
- `content.editor` mapping:

  | Old value | Board view |
  |---|---|
  | `grid-json` | Grid |
  | `grid-csv` | Code (no CSV grid) |
  | `md-view` | Preview |
  | `monaco`, `html-view`, `mermaid-view`, `svg-view`, unknown | Code |

  The original value is kept until the user switches the view.
- The board reads `data.state` but writes nothing new into it except per-note grid column
  settings. That is a deliberate user action, so it is fine for it to mark the file modified.

### Accepted losses

These go into the What's New breaking note:

- Script execution, HTML/Mermaid/SVG preview, and Monaco features (IntelliSense, Monaco commands).
- Dragging a file or link onto a category to create a note; dragging a note onto a category in the
  sidebar. The card's category field replaces the latter.
- The Notebook switch on JSON pages detected only by content (`"type": "note-editor"` without the
  `.note.json` suffix). Boards associate by file mask only.
- `INotebookEditor` and `pages.addEditorPage("notebook-view", …)`. Scripts move to
  `page.editor.app`.
- A restored `notebook-view` tab and an old pinned new-page entry get no migration (EPIC-047/121
  precedent). Opening the file again goes to the board, or to the `+` install entry when the board
  isn't installed.

### Core removal (last phase)

Done only after the board is published. Remove:

- `editors/notebook/`;
- the `notebook-view` matcher and module entry;
- the `notebook-categories` and `notebook-tags` secondary views;
- `NotebookEditorFacade.ts`, its `PageWrapper` branch, and `api/types/notebook-editor.d.ts` plus its
  references;
- the MCP manifest entry, the tools-editors registry entry, and the ai-vision page-panels and root
  references;
- the language-icon and language-map hooks that exist only for notebook;
- the `notebook` i18n catalog and its keys in all 17 packs;
- `assets/guides/editors/notebook.md` and `formats/notebook.md`. Their content moves to the board's
  `guides/`.

Leave alone the shared mechanisms Notebook happened to use (`IContentHost.getEditorState`, which
EnvVars also uses). Fix only comments that name Notebook. The task doc lists every reference from
a fresh grep.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| BT-078 | Notebook board: scaffold, format-preserving model, paged card list, CodeMirror bundle, search, add/delete/expand | Implemented — awaiting user test |
| BT-079 | Notebook board: Categories & Tags secondary view, breadcrumb, card category/tag autocomplete | Implemented — awaiting user test |
| BT-080 | Notebook board: Markdown preview and av-grid view for JSON array notes | Implemented — awaiting user test |
| BT-081 | Notebook board: aiVision model, guides, language packs, screenshot; publish v1.0.0 | Implemented — awaiting user test |
| [US-1771](../tasks/US-1771-board-toolbar-breadcrumb/README.md) | Board toolbar breadcrumb control | Planned |
| US-1769 | Remove the built-in Notebook editor from the core (after BT-081 is published) | Planned |
| US-1770 | Research: simplify editor architecture that existed only to host editors inside Notebook | Planned |

BT tasks live in `persephone-boards/doc/`. While the board is built it runs **A/B next to the
built-in editor**: the board outranks the built-in Notebook (200 vs 20), and the switch widget can
still reach the old one. Removal waits until the user has used the board on real notebooks.

If a task finds a bridge gap that needs a core change, it becomes its own US task with a
`BOARD_BRIDGE_VERSION` bump and a matching board `minBridgeVersion`.

## Notes

### 2026-11-05

- User intent: Notebook is used for short snippets (JS), API response samples (JSON), plain notes,
  Markdown notes, and per-environment config tables (grid). Losing script execution, HTML and
  Mermaid is acceptable. The goal is a simpler core.
- User decision: no virtualization; first page of notes plus load-more on scroll.
- User decisions:
  - published board, not bundled;
  - one combined "Categories & Tags" sidebar view;
  - grid view for JSON arrays only, no CSV grid. JSON keeps column types (string, number,
    boolean) where CSV is all strings.
- CodeMirror rather than highlight-only rendering, because notes are edited in place.

### Follow-up research (US-1770)

After the built-in editor is gone, review the editor code for workarounds and abstractions that
existed only so regular Persephone editors (Monaco, Grid, Markdown, HTML, …) could render inside a
note card, and propose simplifications. The output is a findings document with ranked refactoring
candidates, each becoming its own task once the user approves it. This analysis is Claude's work,
not delegated. Starting points:
- `NoteItemEditModel` acting as an `IContentHost` for embedded editors;
- `IContentHost.getEditorState`/`setEditorState` and `TextHostEditorModel.mirrorHostSettings`:
  check whether anything besides EnvVars and page descriptors still needs the per-host slot;
- the adopt/yield content-host trait paths;
- the HTML-view focus workaround in `HtmlBodyView.ts`;
- the Grid editor's notebook-slot handling.
