---
name: ui-tests
description: Use when asked to run the UI tests, work on UI integration tests or test:ui, or add a UI test.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# UI integration tests

Use for “run the UI tests” or “add a test for X”. The test instance is separate from the user's app. Do not use the ordinary Persephone MCP connection for it. See `doc/standards/integration-tests.md` for the complete contract.

Run the suite when the user asks; the US-2026 prod target is an optional draft-release post-check, never a mandatory release step.

The runner also supports `--open` to reset/start the selected target and leave it reachable through `reports/keep-open.json`, and `--attach` to run selections against that retained app without resetting or restarting it. Attach refreshes fixture copies, preserves other work files and reports target `attach`; the HTTP and HTTPS fixtures on `127.0.0.1:17867` and `:17868` run only during suite runs. The HTTPS server uses the committed test-only certificate from `integration-test/lib/tls/`; normal owned module runs trust only its exact SHA-256 fingerprint. `--open` does not start the fixture servers or install that trust, while `--attach` uses an app whose trust settings cannot be changed by the suite. Tests needing HTTPS fixtures therefore need a normal owned run. The HTTP fixtures include `/refused` (redirects to an unused loopback port) and `/boards-catalog/` (fake catalog, versions, screenshots, and generated ZIP archives). Owned module runs pass `PERSEPHONE_TEST_BOARDS_CATALOG_URL` to the test instance; it is honored only by test instances for `http://127.0.0.1` URLs. The suite seed sets `link-open-behavior` to `internal-browser` so URL actions stay inside the app. `--with network,mic` opts into external requirements (`network`, `mic`, `tor`, `git`, `mneme`); the tagged Tor network test also needs `PERSEPHONE_TEST_TOR_EXE` pointing to a compatible `tor.exe`. `launch` is built in for normal runs and is skipped under attach. The wrapper enables `published-board-checkout` when `../persephone-boards/boards` exists or `PERSEPHONE_BOARDS_DIR` points to a boards folder; otherwise matching tests skip with the missing path and override hint. The wrapper rejects `--with published-board-checkout`. Reports show passed, failed and skipped separately with skip reasons. Read `doc/standards/integration-tests.md` for route contracts and option compatibility.

## Run and fix

1. For the default dev target, ensure `npm start` is running. Check `.vite/dev-server.json`; if absent, start `npm start` in the background. A marker can be stale: if the runner cannot validate its PID, server, or exact dev bundle URL, restart `npm start`. For the optional production target, stop `npm start` first; it rebuilds `.vite/build` and prints `The dev bundle was replaced; run npm start again before dev tests.` after the build exits. Restart `npm start` before dev tests. `--prod` and `--app <exe>` are mutually exclusive. The executable target needs a compatible installed or unpacked `persephone.exe` with US-2022 profile support.
2. Run `npm run test:ui -- --keep-open` (add `--area core/smoke` when requested), or add `--prod` or `--app "C:\path with spaces\persephone.exe"` for an explicitly requested optional target. A green run closes automatically. On failure read only failing sections of `integration-test/reports/latest.md`; do not read passing results or screenshots unless needed. Handle preflight/startup failures from command output. Reports identify `dev`, `prod`, or `exe`; exe reports also include the absolute path in selection.
3. Reproduce each failure in the kept-open instance with `npm run test:ui:call -- <path> '[args]'`; use `--text` for text, `--dialog` for the pilot's modal exchange, and `--max-length N` only when needed. For screenshots call `window.screen.screenshot` and inspect the saved file only when needed. Methods with no arguments use `[]`; omit args for property reads. A failed run may have restarted between modules or after a crash, so reproduce setup from the failing test as needed.
4. Decide whether the application or test is wrong; fix the owning source, not the assertion merely to make it pass. Renderer changes hot-reload; main-process changes require a fresh test instance. Fix unreachable UI in the call tree, not with a test workaround.
5. Close the kept-open instance with `npm run test:ui:call -- --close` before each rerun: the runner refuses occupied ports and resets the profile on each invocation. Run `npm run test:ui -- --rerun-failed --keep-open`; repeat from failures until green. `--rerun-failed` selects only the previous report's exact failed IDs; a green subset is not a full-suite run. Run the full requested selection again after targeted fixes. On completion or interruption close any still-open test instance with `--close`; do not kill the user's app.

