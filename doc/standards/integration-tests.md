# UI integration tests

## Ownership and layout

The product runner in `src/main/test-mode/` and `src/test-host/` owns generic test execution,
context APIs, exact selection manifests, requirements, timeout scaling, page cleanup, screenshots,
and per-invocation reports. `integration-test/run.mjs` is the suite wrapper: it owns test discovery,
area and name filters, suite requirement tags, seed/profile lifecycle, HTTP fixtures, target choice,
the optional `--baseline` comparison, and the aggregate suite report.

Suite tests stay at `integration-test/tests/<area>/<module>/<feature>.test.mjs`. Their imported
`test()` factory remains in `integration-test/lib/context.mjs`. The suite setup module
`integration-test/test-setup.mjs` adds `fixture(relativePath)`, `httpUrl(path)`, `httpsUrl(path)`,
and `_getClient()`;
these members are not product context APIs. `fixture()` resolves only inside the seeded profile's
`work/` directory. `_getClient()` provides the existing MCP SDK client's `listTools()` and the
raw `call` tool response for the unchanged MCP tests.

## Runs and profile lifecycle

Run `npm start`, then `npm run test:ui`. The default target is `dev`; optional targets are
`--prod` and `--app <path>`. `--prod` performs one guarded production build. Windows `--app`
requires `persephone.exe` and invokes its sibling `persephone-test.exe`; Linux `--app` requires an
executable named `persephone` and runs it directly with `--test`. Linux packaged execution is an
invocation path only: this repository does not currently build or verify a Linux package. `--open`
uses the selected app directly and records the retained PID without changing reports.

On Windows, the product runner can also run a standalone test file directly with
`persephone-test.exe <file.mjs> --profile <name> [--log <file> | --log-dir <folder>]`.
The console launcher forwards those arguments to a windowless controller; the controller starts a
test-host utility process and a separate visible Persephone instance in the selected profile. The
host communicates with that instance over its per-run MCP endpoint and remains alive independently
of renderer restarts. A named profile must be free unless `--attach` is used with an already
running profile whose MCP server is enabled. Attach uses that instance without taking ownership
of its shutdown. The user workflow and examples are in
[`assets/guides/agents/web-app-tests/index.md`](../../assets/guides/agents/web-app-tests/index.md).

For Linux development, run the suite from the Linux checkout with Node 24 and `npm run test:ui`.
The wrapper loads the pure shared platform and requirement modules directly from their `.ts` source;
Node 24 strips their erasable TypeScript syntax. Linux profile probing and attach use the product's
Unix-domain socket under `$XDG_RUNTIME_DIR`; the wrapper checks the `uitest` socket before deleting
the profile and requires a non-empty runtime directory. On Windows, the same profile endpoint is
the named pipe.

When the Linux test host starts an app, it removes Electron's inherited `CHROME_DESKTOP` variable
from that child environment. Electron adds the variable to its own main-process environment, but a
test app inheriting it exits during Chromium zygote startup. Other display/session and test-fixture
variables are retained. This Linux development adjustment does not change the Windows spawn.

`persephone-test.exe --init <folder>` copies the offline starter suite from
`assets/test-suite-template/` into an absent or empty destination and exits without launching a
window. It refuses to overwrite files. The general runner accepts `--reporter human` (default) or
`--reporter json-lines`; JSON Lines mode emits versioned run, test, hook-failure, and run-end events
to stdout, with console diagnostics directed to stderr. The existing per-run `report.json` format
is unchanged.

After selection, the host prints the window index, optional persistent name, and live Electron
`windowId` before test events. JSON Lines `run-start` includes optional
`testWindow: { index, windowId, name? }`; if setup fails before selection, the fallback start event
has no identity and comes before synthetic test events.

