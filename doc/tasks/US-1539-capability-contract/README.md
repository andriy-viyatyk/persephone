# US-1539: Capability contract single-sourced — error codes, intent envelope, outcome shape

Epic: [EPIC-115](../../epics/EPIC-115.md), Phase 2 (contracts)

## Goal

Define capability error codes, the capability intent envelope, and the handler outcome once in `src/ipc/capability-bus-channels.ts`, then carry them through renderer and board boundaries without semantic copies. Keep handler values opaque; communicate page discard as a separate bridge field. Preserve script projection behavior and the documented board result envelope while fixing its lossy cases. Leave request lifecycle ownership to US-1540.

## Background

### Current-source verification (after 693f3358)

The EPIC-115 evidence is historical and several references are stale after US-1534. Current `src/renderer/api/board-capability-transport.ts` now opens pages through `pagesModel.lifecycle.openBoardHandlerPage(root, title, intent)` and uses `openingPages` to serialize cold opens by normalized board root. It imports `IBoardIntent` from `src/renderer/api/types/io.link-data.d.ts`; this story should consume a shared `IntentEnvelope` there, but leave the open/intent lifecycle and `openingPages` behavior to US-1540. `src/renderer/api/boards.ts:282` still exposes the deprecated inline intent shape at `openBoard`; its API deprecation/removal remains a US-1540 decision, not a lifecycle refactor in this story.

The duplicated contracts are still present in current code:

- `src/ipc/capability-bus-channels.ts` has the `CapabilityErrorCode` union, but no runtime `CAPABILITY_ERROR_CODES` or shared `isCapabilityErrorCode` guard; `src/renderer/api/capability-bus.ts`, `src/renderer/api/board-capability-transport.ts`, `src/renderer/editors/board/BoardWebview.ts`, and `src/board-shim.ts` each retain runtime code lists/checks. `src/ipc/board-bridge-channels.ts` repeats the union in `BoardCapabilityIntentResultMsg.error.code`; `BoardCapabilityListResultMsg` and `BoardCapabilityInvokeResultMsg` still use `{ code: string; message: string }`.
- The current transport class is `BoardCapabilityTransportError`, separately from `CapabilityError` in `capability-bus.ts`; the transport normalizer duplicates all ten known codes. `BoardWebview.ts` also constructs this transport error for frame reply failures and host-to-board invoke failures.
- Intent shape is still declared as `IBoardIntent` in `src/renderer/api/types/io.link-data.d.ts`, inline in `BoardPortInitMsg.intent` and `BoardCapabilityIntentRequestMsg` (`src/ipc/board-bridge-channels.ts`), as `BoardIntentInit` in `src/board-shim.ts`, inline in deprecated `boards.openBoard` (`src/renderer/api/boards.ts`), and as part of `PersephoneIntentRequest` in `src/renderer/editors/board/board-api.d.ts`. `IntentRequest` in `capability-bus-channels.ts` also repeats the four fields plus lifecycle metadata and should extend `IntentEnvelope`. The shared channel is already imported by renderer and shim type paths and has no runtime imports today.
- The current outcome is not a single typed value. Transport adds `{ pageId, result }` except for its special `conversion-failed` check; `capabilities.ts` calls `unwrapBoardCapabilityResult()` and flattens `pageId` into the public script result; `BoardWebview.resolveCapabilityInvoke()` calls that public API and tries to split the flattened result back into a top-level `{pageId, result}` reply; the shim re-nests that as `{pageId, result}` or `{result}`. The board projection is lossy: `unwrapBoardCapabilityResult()` drops primitive/array results when a page id exists, overwrites a handler-owned `pageId`, and `BoardWebview` omits `result` when the handler returned `{}`. Today the conversion-failure special case discards the newly opened page, returns the raw `{ status, message }` to the script through `unwrapBoardCapabilityResult()`, and reaches the board no-page branch as `{ result: { status, message } }`. The new explicit discard option preserves those visible values without inspecting handler data. Fix the other board-handler loss cases by sending the raw `CapabilityOutcome` through directly; retain the documented envelope.
- The generic transport still contains Excalidraw-specific title fallback (`untitled.excalidraw`), `isPageProducingEditCapability()`'s `image.edit` / `diagram.edit` list, detection of `status: "conversion-failed"`, and the created-page close on that status. Excalidraw's live handler in `assets/boards/excalidraw/index.html` resolves diagram failure with `{ status: "conversion-failed", message }` and success with `{ status: "opened", imageOnly }`.
- The dead leftovers called out in EPIC-115 were checked against current references: image/diagram arms on `EditorCapabilityDeclaration` have no registrations; the transport's headless branch is unreachable because `Capabilities.invoke()` rejects a headless winner before dispatch; `CapabilityRegistrationResult.owner` is threaded into Board Info diagnostics but is never populated by capability registration; and `_activeBoardRoots` is passed to `unregisterBoardCapabilities()` but ignored. Remove those dead paths after checking their callers during implementation. `DiagramEditResult` itself is not dead: `MermaidEditor.ts` branches on it and the public scripting declarations expose it. Remove only its internal membership in built-in `CapabilityResult` if the new outcome typing makes that union unnecessary; retain the public result type/shape.

