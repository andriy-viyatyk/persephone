# US-2131: Agent guides: result shapes and model coverage

**Status:** Planned  
**Epic:** [EPIC-200](../../epics/EPIC-200.md)

## Goal

Document verified result examples for published-board model methods and add a model-coverage table to Persephone's published-boards agent guide. The plan covers only board guides, board help/documentation where no agent guide exists, and the Persephone guide; it does not implement any model changes.

## Background

This task is part of [EPIC-200](../../epics/EPIC-200.md). The epic assigns the implementation across two repositories: board guide and shipped documentation changes go in `C:\projects\persephone-boards` on `develop`; the coverage table goes in `C:\projects\persephone`. EPIC-200 Notes/Decisions require one patch version bump per changed board across the epic, with one corresponding `WHATS-NEW.md` heading. The boards repository rules prohibit hand-editing `boards-manifest.json` and any `versions-manifest.json` (`C:\projects\persephone-boards\CLAUDE.md`, “Releasing a board version” and “Rules”).

`published-boards.md` currently has a 6,726-character body, below the 20,000-character page limit (`doc/standards/guide-structure.md:3-12`). Its staged EPIC-199 change adds `version` to the `searchPublished()` result description; keep that edit and append the table to the same working copy.

Board agent guides are not found by reading each board's `CLAUDE.md`: Persephone mounts guides only for permitted/trusted boards whose manifest has a `guides` folder (`src/renderer/guides/board-guide-mounts.ts:48-56`), and the Boards authoring hub directs agents to a board's own guide folder (`assets/guides/agents/boards/index.md:17-39`). The Board Editor facade adds its `.app` member only while a model has registered (`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:75-86`); the registration channel accepts only the current `BOARD_CDP_TAB` main frame (`src/renderer/editors/board/model/BoardAiVisionChannel.ts:64-93`). Thus a board's `$help` / `$describe` is the live discovery surface when no mounted agent guide exists, while `CLAUDE.md` is only implementation context. For Gem Keep, source inspection found no published model in `js/main.js` or `js/game.js`; add a mounted agent guide for its level/difficulty rule, not a fabricated `.app` result.

An `index.md` in a mounted guide folder is an ordinary page, not a special mount entry: `createGuideIndex()` recursively indexes every `.md` under the mount (`src/shared/guides/index.ts:130-145`), and `guides.search()` searches each page's title, summary, headings, table rows, and body (`:187-225`). `board-guide-mounts.ts` mounts the declared folder as a whole (`src/renderer/guides/board-guide-mounts.ts:49-77`); the tree displays `index` as a page and does not require a file with that name. Still add both `index.md` and `agent.md` for Audio Player and Gem Keep to match existing board guide folders. Use front matter `title`, `audience: both`, `summary`, and `editorId: "board"`; then write the board overview and a `## The guides` table linking to `agent.md`. Audio Player's index outline: what it opens; catalog/playlist full mode versus directly opened plain-audio light mode; then a one-row table linking the agent reference. Gem Keep's index outline: direct game-play purpose; level and difficulty selection; then a one-row table linking the agent reference. Each `agent.md` uses `audience: agent`; Audio Player covers the full/light model boundary and concise results of every model method including US-2128 `previous()`, while Gem Keep covers the starting-gold formula `Math.round(level.gold * difficulty.gold)` and its source meaning without inventing an app model. This follows the existing index pages' roles: DrawIO Viewer uses its index as a full overview and agent-facing explanation (`boards/drawio-viewer/guides/index.md:1-33`), while Todo uses it as an overview and guide hub linking its user and agent pages (`boards/todo/guides/index.md:1-25`).

The `guides` manifest field is supported from Persephone **5.0.2**, when EPIC-100 introduced board-supplied documentation (`doc/epics/completed.md:293`; the source change is in commit `1a7c8663`, whose `package.json` reports `5.0.2`). Audio Player's `minAppVersion` is `5.0.11`; Gem Keep's is `5.0.16`, so neither is below that floor and neither needs a `minAppVersion` change. An older app ignores this field: `readRawBoardManifest()` parses JSON and casts the object without rejecting unknown keys, and `parseBoardManifest()` copies/normalizes known fields without a strict-key rejection (`src/renderer/api/boards/board-manifest-io.ts:35-45`; `src/shared/board/board-manifest-schema.ts:338-410`).

