# US-2148: Test modifiers, grep and retries

## Goal

Implement B3 and B5 of [EPIC-202](../../epics/EPIC-202.md), preserving existing runner contracts while adding test modifiers, name filtering, retries and distinct outcomes.

## Background

`src/test-host/test-api.ts` creates descriptors with `name`, `run`, and validated `requires`; `index.ts` installs it as `globalThis.test`. `runner.ts` discovers default descriptor exports, validates requirements, applies manifest selection, computes rerun selection, then executes each selected test. It takes a baseline with `beginPageOwnership`, makes a fresh context and setup, catches errors and captures screenshots, and calls `closePagesOpenedSince` in `finally` with the context's owned-page set in attach mode. Cleanup errors currently fail the test. `results.ts` writes version-1 `last-failed.json` and reports; `runner.ts` logs `run-summary`, prints existing summary/detail lines, controls `--keep-open` and exit status.

CLI path: `src/main/test-mode/arguments.ts` parses test-controller options; `controller.ts` copies them into JSON after `TEST_HOST_CONFIG_MARKER` from `src/ipc/test-host-protocol.ts`; `src/test-host/index.ts` parses it as `HostConfiguration` from `launcher.ts`. `instance-options.ts` and `isTestInstanceOption` recognize only internal app-child switches; `TestLauncher.arguments()` sends those, not controller options. `launcher/src/test_main.rs` is the `persephone-test` binary (`launcher/Cargo.toml`): it prepends `--test`, forwards all arguments, waits and returns the child status. It currently has no help/usage implementation; controller parsing rejects `--help`. `integration-test/run.mjs` uses its own option parser and invokes the product with `--test-selection`, `--test-setup`, `--log-dir`, etc.

## Implementation Plan

- [x] Extend `test-api.ts`'s `TestDescriptor` and callable `test` API with `test.skip`, `test.only`, and `test.fails(name, fn, { reason })`, reusing the current validation and `requires` option. Store explicit modifier and nonempty reason for `fails`; validate descriptors in `runner.ts` discovery, including hand-authored descriptors. Update `globalThis.test` in `index.ts` to use the exported callable type and align `runner.ts`'s `Descriptor` with it. Example:

  ```ts
  // Before, in test-api.ts:
  export interface TestDescriptor { name: string; run: (context: TestContext) => Promise<void>; requires?: string[]; }
  // After:
  export interface TestDescriptor {
      name: string;
      run: (context: TestContext) => Promise<void>;
      requires?: string[];
      mode?: "skip" | "only" | "fails";
      reason?: string;
  }
  ```

  Missing `mode` means a normal test, including hand-authored `{ name, run, requires }`. `test.skip` has no reason option and yields `status: "skipped"`, `skipReason: "test.skip"`; `test.fails` requires a nonempty reason. Example:

  ```js
  // Before: test("known issue", async ctx => { /* failure counts as failed */ })
  test.fails("known issue", async ctx => { ctx.expect(false).toBe(true); }, { reason: "known bug" });
  test.skip("later", async ctx => {});
  test.only("focus", async ctx => {});
  ```

