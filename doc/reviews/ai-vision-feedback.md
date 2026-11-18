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

### 2026-11-18 · EPIC-188 / US-2072 · Codex Luna (plan)
- **Area:** app object / guide editors/folder
- **What the agent expected:** That `pages.openFile(folderPath)` opens the folder in Folder View, based on the guide's short instruction to click a folder in File Explorer.
- **What actually happened:** `pages.openFile(folderPath)` opens an editorless workspace page with Explorer rooted at that folder. To reach `category-view`, the test must open a parent workspace and double-click a child-folder row; the facade has no direct folder-opening method.
- **How it was resolved:** Read the `pages.openFile` help in `PageCollectionWrapper.ts`, the Explorer panel node in `page-panels.ts`, and `FileTreeProvider.getNavigationUrl`; use a snapshot ref and `window.screen.click(..., { clickCount: 2 })` on a child folder row.
- **Suggested improvement:** Add a short test-authoring note to `folder.md` that `pages.openFile(folder)` creates a workspace page, and show how a folder row opens Folder View.

### 2026-11-18 · EPIC-188 / US-2072 · Codex Luna (plan)
- **Area:** $help / guide editors/folder / screen
- **What the agent expected:** A stable named control or facade setter for switching Folder View between list and tile modes.
- **What actually happened:** The guide and facade expose the current mode, but the facade has no setter and only `category-breadcrumb` is curated. The view-mode button has no accessible label or `data-name`; source inspection found its `data-type="icon-button"` under `[data-name="category-search-host"]`. Its popup menu exposes mode ids through `menus[0]`.
- **How it was resolved:** Use `[data-name="category-search-host"] button[data-type="icon-button"]` when the search input is empty, then `app.menus[0].click("tiles-landscape")` / `click("list")`; verify `editor.viewMode`.
- **Suggested improvement:** Add the View Mode button and mode-menu ids to the guide or add a curated Folder View element/action.

### 2026-11-18 · EPIC-188 / US-2071 · Codex Luna (plan) / Claude (run)
- **Area:** $help / screen (MCP Inspector)
- **What the agent expected:** Stable names for the Inspector's tool-argument fields, and `<textarea>` elements for string arguments.
- **What actually happened:** `McpInspectorFacade` `$help` says argument fields are not listed; the plan typed into `[data-type="mcp-tool-arg-form"] textarea` by `nth`. That selector hit Monaco's hidden textarea of the `args` field ("covered by view-line"); UIKit's Textarea is a contenteditable `div[data-type="textarea"]`.
- **How it was resolved:** Test types into `[data-type="mcp-tool-arg-form"] [data-type="textarea"]` with `nth`, and fills only the string `path` argument (object/array arguments are Monaco editors).
- **Suggested improvement:** Name each argument field (`mcp-arg-<name>`) in `ToolArgForm`, and say in the UIKit/screens guide that Textarea is contenteditable.

