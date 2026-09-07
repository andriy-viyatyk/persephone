---
title: "Editors"
audience: both
summary: "An overview of Persephone's editors and the file types and features they support."
---

# Editors

Every file page uses one editor, and some files offer toolbar switches. Use this catalogue to find
the screen, its script-facing `editorId`, and the detailed guide.

The [screen catalogue](../screens/index.md) owns the `tools-hub-view` mapping because the Tools &
Editors hub is an application screen; this page remains the editor catalogue.

The catalogue families are **Text and code**, **Structured data**, **Viewers and previews**,
**Drawing**, and **Web and custom apps**.

| Editor | editorId | What it opens | Guide |
|---|---|---|---|
| Text Editor | `monaco` | Text, code, scripts, and unknown files | [Text Editor](./monaco.md) |
| Grid Editor | `grid-json`, `grid-csv`, `grid-jsonl` | JSON, CSV, and JSONL tables | [Grid Editor](./grid.md) |
| Notebook Editor | `notebook-view` | Structured `.note.json` notes | [Notebook](./notebook.md) |
| Link Editor | `link-view` | `.link.json` link collections | [Links](./links.md) |
| REST Client | `rest-client` | `.rest.json` HTTP collections | [REST Client](./rest-client.md) |
| Environment Variables | `env-vars-view` | Board environment profiles | [Environment Variables](./env-vars.md) |
| Graph View | `graph-view` | `.fg.json` force graphs | [Graph View](./graph.md) |
| Log View | `log-view` | `.log.jsonl` structured log output | [Log View](./log-view.md) |
| Markdown Preview | `md-view` | Markdown documents | [Markdown Preview](./markdown.md) |
| HTML Preview | `html-view` | HTML documents | [HTML Preview](./html.md) |
| SVG Preview | `svg-view` | SVG documents | [SVG Preview](./svg.md) |
| Mermaid Viewer | `mermaid-view` | `.mmd` and `.mermaid` diagrams | [Mermaid](./mermaid.md) |
| Image Viewer | `image-view` | Raster image files | [Image Viewer](./image.md) |
| Video Player | `video-view` | Video, audio, and streams | [Video Player](./video.md) |
| Archive Editor | `archive-view` | Compressed archives and entries | [Archive Editor](./archive.md) |
| Folder View | `category-view` | Folders and archive directories | [Folder View](./folder.md) |
| Drawing Editor | `draw-view` | `.excalidraw` drawings | [Drawing Editor](./draw.md) |
| Browser | `browser-view` | Web pages and web resources | [Browser](./browser.md) |
| Board | `board-view` | Trusted custom HTML applications | [Board](./board.md) |
| Git Tree | `git-tree` | Repository history and Git status | [Git Tree](./git-tree.md) |
| Git Diff | `file-diff` | Revisions of a Git-tracked file | [Git Diff](./file-diff.md) |

## How a user gets to an editor

Open a file and its extension normally selects the editor. You can also use the arrow beside **+**
to choose a pinned editor or **Show All...** for the **Tools & Editors** hub, or open that hub from
the Menu Bar. Files with more than one applicable editor expose switch buttons in the page toolbar.
The [screen catalogue](../screens/index.md) documents the surrounding Explorer, tabs, sidebar, and
[Menu Bar](../screens/menu-bar.md) chrome. Window-owned [Screen Snip](../screens/header.md) is
documented with the header; the Drawing guide covers the handoff from a snip into a canvas.

## Switching editors

The default and switchable combinations include JSON with Grid, Markdown with Preview, `.note.json`
with Notebook, `.link.json` with Links, `.fg.json` with Graph, `.rest.json` with REST Client,
`.excalidraw` with Drawing, `.svg` and `.html` with Preview, and `.mmd`/`.mermaid` with Mermaid.
CSV, JSONL, and NDJSON can use Grid; Git Diff is offered for text files in a repository when Git
integration is enabled. Archives, images, and audio/video normally have one specialized editor.

Content detection can add a switch without a special filename: Notebook requires JSON with
`"type": "note-editor"` and `"notes"`; Links requires `"type": "link-editor"` and `"links"`;
REST Client requires `"type": "rest-client"` and `"requests"`; and Graph requires
`"type": "force-graph"` and `"nodes"`. Log View is narrower: it accepts `.log.jsonl`, or JSONL
content carrying a `"type": "log.*"` marker, not arbitrary JSONL.

App and tool pages are not editor pages in this catalogue. Open their dedicated routes from the
[screens catalogue](../screens/index.md): [Settings](../screens/settings.md), [MCP Inspector](../screens/mcp-inspector.md),
the Tools & Editors menu, and the Mneme screens with details in [Mneme Knowledge Base](../mneme.md).
The Git Integration Setting is part of [Settings](../screens/settings.md); MCP Inspector can also be
opened with `app.pages.showMcpInspectorPage({ url })`. Most of these ids are deliberately outside
this editor catalogue; `board-info` is the content-host exception to the usual app-page
`pages.addEditorPage` restriction and remains screen-owned.

## Things that are no longer built in

There is no built-in Todo editor. A `.todo.json` file opens as ordinary JSON in Text, with a Grid
switch when its data is an array of objects. Install the [Todo board](../boards.md#published-boards-catalog--discover-install-update)
for the full task-list experience.

There is no built-in PDF viewer. A local PDF opens in Text and shows a binary warning; a PDF at an
HTTP URL uses Chromium in [Browser](./browser.md). Install the published [PDF Viewer board](../boards.md#published-boards-catalog--discover-install-update)
for search, thumbnails, outline, and zoom. Boards are installed from **Tools & Editors** ->
**Search boards**, then trusted when prompted.

## Errors & verification

If `pages.addEditorPage` reports an unknown editor, use an id from this table and the matching
language/suffix guidance in [the scripting page guide](../scripting/api/page.md). A standalone
editor such as Browser, Image Viewer, Archive, or Video Player is opened through its specialized
route rather than an arbitrary add-page call. Parse errors usually mean the content does not match
the editor's format; the detailed page and the linked format guide are the next check. If a switch
is missing, verify the filename suffix and the content marker listed above. Git and Mneme are both
off by default; enable them in Settings when their pages are absent.

The editor pages own the `editorId` mappings. The detailed agent and format references link back to
their user-facing editor pages without claiming those IDs, so F1 and the guide browser have one
unambiguous destination for each editor.

## Where to go next

- [Screen catalogue](../screens/index.md) for application chrome and app-owned pages.
- [Scripting](../scripting/index.md) and the [page API](../scripting/api/page.md) for facades and page creation.
- [Boards](../boards.md) for published boards and custom editors.
- [Browser](./browser.md) for browser, board, and app-window automation.
