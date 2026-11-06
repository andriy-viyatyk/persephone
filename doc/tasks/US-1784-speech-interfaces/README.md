# US-1784: Reserve speech interfaces and publish v1 contracts

Epic: [EPIC-139](../../epics/EPIC-139.md) · Phase 1 prerequisite · Planned

## Goal

Reserve `speech.synthesize` and `speech.wake`, allow Persephone to consume their v1 channels, and publish provider/consumer contracts before the provider boards are built. This task does not build those boards or the assistant.

## Background

- `src/shared/board-manifest-utils.ts` uses `PLATFORM_SERVICE_INTERFACE_IDS` in `validServiceInterfaceId()` for both `serviceInterfaces` and `uses`; unreserved IDs must have exactly two nonempty `author/name` segments. Normalization validates positive integer versions, deduplicates, and sorts declarations.
- `src/main/module-service-supervisor.ts` has a separate `HOST_SERVICE_CHANNEL_POLICIES` allow-list. `connectHostServiceChannel()` validates the interface/version and opening `type`, rechecks provider trust, service permission and declaration, imposes channel limits, and supplies caller `{ id: "persephone", name: "Persephone" }` and interface metadata. Existing prefixes scope channel ownership per window. US-1785 owns `agent.session` host access.
- `assets/guides/agents/speech-transcribe.md` and `text-translate.md` define one channel per operation, declarations, host identity, approval, structured messages, terminal errors, lifecycle and compatible versioning. Transcription uses mono 16 kHz `pcm-s16le` audio in ordered `ArrayBuffer` chunks with `writable`/`whenWritable()`. Service-to-page serialized messages have a 1 MiB limit; each direction has 256 unacknowledged messages (`doc/architecture/scripting.md`). Handlers must be registered before awaiting, since early messages are not replayed.
- [US-1783](../US-1783-wake-word-research/README.md) recommends enrollment and query-by-example for both wake and stop, with roughly five samples per phrase/person; provider storage and matching belong to BT-083. [US-1789](../US-1789-tts-research/README.md) recommends Supertonic 3 in BT-082, sentence-level Float32 PCM, voice 0 by default, and copied rather than external buffers in Electron. The contracts do not mandate either engine.
- EPIC-139 decisions 1, 2, 2a, 3, 3a, 10 and 11 place the assistant, microphone/loopback capture, comparisons between streams, and settings in the app; wake processing must be local. The app sends recordings to the provider but does not persist or own enrollment voice data. Separate `listen` channels permit independent microphone and loopback detection; comparing their event times is app work in US-1786.
- The guide index and call tree are generated from the mounted Markdown corpus (`src/shared/guides/index.ts`, `src/main/mcp/ai-vision/guides.ts`), not a static page list. MCP resource aliases are explicitly listed in `src/main/mcp/manifest.ts`.

## Implementation plan

- [x] **Reserve the IDs.** In `src/shared/board-manifest-utils.ts`, change:

  ```ts
  // Before
  export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session", "speech.transcribe", "text.translate"]);
  // After
  export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session", "speech.transcribe", "speech.synthesize", "speech.wake", "text.translate"]);
  ```

  The shared normalization already covers provider and consumer manifests; do not add independent validators or weaken `author/name`.

- [x] **Permit only the intended host operations.** Add the following to `HOST_SERVICE_CHANNEL_POLICIES` in `src/main/module-service-supervisor.ts` after the existing `speech.transcribe@1` entry:

  ```ts
  // Before: speech.transcribe@1 and text.translate@1 only
  // After: retain both existing entries and add
  ["speech.synthesize@1", { interfaceId: "speech.synthesize", version: 1, openTypes: new Set(["describe", "speak"]), boardIdPrefix: "speech-synthesize:" }],
  ["speech.wake@1", { interfaceId: "speech.wake", version: 1, openTypes: new Set(["describe", "enroll", "list", "delete", "listen"]), boardIdPrefix: "speech-wake:" }],
  ```

  Keep all existing trust, declaration, version, lifecycle and limits checks. These prefixes distinguish ownership and close handling by window. Do not add `agent.session`.

