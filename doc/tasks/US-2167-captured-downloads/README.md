# US-2167: Captured downloads

## Goal

Add `site.waitForDownload(options?)` for browser pages under test. It waits for the next eligible download and returns `{ suggestedFilename, path, size }` without a Save dialog; the runner copies the app-owned file into the run output and attaches it to `report.md`, `report.json`, and a failure bundle when applicable.

## Background

### EPIC-207 decisions and access rule

- This implements F4 from [EPIC-207](../../epics/EPIC-207.md) and section 3 F of the [web-app testing review](../../reviews/web-app-testing-review.md). EPIC Decisions 1, 2, 3, 6, and 8 apply: a browser facade collaborator owns the public member; use existing typed browser IPC and wait primitives; gate this test power with the shared predicate; keep the app's save destination confined and copy into runner output; extend Bridge 1.61.0 without another version bump.
- [US-2166](../US-2166-storage-state/README.md) introduces `agentMayUseBrowserTestPower` in `src/renderer/editors/browser/agent-access.ts`, composing `agentMayAccessBrowserPage` with agent-opened/test-adopted ownership and the shared refusal. Reuse that predicate and refusal unchanged for `waitForDownload`; do not create a download-specific access rule. F4 is explicitly among the test powers governed by Decision 3.
- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` owns the browser editor member/help descriptors and delegates behavior to small collaborators. `BrowserWebviewModel.ts` is a roadmap §2.3 god file and must not grow.

### Existing download lifecycle and gate

- `src/main/download-service.ts` registers Electron `will-download` on each session. For a browser guest, `handleWillDownload()` first calls `downloadRequestLimiter.allow(webContents, guest.activation)`, then applies browser URL claims, then currently handles an ordinary download. Capture should be checked after the limiter and after URL claims, before the ordinary path. A claimed download keeps its existing route; only a real `DownloadItem` reaches capture.
- The limiter in `src/main/browser/download-request-limiter.ts` consumes a fresh `UserActivation` for each gesture download. It also allows one download without a gesture per committed document; later automatic downloads are cancelled and notify once. Arming a waiter grants no gesture and does not reset this gate. A trusted test click is a real gesture and passes through the same `activation.consume()` check. A Blob plus `<a download>` triggered on page load uses the document's single free allowance; additional downloads still require a gesture.
- Ordinary browser downloads use a per-page `SavePathQueue` (up to three queued requests) and a temporary `.part` under `%TEMP%/persephone-downloads[-profile]`. While waiting for a chosen destination, `trackDownload()` pauses at `UNCHOSEN_TEMP_LIMIT_BYTES` (32 MiB). `chooseDownloadPath()` uses `testInstanceDownloadPath()` for an owned `--test-instance`; otherwise it opens a native Save dialog. `finishDownloadMove()` moves/copies the temporary file, writes Mark-of-the-Web where available, then emits `eDownloadCompleted`.
- `testInstanceDownloadPath()` in `src/main/test-mode/downloads.ts` writes to `<userData>/test-downloads/`, sanitizes with `path.basename`, and chooses a `(n)` collision suffix. It is selected only when `isTestInstance()` is true, so it cannot serve an attached run in a normal app. Captured files therefore use the app-controlled root `path.join(os.tmpdir(), "persephone-test-downloads", safeProfileKey)`, where `safeProfileKey` is one sanitized `applicationProfileName()` segment or `default`; this works for both modes and gives the runner a fixed prefix to validate. Never accept a destination path from the test or page.
- `DownloadService` excludes private-session entries from its viewer-less `getDownloads()` result, so `recentDownloads.json` persistence does not include them. Capture must bypass the ordinary `DownloadRecord` and persistence path entirely: it must emit no recent-download entry, including for an agent-opened incognito page. No `eDownload*` event is needed for the test waiter; existing events remain the normal download UI path.
- The download service is about 430 lines. Give capture ownership to a new `src/main/download-capture.ts` collaborator. `download-service.ts` should only delegate an eligible item to it and continue ordinary handling when no waiter is armed.

### Wait, IPC, and runner paths

- `src/main/cdp/cdp-waits.ts` shows the existing arm/await wait lifecycle, cancellation, target-close cleanup, timeout validation, and bounded maximum. `src/shared/pending-requests.ts` provides the shared request correlation, timeout, abort, and `failWhere()` cleanup primitive. Use `PendingRequests` for the single in-flight capture waiter and key its metadata by the registered browser target / `WebContents`; do not add a custom token correlator, event channel, or second CDP download observer.
- Electron's `will-download` / `DownloadItem` is the one interception layer because it is where the US-2144 limiter already runs. Do not add `Browser.setDownloadBehavior` or `Page.downloadWillBegin`; running both Electron and CDP download paths would duplicate completion and ownership decisions.
- The renderer CDP wrapper `src/renderer/automation/CdpSession.ts` uses typed `BrowserChannel` invoke/reply and `invokeUnwrapped()`. Add one typed wait request and its typed result there, dispatch it through `src/ipc/main/cdp-handlers.ts` and the existing CDP service target resolver, and let `src/main/download-capture.ts` own the pending wait. The main handler awaits the same request promise until a download completes or fails. This is a method on the existing service channel, not a new event protocol.
- A method call on the app stand-in starts its MCP request immediately: `createAppProxy()` in `src/test-host/app-proxy.ts` invokes `call()` in the proxy's `apply` trap. Keeping the returned promise lets the test start the wait, click, and then await the same promise. The MCP server handles separate requests asynchronously, and neither `app-proxy.ts` nor `McpClient` serializes them, so source inspection finds no guarantee that the first request reaches the renderer before the click request. For the wait API itself, `BrowserDownloadCapture` must issue the wait IPC before its first yielding await, and Electron orders IPC messages from that renderer; this orders the wait message ahead of any later renderer-originated input once the method has begun running. It does not order two MCP requests that arrive at the main process out of order. `McpClient` defaults each request to `timeouts.request` (30 seconds); the app stand-in's existing `.withOptions({ timeout })` controls the outer MCP request timeout, while `waitForDownload({ timeout })` controls the main-side waiter. For a longer wait, set the stand-in request timeout slightly above the API wait timeout and keep both inside the test's own timeout.
- `src/test-host/results.ts` resolves the output directory to `--log-dir` or `<test path>/test-results`; `runner.ts` writes `report.json` and `report.md` there. `src/test-host/failure-bundle.ts` writes JSON under `failures/` and screenshots under `screenshots/`. Add a runner helper `src/test-host/captured-downloads.ts` to validate a completed wait result, copy it into an app-run output subfolder, remove the app-side copy, and retain only a relative attachment path and metadata for reports. `--attach` uses the same interception and runner copy; it does not depend on test-instance mode.
- `ctx` call/result handling is in `src/test-host/context-operations.ts`; per-test result assembly is in `test-attempt.ts`, `test-file-run.ts`, and `test-result.ts`. Keep attachments per test, carry them into the report entry, and include their relative paths in a failure bundle. `report.md` should link each attachment; `report.json` should include its suggested filename, relative path, and size. Do not serialize the app-side temp path in logs or reports.

### API shape

Before:

```js
await site.click("#export"); // the browser's normal Save dialog interrupts an attached run
```

After:

```js
const wait = site.waitForDownload();
await site.click("#export");
const file = await wait; // { suggestedFilename, path, size }
```

`suggestedFilename` is exactly the page-supplied `DownloadItem.getFilename()` value. The main-side result initially carries its app temp capture path; when called through the test runner, the runner copies the file and changes `path` to its output path under `<output>/downloads/` before returning the result to test code. `size` is the completed file size in bytes.

The API timeout defaults to 10 seconds and rejects invalid/non-positive values while clamping a positive finite input to 1–595,000 ms, following `cdp-waits.ts`. There is one waiter per browser page; a second simultaneous waiter on the same page fails clearly. A download that began before the waiter was armed is not adopted. Cancel only after a committed top-level navigation: listen for Electron's `did-navigate` event (main-frame commit), never `did-start-navigation`; ignore `did-navigate-in-page` so `pushState` and hash changes do not cancel. A page/guest close also cancels the waiter and removes any partial capture. The app's output cap is 32 MiB per captured file, matching the existing unchosen-download hold threshold; larger downloads fail with a size-limit error and leave no partial file.

The main-side collaborator has a tuning-constants block with `CAPTURE_MAX_BYTES = 32 * 1024 * 1024`, `CAPTURE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000`, `CAPTURE_TEMP_FOLDER = "persephone-test-downloads"`, `DEFAULT_DOWNLOAD_WAIT_TIMEOUT_MS = 10_000`, and `MAX_DOWNLOAD_WAIT_TIMEOUT_MS = 595_000`. At app startup, `src/main/download-capture.ts` removes every leftover `.part` file in the current profile capture root regardless of age, and removes other regular files older than `CAPTURE_ORPHAN_MAX_AGE_MS`; it does not follow symlinks out of that root.

## Implementation Plan

1. **Add the public member and delegate it.** In `src/renderer/api/types/browser-editor.d.ts`, declare `waitForDownload(options?: { timeout?: number }): Promise<{ suggestedFilename: string; path: string; size: number }>` with a JSDoc return description such as `Returns the page-supplied DownloadItem.getFilename() as suggestedFilename; path is the runner-output path when called through the test runner.` Add the same explicit result description in the `BROWSER_EDITOR_MEMBERS` and help descriptor in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`. Delegate behavior to a new `src/renderer/editors/browser/BrowserDownloadCapture.ts`. That collaborator owns the renderer-side call and test-power check, resolves the selected browser target with the existing target helper, calls `agentMayUseBrowserTestPower()` from US-2166, and issues `CdpSession.waitForDownload()` before any yielding await. Do not add a member-specific access condition in `BrowserEditorFacade`.

   Example API behavior:

   ```ts
   const wait = site.waitForDownload.withOptions({ timeout: 15_000 })({ timeout: 10_000 });
   await site.click("#export");
   const file = await wait;
   ```

   The first timeout bounds the outer MCP request; the method option bounds the wait itself. The no-options form uses defaults that fit the runner's existing 30-second request timeout.

