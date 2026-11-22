# US-2170: Fake clock

## Goal

Add a nested `site.clock` browser-editor facade that installs a page-side fake clock before the next document's application scripts run, can advance that clock while firing due timers, and can also install into the currently loaded document. Support the scheduled-run pilot with `install({ now? })`, navigation, `fastForward(ms)`, and an explicit `uninstall()` for current-document and runner cleanup.

## Background

### F6 and EPIC decisions

- [EPIC-207](../../epics/EPIC-207.md) implements F6 from [web-app-testing-review.md, section 3.F](../../reviews/web-app-testing-review.md): `clock.install({ now })` and `clock.fastForward(ms)`, built on F1. The pilot suite has a four-minute test waiting for a scheduled run.
- EPIC-207 Decision 1 puts renderer-facing API behavior in a browser-editor collaborator, not `BrowserWebviewModel.ts`; Decision 2 forbids a new protocol; Decision 3 explicitly makes F6 evaluate-equivalent and subject to the existing browser-page access rule, not the test-power predicate. Decision 8 already selected Bridge 1.61.0 for this epic: extend that history paragraph, do not bump again.
- [US-2165](../US-2165-init-scripts/README.md) owns the per-tab `Page.addScriptToEvaluateOnNewDocument` registration. `BrowserTargetModel.cdp(tabId)` returns the tab's existing `CdpSession`; `CdpSession.addInitScript(source)`, `removeInitScript(id)`, and `evaluate(expression)` use the current browser channel and CDP evaluate path.
- F1 source is registered unchanged and runs before page-authored scripts in the main frame and covered same-process child frames on future documents. OOPIFs are outside the target Page session. The registration is scoped to a browser tab and is removed by `clearInitScripts()`.

### Verified facade, access, cleanup, and import patterns

- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` owns the public browser-editor call tree, its `$help` descriptors, nested-node `provide` dispatch, and existing `requireAgentAccess()`. Its `storage` property delegates to the separate `BrowserStorageFacade` collaborator.
- `src/renderer/editors/browser/BrowserStorageFacade.ts` is the concrete nested `IAiVisible` namespace pattern: it supplies member descriptors, validates options, uses the browser model, and evaluates through `model.target.cdp().evaluate(...)`. The clock namespace should use the same pattern, with clock-specific behavior in its own collaborator rather than expanding the facade.
- **Facade instances are request-scoped.** `src/renderer/scripting/ai-vision/call.ts:aiCall()` creates a fresh `ScriptContext` for each MCP call; `src/renderer/scripting/api-wrapper/PageWrapper.ts:editor` calls `editorFacadeRegistry.create()` whenever the editor property is resolved; `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` constructs a new `BrowserStorageFacade` in its constructor. A `BrowserClock` instance field therefore cannot retain an init-script ID between `install()`, `fastForward()`, and `uninstall()` calls.
- `agentMayAccessBrowserPage()` is the normal page-access check; `agentMayUseBrowserTestPower()` is reserved for test powers such as storage-state capture. F6 follows `evaluate()` and does not use the test-power predicate.
- `src/test-host/browser-helpers.ts:closePagesOpenedSince()` already best-effort calls `pages[pageId].editor.clearInitScripts()` for every adopted session page. That clears registrations for future documents only; it does not restore globals or cancel fake timers in the page that is already loaded. Cleanup must call `pages[pageId].editor.clock.uninstall()` before `clearInitScripts()`.
- `eslint.config.mjs` forbids `src/renderer/automation/` from importing renderer editor modules. Keep the fake-source module and its controller within `src/renderer/editors/browser/`, or keep the source module dependency-free if placed in automation. The browser editor can use its existing target/CdpSession seam. Do not add an import-zone exception or use `await import()` / a wrapper to evade one.
- `package.json`, `package-lock.json`, and the checked `node_modules` package records contain no `@sinonjs/fake-timers` or other fake-clock dependency. Use a small self-contained page-script source; do not add a dependency for this task.

### Clock design decisions

- **Public surface:** `site.clock.install({ now? })`, `site.clock.fastForward(ms)`, and `site.clock.uninstall()`. `now` accepts a `Date`, epoch-millisecond number, or parseable date string; when omitted, capture the current epoch time at installation. `fastForward` accepts a finite, non-negative millisecond duration. Do not add `setFixedTime`, `pauseAt`, `resume`, or `runFor` in this task; they are unnecessary for the four-minute scheduled-run case.
- **Time progression:** After installation, fake wall time is `installNow + real elapsed monotonic time since install + total fast-forwarded time`. Fake `performance.now()` reports the same elapsed offset from its install baseline, so it remains monotonic and consistent with `Date.now()`. A single saved native `setTimeout` is the wake-up driver, always scheduled for the earliest due fake timeout, interval, or animation-frame callback; due work also fires autonomously as real time passes. `fastForward(ms)` adds `ms` immediately and runs every newly due callback in due-time/registration order before rescheduling that one native wake-up.
- **Installation timing:** `install()` registers the generated source through the selected tab's F1 `addInitScript()` first, then evaluates the same idempotent source in the current document. This handles both a page that has already loaded and the required before-app-start path after `install()` followed by navigation. Repeated source evaluation in a navigation race must detect the already-installed hidden handle and avoid installing a second scheduler.
- **Existing timers:** In an already-loaded document, timers scheduled before installation keep their native scheduling and are not migrated or canceled. Page code that captured native timer or `Date` references before installation keeps those references too. New calls through replaced globals use fake time. Installing before navigation is the supported way to make application startup and all its timer registrations use the fake.
- **Page-side primitives and frames:** Before replacing globals, the self-contained source captures native `Date`, `performance.now`, `setTimeout`, and `clearTimeout` (and any original property descriptors it must restore). It replaces `Date`/`Date.now`, `performance.now`, `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval`, and `requestAnimationFrame`/`cancelAnimationFrame`; `queueMicrotask` remains native. Preserve ordinary `Date` parsing, formatting, and explicit-argument construction behavior. F1 also runs in covered same-process child frames, so the source uses a per-frame hidden marker for idempotency and each frame gets an independent fake. Host `fastForward()` and `uninstall()` control the main frame only. OOPIFs are not covered.
- **Request-scoped facade state:** `BrowserClock.ts` owns a module-level `WeakMap` keyed by the `BrowserEditor` model, with an inner `Map` keyed by tab ID for each installed script ID and seed time. This is the chosen way to survive new `BrowserEditorFacade` and nested `BrowserClock` instances across call-tree requests without storing state on the facade. Install one model-state subscription per registry; when a tab disappears, delete its entry. The main-process F1 guest-close cleanup already clears that tab's registration.
- **Host control and hidden state:** Store the scheduler handle on `window` under a non-enumerable symbol (or an equally private closure-backed key); app code must not see a normal enumerable global. `fastForward()` evaluates a fixed control expression through the selected tab's existing `CdpSession.evaluate()` and invokes the handle. `uninstall()` invokes its restore/clear method, removes the F1 registration ID, and forgets the selected tab/ID. Do not expose the hidden handle or fake source in results or errors.
- **Current-document semantics:** `uninstall()` restores the saved global property descriptors and cancels fake timers in the current document; it cannot change timer references already captured by page code. Removing the F1 registration prevents future documents from reinstalling. `closePagesOpenedSince()` calls `uninstall()` and then the existing `clearInitScripts()` for adopted session pages. Run-owned pages close through existing cleanup, which clears their F1 registration.
- **CDP virtual time considered:** `Emulation.setVirtualTimePolicy` can replace time for all frames in the target and supports pause/advance policies; `pauseIfNetworkFetchesPending` explicitly makes virtual-time progress depend on pending resource fetches. It is not selected: it acts on the whole target, its policy and budget interact with network work, and it is a separate emulation control surface when F1 plus page evaluation can meet this pilot with per-page globals and no new protocol behavior. See the [Chrome DevTools Protocol Emulation domain](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/).

## Implementation Plan

1. **Add the self-contained page fake.** Create `src/renderer/editors/browser/browser-clock-script.ts`. It owns fake `Date`, `performance.now`, timeout/interval and animation-frame queues, the hidden non-enumerable per-frame handle, callback ordering, elapsed-time calculation, one-native-timeout wake-up scheduling, `fastForward`, idempotent install, and descriptor/timer restoration. Capture native `Date`, `performance.now`, `setTimeout`, and `clearTimeout` before changing globals; use the saved native timeout as the only real-time driver and always schedule it for the earliest fake timer. Export a source builder that serializes the selected initial epoch into a self-contained IIFE; it must not import renderer modules or depend on Node APIs. The per-frame marker must make repeat evaluation harmless, including the main-document install/navigation race. Keep `queueMicrotask` untouched and do not stringify errors or source into diagnostics.

   Before:

   ```js
   const site = await ctx.openBrowser(url);
   // The application starts with real Date and real timers.
   ```

   After:

   ```js
   const site = await ctx.openBrowser("about:blank");
   await site.clock.install({ now: "2026-01-01T00:00:00Z" });
   await site.navigateAndWait(url);
   await site.clock.fastForward(4 * 60 * 1000);
   // Assert the application's scheduled run has fired.
   ```

   `ctx.openBrowser(url)` navigates before returning, so use an `about:blank` page when the first app document must start under fake time. Install before `navigateAndWait(url)`.

2. **Own lifecycle and host commands in a browser collaborator.** Create `src/renderer/editors/browser/BrowserClock.ts`. It owns the per-model registry as a module-level `WeakMap<BrowserEditor, { tabs: Map<string, ClockRegistration>; unsubscribe: () => void }>`; each tab entry holds its initial time and F1 registration ID. Create one state subscription per model registry and delete an entry when the tab closes. This explicit registry is required because `aiCall()` creates a fresh `ScriptContext` per request, `PageWrapper.editor` creates a fresh `BrowserEditorFacade`, and each facade constructs a fresh nested storage collaborator. Reuse `BrowserEditor.target.cdp(tabId).addInitScript(source)`, `.removeInitScript(id)`, and `.evaluate(expression)`; register before evaluating the source into the current document. `fastForward()` validates the duration and evaluates a call into the main-frame hidden handle. `uninstall()` best-effort restores the current main frame, removes the retained init-script ID, and clears the per-tab entry. Do not add a CDP feature module, IPC channel, request correlator, error envelope, frame method map, or protocol code.

3. **Expose the nested clock facade.** In `src/renderer/api/types/browser-editor.d.ts`, add `IBrowserClock` with `install(options?: { now?: Date | number | string }): Promise<void>`, `fastForward(ms: number): Promise<void>`, and `uninstall(): Promise<void>`, plus `readonly clock: IBrowserClock` on `IBrowserEditor`. In `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, add the `clock` member descriptor, provide the nested collaborator following the existing `storage` node path, instantiate/delegate to `BrowserClock`, and add `$help` text for initial-document, current-document, and cleanup semantics. Enforce normal page access by reusing `agentMayAccessBrowserPage()` and `privateBrowserRefusal()` from `src/renderer/editors/browser/agent-access.ts`, as `BrowserStorageFacade` does; do not check `agentMayUseBrowserTestPower()`.

