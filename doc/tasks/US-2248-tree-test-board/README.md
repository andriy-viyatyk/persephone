# US-2248: Test board and UI tests

## Goal

Add an offline board fixture and focused UI integration tests for the board-tree contracts in [EPIC-217](../../epics/EPIC-217.md). Verify the complete user path from `openTree` and Explorer browsing through file editing, tree mutations, restart restore, provider recovery, and claimed-scheme links.

## Background

- The epic's test-board row names `C:\projects\test-boards`, but the suite copies board fixtures into each owned profile's `work/` directory. Follow the established fixture location `integration-test/fixtures/boards/<module>/<board>/`; `tests/helpers/boards.mjs` provides `fixtureBoard(ctx, rel)`, `trustFixtureBoard(ctx, root)`, `openBoardPage(ctx, root)`, `closeBoardPage(ctx, id)`, and `untrustBoard(ctx, root)`. This keeps service state and fixture mutations isolated per module run. Update the epic row to point here instead of treating an external directory as the test fixture.
- Service board precedent is `integration-test/fixtures/boards/module-service/round-trip-board/`: the manifest has `permissions.service: true`, a top-level `service` script path, and the board test opens the service board page to run its bridge. US-2244 defines `persephone.providers.register(type, { readBinary, writeBinary, stat })` alongside `persephone.treeProviders.register(type, { list, stat, mkdir?, rename?, delete? })` on the existing module-service provider channel. Use exactly one `contentProviders` declaration for `test/tree`, with `schemes: ["testtree"]` and `tree: true`.
- US-2244 caps each service listing at 5,000 entries and requires `truncated: true` when more entries exist. Implement the truncation test folder as a lazily generated 5,001-entry virtual listing, return only the first 5,000, and set `truncated`; do not set `truncated` on an undersized list or ask the host to accept an over-limit payload.
- Provider write capabilities are declared per type, not per connection. Therefore `{ conn: "ro" }` may still show type-level write affordances when the type registers writes, but the board handlers must refuse every write for that connection. Assert the operation rejects and then re-list/re-stat to prove the tree was not changed; do not assert that those actions are hidden for `ro`.
- Seed the in-memory tree separately for `{ conn: "a" }` and `{ conn: "b" }`. Include nested directories, a text file, a JSON file, a Unicode-named directory and file, plus exact case-distinct siblings `Readme.md` and `readme.md`. Add test-only paths for a delayed list, a failing nested list, and the virtual truncated directory. These hooks live in the fixture service, not in app code or the service protocol.
- The Explorer panel call facade is owned in `src/renderer/scripting/ai-vision/page-panels.ts`. It exposes `rootPath`, `providerType`, `listItems()`, `openItem(item)`, `revealItem(href)`, `expand(path)`, `collapse(path)`, `navigateUp()`, `openSearch(folder?)`, and `openBoards()`. Use `ctx.app.pages[pageId].panels.explorer.*` for these calls; use `ctx.call` only for methods/options the stand-in cannot express. Existing board bridge tests call `window.persephone` with `page.editor.evaluate(...)` (see `integration-test/tests/boards/bridge/bridge.test.mjs`), which is the appropriate route for `openTree` and `openRawLink`.
- `doc/standards/integration-tests.md` requires board-service tests to declare `requires: ["launch"]`, because only owned launches receive the test-profile environment and isolated board-service directories. Tests use `ctx.fixture()` only for seeded-profile work data; the committed board fixture itself is copied by suite setup. Restart tests use `ctx.restartApp()` and reacquire calls from the refreshed context.
- The existing screen automation path `ctx.app.window.screen.drag(...)` reports that it cannot perform HTML5 drag-and-drop in the app window (`integration-test/tests/sidebar/explorer/explorer.test.mjs`). The runner's path-call tree has no Explorer transfer method today. Do not add a test-only product API: cover cross-tree and OS-drop refusal through an existing callable action if US-2246 exposes one; otherwise document the live UI check as unavailable to automation and assert the target exposes no import capability.

## Implementation Plan

