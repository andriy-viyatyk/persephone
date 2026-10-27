# US-1734: `text.translate` v1 contract and host consumer

## Goal

Define the normative `text.translate@1` board service contract and add the Persephone host path
that discovers and calls providers. The contract and renderer client must serve the text editor
(US-1735) and browser page translation (US-1736/US-1737) without a later protocol change.

## Background

EPIC-135 fixes the service implementation direction: Bergamot WASM in the Translate board, CLD2
detection in the board, hidden pivoting through English, batches of keyed text or HTML items,
cancellation per channel, and progress for model downloads. In-page translation
needs HTML fragments; editor translation needs stable keyed paragraph items. Detection must not
require callers to supply a source language.

The existing reference is the `speech.transcribe@1` contract in
[`assets/guides/agents/speech-transcribe.md`](../../../assets/guides/agents/speech-transcribe.md).
It defines manifest declarations, host and board consumers, structured messages, errors, approval,
limits, and minimal examples. It says providers check their caller approval policy before every
operation and do not download models as a side effect of a request.

Verified host service path:

- [`src/main/module-service-supervisor.ts`](../../../src/main/module-service-supervisor.ts),
  `connectHostServiceChannel`, hard-codes `speech.transcribe@1`, allows `describe` and
  `transcribe`, and assigns channels a `voice-typing:<window-id>` board id. It rechecks provider
  trust, service permission and declaration after starting the provider, then transfers a
  `MessagePort` to the target renderer.
- The host IPC contract currently carries `{ provider, version, openMessage }` in
  [`src/ipc/api-types.ts`](../../../src/ipc/api-types.ts), is forwarded by
  [`src/ipc/main/board-handlers.ts`](../../../src/ipc/main/board-handlers.ts), and is wrapped by
  `api.connectHostServiceChannel` in [`src/ipc/renderer/api.ts`](../../../src/ipc/renderer/api.ts).
  Main supplies the missing interface ID by hard-coding speech. Because `describe` is shared by
  multiple contracts, the generalized host request must add `interfaceId`; update these three
  typed IPC layers and the host callers. The message port is delivered through
  `api.onBoardServiceChannel`, backed by `preload.ts`'s ports-aware `onPort` listener; its event
  signature does not change.
- `voice-typing:` is relied on by the host board id in `module-service-supervisor.ts` and filters
  in [`src/renderer/ui/speech/SpeechTranscriptionProvider.ts`](../../../src/renderer/ui/speech/SpeechTranscriptionProvider.ts),
  [`src/renderer/ui/voice-typing/VoiceTypingController.ts`](../../../src/renderer/ui/voice-typing/VoiceTypingController.ts),
  and [`src/renderer/ui/transcript/TranscriptController.ts`](../../../src/renderer/ui/transcript/TranscriptController.ts).
  Preserve the prefix and current channel routing for speech; give the translation interface its
  own host board-id prefix and filter in its client.
- [`src/shared/board-manifest-utils.ts`](../../../src/shared/board-manifest-utils.ts) reserves
  only `agent.session` and `speech.transcribe` as platform interface IDs. Add `text.translate`.
- [`src/main/mcp/manifest.ts`](../../../src/main/mcp/manifest.ts) registers the speech guide as
  resource `speech-transcribe-guide`, URI `persephone://guides/speech-transcribe`, file
  `guides/agents/speech-transcribe.md`. The guide links are indexed in
  [`assets/guides/agents/index.md`](../../../assets/guides/agents/index.md). The reserved-ID list
  and service-contract pointers also appear in
  [`assets/guides/agents/boards.md`](../../../assets/guides/agents/boards.md),
  [`assets/guides/boards.md`](../../../assets/guides/boards.md), and
  [`assets/board-template/CLAUDE.md`](../../../assets/board-template/CLAUDE.md); update those lists
  so board authors see `text.translate` as a reserved platform ID.
- [`src/shared/board-bridge-version.ts`](../../../src/shared/board-bridge-version.ts) is `1.44.0`.
  The board-facing `persephone.services.list/connect` API already accepts a service ID, provider,
  version and opaque open message. The host-only IPC request currently accepts only provider,
  version and open message, so it will gain the service ID as described below. Neither change adds
  or changes the board-facing API shape, so this task does not bump `BOARD_BRIDGE_VERSION`.

