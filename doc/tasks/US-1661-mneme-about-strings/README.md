# US-1661: Mneme editors and About strings

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implemented; live verification pending

## Implementation checklist

- [x] Add and register 122 typed messages (`mneme`: 102, `about`: 20).
- [x] Extract scoped app-owned UI copy, including audited helper arguments, plurals, and messages with data placeholders.
- [x] Preserve English identities, agent-facing text, thrown errors, product/data values, stable IDs, and guide corpus text.
- [x] `npx eslint src/renderer/editors/mneme-config src/renderer/editors/mneme-root src/renderer/editors/about`: zero `vanilla-view/no-hardcoded-ui-strings` findings.
- [x] Run `npm run lint`, `npm run typecheck`, and `npm run build-prod`.
- [ ] Open About, Mneme Config, and Mneme Root under `en-XA`; live app/MCP access is unavailable in this workspace. Follow the live-check list below.
- [ ] Run `npm run i18n:check`; the user will run this outside the sandbox.

## Goal

Extract app-owned UI copy from `src/renderer/editors/mneme-config/`, `mneme-root/`, and `about/` into the typed English `mneme` and `about` catalogs. Preserve English product/data/agent surfaces, keep identities independent of translated labels, and verify all three screens under `en-XA`.

## Background

This task follows EPIC-125 decisions E1–E7 and the extraction conventions in [`doc/standards/localization.md`](../../standards/localization.md). `src/shared/i18n/t.ts` supports typed two-part catalog keys, lazy `t(key, params)`, `englishMessage(key)`, and `untranslated(text)` for deliberate English UI values. New area files are `src/shared/i18n/en/mneme.ts` and `about.ts`, registered in `src/shared/i18n/en/index.ts` (E4). Resolve `t()` while building or updating view props, never in module-level localized values.

The requested lint scan was run as:

```powershell
npx eslint src/renderer/editors/mneme-config src/renderer/editors/mneme-root src/renderer/editors/about -f json -o "$env:TEMP/us1661-eslint.json"
```

