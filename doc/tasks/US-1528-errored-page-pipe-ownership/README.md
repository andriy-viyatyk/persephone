# US-1528: Re-establish page pipe ownership when reusing an errored media page

Status: Implemented 2026-09-27, awaiting user testing.  
Scope: Platform defect; standalone, no epic. Found during US-1526 live verification on 2026-09-26/27.

## Outcome (2026-09-27)

The live check changed the diagnosis. Reopening a source that is already open does not rebuild the
page: `PagesLifecycleModel.openFile()` finds it by file path and only shows it. So a page whose
first session request was rejected (`playerState: "error"`, empty `streamUrl`) had no path that
ever asked again. That, not a persistent owner-map gap, is why it could not be recovered; the
logged ownership error came from the first request, which ran before the page was registered.

What shipped:

- `PageModel.ensurePipeOwner()` / `setPipeOwnerRegistrar()` (`IPageHost.ensurePipeOwner?`):
  `PagesModel.attachPage()` installs the registrar, `detachPage()` and `PageModel.dispose()` clear it.
  An editor that asks before the page is attached (restore, move-in, duplicate) waits until
  `attachPage()`; release rejects the wait, so a detached page is never re-registered. A rejected
  registration is not cached, so the next request retries it.
- `VideoEditor.resolveStreamUrl()` awaits `ensurePipeOwner()` before a `{ pipe: true, pageId }`
  session. HTTP and local-file sessions are unchanged.
- New optional hook `EditorModel.onReopen()`, called by `openFile()` when the page is reused.
  `VideoEditor.onReopen()` builds a fresh pipe session for a pipe-backed source in `error` or
  `unsupported format` (a failed stream response reaches the media element as the latter).
  Playing pages and HTTP/local sources are left alone.
- `core-handlers.ts`, `board-pipe-service.ts` and `BoardWebview.ts` are unchanged; the guard stands.

Verified in the running app with a `torrent://` page (the swarm was unreachable, so the
provider itself failed; playback to `playing` was not reachable):

1. Fresh open and window-reload restore both created a session (no ownership rejection).
2. With the change stashed, reopening the link re-showed the page and kept the old session
   (`sameSession: true`); nothing retried.
3. With the change, a page forced to `error` with no session went to `loading` with a new
   session on the same page when its link was reopened.

Not reproduced: the registration race itself. Without the change, restore also got a session in
this run, so the race is timing-dependent; the wait closes it by construction.

## Goal

Allow a media page whose previous pipe-backed restore ended in `playerState: "error"` to recover when
the same source link is opened onto that page again. Preserve the main-process ownership guard: the
fix is to make page ownership registration complete and recoverable on page reuse, not to weaken the
check that prevents one renderer from driving another renderer's pipe.

## Background

### Observed behaviour and scope

The live reproduction was reached through the torrent board, but the failure is in Persephone's
page-owned media-pipe lifecycle. A source whose restore had already failed could not be recovered by
opening the same source link onto the existing page; the second attempt logged:

```text
Api Error: Error: The video pipe page is not owned by this renderer.
    at createVideoStreamSession
```

Closing every page for the source and opening it fresh produced `playerState: "playing"` with
`boardPages: 0`. That distinguishes reuse of an errored page from a source, provider, or board-page
failure. The current checkout also supports a boardless reproduction of the same class: `mneme://`
media is a platform-registered pipe source, and script-registered providers/schemes use the same
media path. HTTP and local-file media use URL/file-path sessions and do not enter the pipe-owner
guard.

### Verified ownership contract

The relevant code was read in the current checkout; line numbers below are current line references,
not the original 2026-09-26 notes.

