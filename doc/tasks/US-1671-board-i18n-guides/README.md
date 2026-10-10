# US-1671 — Board template and guides: making a board translatable, adding a language with an agent

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md#us-1671--board-template-and-guides)

## Goal

Make a Persephone-created blank board translatable from its first scaffold, and give board-authoring agents concise, source-accurate instructions for extracting UI text and adding a language pack. Keep the generic guides, board template, and optional `persephone-boards/how-to/` note aligned with the implemented bridge.

## Background

EPIC-126 F1–F9 defines the intended board-localization contract; roadmap decisions D10 and D17 define per-string fallback and agent-authored language packs. The completed plans US-1667–US-1670 provide implementation history, but the current runtime is authoritative. Verified behavior:

- `src/renderer/editors/board/board-manifest.ts` accepts `languages: { folder?, default? }`; normalization defaults to `folder: "lang"`, `default: "en"`, normalizes the default code with `Intl.getCanonicalLocales`, and rejects unsafe folders or malformed codes by omitting the declaration.
- `src/renderer/editors/board/board-i18n.ts` reads only the current code, its base code, and default pack from `<folder>/<code>.json`. A board without `languages` gets empty tables. Packs require a `messages` object; values may be strings or plural-category objects (`zero`, `one`, `two`, `few`, `many`, `other`). `source` is currently ignored. Ordinary translated entries are dropped with warnings for unknown default keys or placeholder mismatch; `manifest.*` entries are reserved plain strings without placeholders and bypass ordinary-key matching. Invalid shapes and malformed JSON are warned and ignored. Missing current/base packs are silent; a missing/unreadable default pack warns.
- `src/board-shim.ts` exposes frozen `persephone.locale = { code }`, `persephone.i18n.t(key, params)` and `has(key)`. Lookup is current table → base table → default table → key. Plural selection uses `Intl.PluralRules(locale)` (English rules if the locale constructor fails); `count` selects a category, otherwise `other`, then the message's `other` form. `{name}` placeholders are replaced from params; missing/null values remain as tokens. `has()` checks presence in any table. Language is fixed at registration; changing the app language reloads the window and boards register again.
- For `en-XA`, the loader pseudo-transforms the board default pack into the current table; `board-display-text.ts` pseudo-transforms English manifest values. The locale code remains `en-XA`. This is the extraction check for board-owned UI text.
- `manifest.*` display keys include `manifest.name`, `.description`, `.editorName`, `manifest.views.<id>.title`, `manifest.settings.<key>.label` / `.description`, and `manifest.capabilities.<id>.title`. They display in the Boards tree, Board Info, editor lists/Open with, secondary-view headings, settings, and the capability details in Board Info. Catalog name/description display is resolved from published catalog localization data.
- Pack and entry warnings are appended to the board `ui.log` after board load. Agents should inspect the board log as well as the rendered board.
- `BOARD_BRIDGE_VERSION` is `1.36.0`; `src/board-shim.ts` records that version's locale/i18n addition. A board using this API must declare `minBridgeVersion: "1.36.0"` so an older host will not install/register an incompatible board.
- `src/renderer/editors/board/board-scaffold.ts` calls recursive `copyDirInto()` on the selected asset template, copying every nested directory and file. Adding `assets/board-template/lang/en.json` therefore requires no scaffold code change.
- The blank template currently has visible starter copy in `index.html` and `app.js`, and its manifest minimum is `1.30.0`. It is not translatable as created. Keep agent-facing identifiers (including `.app` members, settings IDs/keys, message keys, and code identifiers) English; translate only user-visible copy.

The maintained prose/API reference is `assets/guides/agents/boards.md` and the generic per-board authoring guide is `assets/board-template/CLAUDE.md`. `src/renderer/editors/board/board-api.d.ts` is a legacy snapshot and is explicitly not a target.

## Implementation Plan

### 1. [x] `assets/guides/agents/boards.md`