4. **Clean adopted pages through the existing runner helper.** In `src/test-host/browser-helpers.ts`, update `closePagesOpenedSince()` to call `pages[pageId].editor.clock.uninstall()` for each `sessionPages` entry before its existing `clearInitScripts()` call. Keep both actions best-effort, use the existing `boundedCall()` and cleanup log shape, and continue the remaining page/test-power cleanup if uninstall fails. `closePagesOpenedSince()` already owns adopted-page cleanup, so no other runner file or ownership registry is needed.

5. **Extend the existing bridge entry and implementation guides.** Extend the existing Bridge 1.61.0 paragraph in `assets/guides/agents/boards/bridge-versions.md` with `clock.install`, `clock.fastForward`, and `clock.uninstall` available through `window.persephone.call()`. Do not change `src/shared/board-bridge-version.ts`: US-2165 already set 1.61.0 for EPIC-207. At implementation, update `assets/guides/agents/browser.md`, `assets/guides/agents/browser-automation.md`, `assets/guides/agents/web-app-tests/index.md`, and `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` with the API, pre-navigation example, current-document limitations, cleanup, and timer coverage. No other guide is required for this feature.

6. **Keep ownership and guardrails explicit.** `browser-clock-script.ts` owns page-side fake clock mechanics; `BrowserClock.ts` owns F1 registration and host control; `BrowserEditorFacade.ts` only composes/exposes the nested API; `browser-helpers.ts` owns runner cleanup. `BrowserWebviewModel.ts` and `src/main/cdp-service.ts` do not grow. Add no rule to `src/shared/board/` or board registries. Reuse the existing service channel, `PendingRequests`, wire error, typed RPC, and frame method maps only where an existing helper already uses them; this task adds no cross-process call and no new protocol. No `BOARD_BRIDGE_VERSION` change is needed because this is a later member on the 1.61.0 epic bridge entry.

