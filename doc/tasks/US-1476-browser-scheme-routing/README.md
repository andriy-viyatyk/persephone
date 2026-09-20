# US-1476: Browser routing of `magnet:` and `.torrent` into `openRawLink`

**Status:** Planned  
**Epic:** [EPIC-107: Open providers, ranged streaming and the stream-host](../../epics/EPIC-107.md)  
**Roadmap:** Phase C, item 5; worked flow §3.8, step 1

## Goal

Route page-initiated Browser navigations for pipeline candidates through a new renderer event. Main
classifies the navigation, while the renderer checks `isSchemeRegistered()` before forwarding a
registered scheme to the existing `openRawLink` event. Preserve the existing security block for
`file:` and `app-asset:`, and preserve the exemption for programmatic `loadURL()` calls used by MCP
and restore.

The `.torrent` download path is intentionally documented and split out below: it is not a
navigation and needs a separate download-focused task rather than expanding this small change.

## Background

### Verified before-state

Source was checked against the current tree on 2026-09-20:

- `src/main/browser-service.ts:25` defines `BLOCKED_PROTOCOLS` as only `file:` and
  `app-asset:`. The `will-navigate` listener at `:268-289` parses the URL, prevents only those
  two protocols, and sends `BrowserChannel.event` / `did-start-navigation` with
  `{ url, blocked: true }`. An invalid URL is caught and ignored. Every other protocol falls
  through to Chromium.
- `src/renderer/editors/browser/BrowserWebviewModel.ts:266-276` handles that browser event only by
  calling `webview.goBack()` when `data.blocked` is true. It does not open a raw link.
- The live finding recorded in the EPIC-107 notes was reproduced through a real page-initiated
  `editor.click` on `mneme://qa/test.md`, an already-registered pipeline scheme: the Browser tab
  stayed on its current document, no page opened, and `ui.alerts.list()` remained empty. The
  observable before-state is therefore a silent drop, not a user-visible Chromium error.
- The live Browser surface was exercised through MCP for the `mneme://qa/test.md` reproduction
  above. The `.torrent` download surface was not exercised; its before-state is therefore
  source-verified only and must be checked live during implementation verification rather than
  presented as a completed runtime run.

### Where scheme registration lives

`src/renderer/content/scheme-registry.ts:29` owns the `schemeHooks` map. `registerScheme()` stores
registrations at `:70-87`; `isSchemeRegistered()` and `listRegisteredSchemes()` at `:89-95` read
that renderer-local map. The main process cannot import this registry without crossing the process
boundary and creating the wrong dependency.

The renderer already has the required handoff:

1. `src/main/browser-service.ts:82-97` sends browser events to the host renderer with
   `sender.send(BrowserChannel.event, event)`.
2. `src/ipc/api-types.ts:327` declares `EventEndpoint.eOpenUrl`; the renderer subscribes to it in
   `src/ipc/renderer/renderer-events.ts:86-88`.
3. `src/renderer/api/internal/RendererEventsService.ts:76-80` sends that URL through
   `app.events.openRawLink` using `createLinkData()` and `guard()`.
4. `src/renderer/content/parsers.ts:66-69` dispatches registered schemes, and the dispatcher
   uses the same registry map as `isSchemeRegistered()`.

`src/renderer/api/app.ts:60-64` confirms the public equivalent: `app.openRawLink(href, options)`
ultimately sends the same `openRawLink` event. The existing validation boundary at
`src/renderer/api/pages/open-url-validation.ts:59-68` also answers registration in the renderer;
it is not a main-process API.

**Decision:** main answers only whether a page-initiated navigation is a normal Chromium navigation
or a pipeline candidate. The renderer answers whether the candidate is registered, because only the
renderer owns the registry. Main will prevent and send candidates outside the explicit Chromium
allowlist through a new `EventEndpoint.eOpenPipelineCandidate` event. The renderer subscribes to that
event, extracts the URL scheme, and calls `isSchemeRegistered(scheme)` before sending
`app.events.openRawLink`; an unregistered candidate is dropped, restoring the pre-change silent
failure without producing a pipeline warning. The existing `EventEndpoint.eOpenUrl` path is left
unchanged because its other callers pass ordinary HTTP URLs and filesystem paths. No scheme name is
hardcoded.