Keep the existing front matter, headings, concise prose, and API examples. The current bridge-version/feature summary is at the top (lines 14–40); the board-development template inventory begins under `## Develop it` around line 386. Add a `### Languages` section immediately after the `## Develop it` starter inventory and before `### Give the board its secrets — env vars`. This makes localization discoverable beside the starter instructions without turning the API reference into a second implementation plan.

Replace the existing current-version sentence with `1.36.0`, add a one-sentence feature summary, and retain the existing 1.35.0 themes/text-toolbar explanations and their minimum requirements as historical feature versions. Draft current-version text:

> The board bridge is version **1.36.0** in this build. Check `persephone.version` before using a bridge member that may not exist in an older app. Bridge `1.36.0` adds registration-time `persephone.locale.code` and board-pack `persephone.i18n.t()` / `has()`; a board using these APIs must set `minBridgeVersion: "1.36.0"`.

Draft the new section text (adjust only links/formatting to fit the surrounding guide):

> ### Languages
>
> A board can declare its packs in `board-manifest.json`:
>
> ```json
> {
>   "minBridgeVersion": "1.36.0",
>   "languages": { "folder": "lang", "default": "en" }
> }
> ```
>
> Put one `<code>.json` file in that folder per language. Each file has a `messages` object; keys are stable English identifiers and values are strings or CLDR plural objects. `source` is an optional author/translation metadata object; the current runtime ignores it.
>
> ```json
> {
>   "messages": {
>     "title": "Welcome",
>     "items.count": { "one": "{count} item", "other": "{count} items" }
>   }
> }
> ```
>
> Call `persephone.i18n.t(key, params)` for user-visible text and `persephone.i18n.has(key)` to check whether any loaded pack contains a key. Use `{name}` placeholders and keep their names identical in every translation. For plural messages, provide the target locale's CLDR categories (including `other`) and pass a numeric `count`; do not assume every language uses only `one` and `other`. Keys and agent-facing names stay English.
>
> Lookup falls back per key: current locale → base locale → `languages.default` → the key itself. `persephone.locale.code` is the app locale, including a regional code such as `pt-BR` or `en-XA`. Registration loads the locale and packs once; there is no live board-language switch. When the app language changes, Persephone reloads the window and registers boards again. Pass `persephone.locale.code` to third-party libraries that accept a locale/language option.
>
> English manifest values stay in `board-manifest.json`; `manifest.*` keys are not needed in the default pack. Translated packs can add reserved `manifest.*` keys to localize manifest text without changing its English identity: `manifest.name` and `.description` show in board lists, Board Info and the published catalog; `.editorName` labels editor choices; `manifest.views.<id>.title` labels sidebar views; `manifest.settings.<key>.label` and `.description` label board settings; `manifest.capabilities.<id>.title` appears in Board Info. Use the stable view, setting, and capability IDs in these keys. These entries must be plain strings without placeholders.
>
> Persephone drops invalid pack entries and writes validation warnings to the board's `ui.log`. Check that log after opening the board. Open the board under `en-XA` to check extraction: board-pack strings and manifest display text become pseudo-text; any user-visible English literal that remains has not been extracted. Data and agent-facing names are not translated.
>
> **Add a language to an existing board.** Read `lang/en.json` (or the folder/default pack declared in the manifest) first. Create `lang/<code>.json` with the same message keys and translate every value; preserve every `{placeholder}` name and provide the target language's CLDR plural categories. Add translations for applicable `manifest.*` keys using the same IDs. Do not translate `.app` members, settings keys, or message keys. Open the board under the target app language, inspect its UI and `ui.log`, then check under `en-XA` for any remaining English UI text.
>
> **Make a board translatable.** Add `languages: { "folder": "lang", "default": "en" }`, set `minBridgeVersion: "1.36.0"`, and move user-visible strings into `lang/en.json`. Replace inline UI copy with `persephone.i18n.t(key, params)`; use stable English keys and preserve placeholders/plural forms. Add `manifest.*` entries for translated metadata. Keep agent-facing names such as `.app` members and settings keys in English. Check the result under `en-XA` and inspect `ui.log`.

