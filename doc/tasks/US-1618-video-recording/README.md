# US-1618: Record video of the Persephone window

## Goal

Let a user or an automation agent record the Persephone window, the active page, or the active page's main editor area, then optionally review the result in the built-in video player. A recording remains temporary until the user saves it with **Save as…** or discards it; an agent that wants to keep its result copies the returned file elsewhere.

## Background

### Existing UI and page ownership

- `src/renderer/ui/app/HeaderQuickSettingsPopover.ts:52-53,67-82` constructs the two existing snip rows with one `onSnip(hideWindows)` callback. The popover closes after invoking it. Add a separate Record row and region-choice step; do not overload the boolean snip contract.
- `src/renderer/ui/app/MainPageView.ts:19-26,37-67,113-131` owns `runSnip`, the popover callback and the custom header. `buildHeader()` appends the minimize, maximize/restore and close controls in that order at line 120. Put recording controls in a new header host immediately before the minimize control.
- The agent-call surface already exposes `window.screen` through `src/renderer/api/window-screen.ts` and `src/renderer/scripting/ai-vision/namespaces/window-screen.ts`; its `$help` is `WINDOW_SCREEN_HELP`, and `describeWindowScreen()` lists its members. Add a nested `recording` node there, following the `IAiWindowScreen` type contract in `src/renderer/api/types/window.d.ts`. `src/renderer/api/types/*.d.ts` are the checked-in source types that feed the editor-types bundle; update the matching scripting guides (`assets/guides/scripting/api/window.md`, `assets/guides/agents/pages.md`, `assets/guides/agents/browser.md`, `assets/guides/mcp-setup.md`, and `assets/guides/scripting/api/index.md`) so agents know how to record and retrieve a result.
- The page collection's active page is `state.ordered[state.ordered.length - 1]`, as used in `src/renderer/ui/app/PagesView.ts:38-51` and `src/renderer/api/pages/PagesQueryModel.ts:57-59`. `src/renderer/components/page-manager/PageSlot.ts:18-19` sets `data-name="page-slot"` and `data-page-id`; `src/renderer/ui/app/PageContentView.ts:189-190` marks its main editor container `[data-name="page-editor"]`. The stable capture target selector is therefore `[data-name="page-slot"][data-page-id="<activePageId>"] [data-name="page-editor"]`.
- `doc/architecture/ui-element-contract.md` documents `data-name` as the shell addressing convention and `page-editor` as the active page's editor container. Use these markers rather than styling classes. Resolve the selector at recording start and observe it while recording because pages can be changed or closed.

### IPC, permissions, capture and output

- `src/main/snip-service.ts:16-60` hides all application windows only for screen snips that must exclude Persephone, waits 200 ms, captures, then restores windows in `finally`. Window recording must not reuse this hide/restore flow because the window itself is the source.
- The snip IPC chain is `src/ipc/renderer/api.ts:316-318` → `Endpoint.startScreenSnip` in `src/ipc/api-types.ts:77` → `src/ipc/main/core-handlers.ts:316-319,459` → `startScreenSnip()`; `src/ipc/main/endpoint-registry.ts:19-34` applies `guardIpcSender` to every `bindEndpoint`. Add recording endpoints through this typed registry and preserve sender authorization.
- `src/main/permission-policy-service.ts:31,214-218,247-251,309` denies main-frame app-session `media` because `APP_ALLOW` excludes it, and independently denies display capture at line 309. A renderer `getUserMedia()` desktop-video request therefore needs a narrow permission exception. `package.json:37` pins Castlabs Electron 43.0.0; `node_modules/electron/electron.d.ts:2809` declares `BrowserWindow.getMediaSourceId(): string`. Electron's [desktopCapturer API](https://www.electronjs.org/docs/latest/api/desktop-capturer/) identifies `getUserMedia` as the capture consumer; its [source structure](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source) says a source id is usable as `chromeMediaSourceId`. Use the requesting Persephone `BrowserWindow`'s `getMediaSourceId()` through a recording-only main IPC request, then `navigator.mediaDevices.getUserMedia()` with Electron's desktop `chromeMediaSource` / `chromeMediaSourceId` mandatory constraints in the renderer.
- Keep `getDisplayMedia` refused. Add a short-lived, one-shot permission grant keyed by `webContents.id`: `recording-service` arms it immediately before returning the window source id; `permission-policy-service` permits only an app-session main-frame `media` request for that id whose `mediaTypes` contains no audio (a `chromeMediaSource: "desktop"` request arrives with an empty `mediaTypes` on Electron 43 — verified live). The permission-check handler may authorize only `mediaType === "video"` while the same unexpired grant is armed; consume the grant in the request handler, and expire it after a few seconds if unused. No microphone/audio permission or web-content exception is added. Verify the actual permission event shape and live path in the installed Electron 43 runtime.
- Main data-path resolution already exists: `src/main/utils.ts:40-47` exports `getDataFolder()` as `<app.getPath("userData")>/data`, and `preparePath()` at lines 6-15 creates directories. Use a dedicated `recordings` subdirectory under this helper, not the OS temp folder. The renderer already has `fs.resolveDataPath(relativePath)` in `src/renderer/api/fs.ts:451-458` (backed by `<userData>/data` at lines 27-35); call `fs.resolveDataPath("recordings")` to identify recorder-owned paths without adding a folder-path IPC endpoint. `src/renderer/api/fs.ts` initializes before pages are restored. Main-process downloads show the existing temp/save/copy/cleanup pattern in `src/main/download-service.ts:206-224,290-320`.

