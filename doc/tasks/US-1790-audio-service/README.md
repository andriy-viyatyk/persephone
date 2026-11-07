# US-1790: Audio service

## Goal

Provide shared capture and playback as Persephone's `audio` capability, and remove the superseded
US-1786 application-owned voice assistant core. This is a plan for [EPIC-139](../../epics/EPIC-139.md),
not an implementation.

## Background

EPIC-139 decisions 4, 5, 6, 8 and 11 require a main-owned hidden audio window, shared microphone and
computer capture, one clock, PCM playback, and a platform capability. Wake-word detection and film
suppression belong to the Wake Word board; the audio service supplies timestamps, not recognition.
The capability infrastructure is described in [capabilities architecture](../../architecture/capabilities.md)
and the [capability contract](../../../assets/guides/agents/capabilities.md).

The current `src/shared/capability-contract.ts` accepts method-bearing board IDs only when they
contain a dot; `audio` does not pass that validator. `src/main/capability-registry.ts` currently
projects platform editor registrations as `open` methods, and `src/main/capability-router.ts`
routes channels through board services. Both platform registration and platform channel dispatch
need explicit support. Keep the board manifest grammar unchanged and reserve the exact `audio` ID
for Persephone; do not introduce the forbidden `system.audio` illustrated in the existing guide.
The bridge is currently `1.51.0` in `src/shared/board-bridge-version.ts`.

`src/main/permission-policy-service.ts` already enforces board-page microphone grants and owns
one-shot, frame-bound `armTranscriptLoopbackGrant`. Transcript uses that grant via
`src/ipc/main/core-handlers.ts`; keep its existing route for Transcript and add a separate,
window-specific grant for audio rather than widening or deleting the Transcript grant.

## Implementation Plan

### Phase 1 — platform capability and permissions

- [x] In `src/main/capability-registry.ts` add an explicit main-owned registration, provider
  `persephone`, handler key `audio`, version 1, priority 50. Extend
  `src/main/capability-router.ts` and, if needed, `src/main/capability-channel.ts` to dispatch platform
  channels to a main-owned handler with the same lifecycle, timeout, reauthorization and bounded
  channel semantics as board channels. Keep board service dispatch in
  `src/main/module-service-supervisor.ts` and `assets/module-service-host.mjs` working. Reserve
  exact `audio` against legacy and new board registrations; allow exact `audio` for consumers in
  `normalizeServiceUses`/`validServiceInterfaceId` without adding it to
  `PLATFORM_SERVICE_INTERFACE_IDS` (which also allows providers), or relaxing board-provider IDs.
- [x] In `src/main/capability-registry.ts`, replace the editor-only platform array with the editor
  projection plus this independent registration (snippets omit unchanged editor fields):

  ```ts
  // Before
  const platform = PLATFORM_CAPABILITIES.map((entry) => ({ ...entry, /* open method */ }));
  // After
  const platform: CapabilityRegistration[] = [
      ...PLATFORM_CAPABILITIES.map((entry) => ({ ...entry, /* unchanged open method */ })),
      { id: "audio", version: 1, priority: 50, provider: "persephone", name: "persephone",
        handlerKey: "audio", origin: "platform", title: "Audio", methods: audioMethods },
  ];
  ```

  Define `audioMethods` with the exact declarations in the table below; the legacy snapshot stays
  editor-only. In `CapabilityRouter.invokeChannel`, branch after common argument validation,
  lifecycle setup and reauthorization, before looking up a board provider:

  ```ts
  // Before (simplified)
  if (registration.origin !== "board" || !Array.isArray(args) || args.length > 1) throw capabilityError("rejected");
  const provider = capabilityRegistry.board(registration.provider);
  const opening = moduleServiceSupervisor.openCapabilityChannel(provider.boardRoot, /* ... */);
  // After (schematic: preserve the existing timer, abort and cleanup code)
  if (!Array.isArray(args) || args.length > 1) throw capabilityError("rejected");
  const opening = registration.origin === "platform" && registration.handlerKey === "audio"
      ? audioService.openCapabilityChannel(bound, method, argument, invocation, context.channelDelivery)
      : openBoardCapabilityChannel(/* existing provider lookup and arguments */);
  ```

  The main-owned `audioService.openCapabilityChannel` authorizes the route, creates a
  `MessageChannelMain` pair, and transfers one port to the consumer using the existing page or
  utility-process `channelDelivery` path, and the provider port to the audio window using
  `webContents.postMessage` with its transfer list. Capture/play messages go directly between those
  endpoints, never through main. Main retains a channel lifecycle record, not a PCM relay: validate
  readiness/port delivery, keep the invocation alive, and tell the window to close by channel ID on
  timeout, caller destruction, trust/permission revocation or shutdown; window reports channel
  closure to main. Guard these control messages by stored window and main frame. Close late ports
  after cancellation, close both ends on startup failure and preserve existing consumer limits.
  Extract `createRendererCapabilityChannel` from `src/renderer/api/capabilities.ts` into a small
  shared renderer module and use it for the audio-window provider port as well as the existing
  renderer caller. It handles monotonically sequenced data and ACKs after listeners run; `writable`
  is false at 256 outstanding, `whenWritable()` waits for ACK, and `send` enforces the 1 MiB
  serialized limit. ACK confirms listener delivery, not downstream processing. Keep
  `src/main/capability-channel.ts` for main-owned ports; it cannot wrap a renderer `MessagePort`.
