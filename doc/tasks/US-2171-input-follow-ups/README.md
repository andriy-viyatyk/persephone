# US-2171: EPIC-207 follow-ups: destroyed-listener leak, click that closes its popup

**Epic:** [EPIC-208: Input fidelity for web-app tests](../../epics/EPIC-208.md) · **Status:** Planned · **Order:** first EPIC-208 task

## Goal

Stop lifecycle callbacks from accumulating on shared `WebContents`, and make a trusted click succeed when dispatching its release closes the target popup. A target lost before the press remains an error; closure after release must not be reported as a lost click by US-2173.

## Background

### Binding decisions and scope

- This is the EPIC-207 follow-up task in [EPIC-208](../../epics/EPIC-208.md). EPIC-208 Decisions 1, 3, 6, 7 and 8 apply: put input behavior in the shared automation modules; preserve conservative error behavior; use no new protocol; bump the board bridge once for the epic if a board-visible result changes; keep strict null checking and do not run `build-prod`.
- Two warning patterns were observed in the development logs. During the browser UI suite's `popups` area, `11 destroyed listeners added to [WebContents]` appeared beside `browser:close-popup` / `Popup refused to close before the close deadline.` errors. This is consistent with `BrowserPopupRegistry` adding one `sender.once("destroyed")` per popup entry to the shared app renderer. Earlier, `destroyed`, `render-process-gone`, and `did-navigate` each reached 11 at the same time; those are exactly `ALL_EVENTS` in `onWebContentsGone()`, so concurrent lifecycle subscriptions are the matching pattern. Default-event call sites include `capability-router.ts`, `audio-service.ts`, `module-service/leases.ts`, `capability-client.ts`, and `module-service/board-settings-adapter.ts`. This three-event pattern does not implicate `recording-service.ts`, whose subscription explicitly selects only `destroyed` and `render-process-gone`.
- The source audit does **not** find an unremoved `destroyed` listener in the US-2165–US-2170 CDP feature modules. The repeatable per-call leak is also present in `src/main/recording-service.ts::startRecording()`: it calls `onWebContentsGone()` for every recording but drops the returned disposer. `finalizeRecording()` and `removePartial()` remove the recording from `byId` / `byOwner` but do not remove that lifecycle subscription. Repeated recordings in one Persephone window therefore retain callbacks until the window's `WebContents` dies. Keep this owner fix as well.
- `src/main/webcontents-lifetime.ts::onWebContentsGone()` is the existing lifecycle helper. It returns an idempotent disposer, but currently adds native Electron listeners for each subscription. Make it the shared per-WebContents registry: one native listener per WebContents and event, dispatching to registered callbacks; disposing a subscription removes its callback and removes the native listener when no callbacks remain. Preserve `events`, `repeat`, callback ordering, and idempotent disposal semantics.
- This shared-native-listener change covers both logged patterns: it collapses concurrent default-`ALL_EVENTS` subscriptions to one native listener per event and collapses popup sender/opener subscriptions routed through the helper. Keep the explicit recording disposer too, so completed recordings release their callback subscriptions instead of retaining closures until window destruction.

### Recorded fix by Claude (already applied, keep it)

- EPIC-207's `/review` refactor broke saved site extensions and temporary extensions on browser pages. At module load, `src/main/cdp-service.ts` passed the then-undefined `onAiVisionSignalCallback` by value to `createCdpLifecycleMethods(...)`; consequently `cdpAttach(..., { aiVisionBinding: true })` returned `false` and extension injection reported `Browser target could not be attached for injection.`
- Claude changed `createCdpLifecycleMethods()` in `src/main/cdp/cdp-browser-test-methods.ts` to accept `getAiVisionSignal: () => ...`, resolve it inside `cdpAttach()`, and changed `src/main/cdp-service.ts` to pass `() => onAiVisionSignalCallback`. Claude verified live that `attachTestExtension` injects again. Keep both source changes; do not revert or fold them into this task's implementation.

### Verified destroyed-listener inventory

