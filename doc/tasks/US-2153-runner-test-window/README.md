# US-2153: Runner test window for attached runs

**Epic:** [EPIC-204](../../epics/EPIC-204.md) · **Proposals:** A1, A2 · **Feedback:** [US-2138](../US-2138-web-app-test-feedback/README.md), items 13, 22, 23

## Goal

Give attached runs a test window, creating one by default or selecting an existing open window with `--window`. Scope test operations and runner cleanup to it while preserving owned-run behavior.

## Background

- EPIC-204 decisions 1–5 and 10 bind this plan. The review's A1/A2 (`doc/reviews/web-app-testing-review.md:76`) isolate bookkeeping and cleanup; item 13's retry/environment stop is US-2154, not this task. Item 22 asks for menu cleanup; item 23 records unrelated pages and dialogs being affected and listed (`doc/tasks/US-2138-web-app-test-feedback/README.md:38`, `:47`–`:48`). The roadmap puts this work before session pages and page-only failure bundles (`doc/reviews/web-app-testing-review.md:264`).
- `src/main/mcp/ai-vision/main-root.ts:112` implements `windows[i].open()` only for an existing record; `:183` has no create member. `src/main/open-windows.ts:105` creates a normal window and returns its record with a `whenReady` promise (`:119`); `:181` and `src/ipc/main/window-handlers.ts:48` provide an existing IPC-facing open method but no callable main-root create method. Add a main-root member using `createWindow()` and await readiness; no IPC or transport changes.
- Indexes identify records, not positions in the array: `src/main/open-windows.ts:105`–`:130`, `:210`–`:237`, `:252`–`:253` never renumber live records as other windows open or close. `:130` uses maximum current index + 1, so a removed highest index can be reused; a retained closed record can also reopen. `:356`–`:360` renumbers only while restoring at app startup. Capture the Electron `BrowserWindow.id` as a lifetime identity, not just the index.
- A normal close removes a non-last normal record only if saved pages are neither modified nor pinned (`src/main/open-windows.ts:210`–`:237`); otherwise it leaves a closed record. Last-window close may hide it (`:283`–`:301`). `src/main/open-window.ts:366` destroys a window and invokes `onClose`; `src/main/window-states.ts:24` deletes its state file, while `open-windows.ts:348` saves the record list. Explicit disposal is required for guaranteed no residue even with pinned/modified pages or failed per-test cleanup.
- `src/main/mcp/tools/call-tools.ts:43`–`:72` reserves the first segments `windows`, `main`, and `guides` for the main root; all other roots forward to a renderer. A `windows[i].` prefix selects the renderer, with main-owned window members handled locally. `src/main/mcp/ai-vision/main-root.ts:27`–`:31` lists the three main roots. `src/renderer/api/mcp/call-command.ts:7`–`:12`, `:29`–`:32` sees the peeled relative path and invokes `aiCall`, so `script.execute`, `window.screen`, `menus`, and `dialogs` work through the prefix. Attention, hint and event paths are prefixed on return (`call-tools.ts:319`–`:330`); `src/test-host/client.ts:79`–`:92` retains current attention decoding.
- `src/test-host/runner.ts:129` starts the client before the test loop and `:194`–`:203` tears down. `src/test-host/test-attempt.ts:49`, `:62`, `:65` take baseline, capture failure and clean up per attempt. `src/test-host/context.ts:62`, `:79`, `:93` call the client directly; `:132` and `:155` route wait and script through `call`. `src/test-host/browser-helpers.ts:18`–`:34` uses `context.call` for browser setup and navigation.
- All direct bookkeeping paths needing the scoped caller: `src/test-host/browser-helpers.ts:133` (`pages.all`), `:140` (browser `editor.popups`); `:242` (the common bounded call used by `:84` popup close; `:102`, `:106`, `:110` pin, unpin and page verification; `:171`, `:173`, `:175`, `:177` page close and pending dialog; `:193`, `:195` menu; `:208`, `:221`–`:222` dialog sweep). Failure capture uses image paths at `src/test-host/results.ts:85`, `:89`, `:112`; image bypasses `call` and must also be scoped. `src/test-host/launcher.ts:83` is owned-only shutdown, and `:169` is root-only profile verification, so neither becomes a test-window call.
- `src/test-host/context-setup.ts:18`–`:20` exposes `rawCall` and `listTools`; `integration-test/test-setup.mjs:34`–`:36` wraps it as `_getClient`, used by `integration-test/tests/core/mcp/mcp.test.mjs:60`, `:82`. The suite's launcher is `integration-test/run.mjs:338`–`:339` (`package.json:15`). Owned runs need the exact current raw behavior and the current client after restart. Attached setup raw calls need the selected-window scope; `listTools` stays global.

