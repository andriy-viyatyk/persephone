## EPIC-189 — UI test coverage, phase 6a: Browser page

Completed 2026-11-18. First half of Phase 6 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 21 new
tests in the new `integration-test/tests/browser/` area (`navigation`, `tabs`, `profiles`, `downloads`,
`permissions`), all against the runner's fixture server, with a shared `tests/browser/helpers.mjs`; the suite is 262
tests. Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded 26 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** `pages[i].editor.reload()` resolved before the
page reloaded and stopped a loading page (EPIC-186 open item); a finished download kept a stale byte count; the
downloads popup rebuilt its rows on every progress event, so a Cancel click could be lost; the Link editor's Tags and
Hostnames lists kept a deleted link. **Runner/app test support:** the fixture server serves real content types and a
`/download` route; a test instance saves downloads to `<profile>/test-downloads` without the Save dialog. **Guide
fixes:** URL-bar suggestions, browser shortcuts not reachable from `pressKey`. **Open:** the bookmarks drawer's
Collections tree keeps a deleted link (test stays failing); the EPIC-187 grid row-insertion decision. **Uncovered:**
keyboard page zoom, search-query filtering and engine URLs (internet), Open in Windows Default App and Show in Folder,
camera and microphone. Phase 6b (automation, site extensions, certificate, Show Resources, cinema mode, Tor) is next.
Final launched run (`--with git,mneme`): 259 passed, 2 failed, 1 skipped. Completion skills by Codex (Luna). Epic
document: [EPIC-189](EPIC-189.md).

- [x] **Browser `reload()` waits for the reloaded page (US-2076).**
- [x] **HTTP fixture server: content types and downloads (US-2077).**
- [x] **Navigation and the URL bar (US-2078).**
- [x] **Inner browser tabs and page zoom (US-2079).**
- [x] **Profiles, Incognito and bookmarks (US-2080).**
- [x] **Downloads (US-2081).**
- [x] **Site permissions and blocked pop-ups (US-2082).**

## EPIC-188 — UI test coverage, phase 5b: clipboard, MCP inspector, Folder View, agent tools, Git, Mneme

Completed 2026-11-18. Second half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 20 new
tests in `integration-test/tests/tools/` (`clipboard`, `mcp-inspector`, `agent-tools`, `git` with `requires: ["git"]`,
`mneme` with `requires: ["mneme"]`) and `integration-test/tests/editors/folder/`; the suite is 241 tests. Codex (Luna)
planned and wrote every test blind; Claude reviewed, ran and triaged, and recorded 24 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Runner fix (EPIC-187 leftover):** per-test cleanup now
discards a test's own unsaved pages, dismisses a leftover renderer dialog or popup menu (failing the test that left it),
and closes editorless workspace pages, so one stray dialog no longer fails the rest of a module. **App bug fixed:**
stopping Mneme while its page loaded the status showed "Mneme status failed: Connection closed". **Guide fix:**
`folder.md` says a subfolder inherits its parent's layout. **Open:** the EPIC-187 grid row-insertion decision and the
EPIC-185 env-vars failure are carried over. **Uncovered:** Git Pull/Push and remembered layout, Mneme vector/hybrid
search and model download, Mneme's native Add root picker. Final launched run (`--with git,mneme`): 238 passed, 2
failed, 1 skipped. Completion skills by Codex (Luna). Epic document: [EPIC-188](EPIC-188.md).

- [x] **Runner cleanup answers a stray "Unsaved Changes" dialog (US-2069).**
- [x] **Clipboard history (US-2070).**
- [x] **MCP Inspector (US-2071).**
- [x] **Folder View (US-2072).**
- [x] **Agent tools and toolset editor (US-2073).**
- [x] **Git Tree (US-2074).**
- [x] **Mneme (US-2075).**

## EPIC-187 — UI test coverage, phase 5a: Grid, Settings, Tools hub, About

