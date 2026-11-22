# US-2173: Detect a click that produced no click

**Epic:** [EPIC-208: Input fidelity for web-app tests](../../epics/EPIC-208.md)

## Goal

Let hover-driven UI updates settle before trusted locator clicks press, then recheck the hit target and boundedly resolve/move again when it changed. On browser and board pages, optionally detect certain left-clicks that reached the page but emitted no click event; `window.screen` skips this post-release check to protect Persephone UI actions.

## Background

### Reproduction and EPIC-208 decisions

- EPIC-208 E2 is feedback item 5 from [US-2138](../US-2138-web-app-test-feedback/README.md): recheck the hit target one frame after pointer movement because hover-driven UI work may not have rendered before the press. The primary fix is this pre-press settle and recheck. A separate, opt-out post-release check detects missing left-click activation on browser and board pages; incomplete recorder evidence leaves the click result unchanged and silent.
- Live reproduction provided for this task: a trusted `editor.click("#downcell")` on an element whose `pointerdown` handler replaces it with `el.cloneNode(true)` records `pointerdown:downcell`, `mousedown:e2` on the parent, `mouseup:downcell` on the replacement, and no `click`. The click handler does not run while `editor.click` returns success. A replacement on `mouseover` before pressing is hit correctly because the click moves the pointer before the press. A tooltip appended one frame after `mouseenter` receives the press, release, and click which bubbles to its cell; it is not a lost click.
- EPIC-208 Decision 1 assigns pointer behavior to shared `src/renderer/automation/`; its pre-press settle applies to browser, board, and `window.screen`. Decision 3 requires an explicit opt-out for the post-release check. EPIC-208 Decision 7 selects one bridge bump per epic: `1.61.0` to `1.62.0`, with later tasks extending the history entry.
- EPIC-203 Decision A5 says the automation right-click suppresses Persephone's own context menu by default while the page's `contextmenu` handler still runs; `{ nativeMenu: true }` opts in. This task checks only left-button clicks, so right and middle clicks retain existing semantics and have no post-release recorder.

### Verified shared automation path

- `src/renderer/automation/mouse.ts::clickElement()` first calls `resolveActionablePoint()`; for trusted input it focuses the host, dispatches `mouseMoved`, then awaits `mousePressed` and `mouseReleased` in order. It returns without reading page-side event evidence. Its `{ synthetic: true }` branch instead invokes DOM `.click()` through `evaluateWithCandidates()` or `callOnRef()` and returns before trusted CDP input.
- `src/renderer/automation/mouse.ts::clickAtCoordinates()` dispatches trusted `mouseMoved`, press, and release by coordinates without locator actionability. `clickElement()` and `clickAtCoordinates()` both iterate clickCount and pass the incrementing count to the CDP press/release events.
- `src/renderer/automation/locator.ts::actionabilityFunction()` embeds a page-side `describe(el)` helper that formats tag, id, up to three classes, and an aria-label/title/text excerpt. The same function currently performs the initial hit test and reports covered targets. `resolveActionablePoint()` retries transient actionability failures by re-resolving selector locators; refs use `callOnRef()`.
- `src/renderer/automation/selector-execution.ts::evaluateWithCandidates()` routes page expressions through `CdpSession.evaluate()` or `Runtime.callFunctionOn`, reusing `resolveCandidatesSource()` from `page-scripts.ts`. This is the existing page-script injection/evaluation path; no protocol addition is needed for an inline recorder and hit-test.
- `src/renderer/automation/input-session.ts::createInputSession()` supplies a CDP session, optional OOPIF session id, and coordinate mapping. `src/renderer/automation/ref.ts::getRefSessionId()` resolves frame refs; `callOnRef()` evaluates against the resolved element in that frame. String selectors are resolved in the selected main frame. Events in iframe documents do not bubble to the parent document, so the recorder must run in the actual input frame for ref clicks.
- `src/renderer/automation/context-loss.ts::isAutomationContextLoss()` recognizes Chromium's “Cannot find context with specified id” and “Inspected target navigated or closed” messages. `src/renderer/automation/wait-for-function.ts` and `src/renderer/editors/browser/BrowserPageRemote.ts` already use it; the latter preserves the `page-navigated` coded result.
- `src/shared/coded-error.ts::codedError()` creates an `Error` with an enumerable `code`; reuse it for the new `click-not-dispatched` code rather than introducing an error envelope. No lost-click error code currently exists in automation.

