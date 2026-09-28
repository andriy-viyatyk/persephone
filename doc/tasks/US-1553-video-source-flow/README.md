# US-1553: VideoEditor's source flow in one place; one provider-recovery helper for all editors

**Epic:** [EPIC-115](../../epics/EPIC-115.md#us-1553-videoeditors-source-flow-in-one-place-one-provider-recovery-helper-for-all-editors)

## Goal

Make every video source entry point use one source classifier and one guarded start flow, while preserving per-session video resource ownership. Share provider recovery and persisted-pipe reconstruction across editors, let an already-open video adopt the newly resolved pipe, and make board-root identity stable across Windows separator forms.

## Background

### Verified current behavior

- `src/renderer/editors/video/VideoEditor.ts` has separate pipe-source checks in `setPage()`, `onReopen()`, `resolveStreamUrl()` and `restore()`. `setPage()`, `onReopen()`, `submitUrl()` and `restore()` also make separate decisions about request generations, pipe resolution, stream-session creation and state commits. `sourceRequestId` already rejects stale completions, and `activeSessionResourceId` tracks the resource currently paired with the active session.
- Pipe-backed sessions publish `video-<uuid>` through `registerVideoSessionResource()` before `createVideoStreamSession()`. Existing stale-completion and create-error paths invalidate the resource, and `deleteActiveSession()` invalidates it on replacement. The dispose path invalidates its own resource but also calls `deleteVideoStreamSessionsByPage(pageId)`, which can delete a newer editor's session when an older editor is disposed after navigation.
- The comment above `ensurePipeForSource()` describes `resolveStreamUrl()`, so it documents the wrong method. `restore()` handles a missing scheme by reparsing `sourceLink.href` with `schemeOf()` and checking `isSchemeRegistered()` because `pipeFromLink()` currently throws an untyped `Error` when it cannot resolve a link.
- `PagesLifecycleModel.openFile()` disposes an incoming pipe as soon as it finds an already-open page, then calls `onReopen()` without giving the editor the fresh pipe. `VideoEditor.onReopen()` consequently rebuilds its own pipe. `EditorModel.onReopen` has one implementation today, in `VideoEditor`; the base signature is `(): void`.
- Recovery behavior is split across `TextFileIOModel` (a per-model deduplicated provider-error toast and a `pipe.watch()` subscription), `ImageEditor` (watch and retry `restore()` when no image was produced), and `pipe-image-src.ts` (global provider-availability subscription clears failed source keys and errors are reported locally). Video has no provider-availability watch. US-1547 made `MissingProvider.watch()` signal `"available"` after provider registry changes, which is the recovery event these consumers can share while preserving ordinary provider watch events.
- Persisted-pipe rebuilding is duplicated in `BoardEditorModel.resolveStreamPipe()` and `ensureContentPath()`, which prefer a persisted `sourceLink.pipeDescriptor` then fall back to a path, and in `VideoEditor.ensurePipeForSource()`, which rebuilds from `sourceLink.href` or the current URL. `TextEditorModel.applyRestoreData()` is not a source-link rebuild: it makes one direct `createPipeFromDescriptor(data.pipe)` call for the persisted `IEditorState.pipe`, with no href/path fallback. Leave it unchanged.
- Video source links do persist pipe descriptors when the open pipeline supplies one: `src/renderer/content/open-handler.ts` stores `cleanForStorage(data)`, and `src/shared/link-data.ts` removes the live `pipe` but retains `pipeDescriptor`; `VideoEditor.getRestoreData()` then persists the whole editor state, including `sourceLink`. Thus restoring an untrusted board source with a descriptor creates a `MissingProvider` pipe instead of failing `pipeFromLink()` with an unresolved-link error.
- Board-root identity comparisons in the requested paths are literal string comparisons. Current sites include `BoardEditorModel.editorKind`, `PagesLifecycleModel.buildEditorById()` / bundled handler lookup / handler-page lookup, and `custom-editor-registry.ts`'s display-name lookup (the epic's cited lines have moved). `fpNormalizeForCompare()` already resolves absolute paths, unifies separators and applies Windows case folding for equality.
- The backslash spelling is written to editor state by `BoardEditorModel.initFromBoardRoot(boardRoot)`, which assigns its input unchanged; `BoardEditorModel.getRestoreData()` persists `s.boardRoot` unchanged. The input comes from a decoded `persephone-board://` link in `src/renderer/editors/board/index.ts`, a parsed `board-editor:<root>` id in `PagesLifecycleModel.buildEditorById()`, or the board selection flow in `BoardInfoEditorModel`. Main `BoardTrustService.setTrust()` persists its supplied absolute path verbatim, `boardTrust.listPaths()` returns those strings, and `customEditorRegistry.refresh()` uses each returned root verbatim for entries. Thus registry/trust spelling depends on ingress and can itself be backslash or slash form. On restore, `PagesPersistenceModel.normalizeEditorDescriptor()` retains the persisted spelling because `resolvePersistedRoot()` returns a readable persisted root unchanged. Do not invent a slash spelling at restore; normalize identity comparisons, and when a registry entry is available, adopt that entry's spelling for the model root.
- The current `src/shared/board-bridge-version.ts` is `1.23.0`. This story changes renderer-side source ownership, recovery, and path identity. It does not change a board-visible API shape, a `persephone.*` member, a board service message, or the `__pipe` protocol.

