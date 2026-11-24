# US-2191: Web-app test guide gaps, round 2

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — items 3, 4, 7, 8, 11, 12, 14
**Status:** Planned — do last in the epic, so the text matches US-2186/2190 behaviour

## Goal

A suite author finds these answers in the web-app-tests guides without rediscovering them.

## Plan

All pages are under `assets/guides/agents/`. Every page must stay under the 20,000-character limit
(`npm run guides:check`); `web-app-tests/call-boundary-and-examples.md` is close to it, so prefer
the other pages or a new sub-page.

1. **Right-click and Persephone's browser menu (item 3).**
   - Background: an automation right-click runs the page's own handler and does **not** open
     Persephone's browser menu (`BrowserAutomationMenuGuard`); `{ button: "right", nativeMenu: true }`
     opts in.
   - Today this is stated only in `browser-automation.md:78`.
   - Add to `web-app-tests/attached-runs-and-results.md`, next to "A popup menu left open is closed
     and fails the test": an app's own right-click menu is page DOM, and needs no `menus[0].close()`.
     Persephone's menu appears only with `nativeMenu: true`, and the runner's cleanup closes it.
2. **Storage helpers (item 4).** Add a short "Reset page state between tests" example using
   `site.storage.clear({ prefix, area })` and `site.storage.set(key, value, { area })`, with a link
   to the `browser.md` storage-state paragraph. Put it in the web-app-tests index or the
   call-boundary page.
3. **Descriptor gates members (item 7).** In `site-extensions` / `temporary-site-extensions.md`, say
   that every member a test calls must be listed in `aiVision.members`; an exposed but unlisted
   member is not callable.
4. **Splitting one root across model files (item 8).** In the multi-file model section, add the
   getter-safe pattern:
   `Object.defineProperties(root, Object.getOwnPropertyDescriptors(part))`. Add a note that
   `Object.assign` would call getters.
5. **`maxLength` default (item 12).** After US-2186, make sure the guides say runner reads are
   unbounded unless capped. If US-2186 chose the allow-list option, name the members it covers.
6. **Dialog-scoped locator (item 14).** In `browser-automation.md` (the locator section), add an
   example. When the same button name exists in an open dialog and on the page, scope it:
   `dialog[open] >> role=button[name="Discard"s]`. Add the strict-mode error it avoids.

7. **Wait for app readiness before clicking re-rendering rows (item 11, from US-2188).** A trusted
   click goes to whatever the locator matches at that moment. If an app renders placeholder or
   loading rows with the same accessible names and replaces them later, a click right after
   navigation can land on the placeholder and "do nothing". Advise waiting for an app-specific ready
   condition first, for example `ctx.expect.poll` on a model or DOM signal, or the row's final
   content. `{ synthetic: true }` is not the fix. Put this in `browser-automation.md` or the
   web-app-tests pages, wherever there is room.

Already done by other tasks, so verify and do not duplicate: US-2186 documented the unbounded
default (item 12) in `web-app-tests/index.md` and `browser-models-and-playwright.md`. US-2190
documented the `retryErrors`, download and `--summary-only` options and added the runtime hint for
undescribed members. US-2189 documented named windows.

## Acceptance criteria

- [x] Each of the six points is answered in the guides; item 11's readiness guidance is also added.
- [x] Ran `npm run guides:check`; sandbox `spawn EPERM` prevented it from running. Measured all changed page character counts and confirmed each body stays within its limit.
- [x] One-question guide QA: a fresh agent asked "how do I reset localStorage between tests in a
      web-app test?" finds `site.storage.clear`.

## Files

| File | Change |
|---|---|
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md` | Items 3 |
| `assets/guides/agents/web-app-tests/index.md` or `call-boundary-and-examples.md` | Items 4, 12 |
| `assets/guides/agents/temporary-site-extensions.md` (or the site-extensions page that owns the descriptor) | Items 7, 8 |
| `assets/guides/agents/browser-automation.md` | Item 14 |

No code changes.
