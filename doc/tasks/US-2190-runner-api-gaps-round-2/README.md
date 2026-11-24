# US-2190: Runner API gaps — `waitFor` retries read errors, download MIME type, compact summary, undescribed-member hint

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — items 5, 6, 7 (error hint), 10  
**Status:** Planned

## Goal

Four small runner additions that remove workarounds the pilot suite needed.

## Background

- `src/test-host/context-operations.ts:19,187` and `src/test-host/context.ts:9` separately declare `WaitOptions`. `runHostPoll` (`src/test-host/poll.ts:32`) already retries only read errors when `retryReadError` permits them; predicate errors escape. `expect.poll` uses it in `src/test-host/poll-expect.ts:42` and returns void.
- `DownloadCapture.finish` (`src/main/download-capture.ts:173`) settles three fields via the existing typed IPC result `BrowserDownloadResult` (`src/ipc/browser-ipc.ts:171`). `copyCapturedDownload` (`src/test-host/captured-downloads.ts:11`) validates, copies and deletes the capture and constructs a relative report attachment. The draft's claim that non-HTTP URLs pass through the failure-bundle redactor is incorrect: `redactUrl` (`src/test-host/failure-bundle.ts:139`) replaces them with `[redacted URL]`.
- Human output is in `src/test-host/runner.ts:164-185`; summary detail uses `firstErrorLine`, not the failing step. `src/main/test-mode/arguments.ts`, `controller.ts` and `src/test-host/launcher.ts` carry runner options. `ctx.log` and launcher output are separate console streams.
- `BrowserEditorFacade.labelPageShape` (`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:860`) prefixes page-model kinds with `page:`. The installed `ai-vision` 1.5.0 `resolveCall` rejects an undeclared member against the remote shape before a page request; `McpClient.serverError` (`src/test-host/client.ts:121`) appends a `$help` hint. The page's object is unavailable at that point: the draft's proposed prototype inspection cannot work there without another boundary operation.

## Implementation plan

### A. Opt-in retry of read errors

- [x] Owner: `src/test-host/context-operations.ts`, `createContext().waitFor`; reuse `runHostPoll` and `EnvironmentStopError` from `src/test-host/attention-policy.ts`. Add `retryErrors?: boolean` to **both** `WaitOptions` declarations (`context-operations.ts` and `context.ts`). Default false preserves existing behavior; never retry `EnvironmentStopError`, predicate failures, or lifetime cancellation. Keep `expect.poll` returning void.

  ```ts
  // Before: match follows read; errors propagate.
  match: (value) => predicate(value),
  // After: retry only read errors, never environment stops.
  retryReadError: (error) => options.retryErrors === true && !(error instanceof EnvironmentStopError),
  match: (value) => predicate(value),
  ```

- [x] In `timeoutError`, branch on `outcome.kind`: retain the existing redacted last-value message for values; for errors use `Last error: ${safePreview(errMessage(outcome.error))}`, scrubbed with `log?.redactor.scrub` before constructing the error, including the `options.message` prefix as today. `runHostPoll` also logs `lastError`; scrub that field with its existing log redactor so secrets cannot bypass the timeout message. Preserve `check`, `quiet`, failure marking, and timing.
- [ ] Update signatures and behavior in `assets/guides/agents/web-app-tests/index.md:88` and `assets/guides/agents/web-app-tests/call-boundary-and-examples.md:50`.

### B. Download metadata

- [x] Owner: `src/main/download-capture.ts`, `DownloadCapture.finish`; reuse `item.getMimeType()`, `item.getURL()` and the existing `PendingRequests` settlement. Add required string fields to `BrowserDownloadResult` in `src/ipc/browser-ipc.ts`, then settle:

  ```ts
  // Before
  this.requests.settle(id, { suggestedFilename: item.getFilename(), path: finalPath, size: stat.size });
  // After
  this.requests.settle(id, { suggestedFilename: item.getFilename(), path: finalPath, size: stat.size,
      mimeType: item.getMimeType(), url: item.getURL() });
  ```

