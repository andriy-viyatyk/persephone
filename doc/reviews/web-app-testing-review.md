# Web-app testing review: runner, page models and browser automation

**Date:** 2026-11-22 · **Status:** proposal, reviewed against the source 2026-11-22 (corrections in sections B, C,
D, F and 5) · **Input:** the first real suite written with the
web-app test runner ([EPIC-186](../epics/completed.md)), and the 24 feedback items it produced in
[US-2138](../tasks/US-2138-web-app-test-feedback/README.md).

This review reads the pilot suite as evidence, not only its feedback list. The list says what the agent tripped on.
The suite's own code says what the agent had to build because Persephone did not have it. The second source is the
larger one.

---

## 1. Summary

The feature works. One agent wrote 232 tests in 47 files for a React SPA with a virtualized grid and enterprise
sign-in, in about two days, and the suite reported six findings against the app (two of them confirmed by a test that fails
on purpose). None of the 24 feedback items was a blocker.

The cost shows in three places:

1. **The page model is a second automation library.** The suite's model is 1,445 lines with about 90 members. Its
   first 350 lines are a hand-written `getByRole` / `getByLabel` / `fill` layer. Fourteen more members exist only to
   tag an element with a `data-*` attribute and hand a CSS selector back, so the browser editor can click it. The
   browser editor has no way to address an element by role, label or text-inside-a-container, and a model has no way
   to hand an element to it.
2. **Waiting and asserting are low level.** 381 `ctx.waitFor` calls, 104 fixed sleeps, and 518 of 1,922 assertions
   (27%) written as `expect(condition).toBe(true)`, which fails with "Expected false to be true".
3. **An attached run is not scoped to the window it tests.** The runner's baseline, cleanup, attention handling and
   failure screenshot all work on the default window, which with `--attach` is the user's own.

The proposals below are grouped into eight areas (A–H). Section 5 gives a recommended order. The short version:
**A (window scoping), B (assertions) and the cheap half of E (input fixes)** are small and remove most daily
friction; **D (locators) and F (init scripts)** are the two changes that would make the next suite much smaller.

---

## 2. Evidence from the pilot suite

Counts are from the suite's `tests/` and `lib/` folders (model counted separately).

| Measure | Count | What it shows |
|---|---|---|
| Tests / files | 232 / 47 | Scale reached in one run of work |
| Page model | 1,445 lines, ~90 members | Model carries generic work, not only app knowledge |
| Model members that only return a selector (`*Target`) | 14 (18 tag attributes written into the app DOM) | No element hand-off from model to editor |
| `site.app.click(label)` (synthetic, in-page) vs `site.click(selector)` (trusted) | 135 vs 137 | Half of all clicks skip trusted input and actionability, because addressing by label is only possible in the model |
| `ctx.waitFor` | 381 | Every state read is a hand-written poll |
| Fixed `sleep(n)` | 104 | Polls do not cover "settled" states |
| `expect(x).toBe(true/false)` | 518 of 1,922 | Missing matchers and no `.not` |
| `try { … } catch` / `safe(…)` wrappers | 27 / 28 | Calls fail during navigation and re-probe (items 1, 2) |
| `site.evaluate` | 39 | Mostly `localStorage` set-up and clean-up |
| `site.snapshot`, `waitForResponse`, `networkRequests`, `site.waitFor` | 0 | The agent never used the snapshot or network members in tests |
| Helper scripts the agent wrote to read results | 3 (`fail.mjs`, `logs.mjs`, `coverage-check.mjs`) | Reports are hard to read as they are |
| Full run | ~35 min, one flake, two expected failures | No retry, no expected-failure status |

Three patterns are worth naming, because each one maps to a proposal:

- **Tag-and-return.** `filterTarget("item", label)` finds the element in the page, writes
  `data-…-test-filter="item:label"` on it and returns `{ selector }`. The test then calls `site.click(selector)`.
  This changes the app's DOM, and one member had to clear stale tags because the grid reuses header elements.
- **Shared signed-in page.** Sign-in tokens live per tab, so tests cannot open their own page. The suite finds one
  page the user signed in by hand, in a second window, reloads it per test and never closes it. Nothing in the
  runner knows about this page: it is in the baseline, so it gets no failure screenshot and no cleanup.
