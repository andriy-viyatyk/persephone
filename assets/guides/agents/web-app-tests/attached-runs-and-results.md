---
title: "Web-app test attached runs and results"
audience: agent
summary: "Reuse signed-in browser pages in attached test windows, understand cleanup and failure capture, and find reports and diagnostic logs."
---

# Attached runs, session pages, and results

Return to [Web-app regression tests](./index.md) for test setup, context members, and run commands.
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

For a test-owned capture, use `site.waitForDownload()` on a page opened by the agent or adopted
with `ctx.usePage()`. Start the promise before clicking the export control and await it afterward.
The same capture works in owned and `--attach` runs without a Save dialog: the app writes to its
fixed temporary capture folder, then the runner validates and copies the file into the run output's
`downloads/` folder and removes the app-side copy. The returned `path` points to that output file.
`report.json` records `{ suggestedFilename, path, size }` with a relative path; `report.md` links
the attachment, and a failed test's bundle includes the same relative reference. A captured file
can be at most 32 MiB.

Capture applies only to an armed waiter and the existing browser download gate still applies. A
trusted `site.click()` supplies a real gesture when needed; arming a wait alone does not. If the
click request reaches the page before the wait request is armed, the download follows the ordinary
route (including a Save dialog for an attached app) and the waiter times out. Captured downloads,
including agent-opened incognito downloads, do not appear in normal download history, recent
downloads, or the general download UI.

`DOMContentLoaded` only means the document is ready. Wait for the site's own hydrated or
authenticated state before interacting:

```js
await site.waitFor({ selector: "[data-testid='account-home']" });
```

If loading rows reuse a final row's accessible name, a click after navigation can hit a placeholder
and do nothing. Poll an app-specific model or DOM signal with `ctx.expect.poll` or `site.waitFor`
until the row's final content appears. `{ synthetic: true }` does not fix a readiness race.

When sign-in cannot be automated, keep a dedicated Persephone test window open, sign in there by
hand once, and run against that existing window. A session page must use a normal browser profile
(not incognito or Tor). `url` matches a case-sensitive URL prefix and `title` a case-sensitive page
title substring; either may be a regular expression. When both are supplied, both must match, and
exactly one browser page must match overall. A missing URL or title cannot satisfy its corresponding
criterion. A mismatch reports only the number of matches. The returned `site.pageId` identifies the
page, as with `openBrowser`.

```js
// Keep this signed-in window open between runs.
const site = await ctx.usePage({ url: "https://example.test/" });
await site.waitFor({ selector: "[data-testid='account-home']" });
```

Give the normal window a stable name with `windows[i].name = "signed-in"`, then run with
`--attach --window name:signed-in` to preserve that exact window after the run. Its OS title shows
the name after the current app/profile title. Names survive app restarts for windows in the startup
snapshot, but an explicit close clears the name. A name on a closed restored window is reserved;
open that record or clear its name before reusing it. Use a normal browser profile so the signed-in
session remains available to `ctx.usePage`.

