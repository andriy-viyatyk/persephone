# US-2154: Attention from other windows: retry, then environment stop

## Goal

Implement [EPIC-204](../../epics/EPIC-204.md) decision 6: retry unexpected attention, then stop for an environmental obstruction while preserving test-window attention as a named test failure.

## Background

US-2153 is the prerequisite and its reviewed design is authoritative while its files are being edited: `src/test-host/test-window.ts` owns the stable test-window identity and path scoping, including `owned`, `attached-created`, and `attached-selected` modes and `ctx.root`.

- Attention is not proof that an action was skipped: `src/renderer/scripting/ai-vision/attention.ts:82`–`:112` races a started action with a pending dialog and also attaches attention to completed results. `src/main/mcp/tools/call-tools.ts:411`–`:447` emits attention alongside result or pending blocks. Retrying such a reply can repeat an executed or still-running action; only side-effect-free runner reads can safely be repeated.
- `routeCallPath` routes `windows[i].<renderer member>` to window `i` and `main`, `guides`, collection/window-owned members locally (`src/main/mcp/tools/call-tools.ts:43`–`:72`). Only forwarded calls collect attention: the renderer is the target, and `getNativeDialogAttention` is queried **after** forwarding for that same target (`:273`–`:317`; `src/main/native-dialog-tracker.ts:125`–`:159`). Unprefixed renderer calls use the first open non-board window (`call-tools.ts:274`–`:276`); root `windows.*`/`main.*` calls answered locally do not receive this attention. A different window's renderer or tracked native dialog is not scanned. Process-wide/OS dialogs not tracked against the target have no guaranteed attention signal; do not claim detection. Explicit `ctx.root.windows[j]` can intentionally target another window.
- `src/test-host/client.ts:73`–`:104` checks server errors before attention, accepts pending/attention when dialog is allowed, and otherwise throws; `:63`–`:71` image calls ignore attention. `src/test-host/browser-helpers.ts:54`–`:70`, `:193`–`:242` use dialog-allowed calls for menu/dialog sweep and catch cleanup errors; `src/test-host/results.ts:91`–`:126` catches capture errors. Preserve deliberate dialog handling, but never swallow a typed environment stop in cleanup or capture.
- `src/test-host/timeouts.ts:3`–`:6` sets `poll` to 200 ms by default, scaled by `--timeout-scale`. `src/test-host/results.ts:130`–`:172` serializes statuses and overwrites version-1 `last-failed.json`; `src/test-host/runner.ts:155`–`:162` retries failed attempts and `:194`–`:243` reports/returns 1 for failures. `src/test-host/index.ts:10`–`:27` and `src/main/test-mode/controller.ts:59`–`:71` pass through the code; `integration-test/run.mjs:231`, `:354`–`:365` uses 2 for its own CLI errors and currently treats every nonzero product code without failed results as a setup failure. Code 3 is free in these paths.

## Implementation Plan

This plan builds on US-2153, even where today's source differs. No protocol, board rule, `window.persephone` member or bridge version changes; no import-zone exception, dynamic-import workaround, new harness or unit tests. The new attention policy has one owner; runner and report changes consume its typed outcome. Runtime changes below are intentional, not incidental null-check fixes.

- [x] **Classify attention in one place.** Add the short `src/test-host/attention-policy.ts` as owner of `EnvironmentStopError` (code `ENVIRONMENT_STOP`) and a helper returning `inside`, `outside`, or `unknown` and a one-line cause. A separate small module lets client decoding, scoped bookkeeping, and the window identity check reuse the rule without a circular dependency on the US-2153 scope owner. Reuse US-2153 `test-window.ts` for the captured window index and scoped/routed target, and its existing path parsing for explicit `windows[j]`; do not build prefixes at call sites. Explicit native text `is open in window N` identifies N; a renderer reply routed to a known window identifies that window. A different identified native index or a reply routed to a different explicit window is outside; a known test-window source is inside; an unidentifiable source is unknown. If a reply combines sources, any positively identified outside source takes precedence to avoid leaking its title. Outside errors use the generic `A dialog or popup menu requires attention in another window.` and never include raw outside attention, titles or page details. For inside attention, extract the existing renderer dialog title when present and produce `A dialog is open in the test window: <title>`; use `A dialog is open in the test window` without a title, or `A popup menu is open in the test window`. Preserve a useful generic one-line cause for other attention.

  ```ts
  // Before: a leading attention block is an ordinary error with raw reply only.
  if (!allowDialog) throw new Error(`${step} returned unexpected attention. Raw reply: ${raw}`);
  // After: use the shared classifier; do not replay test calls.
  const attention = classifyAttention(block.text, routedTarget, testWindow.index);
  if (attention.origin === "outside") throw new EnvironmentStopError(attention.cause);
  if (!allowDialog) throw new Error(`${attention.cause}\n${step} returned unexpected attention. Raw reply: ${raw}`);
  ```

