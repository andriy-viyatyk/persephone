# US-1374: Editor pages - merge the two catalogues, split one page per editor

## Goal

Merge the user catalogue in `assets/guides/editors/index.md` with the agent catalogue in
`assets/guides/agents/ui-editors.md`, then publish one `audience: both` guide page for each of the
23 editor ids in scope. Reduce `editors/index.md` to a one-screen catalogue and preserve every
source heading and fact in a checked destination. This task is documentation only: no application
code, tests, dashboard entry, commit, or `## Layout` schema is part of US-1374.

## Background

EPIC-092 moved both source documents verbatim. The user catalogue is 935 lines and is organised as
roughly one `##` section per editor (`assets/guides/editors/index.md:1-935`); the agent catalogue is
309 lines, organised by editor id and family (`assets/guides/agents/ui-editors.md:1-309`). The
duplication is intentional history, but it is now a correctness risk: a user-facing fact and an
agent-facing fact can drift, and a future layout schema can contradict either one.

The registry is the authority for the inventory. `EDITORS` contains 32 ids
(`src/renderer/editors/register-editors.ts:132-203`). EPIC-094 decision 2 removes these eight app
screens from this task: `settings-view`, `about-view`, `tools-hub-view`, `mcp-view`, `mneme-config`,
`mneme-root`, `board-info`, and `toolset-view`. `storybook-view` is development-only and receives no
guide page. Therefore `32 - 8 - 1 = 23` ids remain:

| Family | ids in scope |
|---|---|
| Text and code | `monaco`, `file-diff`, `git-tree` |
| Structured data | `grid-json`, `grid-csv`, `grid-jsonl`, `notebook-view`, `link-view`, `rest-client`, `env-vars-view`, `graph-view`, `log-view` |
| Viewers and previews | `md-view`, `html-view`, `svg-view`, `mermaid-view`, `image-view`, `video-view`, `archive-view`, `category-view` |
| Drawing | `draw-view` |
| Web and custom apps | `browser-view`, `board-view` |

The registry and matchers confirm the ids, display names, file matchers, default/switch behaviour,
and content detection (`src/renderer/editors/register-editors.ts:149-166,176-203` and
`src/renderer/editors/base/editor-matchers.ts:40-160`). `grid-json`, `grid-csv`, and `grid-jsonl`
share one `GridEditor` surface (`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:57-61`), so
they share `editors/grid.md` and its front matter uses a list-valued `editorId`. US-1375 is now
landed: `screen` is accepted, `editorId` accepts either a quoted scalar or a quoted list, and
unknown metadata keys are ignored rather than degrading the whole file (`src/shared/guides/front-matter.ts:9,30-42,54-60,76-85`; `src/shared/guides/index.ts:18-24`).

The existing `assets/guides/editors/grid.md`, `notebook.md`, and `browser.md` are the bases, not
files to overwrite. Their current front matter is visible at `grid.md:1-5`, `notebook.md:1-6`, and
`browser.md:1-6`. The catalogue sections merge into those pages. The three new pages that will claim
an id already claimed elsewhere are `editors/log-view.md` (`formats/ui-push.md:1-5`),
`editors/graph.md` (`formats/graph.md:1-5`), and `editors/links.md` (`formats/links.md:1-5`). The
existing base pages also remain in the five-id collision set: `browser-view` is claimed by
`agents/browser.md`, and `notebook-view` by `formats/notebook.md`. US-1378 owns making `editorId`
unique; US-1374 must not edit those competing pages or add another claim.

The handoff checklist for claims already present elsewhere is explicit: the new `editors/graph.md`
claims `graph-view` already claimed by `assets/guides/formats/graph.md`; the new
`editors/links.md` claims `link-view` already claimed by `assets/guides/formats/links.md`; and the
new `editors/log-view.md` claims `log-view` already claimed by `assets/guides/formats/ui-push.md`.
The last one is a sixth affected id authored by this task, not merely inherited. The retained bases
also claim `browser-view` alongside `assets/guides/agents/browser.md` and `notebook-view` alongside
`assets/guides/formats/notebook.md`; all five inherited claimant paths remain US-1378 work.

US-1375's other current claims were checked against this page set: `assets/guides/editors/index.md`
claims `tools-hub-view`, `assets/guides/mneme.md` claims `mneme-config` and `mneme-root`,
`assets/guides/boards.md` claims `board-info`, and `assets/guides/agent-tools.md` claims
`toolset-view`. None is claimed by an `editors/` page in this task; the index claim is preserved
explicitly below because `KeyboardService.findGuidePath()` now handles scalar and list claims
(`src/renderer/api/internal/KeyboardService.ts:9-18,94-101`).

### Facade and editor audit already performed

The implementation must retain the user facts while adding the actual agent surface from the
corresponding editor and facade. These are the verified static facade element inventories; names
not present in a static `elements` declaration must not be invented in the task's merged prose.

