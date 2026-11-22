# US-2150: Browser input: scroll containers, focus, drag by offset, coordinates

**Epic:** [EPIC-203](../../epics/EPIC-203.md) · **Proposals:** E1, E4, E6, E7 · **Feedback:** [US-2138](../US-2138-web-app-test-feedback/README.md), items 16, 18 and input half of 21

## Goal

Make trusted browser input reach clipped elements and support focus without a click, offset drags and page-viewport coordinates. Keep existing input and transport paths and existing defaults.

## Background

- `src/renderer/automation/locator.ts`'s `actionabilityFunction()` only scrolls before the hit test when the element's box extends outside the window. Its later centered scroll happens only when the hit element contains the target; a clipped list item can instead hit the popup opener. The timed retry reports the hit element, not necessarily the clipping container. The same script rejects any `position` outside the border box, including with `force`.
- `src/renderer/automation/keyboard.ts`'s `keyboardAction()` resolves an explicit target then calls `clickElement()` before key dispatch. The default is a trusted click; `{ synthetic: true }` makes that click synthetic. The same `IBrowserKeyboardOptions` is used by `pressKey`, `keyDown`, and `keyUp`. A targetless key focuses the host and uses its input session.
- `src/renderer/automation/mouse.ts` implements `dragElements`, `clickAtCoordinates`, `dragCoordinates`, and the common `dispatchDragPoints`: four moves, HTML5 drag interception/replay, a same-session/frame check, and release plus interception cleanup in `finally`. The app-window guard prevents a trusted HTML5 drag from entering a blocking native OS drag loop. `clickAtCoordinates` validates non-negative finite points; `dragCoordinates` currently does not. `window.screen` exposes coordinate calls in `src/renderer/api/window-screen.ts`.
- `src/renderer/scripting/api-wrapper/AutomationSurface.ts` is shared by `BrowserEditorFacade`, the separate `BoardEditorFacade`, and `window.screen`. `run()` performs target readiness and, for non-passive actions, `withAutomationActivity`; the browser facade's `PageWrapper` access restriction uses `agentMayAccessBrowserPage`, while the window-screen descriptor has its own stricter restriction. `BrowserTargetModel` and `BoardTargetModel` implement `inputCdp` using `createInputSession`; board frames are separately registered and `src/main/cdp-service.ts` routes board CDP input. The browser target handles selected tabs and owned popups. Coordinate values are document viewport CSS pixels, not physical screen pixels.
- `src/test-host/browser-helpers.ts` returns an editor handle; `src/test-host/app-proxy.ts` turns its calls into paths and JSON argument arrays through `context.ts` and `client.ts`. `src/board-shim/bridge-actions-api.ts` and `main-port-channel.ts` forward `persephone.call()` to the same call tree. Neither caller needs a new transport. `BROWSER_AUTOMATION_MEMBERS` in `src/renderer/scripting/ai-vision/browser-automation-members.ts` describes the shared members for both facades and `window.screen`.

## Implementation Plan

- [x] **E1 — actionability and clipping.** Owner: `src/renderer/automation/locator.ts`, reusing `resolveCandidatesSource`, `describe`, the existing retry/stability checks and frame/ref path. Preserve the outside-window centered scroll exactly: its margin protects against sticky headers, and the code also serves `window.screen`. Only when the box is inside the window, scroll with `block: "nearest", inline: "nearest"` before stability and hit testing. Re-read the box. Preserve the existing hit-an-ancestor centered-scroll repair. Only after a hit-test miss, walk composed ancestors looking for computed overflow other than `visible` on an axis whose client box excludes the point; name the nearest clipping container with `describe` in the transient error, otherwise retain the covered-by-hit diagnostic. Do not add clipping checks to the success path or mistake an unrelated overlay for a clip. Keep retry, attachment, visibility, stability, enabled, ambiguity, pointer and `force` behavior. Oversized and unscrollable targets may remain clipped. Keep iframe/ref routing and report only a boundary that can be inspected.

  ```ts
  // Before
  if (beforeScroll.top < 0 || beforeScroll.left < 0 || beforeScroll.bottom > innerHeight || beforeScroll.right > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  // After
  if (beforeScroll.top < 0 || beforeScroll.left < 0 || beforeScroll.bottom > innerHeight || beforeScroll.right > innerWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
  } else {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  ```