The sample shapes below are source-checked against the current `develop` working tree, with parallel-task additions called out explicitly:

- **SQLite Viewer:** `sqlite-aivision.js:721-734` returns the default rows format as `{ columns, rows, rowCount, totalRows, sql, note? }`; its rows are built at `:340-346` as `{ row, cells }`. `getTables()` at `:683-685` wraps `tableList()` entries in `{ tables }`; entries are built at `:445-452` with `rowCount` omitted and `unreadable: true` when a count is unavailable. The guide must show `{ columns: ["name"], rows: [{ row: 1, cells: ["Ada"] }], rowCount: 1, totalRows: 1, sql: "SELECT name FROM people" }`, and `{ tables: [{ name: "people", type: "table", rowCount: 3, columns: ["name"] }] }`, plus `{ tables: [{ name: "virtual_data", type: "table", unreadable: true, columns: ["value"] }] }`. Do not reduce `getTables()` to a guessed column-only list.
- **Force Graph:** `graph-aivision.js:92-103` shapes each node; `:131-150` exposes `nodes` as a node with `count`, `ids`, numeric/id index access, and an indexable summary. The guide's existing `nodes` description at `guides/agent.md:38-43` is right to call this an indexed collection; examples must show access (`nodes.count`, `nodes.ids`, `nodes[0]`, `nodes["zeus"]`) and a node value, never the raw source `nodes` array.
- **Chess:** `chess/app.js:98-103` returns `lastMove()` as `null` or `{ from, to, san, color, by }`, where `color` comes through `COLOR_NAME`. The guide currently lists the shape without the color values (`guides/agent.md:74`); add `color: "white" | "black"` next to it. Examples for every method should mirror `app.js:610-845` (e.g. move and new-game methods return `snapshot()`, `clearArrows()` returns `true`, and arrow display returns the arrow count); timeout branches of both wait methods must retain `{ timedOut: true, userIdleSeconds }` / `userSaid` variants.
- **PowerPoint Viewer:** `pptx-aivision.js:740-805` assembles the app result members; the current working diff has the US-2129 `error` member at `:92, 755, 767`, wired from `app.js:44-52`. Include `error: "<part>: <parse message>"` as an illustrative non-empty string for a failed load; the checked-in HEAD before US-2129 has no such member. All slide-valued fields (`slide`, `slides`, `slideNumber`, etc.) must be labelled **1-based** beside each member.
- **PDF Viewer:** `pdf-aivision.js:367-550` assembles the model and page results; `getPageImage()` returns `{ page, width, height, chars, dataUrl }` at `:517-527`, and `goToPage()` returns the 1-based page at `:529-534`. Label every page-valued member in the guide as **1-based**, including result object fields, and base all samples on the actual method return objects.
- **Word Viewer:** `word-aivision.js:780-861` owns the document methods; `showText()` returns `{ found: false, note }` or `{ found: true, page, flashed, note }` (`:827-845`), while `goToPage()` returns the page number (`:820-825`). The guide already says page numbers are 1-based (`guides/agent.md:12`); place **1-based** adjacent to every page-valued member and output field.
- **Audio Player:** the working tree already has the US-2128 planned `next()` / `previous()` at `ai-vision.js:190-191, 223-224`: `next()` returns `{ advanced: false, reason: "end-of-queue", nowPlaying }` or `{ advanced: true, href, mode }`; `previous()` returns `{ moved: false, reason: "start-of-queue" }` or `{ moved: true, href, mode }`. Put the examples in the new mounted guide, not in `ai-vision.js`; retain these literal no-movement variants and leave the parallel model changes alone.
- **Theme Editor:** `app.js:1331-1361` shows `saveDraftCore()` returns `true` after a successful save; both exposed `save()` and `saveAs()` wrappers call it (`:1680-1681`). `renameThemeCore()` returns `{ id: null, name }` for a built-in draft or `{ id, name }` for a saved custom theme (`:1426-1448`). The exposed method is named `deleteThemeCore()` at `:1682`, and it returns `{ nextSourceId }` after loading the fallback theme (`:1450-1474`). Put these in the model's `$help` text beside its method descriptions at `app.js:1596-1633`; do not describe the UI's dialog behavior as the model result.
- **Gem Keep:** `js/data.js:59-67` defines `difficulty.gold`; `js/game.js:22-28` sets `state.gold = Math.round(level.gold * diff.gold)`; `js/main.js:358-363` passes the chosen difficulty into the game. Document this rule in a new mounted `guides/agent.md`, without claiming an `.app` model or result method.
- **PowerPoint task interaction:** US-2129 is already reflected in the working tree (`git diff -- boards/powerpoint-viewer` includes model, guide, board-manifest, and changelog edits). Add the examples and the 1-based notes to its existing `1.2.1` heading; do not make another model change or version bump.