The wrapper starts the read-only HTTP fixture servers once on loopback ports 17867 (HTTP) and
17868 (HTTPS), both serving `integration-test/fixtures/http/`. The HTTPS server uses the committed
test-only certificate in `integration-test/lib/tls/`; `ctx.httpsUrl(path)` builds a local HTTPS
fixture URL. Normal owned module runs pass that certificate's exact SHA-256 fingerprint to the
test instance, which accepts only that certificate error. `--open` does not start the fixture
servers or install the test trust, and `--attach` uses the already-running app without installing
it, so HTTPS fixture tests need a normal owned run. For every
selected module id, a normal run replaces `.profile` from `seed/`, recopies fixtures into
`.profile/work`, writes an exact file/name manifest, and invokes the product runner. Nested module
ids receive separate app instances too. The manifest limits that invocation to its exact tests;
it does not bypass `requires`. The product host checks requirements for every run: `windows`, `linux`, and
`webgl` are automatic platform requirements and are skipped on other platforms before file hooks
(`webgl` because Linux test machines have no GPU for Chromium; only game boards need it), `launch` is
skipped with `--attach`, and opt-in tags run only when supplied by `--with`. The `desktop`
requirement remains a live visibility check after window selection. The wrapper's `--list` reports
each automatic platform skip and its reason.

Owned test instances set the main process's `%LOCALAPPDATA%` to
`<userData>/test-local-app-data` before child processes start. Board services inherit this value, so
board runtimes, models, and enrollment data stay inside the selected test profile. `--open` and
`--attach` instances are not test instances and keep the user's real `%LOCALAPPDATA%`; any board
test that opens a board service must declare `requires: ["launch"]` and run in an owned instance.

Within an owned test instance, board services and board-started `execute`/`executeNode` processes
also receive board-only `USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, `APPDATA`, `CLAUDE_CONFIG_DIR`, and
`CODEX_HOME` paths under `<userData>/test-home`; their `LOCALAPPDATA` is the same global test path
described above. Their `PATH` contains `<userData>/test-bin` plus only `%SystemRoot%`,
`%SystemRoot%\System32`, `%SystemRoot%\System32\Wbem`, and
`%SystemRoot%\System32\WindowsPowerShell\v1.0`, keeping user-installed CLIs unavailable. `test-bin` holds only a
`node.cmd` that forwards to the host's `node.exe` by absolute path, so fixtures can still run `node <script>`. `CLAUDECODE` and `CLAUDE_CODE_*` (left by an agent CLI that
launched the suite) are removed. These
board-only redirects apply only to test instances; `--open` and `--attach` run as non-test
instances. App-level process startup keeps its existing environment behavior.

The HTTP fixture server also serves `/refused`, which redirects to an unused loopback port for
transport-failure tests. Its `/boards-catalog/` route serves the fake published-board catalog,
version manifests, screenshots, and ZIP archives. The archives are built from
`fixtures/boards-catalog/` when the server starts, including their sizes and SHA-256 values, so
fixtures do not need committed binaries. Owned module launches receive
`PERSEPHONE_TEST_BOARDS_CATALOG_URL` pointing at this route; the product reads it only in a test
instance and accepts only an `http://127.0.0.1` base. Attach does not pass the variable to its
already-running app.

Attach requires the wrapper's live retained-app record and a running named-profile pipe. It does
not reset or restart the app. Fixture files are refreshed over the existing work directory. The
product controller reads MCP settings from `--profile-dir`, connects, then verifies that
`main.runtime.paths.userData` resolves to that same directory before it accepts the connection.
The selected app is never stopped by attach.

`--area` selects whole-segment path prefixes and `--test` selects a substring of the descriptor
name. `--list` prints the filtered suite without starting the app. `--rerun-failed` selects current
file/name identities from the wrapper's `reports/last-failed.json` and reports removed identities
as gone. `--with` accepts opt-in tags such as `network`, `mic`, `tor`, `git`, and `mneme`; automatic
tags (`launch`, `windows`, `linux`, `webgl`, `desktop`, and `published-board-checkout`) cannot be supplied. The seed sets `link-open-behavior` to
`internal-browser`, keeping URL actions on local fixtures inside the test app instead of opening
the operating system's default browser.

The tagged Tor network test also requires `PERSEPHONE_TEST_TOR_EXE` to point to a compatible Tor
executable (a `tor.exe` on Windows); it remains skipped unless both `network` and `tor` are enabled.