- [ ] **Add the tree fixture** under `integration-test/fixtures/boards/trees/tree-board/` with `board-manifest.json`, `index.html`, `app.js`, and `scripts/service.mjs`. The manifest declares the service permission and service script and exactly one provider type:

  ```json
  "contentProviders": [{ "type": "test/tree", "schemes": ["testtree"], "tree": true }]
  ```

  The service registers content `readBinary`, `writeBinary`, and `stat` handlers for `test/tree`, plus tree `list`, `stat`, `mkdir`, `rename`, and `delete` handlers. Both resolve the same board-owned href format and select independent in-memory maps by `config.conn`; writes for `conn === "ro"` reject with a stable error before mutating either map. The normal seeded connections are `a` and `b`; the read-only connection is `ro`. Keep `config` opaque to core and put no credentials in it.

  ```text
  Before → after, fixture manifest:
  no contentProviders declaration
  → contentProviders: [{ type: "test/tree", schemes: ["testtree"], tree: true }]
  ```
- [ ] Seed `/docs/nested/guide.txt`, `/data/sample.json`, a Unicode directory and child file, and case-distinct root siblings `Readme.md` / `readme.md`. The board's page contains a button whose handler calls `persephone.openTree({ type: "test/tree", config: { conn: "a" }, rootPath: "/" })`. Tests may invoke that bridge method directly with `page.editor.evaluate(...)` to pass alternate configs and assert re-use; include one test that clicks the actual **Open tree** button.
- [ ] Add service-only test hooks by reserved tree paths: `/_test/slow` waits a bounded interval before listing; `/_test/fail/nested` throws on its first nested listing and succeeds on Retry while its parent remains listable; `/_test/truncated` lazily synthesizes 5,001 children and returns the first 5,000 with `truncated: true`. The rest of the seeded tree must remain deterministic and independent across connection keys.
- [ ] Add a second small fixture at `integration-test/fixtures/boards/trees/foreign-tree-board/` with a distinct declared type such as `test/foreign-tree` and scheme `othertree`. Give it a minimal `index.html` and service script that registers a valid tree so the type has an accepted owner when trusted; trust and open this fixture before the primary board asks `openTree` for its type, then assert the primary caller is still denied.
- [ ] Add tests under `integration-test/tests/boards/trees/`. Use the existing helpers in `tests/helpers/boards.mjs` and a local cleanup helper that closes pages and unregisters every fixture board in `finally`. Mark all tests in this module `requires: ["launch"]` because they start module services. Split into these focused files and keep the module below 50 tests and three minutes:
  - `open-browse.test.mjs`: button and direct `openTree` open a tree page; repeated identical descriptor focuses/reuses the same page; `{ conn: "b" }` and a different root produce distinct pages; list root and nested contents; expand Unicode folders; verify `Readme.md` and `readme.md` both remain present; navigate up using provider paths; open text/JSON content through the claimed `testtree:` href; edit the text editor, save with `ctx.app.pages[id].editor.saveFile()`, close that file page, reopen the same `testtree:` href, and assert the newly read content contains the saved bytes.
  - `mutations-and-provider.test.mjs`: create a folder, rename it, delete it through the existing Explorer item menus/actions, and assert each result by re-listing the provider tree; reject `mkdir`, `rename`, and `delete` for `{ conn: "ro"}` and prove the seeded listing remains unchanged; assert the test type has no local filesystem import/reveal/terminal actions; assert the truncated listing reports the warning while exposing no more than 5,000 entries.
  - `loading-errors-and-restore.test.mjs`: delayed root listing shows the Explorer loading state before resolving; expanding `/_test/fail` shows the nested error and its retry succeeds; create pages for both connection configs and restart with `ctx.restartApp()`, then verify each descriptor, expansion and selected item restores independently; unregister the tree board while its tree page remains open, assert **Provider missing**, then call `trustFixtureBoard()` to register/trust it again and verify recovery. Keep the restart case isolated and declare launch as above.
  - `bridge-and-ownership.test.mjs`: from the primary board, `openRawLink("testtree://...")` opens the provider content; an unclaimed scheme rejects; `openTree` for `test/foreign-tree` rejects even when the second board is trusted. Exercise cross-tree and OS drops through an existing `ctx.app` or `ctx.call` action if one is exposed by the landed Explorer panel; otherwise record that the current screen drag API cannot dispatch HTML5 drops and verify no import action is offered, leaving end-to-end drop refusal to Claude's live check.
