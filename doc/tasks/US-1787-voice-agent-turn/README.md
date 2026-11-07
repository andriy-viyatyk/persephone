# US-1787: Agent turn wiring

[EPIC-139](../../epics/EPIC-139.md) | Status: Planned (documented)

## Goal

Connect voice requests to a resumable agent session and speak its responses through board-provided synthesis.

## Background

The existing voice assistant owns capture and delegates each recognized request through a handler; this task supplies that handler and leaves voice interrupts to US-1788.

- `AgentSessionProvider.open` already requests `full-auto` and Persephone MCP; `AgentSession` denies approval requests before delivering the event. `AgentSessionStore` serializes and validates the resume binding in `agent-session/session.json`, and creates `agent-session/workspace` through `fs.dataFileName`; the voice assistant will be its first and only consumer. No namespace parameter is needed.
- `agent.session` v1 `send` supports only `text` and reserved attachments, not per-turn metadata. The caller instructions are fixed on open; resuming does not guarantee changed instructions take effect.
- `speech.synthesize` v1 specifies streamed `pcm-f32le` with sample rate on audio messages. The installed Text to Speech provider emits up to 65,536 float samples per chunk, generates per sentence, offers voices 0-9 and accepts speeds 0.5-2.
- `src/main/mcp/tools/call-tools.ts` forwards a normal `call` to the first normal renderer by default or the explicitly selected window. This can differ from the elected microphone owner in `src/main/open-windows.ts`; renderer-local handler state alone cannot route `voice.say` correctly.
- `AiRoot` in `src/renderer/scripting/ai-vision/root.ts` exposes root members and descriptors; `namespaces/clipboard.ts` and `namespaces/tools.ts` show node descriptors and help. `src/renderer/scripting/ai-vision/call.ts` resolves a fresh root in the selected renderer. The main-to-renderer bridge defaults to 30 seconds, too short for a long explanation or a queue.
- `VoiceAssistantController` publishes thinking before invoking `handle`; `setReply` and `setSpeaking` are guarded by the current abort controller. It suppresses correlated microphone and loopback wake events; synthesized output enters the same computer loopback, so no separate self-speech detector is needed.
- `speech.synthesize@1` is already host-allowlisted in `src/main/module-service-supervisor.ts`; this work does not add a board-facing bridge API. `VoiceAssistantSection.ts` already shows a missing-TTS notice and subscribes to owner status.
- `VoiceAssistantController.start()` currently restarts capture for every `voice-assistant.*` settings change. `VoiceAssistantOverlayView.ts` already renders the complete `replyText` using one field; its CSS can scroll that field. The controller must retain the text after the turn.

## Implementation Plan

Each numbered phase is a separately buildable deliverable. Keep new timing, queue, and default numeric tuning in the commented block in `src/renderer/ui/voice-assistant/voice-assistant-constants.ts`; settings are user overrides of those defaults. At the end of every phase run the specified checks; manual audio and UI verification belongs to the user. Do not add unit tests or a test harness.

### 1. Synthesis provider and playback