- **`src/main/recording-service.ts` — leaked per recording.** `startRecording()` registers `onWebContentsGone(owner, ..., { events: ["destroyed", "render-process-gone"] })` at line 79 and discards its disposer. `RecordingEntry` has no lifecycle disposer. `removePartial()` and successful `finalizeRecording()` are the terminal paths that must dispose it. The owner map already prevents two simultaneous recordings for one owner, but allows sequential recordings, which is enough to accumulate callbacks.
- **EPIC-207 `src/main/download-capture.ts` — per wait, cleaned.** `DownloadCapture.wait()` adds one-shot `did-navigate` and `destroyed` listeners and attaches `cleanup` to both fulfillment and rejection of `pending.promise`. Cleanup removes both listeners and clears the `byContents` entry. A second simultaneous waiter for one `WebContents` is refused. No change is needed here.
- **EPIC-207 `src/main/clipboard-service.ts` — one per monitored owner.** `registerOwner()` checks `ownerCleanup.has(ownerId)`, stores the single cleanup callback, and registers one `destroyed` listener. `unregisterOwner()` removes it. No per-call accumulation is present; no change is needed.
- **EPIC-207 `src/main/cdp/cdp-browser-test-methods.ts`** composes feature handlers and registers no `destroyed` listener. The main feature modules from US-2165–US-2169 (`cdp-init-scripts.ts`, `cdp-storage-state.ts`, `cdp-request-routes.ts`, `cdp-waits.ts`, `cdp-page-events.ts`, and `cdp-network-collector.ts`) contain no Electron `WebContents` `destroyed` listener. `cdp-waits.ts` removes CDP event subscriptions in its `finish()`, `clearKey()` and `onTargetDetached()` paths; `cdp-page-events.ts` and `cdp-network-collector.ts` call their CDP subscription cleanup functions from `clearKey()` and `onTargetDetached()`. US-2170's fake clock is renderer page instrumentation and adds no main-process `WebContents` listener.
- **`src/main/browser/BrowserGuestRegistry.ts` and `src/main/search-service.ts` — one watcher per sender.** Both use a `WeakSet` to guard their sender `destroyed` watcher, so repeated registration/search starts do not stack listeners.
- **`src/main/browser/BrowserGuest.ts` — one listener on its own guest contents.** `attach()` registers the guest's own `destroyed` event once for that guest instance to unregister it. This listener is scoped to that distinct guest `WebContents`, not repeated per automation call.
- **`src/main/browser/BrowserPopupRegistry.ts` — entry-scoped listeners, with a shared-sender warning.** Each popup entry registers `destroyed` callbacks on the popup's own contents, its immediate opener and the renderer sender. `remove(entry)` removes the opener and sender handlers and all popup-content handlers. The opener/sender callbacks can stack while many popup entries are simultaneously live, matching the popup-suite warning. Route these registrations through the shared `onWebContentsGone()` registry so a shared opener/sender has one native listener; keep each per-entry callback disposable when `remove(entry)` runs.
- **Popup terminal-path audit.** Popup contents destruction calls `remove(entry)` and then closes descendants; the window's `closed` handler sets `windowClosed`, removes the entry and resolves an active close request. Opener destruction calls `closeDescendants(openerId)`, and sender destruction calls `closeOwned(rootKey, sender)`; both destroy matching popup windows, whose removal path is idempotent. `close()` also calls `remove(entry)` if `window.close()` synchronously leaves the window destroyed. At the close deadline, however, `close()` rejects with `Popup refused to close before the close deadline.` and clears `entry.closing` without removing the entry. This is not a terminal popup path: the refused popup remains live, listed, addressable and eligible for a later close; removing it would orphan a still-open popup from the registry. If it later closes, the `closed` / `destroyed` handlers remove it. No timeout-path removal is planned.
- Other inspected direct registrations are owner/object-scoped rather than per automation call: `permission-policy-service.ts` and `global-mute-service.ts` register once per contents; `TestModeLog.attachConsole()` guards with its attachment map and removes its listener in `detachConsole()`; `OneShotFrameGrant.clear()` removes its grant listener; `board-pipe-service.ts::wireWebContents()` guards by contents ID; `BrowserPopupRegistry.remove()` removes popup lifecycle handlers. The `onWebContentsGone()` call sites in `capability-router.ts` and `module-service/board-settings-adapter.ts` dispose in their `finally` / subscription detach paths. The exception found is `recording-service.ts` above.

### Verified click path and navigation classification

