# EPIC-208: Input fidelity for web-app tests

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 6 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (section 3 E and G2). Trusted
input in browser pages still differs from a user's pointer in three ways the pilot suite hit: a click whose target is
re-rendered by a hover handler silently produces no `click`, CSS `:hover` is not applied so hover-revealed controls
stay invisible, and there is no press / move / release member to inspect a gesture while the button is held. Separately,
a page model disappears for a moment after a same-document (SPA) navigation. This epic closes those, plus two
follow-ups from [EPIC-207](EPIC-207.md): a `destroyed` listener leak on WebContents, and a click that closes its own
popup being reported as an error.

Steps 1a–5 ([EPIC-202](EPIC-202.md) … [EPIC-207](EPIC-207.md)) are done. This epic touches the same input and locator
code as [EPIC-203](EPIC-203.md) (scroll-into-view, focus, drag by offset, `clickAt`) and [EPIC-206](EPIC-206.md)
(`selector-execution.ts`).

Proposals covered: **E2, E3, E5, G2** (E7 was done in EPIC-203). Feedback items of
[US-2138](../tasks/US-2138-web-app-test-feedback/README.md) closed: 5, 10, 17, and the bridge half of 2 (the rest of
1 was closed by G1 in EPIC-203). Out of scope: guides and scaffolding (step 7).

## Goals

- **E2** A click that produced no `click` event is reported, naming the element change between press and release
  (A → B); the hit target is re-checked one frame after the pointer move.
- **E3** `hover()` applies CSS `:hover` in browser pages (CDP `CSS.forcePseudoState` on the target and its ancestors
  until the next pointer action) and `click` hovers first by default — or, if the spike finds forcing not workable,
  the "not visible" error names `hover()`.
- **E5** `mouseDown`, `mouseMove`, `mouseUp`, `wheel` with a locator or page coordinates; the runner releases a held
  button at test end, as it does for held keys.
- **G2** A page-model read during a same-document re-probe waits for the probe (bounded) instead of answering
  `"app" is not a member`.
- **Follow-ups:** one WebContents `destroyed` listener per WebContents (no `MaxListenersExceededWarning`); a click
  that closes its own popup window counts as delivered.

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2171](../tasks/US-2171-input-follow-ups/README.md) | EPIC-207 follow-ups: destroyed-listener leak, click that closes its popup | — | Done |
| [US-2172](../tasks/US-2172-hover-pseudo-state/README.md) | `hover()` applies CSS `:hover`; click hovers first (spike) | E3 | Done |
| [US-2173](../tasks/US-2173-lost-click-detection/README.md) | Detect a click that produced no `click` | E2 | Done |
| [US-2174](../tasks/US-2174-pointer-members/README.md) | Low-level pointer members | E5 | Done |
| [US-2175](../tasks/US-2175-model-across-spa-navigation/README.md) | Page model reachable across a same-document navigation | G2 | Done |

Order: US-2171 first (small, and it changes the click error path E2 also touches), then US-2172 before US-2173 (if
`click` hovers first, the press/release sequence E2 instruments changes), then US-2174 (its pointer actions end the
forced hover state US-2172 adds), and US-2175 at any point (separate code: `BrowserPageRemote`). Investigations of
independent tasks may run in parallel; implementations run one at a time, each staged after review. If the budget runs
out, the epic stops at a task boundary and the rest becomes the next epic.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices.

1. **One owner per rule.** Pointer fidelity (E2, E3, E5) lives in the shared automation layer
   (`src/renderer/automation/`: `mouse.ts`, `input.ts`, `locator.ts`, `input-session.ts`), so every caller (browser
   editor facade, board pages, `window.screen`, the runner) gets it. Page-model reachability (G2) stays in
   `BrowserPageRemote`. A CDP domain new to the app (`CSS` for E3) gets its own collaborator, not more code in a
   roadmap §2.3 god file.
2. **Spikes decide from evidence.** E2 and E3 start with an investigation that reproduces the behaviour (or explains
   why it cannot) before a plan. "Not workable" with the fallback implemented is a valid outcome for E3: the fallback
   is the `hover()` hint in the "not visible" error.
3. **Additive and conservative defaults.** Existing members and options keep their meaning. Where a default changes
   (`click` hovering first, a lost-click report), the plan states the opt-out and why the new default is safe for the
   UI integration suite and `window.screen`. A lost click is reported as an error only when the evidence is certain
   (press and release targets differ, or no `click` arrived on a target that should have received one); otherwise the
   click returns as today (revised at plan review: no warning result, so no return-type change).
4. **E5 cleanup mirrors held keys.** A button held by `mouseDown` is released at test end by the same runner cleanup
   that releases held keys (`keyUp`), and by the automation session when the page goes away.
5. **G2 is bounded.** A read waits for an in-flight re-probe only up to a short bound (the plan names it, as a grouped
   tuning constant), then answers as today. No new correlator: the wait reuses the existing probe promise.
6. **No new protocol code.** Renderer → main calls go through the existing browser IPC / typed RPC used by the other
   CDP features; a new correlator, ack window or error envelope is a review blocker.
7. **Bridge version.** New members reach boards through `window.persephone.call()`. The first task that adds a
   board-callable member or changes a board-observable result bumps `BOARD_BRIDGE_VERSION` once for the epic
   (`1.61.0` → `1.62.0`) and writes the history line in `assets/guides/agents/boards/bridge-versions.md`; later tasks
   extend that line without another bump.
8. **Guardrails.** Strict folders stay strict (`npm run typecheck`). Implementation briefs forbid `build-prod` (it
   wipes the running dev build), `.gitignore` edits and changes to shipped demo boards.

## Notes

