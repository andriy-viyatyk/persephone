# US-1673: Catalog boards, part 1

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md), F1–F9. Plan only; implementation is in `C:/projects/persephone-boards` on `develop`.

## Goal

Make `theme-editor`, `todo`, `chess`, `agent-log-viewer`, and `aivision-explorer` ready for board-pack localization. Move user-visible board copy into English packs and route it through `persephone.i18n.t()`, while preserving data, agent-facing descriptions/errors, and console text in English.

## Background

US-1667 introduced the board localization bridge. Each board declares `languages: { "folder": "lang", "default": "en" }` and `minBridgeVersion: "1.36.0"`; its default catalog is `lang/en.json` with a `messages` object. The English name, description, editor name, setting labels, and sidebar view title remain English in the manifest. Under F1/F7, do not put `manifest.*` keys in `en.json`; a future translated pack can contain those keys. `en-XA` pseudo-localizes messages in the English pack.

Follow the completed [US-1672 plan](../US-1672-bundled-board-strings/README.md): inventory the visible copy, add a small board-local helper, and replace UI literals with `t(key, params)`. The five target boards are plain classic-script HTML/JavaScript applications (not ES modules), so load each `i18n.js` before `app.js`; the helper should expose a local/global `t` function that delegates to `persephone.i18n.t(key, params)`. Each helper is frame-local, which also works for Todo's main and Lists & Tags views.

The sibling repository's `CLAUDE.md` requires all board work on `develop`, a `WHATS-NEW.md` entry under the next release heading, and a matching semantic-version bump in each board's source `board-manifest.json`. Publishing is a separate user decision. Never hand-edit `boards-manifest.json` or any `versions-manifest.json`. This task adds only English packs, does not publish, and makes no changes in this Persephone repository except this plan document.

### Inventory conventions

Paths below are relative to `C:/projects/persephone-boards/boards/<id>/`. Line references are from the inspected source and identify the literal or render site to replace; shared/dynamic variants use one key with placeholders. Counts are proposed distinct `messages` keys (duplicate uses share a key). Manifest identity/description/settings metadata is deliberately not counted or added to `en.json`. Skip `lib/`, vendored assets, minified files, and agent-only documentation. Board data, user-authored content, `.app`/AiVision descriptions and thrown errors consumed by agents, and console/log diagnostics stay English (D3).

## User-visible string inventory

### `theme-editor` — 108 proposed message keys