| Page / ids | Actual editor and facade evidence | Current curated elements |
|---|---|---|
| `monaco` | `TextEditorFacade.ts:8-79`; Monaco keybinding and text chrome in `configure-monaco.ts:101-112` | `text-compare-left`, `text-run-script`, `text-run-all-script`, `text-show-resources`, `text-toggle-script`, `script-panel-splitter`, `script-run`, `script-run-all`, `script-select`, `script-save`, `script-open-tab`, `script-close` |
| `grid-json`, `grid-csv`, `grid-jsonl` | `GridEditorFacade.ts:19-61`; view controls and all three modules in `editors/grid/index.ts:65-94,294-305` | `grid-search`, `grid-search-clear`, `grid-columns`, `grid-csv-options`, `columns-options-apply`, `columns-options-cancel`, `csv-options-header`, `csv-options-delimiter`, `csv-options-other` |
| `log-view` | `LogViewEditorFacade.ts:15-28` | `log-clear`, `log-toggle-timestamps`, `log-grid-open-in-editor`, `log-markdown-open-in-editor`, `log-mermaid-open-in-editor`, `log-mermaid-copy`, `log-text-open-in-editor`, `log-radio-group`, `log-select`, `log-text-input`, `log-dialog-button`, `log-dialog-checkbox` |
| `md-view` | `MarkdownEditorFacade.ts:7-15` | `text-compare-left`, `markdown-compact-toggle`, `markdown-back`, `find-input`, `find-prev`, `find-next`, `find-close` |
| `svg-view` | `SvgEditorFacade.ts:9-14`; export and Drawing handoff in `editors/svg/SvgEditor.ts:26-91` | `text-compare-left`, `svg-open-draw`, `svg-save`, `svg-copy` |
| `html-view` | `HtmlEditorFacade.ts:9-14`; live iframe capture in `editors/html/HtmlEditor.ts:32-134` | `text-compare-left`, `text-show-resources`, `html-copy`, `html-more` |
| `mermaid-view` | `MermaidEditorFacade.ts:9-16`; render/export/conversion in `editors/mermaid/MermaidEditor.ts:57-271` | `text-compare-left`, `mermaid-theme`, `mermaid-open-draw`, `mermaid-convert-excalidraw`, `mermaid-save`, `mermaid-copy` |
| `graph-view` | `GraphEditorFacade.ts:10-44` | `graph-open-in-draw`, `graph-copy-image`, `graph-settings`, `graph-toggle-grouping`, `graph-reset-view`, `graph-expand-all`, `graph-search`, `graph-search-clear`, selection, tuning, detail, and legend controls listed at `GraphEditorFacade.ts:19-44` |
| `draw-view` | `DrawEditorFacade.ts:8-19,28-42` | No static UI `elements` list; the facade exposes canvas count, mount state, image insertion, and export only. |
| `link-view` | `LinkEditorFacade.ts:5-20,30-45` | No static UI `elements` list; the facade exposes link/category/tag snapshots and link mutations only. |
| `rest-client` | `RestClientEditorFacade.ts:24-46`; request body and response UI in `editors/rest-client/RequestBuilderView.ts:292-302` | `body-language`, `body-type-select`, multipart controls, header/form controls, request controls, response controls, `rest-send`, and `url-input` |
| `notebook-view` | `NotebookEditorFacade.ts:9-21`; embedded editor loading in `editors/notebook/note-editor/NoteItemActiveEditorView.ts:121-169` | `notebook-breadcrumb`, `notebook-search`, `notebook-search-clear`, `notebook-add-note`, `notebook-expanded-collapse`, `note-delete`, `note-expand`, `note-language`, `note-editor-switch`, `note-run-script`, `note-run-all-script` |
| `env-vars-view` | `EnvVarsEditorFacade.ts:12-21`; view names in `editors/env-vars/EnvVarsBodyView.ts:64-82,403-403,537-549` | `env-vars-grid`, `env-vars-profile-tabs`, `env-vars-add-profile`, `env-vars-delete-profile`, `env-vars-namespace-row`, `env-vars-add-namespace`, `env-vars-delete-namespace`, `env-vars-unlock` |
| `browser-view` | `BrowserEditorFacade.ts:61-76`; controls in `editors/browser/BrowserView.ts:267-361` | `url-input`, `url-navigate`, `url-bookmark-toggle`, `toolbar-back`, `toolbar-forward`, `toolbar-reload`, `toolbar-home`, `toolbar-bookmarks`, `toolbar-more`, `toolbar-devtools`, `toolbar-close`, `toolbar-tor-info`, `tabs-panel-host`, `popup-blocked-bar` |
| `image-view` | `ImageEditorFacade.ts:8-12`; actions in `editors/image/ImageEditor.ts:204-283` | `image-save`, `image-open-draw`, `image-copy` |
| `archive-view` | `ArchiveEditorFacade.ts:8-11`; the view only exposes refresh/collapse controls in `editors/archive/ArchiveEditorView.ts:43-55` | `archive-refresh`, `archive-collapse-all` |
| `video-view` | `VideoEditorFacade.ts:8-19`; audio controls in `editors/video/AudioControls.ts:110-209` | `video-url-input`, `video-open-vlc`, `audio-play-pause`, `audio-next`, `audio-mute`, `audio-shuffle`, `audio-seek`, `visualizer-bars`, `visualizer-circular`, `visualizer-none` |
| `category-view` | `FolderViewEditorFacade.ts:8-10` | `category-breadcrumb` |
| `git-tree` | `GitTreeEditorFacade.ts:17-22` | `git-tree-refresh`, `git-tree-bottom-tab-select`, `git-tree-pull`, `git-tree-push` |
| `board-view` | `BoardEditorFacade.ts:41-47`; trust and board chrome in `editors/board/UntrustedBoardView.ts:31-43` | `board-toolbar-explorer`, `board-toolbar-reload`, `board-toolbar-log`, `board-toolbar-properties`, `board-trust` |
| `file-diff` | `FileDiffEditorFacade.ts:7-34` | `file-diff-picker-from`, `file-diff-picker-to`, `text-compare-left`, `text-show-resources` |