- `src/renderer/automation/AutomationSurface` owns the shared browser-like call surface. Its `click()` calls `src/renderer/automation/mouse.ts::clickElement()`. `BoardEditorFacade` constructs this surface with `host: "board"`, and `BrowserEditorFacade` uses `host: "browser"`, so the click result is observable through board `window.persephone.call()`.
- `clickElement()` resolves actionability before input, then dispatches `mouseMoved`, `mousePressed`, and `mouseReleased` in order. It has no post-click target check. The popup fixture's `#finish` handler posts its message and calls `window.close()`; a click handler runs because of release. Thus the expected rejection is from the `mouseReleased` CDP command after dispatch has begun, not a later automation check. Errors from actionability, `mouseMoved`, or `mousePressed` must continue to fail.
- `CdpSession.send()` uses existing `BrowserChannel.cdpSend` IPC; `src/main/cdp-service.ts::cdpSend()` forwards to `webContents.debugger.sendCommand()`. No repository code constructs `target closed while handling command`; it is returned from the rejected CDP send path. Keep this fix in the automation owner; add no IPC channel or error envelope.
- EPIC-203 already classifies navigation/context loss through `src/renderer/automation/context-loss.ts::isAutomationContextLoss()`. Its current callers are `src/renderer/editors/browser/BrowserPageRemote.ts::request()` and `src/renderer/automation/wait-for-function.ts::waitForFunction()`. Match the exact phrase `target closed while handling command` case-insensitively (normalize the error message, then test that exact phrase); do not broaden the rule to arbitrary `target closed` errors. In `BrowserPageRemote.request()`, this newly classified error becomes `page-navigated`, or `{ navigated: true }` when allowed; that is acceptable when the page closes during its model call. In `waitForFunction()`, it becomes `Page navigated while waiting for function.`, consistent with existing context loss. The planned third caller, `mouse.ts::clickElement()`, will use the same helper only around `mouseReleased`, treating this specific close-after-press failure as delivered. Do not add a click-specific classifier; target loss before release remains an error.
- US-2173 E2 will inspect whether a click event was produced. A release-stage target-closed context loss means the release was dispatched and the page closed as its result: the click call returns success, and E2 must not turn that case into a lost-click result. Reuse `isAutomationContextLoss()` in that ordering; only a live target with certain press/release evidence can produce the E2 lost-click report.
- The existing regression is already present in `integration-test/tests/browser/popups/popups.test.mjs`: “OAuth completion button posts and closes its popup” clicks `#finish` at line 417, then verifies the opener received `oauth-complete`. No new harness or unit test is needed; Claude runs the UI integration test during implementation verification.
- A live dev-app reproduction is deterministic when the popup's `#finish` handler calls `window.close()` on `mousedown`: `editor.click("#finish", { tabId })` fails with `target closed while handling command`. The `mousePressed` send succeeds and `mouseReleased` rejects after the target closes, confirming that the release-only catch is the right boundary.

## Implementation Plan

1. **Centralize lifecycle listener ownership in `src/main/webcontents-lifetime.ts::onWebContentsGone()`.** Add a `WeakMap<WebContents, ...>` registry keyed by event. Install one native listener per WebContents/event; fan out events to a snapshot of current callback subscriptions. Each call still returns an idempotent disposer. On `destroyed`, dispose each subscription before invoking its callback; on other events, retain it only when that subscription requested `repeat: true`. Remove an event's native listener when its last subscription is disposed. Preserve default events and existing callback semantics. No caller receives a new protocol or IPC surface.

   **Before:**
   ```ts
   const listeners = new Map<WebContentsGoneEvent, () => void>();
   // Every call to onWebContentsGone adds its own webContents.on(event, listener).
   ```

   **After:**
   ```ts
   // webContents -> event -> { one native listener, active callback subscriptions }
   // onWebContentsGone() adds a subscription and returns its idempotent disposer.
   ```

2. **Dispose recording lifecycle subscriptions in `src/main/recording-service.ts`.** Add a disposer field to `RecordingEntry`; assign the result of `onWebContentsGone()` when the entry is created. Call it from `removePartial()` and after a successful `finalizeRecording()` has committed the final file and removed the entry from the active maps. Keep the listener active if finalization fails while the recording remains active, so owner loss can still cancel it.

   **Before:**
   ```ts
   byId.set(id, entry);
   onWebContentsGone(owner, () => { void cancelRecordingsForOwner(owner.id); }, { events: ["destroyed", "render-process-gone"] });
   ```

   **After:**
   ```ts
   entry.stopOwnerLifecycle = onWebContentsGone(owner, () => {
       void cancelRecordingsForOwner(owner.id);
   }, { events: ["destroyed", "render-process-gone"] });
   ```
   The disposer is also called in both terminal paths; `onWebContentsGone()` itself remains the shared native listener owner.