- [ ] Add `src/renderer/ui/voice-assistant/SynthesisServiceProvider.ts`: use `api.getBoardServiceProviders("speech.synthesize")`, filter version 1, connect with `api.connectHostServiceChannel`, match `speech-synthesize:` ports by channel ID, and wrap ports with `createSpeechServiceChannel` from `src/renderer/ui/speech/SpeechServiceChannel.ts`. Follow `WakeServiceProvider.ts` for early-port races, disposal and close handling, but bound pending ports and late connections. Attach message/close handlers before waiting; validate descriptions and handle `error`, `done`, premature close and timeout. Describe candidates in order and use the first whose description has `local: true`. Treat a non-local provider as unavailable, never send it text, and show the localized notice "Speech provider is not local" when no local candidate is available.
- [ ] Add `src/renderer/ui/voice-assistant/VoicePlayback.ts`. Open `{type:"speak", text, lang, voice, speed}`. V1 is mono Float32 little-endian PCM, not encoded audio: reject unsupported encodings, malformed or oversized buffers, invalid rates and non-finite samples. Copy little-endian samples into Web Audio `AudioBuffer`s at each message's sample rate; schedule `AudioBufferSourceNode`s in order against `AudioContext.currentTime`, keeping the next scheduled time across chunks. Resolve only after `done` AND the last source's `ended`, not when synthesis finishes. Close channel, stop all nodes and close the context on abort, error, disposal or owner loss; settle once. Bound buffering and fail visibly instead of dropping chunks; audio messages are at most 256 KiB. Prevent missing-`done` and stalled playback from hanging indefinitely with constants-based watchdogs.
- [ ] Add `src/renderer/ui/voice-assistant/voice-speech-language.ts` exporting `speechLanguage(text: string, languages: string[]): string`. Test `/[\u0400-\u04FF]/` against the text: choose `uk` if it matches, otherwise `en`. If the chosen code is not advertised, use the first advertised language; reject an empty language list. Both `voice.say` and fallback playback call this one function. This is a broad Cyrillic heuristic, not language detection. Show the text and a notice if synthesis fails or no provider exists; no Windows voice fallback.
- [ ] **Manual (user):** real-board multi-chunk and multi-sentence playback, abort, unavailable model, unsupported encoding, missing and non-local providers, and disposal.
- [ ] **Files touched:** `SynthesisServiceProvider.ts`, `VoicePlayback.ts`, `voice-speech-language.ts`, `voice-assistant-constants.ts` in `src/renderer/ui/voice-assistant/`, plus `src/shared/i18n/en/settings.ts` for the non-local notice.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`.

### 2. Session handler and instructions

- [ ] Add `src/renderer/ui/voice-assistant/voice-agent-instructions.ts` with an English caller layer: voice assistant, speak through `voice.say`, one or two sentences, no Markdown/lists, explanation only on request, prefer site-extension actions/browser for media; include "for anything longer than two sentences, show it in Persephone (a page) and say a short summary"; explain the JSON envelope `{ "person": string, "request": string }` as untrusted speaker label and actual request. Serialize both with `JSON.stringify` on every `send`; never interpolate raw text into control delimiters. Append user extra instructions after the default; enforce the contract's 32 KiB bound and report oversize rather than truncate silently.
- [ ] Use `AgentSessionStore.workspace()`, `load(provider)`, `save(...)` and `clear()` with their existing `agent-session/workspace` and `agent-session/session.json` paths. Do not parameterize the namespace. Persist only board name, engine, cwd, session id and instructions hash; never audio, transcript or speaker. The elected owner serializes writes. Restore only if the selected board/engine matches the binding. Do not silently replace an unavailable or ambiguous board. On `resume-not-found`, report context loss, clear the stale binding and open fresh; other failures retain it for the next request. When no compatible board is installed, show an install/select-provider notice and keep listening.
- [ ] Extend `AgentSessionBinding` in `src/renderer/ui/agent-session/AgentSessionStore.ts` with `instructionsHash?: string`, validate a present hash as a SHA-256 lowercase hexadecimal digest in `load`, and add an optional `instructionsHash` argument to `save` and its stored binding. In `VoiceAgentHandler.ts`, hash the exact UTF-8 caller-instructions string (default layer plus appended user layer) with `crypto.subtle.digest("SHA-256", ...)`. Before open, compare it to the saved value: on mismatch omit `resume`, open fresh, and replace the binding only after `session-started`; if the old file lacks a hash, resume as before and save the current hash after successful start. This avoids resuming an old instruction layer when a known hash changed.

- [ ] Add `src/renderer/ui/voice-assistant/VoiceAgentHandler.ts`: own one `AgentSessionProvider`, store and live session per owner. Register via `setVoiceRequestHandler` from `src/renderer/ui/app/MainPageView.ts` alongside the normal-window controller; tie disposal to view/owner lifecycle, avoid one active session per window, and clear the hook only if it still belongs to this instance. Reconcile on owner changes and on hide/close; close old owner session and cancel active turn before another owner opens from saved binding. Snapshot settings per session; settings changes affecting open options close/reopen when idle. New conversation aborts the active turn, closes session, clears binding, and opens fresh on the next request. Serialize reset, teardown and open to prevent stale writes or two live owners.
- [ ] Until phase 4 adds settings, discover a board with `list()`, describe its default engine, pass the first described model ID as the required `model` string, and pass `low` only when that model advertises it. If no model exists, show an error. Use empty extra instructions until phase 4 supplies the setting. Display final text with `setReply` and use phase 1 playback for the short fallback; phase 3 replaces this temporary turn-end path with `voice.say` support. Phase 4 replaces these defaults with the user's saved selections when present.
- [ ] Open using `AgentSessionProvider.open(boardProvider, {model, cwd, engine, effort, instructions, resume}, callbacks)`, which already sends `permissionMode: "full-auto"` and `mcp: {persephone:true}`. Save the effective `session-started.sessionId` only after successful start. Use its `permissionMode`, not the requested mode, for a persistent warning that Agent Chat's cross-board ceiling must be raised in Agent Chat settings. Never change the ceiling. `AgentSession` already sends deny for every `approval-request`; show a separate indicator notice on that event and do not send a second response.
- [ ] Extend `VoiceRequestHandler` context in `VoiceAssistantTypes.ts` with `setNotice` (and clearing semantics); merge session warnings with existing TTS/loopback notices in `VoiceAssistantController.ts`, propagate through existing `voiceAssistantStatus` so both focused indicator and settings see it. Preserve warnings after return to waiting and replace on a new effective session. Collect the last `text` event as final reply, keep it in memory only, and wait for `turn-ended`. On abort send `session.interrupt()`, close or dispose if cancellation stalls, stop audio and settle; never retry a possibly executed turn. On failure clear the live session and reopen with saved resume on the next turn. No `setVoiceInterruptHandler` registration here: US-1788 will trigger the existing cancellation seam.
- [ ] Define a constant set in `VoiceAssistantController.ts` with exactly `voice-assistant.enabled`, `voice-assistant.microphone`, `voice-assistant.silence-ms`, and `voice-assistant.threshold`. Restart only when `CAPTURE_SETTING_KEYS.has(key)`; apply agent and speech configuration on the next turn/session without aborting an active request. Explicit reset remains an immediate abort. This prevents the existing broad prefix subscription from contradicting the idle-reopen policy.
- [ ] **Manual (user):** session resume across restart, changed and legacy instruction hashes, provider crash, ownership transfer, denied approvals, lower ceiling, absent board and reset.
- [ ] **Files touched:** `src/renderer/ui/voice-assistant/VoiceAgentHandler.ts`, `voice-agent-instructions.ts`, `VoiceAssistantTypes.ts`, `VoiceAssistantController.ts`, `voice-assistant-constants.ts`; `src/renderer/ui/agent-session/AgentSessionStore.ts`; `src/renderer/ui/app/MainPageView.ts`; and `src/shared/i18n/en/settings.ts` for session notices.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`.