For each of the ten existing `guides/agent.md` pages, add a short `Example results` block covering every method exposed by that board's model, including a method missing from the guide's current method list; keep examples JSON-ish and small, not document-sized dumps. Take each result from that board's model return statements and use symbolic short content where the underlying data varies. The public method declarations and source owner files are: chess `app.js`; drawio-viewer `drawio-aivision.js`; excel-viewer `xlsx-aivision.js`; force-graph `graph-aivision.js`; notebook `ai-vision.js`; pdf-viewer `pdf-aivision.js`; powerpoint-viewer `pptx-aivision.js`; sqlite-viewer `sqlite-aivision.js`; todo `app.js`; word-viewer `word-aivision.js`. Keep the examples near the methods they explain, and do not add fields absent from a return statement.

## Implementation Plan

### persephone-boards repo

1. Update result examples in the existing `guides/agent.md` pages for chess, drawio-viewer, excel-viewer, force-graph, notebook, pdf-viewer, powerpoint-viewer, sqlite-viewer, todo, and word-viewer. Each example must match the actual return statement of a model method. Add the required conventions beside the relevant members: PowerPoint/PDF/Word page and slide numbers are 1-based; Chess `lastMove().color` is `"white"` or `"black"`; Force Graph `nodes` is an indexed collection; SQLite table/query result fields match the returned objects.
2. For Theme Editor, add result snippets to its live model `$help` text, which agents reach through `pages[id].editor.app.$help`: cover `save()`, `saveAs()`, `rename()`, and `deleteThemeCore()` using the source-verified returns. Do not add the Claude-Agent/Agent Chat result-example work: it is not in EPIC-200's task list and EPIC-201 changes that board next. For Audio Player, do not edit its model because US-2128 owns it; add both `boards/audio-player/guides/index.md` and `guides/agent.md`, plus `guides: "guides"` in its manifest so the result examples are mounted and agent-readable. The index outline and mount behavior are recorded above. For Gem Keep, which has no board-published model, add both `boards/gem-keep/guides/index.md` and `guides/agent.md`, plus `guides: "guides"` in its manifest so Persephone mounts the starting-gold formula where agents can read it; do not invent a model return. Both boards meet the 5.0.2 guide-field floor with their current `minAppVersion`, so leave those values unchanged.
3. Include PowerPoint `editor.app.error` from US-2129 in its guide result example; do not plan changes to that model or the Audio Player model.
4. For every changed board, inspect its `board-manifest.json`, `WHATS-NEW.md`, and current `git diff` on `develop`. Apply one patch bump for this epic only if it has not already been bumped; otherwise add one changelog line beneath the existing epic version heading. Never edit generated manifests.

### Persephone repo

