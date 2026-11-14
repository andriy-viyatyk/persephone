---
title: "Boards — files, folders, watch and persephone.call"
audience: agent
summary: "Native file dialogs, listFolder, watch, folder grants, trashFile, TypeScript projects, readFile/writeFile, getFilePath/getFolderPath and persephone.call."
---

# Boards — files, folders, watch and persephone.call

- `persephone.notify(message, type, options?)` — toast (`"info"|"success"|"warning"|"error"`).
  Info, success and warning toasts close after a few seconds; pass `{ persistent: true }` (bridge
  1.33.0) for a message the user must read in full, such as a failed sync that needs action. Do
  not use `"error"` just to keep a message on screen. Errors and warnings are
  also appended to the board's **`ui.log`** (an on-board indicator opens it). For ordinary boards,
  it is in the board folder; for bundled boards, it is `<userData>/board-logs/<id>/ui.log`.
  The log also receives automatically: load failures, CSP violations, uncaught errors / unhandled rejections,
  and every **`console.error`/`console.warn`** from the board's frames — read it when debugging.
- `persephone.openFileDialog(params)` / `saveFileDialog(params)` / `openFolderDialog(params)` —
  native dialogs returning a path you hand to `execute()`. The board needs
  `fileSystem: "board"` or `fileSystem: "full"` for these dialogs. An agent may dismiss a
  picker with `windows[i].nativeDialog.dismiss()`, but cannot choose or confirm a path.
- `persephone.listFolder(path, options?)` — paged listing (1,000 entries per page, 100,000 per
  listing), non-recursive by default. `masks` match basenames with `*` and `?`; directories remain
  included. Follow `nextCursor` and check `truncated`.
- `persephone.watch(path, callback, options?)` → `Promise<() => void>` — watch an authorized file or
  folder. Options are `{ recursive?: boolean, debounceMs?: number }`; it watches immediate folder
  entries by default and descendants with `recursive: true`. Debounce defaults to 300 ms and accepts
  integers from 50 through 60000. Each callback receives
  `{ changes: [{ path, type }], rescan?, ended? }`, where paths are absolute canonical paths and types
  are `created | changed | deleted`. `rescan: true` means reload the watched scope; `ended` is
  `removed`, `error`, or `revoked`, after which the subscription closes. Folder watches use `list`
  permission and include only the canonical folder and descendants; file watches use `read`
  permission and include only that exact file.
  `fileSystem: false` permits only the exact hosted document. The returned disposer is idempotent;
  subscriptions end on board-port teardown or permission revocation, and each board may have 64 live
  watches. Stable errors are `invalid-argument`, `permission-denied`, `not-found`, and
  `too-many-watches`. A missing exact-file target returns `not-found` in v1; watch its containing
  folder to wait for the file to appear.
- `persephone.rememberFolder(path)` asks the user to persist read/list access to a folder picked by
  this board. `persephone.rememberFile(path)` asks for read/write access to one exact plain local
  file picked by this board or delivered to it as its initial/runtime source; source-context items
  are not eligible. It never covers the parent or siblings. Both prompt only under
  `fileSystem: "board"` and can be revoked in Board Info. Under `fileSystem: "full"` every path is
  already covered, so both return `true` at once without a prompt or a stored grant — a board that
  needs arbitrary user folders (a music library, say) should request `"full"` and be trusted once.
- `persephone.trashFile(path)` → `Promise<void>` (bridge 1.41.0) — move a file to the OS Recycle
  Bin, so the user can restore it. Authorized exactly like `writeFile` (`fileSystem: "board"` or
  `"full"`); rejects with `not-found` for a missing path and `permission-denied` for a folder. The
  board owns the confirmation prompt — ask before calling it.