- [x] In `arguments.ts` add `--retries <n>` / `--retries=<n>` (nonnegative safe integer, default 0) and `--grep <regex>` / `--grep=<regex>` (compile once as case-sensitive JavaScript RegExp; reject malformed expressions), with duplicate/missing checks and test-mode detection. Accept both options in the existing parser, which rejects unknown options. Copy values in `controller.ts` and type in `launcher.ts`'s `HostConfiguration`; do not add internal options to `instance-options.ts` or `test-host-protocol.ts`, and do not forward them to the launched app.
- [x] Own name filtering in `src/test-host/test-selection.ts` next to `selectedByManifest`; match only descriptor name. In `runner.ts` validate manifest identities against discovery before grep, intersect manifest, rerun and grep, then detect `only` across the selected files; if present execute only those and print a focus notice. Requirements and explicit skips remain skipped, never execute. Preserve stale rerun meaning (disappearance from discovery, not exclusion by grep). Handle an empty selection without misreporting it as stale.
- [x] Extract one attempt into `src/test-host/test-attempt.ts`, whose single exported function is `runAttempt(input: AttemptInput): Promise<AttemptResult>`; define the input/result types there for descriptor, file/identity, current client, launcher, timeouts, configuration, setup, log, output directory, attempt number, and returned client plus attempt diagnostics. Move the current `runner.ts` block around lines 135–177, from client reacquisition and context creation through the try/catch/finally and attempt result construction, into it; keep selection, retry loop and final aggregation in `runner.ts` so it shrinks. Reuse `createContext`, `loadContextSetup`'s setup, `beginPageOwnership`, `captureFailure`, and `closePagesOpenedSince`: each attempt gets a fresh context, setup, baseline, ownership set, error bookkeeping, capture and finally cleanup before the next attempt. Reacquire `launcher.client` after restarts. Never retry skipped or expected-failure outcomes; retry `failed` and `unexpected-pass` up to n additional attempts. A later normal pass is `flaky`; a later expected failure is `expected-failure`; exhausted attempts retain final outcome. Keep cleanup failure a real failure even for `test.fails`, so a known assertion cannot mask leftover state. Store one final result per identity and retain attempt diagnostics in additive fields/log events, including attempt number and prior failure, without overwriting screenshots.
- [x] In `results.ts`, extend `TestResult.status` with `expected-failure`, `unexpected-pass`, `flaky`, and preserve reason and attempt details additively. Extend JSON summary and Markdown counts, retain existing fields and `passed`/`failed`/`skipped` meanings, include unexpected passes in failure exit and version-1 `last-failed.json`, and include expected-failure/flaky counts separately. Apply the same failure predicate to `runner.ts` exit and `--keep-open`; add counts to `run-summary` and the existing console summary line, retain detail lines, and log each final outcome. `unexpected-pass` must be actionable in report even without a thrown error.
- [x] Preserve the summary prefix and add distinct counts. The `report.json` summary keeps `passed`, `failed`, `skipped` and adds `expectedFailure`, `unexpectedPass`, `flaky`; `failed` continues to count `failed` results and setup failure, while `unexpectedPass` is separately counted and still causes exit 1. Apply these same counts to `run-summary` and Markdown. Console wording and order:

  ```text
  Before: Test run <ts>: 3 passed, 1 failed, 1 skipped.
  After:  Test run <ts>: 3 passed, 1 failed, 1 skipped, 1 expected failure, 0 unexpected passes, 1 flaky.
  ```

  The existing three counts keep their position and wording so parsers of the old prefix still work.
- [x] Run `npm run typecheck` and `npm run lint`; no unit tests or harnesses were added.
- [x] Live check by Claude on 2026-11-22 against the running dev app (attached throwaway suite outside the repo); `npm run test:ui -- --area core/smoke` passes. See the epic's notes.

## Concerns

- The integration suite uses its own `test` from `integration-test/lib/context.mjs`, passes neither `--retries` nor `--grep`, and its descriptors have no modifier fields; it cannot produce `expected-failure`, `unexpected-pass` or `flaky`. The runner must still accept plain `{ name, run, requires }` descriptors as normal tests. Adding modifiers to the integration suite is a possible follow-up, outside this task; its existing report and rerun consumers stay unchanged.
- `src/test-host/` is not in `scripts/typecheck-strict.mjs`; `src/ipc/` is strict but no change is expected there. No new protocol, `window.persephone` change, or `await import()` workaround. Keep god files shrinking by extracting attempt execution.
- At epic close `/userdoc` should update `assets/guides/agents/web-app-tests.md`, **Test file and context**, the **Run tests** option list for `--grep` and `--retries`, and **Triage a failed run**.
- Files that need NO changes: `doc/active-work.md`, `doc/epics/EPIC-202.md`, `src/main/test-mode/instance-options.ts`, `src/ipc/test-host-protocol.ts`, `integration-test/**`, `launcher/**`, `node_modules/ai-vision/**`, and the user guide in this task.

## Acceptance Criteria

- [x] Modifiers, selection order, focus notice and validated CLI options work as described; existing invocations remain valid.
- [x] Each retry is independently set up and cleaned; statuses, counts, exit code, retained app and rerun identities follow the epic decisions; the integration suite's existing descriptors remain compatible.
- [x] Typecheck and lint pass; Claude can run the manual checks.

## Files Changed

| File | Planned change |
|---|---|
| `src/test-host/test-api.ts`, `src/test-host/index.ts` | Modifier descriptors and global type. |
| `src/test-host/runner.ts`, `src/test-host/test-attempt.ts` | Selection, attempt lifecycle, outcomes and logging. |
| `src/test-host/test-selection.ts`, `src/test-host/results.ts` | Name filter and additive status/report rules. |
| `src/main/test-mode/arguments.ts`, `src/main/test-mode/controller.ts`, `src/test-host/launcher.ts` | Parse and carry options. |
