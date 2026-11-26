---
title: "Run and configure web-app tests"
audience: "agent"
summary: "Choose a test command, configure runner options, and understand output locations and exit codes."
---

# Run and configure tests

Return to [Web-app regression tests](./index.md) for the test context and core browser features.

In an installed app on Windows, run `persephone-test.exe` from beside the installed
`persephone.exe`. The console wrapper finds that sibling executable, adds `--test`, forwards the
arguments, waits, streams output, and returns the app's exit code:

```powershell
persephone-test.exe .\web-tests --profile qa --log-dir .\web-test-logs
```

`persephone.exe --test <file-or-folder>` starts the same test controller directly. `persephone.exe`
is a GUI-subsystem program, so its console output is not shown by a normal shell invocation; use
`persephone-test.exe` when you need visible console output and a waited exit code.

For a developer checkout, run the app entry point and pass the test options:

```powershell
electron . --test .\web-tests --profile qa --log-dir .\web-test-logs
```

The package entry point loads `.vite/build/main.js`. Passing that file directly makes Electron use
the app name `Electron`, so `--attach` looks for the wrong settings folder. Use `electron .` from
the checkout.

## Initialize a starter suite

Create a generic offline suite with `persephone-test.exe --init <folder>` or
`persephone-test.exe --init=<folder>`. Init writes into an absent or empty folder; if the folder
contains entries, it lists conflicts on stderr, writes nothing, and exits 1. In a developer checkout,
run `electron . --test --init .\web-test-starter` from the repository root. Init exits without
starting the test host or a window.

Options:
- `--test <file|folder>` runs one `.test.mjs` file or recursively discovers files in a folder.
- `--profile <name>` selects the Persephone app profile. It does not select a browser profile.
- `--attach` connects to an already running profile instead of launching an owned app. MCP must be enabled in that profile.
- `--window <index-or-title>` selects an existing open test window and requires `--attach`. Decimal values are window record indexes; other values are case-insensitive title substrings and must match exactly one open window. If several windows match, use a decimal index or a more specific title.
- `--window name:<name>` selects one live normal window by its exact case-insensitive name. `--window-name <name>` creates a named normal window or reuses its live match; it requires `--attach` and cannot be combined with `--window`. Names use 1–64 ASCII letters, digits, spaces, dots, underscores, or hyphens. A restored but closed name is reserved until that window is opened or its name is cleared.
- `--log <file>` writes only the test-step JSONL log at that file; it does not create reports or screenshots.
- `--log-dir <folder>` writes test results and test-mode app logs into that folder.
- `--rerun-failed` reruns only file/name identities in `last-failed.json` from the selected results folder.
- `--test-setup <module>` loads a user module that adds suite-specific members to each test context.
- `--test-selection <json-file>` restricts `--test` discovery to exact file/name identities in a versioned manifest; requirements are still checked.
- `--with <tag,...>` enables the named `requires` tags; `launch` remains skipped under `--attach`.
- `--grep <regex>` runs tests whose names match the case-sensitive JavaScript regular expression.
- `--reporter json-lines` writes versioned run-event JSON lines to stdout and routes console output to stderr. Suite calls to `process.stdout.write()` bypass this redirect and can pollute the JSON stream.

After window selection, human output identifies it as `Test window: [7] "app-tests" (windowId 12)`. The JSON Lines `run-start` event includes `testWindow: { index, windowId, name? }` when selection succeeds; a setup failure emits the fallback `run-start` without that field before synthetic test events.
- `--summary-only` suppresses the final per-test detail block in human output while keeping totals, setup and environment errors, stale identities, result paths, and retained-app notices. Summary lines include a redacted single-line failing step, capped at 120 characters. It does not suppress `ctx.log`, child-process output, or critical errors, and cannot be combined with `--reporter json-lines`.
- `--retries <n>` retries failed tests up to `n` additional attempts; the default is `0`.
- `--timeout-scale <number>` scales the runner's timeouts; the default is `1`.
- `--test-timeout <ms>` sets the default per-attempt test timeout; the default is `300000` ms.
- `--keep-open` leaves an owned app running after a failed run and prints its PID and MCP URL in `report.json`.
- `--mcp-port <port>` requests the MCP port for an owned app; the runner refuses the port if it is occupied.
- `--desktop <number|name>` (Windows only) places owned-run windows on an existing numbered or exactly named virtual desktop; Linux workspace placement is unavailable. See [unattended runs](./unattended-runs.md) for selection rules and limits.
- `--attach --profile-dir <path>` attaches using MCP settings in that directory and verifies the connected app's user-data directory before running tests.

Use `{ requires: ["desktop"] }` for tests that need the real desktop; see [unattended runs](./unattended-runs.md) for skip behavior and reasons.

`ctx.waitFor` stops on read errors by default. Set `retryErrors: true` in its options to retry read errors until a match or timeout; predicate errors, environment stops, and lifetime cancellation still escape immediately. A timeout reports the last read error when the final poll failed to read a value.

Without `--log` or `--log-dir`, output goes to `test-results/` next to a test file, or inside the
folder passed to `--test`; that default folder is replaced each run. A run continues through test
failures and exits `0` when there are no failed tests, unexpected passes, or runner setup failures;
otherwise it exits `1`. Expected failures and flaky tests do not change the exit code.

Browser tests can capture a page download with `site.waitForDownload()`. Start the returned promise
before clicking the export control, then await it; the runner copies files up to 32 MiB into the
run's `downloads/` folder and links them from `report.md`, `report.json`, and failure bundles. This
test power requires a page opened by the agent or adopted through `ctx.usePage()`. Captures do not
appear in the app's normal download list or recent-download history, including for an
agent-opened incognito page. The API wait defaults to 10 seconds; longer waits also need a longer
outer MCP call timeout. A separate-request dispatch race remains: if the click arrives before the
wait is armed, the download uses the ordinary route and the wait times out.

The repository's `npm run test:ui` wrapper keeps suite filters, fixture setup, profile resets, and
baseline comparison outside the product host. It starts one product invocation per module and
stores that invocation's reports and logs under `integration-test/reports/runs/<run-id>/<module-id>/`.
The wrapper aggregates them into `integration-test/reports/latest.md`, `latest.json`,
`last-failed.json`, and `screenshots/`. A direct product run uses the output location selected by
`--log` or `--log-dir` and does not create those suite-level reports. With `--attach --profile-dir`,
the controller reads the selected profile's MCP settings, then checks the connected app's
`main.runtime.paths.userData` before running tests.