2. **Own the Electron capture lifecycle in one collaborator.** Create `src/main/download-capture.ts`. It owns per-target waiter registration, timeout/cancellation, and a tuning-constants block containing `CAPTURE_MAX_BYTES = 32 * 1024 * 1024`, `CAPTURE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000`, `CAPTURE_TEMP_FOLDER = "persephone-test-downloads"`, `DEFAULT_DOWNLOAD_WAIT_TIMEOUT_MS = 10_000`, and `MAX_DOWNLOAD_WAIT_TIMEOUT_MS = 595_000`. The profile root is `path.join(os.tmpdir(), CAPTURE_TEMP_FOLDER, safeProfileKey)`; `safeProfileKey` is one sanitized `applicationProfileName()` segment or `default`, derived in this module and never caller supplied. Reuse `PendingRequests`, `DownloadRequestLimiter`'s already-applied admission result, Electron `DownloadItem.setSavePath()` / `done` lifecycle, and the existing `applicationProfileName()` convention. Write to a generated `.part`, then rename into the app-sanitized, collision-safe destination only on success. If a `DownloadItem` reports a known total above the cap, cancel immediately; also cancel if received bytes cross it. Export startup cleanup from this module and call it from `DownloadService.init()` next to `cleanupTemporaryDownloads()`: always remove leftover `.part` files in the profile root, and remove other regular files whose modification time is older than `CAPTURE_ORPHAN_MAX_AGE_MS`. Do not follow symlinks while cleaning.

