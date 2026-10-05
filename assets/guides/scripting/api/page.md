---
title: "Page API"
audience: user
summary: "The active tab, its content pipe and restore status, and its editor and editor-switching APIs."
---

# Page API
`page` is the active tab. `app.pages.activePage` and `app.pages.all` expose the same page
objects. The page API is structural: the current editor is available as `page.editor`, and
editor switching is available as `page.editorSwitches`.

## Page properties

| Property | Description |
|---|---|
| `id`, `title`, `filePath`, `modified`, `pinned` | Page and tab metadata |
| `workspaceFolder` | The project folder at the root of this page's Explorer, or `undefined` without a folder Explorer or while browsing an archive |
| `content` | Read or assign text content for text-based editors |
| `language` | Read or assign the language id |
| `ready` | Promise for the page's current content-restore attempt |
| `pipe` | Current primary content pipe, when this page has one |
| `editor` | Read-only current editor facade; narrow on `editor.id` |
| `editorSwitches` | Current id, toolbar-identical options, and `switchTo(id)` |
| `tab` | This page's tab state and scoped tab-strip controls |
| `data` | Per-page in-memory data bag |
| `panels` | Page sidebar state and controls |
| `grouped` | The side-by-side page; reading it creates one if needed |

`page.editor` never returns `undefined`. Editors without operations yet return an identity facade
with `kind: "Editor"`, `id`, and `name`, whose help explains that no operations are available yet.

Persephone has no separate workspace feature, workspace files, workspace settings, or multi-root
workspaces. A workspace is a page whose Explorer panel is rooted at a project folder. Opening a
folder with `app.pages.openFile(folderPath)` intentionally returns an editorless page: use
`page.workspaceFolder` for its root and `page.panels` to browse it. It still appears in
`app.pages.all`, but has no main editor.

An unrelated empty tab can also remain open after its editor is closed, for example when an open
board is deleted. Its identity facade has `id === ""`; its `page.editorSwitches.current` and
`page.editorSwitches.options` are empty. Use `app.pages.navigatePageTo(page.id, filePath)` to open
a file in it, or `app.pages.closePage(page.id)` to close it.

```javascript
const editor = page.editor;
if (editor.id === "grid-json") {
    editor.addRows(5);
}
```

### Content restore and pipe status

Some editors can show the page shell before its content has finished restoring. `page.ready`
resolves when that restore attempt succeeds and rejects if it fails or is cancelled. Await it before
reading content that depends on the editor being ready, and handle rejection when the open may be
cancelled:

```javascript
try {
    await page.ready;
    console.log(page.content);
} catch (error) {
    console.log("Page content did not finish loading", error);
}
```

