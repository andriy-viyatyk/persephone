# US-1723: Reserve `speech.transcribe` and publish its v1 contract guide

## Goal

Reserve `speech.transcribe` as a platform service-interface id and prepare a normative v1 guide that lets Persephone board providers and consumers interoperate. Register the guide in Persephone's documentation surfaces and update the reserved-id references and release-note plan.

## Background

EPIC-133 defines v1 as record-then-transcribe on one service channel: the consumer opens with `transcribe` or `describe`; a transcription streams ordered audio chunks and ends with one result or terminal error; the provider then closes. Its Concerns 1 and 6 apply here: determine how a pre-reservation build normalizes the id, and keep Whisper-server implementation/API verification in BT-056 rather than treating it as a Persephone contract assumption.

The existing id validator is `validServiceInterfaceId` in `src/shared/board-manifest-utils.ts`. It accepts ids in `PLATFORM_SERVICE_INTERFACE_IDS` or exactly two non-empty slash-separated segments. At this task's baseline the set contains only `agent.session`, so bare `speech.transcribe` is rejected by the validator. `normalizeServiceInterfaces` and `normalizeServiceUses` both route through `normalizeServiceDeclarations`; invalid declarations invoke the optional issue callback and are skipped. The parser in `src/renderer/editors/board/board-manifest.ts` records these as `kind: "service-interface"` manifest issues without returning `null` for an otherwise valid manifest. `BoardInfoEditorModel.load` exposes those issues as `serviceDeclarationIssues`, and `BoardInfoEditorView` displays them as warnings. The main trust snapshot also normalizes provider and consumer declarations through the shared helper. Therefore a build without the reservation drops the offending declaration and reports a declaration warning; it does not reject the whole board manifest or crash. This is a service declaration warning, distinct from the custom-editor registration issue list.

There is no interface-id-specific trust or Board Info presentation logic: provider ids and consumer uses are rendered from generic declaration arrays. `src/renderer/editors/board/board-display-text.ts` builds a generic board-local service-title key from the id. The translated service-interface labels describe the generic field, not `agent.session`; repository searches found no `agent.session`-specific i18n entry and no hardcoded guide test list. No speech-specific translation is needed. The explicit `agent.session` references that describe the reserved-id rule are in `assets/guides/agents/boards.md`, `assets/guides/boards.md`, and `doc/architecture/scripting.md`, and should be generalized to include `speech.transcribe`. The board template's `agent.session` examples are protocol examples, not an exhaustive reserved-id list, so they need no change.

`agent-session.md` is a normative guide with YAML front matter (`title`, `audience`, `summary`), transport/lifecycle sections, declarations, rules, and examples. Its focused MCP resource is explicitly listed in `src/main/mcp/manifest.ts`; its discovery row is in `assets/guides/agents/index.md`. The `guides.agents` object is not separately enumerated in scripting code: the shared guide index recursively scans Markdown files, and the MCP `GuidesNode` exposes folder pages from that index. Adding the new guide file makes the page addressable there; the guide index row remains the author-facing discovery entry. The MCP focused resource list is explicit and needs its own entry.

No bridge API is added. `BOARD_BRIDGE_VERSION` remains the API contract version; the manifest reservation is validation behavior. Board catalog/install compatibility already uses `minAppVersion`, while `minBridgeVersion` is reserved for bridge capabilities. Boards consuming or providing this new id should gate on the Persephone release that ships the reservation (planned as 5.0.15), not a bridge-version change.

## Implementation Plan

- [x] Reserve the id in `src/shared/board-manifest-utils.ts`.

  Before:
  ```ts
  export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session"]);
  ```

  After:
  ```ts
  export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session", "speech.transcribe"]);
  ```

  This makes both provider `serviceInterfaces` and consumer `uses` accept the same reserved id through the existing shared validator.

