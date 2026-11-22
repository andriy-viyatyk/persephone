---
title: "Web-app test call boundary and example"
audience: agent
summary: "Understand how test stand-ins resolve call paths and follow a complete authenticated browser test example."
---

# Call boundary and worked example

Return to [Web-app regression tests](./index.md) for test setup and run commands, or see [attached runs, session pages, and results](./attached-runs-and-results.md) for reuse and diagnostics.

## Per-test timeouts

Each attempt is bounded by 300,000 ms by default. Set the run default with `--test-timeout <ms>`
or `--test-timeout=<ms>`; a descriptor's `timeout` overrides that run value. The option is
available on `test`, `test.skip`, `test.only`, and `test.fails`:

```js
test("scheduled job", async (ctx) => { /* steps */ }, { timeout: 480000 });
test.fails("known failure", async (ctx) => { /* steps */ }, { reason: "issue", timeout: 10000 });
```

Timeout values are non-negative safe integer milliseconds. `0` disables the bound. Positive
values are multiplied once by `--timeout-scale`, rounded, and clamped to the timer limit. A retry
gets a fresh bound. The bound covers `beforeEach` and the test body; `afterEach` gets a separate
fresh bound of the same duration after failure capture. File hooks use the scaled run-level timeout.
Failure capture and page cleanup run afterward with their own limits. A timeout reports
`Test timed out after N ms; last step: <step>` and keeps the step captured at expiry. A timed-out
`test.fails` remains an expected failure when cleanup succeeds.

The host cannot cancel an already dispatched MCP request, arbitrary JavaScript, synchronous loops,
or spawned processes. Such work can finish after timeout and may still affect the app; later context
and retained setup-adapter calls are rejected, but server-side effects already in flight are not
undone. An in-flight `restartApp()` is allowed to finish before failure capture and cleanup.
## Crossing the call boundary

`ctx.app` is the root of Persephone's test call tree. It is separate from the script-facing `app`
object available inside `ctx.script(code)`. A stand-in names a path; every property read or method
call makes a fresh request and resolves that path again, including after an editor switch. A method
starts its request as soon as you call it, while a property read starts its request when you await
it. Awaiting a stand-in returns that path's summary or value. `ctx.app.withOptions({ maxLength,
dialog }).some.path` binds call options to descendant reads and calls without changing their paths.

Successful call results preserve their original types: JSON-looking strings such as `"true"` and
`"42"` stay strings, while booleans and numbers stay typed values. `callText(path, args)` always
returns the primary text body unchanged. Call arguments must be JSON values; methods with no
arguments still need an explicit `[]` when called through `ctx.call`. At the result boundary,
top-level `undefined` arrives as `null`, and undefined-valued object properties are dropped.
Functions and other non-JSON argument values are not supported.

`waitFor(pathOrCallback, predicate, { timeout, maxLength, dialog, allowNavigation, message })` resolves to the value from the
poll that satisfies the predicate. `timeout` sets the polling deadline; `maxLength`, `dialog`, and
`allowNavigation` are forwarded for each path poll. Set `dialog: true` when polling while a renderer
dialog or popup menu has attention, including reads from `dialogs` or `menus`. Callback and predicate
errors still stop `waitFor` immediately. An optional `message` is prepended to its timeout error.

## Polling assertions

Use `ctx.expect.poll` when the value is expected to become true eventually. Its callback receives
`ctx` and runs again for each sample; synchronous values, promises, and awaited stand-ins are
supported. Ordinary callback throws and rejections count as “not yet” and are retried. Environment
stop errors escape immediately. Each matcher returns a promise, so await it:

```js
await ctx.expect.poll(() => site.app.dialog, {
  timeout: 5000,
  interval: 200,
  message: "Dialog should open",
}).toMatchObject({ title: "Ready" });
await ctx.expect.poll(async (ctx) => await ctx.app.pages.activePage.id)
  .not.toBeUndefined();
