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
`--prod` and `--app <persephone.exe>`. `--prod` performs one guarded production build. `--app`
validates the selected app and invokes its sibling `persephone-test.exe`. `--open` uses the direct
app launcher and records the retained PID without changing reports.

The product runner can also run a standalone test file directly with
`persephone-test.exe <file.mjs> --profile <name> [--log <file> | --log-dir <folder>]`.
The console launcher forwards those arguments to a windowless controller; the controller starts a
test-host utility process and a separate visible Persephone instance in the selected profile. The
host communicates with that instance over its per-run MCP endpoint and remains alive independently
of renderer restarts. A named profile must be free unless `--attach` is used with an already
running profile whose MCP server is enabled. Attach uses that instance without taking ownership
of its shutdown. The user workflow and examples are in
[`assets/guides/agents/web-app-tests.md`](../../assets/guides/agents/web-app-tests.md).

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
it does not bypass `requires`. The product host checks requirements for every run: `launch` is
skipped with `--attach`, and other tags run only when supplied by `--with`.

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
as gone. `--with` accepts the suite's external tags (`network`, `mic`, `tor`, `git`, `mneme`); it
does not accept the built-in `launch` tag. The seed sets `link-open-behavior` to
`internal-browser`, keeping URL actions on local fixtures inside the test app instead of opening
the operating system's default browser.

The tagged Tor network test also requires `PERSEPHONE_TEST_TOR_EXE` to point to a compatible
`tor.exe`; it remains skipped unless both `network` and `tor` are enabled.

Owned product test instances enable Chromium's `use-fake-device-for-media-stream` and `mute-audio`
switches before app readiness. This prevents tests from accessing a real microphone or playing
through a real speaker. After each profile reset the wrapper generates
`.profile/test-audio-capture.wav`, a deterministic four-second 48 kHz mono WAV, and passes its
absolute path in `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` to owned module launches. The main process
uses it only in test instances and only when it names an existing WAV. `--open` and `--attach` do
not receive or install this fake media setup; tests that need capture, playback, or voice paths must
declare `requires: ["launch"]` so they run only against an owned test instance.

## Product host options

The general product runner supports these suite-independent options:

| Option | Meaning |
| --- | --- |
| `--test-setup <module>` | Dynamically load a setup module that adds members to each context. |
| `--test-selection <json-file>` | Read a version 1 manifest of exact `{ file, name }` identities. |
| `--with <tag,...>` | Enable named non-`launch` requirement tags. |
| `--timeout-scale <number>` | Scale startup, request, wait, polling, cleanup, screenshot, shutdown, and second-instance deadlines. |
| `--keep-open` | Retain an owned app after invocation failure and record its PID and MCP URL. |
| `--mcp-port <port>` | Request an available MCP port for an owned app; default selection is ephemeral. |
| `--grep <regex>` | Select product tests whose names match this case-sensitive JavaScript regular expression. |
| `--retries <n>` | Retry failed product tests up to `n` additional times; the default is `0`. |

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

The product context handles per-test page and pop-up cleanup. It supports `app`, `openBrowser`,
`handle`, path `call`/`callText` (including `{ dialog: true }`), `set`, `waitFor`, `expect`, `script`,
`restartApp`, `launchSecondInstance`, `file`, and `log`. The suite setup module supplies the
suite-only fixture helpers. The setup hook receives the current context, `{ file, name,
profileDirectory, attach }`, and a getter for the current MCP client adapter, so an app restart
uses the replacement connection.

Browser downloads in an owned test instance bypass the native Save dialog and use
`<userData>/test-downloads/`, adding a ` (n)` suffix when a filename already exists. The path is
available from `app.downloads.downloads[i].savePath` after completion. Attached instances retain
their normal Save dialog behavior.

Before each test, the runner snapshots page ownership. Cleanup closes newly opened pages and
pop-ups, including pages opened through `ctx.call`. Owned-page closes allow the renderer's
unsaved-changes prompt and answer it with `Don't Save`. Cleanup sweeps renderer dialogs (`dialogs[i]`)
before its page snapshot and again after closing owned pages: `Unsaved Changes` is answered with
`Don't Save`, and other renderer dialogs use `cancel()`. Cleanup answers renderer dialogs only;
native OS dialogs are outside this cleanup. A popup menu left open (`menus[0]`) is closed in the same
sweep. Editorless workspace pages count as owned pages. A renderer dialog found before the snapshot is dismissed
and makes that test fail. A prompt raised by cleanup while closing an owned page is expected and
does not itself fail the test. Dialog cleanup actions are logged, and any dialog remaining after
owned-page cleanup also fails the test.

With `--attach` the app window is the user's too, so the diff-based ownership above does not apply:
cleanup closes only pages opened through `ctx.openBrowser` (tracked in `TestContext._state.ownedPages`)
and new pop-ups of those pages, logs other new pages as `leave-unowned-pages`, and skips the
renderer dialog/menu sweep. Otherwise a page the user opened during a test, or the user's own
`Unsaved Changes` prompt, would be closed or answered `Don't Save`
(`src/test-host/browser-helpers.ts` `closePagesOpenedSince`).

The `app` tree is a stand-in for call paths, not a live object model: each property read or method
call makes a round trip and must be awaited. Use `ctx.set(path, value, { timeout? })` to assign a
writable property; assigning through `app` throws because the assignment cannot be awaited. A
stand-in used as an awaitable resolves its call
result; its `then` returns the callback's chained Promise so standard Promise chaining works.
Returning a stand-in from an async helper therefore reads it; use `ctx.handle(node)` to return the
same path as a stand-in instead. `.catch` and `.finally` are rejected with guidance to use
`try { await node } catch {}`. Function arguments cannot cross the call boundary; use
`waitFor({ selector })` or `ctx.script(code)` for those cases.

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
Path-based
`waitFor` accepts the same options and resolves to the matching poll value.

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
