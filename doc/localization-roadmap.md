# Persephone in other languages — localization roadmap

> Status: **accepted by the user, 2026-10-09.** Phase 1 is [EPIC-124](epics/EPIC-124.md), completed 2026-10-10; phase 2 is [EPIC-125](epics/EPIC-125.md), completed 2026-10-10. Each phase below is sized to become
> one epic; numbers are assigned when a phase moves to [active-work.md](active-work.md). Findings
> are source-verified against the tree at commit `9fdd76e5` (v5.0.10 working branch); file
> references are the seams a task document should start from.

## 1. Goal

Persephone's interface is English only. This roadmap makes the interface language a setting:

- **Built-in languages** ship with the app (§4 lists the proposed set, including Ukrainian and its
  neighbours: Polish, Latvian, Lithuanian, Estonian).
- **Language packs are data, not code.** A language can be added or a translation fixed without a
  new release. The user asks their AI agent ("add Estonian", "this button should say …"); the agent
  writes the pack through the `app.languages` API, following an agent guide (D17). There is no
  manual editing UI.
- **Boards are localized too.** A board ships its own packs. When the board has no pack for the
  current language it falls back to English (or to the language it declares as its default), per
  string, never as a broken mix of keys.

## 2. Where we are (verified 2026-10-09)

There is no i18n layer. English literals are written inline across roughly **400 renderer files**.
A grep-based inventory, by area:

| Area | ≈ UI strings | Representative files |
|---|---|---|
| App shell, tabs, sidebar | 105 | `ui/app/MainPageView.ts`, `ui/tabs/PageTabView.ts`, `ui/sidebar/MenuBarView.ts`, `ui/sidebar/tools-editors-registry.ts`, `editors/register-editors.ts` (editor names) |
| Menus and context menus | ~71 files build `MenuItem[]` | `components/tree-provider/item-menus.ts`, `editors/browser/webview-context-menu.ts`, `editors/shared/editor-menu-items.ts`, `src/board-context-menu.ts` |
| Dialogs | 82 | `ui/dialogs/*View.ts` (17 dialogs), `ui/dialogs/ConfirmationDialog.ts` |
| Settings page | 170 | `editors/settings/settings-catalog.ts`, `editors/settings/sections/*.ts` |
| Notifications | 176 `ui.notify(...)` calls, ~60 files | `api/app.ts` and the API layer (~190 literals) |
| Editors | ~900 | board 138, browser 126, explorer 72, board-info 69, link-editor 55, git-tree 53, mneme-config 53, mcp-inspector 40, tools-hub 30, notebook 29, log-view 27, text 25, video 23, the rest under 20 each |
| uikit defaults | small | `emptyText` / `emptyMessage`-style props (111 uses app-wide); most uikit literals are in `*.story.ts` |
| About page | 31 | `editors/about/AboutView.ts`, `AboutGuideBrowserView.ts` |
| Main process | a handful | tray menu in `src/main/tray-setup.ts`, the "Unsaved changes" box in `src/main/browser-service.ts:422`; there is no app menu template |

Total: on the order of **2,000 strings**. Setting patterns: `label:` (326), `title:` (305, dialog
titles and tooltips), `createTextElement("…")` (190), `ui.notify(` (176), `children: "…"` (133,
button text), `placeholder:` (85), `.textContent =` (44). Plurals are hand-rolled
(`` `${n} files` `` ~22, `n === 1 ? … : …` ~7), and some sentences are concatenated from parts.

**Blocker — displayed text is used as identity.**

- `ConfirmationDialog` returns the clicked button's *label*, and ~15 callers compare it to English:
  `=== "Delete"`, `"Overwrite"`, `"Save"`, `"Don't Save"` (`tree-drop-actions.ts`,
  `item-crud-actions.ts`, `BoardEditorModel.ts:644`, `api/board-install.ts:137`, …).
- The public script API documents the same: `IDialogResult.button` "is the label of the clicked
  button" (`api/types/ui-log.d.ts:85`), and examples compare it to `"Yes"`.
- ai-vision matches popup menu items by `item.label === label`
  (`scripting/ai-vision/menus/index.ts:83`) and dialog adapters check `button === "Cancel"`
  (`scripting/ai-vision/dialogs/*.ts`).

Translating labels before these move to stable ids would break confirmations, scripts and agents.