- [x] **E4 — programmatic focus.** Add `src/renderer/automation/focus.ts` as the one owner of focus without pointer input. Reuse `resolveActionablePoint(..., { hitTest: false })`, `runOnLocator` / `callOnRef`, `getRefSessionId`, and the target's `inputCdp` and `focusWebview`: resolve the same visible, attached, stable, enabled target and selected frame, focus the host, call the element's DOM `focus()` in its own document/session, verify focus (including shadow-root active element), and return that same input session for keyboard dispatch. Report a clear failure when the element cannot be focused. Do not require pointer hit testing or fire a click. Preserve ref stale and selector ambiguity behavior. Use `focus: "focus" | "click"` in `IBrowserKeyboardOptions` and `KeyboardActionOptions`; omitted means current click behavior. Apply the option consistently to `pressKey`, `keyDown`, and `keyUp` because they share the options and helper; no target keeps the existing targetless path. `src/renderer/automation/keyboard.ts` delegates its new branch to `focus.ts`, leaving synthetic key semantics intact.

  ```ts
  // Before
  await clickElement(target, locator, options);
  // After (default preserved)
  if (options.focus === 'focus') return focusElement(target, locator, options);
  await clickElement(target, locator, options);
  ```

- [x] **E6 — offset and timing.** Owner: `src/renderer/automation/mouse.ts`, reusing `resolveActionablePoint` and `dispatchDragPoints`; move the drag-specific implementation into a single-purpose `src/renderer/automation/drag.ts` collaborator if needed, with direct imports in the allowed automation zone. Support `drag(source, { by: { x, y } }, options?)` in addition to the existing destination locator form. Compute the end from the resolved source point in its existing input session, without resolving or hit-testing a destination element. Permit an outside-box `targetPosition` for a destination locator by resolving and checking that destination at its normal in-box anchor first, then applying the requested finite local offset to its measured box; the resulting endpoint is deliberately not required to hit that destination. Keep the source `position` inside its border box and hit-tested: an outside start cannot establish that the intended element receives the press. Retain finite-coordinate checks, selector ambiguity, actionable source and destination anchor, same-frame rejection for two locators, and app-window HTML5 guard; `force` retains its existing skip semantics. Explicitly reject invalid/non-finite `by` or positions and malformed destination objects, without treating a `{ ref }` as `{ by }`.

  Add `steps?: number` and `holdMs?: number` to drag options: default four moves and zero added hold; validate positive integer steps (maximum 1000) and finite non-negative hold (maximum 10000 ms), before pressing. The cap leaves room under the default editor-call renderer bridge deadline, `REQUEST_TIMEOUT_MS = 30_000` in `src/main/renderer-rpc.ts:12`; `src/main/mcp/tools/call-tools.ts:125` lists the wait methods that receive extensions, and drag is not among them. Actionability and dispatch also consume the deadline, so the cap cannot guarantee completion before timeout. `holdMs` is the delay after press and before the first move; preserve the existing interception wait and `finally` release even on errors. Apply timing to both locator and coordinate drags via the common dispatcher, including `window.screen` only when its existing signature explicitly gains options. No new drag intercept protocol.

  ```ts
  // Before
  await editor.drag('#handle', '#next', { targetPosition: { x: 8, y: 8 } });
  // After; the old form remains valid
  await editor.drag('#handle', { by: { x: 40, y: 0 } }, { steps: 12, holdMs: 100 });
  ```

- [x] **E7 — coordinates.** Add shared `AutomationSurface` methods calling the existing `clickAtCoordinates` and `dragCoordinates`; expose `clickAt(position, options?: { tabId?: string })` and `dragTo({ from, to }, options?: { tabId?: string; steps?: number; holdMs?: number })` on browser and board editor facades. Board pages have their own facade and should receive these too: coordinates are relative to the selected board frame's viewport, not the host window. Browser coordinates are relative to the selected tab/popup's main viewport, not iframe-local coordinates; choose an iframe ref for locator actions. Use `inputCdp(tabId).mapPoint` and the existing CDP board-frame routing, never manually add webview, window, display, device-scale, or board offsets. Focus the host for coordinate clicks/drags as needed for subsequent keys, matching trusted element click. For the new editor coordinate methods validate both endpoints as finite and non-negative, like `clickAtCoordinates` in `src/renderer/automation/mouse.ts:129`, and let the page clip points beyond the viewport. The `innerWidth`/`innerHeight` read in `src/renderer/automation/snapshot.ts:523` is inside snapshot evaluation, not a reusable cheap input helper; do not add a CDP round trip solely to check bounds. Preserve existing `window.screen` coordinate validation and behavior when no new options are used. Keep same-session and native drag guards. No new coordinate transport or synthetic input path.

  ```ts
  // Existing window API; new editor methods use the same argument shapes
  await editor.clickAt({ x: 120, y: 80 });
  await editor.dragTo({ from: { x: 120, y: 80 }, to: { x: 170, y: 80 } }, { steps: 12 });
  ```

