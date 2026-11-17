# Agent feedback on driving Persephone (ai-vision)

**Started:** 2026-11-18 · **Purpose:** collect every case where an AI agent driving Persephone got stuck. That covers
the `app` object, `call` paths, `$help`, guides, `window.screen.*` and browser automation. Typical cases are a
confusing doc, a wrong guess, or something that did not work as expected. Later we review the cases that recur and
improve the model or its documentation.

Append only. Add new entries at the end and never rewrite old ones. Do not include personal data.

## Entry format

```
### YYYY-MM-DD · EPIC-XXX / US-XXXX · <agent> (e.g. Codex Luna, Claude)
- **Area:** app object / call path / $help / guide <name> / screen / browser / other
- **What the agent expected:** …
- **What actually happened:** …
- **How it was resolved:** (guess corrected, doc found elsewhere, product bug, still open)
- **Suggested improvement:** (doc wording, hint, $help text, API change), optional
```

## Entries

### 2026-11-18 · EPIC-187 / US-2066 · Codex Luna (plan)
- **Area:** app object / call path
- **What the agent expected:** That `ctx.app` is the script `IApp` type, so members missing from the `.d.ts` files (`settings.sections`, `settings.highlight`, the whole `tools` namespace) are not on the stand-in.
- **What actually happened:** The stand-in mirrors the AiVision call-tree root (`root.ts` `ROOT_MEMBERS`), which has `tools`, `settings.sections` and `settings.highlight`. The plans routed `tools.*` through `ctx.call` and marked the settings paths unverified.
- **How it was resolved:** Guess corrected in review (the US-2067 plan now uses `ctx.app.tools.*`); the settings paths worked at run time.
- **Suggested improvement:** Say in `guides/agents/web-app-tests.md` that `ctx.app` is the call-tree root, not the script `app`, and point at `$help` on the root for its members.

### 2026-11-18 · EPIC-187 / US-2066 · Codex Luna (plan)
- **Area:** guide screens/settings
- **What the agent expected:** That the names under "User-facing label → `elements` name" (for example `window.close-to-tray`) are `data-name` selectors.
- **What actually happened:** They are `elements` names; their selector is the section wrapper. The plan concluded the guide was wrong because no element had `data-name="window.close-to-tray"`.
- **How it was resolved:** Guess corrected in review; the test locates the checkbox inside its section.
- **Suggested improvement:** Add one line under that heading: these are `elements` names for `settings.elements` / `highlight`, not `data-name` values.

### 2026-11-18 · EPIC-187 / US-2066 · Codex Luna (plan)
- **Area:** guide scripting/api/settings, agents/scripting/the-app-object
- **What the agent expected:** The two guides to agree on the size of the Settings catalogue.
- **What actually happened:** One says 14 sections / 27 rows, the other 14 / 26; the live catalogue has more rows (Voice Typing, Microphone Audio).
- **How it was resolved:** Still open; the test reads `settings.sections` instead of a count.
- **Suggested improvement:** Drop the hard-coded counts or generate them from `SETTINGS_CATALOG`.

### 2026-11-18 · EPIC-187 / US-2066 · Claude (run)
- **Area:** call path / screen
- **What the agent expected:** `settings.highlight("window.close-to-tray")` to open Settings and draw the ring, as its `$help` says.
- **What actually happened:** Every app-window highlight failed with "The highlight overlay did not install." The `ai-vision` package installs the overlay with an inline `<script>`, which the main window's hash-only CSP blocks.
- **How it was resolved:** Product bug, fixed: `ui.ts` evaluates the package's `highlightOverlaySource` (the CSP allows `unsafe-eval`) before `installHighlightOverlay()`.
- **Suggested improvement:** A test now covers `settings.highlight` (`tools/settings-page`); its `$help` could also name the result shape (`{ found, count, highlighted }`).

### 2026-11-18 · EPIC-187 / US-2066, US-2065 · Claude (run)
- **Area:** app object
- **What the agent expected:** A stand-in read to return the value with its JSON type: `window.screen.evaluate` returning the string `"true"`, and `fs.read` returning file text.
- **What actually happened:** String results come back as plain text and the test client JSON-parses them, so `"true"` became `true` (a wait timed out) and `fs.read` of a `.json` file returned an object (`JSON.parse("[object Object]")` threw).
- **How it was resolved:** Tests now compare `String(value)` and read files with `ctx.callText("fs.read", ...)`. A sentence was added to `web-app-tests.md`.
- **Suggested improvement:** Consider returning strings JSON-quoted from the stand-in, or keep the documented rule: use `ctx.callText` whenever the exact string matters.

