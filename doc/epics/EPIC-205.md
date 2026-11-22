# EPIC-205: Test structure for web-app tests

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 3 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap. The pilot suite wrote 381
`ctx.waitFor` calls followed by an `expect`, wrapped `test()` to get a `finally`, and had no bound on a whole test, only
on single calls. This epic adds polling assertions, a message on waits, a per-test timeout, and file-level hooks.
Steps 1a ([EPIC-202](EPIC-202.md)), 1b ([EPIC-203](EPIC-203.md)) and 2 ([EPIC-204](EPIC-204.md)) gave the runner the
matcher set (`expect.ts`), test modifiers, retries (`test-attempt.ts`), the test window, the `not-run` status and the
failure bundle; this epic builds on all of them.

Proposals covered: **B2, B4, B7**, plus the `waitFor(..., { message })` half of US-2138 item 24. Feedback items of
[US-2138](../tasks/US-2138-web-app-test-feedback/README.md) touched: 2 (runner half: a stand-in that is not there yet
is "not yet" inside a poll; the bridge half is G2, step 6), 24 (wait message).

## Goals

- `await ctx.expect.poll(fn, { timeout, interval, message }).<matcher>(…)` with every matcher of `expect.ts`, including
  `.not`; one call replaces a `waitFor` plus an `expect` (B2).
- `ctx.waitFor(target, predicate, { message })` puts the message first in its timeout error (item 24).
- A whole test is bounded: a generous default, `--test-timeout <ms>`, and a per-test `{ timeout }` option. A timed-out
  test still gets failure capture and cleanup (B7).
- A test file can export `beforeAll`, `beforeEach`, `afterEach`, `afterAll` next to its tests. A failing `beforeAll`
  reports the file's tests as `not-run` instead of failing them one by one (B4).

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2157](../tasks/US-2157-polling-assertions/README.md) | Polling assertions and wait messages | B2, item 24 | Done |
| [US-2158](../tasks/US-2158-per-test-timeout/README.md) | Per-test timeout | B7 | Done |
| [US-2159](../tasks/US-2159-file-hooks/README.md) | File-level hooks | B4 | Done |

Order: US-2157 and US-2158 are planned in parallel (US-2157 lives in `expect.ts` / `context.ts`, US-2158 in
`test-attempt.ts`, `test-api.ts` and the CLI); implementations run one at a time, each staged after review. US-2159 is
planned after US-2158 is implemented, because hook timeouts and the per-attempt hook order build on the timeout's
bound and on the attempt flow as it then stands.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices (review section 6 answers taken as recommended).

1. **`runner.ts` only shrinks** (refactoring guardrail 3). It has grown in each epic. New logic goes into new
   collaborator files with one job each; US-2159, which needs a per-file loop, first moves the per-file and per-test
   execution out of `runner.ts` into a collaborator, so the file ends smaller than it starts.
2. **One polling loop.** `ctx.waitFor` and `ctx.expect.poll` share one host-side poll owner (deadline, poll delay
   from `timeouts.poll`, `--timeout-scale` applied to explicit timeouts, the quiet step logging that `waitFor` already
   does). The matcher predicates of `expect.ts` are reused by the poll, never copied.
3. **Poll semantics (B2).** `ctx.expect.poll(fn, options)` takes a function (sync or async, given `ctx`) whose value
   is read on every poll; a stand-in path string is not accepted (a function reads the same and keeps one form).
   Matchers on the poll return promises and must be awaited. Default timeout = `ctx.waitFor`'s default; `interval`
   defaults to the runner's poll delay. Matcher arguments are validated once, before polling. While polling, an error
   thrown by the function (a member that is not there yet, a page mid-navigation) counts as "not yet"; an
   `EnvironmentStopError` and a timed-out test end the poll at once. On timeout the error is compact: the message
   first, then one line with the expected side (`not toMatchObject {…}`), then the last actual value or the last
   error, each shortened by the existing `safePreview`.
4. **Wait message (item 24).** `ctx.waitFor` options take `message`; the timeout error starts with it. Without it the
   error is unchanged except that the last value uses the same short preview as poll.
5. **Per-test timeout (B7).** Default 300 000 ms (five minutes: the pilot had a four-minute test that waits for a
   scheduled run). `--test-timeout <ms>` sets the run default (`0` = no bound); `test(name, fn, { timeout })` (and the
   `skip`/`only`/`fails` forms) overrides it per test. All three are multiplied by `--timeout-scale`, as `ctx.waitFor`'s
   explicit timeout already is. The bound covers one attempt (each retry gets a fresh bound) and covers `beforeEach`
   plus the test body. After a timeout the test's context is marked timed out so the abandoned body's later calls
   throw at once instead of acting on the next test; failure capture, `afterEach` and page cleanup then run with their
   own bounds. The error reads `Test timed out after N ms` and names the step that was running.
6. **Hooks (B4).** Named exports `beforeAll`, `beforeEach`, `afterEach`, `afterAll` of a `.test.mjs` file, each an
   async function given a context. A non-function export is a module error. `beforeEach`/`afterEach` run inside every
   attempt with the test's own context (so retries re-run them); `afterEach` runs even when `beforeEach` or the body
   failed or timed out, after failure capture. `beforeAll`/`afterAll` run once per file, only when at least one test
   of the file will run (after `--grep`, selection, `test.only` and skips are applied), each with its own context and
   bounded by the test timeout. `afterAll` runs even when `beforeAll` failed.
