---
title: "Boards — source opens, unsaved work and content hosts"
audience: both
summary: "Source opens and sibling context, plain board pages reporting unsaved work, content-host editors and stream-host editors with ranged pipe URLs."
---

# Boards — source opens, unsaved work and content hosts

## Source opens and sibling context

`persephone.getSourceUrl()` returns the identity of the initial source. When a custom-editor board
is opened from an Explorer folder or a Link Editor category/tag, bridge `1.37.0` also provides
`persephone.source.initialSourceContext`: a bounded snapshot with `kind`, `sourcePath`, the raw
`category` or `tag` where applicable, a display `label`, ordered non-directory `items`, and the
opened item's `index` (`-1` when it is outside the snapshot). Link items include their collection
`id`, `category`, and `tags`; folder items do not. The host filters items by the receiving board's
file masks when it declares them. Context is capped at 5,000 items and 1 MiB of serialized UTF-8.

Later opens routed to a single-instance board arrive through `persephone.source.onOpen()` and each
event carries the context captured for that particular open. Both contexts are open-time snapshots.
Only the initial one is host-restored: it lives in `sourceLink` in the page descriptor saved by
`PagesPersistenceModel.saveState()` through `appFs.saveDataFile()`. Runtime events are transient;
persist any accepted later hrefs or contexts in board-owned restorable state if they must survive a
restart. The context uses the same JSON-serialized page-state path and 1 MiB member bound described
above, separate from the board storage value limit.

```js
const initialContext = persephone.source.initialSourceContext;
persephone.source.onOpen(({ sourceUrl, context }) => {
    if (context) addQueueSources(context.items, context.index, sourceUrl);
});
```

When a matching download starts from a Tor or Incognito page, Persephone fetches the source through
that page's browser session. With bridge 1.24.0, the board receives `privateSession: true` on
`source.onOpen` for later source opens, and `source.initialSourcePrivateSession` reports the status
of the page's initial source. The Torrent Viewer board uses this information to explain that the
private session applies only to fetching the source; the torrent's tracker and peer connections are
not routed through Tor, so other peers can see your real IP. Persephone no longer shows a
torrent-specific privacy toast for this case. From Torrent Viewer 1.8.0, the network indicator in
the board's status bar can put all tracker, peer, and web-seed traffic behind a SOCKS5 proxy
instead; the board then says so in that notice.

Only trusted boards and enabled bundled boards contribute claims. Registration order is trusted
roots followed by bundled boards; an exact normalized duplicate is refused and reported as a
`browser-url-mask` registration issue, with a toast the first time it appears and an entry in Board
Info. Distinct overlapping masks remain ordered and the first matching claim wins. Trust and
bundled eligibility protect registry correctness and user disclosure; trust is not a sandbox or a
per-API permission gate, and a trusted board is a user application with the execution privileges
described above.

## Plain board pages — reporting unsaved work

A simple or stream-host board can report its own non-file draft as modified. Only the main board
frame owns this state and the optional Save handler; secondary views cannot register competing
handlers. A dirty page shows the existing tab dot and uses Persephone's Save / Don't Save / Cancel
prompt when it is closed, navigated away from, switched to another editor, or reloaded.

```js
persephone.page.setModified(true);
const offSave = persephone.onSaveRequest(async () => {
    await saveDraft();
    persephone.page.setModified(false);
});
// Call offSave() when this view no longer owns the save action.
```

`onSaveRequest()` handlers may return `false` to keep the page open; a rejected promise, missing
handler, or handler that does not finish within 30 seconds also keeps it open and reports the error.
The latest active registration wins. Persephone clears modified state after a successful release
Save; a board can clear it after a manual save with `page.setModified(false)`. Use this API for a
board-owned draft such as settings or a custom theme. It needs no manifest permission because it
only affects that board page. The API ships with bridge **1.35.0** and does not require another
version bump.

`persephone.onDiscardRequest(handler)` runs when the user chooses **Don't Save**, before the frame is
torn down (best effort, 3 seconds); use it to delete a draft the board keeps in `persephone.pageState`
for app restarts, or the reloaded board would restore the discarded work. It returns an unsubscribe
function and takes effect only while an `onSaveRequest` handler is registered.

Window/app close does not prompt. Persist non-file drafts in board-local storage and call
`page.setModified(true)` again after restoring a draft. For example, a Theme Editor should save and
apply its theme in the registered handler, and clear modified only after both operations succeed.

This differs from a **content-host** editor: Persephone owns that file's pipe, auto-save cache,
dirty state and file-save prompt. Use `persephone.host.setContent()` and `persephone.host.save()`
for that file rather than the plain-board draft API.

## Content-host editors — sharing Persephone's file with the board

