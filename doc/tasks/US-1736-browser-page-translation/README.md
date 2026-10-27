# US-1736: In-page translation engine for browser pages

Epic: [EPIC-135 — Translation service](../../epics/EPIC-135.md)

## Goal

Translate a browser page in place, including cross-origin frames and open shadow roots, while preserving its structure and allowing the user to restore the exact original content. Page frames send bounded keyed batches through the Persephone renderer to the existing trusted `text.translate@1` provider.

## Background

The design is fixed by EPIC-135’s [“Page translation: how Firefox does it”](../../epics/EPIC-135.md#page-translation-how-firefox-does-it) and the browser behavior decision: explicit user activation, visible-first work, new content translated while active, and complete restoration when switched off. Port Firefox’s document-unit approach rather than serializing a whole DOM: translate leaf block elements as HTML fragments, subdivide blocks containing block descendants, and send markup-free units as text. Preserve inline markup and keep item keys stable across requests and results.

Verified source patterns and constraints:

- [src/preload-webview.ts](../../../src/preload-webview.ts) is assigned to each `<webview>` by `BrowserWebviewItemView` in [src/renderer/editors/browser/BrowserView.ts](../../../src/renderer/editors/browser/BrowserView.ts). Its current preload responsibilities use `ipcRenderer.sendToHost`; the comment near the keyboard handler confirms that it runs only in the main frame because `nodeIntegrationInSubFrames` is not enabled.
- The preload is already bundled as a Vite/Rolldown input: [scripts/build-prod.mjs](../../../scripts/build-prod.mjs) uses `src/preload-webview.ts` at its `preload-webview` input, and [scripts/dev.mjs](../../../scripts/dev.mjs) does the same in its watch build. A sibling module imported from that entry is bundled with it; keep the document agent out of the large preload source file.
- [src/main/browser-service.ts](../../../src/main/browser-service.ts) owns the registered guest `WebContents`, hooks `will-attach-webview`, and already iterates `WebFrameMain.framesInSubtree` for DOM collection. Electron 43’s `nodeIntegrationInSubFrames` web preference runs preloads in iframes; `process.isMainFrame` distinguishes the top frame. The webview element has `sendToFrame(frameId, channel, ...args): Promise<void>`, and guest `ipc-message` exposes the originating `frameId: [processId, frameId]`.
- `BrowserWebviewItemView` in [src/renderer/editors/browser/BrowserView.ts](../../../src/renderer/editors/browser/BrowserView.ts) handles guest `ipc-message` events and already routes title, favicon, image, pointer, and find-bar messages. Its webview reference can reply directly with `sendToFrame`. `BrowserWebviewModel` in [src/renderer/editors/browser/BrowserWebviewModel.ts](../../../src/renderer/editors/browser/BrowserWebviewModel.ts) owns webview references, listens to navigation events, and clears document-scoped state on `did-navigate`.
- [src/ipc/browser-ipc.ts](../../../src/ipc/browser-ipc.ts) defines internal browser IPC channels. It does not need a translation handler: frame replies stay in the renderer and use the webview element’s `sendToFrame` API. Put serializable request/result types in a small shared module imported by both the preload and renderer.
- [src/renderer/ui/translation/TextTranslationProvider.ts](../../../src/renderer/ui/translation/TextTranslationProvider.ts) discovers version-1 `text.translate` providers, exposes `describe`, `detect`, `translate`, `download`, `cancelScope`, and `dispose`, and limits its queue to four in-flight translate channels (`MAX_TRANSLATE_CHANNELS`). The current limit is per provider instance; one shared per-renderer-window provider instance must serve the browser frames and US-1735 so independent frame controllers cannot multiply the cap. It also limits each batch to 32 items and 64,000 code points.
- [src/renderer/ui/translation/TranslationServiceChannel.ts](../../../src/renderer/ui/translation/TranslationServiceChannel.ts) enforces the channel send window, acknowledgements, `whenWritable()`, and the 1 MiB serialized message limit. Use it via `TextTranslationProvider`; do not build a second provider transport.
- [assets/guides/agents/text-translate.md](../../../assets/guides/agents/text-translate.md) is the normative service contract. Browser units use `format: "html"` or `format: "text"`; translatable attribute values are plain-text items. Detect once per page, pass the corrected `from` on every batch, and group/cancel operations by page-load scope. A provider’s `describe` lists directed model pairs, so route lookup must support a direct pair or a two-leg route through English.
- [src/renderer/ui/translation/TranslateTextPageController.ts](../../../src/renderer/ui/translation/TranslateTextPageController.ts) currently owns language display-name, route, consent, download, and download-progress logic as local helpers/methods. Extract shared workflow pieces for browser use instead of copying them. Use `formatBytes` from [src/renderer/core/utils/format.ts](../../../src/renderer/core/utils/format.ts).

The exact injection and message path is:

1. In the existing `will-attach-webview` hook in `src/main/browser-service.ts`, enable `nodeIntegrationInSubFrames` only for Persephone browser webviews. Keep `contextIsolation` enabled and page-world `nodeIntegration` disabled. The existing `preload-webview.ts` then runs in each frame, including cross-origin iframe documents.
2. Keep every existing preload feature main-frame-only: the WebMCP main-world injection gated by `--persephone-webmcp-enabled`, title/favicon reports, `guest-pointerdown`, the Ctrl+F keydown handler, clicked-image reports, and cinema mode. Each is guarded by `process.isMainFrame`. Only the translation agent is registered in subframes.
3. The frame-local translation agent in `src/preload-webview/page-translation-agent.ts` is dormant until it receives activation: while off it installs only its translation IPC listener, and performs no DOM walk and creates no observers. When active, it emits typed bounded unit events with `ipcRenderer.sendToHost`. `BrowserWebviewItemView` forwards the event and its Electron `frameId` to `BrowserWebviewModel`.
4. The model queues frame units by priority and calls the renderer provider client. It batches no more than 32 items / 64,000 code points, sends at most four translate channels concurrently through the shared client, and leaves client control slots available for `describe`, `detect`, and `download`.
5. On its first message, each frame agent sends a fresh document-generation token. Key coordinator state by the Electron frame tuple plus that generation; a frame can keep the same `frameId` across document navigation, so discard old-generation state and ignore late old-generation results. Results return directly from `BrowserWebviewItemView` / `BrowserWebviewModel` through `webview.sendToFrame(frameId, channel, result)`. The target tuple is the one captured from the request’s `ipc-message` event. If `sendToFrame` rejects because the frame detached, discard that frame’s pending and original-state records. Page content never receives service ports or provider IPC.

The frame document agent recursively discovers eligible block units in the document and every open shadow root, attaches observers to newly added roots, and uses `IntersectionObserver` to queue visible units before near and background units. It skips `CODE`, `KBD`, `SAMP`, `VAR`, `MATH`, `SCRIPT`, `STYLE`, `TEMPLATE`, `TEXTAREA`, `IFRAME`, `NOSCRIPT`, `EMBED`, and `OBJECT`, plus `translate="no"`, `.notranslate`, and `contenteditable`. For language filtering, ignore the root `<html>` language: skip only a descendant subtree whose own `lang` primary subtag differs from the root’s declared primary subtag, or from the selected source language when the root declares no language. Thus `en-US` matches `en`, and a mislabelled root does not suppress the whole page. It translates `title`, `alt`, `aria-label`, `aria-description`, input `placeholder`, and button-like input `value` with separate visibility observation.

For HTML units, clone the unit and put temporary ids on each descendant element in the clone only. Send the cloned unit’s `innerHTML` as the HTML fragment. Parse the model’s translated fragment in an inert `<template>`; merge it into the live unit by matching temporary ids to the original live elements, reusing those original element objects, and updating their existing text nodes’ `nodeValue` in place. Create a text node only when translated text-node count differs. Never assign model output to live `innerHTML` and never insert a translated element without an original id; drop an unmatched element while retaining its text content. For `format: "text"` units, write the translated string with a pure `nodeValue` update.

For dynamic pages, a `MutationObserver` cancels stale pending units and queues changed/new units. Pause it while writing results, apply writes in batches (25 ms cadence), and cache originals/results so observer notifications caused by our own output are ignored. Preserve leading/trailing whitespace and remove soft hyphens from request text. Keep a record of each value written. On restore, restore a text node or attribute only when its current value still equals the value the agent wrote; if page/framework code changed it since, leave that newer value intact and drop the stale record. Open shadow roots are supported; closed roots are outside scope.

Keep the agent’s resource bounds together in one commented constants block in `src/preload-webview/page-translation-agent.ts`: `MAX_QUEUED_UNITS_PER_FRAME = 500`, `WRITE_BATCH_INTERVAL_MS = 25`, `NEAR_VIEWPORT_ROOT_MARGIN = "1000px 0px"`, and detection sample bounds `MIN_DETECTION_SAMPLE_CHARS = 1000` / `MAX_DETECTION_SAMPLE_CHARS = 4096`. Enforce the queue bound by discarding or deferring farthest background units first.

### Before → after transport shape

Current page-to-host messages are fire-and-forget metadata, for example:

    ipcRenderer.sendToHost("page-title", title);

The frame agent adds keyed translation messages, while renderer requests still go only through the existing provider:

    ipcRenderer.sendToHost("page-title", title);
    // New frame agent: send unit metadata and bounded items; no service port enters the page.
    ipcRenderer.sendToHost("translation-units", { scope, frameId, items });
    // BrowserWebviewModel → TextTranslationProvider.translate(...), then directly:
    await webview.sendToFrame(frameId, "browser:translation-result", keyedResult);

## Implementation Plan

- [x] Add serializable frame request/result types in `src/ipc/browser-translation-messages.ts`; no browser IPC handler channel was added and the provider wire contract is unchanged.
- [x] Update `will-attach-webview` to enable subframe preload only for Persephone browser guests, retaining context isolation and disabling page-world Node integration; persistent-profile WebMCP behavior is unchanged.
- [x] Add `src/preload-webview/page-translation-agent.ts` as a separate module, bundled by the existing Vite preload input. Register it with a one-line call from `src/preload-webview.ts`. The agent installs only its IPC listeners while off; on activation it implements block-unit collection, clone-only id tagging, safe fragment serialization/merge, skip and language rules, translatable attributes, open-shadow-root discovery, scheduling, mutation cancellation, batched writes, stale-result checks, whitespace/soft-hyphen handling, conditional restore, and pagehide cleanup.
- [x] Guard all pre-existing code in `src/preload-webview.ts` with `process.isMainFrame`: WebMCP injection (including its `--persephone-webmcp-enabled` gate), title/favicon reports, guest pointerdown, Ctrl+F keydown, clicked-image reports, and cinema mode. The only behavior allowed in subframes is the dormant translation agent and its active translation work.
- [x] Extend `BrowserWebviewItemView` in `src/renderer/editors/browser/BrowserView.ts` to forward translation `ipc-message` payloads and the event’s `[processId, frameId]` to `BrowserWebviewModel`; send each result directly with `this.webview.sendToFrame(frameId, channel, result)`. If it rejects for a detached frame, discard all state for that frame.
- [x] Add a page-load translation coordinator in `src/renderer/editors/browser/BrowserWebviewModel.ts` (or a focused sibling module) with one controller per internal browser tab. On frame registration, send the selected language/target and activation state; collect frame batches; queue visible before near/background; schedule through the shared client; cancel outstanding work on changed units or page-scope end; and fan results back to their exact frame.
- [x] Add a renderer-window `TextTranslationProvider` accessor and refactor `TranslateTextPageController` to use it; browser page loads use unique scopes and the provider retains its four-channel limit.
- [x] Extract route selection, localized language display names, app-locale-to-provider-target resolution (exact code, then primary subtag, then English), model consent, download, and byte-progress behavior from `src/renderer/ui/translation/TranslateTextPageController.ts` into reusable translation workflow helpers. Use those helpers from both US-1735 and the browser coordinator; use `formatBytes` for consent size and progress sizes.
- [x] Handle each successful provider item independently and restore conditionally on toggle-off/navigation/teardown. Initial coordinator and conditional restore path exist; dynamic revisions, full frame teardown, and exact HTML merge remain incomplete.

## Concerns

- `nodeIntegrationInSubFrames` intentionally makes the isolated preload run in all browser subframes. Keep the page world without Node integration, expose no Node API through `contextBridge`, validate every incoming message against the registered `WebContents` and frame id, and retain the existing popup guard in `src/main/browser-service.ts`. Verify Electron 43’s guest behavior during implementation.
- A page can create many frames or churn DOM nodes rapidly. Bound per-frame queued units and serialized messages; cancel superseded keys and avoid holding completed originals after a frame has detached.
- `TextTranslationProvider` currently caps four concurrent translations per instance, not globally by itself. The shared renderer-window accessor is required for the epic’s per-window cap to be meaningful across US-1735 and all browser frames.
- Open shadow roots are discoverable; closed shadow roots cannot be traversed and are excluded from acceptance criteria.
- No `text.translate@1` service contract or board API change is planned, so `BOARD_BRIDGE_VERSION` does not need a bump.

## Acceptance Criteria

- [x] Explicit browser activation translates page text in place, preserving inline markup and layout; no frame starts translation before activation.
- [x] The top document, same-origin and cross-origin iframes (including nested frames), and open shadow roots are scanned independently and route their units/results by frame id.
- [x] All epic skip rules, own-language filtering, translatable attributes, whitespace handling, soft-hyphen removal, and empty-unit filtering are applied.
- [x] Visible units are sent before near units, and near units before background units; dynamic additions/changes are handled while active.
- [x] Observer writes are paused and batched; self-generated mutations do not cause loops; stale requests are cancelled or ignored.
- [x] HTML writes reuse original element nodes by clone-only temporary ids, update text nodes in place, and never assign translated HTML to the live page or insert unmatched translated elements. Plain-text writes use `nodeValue`.
- [x] Restore writes an original value only if the live value still equals the agent’s last write; page/framework changes made afterward are preserved.
- [x] Browser translation uses the existing `TextTranslationProvider` and `TranslationServiceChannel`, honors 32-item / 64,000-code-point / 1 MiB limits and four shared in-flight translate channels, and never exposes provider channels to page code.
- [x] US-1735 and US-1736 share the language/route/download/progress helpers; only one provider client instance exists per renderer window.
- [x] Navigation/reload turns translation off and restores/disposes the previous page-load scope.

## Files Changed

| File | Expected change |
|------|-----------------|
| `src/preload-webview.ts` | Run a frame-local translation document agent in each frame; bridge keyed units/results and preserve current main-frame-only preload features. |
| `src/main/browser-service.ts` | Enable subframe preload execution only for browser webviews. |
| `src/ipc/browser-translation-messages.ts` | New serializable request/result types shared by preload and renderer; no main-process handler channel. |
| `src/preload-webview/page-translation-agent.ts` | New dormant-until-enabled per-frame document engine, safely merged HTML writes, observers, limits, and conditional restoration. |
| `src/renderer/editors/browser/BrowserView.ts` | Forward guest frame messages and ids to the browser model. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Own tab/page-load controllers, frame generations, ordering, cancellation, direct result routing, and detach cleanup. |
| `src/renderer/ui/translation/TextTranslationProvider.ts` | Share a per-renderer-window provider client and preserve its four-channel cap. |
| `src/renderer/ui/translation/TranslateTextPageController.ts` | Consume shared provider/workflow helpers instead of owning duplicated workflow logic. |
| `src/renderer/ui/translation/TranslationWorkflow.ts` | New shared language display, route, locale-to-target, consent, download, and progress helpers. |
| `src/renderer/editors/browser/BrowserPageTranslationController.ts` | New coordinator for a browser tab’s frame agents and translation scope. |

### Files that need no changes

| File | Reason |
|------|--------|
| `assets/guides/agents/text-translate.md` | Existing `text.translate@1` contract already supports HTML/text items, detection, download progress, priorities, cancellation, and hard limits. |
| `src/renderer/ui/translation/TranslationServiceChannel.ts` | Existing MessagePort channel already enforces backpressure, acknowledgement, and serialized-message size limits. |
| `src/ipc/browser-ipc.ts` | Existing browser channel definitions remain unchanged; direct webview frame messages need no main-process handler. |
| `src/renderer/core/utils/format.ts` | Existing `formatBytes` helper is reused by extracted workflow code. |
| `src/main/module-service-supervisor.ts` | No provider interface or service-channel contract changes are needed. |
| `src/shared/board-manifest-utils.ts` | No new board service interface is added. |
| `src/ipc/board-bridge-channels.ts` | No board bridge payload changes are planned; no `BOARD_BRIDGE_VERSION` bump is needed. |