```

Polling assertions support every `expect` matcher: `toBe`, `toEqual`, `toContain`, `toBeTruthy`,
`toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThan`,
`toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toHaveLength`, `toHaveProperty`,
`toMatch`, `toMatchObject`, `toContainEqual`, and `toThrow`. Every matcher supports recursive
`.not`; matcher arguments are validated once before the callback runs. `toThrow` expects the callback
sample itself to be a synchronous function, which the matcher invokes on each sample.

The default timeout is the runner's scaled `waitFor` timeout (10 seconds by default), and the default
interval is its scaled 200 ms poll delay. An explicit timeout is multiplied by `--timeout-scale`;
an explicit interval is already in milliseconds and is not scaled again. Both must be positive finite
numbers. On timeout, the assertion shows an optional message, a compact expected matcher, then the
last actual value or callback error. `waitFor` retains its immediate callback/predicate error behavior;
only `expect.poll` retries callback errors.

`openBrowser()` returns the existing editor stand-in, with a local `pageId` property containing the
created page's id. Use that id for paths such as `pages[pageId]`; it is metadata on the returned
handle and is never sent as a call-tree member. Tests may leave pages unsaved because the host
closes pages they opened. Cleanup belongs in `finally`, and cleanup code must catch its own errors
so it never throws over the test's original result.

Matcher failures are recorded as the current test step. `toThrow` accepts a synchronous function and
optionally a string, regular expression, or error constructor to match. `toHaveProperty` accepts a
dotted path and an optional expected value. Pass ordinary values to `expect`; await a stand-in or
read one of its properties first.

Use modifiers to focus, skip, or document a known failure:

```js
test.skip("later", async (ctx) => { /* skipped */ });
test.only("focus this test", async (ctx) => { /* runs alone among selected tests */ });
test.fails("known issue", async (ctx) => { /* should fail */ }, { reason: "issue description" });
```

If any selected test uses `test.only`, only selected `only` tests run. A `test.fails` test that fails
is reported as `expected-failure`; if it passes, it is `unexpected-pass` and fails the run. A normal
failure that passes on a retry is `flaky`. Expected failures and flaky tests are listed but do not
fail the run; unexpected passes do (exit code `1`).

## Storage state

Save a browser snapshot with Node's `fs/promises`; `ctx.file()` resolves relative to the suite file.
Keep state files under an existing git-ignored local directory because they contain cookies and
sign-in tokens. `storageState()` reads cookies for the browser profile/partition that apply to the
current URL, including HttpOnly cookies. Applying them on a persistent profile can overwrite and
persist the user's cookies for that domain. Use `incognito: true` for a disposable in-memory session
or a dedicated profile when persistence is needed.

```js
import fs from "node:fs/promises";