### 3. `voice.say` and owner routing

- [ ] Add `src/renderer/scripting/ai-vision/namespaces/voice.ts` with `voiceNode` and descriptor/help, validate text and options, expose `say(text, {mode?})` returning `{ status: "finished" | "interrupted" }`. Add it to `AiRoot` members/getter and `children` in `src/renderer/scripting/ai-vision/root.ts`, register descriptor in `src/renderer/scripting/ai-vision/namespaces/index.ts`; document both limits and recovery in `$help`. Limits are live settings `voice-assistant.max-chars` (300) and `voice-assistant.explanation-max-chars` (2000), counting Unicode code points consistently for help and validation. Reject empty/non-string text, invalid options/mode and over-limit text with the applicable limit and instruction to shorten or select explanation mode. Declare only as a call-tree node, not a board bridge API.
- [ ] Add the two limit keys, defaults and validation to `src/renderer/api/settings.ts`, and their English description keys `voiceAssistantShortLimit` and `voiceAssistantExplanationLimit` to `src/shared/i18n/en/settings.ts`, in this phase so the node builds and works before phase 4 adds settings controls and catalog rows.
- [ ] Add `getVoiceAssistantOwnerIndex(): number | undefined` to `OpenWindows` in `src/main/open-windows.ts`. Find the window record whose `window.window.id` equals `voiceAssistantOwner` and return its `index`.
- [ ] In `src/main/mcp/tools/call-tools.ts`, after `routeCallPath` and inside its forwarded branch before `sendToRenderer`, compute `isVoicePath = forward.path === "voice" || forward.path.startsWith("voice.") || forward.path.startsWith("voice[")`. This includes `voice.$help` and normalized `windows[i].voice`; do not route empty root discovery or root `$help`. Every renderer's root descriptor lists `voice`. For a voice path use `openWindows.getVoiceAssistantOwnerIndex()` instead of `forward.windowIndex`; if undefined return an `ICallResult` error `The voice assistant is not running.`. Use that same chosen index for target window data, event cursor and `sendToRenderer`; retain the existing path-prefix rewriting. Owner loss aborts the old controller's active turn and rejects pending speech.
- [ ] Define `VOICE_SAY_DEADLINE_MS` and `VOICE_BRIDGE_MARGIN_MS` in a new `src/shared/voice-assistant-limits.ts` (commented like the constants block), because both main and the renderer need them and main must not import from `src/renderer/`; `voice-assistant-constants.ts` gets a comment pointing there. Add `voiceSayBridgeTimeout(path: string): number | undefined` beside `automationWaitBridgeTimeout` in `call-tools.ts`; return their sum for a `voice.say` call (including parenthesized call syntax), otherwise undefined. Include it in the existing `bridgeTimeoutMs` selection. The deadline starts when the owner accepts the call, including queue wait: on expiry remove the queued item or stop its active audio, clean resources and reject. It must settle before the bridge deadline. Do not add a cross-process cancellation protocol. Owner loss, abort and queue overflow also settle all pending promises.

