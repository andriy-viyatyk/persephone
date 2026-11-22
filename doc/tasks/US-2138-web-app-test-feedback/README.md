# US-2138: Web-app test runner and temporary site extensions: feedback from a real app suite

## Status

**Status:** Planned
**Priority:** Low
**Started:** —
**Completed:** —

## Summary

A running list of problems and suggestions found while building a regression suite for a real web app
(a React SPA with Entra sign-in and a virtualized grid, on `http://localhost:5173`) with
`persephone-test.exe --attach`, `ctx.openBrowser` and a temporary site extension as the page model.
Items are appended as they are found; none is a blocker unless marked so.

## Why

- First external use of the web-app test runner and temporary site extensions on a full application.
- Each item has a workaround in the suite today; fixing them removes the workarounds for every user.

## Items

| # | Found | Problem / suggestion | Workaround in the suite | Blocker |
|---|---|---|---|---|
| 1 | 2026-11-20 | A model method whose action navigates the page (a click that starts a sign-in redirect) fails with `Cannot find context with specified id (resolved up to "pages[...].editor.app")`. The action did happen; the reply was lost with the old document. Suggestion: report a recognisable result or error such as "the page navigated during the call", or let the caller opt in to treating navigation as success. | The model defers the click with `setTimeout(..., 50)` and returns first; the test wraps the call in a try/catch. | No |
| 2 | 2026-11-20 | After a same-document navigation (`history.pushState` + `popstate` in a SPA), `editor.app` disappears for ~50 ms while the model is re-probed: a read in that window fails with `"app" is not a member of BrowserEditor`, although the extension's runtime and model are unchanged. Seen in the runner: `app.navigate(path)` then `app.state` 50 ms later. Suggestion: keep the existing model reachable during a same-document re-probe (or wait for the probe instead of failing), and/or let `ctx.waitFor` treat a missing `app` as "not yet". | The suite's `go(ctx, site, path)` navigates, then polls the route and state through a try/catch until the model answers. | No |
| 3 | 2026-11-20 | Tests that need a signed-in enterprise app (Entra/MSAL) cannot safely sign in per test: each `ctx.openBrowser` page is a new tab, MSAL keeps tokens per tab, and repeated automated sign-ins hit "We couldn't sign you in" and risk the account being flagged. Suggestion: document a "shared session page" pattern in `web-app-tests.md` (find an existing user-signed-in page, reload it, never close it), and maybe a runner helper to resolve a page by URL/title without probing every page's `editor.url` (that throws on non-browser pages and is logged as a failed step). | The suite finds the page by tab title via `script.execute`, confirms its `editor.url`, reloads it and reuses it; the user signs in once by hand. | No |
| 4 | 2026-11-20 | A model method that returns a long array is cut off without an error: a 365-element array of 4-key objects came back with 153 elements (a 1-key array of 365 was fine), so a scan looked like it had stopped. Suggestion: fail loudly (or flag `truncated`) when a reply is cut, and document the size cap. | The model keeps the scan in the page (`tableScan`) and the test reads it back in slices of 40 rows (`tablePage`). | No |
| 5 | 2026-11-20 | A trusted `editor.click` on some elements delivers only `pointerdown` to the page (no `mouseup`/`click`): seen on an icon button inside an av-grid cell and on a badge span with a tooltip, while a text cell and a double-click work. The click call returns normally, so the test fails later and the cause is hard to find. Suggestion: report when a click produced no `click` event, or say how to make a click on such elements work. | Use `{ synthetic: true }` for the button, and click the neighbouring text cell for the row click. | No |
| 6 | 2026-11-20 | `ctx.expect` lacks common matchers: `toBeGreaterThanOrEqual`, `toBeLessThan`/`toBeLessThanOrEqual`, and `.not`. Using one throws a TypeError that reads like a test bug. Suggestion: add them, or list the supported matchers in `web-app-tests.md`. | Boolean comparisons with `toBe(true)`. | No |
| 7 | 2026-11-20 | `ctx.expect(handle)` on a page handle (e.g. the value `openApp` returns) makes the runner serialise it: an unhandled rejection `"toJSON" is not a member of BrowserEditor` is printed (the test still passes). Suggestion: a handle should answer `toJSON` or be refused with a clear message. | Do not pass handles to `ctx.expect`. | No |
| 8 | 2026-11-20 | Object keys of a model reply come back sorted alphabetically, so the order of a model's own list-as-object (the rows of a panel) is lost. Suggestion: keep insertion order or document that keys are sorted. | Return an array of pairs when order matters; tests compare sorted keys. | No |
| 9 | 2026-11-21 | A download started by the page (Blob + hidden `<a download>` click, as the app's CSV export does) cannot be observed or saved when the runner is attached to a user window: with `--attach` the native Save dialog may appear and cannot be answered, and a test cannot read the file. Suggestion: a runner API to wait for a download and read it (name, bytes), also for attached pages. | The model patches `URL.createObjectURL` and `HTMLAnchorElement.click` in the page to keep the Blob and skip the real download (`exportCaptureStart`, `exportCaptured`); the test reads the bytes (BOM, CRLF) and name from it. The real download path is not exercised. | No |
| 10 | 2026-11-21 | A control that is see-through until the pointer is over its row (an app "..." button) fails `click` with "Element is not visible" and the call waits 5 s; browser webviews do not apply CSS :hover, so the app's own pointer tracking is what shows it. Suggestion: say in the error that `hover()` may be needed first, or let `click` hover the nearest container first. | `hover()` on the cell, then `click(selector, { force: true })`. | No |
| 11 | 2026-11-21 | The failure screenshot written to `reports/screenshots` shows the Persephone main window (here the user's calendar and action items), not the browser page or window the test drove; useless for diagnosing and it captures unrelated personal content. Suggestion: capture the page under test (or the test window). | Not using the screenshots; failures are diagnosed from `tests.log` and `ctx.log` lines. | No |
| 12 | 2026-11-21 | A failed model or browser call prints the whole member list of `BrowserEditor` or of the page model (several kilobytes) after the error text, so a failure summary is mostly hint text. Suggestion: print the hint only on request, or cut it to the member names. | Reading `tests.log` through a script that prints only `test-outcome` and the first 300-900 characters of the error. | No |
| 13 | 2026-11-21 | While a run was going an unrelated Persephone dialog (a password prompt "Decrypt / Cancel" of another page) was open: every `pages.all` call of the runner answered "Attention: dialog is open" and three tests failed at their first step ("call pages.all returned unexpected attention"), though the app was fine. Suggestion: the runner should tell the attention dialog apart from a test failure (report it as an environment stop, not a test failure) or wait and retry the call a few times. | Rerun the file once the dialog was gone. | No |
| 14 | 2026-11-21 | `ctx.expect` has no `.not` (`expect(x).not.toContain(y)` throws "Cannot read properties of undefined (reading 'toContain')", which reads like an app failure) and the `report.json` entry of a failed test has only the message and a `step` string, no source line. Suggestion: add `.not`, and a line number or stack frame of the test file to the failure record. | `expect(list.includes(y)).toBe(false)`; a small script prints status, message and step of each test from `report.json` (`tools/fail.mjs`). | No |
| 15 | 2026-11-21 | `editor.click` has no double-click member (`dblclick` is not a member) but `click(locator, { clickCount: 2 })` works and fires the app's double-click; the guide and `$help` do not say so, so an agent first tries `dblclick`. Suggestion: mention `clickCount: 2` in the `click` help line (and in `web-app-tests.md`). | `site.click(selector, { clickCount: 2 })`. | No |
| 16 | 2026-11-21 | `pressKey(key, { target })` first clicks the target with trusted input, which for a draggable or focus-sensitive element (a resize handle, a cell in edit mode) can start a drag or commit an edit before the key. Suggestion: a `focus(locator)` member (or a `target` option that focuses without clicking). | Keys sent to a resize handle after a first click on it work; elsewhere the tests click the element deliberately, then send the key without a target. | No |
| 17 | 2026-11-21 | There is no mouse-down / mouse-move / mouse-up member, so a press-drag-release that has to be inspected while the button is held (the Calendar's mini calendar marks the range live and reads the counts only on release) cannot be driven with trusted input; `drag()` does it in one step. Suggestion: `mouseDown(locator)`, `mouseMove(locator)`, `mouseUp()` with the usual position and modifier options. | The test model fires synthetic `PointerEvent`s (down, over, up on the body, a move with no button held, a window blur) and reads the marked days after each; the final selection is also checked with a real `drag()`. | No |
| 18 | 2026-11-21 | `drag(source, destination, { position, targetPosition })` rejects a position outside the element ("position must be inside the element border box"), so a drag by an offset (resizing an av-grid column from the right edge of its header) cannot be asked for directly. Suggestion: `dragBy(locator, dx, dy, { position })` or accept positions outside the box. | Drag from the right edge inside the header to a point inside the next header (a net move of a few tens of pixels). | No |
| 19 | 2026-11-21 | There is no way to read what a Ctrl+C put on the clipboard ("Ctrl+C/V use the real OS clipboard"), so a copy of grid cells cannot be asserted. Suggestion: `clipboard.readText()` on the page, or a capture like the one for downloads. | The model dispatches a `copy` event with a `DataTransfer` on the grid and reads `text/plain`, which works only for an app that writes through the event. | No |
| 20 | 2026-11-21 | No way to make one request fail (route, fulfil or abort by URL), so a "the read failed, Retry" state cannot be reached honestly. Suggestion: a request-interception member (`route(pattern, handler)`) on the browser editor. | The page's `XMLHttpRequest.prototype.open` is patched through `evaluate` to send the Calendar request to an address that answers 404, and the patch is taken off for the retry. | No |
| 21 | 2026-11-21 | `click` does not scroll the target into view inside a scrollable pop-up list: an item above the visible part fails after 5 s with "Element does not receive pointer events; covered by <the button that opened the list>", which hides the real cause. Suggestion: scroll the element into view before the hit test, or name the clipping container in the error. Also `ctx.expect` has no `toBeLessThan` (`toBeGreaterThan` exists): the call throws "is not a function". | The model's selector helper calls `scrollIntoView({ block: "nearest" })` before returning the selector; comparisons are written as `expect(a < b).toBe(true)`. | No |
| 22 | 2026-11-21 | A right-click on an element the page gives no menu (an av-grid header cell) opens the browser's own context menu, and from then on every call answers "Attention: a popup menu is open" until `windows[i].menus[0].close()` is called; a test that fails first leaves it open, so all later tests in the run fail at their first step with the misleading "No <app> page in a test window". Suggestion: let the runner close a popup menu of the test window between tests (it already does so for some) and name the cause in the failure ("a popup menu is open"), and show `menus[0].close()` in the `$help` of the attention reply for `ctx.app` calls. | The test calls `ctx.app.windows[1].menus[0].close()` right after the right-click (and in a `finally` at the end of every test of the area). | No |
| 23 | 2026-11-21 | The per-test cleanup (`close-page`, `close-popup-menu`, "left a renderer dialog open") works on every window, the user's main window included: during a run it closed 17 pages that opened there and twice found a popup menu of the user's own page (a video player menu) and counted it as "leftover state", which failed tests that had passed; the screenshot step also printed the title, file path and URL of every page of the main window into the run output. Suggestion: with `--attach`, limit the baseline snapshot, the cleanup and the failure screenshot to the windows the tests drive (the shared test window), and never list other windows' pages in a report. | Rerun the failed files (`-RerunFailed`); the output is not shared. | No |
| 24 | 2026-11-21 | `ctx.expect(value)` and `ctx.waitFor` take no message, so a test kept failing on purpose for a known app bug can only say "Expected [] to equal [...]" or "Timed out after 6000 ms waiting for callback" with a long last value; the reader cannot tell a known bug from a new break. Suggestion: an optional message (`expect(value, message)`, `waitFor(..., { message })`) shown first in the report, or a `ctx.knownFailure(id, reason)` mark that reports such a test as an expected failure apart from the real ones. | The two tests for app bugs catch the timeout and throw an Error that names the finding ("SPIKE-010 #1 ..."). | no |

## Acceptance Criteria

- [ ] Each item is fixed, documented as intended behavior, or closed with a reason
- [ ] Guides updated (`web-app-tests.md`, `temporary-site-extensions.md`) where behavior changes
- [ ] No regressions in existing functionality

## Implementation Progress

Worked through the roadmap in [the web-app testing review](../../reviews/web-app-testing-review.md) (section 5),
one epic per step.

- **Step 1a — [EPIC-202](../../epics/EPIC-202.md) (done 2026-11-22):** items 6, 7, 12 (runner half), 14, 24 and the
  matcher half of 21.
- **Step 1b — [EPIC-203](../../epics/EPIC-203.md) (done 2026-11-22):** items 4, 8 (sorting from Chromium's CDP
  transfer: fixed for page-model replies, documented for `evaluate`), 15, 16, 18, 21 (input half), 22 (menu half)
  and half of 1.
- **Step 2 — [EPIC-204](../../epics/EPIC-204.md) (done 2026-11-22):** items 3 (session-page half), 11, 13, 22 (runner
  half), 23.
- **Step 3 — [EPIC-205](../../epics/EPIC-205.md) (done 2026-11-22):** item 24 (`waitFor` message; the `expect`
  message was step 1a) and the runner half of 2 (inside `ctx.expect.poll` a stand-in that is not there yet counts as
  "not yet"). Also polling assertions (B2), file-level hooks (B4) and a per-test timeout (B7), which the suite had
  worked around (a wrapped `test()` for a `finally`, `waitFor` + `expect` pairs).
- **Step 4 — [EPIC-206](../../epics/EPIC-206.md) (done 2026-11-22):** no numbered item is closed by it alone; it
  removes the reason for the pilot model's generic layer and its fourteen tag-and-return `*Target` members. Selector
  engines (`role=`, `label=`, `placeholder=`, `testid=`, `title=`, `alt=`, `ref=`), `>>` chaining, `nth=`,
  `:has-text()`/`:visible`, the object form, refs handed out by a page model (`runtime.ref`) and the other runtime
  helpers, locator reads (`count`, `isVisible`, `isEnabled`, `isChecked`, `innerText`, `allInnerTexts`,
  `boundingBox`, bulk `query`) and `waitForFunction`.
- Still open after step 4: 1 (rest), 2 (bridge half, G2), 3 (storage-state half, F2), 5, 9, 10, 17, 19, 20 — roadmap
  steps 5–7.
