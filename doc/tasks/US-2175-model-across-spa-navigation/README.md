# US-2175: Page model reachable across a same-document navigation

**Epic:** [EPIC-208: Input fidelity for web-app tests](../../epics/EPIC-208.md)  
**Status:** Planned  
**Proposal:** G2; [US-2138 feedback item 2](../US-2138-web-app-test-feedback/README.md)

## Goal

Keep `pages[i].editor.app` and its `documentGeneration(tabId)` stable across a same-document SPA navigation when the page runtime and model survive, so a model method that itself calls `history.pushState` can return its value and convert model element refs. If a probe is actually required, resolving the `app` segment waits for its existing probe promise for a bounded interval before retaining the current unavailable-app error. Cross-document navigation continues to invalidate the old model, probe the new document, and report `page-navigated` for an in-flight method call.

## Background

### Verified cause and current lifecycle

- `src/renderer/editors/browser/BrowserPageRemote.ts` owns each page model registration in `registrations`, keyed by internal browser tab id. `clear()` increments the generation and deletes the registration. `probe()` inspects `AI_VISION_PAGE_GLOBAL` and `WEBMCP_REMOTE_PAGE_GLOBAL`, then registers a composed shape with `set()`.
- The event owner is `src/renderer/editors/browser/BrowserWebviewModel.ts`. A cross-document `did-navigate` calls `pageRemote.onNavigation()`, which clears the model, then `siteExtensions.onNavigation()` advances the extension document identity. A `did-navigate-in-page` only updates navigation state and calls `pageRemote.onInPageNavigation()`; it does not clear the registration.
- The gap is caused by `did-start-loading`: `BrowserWebviewModel.handleBrowserEvent()` unconditionally calls `pageRemote.onLoadStart()`. That method records whether the model was live and immediately calls `clear()`, which increments `documentGeneration(tabId)` and deletes the registration. `did-stop-loading` calls `onLoadStop()`, which starts `probe()`. The adjacent source comment says `did-start-loading` also fires for same-document loads and the injected script keeps running. The remote model and generation are therefore invalidated before re-probing even though the document/runtime survives. A model method that returns element refs then fails `convertSiteModelRefs()`'s current-generation check with `"The page navigated while converting model element refs."`
- Registration absence becomes facade member absence: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, getter `aiVision`, adds `app` only when `pageRemote.getRegistration()` returns a registration. `EditorFacadeBase` assembles the descriptor from those members, so reads during the gap fail with `"app" is not a member of BrowserEditor` before reaching the remote request path.
- Re-probing is currently deduplicated by `probedGenerations`, not a stored in-flight promise. `probeForSiteExtensionReload()` returns `probe(tabId)`, while `onLoadStop()` fires it without awaiting. `probe()` marks the generation before awaiting CDP attach/readiness/evaluation. If needed, bounded waiting must reuse an owner-held in-flight promise rather than start a second probe or add a correlator.
- The existing `ai-vision` resolver supports the bounded wait without a new RPC: `node_modules/ai-vision/package/dist/core/resolver.js` awaits each resolved value. `provide(name)` itself is synchronous, but its `{ value }` may be a promise because the resolver awaits that value. Use this path only for the exact `name === "app"` branch: it lets the facade return the existing proxy after a bounded wait without making `children()` wait during arbitrary unknown-member checks or children listings. On timeout/no model, reject with the existing `"app" is not a member of BrowserEditor` message.
- Live dev-app evidence from Claude: with a temporary extension whose `navigate(path)` calls `history.pushState` and dispatches `popstate`, `pages[id].editor.app.navigate("/b")` failed with `The page navigated while converting model element refs.` A subsequent immediate `app.route` read returned `/b`, confirming the runtime and model survived while `documentGeneration` was incorrectly advanced by `onLoadStart()`.

### Runner behavior

- `src/test-host/poll.ts` is the shared loop for `ctx.waitFor` and `ctx.expect.poll`: non-matching values retry, while read errors retry only when `retryReadError` says so.
- `src/test-host/poll-expect.ts` configures `expect.poll` to retry every read error except `EnvironmentStopError`. A missing `app` unknown-member error is retried, matching the EPIC-205 behavior referenced by this proposal.
- `ctx.waitFor` in `src/test-host/context-operations.ts` uses the same poll loop without a `retryReadError` callback, so a missing `app` read error currently fails immediately. This is not the renderer-side cause; no runner change is planned.

### Site-extension identity

`BrowserSiteExtensionController.onNavigationStarted()` clears extension state only for a main-frame navigation where `isSameDocument` is false. `onNavigation()` clears the extension registration, forgets temporary state, and advances its document id on committed cross-document navigation. `SiteExtensionInjection.createExpression()` installs `window.__persephoneSiteRuntime` into the current `window`; teardown deletes that runtime. Same-document navigation does not call teardown or advance the document id, so the same window/runtime survives. This supports preserving the page model registration across same-document navigation.

