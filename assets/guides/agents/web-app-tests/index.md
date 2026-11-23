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
| Read a complete call-boundary test example | [Call boundary and worked example](./call-boundary-and-examples.md) | `guides.agents["web-app-tests"]["call-boundary-and-examples"]` |
| Check matchers, browser-model scope, and Playwright mappings | [Browser models and Playwright](./browser-models-and-playwright.md) | `guides.agents["web-app-tests"]["browser-models-and-playwright"]` |
| Reuse a signed-in browser page, configure attached windows, or inspect captured failures and logs | [Attached runs, session pages, and results](./attached-runs-and-results.md) | `guides.agents["web-app-tests"]["attached-runs-and-results"]` |
| Share setup and cleanup across tests in one file | [File hooks](./file-hooks.md) | `guides.agents["web-app-tests"]["file-hooks"]` |
| Choose test commands, runner options, output locations, and exit-code behavior | [Run and configure tests](./run-options.md) | `guides.agents["web-app-tests"]["run-options"]` |
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

Held gesture example:

```js
const site = await ctx.usePage();
await site.mouseDown("#range-start");
await site.mouseMove("#range-end", { steps: 12 });
const liveCount = await site.count(".selected-day");
await site.mouseUp();
const committedCount = await site.count(".selected-day");
```

`ctx.usePage` cleanup releases held keys and buttons after errors too.

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
- `openBrowser(url, { profile?, incognito?, timeout?, storageState? })` — create a browser page, optionally apply saved state before its first navigation, and return its editor handle.
- `usePage({ url?, title? })` — adopt one already open browser page in the test window; returns its editor handle.
- `handle(node)` — keep a stand-in awaitable when returning it from an async helper.
- `call(path, args?, options?)` — path-based call; useful for stand-in escape hatches.
- `callText(path, args?, options?)` — path-based call returning text without JSON parsing.
- `set(path, value, { timeout? })` — assign a writable property (one whose `$help` says it is writable). Assigning through `ctx.app` throws, because an assignment cannot be awaited.
- `waitFor(pathOrCallback, predicate, { timeout?, maxLength?, dialog?, allowNavigation?, message? })` — host-side polling of a call or callback.
- `expect(value, message?)` and `expect.poll()` share the same matchers; see the [matcher reference](./browser-models-and-playwright.md).
- `script(code)` — run `script.execute` and return its completed text.
- `file(relative)` — resolve a fixture path relative to this test file.
- `log(message)` — add a note to `tests.log` and runner console output.
- `restartApp()` — restart the app instance owned by this run.
- `launchSecondInstance(args?)` — start a second instance on the same profile (it hands its arguments to the running app) and return its exit code; a signal exit or a 15 s timeout throws.

`restartApp()` and `launchSecondInstance()` throw under `--attach`; mark tests that need them with
`requires: ["launch"]` so they are skipped there. `ctx.waitFor` polls a value with a predicate;
the browser editor's `site.waitFor({ selector })` waits for a DOM condition.

Use `site.storageState()` to capture cookies for the current URL and local/session storage for the
current origin. `ctx.openBrowser(url, { storageState })` accepts that object or a JSON file path;
relative paths resolve beside the test file. Cookies are installed before navigation, and Web
Storage is seeded at document start only for matching origins. The temporary script is removed when
the initial navigation settles; a redirect or early reload can reseed a matching origin before
then. Store state files only in an existing git-ignored local folder: they contain sign-in tokens.
`ctx.usePage()` adopts normal browser pages for storage-state capture and releases adoption at
cleanup; user-opened incognito/Tor pages cannot be adopted. See the [save/load example](./call-boundary-and-examples.md#storage-state).

### Route page requests

`site.route(pattern, response, options?)` configures declarative Fetch request routing on an
agent-opened or test-adopted page. It accepts URL strings as globs, RegExp values in test code, or
JSON `{ regex, flags? }` patterns through calls. Newest matching route wins; optional method,
resource-type, and positive `times` filters constrain matches. Routes stay active through navigation.
The response can fulfil UTF-8 `body`, `bodyBase64`, status and headers, delay fulfilment, continue
after a delay-only object, or abort. `site.unroute(pattern?)` and `site.unrouteAll()` remove routes.
At run cleanup the runner clears routes on every adopted page before releasing test access; owned
pages clear routes on close.

Routes are limited to 50 per page, 1 MiB per response body, 30 seconds per delay, and 2,000 pattern
characters. Cross-origin fulfillments still need CORS response headers. Route an `OPTIONS` preflight
separately with allow-origin, allow-methods, and allow-headers when required. Only the page target is
attached: OOPIFs and dedicated workers are not covered, and service workers may bypass routing.
DevTools detach pauses routes until the next CDP attach restores them.

### Use the page clipboard

The page-scoped clipboard facade is available on pages opened with `ctx.openBrowser()` or adopted
with `ctx.usePage()`. Call `site.clipboard.arm()` before the copy action, then read only text/plain
observed from that page with `site.clipboard.readText()`; the result is `null` until a page write is
observed. `site.clipboard.writeText(text)` stages one value for the page's next clipboard read or
trusted Ctrl+V / Windows Shift+Insert. Keyboard paste dispatches an untrusted synthetic event and
uses `insertText` for an uncancelled paste into an editable target. After `arm()` the page's
clipboard is isolated from the OS clipboard, menus and `navigator.clipboard` included.
The host never reads OS clipboard contents. Adopted-page cleanup resets the recorder and removes its
document-start registration.

### Advance scheduled page work with a fake clock

Use `site.clock` when a web app schedules work several minutes after startup. Open `about:blank`,
install the clock before navigating so app startup uses fake timers, then fast-forward the required
duration:

```js
const site = await ctx.openBrowser("about:blank");
await site.clock.install({ now: "2026-01-01T00:00:00Z" });
await site.navigateAndWait("http://localhost:5173");
await site.clock.fastForward(4 * 60 * 1000);
```

The clock covers `Date`, `Date.now()`, `performance.now()`, timeout/interval, and animation-frame
functions; `queueMicrotask` stays native. Time also advances with real elapsed time, and due timers
fire automatically. Installing after load does not migrate already scheduled native timers or
references captured before installation. The fake does not control workers, OOPIFs, network timing,
or painting. Call `site.clock.uninstall()` when finished. Runner cleanup does this for adopted pages
before clearing their init scripts; pages opened by `ctx.openBrowser()` close during cleanup.