| File:line | Proposed key(s) | English text / inventory |
|---|---|---|
| `index.html:16-62` | `theme.starting.*`, `theme.colorMode`, `theme.mode.auto/dark/light`, `theme.contrast`, `theme.waitingPalette`, `theme.palette.aria`, `theme.views.aria`, `theme.view.set/generator/details`, `theme.set.heading/description`, `theme.set.mode.aria`, `theme.set.mode.both/dark/light`, `theme.set.status.initial`, `theme.set.regenerate`, `theme.set.tiles.aria`, `theme.generator.heading/description`, `theme.generator.generateDark/generateLight`, `theme.overrides.clear`, `theme.details.heading/description`, `theme.overrides.clearAll/title` | Static view headings, mode labels, descriptions, buttons, initial status and accessible labels, including “Starting palette”, “Set the three foundations. Persephone derives the rest of the palette.”, “Color mode”, “Auto”, “Dark”, “Light”, “Contrast”, “Waiting for a palette…”, “Generated Set”, “Generator”, “Details”, “Generated set”, “100 contrast-ranked variants, sorted by background hue. Select a tile to preview it.”, “Both”, “Select Generated Set to create variants.”, “Regenerate”, “Theme generator”, “Generate dark theme”, “Generate light theme”, “Palette details”, “Clear overrides”, and the `aria-label` text. `WCAG AA`, color-token names, and numeric color values remain standards/data labels. |
| `index.html:68-98` | `theme.delete.title/copy/cancel/confirm`, `theme.rename.title/name/cancel/confirm`, `theme.unsaved.title/copy/cancel/discard/save`, `theme.import.title/copy/cancel/chooseFile` | Dialog headings, explanatory copy, labels and actions: “Delete custom theme?”, “This removes the saved theme from Persephone.”, “Cancel”, “Delete theme”, “Rename theme”, “Name”, “Rename”, “Unsaved theme changes”, “Your current draft has unsaved changes. Save it or discard it before opening the requested theme.”, “Discard”, “Save”, “Import theme JSON”, “The file is saved as a new custom theme and applied.”, “Choose file…”. |
| `app.js:152-164,235-272,315` | `theme.reroll`, `theme.lock.unlocked/locked`, `theme.colorSource`, `theme.source.auto/custom`, `theme.derivedColors`, `theme.override.pinned` | Generated control labels “Reroll”, “Unlocked”, “Locked”, “Color source”, “Auto”, “Custom”, “Derived colors”, “Pinned”. Labels dynamically supplied from known generator blocks remain user-facing and need stable message keys rather than being treated as CSS color data. |
| `app.js:287,357,369` | `theme.error.invalidCssColor`, `theme.contrast.summary/pending`, `theme.override.notice` | “Enter a valid CSS color for {block}. The last valid preview is unchanged.”; “Text / background: {ratio}:1 · {result}” / “Text / background contrast pending”; pluralized “{count} color(s) were set in Details and won't follow the generator.” |
| `app.js:512,550,576,585,590,655,657` | `theme.variant.caption`, `theme.set.generating`, `theme.set.ready`, `theme.set.failed`, `theme.generation.passes`, `theme.generation.best` | “Variant {index} · {mode}”; “Generating {count} of 100…”; “100 variants ready in {seconds}s.”; “Generation failed. Select Regenerate to try again.”; “Rerolled color passes all four AA checks.” / “Generated {mode} theme passes all four AA checks.”; “Best candidate after 20 tries passes {passes} of 4 required AA checks; some pairs still fail.” |
| `app.js:693,779,830,853,858,1007,1012,1018,1033,1042` | `theme.overrides.clearCount`, `theme.reset`, `theme.mode.inferred`, `theme.monaco.inferred`, `theme.contrast.none/aa/fail`, `theme.active`, `theme.preview.superseded` | “Clear overrides ({count})”; “Reset”; “Monaco base follows the inferred light/dark mode.”; “Dark inferred” / “Light inferred”; “Monaco base: {color} (follows inferred mode).”; “No measurements returned.”; “AA” / “Fail”; “Active in Persephone: {name}”; “another selection replaced this preview”. Numeric contrast ratios and derived colors are formatted values, not translated content. |
| `app.js:1049,1053,1204,1348,1391,1403-1411,1424,1436,1463,1488,1518,1749,1751` | `theme.notice.removedElsewhere/changedElsewhere/newDraft/saved/reverted/renamed/deleted/export/import/restored`, `theme.saveAs.title`, `theme.delete.confirmCopy` | In-board status and confirmation copy: “This theme was removed elsewhere. Your unsaved changes are kept; use Save as to keep them.”; “This theme changed elsewhere. Your unsaved changes are kept; use Revert to load the saved version.”; “New theme draft created from the active theme.”; “Theme saved as a new custom theme and applied.” / “Theme saved and applied.”; “Draft reverted; another selection remains active.” / “Draft reverted. The persisted theme is active.”; “Save as a new theme”; “Save” / “Rename”; “{name} will be removed from the saved custom themes.”; “Name changed. Save to keep it as a custom theme.”; “Theme renamed.”; “Custom theme deleted.”; “Theme JSON export started.”; “Imported as a new custom theme and applied.”; “Restored unsaved changes. Revert is available in the toolbar.”; “Restored unsaved changes.” |
| `app.js:675-676,1204+,1348+,1391+` | `theme.errors.*` | Errors surfaced through the board message or `persephone.notify`: “Could not generate theme variants”, “Could not apply theme variant”, “Could not delete theme”, “Could not rename theme”, “Theme Editor could not connect to Persephone”, and any other fixed user-facing fallback passed to `reportError`. Preserve the caught error's agent/diagnostic detail as English when it is also emitted to logs. |
| `app.js:714-739` | `theme.toolbar.rename/save/saveAs/revert/delete/export/import`, `theme.toolbar.text` | Labels registered with `persephone.toolbar.set()` for Rename, Save, Save as, Revert, Delete theme, Export JSON and Import JSON; toolbar text is `Theme: {name}`. These are Persephone-registered UI strings and must use `t()`. |
| Dynamic render sites `app.js:195,779,811,853,1026`; `index.html:5` | `theme.base.component.*`, `theme.group.*`, `theme.contrast.label.*`; manifest excluded | Visible base-color component names, group headings and contrast row labels sourced from fixed in-board display-name constants should be keyed and localized. `index.html:5` is document title metadata (“Theme Editor”), and manifest name/description/capability title stay English in this task. |