### Decisions

- Classify sources with one `sourceKind(url, format)` function returning a small discriminant (`"hls"`, `"http"`, `"local-file"`, or `"pipe"`). Keep `m3u8` direct playback, HTTP headers, local-file streaming, and archive/custom-scheme pipes as distinct cases in the same start flow.
- Make `startSource(...)` own request-generation increments, source pipe adoption/rebuild, prior-session replacement, recovery-watch setup, stream URL resolution/session creation, and guarded state commits. Call it from `setPage()`, `onReopen()`, `submitUrl()` and `restore()`. Guard duplicate starts for the same URL while one is in flight, and skip a healthy source that already has a stream URL/session, so `restore()` followed by `setPage()` does not churn sessions. Explicit retries from a failed reopen or an `"available"` event bypass the healthy-session guard.
- Add `UnresolvableLinkError` in `rebuild-pipe.ts`, carrying `scheme: string | undefined` and `registered: boolean`. Throw it only after registered-scheme resolution and ordinary descriptor resolution both fail. Video uses `unknownScheme: "reject"` to preserve today's `pipeFromLink()` behavior; board path fallback uses `unknownScheme: "file"` to preserve today's `pipeFromSourcePath()` behavior. In descriptor-first video restore, an untrusted-board descriptor intentionally produces `MissingProvider`; preflight the pipe with `stat()` in `startSource()` so `MissingProviderError` reaches `reportProviderError()`, while no-descriptor unresolved links use `UnresolvableLinkError` and retain the missing-board message.
- Put `watchSourceRecovery(pipe, onAvailable)` and `reportProviderError(error, previousMessage?)` in a focused new `src/renderer/content/source-recovery.ts`. The recovery helper returns a disposer and invokes its callback only for the `"available"` event. Text and image retain separate handling for ordinary file-change events. For text dedupe, pass the model's `lastProviderError` into `reportProviderError`; the helper toasts only when the typed provider error's message differs and returns the current message for the model to retain. `pipe-image-src.ts` keeps its module-level `subscribeProviderAvailability(() => failed.clear())`: it retains no per-source pipe, so per-source watches would add eviction bookkeeping without improving recovery. That module uses the shared reporter only.
- Change `onReopen(pipe?)` to return a synchronous boolean ownership decision. `PagesLifecycleModel.openFile()` passes the newly built pipe to the hook and disposes it only when the hook declines. Video returns `true` only when a fresh pipe is supplied, the page exists, the current source kind is `"pipe"`, and `playerState` is `"error"` or `"unsupported format"`. Healthy/playing pages, HLS, HTTP and local-file sources return `false`, preserving today's disposal behavior. For an accepted pipe, `onReopen()` immediately hands ownership to `startSource()` and returns `true`; `startSource()` invalidates the prior request generation, awaits `deleteActiveSession()` to end the old session and invalidate its resource, disposes the old `this.pipe` if distinct, assigns the fresh pipe, then starts the retry. The editor owns the adopted pipe if retry later fails.
- Add `pipeFromPersistedSource(sourceLink, fallbackPath, options?)` to `rebuild-pipe.ts`. Prefer a persisted pipe descriptor when present; otherwise rebuild from `sourceLink.href`, then the fallback path. Expose an explicit unknown-scheme policy (`"reject"` or `"file"`) so VideoEditor can retain reject semantics and BoardEditorModel can retain path-as-file semantics. Replace the two BoardEditorModel rebuild branches and VideoEditor reconstruction. Leave `TextEditorModel.applyRestoreData()` unchanged because it restores one explicit `data.pipe` descriptor and has no source-link/path fallback logic.
- Keep `BOARD_BRIDGE_VERSION` at `1.23.0`: no board-visible contract changes.
- Do not add unit tests. The epic requires changed message paths to be exercised twice live; use the live verification plan below and record actual outcomes during implementation.