- `persephone.registerTypeScriptProject(root)` → `Promise<void>` (bridge 1.47.0) — register a TypeScript
  project folder (it must contain a `tsconfig.json`) so Monaco pages that edit `.ts`/`.tsx` files under
  it get project IntelliSense: relative imports, sibling units, project `.d.ts` (including
  `declare module "x"`) and, when the tsconfig sets `resolveJsonModule: true`, typed default imports of
  the project's `*.json` files. Authorized exactly like `listFolder` (`fileSystem: "board"` with `root`
  inside the board folder or a granted folder, or `"full"`); `fileSystem: false` rejects with
  `permission-denied`, a missing `tsconfig.json` rejects with a readable message. Registration is lazy:
  only `tsconfig.json` is read; the project's files load when the first Monaco page opens one, and are
  released when the last such page closes. Registrations are released when the board closes or reloads,
  so call it on **every board load** (it is idempotent). Use the same path spelling for
  `openRawLink` that you register, because a page's file is matched to the project by path.
  Limits: `.ts`/`.tsx` only (no `.mts`/`.cts`, no JS), `extends` is not followed, compiler options are
  not applied (highlighted errors are a subset of `tsc --noEmit`), at most 8 projects per board, 2000
  source files / 1 MiB per source / 512 KiB per JSON / 16 MiB total (a toast reports truncation).
  A page that was already open when the project registered keeps its text, cursor and scroll but loses
  its undo history. Pages can show errors through the toolbar "Show TypeScript errors" toggle.
- `persephone.unregisterTypeScriptProject(root)` → `Promise<void>` (bridge 1.47.0) — drop this frame's
  registration of the folder; ungated.
- `persephone.getFileAccess(path)` returns `{ read, write }` for the current path authorization
  without prompting or changing grants. Call it at startup to check whether a remembered catalog is
  writable; `rememberFile()` may prompt and should not be used as an access check.
- `persephone.readFile(path, options?)` / `writeFile(path, data, options?)` — read/write a file with
  `fileSystem: "board"` or `fileSystem: "full"` (full allows any accessible path). With
  `fileSystem: false`, `readFile()` may read only the exact current `getFilePath()` target; all other
  reads and every write still need `"board"` or `"full"`. Relative `path`
  resolves against the board folder; absolute reads/writes anywhere.
  `writeFile` creates parent dirs. Both return Promises (reject on error). Encodings: `"utf8"`
  (default) → string; **`"binary"` → a `Uint8Array`, the right choice for ANY binary file** (image,
  PDF, zip, spreadsheet) — it feeds a parser directly and is the only way to read a file over
  ~400 MB, since base64 of one exceeds V8's max string length; `"base64"` → a base64 string, for
  when you actually want base64 (a `data:` URI). `"binary"` needs app 4.0.21+, so declare
  `"minAppVersion": "4.0.21"` in `board-manifest.json` — Persephone then refuses to run the board on
  older apps and no runtime check is needed. Use it to persist small board state and load config.
  ```js
  const bytes = await persephone.readFile(path, { encoding: "binary" });  // Uint8Array
  ```
- `listFolder()` skips symlinks and junctions, limits recursive depth to 32, and expires cursors
  after five minutes. Stable error codes include `permission-denied`, `invalid-argument`, `not-found`,
  `not-directory`, `too-many-entries`, `depth-limit`, `cursor-expired`, and `io-error`. Persephone
  returns `invalid-argument: The folder cursor is invalid.` when a cursor belongs to a disposed,
  replaced, or different board-port connection; a lookup from another connection does not consume
  the cursor. Persephone
  also reports the stable `permission-denied` code for service-interface, service, dialog, and
  board-folder grant denials; their existing descriptive messages are unchanged. Scoped file checks
  still report their path-specific denial messages. Persephone
  grants session-only read access to exact local source files delivered to the board and to local
  items in delivered source contexts; this also lets `content.open()` read those files. It grants no
  writes. A `fileSystem: false` board cannot read context siblings.
- `persephone.getFilePath()` → `Promise<string | undefined>` — when the board is opened as a **custom
  editor** for a file (associated via `fileMasks` in `board-manifest.json`), resolves to that file's
  absolute path (read/write it with `readFile`/`writeFile`); `undefined` for a board opened plainly.
  Safe to `await` at any time (waits for the host handshake). The path is **always local**: with
  `"editorSources": "any"` the board also opens archive entries and `http(s)` URLs, and Persephone
  materializes those into a read-only cache file first — so one code path serves every source. Such a
  board must handle two edges: the call can be **slow** (a URL completes only after the whole
  download — build your UI in parallel rather than awaiting first) and it can **reject** (missing
  archive entry, HTTP failure), which is different from `undefined`. Report a rejection; never leave a
  blank frame.
