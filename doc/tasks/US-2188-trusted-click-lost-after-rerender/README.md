# US-2188: Trusted click right after a list re-render does nothing

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — item 11  
**Status:** Closed — not a Persephone bug (see Outcome)

## Goal

Find out why a trusted `site.click(locator)` on a list row's icon button returns success but the
app does not react. Fix it, or make the click fail loudly. A click that reports success must have
reached the element it resolved.

## Background

The pilot suite reports that a trusted click on `role=button[name="Delete <rule>"s]` immediately
after a list loads returns successfully without opening a dialog; synthetic clicks and later manual
clicks work. Replacement, hover and handler attachment are hypotheses, not confirmed causes. The
pilot suite's data-changing buttons must not be used for reproduction.

Source verified: `src/renderer/automation/locator.ts`'s `resolveActionablePoint()` already retries
transient actionability failures, checks connection and the same box across two animation frames
(with 50 ms fallbacks), and hit-tests. It does not treat `opacity: 0` as hidden. `mouse.ts`'s
`clickElement()` then moves the pointer, waits a frame and calls `recheckHitTarget()` up to three
times; it re-resolves replaced selectors, but deliberately ignores `covered` for the same node.
`recheckHitTarget()` uses mapped input coordinates with `elementFromPoint`, which expects local
viewport coordinates; frame offsets need care. It also handles shadow hits differently for refs.

`src/renderer/automation/lost-click.ts`'s `armLostClickRecorder()` observes page events and
`assertClickWasDispatched()` accepts *any* click, without comparing it to the resolved target or
checking `isTrusted`. It also returns success on incomplete recording or absent down/up. A click on
an unrelated overlay or a replacement can therefore pass. A click delivered to the original
button before its listener is attached also passes: DOM dispatch evidence cannot prove application
readiness or that a handler ran. No fixture reproduction has been run by Codex.

## Outcome (2026-11-24): not a Persephone bug — closed without code changes

The reproduction fixture (placeholder rows with the same accessible names, replaced by real rows
after 50, 150 or 300 ms; click issued right after `DOMContentLoaded`) was run against the unchanged
code:

| Replacement delay | Click finished after | Real button | Placeholder button | Events |
|---|---|---|---|---|
| 50 ms | 269 ms | 1 | 0 | trusted pointerdown/mousedown/mouseup/click on the real button |
| 150 ms | 142 ms | 0 | 1 | trusted, all on the placeholder |
| 300 ms | ~146 ms | 0 | 1 | trusted, all on the placeholder |

Every trusted click reached the element the locator resolved at the time of the click. When the
placeholder was the only match, the click went to the placeholder. This is correct, and Playwright
behaves the same. No case showed a click that reported success while reaching nothing.

**Conclusion:**
- The pilot suite's "nothing happens" is an application-readiness race. The row's buttons exist,
  with the same names, before the app has finished loading the list or attached its handlers.
  `{ synthetic: true }` most likely succeeded only because its extra round trip landed after the
  redraw.
- The fix belongs in the test: wait for an app-specific ready condition before clicking, as
  documented in US-2191.
- The stricter click-delivery checks proposed below were not implemented. Nothing showed they are
  needed, and they risk failing clicks that work today.
- The fixture's same-node overlay and cover-between-press-and-release cases do report success
  today even though the click landed on the cover. These are contrived cases. If a real report
  shows one, start a new task from the plan below.
- The reproduction files were removed.

The original plan is kept below for reference only.

## Implementation plan (not implemented)

1. [ ] **Implementer: reproduce first.** Complete steps 2-3 and run the UI test against
   unchanged production code. Record each scenario's pass/fail, timings and any non-reproduction
   in this document before implementing steps 4-5; rerun the same test after the fix. Do not close
   the task merely because the timed race does not reproduce: deterministic cases exercise the
   source gaps. Codex did not run the fixture.
2. [x] Create `integration-test/fixtures/http/browser/automation/input-rerender.html`. Render
   placeholder rows immediately and replace them after 50–300 ms with real rows, using the same
   accessible names; include always-visible and hover-revealed (`opacity`) icon buttons, click
   counters and a dialog marker. Attach real-row handlers with the replacement. Add deterministic
   modes: on pointer move replace the row; on pointer move overlay the same button; on pointerdown
   replace it or cover it before release; and leave a button temporarily without a handler. Record
   trusted event targets, counters and readiness separately. Reset each scenario independently.