- [x] **Retry only runner bookkeeping reads.** In `src/test-host/browser-helpers.ts`, have one small helper wrap the existing scoped call for `readSnapshot`'s `pages.all` and per-browser `editor.popups`, baseline through `beginPageOwnership`, and cleanup's `pages.all` re-reads in `closeOwnedPage` and `closePagesOpenedSince`. Reuse the existing bounded call and `timeouts.poll` from `src/test-host/timeouts.ts`; retry the same read up to three times after an attention reply, waiting `poll` between retries (default 200 ms, 600 ms total waiting; scaled by `--timeout-scale`). A clear reply returns the read result. On persistent inside attention, preserve a named failure or let the existing cleanup sweep deal with it; on persistent outside or unknown attention throw `EnvironmentStopError` with a generic cause. Preserve the original cleanup timeout and make sure attention is visible to this read helper even where the existing call uses `dialog: true`; do not change the sweep's intentional dialog handling. No test call, action, set, image, pending call or arbitrary read is retried.

  ```ts
  // Before: one scoped runner snapshot read.
  const pages = await boundedCall(client, "pages.all", undefined, timeout, true);
  // After: only this runner-owned, side-effect-free read gets bounded attention retries.
  const pages = await readWithAttentionRetry(() => boundedCall(client, "pages.all", undefined, timeout, true));
  ```

- [x] **Test calls and error propagation.** In `src/test-host/client.ts`, reuse the classifier at the existing unexpected-attention decode branch for `ctx.app`, `ctx.call`, `callText`, `set`, and waits routed through it. Preserve `isError` ordering, pending and `dialog: true` semantics, raw setup adapter, and image behavior. Test calls are never replayed: an inside or unknown attention reply fails with a one-line cause followed by the raw reply; a positively identified outside reply raises `EnvironmentStopError` with a generic cause only. Pass the target identity from US-2153's scoped and `ctx.root` callers; the helper must distinguish an explicit different `windows[j]` route. An intentional `dialog: true` call still handles test-window dialogs as today, but an identified outside attention must not be accepted as an in-window dialog. In `src/test-host/browser-helpers.ts` catches at `:65`, `:86`, `:113`, `:143`, `:197`, `:209`, `:227`, and `src/test-host/results.ts:91`, `:123`, rethrow the typed stop before existing error handling; do the same for any context wait catch that would swallow it. Keep ordinary errors and cleanup behavior unchanged.

  ```ts
  // Before: cleanup converts every exception to a string.
  catch (error) { errors.push(`Could not inspect browser pages for cleanup: ${errMessage(error)}`); }
  // After: do not hide a run-level stop.
  catch (error) {
      if (error instanceof EnvironmentStopError) throw error;
      errors.push(`Could not inspect browser pages for cleanup: ${errMessage(error)}`);
  }
  ```

