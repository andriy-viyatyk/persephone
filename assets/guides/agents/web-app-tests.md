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
call-tree path the stand-in cannot represent. Function arguments are rejected because calls carry
JSON; use a browser editor's `waitFor({ selector })` for page readiness or `ctx.script(code)` for
app scripting.

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
- `waitFor(pathOrCallback, predicate, { timeout? })` — host-side polling of a call or callback.
- `expect(value)` — assertions with `toBe`, `toEqual`, `toContain`, and `toBeTruthy`.
- `script(code)` — run `script.execute` and return its completed text.
- `file(relative)` — resolve a fixture path relative to this test file.
- `log(message)` — add a note to `tests.log` and runner console output.
- `restartApp()` — restart the app instance owned by this run.
- `launchSecondInstance(args?)` — start a second instance on the same profile (it hands its arguments to the running app) and return its exit code; a signal exit or a 15 s timeout throws.

`restartApp()` and `launchSecondInstance()` throw under `--attach`; mark tests that need them with
`requires: ["launch"]` so they are skipped there. `ctx.waitFor` polls a value with a predicate;
the browser editor's `site.waitFor({ selector })` waits for a DOM condition.

## Browser page and profile behavior

`openBrowser()` creates a new browser page, navigates to the URL, waits for `DOMContentLoaded`, and
returns a handle to `pages[id].editor`. Its `profile` option is a browser profile name;
`--profile` selects the Persephone app profile. The name is checked against configured browser
profiles; a typo reports valid names. If omitted, the configured default browser profile is used.
If that setting is empty, the built-in browser profile is used.

`DOMContentLoaded` only means the document is ready. Wait for the site's own hydrated or
authenticated state before interacting:

```js
await site.waitFor({ selector: "[data-testid='account-home']" });
```

The runner snapshots pages and pop-ups before each test, then closes pages and pop-ups first
opened during that test. It does not close ids from the baseline, including in attached runs.
Cleanup also covers pages opened through `ctx.call`, not only those created by `openBrowser`.

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

For a developer checkout on the user's machine, the equivalent command is:

```powershell
electron .vite/build/main.js --test .\web-tests --profile qa --log-dir .\web-test-logs
```

The dev command runs the built development main bundle with the Electron executable; it does not
use the installed console wrapper.

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
- `--timeout-scale <number>` scales the runner's timeouts; the default is `1`.
- `--keep-open` leaves an owned app running after a failed run and prints its PID and MCP URL in `report.json`.
- `--mcp-port <port>` requests the MCP port for an owned app; the runner refuses the port if it is occupied.
- `--attach --profile-dir <path>` attaches using MCP settings in that directory and verifies the connected app's user-data directory before running tests.

Without `--log` or `--log-dir`, output goes to `test-results/` next to a test file, or inside the
folder passed to `--test`; that default folder is replaced each run. A run continues through test
failures and exits `0` when none failed, or `1` for test or runner setup failures.

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
test name, status, duration, failing step and error. The failing step is the step that threw,
even if the test's `finally` block runs later. `last-failed.json` stores file/name pairs for
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

Fix all failures shown in the first full run, then run `--rerun-failed` to check only those tests.
If a call fails with an unknown-member error, read the member list included in the error. Correct
the path using that list; you usually do not need to explore the same node again.

## Worked example: authenticated dashboard

Assume the user has already logged in to the browser profile named `customer-qa`:

```js
export default [
  test("opens the orders dashboard", async (ctx) => {
    const site = await ctx.openBrowser("https://shop.example.test/orders", {
      profile: "customer-qa",
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