- `persephone.getFolderPath()` → `Promise<string | undefined>` — for a direct-folder editor, the
  absolute directory claimed by the board; `undefined` for plain boards and file-only openings. It
  waits for the same handshake as `getFilePath()`. `boardRoot` is where the board app is installed,
  while `folderPath` is the claimed directory it operates on. Folder mode never supplies a file path,
  and `editorKind: "content-host"` / `"stream-host"` applies only to the file association.
- `persephone.call(path, options?)` — requires `appScripting: true`; resolve the same bounded AiVision descriptor tree as the
  <!-- board-template:exclude -->MCP `call` tool<!-- /board-template:exclude -->, rooted at the page hosting this Board. The Board must be trusted; trust is checked
  again when each call resolves, so revoking trust also blocks an already-mounted Board. The call
  always uses `hints: "never"` and returns only a JSON-safe plain value; it rejects an `Error` for
  resolver, transport, timeout, or serialization failures. `args` invokes the final method,
  `value` assigns a writable property, and an explicit `maxLength` optionally bounds shaped strings
  or structured results (structured truncation keeps whole values). Board calls are unbounded by
  default. `persephone.call()` returns the bounded value itself;
  <!-- board-template:exclude -->`shown`/`total` metadata is available in the external MCP `call` envelope.<!-- /board-template:exclude --> `args` and `value`
  cannot be combined.
  ```js
  const source = await persephone.call("page.grouped.content");
  const matches = [...source.matchAll(/TODO\w*/g)].map((m) => ({ match: m[0], index: m.index }));
  await persephone.call("page.grouped.content", {
      value: JSON.stringify(matches, null, 2),
  });
  ```
  Append `.$describe` to any path to return the node's descriptor as the call result rather than
  prose: `{ path, kind, summary, members[], children[], overview?, help?, identity?, restricted? }`.
  `members[]` contains the raw `IAiMember` entries (`name`, `kind`, `summary`, and optional
  `signature`, `caution`, `writable`, and `node`); `children[]` contains raw `IAiChild` entries
  plus an absolute `path` for each child. A function-valued `help` is resolved and trimmed.
  `$describe` follows the same walk as `$help`, must be the final segment (anything after it is a
  path syntax error), and is answered before the node's `restricted()` gate: a restricted node
  describes itself and includes its `restricted` text, while descendants remain blocked. A node
  without an AiVision descriptor returns the same error as `$help`, with its value shown.
  `$help` remains the right call for prose; `$describe` is for programmatic board consumers such
  as a tree view or generated client. Expanding a tree with `$describe` is side-effect free by
  contract, but a board that offers to invoke members must surface each member's `caution` text
  and require explicit confirmation for every such invocation. A trusted board reaches `proc`,
  `fs`, `shell`, and `script`, so treat that confirmation as a privilege boundary.
  ```js
  const node = await persephone.call("page.editor.$describe");
  const rows = node.children.map((child) => ({ label: child.segment, path: child.path }));
  ```
  Describe a NODE, not a leaf value: `page.editor.$describe` works, `page.content.$describe` does
  not, because a string carries no descriptor.
  `$describe` also resolves on a published remote model at `pages[i].editor.app`, allowing one
  board to browse another board's model or a web page's model.
  The hosting page is identified from the Board editor's owner id, not from the active tab, so
  switching tabs does not retarget the call. The resolver's existing descriptor restrictions still
  apply, including the private incognito/Tor browser-page guard. No renderer object or method crosses
  the Board port.
  <!-- board-template:exclude -->This is the renderer-side, page-scoped tree: `main.*` and `windows[i].*` are MCP-only routing
  paths and cannot be resolved through the Board bridge.<!-- /board-template:exclude --> The `boards` namespace exposes local board
  inventory and lifecycle operations, while `tools` exposes registered Agent Tools; tool execution
  runs with the user's privileges and returns environment-variable names only. Trust, board
  registration, and toolset registration remain user-mediated actions, so a call can request them
  but never silently grants them.