The provider is the Translate board in `persephone-boards` (BT-069/BT-070), outside this task.
The provider owns the engine, model registry/download implementation, caller approval policy, and
provider-board UI. Persephone remains a consumer and must not translate text locally.

## Implementation Plan

1. [x] **Write the normative contract** in
   [`assets/guides/agents/text-translate.md`](../../../assets/guides/agents/text-translate.md),
   following the structure and level of specificity in
   [`assets/guides/agents/speech-transcribe.md`](../../../assets/guides/agents/speech-transcribe.md).
   Define the following v1 wire shapes and lifecycle (the examples below are the intended contract
   decisions for implementation):

   ```js
   // Describe one provider; reply with description and close.
   { type: "describe" }
   // Provider reply:
   { type: "description", engine, model,
     pairs: [{ from, to, installed, sizeBytes }],
     features: ["detect", "html", "download-progress"] }

   // Detect without translating; source-language correction remains a consumer concern.
   { type: "detect", text, htmlLang? }
   // Provider reply:
   { type: "detection", language, confidence: "high" | "low", sampleChars,
     candidates: [{ language, score: number }] } // up to 3, strongest first

   // Exactly one batch per channel. Omitted `from` means detect automatically.
   { type: "translate", id, from?, to,
     priority?: "visible" | "near" | "background",
     items: [{ key, text, format: "text" | "html" }] }
   // Provider emits zero or more progress messages and then one terminal result/error:
   { type: "progress", id, done, total }
   { type: "result", id,
     items: [{ key, ok: true, text } | { key, ok: false, error: { code, message } }] }
   { type: "error", code, message } // request-wide terminal failure

   // Cancels the one translate or download operation on this channel.
   { type: "cancel" }

   // Explicit model acquisition is a distinct operation, never a translate side effect.
   { type: "download", from, to }
   { type: "download-progress", from, to, leg: { from, to }, loadedBytes, totalBytes }
   { type: "download-result", from, to, installed: true }
   { type: "error", code: "download-failed" | "cancelled", message }
   ```

   Establish these rules in the guide:

   - A `translate` request MUST NOT start a model download. If one or both pivot legs are absent,
     return terminal `not-ready` before accepting work. The consumer displays the advertised pair
     sizes, obtains explicit user consent, and only then opens `download`; browser translation is
     initiated only by the explicit toolbar toggle, with no offer bar or automatic translation.
     The toggle detects the page, reports that it is already in the target language and does
     nothing in that case; otherwise it translates if ready, or prompts when a model is missing,
     downloads with progress, then translates. `download` is the only operation allowed to fetch
     models.
   - `description.pairs` enumerates directed model pairs and reports `installed` plus the total
     advertised download size in bytes. Translation accepts a requested source/target pair even
     when it is not a direct model pair; the provider resolves direct routes or pivots through
     English. For a pivot, the download operation installs both legs and progress identifies the
     leg being downloaded. Include supported language pairs, engine/model identity and stable
     feature names in `description`.
   - `detect` is separate from `translate`, accepts plain text plus optional page `htmlLang`, and
     returns a normalized BCP-47 language code, confidence, sampled character count, and up to three
     alternative `{ language, score }` candidates in descending score order for the source-language
     correction dropdown. Use CLD2 in the provider; check page `htmlLang` first in the consumer,
     then use provider detection on a bounded sample (the epic specifies 1,000–4,096 characters).
     Short text may be low confidence. Consumers detect once per page/document and pass the chosen
     `from` on every batch; source correction updates `from` for subsequent batches. `from` remains
     optional for simple board consumers, in which case the provider detects each batch. `to` is
     required. Items retain caller-supplied unique
     keys and are returned in a keyed result array; a failed item does not fail successful siblings.
     The `html` format translates fragment text while preserving inline markup; `text` is plain text.
   - One channel carries exactly one translate request. Its `id` correlates progress and terminal
     messages; `{ type: "cancel" }` on that channel, or closing it, cancels that request only.
     `scope` is not part of the provider protocol: the renderer client groups channels by its own
     page/document scope and cancels each channel in that group. Detect and describe each answer
     once and close. Download reports progress and one terminal result or error. A download can be
     cancelled with `{ type: "cancel" }` on its channel or by closing it. Providers must release
     request work on cancellation/close and check their caller approval policy for each download
     independently, so a consumer cannot fill disk unless the provider policy allows it.
   - Providers process `visible` work before `near`, then `background`, preserving FIFO order within
     a priority; only queued work may be reordered. Browser callers send attribute values as `text`
     items through the same keyed batch operation and use `html` for element fragments, so no
     separate attribute request shape is needed.
   - Define stable error codes at minimum: `not-ready`, `unsupported-language-pair`,
     `unsupported-format`, `too-large`, `engine-failed`, `download-failed`, `cancelled`; item
     errors carry a code and message. Reserve `connection-refused` for the platform close reason.
   - Set hard limits of **32 items** and **64,000 Unicode code points across all item text in one
     translate message**, with each message still below the platform's 1 MiB serialized-message
     limit. Reject a whole over-limit batch with `too-large`; do not silently truncate. Bound detect
     samples to 4,096 characters. The provider splits accepted batches internally into engine calls
     of at most 8 items and 8,192 code units each (BT-069); consumers do not need to split around
     these engine limits. Document provider backpressure, ordering, and unknown-field/type forward
     compatibility. The platform limits service channels to 16 per consumer board ID/page;
     board consumers should cap in-flight translate channels at 4, queue the remainder client-side
     by priority, and retain at least one channel slot for describe/detect/download control work.
   - Provider declarations use `serviceInterfaces: [{ id: "text.translate", version: 1, title: ... }]`
     and `permissions.service: true`; consumer declarations use `uses: [{ id: "text.translate",
     version: 1 }]`. Consumers need no provider permissions. State that an existing compatible
     platform service provider is trusted/permission-gated by Persephone, and must check its own
     approval policy before `describe`, `detect`, `translate` or `download`.
     Document the host caller as `{ id: "persephone", name: "Persephone" }`, with
     `info.interface = { id: "text.translate", version: 1 }`; a provider may allow or refuse that
     caller under its normal approval policy.
   - Cover both Persephone host use and board consumers. Include consumer examples for discovery,
     description, explicit consent followed by download, detection, keyed text/HTML translation,
     per-item failures, progress and cancel. Clarify that US-1735 selects text/plain or Markdown
     items and US-1736 sends page HTML fragments; neither consumer sends DOM or document contents
     except the requested item strings.

