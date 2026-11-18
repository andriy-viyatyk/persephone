# UI test coverage roadmap

**Date:** 2026-11-16 · **Status:** accepted 2026-11-16; Phase 1 is [EPIC-181](../epics/EPIC-181.md) (completed 2026-11-16); Phase 2 is [EPIC-182](../epics/EPIC-182.md) (completed 2026-11-16); Phase 3 is [EPIC-183](../epics/EPIC-183.md) (completed 2026-11-17); Phase 4a is [EPIC-184](../epics/EPIC-184.md) (completed 2026-11-17); Phase 4b is [EPIC-185](../epics/EPIC-185.md) (completed 2026-11-17); Phase 5a is [EPIC-187](../epics/EPIC-187.md) (completed 2026-11-18); Phase 5b is [EPIC-188](../epics/EPIC-188.md) (completed 2026-11-18) · **Builds on:** [EPIC-180](../epics/EPIC-180.md) (runner,
`uitest` profile, pilot tests).

The refactoring roadmap touched almost the whole codebase. This roadmap retests every screen and feature once, and
turns each check into a scripted test under `integration-test/tests/` so the next pass costs no tokens. The work is
split into phases. Each phase becomes one epic (or a few), created one at a time when the previous one closes.

---

## How every phase works

Each epic follows the same loop. The deliverable is **the tests plus the bugs they found**, not a pass/fail report.

1. **Inventory.** List the area's features from its user guide (`assets/guides/…`), its `data-name` elements
   ([ui-element-contract](../architecture/ui-element-contract.md)), and its `call` tree (`$help`). The epic document
   holds this list as the area's test checklist.
2. **Write tests** into `integration-test/tests/<area>/`. One file per feature group, and one test per behavior a user
   would notice breaking. Shared steps go in area helpers, not copied between files.
3. **Run and triage.** Every failure ends in one of these:
   - **App bug:** the test stays failing and the bug is reported (steps, expected, actual). Tests assert what the app
     should do, never its current behavior just to pass. Claude fixes it in the running dev app; the fix and a
     `whats-new.md` line ship with the epic.
   - **Test bug:** fix the test.
   - **Call gap:** the behavior cannot be reached or observed through `call`. Close the gap in ai-vision (as US-2024 did
     for `fs.*`) when it is cheap. Otherwise record it as not covered.
4. **Close.** The area runs green twice in a row (`--area <name>`), and its run time is recorded. The epic document
   lists the bugs fixed and what stayed uncovered, and why.

### Who does what

| Work | Owner | Why |
|---|---|---|
| Phase order, epic documents, the inventory checklist | Claude | Epic-level planning |
| Writing tests, running them (`--attach` against an instance Claude starts), triaging, reporting app bugs (never fixing them) | Codex (Luna) | Volume work *(user decision, 2026-11-16)* |
| Checking each task's tests are written properly; corrections back to Codex | Claude | Review is where judgment pays |
| Investigating and fixing every reported app bug; running all new tests in launched mode once per epic | Claude | Restart and second-instance tests need a launched app |
| Completion skills | Codex (Luna) | As usual |

---

## Test layout: areas and modules

Tests are grouped in two levels, and the folder is the only registry:

```
integration-test/tests/<area>/<module>/<feature>.test.mjs
```

| Area | Roadmap phase | Modules (examples) |
|---|---|---|
| `core` | 1 | `startup`, `settings`, `session`, `files`, `scripting`, `mcp`, `smoke` |
| `shell` | 2 | `tabs`, `grouping`, `menu-bar`, `dialogs`, `menus`, `shortcuts` |
| `explorer` | 3 | `tree`, `search`, `panels`, `watching`, `archive` |
| `editors` | 4, 5 | `text`, `markdown`, `mermaid`, `grid`, `compare`, `switching`, … |
| `tools` | 5 | `settings-page`, `tools-hub`, `guides`, `agent-tools`, `git`, `mneme` |
| `browser` | 6 | `navigation`, `profiles`, `downloads`, `automation`, `site-extensions` |
| `boards` | 7 | `lifecycle`, `bridge`, `catalog`, `excalidraw`, `rest-client` |
| `published-boards` | 8 | one module per board (`pdf-viewer`, `todo`, …) |
| `capabilities` | 9 | `audio`, `voice`, `speech`, `terminal` |

- **Selecting:** `--area core` runs a whole area. `--area core/settings` runs one module. A comma list runs several.
  `--list` prints the tree with test counts and starts no app.
- **Appending:** a new test goes into the module that owns the feature. A new feature with no module gets a new
  module folder. A new area is added only with a new roadmap phase.
- **Size:** a module stays under about 50 tests or about 3 minutes. When it grows past that, it splits into
  sub-modules by feature (`editors/grid/sort`, `editors/grid/edit`). It never splits by count: numbered chunks shift
  whenever a test is added, so "chunk 3" would mean different tests next time.