### Before → after

Duplicate-open pipe ownership:

```ts
// Before — src/renderer/api/pages/PagesLifecycleModel.ts, existing-page branch
pipe?.dispose();
this.model.navigation.showPage(existingPage.id);
existingPage.mainEditorInstance?.onReopen?.();

// After — a failed, page-attached pipe video may adopt; other sources decline
this.model.navigation.showPage(existingPage.id);
const adopted = existingPage.mainEditorInstance?.onReopen?.(pipe) === true;
if (!adopted) pipe?.dispose();
```

Restore-time unresolvable link handling:

```ts
// Before — VideoEditor.restore() re-parses the persisted href in its catch block
const scheme = schemeOf(persistedLink);
if (scheme && !isSchemeRegistered(scheme)) { /* show missing-board state */ }

// After — the failure carries the resolution facts
if (error instanceof UnresolvableLinkError && error.scheme && !error.registered) {
    /* show the same missing-board state using error.scheme */
}
```

Board-root identity and restored representation:

```ts
// Before — src/renderer/editors/board/BoardEditorModel.ts
customEditorRegistry.entries.find((entry) => entry.boardRoot === boardRoot)

// After — identity comparison uses the path utility
customEditorRegistry.entries.find((entry) =>
    fpNormalizeForCompare(entry.boardRoot) === fpNormalizeForCompare(boardRoot)
)
```

When a registry entry is available, use its `boardRoot` spelling for model state. While untrusted, preserve the persisted spelling and compare it through `fpNormalizeForCompare()` after trust returns; do not impose a separator form that trust/registry inputs do not guarantee.

## Implementation Plan

