# EPIC-206: Locators for browser automation

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 4 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (section 3 D and G6). A locator is
today a CSS selector, a `text=` string or a snapshot ref. Agents trained on Playwright write `getByRole`,
`getByLabel`, `locator(...).getByText(...)`; none of these can be expressed, so the pilot suite's page model grew a
hand-written role/label layer and fourteen "tag-and-return" members that write `data-*` attributes into the app's DOM
so a test can click the element. This epic gives the shared automation locator Playwright's selector engines,
chaining and filters, element refs handed out by a page model, locator read members, an in-page `waitForFunction`,
and runtime helpers for model authors.

Steps 1a–3 ([EPIC-202](EPIC-202.md) … [EPIC-205](EPIC-205.md)) are done. [EPIC-203](EPIC-203.md) touched the same
automation code (scroll-into-view, focus, drag by offset, Playwright aliases, the H2 "did you mean" hints).

Proposals covered: **D0, D1, D2, D3, D4, D5, G6**. Optional if it falls out of D4: `editor.evaluate` key order
(EPIC-203 follow-up). Out of scope: init scripts, routing, window work (steps 5–7).

## Goals

- One selector resolution path: every read of a selector string goes through `resolveCandidates`
  (`src/renderer/automation/page-scripts.ts`), with no behaviour change (D0).
- Playwright selector engines in the locator string: `role=button[name="Save"]`, `label=`, `placeholder=`,
  `testid=`, `title=`, `alt=`, and the existing `text=`; `role=` agrees with the snapshot's role and name (D1).
- Chaining `>>`, `:has-text("…")`, `:visible`, `>> nth=N`, and the object form `{ role, name, within }` (D2).
- `runtime.ref(element)` in a page model returns `{ ref }`, accepted wherever a locator is, clicked with trusted input
  (D3), plus the other runtime helpers `visible`, `accessibleName`, `setValue`, `waitFor`, `afterReturn` (G6).
- Read members taking a locator: `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`,
  `boundingBox`, and the bulk `query(locator, { fields })` (D4); `waitForFunction(fn, { args, timeout })` running in
  the page on animation frames (D5).

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2160](../tasks/US-2160-one-selector-path/README.md) | One selector resolution path | D0 | Done |
| [US-2161](../tasks/US-2161-selector-engines/README.md) | Selector engines (`role=`, `label=`, …) | D1, H2 text | Done |
| [US-2162](../tasks/US-2162-locator-chaining/README.md) | Chaining, filters and the object form | D2 | Done |
| [US-2163](../tasks/US-2163-model-runtime-helpers/README.md) | Model refs and runtime helpers | D3, G6 | Done |
| [US-2164](../tasks/US-2164-locator-reads/README.md) | Locator read members and `waitForFunction` | D4, D5 | Done |

Order: US-2160 first (D0 is the base of D1, D2 and D4). US-2163 lives in the site-extension runtime and the
page-model reply path and is planned in parallel with US-2160. US-2161 is planned after US-2160 is implemented,
US-2162 after US-2161, US-2164 last (its reads go through the path US-2160–US-2162 build). Implementations run one at
a time, each staged after review.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices (review section 6 answers taken as recommended).

