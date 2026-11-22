# US-2158: Per-test timeout

## Goal

Bound each attempt with a configurable timeout, retaining diagnostics and cleanup, under [EPIC-205](../../epics/EPIC-205.md). This is a plan; hooks are US-2159.

## Background

- Decision 5 requires 300000 ms by default, a run override and a test override, all scaled by `--timeout-scale`; 0 disables the bound. Each retry gets a fresh bound. Later `beforeEach` belongs inside it and `afterEach` outside it after capture.
- `src/main/test-mode/arguments.ts` parses `--retries` in both forms with duplicate and safe-integer validation; `controller.ts` copies parsed fields into the serialized `HostConfiguration` in `src/test-host/launcher.ts`, and `index.ts` forwards it.
- `test-api.ts` creates descriptors for four test forms. `runner.ts:discover` independently validates manually constructed descriptors; errors become `<module import>` results.
- `runAttempt` asserts window identity, snapshots page ownership and runs setup before the body. Its catch records `errMessage` and `context._state.stepOf(error)`, then calls `captureFailure`; finally it refreshes `launcher.client` and calls `closePagesOpenedSince`. Capture has individually bounded requests/screenshots; cleanup has per-operation bounds, not total deadlines.
- The call-path findings below predate US-2157. Read the post-US-2157 `src/test-host/context.ts` and `src/test-host/poll.ts` before implementing; its plan moves both waits to `poll.ts` with an optional context-aborted check hook.
- Scoped stand-ins use `beforeProxyCall → proxyCall → call`; direct `ctx.call` also uses `call`, but `callText`, `set` and root stand-ins use separate paths. `openBrowser` and `script` use context calls; `usePage` also uses a client getter. There is no single existing choke point. Callback `waitFor` can execute without an app call. Setup extensions can retain `getClient()` adapters with `rawCall` and `listTools`.
- `McpClient.rawCall` uses SDK `callTool` with an independent request timeout, normally scaled 30000 ms or a caller override. Racing the body neither cancels an in-flight request nor undoes server effects; it can overlap cleanup or the next test. `restartApp` awaits `launcher.restart()` (stop then start), replacing its local client; the launcher also publishes a replacement. Capture and cleanup refresh from the launcher.
- Existing retries create a new attempt and context each time. A body failure on `test.fails`, including timeout, is `expected-failure` when cleanup succeeds; cleanup errors remain real failures. Ordinary timeout uses `failed`; a subsequent pass can be `flaky`. `results.ts` already renders error and step in Markdown, JSON and console; no status is needed. A timer error normally has no test-file stack frame, so location may be absent.
- `npm run test:ui` runs `integration-test/run.mjs` on `integration-test/tests/`. Its explicit allowlist passes `--timeout-scale`, not arbitrary arguments. Its aggregate report maps existing failure fields. Available `integration-test/reports/latest.json` has 36 results, maximum 7715 ms; two older US-2061 baselines each have 188, maximum 35309 ms. None exceeds five minutes, but these are partial historical runs; source includes individual 90-second Tor waits.
- `src/test-host` is absent from `scripts/typecheck-strict.mjs`; the existing strict gate remains mandatory. `launcher/src/test_main.rs` adds `--test` and forwards arguments and has no help text. The actual test-mode options reference is `assets/guides/agents/web-app-tests/index.md`.

## Implementation Plan