2. [x] **Register the platform interface** in
   [`src/shared/board-manifest-utils.ts`](../../../src/shared/board-manifest-utils.ts).

   Before:

   ```ts
   export const PLATFORM_SERVICE_INTERFACE_IDS = new Set(["agent.session", "speech.transcribe"]);
   ```

   After: include `"text.translate"`, preserving existing IDs and validation behavior. The actual
   source currently validates reserved IDs through this set; no separate service registry exists.

3. [x] **Generalize host service channel policy** in
   [`src/main/module-service-supervisor.ts`](../../../src/main/module-service-supervisor.ts),
   method `connectHostServiceChannel`. Replace the hard-coded interface/open-type pair with a
   module-level allowlist table keyed by interface ID and version. Add `interfaceId: string` to the
   host request selector at each typed IPC layer (below); the current host-only request omits it,
   which is why main can only infer the interface by hard-coding speech. Each allowlist entry declares allowed open
   types and its host board-id prefix; include `speech.transcribe@1` with `describe`/`transcribe`
   and the existing `voice-typing:` prefix, and `text.translate@1` with `describe`/`detect`/
   `translate`/`download` and a dedicated `text-translation:` prefix. Validate the selector and
   open type against the table before the existing trust/start/recheck flow, then use the table's
   interface id in declaration checks and channel metadata. Keep the caller identity, trust checks,
   service permission checks, channel caps, and speech board id exactly as today.

   Before:

   ```ts
   const interfaceId = "speech.transcribe";
   // IPC selector: { provider, version, openMessage }
   // accepts describe/transcribe only
   const boardId = `voice-typing:${windowId}`;
   ```

   After: resolve `{ interfaceId, version, openTypes, boardIdPrefix }` using the explicit
   `interfaceId` in the selector, validate `openMessage.type`, and build
   `${boardIdPrefix}${windowId}`. Unknown interfaces, versions, and open types remain
   `invalid-argument`; provider/trust errors retain their current codes.

   Update the host request type in [`src/ipc/api-types.ts`](../../../src/ipc/api-types.ts), its
   validation/forwarding in [`src/ipc/main/board-handlers.ts`](../../../src/ipc/main/board-handlers.ts),
   and the renderer wrapper in [`src/ipc/renderer/api.ts`](../../../src/ipc/renderer/api.ts) from
   `{ provider, version, openMessage }` to
   `{ interfaceId, provider, version, openMessage }`. Update speech host callers in
   `src/renderer/ui/speech/SpeechTranscriptionProvider.ts`,
   `src/renderer/ui/voice-typing/VoiceTypingController.ts`, and
   `src/renderer/ui/transcript/TranscriptController.ts` to pass `interfaceId: "speech.transcribe"`;
   this preserves their behavior while making interface selection explicit. Translation callers
   pass `interfaceId: "text.translate"`.

