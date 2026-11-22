# US-2165: Init scripts at document start

## Goal

Let a browser-page test register a JavaScript source that runs in that page's main frame before page-authored scripts on every subsequent document load, and remove that registration by ID. Provide a main-process registry that F2, F6, and later page-environment tasks can reuse.

Choose a separate `editor.addInitScript(source)` / `editor.removeInitScript(id)` API. A raw init script is scoped to one browser tab's lifetime and should not inherit `attachTestExtension`'s exact-host matching, page-model runtime, current-document teardown, or future-tab behavior. Keep `attachTestExtension` focused on its existing host-scoped `site.app` model contract; F1 does not add `runAt` to that API.

## Background

### Existing CDP ownership and call path

- `src/main/cdp-service.ts` is the composition root. It resolves browser targets from a registration key, calls `attachTarget`, and composes feature modules. `cdp-waits.ts`, `cdp-network-collector.ts`, and `cdp-page-events.ts` each expose `clearKey(key)` plus `onTargetDetached(wc)`; the latter also releases subscriptions. `cdp-ai-vision-binding.ts` instead keys execution-context/binding state by `WebContents` in `WeakMap`s and exposes `onTargetAttached(wc)`, `onTargetDetached(wc)`, and `clearAiVisionBinding(wc)` (explicit CDP detach calls the last one). `clearCdpTargetState(key)` composes the per-key wait/network/page-event cleanup. `attachTarget(wc)` calls `CdpTarget.ensureAttached()` and registers target-detach callbacks for target-owned state.
- `src/main/cdp/CdpTarget.ts` keeps one `CdpTarget` per `WebContents` in a `WeakMap`. `ensureAttached()` starts a new attach generation and resets its detach callbacks. `handleDetach()` invokes those callbacks, clears subscriptions and enabled-domain caches, and leaves the `CdpTarget` object available for a later attach. Therefore a feature must discard CDP command identifiers on detach and re-register retained source when the target is attached again.
- The browser renderer calls through `src/renderer/automation/CdpSession.ts`, which uses the existing `BrowserChannel` invoke/reply path. `src/ipc/main/cdp-handlers.ts` dispatches into `cdpService`. Use typed `BrowserChannel` request arguments and the existing invoke error unwrapping; do not add a second request protocol, correlator, or error envelope.
- Browser CDP keys are per registered browser guest. `BrowserTargetModel.cdp(tabId)` gets a `CdpSession` for that tab's guest key. `BrowserGuest.dispose()` calls `clearCdpTargetState(key)` when the guest is released. `cdpService.cdpDetach()` also calls that function today, so implementation must split transient feature cleanup from retained init-script registration cleanup: explicit debugger detach invalidates CDP identifiers but keeps source registrations; guest close clears both. Profile/session keys are not appropriate registry keys.
- Electron's checked-in `node_modules/electron/electron.d.ts` documents debugger detach on `WebContents` close or when DevTools is invoked. The project also handles the debugger `detach` event. When DevTools detaches CDP, init scripts stop running until automation reattaches; the next automation call restores registrations before it runs. The source does not show detach on ordinary navigation. Browser guest tabs use a `WebContents` and per-tab registration key, so cross-origin top-level navigation remains associated with that key. Child OOPIF targets are separate targets and the existing network/page-event collectors explicitly discover/attach owned iframe targets when needed.

### Temporary extensions and page-model bridge

- `BrowserEditorFacade.attachTestExtension()` delegates to `BrowserSiteExtensionController.attachTemporary()`. `TemporarySiteExtensions.attach()` validates one exact HTTP(S) authority and stores source/params in a page-model-local map. `BrowserSiteExtensionController` applies matching rules to current/future tabs and injects the selected code from `injectSelectedExtension()` through `SiteExtensionInjection.createExpression()` and `evaluateInTarget()`.
- That injection occurs after the current document is ready: `BrowserWebviewModel` calls `siteExtensions.onDocumentReady()` from the webview load lifecycle, while `attachTemporary()` evaluates against already-ready current tabs. Detach runs extension teardown in the current document. The wrapper creates `window.__persephoneSiteRuntime`, calls the extension source, and reports synchronous extension failures through `console.error` plus an injection result. These are extension semantics, including the site runtime and `site.app` model; they are not a generic pre-page-script API.
- `BrowserPageRemote.onLoadStop()` calls `probe()` after the document load. `probe()` attaches the page binding and evaluates `AI_VISION_PROBE`; after injection, `probeAfterSiteExtensionInjection()` explicitly reprobes. A raw init script runs earlier and does not register a `site.app` model by itself. If an init script or the app exposes the site model before load completes, the normal post-load probe still discovers it.
- `BrowserEditorFacade` has its own `$help` descriptors in `BROWSER_EDITOR_MEMBERS` and `BROWSER_EDITOR_HELP`; public signatures live in `src/renderer/api/types/browser-editor.d.ts`. Browser-editor members are also reachable through the generic board `window.persephone.call()` call tree: the 1.59.0 history entry says browser-editor aliases are callable there, and 1.60.0 records locator reads exposed there. Therefore all three new members (`addInitScript`, `removeInitScript`, and `clearInitScripts`) are board-observable even though `BoardEditorFacade` does not compose `BROWSER_EDITOR_MEMBERS` directly.

