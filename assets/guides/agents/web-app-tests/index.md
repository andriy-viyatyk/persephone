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

## Read next

| If you need to... | Read | Object-model path |
|---|---|---|
| Understand call paths, stand-ins, and a complete test example | [Call boundary and worked example](./call-boundary-and-examples.md) | `guides.agents["web-app-tests"]["call-boundary-and-examples"]` |
| Reuse a signed-in browser page, configure attached windows, or inspect captured failures and logs | [Attached runs, session pages, and results](./attached-runs-and-results.md) | `guides.agents["web-app-tests"]["attached-runs-and-results"]` |
| Share setup and cleanup across tests in one file | [File hooks](./file-hooks.md) | `guides.agents["web-app-tests"]["file-hooks"]` |
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

For async polling assertions and wait messages, see [the polling examples and matcher options](./call-boundary-and-examples.md#polling-assertions).

Every test receives these `ctx` members:

- `app` — awaitable stand-in for paths in the live call tree.
- `openBrowser(url, { profile?, incognito?, timeout? })` — create and navigate a browser page; returns its editor handle.
- `usePage({ url?, title? })` — adopt one already open browser page in the test window; returns its editor handle.
- `handle(node)` — keep a stand-in awaitable when returning it from an async helper.
- `call(path, args?, options?)` — path-based call; useful for stand-in escape hatches.
- `callText(path, args?, options?)` — path-based call returning text without JSON parsing.
- `set(path, value, { timeout? })` — assign a writable property (one whose `$help` says it is writable). Assigning through `ctx.app` throws, because an assignment cannot be awaited.
- `waitFor(pathOrCallback, predicate, { timeout?, maxLength?, dialog?, allowNavigation?, message? })` — host-side polling of a call or callback.
- `expect(value, message?)` — assertions with `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toHaveLength`, `toHaveProperty`, `toMatch`, `toMatchObject`, `toContainEqual`, and `toThrow`. Every matcher also supports `.not`, for example `ctx.expect(value).not.toBe(expected)`. A supplied message is shown before the generated assertion failure.
- `script(code)` — run `script.execute` and return its completed text.
- `file(relative)` — resolve a fixture path relative to this test file.
- `log(message)` — add a note to `tests.log` and runner console output.
- `restartApp()` — restart the app instance owned by this run.
- `launchSecondInstance(args?)` — start a second instance on the same profile (it hands its arguments to the running app) and return its exit code; a signal exit or a 15 s timeout throws.

`restartApp()` and `launchSecondInstance()` throw under `--attach`; mark tests that need them with
`requires: ["launch"]` so they are skipped there. `ctx.waitFor` polls a value with a predicate;
the browser editor's `site.waitFor({ selector })` waits for a DOM condition.

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
- `--window <index-or-title>` selects an existing open test window and requires `--attach`. Decimal values are window record indexes; other values are case-insensitive title substrings. Exactly one open window must match. Title collisions are resolved by choosing the numeric index.
- `--log <file>` writes only the test-step JSONL log at that file; it does not create reports or screenshots.
- `--log-dir <folder>` writes test results and test-mode app logs into that folder.
- `--rerun-failed` reruns only file/name identities in `last-failed.json` from the selected results folder.
- `--test-setup <module>` loads a user module that adds suite-specific members to each test context.
- `--test-selection <json-file>` restricts `--test` discovery to exact file/name identities in a versioned manifest; requirements are still checked.
- `--with <tag,...>` enables the named `requires` tags; `launch` remains skipped under `--attach`.
- `--grep <regex>` runs tests whose names match the case-sensitive JavaScript regular expression.
- `--retries <n>` retries failed tests up to `n` additional attempts; the default is `0`.
- `--timeout-scale <number>` scales the runner's timeouts; the default is `1`.
- `--test-timeout <ms>` sets the default per-attempt test timeout; the default is `300000` ms.
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