`--attach --window <title or index>` also preserves that window after the run. `usePage` does
not reload or close the session page between tests; new pop-ups on it are still closed during
per-test cleanup. A session page adopted in an owned run or a runner-created attached window is
protected during per-test cleanup, but its containing window is disposed at run end.
`ctx.openBrowser` remains the choice when the test should create a fresh page and automate sign-in.
`ctx.usePage()` adopts the matched page for test-only storage-state access. User-opened incognito or
Tor pages are refused; ordinary pages remain open and are not navigated. Cleanup clears init-script
registrations and releases adoption even if its later page snapshot fails. A captured state reads
cookies from that page's profile/partition for its current URL, so treat it as a secret. See the
[storage-state example](./call-boundary-and-examples.md#storage-state).
Clipboard helpers are also limited to agent-opened or adopted pages; user-opened incognito/Tor
pages remain refused. Call `site.clipboard.arm()` before the page action, then `readText()` returns
only page-observed text/plain writes and never reads the OS clipboard. `writeText(text)` stages a
one-shot value for the page's next clipboard read or trusted Ctrl+V / Windows Shift+Insert. Staged
keyboard paste sends an untrusted synthetic event and uses `insertText` for an uncancelled paste
into an editable field. After `arm()` copy, cut, paste (keyboard and menus) and `navigator.clipboard`
never touch the OS clipboard; a paste with nothing staged delivers the page's own last copy.
Adopted-page cleanup also resets the page clipboard recorder before clearing init scripts and
releasing test access. Clipboard text is excluded from runner logs and reports.

The runner snapshots pages and pop-ups before each file's `beforeAll` and before each test. File
pages remain available through every attempt and are cleaned after `afterAll`; per-test cleanup
uses its later baseline. In owned runs and runner-created attached windows, cleanup closes pages
and pop-ups first opened during that test. In a selected `--window`, it
closes pages opened through `ctx.openBrowser` and their new pop-ups, plus new pop-ups on session pages;
other new pages are left open. Session pages are never closed, even when first seen after the
baseline or also opened through `openBrowser`. Baseline pop-ups remain open, and untrackable pop-ups
are left alone. Cleanup also covers pages opened through `ctx.call` in owned and runner-created
windows, not only those created by `openBrowser`.
When an owned page has unsaved changes, cleanup answers its renderer prompt with `Don't Save`.
Cleanup answers renderer dialogs only: it sweeps open renderer dialogs before taking its page
snapshot and after closing owned pages, choosing `Don't Save` for `Unsaved Changes` and neutral
`cancel()` for other dialogs. A dialog the test left open is dismissed and logged, but the test
fails; the expected prompt raised by cleanup while closing an owned page does not fail the test.
A popup menu left open is closed and fails the test the same way. Workspace pages (a folder opened
with `pages.openFile`) are owned pages too. Native OS dialogs are outside the runner's cleanup scope.
A page's own right-click menu is DOM and needs no `menus[0].close()`. Persephone's menu appears only
when the click opts in with `{ button: "right", nativeMenu: true }`; runner cleanup closes it.

With `--attach`, the runner creates a separate test window by default. All unprefixed `ctx.app`,
`ctx.call`, `ctx.callText`, `ctx.set`, `ctx.waitFor`, `ctx.script`, setup `rawCall`, page ownership,
cleanup, and screenshot calls target that window. The runner closes its created window at run end,
including after setup or test failures. `ctx.root` is the unscoped app proxy. Explicit
`ctx.app.windows[i]` paths also remain unscoped, so use them only when a test deliberately needs
another window. Awaiting `ctx.app` with no path describes the selected window, not the renderer overview.
Prefer unprefixed paths; `ctx.root` and explicit `windows[i]` paths can reach outside the test window.

For unseen-mode controls, owned/attached run defaults and restoration, see [unattended runs](./unattended-runs.md).

For minimized browser-page visibility and its iframe behavior, see [unattended runs](./unattended-runs.md).

Use `--attach --window <index-or-title>` to reuse an open window. A decimal value selects the exact
`windows[i]` record index; `name:<name>` selects an exact case-insensitive name; any other value
selects a unique case-insensitive substring of the OS window title. Names avoid collisions with the
main window, whose title can also contain a profile suffix. `--attach --window-name <name>` creates
and names a normal window on the first run, then reuses it on later runs. Named windows use the same
conservative cleanup and stay open, so adopted pages and their signed-in session remain available.
If no selector match exists or several title matches exist, the error reports the match count. The
selected window is never closed.
Its cleanup closes only pages opened through `ctx.openBrowser` (and new pop-ups of those pages),
leaves other new pages open, and sweeps renderer dialogs and popup menus only in that window. The
created test window uses the baseline page diff for cleanup. On failure, both attached modes capture
only pages under test in the selected test window; they never capture a window screenshot. Owned
runs keep their existing window screenshot and also capture pages under test.

`ctx.root` uses the normal app call grammar, including the root-only `windows`, `main`, and `guides`
paths. Relative `$help` and `$describe` calls under `ctx.app` describe the selected window node.
Results in `reports/` and `test-results/` are local output; keep those folders in `.gitignore`.

## Triage a failed run

Start with the console summary and `report.md` or `report.json`: each result has its file, exact
test name, status, duration, failing step and error. When a stack points into the test file,
`report.md` also includes a `Location:` line with its file and line number. The failing step is the
step that threw, even if the test's `finally` block runs later. `last-failed.json` stores file/name pairs for
the next `--rerun-failed` run. A failed `<beforeAll>` or `<afterAll>` identity expands to the file's
discovered descriptors on rerun; normal filters and skip rules still apply. Failure screenshots are saved under `screenshots/` and their paths
appear in the report and `tests.log`.

Per-test timeout errors name the effective scaled duration and the step active at expiry. The
timeout snapshot remains the result step even if abandoned asynchronous work settles later. The
runner captures failure diagnostics and then performs page cleanup using their existing independent
operation bounds. A request already sent to the app is not cancelled, so its effects may arrive
after the timeout; later context calls are rejected.

When a test throws and report output is enabled, the runner writes one
`failures/<test>-a<attempt>-<id>.json` bundle for that failed attempt. `report.md` links to the
latest captured failure bundle and `report.json` stores its relative path. A later retry that passes
does not remove the failed attempt's link. Cleanup-only failures do not create a bundle. A run using
`--log` alone keeps its existing no-report/no-artifact behavior.

Each bundle lists pages under test in the scoped test window: page ID and owned/session kind, URL,
title, page errors, console errors, failed requests, and a relative screenshot path (`null` if
capture failed). It also lists captured downloads by original suggested filename, relative output
path, byte size, MIME type, and redacted URL. Runner results and attachments share this URL; HTTP(S)
credentials, query values, and fragments are removed, while non-HTTP URLs become `[redacted URL]`.
Direct browser facade calls return Electron's original URL. Each diagnostic list keeps at most the newest 100 entries. Page errors and failed
requests are limited to timestamps at or after the test attempt started; console records are
requested from that time and filtered to errors. Network records contain method, URL, status, and
`durationMs: null` because the API does not provide a duration. Active-tab APIs and bounded event
buffers make this best-effort context, not a complete trace. Capture failures appear under
`Capture errors` and do not change test status.

The bundle omits network headers, bodies, referrers, and other raw request data. URL credentials and
fragments are removed, and every query value is replaced while query keys remain. URLs in page-error
text and console arguments receive the same query redaction. Other diagnostic text, page titles, and
screenshots may still contain sensitive page content; inspect and handle these local artifacts
accordingly. Reports under `reports/` and `test-results/` are local output and belong in `.gitignore`.

Human output identifies the selected window before tests. In JSON Lines mode, `run-start` carries
`testWindow: { index, windowId, name? }`; setup failures still emit a `run-start` without identity
before synthetic test events. JSON events remain on stdout and human diagnostics go to stderr.

`tests.log` is JSON Lines: each line is a JSON event. Its event names include `run-start`,
`test-start`, `test-outcome`, `hook-start`, `hook-result`, `step-start`, `step-result`, `step-error`, `wait-start`,
`wait-result`, `wait-error`, `cleanup`, `screenshot`, `log`, `rerun-stale`, and `run-summary`.
Call and stand-in steps include the path and a shortened argument preview. `waitFor` and each
polling assertion are logged as one wait rather than one entry per sample.

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
the final failing step when available, and a short reason. `--summary-only` omits the separate full
per-result detail block; explicit `ctx.log`, child-process output, and critical errors remain visible.
The step is redacted, flattened to one line, and limited to 120 characters. An unknown-member error stays short; when there is no close
suggestion, it tells you how to list members, for example `List members: ctx.call("pages.$help")`.
Use the indicated `$help` call to inspect that node, then correct the path.