## Implementation Plan

- [x] **CLI and configuration.** In `src/main/test-mode/arguments.ts:21`–`:26`, detect `--window` and `--window=`, parse once as a nonempty string like `--grep` at `:76`–`:81`, reject duplicates/missing values and reject without `--attach` after parsing, independent of flag order. Propagate `window?: string` in `TestControllerArguments`, `src/main/test-mode/controller.ts:31`–`:51`, and `HostConfiguration` in `src/test-host/launcher.ts`. Pass the raw string unchanged to `windows.selectTestWindow`; the main-side selection owner alone interprets decimal digits as a non-negative safe integer index and other values as title substrings, and rejects unsafe numeric values. Numeric-only titles require index selection instead. No new controller/host protocol machinery: the existing JSON configuration already carries fields.

  ```ts
  // Before
  attach: options.attach,
  // After
  attach: options.attach, window: options.window,
  ```

- [x] **Main window operations.** Add `src/main/mcp/ai-vision/test-window-operations.ts` as owner of selection, creation and disposal rules, injected with the existing `openWindows`/`windowStates` collaborators. Add concise discoverable `windows.createTestWindow()`, `windows.selectTestWindow(selector)` and `windows.disposeTestWindow(index, windowId)` members and the read-only `windows[i].windowId` member via `WindowsNode` and `WINDOWS_MEMBERS` in `src/main/mcp/ai-vision/main-root.ts:44`, `:183`; `call-tools.ts:58` routes collection methods locally already. Add `windowId` to `WINDOW_MEMBER_NAMES` so it is answered locally; return no live id for a closed window. The member summaries identify these as web-app test runner operations. This is the complete added member set. Creation calls `openWindows.createWindow()`, captures both index and live `BrowserWindow.id`, and awaits `whenReady` before returning `{ index, windowId }`. The main-side operations module keeps the process-lifetime ownership set and records `{ index, windowId }` before awaiting readiness. Bound the wait; if readiness fails before the host receives the identity, the create operation checks identity and invokes the same disposal routine itself before rethrowing. Selection receives the raw string and alone decides index versus title; it checks only open, non-destroyed windows; index requires an exact record, title uses `BrowserWindow.getTitle().toLocaleLowerCase().includes(selector.toLocaleLowerCase())`. Return only `{ index, windowId }` for one match or `{ count }` otherwise, never names, pages or other indexes. The title is the OS window title, not a tab title: `src/renderer/ui/app/MainPageView.ts:45` appends the profile to `document.title`; normal windows may have identical titles.

  Disposal is callable only for a window created by this operation and only with the matching live identity; track owned identities in the operation owner, never allow disposal of a selected or replacement window. After per-test page cleanup, destroy the owned window with `OpenWindow.close()` and remove its exact record and state using a narrowly scoped `openWindows` lifecycle method that reuses `windowStates.deleteState` and `saveState`; handle the `onClose` callback idempotently, including a retained closed record. Never remove a replacement record. If the user already closed it, the required live-identity check fails: report the setup-style failure and do not dispose a retained or replacement record. A closed record may therefore remain in that exceptional case. Report disposal failure as a run setup/cleanup failure, not silent success. Account for the user closing other windows, close cancellation, timeouts, failed baseline, setup errors and exceptions; disposal belongs in run-level `finally` before the client is disconnected. Do not force-close selected windows or discard their page state.

  ```ts
  // Before: windows[i].open() reopens an existing window; no collection create member.
  await client.call(`windows[${index}].open`, []);
  // After: create once, obtain both identities, then target the returned window.
  const { index, windowId } = await client.call("windows.createTestWindow", []);
  ```