- **Isolation between modules:** the runner stops the app, re-seeds the profile and starts it again between modules in a normal run, so a module can rely
  only on the seeded profile.

## Cross-cutting rules

- **Isolation.** Every test starts from the seeded profile state it needs. Use the existing `restartApp`, or a
  per-file reset helper added in Phase 1. Never depend on another test's leftovers.
- **No real network, by default.** The browser, REST client, board catalog and downloads run against a local fixture
  HTTP server started by the runner (Phase 1). Tests that need the internet, Tor, a microphone, git remotes or Mneme
  declare `requires: [...]` and are skipped unless the run opts in (`--with network,mic,…`).
- **Published boards come from a local checkout.** Boards register from `../persephone-boards/boards/<id>` (the
  `PERSEPHONE_BOARDS_DIR` env variable overrides this). No download from GitHub. If the checkout is missing, those
  tests are skipped with a clear reason. Installing from the catalog is tested once, against the fixture server.
- **Trust is explicit.** Board and tool trust dialogs are clicked through in the tests that cover them. Every other
  test registers trust through seed data or a helper, so the dialog never blocks.
- **No pixel comparison.** Visual correctness is checked through snapshots (element present, text, size not 0×0).
  Screenshots are kept only on failure.
- **Run-time budget.** The full suite should stay under ~15 minutes. Long areas are split, so `--area` stays useful
  during triage.

---

## Phases

User-chosen order: core first, then pages/tabs, then the page explorer, then editors and boards one by one.

### Phase 1: Foundation and core app

Grows the runner, then covers what every other area relies on.

- **Runner additions:** an `--open` authoring mode, the fixture HTTP server, `requires` tags and `--with`, a
  second-instance helper, area helper modules. (The published-board registration helper moved to Phase 7.)
- **App startup and shutdown:** first start on a fresh profile, a second-instance hand-off (open a file into the
  running instance), and window state.
- **Settings:** round-trip through `app.settings`, persistence across restart, theme switch (built-in and custom),
  UI language switch.
- **Session restore:** open pages, groups and the active tab survive a restart. Also covers the restore-failed page.
- **Files:** `app.fs` read/write/watch, recent files, open via dialog command, external change detection, encoding
  detection and save, encryption (password dialog, encrypt, decrypt).
- **Scripting core:** run a JS and a TS script against a page, `page`/`app`/`io` basics, Log View output, an inline
  script dialog, `page.grouped` output, script library run.
- **MCP surface:** `$help` at the root, the attention/dialog protocol, timeouts. This is the test harness's own
  footing.
- **Decision recorded at close:** who writes the tests for later phases (Codex or Claude).

### Phase 2: Shell — pages, tabs, menus, dialogs

- **Tabs:** open, close, close others, reorder, pin, duplicate, rename, the right tab strip, the editor-categories
  popover, dirty-state marker, close with unsaved changes.
- **Grouping and compare:** group side by side, ungroup, swap, compare mode.
- **Menu bar and folders:** menu bar sections, folder bookmarks, header quick-settings popover, status indicators,
  global mute button.
- **Dialogs:** each of the 13 dialog views opened and answered (confirmation, input, text, password, open URL,
  commit, create board, create board-vars storage, library setup, namespace collision, register toolset, Tor info,
  trust board). Covers keyboard handling (Enter, Escape) and cancel.
- **Popup and context menus:** the tab menu, the page menu and the link menus.
- **Keyboard shortcuts:** the global shortcuts from `shortcuts.md` that the call tree can send.

### Phase 3: Page sidebar and Explorer

Tracked in [EPIC-183](../epics/EPIC-183.md) (completed 2026-11-17).

- **Explorer panel:** browse, expand and collapse, open file, create file and folder, rename, delete, copy and move,
  drag-drop (if `call` can drive it), reveal the active file.
- **Search panel:** file search by name and by content, open a result.
- **Other panels:** open-tabs list, recent-files list, script-library panel, tools/editors panel.
- **Watching:** the explorer updates on outside file changes.
- **Archive browsing:** open a zip as a folder and open an entry.

### Phase 4: Text and document editors

Split in two. Phase 4a (Monaco, Markdown, Mermaid, compare and Git diff, editor switching) is tracked in
[EPIC-184](../epics/EPIC-184.md) (completed 2026-11-17); phase 4b (the viewer editors) is
[EPIC-185](../epics/EPIC-185.md) (completed 2026-11-17).

- **Monaco:** edit, undo, find and replace, language switch, multi-cursor (as far as `call` reaches), word wrap,
  save, format.
- **Markdown** (preview, Mermaid in markdown, links), **Mermaid** (look/layout menus from US-2020), **HTML**, **SVG**,
  **Image**, **Log View**, **Links editor**, **Env-vars editor**, **Video** (local file playback, HLS from the
  fixture server).
- **Compare and file diff.**
- **Editor switching:** the switch strategies between text, grid, markdown and preview for one file.