### `todo` — 58 proposed message keys

| File:line | Proposed key(s) | English text / inventory |
|---|---|---|
| `index.html:16-53` | `todo.list.switch.title/label`, `todo.list.all`, `todo.search.placeholder/clear`, `todo.item.add.placeholder/add.title`, `todo.list.add.placeholder/add.title`, `todo.section.lists/tags`, `todo.tag.add.placeholder/add.title` | Main and Lists & Tags chrome, including `Switch list`, `List:`, `All`, `Search…`, `Clear search`, `Add an item…`, `Add item`, `New list…`, `Add list`, `Lists`, `Tags`, `New tag…`, and `Add tag`. Plus/cross glyphs are symbols, not strings. |
| `app.js:268,299,336` | `todo.confirm.deleteItem/deleteList/deleteTag` | Confirmations “Delete “{title}”?” (fallback “this item”), “Delete list “{name}”? Its items become unassigned.”, and “Delete tag “{name}”?”. |
| `app.js:137` | `todo.error.save` | Toast “Todo board: failed to save — {error}”; localize the fixed message and keep technical diagnostic details English. |
| `app.js:788,802,826,832,838` | `todo.fileName` (data), `todo.list.all`, `todo.error.invalidJson`, `todo.empty.new`, `todo.empty.filtered` | Empty/error states “This file isn't valid JSON — fix it in Monaco to edit here.”, “No items yet. Create a list in the Lists & Tags panel, then add items.”, and “No items match the current filter.” `fileName` and selected list names are user data. |
| `app.js:802,826,832,838,897-898` | `todo.status.itemCount`, `todo.status.filteredCount`, `todo.date.created`, `todo.date.done` | Status-bar strings “{count} items” and “{shown} of {total} items”; accessible date title “Created {created} · Done {done}”. Date values are formatted with the current app locale. |
| `app.js:897,992,1059` | `todo.item.markDone/markNotDone`, `todo.item.addComment`, `todo.comment.placeholder`, `todo.tag.add`, `todo.item.delete.title`, `todo.tag.set.title` | Row controls “Mark done”, “Mark not done”, “+ Add comment”, “Comment…”, “＋ tag”, “Delete item”, and “Set tag”. |
| `app.js:1059-1130` | `todo.list.allTags`, `todo.list.rename/delete`, `todo.tag.color/rename/delete`, `todo.color.none`, `todo.listPicker.empty` | Sidebar and popover controls “All”, “All Tags”, “Set color”, “Rename”, “Delete”, “No color”, and “No lists yet — add one in the Lists & Tags panel.” List/tag names and tag color values remain user content. |
| `app.js:1284` | `todo.empty.openFile` | Plain-board state “Open a .todo.json file to edit it here.” |
| `app.js:128+` and `app.js:760+` | `todo.confirm.title/cancel/confirm` and validation/status keys | Inventory the fixed title/action labels used by the in-board confirmation overlay, inline list/tag edit controls, and other fixed validation copy in the shared DOM helper / confirm flow. Keep names, item titles, comments, list/tag values and file content as user data. |
| `index.html:5` and `board-manifest.json` | Not in pack | “Todo Board” document title and manifest metadata remain English; manifest metadata is not `manifest.*` content in `lang/en.json`. |

### `chess` — 42 proposed message keys

