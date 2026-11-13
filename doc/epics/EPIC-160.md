# EPIC-160: Refactoring Phase 6.1 part 3 — browser main process: `BrowserGuest`, host fullscreen, DOM snapshot and `CdpTarget`

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the twentieth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the last of three for roadmap
item 6.1 (Browser). Parts 1 and 2 ([EPIC-158](EPIC-158.md), [EPIC-159](EPIC-159.md)) refactored the renderer side. This
epic is **6.1 part 3**, the main-process side: finding MAIN-7 in `doc/reviews/refactoring-2026-11/01-main.md`. It also
takes the one renderer step EPIC-159 deferred, BRW-4 step 4 (state slices), so that 6.1 closes completely.

The code was checked on 2026-11-13, after EPIC-159. Line numbers in the report have drifted; the current state:

- `src/main/browser-service.ts` is 1,233 lines. `registerWebview` (about `:528-884`, ~356 lines) is one closure that
  wires every guest listener: event relay, the navigation-scheme policy, the unload-guard native dialog, HTML
  fullscreen, mouse-press tracking, keyboard shortcuts, voice-typing forwarding, popup policy and rate limiting. Guest
  state is a `RegisteredWebview` record in a module `registrations` map; other modules reach it through
  `getBrowserServiceRegistration(s)`, `isRegisteredBrowserWebContents` and `browser-service-composition.ts`.
- Host-window fullscreen state is four module `WeakMap`s (`hostFullscreenIntent`, `hostFullscreenRevision`,
  `guestTransitionUntil`, `postFullscreenMaximize`) exported to `window-display-service.ts`; `open-window.ts` imports
  `watchHostFullscreen` and `reapplyBrowserGuestZoom` from `browser-service.ts`, which imports `open-windows.ts`, which
  imports `open-window.ts` — the cycle MAIN-7 names.
- The cheerio DOM collection (`collectLoadedResources`, `collectDom`, `injectIframeContent`, `urlsMatch`, about
  `:918-1076`) sits in the same file.
- `src/main/cdp-service.ts` is 1,148 lines with about twenty module-level maps (`attachedDebuggers`,
  `cdpEventDispatchers`, `enabledDomains`, `enablingDomains`, `aiVisionBindingStates`, `pageEventStates`,
  `targetStateKeys`, `navigationWaits`, `networkCollectors`, `responseWaits`, `dragIntercepts`, `ownedFrameSessions`, …)
  and dispatches app-window, board and browser targets in one send handler. EPIC-156 already gave it a
  `startCdpService(dependencies)` entry and IPC contracts in `src/ipc/main/cdp-handlers.ts`; the board frame registry
  already lives in `src/main/board-host/BoardFrameRegistry.ts` (MAIN-2 is done).

## Goals

- **`browser-dom-snapshot.ts`** holds the DOM and loaded-resource collection; `browser-service.ts` only delegates.
- **`BrowserGuest`** (one per registration) owns its listeners, its per-guest state (`pressed`, last user activation,
  HTML fullscreen, unload-guard bypass, zoom) and `dispose()`. The navigation-scheme policy, popup policy and shortcut
  handling are small named methods or strategy functions. **`BrowserGuestRegistry`** (key → guest) is the one lookup;
  CDP, the network logger, downloads and the composition module receive it (or a narrow lookup function) instead of the
  module map.
- **`HostFullscreenController`**, one per `BrowserWindow`, owned by `OpenWindow`; it replaces the four `WeakMap`s.
  `open-window.ts` no longer imports `browser-service.ts`, so the `open-windows` → `open-window` → `browser-service` →
  `open-windows` cycle is gone.
- **`CdpTarget`** (one per `WebContents`): debugger attach, enabled/enabling domains and the event dispatcher. Feature
  modules (`cdp-page-events`, `cdp-waits`, `cdp-network-collector`, `cdp-drag-intercept`, and the AI-vision binding)
  take a `CdpTarget`. `cdp-service.ts` keeps the service surface, and the send path resolves its target through one
  `resolveTarget(key, sender)`.
- **State slices (BRW-4 step 4).** URL-bar, find and prompt state live in their own `TComponentState` slices owned by
  `BrowserUrlBarModel` (or the existing URL-bar owner), `BrowserFindModel` and the prompt owners; views bind only the
  slice they render.

## Decisions this epic acts on

- **Scope.** All of MAIN-7 plus BRW-4 step 4, in six tasks. That closes roadmap item 6.1. Splitting
  `cdp-service.ts` into `CdpTarget` and its feature modules is two tasks (the class first, then the module split) so
  that the subtle automation state is changed in one place at a time.