Also edit the starter-file inventory under `## Develop it` so it lists `lang/en.json` and notes that the starter calls `t()`; describe `ui.log` as the place to inspect validation warnings. Keep the sample focused on the few strings a new author can read in a minute. Do not add a second full API table: the section above is the maintained reference.

### 2. [x] `assets/guides/agents/board-review.md`

Add localization review checks under **What to read**, after the manifest/language-pack inventory step, and make them concrete:

- If `languages` is declared, inspect every `<folder>/<code>.json` pack (including the default), confirm visible HTML/JS strings use `t()`, and flag user-visible hardcoded text in board UI. Do not flag stable English identifiers, data, or agent-facing names as UI copy.
- Compare each translated message's placeholders with the corresponding default message; inspect plural objects for the categories used by the target locale and a usable `other` form. Check the board `ui.log` for invalid/unknown/mismatched entries.
- If board code uses `persephone.locale` or `persephone.i18n`, require `minBridgeVersion: "1.36.0"`.

Add this brief draft after the current file-inventory instruction:

> If the manifest declares `languages`, read the default and translated packs too. Check user-visible UI for hardcoded strings that bypass `persephone.i18n.t()`, compare placeholder names against the default pack, and verify plural forms for each target locale. Stable English keys, settings IDs, and agent-facing `.app` names are not translation findings. A board that uses `persephone.locale` or `persephone.i18n` needs `minBridgeVersion: "1.36.0"`; inspect `ui.log` for pack-validation warnings.

Keep the themes check at `minBridgeVersion: "1.35.0"`: that remains the minimum for themes-only boards.

### 3. [x] `assets/guides/boards.md` (user-facing guide)

This guide documents board features and has the bridge overview at `## The board bridge — window.persephone` (around line 661); the current-version summary is around line 200 and the full bridge methods follow. Add only a short user-level note adjacent to that version summary, not the agent recipe:

> Boards that declare language packs can show their interface in Persephone's current language. Ask your AI agent to add a language to a board; changing the app language reloads open boards so they can use the new language.

Update the guide's current-version sentence to `1.36.0` and add the brief locale/i18n feature summary there. Leave the detailed authoring recipe in the agent guide. Do not edit historical API minima such as the themes bridge's `1.35.0` requirement or the plain-board save API's original 1.35.0 ship version.

### 4. [x] `assets/board-template/`

Make the generic starter demonstrate localization from its first scaffold:

- `board-manifest.json`: set `minBridgeVersion` to `"1.36.0"` and add `"languages": { "folder": "lang", "default": "en" }`. It is a blank starter with no bridge permissions enabled; the minimum is for its localization API use.
- Add `lang/en.json` with only the starter's visible title, description, button, output placeholder, and result messages.
- `app.js`: define a small `t(key, params)` wrapper around `persephone.i18n.t()` and render the starter title, instructions, button, output placeholder, and result text from keys. The example result uses a stable `messageKey`, matching the JSON response shape returned by `scripts/hello.js`; translate the key in the page. Keep DOM IDs and code identifiers in English.
- `index.html`: leave translated text slots empty or keyed for `app.js` to fill before use; include a nonlocalized fallback only if needed before the script runs. Keep script/style paths and board mechanics unchanged.
- `CLAUDE.md`: update the current bridge sentence and feature summary to 1.36.0, document the starter `languages` declaration and `lang/en.json`, show the `t()` pattern, explain `en-XA` and board-log validation warnings, and add the concise add-language / make-translatable guidance or point to the canonical agent guide. Keep historical 1.35.0 minima on themes, text toolbar controls, and page save handlers unchanged. The existing note says the generic file is rewritten after board-specific implementation; retain that workflow and the pointer to `persephone://guides/boards`.
- `scripts/hello.js`: keep console diagnostics English, but return a stable message key (for example, `messageKey: "starter.result"`) instead of a displayed English result sentence; `app.js` resolves that key through the pack.

Scaffold verification is source-backed: `scaffoldBoard()` calls recursive `copyDirInto()` for every template directory entry, so `lang/` and its JSON file are copied without changing `src/renderer/editors/board/board-scaffold.ts`.

