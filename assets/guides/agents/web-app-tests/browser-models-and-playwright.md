---
title: "Browser models, matchers, and Playwright mappings"
audience: "agent"
summary: "Which test matchers, session pages, browser windows, model calls, and Playwright-like browser methods does Persephone support?"
---

# Browser models, matchers, and Playwright mappings

This page describes the current test host and browser facade. For the common call flow, see the
[web-app test guide](./index.md). For the complete test example, see
[call boundary and examples](./call-boundary-and-examples.md). For temporary model code, see
[temporary site extensions](../temporary-site-extensions.md). For selected-window setup and captured
results, see [attached runs and results](./attached-runs-and-results.md).

## Matchers

`ctx.expect(value, message?)` checks a value now. Its optional message is prepended to an assertion
failure. Every matcher supports recursive `.not`, such as
`ctx.expect(value).not.toBe(expected)`.

The 18 matchers are `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeFalsy`, `toBeNull`,
`toBeUndefined`, `toBeDefined`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`,
`toBeLessThanOrEqual`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toMatchObject`,
`toContainEqual`, and `toThrow`. `ctx.expect.poll()` uses the same names and `.not`; it polls a
value-producing callback, not a browser locator:

```js
await ctx.expect.poll(() => site.app.heading()).toBe("Mock list");
```

`toHaveProperty(path, expected?)` takes a non-empty dotted path. `toMatch` takes a `RegExp`;
`toMatchObject` takes an object. Numeric comparisons and `toHaveLength` take numbers. `toThrow`
takes a synchronous function and may also take a string, `RegExp`, or `Error` constructor.

Polling accepts only `timeout`, `interval`, and `message`:

```js
await ctx.expect.poll(readValue, {
    timeout: 5000,
    interval: 100,
    message: "The value should appear",
}).toEqual(expected);
```

When supplied, timeout and interval must be positive finite numbers. Explicit timeout is scaled by
`--timeout-scale`; explicit interval is already in milliseconds. Callback errors retry. Environment
stop errors end polling. Unknown options and matcher names throw.

## Session pages and storage state

Use `ctx.usePage({ url?, title? })` to adopt one existing browser page in the selected test window.
The filters may be used together; adoption must resolve to exactly one page. Use
`ctx.openBrowser(url, { storageState? })` when the run should create and own the page. `storageState()`
captures applicable profile cookies and current-origin local and session storage. `openBrowser`
accepts that object or a JSON file path relative to the test file. Cookies are applied before the
first navigation; Web Storage is seeded at document start for matching origins. Treat state files
as credentials and keep them in an ignored local directory. `storageState()` returns the whole
state by default; with an explicit `maxLength` that is too small it fails and asks you to raise the
cap, instead of returning partial state. `usePage` accepts normal-profile pages;
user-opened Incognito and Tor pages are refused.
For setup examples, see [attached runs and results](./attached-runs-and-results.md).

Cleanup releases adopted-page test access and resets test-owned clipboard recording, routes, fake
clock, and init-script registrations. The adopted page stays open; the runner does not reload or
navigate it. Cleanup does not restore cookies, local or session storage, form contents, app state,
URL, or arbitrary page effects.

In a selected existing window, unrelated pages remain open. Cleanup closes pages created by
`ctx.openBrowser()` and their new pop-ups, plus pop-ups created on adopted session pages. Owned
windows and runner-created attached windows use a baseline diff to close new pages. The
runner-created attached window is disposed at run end; a selected existing window is preserved.

## Test-window scope

Without `--attach`, the runner owns its test window. `--attach` without `--window` creates a
dedicated test window. `--window` selects an existing window by decimal window-record index or a
unique case-insensitive title substring; ambiguous matches fail. `--window` requires `--attach`.