**Agent-facing text is separated by folder**, which is what keeps it English (§3, D3):
`scripting/ai-vision/**`, `scripting/api-wrapper/**` (~1,160 `help` / `$help` literals),
`src/main/mcp/**`, `api/mcp/*`, the `api/types/*.d.ts` JSDoc and `assets/guides/`. Three files mix UI
and agent text and need splitting: `editors/settings/settings-catalog.ts` (also feeds
`ai-vision/namespaces/settings.ts`), `editors/board/board-permission-copy.ts` (also feeds
`ai-vision/dialogs/trust-board.ts` and `BoardInfoEditorFacade.ts`), and the ai-vision dialog
adapters that mirror button labels.

**Formatting** has no `Intl` use. Shared helpers are `core/utils/format-bytes.ts` (hardcoded
"KB/MB") and `formatDate` in `core/utils/utils.ts:38` (fixed `YYYY-MM-DD`), with duplicates in
`mneme-config/mnemeTypes.ts:140`, `browser/BrowserDownloadsPopup.ts:321`,
`core/utils/html-resources.ts:134`, plus `git-tree/git-date.ts`, `explorer/clipboard-date.ts`
("N days ago"), `log-view/LogEntryWrapper.ts`, `video/AudioControls.ts`.

**Monaco** (`monaco-editor` 0.55.1, ESM via `vite-plugin-monaco-editor-esm`) has no locale setup,
but the package ships `esm/nls.messages.<lang>.js` for cs, de, es, fr, it, ja, ko, pl, pt-br, ru,
tr, zh-cn, zh-tw.

**Seams to reuse:** custom theme storage (`api/custom-theme-storage.ts`: one validated JSON file
per item under `fs.resolveDataPath(...)`, atomic save, `DirectoryWatcher` reload) is the template
for user language packs; the board theme push (`board-theme.ts` → `BoardWebview.ts:544`
`registerBoard` → `main/board-bridge.ts:627` → `board-shim.ts` `onThemeChange`) is the template for
handing a board its locale.

**Layout risks for longer text (German is ~30% longer):** tabs `width: 200px` (`ui/tabs/PageTab.css:17`),
pinned rail 240px (`ui/sidebar/PinnedRail.css:19`), dialogs at `width: 520`
(Commit, CreateBoard, CreateBoardVarsStorage).

## 3. Decisions (accepted 2026-10-09)

- **D1 — Keys, with English as the source catalog in TypeScript.** Strings move to typed catalogs
  under `src/shared/i18n/en/<area>.ts`, keyed by area (`settings.theme.title`,
  `dialog.confirm.delete`). The key type is derived from the English catalog, so a typo is a
  compile error and "find all uses of this string" is a key search. `src/shared/` because the main
  process needs a few strings too.
- **D2 — One small runtime, no library.** `t(key, params?)` with `{name}` placeholders and plural
  messages as CLDR category objects (`{ one, few, many, other }`) chosen by `Intl.PluralRules`.
  Ukrainian, Polish, Lithuanian and Latvian need the `few` / `many` / `zero` forms, so `n === 1`
  ternaries cannot survive. Concatenated sentences become one message with placeholders, because
  word order differs between languages. An i18next/ICU library would be more weight than the
  ~100 lines this needs.
- **D3 — The agent surface stays English.** `$help`, MCP descriptions, script API errors, logs,
  guides and What's New are not translated: agents and documentation read them, and they are
  developer text. Agents address UI by `data-name` (ui-element-contract) and by stable ids (D4), so a
  translated window stays drivable. A snapshot shows translated text, which is correct.
- **D4 — Identity moves off displayed text first.** Dialog buttons and menu items get stable ids.
  `IDialogResult.button` keeps returning the **English** button name (the id), so existing scripts
  keep working in any language; a new `buttonLabel` carries the displayed text. ai-vision resolves
  a menu item or button by id *or* displayed label. This is done before any string is translated.
- **D5 — Switching language reloads the windows.** Views are `VanillaView`s that build their DOM once;
  making every view re-render on a language change would touch every view for a rare action. The
  Settings picker saves the language and reloads every window at once, without asking (user
  decision, 2026-10-10): each window saves its pages first and the main process keeps running, so
  pages come back as they were. A change made elsewhere (script, MCP, editing `appSettings.json`)
  does not reload; it applies on the next reload. Startup reads the setting
  synchronously, like `readStartupThemeId()`, so nothing paints in the old language.