Two important boundaries follow from this audit. Drawing and Links have no curated UI element list
today, so their merged pages describe the facade API without pretending that canvas/link controls are
highlightable. Grid filtering, sorting, cell editing, and several transient controls likewise remain
user prose unless a later schema task adds the corresponding element entry. The page must say when
a drawn control has no facade element, because `US-1376` owns the layout and `where` additions.

The merge applies this rule: on `editors/draw.md` (`draw-view`) and `editors/links.md` (`link-view`),
prose must not use words that imply an addressable control, including “highlight the …” or “point at
the …”. Their facades have no static `elements` list, so such wording gives US-1376 no element-name
column to populate and would push the schema toward inventing a control inside a third-party/canvas
surface. Describe user actions or facade methods instead; only controls with a verified element may
be described as addressable.

### Stale-content findings

The following are discrepancies found by comparing both source guides with the current registry,
matchers, editor implementations, and facades. They must be called out in implementation rather
than silently corrected. Claims not listed here were not found to contradict the checked source;
the per-page merge still rechecks them before copying them.

| Source claim | Verified current fact | Required treatment |
|---|---|---|
| `editors/grid.md:13-16` lists only `.grid.json` and `.grid.csv` as direct Grid files. | The registry has a separate `grid-jsonl` module and matcher for `.grid.jsonl` (`register-editors.ts:149-151`; `editor-matchers.ts:58-61`). | Add `.grid.jsonl` and JSONL to the merged Grid page. |
| `editors/grid.md:198-207` says the grid expects a JSON array of objects. | `GridEditor.reparseRows` explicitly wraps a single JSON object into a one-row grid (`src/renderer/editors/grid/GridEditor.ts:443-474`). | Say that arrays are the normal shape and a single object is accepted as one row. |
| `agents/ui-editors.md:115-117` says Log View handles “JSONL log content” generally. | The matcher accepts `.log.jsonl`, or content detected by a `"type": "log.` marker; arbitrary JSONL is not enough (`editor-matchers.ts:63-69`). | Narrow the detection statement and retain `pages.logView.push` as the programmatic route. |
| `editors/index.md:172-177` and `ui-editors.md:172-177` say ZIP-based archives are read/write. | `ArchiveEditor` has listing, navigation, and extraction paths but no archive write/edit operation (`editors/archive/ArchiveEditor.ts:107-158`); the view exposes only refresh and collapse (`ArchiveEditorView.ts:43-55`). | Replace “read/write” with the verified read/browse/extract behaviour. |
| `ui-editors.md:217-218` says every board must be explicitly trusted before it renders. | `app.boards.createBoard` and `createDemoBoard` scaffold and auto-trust the board (`src/renderer/api/boards.ts:23-36`); published-board installation still uses the user trust gate. | Qualify the trust rule by opening path and distinguish API-created boards from installed/untrusted boards. |
| `ui-editors.md:226-235` says `pages.addEditorPage` rejects every app/tool page, including `board-info`. | `board-info` is registered with `hasContentHost: true` (`register-editors.ts:181-189`), while `PagesLifecycleModel.addEditorPage` rejects only known definitions without that flag (`src/renderer/api/pages/PagesLifecycleModel.ts:259-281`). | Do not repeat the blanket claim; describe the dedicated routes and verify the `board-info` exception for US-1378. |
| `editors/notebook.md:18` says the Notebook switch is available only when the title ends in `.note.json`. | The matcher also detects JSON content with `"type": "note-editor"` and `"notes"` (`editor-matchers.ts:80-89`). | State both filename and content-based detection. |

These findings are also why the target pages must link the actual facade rather than copying the old
agent catalogue's API wording unchecked. The five inherited duplicate `editorId` claims and the new
`editors/log-view.md` claim remain a US-1378 concern, not a US-1374 fix.

## Implementation Plan

### 1. Create or edit the page set

The following are the exact target front matters. Each block is literal front matter, not a prose
example. All pages use `audience: both`; the Grid page uses the list form supported by the landed
US-1375 parser.
“New” means create the file; “edit” means merge into the existing base page.

