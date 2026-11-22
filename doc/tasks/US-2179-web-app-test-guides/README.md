# US-2179: Web-app test guides and test-model section

Epic: [EPIC-209: Guides and scaffolding for web-app tests](../../epics/EPIC-209.md), proposals H3 and G7.

## Goal

Update the web-app test guide set and temporary-extension guide so they describe the current runner, browser facade, and page-model surface. Include verified matcher and Playwright mappings, session-page and window rules, model/test responsibilities, the temporary test-model lifecycle, and a complete offline mock example; correct stale guide/help claims found during source review.

## Background

EPIC-202 through EPIC-208 delivered the runner and browser automation surface. EPIC-209 adds ordered-list/folder `scriptPath` support, a JSON Lines reporter, and the generic `--init` starter suite. Decision 1 in [EPIC-209](../../epics/EPIC-209.md#decisions-2026-11-22) is controlling: document what current source implements, not the review proposal where it differs. The starter-suite contract and complete mock assets are in [US-2178](../US-2178-test-suite-init/README.md); retain its mock-page names and behavior so the worked example agrees with the generated suite.

The current web-app guide is already split into an `index.md` hub and four pages. Its body is 9,978 characters before the new hub row, so it needs a concise trim to stay within the 10,000-character hub limit; `call-boundary-and-examples.md` is 19,994 characters and cannot take the requested table/reference. The temporary-extension guide is about 7,512 characters, so its test-model section fits without a path split. The established saved-extension model remains in `site-extensions.md` and `site-extensions-example.md`; do not duplicate that longer privacy-bounded authoring guide.

### Source findings recorded during investigation

- `src/test-host/expect.ts` declares exactly 18 immediate matcher names. `src/test-host/poll-expect.ts` builds polling from that same list, and both surfaces expose recursive `.not`. `expect(value, message?)` accepts the optional message. Poll options are exactly `timeout`, `interval`, and `message`; unknown options and matcher names throw. Poll callback errors retry except environment-stop errors.
- `ctx.usePage({ url?, title? })` adopts exactly one matching browser page inside the selected test window. Its cleanup releases test access and clears clipboard recording, request routes, fake clock, and init-script registrations; it does not close or reload the adopted page or restore page storage, cookies, navigation, or arbitrary page effects. `ctx.openBrowser(url, { storageState? })` creates a page owned by the run; a state file path is relative to the test file and cookies are applied before the initial navigation.
- `--attach` creates a new test window unless `--window <index-or-title>` selects an existing window. Unprefixed `ctx.app` and context calls are scoped to that window. `ctx.root` and explicit `ctx.app.windows[i]` paths can reach outside it. Browser test powers are available only on pages opened by the agent or adopted with `ctx.usePage`; user-opened private pages cannot be adopted.
- H1 hidden aliases and H2 suggestions are implemented in `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts`, installed by `BrowserEditorFacade`. The exact names and accepted suggestion text are listed below. Public direct members such as `isVisible` are not aliases. Locators are selector strings or supported locator objects, not Playwright `Locator` instances.
- `scriptPath` accepts one absolute file, an ordered non-empty list, or a folder of direct `.js`/`.JS` files sorted by plain filename comparison. All sources share one script scope. `runtime.expose(root)` requires `root.aiVision`; a missing descriptor throws `The exposed root must carry an AiVision descriptor.` The descriptor used by this guide has `kind`, `summary`, and `members`; each declared member uses `name`, `kind`, and `summary`, plus `signature` where useful.
- The verified `assets/test-suite-template/` files supersede the earlier inline mock example: the fixture uses `form.querySelector("input[name='item']")`, and the first `site.app.heading()` read after navigation is inside `ctx.expect.poll()` because model registration can lag load. `BrowserPageRemote.waitForRegistration()` waits at most 250 ms only when a probe is already active; it returns immediately if there is no active probe.
- The current guide corpus already has brief entries for `--reporter json-lines` and `--init` in `run-options.md`; keep those facts there once each. This task adds links to that page rather than repeating the CLI details in a new section.
- Two contradictory statements were found in the searched guide and browser `$help` sources. (1) `src/renderer/scripting/ai-vision/browser-automation-members.ts:8` says trusted browser pointer events do not apply CSS `:hover`, while current behavior forces `:hover`; adjacent facade help is correct at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:172-174`. (2) `assets/guides/agents/temporary-site-extensions.md:31-33` and `assets/guides/agents/site-extensions.md:141` say `{ allowNavigation: true }` recovers the model reply if navigation wins; the actual contract in `BrowserEditorFacade.ts:144` is that navigation context loss returns `{ navigated: true }` (without the option it fails with `page-navigated`). `runtime.afterReturn()` schedules a callback after reply serialization on a best-effort timer, which is the way to defer a navigation until after the model method's result is produced. Correct both guide statements. No other contradictions were found in the scoped web-app-test/temporary/saved-extension guides or browser `$help` source during this search.

## Implementation Plan

### 1. Add a focused web-app guide page and link it from the hub

Create `assets/guides/agents/web-app-tests/browser-models-and-playwright.md` with quoted front matter (`title`, `audience: "agent"`, and a question-oriented `summary`). Keep it under 20,000 characters. Add exactly one “Read next” row to `assets/guides/agents/web-app-tests/index.md`, with the relative page link and object-model path `guides.agents["web-app-tests"]["browser-models-and-playwright"]`. The hub body is already 9,978 characters; move its duplicated full matcher-name list into the new page, replace the long `expect` bullet with a short pointer, and shorten the locator-focused Read next label now covered by the new page. These trims must save at least 300 characters while preserving the common workflow and current links, then verify the new row keeps the hub at or below 10,000 characters. No existing link targets the matcher bullet, so no link target changes. The folder is already registered as a hub in `scripts/guides-check-entry.ts`; do not add another hub registration. Keep existing headings and anchors in the four current pages.

Hub before/after shape:

```md
Before: `expect(value, message?)` followed by the full matcher list and `.not` example.
After: `ctx.expect(value, message?)` and `ctx.expect.poll()` share the same matchers; see [matcher reference](./browser-models-and-playwright.md).

Before: Understand call paths, Playwright-to-Persephone locators, and a complete test example.
After: Read a complete call-boundary test example.
```

The new page outline is:

1. **Matcher reference:** list the exact 18 names above; explain `.not`, message placement, argument shapes, the shared immediate/polling names, and the three polling options. Do not describe `expect.poll` as a locator assertion API.
2. **Session pages and storage state:** when to choose `ctx.usePage()` versus `ctx.openBrowser()`, accepted page match criteria, normal-profile requirement, storage-state secret handling, and exact cleanup effects/non-effects.
3. **Test-window scope:** owned window versus `--attach`'s created window versus selected `--window`; selection forms; `ctx.app`/`ctx.root` scope; which pages can receive test powers; cleanup ownership implications.
4. **Playwright → Persephone:** a compact table using the current mappings below. Name hidden aliases exactly, identify H2 suggestion-only spellings as hints (not accepted methods), distinguish supported direct members from unsupported Playwright APIs, and qualify frame support accurately.
5. **What belongs in a model vs a test:** model exposes bounded page reads/actions in `site.app`; tests own setup, interactions through facade methods, waits, expectations, and pass/fail choices. After navigation or attachment, the first model read must poll because registration can lag page load; callback errors retry. Refer to the temporary guide for implementation details.
6. **Short CLI navigation:** link to `run-options.md` for the already-documented `--init` and JSON Lines entries; do not restate their options, limits, or output contract here.

### 2. Matcher, option, session, and window details to write

The exact matcher inventory is `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toMatchObject`, `toContainEqual`, and `toThrow`. Immediate and polling assertions share all 18 names and recursive `.not`. For immediate assertions, document `ctx.expect(value, message?)`; the optional message is prepended to an assertion failure. For polling, document `await ctx.expect.poll(callback, { timeout?, interval?, message? }).<matcher>(...)`; poll options reject unknown keys, timeout/interval must be positive finite numbers when supplied, explicit timeout is scaled by `--timeout-scale`, and explicit interval is already milliseconds. Poll callback errors retry; environment-stop errors terminate polling. `toHaveProperty(path, expected?)` takes a non-empty dotted path; `toMatch` takes a `RegExp`; `toMatchObject` takes an object; numeric comparisons and `toHaveLength` take numbers; `toThrow` samples a synchronous function and optionally matches a string, `RegExp`, or `Error` constructor. The source of truth is `src/test-host/expect.ts` and `src/test-host/poll-expect.ts`, not the old proposal list in the review.

For session-page cleanup, distinguish test lifecycle from page lifecycle. `ctx.usePage()` adoption is released. The page remains open and is not navigated or reloaded. Runner cleanup resets test-owned clipboard state and clears routes, fake clock, and init-script registrations; it releases test access. It does not reverse arbitrary page JavaScript or restore prior cookies, local/session storage, form contents, app state, or URL. In a selected `--window`, unrelated pages remain open; cleanup closes only `ctx.openBrowser()` pages and their new pop-ups, and closes pop-ups created on session pages. Owned and runner-created attached windows use the baseline diff to close newly created pages. A runner-created attached window is disposed at run end; a selected existing window is preserved.

For storage state, note that `storageState()` captures applicable profile cookies plus current-origin local/session storage. `ctx.openBrowser` accepts the object or JSON path; relative file paths resolve beside the test file. Cookies install before navigation and Web Storage seeds at document start for matching origins. Treat state files as credentials and store them only in an ignored local directory. `ctx.usePage` is limited to a normal browser profile; user-opened incognito/Tor pages are refused.

For window scope, `--attach` without `--window` creates a dedicated test window. `--window` takes a decimal window-record index or unique case-insensitive title substring; ambiguous selection fails. Unprefixed context calls and `ctx.app` target that test window. `ctx.root` and explicit `windows[i]` paths are app-wide escape hatches. Browser automation/test powers work only on pages opened by the agent or adopted with `ctx.usePage()`; `ctx.usePage()` itself only searches browser pages in the selected test window. State that app-wide call paths do not grant browser test power over an arbitrary user-opened page.

### 3. Playwright → Persephone mapping to include

| Playwright member / intent | Current Persephone form | Status and qualification |
|---|---|---|
| `click`, `hover`, `fill` / `type`, `check`, `selectOption`, `setInputFiles`, drag | `click`, `hover`, `type`, `check` / `uncheck`, `select`, `setInputFiles`, `drag` | Supported public members; hidden aliases listed below cover specific Playwright spellings. |
| `dblclick` | hidden `dblclick(locator, options?)` → `click(locator, { ...options, clickCount: 2 })` | Accepted alias; omitted from `$help` member lists. |
| `fill`, `press`, `goto`, `selectOption`, `setChecked`, `textContent`, `inputValue`, `waitForTimeout`, `goBack`, `goForward` | `type`, `pressKey`, `navigateAndWait`, `select`, `check`/`uncheck`, `getText`, `getValue`, `wait`, `back`, `forward` | Accepted hidden aliases; their signatures and qualifications are in the verification table. `isVisible` is a public member, not a hidden alias. |
| `focus`, `mouse.down/move/up`, `mouse.wheel`, `dragTo` | `focus`, `mouseDown`, `mouseMove`, `mouseUp`, `wheel`, `dragTo` | Supported direct members with Persephone argument shapes; `drag` also supports locator/offset drags. |
| `page.evaluate`, `page.reload` | `evaluate(expression, options?)`, `reload(options?)` | Supported direct members with Persephone-specific expression and navigation options. |
| `getByRole`, `getByLabel`, `getByText`, `getByTestId`, `getByPlaceholder`, `getByTitle`, `getByAltText` | `role=`, `label=`, `text=`, `testid=`, `placeholder=`, `title=`, `alt=` selectors, or object locators | The Playwright names are H2 suggestions only, not callable aliases. Role/name facts use Chromium accessibility data. |
| `locator().locator()`, `filter({ hasText })`, `nth()` | Chained selector strings using ` >> `, suffix filters such as `:has-text("...")`/`:visible`, `nth=N`, action/read `{ nth }`, or object locators | There is no Playwright Locator object or chain-building method. Refs may be passed as `{ ref }`; plain selector strings target the main frame. |
| `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`, `boundingBox` | Same-named direct members | Supported immediate reads; strictness and frame limits vary by method. |
| `waitForSelector`, `waitForURL`, `waitForResponse`, `waitForFunction` | `waitFor`, `waitForURL`, `waitForResponse`, `waitForFunction`; host-side `ctx.waitFor` and `ctx.expect.poll` for model values | Supported with different signatures and polling semantics. `waitForResponse` must be armed before the trigger. |
| `waitForLoadState` | `waitForNavigation({ waitUntil: "load" })` | H2 suggestion only; it waits for the next navigation, not current document state. |
| `waitForRequest`, `waitForEvent("download")` | No equivalent request waiter; `waitForDownload({ timeout? })` handles eligible page downloads | Request waiter unsupported; download capture is supported with a different API and must be armed before the triggering action. |
| Locator retrying `expect(locator).toBeVisible()` and other locator assertions | `ctx.expect.poll(() => value)` | Value polling is supported; Playwright locator assertions are not implemented. |
| `route` / `fulfill` / `abort` | `route(pattern, declarativeResponse, options?)`, `unroute`, `unrouteAll` | Declarative request routing is supported; Playwright's callback route object and `route.fulfill()` / `route.abort()` methods are not. |
| `addInitScript`, `storageState`, `clock` | `addInitScript`, `storageState`, `clock.install/fastForward/uninstall`, plus `ctx.openBrowser(..., { storageState })` | Supported with Persephone-specific scope and cleanup behavior. |
| Clipboard permissions/read | `clipboard.arm()`, `clipboard.readText()`, `clipboard.writeText()` | Page-scoped test clipboard is supported; OS clipboard read and Playwright permissions API are not. |
| `page.on("dialog")`, console, page errors | `dialogs`, `handleDialog`, `consoleMessages`, `pageErrors` | Supported direct browser facade members with different event/read APIs. |
| `test.beforeEach`, `test.skip/only/fail`, retries, `--grep`, `test.step` | File exports `beforeAll`, `beforeEach`, `afterEach`, `afterAll`; `test.skip`, `test.only`, `test.fails`; `--retries`, `--grep` | Hooks, skip/only/fails, retries and grep are supported. `test.step` is not implemented. |
| Trace, screenshot, video on failure | Runner screenshots and failure bundles; browser `screenshot()` | Screenshots and diagnostic bundles are supported; Playwright trace recording and video recording are not. |
| Frames / frame locators | Snapshot refs may identify frame elements; direct `{ ref }` can retain a frame target. Selector strings and most page operations target the main frame. | No Playwright `Frame`/`FrameLocator` API or general cross-frame automation surface. Do not summarize all frame references as unsupported. |
| Headless/CI, parallel workers, cross-browser | No Persephone runner form | Not supported; use a CI-oriented browser automation runner for those jobs. |

Spell the aliases and suggestions exactly as implemented:

| Accepted hidden alias | Exact delegated form |
|---|---|
| `dblclick(locator, options?)` | `click(locator, { ...options, clickCount: 2 })` |
| `fill(locator, text, options?)` | `type(locator, text, options)` |
| `press(key, options?)` | `pressKey(key, options)` |
| `goto(url, options?)` | `navigateAndWait(url, options)` |
| `selectOption(locator, values, options?)` | `select(locator, values, options)` |
| `setChecked(locator, checked, options?)` | `check(locator, options)` when true; `uncheck(locator, options)` when false; non-boolean `checked` throws |
| `textContent(locator, options?)` | `getText(locator, options)` |
| `inputValue(locator, options?)` | `getValue(locator, options)` |
| `waitForTimeout(ms)` | `wait(ms)` |
| `goBack(options?)` | `back(options)` |
| `goForward(options?)` | `forward(options)` |

These 11 alias names are resolver-accepted despite being hidden from member listings. `isVisible` is a separate public member. The source's exact suggestion-only map is:

| Unknown Playwright name (not accepted as a method) | Exact “Did you mean …?” text |
|---|---|
| `getByRole` | `click('role=button[name="Save"]')` |
| `getByLabel` | `type('label=Email', "name@example.com")` |
| `getByText` | `click("text=Save")` |
| `getByTestId` | `click("testid=save")` |
| `getByPlaceholder` | `type("placeholder=Email", "name@example.com")` |
| `getByTitle` | `click("title=Refresh")` |
| `getByAltText` | `click("alt=Logo")` |
| `locator` | Exact displayed hint: `passing a chained selector or object locator, e.g. click("role=dialog >> role=button[name="Save"]") or click({ role: "button", name: "Save", within: { ref: "e12" } })` |
| `waitForLoadState` | `waitForNavigation({ waitUntil: "load" }) (it waits for the next navigation)` |
| `$` | `query(selector) or an existing scalar read such as getText(selector)` |
| `$$` | `query(selector) or allInnerTexts(selector)` |
| `content` | `getHtml(selector), or evaluate("document.documentElement.outerHTML") for the whole document` |

Unknown browser members may also receive normal fuzzy suggestions from the descriptor resolver, but only these 12 explicit Playwright-name keys have these guaranteed hint strings.

### 4. Add “Test models” to the temporary-extension guide

Edit `assets/guides/agents/temporary-site-extensions.md` in place; it has ample space below 20,000 characters. Add a “Test models” section after matching/scope and before results/cleanup, with these subsections:

- **Purpose and boundary:** a test model deliberately returns the bounded page content/state needed by assertions and is attached only for the test run. This differs from saved, privacy-bounded agent models described in `site-extensions.md`, whose default list should return minimal identifiers/header metadata and gate body content behind explicit reads. A temporary model uses the same AiVision model protocol and result shaping; it does not gain the saved extension's privileged fetch broker.
- **Model vs test:** page reads and reusable page actions belong in model methods; fixture/run setup, locator interaction, waits, assertions and pass/fail decisions belong in `.test.mjs`. Keep the model's returned data narrow and page-derived. After navigation or attachment, the first model read must poll because registration can lag page load; callback errors retry. The bounded 250 ms wait applies only when a probe is already in flight, and there may not yet be one right after load.
- **Navigation:** `runtime.afterReturn(callback)` schedules work after a model reply is serialized, on a best-effort timer; use it when a method must trigger navigation after producing its result. It is not a delivery guarantee. If cross-document navigation destroys an in-flight invocation, `{ allowNavigation: true }` changes the failure into the `{ navigated: true }` marker; it does not recover the original model value. Same-document SPA navigation preserves the live model registration; an app read waits up to 250 ms only if a real probe is already in flight. A model exposed late may require `remote.refresh()` to trigger a fresh probe.
- **Paging:** return bounded pages with an offset/limit and `hasMore`, then request the next slice. If normalization receives a cut reply, it fails with code `result-truncated` and an error naming `maxLength`; tests must not treat a truncated result as complete. Page large results regardless, and keep body reads explicit and per-id where appropriate.
- **Source check for this plan (not guide prose):** temporary and saved site-extension model calls use the `siteShape` / `__aiVision` path, so `BrowserPageRemote` passes `webMcp: false` to `normalizePageModelReply`; the host's `shapeResult` branch and its `MAX_ARRAY_ITEMS` 500-entry cap apply only to `webMcp: true`. The cap does not apply to site-extension calls and must not appear as their limit in the guide.
- **Several files:** link to the `scriptPath` API and state the exact contract: list order is preserved; folder loads direct `.js`/`.JS` files in ordinal/plain filename order; all concatenate into one shared scope, so a later file can use earlier declarations. Use name prefixes such as `00-base.js`, `10-app.js`; nested directories are not traversed. File-backed script errors map to file and line.
- **Required root descriptor:** `expose(root)` rejects if `root.aiVision` is absent, using the exact message found in source/runtime history. Include the minimum descriptor form `{ kind: string, summary: string, members: IAiMember[] }`; each member needs `name`, `kind: "property" | "method"`, and `summary`. `signature` is optional but recommended for methods. Expose only model members the test needs. Include a source-verified descriptor in the example.
- **Worked example:** show only `model/00-base.js`, `model/10-app.js`, and `tests/smoke.test.mjs`, copied from `assets/test-suite-template/`. Keep the first heading read and post-action assertion in `ctx.expect.poll()`; do not duplicate the fixture page, server helper, run script, or full generated suite. State that `persephone-test --init <folder>` writes the full starter including those omitted files.

#### Worked example plan for the guide

Do not inline the complete generated suite in the guide or task document. In the temporary guide, show only the three source-backed examples copied from the shipped starter template: `model/00-base.js`, `model/10-app.js`, and `tests/smoke.test.mjs` (`assets/test-suite-template/`). The test excerpt must preserve the current first-read poll after navigation and the existing post-action poll. Link to `run-options.md` for `persephone-test --init <folder>` and state that `--init` creates the full suite, including the fixture page, loopback server helper, run script, and `AGENTS.md`; those generated files are not repeated in the guide. The starter template is authoritative, so the guide excerpt is refreshed from those files during implementation rather than copied from this plan.
### 5. Keep existing CLI facts in one place and correct stale help

Keep the short `--init` entry and `--reporter json-lines` entry in `assets/guides/agents/web-app-tests/run-options.md`, where they already exist from US-2178/US-2177. The new page links there; do not duplicate either fact in the hub, call-boundary page, or temporary-extension guide unless the model section has a direct one-line pointer.

Correct `src/renderer/scripting/ai-vision/browser-automation-members.ts:8` to say browser `hover()` sends trusted pointer movement and forces CSS `:hover` on the target and composed ancestors until the next pointer action. Do not alter the correct description in `BrowserEditorFacade.ts:172-174`. Keep the browser automation guide's existing accurate statement at `assets/guides/agents/browser-automation.md:24`.

Correct `assets/guides/agents/temporary-site-extensions.md:31-33` and `assets/guides/agents/site-extensions.md:141`: do not say `allowNavigation` recovers the original reply. Say `runtime.afterReturn()` defers a page action until after reply serialization; if navigation still destroys the method invocation, `allowNavigation: true` returns `{ navigated: true }`, while the default reports `page-navigated`. The method's actual value is only available when the reply arrives before navigation.

Before implementation is considered complete, re-search `assets/guides/agents/web-app-tests/`, `assets/guides/agents/temporary-site-extensions.md`, `assets/guides/agents/site-extensions.md`, and browser facade `$help` strings for claims contradicted by EPIC-202..209. Record any additional correction discovered in the task progress and implementation diff. Current investigation found the two issues listed above; examples of feature locations to compare include session cleanup, hover/pointer state, locators, storage state, routes, clock, clipboard, captured downloads, same-document model preservation/probe waits, `scriptPath` folders, `--init`, and JSON Lines output.

Required before → after snippets for the stale claims:

```ts
// Before: src/renderer/scripting/ai-vision/browser-automation-members.ts
summary: "Move the real pointer once over a selector or ref. Browser webviews receive trusted pointer events but do not apply CSS :hover. ..."

// After: accurate descriptor summary
summary: "Move the real pointer once over a selector or ref. Browser webviews force CSS :hover on the target and composed ancestors until the next pointer action. ..."
```

```md
<!-- Before: temporary-site-extensions.md and site-extensions.md -->
If navigation wins, use { allowNavigation: true } to recover the reply.

<!-- After: describe the implemented call result -->
Use runtime.afterReturn() to schedule navigation after reply serialization. If navigation still
destroys the in-flight call, allowNavigation: true returns { navigated: true }; the original
model value is available only when the reply arrives before navigation.
```

### 6. Verification table: every API named by the planned pages/example

Line references below point to current source implementing the behavior. If implementation changes these files first, re-check the current line before writing the guide. Claude must spot-check the worked example and any behavior that requires a live Persephone process; Codex cannot run the product or live-check this model.

| API or claim named in plan/example | Implementation reference and verification |
|---|---|
| Immediate matcher names, recursive `.not`, optional `message`, argument behavior | `src/test-host/expect.ts:5-18,32-48,59-120,129-132` (`MATCHERS` is the canonical 18-name list; proxy implements `.not` and unknown-name diagnostics; `toMatch`, `toHaveProperty`, `toThrow`, and numeric matcher argument shapes are validated here). |
| Polling matchers, `.not`, callback retry rules, poll options | `src/test-host/poll-expect.ts:10-18,34-60,63-90`; same `matcherNames`/`prepareMatcher` imported from `expect.ts`. |
| `ctx.expect`, `ctx.expect.poll`, `ctx.usePage`, `ctx.openBrowser`, `ctx.root`, `ctx.app` | `src/test-host/context.ts:11-31`; operations at `src/test-host/context-operations.ts:43-62,68-121,150-180,188-208`. |
| Open page, `storageState` object or JSON path, cookie and Web Storage application, ownership | `src/test-host/browser-helpers.ts:17-66`; storage format and input type at `:12-15`; open page owned-ID registration is in `src/test-host/context-operations.ts:68-80`. |
| Adopt exactly one page by URL/title and release semantics | `src/test-host/browser-helpers.ts:12,68-103,286-306`; `src/test-host/context-operations.ts:48-52,150-180`. |
| Session cleanup: page retained; clipboard/routes/clock/init scripts/test power cleared; selected-window ownership | `src/test-host/browser-helpers.ts:110-160,191-225`; page/file lifecycle in `src/test-host/test-file-run.ts:126-142`; test-attempt cleanup in `src/test-host/test-attempt.ts:130-142`. |
| Owned/attached-selected/attached-created windows; `--window` selection; scoped paths and disposal | `src/test-host/test-window.ts:5-19,21-40,42-58,82-87`; CLI parse/`--window requires --attach` at `src/main/test-mode/arguments.ts:125-129,178`; numeric-index and case-insensitive title-substring selection at `src/main/mcp/ai-vision/test-window-operations.ts:29-50`; runner disposal at `src/test-host/runner.ts:118-130`. |
| Pages eligible for test power; private-page refusal | `src/renderer/editors/browser/agent-access.ts:26-33`; actual gate at `BrowserEditorFacade.ts:286-310,335-340`. |
| Hidden Playwright alias inventory and exact delegated implementations | `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts:22-35,57-77`; registration in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:15,361-365`. |
| H2 Playwright-name suggestion keys and exact suggestion strings | `src/renderer/scripting/ai-vision/browser-playwright-aliases.ts:37-51`; facade wires `suggestBrowserPlaywrightName` at `BrowserEditorFacade.ts:365`. |
| Direct browser members used in mapping: interaction, evaluate/reload, locators, waits, diagnostics, download, route, storage, clock, clipboard | Member declarations at `src/renderer/scripting/ai-vision/browser-automation-members.ts:4-35`; facade methods at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:470-485,525-646,604-610,670-715,810-850`; storage members/implementation at `src/renderer/editors/browser/BrowserStorageFacade.ts:4-15,24-78`; fake clock at `BrowserClock.ts:21-42,69-112`; clipboard at `BrowserClipboardFacade.ts:6-9,27-42`; route operations at `BrowserRequestRoutes.ts:6-45`; download wait at `BrowserDownloadCapture.ts:6-20`. |
| Selector grammar, object locators, chain filters, `nth`, role/label examples | `src/renderer/automation/locator.ts:1-150`; selector parsing and role attributes at `src/renderer/automation/page-scripts.ts:1-70,130-210`; object shape in `src/renderer/api/types/browser-editor.d.ts:30-130`. |
| Frames qualification: direct refs versus main-frame string selectors | `src/renderer/automation/locator.ts:35-80,150-205`; `src/renderer/scripting/ai-vision/browser-automation-members.ts:1-3` snapshot/ref description. Confirm current frame/OOPIF limits during Claude's live spot-check. |
| Navigation call option and lost/re-probed page model | Call options at `src/test-host/app-proxy.ts:1`; forwarding at `src/test-host/context-operations.ts:68-120,188-208`; navigation recovery/re-probe in `src/renderer/editors/browser/BrowserPageRemote.ts:320-425,530-555`. |
| Temporary runtime `expose`, `afterReturn`, cleanup registration, late `remote.refresh()` | `src/site-extension-runtime.ts:15-18,43-52,106-121`; `afterReturn` invocation tracking and best-effort timer dispatch are implemented in `src/site-extension-helpers.ts:111-153`; the browser transport observes remote `refresh()` at `doc/architecture/scripting.md:1094-1112`, and the existing saved-model guide describes late-exposure refresh at `assets/guides/agents/site-extensions.md:305-321`. |
| `allowNavigation` result on cross-document call loss; same-document model registration | `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:144,406`; `src/renderer/editors/browser/BrowserPageRemote.ts:180-207,333-414`; same-document preservation rationale and accepted contract in `doc/tasks/US-2175-model-across-spa-navigation/README.md:15-19,31-35,82-109`. |
| Cut model reply error and model branch (`result-truncated`, `maxLength`; whether host `MAX_ARRAY_ITEMS` applies) | `src/renderer/editors/browser/page-model-reply.ts:6-24` returns `result-truncated` with the `maxLength` detail when normalized metadata says truncated. `BrowserPageRemote.request()` computes `webMcp` in `src/renderer/editors/browser/BrowserPageRemote.ts:322-348` and passes it to `normalizePageModelReply()` at `:386`; site model discovery/registration is at `:27-29,605-636`, and `src/site-extension-runtime.ts:2-5,42-48` publishes the `expose(root)` model through ai-vision/remote. The temporary/saved site-extension model is the `siteShape` / `__aiVision` path (`src/shared/browser-page-globals.ts:1-2`), so `webMcp` is false and the host `shapeResult` call is skipped. Its 500-item cap in `node_modules/ai-vision/dist/core/result-shaper.js:17-20,164-169` must not be presented as applying to these site-extension calls. |
| First model read after navigation/attachment and bounded probe wait | `src/renderer/editors/browser/BrowserSiteExtensionController.ts:642` starts a probe after injection; `src/renderer/editors/browser/BrowserPageRemote.ts:93-108,451-469` waits at most 250 ms only when an active probe exists, otherwise returns without waiting. `src/test-host/poll-expect.ts:34-60` retries callback errors. |
| Exposed model probe after injection and bounded wait during a real probe | `src/renderer/editors/browser/BrowserPageRemote.ts:250-263,280-304,541-550`; probe after injection call in `src/renderer/editors/browser/BrowserSiteExtensionController.ts:642`; facade waits for a current registration at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:337-345`. Same-document navigation does not clear the model or automatically require `remote.refresh()`. |
| `scriptPath` files/lists/folders, extension sorting, shared source assembly and line mapping | `src/renderer/editors/browser/temporary-extension-sources.ts:16-75,88-117`; concatenated shared-scope evaluation at `src/renderer/editors/browser/SiteExtensionInjection.ts:22-53`; facade option text at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:58,670-673`. |
| Required `aiVision` root descriptor and exact expose error | The runtime delegates to `ai-vision/remote` in `src/site-extension-runtime.ts:5,43-47`; `IAiVisionDescriptor` fields and `IAiMember` requirements are in `patches/ai-vision+1.4.0.patch:84-137`; the exact validator error and minimum `{ kind, summary, members }` shape are recorded in `doc/reviews/ai-vision-feedback.md:1279` and US-2178's live-failure note. Claude must spot-check `expose()` live. |
| File hooks, exported test descriptor array, `test()` global | `src/test-host/file-hooks.ts:5-24`; context is `src/test-host/context.ts:11-31`; descriptor validation `src/test-host/test-descriptor-validation.ts:7-19`; global `test` installation `src/test-host/index.ts:20-25`; descriptor factory and modifiers `src/test-host/test-api.ts:1-50`. |
| Template excerpts planned for the guide: `heading`, `items`, descriptor, first-read and post-action polls, locator actions, file hooks, `scriptPath` folder | Copy from authoritative shipped files `assets/test-suite-template/model/00-base.js:1-10`, `model/10-app.js:1-18`, and `tests/smoke.test.mjs:1-35`. The first-heading poll is at `smoke.test.mjs:26`; the follow-up assertion poll is at `:30-33`. `assets/test-suite-template/site/index.html:18-29` contains the corrected input lookup and is intentionally not copied into the guide. The full suite's fixture, server helper, run script, and `AGENTS.md` come from `persephone-test --init <folder>` (`src/main/test-mode/init-suite.ts:1-80`), not from additional guide snippets. |
| JSON Lines and `--init` short references (no duplicated guide contract) | `src/test-host/json-lines-reporter.ts:1-25,52-75`; `--reporter` parsing in `src/main/test-mode/arguments.ts:129-137`; `--init` parsing in `src/main/test-mode/arguments.ts:28-47`; init execution in `src/main/test-mode/init-suite.ts:1-80`; current single guide entries are `assets/guides/agents/web-app-tests/run-options.md:33-39,53`. |
| Screenshot/failure capture and reporter coverage boundaries | `src/test-host/test-attempt.ts:130-142`; `src/test-host/results.ts:1-45,90-130`; `src/test-host/runner.ts:135-171`. |

### 7. Link and page-size plan

- Add the new `browser-models-and-playwright.md` row only to `assets/guides/agents/web-app-tests/index.md`'s Read next table. The page name is a sibling page; there is no file/folder stem collision.
- Add links from the new page to `./index.md`, `./attached-runs-and-results.md`, `./run-options.md`, and `../temporary-site-extensions.md`; add a reciprocal link in the temporary guide to the new page and to `./site-extensions.md` / `./site-extensions-example.md` for saved-model contrast. Update the existing navigation advice in `temporary-site-extensions.md` and `site-extensions.md` as described above.
- No existing page moves and no existing anchors are removed, so no current link needs a path or anchor change. The current consumers found by `rg -n '\]\([^)]*(call-boundary-and-examples|attached-runs-and-results|site-extensions-example|site-extensions\.md|temporary-site-extensions|web-app-tests)' assets/guides src` are `web-app-tests/index.md` (call-boundary and attached-runs pages plus polling/storage anchors), `web-app-tests/file-hooks.md` (attached-runs), `web-app-tests/call-boundary-and-examples.md` (index and attached-runs), `web-app-tests/attached-runs-and-results.md` (storage-state anchor), `temporary-site-extensions.md` (site-extensions runtime anchor), and the other agent/browser/site-extension guide pages listed by that search. Preserve those targets; only add the links listed above.
- Do not add the new sibling page to `HUB_FOLDERS`; it is a content page. Do not modify MCP manifest/editor registrations because the existing `web-app-tests` hub already exposes every child markdown page from its directory.
- Keep `index.md` at or below the 10,000-character hub limit, the new page and temporary guide below 20,000 characters, and do not expand the current 19,994-character call-boundary page. Run `npm run guides:check` after implementation; the sandbox may fail to spawn esbuild, in which case Claude must run it. Record the exact result, not an inferred pass.

## Concerns

- **Live verification:** Codex cannot run Persephone. After implementation, Claude must live-spot-check the hidden aliases `fill` and `dblclick`; the exact `getByRole` hint; `role=` and `label=` selectors; the `aiVision` missing-descriptor error; and `allowNavigation` returning `{ navigated: true }`. The three guide excerpts must be copied from `assets/test-suite-template/`; the shipped suite's first-read poll is required because registration can lag navigation.
- **Scope-sensitive wording:** frame refs are not the same as full Playwright frame support. Keep the table's split qualification and check it against current `locator.ts` before publishing.
- **Guide limits:** the new guide page avoids expanding the nearly full call-boundary page; the hub row must be measured after implementation.
- No product/API behavior change is planned. The later implementation includes wording corrections in one stale `$help` descriptor and two stale guide statements; no guide/source implementation is made in this planning turn.

## Acceptance Criteria

- [x] This document was reviewed before implementation; no guide/source implementation was made as part of the planning task.
- [x] The new web-app guide page lists every matcher from current source, `.not`, immediate and poll options, session-page cleanup effects/non-effects, and exact owned/attached/window-selection rules.
- [x] The Playwright table accurately lists all 11 hidden aliases, all 12 explicit H2 suggestion keys and exact suggestion strings, direct Persephone members, partial frame support, and genuinely unsupported features.
- [x] The model-vs-test section explains bounded model results and test-owned assertions/actions, and requires polling the first model read after navigation or attachment because registration can lag page load.
- [x] `temporary-site-extensions.md` has a Test models section covering purpose versus saved models, model/test division, navigation and re-probe lifecycle, paging and `result-truncated`/`maxLength`, multi-file scope/order, the required root AiVision descriptor, and only the three starter-template excerpts (`model/00-base.js`, `model/10-app.js`, `tests/smoke.test.mjs`). It states that `--init` writes the full suite including the omitted fixture/server/run-script files.
- [x] Every planned API and example member is represented in the verification table with a current source path and line; Claude's live spot-check list covers `fill`, `dblclick`, `getByRole` hint text, `role=`/`label=`, the `aiVision` error, and the `allowNavigation` marker.
- [x] Stale hover text is corrected in `browser-automation-members.ts`; stale `allowNavigation` reply claims are corrected in `temporary-site-extensions.md` and `site-extensions.md`. The saved site-extension guide's generic array/depth shaping cap was also corrected for site-shape models. Other EPIC-202..209-related guide and `$help` claims were searched; no further contradictions were found.
- [x] CLI facts for `--init` and `--reporter json-lines` have one owner each in `run-options.md` and are not duplicated in the new page.
- [ ] All new/changed links resolve; existing anchors remain; page/hub limits pass `npm run guides:check` (Claude runs it if Codex's sandbox cannot spawn esbuild).
- [x] No customer/company name or data appears; all example data is synthetic.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-2179-web-app-test-guides/README.md` | This implementation plan, source verification table, starter-excerpt plan, stale-text findings, and guide/link/size plan. |
| `assets/guides/agents/web-app-tests/index.md` | Add one Read next row to the existing hub. |
| `assets/guides/agents/web-app-tests/browser-models-and-playwright.md` | New source-backed matcher, session/window, Playwright mapping, and model-vs-test guide page. |
| `assets/guides/agents/temporary-site-extensions.md` | Add the Test models section and the three source-backed template excerpts; correct stale `allowNavigation` claim; link to saved-model reference and web-app test hub. |
| `assets/guides/agents/site-extensions.md` | Correct stale `allowNavigation` claim; retain its saved-model privacy guidance. |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts` | Correct the stale hover member summary; current facade help at `BrowserEditorFacade.ts:172-174` is already accurate. |
| `assets/guides/agents/web-app-tests/run-options.md` | No change planned; it already owns the short `--init` and `--reporter json-lines` entries. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | No change planned; near the 20,000-character limit and its polling/storage examples remain linked. |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md`, `file-hooks.md` | No change planned; retain as the existing detail references after the source re-check recorded above. |
| `assets/guides/agents/site-extensions-example.md` | No change planned; retain as the saved-extension example reference. `site-extensions.md` is changed above only to correct its navigation claim. |
| `scripts/guides-check-entry.ts`, `src/main/mcp/manifest.ts`, `src/renderer/editors/register-editors.ts` | No change planned; web-app-tests is already a registered hub and new sibling pages are discovered under it. |
| `doc/active-work.md`, `doc/epics/EPIC-209.md` | No change planned; the dashboard and epic task row already exist. |