- [ ] In `VoiceAgentHandler.ts`, install an active-turn-only speaking endpoint before `session.send`; reject calls outside that lifetime. FIFO serialize multiple accepted `say` calls and cap queue length in constants. Set reply at start of each item, set speaking true for actual playback and false on completion; keep thinking between items while agent remains active. Count a valid accepted call as spoken intent even if interrupted; errors report failure, not successful speech. On abort stop current source, cancel queued items as interrupted, interrupt agent and unblock all callers. Wait for queue drain before ending the handler. On completed turn with no accepted `voice.say`, use the last final `text` if within short limit; otherwise speak localized `voiceAssistant.doneDetails` (English value `Done \u2014 details are on the screen`). If synthesis is unavailable, show the full final reply as text with a notice. Do not fallback after interrupted/error turns.
- [ ] Add `src/renderer/ui/voice-assistant/VoiceSayHooks.ts` with a renderer-local `setVoiceSayHandler(handler | null)` and `getVoiceSayHandler()`; type the handler as `(text: string, options: { mode?: "short" | "explanation" }) => Promise<{ status: "finished" | "interrupted" }>`. `voiceNode.say` validates arguments and delegates to the current handler, rejecting when absent. `VoiceAgentHandler` installs it only during a turn and removes it in `finally`; main's owner routing ensures the renderer-local hook is the owner's hook. Do not remove another turn's handler during stale cleanup.
- [ ] For a long fallback, call `setReply(finalText)` and speak the localized short fallback without replacing `replyText`. `VoiceAssistantOverlayView.ts` already displays `replyText`; in `VoiceAssistantOverlayView.css` give its reply element a bounded height and `overflow-y: auto`. In `VoiceAssistantController.ts`, keep the reply in the existing status after returning to waiting, clear it on the next wake or after `REPLY_LINGER_MS` (in `voice-assistant-constants.ts`), and clear the timer on disposal. Do not add a second status field. The final reply remains visible and scrollable even when TTS is unavailable.
- [ ] **Manual (user):** root/help discovery, both limits, FIFO calls and interruption, different and explicit windows, owner loss, deadlines, inactive error, and the full scrollable final reply through the linger period.
- [ ] **Files touched:** `src/renderer/scripting/ai-vision/namespaces/voice.ts`, `namespaces/index.ts`, `root.ts`; `src/main/mcp/tools/call-tools.ts`, `src/main/open-windows.ts`; `src/renderer/ui/voice-assistant/VoiceSayHooks.ts`, `VoiceAgentHandler.ts`, `VoiceAssistantController.ts`, `VoiceAssistantOverlayView.css`, `voice-assistant-constants.ts`; `src/renderer/api/settings.ts`; `src/shared/i18n/en/settings.ts`, `voiceAssistant.ts`.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`.

### 4. Settings and final integration

- [ ] Add typed keys, defaults, descriptions and load/set validation in `src/renderer/api/settings.ts`: `voice-assistant.agent-provider`, `voice-assistant.agent-engine`, `voice-assistant.agent-model`, `voice-assistant.agent-effort`, `voice-assistant.instructions`, `voice-assistant.max-chars`, `voice-assistant.explanation-max-chars`, `voice-assistant.voice`, `voice-assistant.speed`. Use a distinct automatic model sentinel (for example `null`) because the described model ID may itself be an empty string. Defaults: short 300, explanation 2000, voice provider default, speed 1; validate finite positive integer limits and finite speed 0.5-2. Keep numeric defaults in the constants block. Add rows in `src/renderer/editors/settings/settings-catalog.ts`. The epic spells the limits `voice.max-chars`; these keys use `voice-assistant.*` for consistency.
- [ ] `AgentSessionProvider.list()` returns board service providers; each `provider.provider` identifies a board for `describe(board, engine?)` and `open`. The optional engine is the `provider` field in the service open request, not the board identifier. Agent Chat is currently `C:/projects/persephone-boards/boards/claude-agent/scripts/service.mjs`: its no-engine `describe` builds `catalog` from its `claude` and `codex` adapters. Type the optional `catalog` and its `provider`, `available`, `models` and `efforts` data in `AgentSessionDescription` in `src/renderer/ui/agent-session/AgentSessionProvider.ts`. Populate engine choices from valid available catalog entries. If a provider omits `catalog`, show its description's `provider` as the sole engine, or a provider-default choice when that field is absent; do not hardcode Claude/Codex or invent engine discovery.
- [ ] Call `describe(board, selectedEngine)` after choosing an engine. Type its `permissionCeiling?: AgentPermissionMode` in `AgentSessionDescription`: Agent Chat's `providers/claude.mjs` and `providers/codex.mjs` send exactly `permissionCeiling` in engine-specific descriptions. Its aggregate catalog response does not supply this field, so do not infer the ceiling from the aggregate. Validate the returned value; if lower than `full-auto`, show a settings warning before any session opens explaining that the user can raise Agent Chat's cross-board ceiling in Agent Chat settings. If absent or invalid show unknown, not an invented mode. Continue using `session-started.permissionMode` for the indicator during an actual session.
- [ ] In `VoiceAssistantSection.ts`, create board, engine, model and effort selectors using the above discovery. `open.model` is required: absent a saved model select the first entry in the selected engine's `describe().models`, and pass its `id` as a string, including an empty ID if that is what the provider describes. Choose `low` if the model lists it, otherwise omit `effort` to use the provider default. Explicit saved model/effort wins. If a saved model is no longer described, show `voiceAssistantSelectionUnavailable` and do not open. If no model is described, report unavailable and do not open. Refresh dependent lists when board or engine changes, discard stale async responses, and dispose discovery providers when the view closes.
- [ ] Add synth voice and speed controls, multiline instructions, short/explanation limits and reset button to `VoiceAssistantSection.ts` after its threshold control. Discover synth voices from local provider descriptions only. Add the settings warning to `renderStatus`, keeping it independent of the owner status and useful before a session opens. Changing agent settings applies to the next session; the instruction hash rule determines whether to resume.
- [ ] Add `voiceAssistantNewConversation(): Promise<{ handled: boolean }>` to `src/ipc/api-types.ts` and `src/ipc/renderer/api.ts`. Bind its handler in `src/ipc/main/core-handlers.ts`; `src/main/open-windows.ts` relays a new `eVoiceAssistantNewConversation` event to the current owner, like `voiceAssistantPause`. Add the event to `api-types.ts` and `src/ipc/renderer/renderer-events.ts`. When an owner exists main sends the event and returns `{ handled: true }`; the owner handler aborts the active turn, closes the session, calls `store.clear()` and opens fresh on the next request. When main returns `{ handled: false }`, the calling settings window creates `AgentSessionStore` and awaits `clear()` itself. Do not add main-owned storage or a separate serialization protocol.
- [ ] Add English catalog keys in `src/shared/i18n/en/settings.ts`: `voiceAssistantAgentProvider`, `voiceAssistantAgentEngine`, `voiceAssistantAgentModel`, `voiceAssistantAgentEffort`, `voiceAssistantInstructions`, `voiceAssistantShortLimit`, `voiceAssistantExplanationLimit`, `voiceAssistantVoice`, `voiceAssistantSpeed`, `voiceAssistantNewConversation`, `voiceAssistantAgentMissing`, `voiceAssistantAgentFailed`, `voiceAssistantLowerPermission`, `voiceAssistantApprovalDenied`, `voiceAssistantSynthesisFailed`, `voiceAssistantSynthesisNotLocal` ("Speech provider is not local"), `voiceAssistantSelectionUnavailable`, and `voiceAssistantPermissionUnknown`. Add `doneDetails` in `src/shared/i18n/en/voiceAssistant.ts` with English value `Done \u2014 details are on the screen`. Translate at epic close.
- [ ] **Manual (user):** settings discovery and persistence, ceiling warning before first session, approval denial, reset from another window and with no owner, model and effort defaults, changed instructions, multiple speakers, speech and fallback, absent/non-local TTS and loopback suppression.
- [ ] **Files touched:** `src/renderer/api/settings.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `sections/VoiceAssistantSection.ts`; `src/renderer/ui/agent-session/AgentSessionProvider.ts`; `src/renderer/ui/voice-assistant/VoiceAgentHandler.ts`, `voice-assistant-constants.ts`; `src/main/open-windows.ts`; `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, `src/ipc/renderer/renderer-events.ts`; `src/shared/i18n/en/settings.ts`, `voiceAssistant.ts`.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`.

