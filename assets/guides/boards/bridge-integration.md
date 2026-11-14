---
title: "Boards — the bridge: integration methods"
audience: both
summary: "Integration methods boards use to open pages, content and files, persephone.openContent, persephone.call and persephone.themes."
---

# Boards — the bridge: integration methods

## Integration methods

These handle in-app effects that `execute()` cannot express:

| Method | Description |
|--------|-------------|
| `persephone.notify(message, type, options?)` | Show a toast. `type`: `"info"`, `"success"`, `"warning"`, or `"error"`. Info, success and warning toasts close after a few seconds; `{ persistent: true }` (bridge 1.33.0) keeps the toast until you close it. Errors and warnings are also appended to `ui.log`. |
| `persephone.clipboard.writeText(text)` | Write text to the OS clipboard. Useful for board actions triggered from Persephone's own toolbar, where the board page may not be focused. |
| `persephone.clipboard.writeImage(data)` | Write encoded image bytes (`Uint8Array` or `ArrayBuffer`) to the OS clipboard. |
| `persephone.icons.forFiles(names)` | Get the icon Persephone shows for each file name, as `{ [name]: dataUrl }` for `<img src>`, so a board's file list can match the Explorer. The file does not need to exist. Single-colour icons follow the current theme; request again after `persephone.onThemeChange` fires. |
| `persephone.openRawLink(href, options?)` | Open a file or URL in Persephone. Main accepts absolute local paths (`path.isAbsolute` under Windows, including `/docs/x.md` and `\docs\x.md`), `file:`, `http:`, `https:`, `mailto:`, `data:image/png;base64,`, and `torrent:` links; relative paths and other schemes are rejected. Pass `{ editor }` (e.g. `{ editor: "md-view" }`) to request a specific editor — for example, render a Markdown doc instead of opening its source; falls back to the default editor when omitted. `{ inPlace: true }` (bridge 1.57.0) navigates content in the page hosting this board without requiring `appScripting`; it cannot be combined with `reuseKey`. Normal save/discard/cancel prompts apply, and successful navigation can dispose the calling board frame before its promise settles. Declare `minBridgeVersion: "1.57.0"` when using `inPlace`. |
| `persephone.openBoard(folder)` | Open a board folder this board can list; relative paths resolve from the caller board root. Requires list-equivalent `fileSystem` access. The target board uses its normal trust and permission-change dialogs; folder access does not grant target trust. Added in bridge 1.48.0; declare `minBridgeVersion: "1.48.0"`. |
| `persephone.openContent(options)` | Create a new in-memory page in another content-host editor and return its page id. Use this for content held by the board rather than a file or URL. |
| `persephone.openFileDialog(params?)` | Show a native Open File dialog; returns the selected path. |
| `persephone.saveFileDialog(params?)` | Show a native Save File dialog; returns the chosen path. |
| `persephone.openFolderDialog(params?)` | Show a native Open Folder dialog; returns the selected path. |
| `persephone.listFolder(path, options?)` | List at most 1,000 entries per page (`limit`, `nextCursor`, `truncated`). Non-recursive by default; `recursive: true`, `masks: ["*.mp3"]` (basename `*` / `?` masks) are supported. |
| `persephone.rememberFolder(path)` | Ask the user to persist read/list access to a folder picked by this board. The grant is read-only and individually revocable in Board Info. |
| `persephone.rememberFile(path)` | Ask the user to persist read/write access to one exact plain local file picked by this board, or delivered to it as its initial/runtime source. Source-context items are not eligible. It does not grant its parent or siblings; individually revocable in Board Info. |
| `persephone.getFileAccess(path)` | Return `{ read, write }` for current authorization without prompting or changing grants. Useful at startup to check whether a remembered catalog is writable; `rememberFile()` may prompt. |
| `persephone.watch(path, callback, options?)` | Watch an authorized file or folder and receive `PathWatchBatch` updates; returns a Promise for an idempotent disposer. |
| `persephone.readFile(path, options?)` | Read a file and return its contents (Promise). A relative `path` resolves against the board folder; absolute reads anywhere. Text by default; `{ encoding: "binary" }` returns a `Uint8Array` (the right choice for binary files — app 4.0.21+), `{ encoding: "base64" }` a base64 string. |
| `persephone.writeFile(path, data, options?)` | Write a file (Promise); creates parent folders. A relative `path` resolves against the board folder. Text by default; `{ encoding: "binary" }` takes a `Uint8Array`, `{ encoding: "base64" }` a base64 string. |
| `persephone.trashFile(path)` | Move an authorized regular file to the OS Recycle Bin so it can be restored. Requires write access; folders are rejected. Added in board bridge `1.41.0`. |
| `persephone.registerTypeScriptProject(root)` / `unregisterTypeScriptProject(root)` | Give Monaco pages editing `.ts`/`.tsx` files under a folder with a `tsconfig.json` project IntelliSense (relative imports, sibling files, project `.d.ts`, and typed JSON default imports when `resolveJsonModule` is enabled). Authorized like `listFolder`; lazy; released when the board closes or reloads, so register on every board load. Compiler options are not applied. Added in board bridge `1.47.0`. |