- [x] Create `assets/guides/agents/speech-transcribe.md` using the complete normative draft below. Preserve the front matter and practical board-author tone of `assets/guides/agents/agent-session.md`.

  **Full guide draft for review:**

  ````markdown
  ---
  title: "Speech Transcription — the speech.transcribe v1 contract"
  audience: both
  summary: "Normative provider and consumer contract for record-then-transcribe audio over Persephone board service channels."
  ---

  # Speech Transcription — the `speech.transcribe` v1 contract

  This is the normative contract for boards that provide or consume `speech.transcribe` version 1. One channel represents one transcription or one provider-description request. The consumer records and streams audio; the provider returns one result or error and closes the channel. The provider owns its engine, data handling, and caller approval policy.

  ## Declarations and transport

  Declare the exact interface version in `board-manifest.json`:

  ```json
  // Provider
  {"minAppVersion":"5.0.15","permissions":{"service":true},"serviceInterfaces":[{"id":"speech.transcribe","version":1,"title":"Speech to Text"}]}
  // Consumer; also declare permissions.microphone when the page records audio
  {"minAppVersion":"5.0.15","uses":[{"id":"speech.transcribe","version":1}],"permissions":{"microphone":true}}
  ```

  `uses` grants messaging access only. It does not grant the provider's permissions or authorize the consumer to approve provider actions. Providers must be trusted and have their own `service` permission. A provider must apply its own approval policy to every caller. If it refuses a caller, close with the platform's normal `connection-refused` code.

  Use `persephone.services.list("speech.transcribe")` to discover providers and `persephone.services.connect("speech.transcribe", selector, openMessage)` to open a cross-board channel. The provider handles cross-board and same-board opens with `persephone.service.onChannel((channel, openMessage, info) => ...)`. Versions match exactly. See the [Boards guide](./boards.md) for trust, grants, channel limits, and lifecycle behavior.

  ## Opening requests

  `services.connect` sends one opening request. For transcription, use:

  ```js
  {
    type: "transcribe",
    format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
    languages: ["uk", "en"], // optional ISO 639-1 hints; absent or [] means auto-detect
    prompt: "Persephone, Codex, board" // optional vocabulary hint
  }
  ```

  V1 accepts mono, signed 16-bit little-endian PCM at 16,000 samples per second. `languages` is optional; an absent or empty list asks the provider to detect the language. `prompt` is an optional vocabulary hint. Providers may reject a different format with `unsupported-format`.

  `{ type: "describe" }` asks for provider metadata. The provider answers with one `description` message and closes the channel; it does not start recording or transcription.

  ## Consumer to provider

  After a `transcribe` open, the consumer sends any number of ordered audio messages, then exactly one terminal control message:

  | Message | Fields | Meaning |
  |---|---|---|
  | `audio` | `data: ArrayBuffer` | An ordered chunk of PCM s16le audio in the opening format. |
  | `end` | — | No more audio; finish the recording and transcribe it. |
  | `cancel` | — | Cancel this transcription. |

  Respect channel backpressure with `writable` and `whenWritable()` before sending. Chunks should be small enough for timely delivery. A provider may reject audio whose accumulated duration exceeds its advertised `maxAudioMs`; it must not silently truncate and report that as a complete transcription.

  ## Provider to consumer

  All provider messages are structured-cloneable objects with a string `type` discriminator.

  | Message | Fields | Meaning |
  |---|---|---|
  | `status` | `state: "preparing" \| "listening" \| "transcribing"`, optional `detail` | `listening` is sent once immediately after accepting a `transcribe` open. `preparing` means loading an already-installed engine/model and may include numeric `detail.progress`; downloads are not part of a transcription request. `transcribing` means the provider is processing the completed audio. |
  | `result` | `text`, `language`, `audioMs`, `elapsedMs` | The single successful transcription result. `language` is the ISO 639-1 code the provider detected or was instructed to use, or `""` when unknown. Send this once, then close. |
  | `error` | `code`, `message` | A terminal failure. Send a useful explanation, then close. |
  | `description` | `engine`, `model`, `languages`, `local`, `maxAudioMs`, `features` | Provider metadata returned only for `describe`. |

  `languages` in a description is `"auto"` or an array of supported language codes. `local: true` means the audio is processed on the user's machine and does not leave it; `local: false` means audio leaves the machine and consumers should disclose that before recording. `maxAudioMs` is the provider's maximum recording duration in milliseconds. V1 `features` is an array and is empty when the provider implements only this contract; do not infer extra behavior from the engine name.

  Use these v1 error codes:

  | Code | Meaning |
  |---|---|
  | `not-ready` | Required engine or model is not installed. The provider sends this immediately when it receives a `transcribe` open, before accepting it, and closes. `message` explains how the user can make it ready. |
  | `unsupported-format` | The opening format is unsupported. |
  | `too-long` | Audio exceeds `maxAudioMs`. The provider sends this as soon as accumulated audio exceeds the limit, then closes; it does not wait for `end`. |
  | `engine-failed` | The transcription engine failed. |
  | `cancelled` | The consumer cancelled the operation. |

  The provider may also refuse the connection before accepting the open request with the platform close code `connection-refused`.

  ## Lifecycle and limits

  One channel handles one request. The provider checks its approval policy before describing or accepting any request. For `transcribe`, it checks readiness at open: if the required engine or model is not installed, it immediately sends `not-ready` and closes without accepting the request or starting a download. Otherwise it accepts the request and sends `listening` exactly once, immediately. Consumers may start streaming as soon as `connect` resolves; they must not wait for `listening`. The provider buffers audio received while it loads the already-installed engine/model. The normal status order is `listening` → after `end`, optional `preparing` → `transcribing` → exactly one `result` or `error`. Terminal pre-accept errors such as `not-ready` or `unsupported-format` may close without a status; `too-long` is sent immediately during streaming if the limit is exceeded, without waiting for `end`. `preparing` only reports loading an installed engine/model; first-run downloads are user-triggered separately. If the consumer sends `cancel`, stop work, send `error` with code `cancelled` when the channel is still writable, and close. On any `error`, the consumer stops microphone capture. If the channel closes first, stop recording/transcription work and release request-scoped resources. Do not keep sending after close.

  Each provider advertises its own `maxAudioMs` and enforces that limit for one recording. Speech to Text advertises five minutes; other providers may choose a different finite limit. Keep provider-to-consumer messages within the platform's 1 MiB serialized-message limit and obey channel backpressure. A single result contains text and timing, not audio.

  ## Forward compatibility

  Consumers must ignore unknown provider message types and unknown fields on known messages. Providers may add fields to v1 messages, but must preserve the meaning of existing fields and behavior. New optional behavior is advertised through `features`; v1 providers report `features: []`. An incompatible protocol change requires a new interface version and a separate contract. Live partial transcription is not part of v1.

  ## Minimal consumer

  The capture implementation below is abbreviated: an `AudioWorklet` captures mono samples, resamples to 16 kHz if necessary, converts each sample to signed PCM s16le, and calls `sendChunk(ArrayBuffer)` as chunks are ready.

  ```js
  const providers = await persephone.services.list("speech.transcribe");
  if (providers.length === 0) throw new Error("No speech.transcribe provider is installed");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const channel = await persephone.services.connect("speech.transcribe", {
    provider: providers[0].provider, version: 1,
  }, {
    type: "transcribe",
    format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
    languages: ["uk", "en"],
    prompt: "Persephone, Codex, board",
  });
  channel.onMessage(message => {
    if (message.type === "status") showStatus(message.state, message.detail);
    if (message.type === "result") insertAtCursor(message.text);
    if (message.type === "error") {
      stopCapture();
      showError(message.code, message.message);
    }
  });
  function stopCapture() {
    stopWorklet();
    stream.getTracks().forEach(track => track.stop());
  }
  // The worklet emits ArrayBuffer chunks after conversion to 16 kHz PCM s16le.
  async function sendChunk(data) {
    if (!channel.writable) await channel.whenWritable();
    channel.send({ type: "audio", data });
  }
  // On the user's stop action:
  await stopWorkletAndFlush(sendChunk);
  channel.send({ type: "end" });
  // Stop capture before sending the terminal audio message.
  stream.getTracks().forEach(track => track.stop());
  ```

  The consumer needs the manifest's `uses` declaration and microphone permission because it owns capture. It should insert returned text into its UI and must not send or submit that text automatically unless its own UX explicitly asks the user.

  ## Minimal provider

  ```js
  persephone.service.onChannel(async (channel, open, info) => {
    // Check first: even describe and malformed requests disclose nothing to refused callers.
    if (!approvalPolicyAllows(info)) {
      channel.close({ code: "connection-refused", message: "This provider does not accept this caller." });
      return;
    }
    if (open?.type === "describe") {
      channel.send({
        type: "description", engine: "Example Engine", model: "Example Model",
        languages: "auto", local: true, maxAudioMs: 300000, features: [],
      });
      channel.close();
      return;
    }
    if (open?.type !== "transcribe") {
      channel.close({ code: "connection-refused", message: "Unsupported request." });
      return;
    }
    // Check before accepting the request so the consumer can stop capture immediately.
    if (!await isEngineAndModelInstalled()) {
      channel.send({ type: "error", code: "not-ready", message: "Install the engine and model in this provider board first." });
      channel.close();
      return;
    }
    if (open.format?.encoding !== "pcm-s16le" || open.format.sampleRate !== 16000 || open.format.channels !== 1) {
      channel.send({ type: "error", code: "unsupported-format", message: "Use mono PCM s16le at 16 kHz." });
      channel.close();
      return;
    }
    channel.send({ type: "status", state: "listening" });
    const engineReady = loadInstalledEngineAndModel();
    const chunks = [];
    let receivedAudioMs = 0;
    channel.onMessage(async message => {
      if (message.type === "audio") {
        receivedAudioMs += durationMs(message.data);
        if (receivedAudioMs > 300000) {
          channel.send({ type: "error", code: "too-long", message: "Recording exceeds this provider's five-minute limit." });
          channel.close();
          return;
        }
        chunks.push(message.data);
      }
      if (message.type === "cancel") {
        await cancelTranscription();
        channel.send({ type: "error", code: "cancelled", message: "Transcription cancelled." });
        channel.close();
      }
      if (message.type === "end") {
        if (!engineIsLoaded()) channel.send({ type: "status", state: "preparing" });
        try {
          await engineReady;
          channel.send({ type: "status", state: "transcribing" });
          const result = await transcribe(chunks, open.format, open.languages, open.prompt);
          channel.send({ type: "result", ...result });
        } catch (error) {
          channel.send({ type: "error", code: "engine-failed", message: "Transcription failed." });
        } finally {
          channel.close();
        }
      }
    });
  });
  ```

  This skeleton leaves engine setup, PCM accumulation, cancellation races, and error mapping to the provider. A production provider must validate the format, enforce `maxAudioMs` while audio arrives, send `not-ready` immediately before accepting a request when the engine/model is not installed, buffer audio while loading an installed engine/model, map failures to the defined error codes, and ensure terminal messages are sent only once. It must not trust caller-supplied audio or metadata merely because the caller has a `uses` grant.
  ````