export default [
  test("save and reuse a browser session", async (ctx) => {
    const statePath = ctx.file(".local-test-state/auth.json");
    const signedIn = await ctx.usePage({ url: "https://example.test/" });
    await fs.writeFile(statePath, JSON.stringify(await signedIn.storageState(), null, 2), "utf8");

    const site = await ctx.openBrowser("https://example.test/orders", {
      storageState: statePath,
      incognito: true,
    });
    await site.waitFor({ selector: "[data-testid='orders-dashboard']" });
  }),
];
```

The snapshot contains local and session storage for the current HTTP(S) origin. Applying state
installs cookies before the first navigation and seeds matching-origin Web Storage through a
temporary document-start script. The runner removes the registration when navigation settles,
including timeout or failure; a redirect or reload before settlement may seed again only when its
origin exactly matches.

## Worked example: authenticated dashboard

Assume the user has already logged in to the browser profile named `qa-browser`:

```js
export default [
  test("opens the orders dashboard", async (ctx) => {
    const site = await ctx.openBrowser("https://example.test/orders", {
      profile: "qa-browser",
    });
    await site.waitFor({ selector: "[data-testid='orders-dashboard']" });
    await site.click("[data-testid='refresh-orders']");
    await site.waitFor({ selector: "[data-testid='orders-loaded']" });
    const heading = await site.evaluate(
      "() => document.querySelector('[data-testid=orders-heading]')?.textContent?.trim()",
    );
    ctx.expect(heading).toBe("Your orders");
  }),
];
```

Save as `orders.test.mjs` and run it with
`persephone-test.exe .\orders.test.mjs --profile qa --log-dir .\orders-run`. If the assertion fails, read `report.md` and the screenshot first. Then
check `site-console.log` for page errors/messages and `network.log` for failed requests or an
unexpected response status for the dashboard request. A request status and URL are logged, but
its headers and body are not.

The runner retries its own page bookkeeping reads up to three times when attention is present, 200 ms apart by default (scaled by `--timeout-scale`); it never replays test calls. Attention in the test window fails the test with its cause. Attention identified in another window, persistent unidentifiable attention on a runner read, or a closed/replaced test window stops the run (exit 3). The interrupted test and remaining selected tests are `not-run`; the interrupted test may already have changed state. After a stop, `--rerun-failed` selects the failures and tests that did not run. The report names the cause. Untracked OS-level dialogs may not produce an attention reply.

### Start a download wait before the click

`waitForDownload()` is available on pages opened by the agent or adopted with `ctx.usePage()`.
The download wait defaults to 10 seconds. When extending it, extend the outer MCP request timeout
through `.withOptions()` as well; the outer request must outlast the API wait and fit inside the
test's own timeout:

```js
const pending = site.waitForDownload.withOptions({ timeout: 40_000 })({ timeout: 35_000 });
await site.click("#export");
const file = await pending;
// { suggestedFilename, path, size }; path is under the run output downloads/ folder
```

The runner copies the app-owned capture into `downloads/`, removes its temporary copy, and records
relative attachment metadata in the reports and failure bundle. Files are limited to 32 MiB.
There is a residual ordering race because the wait and click are separate MCP requests: if the
click reaches the page before the wait IPC is armed, that download follows the ordinary route
(including a Save dialog in an attached normal app) and the wait times out. The wait does not
bypass the download gesture gate; use a trusted `site.click()` for downloads that need a gesture.

## Playwright patterns in Persephone

`ctx.openBrowser()` returns the browser editor itself, so register document-start setup directly
through that handle. The script runs on later documents in that tab; tests that adopt an existing
page can use `ctx.usePage()` and cleanup clears its init scripts automatically.

```js
const page = await ctx.openBrowser("http://localhost:5173");
const initScriptId = await page.addInitScript(`
    window.testMode = true;
`);
await page.navigateAndWait("http://localhost:5173");
await page.removeInitScript(initScriptId);
const removed = await page.clearInitScripts(); // number of registrations removed
```

`addInitScript` returns an opaque ID; `removeInitScript` returns whether it found that ID, and
`clearInitScripts` returns the number removed. Scripts are limited to 1,000,000 characters and 50
per tab. They run unchanged before page scripts on later documents (not the current one), in the
main frame and same-process child frames, not OOPIFs. They persist through reload and cross-origin
navigation and clear when the tab closes. DevTools pauses them while CDP is detached; the next
automation call restores them before it runs. `ctx.usePage()` cleanup clears registrations on adopted
pages; pages opened with `ctx.openBrowser()` close during cleanup.

### Fake clock for scheduled work

Install before navigation so the application registers its timers under fake time. The clock starts
at `now` (a `Date`, epoch milliseconds, or parseable string), keeps advancing with real elapsed time,
and `fastForward(ms)` adds a time jump while running due callbacks:

```js
const site = await ctx.openBrowser("about:blank");
await site.clock.install({ now: "2026-01-01T00:00:00Z" });
await site.navigateAndWait("http://localhost:5173");
await site.clock.fastForward(4 * 60 * 1000);
// Assert the app's scheduled run has fired.
await site.clock.uninstall();
```

The fake covers page `Date`, `Date.now()`, `performance.now()`, timeout/interval, and
animation-frame functions; `queueMicrotask` is unchanged. Installing in a loaded page affects future
global lookups but cannot migrate existing timers or replace references captured earlier. Same-process
frames get independent clocks, while host controls target the main frame. Workers, OOPIFs,
network timing, and painting are not controlled. Adopted-page runner cleanup calls `uninstall()`
before clearing any remaining init-script registrations.

### Page clipboard

Arm recording before the action whose output you need. The recorder observes this page's own
text/plain copy/cut writes and successful Clipboard API writes; it cannot recover text from before
arming and never reads the OS clipboard.

```js
await site.clipboard.arm();
await site.click("button.copy");
const copiedText = await site.clipboard.readText();
await site.clipboard.writeText("pasted by the test");
await site.pressKey("Control+V");
```

Test clipboard access requires an agent-opened or `ctx.usePage()` adopted page. Staged Ctrl+V and
Windows Shift+Insert dispatch an untrusted synthetic paste event; if it is not cancelled and focus
is editable, `insertText` inserts the staged text. Rich HTML is not emulated. Context-menu and
Electron-menu Paste continue to use the OS clipboard. Adopted-page cleanup resets recorder state
and removes its init-script registration.

### Mock page requests

Route declarations cross the test host as JSON, so route handlers are response objects rather than
functions. URL strings use full-URL globs: `*` excludes `/`, `**` crosses `/`, `?` is literal, and
`\\` escapes a wildcard. JSON regular expressions use `{ regex, flags? }`. The last registered
matching route wins; `method`, `resourceTypes`, and positive `times` filters apply before a route is
consumed.

```js
await site.route("**/api/items", {
    status: 200,
    body: "[{\"id\":1}]",
    contentType: "application/json",
    delayMs: 100,
}, { method: "GET", times: 1 });

