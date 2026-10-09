# EPIC-124: Localization foundation — interface languages, phase 1

## Status

**Status:** Active
**Created:** 2026-10-09
**Completed:** —

## Overview

Persephone's interface is English only, with about 2,000 literals written inline across ~400
files. This epic is phase 1 of the [localization roadmap](../localization-roadmap.md): it builds the
translation layer, the language setting and the conventions, moves identity off displayed text, and
proves the pattern end to end on the Settings page and the dialogs. Phases 2–4 (extract every
string, localize boards, language packs and the Language Editor board) become their own epics.

## Goals

- A `t(key, params)` runtime with typed keys, placeholders and CLDR plurals, shared by renderer and
  main, with no third-party library.
- No code path — confirmations, the script API, ai-vision — depends on the English text of a button
  or menu item.
- A `language` setting (`"auto"` follows the OS) with a Settings picker; changing it reloads the
  windows, and startup paints in the chosen language.
- Dates, numbers, relative times and byte sizes formatted through `Intl` with the active locale.
- Written conventions, a lint rule (warning mode) and `npm run i18n:check`, so Phase 2 can fan out
  by area.
- The Settings page and all dialogs fully translatable, verified under the `en-XA` pseudo-language.

## Decisions

All roadmap decisions D1–D15 ([§3](../localization-roadmap.md#3-decisions-accepted-2026-10-09)) were accepted
by the user on 2026-10-09, including the eighteen built-in languages (§4; Belarusian, Romanian, Slovak and Hungarian added
the same day), no Russian ever (D15), reload-on-switch (D5),
the English agent surface (D3) and agent-drafted translations with user review of Ukrainian (D14).
The ones this epic implements:

- **D1** English source catalog in TypeScript under `src/shared/i18n/en/<area>.ts`; the key type is
  derived from it.
- **D2** Own runtime: `{name}` placeholders, plural messages as `{ one, few, many, other }` objects
  chosen by `Intl.PluralRules`; concatenated sentences become one message.
- **D3** Agent-facing text stays English: `scripting/ai-vision/**`, `scripting/api-wrapper/**`,
  `src/main/mcp/**`, `api/mcp/*`, `api/types/*.d.ts`, `assets/guides/`, logs and thrown errors.
- **D4** Stable ids before translation. `IDialogResult.button` keeps returning the English button
  name in every language; a new `buttonLabel` carries the displayed text. ai-vision resolves menu
  items and buttons by id or displayed label.
- **D5–D7** Reload on switch, `"auto"` default via `app.getPreferredSystemLanguages()`, pack format
  `<code>.lang.json` with per-key `source` hashes; layering user pack → built-in pack → English.
  (Built-in packs other than `en-XA` arrive in phase 4; this epic only needs the loader.)
- **D8** One `core/utils/format.ts` over `Intl`; data dates (file names, logs) stay ISO.
- **D11** Local ESLint rule for literals in UI positions, warning mode in this epic.
- **D12** Hidden `en-XA` pseudo-language generated from English.
- **D16** Russian words in non-built-in packs are scrambled at load (roadmap D16).
- **D15** Russian is never supported: the shared pack validator rejects `ru` / `ru-*` codes and
  the names `Russian`, `Русский`, `Руский` (case-insensitive), for user and board packs alike.

## Current state (verified 2026-10-09)

- No i18n layer; no `Intl` use beyond one `toLocaleString` (`uikit/DataGrid/cell-tooltip.ts:113`).
- `ConfirmationDialog` (`ui/dialogs/ConfirmationDialog.ts`, default title typo "Confirmatioin")
  returns the clicked label; ~15 callers compare it to English (`tree-drop-actions.ts`,
  `item-crud-actions.ts`, `plural-actions.ts`, `os-clipboard.ts`, `BoardEditorModel.ts:644`,
  `api/board-install.ts:137`, `api/site-extension-management.ts:42`, …).
- `api/types/ui-log.d.ts:85` documents `button` as "the label of the clicked button".
- ai-vision: `scripting/ai-vision/menus/index.ts:83` matches `item.label === label`;
  `scripting/ai-vision/dialogs/*.ts` compare `button === "Cancel"`.
- Mixed UI/agent text: `editors/settings/settings-catalog.ts` (also read by
  `ai-vision/namespaces/settings.ts`), `editors/board/board-permission-copy.ts` (also read by
  `ai-vision/dialogs/trust-board.ts`, `BoardInfoEditorFacade.ts`).
- Settings: a setting is a key in the `AppSettingsKey` union (`api/settings.ts:26`), an optional
  `settingsComments` entry, a default in `defaultAppSettingsState`, a getter; sections live in
  `editors/settings/sections/`. Startup theme is read synchronously by `readStartupThemeId()`
  (`theme/themes/index.ts`) — the model for reading the language before first paint.
- Formatters: `core/utils/format-bytes.ts`, `formatDate` in `core/utils/utils.ts:38`, duplicates in
  `mneme-config/mnemeTypes.ts:140`, `browser/BrowserDownloadsPopup.ts:321`,
  `core/utils/html-resources.ts:134`, plus `git-tree/git-date.ts`, `explorer/clipboard-date.ts`,
  `log-view/LogEntryWrapper.ts`, `video/AudioControls.ts`.
- Main-process UI strings: tray menu (`src/main/tray-setup.ts`), unsaved-changes box
  (`src/main/browser-service.ts:422`).

## Linked Tasks

Task documents are written per task (investigation delegated to Codex, reviewed by Claude) when the
task starts.

| Task | Title | Status |
|------|-------|--------|
| [US-1647](../tasks/US-1647-i18n-core/README.md) | i18n core: catalogs, `t()`, plurals, pack loading and layering, `en-XA` | Implemented |
| [US-1648](../tasks/US-1648-stable-ui-ids/README.md) | Stable ids for dialog buttons and menu items; split mixed UI/agent text | Implemented |
| [US-1649](../tasks/US-1649-language-setting/README.md) | `language` setting, Settings picker, reload on switch, startup locale, main-process strings | Implemented |
| [US-1650](../tasks/US-1650-locale-formatting/README.md) | Locale-aware formatting through `Intl` (`core/utils/format.ts`) | Implemented |
| [US-1651](../tasks/US-1651-i18n-conventions/README.md) | Localization conventions doc, ESLint rule (warning), `npm run i18n:check` | Implemented |
| [US-1652](../tasks/US-1652-pilot-extraction/README.md) | Pilot extraction: Settings page and all dialogs, verified under `en-XA` | Implemented |

### US-1647 — i18n core

- `src/shared/i18n/`: `en/<area>.ts` catalogs merged into one typed English catalog; `MessageKey`
  derived from it; optional translator note per key.
- `t(key, params?)`: placeholder substitution, plural selection by `Intl.PluralRules(locale)`,
  missing key → English → the key itself (never throws).
- Pack model and validator (`<code>.lang.json`, D7): unknown keys and placeholder mismatches dropped
  with a warning; `source` hashes computed from English.
- Blocked-language rule (D15) in the shared validator: a pack with `code` `ru` / `ru-*`, or `name` /
  `englishName` equal (trimmed, case-insensitive) to `Russian`, `Русский` or `Руский`, is rejected
  as a whole with a clear message; exported for reuse by save, import, the bridge and board packs.
  `"auto"` never resolves to it.
- Russian-word scrambler (D16): normalize (`ё` → `е`, Latin look-alikes → Cyrillic), split into
  words, compare hashes against a deny-list, replace matches with `▒` characters; plus the letter
  rule — a pack where any message has one of `ы э ё` together with one of `и щ ъ` gets every
  `ъ ы э ё` scrambled in all its messages; applied once at
  load to every non-built-in pack (user packs now, board packs in phase 3). Ships with a small seed
  list of Russian-only UI words; the full list is built in phase 4.
- Loading: built-in packs from `assets/languages/`, user packs from `fs.resolveDataPath("languages")`
  following `api/custom-theme-storage.ts` (validated files, watcher); layering per key.
- Active locale resolved synchronously at startup (renderer and main) from the `language` setting.
- `en-XA` generated from the English catalog at runtime (accents + ~35% padding, brackets), hidden
  unless a developer setting enables it.
- **Acceptance:** a typo in a key fails `npm run typecheck`; `t` picks the right plural form for
  `uk`, `pl`, `lt`, `lv` counts (1, 2, 5, 11, 21, 22); a malformed user pack logs warnings and the
  app still starts; a user pack `ru.lang.json`, or one named `RUSSIAN` / `руский`, is rejected and
  never listed; a user pack under another name whose messages contain seed-list words shows those
  words scrambled, a pack with a message like `Открыть объект` has its `ъ ы э ё` scrambled
  everywhere, while the same check over Ukrainian and Belarusian sample strings scrambles
  nothing.

### US-1648 — Stable identity

- Dialog buttons carry ids; `ConfirmationDialog` and `ui.dialog.*` return the id as `button`
  (English name, unchanged for scripts) and the displayed text as `buttonLabel`; update
  `ui-log.d.ts` docs. All label comparisons in `src/renderer` move to ids (grep `=== "` against
  labels, not only the ~15 known sites).
- Menu items get an optional `id`; ai-vision menu and dialog resolution accepts id or label and its
  `$help` says so.
- Split `settings-catalog.ts` and `board-permission-copy.ts` so ai-vision keeps English text while
  the UI half can be translated.
- Fix the "Confirmatioin" default title.
- **Acceptance:** with every button label replaced by a test string (e.g. under `en-XA` once
  US-1652 lands), delete/overwrite/save confirmations, `ui.dialog.confirm` scripts and ai-vision
  dialog/menu clicks still work.

### US-1649 — Language setting and picker

- `language` setting (`"auto"` | BCP-47 code) in `api/settings.ts`; `"auto"` matches
  `app.getPreferredSystemLanguages()` exact → base → English.
- Settings section: languages by native and English name with completeness percentage; on change,
  every window reloads at once without a prompt (user decision 2026-10-10); pages are saved first.
- Main process reads the same setting for the tray menu and the unsaved-changes box.
- `app.settings.language` in the script API types; ai-vision settings namespace lists it.
- **Acceptance:** switching to `en-XA` and reloading shows the Settings page and dialogs in the
  pseudo-language from the first paint; `"auto"` on an OS set to an unsupported language gives
  English.

### US-1650 — Locale-aware formatting

- `core/utils/format.ts`: `formatDate`, `formatDateTime`, `formatTime`, `formatRelativeTime`,
  `formatNumber`, `formatBytes` (unit names localized) over `Intl`, active locale.
- Replace the duplicates listed in Current state; keep ISO where the value is data.
- **Acceptance:** the listed call sites use the shared helpers; German shows `1.234,5 KB`-style
  numbers and Ukrainian relative times use correct plural forms.

### US-1651 — Conventions, lint, check script

- `doc/standards/localization.md`: adding a string, key naming by area, placeholders, plurals, no
  concatenation, translator notes, what stays English (D3), `en-XA` verification.
- Local ESLint rule flagging literals in UI positions (`label`, `title`, `children`, `placeholder`,
  `textContent`, `createTextElement`, `ui.notify`) outside `src/shared/i18n/` and the agent-facing
  folders; warning level.
- `npm run i18n:check`: per pack, missing / stale (`source` hash) / invalid messages.
- Link the standard from `doc/agents-common.md` Documentation Map.
- **Acceptance:** `npm run lint` reports the remaining literals as warnings without failing;
  `i18n:check` runs on `en-XA` cleanly.

### US-1652 — Pilot extraction

- Settings page (`editors/settings/**`) and every dialog in `ui/dialogs/` converted to catalog keys.
- Fix any layout `en-XA` breaks in those screens.
- Update the conventions doc with anything the pilot taught.
- **Acceptance:** under `en-XA` no plain-English text remains on the Settings page or in any
  dialog; lint warnings for those folders are zero; agents still drive both through MCP.

## For the user to test (overnight run, 2026-10-10)

Implemented and checked live by Claude through MCP; these are the things worth a human look.

- **US-1649 — language picker.** Settings > General > Language: choosing a language reloads every
  window at once, with no prompt, and open pages (including unsaved edits) come back. Choose
  *Automatic* to return to English.
- **US-1650 — formatting.** With a language pack active, numbers, byte sizes and relative days follow
  that language (German `1.234,5`, Ukrainian `3 дні тому`, `1,2 МБ`). To try it without a real
  translation, drop a stub pack in `%APPDATA%\persephone\data\languages\`, e.g. `uk.lang.json`:
  `{"schemaVersion":1,"code":"uk","name":"Українська","englishName":"Ukrainian","messages":{}}`,
  then pick it in Settings. Where to look: the Explorer clipboard-history badges/tooltips
  (`-3д`, `3 дні тому`, `учора`), browser downloads popup sizes, Mneme config sizes, board-info
  service start time. Intentional: git and notebook dates stay `YYYY-MM-DD HH:mm`; in English the
  kilobyte unit is now `kB` (Intl's spelling) and a 1-day-old clipboard item says "yesterday".
- **US-1651.** `npm run lint` now prints ~1,100 `no-hardcoded-ui-strings` warnings (by design, warning
  level until phase 2); `npm run i18n:check` validates packs.
- **US-1652 — Settings and dialogs under `en-XA`.** In a dev build (`npm start`), pick
  *Pseudo-English* in Settings > General > Language; everything app-owned on the Settings page and
  in dialogs should read like `[šéţţíñĝš · · ·]`. Checked live by Claude: every Settings section,
  `app.ui.confirm` (default and custom buttons), `app.ui.input`, `app.ui.password`,
  `app.ui.textDialog`; agents still resolve buttons by their English ids. **Not opened live** (they
  need real workflows with side effects), please glance at them: Commit (Git Changes), Create
  Board, board env-vars storage, Script Library setup, Open URL, Namespace Collision, Register
  Toolset, Trust Board, Tor/Proxy info. Known leftovers outside the pilot scope: the uikit tree's
  `Collapse`/`Expand` aria-labels, browser-profile color names (`Dodger Blue`…), and board-supplied
  setting labels (board-owned, phase 3). Long section names in the Settings tree are ellipsized
  under `en-XA` — acceptable, but say if you want the tree wider. A script button whose label equals
  a built-in id (e.g. `"Delete"`) is shown translated; the returned id is unchanged.

## Notes

### 2026-10-09
- Epic created from phase 1 of the localization roadmap after the user accepted all its proposals.