### Phase 5: Data and tool editors

Split in two. Phase 5a (Grid, Settings page, Tools & Editors hub, About and guides) is tracked in
[EPIC-187](../epics/EPIC-187.md) (completed 2026-11-18); phase 5b ([EPIC-188](../epics/EPIC-188.md), completed 2026-11-18) takes clipboard history, the MCP inspector, category pages, the toolset
editor, agent tools, and the optional Git tree and Mneme tests.

- **Grid:** extends the pilot. JSON and CSV editing, sort, filter, add and delete rows, Excel paste, keyboard
  navigation, switch back to text with the content preserved.
- **Settings editor:** each section renders, a field changes and persists, scroll-spy navigation.
- **Tools hub:** editor categories, trusted tools, site-extensions tab, search boards tab.
- **About and guides:** the guide browser, F1, links between guide pages.
- **Clipboard history, MCP inspector, category pages, toolset editor, agent tools** (register, trust, execute a
  fixture tool).
- **Optional features**, tagged `requires`: **Git tree** and git diff against a fixture repo created by the test,
  **Mneme** root and config.

### Phase 6: Browser

Everything runs against the fixture server.

- Navigation, back and forward, reload, tabs inside the browser page, zoom (the recent restored-page zoom fix).
- Profiles, Incognito, bookmarks, downloads (to the profile `work/` folder), certificate view.
- Browser automation and the page models agents use.
- Site extensions: trust, run, manage.
- Tor mode: tagged `requires: [network, tor]`.

### Phase 7: Board platform and bundled boards

- **Runner:** the published-board registration helper (from `../persephone-boards`).
- **Board lifecycle:** create a board (scaffold), create the demo board, open, edit, reload, trust dialog,
  off-by-default manifest permissions, board windows, Board Info (properties, uninstall, unregister).
- **Bridge:** `persephone.execute`, `executeNode`, board vars and storage, capabilities, custom editors registered
  by a board, content providers. Each is checked from a small fixture board in `integration-test/fixtures/boards/`.
- **Catalog install:** install, update and roll back against a fake catalog on the fixture server.
- **Bundled boards:** Excalidraw (open, draw through its API, save `.excalidraw`, disable/enable) and REST Client
  (`.rest.json` collection, send a request to the fixture server).

### Phase 8: Published boards (persephone-boards)

One epic per group. Each board gets: opens its sample file, the main view renders, its primary action works, and its
data round-trips where it edits.

| Epic | Boards |
|---|---|
| 8a Document viewers | pdf-viewer, word-viewer, excel-viewer, powerpoint-viewer, drawio-viewer, font-viewer, pe-viewer, cert-viewer, sqlite-viewer, torrent-viewer |
| 8b Apps | todo, notebook, gem-keep, chess, translate, theme-editor, force-graph |
| 8c Agent tools | agent-log-viewer, aivision-explorer, claude-agent |
| 8d Audio and speech | audio-player, speech-to-text, text-to-speech, wake-word (depends on Phase 9's capture source) |

Sample files live in each board's folder or in `integration-test/fixtures/boards-samples/`. The tests also live in
this repo, because they test the integration between the board and the app.

### Phase 9: Capabilities and integrations

- **Audio:** capture sources and playback, global mute, window recording.
- **Voice typing and voice assistant UI.**
- **Speech and translation services.**
- **Terminal, `app.proc`, the module service, proxy/tunnel.**

Microphone and speaker tests need a file-backed capture source. If the audio module cannot take one, the phase starts
with a task to add it (see Concerns). Everything else here is tagged `requires: [mic]` and runs only on demand.

---

## Concerns

1. **Call coverage decides test coverage.** A test can only check what `call` can reach and observe. Expect each
   phase to find gaps. Rule of thumb: close a gap when it takes under an hour; otherwise list it as uncovered in
   the epic.
2. **Codex cannot launch the suite** (Electron spawn fails with EPERM in its sandbox). So Claude starts an `--open`
   instance and Codex runs its tests with `--attach`. Restart and second-instance tests run only in Claude's per-epic
   pass. Phase 1 confirms Codex's sandbox can reach the instance's loopback port.
3. **Hardware-bound features.** Microphone, speaker, Widevine DRM and Tor cannot run unattended in a fresh profile.
   They are either faked (a file capture source, a fixture HLS stream) or tagged and opt-in.
4. **Published boards change on their own schedule.** Tests pin to the checkout the user has. A failure after a board
   update is triaged in the board repo, not here.
5. **Suite run time.** At roughly 2 s per test, about 400 tests fits the 15-minute budget. Areas that are slow to
   start (browser, boards) are watched first.

## Not in scope

- Rust binaries (`mneme/`, `launcher/`, `snip-tool/`) on their own; Mneme is covered only through the app.
- Installer and auto-update (NSIS, releases). The `--app` target covers the packaged app only after it is installed.
- Pixel-level visual regression.