| Concern | Current implementation | Finding |
|---|---|---|
| Main guard | `src/ipc/main/core-handlers.ts:314-324`, especially `Controller.createVideoStreamSession()` at `:319-321` | A `{ pipe: true, pageId }` request is accepted only when `boardPipeService.ownsPage(pageId, event.sender)` is true. The guard checks the page id, calling `WebContents`, and renderer liveness; it does not grant board permissions. |
| Owner map | `src/main/board-pipe-service.ts:35-83` | `registerPage()` stores `page:<pageId> → { webContents, host }`; `ownsPage()` requires the same `WebContents` and a non-destroyed renderer. `host` is intentionally irrelevant to this check. |
| IPC registration | `src/ipc/main/board-pipe-handlers.ts:11-23`; typed endpoint/API at `src/ipc/api-types.ts:126-129,295-298` and `src/ipc/renderer/api.ts:498-504` | Registration and unregistration are fire-and-forget calls from the renderer. The main handler itself is synchronous once the IPC request arrives. |
| Normal page attach | `src/renderer/api/pages/PagesModel.ts:67-106` | `attachPage()` calls `api.registerBoardPipePage(page.id)` at `:69`, installs persistence subscriptions, and assigns `page.onClose`. It does not await or retain registration readiness. |
| Page release | `src/renderer/api/pages/PagesModel.ts:114-127` | `detachPage()` unregisters at `:116`, deletes video sessions by page at `:117`, invalidates renderer pipe reads at `:118-120`, removes subscriptions, and clears `page.onClose`. |
| Board host rebinding | `src/renderer/editors/board/BoardWebview.ts:364-398`, especially `transferPort()` at `:373` | A board frame re-registers the same page id with its stable `board://` host. It does not create a second owner concept. |
| Renderer teardown | `src/main/board-pipe-service.ts:170-192` | `destroyed` and `render-process-gone` remove all owners for that renderer and reject its pending reads. |

The owner is therefore page-level, not editor-level. Replacing or disposing a `VideoEditor` does not
normally unregister the page. `PageModel.detach()` at `src/renderer/api/pages/PageModel.ts:320-352`
only removes an editor from a page; it is not `PagesModel.detachPage()`. The main guard must remain
because the page id alone is not enough to establish renderer ownership.

### Where the ordering gap occurs

`VideoEditor` can request a pipe session from `setPage()`:

- `src/renderer/editors/video/VideoEditor.ts:100-124` starts `resolveStreamUrl()` when a pipe-backed
  editor is assigned to a page and writes `playerState: "error"` when that asynchronous request
  rejects.
- `src/renderer/editors/video/VideoEditor.ts:152-190` selects `{ pipe: true, pageId }` for every
  non-HTTP, non-local, non-M3U8 source and calls `api.createVideoStreamSession()` at `:175-178`.
- `src/renderer/editors/video/VideoEditor.ts:227-270` restores the pipe first, but the page is
  still null during `restore()` for a newly constructed editor; the session request starts later
  from `setPage()`.

The page can be editor-attached before it is owner-registered:

```ts
// Before: restore/temporary-page construction
page.attach(editor);              // PageModel.attach() calls editor.setPage()
                                   // VideoEditor may now request a pipe session.
// Later, after restorePage() / all pages finish restoring:
this.model.attachPage(page);      // PagesModel.attachPage() only now sends registration.
```

This order is present in these paths:

- Session restore: `src/renderer/api/pages/PagesPersistenceModel.ts:182-385` calls `page.attach()`
  at `:324`, while `applyState()` calls `this.model.attachPage()` only at `:403`, after all
  `restorePage()` promises settle.
- Fresh page/file open: `src/renderer/api/pages/PagesLifecycleModel.ts:286-310` attaches the
  editor at `:292`, then calls `attachPage()` at `:302`. The current `VideoEditor.setPage()` has an
  initial await, so this path usually sends registration first, but no readiness contract guarantees
  that ordering.
- Duplicate and cross-window move-in: `PagesLifecycleModel.ts:701-735` and `:771-808` rebuild a
  page through `restorePage()` and then attach/register it, repeating the restore ordering gap.
- Archive and fixed-id page helpers use `addPage()` or pre-attach an editor before `addPage()`:
  `PagesLifecycleModel.ts:568-590` and `:867-892`; these must retain the same invariant even though
  they do not normally carry a pipe-backed video editor.