Set `"editorKind": "content-host"` and Persephone builds the board **with the same file-handling machinery every built-in editor uses** — the content pipe, encoding detection, encryption, the auto-save cache, and dirty/unsaved-changes tracking (the tab's unsaved dot, the "Save changes?" prompt). The board never touches the disk directly; it works through a bridge instead:

```js
// Render the current content, and re-render whenever it changes externally
render(await persephone.host.getContent());
persephone.host.onContentChange((content) => render(content));

// Write a change back — marks the file modified and schedules the auto-save cache
persephone.host.setContent(newContent);

// Optional: the Monaco language id of the current content (e.g. "xml", "json")
const language = await persephone.host.getLanguage();
```

`persephone.host` is only meaningful on a content-host board — on a **simple** board, `getContent()`/`getLanguage()` reject (instead of hanging forever) and `onContentChange()` simply never fires, so feature-detect if your board needs to support either kind.

Three things a content-host board can do that a simple board cannot:

- **Works beyond local files.** It can open a file served over `https://`, an entry inside an archive, or an **encrypted** file — none of which a simple board supports.
- **Shares content live with other editors.** Switching from a content-host board to the Text Editor (or Grid) and back hands over the same live content, with no reload and no data loss. Edit the raw text in Monaco, switch back and the board re-renders from the edit; edit in the board and switch to Monaco to see it reflected there.
- **Works on an untitled page.** Create a new page and rename its tab to a name matching the board's `fileMasks` (e.g. `diagram.drawio`) — the board appears in the switch control right away, even though the page has never been saved to disk. Switch to the board and back without losing anything. A simple board can't do this: it reads and writes the file path directly, so it needs a file that already exists on disk.

**Same chrome as the built-in editor it replaces.** A content-host board's editor-switch control offers the exact same options its file's built-in editor would — including **Text Editor** (Monaco) even when the file's natural built-in viewer is something else (for example, a board for `*.drawio` files shows `Text Editor | Drawio`, matching what a built-in viewer for that file type would show). The board also gets the same footer row a built-in text editor shows: a **script** toggle that opens the [Script Panel](../scripting/index.md#script-panel) to run a script against the file's content, and the file's encoding with a provider icon (local file, HTTP, or Mneme).

**Footer status text:** any board can put its own text in its footer bar — call `persephone.setStatusText(text)` with any string, e.g. a **Todo board** (a published board that replaces Persephone's former built-in Todo editor — see [What's New](../whats-new.md)) showing its `"12 items"` count. Call it from the board's main view; pass `""` to clear it. A **simple** board has the footer too (without the script toggle and encoding). The text clears when its frame reloads, its grants change, or it loses trust; set it again from the main frame after it starts. Guard the call with `persephone.setStatusText?.(…)` if the same board also targets older Persephone builds.

**Footer status-bar items:** boards that require bridge version `1.27.0` can also use
`persephone.statusBar.set()` to add transient text labels and buttons beside the footer indicators.
Items can be updated by id, hidden for later reuse, and aligned to the end of the board contribution
area. With bridge `1.42.0`, a text item can set `variant: "chip"` to appear as a compact bordered
pill instead of plain text. The legacy `setStatusText()` label remains in its existing position.
Items clear when their frame reloads, the board's grants change, or the board loses trust; the
active main frame can declare them again after it starts.

**Page-toolbar text:** a trusted or bundled board's main view can call
`persephone.toolbar.setText(text)` to replace the wide middle label in the page toolbar. This is
separate from the content-host footer status: it works for plain and content-host boards and is
transient and non-persistent. **The slot starts empty**: it used to show the board's folder path
when no board had claimed it, which spent the toolbar's whole flexible span on something the user
had just chosen and could not act on. So `persephone.toolbar.setText("")` now clears the slot
rather than restoring that path. The label remains non-interactive, and while a board's text is
shown its native tooltip carries the full path. Reloading, navigating away, a frame error, or
losing trust or changing the board's grants clears the text; the newly mounted frame must set it
again. It is safe to call
`setText()` (and `toolbar.set()` / `update()`) from top-level script code: calls made while the
page is still loading are held and applied, in order, once it has loaded.

**Saving:** press **Ctrl+S** (or **Cmd+S**) anywhere in the board and Persephone saves the file through the pipe automatically — no board code required. A board that wants to handle the keystroke itself can call `event.preventDefault()` in its own key handler to opt out, in which case the automatic save stands down. `persephone.host.save()` is also available if you want to trigger a save from your own UI (e.g. a Save button).

**Example:** the DrawIO diagram viewer board renders a `.drawio` file's XML read via `persephone.host.getContent()`, and re-renders whenever `onContentChange()` fires. Switch to the Text Editor to hand-edit the raw XML — switching back to the board re-renders the diagram from your edits immediately — and Ctrl+S saves through the pipe with no board code at all.

## Stream-host editors — ranged pipe URLs without a materialized file

Set `"editorKind": "stream-host"` when the board needs binary or media access without receiving
text or a local cache path. Persephone owns the pipe and gives the board an origin-local URL:

```js
const url = await persephone.host.streamUrl();
const response = await fetch(url, { headers: { Range: "bytes=0-1048575" } });
console.log(response.status, response.headers.get("Content-Range"));
```

`streamUrl()` is available to both `stream-host` and `content-host` pages and returns
`board://<host>/__pipe/<pageId>`, which supports `Range`. A stream-host page does not write its
source to disk. This is a broker policy, not an OS guarantee: memory may be paged and Chromium may
keep its own caches. `editorSources: "any"` solves the same non-local problem by copying the source
into a cache file and returning that local path from `getFilePath()`.

The pipe can range-read platform providers, and a board provider that implements `readRange`
receives bounded ranged pulls without a whole-resource `readBinary()` first. A provider that omits
`readRange` keeps the buffered `readBinary()` fallback and its 256 MiB ceiling. Content reads have
no platform deadline; cancellation, including page teardown or a superseded request, releases the
outstanding operation.

---