3. **Route popup lifecycle subscriptions through the registry in `src/main/browser/BrowserPopupRegistry.ts::register()` / `remove()`.** Replace per-entry `once("destroyed")` registrations for the shared `immediateOpener` and `sender` with `onWebContentsGone(..., { events: ["destroyed"] })` subscriptions and store their disposers on `PopupEntry`. Replace the popup-content `destroyed` listeners with one registry subscription that calls `remove(entry)` and then `closeDescendants(id)`, preserving the current event order. `remove(entry)` disposes all three subscriptions idempotently. The close-deadline rejection keeps a still-live popup registered; actual window/content closure and opener/sender destruction all remove matching entries through the audited paths above. Preserve close-owned, popup-closed and attachment ordering.

   **Before:**
   ```ts
   immediateOpener.once("destroyed", entry.openerDestroyed);
   sender.once("destroyed", entry.senderDestroyed);
   ```

   **After:**
   ```ts
   entry.stopWatchingOpener = onWebContentsGone(immediateOpener, entry.openerDestroyed, { events: ["destroyed"] });
   entry.stopWatchingSender = onWebContentsGone(sender, entry.senderDestroyed, { events: ["destroyed"] });
   ```
   The per-entry callbacks remain distinct, but the helper owns one native listener for a shared WebContents.

4. **Classify click-close at the release boundary.** In `src/renderer/automation/context-loss.ts::isAutomationContextLoss()`, normalize `errMessage(error)` to lowercase and recognize the exact phrase `target closed while handling command`, alongside the current context-loss phrases. This changes the existing `BrowserPageRemote.request()` and `waitForFunction()` outcomes as described in Background, which is acceptable and consistent with their existing navigation-loss behavior. In `src/renderer/automation/mouse.ts::clickElement()`, wrap only the awaited `mouseReleased` dispatch: return successfully when `isAutomationContextLoss(error)` is true, and rethrow every other error. Leave actionability, move, press, and the pre-release failure path unchanged.

   **Before:**
   ```ts
   await dispatchMouseEvent(action.cdp, action.sessionId, { type: "mouseReleased", ... });
   ```

   **After:**
   ```ts
   try {
       await dispatchMouseEvent(action.cdp, action.sessionId, { type: "mouseReleased", ... });
   } catch (error: unknown) {
       if (isAutomationContextLoss(error)) return;
       throw error;
   }
   ```

5. **Update the board bridge once for EPIC-208.** Since `BoardEditorFacade` exposes the same shared `AutomationSurface.click()` result through `window.persephone.call()`, boards can observe this error-to-success change. This is the first EPIC-208 task in the binding order that changes a board-observable result: change `src/shared/board-bridge-version.ts` from `1.61.0` to `1.62.0`, and add one `1.62.0` history line to `assets/guides/agents/boards/bridge-versions.md`. Later EPIC-208 tasks extend that same history line without another bump.

6. **Preserve the existing popup integration regression.** Keep `integration-test/tests/browser/popups/popups.test.mjs`’s OAuth completion test as the end-to-end acceptance check: the click resolves and the opener message becomes `oauth-complete`; run it as part of the browser UI integration suite under Claude’s verification workflow. Add no unit tests and no test harness.

## Concerns

- Only a context-loss rejection from the `mouseReleased` send is treated as delivered. Actionability failures and errors before release, including a target already closed before the click can press, remain errors. Other release failures remain errors.
- The deterministic mousedown-close reproduction means the page may close before it can produce a `click`; after the successful press and attempted release, this task still treats the classified close as delivered. US-2173 must not report that closed-target case as a lost click.
- The lifecycle helper must preserve callback and `repeat` behavior for current users while sharing only native listeners. A callback may dispose itself or another subscription during dispatch, so dispatch over a stable subscription snapshot and check that a subscription remains active before invoking it.
- The task document's listener audit found the EPIC-207 download and clipboard registrations already scoped correctly. The actionable repeated-call leak is the recording owner; the popup change prevents many simultaneously live popup entries from stacking native listeners on their shared sender/opener.
- No delay or threshold is tuned, so no constants block is needed. No `window.persephone` member is added, but its observable click result changes; the bridge bump/history line above is required. No board rule, protocol code, god-file growth, import-zone workaround, or runtime null-check change is planned.

