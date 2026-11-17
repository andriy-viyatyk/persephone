# EPIC-186: Persephone test runner for web applications

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-17

## Overview

An agent can already explore and drive the user's own web applications in a Persephone browser
page, and a temporary site extension (US-2054) makes that cheaper. Each check still costs tokens
every time it is repeated. This epic lets the agent, or the user, write those checks down once as
a test file and rerun them without an LLM:

```
persephone --profile webtests --test my-web-app-tests.mjs --log-dir ./test-logs
```

The tests use the same object model the agent sees through `call` and reads `$help` on, written
as objects (`app.pages[id].editor.click(...)`) instead of path strings. They run in the
named app profile, so a browser profile where the user logged in once keeps its session. The
runner ships inside Persephone and uses the app's own Node runtime (the mechanism boards use for
Node scripts), so no Node install is needed. In test mode the app also streams its console output
and network requests to log files, so a crash leaves a trail an agent can read.

Our own UI integration suite (EPIC-180) moves onto the same runner and is rewritten in the new
style, which tests the runner end to end before it is used on a customer's web app.

## Goals

- `persephone --test <file>` runs a test file with no Persephone window of its own. It launches a
  separate Persephone instance with a window, in the profile given by `--profile`, drives it,
  prints a summary and exits with 0 or 1.
- Tests are written with an `app` object that mirrors the `call` tree path for path. Every
  step an agent tried through `call` can be copied into a test unchanged in meaning, and every
  node's `$help` works from a test too.
- `ctx.call(path, args)` stays available, so existing path-style tests keep working.
- `--log-dir <folder>` collects, line by line while the run is in progress: the test steps, the
  app's own console and main-process output, the console of the pages under test, and their
  network requests. `--log <file>` is the short form that writes only the test step log.
- A guide teaches the agent to turn an exploration session into a test file, run it, and triage
  failures from the logs.

## Non-goals

- No headless CI on a server. Tests run on the user's desktop with a real window and a real
  logged-in profile. For server CI with saved logins, Playwright stays the better tool.
- No unit tests or test framework for Persephone itself (standing user preference).
- No pixel or screenshot-baseline comparison.
- Temporary site extensions stay agent-driven (US-2054). A test may load one through the existing
  API; the runner adds nothing specific to them.

## Design

### Processes

```
persephone --test file.mjs --profile webtests --log-dir D
  │  main process in "test controller" mode: no window, no single-instance lock
  │
  ├─ utilityProcess: test host (the app's own Node, same mechanism as board Node scripts)
  │     imports file.mjs, runs its tests, writes D/tests.log, connects to the instance over MCP
  │
  └─ child persephone.exe --profile webtests --test-instance … (normal app with a window)
        MCP forced on at a per-run port (not saved), D/app-console.log, D/site-console.log,
        D/network.log written by its main process
```

- **Controller.** `src/main.ts` branches before `requestSingleInstanceLock()` (`src/main.ts:23`).
  In test mode it never calls `setupMainProcess()`, never creates a window and never takes the
  profile lock. It uses a throwaway `userData` of its own so it cannot collide with any instance.
  It starts the test host, launches the child app, relays the summary and sets the exit code.
- **Test host.** A new `utilityProcess` entry next to `src/node-script-host/` (forked like
  `startNodeJobTo` in `src/main/command-runner.ts:286-305`). The packaged app has the RunAsNode
  fuse off (`electron-builder.yml:47-59`), so a utility process is the only way to run Node, and
  it is the way boards already do it.
- **Child instance.** An ordinary Persephone start with test-instance options. MCP is forced on
  at a port the controller chose, for this run only. The existing localhost, Host and Origin
  guards (`src/main/mcp-http-server.ts:55-67`) still apply. The test host talks to it with the MCP
  client that `integration-test/lib/client.mjs` already uses.
- **Profile already open.** Chromium keys the single-instance lock on `userData`, so a second
  instance cannot open a profile the user already has open (and could not see its cookies). The
  controller probes the profile's named pipe first, as `integration-test/lib/launcher.mjs` does,
  and fails with a clear message. With `--attach` it uses the running instance instead. It reads
  the MCP port from that profile's settings, and fails if MCP is off there.