3. **Connect the single Electron hook and typed RPC.** In `src/main/download-service.ts`, after `downloadRequestLimiter.allow()` and the existing URL-claim handling, delegate an eligible browser guest's item to `downloadCapture`; return when handled, otherwise preserve `handleOrdinaryDownload()` unchanged. In `src/ipc/browser-ipc.ts`, add the typed request/result and one `BrowserChannel` invoke for waiting. Route it through `src/ipc/main/cdp-handlers.ts`, `src/main/cdp-service.ts`, and `src/renderer/automation/CdpSession.ts` using existing typed invoke/reply and sender/target validation. Keep only imports, a narrow method, and composition in `cdp-service.ts`. Inside the renderer method, issue the wait IPC before any yielding await; Electron's ordering for IPC sent by that renderer preserves the wait-before-input order once this method is running. This does not remove the separate-MCP-request race described under Concerns.

4. **Preserve lifetime and download policy.** The main collaborator rejects a second waiter for the same `WebContents`, does not match downloads that started before arming, and fails the waiter only after a committed top-level navigation (`did-navigate`), WebContents destruction, timeout, download cancellation/failure, or size overflow. Do not listen to `did-start-navigation`, because a link to a file can start navigation and then become a download without committing. Ignore `did-navigate-in-page`, which covers `pushState` and hash changes. A user page with no waiter follows today's path: ordinary downloads retain the Save dialog, the test-instance hook retains its existing test-folder behavior, and existing board URL claims still run. The US-2144 gate runs before capture; capture never calls or bypasses `allow()`. A captured private-session download does not create a `DownloadRecord`, notify the general download list, or enter `recentDownloads.json`.

