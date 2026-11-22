---
title: "Web-app test call boundary and example"
audience: agent
summary: "Understand how test stand-ins resolve call paths and follow a complete authenticated browser test example."
---

# Call boundary and worked example

Return to [Web-app regression tests](./index.md) for test setup and run commands, or see [attached runs, session pages, and results](./attached-runs-and-results.md) for reuse and diagnostics.
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

`waitFor(pathOrCallback, predicate, { timeout, maxLength, dialog })` resolves to the value from the
poll that satisfies the predicate. `timeout` sets the polling deadline; `maxLength` and `dialog` are
forwarded for each path poll. Set `dialog: true` when polling while a renderer dialog or popup menu
has attention, including reads from `dialogs` or `menus`.

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
