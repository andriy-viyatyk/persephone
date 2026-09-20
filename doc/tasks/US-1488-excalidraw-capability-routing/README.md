# US-1488 — Capability routing into the board, and the payload measurement

**Status:** Planned investigation follow-up  
**Epic:** [EPIC-109 — Excalidraw as the built-in drawing board](../../epics/EPIC-109.md)  
**Depends on:** [US-1487 — Excalidraw board](../US-1487-excalidraw-board/README.md), [EPIC-108 D7](../../epics/EPIC-108.md#L281-L318)

## Goal

Route the `image.edit` and `diagram.edit` capability contracts into the bundled Excalidraw board, restore the manifest declarations only in the same change as the board handler, preserve the built-in `draw-view` fallback when the board is disabled, and record a renderer-side measurement of the inline structured-clone path for realistic `image.edit` payloads.

The implementation must give callers the platform capability contracts already declared in [`capabilities.d.ts`](../../../src/renderer/api/types/capabilities.d.ts#L37-L95). In particular, an image handoff resolves a `CapabilityPageResult`, a successful diagram handoff resolves an `opened` `DiagramEditResult`, and a failed Mermaid conversion resolves a `conversion-failed` result without inventing a page.

## Background

### Scope boundary and the US-1487 regression

US-1487 shipped the Excalidraw board with `image.edit` and `diagram.edit` declarations at priority 60, but no board-side intent handler. Capability resolution therefore selected the board declaration ahead of the platform `draw-view` registration at priority 50; the image viewer’s Edit action opened a board page that ignored the request. The current manifest has the `capabilities` declaration block removed as a stopgap, while `permissions: ["capabilities"]` remains. The defect and the stopgap are documented in the final section of [US-1487](../US-1487-excalidraw-board/README.md#L540-L593).

The amended [US-1488 section of EPIC-109](../../epics/EPIC-109.md#L348-L360) makes the ordering explicit: restoring the manifest declarations belongs to this task and must happen in the same change as `persephone.intent.onRequest`.

### Epic decisions that constrain this task

- [D4](../../epics/EPIC-109.md#L95-L100) makes the Excalidraw board disable flag a registry/capability decision: when disabled, the board is not registered for these capabilities and the built-in handler remains available.
- [D7](../../epics/EPIC-109.md#L156-L162) gives the board editor priority 60 and the built-in `.excalidraw` editor priority 50. This is editor selection priority, distinct from capability priority.
- [D8](../../epics/EPIC-109.md#L164-L171) treats the manifest `permissions` field as disclosure rather than a security boundary. The bundled board does not need a trust prompt for this task.

The deferred data-handle store is explicitly outside this task. US-1488 measures the Phase D inline path; crossing the measured trigger becomes a separate follow-up task.

### Verified capability contracts and callers

The public declarations in [`src/renderer/api/types/capabilities.d.ts`](../../../src/renderer/api/types/capabilities.d.ts#L37-L95) are the source of truth for the board result shape:

| Capability | Payload verified in source | Public result |
| --- | --- | --- |
| `image.edit` | `dataUrl`, optional `mimeType`, optional `naturalWidth`/`naturalHeight`, and `title` | `{ pageId: string }` |
| `diagram.edit` | Mermaid `source` and `title` | `{ status: "opened", pageId, imageOnly }` or `{ status: "conversion-failed", message }` |

The platform handlers in [`capability-handlers.ts`](../../../src/renderer/editors/draw/capability-handlers.ts#L1-L43) measure missing image dimensions, build the same Excalidraw JSON used by `draw-view`, add a new drawing page, and return the contract above. Diagram conversion uses the Mermaid converter and returns a failure result rather than opening a page when conversion throws.

The verified callers are:

- [`ImageEditor.ts:315`](../../../src/renderer/editors/image/ImageEditor.ts#L315-L323), which supplies the data URL, MIME type, natural dimensions, and title.
- [`SvgEditor.ts:69`](../../../src/renderer/editors/svg/SvgEditor.ts#L69-L77), which supplies the SVG data URL and its dimensions.
- [`MermaidEditor.ts:205`](../../../src/renderer/editors/mermaid/MermaidEditor.ts#L205-L216), which uses `image.edit` for rendered SVG fallback, and [`MermaidEditor.ts:225`](../../../src/renderer/editors/mermaid/MermaidEditor.ts#L225-L240), which consumes `diagram.edit`’s `status` and `imageOnly` fields.
- [`PagesLifecycleModel.ts:415`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L415-L430), whose `addDrawPage()` invokes `image.edit` and then resolves the returned page.

The draw toolbar’s [`handleScreenSnip()`](../../../src/renderer/editors/draw/index.ts#L201-L231) is a separate, verified path: it currently adds the captured PNG directly to the already-mounted Excalidraw scene. It is not currently an `app.capabilities.invoke()` caller. The implementation must preserve that active-board insertion behavior unless the product decision explicitly changes it; the new-page screen-snip seam is `PagesLifecycleModel.addDrawPage()`, which already routes through `image.edit`.

### Intent delivery and the board result envelope

The board shim exposes [`persephone.intent.onRequest`](../../../src/board-shim.ts#L1222-L1241). A request is represented by an intent context containing `id`, `version`, `requestId`, and `payload`, plus `resolve()` and `reject()` functions ([`board-shim.ts`](../../../src/board-shim.ts#L455-L496)). During the initial `BoardPortInitMsg` handshake, the shim creates and delivers the initial intent before or while the board registers its handler ([`board-shim.ts`](../../../src/board-shim.ts#L803-L874)); the IPC type carries the initial intent in [`BoardPortInitMsg`](../../../src/ipc/board-bridge-channels.ts#L232-L242).

This matters because the current transport opens a capability request as a plain board page, not a content-host page. The board’s current bootstrap catches the `persephone.host.getContent()` rejection and records `hostAttached: false` ([`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html#L131-L141)). US-1488 changes the renderer opening path so this request uses the bundled content-host constructor; the board must not call host APIs until that `contentHost: true` handshake is in place.

There is also an existing renderer transport envelope that cannot be returned directly to platform callers. [`BoardCapabilityTransport`](../../../src/renderer/api/board-capability-transport.ts#L150-L210) currently settles a board dispatch as `{ pageId: frame.pageId, result }`, where `frame.pageId` is the transient board handler page. [`Capabilities.invoke()`](../../../src/renderer/api/capabilities.ts#L287-L346) returns that board result, while `MermaidEditor` expects the public `DiagramEditResult` directly. [`BoardWebview.resolveCapabilityInvoke()`](../../../src/renderer/editors/board/BoardWebview.ts#L760-L808) separately expects the board-facing `{ pageId, result? }` envelope. The implementation plan therefore includes an explicit split between the internal transport envelope and the public capability contract.

### Existing board insertion and conversion logic

The board already exposes `model.aiVision.addImage` in [`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html#L197-L252). It adds a PNG file, caps the longer image dimension at 1200 pixels, inserts at `(250, 120)`, and updates the scene. The renderer implementation follows the same geometry in [`drawExport.ts`](../../../src/renderer/editors/draw/drawExport.ts#L92-L155), while [`DrawEditorFacade.ts`](../../../src/renderer/scripting/api-wrapper/DrawEditorFacade.ts#L54-L70) is the mounted-editor API reference.

The board’s bundled dependency exports `convertToExcalidrawElements` and `MIME_TYPES` from [`assets/boards/excalidraw/lib/index.js`](../../../assets/boards/excalidraw/lib/index.js#L1). The handler should use that existing board-side dependency and the existing scene insertion path, not import renderer source into the bundled page.

### Saving semantics for an intent-opened page

The first implementation draft incorrectly treated the intent page as a transient assembly surface and handed its scene to `persephone.openContent({ editor: "draw-view", ... })`. That cannot be the design: `resolveBoardOpenContent()` deliberately rejects editor IDs beginning with `board-editor:` ([`board-open-content.ts:62-64`](../../../src/renderer/editors/board/board-open-content.ts#L54-L70)), and `draw-view` is the editor EPIC-110 removes. It would also make a user who chose the board land in the editor that the board is meant to replace.

Decision for this task: choose option (ii). The intent-opened board page itself becomes the result page by being created as a bundled content-host board page. The existing path is verified in [`PagesLifecycleModel.buildEditorById()`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L127-L195): after `resolveBoardEditorId()`, a `board-editor:<root>` whose registry entry has `editorKind: "content-host"` constructs `BoardContentEditorModel`, calls `initFromBoardRoot()`, and adopts `newTextFileModel(filePath)`. With no file path, that is a fresh unsaved `TextFileModel` host. [`addBundledBoardPage()`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L250-L276) already validates the bundled content-host registration, sets the host language/title, restores the editor, and adds the page.

For existing files, [`resolveEditorIdForFile()`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L114-L124) resolves the `.excalidraw` file association from the manifest’s `fileMasks` and editor priority. For an untitled capability result, the implementation will use the same `boardEditorId(boardRoot)` plus `addBundledBoardPage()` path rather than pretending an untitled page has a file to resolve. A page-producing edit capability must always create a new untitled content-host page; it must never reuse a user-open `.excalidraw` page or another capability result page. Other board capabilities may retain their existing content-host reuse semantics.

The implementation will extend the `addBundledBoardPage()` path to carry the initial `IBoardIntent` before restore/handshake. The board then receives `contentHost: true` in [`BoardPortInitMsg`](../../../src/renderer/editors/board/BoardWebview.ts#L303-L326), `persephone.host.getContent()` succeeds, and the existing `scheduleHostWrite()` path writes the serialized Excalidraw scene into the adopted host. Persephone therefore owns dirty state and save/save-as for the same board page that handled the capability; no second `draw-view` page or second editor implementation is involved.

This is a platform-side change within US-1488, but it does not relax `openContent()` and does not modify `board-open-content.ts`. It changes the task size and the Files Changed table: `PagesLifecycleModel.ts`, its `PagesModel.ts` forwarding method, and `board-capability-transport.ts` must coordinate content-host page creation and initial-intent delivery. The board page ID is both the handler frame ID and the public capability page ID. The transport still has two page-ID fields to normalize—outer envelope `pageId` and the nested public result’s `pageId`—but they must identify this same board-owned page, never a `draw-view` page or a fabricated second page.

### EPIC-108 D7 threshold and renderer-side measurement

The relevant decision is [EPIC-108 D7](../../epics/EPIC-108.md#L281-L318), not an assumed 8 MiB value. The decision states:

> “to be measured, not the 8 MB guess a first draft carried”

and:

> “If Phase F measures a single image.edit payload above the cap in ordinary use, or measures a clone cost above ~50 ms at the 95th percentile, the handle store becomes a task in that epic.”

D7 defines an inline structured-clone hard cap of `MAX_INTENT_PAYLOAD_BYTES` (8 MiB in the current decision), and notes that a board-to-board payload can incur one clone each way inside the renderer. This measurement records the outbound payload clone and the small result separately from that transport accounting.

The cap wording is also explicit: “`MAX_INTENT_PAYLOAD_BYTES` (8 MiB, matching the order of magnitude the provider path already uses for `MAX_BUFFERED_PIPE_BYTES`) with a `payload-too-large` rejection naming the limit.” D7 limits that cap to board-bound invocations; a platform handler remains an in-process call without this structured-clone boundary.

Restoring the board declarations changes the enforcement boundary for existing callers. Today, `Capabilities.invoke()` returns directly from the platform-handler branch before the capability bus ([`capabilities.ts:311-329`](../../../src/renderer/api/capabilities.ts#L311-L329)); after priority 60 selects the board, the request reaches `capabilityBus.invoke()`, where [`estimatePayloadSize()` is compared with `MAX_INTENT_PAYLOAD_BYTES`](../../../src/renderer/api/capability-bus.ts#L262-L272). `PagesLifecycleModel.addDrawPage()` and the image/snip flows that call it currently send full-size data URLs to the platform `draw-view` handler without this cap. The active-board toolbar snip that directly inserts into an already-mounted board remains outside this boundary; a new-page snip/edit path is not.

If a restored board-bound request exceeds the limit, the user-visible operation fails with the existing `payload-too-large` rejection naming `MAX_INTENT_PAYLOAD_BYTES` and its byte limit. The affected caller then shows its existing failure surface—for example, the HTML capture path reports “Failed to open image for editing”, and the data-image scheme reports “Failed to open image in Drawing editor”—rather than opening a partial drawing. US-1488 does **not** fall back automatically to the platform handler on this error: doing so would silently bypass the board’s winning capability and hide the exact D7 trigger. An above-cap ordinary-use payload is the trigger for the separate deferred handle-store task; transport fallback is not part of this task.

The measurement was run in the live renderer with `script.execute`, without a test harness or repository test. It duplicated the current `estimatePayloadSize()` traversal in [`capability-bus.ts`](../../../src/renderer/api/capability-bus.ts#L1-L85), generated deterministic high-entropy canvas images, built the exact `image.edit` payload shape, warmed up with 10 clones, then timed 100 `structuredClone(payload)` calls using `performance.now()`. The p95 is the nearest-rank value of the sorted 100 samples. PNG cases use lossless encoding; JPEG cases use quality 0.9. The measured browser was Chromium 150.0.7871.46 on Windows.

| Synthetic source | Encoding | Estimated inline bytes | p95 clone time | Observation |
| ---: | --- | ---: | ---: | --- |
| 512 × 512 | PNG | 839,714 | 0.6 ms | Below cap |
| 1024 × 768 | PNG | 2,358,278 | 1.7 ms | Below cap |
| 1920 × 1080 | JPEG 0.9 | 2,231,920 | 1.1 ms | Below cap |
| 2560 × 1440 | JPEG 0.9 | 4,035,640 | 2.2 ms | Below cap |
| 3840 × 2160 | JPEG 0.9 | 9,077,514 | 6.1 ms | Above 8 MiB cap |
| 1920 × 1080 | PNG | 7,801,462 | 5.5 ms | Below cap |

The largest measured p95 clone time is 6.1 ms, below D7’s approximately 50 ms trigger. No realistic screenshot/canvas input measured here crossed the cap: the 1920 × 1080 PNG remained at 7,801,462 bytes, and the JPEG cases stayed below it through 2560 × 1440. The 3840 × 2160 high-entropy JPEG row is a deliberately maximum-entropy synthetic worst case at 9,077,514 bytes, not ordinary-use evidence; together with the better-compressing PNG rows, it suggests the cap is sized about right rather than proving that the handle store should be built now. The ordinary-use classification remains open, and any decision to treat that synthetic/wider input class as ordinary belongs to the separate deferred handle-store task. No threshold crossing is acted on in US-1488.

## Implementation Plan

### 1. Restore declarations and handler atomically

Change [`assets/boards/excalidraw/board-manifest.json`](../../../assets/boards/excalidraw/board-manifest.json) only in the same implementation change that adds `persephone.intent.onRequest` handling. The current stopgap is:

```json
{
  "schemaVersion": 1,
  "name": "Excalidraw",
  "description": "The bundled Excalidraw editor.",
  "author": "Persephone",
  "permissions": ["capabilities"],
  "fileMasks": ["*.excalidraw"],
  "editorKind": "content-host",
  "editorPriority": 60,
  "standalone": true
}
```

The resulting declaration must retain the complete manifest metadata and restore the declarations US-1487 shipped, including `version: 1` and the diagnostic titles:

```json
{
  "schemaVersion": 1,
  "name": "Excalidraw",
  "description": "The bundled Excalidraw editor.",
  "author": "Persephone",
  "permissions": ["capabilities"],
  "capabilities": [
    { "id": "image.edit", "version": 1, "priority": 60, "title": "Edit image" },
    { "id": "diagram.edit", "version": 1, "priority": 60, "title": "Edit diagram" }
  ],
  "fileMasks": ["*.excalidraw"],
  "editorKind": "content-host",
  "editorPriority": 60,
  "standalone": true
}
```

`fileMasks` is load-bearing: it supplies the `.excalidraw` association used by `resolveEditorIdForFile()` and must not be dropped. Retaining the declaration `version` and `title` fields is intentional; the titles surface in Board Info diagnostics, while the version keeps the shipped capability contract explicit. These are complete-file examples, not excerpts.

The before/after pair is intentionally a plan, not an implementation in this investigation task. The acceptance check must open the image viewer’s Edit action only after the handler is present and confirm that no declaration-only interval can shadow `draw-view`.

### 2. Register and service the board intent

In [`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html), register `persephone.intent.onRequest` after the Excalidraw API and scene model are ready, and make registration safe when the initial request was delivered during bootstrap. The handler must:

1. Validate the intent ID and payload shape, and ignore or reject unsupported intent versions without mutating the scene.
2. For `image.edit`, use the supplied MIME type and dimensions when present; otherwise derive the MIME type from the data URL and measure dimensions as the platform handler does. Reuse the board’s existing `addImage` insertion geometry and file registration, but do not call its current PNG-only file-recording behavior unchanged for SVG or another supplied MIME type; factor or extend the insertion helper so the capability path preserves the payload MIME.
3. For `diagram.edit`, convert Mermaid source through the bundled converter, apply the same text font setup as [`buildExcalidrawJsonFromMermaid()`](../../../src/renderer/editors/draw/drawExport.ts#L178-L214), and preserve the `imageOnly` calculation. Conversion errors resolve the `conversion-failed` result and do not create a page.
4. Serialize the completed scene through the existing content-host write path. On the intent-opened content-host page, `hostAttached` is true, so `scheduleHostWrite()` writes the serialized scene to Persephone’s adopted `TextFileModel`; the handler must not call `persephone.openContent()` and must not use a second `draw-view` page.
5. Resolve with the exact public result shape or reject only for transport/validation failures. The successful `pageId` is the current content-host board page ID, which is also the handler frame ID.

Current board bootstrap has no request handler:

```js
const hostAttached = true;
// scene setup and Excalidraw render...
```

Planned shape, after the scene API is available:

```js
const unsubscribeIntent = persephone.intent.onRequest((intent) => {
    void handleCapabilityIntent(intent).catch((error) => intent.reject(error));
});
// dispose unsubscribeIntent with the board lifecycle
```

The exact function names may follow the board’s local style, but the lifecycle requirements above are fixed. The handler must also avoid double delivery if the shim has already delivered the initial `BoardPortInitMsg` intent before registration; the shim’s `deliveredIntentIds`/active-intent behavior is the existing delivery guard.

### 3. Create a content-host board result and preserve the public contracts

The renderer must change the existing board-capability opening path rather than the board-open-content refusal:

- [`PagesLifecycleModel.addBundledBoardPage()`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L250-L276) must accept the initial `IBoardIntent`, call the existing `setInitialBoardIntent()` before restore, and retain the current content-host construction through `buildEditorById()`.
- [`PagesModel.addBundledBoardPage()`](../../../src/renderer/api/pages/PagesModel.ts#L228-L236) must forward that optional intent.
- [`board-capability-transport.ts`](../../../src/renderer/api/board-capability-transport.ts#L184-L204) must create a new bundled content-host page for `image.edit` and `diagram.edit` instead of reusing any existing page. Other board capabilities may reuse an existing content-host page; a plain board page must never receive an intent that requires a content host.
- [`BoardWebview.ts`](../../../src/renderer/editors/board/BoardWebview.ts#L303-L326) already sends `contentHost` and the initial intent in the handshake; the implementation must preserve that path and verify the board receives both.

The resulting transport identity is deliberate: the board page is the final user-visible page, so the outer envelope’s `pageId` from the exact existing transport line remains the frame/page ID, and the nested `CapabilityPageResult`/opened `DiagramEditResult` must carry that same ID. The public `Capabilities.invoke()` path still needs to unwrap the internal envelope before returning to `ImageEditor`, `SvgEditor`, `MermaidEditor`, and `PagesLifecycleModel`; `BoardWebview.resolveCapabilityInvoke()` still needs to preserve the board-facing top-level `{ pageId, result? }` envelope. This is the result-envelope split, not a second page creation.

The previous planned `openContent()` route is explicitly rejected. [`resolveBoardOpenContent()`](../../../src/renderer/editors/board/board-open-content.ts#L54-L70) must remain unchanged because its `board-editor:` refusal prevents a board from conjuring another board. The content-host board-page constructor is the deliberate platform seam for this task.

### 4. Keep fallback, disable, and active-board behavior explicit

Verify the registry path against D4: when the Excalidraw board is disabled, its manifest/capability candidate is absent and the platform `draw-view` handler handles both capabilities. When enabled, the board candidate wins by capability priority 60, but the returned value remains the same public contract.

Do not rewrite the active-board screen-snip path in this task without an explicit product decision. Its current behavior is direct scene insertion through [`DrawToolbarView.handleScreenSnip()`](../../../src/renderer/editors/draw/index.ts#L201-L231). Test both that behavior and the new-page path through `PagesLifecycleModel.addDrawPage()` separately.

### 5. Record the measurement, without adding a harness

Keep the method and results in this document. If the implementation needs a development-only diagnostic, run it through the renderer’s existing script execution surface and remove it before completion; do not add unit tests or a test harness. Compare the measured estimate and p95 against the exact D7 wording. If a later product decision treats the above-cap 4K case as ordinary use, file a separate DataHandle task rather than changing the inline protocol here.

## Concerns

- **Content-host construction:** a capability request must be opened through the bundled content-host board path, not `openContent()`. `openContent()`’s board rejection remains deliberate; the new `PagesLifecycleModel` seam must pass the initial intent before the board handshake and preserve the unsaved host.
- **Two page IDs:** the transport still has an outer handler/frame `pageId` and a nested public-result `pageId`. Under the chosen design they must be the same board-owned content-host page ID; neither may become a `draw-view` ID or a second page.
- **Initial intent timing:** `BoardPortInitMsg` can carry the request before handler registration. Registration must consume the shim’s pending delivery exactly once and must not lose the initial image or diagram.
- **Image fidelity:** callers can provide natural dimensions and MIME type; missing values must follow the platform fallback path. SVG handoffs must not be silently recorded as PNG when the MIME is supplied.
- **Mermaid failure:** conversion failure is a valid result with no page. It must remain distinguishable from transport rejection and must preserve `MermaidEditor`’s fallback-to-image behavior.
- **Measurement representativeness:** the recorded images are deterministic, high-entropy synthetic inputs on one live Chromium/Windows renderer. They establish a reproducible Phase D baseline, not a universal performance guarantee.
- **Generated/vendor code:** no generated Excalidraw dependency or vendored library should be edited for this task; use the existing exported board dependency.

## Acceptance Criteria

1. `board-manifest.json` declares `image.edit` and `diagram.edit` at priority 60 only in the same change that registers the board intent handler; no declaration-only regression is possible.
2. With the board enabled, an image edit from `ImageEditor`, `SvgEditor`, Mermaid’s rendered-image path, and `PagesLifecycleModel.addDrawPage()` opens a populated Excalidraw drawing and resolves `{ pageId }`.
3. With the board enabled, Mermaid `diagram.edit` opens the converted scene and resolves `{ status: "opened", pageId, imageOnly }`; conversion failure resolves `{ status: "conversion-failed", message }` and creates no page.
4. A page-producing edit capability opens a new bundled content-host board page. The board receives `contentHost: true`, writes the scene through `persephone.host.setContent()`, and remains the user-visible unsaved page that can be saved or saved-as; no existing board/file page is modified and no `draw-view` page is created.
5. Board and platform callers observe the same declared capability result types; the outer and nested page IDs identify the same board-owned page, and a failed conversion has no fabricated page ID.
6. Disabling the Excalidraw board removes its winning capability candidate and leaves the built-in `draw-view` handlers functional, as required by D4.
7. The active-board screen-snip insertion remains functional, and the new-page screen-snip path continues to route through `PagesLifecycleModel.addDrawPage()`.
8. A board-bound payload above `MAX_INTENT_PAYLOAD_BYTES` rejects with `payload-too-large`, the existing caller error surface is visible, and US-1488 does not silently fall back to the platform handler.
9. This document records the renderer-side method, the exact D7 trigger, and measured structured-clone estimates/p95 times. No DataHandle protocol is implemented and no unit-test harness is added.

## Files Changed Summary

| File | Planned change | Status in this investigation |
| --- | --- | --- |
| [`assets/boards/excalidraw/board-manifest.json`](../../../assets/boards/excalidraw/board-manifest.json) | Restore the two capability declarations atomically with the handler | Not changed |
| [`assets/boards/excalidraw/index.html`](../../../assets/boards/excalidraw/index.html) | Register `persephone.intent.onRequest`, route image/diagram intents, and write the serialized scene through the board’s content host | Not changed |
| [`src/renderer/api/board-capability-transport.ts`](../../../src/renderer/api/board-capability-transport.ts) | Open a new content-host board page for each page-producing edit intent, preserve other capability reuse semantics, and preserve the board/result page-ID envelope | Not changed |
| [`src/renderer/api/capabilities.ts`](../../../src/renderer/api/capabilities.ts) | Unwrap board transport results to the public capability contracts | Not changed |
| [`src/renderer/api/pages/PagesLifecycleModel.ts`](../../../src/renderer/api/pages/PagesLifecycleModel.ts) | Carry the initial intent into `addBundledBoardPage()` and construct the untitled content-host board page through `buildEditorById()` | Not changed |
| [`src/renderer/api/pages/PagesModel.ts`](../../../src/renderer/api/pages/PagesModel.ts) | Forward the optional initial intent to the lifecycle method | Not changed |
| [`src/renderer/editors/board/BoardWebview.ts`](../../../src/renderer/editors/board/BoardWebview.ts) | Preserve the board-facing `{ pageId, result? }` invoke envelope after normalization | Not changed |
| [`doc/active-work.md`](../../active-work.md) | Confirm the US-1488 dashboard row links to this task | Already linked; preserved |
| [`doc/epics/EPIC-109.md`](../../epics/EPIC-109.md) | Link the US-1488 entry in the epic task table | Updated separately in this documentation change |
| [`src/renderer/editors/draw/capability-handlers.ts`](../../../src/renderer/editors/draw/capability-handlers.ts) | Reference only; its contracts and conversion behavior guide the board handler | No change planned |
| [`src/renderer/editors/draw/drawExport.ts`](../../../src/renderer/editors/draw/drawExport.ts) | Reference only for dimensions, offsets, serialization, and Mermaid conversion | No change planned |
| `src/renderer/editors/image/ImageEditor.ts`, `src/renderer/editors/svg/SvgEditor.ts`, `src/renderer/editors/mermaid/MermaidEditor.ts` | Existing callers consume the verified contracts | No call-site change planned |
| [`src/renderer/editors/board/board-open-content.ts`](../../../src/renderer/editors/board/board-open-content.ts) | Retain the deliberate refusal to open another board through `openContent()` | No change planned |
| [`src/board-shim.ts`](../../../src/board-shim.ts), [`src/ipc/board-bridge-channels.ts`](../../../src/ipc/board-bridge-channels.ts) | Existing intent API and initial-message delivery are sufficient | No change planned |
| `assets/boards/excalidraw/lib/**`, `scripts/build-board-lib.mjs` | Existing bundled dependency/export is sufficient | No change planned |
| Tests | No unit-test harness exists for this project, and none is added | No change |

## The defect found in live testing, and what actually caused it

The first implementation passed typecheck, lint and build-prod, and still lost every image.
`app.capabilities.invoke("image.edit", …)` resolved a page id, the page opened and mounted, and the
canvas was **empty** — with a 247-byte serialized empty scene stored as its content.

Three diagnoses were attempted and **all three were wrong**, which is worth recording because each
was plausible from reading alone:

1. *The initial host snapshot clobbers the scene.* `settleHostContent()` (`src/board-shim.ts`) fires
   `onContentChange` on the first push, contradicting its own doc comment. Real, but not the cause.
2. *A second board instance overwrites the first.* The page's final board reported never having seen
   the image, which looked like two frames racing.
3. *Another page's frame steals the request before the new page attaches.*

The actual cause was found by tracing every board instance through `pages.logView.push` (a channel
that survives across instances, unlike a value read back from the surviving frame):

```
BT egr0y boot hostAttached=true len=0
BT egr0y render
BT egr0y intent insert
BT egr0y intent inserted n=1      <- the image IS on the API
BT egr0y intent wrote             <- 1576 bytes, the correct scene
BT egr0y onChange n=0             <- 75 ms later, zero elements
BT egr0y onChange n=0
```

One instance, not two. **Excalidraw applies `initialData` asynchronously, after it hands back the
imperative API.** The board treated the `excalidrawAPI` callback as "editor ready" and resolved
`editorReady` synchronously inside `adoptExcalidrawApi`, so an intent could insert during the window
before Excalidraw had committed its opening scene. The component then committed `initialData` —
empty, for a fresh capability page — and wiped the insertion. The board's own debounced write then
serialized that empty scene over the good content 500 ms later, which is the 247-byte artifact.

The fix gates `editorReady` on the **first `onChange` after adoption**, which is the earliest point
at which the opening scene is known to be committed, with a 1 s timer as a floor so an intent waits a
beat rather than hanging if a future build stops firing that first change.

### What was kept, and what was reverted

- **Kept** — the board's `allowEmptySceneWrite` guard. It stops an empty scene being serialized over
  non-empty host content the board never loaded. That is defense in depth against a data-loss shape
  that exists beyond this task, and delete-to-empty still works because any non-empty scene arms it.
- **Kept** — the transport's `if (!pending.page) continue;` guard, which stops a frame belonging to
  another page of the same board root taking a request while its own page is being constructed.
- **Reverted** — the `settleHostContent()` change in `src/board-shim.ts`. Finding 1 above is a real
  contract mismatch, but the fix was unnecessary once the true cause was known, and it changes shared
  behavior for every content-host board. The claim that "only Excalidraw listens, after awaiting
  `getContent()`" is **false**: the `todo` and `force-graph` boards both register `onContentChange`
  *before* awaiting `getContent()`, deliberately. They would still work, but that is a shared-contract
  change verified by reading alone, and it belongs to its own task with its own verification.

### Verified live, after the fix

| Check | Result |
|---|---|
| `image.edit` | new page per call, `elementCount: 1`, 1581-byte scene |
| `diagram.edit` | `{ status: "opened", imageOnly: false, pageId }`, 5063-byte converted scene |
| Two successive invocations | distinct page ids, correct titles |
| Opening a real `.excalidraw` file | 25 elements loaded, page not modified — the file path is unaffected |
| typecheck / lint / build-prod | pass |