5. **Copy into test output and attach it.** Create `src/test-host/captured-downloads.ts` as the sole owner of runner-side path validation, copy, app-side cleanup, filename re-sanitizing, and report attachment metadata. Before copying, reject any `..` path segment in the supplied source, resolve it with `fs.realpath()`, and require the resolved file to be a direct child of `<os.tmpdir()>/persephone-test-downloads/<one segment>/`; validate that the canonical profile folder is exactly one segment below the canonical capture root, which prevents symlink escape, that `fs.stat()` reports a regular file, and that its byte size exactly equals the reported `size`. Refuse the result without copying if any check fails. Re-sanitize the untrusted page-supplied `suggestedFilename`: remove path separators and control characters, strip trailing dots/spaces, and neutralize reserved Windows names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including extensions). Write under `<output>/downloads/` with an exclusive `COPYFILE_EXCL` copy (or exclusive `"wx"` file creation), retrying a generated collision suffix; unlink the app-side file after a successful copy. In `src/test-host/context-operations.ts`, after a successful `waitForDownload` call result and before returning it to test code, pass the result to this helper using the current test's output directory. If copying fails, unlink best-effort and fail the step without echoing source paths or file contents.

   Carry each test's attachment records through `src/test-host/context.ts` / `context-operations.ts`, `src/test-host/test-attempt.ts`, `src/test-host/test-file-run.ts`, and `src/test-host/test-result.ts`. Extend `TestResult` and `writeReports()` in `src/test-host/results.ts` so JSON records `{ suggestedFilename, path, size }` with a path relative to the report directory and Markdown links the file. Extend `src/test-host/failure-bundle.ts` to include the same relative attachment references for failed tests. The test receives the runner-output path, not the app temp path; `suggestedFilename` remains the original page-supplied `DownloadItem.getFilename()` value. Keep `tests.log`, report diagnostics, and failure-bundle metadata free of the app-side temp path.

6. **Extend the existing bridge line and implementation guides.** The new browser-editor member is callable through `window.persephone.call()`. Extend the existing Bridge 1.61.0 paragraph in `assets/guides/agents/boards/bridge-versions.md` to include `waitForDownload`; leave `src/shared/board-bridge-version.ts` at 1.61.0. At implementation update `assets/guides/agents/browser.md`, `assets/guides/agents/browser-automation.md`, `assets/guides/agents/web-app-tests/index.md`, `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`, and `assets/guides/agents/web-app-tests/attached-runs-and-results.md`. Document the promise-start/click/await pattern, the separate outer MCP timeout for longer waits, the access rule, file cap, output attachment paths, attached runs, and privacy behavior. State the residual ordering race explicitly: if the click reaches the page before the wait IPC is armed, that download takes the ordinary path (including a Save dialog where applicable) and the wait times out; describe the consequence in the guide until implementation supplies an ordering guarantee.

