# US-2149: Short, located failures

## Goal

Implement C3, C4 and C5 of [EPIC-202](../../epics/EPIC-202.md) after US-2148: concise member errors, source locations and a compact end-of-run list.

## Background

`src/test-host/client.ts` passes `hints: "always"` in `call`, `callText`, and `set`; `rawCall` defaults to `never`, as does `image`. `serverError` joins all text blocks into the thrown error. `context.ts` writes this to `step-error`; `runner.ts` currently reduces the caught error with `errMessage`, losing its stack, then `results.ts` writes `file` but no line. The runner prints a summary, details for non-passed results, stale identities, result path and possible setup/retained-app lines.

The error producer is the installed `ai-vision` 1.4.0 dependency (`node_modules/ai-vision/dist/core/resolver.js`, `errorAt`, `errorNodeHint`, `member-suggestion.js`, `hint.js`), called from `src/renderer/scripting/ai-vision/call.ts` via `src/renderer/api/mcp/call-command.ts`, or locally from `src/main/mcp/tools/call-tools.ts`. For an unknown member the resolver emits `"name" is not a member of Kind.` and appends up to three `Did you mean ...?` suggestions when close candidates exist. With `never`, it returns that error and `resolvedUpTo`, without a hint or full list, even if no close names exist. With `always`, it includes the same suggestions and a forced hint with full descriptor members and live children. `toCallResult` in `src/main/mcp/tools/call-tools.ts` puts nonempty `resolvedUpTo` into the error text as ` (resolved up to "...")`; an empty root path has no suffix. It emits any hint as another block. `$help` is an existing call; a path containing an invoked method may be unsafe to replay, so the runner must not make a diagnostic call.

## Implementation Plan

- [x] Change `client.ts`'s three calls from `always` to `never`:

  ```ts
  // Before
  const result = await this.rawCall(path, args, { timeout, maxLength, hints: "always" });
  // After
  const result = await this.rawCall(path, args, { timeout, maxLength, hints: "never" });
  ```

  `client.ts` owns compact error decoding. Keep the server's unknown-member text and any `Did you mean ...?` unchanged. For an unknown-member error with no suggestion, extract the resolved path from the same error text and append `List members: ctx.call("<resolvedUpTo>.$help")`; for the absent suffix representing the root, use `$help`. Quote the complete call path safely as a JavaScript string. Make no second call and do not replay any path; the line is an optional user action, not an automatic lookup. Preserve the existing step, error code and other error content. Examples (the first line is `serverError`'s existing `formatStep`):

  ```text
  Before: call pages.ALL
  Error: "ALL" is not a member of Pages. Did you mean "all"? (resolved up to "pages")
  After:  call pages.ALL
  Error: "ALL" is not a member of Pages. Did you mean "all"? (resolved up to "pages")

  Before: call pages.zzzzzz
  Error: "zzzzzz" is not a member of Pages. (resolved up to "pages")
  After:  call pages.zzzzzz
  Error: "zzzzzz" is not a member of Pages. (resolved up to "pages")
  List members: ctx.call("pages.$help")
  ```

- [x] Add `src/test-host/source-location.ts` exporting `testFileLocation(error: unknown, testFile: string): string | undefined`. In `src/test-host/test-attempt.ts`'s catch, inspect the original thrown object's stack before `errMessage`; find the first V8 frame matching that descriptor's exact test file, parse line/column from the right so Windows drive letters survive, decode `file:` URLs using Node's URL helpers, normalize with existing `test-identity.ts` rules, and return an absolute `file:line`. Support `at fn (file:///...:line:column)` and `at file:///...:line:column`, plain Windows paths, and filenames with spaces; avoid matching another file merely by basename. If no matching frame or a primitive throw, leave location absent rather than inventing a line. Move `displayPath(cwd, file)` from `runner.ts` to this helper; compute `TestResult.location?: string` as `relative/or/absolute/path.test.mjs:LINE`, using `displayPath(configuration.cwd, testFile)` for the path (relative when inside cwd, absolute otherwise). Preserve the existing `file`, `step`, `error` and cleanup fields. Cleanup-only and unexpected-pass outcomes may have no source stack and therefore no location.
- [x] In `results.ts` print the optional location in each Markdown result and preserve it in JSON; retain the existing `File:` line. In `runner.ts` retain existing console output and append a compact list after **all** existing output, including setup errors and retained-app lines. The header and each line use this exact format; these are the final lines of the run, with nothing printed afterward. Passed tests are not listed. Cover `failed`, `skipped`, `expected-failure`, `unexpected-pass`, and `flaky` from US-2148; use the displayed file if location is absent, and the first error line, skip reason or expected-failure reason when available. Keep setup failures visible in their existing line; do not change exit behavior.

  ```text
  # Before: FAILED file — test — step, followed by a multi-line error
  # After: existing detail remains; the final lines are:
  Summary:
  FAILED — save — tests/save.test.mjs:12 — Expected false to be true.
  SKIPPED — later — tests/save.test.mjs — test.skip
  ```

- [x] Run `npm run typecheck` and `npm run lint`; no unit tests or harnesses were added.
- [x] Live check by Claude on 2026-11-22 against the running dev app (attached throwaway suite outside the repo); `npm run test:ui -- --area core/smoke` passes. See the epic's notes.

## Concerns

- With `hints: "never"`, the server returns no full member list and may find no close suggestion. Roadmap C3's “The full list stays in `tests.log`” is not achievable with `never` without an extra call; the epic accepts the pointer line above instead. Do not add a lookup protocol or fabricate a list.
- The integration suite's `integration-test/run.mjs` passes exact selections and setup; `integration-test/lib/aggregate-report.mjs` reads `report.json` and ignores unknown fields, preserving its own report and `last-failed.json`. Existing status meanings and console lines remain; optional location is additive. Integration tests may see shorter MCP error text, while error/code semantics stay intact.
- `src/test-host/` is not in the strict folders of `scripts/typecheck-strict.mjs`. No new protocol, `window.persephone` change or `await import()` workaround; keep god files shrinking by using focused collaborators.
- At epic close `/userdoc` should update `assets/guides/agents/web-app-tests/index.md`, **Run tests** and **Triage a failed run**.
- Files that need NO changes: `doc/active-work.md`, `doc/epics/EPIC-202.md`, `src/main/test-mode/instance-options.ts`, `src/ipc/test-host-protocol.ts`, `integration-test/**`, `launcher/**`, `node_modules/ai-vision/**`, the MCP server, and the user guide in this task.

## Acceptance Criteria

- [x] Normal calls request `never`; errors retain the server's wrong member and available suggestions, or append the existing `$help` pointer when no suggestion is returned, without a second call.
- [x] Matching stack frames supply a correct optional file/line in JSON, Markdown and console; missing frames remain absent.
- [x] Final compact list covers all non-passed statuses without removing existing output; typecheck and lint pass and Claude can run the manual check.

## Files Changed

| File | Planned change |
|---|---|
| `src/test-host/client.ts` | Suppress hints and append a help pointer when needed. |
| `src/test-host/test-attempt.ts` | Retain original stack at catch and record location. |
| `src/test-host/source-location.ts` | Extract a matching test file and line and own display paths. |
| `src/test-host/results.ts`, `src/test-host/runner.ts` | Add location to reports and append compact summary. |