On Windows, `npm run test:ui -- --with virtual-desktop --desktop 2` opts into the real placement
module and moves every window in each owned run to the selected existing virtual desktop. The
selector is a 1-based desktop number or an exact case-insensitive desktop name; a missing selector
reports the available desktops and says to create one with Win+Ctrl+D. It cannot be used with
`--attach`. Placed windows use inactive display and ignore focus requests, and
`windows[i].desktopVisible` reports whether each window is on the current desktop. Native file
dialogs remain managed by Windows and are not guaranteed to appear on the selected desktop. The
`virtual-desktop` requirement stays skipped unless explicitly enabled with `--with`.

Owned product test instances enable Chromium's `use-fake-device-for-media-stream` and `mute-audio`
switches before app readiness. This prevents tests from accessing a real microphone or playing
through a real speaker. After each profile reset the wrapper generates
`.profile/test-audio-capture.wav`, a deterministic four-second 48 kHz mono WAV, and passes its
absolute path in `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` to owned module launches. The main process
uses it only in test instances and only when it names an existing WAV. `--open` and `--attach` do
not receive or install this fake media setup; tests that need capture, playback, or voice paths must
declare `requires: ["launch"]` so they run only against an owned test instance.

Owned test instances start with `main.unseenMode.enabled` set to `true`; ordinary instances start
disabled. This runtime setting disables Chromium animation and timer throttling for eligible process
WebContents while enabled. Each attached product-runner invocation reads the prior value, enables
the setting for setup, tests, and cleanup, then restores that value before disconnecting. This is
temporary process state, not persisted profile state. A hard termination of the host cannot run its
`finally` block, so the setting may remain enabled until manually disabled or Persephone quits.

`main.session.locked` and `windows[i].desktopVisible` are live main-process AiVision paths. Tests
read them with `ctx.call("main.session.locked", [])` and
`ctx.call("windows[index].desktopVisible", [])`; this goes through `createContext()` and
`TestWindowOwner.call()` to `McpClient.call()`. The `main` and `windows` roots stay unprefixed by
`TestWindowOwner.scope()`.

## Product host options

The general product runner supports these suite-independent options:

| Option | Meaning |
| --- | --- |
| `--test-setup <module>` | Dynamically load a setup module that adds members to each context. |
| `--test-selection <json-file>` | Read a version 1 manifest of exact `{ file, name }` identities. |
| `--with <tag,...>` | Enable named non-`launch` requirement tags. |
| `--timeout-scale <number>` | Scale startup, request, wait, polling, test, cleanup, screenshot, shutdown, and second-instance deadlines. |
| `--test-timeout <ms>` | Set the default attempt bound (300000 ms); `0` disables it. A descriptor `timeout` overrides it, and both values are scaled once. |
| `--keep-open` | Retain an owned app after invocation failure and record its PID and MCP URL. |
| `--mcp-port <port>` | Request an available MCP port for an owned app; default selection is ephemeral. |
| `--desktop <number|name>` | Place owned windows on an existing Windows virtual desktop; requires the suite opt-in and cannot be combined with `--attach`. |
| `--grep <regex>` | Select product tests whose names match this case-sensitive JavaScript regular expression. |
| `--retries <n>` | Retry failed product tests up to `n` additional times; the default is `0`. |
| `--reporter` | Select `human` (default) or `json-lines` output; JSON Lines emits versioned events to stdout. |
| `--summary-only` | Suppress the final per-test detail block in human output; it cannot be combined with `--reporter json-lines`. |

With `--attach --profile-dir <path>`, the controller reads that directory's MCP settings and
checks the connected app's user-data identity. The suite wrapper passes its configured product
options as separate process arguments. It sends `--keep-open` only to the last runnable module when requested.
The second-instance and dev-server probe deadlines remain wrapper-owned and are scaled there too.

The product runner also supports `test.skip`, `test.only`, and `test.fails(name, fn, { reason })` in
test modules. If any selected test uses `test.only`, only those focused tests run. A skipped test
keeps the `skipped` status; a failing `test.fails` becomes `expected-failure`, while a passing one
becomes `unexpected-pass`. A test that passes after a failed retry is `flaky`. `expected-failure`
and `flaky` are reported but do not fail the invocation; `unexpected-pass` does fail it and is
included in `last-failed.json`. A test that still fails after its retries remains `failed`.
`--grep` filters descriptor names after exact manifest and rerun selection; it does not change
whether a requested rerun identity exists.

