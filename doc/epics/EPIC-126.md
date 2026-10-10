# EPIC-126: Boards localization — interface languages, phase 3

## Status

**Status:** Completed
**Created:** 2026-10-10

## Overview

Phase 3 of the localization roadmap. After EPIC-125, everything
Persephone draws is in the English catalog, but boards are still English only. A board's own text
lives in its own files, and the board webview has no idea which language the app uses. This epic
gives boards the same model as the app (roadmap D10). A board ships `lang/<code>.json` packs, the
host hands the board its locale and messages, and the shim offers `persephone.i18n.t()` with
per-string fallback. Every board Persephone ships, or lists in its catalog, is made translatable.
Like phase 2, this epic ships no new language: it makes boards ready for the packs that phase 4
writes.

## Goals

- A board can declare `languages` in its manifest and call `persephone.i18n.t(key, params)`. That
  gives it the current language, then the base language, then the board's default pack, then the
  key itself, with the same placeholder and CLDR plural rules as the app.
- A board's name, description, sidebar view titles, settings labels and editor name are
  translatable. They show in the Boards sidebar, board info, Open with, tabs and the published
  catalog.
- The text the shim draws itself (the board context menu) follows the app language.
- The two bundled boards (REST Client and Excalidraw) and the catalog boards in `persephone-boards`
  read their text from packs. Under `en-XA`, a board shows pseudo-text everywhere except data.