#### New pages

`assets/guides/editors/monaco.md` (new)

```yaml
---
title: "Text Editor"
audience: both
summary: "Monaco-powered text editing for code, plain text, scripts, and file content."
editorId: "monaco"
---
```

`assets/guides/editors/log-view.md` (new)

```yaml
---
title: "Log View"
audience: both
summary: "Structured JSONL output, messages, and interactive dialogs for agent and script results."
editorId: "log-view"
---
```

`assets/guides/editors/markdown.md` (new)

```yaml
---
title: "Markdown Preview"
audience: both
summary: "GitHub-flavored Markdown preview with search, navigation, code blocks, Mermaid, and local assets."
editorId: "md-view"
---
```

`assets/guides/editors/svg.md` (new)

```yaml
---
title: "SVG Preview"
audience: both
summary: "Live SVG preview with zoom, raster export, clipboard copy, and Drawing Editor handoff."
editorId: "svg-view"
---
```

`assets/guides/editors/html.md` (new)

```yaml
---
title: "HTML Preview"
audience: both
summary: "Sandboxed live HTML preview with JavaScript, resource extraction, and image capture."
editorId: "html-view"
---
```

`assets/guides/editors/mermaid.md` (new)

```yaml
---
title: "Mermaid Diagram Viewer"
audience: both
summary: "Mermaid diagram preview with theme toggle, image export, and Excalidraw conversion."
editorId: "mermaid-view"
---
```

`assets/guides/editors/graph.md` (new; currently claimed by `formats/graph.md`)

```yaml
---
title: "Graph View"
audience: both
summary: "Interactive force-directed graph viewer for graph JSON with search, grouping, editing, and export."
editorId: "graph-view"
---
```

`assets/guides/editors/draw.md` (new)

```yaml
---
title: "Drawing Editor"
audience: both
summary: "Excalidraw drawing canvas for editable shapes, annotation, screen snips, and export."
editorId: "draw-view"
---
```

`assets/guides/editors/links.md` (new; currently claimed by `formats/links.md`)

```yaml
---
title: "Link Editor"
audience: both
summary: "Link collections with categories, tags, hostnames, views, previews, and drag-and-drop."
editorId: "link-view"
---
```

`assets/guides/editors/rest-client.md` (new)

```yaml
---
title: "REST Client"
audience: both
summary: "HTTP request collections with request editing, body formats, responses, and export."
editorId: "rest-client"
---
```

`assets/guides/editors/env-vars.md` (new)

```yaml
---
title: "Environment Variables Editor"
audience: both
summary: "Per-board environment variables with namespaces, profiles, editable values, and encryption."
editorId: "env-vars-view"
---
```

`assets/guides/editors/image.md` (new)

```yaml
---
title: "Image Viewer"
audience: both
summary: "Image viewer with zoom, pan, clipboard paste, format-preserving save, and Drawing Editor handoff."
editorId: "image-view"
---
```

`assets/guides/editors/archive.md` (new)

```yaml
---
title: "Archive Editor"
audience: both
summary: "Archive browser for compressed files, with tree navigation, inline previews, and extraction."
editorId: "archive-view"
---
```

`assets/guides/editors/video.md` (new)

```yaml
---
title: "Video Player"
audience: both
summary: "Video and audio playback with streams, visualizer effects, navigation, and VLC fallback."
editorId: "video-view"
---
```

`assets/guides/editors/folder.md` (new)

```yaml
---
title: "Folder View"
audience: both
summary: "Folder and archive-directory browsing with list/tile views, navigation, and file operations."
editorId: "category-view"
---
```

`assets/guides/editors/git-tree.md` (new)

```yaml
---
title: "Git Tree"
audience: both
summary: "Repository history and Git status with refs, changes, commits, panels, and navigation."
editorId: "git-tree"
---
```

`assets/guides/editors/board.md` (new)

```yaml
---
title: "Board"
audience: both
summary: "Sandboxed custom HTML applications and file editors backed by scripts and board manifests."
editorId: "board-view"
---
```

`assets/guides/editors/file-diff.md` (new)

```yaml
---
title: "Git Diff"
audience: both
summary: "Revision comparison for Git-tracked files with selectable From/To revisions and editable working tree."
editorId: "file-diff"
---
```

#### Existing bases to edit

`assets/guides/editors/grid.md` (edit)

```yaml
---
title: "Grid Editor"
audience: both
summary: "Spreadsheet-like viewing and editing of JSON, CSV, and JSONL data."
editorId: ["grid-json", "grid-csv", "grid-jsonl"]
---
```

`assets/guides/editors/notebook.md` (edit; retain its current title and summary)

```yaml
---
title: "Notebook Editor"
audience: both
summary: "Structured notes in `.note.json` files with code, categories, tags, and full-text search."
editorId: "notebook-view"
---
```

`assets/guides/editors/browser.md` (edit; retain its current title and summary)

```yaml
---
title: "Browser"
audience: both
summary: "A built-in web browser for documentation, APIs, and web resources."
editorId: "browser-view"
---
```

