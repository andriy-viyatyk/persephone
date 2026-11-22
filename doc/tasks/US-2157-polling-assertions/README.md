# US-2157: Polling assertions and wait messages

## Goal

Add async polling assertions and wait messages under [EPIC-205](../../epics/EPIC-205.md), decisions 2–4. Keep existing UI integration tests working unchanged and make failures concise and located at the test's awaited assertion.

## Background

The [web-app testing review](../../reviews/web-app-testing-review.md) §3B identifies repeated `waitFor` plus assertion sequences; §5 places B2 in roadmap step 3. EPIC-202 introduced matchers and located failures (US-2147, US-2149); EPIC-203 improved call errors; EPIC-204 introduced test-window scoping and environment stops. The linked US-2147–US-2156 task documents describe those changes. EPIC-205 already links this task, and `doc/active-work.md` already lists it.

`src/test-host/context.ts` currently owns a `do`/`while` loop. `createHostTimeouts` in `src/test-host/timeouts.ts` scales the 10,000 ms default wait and 200 ms poll delay; `waitFor` scales and rounds an explicit timeout once. It logs `wait-start`, `wait-result`, or `wait-error`, increments `quietDepth` around polling, returns the matching value, forwards `maxLength`, `dialog`, and `allowNavigation` on path reads, and propagates callback and predicate errors immediately. Its timeout uses `JSON.stringify(value)`. Nested calls update `state.step` and may record their own errors even when quiet; restoring the outer wait step is therefore necessary.

`src/test-host/expect.ts` exports `ExpectMatchers` and `createExpect` and internally uses `makeSide` and the `MATCHERS` list. `check` tracks argument/assertion steps and `markFailure` remembers the first step on an error; `match` runs the predicate and throws `assert.AssertionError` on mismatch. `assertSafe` rejects stand-ins and `safePreview` avoids accessors/cycles and caps output at 300 characters. Several matchers have specific argument validators; `toHaveProperty` distinguishes an omitted expected value from explicit `undefined`, and regex matchers restore `lastIndex`. `toThrow` requires a synchronous function *sample* as well as validating its optional matcher argument. All these semantics must be shared, not duplicated.

In `src/test-host/app-proxy.ts`, awaiting a stand-in calls the path; `McpClient.serverError` in `src/test-host/client.ts` turns an error response such as `"app" is not a member` into an ordinary `Error`, optionally adding a `$help` suggestion. There is no reliable missing-member type to filter on. A poll callback's ordinary thrown/rejected errors are therefore retryable, including navigation errors; `EnvironmentStopError` from `src/test-host/attention-policy.ts` must escape unchanged. `waitFor` retains its existing immediate-error behavior.

`TestContext.expect` is a method type in `src/test-host/context.ts`, used by `TestDescriptor.run` in `src/test-host/test-api.ts`; runtime `.mjs` tests use the same context. `CallOptions` is declared in `src/test-host/app-proxy.ts`, re-exported by `context.ts`, and also used for calls and stand-in `withOptions`; a wait-only message belongs on a separate extending type, not that shared call type. `src/test-host/source-location.ts` selects the first stack frame in the test file; `src/test-host/test-attempt.ts` reports that location and uses `_state.stepOf` after a catch. A timeout created after an async delay cannot rely on its own stack retaining the original test frame.

The scale travels from `src/main/test-mode/arguments.ts` through `src/main/test-mode/controller.ts` to `HostConfiguration` in `src/test-host/launcher.ts`, then `src/test-host/index.ts` / `runner.ts` and `createHostTimeouts`. No new CLI option is needed. `src/test-host` is not listed in `scripts/typecheck-strict.mjs`; the existing `npm run typecheck` strict gate must still pass. `npm run test:ui` invokes `integration-test/run.mjs`, with tests in `integration-test/tests/`.

## Implementation Plan

