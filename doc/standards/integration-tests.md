# UI integration tests

## Ownership and layout

The product runner in `src/main/test-mode/` and `src/test-host/` owns generic test execution,
context APIs, exact selection manifests, requirements, timeout scaling, page cleanup, screenshots,
and per-invocation reports. `integration-test/run.mjs` is the suite wrapper: it owns test discovery,
area and name filters, suite requirement tags, seed/profile lifecycle, HTTP fixtures, target choice,
the optional `--baseline` comparison, and the aggregate suite report.

Suite tests stay at `integration-test/tests/<area>/<module>/<feature>.test.mjs`. Their imported
`test()` factory remains in `integration-test/lib/context.mjs`. The suite setup module
`integration-test/test-setup.mjs` adds `fixture(relativePath)`, `httpUrl(path)`, and `_getClient()`;
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

The wrapper starts the read-only HTTP fixture server once on loopback port 17867. For every
selected module id, a normal run replaces `.profile` from `seed/`, recopies fixtures into
`.profile/work`, writes an exact file/name manifest, and invokes the product runner. Nested module
ids receive separate app instances too. The manifest limits that invocation to its exact tests;
it does not bypass `requires`. The product host checks requirements for every run: `launch` is
skipped with `--attach`, and other tags run only when supplied by `--with`.

Attach requires the wrapper's live retained-app record and a running named-profile pipe. It does
not reset or restart the app. Fixture files are refreshed over the existing work directory. The
product controller reads MCP settings from `--profile-dir`, connects, then verifies that
`main.runtime.paths.userData` resolves to that same directory before it accepts the connection.
The selected app is never stopped by attach.

`--area` selects whole-segment path prefixes and `--test` selects a substring of the descriptor
name. `--list` prints the filtered suite without starting the app. `--rerun-failed` selects current
file/name identities from the wrapper's `reports/last-failed.json` and reports removed identities
as gone. `--with` accepts the suite's external tags (`network`, `mic`, `tor`, `git`, `mneme`); it
does not accept the built-in `launch` tag.

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

With `--attach --profile-dir <path>`, the controller reads that directory's MCP settings and
checks the connected app's user-data identity. The suite wrapper passes these product options as
separate process arguments. It sends `--keep-open` only to the last runnable module when requested.
The second-instance and dev-server probe deadlines remain wrapper-owned and are scaled there too.

The product context handles per-test page and pop-up cleanup. It supports `app`, `openBrowser`,
`handle`, path `call`/`callText` (including `{ dialog: true }`), `waitFor`, `expect`, `script`,
`restartApp`, `launchSecondInstance`, `file`, and `log`. The suite setup module supplies the
suite-only fixture helpers. The setup hook receives the current context, `{ file, name,
profileDirectory, attach }`, and a getter for the current MCP client adapter, so an app restart
uses the replacement connection.

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

The `app` tree is a stand-in for call paths, not a live object model: each property read or method
call makes a round trip and must be awaited. A stand-in used as an awaitable resolves its call
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

Tests must run independently and should leave committed fixtures unchanged. Use `ctx.fixture()`
for mutable work copies and reset their content at the start of each test. Tests that restart the
app or launch another process declare `requires: ["launch"]`. Use `ctx.httpUrl()` for local
HTTP-fixture paths. Do not weaken assertions to make a test pass; repair the owning application
behavior instead. Keep modules focused and split by feature when needed.