The merge also edits `assets/guides/agents/ui-editors.md` into a short compatibility pointer to
`../editors/index.md`, so the old duplicate cannot drift. It does not delete the file or alter the
agent-only format/browser pages; their `editorId` cleanup belongs to US-1378.

### 2. Preserve complete heading coverage

This table is the implementation checklist. Every source heading is assigned before text is
removed. Category headings in the agent source are included even though the epic specifically
requires every `###` heading, because they define the catalogue grouping.

#### `assets/guides/editors/index.md` source headings

| Source heading | Destination |
|---|---|
| `## Text Editor (Default)` (`index.md:11`) | `editors/monaco.md` |
| `## Grid Editor` (`index.md:27`) | `editors/grid.md` |
| `## Markdown Preview` (`index.md:51`) | `editors/markdown.md` |
| `## PDF Viewer` (`index.md:84`) | `editors/index.md`, under the retained “Things that are no longer built in” note; link to the published PDF board |
| `## Video Player` (`index.md:95`) | `editors/video.md` |
| `## Image Viewer` (`index.md:147`) | `editors/image.md` |
| `## Screen Snip` (`index.md:169`) | `../screens/header.md` (chrome-owned page, US-1375); editor pages keep the Drawing handoff link |
| `## SVG Preview` (`index.md:191`) | `editors/svg.md` |
| `## Mermaid Diagram Viewer` (`index.md:203`) | `editors/mermaid.md` |
| `## HTML Preview` (`index.md:230`) | `editors/html.md` |
| `## Browser` (`index.md:254`) | `editors/browser.md` |
| `## Compare Mode` (`index.md:275`) | `editors/monaco.md`; it is a grouped-page mode, not a registry editor id |
| `## Todo Lists` (`index.md:294`) | `editors/index.md`, under “Things that are no longer built in”; link to the Todo board |
| `## Notebook Editor` (`index.md:300`) | `editors/notebook.md` |
| `## Graph View` (`index.md:314`) | `editors/graph.md` |
| `## Log View` (`index.md:409`) | `editors/log-view.md` |
| `## Drawing Editor` (`index.md:419`) | `editors/draw.md` |
| `## Link Editor` (`index.md:441`) | `editors/links.md` |
| `## Rest Client` (`index.md:477`) | `editors/rest-client.md` |
| `## Environment Variables Editor` (`index.md:495`) | `editors/env-vars.md` |
| `## Folder View` (`index.md:508`) | `editors/folder.md`; its `### Selecting multiple items` and `### Drag and drop` remain under Folder View |
| `## Archive Editor` (`index.md:583`) | `editors/archive.md` |
| `## Git Tree` (`index.md:601`) | `editors/git-tree.md` |
| `## Git Diff` (`index.md:792`) | `editors/file-diff.md` |
| `## Git Integration Setting` (`index.md:823`) | `../screens/settings.md` (settings-owned page, US-1375); Git pages link back to it |
| `## MCP Inspector` (`index.md:837`) | `../screens/index.md` (app-screen catalogue, US-1375) plus the existing scripting/API reference |
| `## Mneme Knowledge Base` (`index.md:856`) | `../screens/index.md` for the two app screens plus existing `../mneme.md` for detailed knowledge-base prose |
| `## Board` (`index.md:869`) | `editors/board.md` |
| `## Switching Editors` (`index.md:902`) | `editors/index.md` |

#### `assets/guides/agents/ui-editors.md` source headings