1. **Owners.** The page-side `resolveCandidates` (`automation/page-scripts.ts`) owns the selector grammar and every
   engine; nothing else parses a selector string. On the host side, one function (a new small module in
   `src/renderer/automation/`, named in US-2160's plan) owns *how* page code that needs selector candidates is run.
   Every caller that has a selector (actions and their actionability retry, queries, page state, the synthetic paths
   in `mouse.ts` and `synthetic.ts`, the CDP `DOM.querySelectorAll` reads in `forms.ts` and the snapshot root) goes
   through it. US-2161 adds the accessibility facts there and nowhere else. No call site keeps a direct
   `document.querySelectorAll(selector)` or a `startsWith('text=')` branch for a caller-supplied selector.
   **Exception:** `fullscreen(selector)` (page tools) selects and re-checks its element in the main process
   (`src/main/browser/BrowserGuest.ts`, `enterFullscreen`) under a user gesture; it is not part of the shared
   automation locator and stays CSS-only (decided at US-2160 plan review).
2. **Role and name come from Chromium's accessibility tree**, the same source `snapshot.ts` renders
   (`Accessibility.getFullAXTree`), so `role=X[name="Y"]` matches exactly what a snapshot line `- X "Y"` shows. The
   host queries the tree over CDP (`Accessibility.queryAXTree` or the full tree, chosen in the plan) and hands the
   matching elements to the page-side resolver as arguments; the page side applies the grammar. A page-side JS
   re-implementation of ARIA role/name computation is rejected: it would disagree with the snapshot. Enabling the
   Blink `ComputedAccessibilityInfo` feature on user pages is rejected too: it changes what every site can observe.
3. **Engines follow Playwright's semantics** so agents need no new grammar: `name` and text values match
   case-insensitively as a substring, a quoted value with the `s` flag (or `text="…"`, as today) matches exactly, and
   `/regex/flags` is accepted. `role=` hides elements that are not exposed to accessibility unless `include-hidden` is
   given; state attributes are limited to those the snapshot already prints or Chromium exposes directly (`checked`,
   `disabled`, `expanded`, `level`, `pressed`, `selected`). `label=` matches form controls by their `<label>`,
   `aria-labelledby` or `aria-label`; `testid=` is `data-testid`, exact. The existing `text=` behaviour is kept as is.
4. **Chaining and filters (D2)** follow Playwright: `a >> b` resolves `b` inside every match of `a`; `nth=N` is a
   step (negative counts from the end); `:has-text("…")` and `:visible` are accepted as suffixes of a CSS step and
   applied by the resolver as filters. A pseudo the resolver does not support in a position it does not support fails
   with a clear error, never with the browser's CSS syntax error.
5. **The object form is sugar.** `{ role, name, exact, within, hasText, visible, nth }` (exact keys fixed in the
   plan) is compiled host-side into the one string grammar by the locator normaliser (`resolveElementLocator`); there
   is no second resolution path. `within` takes any locator form, including `{ ref }`.
6. **Model refs are ordinary refs.** `runtime.ref(element)` gives the test `{ ref: "e<backendNodeId>" }` (or the
   frame form), so `ref.ts` stays the only ref format and every existing ref consumer accepts it with no change. How
   the page-side token becomes a backend node id is planned in US-2163 over the existing model-call evaluate path;
   no new message, correlator or event channel (guardrail 1). The ref is valid until the element leaves the DOM.
7. **Bridge version.** Engines, the object form, refs from models, read members and `waitForFunction` all reach boards
   through `window.persephone.call()`. US-2161 bumps `BOARD_BRIDGE_VERSION` once for the epic (`1.59.0` → `1.60.0`)
   and writes the history line in `assets/guides/agents/boards/bridge-versions.md`; later tasks extend that same line
   without another bump. If US-2160 alone already changes anything a board can observe, it does the bump instead.
8. **H2 text.** The `getByRole` suggestion in `browser-playwright-aliases.ts` points at the `role=` engine once it
   exists (US-2161); `isVisible` stops being a suggestion when it becomes a member (US-2164).
9. **Guardrails.** No new protocol code; no growth of a roadmap §2.3 god file (`BrowserWebviewModel.ts` holds the
   site-extension runtime: G6 helpers go into a collaborator, not into that file); strict folders stay strict.
   Implementation briefs forbid `build-prod` (it wipes the running dev build) and `.gitignore` edits.

## Notes

### 2026-11-22
- Epic created from roadmap step 4. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Plan review decisions.**
  - *US-2160*: the plan's "compatibility policies" (raw CSS, CSS-only, legacy pre-check) were dropped: query mode
    already returns the raw `querySelectorAll` list for CSS, and the action pre-check rewritten over query mode can
    never fire for `text=` (its query list holds only displayed elements), so two modes suffice. Formerly CSS-only
    paths (synthetic type/focus, `setInputFiles`, snapshot root) take the full grammar; that is board-observable, so
    US-2160 did the epic's bridge bump (1.59.0 → 1.60.0). `fullscreen(selector)` stays a CSS-only main-process
    exception (Decision 1). Invalid-selector wording on the two former CDP paths now comes from the page.
  - *US-2163*: model refs are markers (`persephone-ref:<n>:<padding>`, never shorter than the `e<id>` they become) in
    a per-runtime `WeakRef` registry; the host converts them after `normalizePageModelReply`, so a reply can only
    shrink (no second shaping, no `ai-vision` patch). No connectivity check added to `ref.ts` (it would change every
    snapshot ref). `afterReturn` is best effort (`setTimeout` after the page serialized the reply) and refused while
    zero or several model calls are in flight. `accessibleName` is a documented page-side approximation; `role=` and
    the snapshot use Chromium's name.
  - *US-2161*: the AX preflight runs only when the selector contains `role=` (no extra round trip otherwise). State
    defaults follow Playwright (absent `checked`/`pressed`/`selected`/`disabled` = false; absent `expanded` matches
    neither value).
- **Fixes by Claude during verification.** US-2160: `actionabilityFunction` still embedded the whole resolver source
  (dead after the change); removed. US-2163: `page-model-refs.ts` carried a copy of `cdpExceptionMessage`; it now
  imports the shared one. US-2161: `parseSelector` returned engine names with the trailing `=`, so every engine
  (including `text=`) matched nothing and no AX roles were requested; Chromium reports `checked`/`pressed` as tristate
  string tokens (`"true"`/`"false"`/`"mixed"`), so `[checked=false]`/`[pressed]` never matched; quoted `testid="…"`
  compared the quotes. All fixed.
- **Limitation recorded (US-2161):** `[include-hidden]` adds nothing in practice: Chromium's `queryAXTree` does not
  return `display:none` or `aria-hidden` nodes. Documented rather than approximated (Decision 2).
- **Plan review decisions (later tasks).**
  - *US-2162*: a scope passed as `within: { ref }` became a public `ref=<ref>` first step, resolved host-side next
    to the AX facts, instead of a `scopeRef` field threaded through seven consumers. `nth=` counts the raw ordered
    list (Playwright); the `{ nth }` option still counts visible matches after the selector.
  - *US-2164*: strict Playwright cardinality for `isVisible`/`isEnabled`/`isChecked`/`innerText`/`boundingBox`
    (every read takes `{ nth }`); bulk `query` reports Chromium AX role/name (as the `role=` engine sees them, not the
    snapshot's pointer-line text), capped at 200 rows with `truncated`; `waitForFunction` defaults to 10 s, clamps to
    28 s, polls on animation frames with a 100 ms fallback; `evaluate` key order left as is (documented).
- **More fixes by Claude.** US-2164: `query` rows came back with Chromium-sorted keys; rows are now rebuilt in the
  requested field order. Completion: reverted an unrequested `/document` edit to the shipped demo board.
- **Live verification (dev app, local test page with labelled inputs, aria-labels, placeholders, `data-testid`, a
  dialog, hidden duplicates, 300 generated buttons, and a temporary test model).** D0: CSS, `text=`, refs, ambiguity,
  `{ nth }`, hidden-only targets, snapshot root, synthetic typing behaved as before; invalid CSS reports the page's
  `SyntaxError`. D1: every engine clicked/typed with trusted input; `role=` name matched the snapshot line (title
  button `button "R"`, wrapped label `textbox "To "` via whitespace normalisation), substring/`s`/regex, all states
  incl. tristate checked/pressed, 300-button role lookup ~110 ms, bad attributes rejected, `role=` on the app window.
  D2: chains across engines, `nth=-2`, `:visible`/`:has-text` suffixes and the mid-selector error, dialog scoping,
  object form (role/name/exact/regex/label/text/testId/nth/within), `ref=` scope and its frame/stale/position errors.
  D3/G6: `runtime.ref` nested in a list (key order kept) clicked with trusted input, hidden ref refused as not
  visible, detached element refused at mint, `visible`, `accessibleName`, `setValue` (input event fired), `waitFor`
  success/timeout, `afterReturn` reload after the reply. D4/D5: every read incl. strictness, `{ nth }`, bounding box,
  `query` fields/validation/200 cap, refs from `query` clicked; `waitForFunction` immediate/delayed/args/timeout/
  numeric polling/predicate error/non-function/navigation, on browser and app window. Scratch suite through the
  web-app test runner (`electron . --test <suite> --attach`): 3/3 passed (engines, chains, object form, reads, `query`
  refs, `waitForFunction`, model refs).
- **Not verified live:** board pages (no board opened), iframe/OOPIF refs and `boundingBox` frame mapping, a React
  controlled input for `setValue`.
- Checks: `npm run lint`, `npm run typecheck`, `npm run guides:check` (135 pages), `npm run i18n:check` (no catalog
  changes; every pack 1697/1697). `npm run test:ui -- --area browser` 114 passed after US-2160; after the epic 113
  passed + 1 failure in a WebMCP page-model test that ran while Codex's completion run was editing files (HMR); it
  passed when rerun alone, and a final full `--area browser` run after completion gave 114 passed. `--area core` 36
  passed. Completion skills by Codex (Luna): `/review` replaced a non-null
  assertion in `locator-reads.ts` with a guard; `/document` updated five architecture docs; `/userdoc` split new
  pages `browser-automation.md` and `site-extensions-example.md` and updated the browser, site-extension, temporary
  extension, web-app-tests and what's-new guides.