### Downloads are a different path

An HTTP link ending in `.torrent` may cause Chromium to emit a session `will-download` event rather
than `will-navigate`. `src/main/download-service.ts:20-34` hooks that event for every session;
`handleWillDownload()` at `:86-170` opens a save dialog, calls `item.setSavePath()`, tracks the
download, and emits download progress/completion events. It never sends `openRawLink`.

The renderer's completed-download action is also separate:
`src/renderer/api/downloads.ts:89-92` calls `api.openDownload()`, and
`src/main/download-service.ts:49-53` implements that as `shell.openPath(savePath)`. A trusted board's
`fileMasks` claim is only consumed by the renderer custom-editor registry
(`src/renderer/editors/board/custom-editor-registry.ts:246-272`) after a source enters the content
pipeline; it is not consulted by `download-service.ts`.

Therefore a `.torrent` download currently saves/opens as an OS file and bypasses `openRawLink`.
The `.torrent` interaction was not exercised in this session, so implementation verification must
confirm the save-dialog/download-manager behaviour. Routing it would require a separate design for
whether to cancel the download and open the source URL, or save first and open the saved path, plus
main/renderer download event and cleanup semantics. That is larger than the focused `will-navigate`
change and belongs in standalone follow-up task **US-1478**, not EPIC-107.

### Programmatic navigation exemption

The comment at `src/main/browser-service.ts:268-272` is load-bearing: Electron's `will-navigate`
fires for page actions such as links, `window.location`, and forms, but not for programmatic
`loadURL()`. `src/renderer/editors/browser/BrowserWebviewModel.ts:175-182` calls `webview.loadURL()`
when the Browser model target changes; MCP/restore use this path. The fix must change only the
page-initiated `will-navigate` branch and must not add a renderer-side interception that turns
programmatic loads into pipeline opens.

The URL-bar `BrowserEditor.navigate()` path is likewise model-driven (`BrowserEditor.ts:445-491`);
it must remain a `loadURL()` path under this task. A later task may decide whether user-entered
schemes need a distinct, explicitly user-initiated route, but that is not permission to weaken the
MCP/restore exemption here.

## Implementation Plan

### 1. Change the main-process navigation candidate policy

- Edit `src/main/browser-service.ts` for the navigation change and add a direct import of
  `EventEndpoint` from `src/ipc/api-types.ts`; do not add a renderer-registry import to main.
- Keep `BLOCKED_PROTOCOLS = ["file:", "app-asset:"]` and its current `event.preventDefault()` plus
  `did-start-navigation` notification unchanged for those security cases.
- Define the explicit normal-navigation allowlist as `http:`, `https:`, `about:`, `blob:`,
  `mailto:`, and `tel:`. `http:`/`https:` are ordinary web pages; `about:` includes the Browser's
  internal blank/document targets; `blob:` is a Chromium object URL. `mailto:` and `tel:` remain
  with Chromium so its existing external-protocol/OS handling is not prevented. The existing
  `src/renderer/content/open-with-default-app.ts` and `api.openPath()`/`shell.openPath` surface is
  for filesystem paths and folders, not URI schemes, so it is not a replacement handoff here.
- Deliberately leave `data:` outside that allowlist. Chromium blocks top-level page-initiated
  `data:` navigation for security, so routing a registered `data:` scheme through the candidate
  event is a new capability, not preservation of current behaviour. The renderer registration gate
  decides whether it is usable.
- Do not allowlist `devtools:`, `chrome:`, `view-source:`, or `chrome-extension:`. The Browser
  webview surface does not register or host those Chromium-internal/extension schemes; they are not
  legitimate app Browser targets and an emitted instance is dropped as an unregistered candidate.
- For every other protocol after the dangerous-protocol branch, call `event.preventDefault()` and
  send the original URL through the distinct `EventEndpoint.eOpenPipelineCandidate` event to the
  owning host renderer. This includes any future board-registered scheme; do not add `magnet`,
  `torrent`, or a board-provided name to main code.
