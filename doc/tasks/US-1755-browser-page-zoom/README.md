# US-1755: Browser page zoom

## Goal

Add a per-internal-tab page zoom control relative to window zoom. Its toolbar button shows the tab's own percentage and opens a vertical slider with 200%, 150%, 100%, 75%, and 50% presets.

## Background

- Each browser editor has multiple retained internal-tab webviews (`src/renderer/editors/browser/BrowserView.ts:67`, `:292`); tab data lives in `BrowserEditorModel.ts:130`. The toolbar and its positionally updated controls live in `BrowserView.ts:509`, `:615`.
- The webview registers its composite editor/tab key and webContents ID on `dom-ready` (`BrowserView.ts:134`); `src/main/browser-service.ts:324` resolves the ID and tracks listeners, replacing the registration on every `dom-ready`. Browser IPC channels live in `src/ipc/browser-ipc.ts:15`; the guarded, sender-checked request pattern is at `browser-service.ts:905`. Prefer main-process `webContents` zoom via `guardedIpcHandle`, with ownership and value validation, so guest input and zoom share a lifecycle. Renderer [`webview.setZoomFactor`](https://github.com/electron/electron/blob/v43.0.0/docs/api/webview-tag.md#setzoomfactorfactor) exists but does not solve shared-origin zoom.
- **Prerequisite:** US-1756 (Upgrade to Castlabs Electron 44, completed 2026-11-03; see `doc/tasks/completed.md`) targets Castlabs `v44.9.3+wvcus`. `package.json:53` currently pins Castlabs Electron 43.0.0. [Electron 43 webContents](https://github.com/electron/electron/blob/v43.0.0/docs/api/web-contents.md#contentssetzoomlevellevel) documents same-origin zoom propagation and does not expose `setZoomMode`. [Current Electron documentation](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoommodemode) marks `setZoomMode('isolated')` as added in Electron 44; it isolates a webContents and persists across navigation. Reapplying after navigation cannot guarantee isolation: the write itself can affect other same-origin guests. Electron 43's documentation does not establish whether origin zoom survives restart; test it rather than assume.
- User-provided live measurement on Electron 43: two guests in `persist:browser-default` at `example.com/?a=1` and `example.com/?b=2` both reported factor 1.5 after `webview.setZoomFactor(1.5)` on one. Navigating the first to `example.com/?c=3` retained 1.5. Same-origin sharing is confirmed in this build.
- `getPartitionString()` uses a shared persistent profile partition and unique non-persistent incognito and Tor partitions (`BrowserEditorModel.ts:350`); internal tabs in an editor use that same partition (`BrowserView.ts:91`, `:292`; `BrowserTorModel.ts:28`). Same-origin sharing can therefore affect tabs in the same profile, including across editors, and tabs within a private editor. Per-tab partitions would change shared cookies/session and Tor routing, so are not a suitable zoom fix.
- Use a per-internal-tab factor, following that tab across navigation, default 100%, and surviving normal tab restoration. `BrowserEditor.getRestoreData()` spreads tabs (`BrowserEditor.ts:375`), and `applyRestoreData()` regenerates IDs (`:409`); restored Tor editors intentionally replace tabs (`:448`). Validate old or invalid zoom values and default them to 100%; preserve existing private/Tor restore rules.
- Host keyboard zoom targets the window webContents (`src/main/open-window.ts:201`); host wheel zoom goes through `src/renderer/api/internal/GlobalEventService.ts:91`, `:202`, and `src/ipc/main/core-handlers.ts:213`. The host reset indicator is `src/renderer/ui/app/MainPageView.ts:268`. The guest keyboard listener handles reload, devtools and history, but not zoom (`browser-service.ts:538`). Electron describes the guest's separate input routing in its [webview internals](https://github.com/electron/electron/blob/v43.0.0/docs/api/webview-tag.md#internal-implementation). Existing guest Ctrl+wheel and Ctrl+=/- behavior, including page handlers and Chromium defaults, has not been measured; do not assume it does nothing. Electron's [`zoom-changed` event](https://github.com/electron/electron/blob/v43.0.0/docs/api/web-contents.md#event-zoom-changed) reports mouse-wheel requests, not all zoom changes.
- User-provided live measurement on Electron 43: with both guests at 1.5, host renderer `webFrame.setZoomLevel(1)` changed both to 1.2; `setZoomLevel(0)` changed both to 1.0. The embedder zoom sync overwrites guest zoom. Define effective guest factor as **window factor × tab factor**; display and persist only the tab factor. Reapply every guest's effective factor after each host zoom change. Verify whether isolated mode still receives embedder sync on the shipped Electron 44 fork.
- Reuse `ButtonView` and `PopoverView` (`BrowserView.ts:551`, `:896`). `src/renderer/uikit/Slider/SliderView.ts:5` is a native range input without orientation support and its progress runs horizontally (`:67`); extend this reusable primitive for vertical orientation and add a story. Follow `src/renderer/uikit/CLAUDE.md`, especially popover `contentView` ownership and portal styling.
- Localize accessible labels and tooltips in `src/shared/i18n/en/browser.ts` and locale catalogs under `doc/standards/localization.md`. The existing `BrowserEditorFacade` (`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:190`) and MCP/automation APIs need no zoom additions for this task; give the controls stable names under the UI element contract. This is not a board-facing API change; `src/shared/board-bridge-version.ts:2` does not need a bump (board-facing scope: `doc/epics/EPIC-115.md:57`).

## Implementation Plan

**US-1756 is complete: Persephone runs on Castlabs Electron 44.9.3.**

- [ ] First verify that the shipped Castlabs fork exposes and honors `setZoomMode('isolated')`, including same-origin guests and host embedder zoom synchronization. Set isolated mode on each guest before any zoom write, early enough to prevent shared-origin effects on initial navigation. Registration on `dom-ready` may be too late: investigate the guest creation hook in `src/main/open-window.ts` and `src/main/browser-service.ts`. Avoid duplicate listeners and verify isolation across reload and cross-origin navigation in the shipped runtime.
- [ ] Add `zoomPercent` to `BrowserTabData` in `src/renderer/editors/browser/BrowserEditorModel.ts`; initialize every tab creation path, including `BrowserTabsModel.ts:117`, `:287` and `BrowserEditor.ts:455`, to 100. Normalize restored values in `BrowserEditor.applyRestoreData` to finite values within 50–200; `getRestoreData` already spreads tabs. Preserve existing Tor reset behavior.
- [ ] Add typed set-zoom and tab-keyed guest input messages to `src/ipc/browser-ipc.ts`. In `src/main/browser-service.ts`, use `guardedIpcHandle`, resolve the registered key, verify the requesting sender owns it as at `:905`, reject destroyed guests and invalid values, then call `wc.setZoomFactor(windowFactor * percent / 100)` after isolation is established. Handle registration races and stale responses after tab closure, navigation, or switching. Keep one authoritative relative value per tab.
- [ ] Reapply the effective factor to **all** registered guests belonging to the affected host window after every host zoom change, including keyboard, wheel and reset. Coordinate `eZoomChanged` (`src/main/open-window.ts:201`, `src/ipc/main/core-handlers.ts:213`) or a main-side common path with the embedder sync; order reapplication after the sync and handle rapid changes and guest teardown. Verify behavior on Electron 44, including whether isolated mode still receives the sync. The toolbar remains the tab factor, not the product.
- [ ] Wire the active tab and guest lifecycle in `BrowserView.ts` and `BrowserWebviewModel.ts`; apply the saved value after guest creation and reconcile after navigation if runtime testing shows it necessary. Do not update navigation target `state.url` in response to observed navigation (`BrowserWebviewModel.ts:406`).
- [ ] Use tracked guest listeners in `browser-service.ts:338`, `:538` for Ctrl+=/+, Ctrl+-, Ctrl+0 and the guest wheel zoom request. Route tab-keyed intents through the same bounded update as the control: 5% steps, 50–200%, reset 100%. Prevent duplicate default behavior where supported; test wheel cancellation and page handlers in Electron before shipping. Host-focused shortcuts remain window zoom.
- [ ] Extend `src/renderer/uikit/Slider/SliderView.ts`, `Slider.css`, and `Slider.story.ts` with vertical orientation, high value at top, correct progress direction, focus, ARIA and native arrow/Home/End keyboard behavior. Add a named percentage `ButtonView` and anchored `PopoverView` in `BrowserView.ts` and `BrowserView.css`; add the slider and five named preset buttons. Keep the open popover synchronized on tab/value changes and support outside-click/Escape dismissal. Preserve positional toolbar control indices. Add localized labels.
- [ ] Manually verify two same-origin tabs in a profile at different zooms, multiple editor windows and profiles, incognito and Tor, cross-origin navigation, reload, restart/old state, guest recreation, page versus toolbar focus, guest shortcuts and wheel, slider keyboard, presets, popover dismissal and host zoom changes with distinct tab factors. Check actual rendering, not only the label. Update guides and architecture during the project's completion workflow.

Illustrative state change (not the isolation implementation):

```ts
// Before
interface BrowserTabData { id: string; /* existing fields */ }
// After
interface BrowserTabData { id: string; zoomPercent: number; /* existing fields */ }
```

## Concerns / Open Questions

**Recorded decision:** the user approved the Electron 44 route as the separate US-1756 prerequisite, targeting Castlabs `v44.9.3+wvcus`. Isolated mode is needed because Electron 43 shares zoom by origin and navigation reapplication alone cannot provide per-tab semantics. Verify the fork's isolated mode and host sync behavior before building on them. Current guest shortcut behavior and origin zoom disk persistence also require live verification.

## Acceptance Criteria

- [ ] The toolbar displays the active internal tab's zoom; the accessible popover offers a vertical slider and all five presets.
- [ ] Same-origin tabs sharing a partition retain independent relative zoom across navigation and reload. Window zoom still scales pages; changing or resetting it preserves each tab's relative factor, verified in the shipped runtime.
- [ ] Restored normal tabs retain their own zoom; old/invalid state defaults safely to 100%; existing private/Tor restore behavior remains intact.
- [ ] Guest Ctrl+wheel, Ctrl+=/+, Ctrl+- and Ctrl+0 update the same tab value exactly once; host-focused shortcuts retain window zoom.
- [ ] UI is localized and keyboard accessible; no board bridge or script facade change.

## Files Changed Summary

| File | Planned change |
| --- | --- |
| `src/main/browser-service.ts`, `src/main/open-window.ts`, `src/ipc/browser-ipc.ts` | Guest isolation, validated commands and input routing |
| `src/ipc/main/core-handlers.ts` or equivalent common host zoom path | Coordinate effective guest zoom reapplication after host zoom changes |
| `src/renderer/editors/browser/BrowserEditorModel.ts`, `BrowserTabsModel.ts`, `BrowserEditor.ts`, `BrowserWebviewModel.ts`, `BrowserView.ts`, `BrowserView.css` | Tab state, restore, lifecycle and toolbar |
| `src/renderer/uikit/Slider/SliderView.ts`, `Slider.css`, `Slider.story.ts` | Reusable vertical slider |
| `src/shared/i18n/en/browser.ts`, locale catalogs | Accessible localized labels |
| Completion documentation | User/developer documentation |
| `src/renderer/ui/app/MainPageView.ts`, `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `src/shared/board-bridge-version.ts` | **No changes:** host indicator, facade and board bridge remain separate |