Unprefixed context calls and `ctx.app` are scoped to the selected test window. `ctx.root` and
explicit `ctx.app.windows[i]` paths can reach elsewhere in the app. This wider call scope does not
grant browser test powers over an arbitrary user page. Browser test powers are available only on
pages opened by the run or adopted with `ctx.usePage()`, which searches only the selected test
window.

## Playwright to Persephone

Persephone accepts selector strings and supported object locators. It does not create Playwright
`Locator` objects or implement Playwright's full API.

| Playwright intent | Persephone form | Support |
|---|---|---|
| `click`, `hover`, `fill`/`type`, `check`, `selectOption`, file input, drag | `click`, `hover`, `type`, `check`/`uncheck`, `select`, `setInputFiles`, `drag` | Public methods with Persephone argument shapes. |
| `dblclick(locator, options?)` | `click(locator, { ...options, clickCount: 2 })` | Hidden accepted alias. |
| `fill(locator, text, options?)`; `press(key, options?)`; `goto(url, options?)` | `type(locator, text, options)`; `pressKey(key, options)`; `navigateAndWait(url, options)` | Hidden accepted aliases. |
| `selectOption`, `setChecked`, `textContent`, `inputValue`, `waitForTimeout`, `goBack`, `goForward` | `select`, `check`/`uncheck`, `getText`, `getValue`, `wait`, `back`, `forward` | Hidden accepted aliases. `setChecked` requires a boolean. |
| `focus`, `mouse.down/move/up`, `mouse.wheel`, `dragTo` | `focus`, `mouseDown`, `mouseMove`, `mouseUp`, `wheel`, `dragTo` | Public methods. `drag` also accepts a locator and offset. |
| `page.evaluate`, `page.reload` | `evaluate(expression, options?)`, `reload(options?)` | Public methods with Persephone-specific arguments. |
| `getByRole`, `getByLabel`, `getByText`, `getByTestId`, `getByPlaceholder`, `getByTitle`, `getByAltText` | `role=`, `label=`, `text=`, `testid=`, `placeholder=`, `title=`, `alt=` selectors or object locators | The Playwright method names are suggestion-only, not accepted calls. Role and name facts use Chromium accessibility data. |
| `locator().locator()`, `filter({ hasText })`, `nth()` | Chained selectors with ` >> `, suffixes such as `:has-text("...")` and `:visible`, `nth=N`, action/read `{ nth }`, or object locators | No Locator object or chain-building method. Refs can use `{ ref }`; plain selector strings target the main frame. |
| `count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`, `boundingBox` | Same-named methods | Immediate reads; strictness and frame limits vary by method. |
| `waitForSelector`, `waitForURL`, `waitForResponse`, `waitForFunction` | `waitFor`, `waitForURL`, `waitForResponse`, `waitForFunction`; host-side `ctx.waitFor` or `ctx.expect.poll` for model values | Different signatures and polling behavior. Arm `waitForResponse` before the request. |
| `waitForLoadState` | `waitForNavigation({ waitUntil: "load" })` | Suggestion only. Waits for the next navigation, not the current document state. |
| `waitForRequest`, `waitForEvent("download")` | No request waiter; `waitForDownload({ timeout? })` captures eligible downloads | Download capture has a different API and must be armed before the action. |
| `expect(locator).toBeVisible()` and other locator assertions | `ctx.expect.poll(() => value)` | Value polling only; locator assertions are not implemented. |
| `route` / `fulfill` / `abort` | `route(pattern, declarativeResponse, options?)`, `unroute`, `unrouteAll` | Declarative routing is supported. Playwright callback route objects and `route.fulfill()`/`route.abort()` are not. |
| `addInitScript`, `storageState`, `clock` | `addInitScript`, `storageState`, `clock.install/fastForward/uninstall`, `ctx.openBrowser(..., { storageState })` | Supported with Persephone scope and cleanup rules. |
| Clipboard read and permissions | `clipboard.arm()`, `clipboard.readText()`, `clipboard.writeText()` | Page-scoped test clipboard only. No OS clipboard read or Playwright permissions API. |
| Dialogs, console, page errors | `dialogs`, `handleDialog`, `consoleMessages`, `pageErrors` | Supported with different event and read APIs. |
| Hooks, skip/only/fail, retries, grep, `test.step` | `beforeAll`, `beforeEach`, `afterEach`, `afterAll`; `test.skip`, `test.only`, `test.fails`; `--retries`, `--grep` | Hooks, modifiers, retries, and grep are supported. `test.step` is not. |
| Traces, screenshots, video on failure | Runner screenshots and failure bundles; browser `screenshot()` | Screenshots and diagnostic bundles are supported. Trace and video recording are not. |
| Frames and frame locators | Snapshot refs may identify frame elements; direct `{ ref }` retains a frame target | No Playwright `Frame`/`FrameLocator` or general cross-frame API. Selector strings and most operations target the main frame. |
| Headless CI, parallel workers, cross-browser | No runner form | Not supported. |