### Video editor lifecycle

- `src/renderer/editors/video/index.ts:8-24` creates the video editor; when passed a path, it seeds `filePath`, `inputText`, `url`, format and loading state. `src/renderer/editors/base/editor-matchers.ts:141-143` routes recognized video extensions to `video-view`.
- `src/renderer/api/pages/PagesModel.ts:237-251` opens a path through `openRawLink` and returns its page; `src/renderer/api/pages/PagesLifecycleModel.ts:621-777` creates and attaches a matching editor. Opening a finalized `.mp4`/`.webm` recording with `pagesModel.openFile(recordingPath)` therefore uses the existing player path and playback restore flow.
- `src/renderer/editors/video/VideoEditor.ts:31-79,88-95` defines the persisted video state and `VideoEditor`; it already has a transient `streamUrl`, and sets `skipSave = true`. `src/renderer/editors/video/VideoView.ts:82-84,167-175` owns a `PageToolbarView`; toolbar actions can be supplied through its existing toolbar slots. `VideoEditor.startSource()` (line 191 onward), `submitUrl()` (line 284) and `restore()` (line 303) resolve the source URL for playback. `src/renderer/api/pages/PagesPersistenceModel.ts:149-179,410-435` persists open page descriptors and restores them, so temporary status must be derivable after restart. Treat a file as a temporary recording only when its normalized parent path equals `fs.resolveDataPath("recordings")` and its basename matches the recorder-generated prefix and supported video extension. `src/renderer/core/utils/file-path.ts:252` exports `fpNormalizeForCompare()` for path comparison. This keeps Save as… / Discard available on restored recording pages while leaving other videos unaffected.
- `src/renderer/api/fs.ts:335-340,375-379,484-496` provides delete, copy, and Save dialog helpers (`fs.delete`, `fs.copyFile`, `fs.showSaveDialog`). A Save as… action can copy to the chosen destination and retarget the editor to the saved file; Discard deletes the owned temporary file and closes that video page.

### Before → after behavior

```text
Before: Quick settings → Snip Screen | Snip Persephone | service switches
After:  Quick settings → Snip Screen | Snip Persephone | Record… | service switches
        Record… → Full window | Active page | Main editor area

Before: Header → … | Minimize | Maximize/restore | Close
After:  Header → … | [recording controls when active] | Minimize | Maximize/restore | Close
```

```text
Before: Video toolbar has the normal player controls only.
After:  Recorder-created temporary recording → Save as… | Discard
        Ordinary video file → unchanged normal toolbar.
```

```typescript
// Before
interface QuickSettingsProps { onSnip: (hideWindows: boolean) => void; }

// After
type RecordingRegion = "window" | "page" | "editor";
interface QuickSettingsProps {
    onSnip: (hideWindows: boolean) => void;
    onRecord: (region: RecordingRegion) => void;
}
```

The public automation contract is attached to the existing app-window host, alongside screenshot:

```typescript
window.screen.recording.start({ region: "window" | "page" | "editor", openPlayer?: boolean });
window.screen.recording.pause();
window.screen.recording.resume();
window.screen.recording.stop(); // { path, durationMs, mimeType, width, height }
window.screen.recording.cancel();
window.screen.recording.state; // { status: "idle" | "ready" | "recording" | "paused", elapsedMs, region?, last? }
```

