# US-1552: Video pipe sessions use the `resource` pipe kind; delete the page-owner waiters

**Epic:** [EPIC-115](../../epics/EPIC-115.md)

## Goal

Make pipe-backed video sessions address their editor-owned content pipe through the existing opaque `resource` pipe kind, so session creation does not wait for page attachment and a video editor can stream even when it is not the page's main editor or has no page id yet. Remove the page-owner waiter mechanism while preserving host-owned board `__pipe` reads.

## Background

### Verified constraints and current behavior

- EPIC-115 places US-1552 in Phase 3, says to do it before US-1553, and directs the resource ownership transition and waiter deletion. (`doc/epics/EPIC-115.md:669-697`.) Its standing rules require checking board-visible contract changes and invoking changed message paths twice live. (`doc/epics/EPIC-115.md:33-44`.)
- The main range reader already accepts `BoardPipeKind`, id, optional host, range and abort signal; it delegates both initial and continuation reads to `boardPipeService.read()` without specialized video range logic. (`src/main/board-pipe-range-reader.ts:23-35,67-86`.) The video HTTP server currently calls `readPipeRange("page", pageId, undefined, ...)`, requiring a page id from session config. (`src/main/video-stream-server.ts:650-660`.)
- Main pipe ownership stores `{ webContents, host }`; `read()` rejects unless the request host exactly equals the registered owner's host, and current `registerResource()` requires a host string. (`src/main/board-pipe-service.ts:12-15,42-57,85-99`.) Change its type to `host?: string` so a host-less video resource matches video-server reads with `host: undefined`. Preserve `registerResource()`'s existing replacement semantics for the board IPC path, and add a separate exclusive registration method for video sessions.
- `BoardPipeKind` currently has `"page" | "resource"`. (`src/ipc/board-pipe-channels.ts:15-25`.) Board HTTP protocol routes `/__pipe/resource/<id>` to resource reads and `/__pipe/<pageId>` to page reads. (`src/main/board-protocol-service.ts:256-279`.) Page kind remains necessary for board page pipe URLs.
- `BoardWebview.transferPort()` registers a board page with its host before transfer, and board `content.open()` registers resource ids with that host before returning `/__pipe/resource/<id>`. (`src/renderer/editors/board/BoardWebview.ts:547-568,1103-1129`.) Preserve this host-bound registration and ownership behavior.
- `PagesModel.attachPage()` installs a host-less page registrar; `detachPage()` clears it, unregisters the page pipe, and removes page sessions. (`src/renderer/api/pages/PagesModel.ts:66-70,114-120`.) `BoardWebview.transferPort()` also registers that page id with the board host. (`src/renderer/editors/board/BoardWebview.ts:547-568`.) Keep `detachPage()`'s `unregisterBoardPipePage(pageId)` to release the host-bound registration; remove only the host-less attach registrar and its clear call. `PageModel` stores the registrar, caches its promise, queues unresolved waiters before attachment, resolves/rejects the waiters when registrar state changes, and guards disposed pages. (`src/renderer/api/pages/PageModel.ts:94-138`.) `IPageHost` exposes `ensurePipeOwner()`. (`src/renderer/api/pages/IPageHost.ts:55-57`.)
- The board renderer's page-kind read handler currently falls back to duck-typed `mainEditorInstance.pipe` for non-board pages, while board pages use `resolveStreamPipe()` and the `pipeUrlEnabled` gate. (`src/renderer/editors/board/board-pipe-handler.ts:133-160`.) The resource read path already looks up an opaque id directly in `contentResources`. (`src/renderer/editors/board/board-pipe-handler.ts:37-41,133-140`.)
- Video restore rebuilds a pipe before returning, but `resolveStreamUrl()` only runs after the editor is attached to a `PageModel`: `PageModel.attach()` calls `editor.setPage(this)`, whose video override starts resolution; `PagesPersistenceModel.restorePage()` attaches restored editors before returning, and `applyState()` calls `PagesModel.attachPage()` only after every page has restored. (`src/renderer/editors/video/VideoEditor.ts:100-124,272-315`; `src/renderer/api/pages/PageModel.ts:350-354`; `src/renderer/api/pages/PagesPersistenceModel.ts:257-265,313-318,381-397`.) Thus session creation occurs before `attachPage()` installs the current registrar. The new design also permits omitting `pageId`: the pipe resource id is the owner identity, while `pageId` is optional cleanup metadata.