4. [x] **Add a renderer translation client** next to the speech provider at
   [`src/renderer/ui/translation/TextTranslationProvider.ts`](../../../src/renderer/ui/translation/TextTranslationProvider.ts).
   It must expose provider discovery (`text.translate`, v1 only), `describe`, `detect`, batch
   `translate`, explicit-consent `download` with progress callbacks, cancellation on the operation's
   own channel, consumer-scope cancellation (cancel each grouped channel), and disposal. It must
   receive ports only for the `text-translation:` host prefix, correlate channel IDs before handlers can miss
   messages, apply open/describe timeouts, observe channel close, respect `writable`/`whenWritable()`,
   and close pending ports on disposal. Enforce at most **4 concurrent translate channels per
   window**, queue additional batches client-side by `visible`/`near`/`background` priority, and
   never occupy more than 15 of the 16 channels under that host board ID so at least one slot stays
   available for `describe`, `detect`, or `download`. Cancel and free a channel slot when a request
   finishes, is cancelled, or its page/document scope is closed.
   Add [`src/renderer/ui/translation/TranslationServiceChannel.ts`](../../../src/renderer/ui/translation/TranslationServiceChannel.ts)
   as a translation channel adapter that preserves the service-channel ack, backpressure, 1 MiB
   check, close, and cleanup semantics. Keep speech behavior intact. Keep the client API suitable
   for both upcoming consumers: `US-1735` and US-1736 detect once and pass `from` on every batch;
   browser translation needs HTML items and priority. Consumer scope is local to this client and
   groups its per-request channels for cancellation.

5. [x] **Register the guide and update board-authoring references:**

   - Add `text-translate-guide`, URI `persephone://guides/text-translate`, file
     `guides/agents/text-translate.md` and a normative-contract description to
     [`src/main/mcp/manifest.ts`](../../../src/main/mcp/manifest.ts), following the speech resource.
   - Add a row for `text.translate` to [`assets/guides/agents/index.md`](../../../assets/guides/agents/index.md),
     following its speech service row and linking to the local guide, `guides.agents` key, and
     resource URI.
   - Update the reserved platform-ID lists and service-guide references in
     [`assets/guides/agents/boards.md`](../../../assets/guides/agents/boards.md),
     [`assets/guides/boards.md`](../../../assets/guides/boards.md), and
     [`assets/board-template/CLAUDE.md`](../../../assets/board-template/CLAUDE.md). Keep their
     bridge minimum-version guidance as-is because this adds no board bridge API.

   Before:

   ```ts
   { name: "speech-transcribe-guide", uri: "persephone://guides/speech-transcribe", ... }
   ```

   After: retain that resource and add a sibling `text-translate-guide` resource with the matching
   file and URI. No user-facing guide root index change is required: this is an agent contract guide,
   like `speech-transcribe.md`.

6. [x] **Do not change the board bridge version.** Keep
   [`src/shared/board-bridge-version.ts`](../../../src/shared/board-bridge-version.ts) at `1.44.0`:
   this task adds a reserved interface and internal renderer host consumer, not a new method or wire
   shape to the board-facing `persephone` shim API. If implementation discovers a necessary
   board-facing API shape change, record it and bump `BOARD_BRIDGE_VERSION` in that implementation
   change; do not preemptively version an unchanged API.

7. [x] Update this checklist as implementation proceeds. No tests were added as part of this task.

## Concerns

- `description.pairs` advertises directed models while requests may pivot through English. The
  guide must clearly distinguish direct pair availability from supported end-to-end route so
  consumers do not assume every requested pair has one direct model.
- Fixed limits (32 items/64,000 code points) fit page-priority batches and keep well under the
  board-channel 1 MiB message cap for ordinary strings; implementations must still account for
  JSON/HTML markup and structured-clone serialization size. The provider's 8-item/8,192-code-unit
  engine-call limit is internal and the protocol remains unchanged.