- [x] Add an explicit focused MCP resource in `src/main/mcp/manifest.ts`, adjacent to `agent-session-guide`.

  Before:
  ```ts
  {
      name: "agent-session-guide",
      uri: "persephone://guides/agent-session",
      file: "guides/agents/agent-session.md",
      description: "Normative provider and consumer contract for streaming, resumable agent sessions over board service channels.",
  },
  ```

  After: retain the existing entry and add:

  ```ts
  {
      name: "speech-transcribe-guide",
      uri: "persephone://guides/speech-transcribe",
      file: "guides/agents/speech-transcribe.md",
      description: "Normative provider and consumer contract for speech transcription over board service channels.",
  },
  ```

- [x] Add a discovery row in `assets/guides/agents/index.md` alongside Agent Session, linking `./speech-transcribe.md`, naming `guides.agents["speech-transcribe"]`, and pointing to `persephone://guides/speech-transcribe`.

  Before:
  ```md
  | Build or consume a board-backed coding-agent session | `persephone.services.connect("agent.session", ...)` | [Agent Session contract](./agent-session.md) / `guides.agents["agent-session"]` / `persephone://guides/agent-session` |
  ```

  After: retain that row and add:

  ```md
  | Build or consume speech transcription | `persephone.services.connect("speech.transcribe", ...)` | [Speech Transcription contract](./speech-transcribe.md) / `guides.agents["speech-transcribe"]` / `persephone://guides/speech-transcribe` |
  ```

  `guides.agents` is not a hand-maintained scripting enum: `src/shared/guides/index.ts` scans Markdown pages recursively and the guide tree exposes them dynamically. No separate scripting code change is planned.

- [x] Generalize the reserved-id statement in `assets/guides/agents/boards.md` and `doc/architecture/scripting.md` to name both reserved ids. In `assets/guides/boards.md`, add the reserved-id rule and speech-guide link after the existing Agent Session contract paragraph; the user guide does not currently state the reserved-id rule. Do not change `assets/board-template/CLAUDE.md`: its ids are examples for the specific Agent Session protocol, not a statement that the reserved list is exhaustive.

  Before (agent guide):
  ```md
  `agent.session` is the reserved platform id; third-party ids use exactly `author/name`.
  ```

  After:
  ```md
  `agent.session` and `speech.transcribe` are reserved platform ids; other ids use exactly `author/name`.
  ```

  Before (user guide, exact existing paragraph):
  ```md
  For a streaming coding-agent provider and consumer protocol over this channel, see the normative
  [`agent.session` v1 contract](./agents/agent-session.md) (`guides.agents["agent-session"]`). The
  Agent Chat board uses this platform contract for its coding-agent sessions.
  ```

  After (retain the paragraph and add the reserved-id rule and speech guide):
  ```md
  For a streaming coding-agent provider and consumer protocol over this channel, see the normative
  [`agent.session` v1 contract](./agents/agent-session.md) (`guides.agents["agent-session"]`). The
  Agent Chat board uses this platform contract for its coding-agent sessions.

  `agent.session` and `speech.transcribe` are reserved platform ids; other ids use exactly `author/name`.
  For recording audio and getting text back from an installed speech-to-text board, see the normative
  [`speech.transcribe` v1 contract](./agents/speech-transcribe.md) (`guides.agents["speech-transcribe"]`).
  ```

  Before (developer scripting guide):
  ```md
  `agent.session` is the reserved platform id; other ids use exactly `author/name`.
  ```

  After:
  ```md
  `agent.session` and `speech.transcribe` are reserved platform ids; other ids use exactly `author/name`.
  ```

- [x] Add a What's New plan under `## Version 5.0.15 (Upcoming)` in `assets/guides/whats-new.md`, following the existing release-note bullet style.

  Before:
  ```md
  ## Version 5.0.15 (Upcoming)

  *No changes yet.*
  ```

  After:
  ```md
  ## Version 5.0.15 (Upcoming)

  ### Improvements

  - **Speech transcription service contract:** Board authors can provide or consume the reserved `speech.transcribe` v1 interface using a documented record-then-transcribe channel contract.
  ```

  Release-note wording can be finalized when implementation lands.