Before → after examples:

```json
// Before: assets/board-template/board-manifest.json
{ "minBridgeVersion": "1.30.0" }

// After
{
  "minBridgeVersion": "1.36.0",
  "languages": { "folder": "lang", "default": "en" }
}
```

```js
// Before: app.js writes an English sentence directly
out.textContent = "Your board is running.";

// After: app.js resolves a stable message key through the board pack
out.textContent = persephone.i18n.t("starter.running");
```

### 5. [Skipped by user] `C:/projects/persephone-boards/how-to/` (read-only in this task)

The other repository has `how-to/README.md` and one current recipe, `how-to/open-image-in-drawing-editor.md`. The recipe documents a bridge call and no board UI strings, so do not add a localization paragraph to that individual recipe. Add a brief pointer to the index's authoring-reference paragraph so agents know the app guide covers board localization. Draft for the separate run to apply:

> For board UI languages, message format, and the agent workflow for adding a language, read `guides.agents.boards` over MCP or the `persephone://guides/boards` resource. The board bridge exposes `persephone.locale.code` and `persephone.i18n.t()`; a board using them requires `minBridgeVersion: "1.36.0"`.

No how-to file is edited in this repository/task; the above is a handoff text for the read-only catalog repo.

### 6. [x] Bridge version and feature-list sweep

Update current-version statements and add the 1.36.0 feature entry in these author/user guides:

| File and location | Planned edit |
|---|---|
| `assets/guides/agents/boards.md` top version/feature summary (around lines 14–40) | Current version `1.35.0` → `1.36.0`; add locale/i18n feature and minimum requirement. Keep the 1.35.0 themes/text-toolbar feature descriptions and minima. |
| `assets/guides/boards.md` bridge version summary (around lines 198–206) | Current version `1.35.0` → `1.36.0`; append locale/i18n feature, plus the short user-facing note. |
| `assets/board-template/CLAUDE.md` opening bridge summary (line 8) | Current version `1.35.0` → `1.36.0`; add locale/i18n feature summary and language reference. |
| `assets/guides/agents/board-review.md` theme permission review paragraph (around line 135) | Keep themes' `minBridgeVersion: "1.35.0"`; add a distinct rule that use of locale/i18n requires `1.36.0`. |
| `doc/architecture/overview.md` board-bridge feature history (around line 439) | Append the 1.36.0 registration-time locale and board-pack i18n addition to the existing versioned API history. |

`src/shared/board-bridge-version.ts` already contains `1.36.0`; `src/board-shim.ts` already lists the 1.36.0 locale/i18n addition; and `doc/architecture/key-files.md` already records the 1.36.0 feature. No edit is needed there. Other `1.35.0` occurrences in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, `doc/epics/completed.md`, and historical task/epic documents describe when themes, toolbar controls, or page-state APIs shipped or the minimum those APIs require; retain those historical references. `doc/architecture/overview.md` has a historical versioned feature list through 1.24.0 and should gain the new 1.36.0 entry. Do not fabricate a What's New release entry: `assets/guides/whats-new.md` has no current 1.35.0 bridge-version banner to replace.

## Concerns

- The task guide must document the implementation, including that `source` is currently ignored and that the runtime loads only three packs. Do not promise automatic source-hash validation, live locale updates, or unrestricted dynamic fallback.
- English manifest values stay in `board-manifest.json`, so the default pack does not need `manifest.*` keys. Translated packs can add `manifest.*` entries; these are plain strings, not placeholder/plural messages. Keep metadata identifiers stable and English; mention capability title despite its omission from the original F1 list because it is implemented and displayed.
- The default pack is the placeholder/plural reference. If it is absent or unreadable, the board log warns and untranslated lookup can return the key; the guide should tell agents to inspect `ui.log`.
- `en-XA` is a verification locale supplied by Persephone, not a board pack to create. Board data and agent-facing identifiers should remain stable and are not pseudo-localized.
- A board language is fixed for a registered frame. Explain that changing app language reloads the window; do not describe a live switching API.
- The scaffold's manifest name is rewritten when a board is created. The starter pack should localize sample UI strings without pretending its generic `manifest.name` is the created board's translated name. New board authors add appropriate `manifest.*` values as their own metadata is settled.
- The catalog repository is read-only for this task; the how-to addition is a separate-run handoff, not a local change.
- Do not change `doc/epics/EPIC-126.md`, `doc/active-work.md`, or the legacy `src/renderer/editors/board/board-api.d.ts`.