### 2026-11-18 · EPIC-187 / US-2067 · Claude (run)
- **Area:** app object / ctx.waitFor
- **What the agent expected:** That `ctx.waitFor(fn, pages => pages.find(...))` returns the page the predicate found.
- **What actually happened:** It returns the polled value (the whole page list), so `createdPage.title` was `undefined`.
- **How it was resolved:** Test fixed to find the page in the returned list.
- **Suggested improvement:** State in the `ctx.waitFor` line of `web-app-tests.md` that it resolves to the last polled value, not the predicate's result.

### 2026-11-18 · EPIC-187 / US-2067 · Claude (run)
- **Area:** screen / guide screens
- **What the agent expected:** `window.screen.type('[data-name="search-boards-filter"]', text)` to type into the documented filter control.
- **What actually happened:** "Cannot type into non-editable <div>": the `data-name` sits on the Input wrapper; the editable is its `<input>`.
- **How it was resolved:** Test types into `[data-name="search-boards-filter"] input`.
- **Suggested improvement:** Let `type`/`clear` target the single editable descendant of a named wrapper, or document that UIKit inputs carry `data-name` on the wrapper.

### 2026-11-18 · EPIC-187 / US-2067 · Codex Luna (plan) / Claude (run)
- **Area:** other (Search boards catalog)
- **What the agent expected:** An empty published-boards catalog in the test profile, and a "No boards match" message when a query matches nothing.
- **What actually happened:** The test app fetched the live catalog from GitHub at start (the seed had no check time), so the tab was full. With an empty catalog the tab keeps "No published boards available." for any query, because `renderCards` checks the entry count first. No call path reads or seeds the catalog.
- **How it was resolved:** The seed now marks the catalog as checked (no network); the test asserts the empty-catalog behaviour. Populated filtering is uncovered until Phase 7's fixture catalog.
- **Suggested improvement:** Expose a read-only `publishedBoards` listing in the call tree, and a way to point the catalog at the fixture server.

### 2026-11-18 · EPIC-187 / US-2067 · Codex Luna (plan)
- **Area:** call path / dialogs
- **What the agent expected:** A documented sequence for a call that opens a confirmation (`tools.createToolset`).
- **What actually happened:** `{ dialog: true }` is documented, but the pending result plus `dialogs[0].title` / `dialogs[0].click(...)` sequence is only shown by existing tests.
- **How it was resolved:** Copied from `tests/shell/dialogs/later.test.mjs`; it worked.
- **Suggested improvement:** Add a short dialog example to `web-app-tests.md`.

### 2026-11-18 · EPIC-187 / US-2067 · Codex Luna (plan)
- **Area:** $help / guide screens
- **What the agent expected:** Stable names for the hub's individual tabs and editor rows.
- **What actually happened:** `tools-hub-tabs` names the tab strip only; dynamic rows are not `elements`. The plan fell back to `text=` locators, which worked.
- **How it was resolved:** `text=` locators used.
- **Suggested improvement:** Say in the hub `$help` that tabs and rows are reached with `text=` locators or snapshot refs.

### 2026-11-18 · EPIC-187 / US-2068 · Codex Luna (plan)
- **Area:** guide / app object (guides)
- **What the agent expected:** That `guides["editors/grid"]` returns the same text as the shipped file, starting with the title.
- **What actually happened:** It returns the body after front matter, which starts with a blank line, so `startsWith("# Grid Editor")` failed. Where `guides` lives (the main-process root) and how to read it from a test were not documented.
- **How it was resolved:** Test trims before the prefix check; the body equality passed.
- **Suggested improvement:** State in the guides `$help` that reads return the body after front matter, unchanged.

### 2026-11-18 · EPIC-187 / US-2068 · Codex Luna (plan) / Claude (run)
- **Area:** screen
- **What the agent expected:** A unique selector for a link inside the About guide pane.
- **What actually happened:** `a[href="persephone-guide://editors/grid"]` matched two visible links; rendered guide links have no `data-name`.
- **How it was resolved:** Test passes `{ nth: 0 }`.
- **Suggested improvement:** Document the rendered link form, or scope a selector such as `[data-name="about-guide-body"] a[href=...]`.

### 2026-11-18 · EPIC-187 / US-2068 · Codex Luna (plan)
- **Area:** app object (F1)
- **What the agent expected:** A way to make an editor with no guide mapping active, to test F1's fallback to the guide contents.
- **What actually happened:** The only such editor (Storybook) is standalone, and `addEditorPage` rejects it.
- **How it was resolved:** Still open; listed as uncovered.
- **Suggested improvement:** A test-reachable page whose editor has no guide.