| File:line | Proposed key(s) | English text / inventory |
|---|---|---|
| `index.html:5,11-20,43` | `chess.game.newWhite/newBlack`, `chess.game.newWhite.title/newBlack.title`, `chess.game.takeback/title`, `chess.game.resign/title`, `chess.board.flip/title`, `chess.pgn.copy/title`, `chess.chat.placeholder` | Toolbar buttons and accessible titles: “New game: I'm White”, “New game: I'm Black”, their explanatory titles, “Take back” and its title, “Resign” and its title, “Flip the board”, “Copy PGN”, “Copy the game as PGN”, and “Message your agent…”. `PGN` is a file format identifier. |
| `app.js:71-82,336-344` | `chess.result.checkmate/resigned/draw`, `chess.turn.check/user/agent`, `chess.turn.userColor/agentColor`, `chess.result.prompt` | Board result/status messages: “Checkmate — {winner}”, “{who} resigned — {winner}”, “Draw ({reason})”, “Result {result} · start a new game from the toolbar”, “Check! Your move”, “Your move”, “Check! Agent is thinking”, “Agent is thinking”, “You play {color}”, “The agent plays {color}”. Chess outcome terms can be message values, while internal result enum values stay English. |
| `app.js:143,159,171,185` | `chess.chat.newGame`, `chess.chat.resignationTakenBack`, `chess.chat.takeback.one/multiple`, `chess.chat.resigned.agent/user` | User-visible system chat entries “New game — {starter} started it. You play {color}.”, “Resignation taken back.”, “You took back your move.”, “You took back your move and the agent's reply.”, “The agent resigned.”, and “You resigned.” The agent-authored chat text itself remains user content. |
| `app.js:348,356,382,390` | `chess.status.move`, `chess.moves.empty`, `chess.chat.emptyPrompt`, `chess.chat.speaker.agent/user` | Status-bar item “Move {number} · {color} to move”; empty move list “No moves yet.”; empty chat prompt “Ask your AI agent (connected to Persephone over MCP) to play, for example: … Then make your move. The agent's moves and comments appear here.”; speaker labels “Agent” / “You”. The quoted example is agent-facing sample content and should remain English inside this UI guidance. |
| `app.js:517-540` | `chess.promotion.title/queen/rook/bishop/knight` | Promotion picker heading and accessible labels/options for Queen, Rook, Bishop, Knight (inspect the picker render block; piece symbols/letters stay chess notation). |
| `app.js:556-558` | `chess.toast.pgnCopied`, `chess.error.pgnCopy` | Toasts “PGN copied to the clipboard” and “Could not copy the PGN”. |
| `app.js:87-91,127-151,179-203,572,601-731` | Excluded: agent/model strings | PGN headers/data, SAN, FEN, square coordinates, piece letters, legal move lists, chat payloads sent to the agent, `.app` descriptions, and thrown errors read by the agent remain English/notation under D3. |
| `index.html:5`, manifest | Not in pack | Browser title “Agent Chess”, board name and description remain English metadata. |

### `agent-log-viewer` — 96 proposed message keys