7. **Hook failures are located results.** A failing `beforeAll` or `afterAll` is reported as one failed result named
   `<beforeAll>` / `<afterAll>` for the file (the same pseudo-test shape as today's `<module import>`), with
   `file:line`, step, and failure capture; when `beforeAll` fails the file's tests are `not-run` with the reason
   "beforeAll failed". A failing `beforeEach` fails the test (body not run); a failing `afterEach` fails a test that
   had passed, and is added as a note to a test that had already failed. A `test.fails` test whose only failure is
   `afterEach` is a real failure, not an expected one (same rule as cleanup errors today).
8. **Hook state.** Plain values (ids, URLs, flags) pass between hooks and tests through the test module's own
   variables. A stand-in is bound to the context that created it, so a test does not reuse a `beforeAll` stand-in; it
   re-reads the page (`ctx.usePage`, `ctx.app.pages[…]`). Pages opened in `beforeAll` belong to the file: per-test
   cleanup leaves them, and they are closed after `afterAll`.
9. **No protocol code, no bridge change.** Everything is host-side in `src/test-host/` plus one argument in
   `src/main/test-mode/arguments.ts`. Nothing a board reaches through `window.persephone` changes; if a plan finds
   otherwise, it bumps `BOARD_BRIDGE_VERSION` with a history line.

## Notes

### 2026-11-22
- Epic created from roadmap step 3. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Plan review decisions.**
  - *US-2157*: accepted with small corrections (validate `timeout` too and reject unknown poll option keys; the
    guide hub stays a one-line mention). `ctx.waitFor` keeps its immediate stop on callback/predicate errors; only
    `expect.poll` retries callback errors. An explicit `interval` is not scaled.
  - *US-2158*: corrected to wire the timeout guard into US-2157's poll hook (one place for both waits), to name the
    step in the error (`Test timed out after N ms while running: <step>`), and to keep restart coordination minimal
    (await an in-flight `restartApp`, no change to `TestLauncher.stop`).
  - *US-2159*: accepted. `runner.ts` loses its per-file/per-test loop to `test-file-run.ts` and `test-result.ts`
    (target ≤190 lines). `afterEach` keeps the test's context but runs in its own guard scope (Node
    `AsyncLocalStorage`), so the timed-out body stays refused while teardown works. Added: a call through a stand-in
    whose context has ended (a `beforeAll` stand-in used in a test) is refused with a message naming the owning
    context and the fix (pass plain values, re-read the page). A failed `<beforeAll>`/`<afterAll>` saved in
    `last-failed.json` makes `--rerun-failed` select the whole file. A timeout inside a hook has no hook line (the
    error is made by a timer); the hook phase and last step are reported instead.
- **Fixes by Claude during live verification.** US-2157: a RegExp previewed as `{}` in assertion text
  (`Expected: toMatch {}`); `safePreview` now prints it as `/done/`. Codex's checklist tick double-encoded the
  US-2157 task document (mojibake); re-encoded. US-2158: the step at expiry is the *last* step, which can be a call
  that already finished, so the message reads `Test timed out after N ms; last step: <step>` (not "while running");
  a poll now sets its own step on every sample, so a timeout inside `expect.poll`/`waitFor` names the poll; a
  restart error recorded before cleanup was overwritten by the cleanup result and is now kept. US-2159: when a test
  had already failed, a failing `afterEach` overwrote the test's step with its own (the error stayed the body's); the
  body's step now stays primary and `afterEach` is only the cleanup note. A `beforeEach` that finished after its
  attempt had timed out logged a late `hook-result ok` into the next attempt's log; it is now refused like any other
  late call.
- **Live verification (dev app, attached runs against a local HTTP page; each run in its own runner-created window).**
  `expect.poll` passed for a value that changes (`toBe`, `toBeGreaterThan`), with `.not`, and for an element that
  appears late (the failing reads before it appears counted as "not yet"). Timeouts read: message, `Expected: toMatch
  /done/`, `Last actual: "ready"`; `.not` gave `Expected: not toBe 5` / `Last actual: 5`; a member that never exists
  gave `Last error: …`; each located at the awaited line. An unknown poll option is refused with the supported keys.
  `waitFor(…, { message })` puts the message first. Per-test `{ timeout }`, `--test-timeout`, `{ timeout: 0 }`, a
  poll inside a timed-out test, and a timed-out `test.fails` (expected failure) behaved as designed; the abandoned
  body's late call was refused, the next test ran clean, failure capture and bundles were written, and each retry got
  a fresh bound. `--test-timeout abc` is rejected. Hooks: order `beforeAll, (beforeEach, test, afterEach)…, afterAll`,
  hooks re-run per retry attempt, a `beforeAll` page stayed open through the file's tests and was closed after
  `afterAll`, a `beforeAll` stand-in used in a test was refused with the guidance message, a failing `beforeAll` gave a
  located `<beforeAll>` failure plus `not-run` tests and `afterAll` still ran, `--rerun-failed` after it selected the
  whole file, `afterEach` failures (alone, and after a failed body) and an `afterAll` failure were reported, `afterEach`
  ran after a timeout, `beforeEach` counts inside the bound, and a file with only skipped tests ran no hooks.
- **Not verified live:** an environment stop raised inside a hook, and `--test-setup` extensions in hook contexts
  (the UI suite uses `--test-setup` but has no hooks).
- Checks: `npm run lint`, `npm run typecheck`, `npm run guides:check` (133 pages), `npm run i18n:check` (no catalog
  changes; all packs complete); `npm run test:ui -- --area core` 36 passed after each task. Completion skills by Codex
  (Luna): `/review` removed two non-null assertions on `input.setup`; `/document` found the developer docs current;
  `/userdoc` completed the `waitFor` options line in the hub and added a `whats-new.md` entry.