- [x] Owner for runner projection: `src/test-host/captured-downloads.ts`, `copyCapturedDownload`. Add fields to both interfaces; validate both as strings alongside existing validation, then copy `mimeType` and sanitized `url` into both result and attachment. Replace the inline cast in `src/test-host/context-operations.ts:86` with `CapturedDownload`. Move `redactUrl` unchanged into new `src/test-host/url-redaction.ts`, import it in `failure-bundle.ts` and `captured-downloads.ts`; additionally run the result through the run `StorageStateRedactor.scrub` passed from `createContext` before either return or attachment. HTTP(S) strips credentials, fragments and query values; all other schemes, including blob/data and invalid URLs, become `[redacted URL]`. This deliberately preserves the existing safe helper instead of the draft's unsafe pass-through. Return the same redacted URL in both runner result and report; direct non-runner facade calls receive the raw Electron URL. Do not alter capture file validation or cleanup.
- [x] Update `src/renderer/api/types/browser-editor.d.ts:260` and both member signature and download help in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:66,150`; document runner vs direct-call URL behavior in `assets/guides/agents/web-app-tests/attached-runs-and-results.md`. `results.ts` already uses `DownloadAttachment`, so its serialization needs no new mapping.

### C. Compact human output

- [x] Owner: `src/test-host/runner.ts` final reporting, reusing `displayPath`, `firstErrorLine`, existing `result.step`, and the run redactor. Parse boolean `--summary-only` with duplicate rejection in `src/main/test-mode/arguments.ts` (also `hasTestControllerArguments` and return object), pass it through `src/main/test-mode/controller.ts` and `HostConfiguration` in `src/test-host/launcher.ts`. Reject combination with `--reporter json-lines`: the option controls human output only. Do not change report generation, logs, exit codes, or JSON-lines output.

  ```ts
  // Before: full per-result detail always prints.
  for (const result of results.filter((item) => item.status !== "passed")) { /* existing detail */ }
  // After: retain the entire existing block in default mode.
  if (!configuration.summaryOnly) {
      for (const result of results.filter((item) => item.status !== "passed")) { /* existing detail */ }
  }
  ```

- [x] For each existing non-passed summary entry, prepend a scrubbed, single-line `result.step` to its existing first-line detail; cap the step at 120 characters including an ellipsis. Omit the separator when step is absent. Use final `result.step` for failures and flaky results; keep status, name, location, skip/expected-failure reasons. Keep the run totals, setup/environment errors, stale identities, results path and retained-app notice visible in both modes. `--summary-only` suppresses the final per-result detail block, not explicit `ctx.log`, test/child process output, or critical errors. This matches the fixed decision to suppress per-failure detail without hiding diagnostics. Document these boundaries in `assets/guides/agents/web-app-tests/attached-runs-and-results.md` and the option in `assets/guides/agents/web-app-tests/run-options.md`.

### D. Undescribed-member hint

- [x] Owner: `src/test-host/client.ts`, `McpClient.serverError`; reuse its existing unknown-member detection and `$help` hint. Add a conditional hint only when the actual unknown-member error names a `page:` kind, independently of the existing `Did you mean` check:

  ```ts
  // Before: unknown members get only the existing list-members hint.
  // After: append this suggestion for page-model unknown members.
  if (/ is not a member of page:[^.]+\./.test(errorText)) {
      errorText += "\nIf the member exists on the exposed model, add it to aiVision.members.";
  }
  ```

  This is deliberately conditional: it also covers a typo, never asserts existence, invokes no getter and reveals no value. Checking own/prototype descriptors in the page would need an additional cross-process operation, so the conditional hint satisfies the diagnostic goal without new protocol code. Keep ordinary, board, restricted and suggestion errors unchanged. No `window.persephone` surface changes; if implementation later changes it, bump `BOARD_BRIDGE_VERSION` and its history line.

### Verification and documentation

- [ ] Extend `integration-test/tests/core/mcp/mcp.test.mjs` for callback read throws then succeeds, default immediate throw, predicate throw, timeout last error and redaction; exercise an environment stop through an existing integration scenario. Extend `integration-test/tests/browser/page-models/page-models.test.mjs` and `integration-test/fixtures/http/browser/page-models/page-model.html` for an undescribed own member and prototype getter (the current fixture supplies a hand-written remote, so add an exposed-root fixture with a getter counter), unknown typo, declared member and non-page error; assert no getter invocation.
- [ ] Extend `integration-test/tests/browser/downloads/downloads.test.mjs` and the existing `integration-test/fixtures/http/browser/downloads/index.html` fixture to exercise captured download MIME and query/credential/fragment redaction, non-HTTP redaction, attachment and copied file. Reuse the `/download` route in `integration-test/lib/http-fixtures.mjs`; extend its response only if the existing MIME is unsuitable. Run the suite with a local fixture and inspect `report.json` for attachments.
- [ ] Verify normal and `--summary-only` human runs with a deliberately failing local integration fixture, multiline step, missing step, skipped/expected/flaky outcomes, setup failure and report/log parity; verify JSON-lines still works and rejects the conflicting flag. No unit tests or new test harnesses. Run `npm run typecheck`, `npm run lint`, relevant integration tests and `npm run guides:check`.
- [x] Update `assets/guides/whats-new.md` for the new runner behavior; guide topic ownership for broader model guidance remains US-2191.

## Concerns

- Retry reads only; a timeout reports the final poll outcome, so a successful nonmatching read after an error reports its last value. Run redaction must cover error text and the poll log as well as result/attachment URLs.
- A page-model hint cannot distinguish a missing descriptor entry from a typo without querying the page. The conditional wording is accurate and preserves the existing boundary and descriptor access controls.

## Acceptance criteria

- [ ] `ctx.waitFor(read, pred, { retryErrors: true })` survives transient read failures and returns the settled value; default, predicate failures and environment stops retain their behavior; timeout reports the redacted final error.
- [ ] Runner `waitForDownload()` result and report attachment contain `mimeType` and the same redacted `url`; capture copying and cleanup remain intact.
- [ ] `--summary-only` suppresses per-result detail; summary lines include the failing step when available, bounded and redacted. Default detail, reports and logs remain intact.
- [ ] An exposed-but-undescribed page member produces a conditional `aiVision.members` hint without reading the member; unrelated model errors do not.

## Files needing no changes

- `src/test-host/results.ts`, `src/test-host/test-result.ts`, `src/test-host/test-attempt.ts`: already carry the attachment type; report serialization consumes it.
- `src/test-host/json-lines-reporter.ts`: machine reporter remains unchanged.
- `src/site-extension-runtime.ts`, `src/renderer/editors/browser/BrowserPageRemote.ts`, `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` model-proxy logic, and the `ai-vision` dependency: existing shape and error path suffice for D. The facade's download help still changes for B.
- `src/board-shim.ts`, `src/shared/board-bridge-version.ts`, board registries and frame protocols: no board rule, bridge surface or protocol is added.

## Files changed

| File | Planned change |
|---|---|
| `src/test-host/context.ts`, `src/test-host/context-operations.ts`, `src/test-host/poll.ts` | Retry option, polling policy, safe timeout/logging and download projection. |
| `src/main/download-capture.ts`, `src/ipc/browser-ipc.ts` | Capture and type MIME/URL through existing IPC. |
| `src/test-host/captured-downloads.ts`, `src/test-host/failure-bundle.ts`, new `src/test-host/url-redaction.ts` | Reuse URL redaction and propagate metadata. |
| `src/renderer/api/types/browser-editor.d.ts`, `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Download return type and help. |
| `src/main/test-mode/arguments.ts`, `src/main/test-mode/controller.ts`, `src/test-host/launcher.ts`, `src/test-host/runner.ts` | Parse and forward compact mode; human summary. |
| `src/test-host/client.ts` | Conditional page-model descriptor hint. |
| `integration-test/tests/core/mcp/mcp.test.mjs`, `integration-test/tests/browser/page-models/page-models.test.mjs`, `integration-test/tests/browser/downloads/downloads.test.mjs`, `integration-test/fixtures/http/browser/page-models/page-model.html`, `integration-test/fixtures/http/browser/downloads/index.html`, `integration-test/lib/http-fixtures.mjs` (only if needed) | Integration coverage and fixtures. |
| `assets/guides/agents/web-app-tests/index.md`, `call-boundary-and-examples.md`, `attached-runs-and-results.md`, `run-options.md`, `assets/guides/whats-new.md` | Document behavior and usage. |