- [x] In `src/renderer/editors/video/VideoEditor.ts`, define `sourceKind(url, format)` and route `setPage()`, `onReopen()`, `submitUrl()` and `restore()` through one `startSource(...)`. Keep HLS direct; keep HTTP request headers from `ParsedHttpRequest`; keep local-file sessions; build pipe-backed sessions for archive/custom-scheme sources. Move request-id creation, replacement, stale checks, stream URL assignment, loading/error transitions and recovery-watch lifecycle into the shared flow. `onReopen()` returns its boolean synchronously and passes the fresh pipe into `startSource()`; that method bumps the request generation before awaiting, then deletes the active session/resource, disposes the old pipe, adopts the fresh pipe and retries in that order. Move the misplaced `resolveStreamUrl()` doc comment onto the method it describes or delete it if `startSource()` makes that method unnecessary.
- [x] In `VideoEditor.startSource(...)` and `dispose()`, preserve the US-1552 resource contract. For each pipe session, publish a unique `video-<uuid>` resource before session creation and retain its id with that session. Invalidate that exact id on stale completion, session-create failure, replacement and dispose, including failures between local publication and IPC creation. On replacement/dispose delete only this editor's `activeSessionId`; remove the page-wide sweep and the now-unused `activeSessionPageId` tracking from `VideoEditor.dispose()` so deferred cleanup cannot remove a successor's session. Keep the existing `sourceRequestId++` before dispose awaits anything, so an in-flight create detects staleness and deletes its own session. Dispose the recovery watch there too. `PagesModel.detachPage()` still calls `deleteVideoStreamSessionsByPage(pageId)` on page close, so page-close cleanup remains. Keep dynamic imports of `board-pipe-handler` so the lazy video editor does not statically pull in the board editor graph.
- [x] In `src/renderer/content/rebuild-pipe.ts`, export `UnresolvableLinkError` with `scheme` and `registered` fields and throw it from the terminal unresolved branch of `pipeFromLink()`. Preserve `unknownScheme: "file"` behavior for `pipeFromSourcePath()` and all existing successful resolution behavior.
- [x] In `VideoEditor.restore()`, replace `schemeOf()` / `isSchemeRegistered()` catch-time parsing with `UnresolvableLinkError` handling for the no-descriptor unresolved-link case. For descriptor-first restore, call `pipe.stat()` before creating the session; when it throws `MissingProviderError`, use the shared reporter, set the failed state and retain a recovery watch so trust later retries the same pipe. Preserve the actionable missing-board message for unresolved unregistered schemes.
- [x] Add `pipeFromPersistedSource(sourceLink, fallbackPath, options?)` to `src/renderer/content/rebuild-pipe.ts`. It should reconstruct a stored `pipeDescriptor` first, otherwise use the persisted source href, otherwise use `fallbackPath`; expose the caller's unknown-scheme mode (`"reject"` or `"file"`) and report a clear error if no source exists. Replace descriptor/path branching in `BoardEditorModel.resolveStreamPipe()` and `BoardEditorModel.ensureContentPath()`, plus `VideoEditor.ensurePipeForSource()`. Do not change `TextEditorModel.applyRestoreData()`; its only rebuild is the direct descriptor restore at `TextEditorModel.ts:312`.
- [x] Add `src/renderer/content/source-recovery.ts` with `watchSourceRecovery(pipe, onAvailable)` and `reportProviderError(error, previousMessage?)`. The watcher must call back only for the exact `"available"` event, return a disposer and support absent `pipe.watch`. Provider reporting must use `isProviderResolutionError()` and `errMessage()`; compare `previousMessage` to preserve TextFileIOModel's per-model toast dedupe and return the message to retain.
- [x] In `src/renderer/editors/text/TextFileIOModel.ts`, use `watchSourceRecovery()` for the `"available"` retry and preserve its ordinary file-change watch separately. Route its typed provider failures through `reportProviderError(error, this.lastProviderError)`, update `lastProviderError` from the helper result, and keep its clear-on-success behavior.
- [x] In `src/renderer/editors/image/ImageEditor.ts`, use `watchSourceRecovery()` to retry only on `"available"` and route typed provider failures through `reportProviderError()` while keeping cache fallback and generic image-load notifications. Preserve its existing retry for non-availability pipe events with a separate filtered watcher so file-change recovery remains intact without double retry on `"available"`.
- [x] In `src/renderer/editors/link-editor/pipe-image-src.ts`, route typed provider failures through `reportProviderError()`. Keep the existing global `subscribeProviderAvailability(() => failed.clear())`; there is no retained pipe to watch and no per-source watcher bookkeeping should be added.
- [x] In `VideoEditor`, watch a pipe-backed source for `"available"` only. Retry through `startSource()` only if the current request generation still matches and player state is `"error"` or `"unsupported format"`; never restart an already-playing source. Dispose the watch on source replacement and editor disposal.
- [x] In `src/renderer/editors/base/EditorModel.ts`, change the optional hook contract to `onReopen?(pipe?: IContentPipe): boolean` (using the existing pipe type import or a type-only import). Document that `true` transfers pipe ownership to the editor and `false` leaves disposal to the lifecycle.
- [x] In `src/renderer/api/pages/PagesLifecycleModel.ts`, pass the incoming fresh pipe to `onReopen()` in the already-open-page branch. Do not dispose an adopted pipe; dispose it when no hook accepts it. Retain page activation and fragment reveal behavior. Check every implementation and call site of `onReopen` after changing the signature; code search currently finds only `VideoEditor` as an implementation.
- [x] In `src/renderer/editors/board/BoardEditorModel.ts`, compare `state.boardRoot` to registry roots using `fpNormalizeForCompare()` in `editorKind` and other exact root identity checks. In `initFromBoardRoot()` and restore, if a matching registry entry exists, adopt that entry's `boardRoot` spelling; if untrusted and absent, preserve the supplied/persisted spelling. Keep original roots for URLs, display and filesystem calls.
- [x] In `src/renderer/api/pages/PagesLifecycleModel.ts`, normalize board-root identity in `buildEditorById()` (including parsed roots embedded in `board-editor:<root>` ids), `addBundledBoardPage()` and `openBoardHandlerPage()`. Do not compare the raw dynamic editor-id string when root spellings may differ.
- [x] In `src/renderer/editors/board/custom-editor-registry.ts`, normalize the root comparison in `boardDisplayName()` (the epic's cited comparison moved) and other root-keyed lookup touched by this flow. Avoid changing ownership-registration keys or board IDs; this is path identity only.
- [x] Confirm `src/shared/board-bridge-version.ts` remains `1.23.0`; the board bridge and service protocol remain unchanged. Do not change `src/main/board-pipe-handler` or its renderer counterpart's resource protocol as part of this source-flow consolidation.
- [x] Search all `onReopen` implementers/callers and all pipe rebuild call sites after refactoring. Do not add unit tests or edit `doc/active-work.md`.

## Concerns

- **Session/resource cleanup races:** source start, replacement, stale completion and dispose can interleave. Keep resource ownership paired per request, not in a shared editor dispose sweep. A stale request must never invalidate a resource id now owned by the current session; capture the request's own id in its cleanup path. Page-close cleanup remains in `PagesModel.detachPage()`.
- **Pipe ownership on reopen:** only the failed, page-attached pipe source adopts the incoming pipe. Adoption order is session/resource deletion, old-pipe disposal, fresh-pipe assignment, then retry. Every other case declines and leaves fresh-pipe disposal to `PagesLifecycleModel`.
- **Recovery watches and existing change watches:** the shared recovery watcher reacts only to `"available"`; text and image keep separate callbacks for non-availability events. `MissingProvider.watch()` attaches a delegate watch only if the delegate already exists at subscription time. If a text pipe's provider arrives later, that pipe will not receive subsequent delegate file-change events. Re-subscribing after delegate resolution is out of scope here; provider-availability recovery stays supported.
- **Provider error dedupe:** `reportProviderError(error, previousMessage?)` is stateless across owners. Text passes and updates its own `lastProviderError` so its existing per-model dedupe is preserved; other callers choose their own state lifetime.
- **Persisted source precedence:** a stored descriptor can preserve provider settings such as HTTP method/headers that a raw href cannot reconstruct. The helper prefers that descriptor and keeps caller-specific unknown-scheme behavior (`"reject"` for video, `"file"` for BoardEditorModel's path fallback). Video preflight exposes a descriptor's `MissingProviderError` before a stream session hides it behind media playback failure.
- **Path representation:** neither trust nor registry storage guarantees forward slashes; both preserve the spelling supplied at their input. Keep original spelling for display and I/O, use `fpNormalizeForCompare()` at every identity comparison (including embedded editor-id roots), and adopt a matching registry entry's spelling when one exists. No separator rewrite or new utility is needed.
- **Board bridge version:** resolved at planning time: keep `BOARD_BRIDGE_VERSION` at `1.23.0`; reconsider only if implementation changes a board-visible member, result shape or service protocol.
- **Live verification:** no code is implemented in this task-document turn. The checks below are required during implementation, including repeated requests on changed paths per EPIC-115's standing rule.

## Live verification plan

- Open and play a video from a local file; verify the stream URL works and seeking/range reads continue to work.
- Submit an HTTP URL and an HTTP cURL request through `submitUrl()`; verify the request URL and headers survive the unified source flow.
- Open an HLS `.m3u8` source; verify it remains direct HLS playback without creating a video stream session.
- Open an archive-pipe source such as `media.zip!vp8.webm`; verify it streams through a `video-<uuid>` resource. Repeat a range request to the already-open source.
- Exercise `submitUrl()` separately with local, HTTP and pipe-backed inputs, including a replacement while an earlier source request is pending; verify only the latest request commits.
- Use next-track navigation from a source provider. Verify deferred disposal of the old VideoEditor leaves the new editor's video session and resource usable.
- Reopen an already-open failed pipe-backed video page. Verify the lifecycle passes the fresh pipe, `VideoEditor` adopts it, and the page retries without rebuilding a second pipe.
- Open text, image and video pages backed by a board provider while the board is untrusted, then trust the board. Verify each page recovers through the shared availability watch and provider error reporting does not spam duplicate notifications. For text/image/video repeat the relevant read or stream request twice on the same open page.
- Restore a stream-host board page while untrusted, then trust it. Verify the persisted `boardRoot` spelling may remain as saved, normalized identity matches the newly trusted registry entry, `BoardEditorModel.editorKind` becomes `stream-host`, and `persephone.host.streamUrl()` succeeds; issue a range request twice to the same page.
- Close a page with an active video session. Verify `VideoEditor.dispose()` invalidates only its own resource while `PagesModel.detachPage()` still performs the page-close `deleteVideoStreamSessionsByPage()` sweep. Dispose during an in-flight session create and verify the incremented `sourceRequestId` makes that request delete its own stale session; verify the recovery watch is disposed.

### Implementation verification outcome

- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings.
- Live source-flow verification: not run. The running app had no open video or provider-backed page, and the repository contains no video fixture; no trusted board-provider source was available to exercise recovery and repeated range requests.
- No unit tests, test harnesses, or production build were run.

## Live verification (2026-09-28)

Dev build, driven over the Persephone MCP with synthetic fixtures for local files, archive pipes,
and the Range Provider Test board (a 1 KB VP8 clip and a zip holding it plus an Ogg clip). The
listed local, HTTP, archive and board-provider paths were exercised twice; HLS used a public test
stream.

- **Local file and archive pipe:** both open and play (readyState 4). The archive page carries a
  `video-<uuid>` resource id.
- **Healthy page reopened:** opening either link again leaves the session id and resource id
  unchanged. `onReopen` declines, and the lifecycle disposes the fresh pipe.
- **Failed page reopened:** with the archive page forced to `error`, reopening its link adopts the
  fresh pipe (a different instance from the old one), creates a new session and a new resource id,
  and plays. This worked on both runs.
- **`submitUrl`:** a plain HTTP URL, a cURL command with an `x-test` header (the test server
  received the header), the archive path and the local path were each submitted twice on one page,
  and each run produced a fresh session. HTTP and local runs had no pipe; the archive run had a pipe
  and a resource id.
- **HLS:** a public mux test stream plays directly with no session. Resubmitting the *same* HLS URL
  leaves `playerState` at `loading`, because `streamUrl` does not change and the player does not
  reload. The code before this story did the same, so this is not a regression.
- **Next-track navigation:** navigated in place (`openRawLink` with `pageId`, as `navigateToTrack`
  does) between local tracks and between archive entries, twice each. After the old editor was
  disposed, the new editor's stream still answered `206` to a ranged fetch.
- **Late board provider:** opened video, text, image and stream-host board pages from `rangetest://`
  links. Then untrusted the board, restarted the app, and trusted it again. Two cycles. Before trust,
  video was in `error` on a `MissingProvider` pipe, text had its provider error, and the board was
  `simple`. After trust, video had a new session and resource on its own, text reloaded its 300
  characters, and the board was `stream-host`.
- **Backslash board root:** in the second cycle the board page's `boardRoot` was persisted in
  backslash form while untrusted. After trust it was still backslash and `editorKind` was
  `stream-host`. `persephone.host.streamUrl()` from the board frame then answered two ranged fetches
  with `206`, twice.

**Defect found and fixed during verification.** The first trust cycle killed the renderer. The text
recovery callback called `TextFileIOModel.restore()`, and `restore()` synchronously re-runs
`setupWatch()`, which removes and re-adds an availability listener. `signalProviderAvailability()`
iterated the live listener `Set`, so it visited each new listener in the same pass and never ended.
Two fixes: the text callback now calls `onFileChanged()`, as before this story, and `registry.ts`
iterates a snapshot of the listeners.

### Not verified

- **Image recovery after trust:** the image page kept a cached copy, so there was no visible failure
  to recover from.
- **Thumbnail recovery (`pipe-image-src`):** only its toast moved to `reportProviderError`. The
  recovery path did not change and was not re-run.
- **Old resource released on replacement:** the renderer's resource map is not reachable from a
  script (a module imported by path is a separate instance), so this was not checked. The code path
  (`deleteActiveSession`) is unchanged from US-1552.

## Acceptance Criteria

- [ ] `sourceKind(url, format)` and `startSource(...)` are the single classification/start flow used by `setPage`, `onReopen`, `submitUrl` and `restore`; HLS, HTTP/cURL, local files, archive pipes and custom provider pipes keep their existing intended behavior.
- [ ] Every video pipe-session path pairs local resource publication with invalidation on stale request, create failure, replacement and dispose. Disposal deletes only the current editor's session and resource; it does not sweep sessions by page id.
- [ ] The misplaced VideoEditor comment is corrected, and restore consumes typed `UnresolvableLinkError` details rather than reparsing the scheme.
- [ ] `onReopen(pipe?)` returns `true` only for a page-attached, failed pipe source (`error`/`unsupported format`). It ends that editor's session/resource, disposes the old pipe, adopts the fresh pipe and starts recovery in that order. Healthy/playing, HLS, HTTP and local-file sources return `false`, so lifecycle disposes the fresh pipe. All hook implementations and call sites use the new contract.
- [ ] Text, image and video use shared `watchSourceRecovery()` and `reportProviderError()` helpers; late provider registration retries a failed source while preserving existing file-change, cache fallback and error behavior. `pipe-image-src.ts` uses the shared reporter and retains its existing global provider-availability subscription.
- [ ] `pipeFromPersistedSource(sourceLink, fallbackPath, options?)` replaces persisted-source reconstruction in both `BoardEditorModel` paths and `VideoEditor`, preserving descriptor-first reconstruction and each caller's unknown-scheme policy. `TextEditorModel.applyRestoreData()` remains a direct descriptor restore because it has no href/path fallback logic.
- [ ] Board-root comparisons in `BoardEditorModel`, `PagesLifecycleModel` and `custom-editor-registry.ts`, including roots embedded in `board-editor:<root>` ids, use normalized identity. A trusted registry match supplies its spelling to the model; untrusted restore preserves the saved spelling without blocking stream-host recognition after trust.
- [ ] `BOARD_BRIDGE_VERSION` remains `1.23.0`; no board-visible API or service protocol changed.
- [ ] The live verification plan passes, including two invocations of changed message paths on the same already-open page. No unit tests are added.

## Files that need no changes

- `src/main/video-stream-server.ts`, `src/main/board-pipe-service.ts`, `src/ipc/main/core-handlers.ts`: US-1552 already owns video-session resource registration/release in main; this story preserves that contract and only changes renderer source orchestration.
- `src/renderer/editors/board/board-pipe-handler.ts`: its `contentResources` map already publishes, reads and invalidates video session resources; this story keeps that interface.
- `src/ipc/board-pipe-channels.ts`, `src/main/board-protocol-service.ts`, `src/shared/board-bridge-version.ts`: board page/resource pipe kinds and public payloads are unchanged.
- `src/renderer/content/registry.ts`: retain its typed provider errors and `MissingProvider.watch()` availability event; the shared recovery helper composes that existing behavior.
- `src/renderer/editors/text/TextEditorModel.ts`: its `applyRestoreData()` makes one descriptor-based `createPipeFromDescriptor(data.pipe)` call and has no source-link/path fallback branch to consolidate.
- `src/renderer/api/pages/PagesPersistenceModel.ts` and `src/renderer/core/utils/file-path.ts`: do not invent a canonical separator spelling during restore; use normalized comparison and matching registry spelling, so no restore rewrite or new path helper is planned.
- `src/renderer/api/pages/PagesModel.ts`: `detachPage()` already calls `deleteVideoStreamSessionsByPage(pageId)` on page close, so removing the duplicate sweep from `VideoEditor.dispose()` does not remove page-close cleanup.
- `src/renderer/editors/video/video-types.ts` and the VPlayer view: format detection and media rendering remain the existing implementation; source orchestration changes stay in `VideoEditor`.
- `doc/active-work.md`: user explicitly reserved this dashboard edit.
- `doc/epics/EPIC-115.md`: the epic already lists US-1553; this task plan links to it without changing the epic.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1553-video-source-flow/README.md` | Record verified current behavior, decisions, implementation steps and live checks. |
| `src/renderer/editors/video/VideoEditor.ts` | Centralize classification/start, adopt reopened pipes, watch provider recovery, and scope resource/session cleanup to this editor. |
| `src/renderer/content/rebuild-pipe.ts` | Add typed unresolved-link errors and descriptor-first persisted-source reconstruction. |
| `src/renderer/content/source-recovery.ts` | **New.** Share `"available"`-only pipe recovery watches and typed provider-error reporting with per-owner dedupe input. |
| `src/renderer/editors/base/EditorModel.ts` | Define boolean pipe-ownership contract for `onReopen(pipe?)`. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Transfer a fresh pipe to a reopening editor and normalize board-root lookup identity. |
| `src/renderer/editors/text/TextFileIOModel.ts` | Use shared recovery/watch helpers while preserving ordinary file watches and dedupe state. |
| `src/renderer/editors/image/ImageEditor.ts` | Use shared recovery/watch helpers for image source retry. |
| `src/renderer/editors/link-editor/pipe-image-src.ts` | Use the shared provider-error reporter while keeping its registry subscription for recovery. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Use persisted-source helper in both rebuild paths and normalize board-root identity. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Normalize root-keyed lookups without changing registry ownership keys. |
| `src/shared/board-bridge-version.ts` | **No change expected**; verify it stays `1.23.0`. |
| `src/main/video-stream-server.ts`, `src/main/board-pipe-service.ts`, `src/ipc/main/core-handlers.ts`, `src/renderer/editors/board/board-pipe-handler.ts` | **No changes**; retain US-1552 ownership and pipe protocol. |
| `doc/active-work.md`, `doc/epics/EPIC-115.md` | **No changes**; the user will maintain the dashboard and the epic already lists this story. |
| `src/renderer/editors/text/TextEditorModel.ts`, `src/renderer/api/pages/PagesPersistenceModel.ts`, `src/renderer/core/utils/file-path.ts` | **No changes**; descriptor restore needs no source helper, and board identity is fixed with normalized comparisons plus registry spelling adoption. |
