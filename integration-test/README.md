# Integration tests

`npm run test:ui` keeps suite behavior in this folder and delegates each runnable module to
Persephone's shipped `--test` runner. The wrapper owns test discovery, `--area` and `--test`
filters, requirement tags, seed/profile resets, HTTP fixtures, target selection, the optional
`--baseline` comparison, and aggregate reports. The product host owns descriptor execution, context APIs, per-test page
cleanup, screenshots, and each module's detailed artifacts.

## Run the suite

Start `npm start`, then select the full suite or a subset:

```powershell
npm run test:ui
npm run test:ui -- --area core
npm run test:ui -- --area editors/grid
npm run test:ui -- --test "open fixture"
npm run test:ui -- --with network,mic
npm run test:ui -- --list --area editors
npm run test:ui -- --rerun-failed
npm run test:ui -- --timeout-scale 1.5
npm run test:ui -- --keep-open
npm run test:ui -- --prod
npm run test:ui -- --app "C:\release\win-unpacked\persephone.exe"
npm run test:ui -- --open
npm run test:ui -- --attach --area core/smoke
```

The default target is `dev`. `--prod` performs one guarded build and replaces `.vite/build`; it
refuses to run while a live dev marker exists. Restart `npm start` before returning to dev tests.
`--app` validates `persephone.exe` and uses its sibling `persephone-test.exe`. These target options
are mutually exclusive. Paths are passed as separate OS arguments, including paths with spaces.
`--open` directly launches the selected app and leaves reports unchanged. Use
`npm run test:ui:call -- --close` to close a retained app before a profile reset.

The isolated profile is `integration-test/.profile`, identity `uitest`, with MCP 17865, video
17866, Mneme 17700, Tor 19052, HTTP fixtures 17867, and HTTPS fixtures 17868. The seed's
`appSettings.json` sets `link-open-behavior` to `internal-browser`, so URL actions in tests stay in
the app. Its `config.json` marks the published-boards catalog as
checked far in the future, so the app never fetches the catalog from GitHub and starts with an
empty catalog. A normal run seeds the profile and copies fixtures before
every module id, including nested modules. The read-only HTTP and HTTPS fixture servers run for
the wrapper run on ports 17867 and 17868, serving the same `fixtures/http/` tree. The HTTPS server
uses the committed test-only certificate in `lib/tls/`; `ctx.httpsUrl(path)` constructs its local
URLs. Normal owned module runs trust only that certificate's SHA-256 fingerprint. `--open` does
not start the fixture servers or install test certificate trust, and `--attach` cannot change the
already-running app's trust settings; run HTTPS fixture tests as normal owned tests. The wrapper
refuses occupied ports, an existing `uitest` pipe, an unsafe
profile path, or a concurrent `.runner.lock`. It does not stop the user's ordinary app.

The fixture server also exposes `/refused`, which redirects to an unused loopback port to exercise
transport failures, and `/boards-catalog/`, a fake published-board catalog with version manifests,
screenshots, and ZIP archives generated from `fixtures/boards-catalog/` at server startup. Owned
module launches receive `PERSEPHONE_TEST_BOARDS_CATALOG_URL` for that loopback route. The main
process honors the override only in test instances and only for an `http://127.0.0.1` URL; attach
cannot change the environment of its existing app.

The wrapper detects the boards checkout at `../persephone-boards/boards`, or uses
`PERSEPHONE_BOARDS_DIR` as an override. When present it enables the `published-board-checkout`
requirement automatically; when absent, tests with that requirement skip and report the missing
path and how to set the override. Do not pass this wrapper-owned tag to `--with`.

`--area` accepts comma-separated whole-segment prefixes: `core` includes `core/smoke` but not
`core-x`. `--test` selects a substring of the descriptor name. `--list` prints the area/module
tree without launching an app. `--rerun-failed` uses exact file/name identities from
`reports/last-failed.json` and reports removed identities as gone. Suite requirement tags are
`network`, `mic`, `tor`, `git`, and `mneme`; each missing tag skips its test with a reason. The
built-in `launch` requirement works on owned runs and is skipped by the product host under
`--attach`. The Tor network test also requires `PERSEPHONE_TEST_TOR_EXE` to name a compatible
`tor.exe` and both `network` and `tor` tags.