### Decisions

- Use a video-session-specific resource id (opaque UUID), register it to the invoking renderer with `host: undefined`, and include the resource id in the session configuration. Have the main session creation path register the resource owner and create the session as one operation; this prevents a session URL from becoming usable before its resource owner exists. This follows the epic's stated `createVideoStreamSession({ pipeResourceId })` direction. (`doc/epics/EPIC-115.md:690-697`; main's existing session API and endpoint are at `src/main/video-stream-server.ts:62-94` and `src/ipc/main/core-handlers.ts:310-320`.)
- Keep renderer ownership limited to the local `contentResources` map: `VideoEditor` publishes and invalidates its pipe there, while the session layer alone registers/releases the `boardPipeService` owner. (`src/renderer/editors/board/board-pipe-handler.ts:37-41,270-285`; `src/main/video-stream-server.ts:96-120`.)
- A session can currently lose its session-map entry from `deleteSession()`, `deleteSessionsByPage()`, the idle expiry timer, and `stopVideoStreamServer()`. (`src/main/video-stream-server.ts:96-120,131-140`.) A renderer unregister call cannot reliably follow each path. Main must own registration and release together in the session layer.
- Keep `pageId` as optional metadata on the session for the existing page-close sweep and preserve the sweep in this story. `VideoEditor.dispose()` currently deletes its session and all sessions for its page, disposes its pipe and clears the URL. (`src/renderer/editors/video/VideoEditor.ts:540-559`.) `deleteActiveSession()` is also used before session replacement and currently tracks only the session id/page id. (`src/renderer/editors/video/VideoEditor.ts:180-185,193-195`.) US-1553 explicitly reserves removal of that page-wide sweep and the broader disposal repair for itself. (`doc/epics/EPIC-115.md:702-715`.) Track the active resource id for local-map invalidation on replacement and dispose; main session deletion releases the main owner.
- Main's `createVideoStreamSession` endpoint already has the invoking `event.sender`, checks page ownership for pipe sessions, and delegates to `createSession()`. (`src/ipc/main/core-handlers.ts:310-320`.) Pass that `WebContents` to the session layer; it can register the host-less owner and retain the sender for release. `boardPipeService.ownsPage()` has only this caller, so remove that method and the `core-handlers.ts` import when replacing this check. (`src/main/board-pipe-service.ts:80-83`; `src/ipc/main/core-handlers.ts:32,315`.)
- Video resource ids should use a `video-<UUID>` namespace; board content ids use `resource-<UUID>`. (`src/renderer/editors/board/BoardEditorModel.ts:686-692`.) Main must still reject any existing key: `registerOwner()` currently overwrites a same-renderer key's host, as well as replacing a different renderer's owner. (`src/main/board-pipe-service.ts:50-64`.) Use a separate exclusive method for video-session registration; do not change the ordinary board `registerResource()` IPC behavior.
- The renderer resource map is the board handler's resource-id-to-pipe lookup, with invalidation removing its memo and aborting pending reads. (`src/renderer/editors/board/board-pipe-handler.ts:37-41,133-140,270-285`.) `BoardEditorModel` already publishes into and invalidates this map on its own resource lifecycle. (`src/renderer/editors/board/BoardEditorModel.ts:687-724`.) Video can use the same mechanism by id without making its pipe discoverable through `mainEditorInstance`.
- `initBoardPipeHandler()` is initialized from `app.ts` through a dynamic import, so the resource helper module is already loaded by app startup. (`src/renderer/api/app.ts:244-245`.) Keep VideoEditor's reference dynamic (`await import("../board/board-pipe-handler")`) so the lazy video editor does not statically pull the board editor module graph into its chunk. (Dynamic editor imports are the project rule in `doc/agents-common.md`, “Critical Patterns / 1. Dynamic Imports for Editors”.)
- Retain the `page` kind: board frames still address it at `/__pipe/<pageId>`, while `/__pipe/resource/<id>` is a separate route. (`src/main/board-protocol-service.ts:256-279`.) Remove only the non-board page handler's generic `.pipe` fallback; keep its board `resolveStreamPipe()` branch and its access gate. (`src/renderer/editors/board/board-pipe-handler.ts:140-160`.)
- No board-visible contract change is indicated: the change is the internal video server's pipe ownership and keeps the board `__pipe` URL routes and IPC request/reply payload shape intact. Confirm this during implementation; if no public board surface changes, keep `BOARD_BRIDGE_VERSION` at `1.23.0`. (`src/shared/board-bridge-version.ts:1-2`; pipe payload is in `src/ipc/board-pipe-channels.ts:15-43`.)