5. Add the following table in `assets/guides/agents/boards/published-boards.md` as a new `### Model coverage by open mode` subsection immediately after the existing `### Reviewing a board before trusting it` subsection and before the closing sentence “These members are `call` paths on `boards.*`...”. This placement keeps it within the published-boards guide, adjacent to the review flow. Board models are registered from the main editor frame; the app routes model registration only from the current `BOARD_CDP_TAB` (`BoardAiVisionChannel.ts:79-93`). The secondary-view frame may contribute declared `elements` by view, but its own `editor.app` is not separately registered (`BoardEditorFacade.ts:75-86`). List file-backed association and direct board opens separately; mark Audio Player's directly opened plain audio light mode as no model. The existing page is 6,726 characters; the proposed table keeps it below the 20,000-character page limit, so no subpage is needed. Keep source references out of the user-facing table.
6. Keep the currently staged EPIC-199 working-copy edit in `published-boards.md` and add the table to that same working copy.
7. No integration-test assertion changes are required for this documentation-only task. Do not edit `integration-test/tests/published-boards/<board-id>/`; no current failure is being fixed in this task. Existing assertions remain unchanged and are not weakened.

Final table text to add at that location:

| Board | `editor.app` | Open modes |
|---|---|---|
| `agent-log-viewer` | No | File-backed `.jsonl` |
| `aivision-explorer` | No | Direct board |
| `audio-player` | Yes (full only) | Direct board/catalog/playlist; plain audio is light mode with no model |
| `cert-viewer` | No | File-backed certificate formats |
| `chess` | Yes | Direct board |
| `claude-agent` | Yes | Direct board |
| `drawio-viewer` | Yes | File-backed `.drawio`; direct board |
| `excel-viewer` | Yes | File-backed `.xls`/`.xlsx`; direct board |
| `font-viewer` | No | File-backed font formats |
| `force-graph` | Yes | File-backed `.fg.json`; direct board |
| `gem-keep` | No | Direct board |
| `notebook` | Yes | File-backed `.note.json`; main editor frame |
| `pdf-viewer` | Yes | File-backed `.pdf`; direct board |
| `pe-viewer` | No | File-backed PE formats |
| `powerpoint-viewer` | Yes | File-backed `.pptx`; direct board |
| `speech-to-text` | No | Direct board |
| `sqlite-viewer` | Yes | File-backed database formats; direct board |
| `text-to-speech` | No | Direct board |
| `theme-editor` | Yes | Direct board |
| `todo` | Yes | File-backed `.todo.json`; direct board; main editor frame only |
| `torrent-viewer` | No | File-backed `.torrent` |
| `translate` | No | Direct board |
| `wake-word` | No | Direct board |
| `word-viewer` | Yes | File-backed `.docx`; direct board |

### Verified model-coverage inventory