Filtering the JSON to `vanilla-view/no-hardcoded-ui-strings` found **86 reports in 11 files**. Counts below are rule reports, so repeated uses (for example, a control's initial and updated props) are listed separately.

| File | Reports | Exact lint findings (line: source text) |
|---|---:|---|
| `src/renderer/editors/about/AboutEditor.ts` | 2 | 15, 99: `About` |
| `src/renderer/editors/about/AboutGuideBrowserView.ts` | 6 | 231: `What's New`; 240: `View full What's New`; 253: `Resources:`; 286, 340: `Show agent guides`; 404: `No guides available.` |
| `src/renderer/editors/about/AboutGuidePageView.ts` | 4 | 119, 285: `Back`; 127, 293: `Open in tab` |
| `src/renderer/editors/about/AboutView.ts` | 9 | 155: `Persephone`; 156: `Version ${app.version || "..."}`; 197: `GitHub Repository`; 204: `Report Issue`; 297: `Checking for updates...`; 306: `New version ${releaseVersion} available!`; 316: `Download`; 329: `What's New`; 340: `You're up to date!` |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` | 23 | 51: `Mneme`; 166: `Mneme restarted`; 168: `Mneme failed to restart: ${status.error ?? "unknown error"}`; 171: `Restart failed: ${errMessage(err)}`; 221: `Mneme status failed: ${errMessage(err)}`; 268: `Add wiki root folder`; 277: `Add root`; 278: `Root name — must be unique; no spaces, '/', or '\\':`; 288: `Root name must not contain spaces, '/', or '\\'.`; 301: `Root added — indexing in background`; 303: `Add root failed: ${errMessage(err)}`; 319: `Root "${root}" removed`; 321: `Remove root failed: ${errMessage(err)}`; 357: `Reindex cancelled`; 360: `Reindex failed: ${errMessage(err)}`; 400: `Read filters failed: ${errMessage(err)}`; 421: `Filters applied — reindexing in background`; 423: `Apply filters failed: ${errMessage(err)}`; 441: `Model download started`; 443: `Model is up to date`; 446: `Model update failed: ${errMessage(err)}`; 510: `Index deleted`; 512: `Delete index failed: ${errMessage(err)}` |
| `src/renderer/editors/mneme-config/MnemeConfigView.ts` | 7 | 38: `Start Mneme`; 39: `Open Settings`; 41: `Mneme is not running` and `Mneme is disabled or not started.`; 65: `Open in MCP Inspector`; 66: `Open Mneme log`; 79: `Restart Mneme` |
| `src/renderer/editors/mneme-config/ModelPanel.ts` | 2 | 64: static `Cache: ` and `v` in model/cache metadata presentation |
| `src/renderer/editors/mneme-config/RootsPanel.ts` | 19 | 60, 94: `+ Add root`; 61, 96: `Reindex all`; 150: `Open in Explorer: ${folder}`; 162: `Filters`; 196: `Open in Explorer: ${root.folder}`; 241: `Cancel`; 246: `Remove`; 259: `stale: `; 260: `Delete`; 297: `add include glob (e.g. **/*.md)`; 298: `add ignore glob (e.g. drafts/**)`; 300: `Reset`; 301: `Apply & reindex`; 309, 313: `Add` |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | 1 | 99: `Mneme` |
| `src/renderer/editors/mneme-root/MnemeRootEditorView.ts` | 10 | 34–36: `Hybrid`, `Text`, `Vector`; 75: `Include tags`; 81: `Exclude tags`; 89: `Created from`; 94: `to`; 142, 151: `Add tag…`; 430: `Search` |
| `src/renderer/editors/mneme-root/MnemeTreeSecondaryView.ts` | 3 | 54: `Close`; 66, 220: `Wiki` |
| **Total** | **86** | |

### Rule blind spots verified in source

Also extract these app-owned strings/positions, which the 86-report count does not include:

- `src/renderer/editors/about/AboutView.ts`: `checkButtonProps()` switches between `Checking...` and `Check for Updates`; `versionRow()` receives `Electron`, `Node.js`, `Chromium`, and `Available boards` positionally. Keep the three runtime/product names English; translate `Available boards`. The update sentence is one message with `{version}`; `app.version` and release version are data. `Persephone` is a product name.
- `src/renderer/editors/about/AboutGuideBrowserView.ts`: `appendResourceButton(parent, name, label, onClick)` receives the labels `Repository`, `Issues`, `Boards catalogue`, and `MCP setup` positionally. Extract these as chrome; the labels already have stable names in the separate `name` argument. `projectReleaseNotes()` projects the English What's New guide and remains guide content.
- `src/renderer/editors/mneme-config/MnemeConfigView.ts`: the `textContent` status ternary includes `Connected`, `Connecting…`, and `Disconnected`.
- `src/renderer/editors/mneme-config/ModelPanel.ts`: `Cache: ${model.dir}` is UI framing; model name, precision, version, and directory are data.
- `src/renderer/editors/mneme-config/RootsPanel.ts`: `Hide filters` / `Filters`; `Indexing…` / `Reindex`; `${docCount} docs`; `index: ${model}-${precision} · v${schemaVer}`; the root-folder tooltip `Open in Explorer: {folder}`; `active` in the row status; and the progress phase/count display. Use a CLDR message for the docs count. Root/model names, folder paths, schema versions and progress counts are data. Map known service phase enums to localized status labels; preserve unknown server-supplied phase text as English data.
- `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts`: the `reindex()` success branch has `Reindexed "{root}"` / `Reindex complete`; the restart failure fallback includes `unknown error`. `removeRoot()` and `deleteIndex()` also pass confirmation title/body/action text through the local `confirm()` helper. Make each complete confirmation sentence one catalog message with `{root}`, `{model}`, and `{version}` placeholders.
- `src/renderer/editors/mneme-root/MnemeRootEditorView.ts`: `RootStatusView` renders `Searching…`; empty states select `Mneme`, `Connecting…`, `Type a query and press Enter`, or `No results`; the query placeholder is `Search {root}…`; the filter control can render `Filters ({count})`. Treat root as data and translate the complete placeholder/empty-state message. The search mode array has English labels paired with stable `value` strings `hybrid`, `text`, and `vector`.
- `src/renderer/editors/mneme-root/MnemeTreeSecondaryView.ts`: fallback states are `Connecting…` and `No content`; the sidebar action title is `Open Mneme search`.
- `src/renderer/editors/mneme-root/results-to-markdown.ts`: generated result Markdown includes the UI-owned metadata label `score`; translate that label in the rendered result text while preserving hit titles/snippets/tags, URI/path, score value, and Markdown links as data.

There are no count-based `n === 1 ? ... : ...` branches in the scoped source. The docs count is the count plural requiring CLDR categories. Keep the filter count as a numeric placeholder unless the final English wording introduces a grammatical plural.

## English text retained by decision

- **E3, thrown errors remain English:** `AboutView.ts` throws `About view received an invalid model.`; `AboutGuideBrowserView.ts` throws `The About guide page mount is not available before mount().`; `MnemeConfigView.ts` throws `Mneme config view received an invalid model.`; `MnemeRootEditorView.ts` throws `Mneme root view received an invalid model.` and `Mneme root toolbar has no editor model.`; `MnemeRootEditorModel.ts` throws `Invalid Mneme search mode ${JSON.stringify(mode)}; expected text, vector, or hybrid.`. Keep these strings unchanged. Translate a fixed UI wrapper around an error only when the app creates one; preserve `errMessage(err)`, service status errors, and search errors as English cause/data.
- **E5, product/protocol and technical names remain English:** `Persephone`, `Mneme`, `MCP`, `GitHub`, `Electron`, `Node.js`, and `Chromium`. Use `untranslated("Persephone")`, `untranslated("Mneme")`, `untranslated("GitHub")`, `untranslated("MCP")`, and markers for the runtime names when they occupy linted UI positions; translate surrounding words such as `Repository`, `setup`, or `Inspector`. Keep keyboard shortcut text if introduced unchanged.
- **E5/D3, data and board/guide-owned copy remain English:** root names and folder paths; file names and glob patterns (`*.md`, `drafts/**`); model names, precision, versions, schema numbers and download filenames; tags, query text, hit titles/snippets/scores, document hrefs, URLs, release version/body; guide-tree titles/summaries, guide Markdown, projected What's New content, and any board-owned text. Translate only app-authored labels and framing around these values.

## Identity and agent-facing text

The displayed labels below must not become identity. Preserve the existing IDs/values or split the dialog button identity from its translated label. No new menu item descriptors were found in these folders; where a scoped action is a menu item in a shared component, its shared menu ID remains its identity under D4.

| Source / surface | Identity or agent-facing value | Handling |
|---|---|---|
| `src/renderer/editors/about/AboutEditor.ts`, `src/renderer/ui/tabs/page-title.ts`, and `src/renderer/scripting/api-wrapper/PageWrapper.ts` | The stored About page title `About` is persisted/page state and is returned as `page.title` to scripts; it is also visible in the tab. | Keep the stored/API value English with `englishMessage("editors.about")`; have `displayPageTitle()` translate only the tab presentation with `t("editors.about")`. `PageWrapper.title` and persisted state stay English. |
| `src/renderer/editors/register-editors.ts` → `about-view`, `mneme-config`, and `mneme-root` | The registry `name` is supplied to the About/Mneme facades and is agent-facing; `nameKey` supplies the editor-switch UI label. | Preserve the existing E2 split: registry `name` is materialized with `englishMessage(e.nameKey)`, while the UI resolves `nameKey` with `t()`. Keep `editors.about` and `editors.mneme` as the shared keys; no registry change is needed here. |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` → `removeRoot()` → private `confirm()` | `DialogButton.remove` (`"Remove"`) is passed as the dialog button ID and compared with the returned choice (`choice === confirmLabel`). | Preserve the current ID and comparison. `dialogButtonLabel()` already maps this built-in ID to `dialogs.buttonRemove`; translate the confirmation title/body separately. |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` → `deleteIndex()` → private `confirm()` | `DialogButton.delete` (`"Delete"`) is likewise the returned button ID compared by `choice === confirmLabel`. | Preserve the current ID and comparison. `dialogButtonLabel()` already maps this built-in ID to `dialogs.buttonDelete`; translate the confirmation title/body separately. |
| `src/renderer/editors/mneme-root/MnemeRootEditorView.ts` `MODE_ITEMS` and `src/renderer/scripting/api-wrapper/MnemeRootEditorFacade.ts` | `hybrid`, `text`, and `vector` are model/API values returned by `mode`, accepted by `setMode()`, and sent to Mneme. | Keep each `value` unchanged; translate the corresponding display `label` using `mneme` keys. The facade values stay English and need no translated display copy. |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts` / `MnemeConfigEditorView.ts`; `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | Editor IDs `mneme-config` and `mneme-root` are script/MCP identities. Initial page title `Mneme` is a product name; root editor `state.title` later becomes the root folder name and is persisted page state. | Keep editor IDs unchanged. Use `untranslated("Mneme")` for the product title; preserve a resolved root/folder title as data, not catalog copy. |
| `src/renderer/editors/about/AboutEditor.ts`, `AboutView.ts`, and `AboutGuideBrowserView.ts`; `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` | `ABOUT_PAGE_ID` / editor id `about-view`, guide `path`/URL, and named AI-visible elements identify the view/control independently of labels. Existing names: `about-root`, `about-content`, `about-card`, `about-check-updates`, `about-github`, `about-report-issue`, `about-update-download`, `about-update-whats-new`, `about-splitter`, `about-guide-browser`, `about-whats-new`, `about-whats-new-open`, `about-resources`, `about-resource-repository`, `about-resource-issues`, `about-resource-boards`, `about-resource-mcp-setup`, `about-show-agent-guides`, `about-guide-tree`, `about-guide-page`, `about-guide-breadcrumbs`, `about-guide-back`, `about-guide-open-in-tab`, and `about-guide-body`. | Preserve every name and guide path. The visible `Back` button already uses `name: "about-guide-back"` in both initial and updated props; translate its label only. AI-vision keeps reading stable names and English descriptions from `AboutEditorFacade.ts`. |
| `src/renderer/editors/mneme-config/MnemeConfigView.ts`, `RootsPanel.ts`, and Mneme config/root facades | Stable MCP-visible config controls: `mneme-start`, `mneme-open-settings`, `mneme-open-mcp-inspector`, `mneme-open-log`, `mneme-restart`, `mneme-add-root`, `mneme-reindex-all`, `mneme-update-model`. Dynamic root controls include `mneme-filters-{root}`, `mneme-cancel-{root}`, `mneme-reindex-{root}`, `mneme-remove-{root}`, `mneme-delidx-{root}-{modelId}-{schemaVer}`, `mneme-filters-reset-{root}`, `mneme-filters-apply-{root}`, `mneme-include-add-{root}`, `mneme-ignore-add-{root}`, `mneme-include-addbtn-{root}`, and `mneme-ignore-addbtn-{root}`. | Preserve every `data-name` and parameterized name. Agents locate controls by these names; never use localized visible labels as selectors. Facade purpose/signature prose remains English. |
| `src/renderer/editors/mneme-root/MnemeRootEditorView.ts` and `MnemeRootEditorFacade.ts` | Stable agent-visible controls: `mneme-search-input`, `mneme-search-mode`, `mneme-filters-toggle`, `mneme-search-run`, `mneme-filter-tags`, `mneme-filter-exclude-tags`, `mneme-filter-date-from`, `mneme-filter-date-to`, and `mneme-filters-clear`. | Preserve each name and its selector behavior. Translate adjacent labels only. |
| `src/renderer/editors/mneme-config/RootsPanel.ts`, `MnemeRootEditorModel.ts`, `MnemeTreeSecondaryView.ts` | Root names, root folder paths, globs, tags, model names/precision/version, document hrefs, and search results are data consumed by the UI and/or Mneme; root folder determines the root editor and navigation URL. | Preserve as values/URLs. Translate only app-owned framing around these values. |
| About guide tree/page rendering | Guide paths select the page; node title, summary, release notes, and guide body come from the shipped guide corpus. | Keep corpus text and guide-derived labels English per D3; localize About chrome, including resource controls, guide toggles, empty-state, page actions, and Back. |

No scoped UI string is read by `scripting/ai-vision/**` directly. The relevant adapters are the English `AboutEditorFacade.ts`, `MnemeConfigEditorFacade.ts`, and `MnemeRootEditorFacade.ts`; their names, summaries/help, editor IDs, values, and result payloads are agent-facing and remain English. The config/root facade element IDs already exist; do not rename them when translating adjacent labels.

## Implementation Plan

### 1. Add typed catalogs

- Add `src/shared/i18n/en/mneme.ts` and `src/shared/i18n/en/about.ts`, using `EnglishCatalogEntry` and translator notes where needed.
- Register both areas in `src/shared/i18n/en/index.ts`; retain the current two-part `<area>.<entry>` key shape.
- Check `common`, `shell`, `menus`, `dialogs`, `api`, and `explorer` first. Reuse exact shared actions such as `common.cancel`, `common.remove`, `dialogs.buttonAdd`, `menus.delete`, `menus.noResults`, `board.download`, `shell.search`, `shell.wiki`, and the existing About title key (`editors.about`) instead of duplicating them. Consider `api.actionFailed` only where its complete `{action}: {error}` message preserves the source meaning. Add context-specific keys to `mneme` or `about` when the message is not an exact semantic match; `common.open` is not an exact match for `Open in tab`.
- Use a CLDR object for `{count} doc` / `{count} docs`. Use whole messages with placeholders for version/update text, root and index confirmations, errors/status wrappers, folder tooltips, and search placeholders; do not concatenate sentence fragments.
- Use `untranslated("Persephone")`, `untranslated("Mneme")`, and deliberate technical/product names in visible English positions. Keep filesystem paths, model names, glob examples, tags, guide content, runtime causes, and service values as data. For any English identity value that also needs a catalog key, call `englishMessage(key)` on the agent side and `t(key)` in the UI.

### 2. Extract Mneme configuration and root search UI

- `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts`: extract notification wrappers, folder chooser/input-dialog copy, and remove/delete confirmation copy. Keep `errMessage(err)` and `status.error` as English error data inside translated wrappers. Keep `DialogButton.remove` / `.delete` IDs and comparisons unchanged; their existing `dialogButtonLabel()` mapping already localizes their visible labels.
- `src/renderer/editors/mneme-config/MnemeConfigView.ts`: translate stopped/running status, buttons, titles/tooltips, connection status, and empty-state copy. Keep Mneme as the product name and preserve all control names.
- `src/renderer/editors/mneme-config/ModelPanel.ts`: translate `Cache:` framing; keep model metadata, paths and downloaded filenames as data.
- `src/renderer/editors/mneme-config/RootsPanel.ts`: translate root actions, filter form labels/placeholders, known progress phases, status labels, tooltip prefixes and count/index framing. Keep root paths/names and include/ignore globs as data; preserve all existing stable control names. Resolve labels on each `sync()`/props build.
- `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts`: mark initial product title deliberately English. Keep per-root titles/path state and persisted state unchanged. Leave thrown validation errors English under E3.
- `src/renderer/editors/mneme-root/MnemeRootEditorView.ts`: translate filter/search controls, mode labels, connecting/empty/error framing and placeholders. Keep mode enum values stable and retain raw service/exception text as English error data.
- `src/renderer/editors/mneme-root/MnemeTreeSecondaryView.ts`: translate the sidebar title/action, close tooltip, and no-content/connecting state; keep root tag and tree-provider item text as data.
- `src/renderer/editors/mneme-root/results-to-markdown.ts`: translate the static `score` label in rendered result metadata only; preserve Markdown, URIs, paths and Mneme result fields.

Before:

```ts
{ value: "hybrid", label: "Hybrid" }
```

After:

```ts
{ value: "hybrid", label: t("mneme.modeHybrid") }
```

### 3. Extract About chrome and keep guides English

- `src/renderer/editors/about/AboutEditor.ts`: keep the persisted `About` title English via `englishMessage("editors.about")`; preserve `ABOUT_PAGE_ID`, guide location/history, and editor identity. Update `src/renderer/ui/tabs/page-title.ts` so `displayPageTitle("about-view", "About")` returns `t("editors.about")` for the tab presentation. Leave `PageWrapper.title` English for scripts.
- `src/renderer/editors/about/AboutView.ts`: translate update button/status, version sentence, resource links and `Available boards`. Mark `Persephone` deliberately English; keep Electron, Node.js, Chromium, versions, release notes, URLs, and GitHub as technical/product/data values. Keep the check/update element names stable.
- `src/renderer/editors/about/AboutGuideBrowserView.ts`: translate chrome, resource helper labels, agent guide toggle, and empty message. Keep resource `name` values stable and keep all guide-tree titles, summaries, What's New article copy, and markdown projection English per D3.
- `src/renderer/editors/about/AboutGuidePageView.ts`: translate `Back` and `Open in tab` at initial construction and updates. Preserve `about-guide-back` and guide path/breadcrumb navigation; breadcrumb labels derived from the corpus remain English.

Before:

```ts
name: "about-guide-back",
children: "Back",
```

After:

```ts
name: "about-guide-back",
children: t("about.back"),
```

### 4. Live-check the scoped surfaces under `en-XA`

- About: use MCP `script.execute` with `await app.pages.showAboutPage();` (also reachable from the shell About control and `F1`). Open a guide from the guide tree, verify the guide page chrome and `Back`, then return to contents. Exercise the update/status and resource-link labels where available. Read the screen through `about-view` elements/data-name IDs, not translated text.
- Mneme Config: use MCP `script.execute` with `await app.pages.showMnemeConfigPage();` (also reachable from Settings > Mneme or the Mneme shell indicator). Inspect stopped/connected states, status bar, roots, model, root filters, notifications, and add/remove/delete dialogs. For a root editor, click a root name in the Roots list; the row opens the root editor for that folder.
- Mneme Root: reach it by opening a root name from Mneme Config, or open a folder through the Mneme folder flow. Check mode selector labels, filters, empty/searching/results states, and the tree sidebar. Confirm `mode` still returns `hybrid`/`text`/`vector` through the MCP facade and all named controls remain addressable by their existing names.
- In each surface, inspect text nodes plus `title`, placeholder and accessibility attributes at normal and narrow widths. `en-XA` should expose pseudo-text for app-owned chrome while E5 data/product names, D3 guide text, paths, model values and raw English error causes remain intact. Check About's resizable panes and Mneme's root/filter/status layouts for clipping.

## Concerns

- The About page title is both displayed and returned through `page.title`. Keep its stored value English and translate only tab presentation in `page-title.ts`, following the stored/API identity pattern already used for Browser titles.
- The remove/delete confirmation action labels use existing built-in dialog button IDs and `dialogButtonLabel()` mappings. Preserve those IDs and `choice === confirmLabel` comparisons while translating the title and message.
- The About guide tree and What's New summary mix app-owned controls with shipped guide content. Keep only the page chrome in the catalogs; article text, summaries and guide-derived titles stay English under D3.
- Several displayed technical values resemble copy (model/path metadata, runtime names, glob patterns, tags, root names, MCP values). Keep them as data and translate only the fixed framing around them.
- This task changes only its README during investigation. Do not edit `doc/epics/EPIC-125.md` or `doc/active-work.md`; the task link is added by the user.

## Acceptance Criteria

- English catalog areas `mneme` and `about` are registered in `en/index.ts`, with only two-part keys and translator notes where context requires them.
- All app-owned UI copy in the scoped folders is translated lazily. The scoped lint rule reports zero findings, including the audited helper arguments, template strings, conditionals and array/map labels.
- Counts use CLDR plural objects; sentences with dynamic values use one message and placeholders.
- Every identity and agent-facing case in [Identity and agent-facing text](#identity-and-agent-facing-text) remains stable and separately represented from its translated display label.
- Mneme product names and technical/runtime/file/data values remain English where required. Thrown errors and all About guide corpus content remain English.
- About, Mneme Config and Mneme Root are checked live under `en-XA`; controls remain usable and no app-owned plain English remains in the scoped chrome.

## Files Changed

| File / area | Planned change |
|---|---|
| `src/shared/i18n/en/mneme.ts`, `about.ts`, `index.ts` | Add and register typed area catalogs. |
| `src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts`, `MnemeConfigView.ts`, `ModelPanel.ts`, `RootsPanel.ts` | Extract config, notification, dialog and root-list UI copy; preserve data/identities. |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts`, `MnemeRootEditorView.ts`, `MnemeTreeSecondaryView.ts`, `results-to-markdown.ts` | Extract root search/tree UI copy and rendered score label; preserve mode values and results data. |
| `src/renderer/editors/about/AboutEditor.ts`, `AboutView.ts`, `AboutGuideBrowserView.ts`, `AboutGuidePageView.ts` | Extract About chrome and guide navigation controls; keep guide corpus English. |
| `src/renderer/ui/tabs/page-title.ts` | Translate the About tab's display title while `page.title` and stored About state remain English. |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts`, `MnemeConfigEditorFacade.ts`, `MnemeRootEditorFacade.ts` | No changes; English agent-facing schemas, descriptions, names, IDs and values remain stable. |
| `src/renderer/editors/register-editors.ts`, `src/renderer/scripting/api-wrapper/PageWrapper.ts`, `src/renderer/ui/tabs/PageTabView.ts` | No changes expected; editor registry already provides English `name` with `nameKey` for localized presentation, PageWrapper keeps page title English, and the tab already calls `displayPageTitle()`. |
| `src/renderer/editors/mneme-config/mnemeTypes.ts`, `src/renderer/editors/mneme-root/index.ts`, `src/renderer/editors/about/index.ts`, co-located CSS | No changes expected; types/registration/style contain no app-owned copy requiring extraction. |
| `doc/epics/EPIC-125.md`, `doc/active-work.md` | No changes; the user will link this task document. |
| `doc/tasks/US-1661-mneme-about-strings/README.md` | Investigation findings and implementation plan (this document). |
