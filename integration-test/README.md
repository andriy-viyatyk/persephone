# Integration tests

This suite starts an isolated instance of Persephone and calls its MCP API. It requires the US-2022 `--profile-dir` implementation. The default `dev` target requires a live `npm start`; optional `--prod` and `--app <exe>` targets support a user-chosen draft-release post-check. Neither is a mandatory release step. The runner resets its own `integration-test/.profile` directory once the selected target passes preflight.

The isolated app uses profile identity `uitest`, fixed loopback ports (MCP 17865, video 17866, Mneme 17700 and Tor 19052), and a clean copy of `seed/`. The runner refuses occupied ports, a live `uitest` named pipe, unsafe profile paths, or a concurrent runner lock. It never connects to or stops the user's ordinary app. To delete test state manually, close the isolated app and remove `integration-test/.profile`; the next run recreates it from the seed. Do not run `npm run build-prod` while using the dev target; a production build can replace `.vite/build`, so restart `npm start` afterward.

Run the full suite or select by area/name:

```powershell
npm run test:ui
npm run test:ui -- --area core
npm run test:ui -- --area editors/grid
npm run test:ui -- --area core/smoke,editors/grid
npm run test:ui -- --list
npm run test:ui -- --list --area editors
npm run test:ui -- --test "open fixture"
npm run test:ui -- --area core/smoke --timeout-scale 1.5
npm run test:ui -- --keep-open
npm run test:ui -- --rerun-failed
npm run test:ui -- --prod
npm run test:ui -- --app "C:\release\win-unpacked\persephone.exe"
npm run test:ui -- --open
npm run test:ui -- --attach --area smoke
npm run test:ui -- --with network,mic
```

`--prod` and `--app <exe>` are mutually exclusive. The production target builds `.vite/build` once and reports `The dev bundle was replaced; run npm start again before dev tests.` after the build exits; it refuses while a live dev marker is present. Restart `npm start` before returning to dev tests. The executable target launches the supplied absolute path directly and requires a compatible installed or unpacked Persephone executable that includes US-2022 profile support; for example, use `release/win-unpacked/persephone.exe` from a Windows unpacked build. Paths with spaces are supported. Invalid options and executable paths fail before profile reset. Reports identify the selected target as `dev`, `prod`, or `exe`, and retain the absolute executable path in the selection.

Tests live at `tests/<area>/<module>/<feature>.test.mjs`; deeper module paths are allowed. The area/module id is the test path under `tests/` with its filename removed, such as `core/smoke` or `editors/grid/sort`. `--area` takes a comma-separated list of path prefixes on whole segments: `core` selects `core/smoke` and `core/settings`, but not `core-x`; `editors/grid` selects that module and its submodules. Unknown prefixes fail before profile reset and list known module ids. `--test` selects names containing the given substring. `--rerun-failed` selects current exact IDs from `reports/last-failed.json`; moved or removed IDs are reported as gone and ignored. `--with` opts into external requirements. Tests can declare `requires: ["network", "mic", "tor", "git", "mneme"]`; every listed tag must be supplied once in the comma-separated option or the selected test is reported as skipped. `launch` is built in for normal runs and must not be passed to `--with`. Reports separate passed, failed and skipped counts and include skip reasons. The generated profile is reset from the seed once per normal invocation, then fixtures are copied into `.profile/work/`. Tests should use `ctx.fixture(relativePath)` to get that isolated editable copy.