Completed 2026-11-18. First half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 33 new
tests, 16 in `integration-test/tests/editors/grid/` and 17 in the new `tools` area (`settings-page`, `tools-hub`,
`guides`); the suite is 221 tests. First coverage epic on the product runner: Codex (Luna) planned and wrote every test
blind (it cannot start the app), Claude ran and triaged, and every wrong guess about the API went into
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md) (21 entries). **App bugs fixed:** every app-window highlight
failed because the CSP blocked the overlay's inline script; the Settings scroll-spy stopped following the scroll after
a scroll made while a Content tree jump settled; a JSONL file with a bad line showed a partial table (an edit would
have dropped the rest of the file); a mouse pick in Edit Columns' filter-type list closed the popup. **Runner fix:**
the test app fetched the published-boards catalog from GitHub at every start; the seed now keeps it offline.
**Open:** the guide says sorting or filtering disables grid row insertion, but the editor always allows it (test stays
failing); runner cleanup does not answer a stray "Unsaved Changes" dialog, so one can fail the rest of a module; the
EPIC-185 env-vars failure is carried over. **Uncovered:** grid column drag, populated Search boards filtering, F1's
fallback to the contents. Final launched run (`--with git`): 218 passed, 2 failed, 1 skipped. Completion skills by
Codex (Luna). Epic document: [EPIC-187](EPIC-187.md).

- [x] **Grid editor (US-2065).**
- [x] **Settings page (US-2066).**
- [x] **Tools & Editors hub (US-2067).**
- [x] **About page and guides (US-2068).**

## EPIC-186 — Persephone test runner for web applications

Completed 2026-11-18. `persephone.exe --test <file|folder>` (and the console wrapper `persephone-test.exe`) runs
`.test.mjs` regression checks against the user's own web apps without an LLM: a windowless controller starts a test
host utility process, which launches an owned app instance (or attaches with `--attach`) and drives it over MCP. Tests
use an `app` stand-in that maps property chains to `call` paths, `ctx.openBrowser` with a logged-in browser profile,
per-test cleanup of pages and pop-ups, `report.md|json`, `last-failed.json` / `--rerun-failed`, failure screenshots,
and JSON Lines logs (`tests.log`, `app-main.log`, `app-console.log`, `site-console.log`, `network.log`; no headers or
bodies). Agent guide: `guides/agents/web-app-tests.md`. **Proof:** the 188-test integration suite moved onto the
product runner (`integration-test/run.mjs` is now a wrapper with `--test-setup`, `--test-selection`, `--with`,
`--baseline`) and was rewritten to the `app` object; the final owned run matched the baseline exactly (185 passed, the
known EPIC-185 env-vars failure, 2 opt-in skips). The packaged `--app` target passed smoke and all startup tests.
**App fixes found by the suite:** clicks right after a sidebar panel expands could hit the neighbouring row (actionability
now needs two stable frames); the reported failing step is the step that threw, not a later cleanup step.
**Open:** browser `reload()` resolves before the navigation commits, so a site-extension test can race on fast builds;
the `app` stand-in cannot pass call options (`{ dialog: true }`, `maxLength`), so about 150 test calls keep `ctx.call`;
`--prod` was not run (needs the dev server stopped). Completion skills by Codex (Luna). Epic document:
[EPIC-186](EPIC-186.md).

- [x] **`--test` controller mode (US-2056).**
- [x] **`app` object over `call` paths (US-2057).**
- [x] **Test helpers, results and logs options (US-2058).**
- [x] **Test-mode console and network logs (US-2059).**
- [x] **Agent guide for web-app tests (US-2060).**
- [x] **Integration suite on the product runner (US-2061).**
- [x] **Rewrite `core` and `sidebar` tests (US-2062).**
- [x] **Rewrite `shell` tests (US-2063).**
- [x] **Rewrite `editors` tests (US-2064).**

## EPIC-185 — UI test coverage, phase 4b: viewer editors