| Source heading | Destination |
|---|---|
| `## How a user gets to an editor` (`ui-editors.md:20`) | `editors/index.md` |
| `## Text and code` (`ui-editors.md:35`) | `editors/index.md` catalogue grouping |
| `### Text Editor — \`monaco\`` (`ui-editors.md:37`) | `editors/monaco.md` |
| `### Compare Mode` (`ui-editors.md:47`) | `editors/monaco.md` |
| `### Git Diff — \`file-diff\`` (`ui-editors.md:52`) | `editors/file-diff.md` |
| `### Git Tree — \`git-tree\`` (`ui-editors.md:58`) | `editors/git-tree.md` |
| `## Structured data` (`ui-editors.md:67`) | `editors/index.md` catalogue grouping |
| `### Grid — \`grid-json\`, \`grid-csv\`, \`grid-jsonl\`` (`ui-editors.md:69`) | `editors/grid.md` |
| `### Notebook — \`notebook-view\`` (`ui-editors.md:79`) | `editors/notebook.md` |
| `### Links — \`link-view\`` (`ui-editors.md:86`) | `editors/links.md` |
| `### Rest Client — \`rest-client\`` (`ui-editors.md:94`) | `editors/rest-client.md` |
| `### Environment Variables — \`env-vars-view\`` (`ui-editors.md:103`) | `editors/env-vars.md` |
| `### Graph — \`graph-view\`` (`ui-editors.md:110`) | `editors/graph.md` |
| `### Log View — \`log-view\`` (`ui-editors.md:115`) | `editors/log-view.md` |
| `## Viewers and previews` (`ui-editors.md:119`) | `editors/index.md` catalogue grouping |
| `### Markdown Preview — \`md-view\`` (`ui-editors.md:121`) | `editors/markdown.md` |
| `### HTML Preview — \`html-view\`` (`ui-editors.md:132`) | `editors/html.md` |
| `### SVG Preview — \`svg-view\`` (`ui-editors.md:139`) | `editors/svg.md` |
| `### Mermaid — \`mermaid-view\`` (`ui-editors.md:144`) | `editors/mermaid.md` |
| `### Image Viewer — \`image-view\`` (`ui-editors.md:152`) | `editors/image.md` |
| `### Video / Audio Player — \`video-view\`` (`ui-editors.md:161`) | `editors/video.md` |
| `### Archive — \`archive-view\`` (`ui-editors.md:172`) | `editors/archive.md` |
| `### Folder View — \`category-view\`` (`ui-editors.md:179`) | `editors/folder.md` |
| `## Drawing` (`ui-editors.md:190`) | `editors/index.md` catalogue grouping |
| `### Drawing Editor — \`draw-view\`` (`ui-editors.md:192`) | `editors/draw.md` |
| `## Web and custom apps` (`ui-editors.md:202`) | `editors/index.md` catalogue grouping |
| `### Browser — \`browser-view\`` (`ui-editors.md:204`) | `editors/browser.md` |
| `### Board — \`board-view\`` (`ui-editors.md:211`) | `editors/board.md` |
| `## App and tool pages` (`ui-editors.md:224`) | `../screens/index.md`; `editors/index.md` keeps only the cross-link and scope note |
| `## Switching editors` (`ui-editors.md:240`) | `editors/index.md` |
| `## Things that are no longer built in` (`ui-editors.md:270`) | `editors/index.md` |
| `## Errors & verification` (`ui-editors.md:286`) | `editors/index.md` |
| `## Where to go next` (`ui-editors.md:303`) | `editors/index.md` |

### 3. Merge the two voices into one readable page

Every editor page remains `audience: both`. The concrete editorial rule is: introduce a fact in the
user's action/label vocabulary, then attach its machine identity and route in the same paragraph or
in an adjacent “For agents and scripts” paragraph. For example:

```md
Click **Grid** in the page toolbar to view supported tabular content. The same screen is exposed
to scripts as `page.editor` with id `grid-json`, `grid-csv`, or `grid-jsonl`; a new content page uses
`pages.addEditorPage("grid-json", "json", title, content)`.
```

This preserves both “click **Grid** in the toolbar” and “`grid-json`, opened with
`pages.addEditorPage`” without repeating the whole page in two voices. User-facing labels stay
bold and concrete; ids, method names, selectors, and error contracts stay inline code. A feature
that is user-visible but absent from the facade is explicitly labelled as such. Agent-only API
details from the old catalogue are folded beside the feature they describe, not left as a trailing
agent appendix.

Each page will use this order: front matter, H1 and short purpose, `## How to Open`, `## Layout`,
feature sections from both source pages, an editor-specific `## Agent API` section tied to the actual
facade, and concise editor-specific errors/limits. The generic opening/switching/errors/navigation
material stays at the index. `## Layout` is reserved for US-1376; US-1374 adds only the heading and
the agreed position.

### 4. Place the `## Layout` slot consistently

US-1376 writes the schemas. It must insert the section exactly after the following heading on every
page, before the first feature section:

| Page | `## Layout` follows |
|---|---|
| `monaco.md` | `## How to Open` |
| `grid.md` | existing `## How to Open` |
| `log-view.md`, `markdown.md`, `svg.md`, `html.md`, `mermaid.md`, `graph.md`, `draw.md`, `links.md`, `rest-client.md`, `env-vars.md`, `image.md`, `archive.md`, `video.md`, `folder.md`, `git-tree.md`, `board.md`, `file-diff.md` | the page's new `## How to Open` |
| `notebook.md` | existing `## Getting Started` (the current page already places `## Layout` there at `notebook.md:12-20`) |
| `browser.md` | a new merged `## How to Open` section; move the existing opening paragraph into it, then place `## Layout` before `## URL Bar` |

No ASCII diagram, schema field, control position, or `where` value is written by US-1374. The
convention is only the insertion point, so US-1376 does not have to infer placement from page length.

### 5. Shrink the index and retain its catalogue framing

The old index starts with a long editor manual (`editors/index.md:7-49`) and ends with a second
switching catalogue (`editors/index.md:902-935`). The target keeps `audience: both`, H1, a short
two-sentence explanation, and one table with columns `Editor`, `editorId`, `What it opens`, and
`Guide`. The table has one row for the 21 pages, with one row for Grid listing its three ids; app
screens are linked to `../screens/index.md` rather than pretending to be editor pages.

