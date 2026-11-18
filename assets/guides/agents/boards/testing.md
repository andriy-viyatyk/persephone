---
title: "Boards — test it, errors and the demo board"
audience: agent
summary: "Test a board through pages[i].editor, inspect secondary views, integration recipes, error log and verification, and the bundled Demo board."
---

# Boards — test it, errors and the demo board

## Test it

Once the board is open, drive it through `pages[pageId].editor`. `boards.openBoard(root)` resolves
with no value. After it resolves, read `pages.activePage.id` or find the page whose editor has the
matching `boardRoot`:

```
call at `pages`                  → pick the entry with editor: "board-view" → its pageId
pages[pageId].editor.snapshot()  → read the UI
pages[pageId].editor.click({ ref: "e12" }) / .type(...) / .evaluate(...)  → interact
```

- `pages` → find the board (`editor: "board-view"`) and read its `pageId`. If several
  `board-view` pages exist, match the one you opened by its `boardRoot` / `selectedBoard`.
- `pages[pageId].editor.snapshot()` → read the accessibility tree (element refs). **Always use the
  board's page id** — board pages are not browser tabs.
- `click`, `type`, `pressKey`, and `evaluate` on that editor → interact using refs from the
  snapshot. Pass `{ ref: "e12" }` explicitly; a plain string is a CSS selector.
- Mouse and keyboard actions use trusted input and check visibility, enabled state, stability, and
  hit-testing before dispatch. Use `{ nth }` to disambiguate matching selectors, or `{ force: true }`
  to skip actionability checks. Arm `waitForResponse()` before an action that sends the request.
- String locators also accept `text=`: quoted text is exact and case-sensitive after whitespace
  normalization; unquoted text is a case-insensitive substring. Nested visible matches prefer the
  smallest element, and `{ nth }` selects within those matches. The same behavior applies to
  browser pages and `window.screen`.
- **Verify UI visually.** The accessibility snapshot includes elements that are invisible on
  screen (zero-height, overridden `display`), so it can look right while the render is broken.
  After UI changes, check `pages[pageId].editor.screenshot()` before declaring the UI correct.

Board automation waits, with a timeout, for a frame that is still loading. You can call
`snapshot()`, `evaluate()`, and the other frame methods after opening a board or while it reloads;
if a reload replaces the frame during a call, Persephone retries that call on the new frame.
`pages[pageId].editor.reload()` also works while the frame is loading or another reload is in
progress. Its result's `frameReady` is true once the main frame has loaded. A board's optional
`.app` model can register slightly later, so after `frameReady` becomes true, poll
`pages[pageId].editor.app` until it is available before reading its members.

### Testing a published board with a sample file

The repository's published-viewer tests live in
`integration-test/tests/published-boards/<board-id>/`. Their shared `openPublishedSample(ctx,
boardId, sampleRel)` helper registers a local board checkout, opens a synthetic fixture with the
app's normal file-open path, activates the page, and waits for `frameReady`. The returned
`{ id, editor, root, file }` contains the page id and an editor stand-in; use the stand-in to drive
the board just as above. Wait for `editor.app` separately when a test uses the board's app model:
the frame can be ready before that model has registered.

Close the page and unregister the board in a `finally` block with
`closePublishedSample(ctx, handle)`. Mark each test with
`requires: ["launch", "published-board-checkout"]`: it needs an owned app and the separate
`persephone-boards` checkout. Board processes stop asynchronously after `closePage`, so allow a
short delay before assuming files held by a board process have been released. Keep samples under
`integration-test/fixtures/boards-samples/<board-id>/`; make them synthetic, minimal, deterministic,
and offline-safe. Do not open the torrent viewer in this suite: its current open path starts DHT
discovery.

A board never navigates, so it has no navigation members and cannot add or close frames. Its
`tabs` and `switchTab("board-secondary:<viewId>")` members select which board frame to drive
(see next).

For a declared service, run the normal Service-tab request first, then inspect
`boards.list()` for the matching `service` payload. Use the public host calls
`app.boards.requestService(root, { op: "echo", value: "no-page" })`,
`app.boards.startService(root)`, and `app.boards.stopService(root)` for no-page requests and
lifecycle control. The Demo fixture's service request
operations are `echo`, `storage-get`, `storage-set`, `storage-delete`, `storage-keys`, `delay`,
`crash`, and `arm-handshake-hang`; the last mode is consumed and deleted by the service before it
withholds `ready`, so verification must wait for the following normal retry and confirm echo works.

### Inspecting secondary views