3. [ ] Add `integration-test/tests/browser/automation/input/lost-click.test.mjs`, following
   `input.test.mjs`: `test` from `integration-test/lib/context.mjs`, `fixturePage`,
   `openBrowserPage` and `closeBrowserPage` from `integration-test/tests/browser/helpers.mjs`,
   with cleanup in `finally`. Start clicks just after `openBrowserPage` (which waits for
   DOMContentLoaded), vary the replacement delay, and compare trusted and synthetic results.
   Assert the counter/dialog, not just `click()` success. Exercise selector and snapshot ref,
   descendant SVG, hover, same-target overlay, replacement before press and between press/release,
   missing recorder evidence, clickCount 2, and navigation/context loss. Include a frame-offset
   case, open and closed shadow-host retargeting, and a navigation that destroys the context.
   Check `click-not-dispatched` plus a useful message on confirmed wrong-target and complete
   zero-click failures; verify unavailable evidence and navigation retain success, and a dispatch
   that changed state is never automatically replayed. Run
   `npm run test:ui -- --area browser/automation/input` before and after the fix; record observed
   results, including a non-reproduction. No unit tests or separate harness.
4. [ ] **Pre-press owner: `src/renderer/automation/locator.ts`, `recheckHitTarget()`.** Reuse
   `actionabilityFunction()`'s hit-test, tooltip and shadow traversal rules: extract shared
   page-source helpers within this module and use them for selector and ref rechecks. Preserve
   local viewport coordinates alongside mapped CDP input coordinates in `ActionablePoint` (use
   `result.x/y` from `resolveActionablePoint()`); hit-test in the target document's coordinates,
   dispatch using mapped `action.x/y`. Verify `isConnected` for refs; a stale ref fails with the
   existing re-snapshot guidance, never silently substitutes a different node. Apply the existing
   strict ambiguity rules on selector re-resolution.

   In `src/renderer/automation/mouse.ts`, `clickElement()` currently ignores `covered`:

   ```ts
   if (checked.matchesResolvedTarget) { settled = true; break; }
   ```

   Change the decision to require both identity and hit, reusing the existing bounded re-resolution
   and `resolveActionablePoint()` retry/timeout; a transient overlay must be retried until it clears
   or the existing timeout expires, not fail after only three immediate rechecks. If it remains
   covered or changing at the deadline, throw a diagnostic naming the obstruction or replacement.
   Carry one action deadline through re-resolution rather than restarting the timeout. Never press
   on an unchecked point; add no waits:

   ```ts
   if (checked.matchesResolvedTarget && !checked.covered) { settled = true; break; }
   ```

   This resolves hover overlays and replacement before press without adding another stability wait.
   Preserve explicit `{ force: true }` bypass, `{ synthetic: true }`, right/middle clicks and
   `{ checkClick: false }` semantics; these are opt-outs or different input paths.