## Concerns

- Installing in a loaded document cannot retroactively make already-scheduled native timers fire on fake time, nor replace globals captured earlier by the app. The pilot and reliable application-start behavior must install before the first navigation.
- The fake does not control Web Workers, `MessageChannel`/`setImmediate`-based schedulers, or CSS animations. It also does not virtualize network timing or compositor painting.
- `fastForward()` runs JavaScript callbacks in the page. A callback that throws, schedules an unbounded zero-delay loop, or performs asynchronous work can affect the host call; keep error handling bounded and avoid leaking callback exception details or the fake source through the facade.
- The page clock continues to advance with real elapsed time and fires due callbacks autonomously; tests do not need to repeatedly fast-forward for ordinary debounces, polling, or spinners. `fastForward()` adds an immediate time jump on top of that progression.
- Animation-frame callbacks are scheduled on the same fake queue at frame intervals; this is deterministic timer emulation, not rendering or compositor advancement. Do not promise that a frame has been painted after `fastForward()`.
- The fake is page-side and tab-scoped. Each covered same-process child frame installs its own independent clock; host fast-forward and uninstall affect the main frame only. It does not change Node/test-runner time, other browser tabs, network timing, Web Workers, or OOPIF targets.
- `BrowserEditorFacade` and its `BrowserStorageFacade` are constructed anew during call-tree resolution, so registration state cannot live in a facade or nested collaborator instance. The per-model `WeakMap`/per-tab `Map` in `BrowserClock.ts` and its tab-close subscription are required for later calls to find and remove the original F1 registration.
- The bridge call tree is board-callable; `clock` is evaluate-equivalent under EPIC-207 Decision 3, and is not a test-runner-only power. Do not add a special board restriction or change the existing access predicate.
- F1 registry cleanup alone is insufficient for the currently loaded adopted page. Runner cleanup must call `clock.uninstall()` first, then clear any remaining per-tab init scripts with the existing helper.

## Acceptance Criteria