The per-attempt timeout defaults to 300000 ms. `--test-timeout <ms>` or its `=` form sets the run
default; an optional `timeout` on `test`, `test.skip`, `test.only`, or `test.fails` overrides it.
Both are non-negative safe integer milliseconds, and `0` disables the bound. Positive values are
scaled once by `--timeout-scale`. Retries receive a fresh bound. The wrapper forwards its allowlisted
`--timeout-scale` value but does not expose arbitrary product options such as `--test-timeout`.
Timeout covers `beforeEach` and the body; `afterEach` uses a separate bound of the same duration.
File hooks use the scaled run-level timeout. Failure capture and cleanup use their own bounds. An
already dispatched MCP call or arbitrary JavaScript cannot be cancelled and may finish after expiry;
later context and retained setup-adapter calls reject.

Named `beforeAll`, `beforeEach`, `afterEach`, and `afterAll` exports are optional file hooks. They
receive context instances with independent lifetimes and per-hook `--test-setup` extensions.
`beforeEach` and `afterEach` run on every attempt; file hooks run only when selection and skip rules
leave at least one runnable descriptor. File pages remain open through attempts and are cleaned
after `afterAll`. Hook failures use `<beforeAll>` / `<afterAll>` pseudo-results or the test result,
and are included in reports and `tests.log`. Failed file-hook identities expand to their file's
descriptors under `--rerun-failed`. See the [file-hook guide](../../assets/guides/agents/web-app-tests/file-hooks.md)
for ordering, failure precedence, attach ownership, and diagnostics.

The product context handles per-test page and pop-up cleanup. It supports scoped `app`, unscoped
`root`, `openBrowser`, `usePage`, `handle`, path `call`/`callText` (including `{ dialog: true }`), `set`,
`waitFor`, `expect`, `script`,
`restartApp`, `launchSecondInstance`, `file`, and `log`. The suite setup module supplies the
suite-only fixture helpers. The setup hook receives the current context, `{ file, name,
profileDirectory, attach }`, and a getter for the current MCP client adapter, so an app restart
uses the replacement connection.

`ctx.waitFor(pathOrCallback, predicate, options)` accepts `timeout`, `maxLength`, `dialog`,
`allowNavigation`, `message`, and `retryErrors`. It returns the matching value and prepends `message`
to timeout errors when supplied. Callback and predicate errors propagate immediately by default;
`retryErrors: true` retries read errors until a match or timeout, but does not retry predicate errors,
environment stops, or lifetime cancellation. Its explicit timeout is scaled by `--timeout-scale`;
its default wait and poll intervals are already scaled.
`ctx.expect.poll(callback, options)` accepts a callback that receives `ctx` and retries ordinary
callback errors as well as matcher mismatches. Its async matchers mirror every `ctx.expect(value)`
matcher, including recursive `.not`; matcher arguments are checked before sampling, and `toThrow`
requires each sample to be a synchronous function. The default timeout and interval are the scaled
wait and poll settings. Explicit timeout is scaled; explicit interval is in milliseconds. A timeout
reports the expected matcher and compact last value or error. Each polling assertion emits one
`wait-start` and one `wait-result` or `wait-error` event.

Browser downloads in an owned test instance bypass the native Save dialog and use
`<userData>/test-downloads/`, adding a ` (n)` suffix when a filename already exists. The path is
available from `app.downloads.downloads[i].savePath` after completion. Attached instances retain
their normal Save dialog behavior. `waitForDownload()` returns the suggested filename, copied path,
size, MIME type, and URL. Runner results redact URL credentials, query values, and fragments; URLs
outside HTTP(S) are replaced with `[redacted URL]`. Direct browser facade calls return Electron's
original URL.