| File:line | Proposed key(s) | English text / inventory |
|---|---|---|
| `index.html:11-21` | `logs.back/title`, `logs.source.none`, `logs.open.files/title`, `logs.open.folder/title`, `logs.preset.claude/title`, `logs.preset.codex/title`, `logs.recent/title/empty`, `logs.reload/title` | Toolbar controls and titles “Back to the session list (Backspace)”, “No source”, “Files…”, “Open one or more session log files”, “Folder…”, “Open a folder of session logs”, “Claude Code”, “Codex”, “Recent…”, “Recent sources”, “Reload from disk”. Product/protocol names remain unchanged in translations unless they are part of a surrounding sentence. |
| `index.html:29-42` | `logs.filter.placeholder`, `logs.agent.title/options.*`, `logs.group.title/options.*`, `logs.subagents.title`, `logs.search.placeholder/title` | List filters: “Filter by title or project…”, “Agent” and its Any/Claude Code/Codex options, “Group rows” and grouping options, “Include subagent sessions”, “Subagents”, “Search prompts and answers…”, and “Scans the files (Enter)”. |
| `index.html:66-71` | `logs.expandAll/title`, `logs.collapseAll/title`, `logs.find.placeholder/title`, `logs.find.previous/title`, `logs.find.next/title` | Session controls “Expand”, “Expand all tool calls”, “Collapse”, “Collapse all”, “Find in session…”, “Enter: search, then n / p”, “Previous match (p)”, “Next match (n)”. Keyboard shortcuts remain literal placeholders. |
| `index.html:22-86` | `logs.view.*`, `logs.column.*`, `logs.state.*` | Static labels/headings for session-list and session views, list columns, chart, transcript, outline, raw view, filters, live tail and empty/loading/failure regions. Inventory each literal label and `aria-label` in this shell; data-derived prompt/session text and raw log content are excluded. |
| `app.js:207,317-375,416-476` | `logs.source.*`, `logs.noPrompt`, `logs.noProject`, `logs.noDate`, `logs.metric.*`, `logs.chart.peak`, `logs.cost.*` | Fixed user-visible fallbacks, column headings and titles such as “(no prompt)”, “(no project)”, “(no date)”, “Est. cost (API)”, “Estimated API cost”, “tokens”, “Tokens per day · peak {count}”. Session titles, project paths, errors read from the log, model names, token counts and costs are log data. |
| `app.js:558-686` | `logs.turn.*`, `logs.toolCall.one/other`, `logs.tokens`, `logs.raw`, `logs.outline.*`, `logs.session.*` | Fixed transcript/outline labels, paired tool-call labels and the `plural()` labels used in accessible titles, turn summaries, tool results, thinking/compaction markers, diffs, raw records, subagent navigation, and live-tail actions. Inventory fixed strings at render sites; prompt/answer/tool payloads and raw record values are data. |
| `app.js:907-924` | `logs.find.progress`, `logs.find.count`, `logs.find.none`, `logs.find.position` | Find status “Searching…”, “{count} turns”, “no match”, and “{current} / {total}”. |
| `app.js` (all render and error handlers) | `logs.empty.*`, `logs.loading.*`, `logs.error.*`, `logs.toast.*`, `logs.dialog.*` | Empty states, unsupported/invalid source errors shown to the user, file/folder picker failure states, parser/worker errors surfaced in the view, action confirmation text, and notifications. Use distinct keys for each fixed message and placeholders for counts/source labels; do not translate raw log error payloads or console diagnostics. |
| `app.js:38-74,336,356,374,416,575,584-607,686` | Locale-aware formatting | Replace ambient-locale `Intl.NumberFormat()` and `toLocaleDateString/TimeString(undefined, …)` with formatters given `persephone.locale.code`; route byte/token/cost counts and fixed date/time displays through `Intl.NumberFormat` / `Intl.DateTimeFormat`. Keep ISO timestamps, token totals, paths, raw log text and cost values as data. |
| `lib/`, `index.html:5`, manifest | Not in pack | Skip vendored Marked and DOMPurify. Browser title and English manifest name/description/settings metadata stay English. |

### `aivision-explorer` — 74 proposed message keys

| File:line | Proposed key(s) | English text / inventory |
|---|---|---|
| `index.html:5-125` | `aiExplorer.tree.aria`, `aiExplorer.nodes.aria`, `aiExplorer.resize.aria`, `aiExplorer.tabs.aria`, `aiExplorer.details.aria`, `aiExplorer.tab.agent/members/search/events`, `aiExplorer.search.placeholder`, `aiExplorer.controls.*` | Static shell labels, tab names, accessible names, selected-path/operation controls, Refresh and Search controls, form labels, action buttons and static hints in the four tabs. Inventory every fixed shell text and `title`/`placeholder`/`aria-label` attribute; do not key stable `data-name` identifiers. |
| `app.js:53-134,300` | `aiExplorer.boot.*`, `aiExplorer.error.*`, `aiExplorer.note.noModel` | Boot/trust/loading states and errors presented in the UI, plus the editor-without-model note. Preserve host-provided trust text and caught diagnostics as English detail when included. |
| `app.js:394-401,488-508` | `aiExplorer.value.label`, `aiExplorer.members.count`, `aiExplorer.kind.*`, `aiExplorer.member.summary`, `aiExplorer.operation.*` | Fixed labels and status around returned values, member counts and selected member details. **The board displays Persephone's live AiVision model text (summaries, descriptions, help/hints, child/member names and returned values); that text is agent-facing data and stays English.** |
| `app.js:556-620` | `aiExplorer.dialog.resultTitle`, `aiExplorer.dialog.copy/copied`, `aiExplorer.dialog.confirmAction`, `aiExplorer.dialog.cancel/confirm` | Result/copy and caution-confirmation dialogs, including “Copied”, “Copy”, “Confirm {action}”, and action/cancel buttons. The caution paragraph comes from model metadata and stays agent-facing English. |
| `app.js:654,779-795,802,870,892,946` | `aiExplorer.operation.cancelled`, `aiExplorer.search.empty/searching/results/failed`, `aiExplorer.events.*`, `aiExplorer.operation.read` | “Cancelled — no bridge call was made.”, “Enter a non-empty query.”, “Searching…”, “{count} result(s)”, “Search failed: {error}”, live-feed paused/history-unavailable status, and fixed action labels. Bridge errors and event payloads remain English data. |
| `app.js` (rendered fixed labels across Agent/Members/Search/Events) | `aiExplorer.member.*`, `aiExplorer.search.*`, `aiExplorer.events.*`, `aiExplorer.value.*`, `aiExplorer.action.*` | Remaining fixed UI copy for member cards, operation result states, search result controls, event-feed states, and empty/loading states. Keep descriptor content, AiVision help/search results, paths and member values untouched. |
| `app.js` numeric display sites | Locale-aware formatting | Use `Intl.NumberFormat(persephone.locale.code)` for UI-generated result/member/event counts when formatted by the board; do not reformat numbers inside returned model/log payloads. This board has no third-party locale option. |
| `index.html:5`, manifest | Not in pack | Browser title and English board metadata remain English. |

