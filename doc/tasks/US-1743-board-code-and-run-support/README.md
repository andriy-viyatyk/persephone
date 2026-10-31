# US-1743: Board open-at-line and reusable Run page

## Status

**Status:** Completed  
**Priority:** Medium  
**Epic:** None (requested by UI Constructor EPIC-005; cross-repository dependency)  
**Started:** 2026-10-31  
**Completed:** 2026-10-31

## Goal

Give a board two focused ways to work with Persephone pages: open a file at a requested line,
reusing its existing page, and open a built local HTML app in a Browser page owned and reused by
that board. Neither capability requires `appScripting`. `openRawLink` is intentionally not gated by
the board's `fileSystem` grants because it performs user-visible navigation and returns no file
contents to the board.

## Background

UI Constructor EPIC-005 (*Code and Run*, `C:/projects/ui-constructor/tasks/epics/EPIC-005.md`)
opens a generated TypeScript unit after a user creates an event handler, then compiles the project
to `<project>/build/run/<App>.html` and runs that file. The current board `openRawLink` is a fire
message (`src/ipc/board-bridge-channels.ts`, `BoardFireMethod`; `src/main/board-bridge.ts`,
`runFire`): main forwards the href and editor to the renderer without checking `fileSystem`
grants. Keep that behavior: the Claude Agent board opens local chat-file links with
`fileSystem: false` (`C:/projects/persephone-boards/boards/claude-agent/app.js:285-294`),
force-graph opens local node links with `fileSystem: false` (`boards/force-graph/app.js:645`),
and torrent-viewer opens downloaded files with `fileSystem: "board"`
(`boards/torrent-viewer/app.js:1092-1098`). The demo board also declares `fileSystem: "board"`
for its own file dialogs and board-scoped paths (`assets/demo-board/board-manifest.json:25`). These
open-link uses are page navigations, not board file reads.
`PagesQueryModel.findPageByFilePath()` compares exact strings, while `PageNavigator` already has
line reveal support. The Browser editor can open local files and has a hard reload that bypasses
cache.

The accepted scope is needs 1 and 2 only. Need 3 (project TypeScript IntelliSense) is moved to
[US-1744](../US-1744-monaco-project-typescript/README.md). Need 4 (board-owned diagnostics markers)
is recorded as a later follow-up in Notes below; it has no task document yet.

### Current behavior verified

- `runFire()` in `src/main/board-bridge.ts` forwards any `openRawLink` href to
  `EventEndpoint.eBoardOpenRawLink` and calls `win.focus()`. It does not check the board's
  `fileSystem` grants. Preserve this permission behavior when changing the transport to RPC.
- `persephone.openRawLink()` is currently declared `void` in
  `src/renderer/editors/board/board-api.d.ts` and is fire-and-forget. It navigates a Persephone page;
  it does not return file contents to the board. `fileSystem` grants govern board file access APIs,
  not user-visible page navigation.
- `PagesQueryModel.findPageByFilePath()` in `src/renderer/api/pages/PagesQueryModel.ts` compares
  `main.filePath === filePath`. A file URL, slash-style difference, or Windows drive-letter case
  difference can therefore miss an already open page and create a duplicate unless identity is
  normalized before querying and compared canonically.
- `PageNavigator.navigatePageTo()` accepts `revealLine` and `highlightText`; its existing reveal
  path calls `TextFileModel.revealLine()`. It has no `revealColumn` option, and Monaco's current
  reveal message sets the cursor column to 1. Existing pages whose editor is not Monaco must be
  navigated through this method with the requested line so it promotes/builds the text editor before
  revealing.
- `showBrowserPage(model, { url })` in `src/renderer/editors/browser/browser-pages.ts` constructs a
  new `BrowserEditor`, sets its initial URL/tab, restores it, then adds it as a new page. In
  contrast, `openUrlInBrowserTab()` searches existing Browser pages and adds an inner tab, so it
  must not be used for board Run pages. `BrowserEditor.navigate()` updates the active internal tab;
  `BrowserEditor.webview.hardReload()` invokes the cache-bypassing Browser IPC reload.