- [x] Extract the loop from `src/test-host/context.ts` into a new `src/test-host/poll.ts`, the **single owner of host polling**: deadline, sample count, timeout scaling, sleep bounded by remaining deadline, quiet scope, and one start/result/error log pair. Inject the existing `timeouts`, `TestLog`, identity, step/markFailure, and quiet-depth operations; reuse `resultPreview` from `src/test-host/test-log.ts`, `errMessage` from `src/shared/utils.ts`, and `safePreview` from `expect.ts`. Keep `context.ts` shorter than before, and do not change `runner.ts`. Use normal static imports in the allowed direction; no protocol or bridge changes.
- [x] Have the owner accept caller-provided read and match functions plus an explicit error policy. For existing `waitFor`, preserve string/callback handling, path call options, predicate behavior (including awaited predicates), first sample, returned value, log event fields, and immediate propagation of read/predicate errors. Always balance `quietDepth` in `finally`, including nested waits and exceptions; set the outer step before its final success/failure and mark the final error. `WaitOptions extends CallOptions` adds `message?: string` only to `waitFor`; keep other `CallOptions` consumers unchanged. Widen the callback and predicate types to accept synchronous as well as promise results, matching runtime behavior.
- [x] Format wait timeout as before with `safePreview(value)` replacing `JSON.stringify(value)`; prepend `message` and a newline only when supplied. Keep the existing `Timed out after N ms waiting for target; last value: …` text otherwise. Keep `state.error` and `wait-error` consistent with the thrown message.
- [x] Refactor `src/test-host/expect.ts` so one matcher definition/dispatch path owns argument validation, value validation and predicate evaluation for **both** ordinary and polling assertions. Extract matcher preparation/evaluation to a focused collaborator if useful: validate arguments and `assertSafe(expected)` once when the matcher is invoked, then evaluate each sample with the same existing predicates, negation, property-presence distinction and regex handling. Preserve `createExpect`'s synchronous API, `check` step names, `AssertionError`, unknown matcher diagnostics, safety checks, and ordinary matcher behavior. Validate the `toThrow` sample as a function per sample; do not classify validation or predicate implementation errors as callback errors and silently retry them.
- [x] Add `src/test-host/poll-expect.ts` as owner of the async matcher adapter. Expose a callable `Expect` type with `poll(fn, options)` and a mapped `PollMatchers` type mirroring every `ExpectMatchers` method with `Promise<void>` returns and recursive `.not`. Build the runtime function with its `poll` property in `context.ts`; retain ordinary `ctx.expect(value, message)` behavior. Reject a non-function callback and invalid matcher arguments before the first sample. Invoke `fn(ctx)` on every sample, awaiting sync, promise, and awaitable stand-in results. Reuse the prepared matcher from `expect.ts`, never copy predicates. `.not.not`, unknown matcher access and non-thenable matcher objects must behave like the existing expect proxy.
- [x] Route polling assertions through `poll.ts` with target identifying the matcher and an error policy that retries **callback** throws/rejections only. Track the latest outcome as a discriminated value/error, replacing the prior one on each sample; normal mismatches retry, but `EnvironmentStopError` escapes immediately. Set a callback/check hook in the owner for an optional context-aborted signal; call it before sampling, after awaited reads and before/after delay, and propagate its error. US-2158 owns marking a timed-out context and wiring an interruptible signal; do not implement per-test timeouts here. In the absence of a signal the hook is a no-op. Do not promise cancellation of an already pending callback.
- [x] Default `timeout` to already-scaled `timeouts.wait`, scale explicit timeout exactly as current `waitFor`, and default `interval` to already-scaled `timeouts.poll`. Treat an explicit interval as milliseconds, without applying scale a second time; require a positive finite interval to prevent a busy loop, and a positive finite `timeout`; a non-object `options` or an unknown option key is a `TypeError` naming the supported keys (`timeout`, `interval`, `message`). Preserve existing `waitFor` timeout handling; validate new poll options before starting. Sleep at most the remaining deadline and attempt at least once, matching `waitFor`'s current loop.
- [x] Make the final poll timeout a compact `AssertionError`: optional message first, then `Expected: not toMatchObject {…}` (or the actual matcher/arguments and negation), then `Last actual: …` or `Last error: …`. Use `safePreview` on values and on `errMessage(error)` for errors, not raw `Error` objects (whose message is non-enumerable); use it for expected arguments too. No intervening matcher failure may be recorded as the final failure. Emit one `wait-start` and one `wait-result` or `wait-error` for a poll, with a stable distinct target such as `expect.poll` plus matcher, poll count and final preview/error, and suppress per-sample call logs using the shared quiet scope.
- [x] Capture a stack synchronously at the **matcher invocation** (the line containing `await ctx.expect.poll(...).matcher(...)`), before the first asynchronous boundary. Construct the final timeout error with its own message/type and the captured test frames, then set the poll matcher step and pass it through `markFailure` once. Reuse `testFileLocation` unchanged in `test-attempt.ts`; preserve the original `EnvironmentStopError` and its step/stack. Check `report.md`, `report.json`, and console output for the awaited matcher line, including after a test `finally` performs another context call.
- [x] *(Review note: `index.md` is a hub, limit 10,000 characters — add only a one-line mention and a link there; the detail goes in a page.)* Update `assets/guides/agents/web-app-tests/index.md` with the new API, full async matcher set, `.not`, options and `waitFor` message. In `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`, add an awaited `.mjs` example and explain callback receives `ctx`, retries errors, default/scaled timeouts, interval, compact last outcome, `toThrow`'s function sample, and existing `waitFor` error behavior; include `allowNavigation` in its wait options. In `assets/guides/agents/web-app-tests/attached-runs-and-results.md`, state that polling assertions also log one wait. Keep guide pages under 20,000 characters and run `npm run guides:check` when implementing.
- [x] Update `doc/standards/integration-tests.md` context API and wait documentation with the new assertion and message semantics, and `doc/architecture/key-files.md` with the new collaborators and their single responsibilities. No completion skills are run during planning; epic completion follows the deferred review model.
- [x] On implementation, run `npm run lint`, `npm run typecheck` and `npm run guides:check` (if it hits EPERM, say so; Claude runs it). Codex cannot start Persephone: `npm run test:ui` and the live scenario below are run by Claude after implementation. The live scenario Claude will exercise a temporary `.mjs` scenario through the existing runner (not a new test or harness): eventual success and timeout, `.not` and all matchers, invalid arguments before callback execution, missing stand-in then recovery, persistent callback error, environment stop, wait message/no message, callback/predicate error propagation, scaling, logging, source line and `finally`. Check a TS consumer of `TestContext` with the repository typecheck. Remove temporary files after verification. Do not run `npm run build-prod`.