- An agent can make a board translatable and add a language to it from the board guides alone
  (D17's approach, applied to boards).
- Boards without `languages` behave exactly as today, and agents still drive boards in English.

## Decisions

Roadmap decisions D1–D15 and D17 stand (D16 withdrawn). This epic adds these. They are proposals
for the user to confirm or change:

- **F1 — One place for a board's text: its packs.** D10 proposed a separate
  `"localized": { "uk": { "name", "description" } }` block in the manifest. Instead, manifest text
  also lives in the packs, under reserved `manifest.*` keys:
  - `manifest.name`, `manifest.description` and `manifest.editorName`;
  - `manifest.views.<id>.title`;
  - `manifest.settings.<key>.label` and `manifest.settings.<key>.description`.

  The English values stay in the manifest, which remains the default. A translator, human or
  agent, then edits one file per language, not two. The published catalog cannot read a board's
  files before install, so the `persephone-boards` publish script copies `manifest.name` and
  `manifest.description` from each pack into the catalog entry's `localized` map.
- **F2 — The host loads and validates; the shim receives resolved tables.** At registration, the
  host reads only three packs: the current language, its base language, and the board's default.
  It validates them with the app's placeholder and plural rules, checking placeholders against the
  default pack. Invalid entries are dropped with a warning in the board log, never thrown. The
  shim receives the tables beside the theme palette, so a board never fetches its own `lang/`
  files.
- **F3 — No live language switch** (D5). The locale is fixed when the board registers. A language
  change reloads the window, which registers every board again.
- **F4 — Shim-owned text comes from Persephone's catalog.** The board context menu
  (`src/board-context-menu.ts`) and any other text the shim draws are app text, not board text.
  The host sends these few messages, already translated, at registration. The lint exemption for
  `board-context-menu.ts` is removed. `board-shim.ts` keeps its exemption, because its remaining
  literals are thrown errors, which stay English under D3.
- **F5 — Agents stay English** (D3, E2):
  - board `.app` member names, settings keys and pack keys are never translated;
  - MCP board listings and `boards.*` show the manifest's English text;
  - only what the user sees is translated (snapshots show translated text, which is correct).
- **F6 — Compatibility through the bridge version.** The bridge version goes from `1.35.0` to
  `1.36.0` once, in US-1667. A board that calls `persephone.i18n` requires bridge `1.36.0` in its
  manifest, so an older Persephone never installs an update it cannot run. Each catalog board's
  version bump carries that requirement.
- **F7 — This epic makes boards translatable; it does not translate them.** The roadmap said
  phase 3 localizes the catalog boards "with at least the Phase 4 languages". But no app pack
  exists yet, so a translated board would sit inside an English app, and the translations could
  not be checked against the app's wording. This epic ships each board's `lang/en.json`, while
  the translated board packs are drafted in phase 4, alongside the app's built-in packs, by
  following the same agent guide.
- **F8 — `en-XA` covers boards.** When the app runs under `en-XA`, the shim generates pseudo-text
  from the board's default pack. That is how each board task proves extraction is complete.
- **F9 — Tasks run in order; boards in the catalog repo go on `develop`.** Work in
  `persephone-boards` follows its own CLAUDE.md: changes land on `develop`. **Publishing the catalog
  boards is the user's call** and is not part of any task's acceptance.

## Current state (verified 2026-10-10)

- **Bridge:** `src/shared/board-bridge-version.ts` holds `BOARD_BRIDGE_VERSION = "1.35.0"`.
- **Registration and theme:** `BoardWebview.registerBoard()` calls
  `api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS)`, defined at
  `src/ipc/api-types.ts:315`. The palette reaches the shim's `onThemeChange`
  (`src/board-shim.ts` ~1177). This is the template for the locale (F2).
- **Manifest:** `src/renderer/editors/board/board-manifest.ts` parses these translatable fields:
  `name`, `description`, `editorName`, secondary view `title`, capability `title`, and settings
  `label` / `description` (`api/board-settings/types.ts`).
- **Shim text:** `src/board-context-menu.ts` has about 10 English labels: Open Link, Copy Link,
  Open Image in New Tab, Copy Image, Save Image As…, Cut, Copy, Paste, Save Image.
- **Catalog:** `src/main/published-boards-service.ts` reads `persephone-boards`'
  `boards-manifest.json`, whose entries carry English `name` / `description`.
- **Bundled boards:** `assets/boards/rest-client/` has about 1,600 lines in `src/`, with views
  and components. Excalidraw (`assets/boards/excalidraw/`) ships its own translations and takes a
  `langCode`.
- **Catalog boards (15):**
  - viewers: agent-log-viewer, aivision-explorer, cert-viewer, drawio-viewer, excel-viewer,
    force-graph, pdf-viewer, pe-viewer, powerpoint-viewer, sqlite-viewer, torrent-viewer,
    word-viewer;
  - other: chess, theme-editor, todo.
- **Guides:** `assets/guides/agents/boards.md` (1,511 lines), `board-review.md`, and the board
  template `assets/board-template/` (including its `CLAUDE.md`).

## Linked Tasks

Each task document is written when its task starts. Codex investigates and Claude reviews, as in
EPIC-125.

| Task | Title | Status |
|------|-------|--------|
| [US-1667](../tasks/US-1667-board-i18n-runtime/README.md) | Board packs and `persephone.i18n`: manifest `languages`, host loading, locale at registration, `en-XA`, bridge 1.36.0 | Done |
| [US-1668](../tasks/US-1668-board-shim-text/README.md) | Shim-owned text: board context menu from Persephone's catalog | Done |
| [US-1669](../tasks/US-1669-board-metadata-text/README.md) | Board metadata text: `manifest.*` keys in the sidebar, board info, Open with, tabs, settings | Done |
| [US-1670](../tasks/US-1670-catalog-localized-text/README.md) | Published catalog: localized name and description (publish script + catalog view) | Done |
| [US-1671](../tasks/US-1671-board-i18n-guides/README.md) | Board template and guides: making a board translatable, adding a language with an agent | Done |
| [US-1672](../tasks/US-1672-bundled-board-strings/README.md) | Bundled boards: REST Client packs, Excalidraw `langCode` | Done |
| [US-1673](../tasks/US-1673-catalog-boards-1/README.md) | Catalog boards, part 1: theme-editor, todo, chess, agent-log-viewer, aivision-explorer | Done |
| [US-1674](../tasks/US-1674-catalog-boards-2/README.md) | Catalog boards, part 2: the ten viewers | Done |
| US-1675 | Closing sweep: `en-XA` over every board, QA run of the board-language guide, roadmap | Done |

### US-1667 — Board packs and `persephone.i18n`

- Add a `languages: { folder, default }` field to the manifest, with parsing and validation.
- The host loads the current, base and default packs and validates them with the shared rules,
  logging warnings to the board log (F2).
- The packs and `{ code, pluralRules }` travel with `registerBoard`.
- The shim gets `persephone.locale` and `persephone.i18n.t(key, params)`, with the D10 fallback
  chain and `Intl.PluralRules`.
- Add `en-XA` pseudo-text (F8).
- Bump `BOARD_BRIDGE_VERSION` to `1.36.0` (F6). Check the plan for this: delegated plans have
  missed it before.
- **Acceptance:**
  - a test board with `lang/en.json` and `lang/de.json` shows German under `de`, falls back per
    key, and shows pseudo-text under `en-XA`;
  - a board without `languages` is unchanged;
  - a pack with a wrong placeholder logs a warning, and that key falls back.

### US-1668 — Shim-owned text

- The board context menu labels come from the app catalog (`board` area) and are sent at
  registration (F4).
- Remove the lint exemption for `src/board-context-menu.ts`.
- **Acceptance:** under `en-XA`, the board context menu is pseudo-text; menu ids are unchanged.

### US-1669 — Board metadata text

- Add the `manifest.*` reserved keys (F1).
- The Boards sidebar, board info, Open with, the board tab title, sidebar view titles, board
  settings labels and the editor name read the translated text, while agents get English (F5, E2).
- **Acceptance:** a test board's name and settings labels are translated in each of those places,
  and `boards.*` over MCP still lists English.

### US-1670 — Published catalog

- `persephone-boards`: the publish script copies `manifest.name` and `manifest.description` from
  each board pack into the catalog entry's `localized` map.
- Persephone: the catalog view shows the localized name and description, falling back to English.
- **Acceptance:** with a local catalog fixture, the catalog shows the localized text, and entries
  without `localized` are unchanged.

### US-1671 — Board template and guides

- Update `assets/guides/agents/boards.md`, `board-review.md`, the board template (`lang/en.json`,
  manifest `languages`, `t()` usage), and the `persephone-boards` how-to.
- Cover:
  - making a board translatable;
  - adding a language to an existing board (D17), including the `manifest.*` keys;
  - placeholders and plurals;
  - the bridge requirement (F6);
  - checking with `en-XA`.
- `board-review.md` gains the check "no hardcoded user-visible text".
- **Acceptance:** a new board from the template is translatable as created.

### US-1672 — Bundled boards

- REST Client: move its UI text into `lang/en.json` and `t()`, and add the `manifest.*` keys.
- Excalidraw: pass `persephone.locale.code` to Excalidraw's `langCode`, mapped to the languages
  Excalidraw ships, otherwise English.
- **Acceptance:** under `en-XA`, REST Client shows only pseudo-text and data. Excalidraw follows a
  language it ships (checked with a test pack for `de`).

### US-1673 / US-1674 — Catalog boards

- In `persephone-boards`, on `develop` (F9), extract each board's text to `lang/en.json` and add
  the `manifest.*` keys.
- Each board's version is bumped, with the bridge requirement (F6). No translated packs (F7).
- Boards with almost no text get only the manifest keys.
- **Acceptance:** each board is checked under `en-XA` in a running Persephone, and still works under
  English.

### US-1675 — Closing sweep

- Check every bundled and catalog board under `en-XA`.
- Run the `qa/` practice on the guide: a weaker model, with only the guides, makes a small board
  translatable and adds a language. Fix the guide where it misleads (Claude runs it).
- Update the roadmap (phase 3 done; phase 4 also translates the board packs, per F7).

## For the user to test

- **US-1667:** The scratch board `C:\projects\test-boards\us-1667-i18n` prints its messages. Verified live: English, German (with a test `de.lang.json` user pack), per-key fallback for a German entry with a wrong placeholder, plurals, `en-XA` pseudo-text, and two board-log warnings (placeholder mismatch, unknown key) logged once after "board loaded".

- **US-1668:** Right-click a link, an image or a text field in any board: the menu follows the app language. Verified live under `en-XA` on the scratch board: all eight items show pseudo-text with stable `data-persephone-menu-item-id`s. Not checked: the native "Save Image" dialog title (opening it would leave a native dialog up).

- **US-1669:** Add `manifest.*` keys to a board pack and switch language. Verified live under `de` on the scratch board: tab title, Board Info (name, description) and its tab, sidebar view title ("Notizen"), Settings section, heading and setting label; a missing German setting description falls back to English; `boards.list()`, `getManifest()` and the page title stay English for agents. Claude fixed two missed sites: the Board Info tab title and the Settings board heading. Not checked live: the Boards sidebar tree, pinned rail, Tools & Editors list, Open with and the trust dialog name.

- **US-1670:** Tools & Editors > Search Boards and the Board Info install tiles show a catalog board in the app language once its catalog entry carries `localized` text. Verified live under `en-XA`: catalog names and descriptions are pseudo-text; `boards.searchPublished()` stays English. Not verified live: an actual translated entry (no catalog board has packs yet; the resolver was reviewed by reading). The `persephone-boards` publish script change (`scripts/publish-board.mjs`, staged on `develop`) was checked by Codex with a throwaway script; nothing was published.

- **US-1671:** Read the new **Languages** section in `assets/guides/agents/boards.md` (and the review checks in `board-review.md`). A new board from the template now ships `lang/en.json` and calls `persephone.i18n.t()`. Verified live: a board created with `boards.createBoard()` (`C:\projects\test-boards\us1671-template`) gets `lang/en.json` and shows pseudo-text under `en-XA`. The `persephone-boards` how-to index got a pointer to the guide (staged on `develop`).

- **US-1672:** Open a `.rest.json` file and a drawing. Verified live: REST Client (`C:\projects\test-boards\us-1672-rest-client\demo.rest.json`) shows only pseudo-text and data under `en-XA`, including the Requests sidebar; Excalidraw opens in German under `de` from a bundled locale (no network). Excalidraw now bundles its own translations for the 15 roadmap languages it supports (~0.5 MB); Estonian and Belarusian fall back to English. Claude reverted an unneeded regeneration of Excalidraw's `lib/deps` from the build-script run.

- **US-1673:** In `persephone-boards` (`develop`, staged, not published): theme-editor 1.2.0, todo 1.3.0, chess 1.1.0, agent-log-viewer 1.1.0, aivision-explorer 1.1.0 read their text from `lang/en.json` and require bridge 1.36.0. Verified live with renamed test copies under `C:\projects\test-boards\i18n\` under `en-XA`: opening and empty states show only pseudo-text and data. Claude fixed leftovers Codex missed (chess hint, Agent Log Viewer buttons and source labels, "Persephone root") and restored ~29 pack strings whose `—`, `…`, `·`, `↑`/`↓` had been written as `?`. Deeper states (after opening a real file) were not walked.

- **US-1674:** In `persephone-boards` (`develop`, staged, not published): cert 1.1.0, drawio 1.2.0, excel 1.3.0, force-graph 1.1.0, pdf 1.2.0, pe 1.1.0, powerpoint 1.2.0, sqlite 1.2.0, torrent 1.10.0, word 1.2.0, all on bridge 1.36.0 with `lang/en.json`. pdf.js uses its own vendored locale when present; draw.io and av-grid UI stay English (no locale option). Verified live under `en-XA` in each board's opening state; Claude fixed draw.io save-dialog text, a force-graph confirmation and the Word zoom tooltip. Versions are minor bumps (bridge requirement raised).

- **US-1675:** Every bundled and catalog board checked under `en-XA` (see US-1672–1674). QA run (Claude, weak test agent with only the guides): it made a template board translatable and wrote a correct `lang/uk.json` with `manifest.name`, but had to guess where `manifest.*` keys go and could not validate the pack without switching the app language. Fixed in `assets/guides/agents/boards.md` (worked `uk.json` example; self-check steps; ask before switching language). Roadmap phase 4 now includes a board-pack validation call. Test boards unregistered; folders under `C:\projects\test-boards\` kept.

## Notes

### 2026-10-10

- Epic created from roadmap phase 3. The user accepted F1–F9 the same day; the roadmap's D10,
  phase 3 and phase 4 text now follow F1 and F7. Implementation runs autonomously.