- `PageModel.getTransient()` / `setTransient()` store runtime-only page values that are cleared on
  close or app restart.

## Implementation Plan

Task boundary: keep needs 1 and 2 together because they use one public board `openRawLink` RPC,
one normalization and renderer-reply route, and the same board-scoped request identity. Need 3 is
independent app-wide Monaco project discovery and is now US-1744. Need 4 has a separate marker
ownership and lifetime contract and is a later follow-up, not a dependency of this task.

### 1. Make board `openRawLink` a correlated request/reply

- [x] In `src/ipc/board-bridge-channels.ts`, remove `openRawLink` from `BoardFireMethod` and add it
  to `BoardRpcMethod`. Type the arguments as href plus optional `editor`, `revealLine`,
  `highlightText`, and (for Browser Run only) `reuseKey`.
- [x] In `src/board-shim.ts`, change the public method and intercepted external-anchor path from
  `fire("openRawLink", ...)` to one shared request helper around `rpc("openRawLink", [...])`,
  returning its `Promise`. Attach an internal no-op rejection handler while returning the original
  promise, so legacy callers and the fire-style anchor click that ignore it do not cause
  unhandled-rejection noise; callers that await it still receive rejection.
- [x] In `src/main/board-bridge.ts`, add `openRawLink` to `boardRpcHandlers` and let `runRpc()` route
  to it. Keep `win.focus()` for the board host window. The handler must validate the request and
  return renderer/open errors through the board RPC error path using `errMessage(error, fallback)`.
- [x] Use the existing correlated main-to-renderer transport:
  `sendToRendererForWebContents()` in `src/main/mcp/renderer-bridge.ts` sends `MCP_EXECUTE` with a
  generated request ID and resolves on matching `MCP_RESULT`; `src/renderer/api/mcp-handler.ts`
  dispatches it and sends the correlated result. Add a private `board_openRawLink` command to
  `src/renderer/api/mcp/command-registry.ts` and its handler. Main passes the normalized request
  and its trusted `entry.root` to this command, targeted to `entry.hostWebContents`; the board
  cannot supply a renderer window or page ID.
- [x] In the main `openRawLink` RPC handler, mirror `runBoardCall()` in
  `src/main/board-bridge.ts`: after `sendToRendererForWebContents()`, if the response has `error`,
  throw `new Error(response.error.message)`. `sendToRendererForWebContents()` resolves with an
  `{ error }` response for an unavailable renderer/timeout; it does not reject the transport
  promise itself. The thrown error then becomes the rejected board RPC result with its message.
- [x] Move the existing `image-view` data-URL special case from
  `RendererEventsService.handleBoardOpenRawLink()` into the new renderer command so current
  `openRawLink` behavior is retained. Keep generic editor-targeted data URLs working too, including
  `draw-view` URLs used by force-graph (`boards/force-graph/app.js:533`) and drawio-viewer
  (`boards/drawio-viewer/app.js:790`). Remove the now-unused `eBoardOpenRawLink` event type and
  subscription from `src/ipc/api-types.ts`, `src/ipc/renderer/renderer-events.ts`, and
  `src/renderer/api/internal/RendererEventsService.ts`.
- [x] Add the new member to `src/shared/board-bridge-version.ts` as `1.46.0`. Make the member
  optional/feature-detectable in board callers and document its minimum version in
  `src/renderer/editors/board/board-api.d.ts` and `assets/guides/agents/boards.md`. Update the stale
  1.44.0 prose in both files to the current compatibility version.

Before â†’ after:

```ts
// Before: BoardFireMethod; no renderer result.
openRawLink(href: string, options?: { editor?: string }): void;
fire("openRawLink", [href, options?.editor]);

// After: BoardRpcMethod; caller can await, and an ignored promise is internally handled.
openRawLink(href: string, options?: OpenRawLinkOptions): Promise<void>;
const result = rpc("openRawLink", [href, options]);
void result.catch(() => {});
return result;
```

### 2. Normalize local file identity (no permission gate)