## Implementation Plan

1. [x] Extend video pipe session configuration to carry an optional `pipeResourceId` field that is required when `pipe: true`; update `pipe`'s comment to say reads come from the resource id, not an owning page's current pipe. Keep `pageId` optional and document it as cleanup metadata only. (`src/ipc/api-param-types.ts:172-188`.) The renderer IPC and main API endpoint signatures already use this config type, so no separate API signature change is expected. (`src/ipc/renderer/api.ts:320-322`; `src/ipc/api-types.ts:252-254`.)
2. [x] Pass `event.sender` (`WebContents`) from `Controller.createVideoStreamSession()` to `createSession(config, port, owner)`, remove the `ownsPage()` check and its now-unused `boardPipeService` import, and delete `ownsPage()` from `BoardPipeService` (its only caller is this check). (`src/ipc/main/core-handlers.ts:32,310-320`; `src/main/board-pipe-service.ts:80-83`.) A pipe session must require `pipeResourceId`, not `pageId`; `pageId` becomes optional lifecycle metadata and may be omitted when the editor has no page. (`src/main/video-stream-server.ts:66-73`; `src/ipc/api-param-types.ts:172-188`.) In the session layer, call a separate collision-refusing `boardPipeService.registerResourceIfUnowned(pipeResourceId, owner)` method, retain owner/resource id on `SessionData`, and roll back only if this call's registration succeeded and anything afterward fails; collision rejection must leave the existing owner intact. Do not alter `registerResource()` replacement behavior used by the board IPC path. (`src/main/board-pipe-service.ts:46-64`; current board registration route is `src/ipc/main/board-pipe-handlers.ts:24-28`.) Make `registerResource`'s `host` optional (`host?: string`). Change the video pipe invariant and `servePipeRequest()` to resource id/kind; preserve range, chunking, cancellation and URL behavior. (`src/main/video-stream-server.ts:62-94,650-670`.)
3. [x] In `VideoEditor`, create a fresh `video-${crypto.randomUUID()}` opaque resource id for each pipe-backed session, including when `pageId` is absent; build `{ pipe: true, pipeResourceId, ...(pageId ? { pageId } : {}) }` rather than requiring `this.pipe && pageId`. Dynamically import `../board/board-pipe-handler` and publish the current pipe with `registerBoardContentResource()` before calling `createVideoStreamSession()`. Track the local resource id with the active session. Delete the `ensurePipeOwner()` await, its post-await stale check, and its now-obsolete comment; retain the pre-await request guard and the post-`createVideoStreamSession()` stale check. On stale completion, delete the session (which releases the main owner) and invalidate the local resource entry. On create failure, replacement and dispose, invalidate only the local entry; main session cleanup owns main unregister. Preserve HTTP/file and HLS behavior. (`src/renderer/editors/video/VideoEditor.ts:187-235,540-559`; `src/renderer/editors/board/board-pipe-handler.ts:270-285`; `src/main/video-stream-server.ts:96-109`.)
4. [x] Add `removeSession(id)` in `video-stream-server.ts` to abort active requests, unregister the session's resource using its retained `WebContents`, and delete the session map entry. Route `deleteSession()`, `deleteSessionsByPage()`, idle expiry, and `stopVideoStreamServer()` through it; this is the single owner-release path. Keep the renderer page-wide session sweep for this story. A later HTTP request to a removed session URL returns 404. (`src/main/video-stream-server.ts:96-120,131-140,163-177`; `src/main/board-pipe-service.ts:73-78,194-213`.)
5. [x] Delete `PageModel`'s `PIPE_OWNER_RELEASED` constant, page-pipe registrar, registration cache and waiter queue/methods; remove `IPageHost.ensurePipeOwner`; remove `attachPage()`'s registrar installation, `detachPage()`'s registrar clear and `PageModel.dispose()`'s registrar clear. Retain `pageDisposed`, which also gates deferred editor cleanup. (`src/renderer/api/pages/PageModel.ts:69,94-138,177,445-449,867-885`.) Keep `detachPage()`'s `unregisterBoardPipePage(pageId)`: it releases the host-bound page registration that `BoardWebview` installs, and remains a no-op for pages with no pipe owner. Also keep page-session cleanup and renderer page-pipe invalidation. (`src/renderer/api/pages/IPageHost.ts:55-57`; `src/renderer/api/pages/PagesModel.ts:66-70,114-120`; `src/renderer/editors/board/BoardWebview.ts:547-568`.)
6. [x] Remove the non-board page-kind fallback to duck-typed `mainEditorInstance.pipe` in `readChunk()`. Rewrite the resource-map and `registerBoardContentResource()` comments to say the map serves both BoardEditorModel's board content resources and VideoEditor's session resources. Rewrite the resource branch comment to name both publishers, and the page-branch comment to explain that page ids resolve board page pipes only; video sessions use opaque resource ids. Keep the board-only `resolveStreamPipe()`/`pipeUrlEnabled` gate. (`src/renderer/editors/board/board-pipe-handler.ts:37-41,133-160,270-274`.)
7. [x] Confirm `BOARD_BRIDGE_VERSION` remains unchanged because board-visible `__pipe` paths, messages and results do not change. Do not remove the page pipe kind or the host-bound `BoardWebview` registrations. (`src/shared/board-bridge-version.ts:1-2`; `src/main/board-protocol-service.ts:256-279`; `src/renderer/editors/board/BoardWebview.ts:547-568,1114-1129`.)

