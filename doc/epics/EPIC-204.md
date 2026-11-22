# EPIC-204: Test window and session pages for web-app tests

## Status

**Status:** Completed 2026-11-22
**Created:** 2026-11-22

## Overview

Step 2 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap. An attached run
(`--attach`) today does its bookkeeping (baseline, cleanup, attention handling, failure screenshot) against the
default window, which is the user's own. This epic gives every attached run a **test window**, keeps every runner
call inside it, lets a test declare an already signed-in **session page**, and replaces the window screenshot with a
capture of the pages under test plus a small **failure bundle**. Step 1a ([EPIC-202](EPIC-202.md)) and step 1b
([EPIC-203](EPIC-203.md)) fixed the runner and the browser automation it drives; US-2146 already limited attached
cleanup to owned pages and switched the dialog/menu sweep off. This epic builds on both.

Proposals covered: **A1, A2, A3, A4, C1, C2**. Feedback items of
[US-2138](../tasks/US-2138-web-app-test-feedback/README.md) closed: 3 (session-page half; storage state is F2,
step 5), 11, 13, 22 (runner half: menu closed between tests), 23.

## Goals

- An attached run works in its own window: `--attach` opens a new test window by default, `--window <index or
  title>` uses an existing one. `ctx.app`, `ctx.call` and every runner bookkeeping call are rooted at that window;
  `ctx.root` reaches the whole app (A1).
- Inside the test window cleanup is complete again (owned pages, a popup menu left open, leftover dialogs); outside it
  the runner touches nothing and lists nothing (A2).
- Attention raised by another window is retried, then reported as an **environment stop**, not as failed tests (A3).
- `ctx.usePage({ url, title? })` adopts an already open, signed-in browser page in the test window as a page under
  test that is never closed (A4).
- A failed test captures the pages under test, never the user's window, and writes a failure bundle (URL, title, page
  errors, console errors, failed requests) with no bodies or headers (C1, C2).

## Linked Tasks

| Task | Title | Proposals | Status |
|------|-------|-----------|--------|
| [US-2153](../tasks/US-2153-runner-test-window/README.md) | Runner test window for attached runs | A1, A2 | Done |
| [US-2154](../tasks/US-2154-attention-environment-stop/README.md) | Attention from other windows: retry, then environment stop | A3 | Done |
| [US-2155](../tasks/US-2155-session-pages/README.md) | Session pages: `ctx.usePage` | A4 | Done |
| [US-2156](../tasks/US-2156-failure-capture-bundle/README.md) | Failure capture of pages under test and failure bundle | C1, C2 | Done |

Order: US-2153 → US-2154 → US-2155 → US-2156. All four change `src/test-host/` and each builds on the test window of
US-2153; US-2156 captures the session pages of US-2155. Implementations run one at a time, each staged after review.

## Decisions (2026-11-22)

Taken by Claude at epic start; the user delegates these choices (review section 6 answers taken as recommended).

1. **Test window by default.** `--attach` always opens its own window for the run (review open question 1). `--window
   <index or title>` uses an existing open window instead (index: the `windows[i]` index; title: a unique
   case-insensitive substring of the window's title — ambiguous or missing matches stop the run before any test,
   listing nothing about other windows beyond the count). `--window` without `--attach` is a usage error.
2. **Owned runs are unchanged.** Without `--attach` the app is the runner's own; the test window is the app's first
   window and paths stay unprefixed, so the UI integration suite (`npm run test:ui`) keeps its exact behaviour.
3. **One owner for scoping.** A single test-host module owns "which window is the test window" and "how a path is
   scoped to it" (prefix `windows[i].`; paths whose first segment is root-only in the call grammar — `windows`, `main`,
   `guides` — and paths a test already wrote as `windows[…]` pass unchanged). `ctx.app`, `ctx.call`, `ctx.callText`,
   `ctx.set`, `ctx.waitFor`, `ctx.script`, `ctx.openBrowser`, `browser-helpers.ts` and `results.ts` all go through it;
   no call site builds a prefix by hand. `ctx.root` is the unscoped stand-in. If window indexes can shift while the
   app runs, the module resolves the window by a stable identity, not a cached index.
4. **The runner's own window is closed at run end.** A window the runner opened is closed (after its pages) when the
   run ends, leaving no persisted residue the user would see as a closed window; a `--window` window is never closed.
5. **Cleanup in the test window.** The popup-menu close and dialog sweep run again in attached runs, but only in the
   test window. Page closing stays owned-only (US-2146) when the window came from `--window`; in a runner-opened window
   every page that appeared since the baseline is the test's.
6. **Environment stop (A3).** An unexpected attention reply is retried a few times with the poll delay. If it persists
   and it comes from outside the test window, the run stops: the current test and the rest are reported as not run,
   the report and console name the cause ("a dialog is open in another window"), and the exit code is non-zero and
   distinct from test failure if a code is free. Attention raised inside the test window stays the test's failure, with
   the cause named.
7. **Session pages (A4).** `ctx.usePage({ url, title? })` looks only in the test window and only at browser pages
   (read from the page list, no per-page probing that would log failed steps). `url` is a prefix string or RegExp,
   `title` a substring or RegExp; exactly one match is required, otherwise the error gives the match count only. The
   page is never closed or reloaded by the runner. The guide documents the pattern: keep a window for tests, sign in
   there once by hand, run with `--window <title>`.