- [x] Declare these methods (all `timeoutMs: 15000`, `agent: true`; types below are the
  declaration's descriptive `args`/`returns` strings, and inputs must be validated):

  | Method | Kind | Args | Returns | Summary |
  |---|---|---|---|---|
  | `capture` | `channel` | `open: { source: "microphone" \| "computer"; deviceId?: string; echoCancel?: boolean }` | `CapabilityChannel` | Board-only streaming: capture shared PCM. |
  | `play` | `channel` | `open: { sampleRate: number }` | `CapabilityChannel` | Board-only streaming: play mono PCM. |

  ```ts
  const audioMethods: Record<string, CapabilityMethod> = {
      capture: { kind: "channel", summary: "Board-only streaming: capture shared PCM.",
          args: [{ name: "open", type: '{ source: "microphone" | "computer"; deviceId?: string; echoCancel?: boolean }' }],
          returns: "CapabilityChannel", timeoutMs: 15000, agent: true },
      play: { kind: "channel", summary: "Board-only streaming: play mono PCM.",
          args: [{ name: "open", type: "{ sampleRate: number }" }],
          returns: "CapabilityChannel", timeoutMs: 15000, agent: true },
  };
  ```

  Keep `agent: true`: `CapabilityRouter.list` retains registrations with an agent-visible
  method and filters hidden methods; `authorize` checks `agent`, while `invokeChannel` rejects
  every agent channel. Agent `$help` therefore lists both as board-only streaming and uncallable.
  Both are visible in agent `$help` as channels only; neither is callable through `call`. There
  are no agent-callable methods. A play channel is its own stop handle, so no global stop call can
  interrupt another caller. The generic client in `src/shared/capability-client.ts` takes one
  JSON open object for a channel; `src/renderer/api/capabilities.ts` and `src/board-shim.ts` expose
  the existing proxy. Page and service code both use:

  ```js
  // Before: page owns capture; a headless service cannot capture.
  // After: manifest uses [{ id: "audio", version: 1 }] and requests the source permission.
  const audio = await persephone.getCapability("audio");
  const capture = await audio.capture({ source: "computer" });
  capture.onMessage(message => { /* consume chunk or error */ });
  // capture.close() releases this consumer only.
  ```

- [x] Add `computerAudio` to `BoardPermissionFlags`, `normalizePermissions`, permission
  comparisons and examples in `src/shared/board-manifest-utils.ts` and
  `src/renderer/editors/board/board-manifest.ts`; add the trust copy mapping in
  `src/renderer/editors/board/board-permission-copy.ts` and English message in
  `src/shared/i18n/en/board.ts`. `TrustBoardDialog.ts` renders the shared permission list.
  In `src/main/board-trust-service.ts` migrate old snapshots missing the new boolean to `false`,
  preserving their other grants; changing a manifest from false to true must require renewed trust.
  Legacy grants must **not** implicitly grant computer audio: require an explicit modern flag.
  Update `assets/guides/agents/boards.md` and `board-review.md`; translate the new key in every
  language pack at epic close.
- [x] Make the permission changes in these existing functions (snippets show relevant lines):

  ```ts
  // board-manifest-utils.ts — BoardPermissionFlags / normalizePermissions
  // Before: microphone: boolean;             microphone: source.microphone === true,
  // After:
  microphone: boolean; computerAudio: boolean;
  // in normalizePermissions flags:
  microphone: source.microphone === true, computerAudio: source.computerAudio === true,

  // board-permission-copy.ts — existing flag-to-message mapping used by boardPermissionLines
  // Before: microphone: "board.permissionMicrophone",
  // After:
  microphone: "board.permissionMicrophone",
  computerAudio: "board.permissionComputerAudio",
  ```

  In `board-trust-service.ts` `parseTrustRecords`, change the flag validation and migration as
  below. Use two independent migration checks: a snapshot may lack both `themes` and the new flag.
  Preserve `permissionReduction`/snapshot reauthorization semantics and audit their flag lists.

  ```ts
  // Before: validate optional themes, then migrate missing themes in an else-if.
  // After: include this in the invalid-flags condition:
  (flags.computerAudio !== undefined && typeof flags.computerAudio !== "boolean")
  // After successful validation, independently:
  if (flags.themes === undefined) { flags.themes = false; migrated = true; }
  if (flags.computerAudio === undefined) { flags.computerAudio = false; migrated = true; }
  ```
- [x] Authorize at channel open and on grant changes using the authenticated route's bound
  `CapabilityCaller` and `capabilityRegistry.board(provider)` main-owned board root and current
  trust snapshot. `board-page` and `board-service` require trusted enabled board, exact `audio@1`
  `uses`, and respectively `microphone` or explicit `computerAudio` for capture; their play needs
  only `uses`. Existing legacy microphone semantics remain as in `boardPermissionAllows`.
  `platform` may capture or play without board grants. `agent` cannot invoke either channel.
  Switch on `ctx.caller.kind`/authenticated bound caller kind, never `ctx.caller.id` (the guide
  states that ID is author-chosen and non-unique). Close active capture on revocation and deny
  `permission-denied`; reject a computer deviceId and malformed input. Do not let an inherited
  agent invocation impersonate a board; use the actual bound route and reauthorize every hop.
- [ ] **Manual MCP:** using the implementer's self-trusted throwaway board, inspect `capabilities["audio"].$help`,
  confirm both channel declarations are visible and cannot be called, and check missing `uses`,
  denied source permissions and trust changes. Verify playback needs no microphone grant.

### Phase 2 — capture and lifecycle

- [x] Add `src/main/audio-service.ts` and a dedicated hidden `BrowserWindow`, created lazily on
  the first capture channel and destroyed after the final channel closes, including on
  open failure, consumer disappearance, revocation, renderer crash and application shutdown.
  Use a minimal `audio.html` and `src/renderer/audio/audio-window.ts`; as in
  `src/main/open-window.ts`, use `nodeIntegration: true`, `contextIsolation: false` and the app
  session. No separate preload: this entry uses `require("electron").ipcRenderer` directly for
  its narrowly scoped control messages. Never load a board or remote content in this privileged
  window; deny navigation, new windows and webviews. Validate IPC sender
  and exact main frame against the stored window; never expose a general grant to board pages.
  Serialise concurrent opens and teardown, and invalidate stale startup replies by generation.
- [x] Build and load the entry explicitly. `audio.html` contains only a module script for
  `/src/renderer/audio/audio-window.ts` and a CSP suitable for the local worklet; configure the
  `inlineScriptHashesPlugin` in `vite.renderer.config.ts` to skip this separate HTML (it currently
  requires the main page's CSP token). Use the existing Vite server in `scripts/dev.mjs` and add
  the second entry to production's renderer build in `scripts/build-prod.mjs`:

  ```js
  // Before: devServerUrl serves only the main window; production uses the implicit index.html.
  // After — dev.mjs, after devServerUrl is known:
  const audioWindowUrl = new URL("audio.html", devServerUrl).href;
  // mainConfig(devServerUrl, audioWindowUrl), in its existing define object:
  AUDIO_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(audioWindowUrl),
  // watchBuild("main", mainConfig(devServerUrl, audioWindowUrl), ...)
  // build-prod.mjs main build define object:
  AUDIO_WINDOW_VITE_DEV_SERVER_URL: "undefined",
  // build-prod.mjs, existing renderer build object:
  rollupOptions: { input: { main: "index.html", audio: "audio.html" } },
  ```

  Main loads `AUDIO_WINDOW_VITE_DEV_SERVER_URL` in development and
  `path.join(__dirname, "../renderer/main_window/audio.html")` in production. Include the new
  define in `mainConfig`; declare `AUDIO_WINDOW_VITE_DEV_SERVER_URL: string | undefined` in
  `src/main/vite-env.d.ts`. `npm run build-prod` confirms the production entry; dev/HMR runtime confirmation remains pending.
- [ ] Manually confirm the audio entry loads and hot reloads in the development server.
- [x] For microphone call `getUserMedia` with `channelCount: 1`, `noiseSuppression: true`,
  `echoCancellation: echoCancel ?? true`, and optional `deviceId: { exact: deviceId }`.
  `TranscriptController.ts` and `VoiceTypingController.ts` already use those three base constraints.
  `echoCancel` must be boolean when supplied; reject it for `computer`. For Windows
  computer audio follow `src/renderer/ui/transcript/TranscriptController.ts`'s
  `getDisplayMedia({audio:true, video:true})`, stop the video track and retain the audio track.
  Add a separate one-use, expiry- and frame-bound audio-window grant in
  `src/main/permission-policy-service.ts`; arm only from main immediately before this window's
  request and consume only for its exact live main frame. Keep the existing Transcript grant,
  `Endpoint.armTranscriptLoopback`, and normal browser/board permission policy intact. Reject
  computer capture on unsupported platforms and report device/OS errors to the channel.
- [x] In `src/main/permission-policy-service.ts`, add `armAudioLoopbackGrant(target)` beside
  `armTranscriptLoopbackGrant`, with separate stored target/frame, five-second expiry, destruction
  cleanup and one-shot consume. The target must equal the currently owned audio window; only main
  can arm it. Modify `handleRequest` and `installAppDisplayMedia` as follows, preserving Transcript:

  ```ts
  // Before: handleRequest allows isTranscriptDisplay; installAppDisplayMedia consumes Transcript.
  // After (schematic; helpers perform the same expiry/frame checks as Transcript):
  const isAudioDisplay = permission === "media" && types.length === 0 &&
      hasAudioLoopbackGrant(webContents.id, webContents.mainFrame);
  const allowed = isVoiceTypingAudio || isScreenRecordingVideo || isTranscriptDisplay || isAudioDisplay;
  // installAppDisplayMedia: accept either one-shot grant, only for the matching request.frame
  if (!consumeTranscriptLoopbackGrant(request.frame) && !consumeAudioLoopbackGrant(request.frame)) {
      callback({}); return;
  }
  ```

  Retain the existing Windows and audio/video request guards. Add a separate one-shot audio-window
  microphone grant, armed by main for this window only, in `handleCheck` and `handleRequest`;
  clear it after the audio-only request, expiry, failed startup or destruction. Do not route either
  grant through a board-callable endpoint. The window must request its grant from main over a
  sender-checked control message before invoking the relevant browser API.
- [x] Share each live source keyed by `(source, deviceId or default, echoCancel)` in the audio window;
  normalize omitted microphone `echoCancel` to true and computer to a single non-applicable value; attach
  independently closable subscribers, stop tracks only after the final subscriber. The default
  key follows the current default capture, not a promise to merge a named device with it.
  Reuse `src/renderer/ui/speech/PcmAudioCapture.ts`: its worklet downmixes and resamples to
  16 kHz mono s16le, emitting 3,200 samples (200 ms, 6,400 bytes). Its first worklet frame is
  mapped using `AudioContext.getOutputTimestamp()` to the window's `performance.now()` time
  origin, then advances by output samples. Define `timeMs` as that monotonic window-relative
  first-sample time, shared across all captures for one audio-window lifetime; never use message
  arrival or wall clock. Main increments a process-local integer `epoch` whenever it creates a new
  audio window and sends it at bootstrap; every capture chunk includes that epoch. Playback end
  messages carry the same epoch when implemented in Phase 3. A
  reopened window starts a new epoch: times from different epochs are incomparable. Epochs are
  process-local, not persistent across application restarts.
  Capture device/OS buffering and output-timestamp estimation limit absolute alignment; generated-loopback measurement remains pending.
- [x] Move the gate from `VoiceAssistantController.onLoopChunk` and
  `voice-assistant-constants.ts`: RMS open 0.01, close 0.006, 400 ms pre-roll, 500 ms tail.
  Apply it **only to computer**. Microphone chunks remain continuous so wake detection and
  end-of-request silence timing see uninterrupted audio. Preserve original sample timestamps
  across gaps: for computer a gap in `timeMs` means gated silence. Silence suppresses chunk delivery
  and downstream processing, not the underlying OS capture or worklet. Send each subscriber
  `{ type: "chunk", epoch, timeMs, sampleRate: 16000, data: ArrayBuffer }`; duration comes from buffer size.
  Send the same chunk through the bounded capability channel to each page or utility-process
  consumer. With 200 ms chunks each subscriber receives about 32 KB/s before structured-clone,
  IPC and channel overhead; work and copies grow linearly with subscribers. `capability-channel.ts`
  has 256 unacknowledged messages and 1 MiB/message limits; use a separate bounded 32-chunk
  per-subscriber queue, and close only a slow subscriber with `channel-backpressure` when full,
  never silently drop samples or stall other consumers. Install listeners immediately; no replay.
- [x] Publish aggregate capture count from main as `EventEndpoint.eAudioCaptureCount` carrying
  `{ count: number, revision: number }`; add `Endpoint.getAudioCaptureCount` returning the same
  shape for the initial snapshot, guarded like
  other normal-window IPC. Update `src/main/tray-setup.ts` tooltip and add a `span` named
  `audio-capture-indicator` in `src/renderer/ui/app/MainPageView.ts`'s `statusIndicators` cluster,
  beside the existing Mneme and MCP indicators, styled in its owning app stylesheet. Set its
  accessible label and title from `shell.audioCaptureActive`; use the same localized text for the
  tray tooltip and `board.permissionComputerAudio` for trust copy. Translate these new keys in
  every `assets/languages/*.lang.json` at epic close.
  Subscribe before requesting the snapshot and use a main-owned revision on snapshot/event to
  ignore stale responses. Remove the indicator only when the final capture ends, including
  gated silence and failure cleanup. Playback alone does not set it. Add localized accessible text.
- [ ] **Manual MCP:** open two consumers in the implementer's self-trusted throwaway board for the same source, check only one
  capture and identical timestamps; close one, then both, and inspect indicator and hidden window
  lifecycle. With the real microphone assert only chunk cadence, monotonic `timeMs`, sharing,
  permission denials and indicator; never store, play back or transcribe microphone audio, and
  never ask anyone to speak. Use a tone generated by the test board for loopback; test its gate,
  timestamps and gaps, permission denial, revocation, reopen and window closure.

### Phase 3 — playback

- [x] On `play({sampleRate})`, validate a finite integer rate in 8,000–192,000 Hz. The consumer
  sends `{ type: "chunk", data: ArrayBuffer }` containing mono little-endian float32 PCM, followed
  by `{ type: "end" }`; validate alignment, finite samples and bounded message sizes. Schedule in
  the audio window in an `AudioBuffer` created at the caller's declared sample rate: Web Audio
  resamples it to the shared `AudioContext` output rate. Use one window-owned `AudioContext` for
  playback and all capture nodes; adapt `PcmAudioCapture.start` to accept that context and do not
  close it when an individual capture stops. This places playback in the same window and context
  as capture for Chromium's echo reference, although effectiveness must be measured. Enforce a
  bounded 5-second queued-audio limit;
  stop and close on overflow with `channel-backpressure`. Honor the channel's writable contract.
  When queued audio finishes after `end`, send `{ type: "ended", epoch, status: "finished" }`, then
  close normally. For stop, send `{ type: "stop" }`; cancel scheduled buffers, send
  `{ type: "ended", epoch, status: "stopped" }`, then close. A disconnected caller is stopped immediately;
  close without a message is also cancellation. Register handlers before asynchronous setup.
- [ ] **Manual MCP:** the implementer's self-trusted throwaway board sends a generated tone at two rates, waits for finished,
  stops another playback and checks stopped, tests overflow and a closed caller, and confirms
  playback does not request capture permission or show the capture indicator.
- [ ] **User-run or user-watched acoustic measurement:** with real speakers and microphone,
  compute ephemeral microphone RMS in the test board without storing, playing back, or transcribing
  microphone samples. Do not ask anyone to speak. At fixed speaker volume and position, compare
  steady-state RMS with `echoCancel: true` and `false` for (a) a board-generated tone through
  `audio.play`, and (b) the same generated tone played by a separate browser tab. Include a silent
  baseline, repeat each condition, and record setup, RMS values and conclusion in this document and
  EPIC-139. Do not claim cancellation until measured. If (b) is not cancelled, record a follow-up
  task for a loopback-referenced canceller, measured on the user's TV; do not implement it here.
  Measurement status: pending implementation and the user-run or user-watched check; no RMS
  values or cancellation result have been observed yet.

### Phase 4 — remove US-1786 core

- [x] Delete all eight files in `src/renderer/ui/voice-assistant/`: `VoiceAssistantController.ts`,
  `VoiceAssistantHooks.ts`, `VoiceAssistantOverlayView.ts`, `VoiceAssistantOverlayView.css`,
  `VoiceAssistantTones.ts`, `VoiceAssistantTypes.ts`, `WakeServiceProvider.ts`, and
  `voice-assistant-constants.ts`, after moving the gate. Remove controller and overlay mounting
  from `src/renderer/ui/app/MainPageView.ts`; delete
  `src/renderer/editors/settings/sections/VoiceAssistantSection.ts` and its registration/catalog
  entry in `SettingsView.ts` and `settings-catalog.ts`. Specifically remove the
  `VoiceAssistantSectionView` import and `"voice-assistant": () => new VoiceAssistantSectionView({})`
  factory, and the catalog entry with id `voice-assistant`, element name
  `settings-section-voice-assistant` and panel name `settings-panel-voice-assistant`.
- [x] Remove the four `voice-assistant.enabled`, `.microphone`, `.silence-ms`, `.threshold` keys,
  defaults, descriptions, normalizers and load/set handling from `src/renderer/api/settings.ts`.
  Loading spreads persisted settings over defaults, so explicitly delete those four keys during
  load; the next normal save removes them from disk. Do not delete board-owned enrollment data.
- [x] Remove owner/status/pause state and callbacks from `src/main/open-windows.ts`, and only the
  now-unused owner-specific callbacks in `src/main/open-window.ts`; retain `rendererReady` and
  readiness handling used by other window selection. Remove the three voiceAssistant endpoints,
  three events and types from `src/ipc/api-types.ts`, their bindings and handlers in
  `src/ipc/main/core-handlers.ts`, and wrappers/events in `src/ipc/renderer/api.ts` and
  `src/ipc/renderer/renderer-events.ts`. Remove `LiveSpeechSessionCoordinator.subscribe` and its
  listener notifications only after confirming no remaining callers; retain its lease logic.
  Exact names from the IPC search are `Endpoint.voiceAssistantGetOwner`,
  `Endpoint.voiceAssistantStatus`, `Endpoint.voiceAssistantPause`,
  `EventEndpoint.eVoiceAssistantOwnerChanged`, `EventEndpoint.eVoiceAssistantStatus`,
  `EventEndpoint.eVoiceAssistantPause`, `VoiceAssistantStatus`, `VoiceAssistantPause`,
  `onVoiceAssistantOwnerChanged`, `onVoiceAssistantStatus`, `onVoiceAssistantPause`, and
  `voiceAssistantPauseSenders`. Remove the matching `Controller` methods and `bindEndpoint` calls.
  Commit `9e9a5832` shows US-1786 added those three handlers and the weak set to
  `core-handlers.ts`; it did not change `permission-policy-service.ts` or the existing
  `armTranscriptLoopbackGrant`, `armTranscriptLoopback`, or `clearTranscriptLoopback`. The
  assistant called those existing methods. Preserve them for Transcript.
- [x] Delete `src/shared/i18n/en/voiceAssistant.ts` and its import, catalog and type entries in
  `src/shared/i18n/en/index.ts`; remove all `voiceAssistant*` entries in
  `src/shared/i18n/en/settings.ts`. Remove `voiceAssistant.*` and `settings.voiceAssistant*`
  messages and source hashes from every `assets/languages/*.lang.json` where present. A search of
  current packs finds none of these keys, so no existing translations currently require deletion.
  Search the user guides again at implementation: currently `assets/guides/` has no US-1786
  Settings or overlay section to delete; preserve the independent speech contract guides.
- [ ] **Manual MCP:** reload the implementer's self-trusted throwaway board and settings; confirm no
  old section, overlay, owner behavior or stale settings keys after save. Check Transcript and
  voice typing UI remains available without starting microphone recording or transcription. Repeat
  capture and playback checks from earlier phases under the same microphone restrictions.

### Phase 5 — contracts and compatibility

- [x] Update `assets/guides/agents/capabilities.md` to replace its speculative `system.audio`
  example with the actual `audio` contract; add a normative `assets/guides/agents/audio.md` and
  link it from `assets/guides/index.md` and capabilities. Update
  `doc/architecture/capabilities.md` for platform channels and write the audio architecture,
  permission, protocol, epoch and resource limits. Update the manifest and trust guides above.
- [x] This introduces a new capability and permission but does not change the board bridge API:
  `getCapability` and channel methods already exist. Keep `BOARD_BRIDGE_VERSION = "1.51.0"`;
  require an appropriate `minAppVersion` for boards relying on this app feature. If implementation
  changes the bridge API itself, bump to `1.52.0` and document its minimum. No unit tests or test
  harnesses; perform the manual MCP checks above using the implementer's self-trusted throwaway board.
- [ ] **Manual MCP:** read the published help and compare the documented declarations and protocol
  with actual page and service behavior, including agent visibility and permission changes.

## Implementation notes

- Progress: platform registration and routing, authorization, the hidden capture window, one-use
  window grants, source sharing, timestamps and bounded capture delivery are implemented. Playback,
  the main-owned capture indicator, US-1786 core removal and the published audio contract are now
  implemented. HMR runtime confirmation and manual MCP/acoustic checks remain pending.
- New English keys for translation at epic close: `board.permissionComputerAudio` — “Capture audio
  playing on your computer.”; `shell.audioCaptureActive` — “Audio capture active.”
- **Fixes found in live verification (2026-11-07):**
  - Concurrent captures of different microphone keys raced on the one-use grant (one request
    consumed or cleared the other's grant, so the second got `permission-denied`).
    `audio-window.ts` now queues stream requests.
  - `stop` after `end` was rejected ("Playback is already ending"). It is now valid until playback
    has ended, because a caller sends all audio plus `end` and then interrupts. `finishPlayback`
    marks `ended` before stopping sources, so stopping never reports `finished`.
- **Live MCP checks passed** (throwaway self-trusted board, generated tones only):
  - Help and channel declarations are visible; an agent call is refused.
  - Two computer consumers share one capture: identical chunks, same epoch.
  - The loopback picks up a played tone. The gate stops delivery after it ends.
  - Microphone is continuous; echo on and off are separate captures; same-key consumers share.
  - The epoch increments when the window is recreated.
  - The indicator shows while capture runs and hides after the last capture closes.
  - Playback: `finished` at 48000, 44100 and 16000 Hz; `stopped` after `end`; close cancels.
  - Bad input is rejected: rate, source, extra key, `echoCancel` on computer.
  - Without `computerAudio`, computer capture gets `permission-denied` and the microphone still
    works. Restoring the permission requires renewed trust.
- **Echo measurement** (user's Creative speakers, 440 Hz tone at 0.3, microphone RMS):

  | Phase | `echoCancel: false` | `echoCancel: true` |
  |---|---|---|
  | Silence | 0.00049 | 0.00047 |
  | Tone via `audio.play` | 0.0248 | 0.00014 |
  | Tone from another page's own AudioContext | 0.00385 | 0.00015 |

  Chromium's canceller removes both down to below the room floor, including sound played outside
  the audio window.

  Sound from a non-Chromium app is **not** cancelled. With YouTube in Firefox playing speech, the
  `computer` stream measured RMS 0.199, the microphone 0.075 with echo cancellation off and 0.082
  with it on. Removing film sound from other apps needs a canceller that uses the `computer`
  stream as its reference: [US-1798](../US-1798-loopback-echo-canceller/README.md).

## Concerns

The current channel acknowledges delivery to listeners, not completion of downstream processing;
consumer code must itself bound its processing queue. The shared clock aligns capture estimates,
not physical sound arrival; platform latency and drift need measurement on the target machine.
Computer loopback is Windows-specific and the loopback gate retains brief pre-roll and tail.
Service-initiated nested calls need particular scrutiny so authorization follows the real route.
Echo cancellation effectiveness for same-window playback and a separate browser tab is unmeasured;
record the Phase 3 user-watched measurements in this document and EPIC-139 after implementation.

## Acceptance Criteria

- [ ] Each phase's manual MCP checks pass using the implementer's self-trusted throwaway board;
  microphone samples are neither stored, played back nor transcribed, and no one is asked to speak.
- [ ] Capture shares resources by source, device and echo setting; each chunk carries its window
  epoch and common-clock first-sample time, and each playback end carries the same epoch. A new
  window changes epoch, computer gate gaps preserve timing, and microphone audio stays continuous.
- [ ] Echo cancellation defaults on and follows the requested constraint; the user runs or watches
  the generated-tone RMS comparison and its results are recorded in this plan and the epic. If
  separate-tab audio is not cancelled, a later follow-up is recorded.
- [ ] Capture releases all
  resources and indicator state on close, crash, permission revocation and failure.
- [ ] Board page and service permissions, channel backpressure, playback end/stop and agent
  discovery follow the protocol above; no cross-caller stop or unauthorized capture is possible.
- [ ] US-1786 core and its UI/settings/IPC/catalog remnants are removed without breaking Transcript
  or voice typing; board enrollment data remains intact.

## Files Changed

| Paths | Planned change |
|---|---|
| `src/main/audio-service.ts`, `audio.html`, `src/renderer/audio/` | New window, capture, playback and restricted control IPC. |
| `scripts/build-prod.mjs`, `scripts/dev.mjs`, `vite.renderer.config.ts`, `src/main/vite-env.d.ts` | Bundle and load the dedicated audio entry. |
| `src/main/capability-registry.ts`, `src/main/capability-router.ts`, `src/main/capability-channel.ts`, `src/shared/capability-contract.ts`, `src/shared/board-manifest-utils.ts` | Register and route platform audio and reserve its ID. |
| `src/main/permission-policy-service.ts`, `src/main/board-trust-service.ts`, `src/renderer/editors/board/board-manifest.ts`, `board-permission-copy.ts`, `src/shared/i18n/en/board.ts` | Source grants, trust and copy. |
| `src/main/tray-setup.ts`, `src/renderer/ui/app/MainPageView.ts`, `src/ipc/api-types.ts`, IPC handlers and renderer wrappers | Indicator and removal of voice-owner IPC. |
| `src/renderer/api/capabilities.ts`, new renderer channel module, `src/renderer/ui/speech/PcmAudioCapture.ts` | Share the renderer channel implementation and audio context. |
| `src/main/open-windows.ts`, `src/main/open-window.ts`, `src/renderer/api/settings.ts`, `src/renderer/editors/settings/`, `src/renderer/ui/speech/LiveSpeechSessionCoordinator.ts` | Remove old ownership, settings and unused subscription. |
| `src/renderer/ui/voice-assistant/`, `src/shared/i18n/en/voiceAssistant.ts`, `src/shared/i18n/en/settings.ts`, `src/shared/i18n/en/index.ts`, `assets/languages/*.lang.json` | Remove core and old strings; translate new indicator and permission. |
| `assets/guides/agents/audio.md`, `capabilities.md`, `boards.md`, `board-review.md`, `assets/guides/index.md`, `doc/architecture/capabilities.md` | Publish contract and architecture. |

## Files needing no changes

- `src/shared/board-bridge-version.ts`: existing generic bridge API is unchanged.
- `src/renderer/ui/transcript/TranscriptController.ts` and its loopback endpoint: retain independent
  Transcript capture; do not migrate it in this task.
- `speech.wake` and `speech.synthesize` contract revisions belong to board tasks.
- `assets/module-service-host.mjs`, `src/main/module-service-supervisor.ts`,
  `src/main/capability-channel.ts`: existing consumer/main transport should suffice; verify during
  implementation and change only if platform channel routing exposes a missing path.