- **Patch the page from a test.** To capture a download, fail a request, read a copy, or reset stored views, the
  suite patches `URL.createObjectURL`, `XMLHttpRequest.prototype.open`, dispatches a fake `copy` event, or edits
  `localStorage` through `evaluate`. Each patch is applied after the app has loaded.

---

## 3. Proposals

Effort: **S** = one small task, **M** = one task with a plan, **L** = several tasks. "Items" refers to the rows of
US-2138.

### A. Scope an attached run to a test window

**Problem.** `runner.ts`, `browser-helpers.ts` and `results.ts` call `pages.all`, `menus[0]`, `dialogs[0]` and
`window.screen.screenshot` with no window prefix. With `--attach` that is the user's main window. Results: a dialog
of an unrelated page fails three tests (item 13); the failure screenshot shows the user's own pages (item 11); the
user's pages and menus were closed or counted as leftovers (item 23; US-2146 already limited the page cleanup to
owned pages and switched the sweep off). The suite works around it by writing `windows[1].` on paths by hand.

**Proposal.**

| # | Change | Effort |
|---|---|---|
| A1 | A run has a **test window**. `--attach` opens a new window for the run by default, or takes `--window <index or title>` to use an existing one. `ctx.app` and every runner bookkeeping call are rooted at that window; `ctx.root` reaches the whole app when a test needs it. | M |
| A2 | Inside the test window the full cleanup is safe again: close owned pages, close a popup menu left open, dismiss leftover dialogs. Outside it the runner touches nothing and lists nothing in reports. | S (after A1) |
| A3 | Attention raised by another window is not a test failure. The runner retries the call a few times, then reports an **environment stop** ("a dialog is open in another window"), separate from failed tests. | S |
| A4 | **Session pages.** `ctx.usePage({ url, title? })` finds an already open browser page in the test window, marks it as the page under test, and never closes it. The failure capture includes it. Documented in `web-app-tests.md` as the pattern for apps whose sign-in cannot be automated (item 3). | S |
| A5 | An automation right-click does not open Persephone's own browser context menu unless the caller asks (`{ nativeMenu: true }`). Today it blocks every later call (item 22). | S |

**Owner:** the runner (`src/test-host/`) owns window scoping; A5 belongs to the browser editor's context-menu path.

### B. Assertions and test structure

**Problem.** `ctx.expect` has seven matchers (`toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeGreaterThan`,
`toBeLessThanOrEqual`, `toMatch`), no `.not`, no message (items 6, 14, 21, 24; item 6 lists `toBeLessThanOrEqual` as
missing, but it exists). A missing matcher throws
a `TypeError` that reads like an app failure. A test that must fail for a known app bug looks the same as a new
break. There are no hooks, so the suite wrapped `test()` to get a `finally`. A flake needs a manual rerun.

**Proposal.**

