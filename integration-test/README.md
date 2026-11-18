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

`--area` accepts comma-separated whole-segment prefixes: `core` includes `core/smoke` but not
`core-x`. `--test` selects a substring of the descriptor name. `--list` prints the area/module
tree without launching an app. `--rerun-failed` uses exact file/name identities from
`reports/last-failed.json` and reports removed identities as gone. Suite requirement tags are
`network`, `mic`, `tor`, `git`, and `mneme`; each missing tag skips its test with a reason. The
built-in `launch` requirement works on owned runs and is skipped by the product host under
`--attach`. The Tor network test also requires `PERSEPHONE_TEST_TOR_EXE` to name a compatible
`tor.exe` and both `network` and `tor` tags.

Attach uses the selected `reports/keep-open.json` record and PID, refreshes fixtures over the
existing work directory, and never resets or stops the app. The product controller connects using
the profile directory's MCP settings and verifies `main.runtime.paths.userData` before accepting
the connection. Attach does not capture test-mode app logs from the already running app.

## Wrapper and product artifacts

Every selected module gets a versioned exact `{ file, name }` selection manifest. The wrapper runs
one product invocation for each runnable module and passes the suite setup module plus `--with`
and `--timeout-scale`. It passes `--keep-open` only to the last runnable module. Product options
are documented in the [web-app test guide](../assets/guides/agents/web-app-tests.md); the suite
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

Product context members include `app`, `openBrowser`, `handle`, `call`, `callText`, `waitFor`,
`expect`, `script`, `restartApp`, `launchSecondInstance`, `file`, and `log`. The suite setup adds
`fixture(relativePath)` constrained to `.profile/work`, `httpUrl(path)` and `httpsUrl(path)`
constrained to the local HTTP and HTTPS fixture servers, and `_getClient()` with raw MCP `call` and
`listTools()` access. Path calls
support `{ dialog: true }`; the app stand-in is available for future object-style suite rewrites.
The product host closes pages and pop-ups opened during a test after that test finishes.

Browser tests live under `tests/browser/automation/{input,observe}/`, `page-models/`,
`site-extensions/` (saved and moved temporary-extension tests), `popups/` (moved from the old
`tests/editors/browser/` location), `page-tools/`, and `tor/`. Their local pages and assets are under
`fixtures/http/browser/<module>/`.

For full API, target, timeout, lifecycle, and report details, see
[`doc/standards/integration-tests.md`](../doc/standards/integration-tests.md).