Before each file hook and test, the runner snapshots page ownership and browser pop-ups. In owned runs and
runner-created attached windows, cleanup closes pages and pop-ups first opened during that test,
including pages opened through `ctx.call`. In a selected `--window`, it closes only tracked
`ctx.openBrowser` pages and their new pop-ups; other new pages are left open and logged. `ctx.usePage`
adopts a browser page in the test window: cleanup never closes that page, even if it appeared after
the baseline or was also opened through `ctx.openBrowser`. New pop-ups on a session page are closed
when they were absent from the baseline; baseline or untrackable pop-ups are left alone. Owned-page
closes allow the renderer's unsaved-changes prompt and answer it with `Don't Save`. Cleanup sweeps
renderer dialogs (`dialogs[i]`) and popup menus (`menus[0]`) in the test window before its page
snapshot and again after closing pages. `Unsaved Changes` is answered with `Don't Save`, and other
renderer dialogs use `cancel()`. Native OS dialogs are outside this cleanup. Editorless workspace
pages count as owned pages. A renderer dialog found before the snapshot is dismissed and makes that
test fail. A prompt raised by cleanup while closing an owned page is expected and does not itself
fail the test. Dialog cleanup actions are logged, and any dialog remaining after cleanup also fails
the test.

With `--attach`, a new test window is created by default, and runner operations plus unprefixed
context and setup `rawCall` paths are scoped to it. Its page baseline diff owns pages that appeared
during the run; the runner sweeps its popup menus and renderer dialogs and closes the created window
after per-test cleanup. `--attach --window <index-or-title>` instead selects an existing open window:
decimal values select a record index, `name:<name>` selects an exact case-insensitive persistent
name, and other values select a unique case-insensitive substring of the OS window title. A name
can be assigned through `windows[i].name`; `--attach --window-name <name>` creates a named normal
window or reuses its live match, and cannot be combined with `--window`. Names survive app restarts
for windows in the startup snapshot; an explicitly closed window loses its name, while a restored
closed record reserves its name until opened or renamed. No match and ambiguous title matches report
only the match count. Window titles can collide, so use a name or index when needed. Cleanup in a
selected window closes only tracked `ctx.openBrowser` pages and their new pop-ups, logs other new
pages as `leave-unowned-pages`, and sweeps renderer dialogs and popup menus only in that window. It
never closes the selected window. Other windows are not inspected by runner bookkeeping.

After selection, human output identifies the test window by index, optional name, and live Electron
`windowId`. JSON Lines `run-start` events carry the same optional `testWindow` identity; a setup
failure before selection emits the fallback event without identity before synthetic test events.

Use `ctx.usePage({ url, title? })` to adopt a signed-in browser page in the selected test window.
String URLs are case-sensitive prefixes; string titles are case-sensitive substrings, and either
criterion may be a regular expression. Both supplied criteria must match exactly one browser page.
The summary URL is omitted for inaccessible private pages, so a session page must use a normal
profile, not incognito or Tor. The returned handle has `pageId` and is not reloaded or closed between
tests. The selected window stays open after the run; owned and runner-created windows are disposed at
run end, so session pages in those modes do not persist beyond the run. Browser storage state (F2)
is planned work, not an available feature.

`ctx.root` keeps the original unscoped call behavior, including access to `windows`, `main`, and
`guides`. Explicit `ctx.app.windows[i]` paths are also deliberate cross-window access. Awaiting
`ctx.app` with no path describes the selected window, not the renderer overview. Prefer unprefixed
paths; `ctx.root` and explicit `windows[i]` paths can reach outside the test window. The setup
adapter's `rawCall` is scoped in attached runs; `listTools` remains global. Owned runs preserve the
existing app behavior, including restart and raw setup calls. Attached failures capture only pages
under test in the selected test window and never take a window screenshot. Owned runs retain their
window screenshot and capture pages under test as well.

When a test throws and report output is enabled, each captured failed attempt writes a JSON file
under `failures/`. `report.md` links the last failed attempt's bundle and `report.json` stores its
relative path, including when a later retry passes. Cleanup-only failures do not trigger capture;
`--log` alone still produces no reports or artifacts. The bundle lists page ID, owned/session kind,
URL, title, page errors, console errors, failed requests, and each page's relative screenshot path
or `null`. Diagnostic lists are capped at the newest 100 entries. Page errors and failed requests
use attempt-start timestamps; console records are requested since attempt start and filtered by
`type === "error"`. Failed requests include transport errors and HTTP 400–599 responses, projected
to method, URL, nullable status, and `durationMs: null` because no duration is exposed. Collection
uses active-tab APIs and bounded buffers, so the bundle is best-effort; individual capture errors
are reported under `Capture errors` and do not affect test status.