- [x] **Create `assets/guides/agents/speech-synthesize.md`.** Before: no guide. After: add front matter (`title`, `audience: both`, `summary`) and the same sections as the existing guides: declarations and transport, opening requests, both message directions, errors, lifecycle/limits, forward compatibility, and practical consumer/provider examples. Include provider `permissions.service` and `serviceInterfaces` and consumer `uses` examples with version 1; document `persephone.services.list/connect`, `persephone.service.onChannel`, exact matching, grants, provider approval, `connection-refused`, and the host caller/metadata as in transcription. Use a minimum app version corresponding to the release that actually ships these IDs; do not claim 5.0.15 supports them.

  Specify this v1 wire contract (all messages structured-cloneable, one operation per channel):

  | Opening request | Provider messages and meaning |
  |---|---|
  | `{ type: "describe" }` | `{ type: "description", local: boolean, languages: string[], voices: { index: number, name: string }[], defaultVoice: number, sampleRate: number, encoding: "pcm-f32le" }`, then close. Language codes are ISO 639-1; voice indices are stable within a provider and defaultVoice must occur in voices; sampleRate is the default output rate in Hz. `local` has transcription's privacy meaning. |
  | `{ type: "speak", text: string, lang: string, voice?: number, speed?: number }` | Ordered `{ type: "audio", data: ArrayBuffer, sampleRate: number, encoding: "pcm-f32le", sentence: number, text: string }` messages, then `{ type: "done" }` and close. A sentence may span several consecutive messages; `sentence` is its zero-based index and `text` repeats that sentence's text on each of its chunks. Audio is mono IEEE Float32 PCM, little-endian; `data` contains only whole samples, with its own actual rate in Hz. Omitted `voice` defaults to `description.defaultVoice`; omitted `speed` defaults to 1. `speed` is a finite positive multiplier, and providers should accept at least 0.5–2; an out-of-range speed is `invalid-argument`. Providers validate all inputs and reject unsupported selections. |

  Provider sends `error` `{ type, code, message }` and closes on failure; document `not-ready`, `invalid-argument`, `unsupported-language`, `unsupported-voice`, and `engine-failed`, plus platform close `connection-refused`. Do not start a download on a request. Consumer cancels by closing; provider stops work and releases resources on close. Respect channel backpressure in both directions and the 1 MiB serialized service-message cap; providers should keep each audio `data` payload at or under 256 KiB. V1 consumers reject any encoding other than `pcm-f32le` without playback, whether advertised in the description or received in an audio message; the explicit field permits future encodings without changing the interface version. Document that Node providers in Electron must not hand out external ArrayBuffers; US-1789 finding 5 used `enableExternalBuffer: false` with sherpa-onnx. `describe` is metadata, not a guarantee of an installed model.

- [x] **Create `assets/guides/agents/speech-wake.md`.** Before: no guide. After: use the same front matter and guide structure and declaration/approval/host guidance as above. A channel handles one operation; only `listen` is long-lived. An enrollment is one clip, never an open-ended session. Give request and response tables with the following exact shapes and lifecycle:

  | Open | Consumer messages | Provider replies |
  |---|---|---|
  | `{ type: "describe" }` | none | `{ type: "description", local: boolean, features: string[], defaultThreshold: number, maxEnrollMs: number }`, then close. `local` has transcription's meaning; assistant must reject `false`. `maxEnrollMs` is the finite enrollment clip limit in milliseconds. |
  | `{ type: "enroll", phrase: string, kind: "wake" \| "stop", person: string, format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 } }` | Ordered `{ type: "audio", data: ArrayBuffer }`, then `{ type: "end" }` | `{ type: "enrolled", sampleId: string, quality: { accepted: boolean, reason?: string }, match: number \| null }`, then close. `match` is the best score against earlier samples for the same phrase, kind and person, or null when none; rejected clips have no stored sample and `sampleId` is an empty string. |
  | `{ type: "list" }` | none | `{ type: "enrollments", phrases: { phrase: string, kind: "wake" \| "stop", person: string, samples: { sampleId: string }[] }[] }`, then close. Metadata only, never voice data. |
  | `{ type: "delete", target: { phrase: string, kind: "wake" \| "stop" } \| { person: string } \| { sampleId: string } }` | none | `{ type: "deleted", count: number }`, then close. Phrase target deletes that phrase and kind across people; person target deletes all that person's samples; sampleId deletes exactly one. Zero count is a successful no-op. |
  | `{ type: "listen", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 }, threshold?: number }` | Ordered `audio` as above, then `{ type: "end" }` when capture ends | Zero or more `{ type: "wake" \| "stop", phrase: string, person: string, score: number, time: number }`, then `{ type: "done" }` and close after `end`. `time` is milliseconds from the first input sample to the end of the detected phrase, permitting comparison of aligned streams. |

  Define `score` and `match` as finite normalized similarity in [0, 1], higher is closer; a detection meets `score >= threshold`, and `defaultThreshold` has the same scale. This is a contract normalization, not US-1783's lower-is-better DTW distance of 0.15; BT-083 must map its engine's distance and default consistently. Phrase/person are nonempty exact, case-sensitive strings; `sampleId` is a provider-generated opaque stable ID unique within that provider. `kind` is part of phrase identity. No sample audio or embeddings appear in responses. Store recordings/templates in the provider's own board data, never app storage; require callers to avoid retaining enrollment audio after sending. This does not prohibit the transient capture needed to send a clip.

  Reuse transcription's audio format, small ordered chunks and backpressure without deviation; register handlers before any await and buffer early messages while accepting/loading. `enroll` has a provider-enforced finite clip limit (advertise `maxEnrollMs` in `description`); reject excessive clips immediately with `too-long`, never truncate. If no samples are enrolled, `listen` sends `no-enrollments` at open, before accepting audio, and closes so the app can prompt for enrollment. `listen` emits both wake and stop events regardless of assistant state; the consumer decides which matter. V1 has no kind filter and the provider has no assistant-state model. `listen` has no total-duration cap but bounds retained audio and queued work; closing cancels either operation and releases resources. Send `not-ready`, `no-enrollments`, `unsupported-format`, `too-long`, `invalid-argument`, or `engine-failed` as terminal `{ type: "error", code, message }` then close; provider refusal uses `connection-refused`. No request triggers a model download. List and delete do not return audio. Include examples of enrollment, listing, deletion, streaming and separate microphone/loopback channels; explain that time comparisons require aligned capture origins and are the consumer's responsibility.