| Board | Publishes `editor.app`? | Source and open-mode evidence |
|---|---|---|
| `agent-log-viewer` | No | File-backed `*.jsonl` board; its `app.js` has no AiVision registration. |
| `aivision-explorer` | No board model | Direct board only; its own `CLAUDE.md:5-8` says target page `editor.app` is what it displays, and it has no model registration of its own. |
| `audio-player` | Yes, full mode only | `app.js:286-289` distinguishes light/full; `:309-318` exposes only when `!light`. Catalog/playlist sources and no-source direct board opens are full mode; directly opened plain audio sources are light and have no model (`CLAUDE.md:65-70`). |
| `cert-viewer` | No | File-backed `*.cer`, `*.crt`, `*.der`, `*.pem`, `*.pfx`, `*.p12`, `*.p7b`, `*.p7c`; parsing/UI only in `app.js`, no `aiVision.expose`. |
| `chess` | Yes | Direct board page; `app.js:740-846` constructs and exposes the game model. |
| `claude-agent` | Yes | Direct chat board page; `app.js:1323-1360` constructs the profile/session model and exposes it. |
| `drawio-viewer` | Yes | File-backed `.drawio` and direct empty-state board; `app.js:913-918` creates the model and `drawio-aivision.js:888` registers it. |
| `excel-viewer` | Yes | File-backed `.xlsx` / `.xls` and direct board page; `app.js:33-42` creates the model and `xlsx-aivision.js:1145` exposes it. |
| `font-viewer` | No | File-backed font masks; `app.js` contains viewer UI only and no model registration. |
| `force-graph` | Yes | File-backed `.fg.json` and direct empty-state board; `app.js:920-932` constructs the model, `graph-aivision.js:508` exposes it. |
| `gem-keep` | No | Direct game page only; `js/main.js:358-363` calls `createGame()` and supplies UI callbacks; `js/game.js` returns game state internally but never exposes it through AiVision. |
| `notebook` | Yes, main editor frame | File-backed `.note.json`; `ai-vision.js:140-154` exposes the model. `todo`'s secondary-view rule is not relevant here; model registration uses the active editor frame. |
| `pdf-viewer` | Yes | File-backed `.pdf` and direct empty-state board; `app.js:71-80` creates its model and `pdf-aivision.js:553-562` registers it. |
| `pe-viewer` | No | File-backed PE masks; source has no model registration. |
| `powerpoint-viewer` | Yes | File-backed `.pptx` and direct empty-state board; `app.js:44-52` creates the model and `pptx-aivision.js:1032` exposes it. US-2129 supplies `getError` but does not change this mode boundary. |
| `speech-to-text` | No | Direct speech tool board; source has no `editor.app` model. |
| `sqlite-viewer` | Yes | File-backed `.db`, `.sqlite`, `.sqlite3`, `.db3` and direct board page; `app.js:49-59` creates the model and `sqlite-aivision.js:1142` exposes it. |
| `text-to-speech` | No | Direct speech tool board; source has no `editor.app` model. |
| `theme-editor` | Yes | Direct board page; `app.js:1560-1563` checks for the AiVision bridge and `:1694` exposes the draft model. |
| `todo` | Yes, main editor frame | File-backed `.todo.json` and direct board page; `app.js:699-702` calls expose. It also calls registration during its secondary-frame startup (`:1330-1343`), but `BoardAiVisionChannel.ts:79-93` only accepts `BOARD_CDP_TAB`, so the secondary Lists & Tags view does not become a separate `editor.app`. |
| `torrent-viewer` | No | File-backed `.torrent`; `app.js` contains the torrent UI/model but does not publish through AiVision. |
| `translate` | No | Direct translation board; bundled engine exposes library APIs only, not Persephone `editor.app`. |
| `wake-word` | No | Direct enrollment board; `app.js` is a local view for enrollment and playback and has no AiVision registration. |
| `word-viewer` | Yes | File-backed `.docx` and direct empty-state board; `app.js:127-137` creates the model and `word-aivision.js:865-875` registers it. |

All `file-backed` entries use the board's listed `fileMasks` in its `board-manifest.json`; open the board directly to get the same registered model in its unloaded/empty state unless the row names an exception. For secondary-view rows, distinguish visible `elements` declared for a view from a second editor-app model.

### Version plan from the current `develop` diff

The current board checkout diff already contains an EPIC-200 bump for these boards; keep adding the guide line under that heading and do not bump again: Audio Player `1.0.6` (US-2128), Notebook `1.0.1` and PDF Viewer `1.2.1` (US-2130), PowerPoint Viewer `1.2.1` (US-2129), and Theme Editor `1.2.2` (US-2127). The exact checks were `git -C C:\projects\persephone-boards diff -- boards/<id>` and each board's `board-manifest.json` / top `WHATS-NEW.md` heading.

For boards first changed by US-2131, bump once from the inspected current version and add one heading/line: Chess `1.2.0` to `1.2.1`; DrawIO Viewer `1.2.1` to `1.2.2`; Excel Viewer `1.3.0` to `1.3.1`; Force Graph `1.1.1` to `1.1.2`; Gem Keep `1.0.0` to `1.0.1`; SQLite Viewer `1.2.0` to `1.2.1`; Todo `1.3.0` to `1.3.1`; Word Viewer `1.2.0` to `1.2.1`. Recheck the branch diff at implementation start because an earlier epic task may add a board bump before this plan is implemented.

### Before -> after

