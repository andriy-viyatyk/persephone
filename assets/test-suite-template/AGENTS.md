# Web-app test suite notes

This suite tests the local mock page in `site/index.html`. Keep its data synthetic and offline.

## Model and test responsibilities

- Put reusable page reads and page actions in `model/`; return bounded content or state.
- Keep expectations and pass/fail decisions in `tests/*.test.mjs`.
- The model folder loads its direct `*.js` files in name order into one shared scope. Keep shared helpers in `00-base.js` and expose the page model from a later file.
- A model call that can navigate must use the call option `{ allowNavigation: true }` at the test call boundary. Start navigation-sensitive waits before the action.

## Pages and windows

- `ctx.openBrowser()` creates a page owned by the run; cleanup closes it. This starter uses that mode and attaches its model to the test-owned page.
- `ctx.usePage()` adopts an existing browser page; cleanup releases adoption but does not close that page. Use it only for a deliberately retained session page.
- An owned run starts its own app and test window. With --attach, the runner selects or creates a test window; MCP must be enabled in the running profile. Keep calls scoped to that window. User pages outside it are not test pages.

## Waiting and assertions

- Use `ctx.expect.poll()` or the browser editor's `waitFor()` for changing page state. Do not add fixed sleeps.
- Use browser editor locator actions (`site.click`, `site.type`) for input; model methods return page state for assertions.

## Run and results

- Run `./run-tests.ps1`; add `-JsonLines` to request `--reporter json-lines`; other arguments pass through to the runner (`./run-tests.ps1 --attach` while Persephone is already open). Set `PERSEPHONE_TEST_EXE` or put `persephone-test.exe` on `PATH`.
- For an owned run, use `--test <suite-folder>`. For an existing signed-in browser session, use `--attach --window <index-or-title>` and `ctx.usePage()`.
- Default reports and logs are under test-results/ beside a test file or inside the selected suite folder. The test-results/ folder inside this suite is replaced on each run. --log-dir <folder> selects an output folder; --log <file> writes only the step log.
- Read `report.md`, `report.json`, `tests.log`, and failure bundles in the selected output folder.

## Guides

Use the in-app guides instead of copying their full instructions here:

- `guides.agents["web-app-tests"]` (`persephone-guide://agents/web-app-tests`)
- `guides.agents["temporary-site-extensions"]` (`persephone-guide://agents/temporary-site-extensions`)