The counts above are distinct English UI message keys; the tables group related keys by source region for readability. Repeated uses share keys, while separate messages retain separate keys. The inventory covers static HTML, title/placeholder/ARIA attributes, dialogs/confirmations, notifications/errors/empty states, sidebar content, Persephone toolbar items, and status-bar items. `theme-editor` registers toolbar strings with `persephone.toolbar.*`; Todo and Agent Chess publish status text with `persephone.setStatusText()` / `setStatusText`; the other boards have no Persephone-registered toolbar or status item in the inspected shell.

## Implementation Plan

- [ ] 1. Work in `C:/projects/persephone-boards` on `develop` only. Reconcile the inventory above against all non-vendored files in the five target board folders. Treat the stated counts as the target distinct message-key counts; adjust the plan-derived catalogs if the line-by-line pass finds missed fixed strings. Exclude all board guides, `CLAUDE.md`, agent descriptions, console text, logs, and data values.
- [ ] 2. Add `boards/theme-editor/lang/en.json`, `boards/todo/lang/en.json`, `boards/chess/lang/en.json`, `boards/agent-log-viewer/lang/en.json`, and `boards/aivision-explorer/lang/en.json`. Each file has `{ "messages": { ... } }`, one entry per fixed user-visible string, with named placeholders and CLDR plural objects where needed. Add no `manifest.*` keys.
- [ ] 3. Add one classic-script `boards/<id>/i18n.js` helper per board. Define a board-local `t(key, params)` wrapper around `persephone.i18n.t(key, params)` and load it from that board's `index.html` immediately before its existing app script(s). Keep the bridge lookup behind the helper; replace fixed UI strings with `t()` across the whole board. Todo's two independent frames each load the same helper. Keep all `.app` names, settings keys, AiVision descriptions/errors, data values and console diagnostics English.
- [ ] 4. In each of the five `boards/<id>/board-manifest.json` files, add `"languages": { "folder": "lang", "default": "en" }` and set `"minBridgeVersion": "1.36.0"`. Retain English manifest `name`, `description`, `editorName`, settings and view title; do not add `manifest.*` entries to the English pack.
- [ ] 5. Update user-visible hand-formatted locale values. In `boards/todo/app.js`, pass `persephone.locale.code` to date formatting in `formatDate()` and preserve the existing date/time presentation. In `boards/agent-log-viewer/app.js`, supply the app locale to `Intl.NumberFormat` and `Intl.DateTimeFormat`/`toLocale*` calls used by the UI. In `boards/theme-editor/app.js`, format visible ratios and elapsed time with `Intl.NumberFormat(persephone.locale.code)` while preserving required precision. In chess and AiVision Explorer, format user-visible generated counts/status numerals with `Intl.NumberFormat` where not part of SAN/FEN, PGN, square coordinates, or returned data. No third-party locale-taking library appears in these five boards; chess.js is a rules/data engine and receives no locale.
- [ ] 6. For each board, add a one-line entry to `boards/<id>/WHATS-NEW.md` under the next version heading, and bump the source manifest to match. The repo guide requires a matching semver bump for every shippable change; use a patch bump for this compatible copy/catalog update: Theme Editor `1.1.0 → 1.1.1`; Todo `1.2.1 → 1.2.2`; Agent Chess `1.0.0 → 1.0.1`; Agent Log Viewer `1.0.0 → 1.0.1`; AiVision Explorer `1.0.6 → 1.0.7`. Verify each changelog top heading equals the manifest version. Do not hand-edit `boards-manifest.json` or `versions-manifest.json`; do not publish or merge to `main` as part of US-1673.
- [ ] 7. Live-check each board under English and `en-XA` in Persephone. Use the board local folder `C:/projects/persephone-boards/boards/<id>`: install/open it locally (or call `app.boards.registerBoard(root)` to register/trust the local root, then `app.boards.openBoard(root)`). For Todo, also open a `*.todo.json` file to exercise the content-host editor and Lists & Tags sidebar; for Agent Log Viewer, open a synthetic `.jsonl` fixture or a matching session-log folder; for Chess, start a new game; for Theme Editor and AiVision Explorer, open their board roots directly. Exercise confirmations, empty/error states, visible registered toolbar/status items and relevant view/tab surfaces; inspect each `ui.log` for pack warnings. Verify data and agent-facing model/guide text remain English.
- [ ] 8. Keep this task plan in Persephone only. Do not edit `doc/epics/EPIC-126.md`, `doc/active-work.md`, or files in `C:/projects/persephone-boards` while creating the plan.