- **Why out of process.** The tests run outside the window under test, so a renderer crash, an
  app restart (`ctx.restartApp()`) or a second instance never takes the runner down. This is the
  architecture of `integration-test/lib/launcher.mjs`, moved into the product.

### The `app` object

The `call` tree root delegates to the script API's `AppWrapper` member by member with the same
names (`src/renderer/scripting/ai-vision/root.ts:44-49`). So the test host can expose `app` as a
stand-in object that turns property chains into `call` paths:

| Test code | `call` sent |
|---|---|
| `await app.version` | `call("version")` |
| `await app.pages[id].editor.click("#a", { tabId })` | `call('pages["<id>"].editor.click', ["#a", { tabId }])` |
| `await app.pages[0].title` | `call("pages[0].title")` |
| `await app.pages[id].editor.$help` | `call('pages["<id>"].editor.$help')` |

Rules (fixed in the task document):

- Every read and every method call is awaited. Each one is a round trip.
- Results are plain JSON data, not live objects. To keep acting on something, keep the stand-in
  (`const site = app.pages[id].editor`), not a returned value.
- Functions cannot be passed as arguments (callbacks, event subscriptions). The stand-in rejects
  them with a message that points to `waitFor({ selector })` and `ctx.script(code)`.
- A stand-in is awaitable, so returning one from an async function reads it. Helpers that return a
  stand-in wrap it in `ctx.handle(node)` (US-2057): same path, not read by `await`, children still
  awaitable. `openBrowser` returns a handle.
- No static type checking. A wrong path is caught at run time: the `call` tree answers an unknown
  member with the node's valid member list (`src/renderer/scripting/ai-vision/root.ts:210`). The
  failure in the report and `tests.log` carries that answer unchanged, so the agent can fix the
  test without exploring again.

### Test file shape

```js
export default [
  test("dashboard action", async ({ app, expect, openBrowser }) => {
    const site = await openBrowser("https://myapp.local/", { profile: "work" }); // = app.pages[id].editor
    await site.waitFor({ selector: "#dashboard" });
    await site.click("#action");
    expect(await site.evaluate("window.__clicked")).toBe(1);
  }),
];
```

`ctx` carries `app`, `expect`, `waitFor`, `openBrowser`, `call` (path form), `callText`,
`script`, `file(relative)` (resolved next to the test file), `log(message)` and, in a launched run,
`restartApp`. Pages and pop-ups a test opened are closed when it ends. A failure saves a
screenshot. The assertion and report code comes from `integration-test/lib/context.mjs` and
`report.mjs`, moved into the product.

### Running all tests and fixing in one pass

A failed test never stops the run. Every test runs, and the summary lists each failure with its
test name, the failing step (path and arguments) and the error text the app returned, including
the member list for an unknown path. After an app update the agent runs the whole suite once,
fixes every broken test from that one report, then reruns only the failed ones
(`--rerun-failed`, as in the EPIC-180 runner).

A test stops at its own first failure, because later steps depend on earlier ones. A test with two
broken paths shows the second only on the rerun. Tests are short, so this costs at most an extra
round.

### Test-mode logs

When the child instance starts with a log folder, a main-process collaborator with one job
(working name `TestModeLog`, under `src/main/test-mode/`) subscribes to events that parts of the
app emit only in test mode, and writes each event to a file as one JSON line, flushed at once.
A crash then loses at most the line being written.

| File | Written by | Source |
|---|---|---|
| `tests.log` | test host | test start, each step (path and shortened arguments), pass/fail, error, screenshot path, final summary |
| `app-main.log` | controller | the child instance's stdout and stderr |
| `app-console.log` | `TestModeLog` | `console-message` of Persephone's own windows |
| `site-console.log` | `TestModeLog` | `console-message` of every browser guest and pop-up `webContents`, with the page id |
| `network.log` | `TestModeLog` | completed and failed requests from the existing main-process network logger |