Owned product test instances enable Chromium's fake media device and `mute-audio` before app
readiness, preventing access to a real microphone or playback through a real speaker. After each
profile reset, the wrapper generates `.profile/test-audio-capture.wav` (four seconds, 48 kHz, mono)
and passes its path in `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` to owned module launches. The main
process accepts this path only in test instances and only for an existing WAV file. `--open` and
`--attach` do not install the fake device or pass the WAV path. Tests needing media capture,
playback, or voice paths must declare `requires: ["launch"]`.

Owned test instances also redirect the main process's `%LOCALAPPDATA%` to
`<userData>/test-local-app-data` before child processes start. Board services inherit this profile-local
path, keeping board runtimes, models, and enrollment data out of the user's real profile. `--open`
and `--attach` instances are not test instances and retain the real `%LOCALAPPDATA%`; tests that open
a board service must declare `requires: ["launch"]`.

Owned test-instance board services and board-started `execute`/`executeNode` processes also receive
board-only `USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, `APPDATA`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`
folders under `<userData>/test-home`; their `LOCALAPPDATA` uses the same profile-local path above.
Their `PATH` is limited to `<userData>/test-bin`, `%SystemRoot%`, `%SystemRoot%\System32`,
`%SystemRoot%\System32\Wbem`, and `%SystemRoot%\System32\WindowsPowerShell\v1.0`, so
user-installed CLIs are unavailable; `test-bin` holds only a `node.cmd` that forwards to the host's
`node.exe`. The board-only redirects apply to owned test instances;
`--open` and `--attach` are non-test instances.

Attach uses the selected `reports/keep-open.json` record and PID, refreshes fixtures over the
existing work directory, and never resets or stops the app. The product controller connects using
the profile directory's MCP settings and verifies `main.runtime.paths.userData` before accepting
the connection. Attach does not capture test-mode app logs from the already running app.

## Wrapper and product artifacts

Every selected module gets a versioned exact `{ file, name }` selection manifest. The wrapper runs
one product invocation for each runnable module and passes the suite setup module plus `--with`
and `--timeout-scale`. It passes `--keep-open` only to the last runnable module. Product options
are documented in the [web-app test guide](../assets/guides/agents/web-app-tests/index.md); the suite
setup adds only `ctx.fixture()`, `ctx.httpUrl()`, and the compatibility `ctx._getClient()` helper.
Existing `test` imports remain in `lib/context.mjs`.

Product reports, logs, and screenshots are staged under
`reports/runs/<run-id>/<module-id>/`. The wrapper keeps aggregate
`reports/latest.md`, `latest.json`, `last-failed.json`, and `screenshots/`. Aggregate results retain
the original `tests/...` file names and map product skip reasons. `--baseline <file>` compares each
selected test's status with an earlier `latest.json` and fails the run on any difference; without
it there is no comparison.

`tests.log` records per-test steps and outcomes. Under each staged module folder, `app-main.log`,
`app-console.log`, `site-console.log`, and `network.log` provide product-host diagnostics. App
logs stay staged; setup/launch failures link to the module's `app-main.log` from `latest.md`.

## Test layout and context

Tests live at `tests/<area>/<module>/<feature>.test.mjs`; nested module paths are allowed. Add a
test to the module that owns the feature and split by feature when a module grows too large. Tests
import `test()` from `lib/context.mjs` and export one descriptor or an array. Declare
`requires: ["launch"]` for tests that restart the app or launch another instance.

Product context members include `app`, `openBrowser`, `handle`, `call`, `callText`, `set`, `waitFor`,
`expect`, `script`, `restartApp`, `launchSecondInstance`, `file`, and `log`. `set(path, value,
{ timeout? })` assigns a writable call-tree property. Assignments through `app` throw because they
cannot be awaited; use `set` instead. The suite setup adds
`fixture(relativePath)` constrained to `.profile/work`, `httpUrl(path)` and `httpsUrl(path)`
constrained to the local HTTP and HTTPS fixture servers, and `_getClient()` with raw MCP `call` and
`listTools()` access. Path calls
support `{ timeout?, maxLength?, dialog? }`; the app stand-in supports bound options through
`ctx.app.withOptions(options)` and is used directly by the suite.
The product host closes pages and pop-ups opened during a test after that test finishes.