- [x] **Surface and contracts.** Add `focus` to `AutomationSurface`, `BrowserEditorFacade`, `BoardEditorFacade`, and `WindowScreen` because `describeWindowScreen` spreads `BROWSER_AUTOMATION_MEMBERS` at `src/renderer/scripting/ai-vision/namespaces/window-screen.ts:103`, making the shared descriptor expose it there too. `scripts/describe-tables-check.mjs:213` checks editor facades, not `WindowScreen` directly; the shared descriptor itself requires the window implementation. Add the coordinate methods to the two editor facades; use the shared surface as the only adapter. Update `src/renderer/api/types/browser-editor.d.ts`, `board-editor.d.ts`, and `window.d.ts` for the overload/union, new focus and coordinate methods, and options. Keep `BrowserTargetModel` and `BoardTargetModel` as target adapters: their existing `inputCdp` is the required seam, not a second public input implementation. Verify their selected tab/popup and frame mapping before changing them; no change is planned if their existing routing passes. All new actions go through `AutomationSurface.run` with `passive: false`, readiness enabled and activity lease; use `tip: true` for editor input consistently with `click`/`drag`, and `tip: false` for window-screen coordinate calls. Preserve the `PageWrapper` private-page gate and `window.screen` restriction, and test refusals through MCP rather than assuming `runHostOperation` itself enforces access. No runner changes are needed: its proxy forwards these JSON arguments unchanged.
- [ ] **Discovery and guides.** In `src/renderer/scripting/ai-vision/browser-automation-members.ts`, add `focus` and update `pressKey`, `keyDown`, `keyUp` and `drag` signatures/summaries, including default click, offset, timing, frame and position rules. Add editor coordinate descriptor entries to `BROWSER_EDITOR_MEMBERS` in `BrowserEditorFacade.ts` and `BOARD_AUTOMATION_TAB_MEMBERS` in `board-editor-facade-definitions.ts`, with their own viewport wording; retain `WINDOW_COORDINATE_MEMBERS` in `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` for app-window wording. Update the long help strings in `BrowserEditorFacade.ts`, `board-editor-facade-definitions.ts`, and the window-screen namespace. `scripts/describe-tables-check.mjs` checks each public facade method against its static member list; run `npm run lint` and ensure every added method is declared, without hiding it or adding an allowlist exception. At epic `/userdoc`, update `assets/guides/agents/browser.md` (host table, shared-member count, focus, coordinates, scrolling and drag rules), `assets/guides/agents/web-app-tests.md` (one runner example/sentence), and `assets/guides/agents/boards/bridge-versions.md` (history below). Guide edits other than the bridge history belong to `/userdoc`.
- [x] **Board bridge.** This changes what a board can receive through `window.persephone.call()`: `$help`/`$describe` gain members/options and changed descriptions, and existing input calls can succeed or produce a clearer clipping error where they previously failed. It does not add a `window.persephone` property, change ordinary action success result shape or key order, or introduce error codes/envelopes; nevertheless the descriptor result shape is observable. US-2150 bumps `src/shared/board-bridge-version.ts` from `1.58.0` to `1.59.0` and adds one `1.59.0` history line in `assets/guides/agents/boards/bridge-versions.md` describing its input additions. This is one bump for the entire unreleased epic: US-2151 and US-2152 extend that same `1.59.0` history line without another bump. Preserve the existing board RPC and `PendingRequests`/wire-error machinery.
- [x] **Guardrails.** New behavioral rules belong to the automation modules above; facades are thin delegates. No board identity, manifest, trust or capability rule is added outside `src/shared/board/` and registries. Roadmap §2.3 files including `BrowserWebviewModel`, `BoardEditorModel`, and `src/main/cdp-service.ts` do not grow; extract a one-job collaborator if new behavior needs one. No new correlator, acknowledgement window or error envelope, dynamic import to bypass a cycle, import-zone wrapper or zone exception. Automation and scripting are strict folders in `scripts/typecheck-strict.mjs`; preserve strict null checking and fix declared types first.

## Concerns

- `scrollIntoView` cannot make an oversized item wholly fit in a smaller clipping ancestor, and clipping by a cross-origin ancestor frame may be outside the document's DOM. The contract is to scroll what can be scrolled and give an honest clipping diagnostic when the chosen point still cannot receive input, not to bypass an overlay or promise impossible geometry.
- The outside-box destination position is an intentional exception to the old refusal; keeping an actionable anchor does not assert that the actual drop point hits the destination. A `by` endpoint can similarly land on another element. Cross-frame locator drags remain refused. Do not change click/hover position validation.
- Focus is DOM focus, not a trusted click or a trusted `focus` event; some elements cannot accept focus. Confirm focus in the target frame before sending keys. Existing `synthetic` key behavior remains separate from the focus choice.
- Coordinate commands bypass locator hit testing and can act on whatever is at the point. Viewport emulation, device scaling, board-frame routing and popup selection need live verification. A cross-origin frame is not addressed by its own local coordinates through a main-viewport call.
- Decisions made here: `focus: "focus"` with default `"click"`; `drag(source, { by }, options)`; `holdMs` means a pre-move hold; expose focus and coordinates on board and app hosts where the shared surface applies. No unresolved implementation decision is required.