- Do not call `sender.send()` directly. Add or reuse an equivalently guarded helper in
  `src/main/browser-service.ts` that checks `sender.isDestroyed()` inside `try/catch`, then sends
  `EventEndpoint.eOpenPipelineCandidate`. The existing `sendEvent()` helper is typed for
  `BrowserChannel.event` payloads, so add a small typed host-event helper rather than widening it
  unsafely. Sending to `sender` targets the owning host renderer; broadcasting through `openWindows`
  would open the link in unrelated windows.
- Return from the handler after each prevented branch so the dangerous block never also forwards a
  `file:` or `app-asset:` URL into the pipeline.
- Keep the existing `try/catch` shape for unparseable URLs. It is an intentional no-op for malformed
  page navigation; do not stringify caught values or add a new error surface.

Before:

```ts
const BLOCKED_PROTOCOLS = ["file:", "app-asset:"];

on("will-navigate", (event: Electron.Event, url: string) => {
    try {
        const parsed = new URL(url);
        if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
            event.preventDefault();
            sendEvent(sender, tabId, internalTabId, "did-start-navigation", {
                url,
                blocked: true,
            });
        }
    } catch {
// Invalid URL
    }
});
```

After (shape; the allowlist and the registration decision are resolved here):

```ts
import { EventEndpoint } from "../ipc/api-types";

const BLOCKED_PROTOCOLS = ["file:", "app-asset:"];
const CHROMIUM_NAVIGATION_PROTOCOLS = [
    "http:", "https:", "about:", "blob:", "mailto:", "tel:",
];

function sendHostEvent(sender: WebContents, endpoint: EventEndpoint, data: string): void {
    try {
        if (!sender.isDestroyed()) sender.send(endpoint, data);
    } catch {
        // The host renderer may be destroyed before the webview is disposed.
    }
}

// The existing file/app-asset branch stays first and still emits did-start-navigation.
// A non-Chromium protocol is prevented and handed to the candidate event.
if (!CHROMIUM_NAVIGATION_PROTOCOLS.includes(parsed.protocol)) {
    event.preventDefault();
    sendHostEvent(sender, EventEndpoint.eOpenPipelineCandidate, url);
}
```

This allowlist is deliberately about supported page navigation, not pipeline ownership. Registration
is answered only by the renderer-side gate below. `data:` is intentionally a candidate and therefore
a new registered-scheme capability despite Chromium's top-level page-navigation block; `file:` and
`app-asset:` remain security-blocked before the candidate branch.

### 2. Add the renderer-side registration gate without changing existing URL opening

- In `src/ipc/api-types.ts`, add `EventEndpoint.eOpenPipelineCandidate` beside `eOpenUrl` and add
  `[EventEndpoint.eOpenPipelineCandidate]: EventObject<string>` to `EventApi`.
- In `src/ipc/renderer/renderer-events.ts`, add the matching `RendererEventObject<string>` property
  so the host renderer subscribes to the new endpoint.
- In `src/renderer/api/internal/RendererEventsService.ts`, subscribe to the new event with a
  dedicated handler; leave `handleOpenUrl` unchanged for its five main-side callers' HTTP URLs and
  filesystem paths. Import `isSchemeRegistered` directly from
  `src/renderer/content/scheme-registry.ts`.
- The exact gate is: extract the leading scheme with the existing scheme grammar
  `/^([a-z][a-z\\d+.-]*):/i`; if there is no match or `isSchemeRegistered(match[1])` is false,
  return without calling `app.events.openRawLink`. If it is true, call the existing guarded
  `createLinkData(url)` → `app.events.openRawLink.sendAsync(...)` path. This keeps `mailto:` and
  `tel:` out of the pipeline because main allowlists them, and prevents unregistered candidates
  from reaching the file-parser fallback and producing an `Invalid file path` warning.
- Do not change `src/renderer/content/scheme-registry.ts`; its renderer-local map and
  `isSchemeRegistered()` remain the source of truth. Do not change `src/renderer/api/app.ts` or
  `src/renderer/api/pages/open-url-validation.ts`; they remain existing consumers/contracts.
- Do not change `src/renderer/editors/browser/BrowserWebviewModel.ts`; its blocked-navigation
  recovery remains responsible for `did-start-navigation` events from the two dangerous protocols.