### Representative edits to existing files

`src/renderer/scripting/ai-vision/root.ts`:

```ts
// Before
get tools() { return toolsNode; }
// After, with matching root descriptor and children
get tools() { return toolsNode; }
get voice() { return voiceNode; }
```

`src/renderer/ui/voice-assistant/VoiceAssistantTypes.ts`:

```ts
// Before
setReply(text: string): void;
setSpeaking(on: boolean): void;
// After
setReply(text: string): void;
setSpeaking(on: boolean): void;
setNotice(text: string | undefined): void;
```

`src/renderer/ui/app/MainPageView.ts`:

```ts
// Before
const overlay = this.child(new VoiceAssistantOverlayView({}));
overlay.mount();
const controller = new VoiceAssistantController();
controller.start();
this.own(() => controller.dispose());
// After (inside the existing !appWindow.isBoardMode block)
const overlay = this.child(new VoiceAssistantOverlayView({}));
overlay.mount();
const handler = new VoiceAgentHandler();
const controller = new VoiceAssistantController();
handler.start();
controller.start();
this.own(() => { controller.dispose(); handler.dispose(); });
```

`src/renderer/ui/voice-assistant/VoiceAssistantController.ts`:

```ts
// Before (in start)
this.subscriptions.push(settings.onChanged.subscribe(({ key }) => { if (key.startsWith("voice-assistant.")) this.restart(); }));
// After; declare this set at module scope
const CAPTURE_SETTING_KEYS = new Set([
    "voice-assistant.enabled", "voice-assistant.microphone",
    "voice-assistant.silence-ms", "voice-assistant.threshold",
]);
// In start:
this.subscriptions.push(settings.onChanged.subscribe(({ key }) => { if (CAPTURE_SETTING_KEYS.has(key)) this.restart(); }));
```