- [ ] Use call paths already exposed by the product. `ctx.app.pages[pageId].panels.explorer.listItems()`, `.expand(path)`, `.navigateUp()`, `.openItem(item)`, and `.revealItem(href)` are declared by `page-panels.ts`; use `ctx.app.pages[pageId].editor.saveFile()` and `ctx.app.pages[pageId].content` for provider round trips. For bridge errors, evaluate a small async expression in the board frame and return `{ message, code }` rather than leaking thrown objects across the frame. Avoid dependence on test-only model internals or custom call-path aliases.
- [ ] Keep fixture-owned state in memory and reset it when the module service starts, so each module run starts from known tree data and committed files never change. Use the path hooks for slow/error/truncated behavior; do not add a generalized fault-injection protocol. Assert useful error codes where the owning provider contract defines them.
- [ ] Codex authors the fixture and tests but cannot launch Persephone or run this suite. Claude runs the new `boards/trees` module after US-2244 through US-2247 land, triages failures against the owning implementation, and records the run result and any automation gaps in this task document before epic close. No unit tests.

  ```js
  // Before → after, module-service registrations
  persephone.providers.register("test/tree", contentHandlers);
  persephone.treeProviders.register("test/tree", treeHandlers);
  ```

## Concerns

- The implementation plans may still be in flight. Reconcile test method names, tree item shape, error codes, and the `openTree` call contract with the landed US-2244 through US-2247 implementations while preserving their reviewed behavior. Do not modify those plans or their source in this task.
- A 5,000-row truncation fixture can stress rendering. Generate its entries lazily in `list`, return exactly the permitted cap, and assert the warning through the existing UI notification surface; do not expand every item in the tree view.
- Type-level capabilities cannot hide write actions only for `conn: "ro"`; handler rejection and unchanged data are the contract-level proof of read-only behavior.
- Board trust state and service state are process/profile scoped. Each test must clean up board pages and unregister the fixture roots in `finally`; restart restore tests must re-open trust before asserting provider recovery.
- The standard screen drag helper cannot currently perform HTML5 drag-and-drop. If no landed Explorer call node can issue a drop, record that automated refusal coverage is unavailable rather than adding an app API solely for the test.

## Acceptance Criteria

- [ ] Both board fixtures live in `integration-test/fixtures/boards/trees/` and tests obtain isolated copies through `fixtureBoard()` / `ctx.fixture()`; no dependency on `C:\projects\test-boards` remains in the plan.
- [ ] The primary manifest declares exactly one tree content provider; its service registers binary content and all five tree operations over independent in-memory connections `a`, `b`, and `ro`. The read-only handler rejects all writes and tests prove no mutation occurred.
- [ ] UI tests cover `openTree` create/reuse, nested/Unicode browsing, case-distinct names, editor open/edit/save/re-read, mkdir/rename/delete, restart restore, missing-provider/re-trust recovery, slow-list loading, nested-error retry, truncation warning, claimed and unclaimed links, and another board's type refusal.
- [ ] Tests use established app call paths and board helpers, run only in owned launches, clean up fixture registrations/pages, and stay under 50 tests and three minutes per module. HTML5 drop refusal is tested only if an existing callable path supports it; otherwise the limitation and Claude live-check result are recorded.
- [ ] No unit tests are added. Codex does not launch Persephone or claim a suite result; Claude runs and triages the module after prerequisites land. The epic/dashboard links resolve to this task document.

## Files Changed Summary

| File | Planned change |
|---|---|
| `integration-test/fixtures/boards/trees/tree-board/board-manifest.json`, `index.html`, `app.js`, `scripts/service.mjs` | Primary tree fixture, open button, in-memory file/tree handlers and controlled test hooks. |
| `integration-test/fixtures/boards/trees/foreign-tree-board/board-manifest.json`, `index.html`, `scripts/service.mjs` | Minimal second owner used to assert cross-board type refusal. |
| `integration-test/tests/boards/trees/open-browse.test.mjs` | Open/reuse, browse, identity, case, Unicode and file edit/save round trip. |
| `integration-test/tests/boards/trees/mutations-and-provider.test.mjs` | Tree writes, read-only enforcement, local-action gates and truncation. |
| `integration-test/tests/boards/trees/loading-errors-and-restore.test.mjs` | Loading, nested retry, missing-provider recovery and restart restore. |
| `integration-test/tests/boards/trees/bridge-and-ownership.test.mjs` | Claimed/unclaimed scheme links, foreign type refusal and supported drop checks. |
| `doc/active-work.md`, `doc/epics/EPIC-217.md` | Replace only the US-2248 entries with links to this plan. |

**No changes:** `src/`, `assets/`, other task documents, test runner/context APIs, `tests/helpers/boards.mjs`, unit tests, or any new provider protocol/API. The fixture must use the already planned `persephone.providers`, `persephone.treeProviders`, `persephone.openTree`, and existing integration-test helpers.