The 11 hidden aliases are `dblclick`, `fill`, `press`, `goto`, `selectOption`, `setChecked`,
`textContent`, `inputValue`, `waitForTimeout`, `goBack`, and `goForward`. They are resolver-accepted
but absent from `$help` member lists. `isVisible` is a public member, not an alias.

| Accepted alias | Delegated call |
|---|---|
| `dblclick(locator, options?)` | `click(locator, { ...options, clickCount: 2 })` |
| `fill(locator, text, options?)` | `type(locator, text, options)` |
| `press(key, options?)` | `pressKey(key, options)` |
| `goto(url, options?)` | `navigateAndWait(url, options)` |
| `selectOption(locator, values, options?)` | `select(locator, values, options)` |
| `setChecked(locator, checked, options?)` | `check(locator, options)` when true; `uncheck(locator, options)` when false; non-boolean values throw. |
| `textContent(locator, options?)` | `getText(locator, options)` |
| `inputValue(locator, options?)` | `getValue(locator, options)` |
| `waitForTimeout(ms)` | `wait(ms)` |
| `goBack(options?)` | `back(options)` |
| `goForward(options?)` | `forward(options)` |

These 12 Playwright names are suggestion keys, not callable aliases. The exact displayed hints are:

| Name | Hint |
|---|---|
| `getByRole` | `click('role=button[name="Save"]')` |
| `getByLabel` | `type('label=Email', "name@example.com")` |
| `getByText` | `click("text=Save")` |
| `getByTestId` | `click("testid=save")` |
| `getByPlaceholder` | `type("placeholder=Email", "name@example.com")` |
| `getByTitle` | `click("title=Refresh")` |
| `getByAltText` | `click("alt=Logo")` |
| `locator` | `passing a chained selector or object locator, e.g. click("role=dialog >> role=button[name="Save"]") or click({ role: "button", name: "Save", within: { ref: "e12" } })` |
| `waitForLoadState` | `waitForNavigation({ waitUntil: "load" }) (it waits for the next navigation)` |
| `$` | `query(selector) or an existing scalar read such as getText(selector)` |
| `$$` | `query(selector) or allInnerTexts(selector)` |
| `content` | `getHtml(selector), or evaluate("document.documentElement.outerHTML") for the whole document` |

Other unknown names may receive ordinary fuzzy suggestions.

## Put page behavior in the model, checks in the test

Model methods in `site.app` should expose bounded, page-derived reads and reusable page actions.
The test owns setup, browser-facade interactions, waits, assertions, and pass/fail choices. Keep
returned data narrow. After navigation or attachment, poll the first model read: registration can
lag page load, and callback errors retry. The browser waits up to 250 ms only when a registration
probe is already active; it returns immediately when no probe is active. See
[temporary model guidance](../temporary-site-extensions.md#test-models) for the lifecycle and example.

For the existing `--init` and JSON Lines references, see [run options](./run-options.md).
