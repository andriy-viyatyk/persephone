# EPIC-203: Browser automation fixes for web-app tests

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 1b of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap: the small fixes to browser
automation (`src/renderer/automation/`), the browser editor and its page-model bridge (`BrowserPageRemote`), ai-vision
result shaping, and the browser context-menu path. Step 1a ([EPIC-202](EPIC-202.md)) fixed the runner; this epic
fixes what the runner drives. Every change benefits any agent that drives a browser page, not only tests.

Proposals covered: **E1, E4, E6, E7, G1, G3, G4, H1, H2, A5**. Feedback items of
[US-2138](../tasks/US-2138-web-app-test-feedback/README.md) closed: 4, 8 (or documented), 15, 16, 18, 21 (input half),
22 (menu half) and half of 1.

## Goals

- Trusted input reaches elements an app hides inside its own scroll containers, can focus without clicking, can drag
  by an offset or to a point outside the element, and can click or drag by page coordinates (E1, E4, E6, E7).
- A page-model call that navigates the page reports that it did, instead of a raw "Cannot find context" error; a long
  reply is never cut silently; a reply keeps its key order (G1, G3, G4).
- An agent's first Playwright guess works or is answered in one line, and a right-click from automation does not leave
  Persephone's own context menu blocking every later call (H1, H2, A5).

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2150](../tasks/US-2150-browser-input-fixes/README.md) | Browser input: scroll containers, focus, drag by offset, coordinates | E1, E4, E6, E7 | Done |
| [US-2151](../tasks/US-2151-page-model-replies/README.md) | Page-model replies: navigation, truncation, key order | G1, G3, G4 | Done |
| [US-2152](../tasks/US-2152-playwright-names-right-click/README.md) | Playwright names, "did you mean", automation right-click | H1, H2, A5 | Done |

Order: US-2150 → US-2151 → US-2152. US-2152's aliases map onto members US-2150 adds (`focus`), so it goes last.
Investigations may run in parallel; implementations run one at a time, each staged after review.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices.

1. **Additive only.** Existing members, options, defaults and error texts keep their meaning; every change is a new
   member, a new option, or a clearer error where there was a wrong or silent result. The UI integration suite and
   EPIC-202's runner keep working unchanged.
2. **One owner per rule.** Input changes live in the shared automation layer (`src/renderer/automation/`), so every
   caller (browser editor facade, board pages, the runner) gets them. Page-model call handling stays in
   `BrowserPageRemote`; result shaping stays in ai-vision's shaping code. No call-site special cases.
3. **E7 reuses the existing coordinate input.** `clickAt` / `dragTo` on browser pages call the same automation input
   path `window.screen` uses (trusted CDP input), translated to the page's coordinate space; no second input path.
4. **H1 uses real hidden aliases** (review open question 2): each alias resolves to the same implementation as its
   Persephone member, is callable through `call`, and is left out of `$help` member lists to keep them short. Where an
   alias needs an argument mapping (`dblclick` → `click(…, { clickCount: 2 })`), the mapping is the only code it adds.
5. **H2 "did you mean"** is a one-line answer in the existing unknown-member error, from one static table of
   Playwright names; it extends the existing "Did you mean" suggestion rather than adding a second error path.
6. **A5 default.** An automation right-click (`click(…, { button: "right" })` and friends) does not open Persephone's
   own browser context menu; `{ nativeMenu: true }` opts in. A user's own right-click is unchanged. The page's own
   `contextmenu` handlers still run.
7. **G4.** Keep insertion order if the sorting is ours (ai-vision shaping); if it comes from a layer we do not control
   or that other callers rely on, document the behaviour instead and record why.
8. **G3.** A cut reply fails with a coded error naming the cap and the option that raises it; model replies on the
   test-runner path are unbounded by default, as scripts and boards already are (`call-limits.ts`).
9. **Bridge version.** If any of these changes what a board receives from `persephone.call()` (result shape, key
   order, error codes) or adds to what `window.persephone` exposes, the task bumps `BOARD_BRIDGE_VERSION` and adds a
   history line to `assets/guides/agents/boards/bridge-versions.md` (refactoring guardrail 6). New members in the app
   object tree reached through `call` follow existing practice for such members; each plan states which case applies.

## Notes