### Errors, frames, boards, and test runner

- `cdp-page-events.ts` records `Runtime.exceptionThrown` as page errors after its page-event state is created and `Runtime` is enabled. An init script's uncaught errors can therefore use the existing `pageErrors()` collection if its listener is armed before the next navigation; the implementation should prepare that existing collector when registering the first init script, before any navigation can execute it.
- This task targets the top-level browser target's Page session. Let CDP evaluate source unchanged in the main frame and same-process child frames covered by that session; OOPIFs are not covered. Do not wrap the source, because a wrapper changes top-level `let`/`const`/function global semantics. A script can check `window === window.top` itself when it wants main-frame-only behavior.
- `src/test-host/context.ts`, `context-operations.ts`, and `browser-helpers.ts` expose `ctx.openBrowser(url, { profile, incognito, timeout })`; `browser-helpers.ts` returns a handle to `pages[pageId].editor` itself, not the containing page. `context-operations.ts` already tracks adopted pages in `state.sessionPages`, and `test-attempt.ts` / `test-file-run.ts` pass those IDs to `closePagesOpenedSince()`. Owned pages are closed, which clears their CDP registry; adopted session pages remain open and need explicit `clearInitScripts()` during cleanup.

## Implementation Plan

1. **Add the public browser-editor surface.** In `src/renderer/api/types/browser-editor.d.ts`, add `addInitScript(source: string, options?: { tabId?: string }): Promise<string>`, `removeInitScript(id: string, options?: { tabId?: string }): Promise<boolean>`, and `clearInitScripts(options?: { tabId?: string }): Promise<number>`. An ID is owned by the selected browser tab's registration key; `clearInitScripts` removes all registrations for the selected tab and returns the number removed. Registering affects future documents only; it does not execute in the already loaded document. Add all three typed members and their precise behavior to `BROWSER_EDITOR_MEMBERS`, the facade methods, and `BROWSER_EDITOR_HELP` in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`. Resolve/default `tabId` using the existing browser-target convention (`this.model.target.cdp(tabId)`); reject unknown/closed tabs through that target helper.

   Before:

   ```js
   await page.editor.attachTestExtension({ host: "app.example", source });
   // The extension is evaluated in the already-loaded matching document.
   ```

   After:

   ```js
   const id = await page.editor.addInitScript(source);
   // The source runs before page scripts on the next and every later document in this tab.
   await page.editor.removeInitScript(id);
   ```

   Temporary extension behavior remains unchanged.

2. **Own registrations in the new main-process feature module.** Create `src/main/cdp/cdp-init-scripts.ts` (Decision 1). It owns per-browser-registration source records, stable public IDs, CDP identifiers, duplicate/concurrent registration handling, and a per-`WebContents` association used to restore scripts after detach. Add a tuning-constants block with `MAX_INIT_SCRIPT_SOURCE_CHARS = 1_000_000` and `MAX_INIT_SCRIPTS_PER_TARGET = 50`; reject oversized source and over-limit registrations with clear errors before calling CDP. Reuse `CdpTarget.enableDomain("Page")`, `CdpTarget.subscribeCdpEvents()` only if needed, and the existing `CdpTarget` detach lifecycle; the registry must be keyed by the exact browser guest key, never by profile/session. Enable Page before registering with `Page.addScriptToEvaluateOnNewDocument` and retain the returned CDP identifier for `Page.removeScriptToEvaluateOnNewDocument`. Never log source text or include it in errors; F2 will pass storage values through this same registry.

3. **Compose lifecycle without adding rules to a god file.** Add only imports/composition in `src/main/cdp-service.ts`: typed service methods register/remove/clear using `resolveTarget(key, sender, "browser-only")`; split existing cleanup into transient target state and full key cleanup, so `clearCdpTargetState(key)` clears the init registry at guest close while explicit `cdpDetach` clears other transient state but preserves init sources. `attachTarget` notifies the module on a new attach generation, and browser `cdpAttach`/`cdpSend` paths await its registration restoration before returning. Opening DevTools detaches the debugger, so init scripts stop running until automation reattaches; the next automation call restores registrations before it runs that call. On debugger detach, invalidate CDP identifiers while retaining source registrations for a later attach. Board/app routing must reject these calls.