The bundle never writes network headers, bodies, referrers, or other raw request data. URL
credentials and fragments are removed, and query values are replaced while query keys remain,
including URLs found in page-error text and console arguments. Other text, page titles, and
screenshots can contain sensitive page content. Treat these artifacts as local sensitive output;
`reports/` and `test-results/` belong in `.gitignore`.

The `app` tree is a stand-in for call paths, not a live object model: each property read or method
call makes a round trip and must be awaited. Use `ctx.set(path, value, { timeout? })` to assign a
writable property; assigning through `app` throws because the assignment cannot be awaited. A
stand-in used as an awaitable resolves its call
result; its `then` returns the callback's chained Promise so standard Promise chaining works.
Returning a stand-in from an async helper therefore reads it; use `ctx.handle(node)` to return the
same path as a stand-in instead. `.catch` and `.finally` are rejected with guidance to use
`try { await node } catch {}`. Function arguments cannot cross the call boundary; use
`waitFor({ selector })` or `ctx.script(code)` for those cases.

An unknown member on a page model adds a hint to list the model's `aiVision.members` descriptor.
The hint is conditional and does not inspect or invoke the missing property.

Every failed test reports the step that threw, even if cleanup runs afterward. `tests.log` records
test lifecycle and steps as JSON lines. In test mode, `app-console.log`, `site-console.log`,
`network.log`, and `app-main.log` capture the app and page diagnostics; network records contain
request metadata only, without request or response headers or bodies. Outside test mode, this
logging is inactive.

## Reports and parity

Each invocation writes `report.md`, `report.json`, `last-failed.json`, `tests.log`, screenshots,
and app logs under the unique ignored path `integration-test/reports/runs/<run-id>/<module-id>/`.
The per-module `app-main.log` stays with those artifacts and is linked from the suite report when
the module has a setup or launch failure.

Product test results may also include a source `Location:` in `report.md` when the thrown stack
contains a frame from that test file. The console output ends with a `Summary:` list of non-passed
tests, including their status, name, file or location, and a short reason or first error line when
available. `report.json` retains each result's optional location and retry-attempt details.

The wrapper owns `integration-test/reports/latest.md`, `latest.json`, `last-failed.json`, and
`screenshots/`. It maps the module results back to their original `tests/...` identities, preserves
skip reasons, copies failure screenshots into the suite screenshot folder, and reports setup or
launch failures against selected identities.

`--baseline <file>` compares the run with an earlier `latest.json`, keyed by normalized
repository-relative file plus exact test name, for the selected tests only. Status is the parity
key; durations, timestamps, and screenshot paths do not affect it. Each changed, missing or added
test is printed as a `BASELINE` line and listed in `latest.md`, and any difference fails the run.
Without `--baseline` there is no comparison. Keep a baseline by copying `latest.json` (for example to
`reports/baselines/`, which is ignored) before a change you want to check, such as a test rewrite.

Inspect `latest.md` and the staged module artifacts to diagnose a failure. `--keep-open` leaves
only the last selected owned module running after failure; use `npm run test:ui:call -- --close`
before a normal run that resets the profile. Attach never retains or closes the borrowed process.

## Authoring rules

Browser tests are grouped under `tests/browser/`: `automation/input/` and `automation/observe/`,
`page-models/`, `site-extensions/` (saved and temporary extensions), `popups/`, `page-tools/`,
and `tor/`; the older `tests/editors/browser/` location is retired. Their HTTP/HTTPS pages and
assets live under `fixtures/http/browser/<module>/`.