8. **Failure capture (C1).** In an attached run the runner never calls `window.screen.screenshot`; it captures the
   pages under test (owned pages and session pages). Owned runs keep the window screenshot as today.
9. **Failure bundle and privacy (C2).** Per failed test, one bundle file next to the report, linked from `report.md`
   and `report.json`: per page under test its URL and title, `pageErrors()`, console errors, and requests during the
   test that failed or returned 4xx/5xx, read through members that already exist. Network entries carry method, URL,
   status and timing only — never request or response bodies or headers. Query-string values are redacted (keys
   kept), since they can carry tokens. Nothing from pages outside the pages under test. The guide says `reports/` /
   `test-results/` is local output that belongs in `.gitignore`.
10. **No protocol code, no bridge change expected.** Everything is host-side in `src/test-host/` plus, if needed, a
    member on the main-process window node to open a new window; such a member goes through the existing `call`
    routing (`main-root.ts`), not a new channel. Nothing a board reaches through `window.persephone` changes; if a plan
    finds otherwise, it bumps `BOARD_BRIDGE_VERSION` with a history line.

## Notes

### 2026-11-22
- Epic created from roadmap step 2. Run autonomously; task investigation and implementation delegated to Codex per
  `persephone-codex-dev`, plan review and live verification by Claude.
- **Plan review decisions.**
  - *US-2153*: the first plan reserved window indexes per run (released on MCP-session disconnect, enforced at
    every reopen path in `open-windows.ts`). Dropped as out of proportion; instead window indexes are allocated
    monotonically (a closed test window's index is never reused in the process) and the window's live Electron id
    is checked once per test attempt and before disposal. Main side: `windows.createTestWindow()`,
    `windows.selectTestWindow(selector)` (the main side alone parses index vs title), `windows.disposeTestWindow(index,
    windowId)` (only for windows that call created) and `windows[i].windowId`, owned by
    `src/main/mcp/ai-vision/test-window-operations.ts`. Host side: `src/test-host/test-window.ts`
    (`TestWindowOwner`) is the one place paths are scoped.
  - *US-2154*: the investigation showed a scoped call only collects attention from its own window's renderer and
    native-dialog tracker, so scoping already removes item 13's cause, and that an attention reply does not prove the
    call did not run. So only the runner's own side-effect-free bookkeeping reads are retried (3 × poll delay); a
    test call is never replayed. Attention identified as another window's (native "in window N", or an explicit
    `windows[j]` path) and a closed or replaced test window are an environment stop: interrupted and remaining tests
    `not-run`, `environmentStop` in the reports, exit code 3, and `last-failed.json` lists failures plus `not-run`
    tests (no merge with the previous file).
  - *US-2155*: matching uses the scoped `pages.all` summary (no per-page `editor.url` probe); a user-opened
    incognito/Tor page has no URL there and cannot be a session page.
  - *US-2156*: the network log's `timestamp` was verified live as epoch milliseconds (same clock as the host), so
    failed requests are filtered to the attempt like page errors. One bundle per failed attempt, written with
    `wx`; no cleanup-only capture.
- **Fixes by Claude during live verification.** `windows.createTestWindow` was called without an argument array, so
  the call only described the method ("did not return a valid live identity"). A test window closed during a test
  made that test fail its cleanup instead of stopping the run; the attempt now checks the window identity before
  cleanup. An out-of-plan `.gitignore` change (`reports/`, `test-results/` unanchored) was reverted.
- **Live verification (dev app, attached runs against a local HTTP page in windows Claude opened).** Created window:
  `--attach` opened its own window, every call went to `windows[N].`, the run closed it at the end with no record
  left in `openWindows.json`; `ctx.root.windows` reached the whole app. `--window <index>` used a window Claude
  opened and left it open; an ambiguous title answered `{ count: 2 }` only. A popup menu a test left open in the test
  window was closed by cleanup and the next test started clean. A popup menu open in another window, reached through
  an explicit `windows[j]` path, stopped the run (exit 3, `not-run` for the interrupted and remaining tests, cause in
  console and reports, `last-failed.json` lists them); the other window's menu was not touched. A test window closed
  mid-test stopped the run the same way. `ctx.usePage` found a page in the selected window by URL prefix and title,
  answered "matched 0 pages" for no match, and the page stayed open across the run. A failed test produced no window
  screenshot in attached runs, a screenshot of each page under test, and a bundle with page errors, console errors and
  the 404 request with query values redacted; the page's `Authorization` header, query token and response body appear
  nowhere in the results folder.
- Checks: `npm run lint`, `npm run typecheck`, `npm run guides:check` (132 pages), `npm run i18n:check` (no catalog
  changes; all packs complete); `npm run test:ui -- --area core` 36 passed. Completion skills by Codex (Luna):
  `/review` found nothing to act on; `/document` updated `key-files.md`; `/userdoc` split the web-app test guide
  (over the 20,000-character limit) into the hub `agents/web-app-tests/index.md` with
  `attached-runs-and-results.md` and `call-boundary-and-examples.md`, and updated links.
- **Not covered / limitations.** Untracked OS-level dialogs give no attention signal (documented). A popup menu that
  opens just after a test's last call is found by cleanup's snapshot read before the sweep, so that test fails with
  "Could not inspect browser pages for cleanup: A popup menu is open in the test window" plus the leftover-state
  note; the sweep then closes it. Network entries have no duration (`durationMs: null`).