## Acceptance Criteria

- [ ] A clipped popup item in nested horizontal/vertical scroll containers is scrolled into view and receives the trusted click; an unscrollable clipped target reports its clipping container, while an unrelated overlay is still named as covering it. Force, ambiguity, stability, disabled and stale-ref behavior remain intact.
- [ ] `focus` and `pressKey(..., { target, focus: "focus" })` deliver focus/key events without click or pointer events, including ref/frame cases; default targeted key behavior still clicks, and an unfocusable element fails clearly. `keyDown`/`keyUp` honor the same option.
- [ ] Offset drag and outside `targetPosition` reach the expected point; default four-step drags and existing locator signatures still work. Validate invalid offsets, timing and source positions; cross-frame and unsafe app-window HTML5 drags remain refused and held input is released on failure.
- [ ] Browser and board `clickAt` / `dragTo` use selected viewport CSS pixels, work with tab IDs, and preserve existing input routing, privacy restrictions and non-passive activity. `window.screen` retains its existing coordinate behavior.
- [ ] `$help` / `$describe`, type declarations and bridge version/history match the implemented surface. Runner handles and board `persephone.call()` reach the same members without protocol changes. `npm run lint` and `npm run typecheck` pass; no unit tests or test harnesses are added. No catalog messages are planned: existing automation errors in `locator.ts`, `mouse.ts` and `keyboard.ts` are English strings, so `npm run i18n:check` is not required for this task.
- [ ] **Live verification by Claude with the Persephone MCP `call` tool:** open one disposable local HTTP page in a browser page Claude opened, containing a scrollable popup list, a draggable handle, a focus-sensitive input and an event log. Inspect `pages["<id>"].editor.$help` for the new signatures. Click a clipped list item and verify its scroll and trusted click. Call `focus` and `pressKey` with `focus: "focus"`, checking the log for focus/key events without pointer or click events; check that the default targeted key still clicks. Drag by offset, use an outside `targetPosition`, and perform a slow drag; inspect the recorded movement and release. Use `clickAt` and `dragTo` on measured viewport points and check recorded `clientX`/`clientY`. For example, call path `pages["<id>"].editor.pressKey` with args `["Enter", {"target":"#field","focus":"focus"}]`. Do not add a committed fixture or harness.

  Optional broader checks, outside this required local-page run: viewport emulation, board main and secondary frames, iframe refs, runner handles and board `persephone.call()` repetitions.

## Files Changed

| Path | Planned change |
|---|---|
| `src/renderer/automation/locator.ts` | Scroll and diagnose clipping; narrowly support checked drag destination anchors. |
| `src/renderer/automation/focus.ts` | New focus owner, reusing locator/ref/input helpers. |
| `src/renderer/automation/keyboard.ts` | Focus-mode dispatch. |
| `src/renderer/automation/mouse.ts`; optionally `src/renderer/automation/drag.ts` | Offset/timed drag and coordinate validation via the existing dispatch. |
| `src/renderer/scripting/api-wrapper/AutomationSurface.ts` | Shared, activity-wrapped input adapters. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `BoardEditorFacade.ts`, `board-editor-facade-definitions.ts` | Thin facade delegates and help. |
| `src/renderer/api/window-screen.ts` | Shared focus and optional drag timing delegation. |
| `src/renderer/api/types/browser-editor.d.ts`, `board-editor.d.ts`, `window.d.ts` | Public declarations. |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Describe tables and help. |
| `src/shared/board-bridge-version.ts`, `assets/guides/agents/boards/bridge-versions.md` | Version bump and history. |
| `assets/guides/agents/browser.md`, `assets/guides/agents/web-app-tests.md` | Later epic `/userdoc` updates. |

**No changes:** `src/test-host/` (generic proxy), `src/renderer/editors/browser/BrowserTargetModel.ts` and `src/renderer/editors/board/BoardTargetModel.ts` (existing target seams, subject to live verification), `src/main/cdp-service.ts` (existing board routing), `src/board-shim/` and `src/ipc/board-bridge/` (existing protocol), `doc/active-work.md`, and `doc/epics/EPIC-203.md`.

