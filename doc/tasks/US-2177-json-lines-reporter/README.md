# US-2177: `--reporter json-lines` on stdout

## Goal

Add an opt-in `--reporter json-lines` (and `--reporter=json-lines`) for `persephone-test` that emits a versioned JSON object per line on stdout for run progress. Preserve the default human reporter and the existing `report.json` format.

## Background

This is H5 in [EPIC-209](../../epics/EPIC-209.md), proposal [H5 in the web-app testing review](../../reviews/web-app-testing-review.md#h-playwright-familiarity-guides-and-scaffolding). The epic decision assigns the reporter to a focused collaborator under `src/test-host/`, fed from the runner's existing event flow. No `window.persephone` API changes are part of this task.

`src/main/test-mode/arguments.ts` currently parses test-run options into `TestControllerArguments`, recognizes test mode through `hasTestControllerArguments`, and rejects unrecognized options. It has no reporter setting. `src/main/test-mode/controller.ts` serializes parsed configuration into the test-host utility process and pipes host stdout/stderr back to the app process at lines 59–60. `src/test-host/index.ts` runs the host and flushes both streams before exiting. `launcher/src/test_main.rs` starts sibling `persephone.exe` with `.status()`, which inherits the wrapper's stdout, stderr, and waits for its exit status.

`src/test-host/TestLog` writes redacted JSONL events synchronously to `tests.log`. Existing events include `test-start`, `test-outcome`, `hook-result`, and `run-summary`. `src/test-host/runner.ts` currently writes the human summary and per-result details using `console.log`/`console.error`; `src/test-host/context-operations.ts` writes `ctx.log()` messages with `console.log`. Those host lines therefore use stdout for `console.log` and stderr for `console.error`. In owned-app runs, `src/test-host/launcher.ts` separately pipes the app child's stdout to host stdout and its stderr to host stderr, while also recording both streams in `app-main.log`. In `--attach` mode `TestLauncher.start()` connects to MCP and does not spawn that app child, so this child-output forwarding path is absent. The launcher does pass the runner streams through in either mode.

The test host imports each `.test.mjs` module inside its own process. To keep JSON stdout clean from runner messages and test debugging calls, `src/test-host/json-lines-reporter.ts` owns a host-wide console redirect: install a `node:console` `Console` with both `stdout` and `stderr` set to `process.stderr`, replacing the host's global `console` in JSON Lines mode before discovery imports any test module. This routes `console.log`, `info`, `debug`, `warn`, `table`, `dir`, and the other console methods to stderr; `runner.ts` and `context-operations.ts` need no per-call-site stream changes. The reporter writes event lines directly with `process.stdout.write`.

There are two main-process cases. The top-level `--test` invocation takes the `startTestController` branch in `src/main.ts:36–39`; it does not call `setupMainProcess()` at `src/main.ts:30`, so normal app service logs are not active in that controller process. Its own test-controller diagnostics in `src/main/test-mode/controller.ts:63,66` use `console.error`. In JSON Lines mode, that controller owns redirecting its process-wide `console` to stderr before it starts the host; the host's JSON bytes still pass through the explicit `process.stdout.write` at `controller.ts:59`. `src/main/stdio-guard.ts:5–13` only installs error handlers that drop `EPIPE` and `ERR_STREAM_DESTROYED`; it does not route output between streams.

The owned app that the host launches is a separate child process with `--test-instance`, and it does run normal main setup. Its stdout can contain `src/main/main-setup.ts:38` (Widevine ready), `src/main/mcp-http-server.ts:179,203` (server start/stop), and conditional service/navigation diagnostics such as `src/main/open-window.ts:236`, `src/main/clipboard-service.ts:116`, `src/main/mneme-service.ts:51`, and `src/main/tor-service.ts:467`. `src/main/test-mode/TestModeLog.ts:34–117` writes its app/site/network records to files with `fs.writeSync`, not console output. `TestLauncher` captures this child's stdout/stderr separately. In JSON Lines mode, route its stdout bytes to host stderr while retaining `stream: "stdout"` in `app-main.log`; leave stderr on stderr. In `--attach`, the already-running app is not spawned or piped by `TestLauncher`, so its output cannot interleave with the test controller's stdout. Default mode keeps current destinations and wording. Arbitrary test code that directly calls `process.stdout.write()` remains outside the guarantee and must be identified as such in the guide entry.

`src/test-host/results.ts` owns report serialization. It writes `report.json` with `runAt`, `target`, a `summary` object, optional environment/setup/retained-app details, stale identities, and result records. Keep this payload unchanged. `src/test-host/test-file-run.ts:39,74` writes `test-start` with `file` and `test`; `test-file-run.ts:30,79,98,118` writes `test-outcome` with `file`, `test`, `status`, `durationMs`, and optional `reason`, `error`, `step`, `cleanupErrors`, and `attempts`. `src/test-host/file-hooks.ts:43–44` writes `hook-result` with `file`, `test`, optional `attempt`, `hook`, `durationMs`, `ok`, and, on failure, `error` and optional `step`; `test-file-run.ts:167` also writes this shape for file cleanup failure. `src/test-host/test-result.ts` builds the terminal test status and attempts. The JSONL stream should consume these existing events rather than create a second test execution path. Counts for the start event are determined only after discovery and current selection filters; end totals use the same status counts as the existing summary.

`TestLog` is created in `src/test-host/runner.ts:73–74` for both report-directory runs and `--log` runs. When neither option is supplied, `runner.ts` resolves the default `test-results` directory and still creates `tests.log`; there is no normal run with no `TestLog`. Pass the reporter's event callback into `TestLog` at those creation sites; invoke it with the same redacted event object that `TestLog.write()` persists. The existing `run-start` file-log record is written before discovery, so its timing cannot supply the external start event's counts. Keep file-log event ordering intact; emit external `run-start` after discovery and filtering, before any `test-start`. `src/test-host/source-location.ts` already owns `displayPath(cwd, file)` and should be reused for event file paths.

`integration-test/run.mjs` launches one product invocation per selected module and reads the product's `report.json` to collect results and detect retained-app/environment-stop data. It does not parse or match product console text. The `persephone-test` launcher inherits the app streams, so the JSON stream will reach its stdout caller.

The run-options guide is [assets/guides/agents/web-app-tests/run-options.md](../../../assets/guides/agents/web-app-tests/run-options.md). Add a short option entry there; full guide changes belong to US-2179.

## Implementation Plan

- [x] Add `reporter: "human" | "json-lines"` to `TestControllerArguments` in `src/main/test-mode/arguments.ts`. Parse both `--reporter json-lines` and `--reporter=json-lines`, reject duplicates, missing values, and unsupported values, and default to `human`. Keep `--reporter` recognized as a test-mode option. Forward the setting through `src/main/test-mode/controller.ts` into `HostConfiguration` in `src/test-host/launcher.ts`.
- [x] Add `src/test-host/json-lines-reporter.ts`. This module owns JSONL stdout serialization, the versioned external event schema below, and host-wide console redirection. In JSON Lines mode, install a `node:console` `Console({ stdout: process.stderr, stderr: process.stderr })` as the host global console at the beginning of `src/test-host/index.ts`, before `run()` can discover/import test files. Have the reporter serialize each event and make one `process.stdout.write` call with the JSON text and a trailing newline. Reuse the redacted event objects emitted by `TestLog` and final results/totals already built by `runner.ts` and `results.ts`; do not change `report.json` or duplicate test execution. Preserve default mode console behavior.
- [x] In `src/main/test-mode/controller.ts`, when `options.reporter === "json-lines"`, redirect that controller process's global console to stderr before async startup work. Continue forwarding test-host stdout to `process.stdout` unchanged so JSON reaches the caller. Forward the reporter setting in the existing utility-process configuration. The separately launched owned app's stdout is handled by `src/test-host/launcher.ts` below.
- [x] Connect the reporter to `TestLog` in `src/test-host/runner.ts` alongside its creation at lines 73–74, so it receives the existing redacted events for report-directory, `--log`, and default `test-results` runs. Read the verified shapes: `test-start` (`file`, `test`) and `test-outcome` (`file`, `test`, `status`, `durationMs`, optional `reason`, `error`, `step`, `cleanupErrors`, `attempts`) are written in `src/test-host/test-file-run.ts:30,39,74,79,98,118`; `hook-result` (`file`, `test`, optional `attempt`, `hook`, `durationMs`, `ok`, optional `error`, `step`) is written by `src/test-host/file-hooks.ts:43–44`, with file-cleanup failure at `test-file-run.ts:167`. Emit one `test-start` and one `test-end` for every selected descriptor, including skipped and not-run descriptors; forward failed hook results as `hook-failure`. Cover retries using final result attempts. Keep `tests.log` events available in both modes.
- [x] Emit `run-start` only after discovery and filters establish counts; emit `run-end` after report writing and final totals are known. For `--log` (which does not write reports), use `reportDirectory: null`. If discovery/setup fails before counts are available, emit a start with the known counts (zero when not yet known) and an end with the setup failure represented in totals/error summary. Ensure the run-end event is emitted on all runner completion paths.
- [x] In owned-app mode, update `src/test-host/launcher.ts` so app stdout goes to host stderr for the terminal while the `app-main.log` record retains `stream: "stdout"`; leave app stderr on stderr. Attached mode has no child app stream to reroute. Keep `launcher/src/test_main.rs` stream passthrough/inheritance intact.
- [x] Add a short `--reporter json-lines` option entry to `assets/guides/agents/web-app-tests/run-options.md`, noting stdout contains versioned event JSON lines, all console output goes to stderr, and direct suite `process.stdout.write()` bypasses the redirect and can pollute the stream. Do not rewrite the guide.
- [ ] Before → after command example:

  ```text
  Before: persephone-test.exe .\web-tests --profile mock
          (human summary on stdout; optional JSONL in tests.log)
  After:  persephone-test.exe .\web-tests --profile mock --reporter json-lines
          stdout: {"version":1,"event":"run-start",...}\n{"version":1,"event":"test-start",...}\n...
          stderr: all host console output and owned-app stdout
  ```

- [ ] Before → after configuration shape:

  ```ts
  // Before
  export interface TestControllerArguments {
      // ...
      grep?: string;
      window?: string;
  }

  // After
  export interface TestControllerArguments {
      // ...
      grep?: string;
      reporter: "human" | "json-lines"; // defaults to "human"
      window?: string;
  }
  ```

### JSON Lines schema, version 1

Each output line is one UTF-8 JSON object. Every event has numeric `version: 1` and string `event`. Optional properties are omitted unless stated nullable. Paths use the existing `displayPath(cwd, absolutePath)` convention: relative to the run working directory when inside it, otherwise absolute. Error summaries are redacted with the existing `TestLog.redactor`, reduced to the first non-empty line, and represented as `null` when there is no error.

Ordering is part of the contract: `run-start` is the first JSON event and precedes every `test-start`; `run-end` is the last JSON line. Each event is serialized and written in one `process.stdout.write` call with a trailing `\n`, so concurrent console output cannot split or interleave an event line.

| `event` | Required fields and types | Meaning |
|---|---|---|
| `run-start` | `version: 1`; `event: "run-start"`; `startedAt: string` (ISO-8601); `fileCount: number` (integer); `testCount: number` (integer) | `fileCount` is the number of discovered `.test.mjs` files. `testCount` is the number of descriptors remaining after manifest, grep, rerun and `test.only` selection; it includes descriptors later skipped by mode, requirements, or attach restrictions. |
| `test-start` | `version: 1`; `event: "test-start"`; `file: string`; `test: string` | A selected descriptor is about to run or be classified as skipped/not-run. |
| `test-end` | `version: 1`; `event: "test-end"`; `file: string`; `test: string`; `status: "passed" | "failed" | "skipped" | "expected-failure" | "unexpected-pass" | "flaky" | "not-run"`; `durationMs: number` (finite, non-negative); `errorSummary: string | null`; `retryCount: number` (integer, additional attempts after the first) | Final result for one descriptor, including skipped and not-run outcomes. `retryCount` is zero when no retry occurred. |
| `hook-failure` | `version: 1`; `event: "hook-failure"`; `file: string`; `test: string`; `hook: "beforeAll" | "beforeEach" | "afterEach" | "afterAll" | "file cleanup"`; `durationMs: number` (finite, non-negative); `errorSummary: string` | Failure from a file or per-test lifecycle hook/cleanup. Include `attempt: number` (positive integer) for per-test hooks; omit it for file-level hooks. |
| `run-end` | `version: 1`; `event: "run-end"`; `startedAt: string` (ISO-8601); `finishedAt: string` (ISO-8601); `durationMs: number` (finite, non-negative); `passed: number`; `failed: number`; `skipped: number`; `expectedFailure: number`; `unexpectedPass: number`; `flaky: number`; `notRun: number`; `reportDirectory: string | null`; `errorSummary: string | null` | Final totals use the same status accounting as the existing run summary, including setup failure in `failed`. `reportDirectory` is the absolute selected reports directory, or `null` when `--log` disables reports. `errorSummary` reports a runner setup failure or environment stop, otherwise `null`. |

`hook-failure` is emitted from the existing `hook-result` events when `ok` is false. Hook failures remain represented in result records/totals according to existing runner behavior; the event adds live detail and does not alter status semantics. The stream must not include arguments or secrets from test steps.

## Concerns

- A JSONL consumer relies on stdout containing only these event objects. The test host redirects every `console` method before importing suites; the test-mode controller redirects its own `console`; and the owned app child's stdout is sent to host stderr. The existing default reporter keeps its output behavior. `launcher/src/test_main.rs` uses `Command::status()` and inherits both streams. `--attach` skips the app child process and does not pipe the existing app's output into the test controller.
- Direct `process.stdout.write()` calls made by arbitrary test code bypass the console redirect and remain outside the stdout guarantee. The `run-options.md` entry must tell suite authors to avoid such writes in JSON Lines mode.
- No open schema decisions remain: version is numeric `1`; paths are display paths for test/file fields; only test descriptors after filters are counted; report folder is nullable; hooks have their own event; setup failure contributes to `failed` and `errorSummary`.
- No new cross-process message or protocol is needed. The reporter setting is serialized in the existing test-host configuration. No `window.persephone` behavior changes, so `BOARD_BRIDGE_VERSION` stays at 1.62.0 and needs no history entry. `src/test-host/` is outside the strict-null-check folder list; any null-check-only work in a strict folder must remain type-only and must not alter runtime conditions.
- Keep `src/test-host/runner.ts` focused by putting serialization/schema ownership in `json-lines-reporter.ts`; do not grow roadmap §2.3 god files. Reuse `TestLog` redaction/event emission and existing `TestResult` status/attempt data. Do not add protocol code, `await import()`, or an import-zone wrapper.
- Ownership and helper reuse: `arguments.ts` owns CLI parsing and reuses its existing duplicate/value validation pattern; `test-log.ts` continues to own persisted event creation and reuses `StorageStateRedactor`; `json-lines-reporter.ts` owns the external schema/serialization and host console redirect and reuses `TestLog.redactor` plus `displayPath` from `source-location.ts`; `src/main/test-mode/controller.ts` owns console routing in the top-level test-controller process because it has the parsed reporter setting; `runner.ts` owns run lifecycle and totals and reuses existing `TestResult` data and `writeReports()`; `launcher.ts` owns owned-app child stream routing and reuses its existing `pipeOutput()` logging path.
- `integration-test/run.mjs` needs no change: its product result collection reads `report.json` and does not depend on runner console format.
- Use generic local test data only; do not include customer or company project names.

## Acceptance Criteria

- [x] Both reporter spellings parse; unsupported or duplicate reporter options fail clearly; omission preserves the default human reporter.
- [x] JSON Lines mode emits one valid version-1 JSON object per line on stdout for run start, each selected test start/end, failed hooks, and run end, with the schema above and no step arguments or secrets. `run-start` precedes every `test-start`; `run-end` is the last line; each event is written in one newline-terminated write.
- [x] Run-start counts reflect discovered files and post-filter descriptors; final status totals and nullable report folder are correct for normal, attached, setup-failure, skipped, retried, and `--log` runs.
- [x] All host `console` methods, including calls from imported test modules, and owned-app stdout do not appear on JSON stdout; they go to stderr in JSON Lines mode. Only direct suite `process.stdout.write()` is out of scope. Attached mode preserves the same JSON-only runner stdout behavior.
- [x] Default console output and `report.json` retain their existing behavior and schema.
- [x] `run-options.md` has the short option entry and tells suite authors direct `process.stdout.write()` can pollute the JSON stream; `integration-test/run.mjs` remains unchanged.

## Files Changed

Files explicitly needing no changes:

- `src/test-host/results.ts` — retain the current `report.json` payload.
- `launcher/src/test_main.rs` — current inherited streams already pass output through.
- `src/test-host/context-operations.ts` — `ctx.log()` uses global console and follows the host-wide redirect.
- `src/main/stdio-guard.ts` — it only drops broken-pipe errors; it does not control stream routing.
- `integration-test/run.mjs` — reads `report.json`, not console formatting.
- `doc/active-work.md` — the EPIC-209 dashboard entry already exists.
- `assets/guides/agents/web-app-tests/attached-runs-and-results.md` — full guide work belongs to US-2179.
- `assets/guides/agents/boards/bridge-versions.md` — no `window.persephone` change.

| File | Planned change |
|---|---|
| `src/main/test-mode/arguments.ts` | Parse reporter aliases, validate values/duplicates, default to human. |
| `src/main/test-mode/controller.ts` | Forward reporter selection and redirect controller-process console output to stderr in JSON Lines mode while preserving explicit host stdout forwarding. |
| `src/test-host/launcher.ts` | Add reporter configuration and route owned app stdout to stderr in JSON Lines mode while preserving its log stream label. |
| `src/test-host/json-lines-reporter.ts` | New owner of versioned event schema, JSONL serialization, and host-wide console redirect. |
| `src/test-host/runner.ts` | Wire start/end events and test reporter mode through run lifecycle; preserve report and exit behavior. |
| `src/test-host/test-log.ts` | Notify the reporter from existing redacted events without changing `tests.log` output. |
| `src/test-host/test-file-run.ts` | Ensure start/end events for selected outcomes and pass attempt data. |
| `src/test-host/file-hook-run.ts` | Expose failed file hook results to the reporter. |
| `src/test-host/test-attempt.ts` | Expose failed per-test hook events with attempt number. |
| `src/test-host/index.ts` | Install console redirect before discovery/imports; keep stream flush and exit handling. |
| `assets/guides/agents/web-app-tests/run-options.md` | Add a brief option and stream behavior entry. |
| `src/test-host/results.ts` | No planned changes; preserve report schema and reuse existing totals/results. |
| `launcher/src/test_main.rs` | No planned changes; `.status()` inherits stdout/stderr and exit code. |
| `src/test-host/context-operations.ts` | No planned changes; `ctx.log()` uses global console and follows the host-wide redirect. |
| `integration-test/run.mjs` | No changes; reads `report.json` and does not parse product console text. |
| `doc/active-work.md` | No changes; EPIC-209 dashboard entry already exists. |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md` | No changes in this task; full results guide update is in US-2179. |