Browser tests live under `tests/browser/automation/{input,observe}/`, `page-models/`,
`site-extensions/` (saved and moved temporary-extension tests), `popups/` (moved from the old
`tests/editors/browser/` location), `page-tools/`, and `tor/`. Their local pages and assets are under
`fixtures/http/browser/<module>/`.

Board platform tests live under
`tests/boards/{lifecycle,permissions,info,bridge,extensions,catalog,published,excalidraw,rest-client}/`.
Shared board setup and trust helpers belong in `tests/helpers/boards.mjs`; the cross-area
published-board checkout helper is `tests/helpers/published-boards.mjs`. Cross-cutting capability
tests live under `tests/capabilities/<module>/`; current modules cover `proc/`, `terminal/`,
`proxy/`, `module-service/`, `translate/`, and `speech/`. Their fixtures are under
`fixtures/boards/module-service/`, `fixtures/boards/translate/`, `fixtures/boards/speech/`,
`fixtures/capabilities/terminal/`, and `fixtures/http/translate/`. Put board fixtures under
`fixtures/boards/<module>/`, with each board in its own folder. Catalog ZIP sources are under
`fixtures/boards-catalog/`; REST Client HTTP fixtures are under `fixtures/http/rest-client/`.
`ctx.fixture()` returns the isolated `work/` copy; reset mutable files there at the start of each
test. Prefer `ctx.app.boards.*` and `ctx.app.pages[id].editor.*`; use `withOptions()` for stand-in
call options, `ctx.call` for paths the stand-in cannot express, `ctx.callText` for exact text, and
`ctx.set` for writable property assignments.

A coded error from any namespace of the agent call tree arrives as `Error [<code>]: <message>`;
the test host parses it into `error.code` for `ctx.call` errors. Assert the code when the
contract defines one. Tests may start loopback HTTP servers and proxies in
the test host using `node:http` or `node:net`; use ephemeral loopback ports, verify proxy routing,
and close each server/socket in `finally`.

Published-board tests live under `tests/published-boards/<board-id>/`, one module per board.
`tests/published-boards/helpers.mjs` provides `openPublishedSample(ctx, boardId, sampleRel)` for
file-backed viewers and `openPublishedBoard(ctx, boardId)` for boards opened directly without a
sample file. `sampleRel` is relative to `fixtures/boards-samples/` (for example,
`audio-player/sample.wav`). Both register the local checkout board and return a handle with `id`,
`editor`, and `root`; the sample helper also returns `file`. The sample helper opens a sample from
`fixtures/boards-samples/` through `app.pages.openFile()`, verifies that the matching board editor
and root opened, activates the page, and waits for `editor.frameReady`. Use the returned `editor`
stand-in for structured calls such as `editor.app.getStats()`; use `ctx.call` or `ctx.callText`
only when the stand-in cannot express the needed call. Close the page before the board is
unregistered. Tests declare both
`launch` and `published-board-checkout`, since each needs a separately owned app and a local board
checkout. Registration copies published files while filtering git-ignored runtime data from the
checkout. Close either handle with `closePublishedSample()` in `finally`.

Keep samples minimal, synthetic, and local. Reusable binary fixtures belong in
`fixtures/boards-samples/<board-id>/` and tests access their isolated work copies with
`ctx.fixture()`. Generate structured files in the test when that keeps the committed fixture
smaller or makes its expected values easier to audit; `tests/published-boards/office-samples.mjs`
builds the Word, Excel, and PowerPoint packages, while the PDF test builds its PDF directly.
Never copy a sample from another checkout without checking for personal data and documenting its
source. Published-board tests must not contact the network; do not open a torrent fixture when the
board starts network discovery as part of opening it.

For full API, target, timeout, lifecycle, and report details, see
[`doc/standards/integration-tests.md`](../doc/standards/integration-tests.md).