## Acceptance Criteria

- [x] `onWebContentsGone()` installs at most one native listener per WebContents/event while subscriptions exist; disposing a subscription is idempotent, removes its callback, and removes the native listener after the last callback is gone. Existing event selection, repeat, and callback semantics remain intact.
- [x] Repeated start/cancel and start/finalize recording cycles on one owner do not increase its active `destroyed` listener count; owner destruction/crash still cancels an active recording and cleans its partial file/media grant.
- [x] Multiple live popup entries sharing a sender or opener add only one native `destroyed` listener to that WebContents; closing a popup disposes its callback subscriptions and preserves descendant cleanup.
- [ ] The existing OAuth popup integration test's trusted `click("#finish", { tabId })` resolves after the popup closes, and the opener still receives `oauth-complete`.
- [ ] A target/context loss before `mouseReleased` still rejects the click. A target-closed error from the release dispatch is success; unrelated CDP errors still propagate. US-2173's lost-click detection treats this closed-target case as delivered, not lost.
- [x] `isAutomationContextLoss()` remains the shared classifier used by `BrowserPageRemote` and wait functions; no parallel click classifier or IPC change is added.
- [x] Board-visible result changes bump `BOARD_BRIDGE_VERSION` exactly once from `1.61.0` to `1.62.0`, with a `1.62.0` history line in the board bridge guide. No later EPIC-208 task bumps it again.
- [x] The existing strict automation/type boundaries remain valid. No unit tests or harnesses are added; Claude runs the UI integration check. The task does not edit `doc/active-work.md` or `doc/epics/EPIC-208.md` because their entries already exist.

## Files that need no changes

- `src/main/cdp/cdp-browser-test-methods.ts`, `src/main/cdp/cdp-init-scripts.ts`, `src/main/cdp/cdp-storage-state.ts`, `src/main/cdp/cdp-request-routes.ts`, `src/main/cdp/cdp-waits.ts`, `src/main/cdp/cdp-page-events.ts`, and `src/main/cdp/cdp-network-collector.ts`: audited; no leaking `WebContents` destruction listener.
- `src/main/download-capture.ts` and `src/main/clipboard-service.ts`: per-wait / per-owner cleanup is already present.
- `src/ipc/browser-ipc.ts`, IPC handler maps, board registries, and `src/renderer/automation/input.ts`, `locator.ts`: no new protocol, call surface, board rule, or post-click check is needed. `src/main/cdp-service.ts` and `src/main/cdp/cdp-browser-test-methods.ts` are excluded here because Claude's recorded getter fix above is already applied and must be kept.
- `integration-test/tests/browser/popups/popups.test.mjs`: its existing OAuth regression already covers the click-close path; it needs to be run, not extended with a harness.
- `doc/active-work.md` and `doc/epics/EPIC-208.md`: the dashboard entry and epic link already exist.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2171-input-follow-ups/README.md` | This investigation and implementation brief. |
| `src/main/webcontents-lifetime.ts` | Share native lifecycle listeners per WebContents/event; fan out disposable subscriptions. |
| `src/main/recording-service.ts` | Dispose each recording's lifecycle subscription on cancel or successful finalize. |
| `src/main/browser/BrowserPopupRegistry.ts` | Use disposable lifecycle subscriptions for popup, opener and sender teardown. |
| `src/renderer/automation/context-loss.ts` | Extend the existing context-loss classification to target-closed CDP sends. |
| `src/renderer/automation/mouse.ts` | Treat target closure from the release dispatch as a delivered click. |
| `src/shared/board-bridge-version.ts` | Bump the board-visible contract from 1.61.0 to 1.62.0 once for EPIC-208. |
| `assets/guides/agents/boards/bridge-versions.md` | Add the 1.62.0 history entry for the changed board-observable click result. |
| `src/main/cdp/cdp-browser-test-methods.ts` | **Done by Claude:** use a getter for the late-initialized AI Vision signal callback. Keep this change. |
| `src/main/cdp-service.ts` | **Done by Claude:** pass `() => onAiVisionSignalCallback` into the lifecycle-method factory. Keep this change. |