- [x] Leave `src/shared/board-bridge-version.ts` unchanged. `BOARD_BRIDGE_VERSION` is currently `1.42.0`; this task introduces no bridge method or message shape. The relevant interface validation is in `board-manifest-utils.ts`; compatibility checks distinguish `minAppVersion` from `minBridgeVersion` in `src/shared/version-utils.ts`, and board catalog/install paths compare `minAppVersion`. Set the board tasks' manifests to the Persephone release containing this reservation (expected 5.0.15).

## Concerns

1. **Pre-reservation compatibility (resolved from code):** an older build rejects the bare id as invalid because it is neither in the reserved-id set nor `author/name`. `normalizeServiceDeclarations` reports the issue through the callback and skips that one declaration. `parseBoardManifest` keeps the rest of the manifest; Board Info receives `serviceDeclarationIssues` and displays a warning. The main trust service uses the same normalizers, so the provider/use declaration is absent from its snapshot. This is a dropped declaration with a visible service-declaration warning, not whole-board rejection, not a `CustomEditorRegistry` registration issue, and not a crash. Boards should set `minAppVersion` to the release that adds the reservation so older builds do not silently lack the interface.
2. **Bridge version:** no `BOARD_BRIDGE_VERSION` bump is needed. The service channel and cross-board service APIs already exist in bridge 1.42.0; only the allow-list used by manifest validation changes. Board compatibility uses `minAppVersion` for app-version requirements and `minBridgeVersion` for bridge API requirements.
3. **Engine behavior:** this guide defines the transport contract, not Whisper-server HTTP details. Concern 6 remains for BT-056: verify the pinned whisper-server's auto-detected language output, prompt parameter, and raw PCM versus WAV support before implementing its provider.
4. **Consumer sample:** the sample deliberately summarizes AudioWorklet conversion/resampling rather than specifying a capture implementation. The consumer board task owns the concrete recorder UX and audio pipeline.