For a page backed by a content pipe, `page.pipe` exposes its current primary pipe. Its `stages`
list the provider and transformers in read order; each stage can have transient status. `summary`
selects an error first, otherwise the most recently updated stage status. Use
`pipe.onStatusChange(callback)` to observe updates and call the returned disposer when finished.
Provider and transformer status may include a state, text, detail, byte progress, and bytes-per-second
rate. Status is not persisted. See the [`io` pipe status reference](./io.md#icontentpipe).

```javascript
const pipe = page.pipe;
if (pipe) {
    console.log(pipe.stages, pipe.summary);
    const unsubscribe = pipe.onStatusChange(() => console.log(pipe.summary));
    // Call unsubscribe when observation is no longer needed.
}
```

## `page.tab`

`page.tab` describes this page's tab-strip presentation. It exposes `title`, `modified`,
`pinned`, `active`, and `soundIndicator`, plus the tab's curated `elements` and
`highlight(name, message?)` helper. `active` also includes the grouped partner shown beside the
active page. Reading or highlighting the tab does not activate the page.

```javascript
console.log(page.tab.title, page.tab.active, page.tab.modified);
await page.tab.highlight("page-tab");
```

The operation-bearing ids are `monaco`, `grid-json`, `grid-csv`, `grid-jsonl`, `notebook-view`,
`env-vars-view`, `archive-view`, `log-view`, `category-view`, `git-tree`,
`link-view`, `md-view`, `svg-view`, `html-view`, `mermaid-view`,
`browser-view`, `mcp-view`, `image-view`, `video-view`, `file-diff`, `board-view`, `board-info`,
`toolset-view`, `tools-hub-view`, `mneme-config`, and `mneme-root`. A custom board secondary view
uses an id such as `board-editor:details`. Each facade also exposes its registry `name`.

## `page.editorSwitches`

`current` is the current main editor id. `options` is the exact merged projection shown by the
toolbar, including compatible built-in editors, trusted board matches, and the install entry. On a
folder page, this includes Folder View, trusted boards whose `folderEditorMasks` match the folder,
and `+` when a compatible published folder editor is available. If the current folder board no longer
matches or is no longer trusted, it can remain as a recovery-only option until you switch away.

```javascript
console.log(page.editorSwitches.current);
console.log(page.editorSwitches.options); // [{ id, label }]
await page.editorSwitches.switchTo("grid-json");
```

`switchTo(id)` accepts any registered editor id on a file page; on a folder page, use an id present in
`options` because the switch must be a currently available folder editor. A same-id call is a silent
no-op. The operation awaits the switch and then verifies
`mainEditorInstance.editorId`. If the call returns without switching, it throws a diagnostic that
the release prompt may have been declined or the page may have no file to rebuild over. Unknown
ids preserve the registry's existing rejection. The page toolbar is available as
`page.editorSwitches.elements` with the `page-editor-switch` declaration.

## Editor facades

The current `page.editor` value exposes the following existing operation surfaces when its id is
narrowed. A drawing page is a board page, so its `pages[i].editor` value is the board facade.

- `monaco`: selection, cursor, insertion, replacement, line reveal, highlighting, and the
  page-local `wordWrap` / `toggleWordWrap()` controls.
- `grid-json`, `grid-csv`, `grid-jsonl`: rows, columns, cell editing, search, and row/column changes.
- `notebook-view`: notes, categories, tags, and note editing.
- `link-view`: links, categories, tags, and link editing.
- `md-view`: markdown preview state and rendered HTML.
- `svg-view`: SVG source and PNG export.
- `html-view`: HTML source, preview capture, image export, and resource/image actions.
- `mermaid-view`: diagram state and PNG export.
- `board-view` and `board-editor:<id>`: board state and board-specific operations. An Excalidraw
  page uses this board facade; it no longer has a dedicated drawing-editor facade.
- `browser-view`: browser navigation, tabs, DOM queries, ref-based interaction, waits, screenshots,
  network requests, and evaluation. See [Browser, board, and window page automation](#browser-board-and-window-page-automation)
  for the shared interaction methods. DOM, wait, screenshot, and network methods accept an optional
  `{ tabId }` for a specific internal browser tab.
- `mcp-view`: MCP connection status, server metadata, request history, and copied Tools/Resources/
  Prompts panel state. `command` and `args` are read-only; the `url` setter rejects embedded
  credentials, fragments, and credential-like query parameters.
- `board-view` and `board-editor:<id>`: board identity, trust/render state, manifest, secondary
  views, busy/frame status, and `reload()` for the open board. A folder board also exposes
  `folderPath`, the claimed folder; its installed `boardRoot` is a separate value, and
  the board bridge's `getFilePath()` remains undefined for folder mode.
- `board-info`: published-board matches, install/properties state, version history, an explicit
  install-directory setter and native picker, and download cancellation. Trust and registration
  remain user actions.
- `toolset-view`: registered toolset identity, validity and errors, plus `refresh()`, `openFolder()`
  and `openLog()`.
- `tools-hub-view`: the active hub tab (`builtin`, `boards`, `search`, or `tools`) and `setTab()`.
- `mneme-config`: Mneme service, root, reindex, and model state, with refresh/restart, root-config,
  reindex, and model-update actions.
- `mneme-root`: Mneme search query, mode, tag/date filters, result state, and search/filter actions.
- `image-view`: image source, bounded inline PNG reads, PNG/original save, drawing export, and
  clipboard copy.
- `video-view`: video/audio source and playback state, playback controls, next-track and
  visualizer settings, and VLC handoff.
- `file-diff`: selected original/modified revisions, staged-state detection, and read-only state.
- `env-vars-view`: environment-variable namespaces, profiles, values, and encryption state.
- `archive-view`: archive entries, selection, entry opening, and extraction.
- `log-view`: Log View entries, non-blocking output/dialog pushes, dialog results, and timestamps.
- `category-view`: Folder View provider state, listing, category navigation, and refresh.
- `git-tree`: repository history, changes, refs, ahead/behind state, and changed-file navigation.

The `html` value on `md-view` and `html-view`, and the `svg` value on `svg-view`, are `undefined`
when their backing preview host is not mounted; use each facade's `viewMounted` property to tell
that state apart from genuinely empty content. Mermaid's `svgUrl` is different by design: `""`
means its state-backed diagram has not rendered yet or rendered with an error.

### Browser, board, and window page automation

Browser pages and board pages expose their automation methods through `page.editor`. Use
`app.window.screen` to inspect or operate Persephone's own window and its active page:

```javascript
const tree = await page.editor.snapshot({ interactive: true });
await page.editor.click({ ref: "e12" });

const appTree = await app.window.screen.snapshot({ interactive: true });
```

Snapshots return an accessibility tree with refs. Pass a ref as `{ ref: "e12" }`; a string
locator is interpreted as a CSS selector, or may use `text=` for exact quoted / substring unquoted
text matching with normalized whitespace. Quoted text is case-sensitive; unquoted text is
case-insensitive. Nested visible matches prefer the smallest element and `nth` selects within that
list. This shared locator works on app-window, browser-page, and board targets. Snapshots can be narrowed to a subtree with `root`,
filtered to actionable items with `interactive: true`, or bounded with `maxNodes` and `maxChars`.
The returned tree can omit content beyond its size budget, so use the suggested scope or interactive
view when the snapshot reports that it was truncated.

The shared methods include `click`, `hover`, `type`, `select`, `check`, `uncheck`, `clear`,
`pressKey`, `keyDown`, `keyUp`, `drag`, `fillForm`, `setInputFiles`, `evaluate`, `waitFor`,
`screenshot`, `waitForResponse`, `dialogs`, `handleDialog`, `consoleMessages`, and `pageErrors`.
Element actions accept a CSS selector or snapshot ref. Selectors matching multiple visible elements
fail with the match count; pass `{ nth }` to choose one, or use a ref. Actions check that the target
is attached, visible, stable, enabled, and receives the event. `{ force: true }` skips those checks.
Mouse and keyboard input is trusted by default. Pass `{ synthetic: true }` to supported input
methods when a page specifically requires synthetic events. `select()` operates on native select
elements programmatically; use trusted clicks and keys for custom dropdowns.

`waitFor()` accepts one selector, text, disappearing text, or time condition. Browser pages also
provide `waitForSelector()`, `waitForNavigation()`, `waitForURL()`, and `navigateAndWait()` for
navigation lifecycle and URL waits. `waitForResponse()` is available on all three surfaces; arm it
before the action that sends the request. A string matches a URL exactly, while a `RegExp` can
match query strings. It resolves when response headers arrive, or when the body finishes if
`includeBody: true`.

Browser pages provide `networkRequests({ includeBodies: true })` to opt into retained request and
response bodies. Response bodies can contain secrets, are omitted unless requested, and are available
only for requests captured after automation first used the tab and while Chromium still buffers the
body. Binary bodies are base64 encoded. `waitForResponse()` can also return an opt-in body with
`includeBody: true`. Boards and `window.screen` can wait for responses but do not expose browser
request history. See the [Browser editor guide](../../editors/browser.md) for using the browser UI.

Every facade's `$help` describes access through `page.editor` and gives its id-narrowing example.

For an image page, `page.editor.read(options?)` returns a PNG image result with applied and original
dimensions for inline MCP display. It defaults to a 2048-pixel maximum longer side, accepts a
positive-integer `maxDimension`, works for inactive pages, and does not write a file. Use
`savePngToFile(path)` when the image should be written to disk.

The browser and board facades may also expose an optional remote model at `page.editor.app`. A
trusted board publishes it with `persephone.aiVision.expose(root)`; a participating web page
publishes it with the `ai-vision` package. The model provides its own `$help`, `$describe`,
`helpSearch(...)`,
hints, writable properties, methods, `elements`, and `highlight(...)`. Board highlighting runs in
the selected owning frame, including a secondary view; browser-page kinds use the `page:` prefix
and remain confined to `.app`. User-opened private pages are rejected before probing. See the
[Boards](../../boards.md) and [Browser](../../editors/browser.md) guides for the workflows.

### Board, Tools & Editors, and Mneme facades

These pages are available through the same `page.editor` object model used by the built-in editors.
They return snapshots of live page state; optional values are absent until the corresponding data
exists. For example:

```javascript
const editor = page.editor;
if (editor.id === "board-view") {
    console.log(editor.boardName, editor.renderState, editor.busy);
    await editor.reload();
}

if (editor.id === "mneme-root") {
    editor.setMode("hybrid");
    editor.setQuery("deployment notes");
    await editor.runSearch();
    console.log(editor.results);
}
```

On a board page, `getManifest()` reads the current `board-manifest.json` and returns a copied
snapshot of the normalized values Persephone applies. For example:

```javascript
const editor = page.editor;
if (editor.id === "board-view") {
    const manifest = await editor.getManifest();
    console.log(manifest?.browserUrlMasks, manifest?.settings, manifest?.guides);
}
```

Boards acting as file editors use an id such as `board-editor:drawio` and expose the same method.

The snapshot includes the manifest's supported fields, including `browserUrlMasks`, `contentMasks`,
`singleInstance`, `settings`, `guides`, and capability `alwaysOpensNewPage`. List values and nested
declarations are copied. Manifest fields are normalized before they are returned: for example,
`permissions` are trimmed and deduplicated, URL and file masks are lowercased, and unsafe service
paths are omitted. Optional fields stay absent when the manifest does not declare them; an absent
manifest returns `undefined`.

### Board Info editor facade

An open Board Info page exposes `properties` as a copied installed-board snapshot. It includes the
same normalized manifest-backed fields where present, plus Board Info state such as `root`,
`trusted`, install status, compatibility, and registration issues. Find that page through
`app.pages.all`:

```javascript
const boardInfoPage = app.pages.all.find(candidate => candidate.editor.id === "board-info");
if (boardInfoPage?.editor.id === "board-info") {
    const properties = boardInfoPage.editor.properties;
    console.log(properties?.fileMasks, properties?.contentMasks, properties?.capabilities);
    boardInfoPage.editor.setInstallDir("C:/Demo/board-installs");
    console.log(boardInfoPage.editor.installDir);
}
```

`setInstallDir(dir)` selects an explicit download parent; `changeInstallDir()` keeps the native
folder picker. Board Info and trust UI continue to show the real, copyable filesystem path.

Arrays and capability payload schemas in this snapshot are copied. See [Boards — Inspecting board
metadata from scripts](../../boards.md#inspecting-board-metadata-from-scripts) for the normalized
field behavior.

The board and toolset actions do not accept secrets and cannot grant board trust or toolset
registration. `board-info` can prepare or cancel a download, but registering a downloaded board
still requires the user's trust-dialog click. See [Boards](../../boards.md), [Agent Tools](../../agent-tools.md),
and [Mneme](../../mneme.md) for the user workflows.

### Data editor facades

The Grid facade is shared by JSON, CSV, and JSONL pages. It exposes copied `rows` and `columns`,
`rowKeys` in the same order as `rows`, row counts, search/filter/sort/selection state, hidden
columns, and CSV options. Use `rowKeys[i]` with `rows[i]` when calling `editCell` or
`deleteRows`; row keys are not added to the row objects themselves. Also use `addRows`,
`addColumns`, `deleteColumns`, `setSearch`, and `clearSearch`; CSV pages support
`setCsvDelimiter` and `setCsvWithColumns`. Data-changing methods are caution-marked in the `call`
tree.

The `filters` property is read-only. Built-in text filters have `type: "text"`; their `value` is
`{ op, text }` for `contains`, `equals`, or `startsWith`, and `{ op }` for `blank` or `notBlank`.
Custom filter values are not prescribed and should be treated as `unknown`.

The Notebook facade exposes copied notes, categories, tags, counts, filters, expanded-note state,
and parse errors. It supports adding, removing, and updating notes, comments, categories, tags,
language, and embedded editor, as well as search and category/tag filtering. Notebook sidebar
panels are available separately through `page.panels.notebookCategories` and
`page.panels.notebookTags`.

The REST facade exposes copied request and response snapshots, including the URL, headers, body,
and response body. It can select, add, rename, move, and remove requests, change request metadata
and header/form keys, and send the selected request. It deliberately does not accept password,
token, header-value, body-value, or form-value arguments. The `.rest.json` text remains available
through `page.content`, so this facade does not claim to redact values that are already in that
text; `send()` uses the request's actual headers and body and can contact a real service.

The environment-variable facade exposes parsed namespaces, profiles, variable names and values,
plus parse/encryption state. It can select namespaces and profiles, add or remove them, and open
the existing encryption dialog without accepting or returning its password. Values are not
redacted after unlock because the plaintext is already present in the page content. The separate
`app.boardVars` service remains the value-capable store for board environment variables.

### Archive, Folder View, and Git Tree facades

The Archive facade lists copied entry metadata, opens an archive-relative entry, and extracts the
archive to a directory. Extraction writes to disk and retains the archive's path-safety checks.
The Folder View facade lists copied items, opens items or categories, reports the provider and
current selection, and refreshes the listing. The Git Tree facade reports copied commits, changes,
refs, and ahead/behind counts; it can refresh, load more history, open a changed path in File Diff,
and reveal a branch, remote branch, or tag. Git commit, checkout, stage, and push operations are
not facade methods.

All of these surfaces expose a curated `elements` inventory to the `call` tree. Each element has a
purpose and live `visible` state; `highlight(name, message?)` activates the owning page and points
at the matching control. Repeated controls may highlight more than one mounted row, and the
highlight result reports both the number found and the number drawn.

## `page.panels`

`page.panels` describes the sidebar belonging to this page. `items` lists rendered panels in order,
with each panel's `id`, `label`, owner, and `expanded` state. The node also exposes `isOpen`,
`width`, `expand(panelId)`, `toggleSidebar()`, `elements`, and `highlight(...)`. Assigning a positive
number to `width` resizes the sidebar and persists it.

Use the named child nodes when present: `explorer`, `search`, `boards`, `git`,
`notebookCategories`, `notebookTags`, `rest`, `archive`, and `fileHistory`. Explorer, Search,
Boards, and Git provide state and model-backed actions; other panels expose their live identity,
state, elements, and available close operation. A child is `undefined` when its panel is not
currently rendered.

When the Clipboard panel is present, it is available as `page.panels["clipboard"]`. The dedicated
Clipboard page can show it even when clipboard history is disabled; it exposes the generic panel
identity and its live `elements`, while the panel's visible controls handle opening, copying,
removing, and clearing stored history.

```javascript
const panels = page.panels;
console.log(panels.items.map(panel => `${panel.id}: ${panel.label}`));
if (panels.explorer) {
    console.log(await panels.explorer.listItems());
    panels.explorer.openSearch();
    await panels.explorer.expand("C:/Projects/persephone/src");
    await panels.explorer.collapse("C:/Projects/persephone/src");
}
page.panels.width = 320;
await panels.highlight("secondary-views-container", "This page's sidebar");
```

Panel access is page-scoped, so the same panel id on two pages resolves to the correct page. A
bare id can be expanded; when multiple editor instances contribute that id, use `items` and the
owner id to distinguish them.

### Video facade (`video-view`)

The video facade exposes the current source, detected `format`, `playerState`, mute state, live
media values (`duration`, `currentTime`, `paused`, `volume`, `muted`, and `playbackRate`), and
audio navigation settings. Use `submitUrl`, `play`, `pause`, `seek`, `toggleMute`, `playNext`,
`toggleShuffle`, `setVisualizerEffect`, and `openInVlc` for playback actions. `play`, `seek`,
`playNext`, and VLC handoff can affect a page that is not currently on screen.

```javascript
const player = page.editor;
if (player.id === "video-view") {
    console.log(player.playerState, player.currentTime, player.duration);
    await player.play();
}
```

### File Diff facade (`file-diff`)

The File Diff facade reports the selected `from` and `to` revisions, whether staged changes were
detected (`hasStaged`), and whether the modified side is read-only (`readOnly`). These values can
be `undefined` while the repository-backed diff is still resolving. A revision is one of
`{ kind: "unstaged" }`, `{ kind: "staged" }`, `{ kind: "head" }`, or a commit object with
`kind: "commit"`, `hash`, and `shortHash`.

```javascript
const diff = page.editor;
if (diff.id === "file-diff" && diff.to) {
    console.log(diff.from, diff.to, diff.readOnly);
}
```

## `app.pages.compare`

`app.pages.compare` describes active side-by-side compare pairs. `pairs` identifies each pair's
left and right page IDs, titles, and available file paths. `enter(pageId)` and `exit(pageId)` accept
either member of a grouped pair. Entering requires a comparable grouped pair; failed entry or exit
throws a diagnostic instead of silently doing nothing.

The node also exposes `elements` and `highlight(name, message?)` for the compare surface. Its
`compare-root` and `compare-exit` controls are scoped to the pair's left page.

```javascript
const pair = app.pages.compare.pairs[0];
if (pair) {
    app.pages.compare.enter(pair.leftPageId);
    await app.pages.compare.highlight("compare-exit");
    app.pages.compare.exit(pair.rightPageId);
}
```

## `runScript()`

Runs the page's JavaScript or TypeScript content as a script and returns its output text.

```javascript
const scriptPage = app.pages.all.find(p => p.title === "transform.js");
await scriptPage.runScript();
```