`src/main/open-windows.ts`:

```ts
// Before
private voiceAssistantOwner: number | null = null;
private voiceAssistantStatus: VoiceAssistantStatus | null = null;
// After
private voiceAssistantOwner: number | null = null;
private voiceAssistantStatus: VoiceAssistantStatus | null = null;
getVoiceAssistantOwnerIndex = (): number | undefined =>
    this.windows.find((record) => record.window?.window?.id === this.voiceAssistantOwner)?.index;
```

`src/main/mcp/tools/call-tools.ts` (inside the forwarded branch; return an error before forwarding when no owner exists):

```ts
// Before
const forward = route.forward!;
const targetWindowData = forward.windowIndex !== undefined
    ? openWindows.findWindowDataByIndex(forward.windowIndex)
    : openWindows.allWindowData().find(windowData => !windowData.boardRoot && windowData.window);
// After
const forward = route.forward!;
const isVoicePath = forward.path === "voice" || forward.path.startsWith("voice.") || forward.path.startsWith("voice[");
const targetIndex = isVoicePath ? openWindows.getVoiceAssistantOwnerIndex() : forward.windowIndex;
if (isVoicePath && targetIndex === undefined) {
    return toCallResult({ result: { path, error: "The voice assistant is not running." } });
}
const targetWindowData = targetIndex !== undefined
    ? openWindows.findWindowDataByIndex(targetIndex)
    : openWindows.allWindowData().find(windowData => !windowData.boardRoot && windowData.window);
// Also pass targetIndex, not forward.windowIndex, to sendToRenderer.
```