### Verified callers and public surfaces

- `src/renderer/scripting/api-wrapper/AutomationSurface.ts::click()` delegates to `clickElement()`; `BrowserEditorFacade.ts` and `BoardEditorFacade.ts` expose that surface. The board bridge reaches the object tree through `window.persephone.call()`.
- `src/renderer/api/window-screen.ts::click()` delegates to the shared automation surface, while its `clickAt()` calls `clickAtCoordinates(appTarget, ...)`. `window.screen` receives the pre-press settle, but never the post-release check: Persephone UI often intentionally acts on `mousedown`/`pointerdown`, and integration coverage makes false positives costly. Coordinate clicks also skip post-release checking because a point has no target expectation and may land over an iframe.
- Browser locator refs may target OOPIFs through their session id. The event recorder must be evaluated in that same session. Existing frame refs and `inputCdp()` provide the session and coordinate mapping; no new frame method map is required.
- `src/renderer/automation/mouse.ts` is not a roadmap §2.3 god file listed in `doc/reviews/refactoring-roadmap.md`; keep the click orchestration there but put page-side recorder source, event classification, and result formatting in a focused collaborator (proposed `src/renderer/automation/lost-click.ts`) rather than growing the input orchestration into a second rules module.
- `src/renderer/automation/CdpSession.ts` already sends CDP through `BrowserChannel.cdpSend`, evaluates expressions, and accepts a session id on `send()`. Use that path. Do not add IPC, a correlator, acknowledgement window, error envelope, or a new CDP protocol route.

### Decisions for implementation

- **Post-release error:** use `click-not-dispatched` only for an opt-out-enabled, trusted, left-button browser/board click when complete evidence shows no `click`. If press and release target descriptions differ, include A → B; otherwise say no click was dispatched. End the error message exactly with: “If the page acts on mousedown, pass `{ checkClick: false }`.” This check can flag pages that intentionally act on press; callers can disable it per click.
- **Incomplete evidence:** if the recorder cannot be armed or read for a non-context-loss reason, or its frame cannot be instrumented, silently return the click result as today. Do not add a warning result or widen return types. Context loss after release counts as success, matching US-2171 and existing `page-navigated` semantics.
- **Event semantics:** post-release check is only for left-button clicks. For `clickCount: 1`, require a captured `click`; for `clickCount: 2`, require at least one `click` total and ignore `dblclick` to reduce false positives. Do not check right/middle clicks. Keep EPIC-203's native-menu guard and page contextmenu behavior unchanged.
- **Settle bound and latency:** keep all timing values in one commented constants block in `lost-click.ts`: one `requestAnimationFrame` per settle, a 50 ms fallback, and at most 3 pre-press move/recheck rounds. At 60 Hz a stable checked click normally adds about two frames (one before press and one post-release). Worst case is 400 ms plus CDP round trips: 3 × 50 ms settle rounds, up to 2 re-resolutions at the existing two-frame actionability stability wait (2 × 2 × 50 ms), and one 50 ms post-release settle.
- **Pre-press target recheck:** after `mouseMoved`, await one animation frame in the actual target frame and re-run the existing hit test against the previously resolved target identity. If it was replaced or is no longer the hit target, re-resolve the locator and move to the new actionable point again, up to 3 rounds. If still changing at the bound, fail before press with the existing actionability-style error naming A → B. If hit testing finds an unrelated cover, retain the existing actionability failure. This applies to browser, board, and `window.screen`; `force: true` skips this recheck.
- **Context loss:** if recorder readback fails because the target navigated or closed during the click, treat release as delivered and return success, matching US-2171 and the existing `page-navigated` semantics. Do not catch context loss during pre-press setup as success; no click has yet been delivered.
- **Coordinate clicks:** `clickAt` and other coordinate clicks skip post-release recording/checking. They have no locator expectation, and coordinate input may land over an iframe whose events are invisible to the main-frame recorder.
- **Synthetic clicks:** `{ synthetic: true }` does not install a recorder or perform the trusted event check: its explicit DOM `.click()` path already dispatches synchronously and keeps its current behavior.
- **Force:** `force: true` skips the pre-press recheck, preserving its existing actionability bypass. Post-release check remains enabled for trusted left-click browser/board calls unless `{ checkClick: false }` is passed.
- **Frames:** selectors resolve in the main frame and recorder there. Refs to same-process or OOPIF frames use the ref's session for recorder setup/readback; if arming fails, silently skip the post-release check. Never assume parent-window capture sees child-frame events.
- **Bridge:** board callers can observe `checkClick` and `click-not-dispatched` through `window.persephone.call()`. US-2171 (implemented first) owns the epic's only `BOARD_BRIDGE_VERSION` bump to 1.62.0 and its history line. US-2173 extends that entry with `checkClick` and `click-not-dispatched`, without another version bump.
- **US-2172 ordering:** its planned `hoverFirst` flow clears forced hover at the start of each pointer action, then resolves actionability (which may reveal a hidden target). The click sequence is `clearForcedHover` → `resolveActionablePoint` → `mouseMoved` → one-frame settle and hit-test → arm recorder → press/release → read. The settle/re-hit-test must not call the pointer-action entry point or invoke `clearForcedHover()` again, so it cannot undo the hover reveal.