The three native dialog methods require a board `fileSystem` grant. Without it, they reject with
`permission-denied`; the existing grant explanation remains in the error message.

`persephone.watch(path, callback, options?)` accepts `{ recursive?: boolean, debounceMs?: number }`; it watches the target folder's immediate entries by default, or descendants with `recursive: true`. Debounce defaults to 300 ms and accepts integers from 50 through 60000. Each callback receives `{ changes: [{ path, type }], rescan?, ended? }`; paths are absolute canonical paths and types are `created`, `changed`, or `deleted`. `rescan: true` means reload the watched scope; `ended` is `removed`, `error`, or `revoked`, after which the subscription is closed. The Promise resolves to an idempotent disposer. Folder watches use list permission and emit only that canonical folder or descendants; file watches use read permission and emit only that exact file. `fileSystem: false` may watch only the exact hosted document. Watches add no permission, end when the board port closes or access is revoked, and are limited to 64 per board. Errors use `invalid-argument`, `permission-denied`, `not-found`, or `too-many-watches`. A missing exact-file target returns `not-found` in v1; watch its containing folder to wait for a file to appear.

With `fileSystem: "board"`, listing is limited to the board folder, folders picked in the current
session, and folders the user explicitly remembered. `rememberFile()` adds read/write access to one
exact file picked by this board or delivered as its initial/runtime source. Source-context items are
not eligible, and the grant never includes the file's parent or siblings. Listing is capped at
100,000 entries, recursion depth 32, and cursors expire after
five minutes. Symlinks and junctions are skipped. Listing errors use stable codes including
`permission-denied`, `invalid-argument`, `not-found`, `not-directory`, `too-many-entries`,
`depth-limit`, `cursor-expired`, and `io-error`. A cursor from a disposed, replaced, or different
board-port connection returns `invalid-argument: The folder cursor is invalid.`; checking it from
another connection does not consume the cursor.

Persephone also gives a board session read access to the exact local source files it delivers: the
initial document, later `source.onOpen()` URLs, and local files in a delivered source context. This
access is read-only and ends when Persephone restarts. A `fileSystem: false` board receives only the
initial and later source files themselves, not context siblings; `content.open()` does not widen
the scope of the delivered files.

## `persephone.openContent(options)`

Use `openContent` when the board has generated content in memory — for example, a Markdown
summary, an extracted graph, or a table — and wants to show it in a new Persephone page:

```js
const pageId = await persephone.openContent({
    editor: "md-view",
    language: "markdown",
    title: "Node report",
    content: markdown,
});
```

`editor` is a registered content-host editor such as `"monaco"`, `"grid-json"`, `"md-view"`,
`"mermaid-view"`, or another registered content-host editor. `language` defaults to `"plaintext"` and `title` to
`"untitled"`. The call creates the page and returns its id; it does not provide a way for the
board to read, navigate, close, or modify other pages. It rejects for an unknown editor or
language, a standalone editor, another board, or content over 16 million characters, so handle
the returned Promise.