## Add a test

The suite setup exposes `ctx.httpUrl(path)` and `ctx.httpsUrl(path)` for fixture files under
`integration-test/fixtures/http/`. Browser tests are grouped under
`browser/automation/{input,observe}/`, `browser/page-models/`, `browser/site-extensions/`,
`browser/popups/`, `browser/page-tools/`, and `browser/tor/`; the popup and temporary site-extension
tests moved from the former `editors/browser/` area. The HTTPS server runs on port 17868 with the
committed test-only certificate under `integration-test/lib/tls/`. Only normal owned module runs
trust its exact SHA-256 fingerprint; `--open` and `--attach` do not. The test seed sets
`link-open-behavior` to `internal-browser`. The Tor network test is tagged for `network` and `tor`
and needs `PERSEPHONE_TEST_TOR_EXE` to point to a compatible `tor.exe`.

The `boards` area is organized under
`tests/boards/{lifecycle,permissions,info,bridge,extensions,catalog,published,excalidraw,rest-client}/`.
Put area-only shared setup and trust helpers in `tests/boards/helpers.mjs`; the cross-area
published-board registration helper is `tests/helpers/published-boards.mjs`. Board fixtures live in
`fixtures/boards/<module>/`, catalog ZIP sources in `fixtures/boards-catalog/`, and REST Client HTTP
fixtures in `fixtures/http/rest-client/`. Tests receive isolated copies under the profile's `work/`
directory through `ctx.fixture()`; reset any mutable fixture file at test start. Prefer
`ctx.app.boards.*` and `ctx.app.pages[id].editor.*` calls, using `ctx.call` or `ctx.callText` where
call options or exact string results are required.

Put `<feature>.test.mjs` in `integration-test/tests/<area>/<module>/`; deeper module paths are allowed. The area/module id is the test path under `tests/` without its filename, for example `core/smoke` or `editors/grid/sort`. Default-export `test(name, async ctx => { ... })` or an array, importing `test` from `lib/context.mjs` with the correct relative path. `--area` accepts comma-separated whole-segment path prefixes; an unknown prefix fails before profile reset and prints known module ids. Use `node integration-test/run.mjs --list` to inspect the module tree and test/skipped counts; it starts no app and takes no lock. `--list --area <prefix>` narrows it; `--with` and `--attach` affect skipped counts. A module should stay under about 50 tests and 3 minutes; split larger modules into feature submodules, never numbered chunks. Append a test to the module that owns its feature; create a new module folder when no owner exists, and add an area only with a new roadmap phase. Put UTF-8, no-BOM, LF fixtures with final newline in `integration-test/fixtures/`; `ctx.fixture(rel)` names the isolated work copy. Reset each mutable fixture at test start via `ctx.call('fs.write', [ctx.fixture(rel), content])`; save changed pages and close them with `pages.closePage` so each test is independently selectable. Tests share no state, each test closes the pages it opens, and files it creates go under a per-test folder in `ctx.fixture`, particularly for attach runs. Cross-area helpers live in `tests/helpers/`; area-only shared steps live in `tests/<area>/helpers.mjs` and move to the shared folder only after another area uses them. Declare external tags with `test(name, run, { requires: [...] })`; declare `requires: ["launch"]` when using `ctx.restartApp()` or `ctx.launchSecondInstance(args = [])`. Use `ctx.httpUrl("/route?query=value")` for the loopback HTTP fixture service. Use `ctx.callText` for exact text and `ctx.call` for structured values, `ctx.expect` for assertions, and `ctx.waitFor(pathOrFn, predicate, { timeout })` for asynchronous state. Tests never insert fixed sleeps; `waitFor` polls and retries false predicates, not call errors. Follow the landed pilot for dialog handling. Run the affected area and full suite; inspect only failures.