`--list` discovers tests and prints the area/module tree with test counts and counts skipped by requirements. It starts no app and takes no runner lock; use `--area` to narrow the listing. `--with` and `--attach` affect the skip counts. A module should stay under about 50 tests and about 3 minutes. Split larger modules into feature submodules, never into numbered chunks. Add a test to the module that owns its feature; create a new module folder if the feature has no suitable module. Add an area only with a new roadmap phase. Between modules a normal run stops the app, re-seeds the profile from `seed/` and `fixtures/`, and starts it again, so each module starts from the seeded profile (a plain restart would keep the previous module's session).

`--open` validates and resets the selected profile, starts the app, writes the retained-app record and exits without tests or report changes. It accepts the target options (`--prod`, `--app`) and `--timeout-scale`; close it with `npm run test:ui:call -- --close`. `--attach` requires a valid live `reports/keep-open.json` created by `--open`, connects to that app without resetting or restarting it, refreshes fixture copies while preserving other work files, and writes reports with target `attach`. It accepts selection, `--with` and timeout options, but no target override or `--keep-open`. Both modes hold the runner lock. The fixture HTTP server exists only during test runs, not while an app is retained.

The runner starts an in-process loopback fixture service at `http://127.0.0.1:17867` during normal and attach test runs. `ctx.httpUrl("/sample.txt")` builds a confined local URL and preserves its query string. Static files under `fixtures/http/` support GET and HEAD, return `text/plain; charset=utf-8`, 404 when absent, and 405 for other methods. Dynamic routes are `/echo` (any method; JSON with method, URL, headers and UTF-8 body; 413 above 1 MiB), `/delay?ms=N` (GET/HEAD, text `delayed` after 0–5000 ms), `/status?code=N` (GET/HEAD, status 200–599), and `/redirect?to=%2Fpath&status=302` (GET/HEAD, local redirect using 301, 302, 303, 307 or 308). Invalid route values and paths return 400; unsupported methods return 405. The listener binds only to 127.0.0.1 and closes with the runner.

Each test module default-exports one descriptor or an array. The `test` helper returns `{ name, run }`:

```js
import { test } from "../../lib/context.mjs";

export default test("example", async (ctx) => {
    const structured = await ctx.call("pages.count");
    const text = await ctx.callText("page.content");
    ctx.expect(structured).toBeTruthy();
    ctx.expect(text).toContain("example");
});
```

Use `ctx.call(path?, args?, { maxLength, dialog } = {})` for structured values: it parses the primary text as JSON when possible and otherwise returns a string. JSON-looking string values are ambiguous in the MCP wire format. Use `ctx.callText(...)` for content and other text whose spelling must be preserved. Calls request `hints: "never"`; malformed replies, errors, pending work, unexpected attention and truncation fail with the raw response retained. Truncation fails unless that call explicitly supplies `maxLength`; with it, the delivered body is returned and the truncation marker remains in diagnostics. The opt-in `{ dialog: true }` accepts the app's dialog-pending response as `{ pending: true }` and strips at most one attention block from a normal response while a dialog is open. It still rejects script pending, MCP and body errors, unexpected content and truncation without `maxLength`.

The context also provides `ctx.waitFor(pathOrFunction, predicate, { timeout })`, `ctx.expect(value)` with `toBe`, `toEqual`, `toContain`, and `toBeTruthy`, `ctx.script(code)`, `ctx.restartApp()`, and `ctx.launchSecondInstance(args = [])`. Tests using either launch helper declare `requires: ["launch"]`; second-instance tests use `ctx.fixture(...)` for existing file arguments and poll the primary app with `ctx.waitFor`. Wait timeouts are in milliseconds and scale with `--timeout-scale`. `ctx.script` reports completed text and fails on script errors or pending runs; dialogs are not handled unattended.

Put steps shared by areas in `tests/helpers/`; put steps shared within one area in `tests/<area>/helpers.mjs` and promote them only when another area uses them. Tests should not import another area's helpers. Attach tests share no state: each test closes the pages it opens, and files it creates go under a per-test folder returned by `ctx.fixture(...)`.

Reports are written to `integration-test/reports/latest.json`, `latest.md`, and `last-failed.json`. Failure capture also saves a screenshot when possible, or records why capture failed. `--keep-open` leaves a healthy test instance open only after a failure. It records the owned PID and profile under `reports/keep-open.json`; close it with `npm run test:ui:call -- --close` before a normal rerun. Attach runs reuse the retained instance without resetting it. The call CLI uses the isolated test MCP endpoint, accepts an optional JSON argument array, and supports `--text`, `--dialog`, and `--max-length N`. For example, `npm run test:ui:call -- pages.count`, `npm run test:ui:call -- page.content --text`, or `npm run test:ui:call -- window.screen.screenshot` saves a PNG/JPEG under `reports/screenshots/`. See [the developer standard](../doc/standards/integration-tests.md) for the full workflow and API contract. A clean passing run otherwise closes its owned app. The runner never sends process-name kills.