## Concerns

- **Capture root and confinement:** the renderer/test never supplies a save path. The main capture module chooses `path.join(os.tmpdir(), "persephone-test-downloads", safeProfileKey)` and a generated name; the runner accepts only completed `waitForDownload` results, resolves the source with `fs.realpath()`, confirms it is a direct file child under one profile segment of that fixed root, checks regular-file status and exact reported size, then copies exclusively beneath its own `--log-dir` / report directory and removes the source. Do not accept a caller-chosen path or follow a symlink outside the root.
- **MCP request ordering:** the test host starts `waitForDownload()` and the click as separate MCP requests. The proxy invokes immediately, but the MCP request handlers are asynchronous and no queue establishes that they arrive in call order. Once the wait method is running in the renderer, it sends its BrowserChannel wait IPC before its first yielding await, and Electron preserves ordering for IPC sent by that renderer; this protects the subsequent renderer input only after the wait request itself has begun. A residual race remains if the click MCP request is dispatched first: its download takes the ordinary path (a Save dialog in an attached non-test instance) and the waiter times out. The implementation guide must state this until a runner-side ordering guarantee is added.
- **Download gate:** an armed wait does not turn an automatic download into a gesture. The first no-gesture download in a document remains the limiter's one free download; a trusted `site.click()` provides the user activation for further downloads. Tests must not bypass the gate through a second download handler.
- **Private downloads:** captured agent-opened incognito pages are permitted under the shared test-power predicate, but the completion must stay out of `recentDownloads.json` and general download UI. The runner attachment belongs only to its local test output.
- **One interception layer:** CDP download behavior/events must not be introduced alongside Electron `will-download`; the latter remains the sole owner because it already applies the limiter.
- **Size and timeout limits:** the 32 MiB cap intentionally bounds disk use and attachment size. The waiter timeout and outer MCP request timeout are separate; the guide and API help must explain how `.withOptions({ timeout })` extends the latter.
- **No new protocol:** use the existing BrowserChannel invoke/reply and `PendingRequests`; no custom event stream, token/ack protocol, or second correlator. Do not edit `BrowserWebviewModel.ts`, add board rules outside the board registries, use `await import()`, or add an import-zone wrapper.

## Acceptance Criteria