- [x] **Attempt and run outcome.** In `src/test-host/test-window.ts`, change both US-2153 per-attempt and pre-disposal identity failures to `new EnvironmentStopError("The test window was closed or replaced; the run stopped.")`; keep its pre-attempt and final disposal identity checks and never dispose a replacement. `src/test-host/test-attempt.ts` propagates this error from baseline, setup, test, capture and cleanup; skip failure screenshots for an environment stop, and run only the existing scoped best-effort cleanup if identity remains valid. Ensure cleanup cannot overwrite an earlier environment stop; retain/log any separate cleanup failure. In `src/test-host/runner.ts`, catch the typed error around attempts before `test.fails` and `--retries` classification; no test retry or expected-failure conversion. Finish run-level teardown and reports in `finally`, preserving the environment cause even if disposal also fails (record separate setup/cleanup failure). Record the interrupted test as `not-run` with its elapsed duration, no failure screenshot; append `not-run` records with zero duration for every remaining selected identity in selection order, including would-be skipped tests because execution stopped before their classification. Preserve already completed results. If stop happens before an attempt, mark all selected identities `not-run`; if only run-final identity check fails after all tests, preserve completed results and report a run-level stop with no fabricated interrupted test.

  ```ts
  // Before: attempt errors enter normal failure / retry processing.
  finalAttempt = await runAttempt(input);
  // After: propagate the run outcome independently of test modifiers and retry count.
  try { finalAttempt = await runAttempt(input); }
  catch (error) {
      if (!(error instanceof EnvironmentStopError)) throw error;
      environmentStop = error.message;
      // Record this identity and remaining selected identities as not-run, then leave both loops.
  }
  ```

- [x] **Reports and rerun selection.** `src/test-host/results.ts` owns the schema: extend `TestResult.status` with `"not-run"`, add `summary.notRun` and optional run-level `environmentStop: string` to `report.json`; render the cause and not-run count/status in `report.md`, console, and run-summary log. Keep all existing status and summary fields. On an environment stop, write version-1 `last-failed.json` with this run's `failed`, `unexpected-pass`, and `not-run` identities; on a normal run keep the existing failed/unexpected-pass selection. Do not read or merge a previous file. Explain that `not-run` means the interrupted test may already have changed state.

  ```ts
  // Before
  const failedForRerun = results.filter((result) => result.status === "failed" || result.status === "unexpected-pass");
  // After
  const failedForRerun = results.filter((result) => result.status === "failed" || result.status === "unexpected-pass"
      || (environmentStop && result.status === "not-run"));
  ```

- [x] **Exit and suite wrapper.** Return 3 for environment stop, taking precedence over ordinary test failure 1, while reporting both if both occurred; `index.ts` and `controller.ts` already forward it. In `integration-test/run.mjs:354`–`:377`, read the complete product report (the current `productReport` expression extracts only `retainedApp`), recognize product code 3 and its `report.json.environmentStop`, stop scheduling further modules, mark their still-selected identities `not-run`, preserve earlier results, print the cause and exit 3 after teardown. A code 3 without a valid cause is a setup failure, not a fabricated environment stop. Update `integration-test/lib/aggregate-report.mjs` to retain `not-run`, count it, expose and render `environmentStop`, and write this run's failed and, on an environment stop, not-run identities to version-1 `last-failed.json`; do not merge prior files. Do not synthesize failed results from an environment stop or discard existing wrapper skips. These changes are necessary because `run.mjs:362` otherwise throws and `aggregate-report.mjs:37`–`:45` fabricates failures for missing identities.

  ```js
  // Before
  if (exitCode !== 0 && !collected.some((result) => result.status === "failed")) throw new Error(...);
  // After
  if (exitCode === 3 && productReport.environmentStop) { environmentStop = productReport.environmentStop; break; }
  if (exitCode !== 0 && !collected.some((result) => result.status === "failed")) throw new Error(...);
  ```

- [x] **Guides.** Add after US-2153's cleanup/triage text in `assets/guides/agents/web-app-tests/index.md` and `doc/standards/integration-tests.md`:

  ```md
  The runner retries its own page bookkeeping reads up to three times when attention is present,
  200 ms apart by default (scaled by `--timeout-scale`); it never replays test calls. Attention in
  the test window fails the test with its cause. Attention identified in another window, persistent
  unidentifiable attention on a runner read, or a closed/replaced test window stops the run (exit 3).
  The interrupted test and remaining selected tests are `not-run`; the interrupted test may already
  have changed state. After a stop, `--rerun-failed` selects the failures and tests that did not run.
  The report names the cause. Untracked OS-level dialogs may not produce an attention reply.
  ```