### API examples

Before:

```js
const value = await ctx.waitFor(() => site.app.dialog, value => value?.title === "Ready");
ctx.expect(value).toMatchObject({ title: "Ready" });
```

After:

```js
await ctx.expect.poll(() => site.app.dialog, { timeout: 5000, interval: 200, message: "Dialog should open" })
    .toMatchObject({ title: "Ready" });
await ctx.waitFor("pages.activePage.id", id => id === pageId, { message: "Page should become active" });
```

## Concerns

- EPIC-205 requires all callback errors to count as not-yet. That can hide a callback typo until timeout; the final short error identifies it. Restricting retries to the text of a missing member would violate the decision and miss navigation errors.
- Existing `waitFor` stops on callback/predicate errors, whereas `expect.poll` retries callback errors. A policy on the common owner preserves existing UI-suite behavior and satisfies the epic without adding a second loop.
- `safePreview` bounds output but does not include an `Error`'s non-enumerable message; preview `errMessage(error)` instead. A single slow or never-settling callback can exceed the polling deadline: the existing loop cannot cancel an in-flight call. A future US-2158 signal must be wired to interrupt pending waits for immediate cancellation; this task provides the check hook only.
- Capturing the stack at `poll()` construction would point at the wrong line when chaining spans lines. Capture at matcher invocation and verify the reported test location; do not replace the cause of an environment stop.

## Acceptance Criteria

- `ctx.expect.poll` accepts sync/async callbacks receiving the context, supports every existing matcher and `.not`, returns awaited promises, validates matcher arguments once, reuses the same predicates, and works in TS and `.mjs`.
- `waitFor` and polling assertions use one extracted host loop, preserve existing wait behavior and quiet logging, respect defaults and scaling, and handle callback errors and environment stops as specified above. A future aborted-context hook exists without implementing US-2158.
- Timeouts show an optional message first and a short expected side plus last value/error for assertions; wait timeouts preserve existing wording apart from the short value. Failures retain the matcher step and awaited test line in reports.
- `context.ts` is smaller, `runner.ts` does not grow, no protocol or board bridge surface changes, all listed checks pass, and the existing UI integration suite runs unchanged. User and developer documentation is updated within guide limits.

## Files Changed

| Path | Planned change |
| --- | --- |
| `src/test-host/poll.ts` | New shared host polling, diagnostics and logging owner. |
| `src/test-host/poll-expect.ts` | New async matcher adapter and poll matcher types. |
| `src/test-host/expect.ts` | Share matcher preparation, validation and predicates with the adapter. |
| `src/test-host/context.ts` | Wire shared owner, callable expect and wait options; remove loop. |
| `assets/guides/agents/web-app-tests/index.md` | Context API summary. |
| `assets/guides/agents/web-app-tests/call-boundary-and-examples.md` | Poll, messages, options and example. |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md` | Poll logging. |
| `doc/standards/integration-tests.md` | Runner API and behavior. |
| `doc/architecture/key-files.md` | New collaborator ownership. |

No changes expected: `src/test-host/runner.ts`, `test-attempt.ts`, `test-api.ts`, `source-location.ts`, `app-proxy.ts`, `client.ts`, `attention-policy.ts`, `timeouts.ts`, `launcher.ts`, `index.ts`, `test-window.ts`, `failure-bundle.ts`, `results.ts`, `test-log.ts`, `src/main/test-mode/arguments.ts`, `scripts/typecheck-strict.mjs`, `integration-test/tests/`, and board bridge/version/history. Reuse their existing interfaces and helpers. `doc/epics/EPIC-205.md` already links this task; leave `doc/active-work.md` untouched.