`src/renderer/api/settings.ts` (one complete example; add the corresponding normalization on both load and set):

```ts
// Before: key union, descriptions and defaults, respectively
| "voice-assistant.threshold"
"voice-assistant.threshold": settingsCatalog.voiceAssistantThreshold.message,
"voice-assistant.threshold": null as number | null,
// After, in the same three locations
| "voice-assistant.threshold"
| "voice-assistant.max-chars"
"voice-assistant.threshold": settingsCatalog.voiceAssistantThreshold.message,
"voice-assistant.max-chars": settingsCatalog.voiceAssistantShortLimit.message,
"voice-assistant.threshold": null as number | null,
"voice-assistant.max-chars": VOICE_SHORT_MAX_CHARS,
```

`src/renderer/editors/settings/sections/VoiceAssistantSection.ts`:

```ts
// Before (onMount, after threshold construction)
this.addRow(t("settings.voiceAssistantThreshold"), this.threshold.mount());
this.root.append(this.status, panel({ paddingBottom: "md" }, text(t("settings.voiceAssistantEnroll"), { bold: true, size: "sm" })));
// After
this.addRow(t("settings.voiceAssistantThreshold"), this.threshold.mount());
this.mountAgentAndSpeechControls(); // construct/mount selectors, instructions, limits and reset
this.root.append(this.status, panel({ paddingBottom: "md" }, text(t("settings.voiceAssistantEnroll"), { bold: true, size: "sm" })));
```

Add the required imports and concrete methods for each snippet. `mountAgentAndSpeechControls()` owns the controls described in phase 4 and registers their disposal with the view. IPC/reset additions use the guarded endpoint and renderer-event patterns in `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/renderer/renderer-events.ts`.

## Concerns