## Implementation Plan

1. **Do not invalidate on load start.** `src/renderer/editors/browser/BrowserPageRemote.ts` owns model/document identity. `onLoadStart()` should continue recording `liveModelAtLoadStart`, but must not call `clear()` or delete the pending shape comparison. A load start is not proof that the document changed: it can precede a same-document SPA navigation or a navigation that is canceled, in which case the current document/runtime remains the right model to address. The existing committed cross-document `did-navigate` path calls `onNavigation()` and remains the navigation invalidation point; tab release, privacy changes, and explicit extension/model lifecycle operations retain their own clears. Same-document navigation does not call `onNavigation()`, so it must not change `documentGeneration(tabId)` at all. Do not reinject a site extension: its runtime is document-scoped and the extension controller already preserves it.

   Before:

   ```ts
   onLoadStart(tabId: string): void {
       this.liveModelAtLoadStart.set(tabId, !!this.getRegistration(tabId));
       this.clear(tabId);
       this.pendingShapeComparisons.delete(tabId);
   }
   ```

   After:

   ```ts
   onLoadStart(tabId: string): void {
       this.liveModelAtLoadStart.set(tabId, !!this.getRegistration(tabId));
   }
   ```

   This is order-independent: `did-start-navigation` and `did-start-loading` ordering no longer decides model identity. On a canceled navigation the old registration and generation remain; on a committed cross-document navigation the existing `did-navigate` → `onNavigation()` → `clear()` path invalidates them.

2. **Bound only app resolution during a real probe.** `src/renderer/editors/browser/BrowserPageRemote.ts` owns probe state and the fallback. Store the promise for the active probe under its `tabId:generation` key; clear that entry in `finally`. Add `waitForRegistration(tabId)` there: return the current registration immediately if present; if the current generation has no in-flight probe, return `undefined` immediately without creating a timeout; only when that generation has an in-flight probe, use the existing `withTimeout()` helper from `src/renderer/core/utils/utils.ts` with `PAGE_MODEL_PROBE_WAIT_MS = 250`, then return the current registration if it is now present. Keep the constant in the single commented tuning-constants block in `BrowserPageRemote.ts`.

   `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` owns the app-segment provider. Keep `APP_MEMBER` in the descriptor so the resolver reaches `provide("app")`; that provider returns a promise from `waitForRegistration()` only for `name === "app"`, then resolves to the existing shaped proxy. If no registration is found, reject with the current not-a-member message. Other members, unknown-member checks, and children/hints listings do not wait.

   Before:

   ```ts
   const registration = this.model.pageRemote.getRegistration();
   const app = registration ? this.getAiVisionProxy(registration) : undefined;
   // APP_MEMBER and provide("app") are added only when app is already present.
   ```

   After (shape sketch; preserve the existing `APP_MEMBER` proxy/provider and advertise the child only after the wait):

   ```ts
   provide: name => name === "app"
       ? { value: this.model.pageRemote.waitForRegistration().then(registration => {
           if (!registration) throw new Error('"app" is not a member of BrowserEditor');
           return this.getAiVisionProxy(registration);
       }) }
       : existingProvider(name)
   ```

   The resolver awaits the provided promise for the `app` path only. No new bridge transport, IPC channel, request id, acknowledgement, or error envelope.

3. **Preserve cross-document semantics.** On committed cross-document `did-navigate`, `BrowserPageRemote.onNavigation()` continues clearing the old registration and invalidating its generation; the new document is probed through the existing `did-stop-loading`/`onLoadStop()` path. Do not redirect an old proxy to a new document. Keep `BrowserPageRemote.request()`'s automation-context-loss behavior: an in-flight invocation without navigation allowance returns code `page-navigated` and the existing message; an allowed navigation returns `{ navigated: true }`.

4. **No runner implementation.** Leave `src/test-host/poll.ts`, `src/test-host/poll-expect.ts`, and `src/test-host/context-operations.ts` unchanged. Their behavior is verified above; the renderer is the root cause. The retained-registration path handles normal same-document navigation, and bounded waiting handles genuine re-probes.

### Ownership and guardrails

