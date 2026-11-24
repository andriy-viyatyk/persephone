# EPIC-210: Web-app test feedback, round 2

## Status

**Status:** Completed
**Created:** 2026-11-24
**Completed:** 2026-11-24

## Overview

An external pilot suite of 233 web-app tests was rewritten onto the EPIC-202..209 features: the test
window, `ctx.usePage`, locators, `runtime.ref`, multi-file models, `expect.poll`, file hooks,
`waitForDownload` and the storage helpers. The rewrite logged 14 items. None blocked the rewrite.
This epic replaces the feedback task US-2185 and is the follow-up to US-2138.

Each item below was checked against the source on 2026-11-24 and routed to one task.

## Goals

- Fix the runner and locator bugs the rewrite hit (truncated whole-value reads, `label=`, a lost
  trusted click).
- Close the small API gaps that forced workarounds (named test windows for `--window`, `waitFor` retrying
  read errors, download MIME type, compact failure summary).
- Fill the guide holes, so the next suite author does not rediscover them.

## Linked Tasks

| Task | Title | Items | Status |
|------|-------|-------|--------|
| [US-2186](../tasks/US-2186-runner-unbounded-whole-value-reads/README.md) | Runner reads whole values without truncation (failure capture, `storageState`) | 2, 12 | Done |
| [US-2187](../tasks/US-2187-label-locator-own-text/README.md) | `label=` matches the label's own text, not the wrapped control's | 13 | Done |
| [US-2188](../tasks/US-2188-trusted-click-lost-after-rerender/README.md) | Trusted click right after a list re-render does nothing | 11 | Closed: app-readiness race, not a bug; guidance in US-2191 |
| [US-2189](../tasks/US-2189-named-test-windows/README.md) | Named test windows for `--attach --window` | 1 | Done |
| [US-2190](../tasks/US-2190-runner-api-gaps-round-2/README.md) | Runner API gaps: `waitFor` retries read errors, download MIME type, compact summary, undescribed-member hint | 5, 6, 7, 10 | Done |
| [US-2191](../tasks/US-2191-web-app-test-guide-gaps-round-2/README.md) | Web-app test guide gaps, round 2 | 3, 4, 7, 8, 12, 14 | Done |

Suggested order: US-2186 and US-2187 (bugs, small), US-2190, US-2189, US-2188 (needs a reproduction
first), then US-2191 last, so the guide describes the final behaviour.

## Feedback items and review verdicts

| # | Area | Reported | Verdict (2026-11-24) | Task |
|---|---|---|---|---|
| 1 | runner `--window` | `--window <title>` matches the OS window title, "Persephone" for every window, so a title cannot pick the test window. | **Confirmed.** `selectTestWindow` (`src/main/mcp/ai-vision/test-window-operations.ts:47`) uses `window.getTitle()`. Enhancement: a persisted window name (page titles rejected: the same app can be open in the main window). | US-2189 |
| 2 | failure capture | The failure bundle's `networkRequests` read fails on a busy page: "truncated without maxLength". | **Bug, confirmed.** `captureDiagnostics` (`src/test-host/failure-bundle.ts:77-89`) passes no `maxLength`, and `client.ts:111` rejects any truncated reply. | US-2186 |
| 3 | native popup menu | After a trusted right-click, `ctx.app.menus[0].close()` answers `No item 0 in "menus"`. | **Not a bug.** Since EPIC-20x an automation right-click runs the page's handler and suppresses Persephone's browser menu (`BrowserAutomationMenuGuard`); `{ nativeMenu: true }` opts in. So no menu is open and none needs closing. Documented in `browser-automation.md:78` only. | US-2191 (doc) |
| 4 | guide | The web-app-tests guides never mention `site.storage.clear/set`. | **Confirmed** (only in `browser.md`). | US-2191 |
| 5 | download | `waitForDownload()` has no MIME type. | **Confirmed.** `src/main/download-capture.ts:198` settles `{ suggestedFilename, path, size }`; `item.getMimeType()` is available. | US-2190 |
| 6 | polling | `ctx.waitFor` does not retry a read that throws; `expect.poll` does but returns nothing. | **Confirmed.** `poll-expect.ts:47` sets `retryReadError`; `context-operations.ts:187` does not. | US-2190 |
| 7 | model bridge | A member exposed but missing from `aiVision.members` is reported as "not a member", with no hint about the descriptor list. | **Confirmed** as an error-message gap. | US-2190 (hint), US-2191 (doc) |
| 8 | guide | No guidance on splitting one exposed root across model files when it has getters. | **Confirmed** as a guide gap. | US-2191 |
| 9 | `test.fails` | Not exercised (the app bugs were fixed first). | **No action.** | — |
| 10 | failure output | With ~30 failures the console is unreadable; the summary line has only the first line of the reason. | **Accepted** as an enhancement: `--summary-only` and the failing step in the summary line. | US-2190 |
| 11 | trusted click | A trusted click on a list row's icon buttons right after load returns OK, but the app does nothing; `{ synthetic: true }` works. | **Plausible bug, unconfirmed.** Needs a reproduction on a fixture; it was not reproduced on the external app, because those buttons change its data. | US-2188 |
| 12 | `storageState` | `site.storageState()` fails "truncated without maxLength" with large tokens in storage; the error is not actionable. | **Bug, confirmed.** The guide says runner reads are unbounded by default (`web-app-tests/index.md:40`), but `storageState` is truncated. Same root as #2. | US-2186 |
| 13 | `label=` | For `<label>Show:<select>…</select></label>` the label text includes the option texts, so an exact `label="Show:"s` finds nothing. | **Bug, confirmed.** `page-scripts.ts:285` matches `label.innerText`, which includes the wrapped control. | US-2187 |
| 14 | guide | No example of a dialog-scoped locator when the same button name exists in a dialog and on the page. | **Confirmed** as a guide gap. | US-2191 |

## Notes

### 2026-11-24
- Converted from task US-2185 at the user's request. The original feedback used the external
  project's names and file paths; this epic and its tasks refer to it only as "the pilot suite"
  (repo rule: no customer or customer-project names in Persephone documents).
- Item 11 must be reproduced on a local fixture, never on the external app: its row buttons delete
  or change its data.