### What the failed restore does and does not do

The failed restore itself does not call `PagesModel.detachPage()` or remove an owner. The error-state
transition is in the `setPage()` rejection handler at `VideoEditor.ts:108-123`, after the editor has
been attached to the temporary `PageModel` but before the page-level registration is guaranteed.
`VideoEditor.restore()` has a different failure shape: if `pipeFromLink()` fails for a registered
source, `PagesPersistenceModel.restorePage()` catches the editor error at `:313-319` and drops that
editor; a page with no remaining editor is dropped at `:384-385`. That path does not leave an attached
errored video editor to reuse.

Therefore the working hypothesis is confirmed in code at the lifecycle level: the failed pipe-session
request happens before ownership registration is guaranteed; the error state does not later release
ownership. The exact main-process owner-map state after the asynchronous `attachPage()` registration
request cannot be proved from static reading alone. In particular, the observed persistent rejection
on the second open needs runtime logging around registration, unregistration, and `ownsPage()` to
distinguish a still-pending/failed registration from a later release or renderer replacement.

### Why the guard is correct

`boardPipeService.ownsPage(pageId, sender)` is the right invariant. The pipe read path at
`src/main/video-stream-server.ts:671-737` and the renderer broker at
`src/renderer/editors/board/board-pipe-handler.ts:133-206` both route bytes by page id. Removing or
loosening the sender check would allow a page id from another renderer to name and drive its pipe.
The correction belongs in page ownership readiness and reuse, not in
`src/ipc/main/core-handlers.ts`.

### Generality and boardless reachability

The defect is general to pipe-backed media, not torrent-specific:

- `VideoEditor.resolveStreamUrl()` uses the guarded `{ pipe: true, pageId }` branch for any source
  that is neither HTTP(S), a plain local path, nor M3U8. The source may come from a board provider,
  the platform `mneme` provider, or a script/provider registration.
- HTTP(S) and local-file sources use `{ url, pageId }` or `{ filePath, pageId }`, so their restore
  failures do not exercise this ownership guard. A failed HTTP restore is still a media-reuse case,
  but it is not evidence for this particular ownership defect.
- A board page is not required. The live torrent check already reached `playing` with
  `boardPages: 0`, and `mneme://<media>` is a platform source with no board frame in the path.

This is consequently a platform task. EPIC-114 is only the discovery context; US-1528 must not be
filed under that epic.

## Implementation Plan

### 1. Make page ownership registration an awaitable, idempotent page invariant

- Keep `PagesModel` as the owner of registration/release. Add one page-level readiness operation that
  sends `registerBoardPipePage(page.id)` once per current page attachment, retains the in-flight
  promise, and clears it on rejection so a later reuse can retry. A repeated registration for the
  same page and renderer must be harmless; the main `BoardPipeService.registerOwner()` map already
  has that property.
- Have `PagesModel.attachPage()` establish and retain this readiness before page/editor work can
  request a pipe session. Have `detachPage()` invalidate the readiness before unregistering, while
  preserving its existing video-session deletion and renderer-read invalidation.
- Expose the readiness only as a renderer lifecycle capability (through `PageModel`/`IPageHost` or
  the existing page lifecycle seam); do not expose the main owner map or add a permissive ownership
  query. If registration fails, the caller must receive the failure and must not create a pipe
  session under the assumption that the guard will accept it.

Before → after at the ownership boundary:

```ts
// Before: src/renderer/api/pages/PagesModel.ts
void api.registerBoardPipePage(page.id);
```

```ts
// After: conceptual shape; the single page lifecycle owner retains readiness
await this.ensurePagePipeOwner(page); // idempotent; retries a rejected registration
```

The implementation may preserve synchronous public page APIs by starting the registration at
`attachPage()` and making the pipe-session path await the retained promise. It must not rely only on
IPC message-send order.

### 2. Close the temporary-page ordering hole