- Network: `src/main/network-logger.ts` already hooks `webRequest` on every session and keeps a
  200-entry buffer per page. It gains a subscriber hook so `TestModeLog` sees every completed or
  failed request, not a capped buffer. The file gets method, URL, status, resource type, page id
  and timing. No request or response headers and no bodies are logged.
- Site console: browser guests register in `BrowserGuestRegistry` and pop-ups in
  `BrowserPopupRegistry`. Those registries (not `browser-service.ts` or `cdp-service.ts`, which are
  roadmap §2.3 god files) emit the attach events `TestModeLog` listens to. Electron's
  `console-message` event is used, so no CDP session is needed, and capture starts when the page
  loads instead of on the first automation command.
- Nothing listens, and no code path changes, when the app is not in test mode.

### Owners

| Rule | Owner | Reuses |
|---|---|---|
| Test controller mode, child launch, profile probe, exit code | new `src/main/test-mode/` controller, entered from `src/main.ts` before the lock | `parseApplicationProfile`, `getNodeHostEntryPath`, the pipe probe from `integration-test/lib/launcher.mjs` |
| Test-instance options (`--test-instance`, MCP port, log folder) | new parser in `src/main/test-mode/`, read by MCP startup and `TestModeLog` | `application-profile.ts` parsing pattern |
| Running test files, `ctx`, report, `tests.log` | new test host entry next to `src/node-script-host/` | `integration-test/lib/context.mjs`, `report.mjs`, `client.mjs` |
| `app` stand-in (property chains to `call` paths) | test host module | `ctx.call` from the moved library |
| Console and network log files | `TestModeLog` in `src/main/test-mode/` | `network-logger.ts` (new subscriber hook), guest and pop-up registries |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2056 | `--test` controller mode: windowless main, test host utility process, child instance launch with forced MCP port, profile probe and `--attach`, summary and exit code. Runs path-style tests (`ctx.call`) using the library moved from `integration-test/lib` | Done |
| US-2057 | `app` object: stand-in that maps property chains to `call` paths, rejects function arguments, passes the app's error text (member lists included) into the failure; port two existing integration tests to prove parity | Done |
| US-2058 | Test helpers and results: `openBrowser`, per-test cleanup of pages and pop-ups, failure screenshots, run-all-then-report with every failure's step and error text, `--rerun-failed`, `tests.log`, report files, `--log` / `--log-dir` | Done |
| US-2059 | Test-mode logs in the app instance: `TestModeLog`, network-logger subscriber hook, console capture for app windows, guests and pop-ups, redaction | Done |
| US-2060 | Agent workflow: guide for writing tests from an exploration session, running them and triaging from the logs | Done |
| US-2061 | Move `integration-test/run.mjs` onto the product runner: it becomes a thin wrapper that resets the profile from `seed/`, starts the HTTP fixture server and calls `--test` with the selected files. Keeps `--area`/`--test` filters, `requires` tags, `--keep-open`, `--rerun-failed` and the dev/prod/exe targets. The unchanged path-style tests must pass as before | Done |
| US-2062 | Rewrite the `core` and `sidebar` tests to the `app` object (12 files, 54 tests) | Done |
| US-2063 | Rewrite the `shell` tests to the `app` object (9 files, 44 tests) | Done |
| US-2064 | Rewrite the `editors` tests to the `app` object (16 files, 91 tests) | Done |

US-2056 comes first: it gives a runnable end-to-end path that each later task extends. US-2061
to US-2064 come last and are the epic's proof. The suite was written for the old runner and covers
the whole app, so running it on the new runner, then rewriting it in the new style, exercises
every part of the runner before it is used on a customer's web app.

### Moving the integration suite (US-2061 to US-2064)

- **Baseline first.** Before US-2061, record a full launched run on the old runner (pass, fail and
  skip per test). After the move, and after each rewrite task, the same tests must give the same
  result. A test that changes result is a runner bug or a rewrite mistake until shown otherwise.
  Known failures carried over (today: the EPIC-185 environment-variables test) stay listed, not
  hidden.
- **Rewrite rule.** Path strings become `app` object chains:
  `ctx.call(\`${root}.click\`, ["#a"])` becomes `site.click("#a")`. Each file's helpers
  (`tests/helpers/*.mjs`, `tests/editors/helpers.mjs` and the like) are rewritten with it.
  `ctx.call` stays only where the object form cannot express the step, with a one-line comment
  saying why. Each such case is a candidate fix for the `app` object.
