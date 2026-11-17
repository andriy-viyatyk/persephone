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