- [x] **Single scope owner.** Add `src/test-host/test-window.ts`, owning mode (`owned`, `attached-created`, `attached-selected`), creation/selection, lifecycle identity validation, and all path scoping. Reuse `ai-vision` `parsePath`/`formatPath` rather than substring parsing: preserve first-segment `windows`, `main`, `guides`, including explicit `windows[...]`; scope every other path to `windows[index].<path>`. An omitted or empty path maps to `windows[index]` (the main window descriptor, because `windows[i].$help` and `windows[i].$describe` are main-owned); explicit root-only paths remain reachable. A relative `$help`/`$describe` under this mapping describes the window node, not the full renderer root; document that distinction. `ctx.root` is a separate proxy using the original unscoped call and the existing `createAppProxy`; `ctx.app` uses the scoped proxy. Explicit `ctx.app.windows[...]` remains an intentional escape, as required by the epic. Preserve proxy handle metadata and avoid double-prefixing returned `windows[...]` paths. Keep owned scope a no-op, including omitted paths and the exact setup raw calls.

  A live record's index does not shift. Change `src/main/open-windows.ts:130` to a monotonic high-water mark initialized from restored records so newly created windows cannot inherit a removed record's index. Keep existing user-facing reopen behavior unchanged; a retained closed record can still reopen under the same index with a different Electron id. The owner checks `windows[i].windowId` against the captured id once before each test attempt's baseline and once immediately before run-final disposal; it does not add a check or round trip to every call. On a missing, closed or replaced target stop the whole run with setup-style failure `The test window was closed or replaced; the run stopped.`; do not fall back to the default window. This does not prevent a user closing and reopening the same retained record between a check and a later call; US-2154 will later classify the detected condition as an environment stop.

  ```ts
  // Before: context uses the current client directly.
  await active.call(apiPath, args, timeout, maxLength, dialog, allowNavigation);
  // After: the one window owner resolves and scopes all test calls.
  await testWindow.call(active, apiPath, args, timeout, maxLength, dialog, allowNavigation);
  ```

- [x] **Context, setup and attempt plumbing.** In `src/test-host/context.ts`, route call, callText, set and both scoped proxy/handle operations through the owner; preserve existing logging, error handling, wait and script behavior. Add `root` to `TestContext`; construct its proxy with unscoped calls. In `src/test-host/context-setup.ts`, pass the scope owner into `loadContextSetup`'s returned adapter; `rawCall` scopes attached paths, forwards all raw options/response unchanged and retrieves the current client on every call. Keep `listTools` untouched. Wire the owner through `src/test-host/runner.ts` and `src/test-host/test-attempt.ts`, retaining the `launcher.client ?? client` replacement semantics for owned restart. Check identity once before `beginPageOwnership`; propagate the closed/replaced condition out of `runAttempt` and the test/retry loops as a run-level setup failure, rather than recording it as an ordinary failed test or retrying it. Resolve the attached window after `launcher.start()` and before any test or baseline; on zero matches throw `--window matched 0 open windows.`; on multiple matches throw `--window matched N open windows; specify an index or a more specific title.` Report counts only, no title, index list or page data. Register disposal as soon as creation returns its identity, even when later setup fails. If the creation readiness wait fails before the identity can be returned, the main-side create operation disposes it as described above.

  ```ts
  // Before
  const app = createAppProxy(proxyCall, beforeProxyCall, onProxyError);
  // After: both use the existing proxy implementation and logging hooks.
  const app = createAppProxy(scopedProxyCall, beforeProxyCall, onProxyError);
  const root = createAppProxy(unscopedProxyCall, beforeProxyCall, onProxyError);
  ```

- [x] **Run-final disposal.** In `src/test-host/runner.ts:194`-`:203`, keep the following order: (a) per-test cleanup has already finished in `runAttempt`'s `finally`; (b) for an attached-created window, check its live `windowId` against the captured id; (c) call `windows.disposeTestWindow(index, windowId)` only if it matches; (d) then `launcher.stop()` and `launcher.close()`. Selected windows are never disposed. Record an identity or disposal error with `setupFailure ??= error` while still executing later teardown and reporting steps. If `launcher.start()` succeeded but the creation readiness wait fails before the host receives an identity, the main-side `createTestWindow()` catch performs the same identity-checked disposal before returning the failure; the runner still executes step (d). Do not rely on a host identity that was never returned.

  ```ts
  // Before: shutdown follows the test loop.
  await launcher.stop();
  // After: disposal is attempted first, but a failure does not skip shutdown.
  try { await testWindow.disposeCreatedWindow(); } catch (error) { setupFailure ??= error; }
  await launcher.stop();
  ```

