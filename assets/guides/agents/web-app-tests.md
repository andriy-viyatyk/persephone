---
title: "Web-app regression tests with Persephone"
audience: agent
summary: "Turn browser exploration into .test.mjs regression checks, run them in a logged-in browser profile, and diagnose failures from reports and logs."
---

# Web-app regression tests with Persephone

Use this runner for regression checks of the user's own web apps on the user's desktop. It opens
real Persephone and browser windows and can use a real logged-in browser profile. The tests run
without an LLM once written. Do not use it for headless CI; use a browser automation tool such as
Playwright for server CI.

## Turn exploration into a test

Explore the site first with the `call` tool: inspect `pages[id].editor.$help`, take a snapshot,
and try the actions and state reads you need. Then write those same operations in a `.test.mjs`
file. The test `app` stand-in maps object chains to the same call paths:

| Exploration with `call` | Test stand-in |
|---|---|
| `call pages["<id>"].editor.click args ["#save"]` | `await site.click("#save")` |
| `call pages["<id>"].editor.$help` | `await site.$help` |

`$help` works on stand-in nodes in tests. Each read or call is a request, so await it. Keep a
stand-in such as `site`; a returned value is JSON data, not a live editor object. When an async
helper must return a stand-in, wrap it with `ctx.handle(node)`. Use `ctx.call(path, args)` for a
call-tree path the stand-in cannot represent.

For page-model calls that may navigate, pass the call option separately from model arguments:
`ctx.call(path, args, { allowNavigation: true })`. Model reads through this runner are unbounded by
default; pass `maxLength` when you need a cap. The browser facade also supports hidden aliases such
as `dblclick`. Use `focus(locator)` or `{ target: locator, focus: "focus" }` before keys when the
page needs focus without a click.

An awaitable stand-in is not a full Promise: its `.then(read)` returns the chained Promise, but
`.catch()` and `.finally()` throw with guidance. Handle errors with `try { await node } catch {}`.

## Test file and context

Files end in `.test.mjs`. Export an array of descriptors made with the global `test` function:

```js
export default [
  test("save action updates the page", async (ctx) => {
    // test steps
  }, { requires: ["launch"] }),
];
```

The options argument is optional. Each `requires` entry must be a non-empty tag string. `launch` is
built in and is skipped under `--attach`; every other tag is skipped unless enabled with `--with`.
Requirement tags belong to the test suite, so customers can use their own tag names.

Every test receives these `ctx` members:

- `app` — awaitable stand-in for paths in the live call tree.
- `openBrowser(url, { profile?, incognito?, timeout? })` — create and navigate a browser page; returns its editor handle.
- `handle(node)` — keep a stand-in awaitable when returning it from an async helper.
- `call(path, args?, options?)` — path-based call; useful for stand-in escape hatches.
- `callText(path, args?, options?)` — path-based call returning text without JSON parsing.
- `set(path, value, { timeout? })` — assign a writable property (one whose `$help` says it is writable). Assigning through `ctx.app` throws, because an assignment cannot be awaited.
- `waitFor(pathOrCallback, predicate, { timeout?, maxLength?, dialog? })` — host-side polling of a call or callback.
- `expect(value, message?)` — assertions with `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toMatchObject`, `toContainEqual`, and `toThrow`. Every matcher also supports `.not`, for example `ctx.expect(value).not.toBe(expected)`. A supplied message is shown before the generated assertion failure.
- `script(code)` — run `script.execute` and return its completed text.
- `file(relative)` — resolve a fixture path relative to this test file.
- `log(message)` — add a note to `tests.log` and runner console output.
- `restartApp()` — restart the app instance owned by this run.
- `launchSecondInstance(args?)` — start a second instance on the same profile (it hands its arguments to the running app) and return its exit code; a signal exit or a 15 s timeout throws.

`restartApp()` and `launchSecondInstance()` throw under `--attach`; mark tests that need them with
`requires: ["launch"]` so they are skipped there. `ctx.waitFor` polls a value with a predicate;
the browser editor's `site.waitFor({ selector })` waits for a DOM condition.

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

## Browser page and profile behavior