Completed 2026-11-17. Second half of Phase 4 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 34 new
tests under `integration-test/tests/editors/` (HTML and SVG preview, Image Viewer, Log View, Link editor, Environment
Variables editor, Video Player); the suite is 158 tests. **Two app bugs fixed:** `openLinks` opened an `Empty` tab
because it never made the Link editor the page's main editor (Show Resources, `app.pages.openLinks`, site-extension
link lists, multi-file drops). A Link editor change made within the 300 ms serialize debounce was lost on close or
editor switch. **Guide fix:** `video.md` now says Open in VLC appears whenever playback fails. Tests generate their own
PNG and WAV files; the only committed binaries are a 74-byte PNG and a 16 KB WAV under `fixtures/http/`. Env-vars tests
point `board-vars.file` at a fixture store and restore it. **Uncovered:** HLS playback (no encoder), Image Save original
and Save as PNG (native dialog only), clipboard contents. Same working model as EPIC-184; completion skills by Codex
(Luna). Epic document: [EPIC-185](EPIC-185.md).

- [x] **HTML and SVG preview (US-2048).**
- [x] **Image Viewer (US-2049).**
- [x] **Log View (US-2050).**
- [x] **Link editor (US-2051).**
- [x] **Environment Variables editor (US-2052).**
- [x] **Video Player (US-2053).**

## EPIC-184 — UI test coverage, phase 4a: text and document editors

Completed 2026-11-17. First half of Phase 4 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 26 new
tests under `integration-test/tests/editors/` (Monaco editing, Markdown preview, Mermaid, compare mode and Git diff,
editor switching), with the area helper in `tests/editors/helpers.mjs`; the suite is 124 tests. **No app bugs found.**
Claude's checks corrected test errors instead: undo back to the saved text keeps `modified` by design, and redo is
`Ctrl+Shift+Z` because `Ctrl+Y` is Delete Line. They also tightened weak assertions. The Git diff test builds its own
repository inside its fixture folder and runs only with `--with git`. **Uncovered:** Mermaid copy-to-clipboard
contents (the call completes; the clipboard image is not read back). The viewer editors follow in phase 4b. Same working
model as EPIC-183; completion skills by Codex (Luna). Epic document: [EPIC-184](EPIC-184.md).

- [x] **Text editor (US-2043).**
- [x] **Markdown preview (US-2044).**
- [x] **Mermaid (US-2045).**
- [x] **Compare and Git diff (US-2046).**
- [x] **Editor switching (US-2047).**

## EPIC-183 — UI test coverage, phase 3: page sidebar and Explorer

Completed 2026-11-17. Phase 3 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 16 new tests under
`integration-test/tests/sidebar/` (Explorer, Search, Open Tabs / Recent Files / Script Library / Tools & Editors /
Boards / Clipboard panels, external file watching and zip archives) with shared helpers in
`tests/helpers/sidebar-helpers.mjs`; the suite is 103 tests. **App bugs found and fixed:** `window.screen.drag` on an
Explorer file row froze the app (the row handed the drag to the native `webContents.startDrag`, whose modal loop blocks
the main process until a real mouse release; app-window drags now fail fast with a clear error, and the tree and the
file-drag handoff respect `defaultPrevented`); the Open Tabs list stopped showing new pages (it mutated one props object
in place, so `ListBoxModel.update` saw no change; it now passes a fresh object). **Dev-tooling fix:** the Vite watcher
held handles on test folders, leaving renamed-then-deleted folders "delete pending" (EPERM on profile reset);
`vite.renderer.config.ts` now ignores `integration-test/**`. **Uncovered:** drag-drop between Explorer folders (no
synthetic drag in the app window), closing a page from Open Tabs (no close action). Same working model as EPIC-182;
completion skills by Codex (Luna). Epic document: [EPIC-183](EPIC-183.md).

- [x] **Explorer panel (US-2039).**
- [x] **Search panel (US-2040).**
- [x] **Other sidebar panels (US-2041).**
- [x] **Watching and archives (US-2042).**