| # | Change | Effort |
|---|---|---|
| B1 | Complete the matcher set to the Jest/Playwright names agents already write: `.not`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toHaveLength`, `toHaveProperty`, `toMatchObject`, `toContainEqual`, `toThrow`. An unknown matcher name throws an error that lists the supported ones. `expect(value, message)` puts the message first in the report. | S |
| B2 | **Polling assertions:** `await ctx.expect.poll(() => site.app.dialog, { timeout, message }).toMatchObject({ title: "…" })`. One call replaces a `waitFor` plus an `expect`, and the failure shows expected against last actual instead of "Timed out … last value: <long JSON>". A stand-in that is not there yet (item 2) counts as "not yet", not as an error. | S |
| B3 | Test modifiers: `test.skip`, `test.only`, `test.fails(name, fn, { reason })`. A `fails` test that fails is reported as **expected failure**; one that passes is reported as **unexpected pass**. The summary counts both apart from real failures (item 24). | S |
| B4 | File-level hooks: `beforeAll`, `beforeEach`, `afterEach`, `afterAll` exported next to the tests. If `beforeAll` fails, the file's tests are reported as not run instead of failing one by one with misleading errors. | M |
| B5 | `--retries <n>`: a test that passes on retry is reported as **flaky**, not passed. `--grep <regex>` filters by name (the suite names tests by spec ID, so `--grep "WKQ.REQ.12"` is natural). | S |
| B6 | Passing a stand-in or handle to `expect` is refused with a clear message instead of an unhandled `toJSON` rejection (item 7). | S |
| B7 | A per-test timeout (default generous, `--test-timeout`, per-test override). Today only single calls are bounded. | S |

**Owner:** `src/test-host/context.ts` (200 lines) holds `expect` today. The matcher set more than doubles, so the
matchers move to their own `expect.ts` (one job per file); modifiers and hooks go to `test-api.ts` and `runner.ts`.
`test-selection.ts` already filters by an explicit file/name list; `--grep` is added next to it, not as a second
filter path.

### C. Failure diagnostics

**Problem.** The agent stopped using the screenshots and wrote scripts to cut the report down. Three causes:
the screenshot is of the wrong window (item 11); every failed call carries a member list of several kilobytes
because the client asks for `hints: "always"` (item 12, `client.ts:36`); a failure has no source line (item 14).
With `--attach` there is also no console or network log.

**Proposal.**

| # | Change | Effort |
|---|---|---|
| C1 | Failure capture targets the pages under test (owned pages and session pages from A4), never `window.screen` in an attached run. | S |
| C2 | A **failure bundle** per failed test, read through members that already exist and so also work attached: page URL and title, `pageErrors()`, console errors, failed and 4xx/5xx `networkRequests()` during the test, and the screenshot. Written next to the report and linked from it. Network entries carry method, URL, status and timing only; request and response bodies and headers (tokens, cookies) are left out by default. The guide says the `reports/` folder is local output and belongs in `.gitignore`. | M |
| C3 | The runner requests `hints: "never"`. For an unknown-member error it keeps a short form: the wrong name and the closest member names. The full list stays in `tests.log`. | S |
| C4 | The failure record gets the test file's `file:line` from the error's stack, and `report.md` prints it. | S |
| C5 | Console output ends with a compact list: status, name, `file:line`, first line of the error. This replaces the suite's `fail.mjs`. | S |
| C6 | Optional, later: `ctx.onFailure(fn)` so a suite can add its own state to the bundle (for example the model's `state` and `dialog`), and video of the test window through the existing `window.screen.recording`. | M |

### D. Locators: address elements the way Playwright does

This is the largest gain for the size of a model.

**Problem.** A locator is a CSS selector, a `text=` string, or a snapshot ref. Agents trained on Playwright reach
for `getByRole("button", { name: "Save" })`, `getByLabel("From")`, `locator(".popover").getByText("Apply")`.
None of these can be written, so the agent wrote them inside the page model, where they lose trusted input and
actionability checks. A snapshot ref cannot be used in a scripted test, because refs are not stable across runs.

**Proposal.**

| # | Change | Effort |
|---|---|---|
| D0 | **One resolution path first.** Today non-`text=` selectors bypass `resolveCandidates`: the visibility pre-check in the action script (`locator.ts:69`), the match count in `locator.ts:202` and `page-state.ts:65` call `document.querySelectorAll(selector)` directly. A new engine added only to `resolveCandidates` would make `locator.ts:69` throw a CSS syntax error on `role=button[...]` before the engine is reached. Route every selector read (actions, queries, page state, the synthetic paths in `mouse.ts`) through `resolveCandidates`, with no behaviour change, before D1. | S–M |
| D1 | **Selector engines** in the locator string, using Playwright's own syntax so agents need no new grammar: `role=button[name="Save"]`, `label=From`, `placeholder=…`, `testid=…`, `title=…`, `alt=…`, plus the existing `text=`. Role and accessible name are computed by the code that already builds the snapshot (`automation/snapshot.ts`), so the snapshot and the locator agree. | M |
| D2 | **Chaining and filters:** `dialog[open] >> role=button[name="Start"]`, `:has-text("…")`, `:visible`, `>> nth=2`. Today `:has-text` reaches `querySelectorAll` and fails as a syntax error. The same grammar in an object form for scripts: `{ role: "button", name: "Start", within: "dialog[open]" }`. | M |
| D3 | **Element refs from a page model.** `runtime.ref(element)` returns `{ ref }`, valid until that document goes, and accepted wherever a locator is. A model method finds the element with app knowledge ("the cell at row 12, column `status`") and the test clicks it with trusted input. This replaces tag-and-return and leaves the app's DOM untouched. | M |
| D4 | **Read members that take a locator:** `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`, `boundingBox`, and one bulk read, `query(locator, { fields })`, that returns role, name, text, value and state for every match in one round trip. `getText` returns `textContent`, which the browser guide itself warns about on virtualized lists. | S–M |
| D5 | `waitForFunction(fn, { args, timeout })` on the browser editor: the predicate runs in the page on animation frames. Faster and less chatty than a host-side poll every 200 ms across MCP. | S |

**Owner:** `src/renderer/automation/page-scripts.ts` (`resolveCandidates`) becomes the single place selector strings
are resolved once D0 is done; the engines are added there and nowhere else. Every caller of the shared automation
locator gets them. If that widens what a board can call through `window.persephone`, the epic bumps
`BOARD_BRIDGE_VERSION` and adds a history line (refactoring guardrail 6).

**Expected effect on the pilot model:** the generic members (`buttons`, `click`, `fields`, `fill`, `tabs`,
`selectTab`, `dialog`, about 350 lines) and the 14 `*Target` members become unnecessary. What stays is real app
knowledge: the virtual-grid scan, the visit panel, the calendar.

### E. Input fidelity and missing input members

**Problem and proposal, per item.** The causes below marked *verified* were read in the source; the others are the
likely cause and are to be confirmed when the task is planned.

| # | Change | Cause | Effort |
|---|---|---|---|
| E1 | **Scroll into view inside any scroll container** before the hit test (item 21). | *Verified:* `locator.ts:84` scrolls only when the element is outside the window, and the later repair runs only when the covering element is an ancestor. A list item clipped by its own pop-up is neither. | S |
| E2 | **Detect a click that produced no `click`** (item 5): arm a one-shot capture listener, and when press and release land on different elements report "the element under the pointer changed between press and release (A → B)". Also re-check the hit target one frame after the pointer move, since hover handlers often re-render. | Likely: the pointer move shows a tooltip or a hover-only button, the app re-renders the cell, and the release lands on a new element. | M |
| E3 | **Make `hover()` apply CSS `:hover`** in browser pages (item 10), by forcing the pseudo-class over CDP (`CSS.forcePseudoState`) on the target and its ancestors until the next pointer action. Then make `click` hover first by default, as a user's pointer does. If forcing is not workable, at least name `hover()` in the "not visible" error. | Documented limitation in `browser.md`. | M (spike first) |
| E4 | `focus(locator)`, and `pressKey(key, { target, focus: "focus" })` so a key can go to an element without a click (item 16). | *Verified:* `target` is always focused by a trusted click. | S |
| E5 | Low-level pointer members: `mouseDown`, `mouseMove`, `mouseUp`, `wheel`, with locator or page coordinates (items 17). The runner releases a held button at test end, as `keyUp` cleanup does. | Absent. | S |
| E6 | `drag(source, { by: { x, y } })` and positions outside the box (item 18); `steps` and `holdMs` options for apps that need a slow drag. | *Verified:* `locator.ts:111` refuses a position outside the border box. | S |
| E7 | `clickAt` / `dragTo` by coordinates exist on `window.screen` only; expose them on browser pages too. | *Verified:* `window-screen.ts:42`. | S |

### F. Control of the page environment

**Problem.** Four feedback items (9, 19, 20, and the storage half of 3) are the same gap: a test cannot set up the
page **before the app's scripts run**, and cannot observe what leaves the page. A temporary extension is injected
when the document is ready, after the app has already read its storage and captured `fetch`.

**Proposal.**

| # | Change | Unlocks | Effort |
|---|---|---|---|
| F1 | **Init scripts.** `attachTestExtension({ …, runAt: "document-start" })` (or a separate `addInitScript`) registers the script with CDP `Page.addScriptToEvaluateOnNewDocument`, so it runs before any page script on every load. | Seeding storage, a fixed clock, stubbing `fetch`, capturing downloads, all without racing the app. One primitive behind F2–F5. | M |
| F2 | **Storage state.** `site.storageState()` returns cookies, `localStorage` and `sessionStorage` for the origin; `ctx.openBrowser(url, { storageState })` applies it at document start. A suite signs in once by hand, saves the state, and every test opens its own fresh page. This removes the shared-page pattern for apps that keep tokens in `sessionStorage` (item 3). State files hold tokens: they stay local, are never logged, and the guide says so. | Test isolation, parallel files later. | M |
| F3 | **Request interception.** `route(urlOrRegex, { status, body, headers } \| "abort" \| { delayMs })` and `unroute`, over the CDP `Fetch` domain. Declarative only: a `call` carries JSON, so there is no handler function. | Error and retry states, slow responses, empty data (item 20). | M |
| F4 | **Downloads.** `const wait = site.waitForDownload(); … ; const file = await wait;` returns `{ suggestedFilename, path, size }` and saves to the run's folder with no Save dialog, also when attached (item 9). The per-page download gate from US-2144 is the place to hook in. | Export tests against the real download path. | M |
| F5 | **Clipboard.** `clipboard.readText()` / `writeText()` scoped to the page under test (item 19). The guide today says Ctrl+C uses the real OS clipboard and nothing reads it back. Privacy rule: only on pages the test owns or uses, never a general OS clipboard read. | Copy and paste tests. | S |
| F6 | **Clock.** `clock.install({ now })`, `clock.fastForward(ms)`, built on F1. | Date-dependent UI, timers. The pilot suite has a four-minute test that waits for a scheduled run. | M |
| F7 | `localStorage` helpers: `storage.clear({ prefix })`, `storage.set(key, value)`. 39 `evaluate` calls in the suite are mostly this. | Shorter set-up. | S |

F3–F5 are test-only powers. They are available on a page the run opened or declared with `ctx.usePage`, and on a
page the agent opened itself; never on a user's private page. That matches the existing agent-access rule.

**Owner and guardrails.** None of F1, F3 or E3 has a foundation yet: nothing in `src/` uses
`Page.addScriptToEvaluateOnNewDocument`, the CDP `Fetch` domain or `CSS.forcePseudoState`. Each plan names the
browser-editor collaborator that owns the CDP domain (a new class, not more code in an existing god file). F3 and F4
reuse the existing cross-process primitives and the per-page popup/download/dialog gates from US-2144; a new
correlator or event channel for downloads or routed requests is a review blocker (refactoring guardrail 1). F3 must
also be planned against any request handling the browser editor's session already does, so two layers do not both
answer the same request.

### G. The page-model bridge and temporary extensions

| # | Change | Cause | Effort |
|---|---|---|---|
| G1 | **Navigation during a model call is a recognised result** (item 1). A method call that dies with "Cannot find context" returns a coded error `page-navigated`, and `{ allowNavigation: true }` turns it into `{ navigated: true }`. | The call is one `evaluate` in the old document (`BrowserPageRemote.request`). | S |
| G2 | **Keep the model reachable across a same-document navigation** (item 2). While a re-probe is running, a read waits for it (bounded) instead of answering `"app" is not a member`. | To confirm in `BrowserPageRemote`: the registration is dropped before the new probe lands. | S–M |
| G3 | **No silent truncation** (item 4). A cut reply fails with a coded error that names the cap and `maxLength`; the runner defaults to unbounded for model replies, as scripts and boards already do (`call-limits.ts`). | The 20,000-character default of ai-vision's `shapeResult` protects an agent's context; a test is a program. The runner's client already throws on a `[truncated:` block (`client.ts:97`), so the flag is lost earlier on the page-model path. To confirm where. | S |
| G4 | **Keep key order** of returned objects, or document the sorting (item 8). | To confirm: in ai-vision's result shaping. | S |
| G5 | **Models in several files.** `scriptPath` accepts a folder or a list, loaded in order. The pilot model is one 1,445-line file because one path is all that is accepted. | Design limit. | S |
| G6 | **Runtime helpers for model authors**, so every model does not rewrite them: `runtime.ref(el)` (D3), `runtime.visible(el)`, `runtime.accessibleName(el)`, `runtime.setValue(input, value)` (framework-controlled inputs), `runtime.waitFor(fn, { timeout })`, `runtime.afterReturn(fn)` (run after the reply is sent, for actions that navigate). | The pilot model starts with ~90 lines of exactly these. | M |
| G7 | **A guide section for test models.** `site-extensions.md` is written for privacy-bounded agent models ("never return text"). A test model must return content. `temporary-site-extensions.md` gets: what a test model is for, what belongs in the model against the test, the navigation rule, paging large results, and one worked example. | The agent had to work this out; its own `AGENTS.md` is the proof. | S |

### H. Playwright familiarity, guides and scaffolding

| # | Change | Effort |
|---|---|---|
| H1 | **Accept the Playwright names for 1:1 members** as hidden aliases (not listed in `$help`, to keep it short): `dblclick` → `click(…, { clickCount: 2 })`, `fill` → `type`, `press` → `pressKey`, `goto` → `navigateAndWait`, `selectOption` → `select`, `setChecked`, `textContent` → `getText`, `inputValue` → `getValue`, `isVisible`, `waitForTimeout` → `wait`, `goBack` / `goForward`. Item 15 is one instance; an agent's first guess should work. | S |
| H2 | **"Did you mean" for the rest.** An unknown member with a known Playwright name answers in one line with the Persephone form (`getByRole` → the `role=` locator; `locator()` → pass the selector to the action; `waitForLoadState` → `waitForNavigation`). This replaces the member dump of item 12. | S |
| H3 | `web-app-tests.md`: the real matcher list, the session-page pattern, the test-window rule, a Playwright → Persephone table, and "what goes in a model". | S |
| H4 | **`persephone-test --init <folder>`** writes a starter suite: `tests/smoke.test.mjs`, `lib/`, `model/app-model.js`, a run script, and an `AGENTS.md` brief. The pilot suite's own brief is a good template once its app-specific parts are removed. | S |
| H5 | A machine-readable result for agents: `report.json` already exists; add `--reporter json-lines` on stdout so an agent can follow a long run without reading files. | S |

---

## 4. Playwright coverage after the review

What an agent expects from Playwright, and where Persephone stands. "Now" is the current browser editor.

| Playwright | Now | Proposal |
|---|---|---|
| `click`, `hover`, `type`/`fill`, `check`, `selectOption`, `setInputFiles`, `dragTo`, `press` | Yes (different names for some) | H1 aliases |
| `dblclick`, `focus`, `mouse.down/move/up`, `mouse.wheel`, drag by offset | `clickCount: 2` only | E4–E7, H1 |
| `getByRole`, `getByLabel`, `getByText`, `getByTestId`, `getByPlaceholder` | `text=` only | D1 |
| `locator().locator()`, `filter({ hasText })`, `nth` | `{ nth }` only | D2 |
| `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`, `boundingBox` | `getText`, `getValue`, `getAttribute`, `exists` | D4 |
| `waitForSelector`, `waitForURL`, `waitForResponse` | Yes | — |
| `waitForFunction`, `waitForRequest`, `waitForEvent("download")` | No | D5, F4 |
| `expect(locator).toBeVisible()` and other retrying assertions | No | B2 (value polling); locator assertions follow from D4 |
| `route` / `fulfill` / `abort` | No | F3 |
| `addInitScript`, `storageState`, `clock` | No | F1, F2, F6 |
| Clipboard permissions and read | No | F5 |
| `page.on("dialog")`, console, page errors | Yes (`dialogs`, `handleDialog`, `consoleMessages`, `pageErrors`) | — |
| `test.beforeEach`, `test.skip/only/fail`, retries, `--grep`, `test.step` | No | B3–B5 |
| Trace, screenshot and video on failure | Screenshot (wrong target when attached) | C1, C2, C6 |
| Frames | Refs cross frames; selectors are main-frame | Not proposed now (no demand in the pilot) |

Not proposed: headless or CI runs, parallel workers, cross-browser. The guide already sends CI work to Playwright,
and that boundary is right. Persephone's own ground is a real signed-in profile on the user's desktop, and tests an
agent explores first through `call` and then writes down.

---

## 5. Recommended order

Each step is one epic, created when the previous one closes. Step 1 is split in two because the runner
(`src/test-host/`) and the browser automation (`src/renderer/automation/`, the browser editor) are separate code with
separate reviewers' context.

| Step | Content | Why here |
|---|---|---|
| 1a | **Runner fixes:** B1, B3, B5, B6, C3, C4, C5 | All small, no design questions, all in `src/test-host/`. B3 (`test.fails`) and B5 (`--grep`, retries) are cheap and make reports honest about known bugs and flakes from the start. Closes 6, 7, 12 (runner half), 14, 24 and the matcher half of 21. |
| 1b | **Automation fixes:** E1, E4, E6, E7, G1, G3, G4, H1, H2, A5 | All small; closes 4, 8 (or documents it), 15, 16, 18, 21, 22 and half of 1. |
| 2 | **Test window and session pages:** A1–A4, C1, C2 | Makes attached runs safe beside the user's work; closes 3, 11, 13, 23. C1 is here, not in step 1, because "the pages under test" only exists once A1 and A4 do. Needed before anyone else is pointed at the feature. |
| 3 | **Test structure:** B2, B4, B7 | Shrinks test code (polling assertions replace `waitFor` + `expect`) and gives files a proper set-up and tear-down. |
| 4 | **Locators:** D0 first, then D1–D5, G6 (with `runtime.ref`) | The largest reduction in model size. Benefits every agent that drives a browser page, not only tests. |
| 5 | **Page environment:** F1 first, then F2, F4, F3, F5, F7, F6 | F1 is the base; F2 changes how suites handle sign-in; closes 9, 19, 20. |
| 6 | **Input fidelity spikes:** E2, E3, E5, E7, G2 | E2 and E3 need an investigation before a plan; closes 5, 10, 17, 2. |
| 7 | **Guides and scaffolding:** G5, G7, H3–H5 | Written last so they describe the finished surface; H3 can be updated per step. |

### Roadmap progress

Accepted as the roadmap on 2026-11-22; the open questions in section 6 take their recommended answers. One epic per
step, created when the previous one closes. "7d used" is the share of the weekly Claude plan limit the epic's run
consumed (from the `claude-limits` status-line snapshot, before → after).

| Step | Epic | Status | 7d used |
|---|---|---|---|
| 1a | [EPIC-202](../epics/EPIC-202.md) | done 2026-11-22 | ~1% (59% → 60%) |
| 1b | [EPIC-203](../epics/EPIC-203.md) | done 2026-11-22 | ~1% (60% → 61%) |
| 2 | [EPIC-204](../epics/EPIC-204.md) | done 2026-11-22 | <1% (61% → 61%) |
| 3 | — | in progress | — |
| 4 | — | — | — |
| 5 | — | — | — |
| 6 | — | — | — |
| 7 | — | — | — |

After step 5 the pilot suite should be rewritten in part as the acceptance check: the model should lose its generic
layer and the `*Target` members, and the 518 boolean assertions and most of the 104 sleeps should go.

### Feedback items → proposals

| Item | Proposal | Item | Proposal | Item | Proposal |
|---|---|---|---|---|---|
| 1 | G1 | 9 | F4 | 17 | E5 |
| 2 | G2, B2 | 10 | E3 | 18 | E6 |
| 3 | A4, F2 | 11 | C1 | 19 | F5 |
| 4 | G3 | 12 | C3, H2 | 20 | F3 |
| 5 | E2 | 13 | A3 | 21 | E1, B1 |
| 6 | B1 | 14 | B1, C4 | 22 | A5, A2 |
| 7 | B6 | 15 | H1 | 23 | A1, A2 (part done in US-2146) |
| 8 | G4 | 16 | E4 | 24 | B1, B3 |

---

## 6. Open questions

1. **Test window by default (A1).** Should `--attach` always open its own window, or only with a flag? Recommended:
   always, because every attached problem in the pilot came from sharing a window.
2. **Aliases (H1).** Real hidden aliases, or hints only? Recommended: aliases for the 1:1 names. The cost is a
   second name for eleven members; the gain is that an agent's first attempt works.
3. **Storage state files (F2)** contain sign-in tokens. Recommended: allow them, keep them out of logs and reports,
   and say in the guide that they are secrets and belong in a git-ignored folder.
4. **Request interception outside tests (F3).** Should `route` be available to an agent in a normal session, or only
   in a test run? Recommended: test runs and agent-opened pages only, never a page the user opened, until there is a
   reason to widen it.
5. **Scope of the first epic.** Step 1 alone is about seventeen small changes. Recommended: two epics, the runner half
   (1a) and the automation half (1b), as section 5 now shows.