The bundled Excalidraw board is a content-host board. Opening an image, SVG, or Mermaid result in
Excalidraw routes it to the enabled board. If it is disabled, install or enable another board that
provides the required image or diagram capability; otherwise Persephone reports that no such
editor is registered.

## `persephone.call(path, options?)`

Trusted Boards can resolve the bounded AiVision object model from the page hosting the Board:

```js
const source = await persephone.call("page.grouped.content");
const matches = [...source.matchAll(/TODO\w*/g)].map((m) => ({ match: m[0], index: m.index }));
await persephone.call("page.grouped.content", { value: JSON.stringify(matches, null, 2) });
```

The method always suppresses hints and returns only a JSON-safe shaped value. `args` calls the final
method, `value` assigns a writable property, and an explicit `maxLength` optionally bounds strings
or structured results; structured truncation keeps whole values. Board calls are unbounded by
default, so a large string arrives intact. `persephone.call()` returns the value itself; the
the `shown`/`total` metadata is part of the external MCP `call` envelope. `args` and `value` are
mutually exclusive. Calls reject as `Error` on resolver, transport, timeout, or trust failures.
Trust is checked at resolution time, and existing descriptor restrictions still apply. Calls remain
anchored to the Board's hosting page even when another tab becomes active.

Append `.$describe` to a node path when a board needs the descriptor as structured data rather than
the prose returned by `$help`. The result includes the node's kind, summary, members, and live
children, so a programmatic viewer can build a tree without parsing help text. `$describe` is
available through the same call path and does not invoke the node's methods; use `$help` for the
human-readable explanation. See the [agent board guide](../agents/boards/index.md) for the descriptor
shape, restrictions, and confirmation rules for boards that expose actions.

Remote `.app` calls use four timeout levels, in order: per-call `timeoutMs`, the remote method's
declared `timeoutMs`, the session-only in-memory `boards.callTimeoutMs`, and the built-in 30-second
fallback. Timeout errors name the selected level and full path. `boards.callTimeoutMs` is not
persisted, and the per-call option affects only a remote `.app` leaf. MCP waits five seconds beyond
the per-call `timeoutMs`; when it is omitted, MCP waits up to 125 seconds total. Pass `timeoutMs` for
a slower call that needs a longer wait.

## `persephone.themes.*` (bridge 1.35.0)

The `themes: true` manifest permission exposes the existing `app.themes` service through a narrow
JSON-only bridge. It does not grant `appScripting` or make other `persephone.call()` paths available.
Without the grant, each method rejects with exactly
`permission-denied: "themes" is not enabled in board-manifest.json`.

```js
const definitions = await persephone.themes.list();
const current = await persephone.themes.current(); // Promise because board calls cross an async transport
const draft = await persephone.themes.fork(current.id);
const preview = await persephone.themes.preview(draft);
await persephone.themes.endPreview();
```

Available methods: `list()`, `get(id)`, `current()`, `derive(base, isDark?)`, `contrast(input)`,
`fork(id)`, `file(id)`, `save(draft)`, `rename(id, name)`, `delete(id)`, `apply(id)`, `preview(draft)`, and
`endPreview()`. Arguments and results are plain JSON values; a missing theme from `get(id)` is
returned as `null`. `file(id)` returns a saved custom theme's stored file — base intent, `isDark`
(`null` = automatic), overrides and id — or `null` for built-ins; use it, not `fork()`, to edit a
saved theme in place. `app.themes.current` remains a synchronous property in the app service, while
the board's `persephone.themes.current()` is a Promise-returning method.

A preview is temporary and restores the latest persisted theme when ended. Closing, reloading, or
navigating away from the requesting frame ends its preview only if no later preview or theme
selection replaced it. Other boards, scripts, Settings changes, cycling, and explicit apply all
replace the preview safely. Boards using this API must declare
`minBridgeVersion: "1.35.0"`.