### Before → after

Current main read and intended resource read:

```ts
// Before — src/main/video-stream-server.ts:656-660
const pageId = session.config.pageId;
if (!pageId) throw new Error("The pipe video stream session has no page owner.");
const result = await readPipeRange("page", pageId, undefined, rangeHeader, signal);

// After — use the session's registered opaque resource id
const resourceId = session.config.pipeResourceId;
if (!resourceId) throw new Error("The pipe video stream session has no resource owner.");
const result = await readPipeRange("resource", resourceId, undefined, rangeHeader, signal);
```

Current page-owned video session and intended session-owned registration handoff:

```ts
// Before — src/renderer/editors/video/VideoEditor.ts:211-223
if ("pipe" in sessionConfig) {
    await page.ensurePipeOwner();
}
const session = await api.createVideoStreamSession(sessionConfig, port);

// After — publish locally, then main registers/releases the owner with the session
const pipeResourceId = `video-${crypto.randomUUID()}`;
const pageId = this.page?.id;
const pipe = this.pipe;
if (!pipe) throw new Error("The video source has no live content pipe.");
const { registerBoardContentResource } = await import("../board/board-pipe-handler");
registerBoardContentResource(pipeResourceId, pipe);
const session = await api.createVideoStreamSession(
    { pipe: true, pipeResourceId, ...(pageId ? { pageId } : {}) },
    port,
);
```