Agent `start()` prepares and begins capture in one call; it does not wait for a header Start click. Its `openPlayer` default is `false`; the user UI path opens the player by default. The shared header controls remain visible for both origins, and a user can pause or stop an agent-started recording.

## Implementation plan

### Progress

- [ ] 1. Typed IPC, recording service, and one-shot media permission grant. Implementation is in
  place; the installed Electron permission-event shape still needs live confirmation.
- [x] 2. Quick-settings Record action and region selection.
- [ ] 3. Shared renderer capture state machine and MediaRecorder pipeline. Implementation is in
  place; playable output and crop/border alignment still need live confirmation.
- [x] 4. Header controls and page/window lifecycle handling.
- [x] 5. Temporary recording Save as… and Discard actions.
- [x] 6. Seven-day cleanup and partial-file cleanup.
- [x] 7. `window.screen.recording` API, types, and guides.
- [x] Run requested typecheck, lint, and production build; fix findings.
- [ ] Live verification in a separate app window. The configured Persephone MCP endpoint at
  `http://127.0.0.1:7865/mcp` did not respond, so capture permissions, playback, and crop alignment
  remain unverified live.

1. **Add the typed capture/write IPC contract**
   - In `src/ipc/api-types.ts`, add typed endpoints for beginning a recording, appending a chunk, finalizing, and cancelling. Add shared request/result types in `src/ipc/api-param-types.ts` (or a dedicated `src/ipc/recording-ipc.ts` if the contract warrants its own module).
   - In `src/ipc/renderer/api.ts`, expose corresponding renderer methods following `startScreenSnip()` and `createVideoStreamSession()` patterns. In `src/ipc/main/core-handlers.ts`, bind each endpoint via `bindEndpoint` and delegate to a new `src/main/recording-service.ts`.
   - Begin accepts only one of `window | page | editor` and returns a generated recording id, the requesting window's `getMediaSourceId()`, and the generated temporary path. The renderer chooses a supported MIME type and supplies only the selected `.mp4` or `.webm` extension when finalizing; it never supplies an arbitrary directory or path. Main stores each recording's owner `webContents.id`, generated path, write handle, status and serialized write chain; every chunk/finalize/cancel verifies owner and active state. Create the directory with `preparePath(path.join(getDataFolder(), "recordings"))`. Append each binary `MediaRecorder` chunk in order; close/flush on finalize; unlink on cancel or failed start. Do not hold the whole recording in renderer memory.
   - Keep recording ownership per BrowserWindow, shared between UI and agent calls. There can be only one recording in a window. A second start while `ready`, `recording`, or `paused` must reject with a clear already-active error. Handle duplicate starts and stale ids as explicit errors. On `webContents` `render-process-gone` or destruction, cancel its active recording and delete the partial file; do not expose an interrupted file as a completed recording.
   - In `src/main/recording-service.ts`, arm the short-lived app-media grant in `src/main/permission-policy-service.ts` for the requesting `event.sender.id` immediately before returning `BrowserWindow.getMediaSourceId()`. In `permission-policy-service.ts`, allow an app-session main-frame `media` request only when the grant exists, the requester id matches, and `(details as Electron.MediaAccessPermissionRequest).mediaTypes` contains only `"video"` or is empty (desktop capture reports `[]`); consume it when the permission request is granted. In `handleCheck`, allow only `mediaType === "video"` for that same still-armed, unexpired id, without consuming before the corresponding request arrives. Expire grants after a few seconds and clear them on owner destruction/cancel. Keep the current `setDisplayMediaRequestHandler(...callback({}))` and all existing app/webview denials unchanged.

