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
| 7 | 2026-11-20 | `ctx.expect(handle)` on a page handle (e.g. the value `openCdi` returns) makes the runner serialise it: an unhandled rejection `"toJSON" is not a member of BrowserEditor` is printed (the test still passes). Suggestion: a handle should answer `toJSON` or be refused with a clear message. | Do not pass handles to `ctx.expect`. | No |
| 8 | 2026-11-20 | Object keys of a model reply come back sorted alphabetically, so the order of a model's own list-as-object (the rows of a panel) is lost. Suggestion: keep insertion order or document that keys are sorted. | Return an array of pairs when order matters; tests compare sorted keys. | No |
| 9 | 2026-11-21 | A download started by the page (Blob + hidden `<a download>` click, as the app's CSV export does) cannot be observed or saved when the runner is attached to a user window: with `--attach` the native Save dialog may appear and cannot be answered, and a test cannot read the file. Suggestion: a runner API to wait for a download and read it (name, bytes), also for attached pages. | The model patches `URL.createObjectURL` and `HTMLAnchorElement.click` in the page to keep the Blob and skip the real download (`exportCaptureStart`, `exportCaptured`); the test reads the bytes (BOM, CRLF) and name from it. The real download path is not exercised. | No |
| 10 | 2026-11-21 | A control that is see-through until the pointer is over its row (an app "..." button) fails `click` with "Element is not visible" and the call waits 5 s; browser webviews do not apply CSS :hover, so the app's own pointer tracking is what shows it. Suggestion: say in the error that `hover()` may be needed first, or let `click` hover the nearest container first. | `hover()` on the cell, then `click(selector, { force: true })`. | No |
| 11 | 2026-11-21 | The failure screenshot written to `reports/screenshots` shows the Persephone main window (here the user's calendar and action items), not the browser page or window the test drove; useless for diagnosing and it captures unrelated personal content. Suggestion: capture the page under test (or the test window). | Not using the screenshots; failures are diagnosed from `tests.log` and `ctx.log` lines. | No |
| 12 | 2026-11-21 | A failed model or browser call prints the whole member list of `BrowserEditor` or of the page model (several kilobytes) after the error text, so a failure summary is mostly hint text. Suggestion: print the hint only on request, or cut it to the member names. | Reading `tests.log` through a script that prints only `test-outcome` and the first 300-900 characters of the error. | No |

## Acceptance Criteria

- [ ] Each item is fixed, documented as intended behavior, or closed with a reason
- [ ] Guides updated (`web-app-tests.md`, `temporary-site-extensions.md`) where behavior changes
- [ ] No regressions in existing functionality

## Implementation Progress

Not started — collecting items.