- **Who does what.** As in EPIC-181 to EPIC-185, Codex rewrites, runs and triages the tests, and
  never bends a test to make it pass. App bugs found on the way go to Claude.
- **What stays in the repo runner.** Seeding and resetting the test profile, the HTTP fixture
  server, test tags and area filters are integration-suite concerns. They stay in
  `integration-test/` around the product runner and are not built into Persephone.

## Concerns / open questions

- **No console output from a GUI program.** `persephone.exe` and `persephone-launcher.exe` are
  both Windows GUI programs (`launcher/src/main.rs:17`). From `cmd` or PowerShell, a GUI program
  is not waited for and its stdout is not shown, so the user would get no summary and no exit
  code. Agent shells that redirect output do get both. Recommendation for US-2056: add a small
  console program (a second binary in the `launcher/` crate, e.g. `persephone-test.exe`) that
  starts `persephone.exe --test …`, streams its output and returns its exit code. The report files
  and `tests.log` are the primary output either way.
- **Launch flags read as file operands.** `launchOperands()` (`src/main/utils.ts:129-136`) skips
  arguments that start with `--` but would keep a flag's separate value (`--mcp-port 17999` leaves
  `17999` as a file to open). Test-instance options must be parsed out like
  `parseApplicationProfile` does, or use only the `--name=value` form. The `second-instance`
  handler must also never act on them.
- **Forcing MCP on from the command line.** A flag that turns MCP on for one run is not a new
  power: any local process running as the user can already edit the profile's settings. The
  forced server is localhost-only with the existing guards, and nothing is saved.
- **Logs hold the site's data.** URLs, console text and page titles from the user's own app end up
  in the log folder. Header redaction and no bodies by default; the files stay local. A body option
  can come later if a real case needs it.
- **Default log location (decided 2026-11-17).** With no `--log-dir`, logs go to a fixed
  `test-results/` folder next to the test file, replaced on each run, so an agent always finds
  the latest logs.
- **How `test` reaches the file (decided 2026-11-17).** `test` is a global the host defines before
  importing the file, and everything else arrives as the `ctx` parameter. No `persephone:test`
  import. The existing suite's `import { test } from "../../../lib/context.mjs"` lines are removed
  in US-2061.
- **Dev builds.** In development the controller is `electron .vite/build/main.js --test …`, and the
  child points at the live Vite server, the same way the EPIC-180 dev target works.

## Notes

### 2026-11-17
- Created from the user's proposal: agent-written regression tests for the user's own web apps,
  in the style of the EPIC-180 suite, run with something like
  `persephone --profile <profile with saved login> --test my-web-app-tests.mjs`.
- The user chose objects over path strings, matching both the script API and the `call`
  paths, so the agent can read `$help` in Persephone and write the same thing into a test.
- The user proposed reusing the app's own Node runtime (as boards do) for a windowless runner that
  launches a separate instance with a window. That also keeps the runner outside the window under
  test, which is why EPIC-180 used an external Node runner.
- The user asked for `--log <file>` and extra log files for the app console and network requests,
  produced by test-mode events inside Persephone and written by a handler.
- Test files are written by the agent, not by the user in a separate editor. No work goes into
  type checking test files in outside editors; the agent learns the API from `$help` and the guide.
- Static type checking dropped entirely (user decision). Old tests broken by an app change are
  found by running the whole suite: the `call` tree's error for an unknown member lists the valid
  members, and the run continues past failures so the agent can fix them all from one report.
- `--profile` keeps its existing meaning (the app profile and its data folder). The browser
  profile with the saved login is named in the test (`openBrowser(url, { profile })`).
- The user accepted both recommendations: `test-results/` as the default log folder, and `test` as
  a global with everything else on `ctx`.
- The user asked for the existing integration suite to move onto the new runner and be rewritten
  in the `app` object style (US-2061 to US-2064). It tests the feature end to end and makes the
  runner ready for customer web-app testing.