- [x] In the renderer request handler/open pipeline, convert `file://` URLs to native local
  file-paths before opening. Do not inspect `fileSystem` grants or add a local-path authorization
  branch: existing boards depend on `openRawLink` navigating to local files outside their grants.
- [x] Normalize native file identity before lookup/open: unify separators and compare with
  `fpNormalizeForCompare()` so a file URL versus path, slash-style differences, and Windows
  drive-letter case resolve to one open page. Update `PagesQueryModel.findPageByFilePath()` to
  compare normalized identities instead of raw strings.

Before â†’ after:

```ts
// Before: runFire forwards any href unchanged; this intentionally does not enforce fileSystem.
win?.webContents.send(EventEndpoint.eBoardOpenRawLink, { href, editor, boardRoot: entry.root });

// After: local URL/path forms are normalized for page identity, without a fileSystem grant check.
const target = fileUrlToNativeFilePath(href) ?? href;
const identity = isNativeLocalFilePath(target) ? fpNormalizeForCompare(target) : target;
return sendToRendererForWebContents("board_openRawLink", { target: identity, ...options, boardRoot: entry.root }, entry.hostWebContents);
```

### 3. Carry line reveal through the normal open pipeline

- [x] In the renderer `board_openRawLink` command, use the ordinary
  `app.events.openRawLink` / `openContent` path for every URL or path, carrying `sourceId: "board"`,
  trusted `boardRoot`, `waitForPageReady: true`, editor, `revealLine`, and optional `highlightText`.
  The handler must not look up or navigate pages itself. Await `sendAsync()` and let failures
  propagate to the MCP response; do not use the old fire-event `guard()` path that consumes errors.
- [x] In `src/renderer/api/pages/PagesLifecycleModel.ts`, fix `openFile()`'s existing-page branch
  (currently it activates the page and handles only `fragment`) to pass `revealLine` and
  `highlightText` through `PageNavigator.navigatePageTo()` with `forceTextEditor: true` when a line
  or highlight is requested. Make `PageNavigator.navigatePageTo()` handle a same-file main editor
  without rebuilding/reopening it, then apply the existing `TextFileModel.revealLine()` and
  `setHighlightText()` operations. If the current page is showing a non-Monaco editor, promote/build
  its Monaco text editor before applying those same reveal operations. Keep new-page reveal behavior
  through the existing open-file hints. This makes scripts and links that pass a line to an already
  open file use the same behavior as the board request.
- [x] Do not add `revealColumn` in this task. The existing `PageNavigator.NavigatePageToOptions`,
  `TextFileModel.revealLine()`, and Monaco reveal message expose only a line; Monaco currently sets
  column 1. The board Messages panel has a column, but this task's accepted need is line navigation.
  A future column requirement would need coordinated API changes through those exact layers.

Before â†’ after:

```ts
// Before: the openFile existing-page branch activates and handles only fragments.
if (existingPage) {
    this.model.navigation.showPage(existingPage.id);
    if (options?.fragment) revealFragment(options.fragment);
    return existingPage;
}

// After: all callers use normal openFile; its existing-page branch delegates line hints
// through the navigator, which reveals the same file model or promotes Monaco if needed.
if (existingPage) {
    this.model.navigation.showPage(existingPage.id);
    if (options?.revealLine || options?.highlightText) {
        await PageNavigator.navigatePageTo(existingPage.id, filePath, {
            revealLine: options.revealLine,
            highlightText: options.highlightText,
            forceTextEditor: true,
        });
    }
    return existingPage;
}
```

### 4. Create and reuse a board-owned Run Browser page

- [x] Keep the public entry point as `persephone.openRawLink(url, { editor: "browser-view", reuseKey })`;
  require a trimmed, non-empty `reuseKey` of at most 256 characters for reuse and scope ownership by the main-supplied
  normalized `boardRoot` plus that key. The board supplies no page ID.
- [x] In `src/renderer/api/pages/PageModel.ts`, store a transient ownership value on the created
  page, keyed by the normalized board root and reuse key. In `src/renderer/api/pages/PagesQueryModel.ts`,
  find only a Browser page whose transient ownership matches both values. This prevents a board
  from selecting or navigating a user page or another board's page.