4. **Prepare existing page-error collection before execution.** In `src/main/cdp/cdp-page-events.ts`, expose a narrow preparation helper that reuses `pageEventsForTarget()` / `createPageEventState()` for a browser key and enables `Runtime`. Call it from the init-script registration path before installing the script. This makes uncaught init-source errors available through the existing browser `pageErrors()` member after navigation; do not invent a second page-error store or event channel.

5. **Reuse the existing browser IPC boundary.** Add typed `BrowserChannel` entries and payload/result types in `src/ipc/browser-ipc.ts`, handlers in `src/ipc/main/cdp-handlers.ts`, and `CdpSession` convenience methods in `src/renderer/automation/CdpSession.ts`. The handlers call the new `cdpService` methods, which compose `cdp-init-scripts.ts`. Reuse invoke/reply and the existing error unwrapping; add no `PendingRequests`, wire envelope, custom acknowledgment, or frame method map.

6. **Version the board-callable call tree.** Because `window.persephone.call()` reaches browser-editor members, update `src/shared/board-bridge-version.ts` from `1.60.0` to `1.61.0` and add a new top `Bridge 1.61.0` history paragraph to `assets/guides/agents/boards/bridge-versions.md`, documenting `addInitScript`, `removeInitScript`, and `clearInitScripts` as browser-editor calls available through `window.persephone.call()`. Later EPIC-207 tasks extend this same history entry without another version bump.

7. **Update implementation-facing guides when the feature is implemented.** Describe all three members, source/registration limits, next-document semantics, same-process frame scope, OOPIF exclusion, DevTools detach behavior, and example usage in `assets/guides/agents/browser-automation.md`, `assets/guides/agents/browser.md`, `assets/guides/agents/temporary-site-extensions.md`, and `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`. Explain that init scripts stop running while DevTools has detached CDP and the next automation call restores registrations before the call runs. Keep the temporary-extension guide explicit that `attachTestExtension` still injects after load and remains the host-scoped `site.app` mechanism. This F1 task document does not run `/userdoc`; EPIC-207 defers completion skills until epic close.

8. **Keep the runner change narrow and leave roadmap god files alone.** `src/test-host/browser-helpers.ts` is the only runner file changed, for the adopted-page cleanup in step 9. `BrowserWebviewModel.ts` must not grow; the browser facade delegates through `BrowserTargetModel`/`CdpSession`, and CDP state stays in the new main feature module.

9. **Clear init scripts from adopted session pages at test cleanup.** In `src/test-host/browser-helpers.ts`, update `closePagesOpenedSince()` to iterate the supplied `sessionPages` set before its page snapshot/cleanup work and call `pages[pageId].editor.clearInitScripts` for each adopted page. Treat the call as best-effort: log success/failure with the existing cleanup action logging shape and continue other cleanup on error. `context-operations.ts` already fills `state.sessionPages` in `usePage()`, and `test-attempt.ts` / `test-file-run.ts` already pass that set to this helper; no changes to those files are planned. Owned pages still close and clear their registry through page-close cleanup.

## Concerns

- CDP `Page.addScriptToEvaluateOnNewDocument` is a target/session registration. The registry must distinguish the stable public script ID from the CDP identifier, preserve script source across debugger detach, and clear all retained source on the browser guest's close/unregister. Explicit CDP detach drops the CDP-side registration; a future target reattach restores it before that attach call completes.
- The repository source and Electron type declarations show the debugger detach lifecycle but do not describe Chromium's internal main-frame process-swap behavior. Acceptance must exercise a same-tab cross-origin navigation and reload while the debugger remains attached, and detach/reattach through the existing CDP surface. The registry design does not depend on profile/session identity.
- Init-source errors are visible in `pageErrors()` only when the existing Runtime event collector is active before execution. Step 4 makes registration arm that collector before the next document can run the script.
- Scripts are arbitrary page code and run in the page's main world. The member is exposed only on the browser editor and follows its existing browser-page access model; this task does not add test-runner access checks or a board API.
- **Decision: do not add `runAt: "document-start"` to `attachTestExtension`.** The extension remains host-scoped and owns the `site.app` runtime/model lifecycle; raw init scripts use the separate registry and F2/F6 should build on it rather than reopening this API choice.
- Init scripts are observable through the board call tree, so this task performs the single EPIC-207 bridge bump to `1.61.0` and adds the `1.61.0` history entry; later epic tasks extend that paragraph.

## Acceptance Criteria

