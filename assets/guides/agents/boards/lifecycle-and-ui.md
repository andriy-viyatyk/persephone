---
title: "Boards — unsaved changes, tab mute and secondary views"
audience: agent
summary: "Unsaved-changes handling for plain boards, the tab mute button, and secondary views with shared state."
---

# Boards — unsaved changes, tab mute and secondary views

## Unsaved changes on plain boards

Simple and stream-host boards can report a board-owned draft through the main frame only:

```js
persephone.page.setModified(true);
const offSave = persephone.onSaveRequest(async () => {
  await saveDraft();
  persephone.page.setModified(false);
});
```

`persephone.page.setModified(modified: boolean)` updates the page's existing modified state, which
agents can inspect through `pages[i].modified`. `persephone.onSaveRequest(handler)` registers an
async Save action and returns an unsubscribe function. The latest active registration wins. A
handler resolving `false`, rejecting, missing, or exceeding the 30-second timeout leaves the page
open and reports an error. Persephone clears dirty state after a successful release Save; a board
can clear it after a manual save. Secondary frames cannot own this state or handler.

`persephone.onDiscardRequest(handler)` runs when the user chooses **Don't Save**, before the frame is
torn down (best effort, 3 seconds); use it to delete a draft the board keeps in `persephone.pageState`
for app restarts, or the reloaded board would restore the discarded work. It returns an unsubscribe
function and takes effect only while an `onSaveRequest` handler is registered.

Closing, navigating away, switching editors, and reloading a dirty board prompts with Save / Don't
Save / Cancel. A failed Save or Cancel keeps the page open. A reload may return a pending attention
result while the prompt is open; answer it through `dialogs[0].click("Save")`,
`dialogs[0].click("Don't Save")`, or `dialogs[0].click("Cancel")`, then inspect the page and frame
state instead of replaying the reload. Direct facade callers receive a cancelled result when Cancel
is chosen. `pages[i].editor.reload()` carries the caution `unsaved changes prompt the user`.

Window/app close does not prompt. Store non-file drafts in board-local storage and report modified
again after recovering a draft on restore. This API ships with bridge 1.35.0 and needs no new
manifest permission. Content-host boards continue to use `persephone.host.*` for Persephone-owned
file content and file saving.

- `persephone.host.*` — for a **content-host** or **stream-host** editor board (`"editorKind":
  "content-host"` or `"stream-host"` in the
  manifest) Persephone owns the file (pipe, encoding, encryption, auto-save, dirty tracking) and the
  board works with the content instead of a path: `host.getContent()` → `Promise<string>`,
  `host.setContent(content)` (marks modified; a `getContent()` right after returns the written value),
  `host.onContentChange(cb)` (fires on external edits — e.g. the user switched to Monaco and back —
  never for your own `setContent`), `host.getLanguage()`, `host.save()`. All of `host.*` is safe to
  call at any time, first thing in your script included (it awaits the handshake internally). `Ctrl+S`
  saves automatically (no board code). The board and Monaco share one host, so they switch back and
  forth on the same file with no reload. On a plain board `getContent`/`getLanguage` reject and a
  registered `onContentChange` never fires.
- `persephone.setStatusText(text)` — set the text shown in the board's footer bar (the status
  bar that also shows the pipe status, and for a content-host board the provider/encoding), e.g. a
  Todo board's `"12 items"` count. Call it from the board's **main** view; `""` clears it. Every
  board has the footer; on builds before 5.0.4 only content-host boards did, so guard with
  `persephone.setStatusText?.(…)` if the board must also run on older app builds.
- `persephone.toolbar.setText(text)` — set transient text in the wide middle slot of the page
  toolbar from the board's **main** view. **The slot is empty unless your board fills it** — it
  no longer falls back to the board path — so `""` and an unset value both leave it blank. While
  your text is visible, the slot's native tooltip carries the board's full path. Breadcrumbs hide
  the slot while retaining its text and tooltip until they are removed. The value is not persisted
  and is cleared when the main frame reloads, errors, is disposed, loses trust, or the board is
  navigated away from; a newly mounted frame must set it again.

  `persephone.host.streamUrl()` is available to both kinds and returns the origin-local
  `board://<host>/__pipe/<pageId>` URL. Fetch it with a `Range` header to read the pipe without
  text or a materialized file. That no-write behavior is a broker policy, not an OS guarantee:
  memory may be paged and Chromium may keep caches. By contrast, `editorSources: "any"` copies
  non-local input into a cache file and returns its local path. Board-provider ranges still fall
  back to buffered `readBinary()` when the provider omits `readRange`; a provider that implements
  it receives bounded range requests instead. For any link, including one unrelated to the page's
  current file, use `persephone.content.open()` above; `host.streamUrl()` remains the page-pipe API
  for content-host and stream-host boards.