## Implementation Plan

1. **Settle and recheck before pressing (primary fix).** In `src/renderer/automation/mouse.ts::clickElement()`, keep the existing initial `resolveActionablePoint()`, dispatch trusted `mouseMoved`, wait one animation frame in the selected target frame, then re-run the existing hit test against the element identity resolved before moving. If the target was replaced or is no longer the hit element, re-resolve the locator and move again, for at most 3 rounds. A persistent target change fails before press with the existing actionability-style error naming A → B; an unrelated cover keeps the existing actionability error. `force: true` skips this recheck. This applies to browser, board, and `window.screen` clicks.

   Before:
   ```ts
   await dispatchMouseEvent(action.cdp, action.sessionId, { type: "mouseMoved", x: action.x, y: action.y });
   await dispatchMouseEvent(action.cdp, action.sessionId, { type: "mousePressed", ... });
   ```

   After:
   ```ts
   await clearForcedHover(target, options.tabId); // US-2172 pointer-action entry behavior
   let action = await resolveActionablePoint(target, locator, options);
   if (!options.force) {
       let settled = false;
       for (let round = 0; round < PRE_PRESS_RECHECK_ROUNDS; round++) {
           await dispatchMouseEvent(action.cdp, action.sessionId, { type: "mouseMoved", x: action.x, y: action.y });
           await waitForTargetFrame(action.cdp, action.sessionId);
           const checked = await recheckHitTarget(action);
           if (checked.matchesResolvedTarget) { settled = true; break; }
           if (round + 1 === PRE_PRESS_RECHECK_ROUNDS) throw changedTargetActionabilityError(checked);
           action = await resolveActionablePoint(target, locator, options);
       }
       if (!settled) throw changedTargetActionabilityError();
   }
   // Do not call clearForcedHover again during settle/re-resolution.
   ```

   Put the frame fallback and three-round limit in the commented constants block in `lost-click.ts`. Reuse/factor `locator.ts::actionabilityFunction()`'s current hit-test and element description; do not add a second actionability implementation.

2. **Add the page-side recorder collaborator.** Create `src/renderer/automation/lost-click.ts`. It owns the one-shot capture listeners on `window` for `pointerdown`, `mousedown`, `mouseup`, and `click`; each record includes event type, button/detail, a compact target description, and an in-context node identity token. Reuse the description format/helper factored from `locator.ts::actionabilityFunction()` (tag, id, class, text/aria-label/title excerpt). Keep the recorder local to the page context and remove its listeners when read or cleaned up.

   Before:
   ```ts
   await dispatchMouseEvent(cdp, sessionId, { type: "mousePressed", ... });
   await dispatchMouseEvent(cdp, sessionId, { type: "mouseReleased", ... });
   ```

   After:
   ```ts
   const recorder = await armLostClickRecorder(cdp, sessionId);
   await dispatchMouseEvent(cdp, sessionId, { type: "mousePressed", ... });
   await dispatchMouseEvent(cdp, sessionId, { type: "mouseReleased", ... });
   const evidence = await recorder.readAfterSettle();
   assertClickWasDispatched(evidence, clickCount);
   ```

   The source must be repository-authored and interpolated only with JSON-serialized values, following `ref.ts::callOnRef()`'s code-construction safety comment. Recorder read/cleanup must be safe to attempt once and must not retain page listeners after completion.