Board platform tests live under `tests/boards/`: `lifecycle/`, `permissions/`, `info/`, `bridge/`,
`extensions/`, `catalog/`, `published/`, `excalidraw/`, and `rest-client/`. Shared board setup and
trust helpers belong in `tests/helpers/boards.mjs`; the cross-area checkout registration helper is
`tests/helpers/published-boards.mjs`. Cross-cutting capability tests live under
`tests/capabilities/<module>/`; current modules cover `proc/`, `terminal/`, `proxy/`,
`module-service/`, `translate/`, and `speech/`. Their fixtures live under
`fixtures/boards/module-service/`, `fixtures/boards/translate/`, `fixtures/boards/speech/`,
`fixtures/capabilities/terminal/`, and `fixtures/http/translate/`. Offline provider boards belong
under `fixtures/boards/<module>/`. Keep board fixtures under `fixtures/boards/<module>/`, with each
board in its own folder. Catalog archives are sourced from `fixtures/boards-catalog/`, and REST
Client HTTP request fixtures live under `fixtures/http/rest-client/`. Tests use `fixture()` to
access an isolated copy in the profile's
`work/` directory, so mutable files can be reset without changing the committed fixture. Prefer the
app stand-in (`ctx.app.boards.*`,
`ctx.app.pages[id].editor.*`) for structured calls; bind stand-in call options with
`ctx.app.withOptions({ timeout?, maxLength?, dialog? })`; use `ctx.call` for paths the stand-in
cannot express, `ctx.callText` for exact text, and `ctx.set` for writable property assignments.
Path-based `waitFor` accepts `timeout`, `maxLength`, `dialog`, `allowNavigation`, and `message`, and
resolves to the matching poll value. Callback and predicate failures still propagate immediately.
`expect.poll` shares the same host polling loop, defaults to the same scaled timeout and interval,
and retries callback failures until a matcher succeeds or its timeout expires. Polling assertions
accept `timeout`, `interval`, and `message`; explicit timeout is scaled while interval is in
milliseconds. Their final `AssertionError` includes the expected matcher and a compact last value or
error, and they produce one wait log pair per assertion.

A coded error from any namespace of the agent call tree arrives as `Error [<code>]: <message>`, and
the test host restores the code as `error.code` on `ctx.call` errors. Tests should assert both
the useful message and code when the capability contract defines one. A capability test may start
its own loopback HTTP server or proxy in the test host with `node:http` or `node:net` (for example,
HTTP CONNECT and SOCKS5 proxies); bind to loopback and an ephemeral port, assert that requests
traversed the proxy, and close every server/socket in `finally` so no listener survives the test.

Tests that need a local `persephone-boards` checkout declare
`requires: ["published-board-checkout"]`. The wrapper enables that tag automatically when
`../persephone-boards/boards` exists or `PERSEPHONE_BOARDS_DIR` names an existing boards folder;
otherwise the test is skipped with the missing checkout path and the override variable to set.
The wrapper owns this tag, so `--with published-board-checkout` is rejected. Catalog tests must
use the fake loopback catalog and owned launches; they must not reach the published catalog or
external network.

Published-board tests have a separate area at `tests/published-boards/<board-id>/`, with one
test module per board. The shared `tests/published-boards/helpers.mjs` provides
`openPublishedSample(ctx, boardId, sampleRel)` for file-backed viewers and
`openPublishedBoard(ctx, boardId)` for boards opened directly without a sample file. Both register
the local board copy, verify the opened editor belongs to that board root, activate its page, and
wait for `editor.frameReady`. Tests use the returned
`editor` stand-in for structured board calls such as `editor.app.*`; close the page and unregister
the board in a `finally` block with `closePublishedSample()`. Declare both `launch` and
`published-board-checkout` because these tests need an owned app and a local checkout. Close either
handle with `closePublishedSample()` in `finally`. Closing a
page can begin asynchronous board-process shutdown, so registration cleanup retries removal of an
old copied board directory before copying the next one.
`sampleRel` is relative to `fixtures/boards-samples/`, for example
`audio-player/sample.wav`.
The copy filters `.git`, `node_modules`, `ui.log`, ZIP files, and simple ignored file or directory
names from the board checkout's `.gitignore`; tests should create runtime data in the isolated copy
and must not depend on a developer's ignored checkout files.

Keep viewer samples synthetic and minimal. Place reusable committed fixtures under
`fixtures/boards-samples/<board-id>/` and obtain mutable work copies with `ctx.fixture()`. Generate
structured formats in test helpers when that is clearer or smaller than committing generated
bytes; the office package builder is `tests/published-boards/office-samples.mjs`. Check any sample
copied from another checkout for personal data and record its source. Tests must not access the
network. Do not open a torrent sample unless the test verifies that opening it stays offline and
does not start discovery.