- Update `src/renderer/api/pages/PagesPersistenceModel.ts` so a restored page has an owner-readiness
  promise before `page.attach(editor)` can start a `VideoEditor` session. Preserve the existing
  all-pages restore and save gate; a rejected editor restore still follows the current drop-and-carry-on
  behavior.
- Update `src/renderer/api/pages/PagesLifecycleModel.ts` for `addPage()`, duplicate, move-in, and
  fresh file-open construction. Every path that can attach an editor to a page must use the same
  readiness operation before a pipe-backed editor can create its session. Do not create a second
  board-only registration path.
- Update `src/renderer/api/pages/PageModel.ts` and, if the lifecycle capability is added there,
  `src/renderer/api/pages/IPageHost.ts`, so a main-editor replacement on an already attached page
  can re-establish ownership before the incoming editor's `setPage()` work is allowed to reach the
  session request. This is the reuse path that recovers an existing errored page.
- Update `src/renderer/editors/video/VideoEditor.ts` only to await the page lifecycle readiness at
  the point where it selects `{ pipe: true, pageId }`. Keep the existing local/HTTP fallback and
  error-state behavior. This is a general media-page consumer, not board-specific code.

Before → after at the media call site:

```ts
// Before: src/renderer/editors/video/VideoEditor.ts:164-178
const pageId = this.page?.id;
const session = await api.createVideoStreamSession(
    { pipe: true, pageId },
    settings.get("video-stream.port"),
);
```

```ts
// After: conceptual shape
const page = this.page;
const pageId = page?.id;
if (!pageId || !page?.ensurePipeOwner) {
    throw new Error("The video page is not attached to an owned renderer page.");
}
await page.ensurePipeOwner();
const session = await api.createVideoStreamSession(
    { pipe: true, pageId },
    settings.get("video-stream.port"),
);
```

The exact public method name can follow the existing page-host naming, but the invariant and call
location are fixed: registration is re-established before reuse and before every pipe-backed session
request, while the main sender guard remains authoritative.

### 3. Preserve release and renderer isolation semantics

- Leave `src/ipc/main/core-handlers.ts` unchanged. Keep the `ownsPage(pageId, event.sender)` check.
- Leave `src/main/board-pipe-service.ts` ownership matching and destroyed-renderer cleanup unchanged.
- Keep `src/renderer/editors/board/BoardWebview.ts`'s host rebinding unchanged. Board frame host
  registration and page-level media ownership are separate concerns; the fix must work when no board
  frame exists.
- Keep `src/renderer/api/pages/PagesModel.detachPage()` as the authoritative release for close and
  move-out. Do not unregister on `PageModel.detach(editor)` or on a `VideoEditor` error state.
- Audit the close-window branch in `PagesLifecycleModel.movePageOut()` and renderer teardown while
  implementing the readiness state. The existing main `WebContents` cleanup remains the backstop
  when a renderer exits before renderer-side page teardown runs.

### 4. Verify in the running application

No unit tests or test harnesses are proposed. Verify with the existing app workflow:

1. Force a pipe-backed media restore to fail, confirm the page remains with `playerState: "error"`,
   open the same source link onto that page, and confirm it reaches `playing` without an ownership
   error.
2. Repeat with the initial source opened fresh and with a page that is already playing; neither path
   may regress.
3. Close every page for the source and open it with no board page present; confirm the existing
   `boardPages: 0` behaviour remains.
4. Repeat with a non-board pipe source, such as a platform `mneme://` media link or an equivalent
   script/provider source, and confirm the same reuse recovery.
5. Confirm closing the page still invalidates the old pipe/session and that a different renderer
   cannot create a session using the old page id. Capture registration/unregistration/guard ordering
   if the persistent second-open failure remains during verification.

## Concerns

- The source establishes the registration race and proves that error state does not release ownership,
  but static reading cannot inspect the live `BoardPipeService.owners` map. Runtime instrumentation is
  required to explain why the observed second attempt still saw no owner after the eventual
  `attachPage()` call; the task should not be closed without that check.