1. **Lifetime owner: new `src/test-host/test-timeout.ts`.** Provide one attempt-lifetime object with `assertActive()` and an async execution method accepting a callback and step getter. Reuse `Promise.race` / `setTimeout` as in `client.ts:connect`. On expiry synchronously snapshot the step, permanently close the lifetime, and reject with `Test timed out after N ms; last step: <step>` using that snapshot; keep the same snapshot in the result `step`. The abandoned body must never overwrite it. Clear timers on every settlement, observe late rejections and never let late completion overwrite the result. A zero value bypasses the timer.
2. **Scaling owner: `src/test-host/timeouts.ts`.** Extract/export the existing clamp and rounding helper in `createHostTimeouts`; apply it exactly once to descriptor timeout ?? configuration timeout ?? 300000. Preserve zero before scaling; positive values round to at least 1 and clamp to 2147483647. N in the error is the effective scaled value. Validate both CLI and per-test values as non-negative safe integers; 0 disables either bound.
3. **CLI owner: `src/main/test-mode/arguments.ts`.** Add `testTimeout` beside retries, default 300000; support `--test-timeout <ms>` and `--test-timeout=<ms>`. Reject missing, duplicate, negative, fractional, nonnumeric and unsafe values like `--retries`. Copy it through `src/main/test-mode/controller.ts` to `HostConfiguration` in `src/test-host/launcher.ts`; retain fallback for older internal configurations. Reuse the existing configuration channel.
4. **Descriptor owner: `src/test-host/test-api.ts` plus new `src/test-host/test-descriptor-validation.ts`.** Add `timeout?: number` to a shared options type and `TestDescriptor` for `test`, `skip`, `only`, and `fails`; fails still requires reason. Move discovery's current descriptor validation into the collaborator and share its timeout validator with creation. Replace the existing block in `runner.ts:discover` with one call, so runner shrinks; preserve import-error, requires, mode and reason behavior.
5. **Guard owner: `src/test-host/test-timeout.ts`; wiring: `src/test-host/context.ts` and `src/test-host/poll.ts`.** Read their post-US-2157 versions first; this plan's call-path findings predate that refactor. Wire the one lifetime `assertActive` function into the optional context-aborted hook in `poll.ts`, used by both `ctx.waitFor` and `ctx.expect.poll`; the shared owner calls it before sampling, after awaited reads and around the delay, propagating its error instead of treating it as a retryable sample error. Do not add a separate wait loop. Call the same guard before step mutation and at each remaining entry point: scoped and root stand-in calls, `call`, `callText`, `set`, `openBrowser`, `usePage`, `script`, `restartApp`, and `launchSecondInstance`. Guard continuations before further requests or page ownership changes. Awaiting/invoking a stand-in rejects immediately; local proxy construction and metadata do not issue reads. Preserve logging and `stepOf`, and keep the expiry step snapshot immutable. Guard retained `rawCall` / `listTools` setup adapters in `src/test-host/context-setup.ts`. If the post-US-2157 context still has scattered operation paths, extract their bookkeeping into a focused `src/test-host/context-operations.ts`; otherwise do not create it. In either case `context.ts` must not grow.
6. **Attempt integration: `src/test-host/test-attempt.ts`.** Create a lifetime per attempt; pass it to context and setup. After existing baseline/setup, use `lifetime.run(callback, stepGetter)` around the body. This callback is the explicit seam where US-2159 will run `beforeEach` plus the body within the same bound. Keep `captureFailure` and `closePagesOpenedSince` outside it, refreshing the launcher client. US-2159 will create a separate guard scope for `afterEach` after capture; never reopen the abandoned body's scope. Do not implement hooks here.
7. **Restart coordination: `src/test-host/test-timeout.ts` and minimal context wiring.** Track a `restartApp` already in flight at expiry and await it before capture or cleanup, using the existing launcher startup and shutdown timeouts; then refresh `launcher.client` and record restart failure. Do not start a competing restart or add protocol. Do not change `TestLauncher.stop` or its `outputsClosed` wait in this task; see Concerns for its limit.
8. **Docs.** Add only the `--test-timeout` option line to `assets/guides/agents/web-app-tests/index.md`; it is a hub limited to 10,000 characters. Put default, precedence, scale, all four descriptor forms, zero, retries, expected failures and abandoned-operation limits in `assets/guides/agents/web-app-tests/call-boundary-and-examples.md`; update `assets/guides/agents/web-app-tests/attached-runs-and-results.md` for error, step, capture and cleanup. Update `doc/standards/integration-tests.md` and `integration-test/README.md` for the shared default, scale and wrapper allowlist. Other guide pages stay below 20,000 characters. Do not add wrapper forwarding; existing UI invocations keep working.
9. **Verification after implementation; no unit tests or test harnesses.** Codex runs `npm run typecheck`, `npm run lint` and `npm run guides:check`; Codex cannot start Persephone or run `npm run test:ui`. Claude runs the UI suite and live product checks with disposable user-style files: default, CLI forms, validation, scaling, zero, modifiers and handwritten descriptors, retry and expected failure, never-settling body, late calls including root and setup adapter, both polling forms, in-flight request, restart and a following test. Claude inspects console, `report.md`, `report.json`, `tests.log`, failure capture and cleanup, including late rejections and timer cleanup. Do not run `npm run build-prod`.

### Representative changes

```ts
// Before
await descriptor.run(extendedContext);
// After: the lifetime snapshots the running step on expiry.
await attemptTimeout.run(() => descriptor.run(extendedContext), () => context._state.step);
```

```js
// Before
test("scheduled job", async (ctx) => { /* steps */ });
// After: milliseconds before scaling; 0 disables the bound.
test("scheduled job", async (ctx) => { /* steps */ }, { timeout: 480000 });
test.fails("known failure", async (ctx) => { /* steps */ }, { reason: "issue", timeout: 10000 });
```