- [x] **Bookkeeping and capture.** Make `beginPageOwnership`, `readSnapshot`, `boundedCall`, `snapshotOwnedPages`, and `captureTarget` in `src/test-host/browser-helpers.ts` and `src/test-host/results.ts` use the same owner for `call` and `image`; keep timeouts, dialog flags, image parsing, errors and logs. Sweep menu and dialogs in all three modes, including both attached modes, using the existing `sweepRendererDialogs`. Pass `ownedPages` only for `attached-selected`, preserving its owned-only page and popup cleanup; use the existing baseline diff for owned and attached-created windows. Never inspect another window's pages. Keep the currently scoped window screenshot for this task; page-only attached capture and its privacy bundle are explicitly US-2156 (EPIC decision 8). Scope any test-written explicit cross-window path exactly as the existing grammar specifies; it is deliberate test access, not runner bookkeeping.

  ```ts
  // Before: attached means skip sweep and restrict page ownership.
  const sweep = attached ? noSweep : sweepRendererDialogs;
  // After: every test window is swept; ownership depends on who owns the window.
  const sweep = (phase) => sweepRendererDialogs(scopedClient, log, cleanupTimeout, phase);
  const ownedPages = testWindow.mode === "attached-selected" ? context._state.ownedPages : undefined;
  ```

- [ ] **Documentation and verification.** Update `assets/guides/agents/web-app-tests/index.md:152`–`:165`, `:196`–`:208` and `doc/standards/integration-tests.md:130`–`:158`: flags, title/index matching and count-only errors, `ctx.root`, setup raw calls, explicit user-window cleanup consequences, created-window disposal, owned-run invariance and attached screenshot's current test-window scope. Explain title collisions and recommend numeric index when titles match. Add these guide sentences: "Awaiting `ctx.app` with no path describes the selected window, not the renderer overview." and "Prefer unprefixed paths; `ctx.root` and explicit `windows[i]` paths can reach outside the test window." After implementation Codex runs `npm run lint` and `npm run typecheck`; Claude runs `npm run guides:check` (Codex encounters EPERM) and the live verification. Do not add unit tests or harnesses. Exercise two open windows, both selectors and error counts, all context APIs including raw setup and image capture, menu/dialog sweep, pinned/modified and failed-cleanup disposal, selected-window preservation, index reuse/reopen and owned suite/restart.

## Concerns resolved