## Concerns

- **Atomicity and failure cleanup:** the session layer registers exclusively and rolls back if creation fails; its one `removeSession(id)` helper releases the owner for explicit delete, page sweep, expiry and server shutdown. Renderer paths only invalidate their local pipe map. Existing `registerOwner()` replaces owners, so video must use the new exclusive method without changing board `registerResource()` semantics. (`src/main/board-pipe-service.ts:46-64,73-78`; `src/main/video-stream-server.ts:96-140`; `src/renderer/editors/board/board-pipe-handler.ts:276-285`.)
- **Close behavior:** explicit/session-sweep deletion releases the main resource owner inside `removeSession`; `PageModel.dispose()` also awaits each editor's `dispose()`, where VideoEditor drops its local map entry. A removed session URL returns 404 `Session not found or expired`. (`src/renderer/api/pages/PagesModel.ts:101-105,114-120`; `src/renderer/api/pages/PageModel.ts:867-885`; `src/renderer/editors/video/VideoEditor.ts:540-559`; `src/main/video-stream-server.ts:96-120,170-177`.)
- **VLC:** `openInVlc()` passes `streamUrl` for all non-HLS inputs, and `streamUrl` comes from `createVideoStreamSession()`. Keep resource registration/session creation ahead of setting that URL so VLC continues to receive a usable loopback stream. (`src/renderer/editors/video/VideoEditor.ts:561-574,257-268`; `src/main/video-stream-server.ts:90-93`.)
- **US-1553 collision:** both stories touch `VideoEditor.ts`. Keep this change scoped to pipe owner identity, resource lifecycle and waiter removal. Do not consolidate the four source flows, alter `onReopen`, change recovery behavior, or remove the page-wide dispose sweep reserved by US-1553. (`doc/epics/EPIC-115.md:702-732`.)
- **Existing page-wide sweep:** `VideoEditor.dispose()` calls `deleteVideoStreamSessionsByPage(pageId)`, which will now also release the main owner for any newer editor session on the same page. This has the same user-visible effect as today because that newer session is already deleted by the sweep; US-1553 removes the sweep. (`src/renderer/editors/video/VideoEditor.ts:540-553`; `src/main/video-stream-server.ts:103-109`; `doc/epics/EPIC-115.md:702-715`.)
- **Verification evidence gap:** repository search found no `*.test.*`/`*.spec.*` source files for these paths, so no focused pipe/session unit tests are available to extend. Live repeat-request checks are required by the epic standing rules. (`doc/epics/EPIC-115.md:39-41`.)

## Live verification plan

