# EPIC-202: Web-app test runner fixes

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 1a of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap: the small, design-free fixes
to the test runner in `src/test-host/`. The first real suite written with the runner
([US-2138](../tasks/US-2138-web-app-test-feedback/README.md)) wrote 518 of its 1,922 assertions as
`expect(x).toBe(true)`, could not mark a test that fails on purpose, could not retry a flake or run one test by name,
and had to write its own scripts to read the results. This epic fixes those, and nothing outside the runner.

Proposals covered: **B1, B3, B5, B6, C3, C4, C5**. Feedback items closed: 6, 7, 12 (runner half), 14, 24 and the
matcher half of 21.

## Goals

- `ctx.expect` has the Jest/Playwright matcher names agents already write, `.not`, and an optional message; an
  unknown matcher or a stand-in passed to `expect` fails with a clear message (B1, B6).
- A test can be skipped, focused, or marked as an expected failure, and the report counts expected failures,
  unexpected passes and flaky tests apart from real failures (B3, B5).
- `--grep <regex>` runs tests by name; `--retries <n>` retries a failed test (B5).
- A failure is short and located: no multi-kilobyte member list, the test file's `file:line`, and a compact summary
  at the end of the console output (C3, C4, C5).

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2147](../tasks/US-2147-runner-expect-matchers/README.md) | Complete the `expect` matcher set | B1, B6 | Done |
| [US-2148](../tasks/US-2148-runner-modifiers-grep-retries/README.md) | Test modifiers, `--grep` and `--retries` | B3, B5 | Done |
| [US-2149](../tasks/US-2149-runner-short-located-failures/README.md) | Short, located failures | C3, C4, C5 | Done |

Order: US-2147 → US-2148 → US-2149. US-2149's console summary lists the new statuses from US-2148, so it goes last.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices.

1. **The runner is shared.** `src/test-host/` also runs Persephone's own UI integration suite (`npm run test:ui`,
   `integration-test/run.mjs` passes `--test`). Every change is additive: existing matchers, statuses, report fields
   and console lines keep their meaning, so the integration suite and its tooling keep working unchanged.
2. **Matchers move to their own file, `src/test-host/expect.ts`** (review section B, "Owner"). `context.ts` keeps
   only the `expect` entry point that wires the step bookkeeping (`check`) to it. One job per file; `context.ts`
   shrinks.
3. **Statuses.** `TestResult.status` gains `expected-failure`, `unexpected-pass` and `flaky`.
   - *Exit code:* `unexpected-pass` counts as a failure (exit 1, and it is written to `last-failed.json`), because
     a known bug that stopped reproducing needs a human to look. `expected-failure` and `flaky` do not fail the run,
     as in Playwright; both are counted and listed in the summary so neither is silent.
   - *Retries* apply only to an attempt that counts as a failure (`failed`, `unexpected-pass`). A test that passes on
     a later attempt is `flaky`. Default `--retries 0`, so nothing changes unless asked.
4. **`test.only`.** If any selected test is marked `only`, the run executes only the `only` tests (across all files)
   and the console says so. No failure for a committed `only`: there is no CI here, and the line in the summary is
   enough of a reminder.
5. **`--grep` matches the test name only**, as a JavaScript `RegExp` built from the string, case-sensitive. It is
   applied next to the existing selection filters in `test-selection.ts`, not as a second filter path (review
   section B, "Owner").
6. **`.not` covers every matcher**, `toThrow` included. `expect(value, message)` puts the message first in the
   failure text; the generated text follows it.
7. **Stand-ins in `expect` (B6)** are refused with a message that says to `await` the value first (or to read the
   property), instead of the unhandled `toJSON` rejection seen in the pilot.
8. **Unknown-member errors (C3).** The runner asks for `hints: "never"`. Where the short form needs the member
   names, the task plan names the existing source of those names rather than adding a second lookup protocol
   (refactoring guardrail 1). The full list, when the runner already has it, goes to `tests.log` only.

9. **Deviation from C3: no full member list in `tests.log`.** Verified in plan review: with `hints: "never"`
   ai-vision's resolver returns no hint at all (`nodeHint`/`errorNodeHint` return early), so the full list cannot
   reach the log without a second call, and a diagnostic replay of a path that invoked a method is unsafe. The
   server still appends `Did you mean …?` when a close member exists; when none does, the runner appends one line,
   `List members: ctx.call("<resolved path>.$help")`, built from the `resolved up to` text already in the error.
10. **Scope trims in plan review.** No `--help` for the Rust `persephone-test` launcher (outside 1a; the guide's
    option list documents the new flags) and no modifier support in the integration suite's own `test()` (it never
    opts in, so it never sees the new statuses). Both are possible follow-ups.

## Notes

### 2026-11-22
- Epic created from roadmap step 1a. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- Plan review trimmed the Rust `--help` and integration-suite modifier work (decision 10) and replaced the
  "full list in `tests.log`" half of C3 with the `List members` pointer (decision 9).
- Implementation by Codex (Luna) in one session for all three tasks. Live check by Claude found and fixed three
  defects: `toMatchObject` never compared primitive leaves (every nested match failed), the console `Summary:` block
  and the report's attempt lines were written as double-encoded UTF-8 (`â€”`), and the summary's "first error line"
  was the call's echoed step (`call pagez`) instead of the error. The summary line was also cut to C5's fields
  (status, name, `file:line`, first error line).
- Verified live against the running dev app with an attached throwaway suite: all new matchers and `.not`, unknown
  matcher and stand-in errors, message-first failures, `test.skip` / `test.only` / `test.fails` (expected failure and
  unexpected pass), `--retries 1` (flaky), `--grep`, invalid `--grep` / `--retries` values, short unknown-member
  errors with and without a suggestion, `Location:` in `report.md`, `last-failed.json` contents, exit codes.
  `npm run test:ui -- --area core/smoke` still passes.
- Completion skills by Codex (Luna). `/userdoc` also fixed the guide's developer-checkout command
  (`electron .`, not `electron .vite/build/main.js`, which makes `--attach` read the `Electron` settings folder).