3. **Scope the post-release recorder to browser/board left clicks.** Add `checkClick?: boolean` (default `true`) to browser/board locator click options and document `{ checkClick: false }`. `AutomationSurface.click()` owns host policy through its existing `host` value: enable the default only for `browser` and `board`, and explicitly disable it for app. `keyboard.ts` and form helpers that internally call `clickElement()` for focus/activation pass the internal check disabled. Do not expose `checkClick` on `window.screen`; define `IWindowScreenClickOptions` without that property. Do not run the post-release check for coordinate clicks, right/middle buttons, or `{ synthetic: true }`. Recorder arming occurs only after the pre-press recheck, immediately before `mousePressed`.
4. **Classify the captured evidence.** For `clickCount: 1`, require at least one captured `click`; for `clickCount: 2`, require at least one `click` total and ignore `dblclick`. If complete evidence shows no click, throw `codedError("click-not-dispatched", message)` from `src/shared/coded-error.ts`. Use A → B when pointerdown and mouseup target identities differ; otherwise use the generic no-click message. Every error message ends with `If the page acts on mousedown, pass { checkClick: false }.` If recorder arming/readback is incomplete or fails for a non-context-loss reason, silently return as today. Readback context loss after release is success. Always attempt listener cleanup.
5. **Target the recorder frame.** String selectors resolve and arm in the main frame. For same-process/OOPIF refs, pass the existing ref session ID to `Runtime.evaluate` / `Runtime.callFunctionOn`; if recorder arming fails, silently skip the check. Use the existing CDP session path and do not add frame method maps or protocol code.
6. **Preserve close/navigation behavior.** Use `isAutomationContextLoss()` from `context-loss.ts` around recorder readback only after release and treat it as delivered. Keep `page-navigated` classification in `BrowserPageRemote` unchanged; do not catch pre-press failures as success.
7. **Document the board-visible contract.** US-2171 (implemented first) owns the single bump to `1.62.0` and the history line in `assets/guides/agents/boards/bridge-versions.md`. Extend that entry with `checkClick` and `click-not-dispatched`; do not edit `src/shared/board-bridge-version.ts` or add another version heading.
8. **Keep scope and guardrails.** The shared automation layer owns these rules; no board-specific code or rules outside `src/renderer/automation/`. Do not add behavior to roadmap §2.3 god files. Reuse existing actionability, selector evaluation, ref sessions, input sessions, context-loss classification, and `codedError()`; add no protocol code, `await import()`, import-zone wrapper, unit tests, or test harness. Optional UI integration scenarios may be listed under `integration-test/tests/`; Claude runs them.

## Concerns

- A one-shot recorder must distinguish a missing activation from incomplete evidence. A document can be destroyed during a click; context loss during post-release readback is success under US-2171, while setup loss before press remains an error. Other recorder arm/read failures skip the post-release check silently.
- Mouse event target descriptions do not prove DOM node identity by themselves. Record a per-recorder node identity token alongside each short description so replacement clones with matching tag/id/classes/text still compare as changed; do not serialize DOM nodes into the host.
- Events originating in an iframe do not reach the parent window. Listener installation must use the same CDP frame session that receives input; CSS selectors currently resolve in the main frame, whereas direct frame refs can target OOPIF sessions.
- For pointerdown replacement, Chromium's mousedown can target a different ancestor because the original node was detached before mousedown; compare pointerdown to mouseup as the primary press/release pair. Keep mousedown in the record for diagnosis, but do not use it as press identity.
- A target replacement after mouseup but before click dispatch, or a click handler that navigates/closes the page, can leave the recorder unreadable. The bounded settle and context-loss-as-delivered rule prevent false lost-click failures in those cases.
- The recorder is private to one operation and should be removed even if CDP input throws. Do not expose its internal token or raw event log in normal success results.
- Clicks initiated by `mousedown` or `pointerdown` may intentionally remove their target without dispatching `click`; this can be a successful user action. The default browser/board check can report these, so `{ checkClick: false }` is the explicit per-click opt-out and its hint is included in every coded error.
- The post-release check is limited to browser and board locator clicks with the left button. Right/middle clicks, coordinate clicks, and `window.screen` do not install the recorder. `window.screen` still gets the pre-press settle/re-hit-test.

## Acceptance Criteria