## Acceptance Criteria

- [x] `speech.transcribe` is included in the reserved service-interface id set, applying equally to provider `serviceInterfaces` and consumer `uses` declarations.
- [x] The complete draft above is published as `assets/guides/agents/speech-transcribe.md`, with contract messages, fields, errors, limits, cancellation/close behavior, compatibility rules, provider approval policy, manifests, and both examples intact.
- [x] The guide is discoverable through the focused MCP resource, `assets/guides/agents/index.md`, the dynamic `guides.agents["speech-transcribe"]` guide tree, and the full API guide assembled by `getAgentGuidePages` in `src/main/mcp/server-factory.ts` (currently line 68 recursively enumerates indexed agent pages).
- [x] The reserved-id description in `assets/guides/agents/boards.md`, `assets/guides/boards.md`, and the developer scripting guide names both `agent.session` and `speech.transcribe`; the user guide also links the speech contract.
- [x] The v5.0.15 upcoming What's New section contains the planned entry in the file's release-note style.
- [x] The task implementation does not change `BOARD_BRIDGE_VERSION`; the epic's Concern 1 is documented with the actual normalization and Board Info warning path.
- [x] The task remains scoped to the Persephone repository; BT-055 through BT-057 are not planned here.

## Files with NO changes

- `src/renderer/editors/board/board-manifest.ts` — already normalizes provider and consumer declarations through the shared helper and records service-interface issues without rejecting the manifest.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `src/renderer/editors/board-info/BoardInfoEditorView.ts` — already show generic service ids and declaration warnings; no id-specific presentation change is needed.
- `src/renderer/editors/board/board-display-text.ts` — service title localization keys are generated generically from the interface id; there is no platform-id special case.
- `src/shared/i18n/en/board.ts` and other locale files — service-interface and trust wording uses generic translated labels and interpolated ids; no `agent.session` special-case copy exists.
- `src/renderer/editors/board/board-permission-copy.ts` and trust dialog code — consumer `uses` are displayed generically; `speech.transcribe` receives the same disclosure as any other non-empty `uses` grant.
- `src/shared/board-bridge-version.ts` — no new board-facing bridge API is introduced.
- `assets/board-template/CLAUDE.md` — its `agent.session` snippets are examples for that protocol, not an exhaustive list of reserved ids.
- Board implementation sources in the separate persephone-boards repository — BT-055 through BT-057 are separate tasks and outside this task's scope.
- Tests — no tests are to be added or changed for this planning task.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1723-speech-transcribe-contract/README.md` | This reviewable implementation plan and full normative guide draft. |
| `doc/active-work.md` | Move EPIC-133 from Planned to Active and link US-1723 to this task document. |
| `doc/epics/EPIC-133.md` | Link the US-1723 task row and change its status to In Progress. |
| `src/shared/board-manifest-utils.ts` | Add `speech.transcribe` to the platform-reserved id set. |
| `assets/guides/agents/speech-transcribe.md` | Publish the full guide draft above. |
| `src/main/mcp/manifest.ts` | Register the guide as a focused MCP resource. |
| `assets/guides/agents/index.md` | Add the guide discovery row. |
| `assets/guides/agents/boards.md` | Document both reserved platform ids. |
| `assets/guides/boards.md` | Add the reserved-id rule and a speech contract link to the cross-board services section. |
| `doc/architecture/scripting.md` | Document both reserved platform ids. |
| `assets/guides/whats-new.md` | Add the v5.0.15 upcoming release-note plan. |