- The progress message's `done/total` counts completed input items, while download progress is byte
  based and pair-specific. Keep these fields distinct so browser scroll priority and per-page UI
  can aggregate progress reliably.
- The platform's 16-channel ceiling is per consumer board ID/page. Keep the host client's four
  translate-channel cap, priority queue and reserved control slot, and document the same per-page
  ceiling for board consumers.
- `voice-typing:` is also a legacy routing label for Transcript, not solely the shortcut feature.
  Preserve its exact generated value and all three consumers' filters when making the host allowlist.

## Acceptance Criteria

- [x] `assets/guides/agents/text-translate.md` normatively defines declarations, all message shapes,
      model consent/download progress, approval policy, errors, cancellation, limits, lifecycle and
      examples for both host and board consumers.
- [x] Contract supports editor text/Markdown batches and browser HTML fragment batches, detection,
      priority, per-item results, one-request-per-channel cancellation, consumer-owned scope
      grouping/cancellation, and source overrides. Detection returns top-three alternatives and
      consumers pass the selected `from` on every page/document batch.
- [x] `text.translate` is accepted as a reserved platform interface, guide resource, and guide-index
      entry.
- [x] Host channel policy accepts only the allowlisted interface/open-type pairs; speech still has
      the exact `voice-typing:` board ID behavior and transcript/voice clients continue to receive
      their channels.
- [x] Renderer client discovers providers and implements describe, detect, keyed translate,
      explicit model download with per-leg progress and cancellation, at most four concurrent
      translate channels per window, priority queuing, one reserved control slot, backpressure,
      channel close and disposal.
- [x] The typed internal host IPC request includes an explicit interface ID; ports-aware preload
      event signatures remain unchanged, and `BOARD_BRIDGE_VERSION` stays unchanged because no
      board-facing API addition is required.
- [x] Implementation followed user review of this task document; no tests are
      added in this task.

## Files Changed Summary

| File | Change |
|---|---|
| `assets/guides/agents/text-translate.md` | Add the normative `text.translate@1` contract. |
| `src/shared/board-manifest-utils.ts` | Reserve `text.translate` as a platform service ID. |
| `src/main/module-service-supervisor.ts` | Use an interface/open-type allowlist for host channels while retaining speech routing. |
| `src/ipc/api-types.ts` | Add interface ID to the typed host-channel request. |
| `src/ipc/main/board-handlers.ts` | Validate and forward the explicit host interface ID. |
| `src/ipc/renderer/api.ts` | Type the renderer host-channel wrapper with interface ID. |
| `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` | Pass the explicit speech interface ID for describe. |
| `src/renderer/ui/voice-typing/VoiceTypingController.ts` | Pass the explicit speech interface ID for transcription. |
| `src/renderer/ui/transcript/TranscriptController.ts` | Pass the explicit speech interface ID for transcription. |
| `src/renderer/ui/translation/TextTranslationProvider.ts` | Add the renderer client for discovery, metadata, detection, translation, download progress and cancellation. |
| `src/renderer/ui/translation/TranslationServiceChannel.ts` | Add a channel adapter preserving service-channel ack, backpressure, message-size, close and cleanup behavior. |
| `src/main/mcp/manifest.ts` | Register the contract resource. |
| `assets/guides/agents/index.md` | Link the contract from the agent guide index. |
| `assets/guides/agents/boards.md` | Add `text.translate` to the reserved-ID list and link its contract. |
| `assets/guides/boards.md` | Add `text.translate` to the reserved-ID list and link its contract. |
| `assets/board-template/CLAUDE.md` | Keep the board authoring template's reserved-ID list current. |
| `doc/active-work.md` | Link US-1734 to this task document under EPIC-135. |
| `doc/epics/EPIC-135.md` | Link US-1734 to this task document in Linked Tasks. |

### Files and Surfaces Verified; No Change Planned

| File | Reason |
|---|---|
| `src/preload.ts` | `onPort` already surfaces transferred service `MessagePort`s. |
| `src/renderer/types/window.d.ts` | Its `onPort` signature is interface-agnostic and does not need a new endpoint. |
| `src/shared/board-bridge-version.ts` | No board-facing method or shape changes; retain `1.44.0`. |

The speech renderer files in the changed-files table gain the explicit
`interfaceId: "speech.transcribe"` request field; their speech-only discovery, `voice-typing:`
filters, and transcription behavior remain unchanged. The IPC files gain the selector field while
the existing ports-aware event and preload delivery stay unchanged.