### Current source locations checked

These locations were re-read in the current checkout; the EPIC-115 line numbers at `693f3358` are not relied on:

- `src/ipc/capability-bus-channels.ts:6-17,20-30,38-58` — current error-code union, declaration, request, settlement, and transport contracts.
- `src/ipc/board-bridge-channels.ts:256-266,576-642` — current init intent and capability request/result reply contracts.
- `src/renderer/api/capability-bus.ts:19-30,33-45,177-198` — repeated code list, `CapabilityError`, code guard, and transport converter.
- `src/renderer/api/board-capability-transport.ts:15-22,90-124,134-138,195,249-252,328-345` — transport error, Excalidraw-specific helpers, `openingPages`, generic page open, result wrapper, and discard condition.
- `src/renderer/api/capabilities.ts:22-23,30-34,236-246,249-265,307-339` — internal result union, unused owner field, flattening/special status branch, headless registration handling, and `invoke()` public boundary.
- `src/renderer/api/types/io.link-data.d.ts:20-25`, `src/renderer/api/boards.ts:282`, and `src/ipc/board-bridge-channels.ts:261-266,576-584` — four current `IntentEnvelope`-shaped declarations. `src/board-shim.ts:643-648` and `src/renderer/editors/board/board-api.d.ts:375-381` are two more.
- `src/renderer/editors/board/board-api.d.ts:363-366,367-375,398-412` — extra copies of the capability code union, request shape, and board-side invoke result projection in the legacy `persephone.*` declaration snapshot.
- `src/renderer/editors/image/ImageEditor.ts:315`, `src/renderer/editors/svg/SvgEditor.ts:70-77`, `src/renderer/editors/mermaid/MermaidEditor.ts:206-212,227`, and `src/renderer/api/pages/PagesLifecycleModel.ts:519-525` — current built-in image/diagram edit callers supply a `title` payload (the lifecycle helper's existing fallback is itself sent as payload title).
- `src/renderer/editors/board/BoardWebview.ts:862-900,928-997,1292-1302` — handler replies, board-side invoke result projection, duplicated code guard and string-coded error converter.
- `src/board-shim.ts:30,67,643-663,741-756,1201-1215` — existing runtime version import, shared error-code type import, shim-local init/error declarations, duplicate guard, and nested board result projection.
- `scripts/build-prod.mjs:119-138` and `src/main/board-protocol-service.ts:129-145` — standalone IIFE build and served-board script inlining.
- `src/renderer/editors/base/editorRegistry.ts:8-13`, `src/renderer/editors/board/board-manifest.ts:62-70,440-470`, and `assets/boards/excalidraw/board-manifest.json:11-15` — current editor/board declaration sites and bundled declarations.
- `assets/boards/excalidraw/index.html:777-824` — current Excalidraw handler result values.
- `src/shared/board-bridge-version.ts:2` — current `BOARD_BRIDGE_VERSION` is `1.18.0`.
- Board invoke consumers: `assets/demo-board/app.js:104-108`, `assets/boards/excalidraw/index.html:654-661`; documented consumer examples at `assets/board-template/CLAUDE.md:234-256`, `assets/guides/boards.md:359-379`, and `assets/guides/agents/boards.md:521-537`.

### Bundling and consumer inventory

`src/board-shim.ts` is compiled into a standalone IIFE by `scripts/build-prod.mjs` (and the corresponding dev build) and its generated JavaScript is inlined into each served board HTML document by `src/main/board-protocol-service.ts`. The shim already has a runtime import of `BOARD_BRIDGE_VERSION` from `src/shared/board-bridge-version.ts`; a runtime import of `CAPABILITY_ERROR_CODES` from the import-free capability channel can therefore be bundled into the IIFE. There is no need for a hand-maintained shim exception or a generated literal.

Verified board-result consumers:

- Bundled Excalidraw calls `persephone.capabilities.invoke("content.view", ...)` in `assets/boards/excalidraw/index.html`; it awaits the result but does not inspect its result envelope. Its capability-handler return path is the `intent.resolve(...)` code described above.
- `assets/demo-board/app.js` calls `P.capabilities.invoke("demo.greet", ...)`, prints the full reply, and describes its `pageId` and `result`; `assets/board-template/CLAUDE.md` reads `reply.result`; `assets/guides/agents/boards.md` and `assets/guides/boards.md` document the nested reply shape. Their result access matches the current board contract.
- The complete bundled/published-board search covered `boards-assets/`, `assets/board-template`, `assets/demo-board`, `assets/boards/excalidraw`, `assets/guides/`, `assets/guides/agents/`, and sibling repo `C:/projects/persephone-boards/boards/`, excluding vendored/minified libraries. No direct `persephone.capabilities.invoke()` consumer was found in the sibling boards. The torrent viewer and `_test/range-provider-test` are service-protocol consumers for US-1543, not capability-result consumers. `boards-assets/` contains reusable assets and no capability caller. `assets/agent/` does not exist; agent board docs are under `assets/guides/agents/`.
- `src/renderer/editors/board/board-api.d.ts` declares the `persephone.*` capability error code union and `PersephoneCapabilityResult` separately from `src/ipc/capability-bus-channels.ts`; it is a self-contained legacy IntelliSense snapshot rather than an extra-lib loaded by the current scaffold. Derive its aliases with type-only import queries instead of another union/interface copy. `src/renderer/api/types/capabilities.d.ts` and its generated copy `assets/editor-types/capabilities.d.ts` describe script results; the latter is loaded for script IntelliSense and must stay in sync if public result typings change.

### Result contract snapshot (before)

```ts
// Current logical shapes, simplified from the implementations:
// script caller: object result + pageId => { ...result, pageId }
//                primitive/array result + pageId => { pageId }
//                no pageId => raw result
// board caller:  documented { pageId, result } or { result }, but some values are lost
// handler wire reply: { requestId, result: handlerValue }
```

The handler value stays opaque. The shim adds an optional second resolve argument and sends `discardPage` as a separate field beside `result`. The transport builds `CapabilityOutcome` from those wire fields, never by inspecting result properties. Only `discardPage: true` on a page created for this request triggers discard; the delivered outcome then has no `pageId`. A reused page ignores the flag. The board handler result envelope remains `{ pageId, result }` / `{ result }`, with lossy cases fixed; script flattening stays as described above. Since the new resolve option and wire field are board-visible, the epic standing rule requires a `BOARD_BRIDGE_VERSION` bump and updating bundled Excalidraw in the same release.

## Implementation Plan

- [x] `src/ipc/capability-bus-channels.ts` — export runtime `CAPABILITY_ERROR_CODES` (the existing ten codes), derive `CapabilityErrorCode` from that tuple, export `isCapabilityErrorCode(value: unknown)`, `IntentEnvelope { id; version?; requestId; payload }`, and `CapabilityOutcome { pageId?; result?; discardPage? }`. Keep imports type-only or absent so this stays safe across main, renderer, and shim bundles.
- [x] `src/ipc/board-bridge-channels.ts` — use `IntentEnvelope` for `BoardPortInitMsg.intent` and `BoardCapabilityIntentRequestMsg`; use `CapabilityErrorCode` in intent/list/invoke error replies; add `discardPage?: boolean` beside the opaque `result?: unknown` on `BoardCapabilityIntentResultMsg`. Do not type or inspect the handler's result value as an outcome.
- [x] `src/renderer/api/types/io.link-data.d.ts`, `src/renderer/api/types/boards.d.ts`, `src/renderer/api/boards.ts`, `src/renderer/api/pages/PagesModel.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/api/pages/PageNavigator.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, and `src/renderer/editors/board/board-api.d.ts` — replace `IBoardIntent` / board intent shape copies with the shared envelope type (use type-only import queries in the self-contained board API declaration). Derive the board error-code and result aliases from shared types too. Preserve lifecycle storage, casts, page-open serialization, and deprecated `boards.openBoard({ intent })` route for US-1540; only remove shape duplication here.
- [x] `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`, `src/renderer/editors/board/board-api.d.ts`, `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and `assets/boards/excalidraw/index.html` — type `intent.resolve(value, options?: { discardPage?: boolean })`; post the opaque `value` as `result` and `discardPage` as a separate optional wire field. Update board guides/template to document that option and update the bundled Excalidraw handler to call `intent.resolve({ status: "conversion-failed", message }, { discardPage: true })`.
- [x] `src/renderer/api/capability-bus.ts`, `src/renderer/api/board-capability-transport.ts`, `src/renderer/editors/board/BoardWebview.ts` — keep the single renderer-side `CapabilityError` class in `capability-bus.ts`; import it into transport/BoardWebview and remove `BoardCapabilityTransportError`. The reviewed graph adds no reverse import from `capability-bus.ts` to transport or BoardWebview, so a new shared error module is not needed. The shim retains its realm-local `BoardCapabilityError`. Remove code-list copies and normalize only unrecognized failures at boundaries. Leave pending maps, deadlines, trust subscription, and lifecycle behavior to US-1540.
- [x] `src/renderer/api/capabilities.ts`, `src/renderer/api/board-capability-transport.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/board-shim.ts` — construct the internal `CapabilityOutcome` from the separate bridge `result` and `discardPage` fields plus transport-owned `pageId`; never inspect handler `result` contents for outcome metadata. For a board-origin handler, `BoardWebview` must use the raw outcome path and send `{ pageId?, result? }` to the shim without routing through script flattening. Preserve the exact handler value in `result`, including primitives, arrays, `{}`, and an object-owned `pageId`. Flatten only in `capabilities.invoke()` for the script API: with a page id and a non-array object result return `{ ...result, pageId }` (transport page id overwrites an object-owned `pageId`); with a page id and a primitive, array, or absent result return `{ pageId }`; without a page id return raw `result`. For a board invoking a platform/built-in handler, retain the existing `BoardWebview` projection that splits a string `pageId` from its script-shaped result. That is the one remaining projection because built-ins return script-shaped values; US-1541 owns built-in resolution.
- [x] `src/renderer/editors/board/board-manifest.ts`, `src/renderer/api/capabilities.ts`, `src/ipc/capability-bus-channels.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/board-capability-transport.ts`, `assets/boards/excalidraw/board-manifest.json`, `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md` — add optional boolean `alwaysOpensNewPage` to the exact board registration path: `BoardCapabilityDeclaration` in `board-manifest.ts`, shared `CapabilityDeclaration` (inherited by `CapabilityRegistration`) in `capability-bus-channels.ts`, then the board `CapabilityRegistration` constructed by `registrationFromDeclaration()` / copied by `copyInfo()` in `capabilities.ts`. `normalizeCapabilities()` currently silently drops non-boolean optional fields, so extend its validation/reporting path to preserve a readable rejection for this field and feed that reason through `custom-editor-registry.ts`'s existing `registrationIssues` / Board Info flow. Reject a present non-boolean (for example, `Capability "<id>" alwaysOpensNewPage must be a boolean.`); do not silently coerce or drop it. Do not add this field to `EditorCapabilityDeclaration`; remove its dead `image.edit` / `diagram.edit` arms. `resolveHandler()` reads `registration.alwaysOpensNewPage` instead of `isPageProducingEditCapability()`. Mark both Excalidraw declarations and document the field in the board manifest guide and template.
- [x] `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/capabilities.ts`, `src/ipc/capability-bus-channels.ts`, `src/renderer/api/board-capability-transport.ts` — add optional `boardName` to `CapabilityRegistrationOptions` in `capabilities.ts` and to shared `CapabilityRegistration` in `capability-bus-channels.ts`, then populate it for board registrations from the existing `boardName = (manifest?.name && manifest.name.trim()) || fpBasename(root)` calculation in `custom-editor-registry.ts`. `capabilityTitle()` uses a non-empty `payload.title`, otherwise this handler board display name; do not use `CapabilityRegistration.title` (the declaration's descriptive handler title) as a page title. Current caller verification: ImageEditor, SvgEditor, MermaidEditor, and PagesLifecycleModel already supply a title payload for image/diagram edits; fallback is exercised by title-less capabilities such as `demo.greet`.
- [x] `assets/boards/excalidraw/index.html`, `src/renderer/editors/board/board-api.d.ts`, and `src/shared/board-bridge-version.ts` — use the separate `discardPage` resolve option and bump the bridge version to `1.19.0`. Keep the documented result envelope; fix only the board projection loss and preserve script projection behavior.
- [x] `src/renderer/editors/base/editorRegistry.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/api/board-capability-transport.ts`, `src/renderer/api/boards.ts` — remove only verified-dead declaration/result/branch/field/parameter items from the epic list; check all references first, including test and generated typing consumers. The `image.edit` / `diagram.edit` declaration arms belong only to the dead `EditorCapabilityDeclaration` path; `alwaysOpensNewPage` belongs to board declarations routed through the transport.
- [x] `src/renderer/api/types/capabilities.d.ts`, `assets/editor-types/capabilities.d.ts`, `src/renderer/editors/board/board-api.d.ts`, `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md` — type/document the handler outcome and declaration flag while preserving published board invoke results and the documented ten error codes.

### Before → after contract sketch

```ts
// Before: copies in ipc/board-bridge-channels.ts, the shim, and boards.ts
{ id: string; version?: number; requestId: string; payload: unknown }
// After: each surface derives from IntentEnvelope in capability-bus-channels.ts
export interface IntentEnvelope { id: string; version?: number; requestId: string; payload: unknown }

// Before: error code union plus separate runtime arrays/guards in each consumer
type CapabilityErrorCode = "no-handler" | "untrusted" | /* eight more codes */ "rejected";
// After: one runtime source also defines the derived union and guard
export const CAPABILITY_ERROR_CODES = [
    "no-handler", "untrusted", "handler-closed", "crashed", "cancelled",
    "timeout", "cycle", "payload-too-large", "busy", "rejected",
] as const;
export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];
export function isCapabilityErrorCode(value: unknown): value is CapabilityErrorCode;

// Before: transport guesses conversion semantics from an opaque handler result.
intent.resolve({ status: "conversion-failed", message });
// After: handler value stays opaque; control metadata travels separately.
intent.resolve({ status: "conversion-failed", message }, { discardPage: true });
// Wire: { requestId, result: <opaque handler value>, discardPage: true }

// Transport outcome is constructed from the separate wire fields only.
export interface CapabilityOutcome { pageId?: string; result?: unknown; discardPage?: boolean }

// A created page discarded for this request has no pageId in the delivered outcome.
// Script: page + object => { ...result, pageId }; page + primitive/array => { pageId };
//         no page => raw result.
// Board handler: preserve { pageId?, result? } and the exact result value.
// Board platform handler: keep the current split of a script-shaped built-in result.

```

### Live verification plan

After implementation, invoke every message path twice as required by EPIC-115:

1. `image.edit` from the Image Viewer into Excalidraw twice; both calls resolve with the existing flat `{ pageId }` value (`image.edit`'s handler result is `{}`), and each request opens a new Excalidraw page.
2. `image.edit` from the SVG editor into Excalidraw twice; same `{ pageId }` result and fresh-page expectation.
3. `image.edit` from the Mermaid editor into Excalidraw twice; same `{ pageId }` result and fresh-page expectation.
4. Fail `diagram.edit` conversion twice; when the request created the Excalidraw page, discard it and deliver no `pageId`. The script result remains `{ status: "conversion-failed", message }`; a board caller receives `{ result: { status: "conversion-failed", message } }`. Verify a reused page ignores discard and retains its page id.
5. Board-to-board `demo.greet`: a trusted scratch board declares `demo.greet`, another board calls `persephone.capabilities.invoke` twice. Each result is `{ pageId, result }` and preserves the handler value (for the bundled demo handler, `{ greeting, requestId, received }`). Also use a scratch handler variant that returns a primitive string: the board caller receives the string under `result`, while the script caller gets `{ pageId }` under today's unchanged flattening. The scratch change is cheap and verifies the lossy case.
6. Invoke `demo.greet` without `payload.title`; the new page title must be the handler board display name (`manifest.name`, else folder name), not the capability declaration title.
7. Typed rejections from both a script caller (`app.capabilities.invoke`) and a board caller (`persephone.capabilities.invoke`): trigger `no-handler`, `timeout`, and `rejected` twice on each surface. Script promises reject with `CapabilityError` and the exact `code`/`message`; board promises reject with the shim's `BoardCapabilityError` and the same exact `code`/`message`. No recognized code is widened to a generic string or remapped accidentally.

## Concerns / Open Questions

- **Lifecycle boundary:** US-1540 owns pending-table/request lifecycle and initial-intent refactoring. This story may update shared type aliases in existing lifecycle files, but must not change their storage, ordering, serialization, timers, trust settlement, `openingPages`, or deprecated `boards.openBoard({ intent })` behavior.
- **Handler outcome compatibility:** handler results stay opaque. `discardPage` is a separate optional bridge field; only `discardPage: true` with `pending.createdPage` closes the created page. It is ignored for a reused page. A discarded page's delivered outcome has no `pageId`, preserving the current script failure value and board no-page envelope.
- **Contract module and shim:** `capability-bus-channels.ts` has no runtime imports; the shim build bundles runtime dependencies into an IIFE and already inlines a shared version constant. Keep the new runtime constant dependency-free and confirm the output remains self-contained.
- **Handler title fallback:** registrations carry `boardRoot` but not a manifest name override. Add `boardName`, populated from the existing `manifest.name.trim() || fpBasename(root)` calculation in `custom-editor-registry.ts`; fall back from payload title to this board name. A capability declaration title is descriptive handler metadata, not a page title.
- **Error-class location:** keep `CapabilityError` in `src/renderer/api/capability-bus.ts`. The reviewed import graph has no reverse dependency from that module to transport or BoardWebview, so moving the renderer-only class is not needed to avoid a cycle.

### Out of scope (US-1540)

- The three pending tables: `CapabilityBus.pending`, `BoardCapabilityTransport.pending`, and `BoardWebview.pendingCapability`.
- `openingPages` serialization and cold-open behavior.
- Initial-intent storage, delivery, and clearing/sweeping.
- The deprecated `boards.openBoard({ intent })` route and its removal/adapter decision.

## Decisions

- **Board-handler invocation result:** keep the documented `{ pageId, result }` / `{ result }` envelope, but pass the handler value untouched. This fixes board-visible lossy cases: primitives and arrays survive, a handler-owned `pageId` stays inside `result`, and an explicitly returned `{}` remains the `result` value.
- **Script invocation result:** preserve today's flattening exactly: with a page id and non-array object result, return `{ ...result, pageId }` (transport page id overwrites any handler `pageId`); with a page id and primitive/array/absent result, return `{ pageId }`; with no page id, return raw `result`.
- **Platform handler result:** for a board invoking a built-in/platform handler such as Excalidraw's `content.view`, retain today's BoardWebview projection that splits a string `pageId` out of the built-in's script-shaped result. This is the one remaining projection because built-ins return script-shaped values; US-1541 owns built-in resolution.
- **`discardPage`:** it is a separate optional bridge field. Honor only `discardPage: true` when `pending.createdPage` is true; close the created page and omit `pageId` from the outcome. Ignore it on a reused page and retain that page id.
- **`BOARD_BRIDGE_VERSION`:** bump from `1.18.0` to `1.19.0` in `src/shared/board-bridge-version.ts` for the new resolve option, separate result field, and `alwaysOpensNewPage` manifest field; update bundled Excalidraw in the same release.
- **Old Excalidraw return:** update bundled Excalidraw in the same release to `intent.resolve({ status: "conversion-failed", message }, { discardPage: true })`. Do not sniff status/result keys in generic transport. Because the bundled handler changes in this release, no legacy adapter for its old status-only return is needed; a handler value that still returns that status without the separate option remains an ordinary opaque result and does not request discard.
- **Page title:** choose non-empty `payload.title`, else the handler board display name from `manifest.name` or folder name. Do not use the capability declaration title as the page title.

## Acceptance Criteria

- [x] `src/ipc/capability-bus-channels.ts` is the single runtime and type source for the error code set, guard, intent envelope, and outcome shape; duplicate lists and shape declarations are removed or explicitly justified.
- [x] Board bridge error codes are typed as `CapabilityErrorCode`; all recognized errors preserve code and message through script and board paths.
- [x] One capability error class represents failures through the bus, transport, and bridge, with only necessary boundary normalization.
- [x] Handler values are never sniffed for outcome keys. `discardPage: true` is transmitted separately and honored only for `pending.createdPage`; discarded outcomes have no `pageId`, while reused-page requests ignore discard and keep the id.
- [x] Board-origin handler outcomes reach board callers as `{ pageId?, result? }` with the exact handler value retained, including primitives, arrays, `{}`, and a handler-owned `pageId`. The script API flattens once using the documented existing rules; board calls to platform handlers retain only the existing split of a built-in's script-shaped `pageId` result.
- [x] Generic transport contains no Excalidraw title, capability-id list, or conversion-status knowledge; page creation comes from board declaration `alwaysOpensNewPage`, and discard comes from the separate handler option.
- [x] A title-less board capability opens with the handler board's manifest display name or folder name, not the declaration title or a generic Excalidraw filename.
- [x] Dead epic leftovers are removed only after reference/reachability confirmation.
- [x] Live verification passes for image viewer, SVG, and Mermaid `image.edit` calls (twice each); conversion failure returns the exact status/message without `pageId` to scripts and as `{ result: { status, message } }` to boards when a newly created page is discarded; reused pages ignore discard (not verified live — see below).
- [x] Live verification confirms board-to-board `demo.greet` (twice), a no-title `demo.greet` page uses the handler board name, a primitive board-handler result stays under board `result` while its script result still flattens to `{ pageId }`, and typed `no-handler`, `timeout`, and `rejected` failures preserve code/message on both script and board surfaces.

## Live verification (2026-09-28)

Run against the dev build after a full app restart, over Persephone MCP `call`: scripts through
`script.execute`; board callers by running code in the repo's `.persephone/boards/Demo` board frame
(through `main.script.execute`, `webFrameMain.executeJavaScript`). That frame reported bridge version `1.19.0`.
The handler was the trusted scratch board `US1534Demo`, whose `demo.greet` handler was given test modes
(`reject`, `hang`, `primitive`).

- **Script `demo.greet`, twice (cold, then reuse):** both returned `{ greeting, requestId, received, pageId }` on the
  same page. The page opened with no payload title and was named `US1534Demo`, the board name.
- **Script, primitive handler result, twice:** `{ pageId }`. This is the unchanged script flattening.
- **Board `demo.greet`, twice:** `{ pageId, result: { greeting, requestId, received } }`.
- **Board, primitive handler result, twice:** `{ pageId, result: "plain-board friend" }`. The old path dropped this value.
- **Typed rejections, twice each on both surfaces:**
  - `rejected` gave "demo rejected";
  - `timeout` fired at about 700 ms with `deadlineMs: 700`;
  - `no-handler` gave `No capability handler matches "nope.nothing".`
  - Scripts got a `CapabilityError` and boards got a `BoardCapabilityError`, each with the exact code.
- **`image.edit` into Excalidraw, twice each:** triggered by clicking the toolbar buttons `image-open-draw` (Image Viewer),
  `svg-open-draw` (SVG preview) and `mermaid-open-draw` (Mermaid preview). Every click opened a new
  Excalidraw page titled from the payload (`pic.excalidraw`, `shape.excalidraw` and `flow.excalidraw`).
- **`mermaid-convert-excalidraw` (`diagram.edit`), twice:** each opened a new Excalidraw page.
- **`diagram.edit` with invalid Mermaid, twice from a script:** returned `{ status: "conversion-failed", message }`
  with no `pageId`, and no Excalidraw page was left open (the created page was discarded). The same call from a board, twice,
  returned `{ result: { status: "conversion-failed", message } }`. A valid source returned `{ status: "opened", imageOnly: false, pageId }`.
- **Board calling a built-in (`text.open`):** returned `{ pageId }`. This is the unchanged built-in projection.
- `npm run typecheck`, `npm run lint` and `node scripts/build-prod.mjs` pass.

Implementation note: `capabilities.invoke` and the board caller share one resolution path,
`invokeCapabilityOutcome` in `src/renderer/api/capabilities.ts`. `capabilities.invoke` is the only place that flattens.

### Not verified

- A handler that passes `discardPage` on a *reused* page (the option should be ignored there). No
  installed handler both reuses its page and requests discard. Excalidraw always opens a new page.
- Observed but pre-existing, and left for US-1540: when a board caller times out, the message is
  sometimes "Capability invocation deadline elapsed." and sometimes "The capability request deadline elapsed.".
  Which one appears depends on which of the duplicated pending tables fires first. The code is `timeout` either way.

### Files verified and not planned for change

- `C:/projects/persephone-boards/boards/**` — no capability-result consumer; the torrent viewer and `_test/range-provider-test` belong to US-1543.
- `boards-assets/**` — reusable asset catalog; no capability call or result consumer.
- `assets/demo-board/app.js` — already prints the full nested result and does not destructure it or require a new field.
- The `content.view` result in `assets/boards/excalidraw/index.html` — awaited but not inspected; only its handler failure return needs updating.
- `assets/guides/scripting/api/app.md` — documents the script result contract, which remains unchanged.
- `doc/active-work.md` — user explicitly owns dashboard edits for this task.

## Files Changed Summary

| File/path | Planned change |
|---|---|
| `src/ipc/capability-bus-channels.ts` | Shared runtime codes, guard, intent envelope, and outcome types |
| `src/ipc/board-bridge-channels.ts` | Shared intent and error types; opaque result plus separate discard field |
| `src/renderer/api/capability-bus.ts` | Consume shared guard/types and one error class |
| `src/renderer/api/board-capability-transport.ts` | Generic declaration/outcome routing; remove duplicate codes and Excalidraw-specific branches |
| `src/renderer/api/capabilities.ts` | Script-only flattening, board registration fields, and dead result cleanup |
| `src/renderer/editors/board/BoardWebview.ts` | Preserve raw board-handler outcome; retain platform-handler projection |
| `src/board-shim.ts` | Shared runtime error list and separate resolve option, bundled into standalone IIFE |
| `src/renderer/api/types/io.link-data.d.ts` | Shared intent envelope alias/re-export |
| `src/renderer/api/boards.ts`, `src/renderer/api/types/boards.d.ts`, page lifecycle files | Remove repeated intent shape while deferring lifecycle refactor to US-1540 |
| `src/renderer/editors/base/editorRegistry.ts`, `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/BoardEditorModel.ts` | Remove dead built-in declaration arms; parse, validate, and expose board-only `alwaysOpensNewPage` |
| `src/renderer/editors/board/board-api.d.ts`, `src/renderer/api/types/capabilities.d.ts`, `assets/editor-types/capabilities.d.ts` | Board/script contract typing updates |
| `assets/boards/excalidraw/index.html` | Handler-requested page discard outcome; migrate from legacy status-only failure |
| `src/shared/board-bridge-version.ts` | Bump from `1.18.0` to `1.19.0` for the resolve option, wire field, and manifest field |
| Board capability guides and `assets/board-template/CLAUDE.md` | Document stable caller result shapes and handler outcomes |
| `doc/epics/EPIC-115.md` | Link US-1539 to its task document |
| `doc/tasks/US-1539-capability-contract/README.md` | Investigation and implementation plan |
| `doc/active-work.md` | **No change** per user instruction for this task-document investigation |