### Before → after examples

```js
// Before: boards/todo/app.js
empty.textContent = "No items match the current filter.";

// After
empty.textContent = t("todo.empty.filtered");
```

```html
<!-- Before: boards/chess/index.html -->
<button id="resign" title="Resign this game">Resign</button>

<!-- After: initialize the shell strings from t() before app interaction -->
<button id="resign" data-i18n="chess.game.resign">Resign</button>
```

```js
// Before: boards/agent-log-viewer/app.js
const nf = new Intl.NumberFormat();

// After
const nf = new Intl.NumberFormat(persephone.locale.code);
```

## Concerns

- Inventory counts are proposed distinct pack keys, not occurrences. Repeated source literals should share a key; different fixed meanings must not share keys merely because their current English is identical.
- English metadata remains English because this task creates only default English packs; translations of manifest display fields belong in later translated packs. Do not mistake generated labels, menu text, sidebar titles or status-bar messages for manifest metadata.
- Agent Log Viewer handles potentially sensitive user content. Only its own labels and fixed UI copy enter `en.json`; session records, prompts/answers, tool calls/results, project paths, model names, parser error payloads and raw data stay out of catalogs.
- Chess's SAN/FEN, piece letters, square coordinates, PGN fields and chess.js values are notation or data. Localize explanatory UI and system chat only; do not translate persisted chat authored by the user or agent.
- AiVision Explorer intentionally presents live Persephone model text to the user. Its dynamic descriptors, help, hints, member names and results are the agent-facing payload itself and remain English; only the Explorer's own shell, actions and fixed statuses are localized.
- The sibling checkout currently has unrelated staged changes in `how-to/README.md` and `scripts/publish-board.mjs`. Keep them intact and out of this plan's implementation scope.
- Publishing is explicitly outside the epic task acceptance (F9); do not merge to `main` or run the publish script.

## Acceptance Criteria