- Do not call `app.openRawLink()` from main. Main must use the new typed renderer event endpoint,
  keeping process ownership and the current `guard()` error handling intact.

Renderer handler shape:

```ts
private handlePipelineCandidate = async (url: string) => {
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1];
    if (!scheme || !isSchemeRegistered(scheme)) return;

    await guard("Failed to open URL", () =>
        app.events.openRawLink.sendAsync(createLinkData(url)),
    );
};
```

The IPC declaration/subscription shape is the matching typed pair: add
`[EventEndpoint.eOpenPipelineCandidate]: EventObject<string>` to `EventApi` in
`src/ipc/api-types.ts`, then add
`[EventEndpoint.eOpenPipelineCandidate] = new RendererEventObject<string>(EventEndpoint.eOpenPipelineCandidate)`
in `src/ipc/renderer/renderer-events.ts`; `RendererEventsService` subscribes that property to the
handler above.

### 3. Verify the focused navigation fix manually through the live app

- Use a non-pinned Browser tab and a harmless local/public page with an anchor to an already
  registered scheme (the existing `mneme://qa/test.md` reproduction is suitable when its fixture is
  available). Click the link so the navigation is page-initiated.
- Before implementation, record the current-document URL, opened-page count, and
  `ui.alerts.list()`; the established result is unchanged tab, no opened page, and no alert.
- After implementation, verify that the Browser navigation is prevented, the owning renderer
  receives `eOpenPipelineCandidate`, the renderer's `isSchemeRegistered()` gate passes the
  registered scheme to `openRawLink`, the parser/resolver opens the expected page, and no Chromium
  navigation error replaces the Browser document.
- Repeat with a board-provided scheme after US-1471 exposes one. Use its declared scheme rather than
  a hardcoded `magnet` special case; later Phase E can use the same path for `magnet:`.
- Verify an unregistered custom scheme is prevented, reaches the candidate event, is dropped by the
  renderer before `openRawLink`, and produces no alert. Verify ordinary `mailto:` and `tel:` links
  remain outside this candidate path so Chromium/OS handling is not prevented. Verify `file:` /
  `app-asset:` still only take the existing blocked/go-back path.
- Verify a programmatic Browser navigation used by MCP or restore still calls `loadURL()` and is not
  intercepted by this handler. Do not modify or leave behind test pages, boards, alerts, or download
  files.

### 4. Track `.torrent` download handling separately

- During verification, use a disposable `.torrent` response only to observe whether Chromium emits
  `will-download`, how the save dialog and download entry behave, and whether any `openRawLink` or
  custom-editor page appears. Revert the downloaded file and download history. This is a follow-up
  investigation for standalone **US-1478**, not an implementation requirement for US-1476.
- US-1478 should cover `src/main/download-service.ts`, the shared download event contract, and the
  renderer download action if the live check confirms that routing is needed. Do not add that work
  to US-1476 or EPIC-107.

No unit tests or test harnesses are planned; this repository's verification for this task is live
manual/MCP surface work plus the project checks required when the implementation is completed.

## Concerns

- **Runtime evidence is asymmetric.** The registered-scheme click has a live MCP reproduction
  recorded in EPIC-107 and was exercised through the live Browser surface. Only the `.torrent`
  download remains unexercised; US-1478 must not be marked complete from source inspection alone.
- **Allowlist correctness is resolved for this task.** The page-initiated pass-through list is
  `http:`, `https:`, `about:`, `blob:`, `mailto:`, and `tel:`. `data:` is deliberately a new
  candidate capability, and `devtools:`, `chrome:`, `view-source:`, and `chrome-extension:` are
  unsupported/unregistered Browser-webview schemes that are dropped. All other protocols become
  renderer-checked candidates, with the dangerous list taking precedence.
- **`magnet:` has no registration today.** The implementation must not special-case it. Once a
  trusted board registers `magnet`, the same main-to-renderer event path must handle it, including
  its standard `magnet:?…` URL shape.
- **Typed URL-bar input is not part of this seam.** `BrowserEditor.navigate()` currently requires a
  `://`-shaped scheme before it avoids search normalization, and then uses programmatic `loadURL()`.
  Changing that behavior would need a separate decision that distinguishes user entry from MCP and
  restore; it must not be smuggled into this navigation-handler fix.