**Clipboard:** use `persephone.clipboard.writeImage(data)` for encoded image bytes (`Uint8Array` or
`ArrayBuffer`) or `persephone.clipboard.writeText(text)` for text. These methods write through
Electron's native clipboard and do not require the board document to be focused. A click on
Persephone's own toolbar can leave the board frame unfocused, in which case
`navigator.clipboard.write*` rejects with `"Document is not focused"`; the Web Clipboard API is
still suitable when the board document is focused and the browser gesture requirements are met.

**File icons:** `await persephone.icons.forFiles(names)` returns `{ [name]: dataUrl }` — the icon
Persephone uses for each supplied name, as a `data:` URL for `<img src>`. Only the name matters;
the file need not exist. Since a name-only lookup has no folder path, it does not use icons from
boards with non-empty `folderMasks`. Local file rows with a full path can use a scoped board icon
when the file is inside a matching folder. The **Open with** menu offers boards based on matching
`fileMasks` even when their `folderMasks` do not match; folder scope still determines the default
editor. The shim caches per name, so a re-render does not round-trip. Single-colour
icons are drawn in the current theme's icon colour: request again from `persephone.onThemeChange`
(the shim drops its cache on a theme change). Bridge 1.18.0.
The CSP blocks remote requests made directly from the board frame; use `persephone.fetch()` for
intentional remote HTTP requests, with `network: "internet"` for public services or `network: "full"`
for local/LAN access.

## Tab mute button

A board that plays sound can show the page tab's mute button, like the built-in Video Player
(bridge `1.38.0`, main frame only):

```js
persephone.page.setMuted(audio.muted);              // show the button in the board's state
persephone.page.onMuteToggle(() => {                 // the user clicked it
  audio.muted = !audio.muted;
});
audio.addEventListener("volumechange", () => persephone.page.setMuted(audio.muted));
```

`persephone.page.setMuted(muted: boolean | null)` shows the button as muted or unmuted; `null`
removes it. Persephone only draws the state the board reports: a click calls the
`onMuteToggle(callback)` handlers (which returns an unsubscribe function), and the board flips its
own mute and reports the new state. Report every change, including ones from the board's own
controls, so the tab and the board always agree. The button goes away with the frame on reload.

## Secondary views & shared state

A board can contribute **secondary views** — extra sidebar panels, each its own `board://`
iframe over the *same board*. All frames (main + secondaries) share one Persephone-owned state
object, so they stay synchronized — the plumbing for editor-style boards (a main view + a
coordinated sidebar).

- **Declare** in `board-manifest.json`: `"secondaryViews": [{ "id": "lists", "title": "Lists" },
  { "id": "detail", "html": "detail.html", "title": "Detail" }]`. `id` has no `::`; `html`
  defaults to `index.html` (one file — branch on `persephone.view`) or names a dedicated file;
  `title` labels the panel (the icon is the board's own). Or replace at runtime from any frame
  with `persephone.setSecondaryViews([...])` (`[]` clears). Navigating the main view away
  disposes the board — panels don't keep it alive.
- **`persephone.view`** — `"main"` or the view's `id`, known synchronously at load; branch on
  it to serve every view from one HTML file.
- **`persephone.state.*`** (every frame): `init(defaults, { restorableKeys })`, `get()` (Promise,
  first-snapshot-then-cached), `set(obj)`, `merge(partial)`, `onChange(cb) → off`. A change in
  one frame is seen in all; `onChange` is authoritative (writes round-trip, React-`setState`-
  style). **Opt-in persistence** — only `restorableKeys` survive restart/reload; everything else
  is in-memory.

```js
persephone.state.init({ selectedId: null }, { restorableKeys: ["selectedId"] }); // main view
persephone.state.onChange((s) => highlight(s.selectedId));
// a sidebar view writes: persephone.state.merge({ selectedId: id })
```

- **Inspect a secondary view** with `pages[pageId].editor.switchTab("board-secondary:<viewId>")` — see
  [Inspecting secondary views](testing.md#inspecting-secondary-views) under "Test it".