- With MCP enabled, use `script.execute` to open the synthetic archive video with `await app.pages.openFile("<absolute-path>/media.zip!vp8.webm")`, avoiding board/torrent setup; archive-hosted media is supported by the video editor and agents can open paths through `app.pages.openFile(path)`. (`src/renderer/scripting/ai-vision/root.ts:101,303`; `assets/guides/editors/video.md:10-16,71-75`.) Use `script.execute` again to capture renderer DOM URLs with `Array.from(document.querySelectorAll("video"), (video, i) => ({ i, currentSrc: video.currentSrc }))`; the VideoEditor facade does not expose `streamUrl`. (`src/renderer/scripting/api-wrapper/VideoEditorFacade.ts:21-35,93-115`.) Repeat the MCP open/read operation twice. Create a pipe-backed VideoEditor attached as a non-main editor and confirm it also gets a `currentSrc` stream URL; the MCP PageWrapper exposes only the page's main editor. (`src/renderer/scripting/api-wrapper/PageWrapper.ts:181-198,247-258`.)
- For a trusted board frame, use MCP path `pages["<boardPageId>"].editor.evaluate("persephone.host.streamUrl()")` to obtain the documented `board://<host>/__pipe/<pageId>` URL. Then evaluate in that frame `fetch(url, { headers: { Range: "bytes=0-1023" } }).then(async r => ({ status: r.status, range: r.headers.get("Content-Range"), length: r.headers.get("Content-Length") }))` twice; confirm 206 and correct `Content-Range` each time. Repeat with a URL from `persephone.content.open()` to verify a host-bound `/__pipe/resource/<id>` resource. (`src/renderer/scripting/ai-vision/browser-automation-members.ts:5-11`; `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:218`; `assets/guides/agents/boards.md:827-835`.)
- For each captured video URL, use `curl.exe -i -H "Range: bytes=0-1023" "<currentSrc>"`; verify 206 and expected `Content-Range`/`Content-Length`. Repeat the request to the same URL after a seek/cancel to verify continuation reads; a full GET should return 200. Verify the URL intended for VLC also answers a Range request with 206; do not launch VLC as part of this story.
- Close the video page, then issue a GET to the previously captured session URL. Expect HTTP 404 (`Session not found or expired`); confirm no `ensurePipeOwner` retry or re-registration occurs.
- Restore the window with the synthetic ZIP video page. Verify the stream is requested after `PageModel.attach()` assigns `editor.page` but before `PagesModel.attachPage()`; repeat the restored stream request and a board `__pipe` read to catch ordering and repeat-request regressions. (`src/renderer/api/pages/PageModel.ts:350-354`; `src/renderer/api/pages/PagesPersistenceModel.ts:313-318,381-397`.)

## Acceptance Criteria

- [ ] Pipe-backed video sessions read `resource` by a per-session opaque resource id; resource registration and video session creation succeed as one main-process operation and support a host-less owner.
- [ ] A pipe session requires `pipeResourceId`; `pageId` is optional cleanup metadata. A non-main video editor and an editor with no page id can stream its own `this.pipe`; restored pipe-backed videos do not wait for `attachPage()`.
- [ ] The video session layer releases resource owners on explicit deletion, page deletion, idle expiry and server shutdown; failed creation rolls registration back. A video resource id already owned by any renderer/resource is rejected without overwriting it; the board resource registration path keeps its current behavior.
- [ ] `BoardPipeService.ownsPage()` and the core-handler import used only by it are removed.
- [ ] `PageModel` waiter/registrar machinery, `IPageHost.ensurePipeOwner`, page registrar installation, and generic non-board page `.pipe` fallback are removed.
- [ ] Closing/disposal invalidates that video's resource and deletes its stream session; subsequent requests to the captured URL return 404.
- [ ] `openInVlc()` still selects the resolved stream URL for non-HLS sources; verify that URL answers a range request with HTTP 206 without launching VLC. (`src/renderer/editors/video/VideoEditor.ts:561-569`.)
- [ ] Board page `__pipe` reads and board resource `__pipe/resource` reads still work with host ownership and range requests.
- [ ] `page` remains a valid pipe kind for board page reads. `BOARD_BRIDGE_VERSION` remains `1.23.0` unless implementation reveals a board-visible contract change, in which case bump it and document that change.
- [ ] The live checks above pass, including two invocations of each changed message path.

## Needs user decision

None.

## Verification results (2026-09-28)

Typecheck, lint and `node scripts/build-prod.mjs` pass. Live, in the running dev app, with synthetic
media only (a scratch `media.zip` holding `vp8.webm` and `theora.ogg`, opened as `<zip>!<entry>`,
which the video editor serves through a pipe session):