- **Downloads need a product decision in US-1478.** Opening the source URL avoids a duplicate local
  file but may lose a user-selected save operation; opening the saved path preserves the download
  but needs an explicit handoff from the download manager into `openRawLink`. Either choice crosses
  more files and lifecycle states than US-1476 should own.
- **No styling or error-string changes are expected.** If implementation adds renderer UI later,
  colors must come from `theme/color`; any caught values must use `errMessage` or `guard`; renderer
  path operations must use `file-path`, not direct `require("path")`; and imports must remain
  direct rather than barrel-based.

## Acceptance Criteria

- [ ] A live, page-initiated click to an already-registered pipeline scheme reaches the owning
  renderer's `openRawLink` pipeline and opens/resolves through that scheme; it no longer silently
  leaves the Browser tab unchanged.
- [ ] The implementation works for a board-provided scheme without naming `magnet`, `torrent`, or
  any other board scheme in main code; a later `magnet` registration follows the same path.
- [ ] The before-state is recorded with the observed silent drop, unchanged Browser document, no
  new page, and empty alerts surface.
- [ ] `file:` and `app-asset:` remain prevented and continue to emit the existing blocked
  `did-start-navigation` event consumed by `BrowserWebviewModel.goBack()`.
- [ ] Programmatic `loadURL()` navigation from MCP/restore remains exempt from `will-navigate` and
  is not rerouted into `openRawLink`.
- [ ] An unregistered custom protocol is prevented from reaching Chromium, dropped before
  `openRawLink`, and produces no pipeline/file-parser warning; `mailto:` and `tel:` remain
  pass-through protocols.
- [ ] The `.torrent` download path is explicitly reported as unexercised here and assigned to
  standalone follow-up **US-1478**; its separate `will-download` / download-manager handling is
  not silently claimed as fixed by US-1476.
- [ ] No unit tests or test harnesses are added, no commit is created, and no user pages, boards,
  alerts, or downloaded files remain after verification.
- [ ] Once implementation is authorized, `npm run typecheck`, `npm run lint`, and
  `npm run build-prod` pass.

## Files Changed

| File | Planned action | Reason |
|------|----------------|--------|
| `src/main/browser-service.ts` | Change | Classify page-initiated protocols, preserve the dangerous block, and send candidates through a destroyed-sender-guarded `eOpenPipelineCandidate` event. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | No change | Existing blocked-navigation recovery remains valid for `file:` and `app-asset:`. |
| `src/renderer/content/scheme-registry.ts` | No change | Renderer-local scheme ownership and `isSchemeRegistered()` already answer registration. |
| `src/renderer/api/app.ts` | No change | Existing `app.openRawLink()` contract is the target pipeline. |
| `src/renderer/api/pages/open-url-validation.ts` | No change | Existing consumer proves registration is renderer-side and needs no routing change. |
| `src/main/download-service.ts` | No change in US-1476 | Downloads are a separate path assigned to standalone US-1478. |
| `src/renderer/api/downloads.ts` | No change in US-1476 | Existing download-manager actions remain unchanged until US-1478's design is approved. |
| `src/ipc/api-types.ts` | Change | Declare `EventEndpoint.eOpenPipelineCandidate` and its `EventApi` payload. |
| `src/ipc/renderer/renderer-events.ts` | Change | Expose the new typed renderer event for subscription. |
| `src/renderer/api/internal/RendererEventsService.ts` | Change | Subscribe to the candidate event, gate it with `isSchemeRegistered()`, and leave `handleOpenUrl` unchanged. |
| `src/renderer/content/open-with-default-app.ts` | No change | Existing `openWithDefaultApp()` is for filesystem paths through `api.openPath()`/`shell.openPath`, not URI-scheme handoff. |
| `US-1478` | Follow-up only | Standalone download-routing task; not part of EPIC-107 and not implemented here. |
| `doc/active-work.md` | No change | User-owned; already contains the US-1476 dashboard entry. |
| `doc/epics/EPIC-107.md` | No change | User-owned authoritative epic document; this task links to it but does not edit it. |