The rewrite preserves the current front-matter line `editorId: "tools-hub-view"` from
`assets/guides/editors/index.md:1-5`. This maps the Tools & Editors hub to the catalogue; dropping it
would make `KeyboardService.findGuidePath()` find nothing for `tools-hub-view` even though its lookup
is now list-aware (`src/renderer/api/internal/KeyboardService.ts:9-18`). The table rewrite changes
the body only and keeps that mapping.

The index also keeps these catalogue-level framing sections from `ui-editors.md`: **How a user gets
to an editor**, **Switching editors**, **Things that are no longer built in**, **Errors &
verification**, and **Where to go next**. Each is reduced to the facts needed to navigate the
catalogue and links to the detailed page. “App and tool pages” moves to the screens catalogue owned
by US-1375, with a one-paragraph scope pointer in `editors/index.md`. Editor-specific prose goes to
the corresponding page. The target is roughly 90-130 lines, including the table and framing, down
from 935, and must fit on one guide-browser screen at catalogue scale.

Before -> after shape:

```md
<!-- before: assets/guides/editors/index.md:7-11 -->
# Editors
persephone includes multiple editors for different file types...
## Text Editor (Default)

<!-- after -->
# Editors
Every file page uses one editor; some files offer toolbar switches. Use this table to find the
screen and its script-facing id.

| Editor | editorId | What it opens | Guide |
|---|---|---|---|
| Text Editor | `monaco` | Text and code files | [Text Editor](./monaco.md) |
```

### 6. Use safe relative links

All links authored inside `assets/guides/editors/` will use Markdown-relative `.md` paths:
`./grid.md` for another editor page, the exact existing screen targets listed below, and
`../scripting/index.md` or `../scripting/api/page.md` for scripting references. Use fragments only
when the target heading is stable. Do not use Windows paths, `file:` URLs, or hand-written
`persephone-guide://` URLs in page prose.

The exact screen links planned by the merge are:

| Source fact | Link from an editor page | Verified target |
|---|---|---|
| Screen catalogue and app/tool-page scope | `../screens/index.md` | `assets/guides/screens/index.md` exists |
| Screen Snip handoff | `../screens/header.md` | `assets/guides/screens/header.md` exists |
| Git Integration Setting | `../screens/settings.md` | `assets/guides/screens/settings.md` exists |
| MCP Inspector | `../screens/mcp-inspector.md` | `assets/guides/screens/mcp-inspector.md` exists |
| Tools & Editors/menu route | `../screens/menu-bar.md` | `assets/guides/screens/menu-bar.md` exists |

`../screens/sidebar.md`, `../screens/tabs.md`, and `../screens/dialogs.md` are also real targets
available for the relevant opening/navigation details; there is deliberately no
`../screens/tools.md`. The implementation checks these exact paths with the current screen corpus
before publishing links.

This works in both consumers. GitHub resolves the `.md` links as ordinary repository-relative
Markdown links. The guide browser's `resolveGuideHref` decodes the href, resolves `.` and `..`
against the source guide path, strips the final `.md`, and returns a `persephone-guide://` URL
(`src/shared/guides/guide-links.ts:58-99`). For example, from `editors/monaco.md`,
`../scripting/index.md` resolves to `persephone-guide://scripting/index`; from
`editors/monaco.md`, `../screens/index.md` resolves to
`persephone-guide://screens/index`. The resolver intentionally leaves existence to the asynchronous
guide index (`guide-links.ts:58-99`), so the implementation must check the exact screen paths above
against the current screen files before the corpus is shipped.

### 7. Apply the audit while merging

For each destination page, merge the two source sections, inspect the actual editor implementation,
then inspect the corresponding facade element declaration listed above. Do not bulk-copy 935 and
309 lines and clean them up afterward. At minimum, verify the registry/matcher route, opening route,
displayed controls, content/format claims, script route, error/disabled states, and every stale fact
listed above. Keep the existing detailed Grid, Notebook, and Browser prose as the starting point,
but correct it in place and retain its useful details.

No unit tests or test harnesses are planned; this repository does not use them for this corpus task.
Validation is static and corpus-specific: parse every target front matter with the landed US-1375
parser, count
the 23 ids, check the coverage table against the source headings, check that each relative link
resolves, and search for duplicate `editorId` claims to hand to US-1378.

### Files that need no changes

- `src/renderer/editors/register-editors.ts` - registry facts are read-only input to this task.
- `src/renderer/editors/base/editor-matchers.ts` - matcher facts are read-only input.
- `src/renderer/scripting/api-wrapper/*Facade.ts` - US-1374 documents these surfaces; US-1376 owns schema/`where` changes.
- `src/shared/guides/front-matter.ts` - US-1375's scalar/list `editorId`, `screen`, and tolerant
  unknown-key parsing is already landed; US-1374 only consumes it and makes no parser edit.
- `src/shared/guides/guide-links.ts` - inspected to choose the link convention; no resolver change is needed.
- `assets/guides/agents/browser.md`, `assets/guides/formats/notebook.md`, `assets/guides/formats/graph.md`, `assets/guides/formats/links.md`, and `assets/guides/formats/ui-push.md` - duplicate claims are recorded for US-1378, not silently changed here.
- `doc/active-work.md` and `doc/epics/EPIC-094.md` - the dashboard entry and epic task table already exist, per the request.