- **D6 — Default is the OS language.** Setting `language`: `"auto"` (default; Electron's
  `app.getPreferredSystemLanguages()` matched against available packs, else English) or a BCP-47
  code. Match order: exact (`pt-BR`) → base (`pt`) → English.
- **D7 — Pack format and layering.** A pack is `<code>.lang.json`:
  ```json
  {
    "schemaVersion": 1,
    "code": "uk",
    "name": "Українська",
    "englishName": "Ukrainian",
    "messages": { "dialog.confirm.delete": "Видалити", "...": "..." },
    "source": { "dialog.confirm.delete": "a1b2c3" }
  }
  ```
  `source` holds a short hash of the English text each message was translated from, so the editor
  and the check script can flag translations whose English has since changed. Built-in packs live
  in `assets/languages/`; user packs in `%APPDATA%\persephone\data\languages\`. Lookup per key:
  user pack → built-in pack → English. A user pack with a built-in code overrides only the keys it
  contains, so fixing one Ukrainian string does not fork the whole pack. Invalid entries (unknown
  key, placeholder set different from English) are dropped with a warning, never thrown.
- **D8 — Formatting goes through `Intl`** with the active locale: dates, times, relative times
  ("3 days ago"), numbers and byte sizes, consolidated into one `core/utils/format.ts` and the
  duplicates removed. ISO dates that are data (file names, logs, `YYYY-MM-DD` in grids where the user
  sorts text) stay ISO. Language-neutral numeric date/time formats (ISO-style `YYYY-MM-DD`, 24-hour
  `HH:mm`) stay as they are; localization applies to words, decimal/grouping separators and units.
- **D9 — Monaco follows when it can.** Load `monaco-editor/esm/nls.messages.<lang>.js` before
  Monaco for the languages it ships (of the proposed set: de, es, fr, it, ja, ko, pl, pt-br, zh-cn);
  other languages leave Monaco's own widgets (find, command palette) in English. Because of D5,
  this is a startup choice, not a live switch.
- **D10 — Boards localize themselves, with per-string fallback.** A board manifest may declare
  ```json
  "languages": { "folder": "lang", "default": "en" }
  ```
  with `lang/<code>.json` files (`{ "messages": { … } }`, same placeholder and plural rules). The
  shim gets `persephone.locale` (`{ code, plural rules }`) at registration, beside the theme
  palette, and offers `persephone.i18n.t(key, params)`, which resolves board pack for the current
  language → its base language → the board's `default` pack → the key itself. A board without
  `languages` keeps working exactly as now. Manifest text (name, description, editor name, view
  titles, settings labels) is translated in the same packs under reserved `manifest.*` keys; the
  `persephone-boards` publish script copies the translated name and description into the catalog
  entry's `localized` map, because the catalog cannot read a board's files before install
  (EPIC-126 F1). Bridge version bump required.
- **D11 — Guard against new hardcoded strings with lint, not tests.** A local ESLint rule flags
  string literals in UI positions (`label`, `title`, `children`, `placeholder`, `textContent`,
  `createTextElement`, `ui.notify`) outside the catalogs and the agent-facing folders. It runs as a
  warning during extraction and becomes an error when Phase 2 closes. `npm run i18n:check` reports,
  per pack, missing, stale (`source` hash mismatch) and invalid messages — a script, not a test
  suite.
- **D12 — A pseudo-language for verification.** A hidden `en-XA` pack generated from English
  (`[Ŝéţţîñĝš ·····]`: accented and ~35% longer) shows any string that escaped extraction (it stays
  plain English) and any layout that breaks with longer text. Agents can check it with a snapshot.
- **D13 — Left-to-right only.** Arabic and Hebrew need mirrored layouts across all CSS; out of scope.
  The pack format reserves `"direction": "ltr"` so it can be added later.
- **D14 — Translations are machine-drafted, reviewed by speakers.** Built-in packs are produced by
  an agent from the English catalog with key context (D1 allows a translator note per key), using
  the same agent guide a user's agent follows (D17). Ukrainian is reviewed by the user before
  release.
- **D15 — No built-in Russian pack (user decision, 2026-10-09; revised 2026-10-10).** Persephone
  ships no Russian pack and does not bundle Monaco's `nls.messages.ru.js`. Nothing blocks Russian:
  a user who wants it can write a `ru.lang.json` pack, as for any other language, and the loader
  treats it like any other pack. *Revised 2026-10-10:* the original D15 also rejected packs by
  code and name, and D16 scrambled Russian words and letters in non-built-in packs. Both were
  removed: many people who are not Russian speak Russian, and an app that breaks their text would
  draw well-deserved criticism. Not shipping a pack is enough.
- **D16 — Withdrawn 2026-10-10.** (Was: scramble Russian words and letters in user and board packs.)
  See D15.

- **D17 — No Language Editor; agents write packs (user decision, 2026-10-10).** Nobody translates
  1,500 strings by hand any more: a user who wants a language or a fix asks an AI agent. So phase 4
  drops the Language Editor board and its `languages` board permission and bridge. What it keeps,
  and must get right, is what the agent needs: the `app.languages` API over MCP and scripting, and
  an agent guide (`guides.agents.languages`) that walks through creating a pack, fixing one
  message, and bringing a pack up to date after an app update. The MCP server instructions point
  to that guide, so an agent finds it from "add a language" alone.

## 4. Built-in languages

| Code | Language | Why | Monaco UI |
|---|---|---|---|
| `en` | English | source | yes |
| `uk` | Українська (Ukrainian) | requested | English |
| `pl` | Polski (Polish) | requested | yes |
| `lt` | Lietuvių (Lithuanian) | requested | English |
| `lv` | Latviešu (Latvian) | requested | English |
| `et` | Eesti (Estonian) | requested | English |
| `be` | Беларуская (Belarusian) | neighbour of Ukraine, requested | English |
| `ro` | Română (Romanian, also Moldova) | neighbour of Ukraine, requested | English |
| `sk` | Slovenčina (Slovak) | neighbour of Ukraine, requested | English |
| `hu` | Magyar (Hungarian) | neighbour of Ukraine, requested | English |
| `de` | Deutsch | large developer audience | yes |
| `fr` | Français | large developer audience | yes |
| `es` | Español | large developer audience | yes |
| `pt-BR` | Português (Brasil) | large developer audience | yes |
| `it` | Italiano | large developer audience | yes |
| `zh-CN` | 简体中文 (Chinese, Simplified) | largest developer audience after English | yes |
| `ja` | 日本語 (Japanese) | large developer audience | yes |
| `ko` | 한국어 (Korean) | large developer audience | yes |

Eighteen languages: Ukrainian and all its neighbours except Russia (no built-in pack, D15), the Baltic states, and the
largest developer audiences. Any other language is a user pack away (Phase 4).

## 5. Phases

Four epics, in order. Phase 2 is the bulk of the work and is mechanical, which makes it a good fit
for delegated, area-by-area tasks.

### Phase 1 — Foundation ([EPIC-124](epics/EPIC-124.md))

1. **i18n core.** `src/shared/i18n/`: catalog types, `t()`, plural selection, placeholder
   validation, pack loading and layering (D7), active-locale state read synchronously at startup.
   Pseudo-language `en-XA` (D12).
2. **Stable identity (D4).** Button ids in `ConfirmationDialog` and the `ui.dialog` API
   (`IDialogResult.button` stays the English id, adds `buttonLabel`); menu item ids; ai-vision menu
   and dialog resolution by id or label. Fix the "Confirmatioin" typo on the way. Split the three
   mixed UI/agent files (§2) so the agent half keeps English.
3. **Language setting and picker.** `language` setting (`"auto"` | code), Settings section with the
   native and English names and translation completeness, reload prompt (D5), startup in the chosen
   language. Main-process strings (tray, unsaved-changes box) read the same setting.
4. **Formatting (D8).** `core/utils/format.ts` over `Intl`; replace the duplicates.
5. **Conventions and lint (D11).** `doc/standards/localization.md` (how to add a string, plural and
   placeholder rules, what stays English), the ESLint rule in warning mode, `npm run i18n:check`.
6. **Pilot extraction:** Settings page and dialogs, end to end, to prove the pattern before Phase 2
   fans out.

### Phase 2 — Extract every UI string ([EPIC-125](epics/EPIC-125.md))

One task per area, each converting its literals to catalog keys and checking the area under `en-XA`:
app shell / tabs / sidebar; menus and context menus; notifications; browser editor; board host
(toolbar, status bar, trust dialog, board info); explorer, link editor and tree providers; git tree
and file diff; Mneme editors; notebook, log view, text, grid and the remaining small editors; MCP
inspector, Tools hub and About; uikit defaults. Then Monaco (D9), the layout fixes `en-XA`
revealed, and the lint rule switched to error.

Result (2026-10-10): **1,512** English catalog messages in 19 areas — settings 205, board 154,
menus 148, browser 125, shell 117, dialogs 114, tools 112, editors 107, mneme 102, api 69, links 64,
git 58, explorer 50, notebook 24, about 20, logView 16, uikit 12, common 9, main 6. This is the size
of each phase-4 pack.

### Phase 3 — Boards localization ([EPIC-126](epics/EPIC-126.md))

Manifest `languages` and `localized` (D10), `persephone.locale` and `persephone.i18n` in the shim,
bridge version bump, the host's built-in board context menu (`src/board-context-menu.ts`, which runs
in the shim and so had no locale in phase 2), catalog and board info showing localized names, the board template
(`assets/board-template/`) and board guides updated. In `persephone-boards`: make the catalog's
own boards (Chess, Theme Editor and the rest) translatable, with their text in `lang/en.json`.
Translated board packs are drafted in Phase 4 with the app's built-in packs (EPIC-126 F7).

### Phase 4 — Language packs for agents (epic)

1. **`app.languages` API** (scripting / MCP): `list()`, `current`, `get(code)`, `english(area?)`
   (keys, English text, plural forms, translator notes, source hashes), `validate(pack)` (the same
   warnings the loader gives: unknown keys, placeholder mismatches, invalid plural forms),
   `missing(code)` / `stale(code)`, `save(pack)` (validates, writes the user pack atomically),
   plus a board-pack check (`validateBoardPack(boardRoot, code)` or similar) so an agent can
   validate a board's `lang/<code>.json` without switching the app language (found in the
   EPIC-126 QA run: today a board pack is validated only when the app runs in that language),
   `delete(code)`, `apply(code)`. Reads are per area so an agent can work in chunks that fit its
   context.
2. **Agent guide** `assets/guides/agents/languages.md` (`guides.agents.languages`), per D17:
   creating a pack area by area; keeping `{placeholders}` and supplying the target language's CLDR
   plural categories; using translator notes for ambiguous keys; recording source hashes; checking
   with `validate` and in the app (`apply`, then a snapshot); fixing a single message; updating
   missing and stale keys after an app update. A pointer from the MCP server instructions and from
   `guides.agents.index`, and a short user-facing note in the Settings guide: "ask your agent to
   add a language".
3. **QA run:** a weak model with only the docs creates a small pack and fixes a message, per the
   `qa/` practice; the guide is fixed where it misleads.
4. **Built-in packs:** the seventeen non-English languages of §4, drafted by an agent per D14,
   checked with `npm run i18n:check`, Ukrainian reviewed by the user. Drafted by following the
   agent guide, which tests it at scale. The same languages are drafted for the bundled and
   catalog boards' packs (EPIC-126 F7).
5. **Installer languages:** `electron-builder.yml` `nsis` gets `multiLanguageInstaller` and the
   matching `installerLanguages`.

## 6. Out of scope

- Translating guides, What's New, `$help` and MCP text (D3).
- Right-to-left languages (D13).
- A manual translation editor (D17).
- Writing a board's packs into the user's data folder: board packs belong to the board's author and
  would be overwritten by the next board update. A user who wants another language for a board
  contributes it to the board.
- Monaco widget text for languages Monaco does not ship (D9).

## 7. Risks

- **Silent identity breaks.** Any comparison against displayed text that Phase 1 misses breaks only
  in non-English languages. Mitigation: Phase 1 greps for `=== "` against labels across
  `src/renderer`, and every Phase 2 task re-checks its area under `en-XA`, where a label-based
  comparison fails visibly.
- **Translation quality.** Machine drafts of UI strings without context produce wrong senses
  ("Open" as an adjective). Translator notes on ambiguous keys (D1) and speaker review mitigate it;
  fixing a string is one request to an agent.
- **Size.** About 2,000 strings across ~400 files. The lint rule and `en-XA` keep the extraction
  measurable, and each Phase 2 task is independent.
- **Bundle size.** Built-in packs are JSON in `assets/languages/` loaded only for the active
  language; English stays in the bundle.