### 2026-11-18 · EPIC-187 / US-2065 · Codex Luna (plan)
- **Area:** guide editors/grid / $help
- **What the agent expected:** Locators for the column filter popup, the Edit Columns rows and the cell editor in the grid guide or `$help`.
- **What actually happened:** None are listed, and `GRID_EDITOR_HELP` omits the declared `grid-column-filter` element. The first plan left most of the checklist uncovered; it did not look at the `av-grid` package source in `node_modules`.
- **How it was resolved:** Review pointed at `node_modules/av-grid/dist`; the second plan found `data-cell`, `data-column-key`, `.avg-filter-button` and the rest.
- **Suggested improvement:** Add an automation note to `grid.md` naming the stable av-grid attributes, and keep `GRID_EDITOR_HELP` in sync with `GRID_ELEMENTS`.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** screen
- **What the agent expected:** `window.screen.click('.avg-header-cell[data-column-key="label"] .avg-filter-button')` to open the column filter.
- **What actually happened:** "Element is not visible": the button only shows while the header is hovered.
- **How it was resolved:** Tests call `screen.hover` on the header first.
- **Suggested improvement:** Say in `grid.md` that the filter button is hover-gated and needs `hover` before `click`.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** app object / runner
- **What the agent expected:** That closing a page with `pages.closePage` in `finally` always succeeds.
- **What actually happened:** A grid page left modified returned a pending "Unsaved Changes" dialog. The runner's per-test cleanup does not answer a leftover dialog, so every later test in the module failed at "starting" with an unexpected-attention error (19 failures from one).
- **How it was resolved:** Tests use the discard-aware `closePage` helper from `tests/editors/helpers.mjs`.
- **Suggested improvement:** Have runner cleanup dismiss an "Unsaved Changes" dialog for test-owned pages (Don't Save), so one stray dialog cannot fail the rest of a module.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** guide editors/grid
- **What the agent expected:** CSV header detection: a CSV whose first line looks like a header opens with `csvWithColumns` true.
- **What actually happened:** There is no detection; every CSV opens with `csvWithColumns` false until the CSV options change it.
- **How it was resolved:** Test sets the header option explicitly.
- **Suggested improvement:** Say in `grid.md` that a CSV opens without a header row by default.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** other (scripting)
- **What the agent expected:** `require("electron").clipboard` in `ctx.script` to save and set the clipboard for a paste test, and `ctx.script("await a; await b")` on one line.
- **What actually happened:** `clipboard` is undefined in the renderer; `navigator.clipboard.readText/writeText` works. The one-line form failed to parse ("Unexpected token ';'"); statements on separate lines with a bare final expression work.
- **How it was resolved:** Test uses `navigator.clipboard` with one statement per line.
- **Suggested improvement:** Document in the scripting guide that the last line must be a bare expression, and how to reach the clipboard.

### 2026-11-18 · EPIC-187 / US-2065 · Codex Luna (implementation)
- **Area:** screen
- **What the agent expected:** `window.screen.drag` to reorder grid columns by dragging a header.
- **What actually happened:** The app window refuses HTML5 drag-and-drop ("the source element is draggable"), as its `$help` already says.
- **How it was resolved:** Test removed; column reordering is uncovered.
- **Suggested improvement:** None beyond the existing `$help`; a planning checklist line "no HTML5 drags in the app window" would have saved the round trip.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** app object (grid facade)
- **What the agent expected:** That `editor.rows` reflects the active column filter.
- **What actually happened:** `rows` is the full data set; only `visibleRowCount` follows filters and search.
- **How it was resolved:** Assertion removed; `visibleRowCount` checks the filter.
- **Suggested improvement:** Say in the facade `$help` that `rows` ignores search and filters.

### 2026-11-18 · EPIC-187 / US-2065 · Claude (run)
- **Area:** guide editors/grid
- **What the agent expected:** Per the guide, sorting or filtering disables row insertion and deletion (Ctrl+Insert / Ctrl+Delete).
- **What actually happened:** Since the av-grid move the editor always passes `canAddRows: true`, so Ctrl+Insert adds a row while sorted.
- **How it was resolved:** Still open: the test stays failing and is listed in EPIC-187's open items.
- **Suggested improvement:** Either restore the rule in `GridBodyView` (its projection must react to sort and filter changes) or change the guide.