## Concerns

1. **Parser state:** US-1375 is already landed. The current parser accepts the Grid scalar/list
   front matter and ignores unknown metadata keys (`src/shared/guides/front-matter.ts:30-42,54-60,76-85`);
   implementation validation must confirm the target files parse with that current behaviour.
2. **Id uniqueness:** Three new pages and two retained bases currently collide with agent/format
   pages, with `log-view` explicitly adding the sixth affected id. Record every claimant for US-1378;
   do not “fix” it by changing those pages in this task.
3. **Screen ownership:** The eight app-screen ids and Storybook are deliberately absent from the
   editor page set. The index must link to the screen catalogue, not create a ninth editor category.
4. **Schema ownership:** `## Layout` is a stable empty slot only. US-1374 must not write layout
   boxes or `where` phrases; US-1376 writes and verifies those against the live editor.
5. **Legacy URI compatibility:** The old `ui-editors.md` file is reduced to a pointer only after
   its content has coverage in the new pages. Resource alias changes and F1/editor mapping remain
   US-1378 work.

## Acceptance Criteria

- [ ] `assets/guides/editors/` contains exactly 21 editor pages for the 23 in-scope ids: the 18 new
      files and edited `grid.md`, `notebook.md`, and `browser.md`; Grid claims all three ids in one
      list-valued `editorId`.
- [ ] Every target page has the exact front matter listed in this document, with `audience: both`,
      a useful one-line summary, and no app-screen or Storybook id.
- [ ] `editors/index.md` is approximately 90-130 lines, preserves `editorId: "tools-hub-view"`,
      contains the four-column catalogue table,
      retains the five named catalogue framing sections, and links to the per-editor and screen
      guides.
- [ ] The two coverage tables account for every `##` heading in `editors/index.md` and every `###`
      heading in `agents/ui-editors.md`; no source fact is dropped without a destination or an
      explicit existing-guide link.
- [ ] All merged editor pages use `audience: both` and reconcile user labels/actions with ids,
      `pages.addEditorPage`/specialized open routes, and actual facade facts in the same narrative.
- [ ] Every page has an empty `## Layout` slot at the exact insertion point in the Layout table;
      no US-1376 schema or `where` value is added.
- [ ] The seven stale findings are corrected visibly in the plan's implementation checklist and in
      the eventual prose: JSONL Grid opening, single-object Grid input, Log View detection, archive
      write claim, board trust qualification, `board-info` add-page exception, and Notebook content
      detection.
- [ ] Relative links use `.md` paths that work on GitHub and resolve through
      `resolveGuideHref`; no unsafe absolute or Windows path is introduced.
- [ ] `agents/ui-editors.md` becomes a compatibility pointer, while the five inherited duplicate
      `editorId` claims and the new `editors/log-view.md`/`formats/ui-push.md` collision are explicitly
      handed to US-1378; the draw/link no-elements rule is applied verbatim.
- [ ] No source, application, test, dashboard, or commit changes are made outside the planned guide
      documents.

## Files Changed

| File | Change |
|---|---|
| `doc/tasks/US-1374-editor-pages-per-screen/README.md` | This task document |
| `assets/guides/editors/index.md` | Edit from 935-line manual to catalogue and framing |
| `assets/guides/editors/grid.md` | Edit existing Grid base; merge source prose and add list-valued ids |
| `assets/guides/editors/notebook.md` | Edit existing Notebook base; merge catalogue prose and correct detection wording |
| `assets/guides/editors/browser.md` | Edit existing Browser base; merge catalogue prose and add the shared structure |
| `assets/guides/editors/monaco.md` | New Text Editor page |
| `assets/guides/editors/log-view.md` | New Log View page |
| `assets/guides/editors/markdown.md` | New Markdown Preview page |
| `assets/guides/editors/svg.md` | New SVG Preview page |
| `assets/guides/editors/html.md` | New HTML Preview page |
| `assets/guides/editors/mermaid.md` | New Mermaid page |
| `assets/guides/editors/graph.md` | New Graph page; collision handed to US-1378 |
| `assets/guides/editors/draw.md` | New Drawing page |
| `assets/guides/editors/links.md` | New Link Editor page; collision handed to US-1378 |
| `assets/guides/editors/rest-client.md` | New REST Client page |
| `assets/guides/editors/env-vars.md` | New Environment Variables page |
| `assets/guides/editors/image.md` | New Image Viewer page |
| `assets/guides/editors/archive.md` | New Archive page |
| `assets/guides/editors/video.md` | New Video Player page |
| `assets/guides/editors/folder.md` | New Folder View page |
| `assets/guides/editors/git-tree.md` | New Git Tree page |
| `assets/guides/editors/board.md` | New Board page |
| `assets/guides/editors/file-diff.md` | New Git Diff page |
| `assets/guides/agents/ui-editors.md` | Replace duplicate catalogue with compatibility pointer |