- `api.registerBoardPipePage()` currently has no renderer-side error handling at its call sites.
  Readiness must not swallow a rejected IPC registration, otherwise the player will continue to
  surface the same misleading ownership error.
- Registration is keyed by page id and renderer, while board frames additionally bind a host. The fix
  must not treat a board host as required for ordinary pages or as a wildcard for the main video
  session route.
- Re-registration on reuse is safe only while the page remains in the current renderer. A page that
  has been detached for close or cross-window move must not be revived by a stale editor callback.
- HTTP/local media are intentionally outside this guard. Do not turn this task into a generic media
  retry feature or alter their existing fallback behavior.
- Do not change `C:/projects/persephone-boards`; the torrent board is only the discovery context.
- Do not add unit tests or a test harness.

## Acceptance Criteria

- Reopening the same pipe-backed source onto an existing errored media page re-establishes page
  ownership before `createVideoStreamSession()` and recovers to `playing` when the provider is
  available.
- The first pipe-backed open, an already-playing-page reuse, duplicate/restore, and cross-window
  move-in do not issue a pipe session before owner registration is ready.
- `src/ipc/main/core-handlers.ts` continues to reject a pipe session whose page id is not owned by the
  calling renderer; no guard weakening or renderer-id bypass is introduced.
- A failed media restore does not unregister a still-live page; page close, move-out, and renderer
  destruction still release ownership and page sessions exactly once or idempotently.
- The behavior is verified for at least one non-board pipe source and is documented as platform-wide;
  HTTP/local-file fallback remains unchanged.
- The user can reach the defect without an open board page, so the dashboard classifies US-1528 under
  Planned → *(no epic)*. EPIC-114 is referenced only as the discovery context.
- No changes are made under `C:/projects/persephone-boards`, and no unit tests or test harnesses are
  added.

## Files Changed

| File | Planned change | Status |
|---|---|---|
| `src/renderer/api/pages/PagesModel.ts` | Own an awaitable/idempotent page-owner registration and invalidate it with existing page release. | Planned |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Ensure restored temporary pages are owner-ready before pipe-backed editor work can request a session. | Planned |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Apply the same owner-readiness invariant to fresh, duplicate, move-in, and reuse construction paths. | Planned |
| `src/renderer/api/pages/PageModel.ts` | Carry the page reuse/readiness seam through editor replacement without changing editor detach semantics. | Planned |
| `src/renderer/api/pages/IPageHost.ts` | Add the narrow optional lifecycle capability only if needed to pass readiness to editor models. | Planned |
| `src/renderer/editors/video/VideoEditor.ts` | Await page ownership before pipe-backed session creation; leave HTTP/local behavior unchanged. | Planned |
| `doc/active-work.md` | Add US-1528 under Planned → *(no epic)*. | Planned |
| `src/ipc/main/core-handlers.ts` | No change; retain the renderer-ownership guard. | No change |
| `src/main/board-pipe-service.ts` | No change; retain sender matching and renderer teardown cleanup. | No change |
| `src/ipc/main/board-pipe-handlers.ts` | No change; existing registration endpoints remain the wire contract. | No change |
| `src/ipc/api-types.ts` and `src/ipc/renderer/api.ts` | No new endpoint; use the existing typed register/unregister calls. | No change |
| `src/renderer/editors/board/BoardWebview.ts` | No change; board host rebinding remains separate from page ownership. | No change |
| `src/renderer/editors/board/board-pipe-handler.ts` | No change; page/resource read routing remains intact. | No change |
| `src/renderer/content/rebuild-pipe.ts` and `src/renderer/content/resolvers.ts` | No change; source resolution is not the ownership defect. | No change |
| `src/ipc/api-param-types.ts` | No change; the existing `VideoStreamSessionConfig` already carries `pipe` and `pageId`. | No change |
| `C:/projects/persephone-boards` | No change by scope. | No change |
| Unit tests/test harnesses | None; explicitly out of scope for this project/task. | No change |