- Each of the five boards has `languages: { "folder": "lang", "default": "en" }`, requires bridge `1.36.0`, and has an English `lang/en.json` with no `manifest.*` keys.
- All inventoried fixed user-visible strings, including `index.html` text/attributes, dialogs, notifications, UI errors/empty states, sidebar surfaces, Persephone toolbar labels and status text, call `persephone.i18n.t()` through exactly one helper per board.
- Under `en-XA`, pack-owned interface text is pseudo-localized in every board and view. Board content, user data, file/notation formats, log payloads, console text and agent-facing `.app`/AiVision descriptions and errors stay English.
- Todo and Agent Log Viewer date/number formatting uses `persephone.locale.code`; Theme Editor uses it for visible hand-formatted numeric values. Any other hand-formatted user-facing numeric/date output uses locale-aware `Intl` formatting; no third-party locale API is left unconnected where one exists.
- Each board's `WHATS-NEW.md` top heading and manifest version match the planned patch version. No generated manifest is hand-edited; no board is published.
- Live checks cover English and `en-XA`, board-specific open route, each relevant sidebar/tab/empty/error/confirmation surface, and `ui.log` pack validation.
- This task plan leaves `doc/epics/EPIC-126.md`, `doc/active-work.md`, all sibling-repo files, and generated catalog/version manifests unchanged.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1673-catalog-boards-1/README.md` (this repo) | Document the investigation, inventory, implementation sequence, live checks, and acceptance criteria. |
| `C:/projects/persephone-boards/boards/theme-editor/lang/en.json` | Add Theme Editor's fixed English UI messages; no `manifest.*` keys. |
| `C:/projects/persephone-boards/boards/theme-editor/i18n.js` | Add the board-local `t()` helper. |
| `C:/projects/persephone-boards/boards/theme-editor/index.html`, `app.js` | Load helper; localize static/dynamic UI, dialog copy, errors, toolbar labels, and locale-aware values. |
| `C:/projects/persephone-boards/boards/theme-editor/board-manifest.json`, `WHATS-NEW.md` | Add languages/bridge requirement and matching `1.1.1` patch note/version. |
| `C:/projects/persephone-boards/boards/todo/lang/en.json` | Add Todo's fixed English UI messages; no `manifest.*` keys. |
| `C:/projects/persephone-boards/boards/todo/i18n.js` | Add the frame-local `t()` helper shared by the main/sidebar page source. |
| `C:/projects/persephone-boards/boards/todo/index.html`, `app.js` | Localize main and Lists & Tags UI, confirmations, empty/error states, and status; format dates with the app locale. |
| `C:/projects/persephone-boards/boards/todo/board-manifest.json`, `WHATS-NEW.md` | Add languages/bridge requirement and matching `1.2.2` patch note/version. |
| `C:/projects/persephone-boards/boards/chess/lang/en.json` | Add fixed chess UI messages; keep chess notation and data out. |
| `C:/projects/persephone-boards/boards/chess/i18n.js` | Add the board-local `t()` helper. |
| `C:/projects/persephone-boards/boards/chess/index.html`, `app.js` | Localize shell, result/status, system chat, picker, notifications and fixed UI copy. |
| `C:/projects/persephone-boards/boards/chess/board-manifest.json`, `WHATS-NEW.md` | Add languages/bridge requirement and matching `1.0.1` patch note/version. |
| `C:/projects/persephone-boards/boards/agent-log-viewer/lang/en.json` | Add fixed log-viewer UI messages; no log payloads. |
| `C:/projects/persephone-boards/boards/agent-log-viewer/i18n.js` | Add the board-local `t()` helper. |
| `C:/projects/persephone-boards/boards/agent-log-viewer/index.html`, `app.js` | Localize controls, views, fixed render/error text, counts and statuses; use app-locale number/date formatters. |
| `C:/projects/persephone-boards/boards/agent-log-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages/bridge requirement and matching `1.0.1` patch note/version. |
| `C:/projects/persephone-boards/boards/aivision-explorer/lang/en.json` | Add Explorer-owned shell/action/status messages only; no dynamic AiVision model text. |
| `C:/projects/persephone-boards/boards/aivision-explorer/i18n.js` | Add the board-local `t()` helper. |
| `C:/projects/persephone-boards/boards/aivision-explorer/index.html`, `app.js` | Localize shell, fixed controls, dialogs, operation/search/event statuses; keep model text English. |
| `C:/projects/persephone-boards/boards/aivision-explorer/board-manifest.json`, `WHATS-NEW.md` | Add languages/bridge requirement and matching `1.0.7` patch note/version. |
| No change: all five `lib/`, `vendor/`, minified files, board guides, `CLAUDE.md`, scripts, styles, icons, screenshots | Vendor/data/agent documentation and unrelated assets are outside the string catalog change. |
| No change: `C:/projects/persephone-boards/boards-manifest.json`, `boards/*/versions-manifest.json` | Generated by the publish script; do not hand-edit. |
| No change: `doc/epics/EPIC-126.md`, `doc/active-work.md` | Explicitly excluded by the task request. |