- **Restore, three times** (cold restart, renderer reload, cold restart after the review fix): the
  restored archive-entry video page came back with a `video-<uuid>` resource session and a mounted
  `<video>` at `readyState` 4, with no retry. Range `bytes=0-99` twice gave 206, an open-ended range
  gave the correct `Content-Range`, and a full GET gave 200 with the whole file.
- **External-player URL:** the session URL (what Open in VLC receives) answers HTTP range requests
  (206). VLC itself was not launched.
- **Close frees the resource, twice** (two different pages): 206 before `closePage`, then
  `404 Session not found or expired` on every later request.
- **Main owns the release:** a page-less `createVideoStreamSession({ pipe: true, pipeResourceId })`
  is accepted; a second one with the same id is refused (collision); after `deleteVideoStreamSession`
  the same id registers again, so deleting the session released the host-less owner.
- **Board `__pipe` reads unaffected:** on a US1534Demo stream-host page, `persephone.host.streamUrl()`
  (page kind) and a `persephone.content.open("mem://demo")` resource URL each answered two range
  requests with 206 and correct bytes.
- A session URL from before a renderer reload now answers 503 (its renderer-side resource entry is
  gone), where it used to keep reading off the reloaded page. Stale URLs are dead either way; its
  main owner is released at idle expiry (30 min).

### Not verified

- A video editor that is not the page's main editor: no UI path reaches one today. The code path
  no longer needs a page id (the page-less main-process check above covers the main side).
- A restored `torrent://` page (no torrent fixture used); the archive-entry pipe exercises the same
  session path.
- Launching VLC.

## Files Changed

| File | Planned change |
|------|---------------|
| `src/ipc/main/core-handlers.ts` | Pass `event.sender` to session creation; remove the page ownership check and unused service import. |
| `src/main/board-pipe-service.ts` | Make `registerResource` host optional; add collision-refusing session registration; remove `ownsPage()`, preserving board registration semantics. |
| `src/main/video-stream-server.ts` | Register/release video resource owners with sessions; route pipe reads through `resource`; centralize all removal paths in `removeSession()`. |
| `src/renderer/editors/video/VideoEditor.ts` | Publish/invalidate local per-session pipes; allow no page id; remove page-owner wait and redundant post-wait check; do not unregister main owners. |
| `src/renderer/editors/board/board-pipe-handler.ts` | Remove duck-typed non-board page-pipe fallback; update resource-map and page-branch comments for both board and video owners. |
| `src/ipc/api-param-types.ts` | Add pipe resource id and correct pipe/pageId ownership comments. |
| `src/renderer/api/pages/PageModel.ts` | Delete page pipe owner registrar and waiter state/methods. |
| `src/renderer/api/pages/PagesModel.ts` | Remove host-less registrar install/clear, but retain detach-time `unregisterBoardPipePage()` for BoardWebview's host-bound owner and preserve page-session cleanup. |
| `src/renderer/api/pages/IPageHost.ts` | Remove `ensurePipeOwner()`. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts` | **No changes**; API calls already consume `VideoStreamSessionConfig`, and resource unregister already exists. (`src/ipc/api-types.ts:252-254,300-303`; `src/ipc/renderer/api.ts:320-329,511-516`.) |
| `src/ipc/main/board-pipe-handlers.ts` | **No changes**; preserve the board resource endpoint and its existing host-bound registration semantics. (`src/ipc/main/board-pipe-handlers.ts:24-34`.) |
| `src/renderer/editors/board/BoardWebview.ts` | **No changes**; its host-bound page/resource registrations must remain. |
| `src/main/board-protocol-service.ts` | **No changes**; retain both board page and resource URL routes. |
| `src/shared/board-bridge-version.ts` | **No change expected**; board-visible API shape and protocol stay unchanged. |
| `doc/active-work.md`, `doc/epics/EPIC-115.md` | **No changes** per task instruction; user will maintain the dashboard and epic. |
| `doc/tasks/US-1557-browser-profile-network/` | **No changes** per task instruction. |