2. **Add the Record action and region choice**
   - In `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, add a Record row adjacent to the two snip rows and give the view a distinct `onRecord(region)` callback. Preserve `onSnip(hideWindows)` as-is. Present three clear actions: **Full window**, **Active page**, **Main editor area**. Use the existing popover/button styling conventions in `HeaderQuickSettingsPopover.css` and close the popover when a region is selected.
   - In `src/renderer/ui/app/MainPageView.ts`, pass the new callback. Resolve the active page from `pagesModel.query.activePage` or the exact `ordered`-last semantics already used by `PagesView`. For page/editor capture, require a live active page and visible target; show a notification and do not begin if there is no page, the active page has no editor area, or its slot has no layout box.

3. **Capture in the renderer, encode with MediaRecorder**
   - Implement a shared per-window recording model/controller under `src/renderer/api/` (for example `src/renderer/api/window-recording.ts`), consumed by both `WindowScreen.recording` and `MainPageView`; do not make the UI the owner of the active capture. Keep `src/renderer/ui/app/MainPageView.ts` as a view/controller adapter that subscribes to shared state. On region selection from UI, request the main-process session, acquire the returned window source with `navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId, maxFrameRate: 30 } } })`, prepare it, and show **Start**, **Cancel** and elapsed time. UI Start begins capture; agent `recording.start()` performs preparation and starts `MediaRecorder` immediately. Both origins use the same start/pause/resume/stop/cancel state machine and single-window lock. Do not call `getDisplayMedia`.
   - API `start({ region, openPlayer })` defaults `openPlayer` to `false`; the UI path sets it to `true`. Store that choice on the active session. `stop()` finalizes the file and returns `{ path, durationMs, mimeType, width, height }`; it opens the video player only when the session's `openPlayer` is true. Keep the window's most recent finished result (`last`, with `stoppedBy: "user" | "agent" | "page-closed" | "window-close"`) on the shared model. If the user stops an agent-started recording before the agent calls `stop()`, a subsequent agent `stop()` returns that `last` result (the agent still needs the path to publish it) as long as no newer recording has started; with no active session and no `last` result it rejects with a clear `No recording is active.` error. `last` is cleared when a new recording starts or its file is discarded. A start during any active/ready session rejects with an explicit already-active error. Agent `pause()`/`resume()` and UI buttons control the same session. `state` is a read-only snapshot with `status: "idle" | "ready" | "recording" | "paused"` and `elapsedMs` (plus the active region when non-idle).
   - For agent `page`/`editor` capture, resolve the active page at the instant `start()` is called, exactly as the UI does; bind the recording to that page id and target. Do not retarget if automation switches pages mid-recording.
   - For full-window capture, record the window video track directly. For page/editor capture, create a fixed-size canvas at recording start, draw from a muted offscreen `<video>` fed by the capture stream, and call `canvas.captureStream(30)`. Drive the frame pump with `HTMLVideoElement.requestVideoFrameCallback()` (not `requestAnimationFrame`, which can be throttled when the app window is unfocused or occluded). On every video frame read the target's `getBoundingClientRect()` and the decoded frame size `video.videoWidth` / `video.videoHeight` (not `track.getSettings()`, which reported the capture maximum, 2552x1370, for a 1296x968 window — verified live). Compute `scaleX = video.videoWidth / window.innerWidth` and `scaleY = video.videoHeight / window.innerHeight`; multiply the target's viewport-relative left/top/width/height by those scale factors to get the source crop. Scope page to the active page slot (the full page content below the shell); scope editor to that slot's `page-editor` element. During live verification confirm frameless Persephone capture has no extra border/shadow offset; if it does, apply the measured source x/y offset before cropping. Ignore missing/zero-sized targets and stop if the selected page closes or the selector disappears for a sustained frame interval.
   - Select `video/mp4;codecs=avc1` if supported, otherwise `video/webm;codecs=vp9`, then `video/webm`; choose the extension from the actual MIME type returned by `MediaRecorder`. Use `videoBitsPerSecond: 6_000_000` and `frameRate: 30` as defaults for readable 1080p UI, with no audio track. Mark the canvas video track's `contentHint = "text"` when supported. Start `MediaRecorder` with a 1000 ms timeslice; forward each `dataavailable` Blob as a `Uint8Array` to the matching main IPC append operation and serialize/await chunk writes. Start elapsed-time measurement when the recorder enters recording state; pause/resume through `MediaRecorder.pause()` / `resume()` and exclude paused time from elapsed time.
   - On Stop, call `MediaRecorder.stop()` once, await its final `dataavailable` chunk and `stop` event, stop every source/canvas track, then finalize/close the main file. Return the finalized result to the caller; for a UI recording open the file with `pagesModel.openFile(path)` and let the existing video-editor restore path autoplay it. For agent recordings, open only when `openPlayer: true`; otherwise leave the completed file in the temporary recordings folder for the agent to copy elsewhere if it wants to keep it. Surface capture/write errors through `app.ui.notify`; cancellation removes the partial file and releases all tracks/listeners.

4. **Add header recording controls and lifecycle handling**
   - In `src/renderer/ui/app/MainPageView.ts` and `src/renderer/ui/app/MainPage.css`, add a small recording-control host directly before the existing `window-minimize` button. After choosing a region show Start, Stop and elapsed time; after Start show Pause (then Resume), Stop and elapsed time. Controls use `data-name` labels for stable shell addressing and button styling consistent with system header controls. Controls are absent while idle.
   - Full-window recording includes the visible recording controls in the video. This is recommended for v1 because the requested capture is the full visible Persephone window and the controls remain operable; do not create a second hidden/altered window composition.
   - If the selected page/editor is closed, disappears, or is replaced while recording, stop and finalize the recording automatically, then open it only when that session's `openPlayer` setting is true (true for the UI, false by default for agents). A page-region recording ends when its selected region is no longer available; full-window recording continues across tab changes.
   - Use the existing quit round-trip: `src/main/open-window.ts:73-100` prevents the first close and sends `EventEndpoint.eBeforeQuit`; `src/renderer/api/internal/RendererEventsService.ts:137-147` saves page state then acknowledges via `signalReadyToQuit()`; `src/renderer/api/window.ts:23-25` sends `setCanQuit`, and `src/main/open-windows.ts:104-121` closes or hides according to the existing close-to-tray behavior. Finalize an active recording, including the last `dataavailable` chunk, before that acknowledgement. The existing 2-second force-close timeout is sufficient for `MediaRecorder.stop()` finalization; if the renderer is destroyed, the recording service's owner-destruction cleanup deletes its partial file.
   - Freeze output canvas dimensions at start using the selected crop's initial pixel dimensions; if the window/target resizes, resample the updated crop into that same output size while preserving aspect ratio and letterboxing. This keeps the MP4 dimensions constant and avoids stretched UI. If the target becomes smaller than the canvas, upscale it; if larger, downscale it.

5. **Expose Save as… and Discard only for recorder-owned temp files**
   - In `src/renderer/editors/video/VideoEditor.ts`, derive temporary-recording status from its current resolved `filePath`: the parent must exactly match `fs.resolveDataPath("recordings")`, and the basename must match the generated `persephone-recording-<uuid>.(mp4|webm)` pattern. Use `fpNormalizeForCompare()` for parent comparison and validate the generated basename pattern. Because this is derived from the persisted file path, restored pages regain the temporary toolbar actions without storing runtime-only metadata. Add guarded `saveTemporaryRecording()` and `discardTemporaryRecording()` model actions.
   - In `src/renderer/editors/video/VideoView.ts`, add **Save as…** and **Discard** actions to the video toolbar only when the model's path-derived `isTemporaryRecording` is true. Save as… uses `fs.showSaveDialog()` with MP4/WebM filters and a suitable filename, copies via `fs.copyFile()`, then retargets/reloads the editor to the destination before removing its owned temporary source. Dialog cancellation leaves the recording and toolbar unchanged. Discard deletes the owned temp file and closes the page via its `PageModel`; ordinary video files never expose either action.
   - *(User decision, 2026-10-04 — reverses the earlier keep-on-close rule.)* Closing the player page (or navigating it to another file) deletes its unsaved temp recording, from `VideoEditor.dispose()`, unless another open page still shows the same file. Dispose does not run on app quit, window close or a cross-window tab move, so restored pages keep their file and its Save as… / Discard actions.

6. **Clean abandoned temporary recordings**
   - In `src/main/recording-service.ts`, run cleanup during service initialization: remove stale partial files and completed recorder temp files older than seven days from only the dedicated `recordings` directory. Use a conservative generated filename prefix/manifest and skip active ids. Do not traverse or delete other content under `<userData>/data`.
   - Ensure failure/cancel/owner-destruction removes partial files immediately. Saving successfully removes the original temp file after the player has retargeted; Discard removes it immediately. Seven-day startup cleanup handles crash leftovers and completed recordings the user neither saved nor discarded. Closing the player page deletes its unsaved recording; the startup cleanup stays as the backstop.

7. **Expose recording through the `window.screen` call object model**
   - Implement `window.screen.recording` beside the existing `window.screen.screenshot()` API, using the existing descriptor-backed object model and IPC boundary. Add the nested API implementation and types in `src/renderer/api/window-screen.ts` and `src/renderer/api/types/window.d.ts`, and describe the `recording` property/methods/state in `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` including its `WINDOW_SCREEN_HELP` text. Preserve the existing `restrictedWindowScreen()` privacy guard: recording is unavailable while the active page is user-opened incognito/Tor, since a whole-window recording could expose it.
   - Update the matching call documentation and method inventory in `assets/guides/scripting/api/window.md`, `assets/guides/agents/pages.md`, `assets/guides/agents/browser.md`, `assets/guides/mcp-setup.md`, and `assets/guides/scripting/api/index.md`. Explain immediate agent start, the returned result, temporary-file lifetime, `openPlayer` behavior, and that the agent must copy the path elsewhere to retain it.

### Files that should not need changes

| File | Reason |
|---|---|
| `src/main/snip-service.ts` | Existing snip hide/show behavior remains independent; recording captures the live app window. |
| `src/renderer/api/fs.ts` | Existing data path, save dialog, copy and delete helpers cover the player actions. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Existing path open and video matcher already create and play a video page. |
| `src/renderer/components/page-manager/PageSlot.ts` | Existing page identity marker is sufficient. |
| `src/renderer/ui/app/PageContentView.ts` | Existing `page-editor` marker is sufficient. |
| `src/main/open-window.ts` | The existing `eBeforeQuit` round-trip and 2-second force-close timeout are sufficient for `MediaRecorder.stop()` finalization. |

## Concerns / Open questions

- **Agent-movable visual pointer (follow-up, out of scope):** Consider a cursor/pointer overlay an agent can move during a recording so viewers can follow its actions. Implement it as a DOM overlay in the app shell above page content (not in the canvas compositor), so it appears in every region including full-window capture, which records the window track directly. Tracked in [backlog.md](../backlog.md) ("Demo recording").
- **Capture compatibility:** The installed runtime is Castlabs Electron 43.0.0 and the existing scaffold reports a live Chromium 150 MediaRecorder MP4/H.264 probe. Keep runtime MIME fallback and verify capture on supported Windows GPU/display configurations during implementation; no ffmpeg dependency is recommended.
- **Resize and full-window controls:** Keep a fixed encoded frame and scale/letterbox on resize; include the visible header controls in full-window recordings as part of the requested full-window image.
- **Audio and encode defaults:** No audio by default, 30 fps and 6 Mbps. Adding microphone or system-loopback audio changes permissions and the user experience; leave it out of this task unless product requirements request it.
- **Window exit / page close:** Stop and finalize on a selected page/editor disappearing; full-window capture survives page changes. Intercept normal window close for finalization; if the process crashes or renderer disappears, delete the incomplete file and clean completed leftovers after seven days.
- **Storage:** A long capture can consume substantial disk space. This plan uses streaming writes and seven-day cleanup; decide later whether the UI needs a duration/size limit.

## Acceptance criteria

- [ ] Quick settings offers Record next to Snip Screen / Snip Persephone and lets the user choose full window, active page, or main editor area.
- [ ] The capture path obtains only the current Persephone window source through main-process IPC and leaves the app-session `getDisplayMedia` refusal in place.
- [ ] `window.screen.recording` is exposed through the call object model with `$help`, TypeScript types and guide updates; `start({ region })` begins capture immediately, `pause()`/`resume()` control it, `stop()` returns `{ path, durationMs, mimeType, width, height }`, `cancel()` removes it, and read-only `state` reports status and elapsed time.
- [ ] Agent and UI calls share one recording per window: agent-started sessions show the header controls and users can pause/stop them; a second start during an active/ready session returns a clear already-active error. If a user already stopped an agent session, a later agent `stop()` returns that finished result (path included, `stoppedBy: "user"`); `state.last` exposes it too. With nothing active and no `last` result, `stop()` rejects with a clear error.
- [ ] Agent `stop()` defaults to leaving the finalized file in the temporary recordings folder without opening the player; `openPlayer: true` opens it, and UI stop opens it by default. Temporary files retain the same Save as… / Discard / seven-day cleanup behavior, and guides explain that an agent must copy a result elsewhere to keep it.
- [ ] Agent page/editor capture resolves and binds the active page at start, matching the UI; switching the active page does not retarget that recording.
- [ ] A live Electron 43 check confirms capture is allowed only after the matching one-shot grant is armed, and plain app-main-frame `getUserMedia` without a grant remains refused; audio-only or video-plus-audio requests remain refused.
- [ ] Full-window capture records the visible window; page/editor capture crops the active slot/page-editor, follows movement/resizing within fixed output dimensions, and stops if the selected target closes.
- [ ] The header shows Start, Stop and elapsed time after region selection, then Pause/Resume, Stop and elapsed time while recording, immediately left of Minimize; the buttons remain usable and appear in a full-window recording.
- [ ] Capture defaults to video only at 30 fps / 6 Mbps, uses supported MP4/H.264 with WebM fallback, and streams timesliced chunks to `<getDataFolder()>/recordings` without buffering the whole recording.
- [ ] Stop flushes and closes the file and releases capture tracks; UI stop and `openPlayer: true` open the file in the video player and start playback, while default agent stop leaves it closed and returns its path/result.
- [ ] Recorder-created temporary videos offer Save as… and Discard; ordinary video files do not. Save creates a durable copy and retargets playback; Discard deletes the temporary file and closes its page.
- [ ] Closing the selected page/editor finalizes the capture and honors the session's `openPlayer` setting. Closing the window finalizes before close where possible; a destroyed renderer cannot leave an incomplete file treated as playable.
- [ ] Temporary recording actions are reconstructed after page restore from a normalized path directly inside `fs.resolveDataPath("recordings")` and the recorder filename pattern.
- [ ] Unfinished captures are removed on cancel/failure/owner destruction; unsaved completed temp recordings are deleted on Discard, when their player page is closed, or by seven-day startup cleanup (which also covers recordings never opened in a player, e.g. agent recordings).

## Files Changed summary

| File | Planned implementation change |
|---|---|
| `src/ipc/api-types.ts` | Add typed recording endpoint names. |
| `src/ipc/api-param-types.ts` | Define recording region, session, chunk and finalization types. |
| `src/ipc/renderer/api.ts` | Add typed recording IPC calls. |
| `src/ipc/main/core-handlers.ts` | Bind guarded endpoints to the recording service. |
| `src/main/recording-service.ts` (new) | Own source ids, one-shot grant arming, generated temp paths, ordered writes, finalization, cancellation, owner-destruction handling and cleanup. |
| `src/main/main-setup.ts` | Initialize seven-day recording cleanup alongside the existing service startup. |
| `src/main/permission-policy-service.ts` | Add expiring, one-shot app-main-frame video permission grant checks; preserve the `getDisplayMedia` denial and all other app/web-content denials. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` | Add Record and region selection. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.css` | Style Record/region rows if existing selectors do not cover them. |
| `src/renderer/ui/app/MainPageView.ts` | Route Record, subscribe to the shared per-window recording state, and render header controls. |
| `src/renderer/ui/app/MainPage.css` | Style conditional recording controls. |
| `src/renderer/api/window-recording.ts` (new) | Own the shared per-window recording state machine, stream acquisition, frame pump/crop, encoding, pause/resume and elapsed-time reporting for UI and `window.screen.recording`. |
| `src/renderer/api/window-screen.ts` | Expose the nested recording API beside screenshot. |
| `src/renderer/api/types/window.d.ts` | Type the recording methods, state and stop result for scripts. |
| `assets/editor-types/window.d.ts` | Regenerate the checked-in Monaco scripting type copy from `src/renderer/api/types/window.d.ts`. |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Add recording methods and property to the descriptor and `$help`. |
| `assets/guides/scripting/api/window.md` | Document the recording API, result and temporary file behavior. |
| `assets/guides/agents/pages.md` | Add an agent demo workflow and explain immediate start and copying the result. |
| `assets/guides/agents/browser.md` | Document the app-window recording controls and scope. |
| `assets/guides/mcp-setup.md` | Include recording in the supported `window.screen` call surface. |
| `assets/guides/scripting/api/index.md` | List the recording API under `window.screen`. |
| `src/renderer/api/internal/RendererEventsService.ts` | Finalize an active recording before acknowledging the existing window close event. |
| `src/renderer/editors/video/VideoEditor.ts` | Derive temporary status from resolved file path and implement save/discard actions. |
| `src/renderer/editors/video/VideoView.ts` | Render Save as… and Discard only for recorder-owned temp paths. |