await site.route("**/api/items", "abort", { method: "POST" });
await site.route({ regex: "api/items\\?id=\\d+", flags: "i" }, {
    status: 200,
    bodyBase64: "AAECAw==",
    headers: { "content-type": "application/octet-stream" },
});
```

Cross-origin fetches still need CORS headers. A preflight is its own `OPTIONS` request; route it
separately from the actual request:

```js
await site.route("**/api/items", {
    status: 204,
    headers: {
        "access-control-allow-origin": "https://app.example.test",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type, authorization",
    },
}, { method: "OPTIONS" });
await site.route("**/api/items", {
    status: 200,
    body: "[]",
    headers: {
        "access-control-allow-origin": "https://app.example.test",
        "access-control-allow-credentials": "true",
    },
}, { method: "GET" });
```

Use `body` for UTF-8 text or `bodyBase64` for binary bytes, never both. `delayMs` on a response
delays fulfilment; `{ delayMs: 250 }` alone delays then continues the original request. Abort can
also name a Network error, such as `{ abort: "TimedOut" }`. `unroute(pattern)` removes all
registrations for an equivalent pattern; `unroute()` and `unrouteAll()` clear the page. The caps are
50 routes, 1 MiB per body, 30,000 ms delay, and 2,000 pattern characters.

Routing is limited to the test-power page target: same-process frames share it; OOPIFs and dedicated
workers are not attached; service workers may bypass it. DevTools detaches the debugger;
the next CDP attach restores declarations. Run cleanup calls `unrouteAll()` on adopted pages before
releasing adoption, and closes owned pages.

Use the browser editor's selector strings and read members through the page stand-in. Calls still cross
the JSON boundary, so a function passed to `waitForFunction` must be function source text, not a
JavaScript callback.

| Playwright | Persephone test |
|---|---|
| `page.getByRole("button", { name: "Save" }).click()` | `await site.click('role=button[name="Save"]')` |
| `page.getByLabel("Email").fill(value)` | `await site.type("label=Email", value)` |
| `page.getByPlaceholder("Search").fill(value)` | `await site.type("placeholder=Search", value)` |
| `page.getByTestId("save").click()` | `await site.click("testid=save")` |
| `page.getByTitle("Refresh").click()` | `await site.click("title=Refresh")` |
| `page.getByAltText("Logo")` | `await site.click("alt=Logo")` |
| `page.getByText("Saved")` | `site.click("text=Saved")` or `site.count("text=Saved")` |
| Snapshot ref from a model (Playwright has no `ref=` engine) | `await site.click({ ref: "e12" })` |
| `page.locator("ul").getByRole("listitem").nth(-1)` | `site.click("ul >> role=listitem >> nth=-1")` |
| `locator.count()` / `locator.isVisible()` | `site.count(locator)` / `site.isVisible(locator)` |
| `locator.isEnabled()` / `locator.isChecked()` | `site.isEnabled(locator)` / `site.isChecked(locator)` |
| `locator.innerText()` / `locator.allInnerTexts()` | `site.innerText(locator)` / `site.allInnerTexts(locator)` |
| `locator.boundingBox()` | `site.boundingBox(locator)` |
| `page.waitForFunction(fn, arg)` | `site.waitForFunction("(arg) => predicate(arg)", { args: [arg] })` |
| Read several matches and fields | `site.query(locator, { fields: ["text", "ref"] })` |

`locator` may be a selector, `{ ref }`, or the object form, such as
`{ role: "button", name: "Save", exact: true, visible: true }`. Selector `nth=N` chooses from
the raw ordered list (negative values count from the end); an action option `{ nth }` counts after
visible-match filtering. Read members are immediate: multi-match scalar reads are strict, while
`count`, `allInnerTexts`, and `query` return lists. `query` returns at most 200 rows and its default
fields are `role`, `name`, `text`, `visible`, `enabled`, `checked`, `tag`, and `ref`. Requested
`text` is trimmed to 1,000 characters; optional `value` is a string or null, and optional
`attributes` returns up to 50 attributes with values capped at 1,000 characters. Invalid or duplicate
field names are rejected. `allInnerTexts` returns each page `innerText` in resolver order; unlike
`query`'s `text`, it is not trimmed or capped.

`waitForFunction` accepts `args`, `timeout` (default 10 seconds, capped at 28 seconds), and
`polling` (`"raf"` or a numeric interval from 10 to 10,000 ms). The function source runs in the
page and can change it; its result must be JSON-serializable. The test host's request deadline is
30 seconds by default, so keep the wait below that bound. See [browser locator and wait details](../browser-automation.md)
for selector matching, strictness, hidden-role limitations, and result-field limits.