## Acceptance Criteria

- A new board scaffold includes a valid `languages` declaration, `lang/en.json`, and a visible `persephone.i18n.t()` use; the manifest minimum is `1.36.0`.
- `src/renderer/editors/board/board-scaffold.ts` is confirmed to copy the nested `lang/` directory recursively; no scaffold implementation change is needed.
- `assets/guides/agents/boards.md` contains source-accurate board-pack, locale, fallback, plural, placeholder, reserved metadata, validation log, reload, `en-XA`, third-party locale, and bridge-minimum guidance, with ready agent recipes for both workflows.
- `assets/guides/agents/board-review.md` checks hardcoded user-facing text when `languages` is declared, matching placeholders/plurals, board-log warnings, and the `1.36.0` minimum for locale/i18n use.
- `assets/guides/boards.md` has only a short end-user note and the current bridge version/feature summary.
- `assets/board-template/CLAUDE.md` reflects the current version and points agents to the language format/workflow without changing historical 1.35.0 minimums. The starter remains a minimal example a new author can read in a minute.
- The how-to handoff identifies `how-to/README.md` for the pointer and no individual recipe as needing localization guidance; it points to `guides.agents.boards` over MCP or `persephone://guides/boards`. The draft is included here for the separate read-only-repo run.
- All current-version statements/feature lists are updated, while accurate historical 1.35.0 feature ship versions/minima remain unchanged.
- No changes are made to `doc/epics/EPIC-126.md`, `doc/active-work.md`, or `src/renderer/editors/board/board-api.d.ts`; no commit is part of this task.

## Files That Need No Changes

`src/renderer/editors/board/board-scaffold.ts` (recursive directory copy already includes `lang/`); `src/renderer/editors/board/board-i18n.ts`, `board-display-text.ts`, `board-manifest.ts`, `src/board-shim.ts`, and `src/shared/board-bridge-version.ts` (runtime implementation is already present); `src/renderer/editors/board/board-api.d.ts` (legacy snapshot explicitly excluded); individual `C:/projects/persephone-boards/how-to/open-image-in-drawing-editor.md` (no UI text or localization-specific behavior); `assets/guides/whats-new.md` (no current-version banner); and `doc/epics/EPIC-126.md` / `doc/active-work.md` (explicitly excluded).

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1671-board-i18n-guides/README.md` | This implementation plan, including drafted guide copy and the read-only how-to handoff. |
| `assets/guides/agents/boards.md` | Update current bridge version, inventory the localized starter, and add the Languages API/recipe section. |
| `assets/guides/agents/board-review.md` | Add pack, hardcoded-copy, placeholder/plural, log, and bridge-minimum review checks. |
| `assets/guides/boards.md` | Update bridge overview and add a short user-level language note. |
| `assets/board-template/board-manifest.json` | Declare `languages`; set `minBridgeVersion` to `1.36.0`. |
| `assets/board-template/lang/en.json` | Add English sample UI messages. |
| `assets/board-template/app.js` | Render starter copy and sample response through `persephone.i18n.t()`. |
| `assets/board-template/index.html` | Provide translatable text slots for the starter script. |
| `assets/board-template/scripts/hello.js` | Return a stable result key for the starter UI while leaving backend diagnostics in English. |
| `assets/board-template/CLAUDE.md` | Update current bridge summary and document the translatable starter and concise author workflow. |
| `doc/architecture/overview.md` | Add the 1.36.0 locale/i18n bridge feature to the architecture's versioned API history. |
| `C:/projects/persephone-boards/how-to/README.md` (separate run; read-only here) | Add a pointer to the board Languages guide and `1.36.0` bridge requirement. |