- [x] **Versioning for both guides.** Consumers ignore unknown message types and fields; providers preserve v1 field meanings and required behavior. New optional behavior is advertised via `features` where applicable; incompatible changes require a new interface version and guide. Document `writable`/`whenWritable()` and message-size limits; examples handle errors, close and cancellation. Avoid promising exact engine quality or false-trigger rates.

- [x] **Register and cross-link.** In `src/main/mcp/manifest.ts` `resourceFiles`, alongside `speech-transcribe-guide`, add:

  ```ts
  // Before: speech-transcribe-guide followed by text-translate-guide
  // After: insert these resource records between them
  { name: "speech-synthesize-guide", uri: "persephone://guides/speech-synthesize", file: "guides/agents/speech-synthesize.md", description: "Normative provider and consumer contract for streamed speech synthesis over board service channels." },
  { name: "speech-wake-guide", uri: "persephone://guides/speech-wake", file: "guides/agents/speech-wake.md", description: "Normative provider and consumer contract for enrolled wake and stop phrases over board service channels." },
  ```

  `guides.agents["speech-synthesize"]` and `guides.agents["speech-wake"]` derive from the files and their front matter; verify discovery, do not add a static call-tree registry. In `assets/guides/agents/index.md`, add two rows beside the transcription row linking the guide, call path and MCP URI. In `assets/guides/agents/boards.md` and `assets/guides/boards.md`, update the reserved-ID sentence and add links to both normative guides beside existing contracts. In `doc/architecture/scripting.md`, update the reserved-ID list and add concise contract/host channel pointers beside transcription and translation. In `doc/architecture/key-files.md`, update the supervisor row to name all four host interfaces; the bridge-version row stays accurate.

  ```md
  Before: `agent.session`, `speech.transcribe`, and `text.translate` are reserved platform ids
  After: `agent.session`, `speech.transcribe`, `speech.synthesize`, `speech.wake`, and `text.translate` are reserved platform ids
  ```

- [ ] **Manual verification, no test harness.** Inspect normalized provider and consumer declarations for both IDs and an invalid unreserved bare ID; confirm exact-version host opens accept each listed type and reject unknown types, wrong versions and `agent.session`, with existing trust checks intact. In a running app with an appropriate local provider or temporary manual stub, check discovery, channel metadata, operation lifecycle, close cancellation and backpressure; verify both guide pages via `guides.agents`, guide browser and `persephone://guides/*` MCP resources. Run the project lint for changed TypeScript. Do not add unit tests or a test harness.

### Verification progress