- This is a substantial integration, but the four independently buildable phases are the recommended split; keep them in US-1787 because speech, routing and lifecycle jointly deliver a usable turn. US-1788 owns media muting, spoken interrupts and guide tuning.
- V1 synthesis requires a language without providing detection; the stated heuristic can misclassify mixed-language text. The provider may retain old instruction layers on resume; the hash comparison starts a fresh session when a recorded layer changes, while old bindings without a hash deliberately retain legacy resume behavior. `voice.say` is a global active-turn capability in this design: the contract does not identify the calling session, so another MCP client can invoke it during a turn. Restricting calls to the private session would require MCP session identity propagation, a separate security design; do not imply that the active-turn check authenticates the agent.
- A local provider description is not proof that its model is installed. Very long speech and queued speech must fit the owner deadline and bridge margin.

## Acceptance Criteria

- [ ] One elected owner uses the resumable agent-session store and workspace; restart, failure, reset and owner transfer do not create duplicate active sessions or persist voice data.
- [ ] `full-auto` requested, effective lower mode visible in indicator and settings, every approval denied with notice; no ceiling changes.
- [ ] Each turn carries safely encoded speaker and request, with default and appended caller instructions; first described model and low advertised effort preferred, with saved selections taking precedence.
- [ ] `voice.say` is discoverable with current limits, routes from any window to the owner, rejects invalid/inactive calls, queues in order and resolves only when finished or interrupted. Fallback and text-only failure behavior work.
- [ ] PCM playback streams in order, completes after audible playback, abort releases all resources and cancels turn; existing loopback protection remains in effect.
- [ ] All remaining settings are discoverable, validated, persisted and reflect provider descriptions; New conversation works across windows; new English keys are catalogued.
- [ ] Each phase builds independently; manual scenarios above pass. No unit tests or harnesses are introduced.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/renderer/ui/voice-assistant/SynthesisServiceProvider.ts`, `VoicePlayback.ts`, `voice-speech-language.ts` | New synthesis client and Web Audio playback. |
| `src/renderer/ui/voice-assistant/VoiceAgentHandler.ts`, `VoiceSayHooks.ts`, `voice-agent-instructions.ts` | New session owner, queue, call hook and instruction layer. |
| `src/renderer/ui/voice-assistant/VoiceAssistantTypes.ts`, `VoiceAssistantController.ts`, `voice-assistant-constants.ts` | Notice seam, lifecycle and centralized tuning. |
| `src/renderer/ui/voice-assistant/VoiceAssistantOverlayView.css` | Bound and scroll the existing reply field. |
| `src/renderer/ui/agent-session/AgentSessionStore.ts`, `AgentSessionProvider.ts` | Optional instructions hash in the existing resume binding; type discovery catalog and permission ceiling. |
| `src/renderer/ui/app/MainPageView.ts` | Mount/dispose handler in normal windows. |
| `src/renderer/scripting/ai-vision/namespaces/voice.ts`, `namespaces/index.ts`, `root.ts` | Voice call node, root and help registration. |
| `src/main/mcp/tools/call-tools.ts`, `src/main/open-windows.ts` | Owner routing and bounded speech call lifetime. |
| `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, `src/ipc/renderer/renderer-events.ts` | Cross-window reset/status IPC if needed. |
| `src/renderer/api/settings.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/editors/settings/sections/VoiceAssistantSection.ts` | Typed settings, catalog and controls. |
| `src/shared/i18n/en/settings.ts`, `src/shared/i18n/en/voiceAssistant.ts` | English UI messages. |
| `doc/tasks/US-1787-voice-agent-turn/README.md`, `doc/active-work.md`, `doc/epics/EPIC-139.md` | This plan and tracking. |

### Files requiring no changes

- `src/main/module-service-supervisor.ts`: existing host allowlist includes synthesis and agent session.
- `src/renderer/ui/speech/SpeechServiceChannel.ts`: reuse transport and backpressure.
- `src/renderer/ui/voice-assistant/VoiceAssistantHooks.ts`: reuse request hook; leave interrupt hook to US-1788.
- `assets/guides/agents/agent-session.md`, `assets/guides/agents/speech-synthesize.md`: consume existing v1 contracts; guide tuning is US-1788.
- Board bridge types/version: no board-facing bridge API is added; no `BOARD_BRIDGE_VERSION` bump. If implementation adds one, bump it and update its contract documentation in that phase.