- Every trusted locator click on browser, board, and `window.screen` waits one animation frame after `mouseMoved`, re-runs existing actionability hit testing, and re-resolves/moves a replaced target within 3 rounds. A persistent pre-press change fails with the existing actionability-style error naming A → B; an unrelated cover retains the existing actionability error. `force: true` skips this recheck.
- Trusted browser and board left-button locator clicks default to `checkClick: true`; `{ checkClick: false }` disables the post-release check. The option is documented in browser/board click types and help, not on `window.screen`.
- A target replaced by a pointerdown handler with no subsequent click fails during the checked browser/board click call with code `click-not-dispatched` and a message that names A → B when targets differ, or says no click was dispatched otherwise. Every message ends with: `If the page acts on mousedown, pass { checkClick: false }.`
- `clickCount: 1` requires at least one captured `click`; `clickCount: 2` requires at least one captured `click` total and does not require `dblclick`. Right/middle button clicks and coordinate `clickAt` do not run the post-release check.
- Incomplete/unreadable recorder evidence, including a frame that cannot be instrumented, silently returns the click result as today without a warning value or return-type change. Context loss after release counts as success and does not alter existing `page-navigated` semantics.
- `{ synthetic: true }` skips recorder setup and retains its DOM `.click()` behavior.
- Coordinate `clickAt` and `window.screen` skip post-release recording; `window.screen` still uses pre-press settling.
- String selectors arm the recorder in the main frame. Same-process/OOPIF refs arm in the ref session; if arming fails the post-release check is skipped silently.
- The coded error and `checkClick` option pass through browser/board calls and are observable through `window.persephone.call()`. US-2171 owns the epic's only bridge bump; this task extends its 1.62.0 history line and does not bump the version.
- With `requestAnimationFrame` at 60 Hz, stable checked clicks typically add about 2 frames (pre-press and post-release). The bounded maximum is 400 ms plus CDP round trips, including up to two existing actionability re-resolutions during three 50 ms pre-press rounds and one 50 ms post-release settle.
- The plan adds no cross-process protocol, no board-specific rule, no code to roadmap §2.3 god files, no import-zone workaround, and no tests/harnesses.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2173-lost-click-detection/README.md` | This implementation brief. |
| `src/renderer/automation/lost-click.ts` | New focused owner for pre-press frame settling, bounded recheck constants, page-side one-shot recorder, element descriptions, and post-release evidence classification. |
| `src/renderer/automation/mouse.ts` | Apply settle/re-hit-test to trusted locator clicks on all hosts; integrate post-release checking only for browser/board left clicks. |
| `src/renderer/automation/locator.ts` | Factor/reuse current page-side element description and hit-test helpers without changing existing error meanings. |
| `src/renderer/automation/context-loss.ts` | Reuse current context-loss classifier; modify only if a precise post-release helper seam is needed. |
| `src/renderer/api/types/browser-editor.d.ts`, `board-editor.d.ts` | Add `checkClick?: boolean` to browser/board locator click options; preserve `Promise<void>` return types. |
| `src/renderer/api/types/window.d.ts` | Define `IWindowScreenClickOptions` without `checkClick`; no return-type change. |
| `src/renderer/scripting/api-wrapper/AutomationSurface.ts` | Apply the default post-release check only for its existing browser/board host values; disable it for app and internal click-to-focus use. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `BoardEditorFacade.ts`, `board-editor-facade-definitions.ts` | Document the browser/board `checkClick` default and opt-out in existing click help/descriptors. |
| `src/shared/coded-error.ts` | **No changes:** reuse `codedError()` for code `click-not-dispatched`. |
| `src/renderer/automation/input.ts` | **No changes:** this owns keyboard input, not trusted mouse press/release dispatch. |
| `src/renderer/automation/selector-execution.ts`, `page-scripts.ts`, `CdpSession.ts`, `input-session.ts`, `ref.ts` | **No changes expected:** reuse existing evaluation, CDP session, frame-session, and input-session helpers; keep generated recorder source in `lost-click.ts` and factor the hit-test/description from `locator.ts` only if required. |
| `src/shared/board-bridge-version.ts` | **No change in this task:** US-2171 owns the epic's single bump from 1.61.0 to 1.62.0. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend US-2171's 1.62.0 history line with `checkClick` and the coded lost-click error contract. |
| `integration-test/tests/` | Optional UI integration scenario for pointerdown replacement, if useful; Claude runs the suite. No unit tests or new harness. |
| `doc/active-work.md`, `doc/epics/EPIC-208.md` | **No changes:** dashboard entry and epic link already exist, per task request. |