- Navigation identity and model registration belong to `src/renderer/editors/browser/BrowserPageRemote.ts`; reuse `documentGeneration()`, `clear()`, `probe()`, and existing `BrowserWebviewModel` event data instead of adding a parallel navigation protocol.
- Navigation event handling stays in `src/renderer/editors/browser/BrowserWebviewModel.ts`; no change is required because committed cross-document `did-navigate` already calls `BrowserPageRemote.onNavigation()`.
- Facade member resolution belongs to `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`; reuse `APP_MEMBER`, `pageRemote.getRegistration()`, the existing proxy factory, and the resolver's awaited provided value. No new cross-process protocol or board rule is planned; no roadmap §2.3 god file grows.
- **Bridge impact:** boards can observe the preserved reachability through `window.persephone.call()`. This task is **not** the first bridge change: [EPIC-208](../../epics/EPIC-208.md) assigns the sole `1.61.0` → `1.62.0` bump to US-2171, the first implementation task. This task only extends that `1.62.0` history line in `assets/guides/agents/boards/bridge-versions.md`; it must not bump `BOARD_BRIDGE_VERSION` again.
- `PAGE_MODEL_PROBE_WAIT_MS = 250` belongs in one commented tuning-constants block in `BrowserPageRemote.ts`; reuse `withTimeout()` from `src/renderer/core/utils/utils.ts`. `waitForRegistration()` is called only by the provider for the `app` segment; it returns immediately if a registration exists or no current-generation probe is active, and waits at most 250 ms only for an active current-generation probe. Other member resolution and hints/children listing never wait.
- No `await import()`, import-zone wrapper/exception, unit test, or test harness. Optional UI integration coverage may be listed under `integration-test/tests/` for Claude to run.

## Concerns

- Git history shows `onLoadStart()` and `liveModelAtLoadStart` were introduced together in `568dde2e` (EPIC-158). The original `BrowserWebviewModel` comment says Chromium emits `did-start-loading` before `did-navigate-in-page`, including same-document navigation, and explains that the map remembers whether a model was live because the preceding clear removed the registration. It records no independent reason to clear at load start; committed cross-document `did-navigate` already calls `onNavigation()` and clears. Therefore this plan removes that clear instead of depending on event ordering. An aborted load leaves the prior document/runtime and registration intact.
- Cross-document in-flight calls must still resolve as `page-navigated` on context loss; verify the existing `request()` handling alongside the `did-navigate` commit invalidation, especially when a response contains page-model element refs.
- Explicit site-extension reload or a changed model shape can legitimately clear a live registration outside navigation. The bounded wait must also cover those real probe windows.
- `provide()` must remain synchronous as a provider, but its returned `value` may be a promise that the resolver awaits. Keep the promise path scoped to `app`; after the wait, return the current registration's proxy and retain generation/token validation for any subsequent request.
- Verify actual Electron event sequence and cancellation cases against the event producer. Retain a registration only while its same document is current; committed cross-document navigation must invalidate promptly.

## Acceptance Criteria

- A same-document SPA navigation (`history.pushState` and the runner's `popstate` path) does not remove `pages[i].editor.app`; `app.navigate(path)` followed by `app.state` 50 ms later does not fail with `"app" is not a member of BrowserEditor` while the page runtime remains alive.
- If a probe is genuinely in flight, an app read and calls through its returned model wait on the existing probe promise for no longer than the named bound, then preserve current behavior if it did not settle with a registration.
- A method whose own implementation performs `history.pushState` and returns a value succeeds; same-document navigation leaves `documentGeneration(tabId)` unchanged, so `request()` and `convertSiteModelRefs()` do not classify the call as navigation or emit the ref-conversion navigation error.
- A committed cross-document navigation removes the old model, probes the new document through the existing lifecycle, and never redirects an old registration's call into the new page. An in-flight method call retains the current `page-navigated` result.
- Temporary and saved site-extension runtimes remain attached across same-document navigation; extension teardown/reload behavior is unchanged.
- `expect.poll` continues retrying missing-member read errors; `ctx.waitFor` keeps its immediate read-error behavior. No runner change is required.
- `window.persephone.call()` observes the preserved reachability. US-2171 owns EPIC-208's one bridge bump; this task extends its `1.62.0` history entry and does not bump again.
- No new protocol code, board rules outside the shared board modules/registries, import-zone bypass, or roadmap §2.3 god-file growth is introduced.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/editors/browser/BrowserPageRemote.ts` | Preserve registration for same-document navigation; reuse in-flight probe promise and own bounded wait and tuning constant. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Publish `app` after bounded active-probe wait, preserving facade members and proxy path. |
| `doc/tasks/US-2175-model-across-spa-navigation/README.md` | This verified investigation and implementation brief. |
| `src/shared/board-bridge-version.ts` | **No change planned in this task:** US-2171 owns EPIC-208's single bump from `1.61.0` to `1.62.0`. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend US-2171's existing EPIC-208 `1.62.0` history line with this behavior; do not add another version line or bump. |
| `src/renderer/editors/browser/BrowserSiteExtensionController.ts` | **No change planned:** same-document preservation and cross-document cleanup are explicit. |
| `src/test-host/poll.ts`, `src/test-host/poll-expect.ts`, `src/test-host/context-operations.ts` | **No change planned:** current poll behavior is documented; runner is not root cause. |
| `src/renderer/scripting/api-wrapper/EditorFacadeBase.ts` | **No change planned:** the existing resolver awaits the promise returned as a provided value; the browser facade can supply it directly. |