5. [ ] **Post-press owner: `src/renderer/automation/lost-click.ts`,
   `armLostClickRecorder()` and `assertClickWasDispatched()`.** Reuse the identity created by
   `locator.ts`'s `NODE_IDENTITY_SOURCE` (the frame-local
   `Symbol.for('persephone.automation.node-identities')` WeakMap), rather than a new identity
   registry. Retain the resolved DOM node in the recorder's target frame before dispatch, using
   the existing `evaluateCandidateObject()` in `selector-execution.ts` for a selector or
   `callOnRef()` in `ref.ts` for a ref, and verify its existing identity equals
   `action.identity`; if it has changed, re-resolve before pressing. Release any CDP object in
   cleanup. Record trusted left-button click events during capture, before handlers remove nodes;
   do not re-resolve the locator after dispatch. Compare the event's effective target in
   `event.composedPath()` with the retained node: accept the node, its descendant or ancestor, or
   its shadow host. Compare the effective target, not just any shared ancestor in the path (the
   document and body otherwise make unrelated clicks appear to match). A closed shadow host in
   the path is valid retargeting; an element inside a closed root is not directly resolvable.
   Keep down/up descriptions for diagnostics and assess each observed click for `clickCount > 1`.

   ```ts
   // Before: any click anywhere, or missing evidence, reports success.
   if (!evidence.complete || !requiresClick || hasClick) return;
   // After: positive evidence of a wrong target always fails; no clicks fail only if complete.
   if (evidence.wrongTargetClicks > 0 || (evidence.complete && evidence.clicks === 0))
       throw codedError("click-not-dispatched", "Trusted click did not reach the resolved element.");
   return;
   ```

   A partial multi-click sequence with no observed wrong target remains success: missing evidence
   is not proof of a miss. Apply target matching only when `!options.force`; retain the existing
   recorder behavior for forced clicks, including the covered-element UI test. Preserve success
   if the recorder cannot arm, recording is incomplete, or the context is lost after press,
   including navigation on release; readable positive wrong-target evidence still fails. Keep
   `clickElement()`'s existing context-loss return, and clean up in `finally`. Never retry after
   press or release: handlers can delete data or navigate. Add no waits.
6. [ ] Handler readiness is an application condition, not inferable from DOM input events. For the
   delayed-handler fixture, assert that delivery evidence can succeed while the counter stays zero;
   the suite must wait for an application-specific ready condition before clicking. Do not promise
   that the automation detects missing handlers. Run `npm run lint`, `npm run typecheck`, and
   `npm run i18n:check` after implementation, in addition to the UI test.

## Concerns

- The default checked guarantee applies to non-forced trusted left clicks on non-app targets;
  explicit `force`, `checkClick: false`, synthetic, app-window and other-button paths retain their
  existing semantics. Context loss and missing evidence can still return success without proof of
  delivery. A confirmed error can follow a real side effect, so inspect state before retrying.
  Event capture cannot prove a page handler executed.
- Additional frame waits are unnecessary: reuse the existing two-frame actionability check and
  pre-press frame and actionability retry/timeout; steps 4-5 add no waits. Event-path evidence
  detects observed misses without replay, but cannot prove delivery when evidence is unavailable.
- No board rule, protocol, import-zone workaround, roadmap §2.3 god-file growth or
  `window.persephone` change is planned; a later bridge change requires a
  `BOARD_BRIDGE_VERSION` bump and history line.

## Acceptance criteria

- [ ] Implementer runs steps 2-3 against unchanged source first, records each scenario and its
      outcome here, then implements and reruns the UI test.
- [ ] A normal checked trusted left click fails clearly on a positively observed wrong target or
      complete zero-click evidence; an observed resolved node, related target or shadow host passes.
      Missing evidence and post-press context loss retain success, including navigation.
- [ ] UI scenarios cover timing, hover, frames, shadow DOM, opt-outs, multiple clicks and side
      effects; application readiness limitations are demonstrated. Required checks pass.

## Files needing no changes

`src/renderer/automation/operations.ts` (roadmap god file; orchestration already delegates),
`src/renderer/automation/selector-execution.ts` (reuse existing selector resolution),
`src/renderer/automation/pointer-actions.ts` (reuse `dispatchMouseEvent`),
`src/renderer/automation/ref.ts` (reuse `callOnRef`), `src/board-shim.ts`, board registries,
bridge version/history, `doc/active-work.md`, and other task or epic documents.

## Files changed

| File | Planned change |
|---|---|
| `src/renderer/automation/locator.ts` | Share hit-test logic and retain local coordinates for pre-press recheck. |
| `src/renderer/automation/mouse.ts` | Respect coverage and pass resolved identity while preserving context-loss success. |
| `src/renderer/automation/lost-click.ts` | Validate observed trusted click targets against the resolved node and its relations. |
| `integration-test/fixtures/http/browser/automation/input-rerender.html` | Local timing and deterministic race fixture. |
| `integration-test/tests/browser/automation/input/lost-click.test.mjs` | UI reproduction and regression scenarios. |
| `doc/tasks/US-2188-trusted-click-lost-after-rerender/README.md` | Record implementer reproduction results before the fix. |