- [x] On the first Run or after the owned page was closed, create exactly one fresh Browser page
  by calling `PagesLifecycleModel.showBrowserPage({ url })`, which delegates to
  `showBrowserPage(model, { url })` in `src/renderer/editors/browser/browser-pages.ts`; that
  function creates a new `BrowserEditor` with its initial single tab and adds a new page.
- [x] On reuse, if the URL is unchanged, call `BrowserEditor.webview.hardReload()` so regenerated
  same-path HTML bypasses cache (`src/renderer/editors/browser/BrowserWebviewModel.ts:194-205`). If the URL changed, call
  `BrowserEditor.navigate(url)` on that owned page. Activate the owned page. A missing/closed page
  causes a fresh page on the next request.
- [x] Do not use `openUrlInBrowserTab()` (`browser-pages.ts:118-209`): it reuses a general Browser
  page and adds an inner tab, which is not an owned Run page.

Before â†’ after:

```ts
// Before: generic open can create another page or an inner tab in a user Browser.
await persephone.openRawLink(runUrl, { editor: "browser-view" });

// After: this board's stable key selects its private transient Run page.
await persephone.openRawLink(runUrl, {
    editor: "browser-view",
    reuseKey: "ui-constructor:run",
});
```

### 5. Update board and editor guidance

- [x] In `assets/guides/agents/boards.md`, document 1.46.0, feature detection, `openRawLink`'s
  awaitable options, intentionally ungated local navigation, reuse key scope, and error handling.
- [x] In `assets/guides/editors/board.md`, document board-initiated open-at-line and Run page use.
- [x] In `assets/guides/editors/browser.md`, document the board-owned reusable Run page and
  hard-reload behavior. Do not add project IntelliSense instructions here; that belongs to US-1744
  and `assets/guides/editors/monaco.md`.

### Per-file contract deltas

These snippets pin the intended change at each bridge/page boundary; names shown in the after
snippets are the planned interface for implementation.

| Exact file | Before â†’ after |
|---|---|
| `src/ipc/board-bridge-channels.ts` | `type BoardFireMethod = "openRawLink" \| "notify"` â†’ `type BoardFireMethod = "notify"; type BoardRpcMethod = ... \| "openRawLink";` |
| `src/board-shim.ts` | `openRawLink(...): void { fire("openRawLink", ...); }` â†’ shared request helper returns `rpc("openRawLink", ...)`, attaches `void p.catch(() => {})`, and is used by the public method and anchor interceptor. |
| `src/main/board-bridge.ts` | `runFire(..., "openRawLink", ...)` sends an event â†’ remove fire branch; `boardRpcHandlers.openRawLink` normalizes and awaits the renderer result without checking file grants; host window is still focused. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/renderer-events.ts`, `src/renderer/api/internal/RendererEventsService.ts` | `eBoardOpenRawLink` event and handler â†’ remove; the typed private renderer command handles open requests/replies. |
| `src/renderer/api/mcp/command-registry.ts` | `"call" \| "board_call"` â†’ add private `"board_openRawLink"` dispatch. |
| `src/renderer/api/mcp/board-open-raw-link.ts` *(new)* | No board RPC handler â†’ validate request, preserve `image-view` data-URL handling, pass other targets including `draw-view` data URLs through the ordinary open pipeline, resolve after the page is ready. |
| `src/shared/board-bridge-version.ts` | `"1.45.0"` â†’ `"1.46.0"`. |
| `src/renderer/api/pages/PagesQueryModel.ts` | `main.filePath === filePath` â†’ compare `fpNormalizeForCompare(main.filePath)` and normalized requested path; add board/key-owned Browser lookup. |
| `src/renderer/api/pages/PageModel.ts` | transient map unused for this feature â†’ `setTransient(runPageOwnerKey, { boardRoot, reuseKey })` on the created page. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | existing-file branch currently applies only fragments â†’ pass line/highlight hints through `PageNavigator.navigatePageTo()` with `forceTextEditor` when needed; create/reuse Run pages through lifecycle. |
| `src/renderer/api/pages/PageNavigator.ts` | same-file/reuse paths currently skip line/highlight â†’ reveal the existing model without rebuilding, or promote/build Monaco when needed, then call existing `TextFileModel.revealLine()`; no column option. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Browser exposes `navigate(url)` and `webview` â†’ use `navigate(url)` for changed URL and `webview.hardReload()` for same URL. |
| `src/renderer/editors/board/board-api.d.ts` | stale `1.44.0`; `openRawLink(...): void` â†’ `1.46.0`; typed optional options and `Promise<void>`. |
| `assets/guides/agents/boards.md` | bridge described as `1.44.0` â†’ describe `1.46.0`, feature detection, ungated navigation and Run reuse. |
| `assets/guides/editors/board.md`, `assets/guides/editors/browser.md` | no board Run/open-at-line guidance â†’ document the corresponding board workflows and ownership. |

## Concerns

- **Permission behavior â€” resolved:** `openRawLink` intentionally is not gated by `fileSystem`
  grants. It performs user-visible Persephone page navigation and returns no file contents to the
  board; existing Claude Agent and force-graph boards use local links with `fileSystem: false`, and
  torrent-viewer uses them with `fileSystem: "board"`. Preserve current local-path, `file://`,
  HTTP(S), and other-link navigation behavior.