- **Pure move first.** US-1910 moves the DOM snapshot code without changing it.
- **Order.** DOM snapshot move (US-1910) → `BrowserGuest` + registry (US-1911, the core of the browser file) → host
  fullscreen controller and the cycle break (US-1912, uses the guest's fullscreen state) → `CdpTarget` + `resolveTarget`
  (US-1913) → CDP feature modules (US-1914) → renderer state slices (US-1915, independent of the main-side work).
- **Re-registration keeps CDP state.** `unregisterWebview(key, { keepCdpState })` and the re-registration path must keep
  today's semantics exactly (report risk note). The `BrowserGuest` plan must show the re-registration sequence before
  and after.
- **No new protocol code** (guardrail 1). The IPC endpoints stay the EPIC-156 contracts in `src/ipc/contracts/` bound in
  `src/ipc/main/browser-handlers.ts` and `cdp-handlers.ts`; renderer events still go through `sendRendererEvent`. No
  new channel, correlator or ack is added. Collaborators are injected through the existing `startCdpService`/
  `initializeBrowserService` dependency points, not new setter globals.
- **`window.persephone` is not touched**, so no `BOARD_BRIDGE_VERSION` bump. Board CDP routing changes only inside
  main, through `BoardFrameRegistry`.
- **No behaviour change** to: the `data-name` contract, the script facade, MCP `call` behaviour and browser automation
  results (`editor.*` snapshot/click/wait/network/dialog/drag), AiVision paths and messages, persisted browser state,
  popup and navigation policy, the unload-guard dialog, HTML fullscreen and the post-fullscreen maximize, voice-typing
  forwarding, keyboard shortcuts, zoom, downloads and permission prompts. Any change a plan finds necessary is named in
  the plan and in the notes.
- **Owners.** `BrowserGuest`/`BrowserGuestRegistry` in `src/main/browser/` (new folder) or next to `browser-service.ts`
  — the plan picks one and says why; `HostFullscreenController` next to `open-window.ts` (window layer owns it);
  `CdpTarget` and the feature modules in `src/main/cdp/`.
- **Imports.** No `await import()` to dodge a cycle (guardrail 5); the cycle is broken by direction (window layer owns
  the host controller; the browser layer reaches it through the window it already has).
- **God files only shrink** (guardrail 3): `browser-service.ts` (1,233), `cdp-service.ts` (1,148), `open-window.ts`
  (634), `open-windows.ts` (440) must not grow across the epic; the renderer files touched by US-1915 must not grow
  beyond the slice wiring.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1910 | Move DOM and resource collection to `browser-dom-snapshot.ts` (pure move) | Done |
| US-1911 | `BrowserGuest` and `BrowserGuestRegistry` | Done |
| US-1912 | `HostFullscreenController` owned by `OpenWindow`; break the window/browser cycle | Done |
| US-1913 | `CdpTarget` and one `resolveTarget` | Done |
| US-1914 | CDP feature modules take a `CdpTarget` | Done |
| US-1915 | URL-bar, find and prompt state slices (BRW-4 step 4) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. List line counts before/after for the god
  files above. Every exported symbol that moves: list its importers and update them.
- **US-1910.** Moves and import rewrites only. Verify by comparing the moved function bodies line for line.
- **US-1911.** List every listener `registerWebview` attaches and where it lands (guest method, strategy function).
  List every reader of `registrations`/`getBrowserServiceRegistration(s)`/`isRegisteredBrowserWebContents` and what it
  uses after. Show the dispose order matches today's unregister order, and the re-registration (`keepCdpState`) path.
- **US-1912.** List the four `WeakMap`s and every reader/writer (including `window-display-service.ts` and
  `core`/window handlers). Show how the guest fullscreen enter/exit/restore reaches the host controller after, and the
  import graph proving the cycle is gone. `reapplyBrowserGuestZoom` must leave `open-window.ts` too (or be reached
  without importing `browser-service.ts`).
- **US-1913.** List every per-`WebContents` map and what moves into `CdpTarget`; who creates and disposes a target
  (debugger detach, `destroyed`, `clearCdpTargetState`). Show the three send routes (app window, board, browser) before
  and after `resolveTarget`.
- **US-1914.** One module per feature; each keeps its own state keyed as today. `cdp-service.ts` keeps the exported
  surface used by `cdp-handlers.ts`, `main-services.ts` and `BoardHostService.ts`.
- **US-1915.** List every field of the browser editor state the URL bar, find bar and prompt bars read today, which
  slice owns it after, and which view subscribes to which slice. Facade and MCP readers of those fields keep working.

## Remainder

Nothing of roadmap item 6.1 remains after this epic.

## Out of scope

- Automation and facades (6.2), the AiVision folder (BRW-13), the `browser-editor.md` rewrite (BRW-14) beyond what
  `/document` updates.
- `browser-network-service.ts`, `network-logger.ts` internals beyond taking the registry lookup.
- Any change to `window.persephone`, MCP `call` behaviour, persisted browser page descriptors or the `data-name`
  contract.
- US-1873 (board docs) stays in Planned until the refactoring work is done.

## Notes

### 2026-11-13
- Epic created after EPIC-159. Current state re-checked against the code (see Overview). BRW-4 step 4 taken in as
  US-1915 so that 6.1 closes in this epic. Arrow mojibake left in `EPIC-159.md` and `browser-editor.md` by the previous
  run was fixed while setting up.
- US-1915 (renderer, independent of the main-side work) was implemented early, in parallel with the main-side plans.
  The live check found the browser editor crashing on mount: `BrowserEditorView` passed the unbound `syncFind` method
  to `bind()`. Fixed by binding through an arrow; the find bar and URL-bar slice then rendered correctly.
- US-1913: an explicit browser `cdpDetach` now runs the same target cleanup as a debugger-initiated detach (enabled-domain
  cache, subscriptions, the AI-vision context handler). Before, an explicit detach left the enabled-domain cache and the
  context handler in place, so a later re-attach skipped `Page.enable`/`Runtime.enable` and stacked a second handler.
  `resolveTarget` takes a `"browser-only"` scope for `waitForURL`, which never routed app or board keys.

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; plans by Codex (Luna, the policy pick while the weekly
  window was tight), reviewed against the source and the roadmap guardrails; Codex Luna implemented. Typecheck, lint and
  build-prod passed after each task, and the app was checked through the MCP HTTP endpoint after each task. After US-1914
  a cold `npm start` ran the browser flows: example.com loaded with title (guest registration and typed guest messages),
  a CDP accessibility snapshot, `evaluate` plus `consoleMessages` (page events), `navigateAndWait` to example.org,
  `networkRequests` (network collector), a CDP click on a link with a `waitForURL` armed before it (navigation wait),
  `back`, `dialogs`; closing the page left no webview and no network-log key in main (guest disposed with its cleanup).
  The find bar and URL-bar slice were exercised after US-1915. HTML-video fullscreen, display moves, popups, the unload
  dialog, downloads and board CDP routing were not exercised live.
- **Sizes (wc -l), epic start → end.** `browser-service.ts` 1,233 → 318; `cdp-service.ts` 1,148 → 280; `open-window.ts`
  634 → 637 (controller wiring); `open-windows.ts` 440 → 440; `BrowserEditor.ts` 536 → 520; `BrowserEditorView.ts`
  217 → 221 (slice bindings); `BrowserToolbarView.ts` 354 → 352; `BrowserWebviewModel.ts` 363 → 357;
  `BrowserEditorFacade.ts` 835 → 835. New files: `browser-dom-snapshot.ts` (162), `browser/BrowserGuest.ts` (393),
  `browser/BrowserGuestRegistry.ts` (74), `browser/navigation-scheme-policy.ts` (17), `browser/popup-policy.ts` (99),
  `host-fullscreen-controller.ts` (85), `cdp/CdpTarget.ts` (166), `cdp/cdp-page-events.ts` (270), `cdp/cdp-waits.ts`
  (334), `cdp/cdp-network-collector.ts` (154), `cdp/cdp-drag-intercept.ts` (37), `cdp/cdp-ai-vision-binding.ts` (104),
  `BrowserPromptsModel.ts` (61).
- **Decision refinements (plan review).**
  - US-1911: `browserGuests` is a module instance (the `boardFrameRegistry` pattern) imported by browser-service,
    the composition module and downloads; CDP and the network logger keep narrow injected lookups. Nothing under
    `src/main/browser/` imports a main service: host fullscreen, voice-typing forwarding and the permission/network/CDP
    cleanup reach `BrowserGuest` as injected hooks. Dispose order is today's unregister order.
  - US-1912: `OpenWindow` constructs `HostFullscreenController(window, browserGuests)`; the controller reads guests
    through the service-free registry. A window without an `OpenWindow` makes the controller calls no-ops (no new error).
    `open-window.ts` no longer imports `browser-service.ts`, so the `open-windows` → `open-window` → `browser-service`
    → `open-windows` cycle is gone.
  - US-1913: one `attachTarget(wc)` wrapper installs the AI-vision context handler and the detach cleanup on a fresh
    attach; the target lives for the WebContents' lifetime; no `destroyed` listener was added. `resolveTarget` covers
    attach, detach, send, page events and response waits.
  - US-1914: features receive an `attach` function and the resolved route from the service and never import it; drag
    intercepts keep no detach cleanup (as before). An out-of-scope change that made `cdp-network-response-bodies.ts`
    use a shared `isRecord` (which accepts arrays) was reverted at review.
  - US-1915: `searchEngineId`/`lastSearchQuery` stay in editor state (persisted); the URL-bar slice holds only transient
    entry state; prompts got their own `BrowserPromptsModel` (`editor.prompts`) instead of growing `BrowserWebviewModel`;
    the editor shell keeps a whole-state binding.
- **Review.** `/review` replaced one non-null assertion in `cdp-service.ts`; `/document` updated `browser-editor.md`,
  `folder-structure.md` and `key-files.md`; `/userdoc` needed no changes. No English catalog messages changed;
  `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour changes.** An explicit browser `cdpDetach` now runs the full target cleanup (see the US-1913
  note above). Otherwise none intended.