Tests must run independently and should leave committed fixtures unchanged. Use `ctx.fixture()`
for mutable work copies and reset their content at the start of each test. Tests that restart the
app or launch another process declare `requires: ["launch"]`. Use `ctx.httpUrl()` for local
HTTP-fixture paths and `ctx.httpsUrl()` for HTTPS-fixture paths. Do not weaken assertions to make a
test pass; repair the owning application behavior instead. Keep modules focused and split by
feature when needed.

The runner retries its own page bookkeeping reads up to three times when attention is present, 200 ms apart by default (scaled by `--timeout-scale`); it never replays test calls. Attention in the test window fails the test with its cause. Attention identified in another window, persistent unidentifiable attention on a runner read, or a closed/replaced test window stops the run (exit 3). The interrupted test and remaining selected tests are `not-run`; the interrupted test may already have changed state. After a stop, `--rerun-failed` selects the failures and tests that did not run. The report names the cause. Untracked OS-level dialogs may not produce an attention reply.

## Minimized browser Page Visibility

When `main.unseenMode` is enabled, embedded browser guest documents and their frames expose
`document.visibilityState === "visible"` and `document.hidden === false` while minimized. Hidden
`visibilitychange` events are suppressed, and disabling the mode restores Chromium's real state
with one event when the exposed state changes. This applies to every embedded browser guest,
including user browsing; standalone popup windows report real visibility. A new document receives
the host's latest state after its document-start announcement, so a stale creation-time snapshot
can briefly be observed by its first script.

`tests/core/unseen-mode/minimized-page-visibility.test.mjs` covers the top page and a same-origin
iframe through the off/on/disable-while-minimized flow, fresh-document reconciliation, and window
restore. Cross-origin and out-of-process iframe first-script behavior remains a manual live-dev
check.

Electron's `<webview>` top document is a special case: Electron defines own, non-configurable
`document.visibilityState` and `document.hidden` properties on it, so the preload cannot replace
those properties through `Document.prototype`. Electron drives them by sending the private
`GUEST_INSTANCE_VISIBILITY_CHANGE` message through the guest's `_sendInternal` method. The main
process `PageVisibilityOverride` wraps that method and substitutes `"visible"` while unseen mode is
enabled; when the mode changes, it sends the current state through the original method. The
document-start preload shim handles subframes. This relies on Electron internals verified against
the shipped Electron build: re-check the channel and method on each Electron upgrade. If the method
is unavailable, the top document keeps its real visibility.

## Desktop awareness and placement

On Windows, `main.session.locked` is maintained from Electron's `powerMonitor` lock and unlock
events. `windows[i].desktopVisible` is derived live and is false for a destroyed, minimized, hidden,
locked, or non-current-virtual-desktop window. The virtual desktop probe uses the COM
`IVirtualDesktopManager` methods `IsWindowOnCurrentVirtualDesktop`, `GetWindowDesktopId`, and
`MoveWindowToDesktop`. Desktop enumeration and names come from the current user's Explorer
`VirtualDesktopIDs` and per-desktop `Name` registry values. Those registry values are binary GUID
arrays and UTF-16 strings respectively; keep the value-type and length checks when changing this
adapter.

The adapter uses `koffi` to call `CoCreateInstance`, `RegGetValueW`, and the COM vtable. Its vtable
slots 3–5 follow the three `IUnknown` entries. HWND and `HKEY_CURRENT_USER` arguments are passed as
`intptr_t` integers (BigInt for the HWND on 64-bit Windows); `koffi.as()` does not convert an integer
to a pointer. Treat negative HRESULTs as failures, except `TYPE_E_ELEMENTNOTFOUND` from
`GetWindowDesktopId` for a window that has not yet been shown.

The wrapper accepts `--desktop <number|name>` only for owned Windows runs and requires the
`virtual-desktop` opt-in tag; it cannot be combined with `--attach`. Desktop selection happens
before a run window's first show. Moving during `browser-window-created` is too early: Windows may
return success without changing the placement. The guard therefore moves immediately before the
first `showInactive()`. It replaces `show()` and `showInactive()` with the placement guard, swallows
`focus()`, `moveTop()`, `setAlwaysOnTop()`, and `webContents.focus()`, and routes `restore()` through
`showInactive()` so a minimized run cannot switch the user's desktop. A focus request is still
recorded for policy checks even though no native focus event occurs. If placement fails, the owned
run exits with an error. Native OS dialogs remain outside these window guards.
