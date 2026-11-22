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
