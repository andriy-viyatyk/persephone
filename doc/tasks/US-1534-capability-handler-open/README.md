# US-1534: Capability handler pages open for any trusted board, not only bundled ones

## Goal

Allow a board capability selected from a trusted board registration to open its handler page in the caller's window when none is open, regardless of board editor kind or origin. Reuse any existing page for that board and keep the current capability request lifecycle and the Excalidraw `image.edit` behavior intact.

## Background

US-1534 belongs to [EPIC-115](../../epics/EPIC-115.md#us-1534-capability-handler-pages-open-for-any-trusted-board-not-only-bundled-ones), Phase 1. The epic's standing rules require bumping `BOARD_BRIDGE_VERSION` only when a board-visible bridge contract changes, and require invoking every changed message path twice live.

### Verified current behavior

- `custom-editor-registry.ts` reads manifests from trusted roots and enabled bundled boards, normalizes each board's `capabilities`, then registers board capability candidates with `handlerKey: boardEditorId(boardRoot)`, `origin: "board"`, and `boardRoot` (`src/renderer/editors/board/custom-editor-registry.ts:331-337, 371-372, 452-468`). The capability registration retains no editor kind or page-opening hook today. The chosen design avoids adding opener metadata to these registrations.
- A `customEditorRegistry.entries` match is not guaranteed for a capability-bearing board: entries are added only when `getBoardEditorAssociation(manifest)` is non-null (`src/renderer/editors/board/custom-editor-registry.ts:398-429`; `src/renderer/editors/board/board-manifest.ts:719-741`). Therefore the page-layer opener uses the bundled-content-host fast path only when such an entry exists with `origin: "bundled"` and `editorKind: "content-host"`; every other board, including capability-only simple boards, goes through the generic page open.
- `capabilities.ts` resolves the winning registration before calling `capabilityBus.invoke`; the bus creates the request ID, validates trust, enforces deadline, cycle/depth, payload size, outstanding-request limit and caller-page cancellation, then dispatches that exact registration (`src/renderer/api/capabilities.ts:285-335`; `src/renderer/api/capability-bus.ts:219-296, 307-365`). This is why the transport must remain behind that route.
- `board-capability-transport.ts` currently reuses only the first page whose editor has a non-null `contentHost` (`:190-200`). `boardPagesForRoot(root)` already returns all main-editor `BoardEditorModel` pages for a normalized root, without filtering by kind (`src/renderer/api/board-updates.ts:70-79`). Thus already-open `stream-host` and `simple` pages are missed by the capability transport's narrower predicate.
- When no reusable page is found, the transport builds an `IBoardIntent` from the bus-created request and directly calls `pagesModel.addBundledBoardPage` (`src/renderer/api/board-capability-transport.ts:210-224`). `PagesLifecycleModel.addBundledBoardPage` explicitly rejects anything except an enabled bundled `content-host` registration (`src/renderer/api/pages/PagesLifecycleModel.ts:306-340`). The method also has its own single-instance reuse behavior for bundled boards.
- Demo declares `demo.greet` with `editorKind: "stream-host"` in `assets/demo-board/board-manifest.json:7-19`. `boards.createDemoBoard` copies `assets/demo-board` as a template (`src/renderer/api/boards.ts:280-281`), while enabled built-ins are enumerated separately from `bundledBoardRegistry` (`src/renderer/editors/board/custom-editor-registry.ts:334-337`), so the created Demo is a regular trusted board. The same route must support any trusted board registration, whether from a user's trusted root or an installed catalog board.
- EPIC-109 commit [`8cec7474`](https://github.com/andriy-viyatyk/persephone/commit/8cec7474d424542b72a3ffc25d07a434e9e847b8) removed the `boards.openBoard(root, { intent })` dispatch from `board-capability-transport.ts` and replaced it with `addBundledBoardPage` for Excalidraw. The commit's stated reason was to create Excalidraw result pages as bundled content-host pages with the initial intent attached. EPIC-108's generic board-to-board path was `boards.openBoard(root, { intent })`.
- The generic `boards.openBoard` implementation validates the board folder, encodes a `persephone-board://` link, and routes it through `app.events.openRawLink` with `intent` in transient link data (`src/renderer/api/boards.ts:282-294`). The registered `persephone-board` scheme uses `parseVirtual` to set `url = href` and `target = "board-view"`; `resolveVirtual` keeps that target, creates a pipe descriptor with a `file` provider pointing to the virtual URL and no transformers, and creates the pipe (`src/renderer/content/builtin-schemes.ts:72-82, 191-209, 395-397, 426`). `open-handler.ts` then passes `pipe.provider.sourceUrl` as `filePath`, the pipe, `cleanForStorage(data)` as `sourceLink`, target and intent into `PagesLifecycleModel.openFile` (`src/renderer/content/open-handler.ts:41-43, 87-105`). The pipe is optional in `openFile`'s TypeScript signature, but this board-link pipeline produces and passes one; the direct lifecycle helper should do the same so the page gets the same virtual source and ownership/disposal behavior. The direct helper stays inside the caller's `PagesLifecycleModel`, so it opens in that renderer window without cross-window link routing.
- `pipeFromSourcePath(url)` routes through that same registered scheme's source-path parse/resolve hooks and returns the resolved pipe (`src/renderer/content/rebuild-pipe.ts:45-60`; `src/renderer/content/scheme-registry.ts:227-254`). It can supply the generic lifecycle helper's `file` pipe without sending a link through the event pipeline.
- `PagesLifecycleModel.openFile` checks single-instance reuse, then file-path deduplication; on the existing-file branch it activates and returns the page but does not call `setInitialBoardIntent` (`src/renderer/api/pages/PagesLifecycleModel.ts:519-551`; intent assignment is later at `:571`). The transport only calls its new opener after it found no open page for that root. A per-root in-flight open promise covers simultaneous capability requests that otherwise race through that empty-page check.
- The generic `boards.openBoard` event path does not return the `PageModel` produced by `PagesLifecycleModel.openFile`: `src/renderer/content/open-handler.ts:87-105` discards it. A later `boardPagesForRoot(root)` lookup cannot identify which page received the intent if the same root has multiple pages or another open races. The new lifecycle helper must return the exact `PageModel` from its direct `openFile` call.
- `BoardWebview` advertises `peekInitialIntent()` in the first board-frame init message, consumes it after posting, and registers the capability frame against the page (`src/renderer/editors/board/BoardWebview.ts:370-397, 405-438`). Its public `persephone.capabilities.invoke` request handler forwards the caller page ID and deadline to `app.capabilities.invoke` (`BoardWebview.ts:957-975`), and returns the invocation result over the frame channel (`:976-1002`). The opened handler therefore needs the bus-generated intent on its first frame, not a second manually dispatched request.
- The public `boards.openBoard(boardRoot, options?: { intent?: IBoardIntent }): Promise<void>` remains declared at `src/renderer/api/types/boards.d.ts:153-164`. Its intent route still transports caller-selected `requestId` metadata directly through the generic open pipeline rather than using `app.capabilities.invoke`; that path therefore does not itself perform the bus's deadline, cycle/depth, payload-size, trust-ordering, or tracked-result lifecycle. It also does not return a capability result: `BoardWebview.handleCapabilityResult` ignores frame replies with no matching pending transport request (`src/renderer/editors/board/BoardWebview.ts:867-870`).
- Excalidraw's `image.edit` and `diagram.edit` are page-producing capabilities. The transport deliberately creates a fresh result page for them rather than reusing a board page (`src/renderer/api/board-capability-transport.ts:102-109, 190-200`); this behavior must remain unchanged.
- `BOARD_BRIDGE_VERSION` is currently `1.18.0` (`src/shared/board-bridge-version.ts:1-2`). The planned change only chooses a renderer-side board page-opening route and page reuse predicate. `app.boards.openBoard` is an app scripting/MCP surface; `PersephoneBoardApi` in `src/renderer/editors/board/board-api.d.ts:436-540` does not expose it. The handler routing change does not change frame messages, board-visible APIs, result shapes, or service protocol, so this task does **not** require a bridge-version bump, even with the accepted deprecation of the separate app API overload.

### Before and after

Before, the transport hard-codes a single bundled opener:

```ts
const openedPage = await pagesModel.addBundledBoardPage(root, "json", title, intent);
```

After, one page-layer function owns the opener choice and returns the page it opened. The bundled content-host path alone applies the capability title; the generic path leaves the manifest-derived board page title untouched.

```ts
const openedPage = await pagesModel.lifecycle.openBoardHandlerPage(root, title, intent);
```

## Implementation Plan

1. [x] **Add `PagesLifecycleModel.openBoardHandlerPage`** in `src/renderer/api/pages/PagesLifecycleModel.ts`, returning `Promise<PageModel>`. It owns the opener choice: if `customEditorRegistry.entries` contains the root's board editor entry with `origin === "bundled"` and `editorKind === "content-host"`, call `addBundledBoardPage(root, "json", title, intent)`; otherwise directly open a generic board page. Do not attach opener callbacks to capability registrations or change `src/renderer/api/capabilities.ts` / `src/renderer/editors/board/custom-editor-registry.ts` for this story.
2. [x] **Open the generic board through the lifecycle directly** in the caller's renderer and return the exact page from `PagesLifecycleModel.openFile`. Encode `root` with `encodePersephoneBoardLink(root)`, then call the already-imported `pipeFromSourcePath(url)`; for this registered virtual scheme it returns the same pipe produced by `resolveVirtual`: `filePath` is `pipe.provider.sourceUrl` (the encoded URL), target is `"board-view"`, and the pipe descriptor has a `file` provider whose path is that URL and an empty transformer list. Pass the pipe because the generic link pipeline creates and passes it, even though `openFile` types it as optional. Construct the matching stored source link from `createLinkData(url, { sourceId: "app-api", target: "board-view" })`, set `url` and the pipe descriptor from `pipe.toDescriptor()`, then pass `cleanForStorage(data)` as `sourceLink` and pass `intent` in the `openFile` options. Do not forward `title` to the generic `openFile` options; `capabilityTitle()`'s `"untitled.excalidraw"` fallback is only for the bundled content-host result-page path and must not replace the generic board page title.
3. [x] **Make the transport reuse all handler-board pages** in `src/renderer/api/board-capability-transport.ts`. Keep the page-producing `image.edit` / `diagram.edit` exception. For ordinary board capabilities, select any `boardPagesForRoot(root)` page (their main editor is already a `BoardEditorModel`), activate it, attach close tracking, and dispatch to its capability frame when available. Preserve the frame-registration race guard so an unrelated page cannot claim an intent while a new page is still being built. The transport only calls its lifecycle opener after the existing-page search finds no page; `openFile`'s file-path dedupe returns an existing page without applying intent, so retain this ordering.
4. [x] **Serialize concurrent first opens by board root** in `src/renderer/api/board-capability-transport.ts` for ordinary board capabilities. `openingPages` maps the normalized root to a `Promise<void>` that resolves after both the *leader* request (the one whose intent opens the page) and its lifecycle open settle. A request that finds an entry waits on it, then re-runs the normal reuse path. If the leader's open failed and no page exists, that request opens the page itself. Followers must not attach to the new page before the leader settles. Their `capabilities:intent` message would reach the frame before its init handshake, and the shim then drops the page's initial intent. Keeping the gate until the lifecycle open also completes prevents a canceled or timed-out leader from releasing followers while its page is still being created. `image.edit` and `diagram.edit` stay out of this path.
5. [x] **Use the page-layer function from transport only** in `src/renderer/api/board-capability-transport.ts`: `pagesModel.lifecycle.openBoardHandlerPage(root, capabilityTitle(request), intent)`. Keep the pending request registered before opening so a fast first-frame handshake is observed. Attach the exact returned page and preserve existing typed error mapping, cancellation, frame matching, and intent cleanup. The transport has no board-kind or origin branch.
6. [x] **Keep `boards.openBoard({ intent })` behavior and deprecate the option.** Add `@deprecated` JSDoc to the `intent` property in `src/renderer/api/types/boards.d.ts`, directing callers to `app.capabilities.invoke(...)`. `src/renderer/scripting/ai-vision/namespaces/boards.ts:13` documents the option in its signature and summary, so update that help entry to mark the legacy route deprecated and direct callers to `app.capabilities.invoke`. Do not change runtime behavior in `src/renderer/api/boards.ts`.
7. [x] **Do not bump** `src/shared/board-bridge-version.ts` for this renderer-only routing/reuse change. Reconsider only if implementation changes a board-visible handshake, API, result, or protocol contract.
8. [ ] **Live verify through Persephone MCP `call`** after the final concurrency-gate change. Earlier checks covered the previous gate, so repeat the concurrent cold-open scenario and confirm that the current implementation resolves all requests on one page. In the `call` tool use `path: "script.execute"`, `args: [code]` (the renderer `script.execute`, not `main.script.execute`). First ensure Demo is trusted and closed; then execute this twice in one script call so the first invocation opens it and the second must reuse it:

   ```js
   const first = await app.capabilities.invoke("demo.greet", { name: "US-1534 first" });
   const second = await app.capabilities.invoke("demo.greet", { name: "US-1534 second" });
   ({ first, second, reused: first.pageId === second.pageId,
      openedInCallerWindow: !!app.pages.findPage(first.pageId) });
   ```

   `app.pages.findPage(pageId)` and `app.pages.closePage(pageId)` exist on the script `IPageCollection` API (`src/renderer/api/types/pages.d.ts:39-40, 60-61`). Expect two greeting results, `reused: true`, and `openedInCallerWindow: true`. Close the returned page with `await app.pages.closePage(first.pageId)` and rerun the same pair to cover another fresh-open/reuse sequence. Then invoke `image.edit` twice with a known valid 1x1 PNG data URL and compare `pageId`s:

   ```js
   const payload = {
       dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nVsAAAAASUVORK5CYII=",
       title: "US-1534 image.png",
   };
   const first = await app.capabilities.invoke("image.edit", payload);
   const second = await app.capabilities.invoke("image.edit", payload);
   ({ first, second, distinctPages: first.pageId !== second.pageId });
   ```

   Expect `distinctPages: true` and both pages to be Excalidraw board pages with the image. Record tool call results and page IDs. This invokes the Demo route at least four times and `image.edit` twice, satisfying the epic's repeated-path rule.

## Concerns

### Decided for this story

- **Public intent overload on `app.boards.openBoard`:** Keep its current runtime behavior for compatibility. Add `@deprecated` JSDoc to the `intent` property in `src/renderer/api/types/boards.d.ts`, pointing callers to `app.capabilities.invoke`. Update the ai-vision `boards.openBoard` help because its current signature and summary explicitly describe `intent` (`src/renderer/scripting/ai-vision/namespaces/boards.ts:13`). This preserves the public API while steering new callers to the lifecycle that returns capability results and applies deadline, trust, cycle, and cancellation checks. Later removed by user decision in US-1558.

### Files that need no changes

| File | Why |
|---|---|
| `src/renderer/editors/board/BoardWebview.ts` | Existing initial-intent handshake and capability frame dispatch already carry the request through the right lifecycle. |
| `src/renderer/api/types/io.link-data.d.ts` | `IBoardIntent` already models the one-shot initial request metadata needed by both openers. |
| `assets/demo-board/board-manifest.json` | It already declares `demo.greet` and `editorKind: "stream-host"`; this is the reproduction fixture. |
| `src/shared/board-bridge-version.ts` | No board-visible contract changes are planned, so no version bump is required. |
| `doc/active-work.md` | Its linked US-1534 entry already exists; it was explicitly excluded from this task. |

## Acceptance Criteria

- With no Demo page open, `app.capabilities.invoke("demo.greet", payload)` opens Demo in the caller's window and resolves with its result.
- A second `demo.greet` invocation reuses that same open Demo page; verify the page ID is unchanged.
- Two simultaneous `demo.greet` invocations when no Demo page is open share one newly opened page, and both requests resolve (the second uses ordinary frame dispatch after the initial-intent request).
- When a handler board already has an open page of `content-host`, `stream-host`, or `simple` kind, ordinary capability invocation reuses that page rather than opening another.
- `image.edit` retains its existing Excalidraw behavior and fresh result-page semantics.
- The transport calls one page-layer opener and contains no board-kind or origin conditional.
- The existing request deadline, trust checks, cycle/depth checks, cancellation, and result settlement remain owned by `app.capabilities.invoke` / `capabilityBus`.
- Each changed live route is invoked at least twice through Persephone MCP `call`, with request results and page reuse/page IDs recorded.
- No `BOARD_BRIDGE_VERSION` bump is made unless implementation expands the board-visible bridge contract; the current design does not.

## Live verification (2026-09-28)

Run over Persephone MCP `call` → `script.execute` against the dev build, using a fresh
`app.boards.createDemoBoard("US1534Demo", <scratchpad>)` board (stream-host, auto-trusted). The
repo's own `.persephone/boards/Demo` copy predates the `demo.greet` declaration, so it cannot be
used for this check.

- **Cold open then reuse, sequential:** four rounds (close the page, invoke twice). Every round:
  both calls resolved with the greeting, the second reused the first's `pageId`, and the page was
  in the caller's window. Cold open took about 100-270 ms; the reuse call took about 2 ms.
- **Concurrent cold open:** the first implementation failed this. With two requests and no page
  open, the follower attached to the new page and was posted as a `capabilities:intent` message as
  soon as the frame registered, which is before the init handshake. The shim's init handler
  (`src/board-shim.ts`, `if (!activeIntent && data.intent …)`) then ignored the page's initial
  intent, so the leader timed out and only the follower resolved. **Earlier fix:** `openingPages` then
  holds a promise that resolves when the *leader request settles*, not when the page opens.
  Followers wait on it and then take the ordinary reuse path; if the leader's open failed, a
  follower opens the page itself. After that fix, two rounds of three concurrent calls: all
  resolved, on one page per round.
- **Already-open page, concurrent:** two concurrent calls both resolved (this path is unchanged).
- **Excalidraw `image.edit`:** invoked twice with a 1x1 PNG. This produced two distinct pages,
  both `board-editor:<repo>/assets/boards/excalidraw`, both titled from the payload. This matches the
  existing fresh-page behaviour.
- **Re-run on the final gate** (after `/review` changed it to release `openingPages` only once
  both the leader request and the lifecycle open have settled):
  - two rounds of three concurrent cold-open calls: all resolved, on one page per round;
  - two sequential cold-open/reuse rounds: both reused;
  - a leader with a 1 ms deadline: rejected `timeout`. The page still opened, and the next two
    concurrent calls resolved on it in about 2 ms;
  - `image.edit` twice: two distinct Excalidraw pages.
- `npm run typecheck`, `npm run lint`, and `node scripts/build-prod.mjs` pass.

## Not verified

- A handler whose page is a `simple` board or a bundled content-host board other than
  Excalidraw. No such capability-declaring board is installed. The reuse path is kind-agnostic
  (`boardPagesForRoot(root)[0]`), but it was only run on stream-host and Excalidraw.
- A caller in a second window. Everything ran in the main window.
- A follower whose deadline expires while it waits for a slow leader. It is settled by the bus's
  deadline through `cancel()`, and the loop exits once the leader settles. This was read in the
  code, not run.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1534-capability-handler-open/README.md` | This task document. |
| `src/renderer/api/board-capability-transport.ts` | Reuse any board handler page; invoke `openBoardHandlerPage`; coalesce first opens by normalized root. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add `openBoardHandlerPage(root, title, intent)` returning the exact page; own bundled fast path and generic direct lifecycle open. |
| `src/renderer/api/types/boards.d.ts` | Add deprecation JSDoc to `options.intent`; preserve runtime behavior. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Mark the documented `openBoard` intent option deprecated and direct callers to `app.capabilities.invoke`. |
| `src/renderer/api/capabilities.ts` | No change; do not attach renderer-only opener callbacks to capability registrations. |
| `src/renderer/editors/board/custom-editor-registry.ts` | No change; `PagesLifecycleModel` uses its existing `entries` getter to choose the bundled content-host path. |
| `src/renderer/api/boards.ts` | No change; the legacy public `intent` behavior remains intact, and the internal path opens directly through the page layer. |
| `src/renderer/content/builtin-schemes.ts` | No change; the lifecycle helper mirrors the verified virtual-board resolver values. |
| `src/renderer/content/open-handler.ts` | No change; direct lifecycle opening returns the page instead of relying on this event handler's discarded return value. |
| `src/shared/board-bridge-version.ts` | No change; no board-frame contract changes. |
| `src/renderer/api/types/pages.d.ts` | No change; `findPage` and `closePage` already exist for the live script plan. |
| `src/renderer/api/pages/PageNavigator.ts` | No change; the new generic helper calls lifecycle `openFile` directly. |
| Capability bus test files | No existing focused test files were found for this path, and unit tests are explicitly out of scope for this task document. |