- [x] Read normalization and host policy code: both declaration paths share reserved-ID validation; other bare IDs are rejected. The v1 policy checks the listed opens and excludes unknown types, other versions and `agent.session`; trust, service permission, declaration and limits checks remain in place.
- [x] Read guide indexing and call-tree code: Markdown files and front matter supply dynamic entries; MCP aliases are registered.
- [x] `npm run typecheck`, `npm run lint`, and `npm run build-prod` passed. The build reports dynamic-import and chunk-size warnings.
- [x] In the running app, `guides["agents/speech-wake"]` and `guides["agents/speech-synthesize"]` resolve through the call tree (2026-11-06).
- [ ] Channel discovery, metadata, lifecycle, cancellation and backpressure need a real provider: verified in BT-082 and BT-083.
- No UI catalog messages were added.

## Concerns / Open questions

- **Bridge version verdict: no bump.** `src/shared/board-bridge-version.ts` currently defines `BOARD_BRIDGE_VERSION = "1.49.0"`; `doc/architecture/key-files.md` documents the version history, including service channels and cross-board interfaces at 1.42.0. This plan uses the existing generic manifest, channel, callback and message surfaces. Reserving names and authorizing the app as an existing host caller adds no board-facing bridge method, field, or channel primitive. If implementation changes that surface, revisit this verdict and bump/document the bridge version before shipping.
- The contract chooses normalized higher-is-better scores so providers with different engines can interoperate; it does not assert US-1783's 0.15 is that normalized value. BT-083 must publish a calibrated default and document its conversion.
- Wake privacy depends on the provider truthfully advertising `local` and keeping its board data local; US-1786 enforces the local requirement. Samples are sensitive provider data. The app's separate stream comparison and microphone ownership follow the epic, not this task.
- No new English UI strings are planned: guide prose and MCP descriptions are durable English per `doc/standards/localization.md`. If implementation introduces UI catalog messages, list each key and translate to every built-in pack at epic completion, with `npm run i18n:check`.

## Acceptance criteria

- [x] Both IDs normalize for provider and consumer declarations; other unreserved IDs still require `author/name`.
- [x] Host channels allow exactly the specified v1 opening types for both interfaces, preserving existing authorization; `agent.session` remains excluded.
- [x] Both normative guides specify interoperable requests, messages, formats, privacy, errors, lifecycle, backpressure, limits, examples and versioning; synthesis streams sentence PCM and wake supports complete enrollment management and independent listening streams.
- [ ] Both guides are discoverable in the guide index, call tree and MCP resources, and linked from agent and user board guides; architecture and key-files descriptions match.
- [x] Bridge version remains unchanged for the stated reason; no provider, assistant, tests or test harness is added.
- [ ] Manual checks and lint above are recorded, and any new UI text is listed for translation.

## Files that need NO changes

- `src/shared/board-bridge-version.ts`, `src/board-shim.ts`, `src/renderer/editors/board/board-api.d.ts`: existing generic bridge supports these interfaces; no new board API.
- `src/shared/guides/index.ts`, `src/main/mcp/ai-vision/guides.ts`, `assets/guides/index.md`: corpus indexing and call-tree entries are dynamic; the top-level user index does not enumerate individual agent contracts.
- `src/renderer/ui/voice-typing/VoiceTypingController.ts`, `src/renderer/ui/speech/SpeechTranscriptionProvider.ts`, `src/renderer/ui/translation/TextTranslationProvider.ts`: existing consumers are unchanged; assistant clients belong to later tasks.
- `assets/guides/agents/speech-transcribe.md`, `assets/guides/agents/text-translate.md`: reference contracts remain unchanged.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/board-manifest-utils.ts` | Reserve both interface IDs. |
| `src/main/module-service-supervisor.ts` | Allow v1 host operations for both interfaces. |
| `assets/guides/agents/speech-synthesize.md` | New normative synthesis contract. |
| `assets/guides/agents/speech-wake.md` | New normative enrollment and detection contract. |
| `src/main/mcp/manifest.ts` | Register MCP guide resources. |
| `assets/guides/agents/index.md`, `assets/guides/agents/boards.md`, `assets/guides/boards.md` | Index and cross-link contracts; update reserved IDs. |
| `doc/architecture/scripting.md`, `doc/architecture/key-files.md` | Update architecture and supervisor index. |
| `doc/tasks/US-1784-speech-interfaces/README.md`, `doc/active-work.md`, `doc/epics/EPIC-139.md` | Record this plan, dashboard link, and epic status. |
