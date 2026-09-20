# US-1490 — The Excalidraw board's library flow

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** [US-1487: The Excalidraw board](../US-1487-excalidraw-board/README.md), [US-1489: Board navigation return URLs](../US-1489-board-navigation-return/README.md)

## Goal

Make the bundled Excalidraw board's library flow behave like the built-in Drawing editor: Browse
libraries opens the library site through Persephone, Add to Excalidraw returns to the owning board,
the board fetches the returned `.excalidrawlib` through bundled Node, and the complete merged library
survives reloads. The task also records the D11 parity audit required before EPIC-110 removes
`editors/draw`.

This is an investigation and implementation plan only. No implementation, test harness, app run,
board drive, generated-library rebuild, or commit belongs to this task.

## Background

### Epic decisions and dependency boundary

EPIC-109 D10 makes browser-navigation return URLs a platform feature. Persephone mints a unique
`https://<nonce>.board-return.persephone.invalid/` URL for one board instance; a board must request
that URL and must not register its own matching pattern. The existing built-in sentinel and its local
`browserUrlChanged` subscriber are explicitly being replaced by US-1489. D10 also rejects a
renderer-side network fetch: the board CSP permits only `connect-src 'self'`, so cross-origin fetch
from the board frame is refused by design. [`EPIC-109.md:212-247`](../../epics/EPIC-109.md#L212-L247)

US-1489 is not present in the repository at the time of this investigation. This task therefore
consumes its API without designing it. US-1490 needs the service to provide the minted return URL for
the current board instance and to deliver a matching return navigation, including its URL/hash
parameters, to that board; it also needs the service's normal focus/return-to-owner behavior. The
board supplies no URL pattern. When US-1489 is written, use its actual method and callback names in
the board bootstrap.

`BrowserUrlEvent` already has the cooperative `handled` flag, and browser navigation currently emits
the event with the changed URL. [`src/renderer/core/state/events.ts:39-46`](../../../src/renderer/core/state/events.ts#L39-L46)
[`src/renderer/editors/browser/BrowserWebviewModel.ts:210-223`](../../../src/renderer/editors/browser/BrowserWebviewModel.ts#L210-L223)

### Current board and the broken flow

US-1487's board is a plain JavaScript module in
[`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html). It loads host
content, renders the vendor Excalidraw entry, serializes edits through
`persephone.host.setContent()`, handles external host snapshots, follows the Persephone theme, and
exposes the existing DrawEditor aiVision surface. [`index.html:59-72`](../../../assets/boards/excalidraw/index.html#L59-L72)
[`index.html:131-181`](../../../assets/boards/excalidraw/index.html#L131-L181)
[`index.html:183-297`](../../../assets/boards/excalidraw/index.html#L183-L297)

The current board passes neither `libraryReturnUrl` nor `UIOptions`, and has no library adapter or
return callback. [`index.html:285-293`](../../../assets/boards/excalidraw/index.html#L285-L293)
Without the D10 return service, Excalidraw's library link falls back to the board's
`board://...` location. Windows then offers to open the `board` scheme instead of returning to the
board. The built-in intercepts Browse and opens its URL in a Persephone Browser tab.
[`src/renderer/editors/draw/DrawBodyView.ts:160-175`](../../../src/renderer/editors/draw/DrawBodyView.ts#L160-L175)

The board must not add a second Browse-anchor listener. The shim already installs a generic
`click`/middle-`auxclick` router for every board; it resolves `a[href]`, ignores only in-board and
`javascript:` links, prevents navigation, and fires `openRawLink`.
[`src/board-shim.ts:1051-1077`](../../../src/board-shim.ts#L1051-L1077)
The resulting path is suitable here: the HTTP resolver sends a URL with no content extension or
other content intent to `openLinkInBrowser`, while file-like/content URLs go through the content
pipeline. The libraries site is an ordinary HTTPS page, so the shim's `openRawLink` path produces a
Browser tab. The board therefore adds nothing for Browse routing; a board-local
`pages.openUrlInBrowserTab` call is unnecessary.
[`src/renderer/api/types/app.d.ts:127-131`](../../../src/renderer/api/types/app.d.ts#L127-L131)
[`src/renderer/api/internal/RendererEventsService.ts:43-53`](../../../src/renderer/api/internal/RendererEventsService.ts#L43-L53)
[`src/renderer/content/builtin-schemes.ts:324-353`](../../../src/renderer/content/builtin-schemes.ts#L324-L353)

Excalidraw constructs the Browse libraries URL from the supplied `libraryReturnUrl`, the current
editor token, and `useHash=true`; the library site returns `addLibrary` and `token` in the hash.
[`node_modules/@excalidraw/excalidraw/dist/dev/index.js:10007-10024`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L10007-L10024)

### Required network and file path

The board must use `persephone.executeNode()` to run a small Node script with the returned library
URL as an argument. This is Persephone's bundled Node runtime and requires no user-installed Node.
The existing bridge exposes that method at [`src/board-shim.ts:1184-1197`](../../../src/board-shim.ts#L1184-L1197).
The script must emit only the downloaded response body, handle HTTP errors and redirects, and return
the text through the execute handle. The board must not call `fetch()` for the library URL from the
board frame. The board CSP is `connect-src 'self'`; its purpose is to refuse this cross-origin
renderer request. [`src/main/board-protocol-service.ts:75-94`](../../../src/main/board-protocol-service.ts#L75-L94)

The board writes the resulting library data through the existing file bridge, not through a new
renderer or main-process API. `writeFile` accepts absolute paths, creates parent folders, and writes
UTF-8 text by default. [`src/board-shim.ts:1311-1329`](../../../src/board-shim.ts#L1311-L1329)
[`src/main/board-bridge.ts:195-202`](../../../src/main/board-bridge.ts#L195-L202)
[`src/main/board-bridge.ts:236-253`](../../../src/main/board-bridge.ts#L236-L253)

### Library persistence contract

The built-in adapter is in [`src/renderer/editors/draw/drawLibrary.ts`](../../../src/renderer/editors/draw/drawLibrary.ts).
It uses the fixed filename `library.excalidrawlib`; `load()` returns `null` for an unset path,
missing file, malformed JSON, or an unreadable file, and otherwise returns the wrapper's
`{ libraryItems: data.libraryItems || [] }`. `save(libraryData)` creates the directory and writes
the complete object as formatted JSON. [`drawLibrary.ts:1-49`](../../../src/renderer/editors/draw/drawLibrary.ts#L1-L49)

The Excalidraw adapter type calls `load(metadata: { source: "load" | "save" })`, but the built-in
implementation is declared `async load()` with no parameter and ignores that metadata. Its
`load()` therefore has identical behavior for initial load and save-time calls. It returns
`{ libraryItems }` or `null`; `save()` receives the complete persisted wrapper and preserves its
shape. [`node_modules/@excalidraw/excalidraw/dist/types/excalidraw/data/library.d.ts:1-31`](../../../node_modules/@excalidraw/excalidraw/dist/types/excalidraw/data/library.d.ts#L1-L31)
[`src/renderer/editors/draw/drawLibrary.ts:21-49`](../../../src/renderer/editors/draw/drawLibrary.ts#L21-L49)

`useHandleLibrary` performs the following observable sequence:

1. Once `excalidrawAPI` exists, it calls `adapter.load({ source: "load" })` and passes the resulting
   items to `excalidrawAPI.updateLibrary({ libraryItems: ..., merge: true })`, so installed items
   are merged into anything already present.
2. When library state settles, Excalidraw calls the component's `onLibraryChange` callback and also
   emits an internal update. The adapter path may call `adapter.load({ source: "save" })` while
   reconciling additions/replacements/deletions by id, but the built-in adapter ignores the source
   value; it simply rereads the same disk wrapper and then saves the complete next collection when
   the item hash changed.
3. A library imported from a URL is passed to `updateLibrary()` with `merge: true`, `prompt: true`,
   `openLibraryMenu: true`, and `defaultStatus: "published"`; the same library update then reaches
   persistence.

These calls are visible in the pinned Excalidraw implementation. [`node_modules/@excalidraw/excalidraw/dist/dev/index.js:9673-9743`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L9673-L9743)
[`node_modules/@excalidraw/excalidraw/dist/dev/index.js:9744-9815`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L9744-L9815)
[`node_modules/@excalidraw/excalidraw/dist/dev/index.js:9855-9950`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L9855-L9950)

The board cannot use the React hook, so its plain-JavaScript bootstrap must provide the equivalent
behavior itself: load the existing item list after the imperative API is available, merge it into
the editor, pass the returned library as a `Blob`/supported `LibraryItemsSource` to `updateLibrary`,
and persist the complete post-merge list from `onLibraryChange` through a serialized save queue. The
board-side save must write `{ libraryItems: [...] }` to `library.excalidrawlib`; it must not overwrite
the collection with only the newly downloaded remote file. The remote addition is stored when the
merged `updateLibrary()` result triggers the save callback.

### Adopt the built-in library, including a customized path

The built-in initializes an empty `drawing.library-path` to
`<userData>/data/excalidraw-lib`, and the settings page lets the user choose another folder or reset
to the default. [`src/renderer/editors/draw/drawLibrary.ts:8-19`](../../../src/renderer/editors/draw/drawLibrary.ts#L8-L19)
[`src/renderer/editors/settings/sections/SettingsSections.ts:334-394`](../../../src/renderer/editors/settings/sections/SettingsSections.ts#L334-L394)
The `drawing.library-path` setting is part of the renderer app settings, not a board-local setting.
However, the board's trusted `persephone.call()` is rooted at the renderer AiVision tree and can
read `settings.get`; it cannot reach process-owned `main.*`. [`src/renderer/editors/board/board-api.d.ts:465-485`](../../../src/renderer/editors/board/board-api.d.ts#L465-L485)
[`src/renderer/api/mcp/board-call-command.ts:25-65`](../../../src/renderer/api/mcp/board-call-command.ts#L25-L65)
[`src/renderer/scripting/ai-vision/namespaces/settings.ts:279-324`](../../../src/renderer/scripting/ai-vision/namespaces/settings.ts#L279-L324)

The recommended resolver is therefore:

```js
// Before: the board has no library resolver or persistence adapter.
const { Excalidraw } = await import("./lib/index.js");
root.render(React.createElement(Excalidraw, { initialData: scene }));

// After: resolve the existing renderer setting, retaining the built-in default when empty.
const configuredDir = await persephone.call("settings.get", {
    args: ["drawing.library-path"],
});
const userData = await persephone.call("fs.commonFolder", { args: ["userData"] });
const libraryDir = configuredDir || `${userData}/data/excalidraw-lib`;
const libraryFile = `${libraryDir}/library.excalidrawlib`;
```

The actual implementation should use the board's existing path handling conventions and normalize
the separator where necessary. This intentionally differs from the adapter's empty-path behavior:
`initDefaultLibraryPath()` materializes the default by creating the directory and writing the
setting on first built-in-editor mount, while the adapter itself returns `null` and skips saves when
the setting is empty. The board should resolve an empty setting to the same known default so a fresh
install does not start with an unrelated empty library, but it need not create the directory or
write the renderer setting during resolution; `persephone.writeFile` creates parent directories on
the first save. A non-empty setting must be honored exactly, so users who configured a folder in the
built-in editor see the same items in the board.
[`drawLibrary.ts:8-19`](../../../src/renderer/editors/draw/drawLibrary.ts#L8-L19)
[`drawLibrary.ts:21-49`](../../../src/renderer/editors/draw/drawLibrary.ts#L21-L49)

This keeps the location stable across EPIC-111. EPIC-111 will expose a user-facing board setting and
must seed that setting from the current `drawing.library-path` value (or the same default) without
copying or renaming `library.excalidrawlib`; until that API exists, US-1490 reads the legacy setting
through `persephone.call()`. EPIC-111 explicitly records adoption of the existing configured value
as an exit criterion. [`EPIC-111.md:20-34`](../../epics/EPIC-111.md#L20-L34)
[`EPIC-111.md:49-66`](../../epics/EPIC-111.md#L49-L66)

## Implementation Plan

### 1. Connect the board to US-1489's return service

- In `assets/boards/excalidraw/index.html`, request the US-1489 minted return URL during bootstrap
  and pass it as Excalidraw's `libraryReturnUrl` prop.
- Rely on the existing board shim's generic external-anchor router for Browse libraries. It already
  prevents the `board://` document navigation and sends the ordinary HTTPS URL through
  `openRawLink`; the HTTP resolver confirms that an ordinary web URL with no content intent becomes
  a Browser tab.
  Do not add a board-local anchor listener or call `pages.openUrlInBrowserTab` from this task.
- Register the return callback through US-1489. Claim only a callback delivered for this board's
  minted URL; read `addLibrary` from the supplied hash parameters and retain the `token` only for
  Excalidraw's prompt/identity semantics if the dependency API exposes it. Do not parse arbitrary
  browser URLs and do not claim a callback with no `addLibrary` value.
- Let the navigation service perform its owner-page focus/return behavior. The board should only
  install the callback and complete the library operation.
- Unsubscribe the return callback on `beforeunload`/board teardown.

### 2. Fetch the returned `.excalidrawlib` through bundled Node

- Decode the `addLibrary` parameter exactly once, validate that it is an HTTP(S) library URL, and
  pass it as an argument to `persephone.executeNode()`; never interpolate it into script source.
- Use only Node built-ins in the script. Follow redirects, reject non-2xx responses, and write the
  response body to stdout without diagnostic output. Read the handle with `getText()` and surface a
  failure with `persephone.notify(..., "error")`.
- Do not use `fetch()` or any other cross-origin network primitive in `index.html`. The board's
  `connect-src 'self'` CSP is an intentional boundary, not a defect to relax.

### 3. Recreate the adapter contract in the plain-JavaScript board

- Add board-local `resolveLibraryPath()`, `loadLibrary()`, `saveLibrary()`, and a serialized save
  queue in `index.html`. Resolve the customized renderer setting first, then the unchanged default
  under `userData`; use the fixed filename `library.excalidrawlib`. An empty setting resolves to the
  default but does not itself create the directory or mutate settings; `writeFile` creates parents
  when a save is needed.
- `loadLibrary(_metadata)` must call `persephone.readFile(libraryFile, { encoding: "utf8" })`,
  parse the JSON wrapper, and return `{ libraryItems: data.libraryItems || [] }`. Missing,
  malformed, or unreadable data returns `null`, matching the adapter's load behavior. The metadata
  object may contain `source: "load"` or `"save"`, but the board must ignore it just as the built-in
  `async load()` does; no source-specific reconciliation is needed.
- `saveLibrary({ libraryItems })` must call `persephone.writeFile(libraryFile,
  JSON.stringify({ libraryItems }, null, 2))`. The bridge creates the directory; no direct `fs`,
  `path`, renderer import, or shell-based writer is permitted.
- After `excalidrawAPI` is adopted, load existing items and call `updateLibrary({ libraryItems,
  merge: true })`. This must happen before or in parallel with a returned remote library so a slow
  initial read cannot discard an already imported library.
- Pass `onLibraryChange` to `<Excalidraw>`. Treat its complete item list as the board's authoritative
  post-merge list, serialize saves so two updates cannot overwrite one another out of order, and
  persist only the wrapper shape expected by the built-in adapter. If the board reproduces the
  internal delta reconciliation instead, its save path must still reread the same wrapper regardless
  of whether Excalidraw labels the call `source: "load"` or `source: "save"`; the built-in does not
  branch on that metadata.

### 4. Complete the return callback

- Fetch the decoded URL with the Node helper.
- Store the downloaded response through the adapter's `writeFile`-backed save path and create a
  browser `Blob` from the response text with the Excalidraw library MIME type.
- Call:

  ```js
  await excalidrawAPI.updateLibrary({
      libraryItems: libraryBlob,
      merge: true,
      prompt: false,   // see below — NOT `true`
      openLibraryMenu: true,
  });
  ```

  **`prompt` must be `false`, and the board asks the question itself.** Excalidraw implements
  `prompt: true` as a raw `window.confirm()` (`alerts.confirmAddLibrary`) — an unthemed Chromium
  dialog, invisible to an agent and out of place inside Persephone. The built-in editor was changed
  to ask with `ui.confirm()` instead and install unprompted, and the board must not regress to the
  native prompt. Boards have no confirm of their own — `src/board-shim.ts` exposes only the file
  dialogs — so raise it through `persephone.call("ui.confirm", ...)`, which a bundled board is
  entitled to use. Count the items for the message the way `countLibraryItems()` in
  `DrawBodyView.ts` does: **both** formats occur in the wild, v2 under `libraryItems` and v1 under
  `library`, and several libraries published on libraries.excalidraw.com are still v1 (Software
  Architecture is one). Fall back to a countless wording rather than refusing to install.

- Await the update so `onLibraryChange` completes persistence before reporting success. Keep the
  existing library items, mark the remote items as published through Excalidraw's normal import
  path, and do not replace the on-disk collection with the downloaded file alone.
- Clear only the consumed return state through the US-1489 callback/service contract; do not mutate
  the board's browser location as a substitute for claiming the navigation.

### 5. Match the four suppressed canvas actions

The built-in supplies this configuration:

```tsx
// Before: built-in Draw editor, ExcalidrawIsland.tsx:22-29
const UI_OPTIONS = {
    canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        export: false,
        toggleTheme: false,
    },
};

// After: board's Excalidraw props in index.html
React.createElement(Excalidraw, {
    ...existingBoardProps,
    libraryReturnUrl,
    UIOptions: {
        canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            toggleTheme: false,
        },
    },
});
```

This is required for parity in both directions:

- `loadScene` calls Excalidraw's file loader and replaces the in-memory scene, but the board's
  current implementation only writes host content from its `onChange` path. The action can therefore
  replace what the user sees without first going through the board's host serialization contract.
  [`node_modules/@excalidraw/excalidraw/dist/dev/index.js:6776-6810`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L6776-L6810)
  [`assets/boards/excalidraw/index.html:165-180`](../../../assets/boards/excalidraw/index.html#L165-L180)
- `saveToActiveFile` is the browser file-handle save action, not `persephone.host.setContent()`;
  the board has no Excalidraw file handle and the host owns persistence. Its predicate and save path
  are in the vendor action implementation. [`node_modules/@excalidraw/excalidraw/dist/dev/index.js:6685-6725`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L6685-L6725)
- `export` exposes Excalidraw's browser-side export/save UI. In the board this is the wrong owner
  for disk output and can start a browser download/file-access flow; built-in export is deliberately
  hidden while Persephone's own export/facade paths remain available. [`node_modules/@excalidraw/excalidraw/dist/dev/index.js:6726-6775`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L6726-L6775)
- `toggleTheme` changes Excalidraw's `appState.theme`, while the board is rendered from the live
  Persephone theme and re-renders on `onThemeChange`. Leaving both controls active lets a canvas-local
  theme fight the host theme. [`node_modules/@excalidraw/excalidraw/dist/dev/index.js:6085-6106`](../../../node_modules/@excalidraw/excalidraw/dist/dev/index.js#L6085-L6106)
  [`assets/boards/excalidraw/index.html:271-297`](../../../assets/boards/excalidraw/index.html#L271-L297)

### 6. Record and verify the D11 parity audit

The audit is behavioral: a structural difference is acceptable only when the user cannot observe it.
The source-backed inventory is:

| Built-in user-facing surface | Built-in source and behavior | Board source and result | D11 status |
|---|---|---|---|
| Excalidraw canvas, tools, selection, undo/redo, and scene editing | `DrawReadyView` mounts the same pinned Excalidraw package and passes the host scene/API. [`DrawBodyView.ts:102-154`](../../../src/renderer/editors/draw/DrawBodyView.ts#L102-L154) | US-1487 renders the committed vendor entry with the same scene/API lifecycle. [`index.html:131-163`](../../../assets/boards/excalidraw/index.html#L131-L163) | Match after US-1487 |
| Host load/save and external content changes | `DrawEditor.parseContent()` defaults empty/missing `elements`, `appState`, and `files`; `updateFromExcalidraw()` fingerprints and serializes with `serializeAsJSON(..., "local")`. [`DrawEditor.ts:119-176`](../../../src/renderer/editors/draw/DrawEditor.ts#L119-L176) | Board parses the host snapshot, fingerprints edits, uses the same serializer, calls `host.setContent()`, and applies external snapshots without echo. [`index.html:88-95`](../../../assets/boards/excalidraw/index.html#L88-L95) [`index.html:153-180`](../../../assets/boards/excalidraw/index.html#L153-L180) | Match after US-1487 |
| Library browse and Add to Excalidraw | Built-in passes a return URL, intercepts Browse, claims its return event, fetches the URL, and calls `updateLibrary({ merge:true, prompt:true, openLibraryMenu:true })`. [`ExcalidrawIsland.tsx:67-76`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L67-L76) [`DrawBodyView.ts:160-175`](../../../src/renderer/editors/draw/DrawBodyView.ts#L160-L175) [`DrawBodyView.ts:256-282`](../../../src/renderer/editors/draw/DrawBodyView.ts#L256-L282) | Current board passes no `libraryReturnUrl`, but the generic shim already routes the Browse HTTPS anchor through `openRawLink`; the HTTP resolver sends this ordinary web URL to a Browser tab. It has no return callback. [`src/board-shim.ts:1051-1077`](../../../src/board-shim.ts#L1051-L1077) [`src/renderer/content/builtin-schemes.ts:324-353`](../../../src/renderer/content/builtin-schemes.ts#L324-L353) [`index.html:285-293`](../../../assets/boards/excalidraw/index.html#L285-L293) | Gap only for the return URL/callback/fetch; US-1490 closes it without board-local Browse interception |
| Existing library items and persistence across reload | Built-in calls `useHandleLibrary` with `createLibraryAdapter()`, loads `library.excalidrawlib`, merges it, and saves the full wrapper. Its empty-path initializer materializes the default before this adapter is used. [`ExcalidrawIsland.tsx:49-67`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L49-L67) [`drawLibrary.ts:8-49`](../../../src/renderer/editors/draw/drawLibrary.ts#L8-L49) | Current board has neither an adapter equivalent nor an initial library update. [`index.html:131-176`](../../../assets/boards/excalidraw/index.html#L131-L176) | Gap; US-1490 closes it, with an intentional fresh-install difference: empty resolves to the same default but directory creation waits for the first save |
| User-configurable library folder | Settings exposes Browse/Reset for `drawing.library-path`; empty means the default. [`SettingsSections.ts:334-394`](../../../src/renderer/editors/settings/sections/SettingsSections.ts#L334-L394) | Board has no board-setting UI and currently has no path resolver. [`index.html:59-306`](../../../assets/boards/excalidraw/index.html#L59-L306) | Gap; EPIC-111 closes it, out of scope here |
| Open/load canvas action | Built-in explicitly suppresses `loadScene`; host owns the document. [`ExcalidrawIsland.tsx:22-28`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L22-L28) | Board passes no `UIOptions`; vendor `loadScene` replaces the scene without a host-file operation. [`index.html:285-293`](../../../assets/boards/excalidraw/index.html#L285-L293) [`index.html:165-180`](../../../assets/boards/excalidraw/index.html#L165-L180) | Board offers more, incorrectly; US-1490 suppresses it |
| Save to active file | Built-in suppresses `saveToActiveFile`; Persephone's host owns saving. [`ExcalidrawIsland.tsx:22-28`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L22-L28) | Board passes no suppression and does not wire the Excalidraw file-handle path. [`index.html:285-293`](../../../assets/boards/excalidraw/index.html#L285-L293) | Board offers more/foreign ownership; US-1490 suppresses it |
| Export/save-to-disk canvas action | Built-in suppresses `export`; its own toolbar uses Persephone's native save dialogs and file APIs. [`ExcalidrawIsland.tsx:22-28`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L22-L28) [`index.ts:231-266`](../../../src/renderer/editors/draw/index.ts#L231-L266) | Board leaves vendor export live; its browser save path is not the host's native file flow. [`index.html:285-293`](../../../assets/boards/excalidraw/index.html#L285-L293) | Board offers more, incorrectly; US-1490 suppresses it |
| Canvas-local theme toggle | Built-in suppresses Excalidraw's toggle and follows its editor theme state; its separate Persephone toolbar toggle persists `darkMode` in editor settings. [`ExcalidrawIsland.tsx:22-28`](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L22-L28) [`DrawEditor.ts:73-107`](../../../src/renderer/editors/draw/DrawEditor.ts#L73-L107) [`index.ts:123-130`](../../../src/renderer/editors/draw/index.ts#L123-L130) | Board follows `persephone.theme` and live `onThemeChange`, but leaves Excalidraw's canvas toggle live. [`index.html:271-297`](../../../assets/boards/excalidraw/index.html#L271-L297) | Board offers a conflicting extra action; US-1490 suppresses it. The separate toolbar preference remains part of the toolbar gap below |
| Persephone Draw toolbar: theme, copy image, save SVG/PNG, open SVG/image, screen snip | The toolbar declares all five controls and implements native clipboard, save-dialog, capability/open-image, and snip flows. [`index.ts:31-80`](../../../src/renderer/editors/draw/index.ts#L31-L80) [`index.ts:192-300`](../../../src/renderer/editors/draw/index.ts#L192-L300) | The board page contains only the Excalidraw root and its aiVision methods; no equivalent host toolbar is declared. [`index.html:57-86`](../../../assets/boards/excalidraw/index.html#L57-L86) [`index.html:183-267`](../../../assets/boards/excalidraw/index.html#L183-L267) | Gap neither US-1490 nor EPIC-111 closes; EPIC-110 would inherit it |
| Scripting surface: `addImage`, `exportAsSvg`, `exportAsPng`, `elementCount`, `editorIsMounted` | `DrawEditorFacade` declares these exact members and semantics. [`DrawEditorFacade.ts:9-64`](../../../src/renderer/scripting/api-wrapper/DrawEditorFacade.ts#L9-L64) | US-1487 exposes the same member names, signatures, live count/mount state, image defaults, and export formats. [`index.html:78-86`](../../../assets/boards/excalidraw/index.html#L78-L86) [`index.html:183-267`](../../../assets/boards/excalidraw/index.html#L183-L267) | Match after US-1487; confirm in acceptance, do not redo |

The custom Persephone toolbar gap is intentionally recorded rather than silently treating the
board's lack of controls as parity. US-1490 and EPIC-111 close none of those toolbar actions. The
gap must be assigned a follow-up before EPIC-110 deletes `editors/draw`; otherwise the board will
inherit a user-visible regression even after the library flow is complete.

## Concerns

- **US-1489 API is not yet available.** The board must not invent a second return-url matcher. The
  integration point is the service's minted URL plus its callback payload; update this document's
  method names only after US-1489 is present.
- **Do not overwrite the user's collection with a remote file.** The downloaded `.excalidrawlib`
  is an input to `updateLibrary(merge:true)`. The adapter save must persist the merged wrapper, or
  an imported library will delete previously collected items.
- **Concurrent reload/import ordering.** Initial disk load, a return callback, and Excalidraw's
  library change callback can overlap. Use one load/update/save queue and await the update's save
  before reporting success; otherwise a late initial load can write stale items over a new import.
- **Path migration belongs to EPIC-111.** US-1490 must honor the current app setting and exact
  default. EPIC-111 must adopt that same path into board settings without moving the file; its open
  migration decision remains a prerequisite for EPIC-110.
- **CSP is not to be relaxed.** No `connect-src` change, renderer fetch, new network capability,
  main-process endpoint, or generated vendor change is justified.
- **The board's custom-toolbar parity gap is real.** Suppressing unsafe canvas actions does not
  recreate the built-in's native toolbar. This task records the gap so EPIC-110 cannot mistake the
  library fix for complete D11 parity.

## Acceptance Criteria

1. The board obtains a US-1489-minted return URL, passes it as `libraryReturnUrl`, and opens the
   Browse libraries URL through the existing Persephone Browser route without navigating the
   `board://` document.
2. A return callback for that minted URL claims the event, extracts `addLibrary`, fetches the
   library using `persephone.executeNode()` and no board-frame cross-origin `fetch()`, and calls
   `updateLibrary()` with merge/prompt/open-menu behavior equivalent to the built-in.
3. The board persists the complete merged collection as `{ libraryItems: [...] }` at
   `library.excalidrawlib` using `persephone.writeFile`; a reload restores both existing and newly
   imported items.
4. A user-configured `drawing.library-path` is adopted through `persephone.call("settings.get", ...)`;
   an empty setting resolves to `<userData>/data/excalidraw-lib` without eagerly creating the
   directory or mutating settings; the first `writeFile` creates parents. The document records that
   EPIC-111 must retain this location when it moves the setting into board settings.
5. The board passes `UIOptions.canvasActions.loadScene: false`, `saveToActiveFile: false`,
   `export: false`, and `toggleTheme: false`; each action is absent, and host content/theme remain
   the owners of those behaviors.
6. The D11 parity audit is present, cites both built-in and board sources for each listed surface,
   confirms the US-1487 scripting surface, identifies the EPIC-111 path gap, and explicitly records
   the custom Persephone-toolbar gap inherited by EPIC-110.
7. No code under `src/renderer/editors/draw/**`, `src/board-shim.ts`,
   `src/main/board-protocol-service.ts`, or `assets/boards/excalidraw/lib/**` is changed by this
   task; US-1489 owns the built-in navigation migration, and D9 keeps generated board output fixed.
8. No unit test, test harness, runtime state, `openFiles*.json`, app process, dev server, board
   session, dashboard entry, or `doc/epics/EPIC-109.md` is changed by this investigation.

## Files Changed Summary

| File | Change |
|---|---|
| `assets/boards/excalidraw/index.html` | Add the US-1489 return-service integration, bundled-Node library fetch, existing-path resolver, `writeFile`-backed persistence equivalent to `useHandleLibrary`, returned-library merge, and the four `UIOptions` suppressions; rely on the existing shim for Browse routing. |
| `doc/tasks/US-1490-excalidraw-library/README.md` | This investigation, implementation plan, persistence contract, concerns, acceptance criteria, and D11 parity audit. |
| `src/renderer/editors/draw/ExcalidrawIsland.tsx` | No change; its adapter/UIOptions behavior is the built-in parity reference, while US-1489 owns its return-service migration. |
| `src/renderer/editors/draw/DrawBodyView.ts` | No change; its existing browse/callback code is source evidence and the built-in migration belongs to US-1489. |
| `src/renderer/editors/draw/drawLibrary.ts` | No change; its adapter contract and path are adopted by the board, not duplicated or moved. |
| `src/board-shim.ts` | No change; `executeNode`, `readFile`, and `writeFile` already provide the required bridge. |
| `src/main/board-protocol-service.ts` | No change; `connect-src 'self'` remains the intentional CSP boundary. |
| `assets/boards/excalidraw/lib/**` | No change; generated and committed per EPIC-109 D9. |
| `scripts/build-board-lib.mjs` | No change; US-1490 adds no vendor dependency or generated output. |
| `doc/active-work.md` | No change; the US-1490 dashboard entry already exists. |
| `doc/epics/EPIC-109.md` | No change; the epic and linked-task row are already authored. |
| `doc/epics/EPIC-111.md` | No change; it owns the future user-facing board-setting migration. |