### 2026-11-22
- Epic created from roadmap step 6. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Regression found and fixed by Claude before planning (US-2171):** every site extension and temporary extension on
  browser pages failed to inject ("Browser target could not be attached for injection.") since EPIC-207's `/review`
  refactor: `cdp-service.ts` passed `onAiVisionSignalCallback` by value into `createCdpLifecycleMethods()` while
  building the service object at module load, before `startCdpService()` set it. Now passed as a getter.
- **Spike conclusions.**
  - *E3 (US-2172), workable.* Live: native trusted `mouseMoved` already applies `:hover` in the guest (the guide's
    "`:hover` does not apply" was wrong); the verified gap was that `click` checks visibility before moving the
    pointer. `CSS.forcePseudoState` works (5 ms), but a later `DOM.getDocument` (snapshot, forms) invalidates node ids
    and strands a forced style that cannot be cleared by id; `CSS.disable` clears every forced state, so clearing is
    by `CSS.disable` only. `hover()` forces `:hover` on target and composed ancestors until the next pointer action;
    `click` reveals (once, only after a "not visible" result) by default, `hoverFirst: false` opts out; the error names
    `hover()`. App window unchanged.
  - *E2 (US-2173).* Reproduced: an element replaced on `pointerdown` gets press on the old node, release on the new
    one, no `click`, and `click()` returned success. Root cause of the feedback case: automation pressed before the
    hover re-render landed. Primary fix: wait one frame after the move, re-hit-test, re-resolve a replaced target (3
    rounds). Post-release check (browser/board, left button only, not `window.screen`, not `clickAt`) throws
    `click-not-dispatched` naming A → B; `checkClick: false` for pages that act on mousedown. No warning result.
  - *G2 (US-2175).* Cause: `onLoadStart()` cleared the registration and bumped the document generation on
    `did-start-loading`, which Chromium also fires for same-document navigation; a model method that itself did
    `pushState` failed "The page navigated while converting model element refs." The clear was removed (cross-document
    commit still clears); a read during a real probe waits up to 250 ms.
  - *Follow-ups (US-2171).* The listener warnings came from `onWebContentsGone()` adding native listeners per
    subscription (concurrent callers) and `BrowserPopupRegistry` adding one per popup on the shared app renderer; the
    helper now shares one native listener per WebContents/event. Recording-service leaked its subscription. The
    popup-close click: the release command fails with "target closed while handling command" or "WebContents not found
    or destroyed"; both are context loss at the release boundary, so the click counts as delivered.
- **Fixes by Claude during review/verification.** `onWebContentsGone` rewrite (Codex's version left a non-repeat
  subscription's other events active after the first event fired); click with `clickCount: 2` returns after a release
  context loss; hover forcing is best effort (never fails a hover that happened) and a failed reveal leaves the normal
  retry in charge; the pre-press recheck no longer throws when a hover tooltip covers the same element (old behaviour
  kept); a malformed recheck body (invocation passed where a function is expected); "WebContents not found or
  destroyed" classified as context loss; `app` is listed only while a model exists or a probe is running (Codex listed
  it on every browser page).
- **Bridge.** `BOARD_BRIDGE_VERSION` 1.61.0 → 1.62.0 once, in US-2171; later tasks extended the history line.
- **Decision 3 revised** at plan review: no warning result (an uncertain check returns silently). The post-release
  check also stays silent unless both a press and a release were recorded (a recorder that saw nothing may be in the
  wrong frame or window).
- **Live verification (dev app, MCP and an attached scratch runner suite on a local lab page, 6/6 twice, also after
  the `/review` refactor).** E3: `click` on a `visibility: hidden` until `:hover` button succeeds with no `hover()`;
  `hoverFirst: false` fails with the `hover()` hint; `hover()` keeps `:hover`, a later snapshot (`DOM.getDocument`)
  then a click elsewhere clears it. E2: an element replaced on `pointerdown` fails with `click-not-dispatched` (A → B);
  `checkClick: false` passes; a hover re-render cell and a hover tooltip child click normally. E5: press on day 2,
  move to day 6 in 5 steps, 5 days marked while held and no release log; `mouseUp` logs `range=5`; `wheel` scrolls
  the list 120 px; `releaseFromTestRun` releases a held button (page saw `pointerup`). G2: `app.navigate("/b")` (a
  model method that pushes state) returns `/b`, an immediate `app.route` reads `/b`, link-driven `pushState` too.
  Popup closing itself on `mousedown`: `click("#finish", { tabId })` succeeds, opener gets the message. Listener counts
  stayed at 5 `destroyed` per WebContents after the runs; no `MaxListenersExceededWarning` in the dev log.
- **Checks.** `npm run lint`, `npm run typecheck` (18 strict folders, 0 errors), `npm run guides:check` (137 pages),
  `npm run i18n:check` (no catalog changes, all packs complete). `npm run test:ui -- --area core` 36 passed;
  `browser/automation/input` 20 passed (two assertions in Codex's new hover test fixed: `:hover` is on the row, not
  the button; the pointer must leave the row before the `hoverFirst: false` check). `boards/bridge`: the version test
  still expected 1.58.0 (stale since EPIC-203); updated to 1.62.0. `--area browser` 112 passed, 3 failed, 2 skipped:
  all three are trusted input not reaching popup windows (`browser/popups`). Standalone `browser/popups` runs with
  the epic: 4, 4, 0, 0, 1 failures (the first run overlapped a source edit; the last failure is `waitForResponse`);
  on `HEAD` with the epic stashed: 1, 0 (the same `waitForResponse`). EPIC-207 recorded 8 such popup-input failures
  on `HEAD`; the intermittent popup-input delivery is pre-existing and is a follow-up, not caused by this epic. The
  OAuth close test passed in the last three standalone runs.
