# US-2156: Failure capture of pages under test and failure bundle

**Epic:** [EPIC-204](../../epics/EPIC-204.md) · **Proposals:** C1, C2 · **Feedback:** [US-2138](../US-2138-web-app-test-feedback/README.md), item 11

## Goal

Capture failed tests safely in attached runs and write a privacy-limited bundle for pages under test.

## Background

- EPIC-204 decisions 8–10 require page-only screenshots in both attached modes, owned-window screenshots in owned runs, and a per-failure bundle without network bodies or headers. US-2153 owns scoping in `src/test-host/test-window.ts` (modes `owned`, `attached-created`, `attached-selected`); its reviewed plan takes precedence over any mid-edit source. US-2155 supplies `_state.pagesUnderTest()` (the union) and `_state.sessionPages` alongside `_state.ownedPages` (`doc/tasks/US-2155-session-pages/README.md:33`-`:40`).
- Current capture (`src/test-host/results.ts:75`–`:128`) always screenshots `window.screen.screenshot`, then each browser returned by `snapshotOwnedPages`; that helper (`src/test-host/browser-helpers.ts:125`) derives pages from the baseline rather than session declarations. Each image uses `client.image`, a UUID filename and a per-target catch. `writeReports` serializes `results` into JSON (`results.ts:142`–`:150`) and links screenshots in Markdown (`:160`–`:162`). Capture occurs before cleanup (`src/test-host/test-attempt.ts:57`–`:65`); final attempt artifacts alone currently reach the result (`src/test-host/runner.ts:149`–`:185`).
- Browser automation methods already route through `AutomationSurface` and work through the normal page editor call tree in attached runs (`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:563`, `:631`–`:636`; `src/renderer/scripting/api-wrapper/AutomationSurface.ts:176`–`:187`). Console supports `since` and `level`; page errors accept only `tabId` (`src/renderer/scripting/ai-vision/browser-automation-members.ts:23`–`:26`).
- Exact shapes are in `src/ipc/browser-ipc.ts:178`–`:193`: console records are `{ type, args: string[], url, lineNumber, columnNumber, timestamp }` (the field is **type**, not level); errors are `{ text, url, lineNumber, columnNumber, timestamp }`. `consoleMessages({ since, level: "error" })` filters on `type` (`src/renderer/automation/page-events.ts:85`–`:97`). `networkRequests({ tabId?, includeBodies?, maxBodyBytes? })` has no since/limit/filter and returns `{ id, url, method, resourceType, referrer, timestamp, requestHeaders, requestBody?, statusCode?, statusLine?, responseHeaders?, fromCache?, error?, responseBody?, responseBodyBase64Encoded?, responseBodyTruncated? }` (`src/ipc/browser-ipc.ts:302`–`:320`; `src/renderer/automation/page-state.ts:106`–`:111`). It has **no duration or failed boolean**: failure is `error` or statusCode 400–599; duration must be `null`, never inferred. `url` and `title` are active-tab `string | undefined` getters (`BrowserEditorFacade.ts:372`–`:378`).
- **Timestamp clocks:** console records and page errors both use the main-process `Date.now()` at event receipt, in Unix-epoch milliseconds (`src/main/cdp/cdp-page-events.ts:89`-`:92`, `:110`-`:120`, `:123`-`:134`). The CDP events' own `Runtime.Timestamp` is epoch milliseconds ([CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-Timestamp)), but this collector ignores it. Host and main process use the same machine wall clock; host `started` is comparable, subject to clock adjustments and event delivery delay.
- Network history instead copies Electron `onBeforeSendHeaders` `details.timestamp` verbatim (`src/main/network-logger.ts:71`, `:85`-`:92`, `:153`-`:170`); the local Electron declaration `node_modules/electron/electron.d.ts:23585`-`:23608` says only `number`, and [Electron's webRequest documentation](https://www.electronjs.org/docs/latest/api/web-request/#webrequestonbeforesendheadersfilter-listener) says only `Double`. **Verified live by Claude (2026-11-22):** a request made at 11:51:08 UTC carried `timestamp: 1795348268289.632`, i.e. epoch milliseconds on the same clock as host `Date.now()`. Filter network entries by `timestamp >= started` like page errors.
- Page-event recording is bounded to 500 entries and starts at first automation command (`src/renderer/scripting/ai-vision/browser-automation-members.ts:25`-`:26`; `src/main/cdp/cdp-page-events.ts:7`); network history is capped at 200 (`src/main/network-logger.ts:17`, `:96`-`:103`). `getNetworkLog` returns request bodies and headers even without `includeBodies` (`:85`-`:94`, `:263`-`:269`), so project an explicit allowlist. Buffers and active-tab-only APIs can miss events; this is best effort, not a full trace.

## Implementation Plan

- [x] **Capture collaborator and selection.** Move `captureFailure`, `captureTarget`, and `sanitize` from `src/test-host/results.ts:75`–`:128`, `:179`–`:181` into new `src/test-host/failure-bundle.ts`; this module owns page selection, redaction, bounded projection, artifact writing and capture errors. Reuse `snapshotOwnedPages`, `randomUUID`, existing image MIME handling, `errMessage`, and US-2153 `testWindow.call` / `testWindow.image` for *all* bookkeeping calls; do not call `ctx.call` because it changes the test step/log. Start with `_state.pagesUnderTest()` in every mode, intersect it with the scoped browser page list, and in `owned` and `attached-created` also include baseline-diff browser pages opened through other routes. In `attached-selected` the accessor alone selects eligible pages. Deduplicate by ID; if an ID is in `_state.sessionPages`, `kind` is `"session"` even when also owned, matching US-2155's session protection. Never use `ctx.root` or enumerate other windows. In `src/test-host/browser-helpers.ts`, change `snapshotOwnedPages` to reuse `pageList` on a scoped `pages.all` read and compare baseline IDs directly, rather than calling `readSnapshot`, which probes popups on every browser page (`:130`-`:145`). Use the same scoped browser list for the accessor intersection, without probing or logging other pages. Snapshot failure is a capture error, not permission to broaden selection. US-2153 plan supersedes current unscoped signatures. For each selected page call the existing screenshot path and associate its relative path with that page; a missing image is `null`. Retain the existing screenshots array for reports. Capture the window only when mode is `owned`; both attached modes are page-only, including the runner-created window.

  ```ts
  // Before (results.ts)
  await captureTarget("window", "window.screen.screenshot", [], prefix, client, directory, identity, screenshots, captureErrors, log);
  const pages = await snapshotOwnedPages(client, baseline, logEvent);
  // After (failure-bundle.ts; scoped owner supplied by US-2153)
  if (testWindow.mode === "owned") await captureTarget("window", "window.screen.screenshot", [] /* existing arguments */);
  const pages = await selectCapturePages(testWindow, client, baseline, context._state.pagesUnderTest(), context._state.sessionPages, logEvent);
  ```

- [x] **Time and diagnostics.** In `src/test-host/test-attempt.ts:39`, reuse the per-attempt host `started = Date.now()` and pass it, the scoped owner, `_state.pagesUnderTest()` and session set to the collaborator before cleanup. Read each page's `editor.url`, `editor.title`, `editor.pageErrors([])`, `editor.consoleMessages([{ since: started, level: "error" }])`, and `editor.networkRequests([])` with bounded existing request timeouts. Calls shown here mean the call-tree method path plus its argument array, e.g. `testWindow.call(client, path, [{ since: started, level: "error" }], timeout)`. No `includeBodies` request. Filter `pageErrors` and network entries by numeric `timestamp >= started` (network unit verified live, see Background); defensively filter console by `type === "error"` too. Filter network to `error` present or `statusCode` 400–599; emit only `{ method, url, status: statusCode ?? null, durationMs: null }`. No endpoint supplies duration. Take the newest 100 page errors, 100 console errors and 100 failed requests per page, in original chronological order; apply caps after filtering. Unavailable properties become `null`, unavailable lists become `[]`, with a capture error for the failed operation. Catch each read separately so a single inaccessible/closed page or method does not prevent other fields/pages; bound every await. Include only active browser tab data, and document collection/buffer limits rather than changing renderer APIs.

  ```ts
  // Before: failures have screenshots only.
  return { screenshots, captureErrors };
  // After: project rather than copying raw network entries.
  const failedRequests = requests.filter(isFailedRequest).slice(-100).map(({ method, url, statusCode }) =>
      ({ method, url: redactUrl(url), status: statusCode ?? null, durationMs: null }));
  return { screenshots, captureErrors, failureBundle };
  ```

- [x] **Privacy and bundle file.** In `failure-bundle.ts`, write a UTF-8 JSON file per captured thrown-failure attempt, `failures/<sanitized-file-and-test>-a<attempt>-<uuid>.json`, under the existing output directory. Use `fs.mkdir`, `path.posix.join` for the relative path and `fs.writeFile(..., { flag: "wx" })` like screenshot writing. Use `{ pages: [{ pageId, kind: "owned" | "session", url: string | null, title: string | null, pageErrors, consoleErrors, failedRequests, screenshot: string | null }] }`. Retain the documented console/error record fields and sanitize their URL fields. In console arguments and page-error text, use one regex matching `https?://` URLs and replace each match via `redactUrl`. A shared local `redactUrl` must preserve query keys and replace *every* value with `…`, including duplicates and empty values; strip URL credentials and fragments as a conservative privacy measure. Apply it to page URL and every emitted network, console and error URL; malformed/unparseable URLs must fail closed (replace with a redacted placeholder, never return the raw string). Avoid serializing raw records, response data, headers, request bodies, referrers or error strings from network records. Do not log diagnostic payloads. Text and screenshots may themselves contain sensitive page content: explain that in the guide, without claiming general secret removal. A write failure produces `captureErrors` and no dangling link. Any unexpected collaborator exception is caught at the attempt boundary and appended to `captureErrors`, leaving the original test outcome intact.

  ```ts
  // Before: no failure bundle.
  // After: explicit schema and only redacted, projected data reach disk.
  const bundle = { pages: capturedPages };
  await fs.writeFile(path.join(directory, relative), JSON.stringify(bundle, null, 2) + "\n", { flag: "wx" });
  ```

- [x] **Attempt bundles and reporting.** In `src/test-host/test-attempt.ts`, keep the existing thrown-failure capture point before cleanup and carry optional `failureBundle` with `screenshots` and `captureErrors`; pass the attempt number to the collaborator. Do not capture on a cleanup-only failure. In `src/test-host/runner.ts:149`-`:188`, remember the last failed attempt's bundle path (if its write succeeded) and capture errors as attempts run, preserving the link when the final attempt passes (flaky); clear the prior path when a later captured attempt has no bundle. Each captured failed attempt writes its own file; no replacement or orphan handling. Expected failures that throw also get a bundle; unexpected passes have no thrown failure to capture. Ensure capture cannot change the test outcome. If no output directory (`--log` only), preserve existing no-artifact behavior. In `src/test-host/results.ts`, add `failureBundle?: string` to `TestResult`, keep `writeReports` serializing it in JSON and add an encoded relative Markdown link; rename the error heading from screenshot-specific to `Capture errors`. The JSON field contains a relative path, not embedded data.
  ```ts
  // Before (runner.ts)
  ...(done.screenshots.length ? { screenshots: done.screenshots } : {}),
  // After: retain the latest failed attempt's artifacts even after a retry passes.
  ...(failureBundle ? { failureBundle } : {}),
  ...(screenshots.length ? { screenshots } : {}),
  ```

- [x] **Guides and verification.** Update `assets/guides/agents/web-app-tests/index.md:210`–`:230` and `doc/standards/integration-tests.md:178`–`:190` to describe links, format, caps, nullable duration and active-tab/buffer/timestamp limits, attached page-only versus owned window capture, best-effort errors, no network headers/bodies, URL query redaction, possible sensitive text/screenshots, and local `reports/` / `test-results/` in `.gitignore`. Do not change `.gitignore` for users. Implementer runs `npm run lint` and `npm run typecheck`; Claude runs `npm run guides:check` and live runs: owned, attached-created and selected with owned and session pages plus unrelated pages/windows; errors, warning versus error, 4xx/5xx and transport failure, pre-attempt requests, query duplicates and tokens, missing fields, screenshots and failed reads/writes, retries/flaky and cleanup-only failure (confirm no capture). Inspect both reports and JSON for correct links, limits and absence of network headers/bodies and query values. No unit tests or test harnesses.

## Concerns resolved

1. **Which pages?** Use `_state.pagesUnderTest()` intersected with the scoped browser list in all modes; add baseline-diff browsers in owned and runner-created windows. Session kind wins on overlap. The shared scope owner prevents unrelated-window reads; no per-call prefix construction.
2. **What counts as during the test?** Filter page events with attempt-start host epoch milliseconds; the collector uses main-process `Date.now()`. Network entries are filtered the same way; their epoch-ms unit was verified live. Automation collection starts on first command and buffers are bounded, so diagnostic coverage is best effort. No per-page cursor or new protocol is needed.
3. **Is timing available?** Network entries lack a duration (`src/ipc/browser-ipc.ts:303`–`:320`); use `durationMs: null`. `error` is the transport-failure indicator and `statusCode` the HTTP status. No change to the browser bridge.
4. **Does omitting `includeBodies` ensure privacy?** No: request body and both headers can still be returned. Explicit allowlist projection excludes them. Redact query values for all URL fields and `https?://` matches in diagnostic text, but arbitrary console text, error text, titles and screenshots can contain private data; the guide identifies local artifacts as sensitive.
5. **Retries and failure while capturing?** One bundle per captured thrown-failure attempt; link the last failed attempt even if a later retry passes. Catch each operation and overall capture; report errors separately and never change status. Cleanup-only failures do not trigger capture.
6. **Guardrails and ownership.** `failure-bundle.ts` owns these rules and reuses existing capture, snapshot, scope and error helpers. `results.ts` owns only report presentation and shrinks by moving capture out (estimated net −50 to −70 lines, including report link/type additions); `runner.ts` and `test-attempt.ts` only plumb state (approximately +15–30 and +10–20 net lines respectively). No roadmap §2.3 god file grows, no protocol or board rules are added, no import-zone workaround or `await import()` is introduced. No `window.persephone` change is expected; if one becomes necessary, bump `BOARD_BRIDGE_VERSION` and add a history line. Strict-folder null fixes are type-only unless recorded separately.

## Acceptance Criteria

- [ ] Both attached modes never call `window.screen.screenshot`; owned mode retains it. Only eligible owned/session browser pages in the scoped test window are captured, with duplicates removed and selected-window unrelated pages excluded.
- [ ] Each captured thrown-failure attempt with output enabled gets its own JSON bundle when writing succeeds; the result links the last failed attempt, including flaky and expected-failure cases. Cleanup-only failures do not trigger capture. `report.md`, `report.json`, screenshot links and `captureErrors` agree; capture errors never alter outcomes.
- [ ] Per-page shape and 100-entry limits match the plan. Console uses `type` and filters error; page errors and network entries use attempt-start timestamps; failed requests include transport errors and 400–599 status, with nullable status and duration.
- [ ] No network headers, bodies or referrers are written; query values are redacted in emitted URLs, including page URLs and `https?://` diagnostic text matches, with safe malformed URL handling. Pages outside the test are never read for capture.
- [ ] Guide and standard explain local output, `.gitignore`, omissions and limitations. Implementer passes lint and typecheck; Claude passes guides check and live scenarios above. No tests or harnesses are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/test-host/failure-bundle.ts` (new) | Own page selection, scoped screenshots, bounded diagnostics, privacy projection and bundle writing; reuse moved capture helpers. |
| `src/test-host/browser-helpers.ts` | Reuse `pageList` for capture without probing unrelated page popups; filter eligible IDs. |
| `src/test-host/results.ts` | Move capture out; add result field and report link; estimated net −50 to −70 lines. |
| `src/test-host/test-attempt.ts` | Pass attempt start, scoped owner, accessor, session set and attempt number; carry artifacts. |
| `src/test-host/runner.ts` | Link the latest failed-attempt bundle across retries. |
| `assets/guides/agents/web-app-tests/index.md` | Describe output, privacy and local ignore rule. |
| `doc/standards/integration-tests.md` | Describe capture and verification behavior. |

**Files needing no change:** `src/test-host/test-window.ts` (reuse US-2153 scope and mode), `src/test-host/context.ts` (reuse US-2155 sets), `src/test-host/client.ts` (existing call/image), `src/renderer/editors/browser/`, `src/renderer/scripting/`, `src/renderer/automation/`, `src/ipc/`, `src/shared/board/`, board registries and bridge (existing APIs suffice); `.gitignore`, dashboard, epic and `integration-test/`.