- `site.waitForDownload()` returns a promise; `const wait = site.waitForDownload(); await site.click("#export"); const file = await wait;` receives `{ suggestedFilename, path, size }`. Through the runner, `suggestedFilename` is the page-supplied `DownloadItem.getFilename()` value and `path` is the copied run-output path. The documented residual ordering race and its Save-dialog/timeout symptom are explicit until a guarantee is implemented.
- Captured downloads have no Save dialog in an owned `--test-instance` or an attached run. The app writes only into its fixed app-controlled temp capture root; no test/page-provided destination path is accepted.
- The runner copies captures into the run output directory (`--log-dir` or `test-results`), deletes the app-side copy, returns the run-output path, and attaches relative paths/metadata to `report.json`, `report.md`, and failure bundles.
- `waitForDownload` is gated by `agentMayUseBrowserTestPower()` from `src/renderer/editors/browser/agent-access.ts`; the same predicate/refusal introduced by US-2166 applies unchanged. A page without an armed waiter retains current behavior.
- `DownloadRequestLimiter.allow()` remains in force before capture. A gesture-triggered download consumes the actual activation; one automatic download per document remains free and further automatic attempts remain blocked.
- Exactly one waiter may be armed per browser page. A download already started before arming is ignored. Timeout, page close, navigation away, failed/cancelled download, and size overflow settle the call and clean up partial files.
- A captured file is limited to 32 MiB. Its app-side filename is sanitized and collision-safe; temp `.part` files are removed on all terminal paths. Startup cleanup removes every leftover `.part` file and non-part regular files older than 24 hours from the profile capture root.
- Captured downloads do not enter normal `DownloadRecord` notifications or `recentDownloads.json`, including private/incognito downloads. Other private-session behavior remains scoped to its page.
- The implementation uses Electron `will-download` only; it does not add `Browser.setDownloadBehavior` or `Page.downloadWillBegin`. It uses existing typed browser RPC and `PendingRequests`, with no new event channel or custom correlator.
- `BrowserWebviewModel.ts` and `src/shared/board-bridge-version.ts` are unchanged. The existing Bridge 1.61.0 history paragraph is extended for `waitForDownload`.
- The listed browser and web-app-testing guides explain capture usage, timeouts, output attachments, access, and privacy.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-2167-captured-downloads/README.md` | This implementation brief. |
| `doc/epics/EPIC-207.md` | Link US-2167 in the Linked Tasks table. |
| `doc/active-work.md` | Link the existing EPIC-207 US-2167 entry to this brief. |
| `src/renderer/api/types/browser-editor.d.ts` | Declare `waitForDownload` and its result/options; document the original page-supplied filename and runner-output path semantics. |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add the public member/help entry and delegate only. |
| `src/renderer/editors/browser/BrowserDownloadCapture.ts` | New renderer collaborator; apply the shared test-power gate and call the existing typed RPC. |
| `src/renderer/editors/browser/agent-access.ts` | No new download rule; reuse the predicate added by US-2166. |
| `src/renderer/automation/CdpSession.ts` | Add a typed BrowserChannel wait wrapper using existing invoke error handling. |
| `src/ipc/browser-ipc.ts` | Add one typed wait request/result and BrowserChannel invoke. |
| `src/ipc/main/cdp-handlers.ts` | Dispatch the wait through existing target validation/composition. |
| `src/main/cdp-service.ts` | Narrow composition and target validation only. |
| `src/main/download-service.ts` | Delegate eligible items after the limiter and URL-claim checks; keep ordinary handling unchanged. |
| `src/main/download-capture.ts` | New owner for waiters, safe app temp paths, named tuning constants, size cap, committed-navigation cancellation, finalization, and cleanup of stale captures at startup. |
| `src/shared/pending-requests.ts` | No changes; use the existing correlation/timeout/cancellation helper. |
| `src/main/browser/download-request-limiter.ts` | No changes; keep the existing per-document gesture gate. |
| `src/main/download-path-queue.ts` | No changes; captured downloads do not queue for Save dialogs. |
| `src/main/test-mode/downloads.ts` | No changes; its path applies only to owned test instances. |
| `src/test-host/captured-downloads.ts` | New runner owner for `fs.realpath` confinement, regular-file/size validation, runner filename sanitizing, exclusive copy, source deletion, and attachment metadata. |
| `src/test-host/context-operations.ts` | Capture the wait result into runner output before returning it to the test. |
| `src/test-host/context.ts` | Track attachments for the current test and pass the output directory to context operations. |
| `src/test-host/test-attempt.ts` | Carry test attachments into attempt/failure-capture state. |
| `src/test-host/test-file-run.ts` | Preserve attachments when building the final test result. |
| `src/test-host/test-result.ts` | Add attachment records to `TestResult`. |
| `src/test-host/results.ts` | Serialize relative attachment references in `report.json` and links in `report.md`. |
| `src/test-host/failure-bundle.ts` | Include relative download attachment references in the failure JSON. |
| `src/test-host/app-proxy.ts` | No changes; invocation starts immediately and `.withOptions()` already controls the outer call timeout. |
| `src/test-host/client.ts` | No changes; existing request timeout is passed through from the stand-in. |
| `src/shared/board-bridge-version.ts` | No changes; US-2165 already set 1.61.0 for EPIC-207. |
| `assets/guides/agents/boards/bridge-versions.md` | Extend the existing Bridge 1.61.0 paragraph, no new bump. |
| `assets/guides/agents/browser.md` | Document browser download capture behavior. |
| `assets/guides/agents/browser-automation.md` | Document the API, timeout, and capture semantics. |
| `assets/guides/agents/web-app-tests/index.md` | Document run output attachments and the size limit. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Show promise start/click/await and outer request timeout. |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md` | Explain capture/attachment behavior with `--attach`. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | No changes; roadmap §2.3 god file. |