- **Target isolation â€” resolved:** The board cannot pass a page ID. Run-page lookup uses the trusted
  board root plus board-supplied reuse key and matches transient state only on a Browser page
  created for that pair.
- **Ignored promise compatibility â€” resolved:** The shim attaches a rejection handler to the RPC
  promise while returning that same promise; old non-awaiting callers do not create an unhandled
  rejection, while new callers can await and handle errors.
- **Renderer reply errors â€” resolved:** `sendToRendererForWebContents()` returns an `{ error }`
  result rather than rejecting for transport errors; the main RPC handler checks that field and
  throws its message, matching `runBoardCall()` so the board RPC rejects with the useful message.
- **Data URLs â€” resolved:** Retain the renderer's special `image-view` data-URL handling. Pass
  editor-targeted `draw-view` data URLs through the ordinary open pipeline; force-graph and
  drawio-viewer use these to open drawings.
- **Existing non-Monaco page â€” resolved:** `PageNavigator.navigatePageTo()` with
  `forceTextEditor: true` performs the editor switch, then uses its existing reveal operation.
- **Column navigation â€” resolved for this scope:** No `revealColumn` is planned because no current
  reveal layer accepts it. US-1743 preserves line-only navigation.
- **Project TypeScript support â€” out of scope:** See [US-1744](../US-1744-monaco-project-typescript/README.md).
- **Diagnostics markers â€” follow-up only:** Need 4 remains a later board capability; this task does
  not define or implement marker ownership, clearing, or persistence.
- **Styling and errors â€” resolved:** Any UI additions must use tokens from
  `src/renderer/theme/color.ts`; return failures using `errMessage(error, fallback)`.
- **Tests â€” resolved:** Do not add unit tests or a test harness; this repository does not use them.

## Acceptance Criteria

- [ ] A feature-detecting board can await `openRawLink()` for a local file and request a line and
  optional highlight text; an already-open matching file page is activated and navigated rather
  than duplicated.
- [ ] A request for a line switches an existing non-Monaco page to Monaco before revealing it.
- [ ] Local paths and `file://` URLs continue to open without a `fileSystem` grant check; navigation
  returns no file contents to the board.
- [ ] `file://` URLs are converted to native file-paths, and normalized identity handles
  URL-vs-path form, separator differences, and Windows drive-letter case for existing-page reuse.
- [ ] The moved renderer command keeps `image-view` data URLs working and passes `draw-view` data
  URLs through the ordinary editor-targeted open pipeline.
- [ ] Each board/reuse-key pair gets a fresh Browser page with one initial tab; subsequent calls
  reuse and activate only that page, same-URL calls hard-reload, changed URLs navigate, and a closed
  page is recreated.
- [ ] No board can target an unrelated page or another board's Run page.
- [ ] The bridge is 1.46.0, its member is feature-detectable, and `boards.md`, `board.md`, and
  `browser.md` document the shipped API. Monaco project IntelliSense remains tracked by US-1744.