SQLite Viewer currently describes `query()` only as returning rows and `getTables()` as returning tables with row counts (`boards/sqlite-viewer/guides/agent.md:43-45`). Add a concrete compact result using the `sqlite-aivision.js:721-734` and `:683-710` returns:

```text
Before: query(sql, options?) -> rows from any SELECT; getTables() -> tables and views
After:  query("SELECT name FROM people") -> { columns: ["name"], rows: [{ row: 1, cells: ["Ada"] }], rowCount: 1, totalRows: 1, sql: "SELECT name FROM people" }
        getTables() -> { tables: [{ name: "people", type: "table", rowCount: 3, columns: ["name"] }] }
```

Force Graph already calls `nodes` an indexed collection in `boards/force-graph/guides/agent.md:41`; make the example preserve that contract rather than showing the source JSON array:

```text
Before: nodes -> indexed collection
After:  nodes.count -> 2; nodes.ids -> ["zeus", "hera"]; nodes[0] -> { id: "zeus", title: "Zeus", level: 5, shape: "star", isGroup: false, group: undefined, neighbors: ["hera"], properties: {} }
```

PowerPoint's existing guide describes page ranges but lacks a nearby example of each return shape. Add an explicit one-based result and the planned US-2129 error member without editing the model:

```text
Before: getOutline() -> every slide's { slide, title }
After:  getOutline() -> [{ slide: 1, title: "Overview" }] // slide is 1-based
        editor.app.error -> "<part>: <parse message>" // only after US-2129 lands
```

Theme Editor's `$help` describes the three persistence methods but omits their actual results (`boards/theme-editor/app.js:1608-1633`):

```text
Before: save(), saveAs(name?), rename(name), deleteThemeCore() are described without result examples
After:  save() -> true; saveAs("Dusk") -> true; rename("Dusk 2") -> { id: "theme-42", name: "Dusk 2" }; deleteThemeCore() -> { nextSourceId: "default" }
```

The precise IDs/names above are illustrative values; the keys and branch-dependent result forms come from their respective return statements (`theme-editor/app.js:1331-1361, 1426-1448, 1450-1474`). For a built-in draft, `rename()` instead returns `{ id: null, name }`.

## Integration tests

No test change is needed for this documentation task. Leave `integration-test/tests/published-boards/` untouched; no regression test is associated with these documentation-only changes. In particular, do not alter assertions in `integration-test/tests/published-boards/<board-id>/<board-id>.test.mjs`.

## Concerns

- Board guides are mounted from trusted boards only when the board manifest declares a `guides` folder; new Audio Player and Gem Keep folders need both an `index.md` hub and an `agent.md` page, with the outlined audience/front matter and links above.
- The boards checkout already contains uncommitted EPIC-200 edits for Audio Player and Theme Editor. Preserve them and add documentation on top of their current version headings without another bump.
- The model-coverage table must distinguish model existence from the model's availability in individual open modes; an implementation that creates the model in the board main frame is not sufficient evidence that a light page or a secondary view publishes it.
- The user's examples list Gem Keep beside boards with a model, but this checkout has no `aiVision.expose` in `gem-keep`; `js/game.js` keeps its state inside the game closure. Preserve the requested starting-gold convention in an agent guide and mark the board as having no `editor.app` model.
- Claude-Agent/Agent Chat result examples and a version bump are out of scope for US-2131 because EPIC-200 does not list that board and EPIC-201 changes it next; retain its `editor.app` row in the coverage table and handle the examples in that follow-up.

## Acceptance Criteria

- [ ] Every listed model method has one concise example derived from its current or parallel-task planned return statement, with no guessed fields.
- [ ] The special result conventions and the US-2128/US-2129 planned members are represented accurately.
- [ ] Every board folder has a verified `editor.app` coverage row and exact mode notes grounded in its model creation site.
- [ ] The board docs destination for boards without `guides/agent.md` is chosen based on guide mounting and `$help` discoverability and recorded with reasons.
- [ ] Board version/changelog instructions honor one patch bump per board for EPIC-200 and preserve existing working-tree changes.
- [ ] `published-boards.md` retains the staged EPIC-199 edit and the coverage table fits the guide size rules, or is moved to a linked page if necessary.
- [ ] The existing integration test suite is unchanged; no test assertion is weakened.