`openBrowser()` creates a new browser page, navigates to the URL, waits for `DOMContentLoaded`, and
returns a handle to `pages[id].editor`. Its `profile` option is a browser profile name;
`--profile` selects the Persephone app profile. The name is checked against configured browser
profiles; a typo reports valid names. If omitted, the configured default browser profile is used.
If that setting is empty, the built-in browser profile is used.

For an HTTPS page served by the integration runner, use `ctx.httpsUrl(path)`. Its fixture
certificate is accepted only by an app instance owned by that run. Set
`PERSEPHONE_TEST_TRUSTED_CERTIFICATES` to a comma-separated list of exact Electron fingerprints
in `sha256/<base64>` form. The runner supplies its fixture fingerprint; ordinary app instances do
not use this trust setting, and `--open`/`--attach` runs do not accept the runner certificate.

For repository board-catalog tests, an owned suite launch also sets
`PERSEPHONE_TEST_BOARDS_CATALOG_URL` to the loopback fake catalog. The product honors this value
only in a test instance and only for an `http://127.0.0.1` URL; attached and ordinary app instances
do not use it.

Downloads in an app launched by the runner do not open the Save dialog. They are saved to the
profile's `test-downloads` folder (a ` (1)` suffix keeps names unique). Find the file's path in
`app.downloads.downloads[i].savePath` once its `status` is `completed`. An app joined with
`--attach` still asks where to save.

`DOMContentLoaded` only means the document is ready. Wait for the site's own hydrated or
authenticated state before interacting:

```js
await site.waitFor({ selector: "[data-testid='account-home']" });
```

The runner snapshots pages and pop-ups before each test, then closes pages and pop-ups first
opened during that test. It does not close ids from the baseline, including in attached runs.
Cleanup also covers pages opened through `ctx.call`, not only those created by `openBrowser`.
When an owned page has unsaved changes, cleanup answers its renderer prompt with `Don't Save`.
Cleanup answers renderer dialogs only: it sweeps open renderer dialogs before taking its page
snapshot and after closing owned pages, choosing `Don't Save` for `Unsaved Changes` and neutral
`cancel()` for other dialogs. A dialog the test left open is dismissed and logged, but the test
fails; the expected prompt raised by cleanup while closing an owned page does not fail the test.
A popup menu left open is closed and fails the test the same way. Workspace pages (a folder opened
with `pages.openFile`) are owned pages too. Native OS dialogs are outside the runner's cleanup scope.

With `--attach` the window is also the user's, so cleanup is narrower: it closes only pages the test
opened with `ctx.openBrowser` (and new pop-ups of those pages), leaves every other new page open
(logged as `leave-unowned-pages`), and does not sweep renderer dialogs or menus. A page the user opens
while a test runs is never closed. An attached test that opens pages any other way (`ctx.call`,
`pages.openFile`) closes them itself in `finally`.

## Run tests

In an installed app on Windows, run `persephone-test.exe` from beside the installed
`persephone.exe`. The console wrapper finds that sibling executable, adds `--test`, forwards the
arguments, waits, streams output, and returns the app's exit code:

```powershell
persephone-test.exe .\web-tests --profile qa --log-dir .\web-test-logs
```

`persephone.exe --test <file-or-folder>` starts the same test controller directly. `persephone.exe`
is a GUI-subsystem program, so its console output is not shown by a normal shell invocation; use
`persephone-test.exe` when you need visible console output and a waited exit code.

For a developer checkout, run the app entry point and pass the test options:

```powershell
electron . --test .\web-tests --profile qa --log-dir .\web-test-logs
```

The package entry point loads `.vite/build/main.js`. Passing that file directly makes Electron use
the app name `Electron`, so `--attach` looks for the wrong settings folder. Use `electron .` from
the checkout.

Options:

- `--test <file|folder>` runs one `.test.mjs` file or recursively discovers files in a folder.
- `--profile <name>` selects the Persephone app profile. It does not select a browser profile.
- `--attach` connects to an already running profile instead of launching an owned app. MCP must be enabled in that profile.
- `--log <file>` writes only the test-step JSONL log at that file; it does not create reports or screenshots.
- `--log-dir <folder>` writes test results and test-mode app logs into that folder.
- `--rerun-failed` reruns only file/name identities in `last-failed.json` from the selected results folder.
- `--test-setup <module>` loads a user module that adds suite-specific members to each test context.
- `--test-selection <json-file>` restricts `--test` discovery to exact file/name identities in a versioned manifest; requirements are still checked.
- `--with <tag,...>` enables the named `requires` tags; `launch` remains skipped under `--attach`.
- `--grep <regex>` runs tests whose names match the case-sensitive JavaScript regular expression.
- `--retries <n>` retries failed tests up to `n` additional attempts; the default is `0`.
- `--timeout-scale <number>` scales the runner's timeouts; the default is `1`.
- `--keep-open` leaves an owned app running after a failed run and prints its PID and MCP URL in `report.json`.
- `--mcp-port <port>` requests the MCP port for an owned app; the runner refuses the port if it is occupied.
- `--attach --profile-dir <path>` attaches using MCP settings in that directory and verifies the connected app's user-data directory before running tests.

Without `--log` or `--log-dir`, output goes to `test-results/` next to a test file, or inside the
folder passed to `--test`; that default folder is replaced each run. A run continues through test
failures and exits `0` when there are no failed tests, unexpected passes, or runner setup failures;
otherwise it exits `1`. Expected failures and flaky tests do not change the exit code.

The repository's `npm run test:ui` wrapper keeps suite filters, fixture setup, profile resets, and
baseline comparison outside the product host. It starts one product invocation per module and
stores that invocation's reports and logs under `integration-test/reports/runs/<run-id>/<module-id>/`.
The wrapper aggregates them into `integration-test/reports/latest.md`, `latest.json`,
`last-failed.json`, and `screenshots/`. A direct product run uses the output location selected by
`--log` or `--log-dir` and does not create those suite-level reports. With `--attach --profile-dir`,
the controller reads the selected profile's MCP settings, then checks the connected app's
`main.runtime.paths.userData` before running tests.

## Triage a failed run

Start with the console summary and `report.md` or `report.json`: each result has its file, exact
test name, status, duration, failing step and error. When a stack points into the test file,
`report.md` also includes a `Location:` line with its file and line number. The failing step is the
step that threw, even if the test's `finally` block runs later. `last-failed.json` stores file/name pairs for
the next `--rerun-failed` run. Failure screenshots are saved under `screenshots/` and their paths
appear in the report and `tests.log`.

`tests.log` is JSON Lines: each line is a JSON event. Its event names include `run-start`,
`test-start`, `test-outcome`, `step-start`, `step-result`, `step-error`, `wait-start`,
`wait-result`, `wait-error`, `cleanup`, `screenshot`, `log`, `rerun-stale`, and `run-summary`.
Call and stand-in steps include the path and a shortened argument preview. `waitFor` is logged as
one wait rather than one entry per poll.

With a launched app and `--log-dir`, inspect the other JSONL logs:

| File | Use it to answer | Recorded fields |
|---|---|---|
| `app-main.log` | What did the child app write to stdout or stderr, including startup or crash output? | `at`, `stream`, `message`; long lines may have `truncated`. |
| `app-console.log` | What did a Persephone window's renderer log? | `event`, `windowId`, `level`, `message`, `source`, `line`, optional `truncated`. |
| `site-console.log` | What did a browser page or pop-up log? | `event`, `pageId`, `editorId`, optional `popupId`, `level`, `message`, `source`, `line`, optional `truncated`. |
| `network.log` | Which registered browser requests completed or failed? | `event` (`request-completed` / `request-failed`), `pageId`, `editorId`, optional `popupId`, `method`, `url`, `resourceType`, `startedAt`, `elapsedMs`, optional `statusCode` or `error`, optional `truncated`. |

These logs do not contain request or response headers or bodies. In `--attach` mode, the runner
cannot add test-mode logging to the already running app, so the app-main, app-console, site-console,
and network logs are not captured for that instance.

Fix failures shown in the first full run, then run `--rerun-failed` to check only those tests.
The console ends with a `Summary:` block listing each non-passed test, its file or source location,
and a short reason when available. An unknown-member error stays short; when there is no close
suggestion, it tells you how to list members, for example `List members: ctx.call("pages.$help")`.
Use the indicated `$help` call to inspect that node, then correct the path.

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