- `site.clock.install({ now? })` supports `Date`, epoch milliseconds, or a parseable date string; omitted `now` captures the current time. It adds a per-tab F1 init script before evaluating the same source in the current document.
- After installation before navigation, page-authored application scripts observe the fake `Date`/`Date.now`, `performance.now`, timeout/interval functions, and animation-frame functions from document start. Time then advances with real elapsed monotonic time as well as explicit fast-forwards; due callbacks fire autonomously through one saved native timeout scheduled for the earliest due fake timer.
- Calling `install()` after a document has loaded installs in that document for future global lookups and registers the same source for subsequent documents. Existing native pending timers and references captured before installation are not migrated; this limitation is documented in help and guides.
- `fastForward(ms)` rejects invalid or negative values, adds the requested duration to the real-time-progressing fake clock, and fires all due callbacks in deterministic due-time and registration order. Fake `Date.now()` and `performance.now()` remain consistent and monotonic. `queueMicrotask` remains native.
- The fake source captures native `Date`, `performance.now`, `setTimeout`, and `clearTimeout` before replacement. F1's same-process child-frame executions each get one independent fake guarded against duplicate installation; host fast-forward and uninstall act on the main frame only.
- The scheduler handle is not exposed as a normal enumerable window property. The app cannot accidentally collide with a public `clock` global.
- `uninstall()` restores original global descriptors, cancels fake scheduled work for the current document, removes the F1 script ID, and can be called repeatedly safely. Reinstalling after uninstall creates one active scheduler and one registration.
- `BrowserClock.ts` retains registration IDs and seed times in a module-level `WeakMap` keyed by the `BrowserEditor` model and an inner map keyed by tab ID; a single model-state subscription removes entries on tab close. This survives request-scoped facade reconstruction and does not persist state on the facade.
- `closePagesOpenedSince()` best-effort calls `clock.uninstall()` and then existing `clearInitScripts()` for every adopted session page; a failure in one cleanup action does not skip other cleanup. Closing run-owned pages continues to clear their init-script registry.
- Clock access follows the same existing page-access rule as `evaluate()` and does not use `agentMayUseBrowserTestPower()`.
- The nested API is composed through a new browser-editor collaborator, not `BrowserWebviewModel.ts`; current `CdpSession`/F1 helpers are reused and no IPC/protocol code is added.
- The existing Bridge 1.61.0 history paragraph records all three clock members; `BOARD_BRIDGE_VERSION` stays at `1.61.0` and no second history paragraph or version bump is added.
- Browser and web-app test guides show installing before navigation, advancing four minutes, current-document limits, supported fake globals, and cleanup behavior.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2170-fake-clock/README.md` | This implementation brief. |
| `doc/epics/EPIC-207.md` | Link US-2170 in the Linked Tasks table. |
| `doc/active-work.md` | Link the existing EPIC-207 US-2170 entry to this brief. |
| `src/renderer/editors/browser/browser-clock-script.ts` | New dependency-free page-script source and fake timer implementation. |
| `src/renderer/editors/browser/BrowserClock.ts` | New browser-editor collaborator for F1 registration, current-page install, evaluate control, uninstall, and request-persistent per-model/per-tab registration state. |
| `src/renderer/api/types/browser-editor.d.ts` | Add the nested `IBrowserClock` API. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Compose and expose the nested clock facade and help. |
| `src/test-host/browser-helpers.ts` | Uninstall current-document clocks before clearing adopted session-page init scripts. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend the existing Bridge 1.61.0 history paragraph. |
| `assets/guides/agents/browser.md` | Document clock API, timing semantics, and lifetime. |
| `assets/guides/agents/browser-automation.md` | Document the fake clock and pre-navigation usage. |
| `assets/guides/agents/web-app-tests/index.md` | Add scheduled-run fake-clock guidance. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Add the `site.clock` example and cleanup semantics. |
| `src/main/cdp/cdp-init-scripts.ts` | **No changes:** US-2165 already owns per-tab document-start source registration. |
| `src/main/cdp-service.ts`, `src/ipc/browser-ipc.ts`, `src/ipc/main/cdp-handlers.ts` | **No changes:** host control uses existing renderer `CdpSession.evaluate()` and F1 methods; no protocol boundary is added. |
| `src/renderer/automation/CdpSession.ts` | **No changes:** existing `evaluate()`, `addInitScript()`, and `removeInitScript()` cover clock control and lifecycle. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | **No changes:** roadmap §2.3 god file; behavior belongs in `BrowserClock`. |
| `src/shared/board-bridge-version.ts` | **No changes:** EPIC-207 already selected version 1.61.0 in US-2165. |
| `src/shared/board/` and board registries | **No changes:** no board rule or registry behavior is introduced. |

## Implementation progress

- [x] Add the self-contained page fake and per-model browser clock collaborator.
- [x] Expose `site.clock` through the browser editor facade and typed API.
- [x] Uninstall clocks during adopted-page cleanup.
- [x] Extend Bridge 1.61.0 history and the specified browser/web-app test guides.
- [x] Run typecheck and lint; guide validation was attempted but could not start because esbuild spawn returned EPERM.