1. **Can existing calls create a window?** `windows[i].open()` only reopens one (`main-root.ts:112`); `openWindows.createWindow()` is the existing creation helper. Add callable collection members through the existing call tree, no IPC channel.
2. **Can indexes shift?** No for live records, but removal and reopen can reuse an index. Pair the index with `BrowserWindow.id` and keep allocation monotonic. Check identity before each attempt and before final disposal; stop rather than fall back if the window is closed or replaced. Reopening a retained record is unchanged, so a close/reopen between checks is a known race; no per-call check is added.
3. **Can normal close leave a closed entry?** Yes, for modified/pinned pages and last-window behavior (`open-windows.ts:210`, `:283`). The main lifecycle owner explicitly destroys and deletes the runner-created record/state after page cleanup when its live identity still matches, including after other failures; selected windows never enter this disposal path. If the user already closed it, the identity check stops disposal and a retained record may remain.
4. **What is global?** `windows`, `main`, `guides` are the only main root members (`main-root.ts:27`; `call-tools.ts:55`–`:56`). Explicit window paths pass through. An empty forwarded path with a `windowIndex` could reach a renderer overview (`call-tools.ts:51`-`:53`), but the current test-host `rawCall` does not expose `windowIndex` (`src/test-host/client.ts:49`-`:57`), and `windows[i]`, `windows[i].$help` and `windows[i].$describe` resolve locally (`call-tools.ts:58`-`:61`). Keep the empty scoped call mapped to the window node and document it; add no routing code. `ctx.root` is the full unscoped stand-in.
5. **How are titles selected?** Match `BrowserWindow.getTitle()` as a unique case-insensitive substring among open windows, returning only a count on failure. Errors are the two exact strings in the context step above. Index means the `windows[i]` record index, never array position.
6. **What if a dialog belongs elsewhere?** The routed renderer and its menu/dialog sweep are the selected window only. Native attention can still interfere; bounded retry and environment-stop classification belong to US-2154. Do not sweep other windows to resolve it.
7. **Do setup and the suite depend on the old behavior?** Yes: the raw adapter is directly used in the UI suite. Preserve it byte-for-byte in owned mode and bind attached calls to the chosen window. `listTools` and the dynamic getter remain global/current. The suite can run attached: `integration-test/run.mjs:20`-`:25`, `:63`, `:338`-`:339` accepts and forwards `--attach` alongside its setup module. Its `_getClient().rawCall` paths become test-window scoped in that mode; ordinary owned `npm run test:ui` remains unchanged. The wrapper does not accept `--window` (`:20`).
8. **Guardrails.** The new test-host module owns scoping and reuses `parsePath`/`formatPath` and `createAppProxy`; the main collaborator owns selection, identity and created-window disposal and reuses `openWindows` and `windowStates`; existing cleanup owns the sweep. No new protocol, board rules, import-zone workaround or growth in a roadmap §2.3 god file. Do not add `await import()` to evade import direction. No `window.persephone` change is planned; if one becomes necessary, bump `BOARD_BRIDGE_VERSION` and add its history line. Strict-folder null fixes are type-only unless a runtime change is separately recorded.

## Acceptance Criteria

- [ ] `--attach` creates one ready test window; `--attach --window <index-or-title>` selects exactly one already-open window; malformed flags and zero/ambiguous matches fail before tests with count-only errors.
- [ ] All listed context, setup raw, baseline, cleanup and image calls target that window; root-only paths and `ctx.root` remain unscoped. Other windows' page details are not read or logged by bookkeeping.
- [ ] Closing/opening other windows does not change the live target index. Closure or replacement detected before an attempt or final disposal stops the run with the specified setup failure; the documented between-check race remains.
- [ ] Menu and renderer-dialog sweeps run only in the test window. Created-window cleanup uses the baseline diff; selected-window cleanup closes only tracked pages and popups and never closes the window.
- [ ] The created window is closed after page cleanup on success and recoverable failures while its live identity matches, without an open or persisted closed record/state; a closed or replaced target stops disposal and is reported. Owned runs and UI suite restart/raw behavior remain unchanged.
- [ ] Codex runs lint and typecheck; Claude runs guides check and verifies the live scenarios above. No unit tests or harnesses are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/main/test-mode/arguments.ts`, `controller.ts`; `src/test-host/launcher.ts` | Parse and propagate `--window`. |
| `src/main/mcp/ai-vision/main-root.ts`, new `test-window-operations.ts` | Discoverable create/select/dispose and read-only identity members through existing call routing; approximately +20-30 net lines in `main-root.ts`, with substantive rules in the new collaborator. |
| `src/main/open-windows.ts` | Monotonic high-water allocation and at most one exact-record/state removal method; approximately +15-25 net lines, with no reopen-behavior change. |
| New `src/test-host/test-window.ts` | Single run-level window and scoped call/image owner. |
| `src/test-host/runner.ts`, `test-attempt.ts`, `context.ts`, `context-setup.ts` | Run lifecycle, scoped contexts, setup and attempts. |
| `src/test-host/browser-helpers.ts`, `results.ts` | Scope all bookkeeping and image paths; restore test-window sweep and correct ownership mode. |
| `assets/guides/agents/web-app-tests/index.md`, `doc/standards/integration-tests.md` | Document behavior and compatibility. |

**No changes planned:** `src/test-host/app-proxy.ts` (reuse its existing proxy), `client.ts` (reuse call, rawCall, set and image), `index.ts`; `src/main/mcp/tools/call-tools.ts` and `src/renderer/api/mcp/call-command.ts` (existing routing); `src/ipc/main/window-handlers.ts`, IPC protocol and bridge; `integration-test/` suite and setup; dashboard and epic. Existing renderer `script`, `window.screen`, menu and dialog APIs need no changes.