- [ ] **Verification by implementer and Claude.** Implementer runs `npm run lint` and `npm run typecheck`; Claude runs `npm run guides:check` and these live checks: leave a dialog or menu in the test window and confirm the test names the cause and cleanup sweeps it; close the test window mid-run and confirm environment stop, exit 3, not-run results and rerun file; call explicit `ctx.root.windows[j]` while window `j` has a dialog and confirm a generic environment stop without its title. Untracked OS-level dialogs may not produce attention and are a documented limitation.

## Concerns resolved

1. **Does attention imply a call was blocked?** No: `attention.ts:82`?`:112` can attach it after execution or race an ongoing call, and `call-tools.ts:286`?`:317` adds native attention after forwarding. Retry only the runner's side-effect-free bookkeeping reads; never replay test calls.
2. **Can another window contaminate a scoped call?** Current routing queries only the target renderer and its native tracker. US-2153 therefore resolves item 13 for scoped calls. Explicit root/window paths can target another window. Untracked OS/process-wide dialogs have no guaranteed attention signal.
3. **What if origin is uncertain?** On a persistent runner read, stop the environment; on a test call, keep the existing test failure and name the attention. A positively identified outside source always stops with a generic cause and no outside titles.
4. **How can a stopped test be not run after starting?** `not-run` means no reliable outcome; retain elapsed time and explain that effects may have occurred. Already completed failures remain failures.
5. **What is rerun after a stop?** The version-1 rerun file contains this run's failed and not-run identities, without merging a prior file.
6. **Why exit 3?** The host/controller forward the runner value, failure uses 1, and the integration wrapper uses 2 for argument errors. The wrapper must recognize 3 and avoid fabricating setup failures.

## Acceptance Criteria

- [ ] A test-window dialog or menu fails the test with a named one-line cause; intentional dialog handling and cleanup still work.
- [ ] Runner bookkeeping reads alone retry attention up to three times with the scaled poll delay; persistent outside or unknown attention stops the run. Test calls are never replayed and identified outside attention stops with a generic cause.
- [ ] A closed/replaced test window stops the run; no fallback or replacement-window disposal occurs.
- [ ] Interrupted and remaining selected tests are `not-run`; completed outcomes and teardown errors remain visible. Reports, logs and console show the cause and count; exit 3 propagates through direct and integration runs.
- [ ] After an environment stop, version-1 `last-failed.json` includes this run's failed and not-run identities, with no prior-file merge.
- [ ] Scoped cleanup does not operate outside the test window; caught environment stops propagate. No new protocol or bridge change is introduced.
- [ ] Implementer lint/typecheck and Claude live runs/guides check pass; no unit tests or test harnesses are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/test-host/attention-policy.ts` | New short owner for attention classification and typed stop. |
| `src/test-host/test-window.ts` | Supply stable identity/routed target and emit identity stop; reuse existing scope machinery. |
| `src/test-host/client.ts` | Classify existing unexpected-attention replies; preserve raw adapter, image and pending behavior. |
| `src/test-host/browser-helpers.ts` | Retry runner bookkeeping reads and propagate stops from cleanup catches. |
| `src/test-host/context.ts` | Preserve typed stop through wait and scoped/root call handling where caught. |
| `src/test-host/test-attempt.ts` | Propagate stop, preserve cleanup and avoid false capture. |
| `src/test-host/runner.ts` | Stop selection, record not-run and console/exit outcome. |
| `src/test-host/results.ts` | Report schema, cause and current-run rerun selection. |
| `integration-test/run.mjs` | Propagate environment stop across modules and exit 3. |
| `integration-test/lib/aggregate-report.mjs` | Aggregate not-run/cause and current-run rerun selection. |
| `assets/guides/agents/web-app-tests/index.md` | User-facing attention and rerun guidance. |
| `doc/standards/integration-tests.md` | Runner outcome and integration wrapper guidance. |

**Files needing no change:** `src/renderer/scripting/ai-vision/attention.ts`, `src/main/native-dialog-tracker.ts`, `src/main/mcp/tools/call-tools.ts` (existing producer/routing behavior); `src/test-host/timeouts.ts` (reuse poll); `src/test-host/index.ts`, `src/main/test-mode/controller.ts` (already forward exit); board registries, shared board rules and bridge version (no bridge change); `doc/epics/EPIC-204.md` and `doc/active-work.md` (entry already exists).