### 2026-11-22
- Epic created from roadmap step 1b. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Plan review decisions.**
  - *E1* keeps the existing centered scroll when the target is outside the window (the same actionability script
    serves `window.screen` and the UI suite; center keeps a margin from sticky headers) and adds a `nearest` scroll
    only when the target is inside the window. The clipping container is named only in the failure path.
  - *One bridge bump for the epic*: `BOARD_BRIDGE_VERSION` 1.58.0 → 1.59.0 in US-2150, one history line extended by
    US-2151 and US-2152 (the version is unreleased).
  - *G4 attributed live*: the sort happens at Chromium's CDP by-value transfer (`Runtime.callFunctionOn` with
    `returnByValue`), not in ai-vision or MCP: `editor.evaluate` showed the same sorting while the page's own
    `Object.keys` kept insertion order. Fixed for page-model replies only (the page returns `JSON.stringify` of the
    response); `editor.evaluate` keeps the by-value semantics and sorted keys, documented with the
    `JSON.stringify` workaround. Candidate for roadmap step 4 (D4).
  - *G3 attributed live*: the 365-row reply arrived as 220 rows because ai-vision's page-side `shapeResult` cut it at
    its 20,000-character default and `createRemoteProxy` dropped the `truncated` metadata. The host now passes the
    effective `maxLength` to the page and turns a reported cut into `result-truncated`.
  - *`allowNavigation`* is a `call` option (like `timeoutMs`, it applies only under `pages[i].editor.app`), so it
    never collides with a model method's own arguments. Scripts' `app.call` and boards do not take it (they get the
    `page-navigated` code path only).
  - *A5*: a renderer-side per-tab guard (`BrowserAutomationMenuGuard`), consume-once with a 500 ms expiry after the
    release, armed through an optional automation-target hook only `BrowserTargetModel` implements. No main-process
    or IPC change. Accepted limitation: a physical right-click on the same tab inside the grace window after an
    automation right-click whose menu the page prevented loses its Persephone menu once.
  - *H1/H2* need two ai-vision extension points (hidden members, an exact `suggest(name)` line). ai-vision is the
    user's own package; this run did not publish it. They ship as `patches/ai-vision+1.4.0.patch` (patch-package,
    applied on postinstall), shaped as the future upstream API. **Follow-up:** upstream into ai-vision and drop the
    patch.
- **Fixes by Claude during live verification.** CDP reports a context lost to navigation as either "Cannot find
  context with specified id" or "Inspected target navigated or closed"; the second (the common one) was missing, so
  `page-navigated` never fired. Property reads (`ai:get`) are shaped in the page too, so the truncation check now
  covers them as well as method calls. The H2 suggestion texts were rewritten to read as the end of the resolver's
  "Did you mean …?" line.
- **Live verification (dev app, local HTTP page with a temporary extension).** E1: a list item clipped inside its
  scrolled pop-up is scrolled into view (container only, window unmoved) and clicked. E4: `focus()` and
  `pressKey(…, { target, focus: "focus" })` give `focus` + key events with no mousedown/click; the default still
  clicks. E6: `drag(source, { by })` with `steps: 12, holdMs: 100` lands exactly with 12 moves; an outside
  `targetPosition` lands at the computed point; a bad offset is refused. E7: `clickAt` reports the same
  `clientX/clientY`, `dragTo` lands at the target point. G1/G3/G4 through MCP and an attached scratch runner suite
  (5/5): `page-navigated`, `{ navigated: true }` with `allowNavigation`, `result-truncated` at the MCP default, all
  365 rows with a raised limit and by default in the runner, insertion key order. H1/H2/A5: `fill`, `inputValue`,
  `textContent`, `dblclick`, `press` work and are absent from `$help`; `getByRole`, `waitForLoadState` answer in
  one line; a typo still gets the fuzzy suggestion; an automation right-click runs the page's `contextmenu` handler
  and leaves no menu open, `nativeMenu: true` opens it.
- Codex's US-2150 run ran `build-prod`, which replaced the dev bundle (the UI suite refused to run until `npm start`
  was restarted); later runs were told not to.
- Checks: `npm run lint`, `npm run typecheck`, `npm run guides:check` (130 pages) and `npm run i18n:check` (no catalog
  changes) pass; `npm run test:ui -- --area browser` 114 passed, 2 skipped. Completion skills by Codex (Luna):
  `/review` found nothing to act on; `/document` updated `browser-editor.md` and `key-files.md`; `/userdoc` updated
  the browser, web-app-tests, site-extensions and temporary-site-extensions guides.