## Concerns

- **Cancellation is cooperative.** An already dispatched MCP request can mutate the app after expiry and affect later attempts. SDK request timeout bounds host waiting, not server effects. Arbitrary JavaScript, spawned processes and synchronous loops cannot be stopped by a host timer. This is the closest host-only protection to decision 5; document the limitation. Do not close a shared attached client or add a cancellation protocol.
- **Restart recovery can be delayed.** `TestLauncher.stop` bounds close and exit races but awaits `outputsClosed` without a total bound. Serializing restart prevents a stale replacement client, but the unbounded `outputsClosed` wait can exceed startup and shutdown timeouts; addressing it is a follow-up, outside this task. Existing capture and cleanup bounds are per operation and can multiply with page count; they are not a total deadline.
- **Future hook access needs a separate scope.** Reopening the same context would reopen the abandoned body. US-2159 must provide a distinct permitted afterEach scope after capture, preserving page ownership without weakening the old guard.
- **Runtime evidence is incomplete.** Partial saved reports do not establish a maximum for every current UI test or slower machines; full live verification remains necessary.

## Acceptance Criteria

- Default, CLI and all four per-test forms select and scale the documented bound; 0 disables it; invalid values and duplicates fail clearly, including handwritten descriptors.
- Each retry has a fresh lifetime. Timeout reports `Test timed out after N ms; last step: <step>` and retains the immutable expiry snapshot in the result step; existing failure, expected-failure, retry, report and exit behavior remains intact.
- Late context and retained setup-adapter calls reject before starting new work; later attempts use independent contexts. In-flight and synchronous-code limits are documented.
- Capture and cleanup run with their independent existing bounds; restart/client replacement is coordinated. Future beforeEach fits inside the callback and afterEach can follow capture without reopening the abandoned scope.
- Existing UI commands and result format remain compatible; documentation and verification above pass. No new protocol, hooks, unit tests, harness, board bridge change, import-zone bypass, or growth of `runner.ts` / `context.ts`.

## Files Changed

| Path | Planned change |
|---|---|
| `src/test-host/test-timeout.ts` | New attempt lifetime, guard and coordination. |
| `src/test-host/context-operations.ts` | Conditional: extract operation/proxy bookkeeping only if still scattered after US-2157. |
| `src/test-host/poll.ts` | Wire the lifetime guard to US-2157's shared context-aborted hook. |
| `src/test-host/test-descriptor-validation.ts` | Shared descriptor validation extracted from discovery. |
| `src/test-host/context.ts`, `context-setup.ts` | Wire lifetime and setup adapter; context shrinks. |
| `src/test-host/test-attempt.ts` | Bound body and coordinate restart before capture/cleanup. |
| `src/test-host/test-api.ts`, `runner.ts` | Descriptor option and validation; runner shrinks. |
| `src/test-host/timeouts.ts` | Reuse shared scaling. |
| `src/test-host/launcher.ts` | Add `testTimeout` to `HostConfiguration` only; do not change stop or `outputsClosed`. |
| `src/main/test-mode/arguments.ts`, `controller.ts` | Parse and carry run timeout. |
| `assets/guides/agents/web-app-tests/index.md`, `call-boundary-and-examples.md`, `attached-runs-and-results.md` | Hub option line; page semantics and diagnostics. |
| `doc/standards/integration-tests.md`, `integration-test/README.md` | Shared default, scale and wrapper behavior. |
| **No changes:** `src/test-host/index.ts`, `client.ts`, `app-proxy.ts`, `expect.ts`, `failure-bundle.ts`, `browser-helpers.ts`, `results.ts`, `test-window.ts`, `test-log.ts`, `source-location.ts`, `attention-policy.ts`, `integration-test/run.mjs`, `launcher/src/test_main.rs`, `scripts/typecheck-strict.mjs`, board bridge | Existing forwarding, bounds, reports and protocol are reused. Reassess only if verification demonstrates a necessary change. |

## Progress checklist

- [x] Attempt lifetime, expiry snapshot, and timeout error.
- [x] Shared scaling and timeout validation.
- [x] CLI option parsing and host configuration forwarding.
- [x] Descriptor timeout options and discovery validation.
- [x] Context operation guards, shared polling guard, and setup adapter guards.
- [x] Per-attempt body boundary and restart coordination.
- [x] User and developer documentation updates.
- [x] `npm run typecheck` and `npm run lint` pass; `npm run guides:check` was attempted but esbuild failed with `spawn EPERM` before page validation.
- [x] Live UI verification remains for Claude, as specified by the verification plan.

\n