## Files that need no change

- `doc/active-work.md` and `doc/epics/EPIC-200.md` - the user says these are already updated; the epic already links this task.
- `C:\projects\persephone-boards\boards\audio-player\ai-vision.js` and `C:\projects\persephone-boards\boards\powerpoint-viewer\pptx-aivision.js` - US-2128 and US-2129 own these model changes; US-2131 only documents their final result shapes.
- Existing board `CLAUDE.md` files - the result examples belong in mounted `guides/agent.md` files or live `$help`; no author-note file needs editing.
- `integration-test/tests/published-boards/helpers.mjs` and all `integration-test/tests/published-boards/<board-id>/` tests - this task changes documentation only and requires no test updates.
- `integration-test/run.mjs` - the user prohibited running this harness and this task does not require a test change.
- `C:\projects\persephone-boards\boards-manifest.json` and each board's `versions-manifest.json` - generated files; the boards repository explicitly forbids hand-editing them.

## Files Changed

| File | Planned change |
|---|---|
| `C:\projects\persephone-boards\boards\chess\guides\agent.md`; `drawio-viewer\guides\agent.md`; `excel-viewer\guides\agent.md`; `force-graph\guides\agent.md`; `notebook\guides\agent.md`; `pdf-viewer\guides\agent.md`; `powerpoint-viewer\guides\agent.md`; `sqlite-viewer\guides\agent.md`; `todo\guides\agent.md`; `word-viewer\guides\agent.md` | Add concise result examples for every model method; add the SQLite, Force Graph, Chess and 1-based conventions. |
| `C:\projects\persephone-boards\boards\audio-player\guides\index.md`, `guides\agent.md`; `gem-keep\guides\index.md`, `guides\agent.md` | Add a hub and an agent page to each newly mounted guide folder. Audio Player documents model results including US-2128 `previous()`; Gem Keep documents the starting-gold formula and makes no `.app` claim. Add each board's `guides: "guides"` manifest field. Both current minimum app versions exceed the 5.0.2 support floor. |
| `C:\projects\persephone-boards\boards\audio-player\board-manifest.json` | Add `guides: "guides"`; its version is already `1.0.6` for this epic. |
| `C:\projects\persephone-boards\boards\theme-editor\app.js` | Add result examples to the live model `$help` for `save()`, `saveAs()`, `rename()`, and `deleteThemeCore()`; retain existing `1.2.2` epic bump. |
| `C:\projects\persephone-boards\boards\chess\board-manifest.json`, `drawio-viewer\board-manifest.json`, `excel-viewer\board-manifest.json`, `force-graph\board-manifest.json`, `sqlite-viewer\board-manifest.json`, `todo\board-manifest.json`, `word-viewer\board-manifest.json`, `gem-keep\board-manifest.json` | Bump each board's patch version once for its first EPIC-200 change. For Gem Keep also add the `guides` folder field. |
| `C:\projects\persephone-boards\boards\chess\WHATS-NEW.md`, `drawio-viewer\WHATS-NEW.md`, `excel-viewer\WHATS-NEW.md`, `force-graph\WHATS-NEW.md`, `sqlite-viewer\WHATS-NEW.md`, `todo\WHATS-NEW.md`, `word-viewer\WHATS-NEW.md`, `gem-keep\WHATS-NEW.md` | Add one line under the matching new patch heading. |
| `C:\projects\persephone-boards\boards\audio-player\WHATS-NEW.md`, `notebook\WHATS-NEW.md`, `pdf-viewer\WHATS-NEW.md`, `powerpoint-viewer\WHATS-NEW.md`, `theme-editor\WHATS-NEW.md` | Add one line under each board's existing EPIC-200 heading without another version bump. |
| `assets/guides/agents/boards/published-boards.md` | Add the verified model-coverage table, retaining the existing staged edit. |