### 2026-11-18 · EPIC-188 / US-2071 · Codex Luna (plan)
- **Area:** guide screens/mcp-inspector
- **What the agent expected:** An end-to-end example: open the Inspector, select a tool, enter schema-driven arguments, call it, read the result.
- **What actually happened:** Neither the guide nor `web-app-tests.md` has one, and the facade has no `callTool`; the flow (and that a self-connection to the app's own MCP endpoint works) was inferred from source.
- **How it was resolved:** Plan derived from source; the self-connection worked at run time.
- **Suggested improvement:** Add a short "call a tool from the Inspector" recipe to `screens/mcp-inspector.md`.

### 2026-11-18 · EPIC-188 / US-2071 · Claude (run)
- **Area:** screen
- **What the agent expected:** `window.screen.click("text=Tools")` to click the Tools segment.
- **What actually happened:** Unquoted `text=` is a substring match: it also matched `<code>tools.search()</code>` and `tools.execute(...)` in the server instructions and failed as ambiguous.
- **How it was resolved:** Test uses the exact quoted form `text="Tools"`.
- **Suggested improvement:** State in `window.screen` `$help` that `text=foo` is a case-insensitive substring match and `text="Foo"` is exact, and suggest the exact form first.

### 2026-11-18 · EPIC-188 / US-2071 · Claude (run)
- **Area:** app object
- **What the agent expected:** `ctx.expect(await editor.availablePanels).toBe(undefined)` for a disconnected Inspector, as the facade says "undefined".
- **What actually happened:** Values cross the call boundary as JSON, so `undefined` arrives as `null`.
- **How it was resolved:** Test compares with `null`.
- **Suggested improvement:** Say in `web-app-tests.md` that `undefined` results arrive as `null`.

### 2026-11-18 · EPIC-188 / US-2071 · Claude (run)
- **Area:** app object / call options
- **What the agent expected:** Reading `editor.history` through the stand-in.
- **What actually happened:** The history holds full tool and resource payloads; the read was truncated ("truncated without maxLength"), and the stand-in cannot pass `maxLength` (EPIC-186 open item).
- **How it was resolved:** Test reads it with `ctx.call(path, undefined, { maxLength: 2000000 })`.
- **Suggested improvement:** Let the stand-in pass call options, or raise the default reply size for test runs.

### 2026-11-18 · EPIC-188 / US-2069 · Codex Luna (implementation) / Claude (run)
- **Area:** $help dialogs
- **What the agent expected:** A documented way to tell "no dialog is open" when reading `dialogs[0]`.
- **What actually happened:** `dialogs` `$help` documents `cancel()` but not the empty case. The implementation guessed the error text "Cannot read properties of undefined (reading 'title')"; the real error is `No item 0 in "dialogs"`. It also read `dialogs[0].cancel` without `[]` arguments, which reads the member instead of calling it.
- **How it was resolved:** Claude fixed both in `browser-helpers.ts`; a probe run confirmed the cleanup.
- **Suggested improvement:** Document in the `dialogs` `$help` that an empty index fails with `No item 0 in "dialogs"`, and expose `dialogs.length`.

### 2026-11-18 · EPIC-188 / US-2074 · Codex Luna (plan) / Claude (run)
- **Area:** app object (pages.openFile)
- **What the agent expected:** That `pages.openFile(<repo>/.git)` opens Git Tree, because the `.git` folder matcher routes it there.
- **What actually happened:** `openFile(folder)` always opens an editorless workspace page rooted at that folder (`editor: null`); Git Tree opens from the Explorer's `.git` row. Recurrence of the EPIC-188 / US-2072 `pages.openFile(folderPath)` entry above.
- **How it was resolved:** Test opens the repository as a workspace page and clicks the `.git` row in its Explorer.
- **Suggested improvement:** Say in `git-tree.md` and the `pages.openFile` `$help` that folder markers (`.git`, `.mneme`) apply to Explorer rows, not to `openFile`.

### 2026-11-18 · EPIC-188 / US-2074, US-2072 · Claude (run)
- **Area:** screen (accessibility snapshot)
- **What the agent expected:** Explorer rows named by the item name (`treeitem ".git"`, `treeitem "project"`).
- **What actually happened:** Row names carry prefixes: `treeitem "Expand .git"`, `treeitem "Expand 📁 project"`, Folder View rows are `generic "📁 project"`, and in tile mode a row is named by its full path. The root row's name carries the full path, so a substring match on "project" hit it through `C:\projects\…`.
- **How it was resolved:** Tests match the whole name with up to two prefix tokens or a preceding path separator.
- **Suggested improvement:** Give tree rows an `aria-label` equal to the item name, and keep the expand chevron's label out of the row name.

### 2026-11-18 · EPIC-188 / US-2074 · Claude (run)
- **Area:** screen / Git Tree
- **What the agent expected:** Commit rows in an interactive snapshot, to click one by ref.
- **What actually happened:** History rows are drawn grid cells and an interactive snapshot does not list them.
- **How it was resolved:** Test waits with `window.screen.waitFor({ text })` and clicks `text="update notes"`.
- **Suggested improvement:** Say in `git-tree.md` that commit rows are reached by text locators (or add `selectCommit(hash)` to the facade).

### 2026-11-18 · EPIC-188 / US-2074 · Codex Luna (implementation) / Claude (run)
- **Area:** other (test structure)
- **What the agent expected:** That removing the fixture folder in `finally` is safe.
- **What actually happened:** `rmSync` threw EPERM (the app still watched the folder for a moment) and the `finally` error replaced the real assertion error in the report.
- **How it was resolved:** Fixture folders are reset at test start only.
- **Suggested improvement:** Add to the authoring rules in `web-app-tests.md`: never let `finally` throw; reset fixtures at the start.

### 2026-11-18 · EPIC-188 / US-2072 · Claude (run)
- **Area:** app object (Folder View facade)
- **What the agent expected:** `editor.rootPath` to be the opened folder.
- **What actually happened:** It is the tree provider's root (the workspace folder); `categoryPath` is the opened folder.
- **How it was resolved:** Test asserts both.
- **Suggested improvement:** Say "the provider root, e.g. the workspace folder, not the shown folder" in the `rootPath` summary.

### 2026-11-18 · EPIC-188 / US-2072 · Claude (run)
- **Area:** screen / menus
- **What the agent expected:** `window.screen.click(...)` on the view-mode button, then `menus[0].click(mode)`.
- **What actually happened:** A click that opens a popup menu returns attention, which the `app` stand-in rejects; every menu read and click must go through `ctx.call(..., { dialog: true })`. A `menus[0].click` that opens a dialog did not return `{ pending: true }`. The menu left open then failed every later test in the module.
- **How it was resolved:** Tests use dialog-aware `ctx.call`; the runner cleanup now closes a stray popup menu.
- **Suggested improvement:** Add a popup-menu example next to the dialog example in `web-app-tests.md`.

### 2026-11-18 · EPIC-188 / US-2072 · Claude (run)
- **Area:** app object (Folder View facade) / guide editors/folder
- **What the agent expected:** `editor.items` of a subfolder to list only its entries.
- **What actually happened:** Below the provider root the list starts with a `..` parent row (FileTreeProvider); neither the guide nor the facade mentions it.
- **How it was resolved:** Test expects the `..` row.
- **Suggested improvement:** Mention the `..` row in `folder.md` and the `items` summary.

### 2026-11-18 · EPIC-188 / US-2072 · Claude (run)
- **Area:** guide editors/folder
- **What the agent expected:** "Each folder remembers its list or tile layout" to mean a subfolder starts in list mode.
- **What actually happened:** A subfolder without its own choice inherits the nearest parent's mode (`FolderViewModeService`).
- **How it was resolved:** Test expects the inherited mode; `folder.md` now says so.
- **Suggested improvement:** None beyond the guide fix.

### 2026-11-18 · EPIC-188 / US-2072 · Claude (run) / Codex Luna (implementation)
- **Area:** screen (snapshot)
- **What the agent expected:** `snapshot({ interactive: true, root: '[data-name="category-breadcrumb"]' })` to list the breadcrumb segments.
- **What actually happened:** It returned an empty string: breadcrumb segments are not interactive controls. Codex also could not tell whether snapshots expose `data-part`.
- **How it was resolved:** Test uses a plain snapshot and reads `data-part` with `window.screen.evaluate`.
- **Suggested improvement:** Say in `window.screen` `$help` that `interactive: true` keeps only controls and can return an empty string.

### 2026-11-18 · EPIC-188 / US-2073 · Codex Luna (plan)
- **Area:** guide agents/tools / editor matching
- **What the agent expected:** That the toolset's execution log opens in Log View; and that the guide's "not a direct `app.tools` property in scripts" applies to tests.
- **What actually happened:** `tools-execution.log` opens in Monaco; `tools` is on the call-tree root that `ctx.app` mirrors.
- **How it was resolved:** Plan read the raw log text with `ctx.callText`; tests use `ctx.app.tools`.
- **Suggested improvement:** Name the log's editor in `agent-tools.md`, and add the call-tree note to `agents/tools.md`.

### 2026-11-18 · EPIC-188 / US-2073 · Codex Luna (implementation)
- **Area:** guide agent-tools
- **What the agent expected:** The exact error text the toolset editor shows for an invalid manifest.
- **What actually happened:** Not documented; found in the English i18n catalog.
- **How it was resolved:** Test asserts the catalog text.
- **Suggested improvement:** List the invalid-manifest state's text in `agent-tools.md`.

### 2026-11-18 · EPIC-188 / US-2075 · Codex Luna (plan)
- **Area:** app object / native dialogs (Mneme)
- **What the agent expected:** A `mneme` call-tree node, or a way to add a root without the native folder picker.
- **What actually happened:** There is no top-level `mneme` node, and Add root opens a native picker the call tree cannot confirm.
- **How it was resolved:** Test registers the root through the Mneme Config page's MCP Inspector button and Mneme's own `add_root` tool.
- **Suggested improvement:** Add `addRoot(folder, name)` to the Mneme Config facade.

### 2026-11-18 · EPIC-188 / US-2075 · Claude (run)
- **Area:** screen / Mneme Root
- **What the agent expected:** A click on a Mneme tree folder row to expand it, and the Mneme Root facade to stay readable after opening a document.
- **What actually happened:** A row click selects the folder; ArrowRight (or the chevron) expands it. Opening a document navigates the same page to Markdown, so Mneme Root members are gone (`selectedDocumentHref` does not exist).
- **How it was resolved:** Test presses ArrowRight, searches before opening the document, and checks the page title.
- **Suggested improvement:** Say in `mneme.md` that documents open in the same page.

### 2026-11-18 · EPIC-188 / US-2075 · Claude (run)
- **Area:** screen / app object
- **What the agent expected:** `window.screen.click('text="<root name>"')` to hit the root row on the Mneme Config page.
- **What actually happened:** The Inspector page was active and its tool result showed the same name, so the click went there; the Config page was hidden.
- **How it was resolved:** Test calls `pages.showPage("mneme-config-page")` first.
- **Suggested improvement:** None: an agent must activate the page it wants to click.

### 2026-11-18 · EPIC-188 / US-2075 · Claude (run)
- **Area:** app object / call options
- **What the agent expected:** Reading the Mneme Inspector's `tools` and `selectedTool` through the stand-in.
- **What actually happened:** Truncated without `maxLength` (long tool schemas). Recurrence of the US-2071 history entry above.
- **How it was resolved:** `ctx.call` with `maxLength`.
- **Suggested improvement:** As in the US-2071 entry.

### 2026-11-18 · EPIC-188 / US-2074 · Claude (run)
- **Area:** runner
- **What the agent expected:** That per-test cleanup closes every page a test opened.
- **What actually happened:** Cleanup's page list dropped pages whose `editor` is `null`, so workspace pages a test opened stayed open.
- **How it was resolved:** Fixed in `src/test-host/browser-helpers.ts`.
- **Suggested improvement:** None beyond the fix.

### 2026-11-18 · EPIC-189 / US-2076 · Claude (run)
- **Area:** browser (`pages[i].editor.reload`)
- **What the agent expected:** That `reload()` resolves after the reloaded document is in place, like `back()` and `forward()` (EPIC-186 open item).
- **What actually happened:** It called the toolbar's `reloadOrStop()` and resolved at once; on a page that was still loading it stopped the load instead of reloading.
- **How it was resolved:** Product bug, fixed: `reload(options?)` always reloads and waits through the navigation waiter, resolving `{ url, status }`. Covered by two `browser/navigation` tests.
- **Suggested improvement:** None beyond the fix; `agents/browser.md` lists `reload` with the other navigation waits.

### 2026-11-18 · EPIC-189 / US-2081 · Codex Luna (plan)
- **Area:** call path (`downloads`) / native dialogs
- **What the agent expected:** A setting or call path to choose where a browser download is saved, so a test can download without user input.
- **What actually happened:** Every download opened the native Save dialog, which no call path can answer; the `downloads` `$help` does not mention it. The plan reported the whole download checklist as blocked.
- **How it was resolved:** Call gap closed: an app launched by the test runner saves downloads to `<profile>/test-downloads` without the dialog (`src/main/test-mode/downloads.ts`), documented in `agents/web-app-tests.md`.
- **Suggested improvement:** Say in the `downloads` `$help` that a normal app asks where to save and a test instance does not.

### 2026-11-18 · EPIC-189 / US-2081 · Codex Luna (plan)
- **Area:** screen (downloads popup)
- **What the agent expected:** Named controls for every action in the downloads popup.
- **What actually happened:** Clear and Open in Persephone have `data-name`s, but the row's Cancel button has only its localized text, and the guide has no example of driving the popup.
- **How it was resolved:** The test finds Cancel by text inside `[data-name="downloads-list"]` through a snapshot ref.
- **Suggested improvement:** Name the row buttons (`downloads-cancel`, `downloads-dismiss`, `downloads-show-in-folder`) and list them in `editors/browser/layout.md`.

### 2026-11-18 · EPIC-189 / US-2081 · Claude (run)
- **Area:** call path (`downloads.downloads`)
- **What the agent expected:** A completed download's `receivedBytes` to equal its size.
- **What actually happened:** It kept the value from the last throttled progress event (0 for a 29-byte file), in `app.downloads` and in the popup.
- **How it was resolved:** Product bug, fixed: the completion event now carries the final byte counts.
- **Suggested improvement:** None beyond the fix.

### 2026-11-18 · EPIC-189 / US-2081 · Claude (run)
- **Area:** screen (downloads popup)
- **What the agent expected:** A click on the popup's Cancel button to cancel a running download.
- **What actually happened:** Nothing happened: the popup rebuilt every row on each progress event (every 500 ms), so the button under the pointer was replaced between press and release. A user's click could be lost the same way.
- **How it was resolved:** Product bug, fixed: rows update their progress in place and are rebuilt only when an entry's status changes.
- **Suggested improvement:** None beyond the fix.

### 2026-11-18 · EPIC-189 / US-2081 · Claude (run)
- **Area:** call path (`downloads`) / test isolation
- **What the agent expected:** That the downloads popup shows only the test's own download.
- **What actually happened:** The download list is app-wide; finished entries from earlier tests added more `downloads-open` buttons and the click failed as ambiguous (3 visible matches).
- **How it was resolved:** Each test calls `downloads.clearCompleted()` at its start.
- **Suggested improvement:** Mention in `web-app-tests.md` that download history is shared across tests in one app run.

### 2026-11-18 · EPIC-189 / US-2080 · Codex Luna (plan) / Claude (epic)
- **Area:** guide editors/browser (bookmarks)
- **What the agent expected:** From the epic checklist, that the star button adds and removes a bookmark.
- **What actually happened:** The star opens Add Bookmark, or Edit Bookmark when the URL is already saved; removal is the Delete item in the bookmark row's context menu. The guide names the star only as "Add Bookmark" and describes neither the edit nor the delete path. Claude's epic text was the wrong guess.
- **How it was resolved:** Plan corrected in review; the test covers add, edit and delete through the row menu.
- **Suggested improvement:** Describe the star's add/edit behavior and the drawer row menu in `editors/browser/index.md`.

### 2026-11-18 · EPIC-189 / US-2080 · Codex Luna (plan)
- **Area:** call path (`ctx.openBrowser`)
- **What the agent expected:** That `ctx.openBrowser()` gives the new page's id, needed for `pages.showPage` and `pages[id]`.
- **What actually happened:** It returns only the editor handle; the plans diffed `pages.all` before and after to find the id.
- **How it was resolved:** A shared helper (`tests/browser/helpers.mjs` `openBrowserPage`) returns `{ id, editor }`.
- **Suggested improvement:** Expose the page id on the returned handle (`editor.pageId`) or return `{ id, editor }`.

### 2026-11-18 · EPIC-189 / US-2080 · Codex Luna (plan)
- **Area:** guide editors/browser / dialogs
- **What the agent expected:** A documented locator and sequence for bookmark rows in the drawer and for the Add/Edit Bookmark dialog.
- **What actually happened:** Neither guide shows them; the rows and the `dialogs/edit-link` adapter were traced through the Link editor source.
- **How it was resolved:** Found in source.
- **Suggested improvement:** Add a bookmarks recipe to `editors/browser/layout.md` (star, dialog fields, drawer rows, row menu).

### 2026-11-18 · EPIC-189 / US-2080 · Claude (run)
- **Area:** app object / dialogs
- **What the agent expected:** `pages.showPage(id)` (through the stand-in) to work while the Edit Bookmark dialog was open, before typing into it.
- **What actually happened:** The call returned the dialog's attention and the stand-in rejected it.
- **How it was resolved:** The test drops the activation while the modal is open; `window.screen` reaches the dialog anyway.
- **Suggested improvement:** Note next to the dialog example in `web-app-tests.md` that every stand-in call fails while a dialog is open; use `ctx.call(..., { dialog: true })` until it closes.

### 2026-11-18 · EPIC-189 / US-2080 · Claude (run)
- **Area:** screen (inactive pages)
- **What the agent expected:** `document.querySelector('[data-name="bookmarks-drawer-root"]')` from `window.screen.evaluate` to return the active page's drawer.
- **What actually happened:** Inactive pages stay mounted, so it returned the other browser page's drawer. Recurrence of the inactive-page DOM trap (`persephone-mcp-verification-gotchas`).
- **How it was resolved:** Tests pick the element with an `offsetParent`.
- **Suggested improvement:** Say in the `window.screen.evaluate` `$help` that the DOM holds every open page and only the active one is visible.

### 2026-11-18 · EPIC-189 / US-2080 · Claude (run)
- **Area:** screen (bookmarks drawer)
- **What the agent expected:** `text="<bookmark title>"` to address the bookmark row.
- **What actually happened:** The title shows twice (the Collections tree lists links, and the list row), so the click was ambiguous; with `nth: 0` the right-click hit the tree row, whose menu (`edit-link`, `copy-href`) has no Delete.
- **How it was resolved:** The test right-clicks `[data-name="link-row-wrapper"]`.
- **Suggested improvement:** Document that the drawer's Collections tree also shows links, and name its rows.

### 2026-11-18 · EPIC-189 / US-2080 · Codex Luna (implementation)
- **Area:** other (dead code)
- **What the agent expected:** That the bookmarks drawer closes after a bookmark opens, as `BrowserBookmarksModel.handleBookmarkLinkClick` does.
- **What actually happened:** That method has no callers since EPIC-023; the drawer opens links through the Link editor's embedded path and stays open.
- **How it was resolved:** Assertion dropped (no documented contract).
- **Suggested improvement:** Remove `handleBookmarkLinkClick`, or wire it if the drawer should close.

### 2026-11-18 · EPIC-189 / US-2080 · Claude (run)
- **Area:** other (Link editor panels)
- **What the agent expected:** After a bookmark is deleted, the drawer no longer shows it.
- **What actually happened:** The list showed "No links yet", but the Hostnames list kept "127.0.0.1 1" and the Collections tree kept the deleted link.
- **How it was resolved:** Product bug, partly fixed: the Tags and Hostnames lists now refresh on every change (`LinkFilterNavigationPanelView`). The Collections tree is still stale; the test stays failing (open item).
- **Suggested improvement:** Fix the category tree refresh after a link is deleted.

### 2026-11-18 · EPIC-189 / US-2082 · Codex Luna (plan)
- **Area:** $help (browser facade `elements`)
- **What the agent expected:** `url-site-permissions` and `browser-permission-prompt` in the browser facade's `elements`, since the layout guide lists them.
- **What actually happened:** `BROWSER_ELEMENTS` omits both (and the prompt's `permission-allow`, `permission-block`, `permission-origin`); they were traced in the view source.
- **How it was resolved:** Tests use those `data-name`s through `window.screen`.
- **Suggested improvement:** Add them to `BROWSER_ELEMENTS` so `elements` matches the guide.

### 2026-11-18 · EPIC-189 / US-2082 · Codex Luna (implementation) / Claude (run)
- **Area:** browser (`editor.waitFor`)
- **What the agent expected:** `waitFor({ selector: "#result", text: "granted" })` to wait for that text in that element.
- **What actually happened:** "Expected exactly one of 'selector', 'text', 'textGone', or 'time'." The options are exclusive, which `agents/browser.md` does not say.
- **How it was resolved:** `waitFor({ text: "granted" })`.
- **Suggested improvement:** State in the `waitFor` `$help` and the Waits table that exactly one condition is allowed, and how to wait for text inside one element.

### 2026-11-18 · EPIC-189 / US-2082 · Codex Luna (implementation) / Claude (run)
- **Area:** screen (site permissions popover)
- **What the agent expected:** The "Ask" hint inside the permission's switch button, and still visible after Allow.
- **What actually happened:** The hint is a sibling of the switch inside `[data-part="permission-row"]`, and a saved Allow or Block hides it; the plan's selector found nothing, and the Allow expectation was wrong.
- **How it was resolved:** Tests read the hint from the row and expect it hidden after a choice.
- **Suggested improvement:** Describe the row structure and the Ask hint in `editors/browser/layout.md`.

### 2026-11-18 · EPIC-189 / US-2082 · Claude (run)
- **Area:** browser (pop-ups and inner tabs)
- **What the agent expected:** To click the fixture page again after a burst of `window.open` calls.
- **What actually happened:** Each allowed pop-up opens as a new inner tab and becomes the active tab, so `editor.click("#single")` looked in the pop-up tab ("Element not found").
- **How it was resolved:** The test switches back to the fixture tab with `switchTab` before each click.
- **Suggested improvement:** Say in `agents/browser.md` that a tab-disposition pop-up becomes the active tab and page actions follow it.

### 2026-11-18 · EPIC-189 / US-2079 · Codex Luna (plan)
- **Area:** guide editors/browser (layout)
- **What the agent expected:** Selectors for the tab panel's `+` button and the page zoom presets in the layout guide.
- **What actually happened:** Only `tabs-panel-host` and `toolbar-page-zoom` are listed; `[data-add-tab]` and `zoom-preset-<percent>` were found in source.
- **How it was resolved:** Found in source; the tests passed.
- **Suggested improvement:** List both in `editors/browser/layout.md`.

### 2026-11-18 · EPIC-189 / US-2079 · Claude (run)
- **Area:** browser (`pressKey`)
- **What the agent expected:** `editor.pressKey("Control+=")` with focus in the page to zoom the page, as the guide says the shortcut does.
- **What actually happened:** Automation key input reaches the page (it saw `keydown` with `ctrlKey`) but not the guest's `before-input-event` handler, so Persephone's browser shortcuts (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`, `Ctrl+R`, `F5`, `F12`) never run.
- **How it was resolved:** Call gap recorded: the keyboard zoom test was dropped (uncovered), and `agents/browser.md` now says these shortcuts do not run from `pressKey`.
- **Suggested improvement:** Route automation key input through the same shortcut handler, or offer `editor.zoom` / `setZoom` on the facade.

### 2026-11-18 · EPIC-189 / US-2079 · Claude (run)
- **Area:** app object
- **What the agent expected:** `window.screen.evaluate("... getAttribute('aria-expanded')")` to return the string `"false"`.
- **What actually happened:** It came back as boolean `false` and the wait timed out. Recurrence of the EPIC-187 / US-2066 JSON-parsed string entry; it hit two more tests here (reload counter `1` versus `"1"`).
- **How it was resolved:** Tests compare `String(value)` or numbers.
- **Suggested improvement:** As in the earlier entry; three epics in a row now.

### 2026-11-18 · EPIC-189 / US-2079 · Claude (run)
- **Area:** other (session file)
- **What the agent expected:** Browser tab state at `openFiles0.json` `pages[].state.tabs`.
- **What actually happened:** Schema 4 keeps it at `pages[].editors[].state.tabs`; the wait never matched.
- **How it was resolved:** Test reads the editors array.
- **Suggested improvement:** None; tests should prefer restoring and reading the live page over parsing the session file.

### 2026-11-18 · EPIC-189 / US-2078 · Codex Luna (plan)
- **Area:** guide editors/browser (URL bar)
- **What the agent expected:** From the guide, that typing in the URL bar filters the visited-page history.
- **What actually happened:** Focusing lists the tab's visited pages; once you type, it lists earlier search queries that match. The plan flagged an app bug.
- **How it was resolved:** Guide sentence corrected; filtering search queries is uncovered (recording a search needs the internet).
- **Suggested improvement:** None beyond the guide fix.

### 2026-11-18 · EPIC-189 / US-2078 · Codex Luna (plan)
- **Area:** call path (`pages.openUrlInBrowserTab`)
- **What the agent expected:** A new Persephone page for each `openUrlInBrowserTab` call.
- **What actually happened:** With a regular browser page active it adds an inner tab to that page and returns its id; the `$help` does not say so.
- **How it was resolved:** Found in `browser-pages.ts`; the test asserts the reuse.
- **Suggested improvement:** Say "reuses the active browser page as a new inner tab" in the `$help`.

### 2026-11-18 · EPIC-189 / US-2078 · Codex Luna (implementation) / Claude (run)
- **Area:** browser / screen (toolbar state)
- **What the agent expected:** To read Back/Forward as disabled on a page just opened by `openBrowser`, and the Reload/Stop label from the button's `title`.
- **What actually happened:** A page opened by `openBrowser` starts on a blank tab and then navigates, so Back is enabled. Toolbar icon buttons have no `title` attribute or accessible name; their label is a hover tooltip, so snapshots list them as unnamed `button`s.
- **How it was resolved:** The no-history case uses a fresh `addTab(url)` tab; the Stop label is read from the tooltip after `hover`.
- **Suggested improvement:** Give `IconButtonView` an `aria-label` from its `title`, so snapshots name toolbar buttons.

### 2026-11-18 · EPIC-189 / US-2078 · Claude (run)
- **Area:** screen / menus
- **What the agent expected:** The search-engine chip's menu under `menus[0]`.
- **What actually happened:** It is a UIKit `openMenu` popover (`search-engine-menu`), not an application popup menu, so `menus` was empty. Which menus appear in `menus` is not documented.
- **How it was resolved:** The test clicks the engine inside `[data-name="search-engine-menu"]` with `window.screen`.
- **Suggested improvement:** Document in the `menus` `$help` which menus it lists, or list UIKit menus there too.