By default every editor call targets the board's **main** frame. To inspect a
[secondary view](lifecycle-and-ui.md#secondary-views--shared-state) (a sidebar panel — its own `board://` frame),
read `pages[pageId].editor.tabs` and select it with
`pages[pageId].editor.switchTab("board-secondary:<viewId>")`; Persephone treats the board's frames
as "tabs":

```
pages[pageId].editor.tabs
  → [ { id: "main", … },
      { id: "board-secondary:<viewId>", title: "<panel title>", … }, … ]
pages[pageId].editor.switchTab("board-secondary:<viewId>") → make that frame the active target
pages[pageId].editor.snapshot()                            → now reads THAT frame's DOM
pages[pageId].editor.click/type/screenshot()               → drive that frame
```

- `list` returns the main view (`index: 0`, id `"main"`) plus one entry per declared secondary
  view (id `board-secondary:<viewId>`, `title` = the panel title).
- `switchTab` points subsequent editor calls at that frame until you select another.
  **Persephone auto-opens the view's sidebar panel and waits for its frame to render**, so the
  next command always succeeds — you never get a "frame not mounted" error, even if the panel
  was closed. `select { index: 0 }` returns to the main view.
- A screenshot of a selected secondary view is clipped to its sidebar panel.
- All frames of one board share `persephone.state.*`, so a change you make in one frame is
  visible when you snapshot another.

## Integration recipes (persephone-boards `how-to/`)

Common **integration cases** — wiring a board into a Persephone feature via the `persephone.*`
bridge — are written up as short, code-first recipes in the boards repo. When you need to open
something in the app, drive a built-in editor, or otherwise integrate, **check there first** —
the plumbing has usually been solved once already:

**<https://github.com/andriy-viyatyk/persephone-boards/tree/main/how-to>**

Example: *Open an image in the Drawing (Excalidraw) editor* documents the
`openRawLink(imageDataUrl, { editor: "image.edit" })` case above (data-URL-only, opens a new
untitled drawing, PNG-over-SVG). Add a new recipe there when you solve a fresh integration case.

## Errors & verification

The debugging surfaces, in the order to check them:

- **Rejected frame requests** may expose a stable `error.code` in addition to `error.message`. Check
  the code when handling host rejections; requests made after trust is revoked reject immediately
  with `code === "untrusted"` instead of waiting for a timeout.

- **`ui.log`** is the board's black box: ordinary boards keep it in the board folder; bundled
  boards keep it at `<userData>/board-logs/<id>/ui.log`. All entries, including
  service stdout/stderr, are written through the main-process `src/main/board-log.ts`. Each
  main-frame load appends a `----- board loaded -----` separator, preserving history across reloads.
  The log is bounded at 256 KiB and trims toward its last ~128 KiB on overflow. It contains load
  failures, CSP violations, uncaught errors, unhandled rejections, and every `console.error`/
  `console.warn` from the board's frames. Read it first when a board renders blank or a
  feature silently does nothing.
- **`pages[pageId].editor.reload()` returning `frameReady: false`** means the reloaded frame never signalled
  load — almost always broken board HTML/JS; `ui.log` has the reason.
- **A silently-dead feature after adding a library** is usually the CSP: remote
  `<script>`/`<link>`/`fetch` are blocked without a visible error in the UI — but the violation
  is in `ui.log`. Vendor the file locally (see "Libraries & assets").
- **Snapshot vs screenshot**: `snapshot()` includes invisible elements, so verify visual changes
  with `screenshot()` before declaring the UI correct.
- **`boards.openBoard` / `boards.createBoard` failures** return real errors (`Not a board: …` — missing
  `board-manifest.json`; name collision on create). `boards.openBoard` resolves with no value
  once its tab is open and active — read `pages.activePage.id` and use it for `pages[pageId].editor`; boards are never
  reached by the untargeted browser-page fallback unless they are the active page.
- **Manifest edits don't apply on refresh** — `fileMasks`/`folderMasks`/`folderEditorMasks`/
  `editorPriority`/`folderEditorPriority`/`editorSources` are
  cached from trust time; toggle trust or restart the app (see "Manifest, icon, reload").
- **`getJson()` rejections** carry `exitCode` + captured `stderr` from the backend script —
  surface them in the board UI rather than leaving a blank panel.

## Richer reference — the bundled Demo board

Persephone ships a full **Demo board** that exercises the whole surface (buffered/streaming/
stdin/kill/cwd `execute()`, the integration tier, the declared supervised `service.mjs` with
shared storage and lifecycle failure controls, the `--p-*` theme + token contract, secondary
views + shared state via `persephone.state.*`, a tabbed layout with a pinned output console).
For a richer example than the blank template, create one with `boards.createDemoBoard(name,
dir)` and read its files, or read the source under the install's `resources/assets/demo-board/`
(`index.html`, `app.js`, `style.css`, `board-base.css`).
