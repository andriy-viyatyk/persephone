---
title: "Page API"
audience: "user"
summary: "How do scripts read page state, navigate page history, switch editors, and run page scripts?"
---

# Page API
`page` is the active work tab. `app.pages.activePage` and `app.pages.all` expose the same page
objects. Showing a right-pinned page in a popover does not change `page` or `activePage`; use
`app.pages.popoverPage` to access that page. The page API is structural: the current editor is
available as `page.editor`, and editor switching is available as `page.editorSwitches`.

## Page properties

| Property | Description |
|---|---|
| `id`, `title`, `filePath`, `modified`, `pinned`, `pinSide` | Page and tab metadata; `pinned` is true for left-pinned tabs, while `pinSide` is `"left"`, `"right"`, or `undefined` |
| `workspaceFolder` | The project folder at the root of this page's Explorer, or `undefined` without a folder Explorer or while browsing an archive |
| `content` | Read or assign text content for text-based editors |
| `language` | Read or assign the language id |
| `ready` | Promise for the page's current content-restore attempt |
| `pipe` | Current primary content pipe, when this page has one |
| `editor` | Read-only current editor facade; narrow on `editor.id` |
| `editorSwitches` | Current id, toolbar-identical options, and `switchTo(id)` |
| `history` | This page's Back and Forward stacks and navigation methods |
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

## Save the page

`page.save()` saves the current main editor's content host and returns `true` when saved or `false`
when Save As is cancelled. On an untitled page it opens the Save As dialog; the call returns dialog
attention while it waits for the user's choice. A page without a content host throws a clear error.

```javascript
const saved = await page.save();
```

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
rate. Status is not persisted. See the [`io` pipe status reference](io-pipes-and-helpers.md#icontentpipe).

```javascript
const pipe = page.pipe;
if (pipe) {
    console.log(pipe.stages, pipe.summary);
    const unsubscribe = pipe.onStatusChange(() => console.log(pipe.summary));
    // Call unsubscribe when observation is no longer needed.
}
```

## `page.history`

Each page has its own Back and Forward stacks. `entries.back` and `entries.forward` are fresh copies,
oldest first; the last entry is the next destination. Each entry exposes `title`, `filePath` (a
logical local path or virtual URL), and `target` (editor id). Replay metadata is not exposed.

```javascript
console.log(page.history.entries);
const moved = await page.history.back();
console.log(moved); // true only when navigation committed; false for a normal no-op
```

`back()` and `forward()` return `true` for a committed move and `false` for a normal no-op, including
an empty or busy stack, a cancelled save prompt, or an intercepted request. Actual navigation
errors reject. Browser pages report page-model history here; their webview history is separate and
is not controlled by these methods. The Markdown facade's `page.editor.navigateBack()` remains as a
compatibility alias and discards the boolean result; prefer `page.history.back()`.

## `page.tab`

`page.tab` describes this page's tab-strip presentation. It exposes `title`, `modified`,
`pinned`, `pinSide`, `active`, and `soundIndicator`, plus the tab's curated `elements` and
`highlight(name, message?)` helper. `active` also includes the grouped partner shown beside the
active page. Reading or highlighting the tab does not activate the page.

```javascript
console.log(page.tab.title, page.tab.active, page.tab.modified);
await page.tab.highlight("page-tab");
```

The operation-bearing ids are `monaco`, `grid-json`, `grid-csv`, `grid-jsonl`,
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
`page.editor.id`. If the call returns without switching, it throws a diagnostic that
the release prompt may have been declined or the page may have no file to rebuild over. Unknown
ids preserve the registry's existing rejection. The page toolbar is available as
`page.editorSwitches.elements` with the `page-editor-switch` declaration.


## `page.panels`

`page.panels` describes the sidebar belonging to this page. `items` lists rendered panels in order,
with each panel's `id`, `label`, owner, and `expanded` state. The node also exposes `isOpen`,
`width`, `expand(panelId)`, `toggleSidebar()`, `elements`, and `highlight(...)`. Assigning a positive
number to `width` resizes the sidebar and persists it.

Use the named child nodes when present: `explorer`, `search`, `boards`, `git`,
`rest`, `archive`, and `fileHistory`. Explorer, Search,
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

The video facade exposes the current source, detected `format`, `playerState`, page mute state, and
live media values (`duration`, `currentTime`, `paused`, `volume`, `muted`, and `playbackRate`). Use
`submitUrl`, `play`, `pause`, `seek`, `toggleMute`, and `openInVlc` for playback actions. `play`,
`seek`, and VLC handoff can affect a page that is not currently on screen. Audio uses the same native
media controls for play/pause, seek, and volume.

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

## Read next

| What you need | Page (object-model path) |
|---|---|
| Editor facades | [page-editor-facades](page-editor-facades.md) - `guides.scripting.api["page-editor-facades"]` |