- `page.editor.addInitScript(source)` returns a stable, opaque ID; `removeInitScript(id)` removes that registration and reports whether it existed.
- A registered source runs before page-authored main-frame scripts on each subsequent navigation and reload in the same browser tab. It does not run in the current already-loaded document, a different browser tab, a board frame, or a user's unrelated page.
- A source can be removed; a removed source does not run on the next navigation.
- Registration rejects a source longer than 1,000,000 characters and rejects more than 50 registrations on one tab with clear errors; source text is never included in logs or errors.
- Multiple scripts execute in registration order, and separate browser guest keys in the same profile do not share registrations.
- Source runs unchanged in the main frame and same-process child frames covered by the target Page session. OOPIFs are not covered; callers can add their own `window === window.top` guard if they need main-frame-only behavior.
- Registrations survive same-tab reload and cross-origin top-level navigation. They are removed when the guest/tab closes. CDP detach invalidates CDP identifiers; a later attach restores still-registered scripts before the next automation call runs. While DevTools has detached CDP, scripts do not run.
- `clearInitScripts()` removes every registration on its selected tab and returns the count. `closePagesOpenedSince()` calls it best-effort for every `sessionPages` entry and records the cleanup result; pages opened by the run are closed, which clears their registrations.
- Uncaught init-script errors appear through the existing `pageErrors()` member after navigation.
- `BrowserPageRemote` continues its post-load `site.app` discovery; no raw init script is reported as a temporary site extension unless it explicitly exposes the page-model contract.
- `src/shared/board-bridge-version.ts` is `1.61.0` and the top `1.61.0` paragraph in `assets/guides/agents/boards/bridge-versions.md` records all three browser-editor calls reachable through `window.persephone.call()`.
- F1 does not change `ctx.openBrowser` options or `BrowserWebviewModel.ts`. Its only runner edit is `src/test-host/browser-helpers.ts`; it bumps `BOARD_BRIDGE_VERSION` to `1.61.0` because the new browser-editor members are reachable through `window.persephone.call()`.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2165-init-scripts/README.md` | This implementation brief. |
| `doc/epics/EPIC-207.md` | Link US-2165 in the Linked Tasks row. |
| `doc/active-work.md` | Link US-2165 in the existing EPIC-207 Active entry. |
| `src/main/cdp/cdp-init-scripts.ts` | New main-process CDP script registry and lifecycle owner. |
| `src/main/cdp-service.ts` | Compose init-script operations, detach/reattach, and per-key cleanup. |
| `src/main/cdp/cdp-page-events.ts` | Expose existing page-event preparation for init-script error capture. |
| `src/ipc/browser-ipc.ts` | Typed init-script invoke channels and payload/result types. |
| `src/ipc/main/cdp-handlers.ts` | Route typed requests to the CDP service. |
| `src/renderer/automation/CdpSession.ts` | Browser IPC convenience methods using the existing invoke/error path. |
| `src/renderer/api/types/browser-editor.d.ts` | Public browser editor signatures. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Facade methods, `$help` descriptors, and help text. |
| `src/shared/board-bridge-version.ts` | Bump `BOARD_BRIDGE_VERSION` from `1.60.0` to `1.61.0`. |
| `assets/guides/agents/boards/bridge-versions.md` | Add the top `1.61.0` bridge history paragraph; later EPIC-207 tasks extend it. |
| `src/test-host/browser-helpers.ts` | Clear init scripts best-effort for adopted session pages inside `closePagesOpenedSince()`, logging outcomes. |
| `assets/guides/agents/browser-automation.md` | Document browser editor init-script usage. |
| `assets/guides/agents/browser.md` | Add the browser init-script member to the browser guide surface. |
| `assets/guides/agents/temporary-site-extensions.md` | Clarify document-start scripts versus current post-load temporary extensions. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Show test use through the returned browser page editor handle. |
| `src/test-host/context-operations.ts`, `src/test-host/test-attempt.ts`, and `src/test-host/test-file-run.ts` | **No changes:** `usePage()` already records adopted IDs, and test/file cleanup already passes the session-page set to `closePagesOpenedSince()`. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | **No changes:** keep this roadmap §2.3 god file from growing. |
| `src/renderer/editors/browser/BrowserTargetModel.ts` and `BrowserPageRemote.ts` | **No changes:** the target adapter already returns the tab's CdpSession, and the existing page-model bridge continues probing after load. |
| `src/renderer/editors/browser/BrowserSiteExtensionController.ts` and `TemporarySiteExtensions.ts` | **No changes:** existing host-matched, after-load extension behavior remains as-is. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | **No changes:** browser-editor members already reach boards through the generic `window.persephone.call()` call tree; no special board facade rule is needed. |