- [ ] `errMessage` is used for surfaced errors; no new board permission, unit tests, or test harness
  is introduced.

## Files Changed summary

| File | Planned change |
|---|---|
| `src/shared/board-bridge-version.ts` | Bump bridge version to 1.46.0. |
| `src/ipc/board-bridge-channels.ts` | Move `openRawLink` from fire to RPC and type options. |
| `src/board-shim.ts` | Return the RPC promise and internally handle ignored rejections. |
| `src/main/board-bridge.ts` | Validate/normalize the request, route to renderer, preserve focus, map renderer errors to rejected RPCs; do not check file grants. |
| `src/ipc/api-types.ts` | Remove the obsolete fire-event type for board open links. |
| `src/ipc/renderer/renderer-events.ts` | Remove the obsolete renderer event object. |
| `src/renderer/api/internal/RendererEventsService.ts` | Remove the event subscription/handler after moving its image case. |
| `src/main/mcp/renderer-bridge.ts` | No change; reuse its correlated `sendToRendererForWebContents()` transport. |
| `src/renderer/api/mcp/command-registry.ts` | Register the private board open command. |
| `src/renderer/api/mcp/board-open-raw-link.ts` *(new)* | Preserve image handling and route file/URL/draw-view data URLs through open pipeline; resolve after navigation. |
| `src/renderer/api/pages/PagesQueryModel.ts` | Compare local file identity canonically; find transient owned Browser page. |
| `src/renderer/api/pages/PageModel.ts` | Store board/reuse-key ownership in transient state. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add line/highlight reveal to its existing-file branch; create/reuse owned Run pages. |
| `src/renderer/api/pages/PageNavigator.ts` | Reveal same-file models without rebuilding; force Monaco as needed and use existing line/highlight operations. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Reuse `navigate()` for changed Run URLs and expose its existing `webview` submodel. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Reuse `hardReload()` for same-URL Run requests; no new reload implementation. |
| `src/renderer/editors/board/board-api.d.ts` | Document the 1.46.0 bridge and feature-detectable options. |
| `assets/guides/agents/boards.md` | Update version and document bridge API/ungated page navigation. |
| `assets/guides/editors/board.md` | Document open-at-line and Run page integration. |
| `assets/guides/editors/browser.md` | Document managed Run page and reload behavior. |

**Files that need no change:** `src/main/permission-policy-service.ts` (no OS permission is
introduced); `src/renderer/editors/board/board-manifest.ts` (no manifest permission is added);
`src/renderer/content/open-handler.ts` (already carries `revealLine`, `highlightText`, and
`waitForPageReady` through the open pipeline); `src/renderer/editors/shared/MonacoEditorHostView.ts`
and `src/renderer/api/setup/configure-monaco.ts` (project model/type work belongs to US-1744);
`assets/guides/editors/monaco.md` (US-1744 owns project IntelliSense guidance); UI Constructor
source/docs (read-only requesting project); test files/harnesses (not used in this repository).

## Notes

- 2026-10-31 live verification from a scratch test board (no permissions): open at line with highlight, `file:///c:/` URL dedupe, Markdown page switched to Monaco for a line jump, Run page create / reload after rebuild / navigate on a new URL / separate page per key / recreate after close, rejection messages, no unhandled rejection for an un-awaited call. It found two defects, fixed by Claude: `openUrlInBrowserTab()` (`src/renderer/editors/browser/browser-pages.ts`) added ordinary web links as tabs inside a board Run page, so it now skips pages with a board Run owner; and `openBoardRunPage()` hard-reloaded whatever tab was active, so it now reloads only when the active tab already shows the Run URL (`runUrlKey`) and otherwise navigates back to it.

- Later follow-up: add board-owned diagnostics markers for need 4 (replace/clear markers by board
  owner and file). This is intentionally not a task document yet and is outside US-1743.
- UI Constructor need 3, project IntelliSense for TypeScript units under `tsconfig.json`, is tracked
  in [US-1744](../US-1744-monaco-project-typescript/README.md).
