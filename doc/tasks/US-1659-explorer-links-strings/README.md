# US-1659: Explorer and link editor strings

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implemented; build-prod, live `en-XA`, and `i18n:check` pending

The task is already linked from EPIC-125 and the dashboard. Per the review correction, this implementation does not edit either linking file.

## Progress

- [x] Add and register the `explorer` and `links` catalogs; reuse existing shared catalog entries.
- [x] Extract lint-visible and manually audited app-owned UI copy; preserve thrown errors, logs, data, and agent/API contracts.
- [x] Add stable IDs to converted app-owned menu items and keep panel/editor/data IDs unchanged.
- [x] Run scoped ESLint, `npm run lint`, and `npm run typecheck`.
- [ ] Complete `npm run build-prod` (renderer config loading failed with sandbox `spawn EPERM` during Vite path resolution).
- [ ] Run `npm run i18n:check` (skipped as requested; user will run it).
- [ ] Open all listed Explorer, Clipboard, Link Editor, link-panel, and Browser Bookmarks screens under `en-XA` and check expansion/clipping.

## Goal

Extract app-owned visible copy in `src/renderer/editors/explorer/` and `src/renderer/editors/link-editor/` into the typed English catalogs `explorer` and `links`, then verify every reachable view under generated `en-XA`. Preserve data, persistence, panel/editor identity, menu IDs, and English agent-facing values.

## Background

US-1647 provides `t(key, params?)`, the typed two-part `<area>.<entryName>` catalogs, `{ message, note? }` entries, CLDR plural objects, and `untranslated()` / `englishMessage()` in `src/shared/i18n/t.ts`. The EPIC-125 decisions E1–E7 apply: use the widened scoped lint rule as the baseline (E1); split UI presentation from English agent identity (E2); leave thrown errors English (E3); use one flat area per task and reuse shared copy (E4); leave data, shortcuts, product/protocol names, and board-owned copy alone (E5); work serially across catalog registration (E6); and check lint, i18n/type/build, live `en-XA`, and MCP driving (E7).

The worked extraction in [US-1652](../US-1652-pilot-extraction/README.md) establishes the current patterns: resolve `t()` while rendering/updating, use placeholders for whole sentences, use CLDR objects for counts, preserve identity values, and distinguish app-authored UI from caller/data text. `doc/standards/localization.md` adds that helper arguments, `emptyText`/`emptyMessage`, and rendered data structures need a manual audit. Catalog keys are two-part only.

### Verified lint baseline

Ran the requested command from the repository root:

```powershell
npx eslint src/renderer/editors/explorer src/renderer/editors/link-editor -f json -o <tmp file>
```

Filtered JSON messages to `vanilla-view/no-hardcoded-ui-strings`: **116 reports across 15 files**. The following is the exact lint-visible copy, grouped by file; repeated occurrences are retained with their source line numbers. The extra manual-audit findings are recorded below.

| File | Lint-visible strings (line: source text) |
|---|---|
| `src/renderer/editors/explorer/BoardsSecondaryView.ts` | 73 `No boards under this folder.`; 94 `Create board`; 103 `Create Demo board`; 136 `Boards`; 198 `Close Panel`; 216 `Boards`; 217 `Tools`; 230 `Create Demo board`; 234 `New board`; 243 `Boards`; 304 `No registered tools under this folder.`; 341 `Board processes are running`; 373 `Create board`; 382 `Create Demo board`; 393 `Open in New Tab`; 398 `Copy board path`; 405 `Open board folder`; 410 `Delete Board`; 420 `Remove from Tools`; 428 `Removed from tools`. |
| `src/renderer/editors/explorer/ClipboardSecondaryView.ts` | 95 `Close Clipboard`; 106 `Clear`; 113 `Restart`; 118 `Unavailable`; 137 `Open Settings`; 166 `Clipboard`; 346 `Copy`; 387 `No clipboard history yet.`; 437 `Failed to open clipboard item: ${errMessage(error)}`; 460 `Remove`; 468 `The clipboard item payload is unavailable.`; 485 `Failed to open clipboard item: ${errMessage(error)}`; 495 `The clipboard item is no longer available.`; 500 `Failed to copy clipboard item: ${errMessage(error)}`; 508 `Remove clipboard item`; 509 `Remove this clipboard item? Its stored payload will be permanently deleted.`; 517 `Failed to remove clipboard item: ${errMessage(error)}`; 526 `Clear clipboard history`; 527 `Clear all clipboard history? Stored payload files will be permanently deleted.`; 535 `Failed to clear clipboard history: ${errMessage(error)}`; 626 `Clear`; 634 `Restart`; 650 `Clipboard`. |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | 52 `Explorer`. |
| `src/renderer/editors/explorer/ExplorerSecondaryView.ts` | 61 `Explorer`; 133 `Already at root`; 143 `Search`; 153 `Boards`; 163 `Collapse All`; 173 `Close Panel`; 193 `Clipboard`; 362 `Make Root`; 367 `Search in Folder`; 415 `Explorer`. |
| `src/renderer/editors/explorer/SearchSecondaryView.ts` | 105 `Close Search`. |
| `src/renderer/editors/link-editor/EditLinkDialogView.ts` | 40 `(auto-detect)`; 41 `Text Editor`; 42 `Browser`; 43 `Image Viewer`; 44 `Markdown Preview`; 45 `HTML Preview`; 46 `SVG Preview`; 47 `JSON Grid`; 48 `CSV Grid`; 135 `Discovered Images`; 243 and 377 `Link title...`; 251 and 385 `https://...`; 260 and 394 `Category path...`; 275 and 409 `Type + Enter to add`; 282 and 437 `https://... (optional)`; 314 `Cancel`; 320 `Save`; 361 `Clear Image URL`. |
| `src/renderer/editors/link-editor/LinkBody.ts` | 163 `Links`; 164 `No links yet`; 165 `Click \"Add Link\" to create your first link`; 171 `No links match the current filter`; 432 `Edit`; 438 `Copy URL`; 447 `Copy Image URL`; 453 `Open Image in New Tab`; 471 `Delete`. |
| `src/renderer/editors/link-editor/LinkEditor.ts` | 756 `The folder contains more than ${SCAN_LIMIT} files. Import all files?`; 757 `Import Folder`; 798 `Imported ${allLinks.length} links`; 872 `Are you sure you want to delete \"${label}\"?`; 873 `Delete Link`; 918 `Move ${count} link${count !== 1 ? "s" : ""} from \"${fromCategory}\" to \"${newCategory}\"?`; 919 `Move Category`. |
| `src/renderer/editors/link-editor/LinkTooltipView.ts` | 57 `Copy link as JSON`; 129 `+ tag (Enter)`. |
| `src/renderer/editors/link-editor/PinnedLinksPanelView.ts` | 246 `Pinned`; 358 `Edit`; 365 `Copy URL`; 374 `Copy Image URL`; 380 `Open Image in New Tab`; 391 `Unpin`; 397 `Delete`. |
| `src/renderer/editors/link-editor/index.ts` | 247 and 250 `Add Link`; 259 `View Mode`; 273 `Search...`; 282 `Clear search`. |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.ts` | 135 `Edit Link`. |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryView.ts` | 41 `Save`; 57 and 123 `Collections`. |
| `src/renderer/editors/link-editor/panels/LinkHostnamesSecondaryView.ts` | 34 and 54 `Hostnames`. |
| `src/renderer/editors/link-editor/panels/LinkTagsSecondaryView.ts` | 256 and 280 `Tags`. |

### Manual audit: positions the lint rule does not cover

Convert these app-owned visible strings too; they do not appear in the 116-report lint count:

- `src/renderer/editors/explorer/ExplorerSecondaryView.ts`: the path-dependent `Search [${fpBasename(searchFolder)}]` heading in `searchTitle()` and the `Up to ${fpBasename(parentPath)}` title. Each becomes one message with a `{folder}` placeholder. The helper defaults `Open Board` / `Open Toolset` passed into `openFolderLikeItem()` are also app-owned UI titles.
- `src/renderer/editors/explorer/BoardsSecondaryView.ts`: `More board options`; deletion/removal dialog titles `Delete board` / `Remove board`; the whole dynamic confirmation messages `Delete board "{name}"? This permanently removes its folder and all its files.` and `Board "{name}" no longer exists on disk. Remove it from the list?`; the fallback `Failed to delete the board folder.`. Reuse the exact existing `api.deleteBoardTitle`, `api.deleteBoardConfirmation`, and `api.failedToDeleteBoardFolder` entries for the matching on-disk delete case/fallback; add an `explorer` message for the different missing-on-disk removal sentence. `Demo` in `defaultName` is a board name/data, not UI copy.
- `src/renderer/editors/explorer/ClipboardSecondaryView.ts`: statuses and fallback copy assembled in `errorStatus()` / `statusText()` (`Failed to start clipboard monitoring: {error}`, `Failed to query clipboard status: {error}`, `Failed to start clipboard monitoring.`, `Failed to query clipboard status.`, `Failed to load clipboard history.`, `Failed to restart clipboard listener.`, `Clipboard history is disabled in Settings.`, `Clipboard listener is unavailable. No new items will be captured.`, `Clipboard listener is unavailable.`, `Disabled`, `Deaf`, `Error`). The dynamic error branch is one full message with `{error}`; error values themselves remain as supplied. `Image`, `Text`, and `HTML` are preview-kind labels; keep format/content-kind values (`HTML`) and clipboard payload text as data, and translate only app-owned display labels where they are not the format name.
- `src/renderer/editors/link-editor/EditLinkDialog.ts` and `EditLinkDialogView.ts`: default `Edit Link` / `Add Link`; `Preview`; dynamic alt text `Image {number}`; positional helper labels `Title`, `URL`, `Category`, `Target`, `Tags`, and `Image URL`. The target-editor option array (lines 40–48) is rendered later: localize its labels, but retain the values (`monaco`, `browser`, `image-view`, `md-view`, `html-view`, `svg-view`, `grid-json`, `grid-csv`, and empty auto-detect) as identity/data.
- `src/renderer/editors/link-editor/index.ts`: the module-level `VIEW_MODE_LABELS` map (`List`, `Landscape`, `Landscape (Large)`, `Portrait`, `Portrait (Large)`) is rendered later; localize by stable `LinkViewMode` value. Also translate the category/tag/hostname breadcrumb roots `Collections`, `Tags`, `Hostnames`, and `All` in `src/renderer/editors/link-editor/panels/LinkCategoryPanel.ts` / `LinkHostnamesNavigationPanel.ts`, leaving the empty root/filter sentinel unchanged. The `Show links` breadcrumb action is app-owned. `Search [query]` and search result/row counts in `LinksFooterView` use full messages and CLDR where a count changes the noun.
- `src/renderer/editors/link-editor/LinkBody.ts`, `LinkEditor.ts`, `LinksListView.ts`, `LinksTilesView.ts`, `PinnedLinksPanelView.ts`, and `LinkTooltipView.ts`: the conditional `Pin` / `Unpin` menu label; `Edit` / `Delete` icon-button titles; `Untitled` display fallback; import/move outcomes `Moved {count} link(s)`, `All items already exist in this collection`, `Imported {count} links`; and the delete/move/import confirmations. Keep each sentence whole. Use a CLDR object for imported/moved link counts and the `{count}` move confirmation, not English suffix concatenation. `Untitled` is an app fallback only when link data has no title; link title/href remain data.
- App-owned context menus not linted through `MenuItem.label`: `BoardsSecondaryView.ts` (`Create Demo board`, `Open in New Tab`, `Copy board path`, `Open board folder`, `Delete Board`, `Remove from Tools`); `ExplorerSecondaryView.ts` (`Make Root`, `Search in Folder`); `ClipboardSecondaryView.ts` (`Remove`); `LinkBody.ts` (`Edit`, `Copy URL`, `Copy Image URL`, `Open Image in New Tab`, `Pin` / `Unpin`, `Delete`); `PinnedLinksPanelView.ts` (same actions plus `Unpin`); and `LinkCategoryPanel.ts` (`Edit Link`). Convert labels and assign IDs as specified in Identity and agent-facing text. Custom items supplied by `onGetLinkMenuItems` remain caller-owned.
- `src/renderer/editors/link-editor/LinkTreeProvider.ts`: `Links` fallback `displayName` is a presentation default; the source file name is data. Preserve the editor's stable `link-view` kind. Link titles, URLs, image URLs, collection/category names, tags, hostnames, file names, board/toolset names, paths, and clipboard contents are user/application data and are never catalog-translated.

## Identity and agent-facing text

The search covered comparisons, state keys, storage, scripting/API return paths, `src/renderer/scripting/ai-vision/page-panels.ts`, panel declarations, and menu item definitions. These are the identity-bearing cases found and their required handling:

| Surface and verified code | Identity / agent contract | Handling during extraction |
|---|---|---|
| Explorer panel: `src/renderer/editors/explorer/ExplorerEditorModel.ts` (`editorId = "explorer"`, `secondaryView` IDs, `title: "Explorer"`); `src/renderer/editors/register-editors.ts`; `src/renderer/scripting/ai-vision/page-panels.ts` (`page.panels.explorer`, `label`) | Panel id `explorer`, owner/editor IDs, `page.panels.explorer.label`, and exposed copied item titles/paths are agent-facing. `ExplorerEditorModel.title` is state data, while the view supplies the visible title. | Keep the English registry `label` and current `labelKey: "shell.explorer"` for agent output. Render the header with `t("shell.explorer")`; do not translate `id`, `editorId`, `secondaryView`, root paths, item fields, or the model's English identity title. No AI-vision changes are needed if registry English remains unchanged. |
| Search / Boards / Clipboard panels: `src/renderer/editors/register-editors.ts`, `src/renderer/scripting/ai-vision/page-panels.ts`, `src/renderer/editors/explorer/{Search,Boards,Clipboard}SecondaryView.ts` | `search`, `boards`, and `clipboard` IDs are panel lookup keys; `page.panels.*` returns their English registry labels to agents. Boards/Tools state tab values are `"boards"` / `"tools"`. | Keep IDs, state values, registry `label` and `labelKey` English/stable; localize only rendered header, toggle, status and menu labels. The existing label/labelKey split is the E2 pattern. |
| Link collection panels: `src/renderer/editors/register-editors.ts`, `src/renderer/scripting/ai-vision/page-panels.ts`, `src/renderer/editors/link-editor/panels/{LinkCategory,LinkTags,LinkHostnames}SecondaryView.ts` | IDs `link-category`, `link-tags`, `link-hostnames`; registry labels `Categories`, `Tags`, `Hostnames` are returned through `page.panels.items[].label`. The category view's visible heading is `Collections`, not its agent label. | Keep each panel ID and registry English label/`labelKey` stable. Translate the rendered header separately (use a `links` key for `Collections`, existing `shell.tags` / `shell.hostnames` for matching headings). Do not feed translated labels into panel lookup. |
| Link editor and persisted collection data: `src/renderer/editors/register-editors.ts` (`link-view`); `src/renderer/editors/link-editor/LinkEditor.ts` (`displayName = "Link"`, persistent data state); `src/renderer/api/types/link-editor.d.ts`; `src/renderer/scripting/ai-vision` editor/page facades | Editor kind `link-view`, link `id`, `href`, `category`, `tags`, and stored titles are keys/values returned by editor/script APIs and shown as data. | Preserve the English `displayName`/editor kind and all stored and returned values. Translate only fixed UI fallbacks/actions; never rewrite a user title, URL, category, tag, or hostname. |
| Explorer/link menu actions: `src/renderer/core/events/context-menu.ts` (`MenuItem.id?`), `ExplorerSecondaryView.ts`, `BoardsSecondaryView.ts`, `ClipboardSecondaryView.ts`, `LinkBody.ts`, `PinnedLinksPanelView.ts`, `LinkCategoryPanel.ts` | Labels were the only stable click target for several app-owned items; E2/D4 requires agents to click the same action in any language. | Added IDs unique within each menu: `make-root`, `search-in-folder`; `create-demo-board`; `open-in-new-tab`, `copy-board-path`, `open-board-folder`, `delete-board`; `remove-from-tools`; `remove-clipboard-item`; `link-edit`, `link-copy-url`, `link-copy-image-url`, `link-open-image-in-new-tab`, `link-pin` / `link-unpin`, `link-delete`; `pinned-link-edit`, `pinned-link-copy-url`, `pinned-link-copy-image-url`, `pinned-link-open-image-in-new-tab`, `pinned-link-unpin`, `pinned-link-delete`; `edit-link`. Link view-mode menu items use their existing stable mode values as IDs. Labels translate; callback and disabled/selected/group behavior remain unchanged. Custom `onGetLinkMenuItems` labels are caller-owned. |
| View mode / target editor options and category root: `src/renderer/editors/link-editor/index.ts`, `EditLinkDialogView.ts`, `LinkCategoryPanel.ts`, `LinkHostnamesNavigationPanel.ts` | Mode values, target editor IDs, and the empty category/tag root sentinel are used to select/filter data. | Translate labels through value-to-key descriptors at render time; preserve values as shown above and preserve the empty sentinel. `Import All` stays English via `englishMessage("links.importAll")` because `app.ui.confirm()` accepts and returns one string per button, so its result identity cannot be separated from the displayed button label without changing the API. |
| Boards and tool names, `Demo`, item names, file paths, links, status error causes, and clipboard history payload | These are board-owned or user/application data, not stable UI labels. Some are returned by `page.panels.boards`, `page.panels.explorer.listItems()`, and link editor facades. | Keep English/data verbatim; do not localize names or agent/API payloads. Use `untranslated("...")` for fixed product/file names that must display literally in a UI position, and `englishMessage(key)` when a catalogued English identity must be materialized for the agent-facing consumer. |

Do not translate thrown `Error` messages under E3. Verified examples include `Explorer action unavailable: no provider is attached.`, `Explorer reveal unavailable: ...`, `Explorer tree is not mounted.`, `Search action unavailable: no page host attached.`, `Link view received an invalid model.`, `Link view received a different model instance.`, `Link not found: {href}`, and `Link category tree provider is unavailable.` Keep these error messages English; translate any fixed UI wrapper/fallback around a caught error.

## Implementation Plan

### 1. Add and register the two catalogs

- Add `src/shared/i18n/en/explorer.ts` and `src/shared/i18n/en/links.ts` using `EnglishCatalogEntry` from `common.ts`; register them in `src/shared/i18n/en/index.ts` and the derived merged catalog.
- Before adding a key, reuse exact matching entries: `common.ok`, `common.cancel`, `common.open`, `common.remove`, `common.loading`, and `common.items`; `shell.explorer`, `shell.boards`, `shell.tools`, `shell.clipboard`, `shell.search`, `shell.hostnames`, `shell.tags`, `shell.openQuickSettings`, `shell.copyBoardPath`, `shell.openBoardFolder`, `shell.openInNewTab`, `shell.removedFromTools`; `menus.searchPlaceholder`, `menus.clearSearch`, `menus.clear`, `menus.viewMode`, `menus.listView`, `menus.landscapeView`, `menus.landscapeLargeView`, `menus.portraitView`, `menus.portraitLargeView`, `menus.copy`, `menus.delete`, `menus.cut`, `menus.paste`, `menus.noResults`, `menus.noMatchingItems`, and existing folder/import errors where semantics match; `dialogs.buttonSave`, `dialogs.buttonCancel`, `dialogs.buttonDelete`, `dialogs.buttonRemove`, `dialogs.buttonCopy`, `dialogs.buttonCreate`; `api.deleteBoardTitle`, `api.deleteBoardConfirmation`, and `api.failedToDeleteBoardFolder` for the matching board case. Use `explorer` for Explorer/clipboard/boards-specific actions and states and `links` for collection/link-specific copy.
- Keep keys flat and resolve `t()` at view/update time. Module-level arrays such as view modes and target-editor options should hold keys/values and map to translated labels when props are built.

Before:

```ts
createFormRow("Title", titleView.root)
```

After:

```ts
createFormRow(t("links.titleLabel"), titleView.root)
```

### 2. Extract Explorer and clipboard UI

- In `src/renderer/editors/explorer/ExplorerEditorModel.ts`, keep `editorId`, state identity, and thrown errors English; do not translate the model identity title.
- In `ExplorerSecondaryView.ts`, `BoardsSecondaryView.ts`, `ClipboardSecondaryView.ts`, and `SearchSecondaryView.ts`, localize panel headers, accessible button titles, tab labels, empty states, status labels, actions, and app-owned notifications. Preserve names/paths and context menu target values.
- Use one placeholder message for each dynamic path/name/error sentence. Use a CLDR message for any count-based clipboard or board copy found during implementation. Keep runtime error causes verbatim; localize fixed fallbacks only.
- Preserve panel `name` attributes such as `explorer-up`, `explorer-search`, `boards-close`, `clipboard-close`, and `search-secondary-close` for AI-vision selectors in `src/renderer/scripting/ai-vision/page-panels.ts`.

### 3. Extract link editor UI and actions

- In `src/renderer/editors/link-editor/EditLinkDialog.ts` and `EditLinkDialogView.ts`, localize default title, form labels, option labels, placeholders, image alt text, and preview/clear actions. Keep caller-supplied dialog title and stored target values unchanged.
- In `src/renderer/editors/link-editor/index.ts`, translate view-mode labels at render time; retain `LinkViewMode` keys. Translate toolbar and breadcrumb actions and roots.
- In `LinkBody.ts`, `LinkEditor.ts`, `LinksListView.ts`, `LinksTilesView.ts`, `LinkTooltipView.ts`, `PinnedLinksPanelView.ts`, and `panels/LinkCategoryPanel.ts`, localize empty states, fallbacks, icon titles, tooltips, confirmations, menu labels, and notifications. Keep link content and custom menu items as supplied.
- Convert concatenated/imported/moved counts to CLDR objects; represent search/path/delete/move/import sentences as full messages with placeholders. Do not assemble English suffixes in code.
- Assign missing IDs to app-owned menu items as enumerated above. Keep comparison/result values, callback behavior, and all preexisting IDs unchanged.

Before:

```ts
`Move ${count} link${count !== 1 ? "s" : ""} from "${fromCategory}" to "${newCategory}"?`
```

After:

```ts
t("links.moveLinksConfirmation", { count, fromCategory, toCategory: newCategory })
```

The corresponding catalog entry must be a CLDR object, with `{count}` in each category.

### 4. Keep English-only UI positions explicit

- Use `untranslated("...")` from `src/shared/i18n/t.ts` for fixed product/protocol/file-format names that must remain literal while appearing in a UI position (`MCP`, `Persephone`, `HTML`, `JSON`, `CSV`, or a known filename/shortcut). Do not mark translatable app actions or user data with it.
- Use `englishMessage(key)` for English panel/identity values consumed by AI-vision or scripts when the UI has a translated catalog value. Existing secondary-view registrations already pair an English `label` with `labelKey`; preserve this split.
- Keep `Ctrl+Enter`, `Enter`, arrow-key names, URLs, file paths, HTML/JSON/CSV values, link/category/tag/hostname data, board-owned text and `Demo` board name in English/data form per E5. Where a literal in one of these positions is inspected by lint, wrap only the deliberate fixed literal with `untranslated()`.

### 5. Live `en-XA` route and acceptance

Use the project's Persephone MCP session and generated pseudo pack (select **Settings → General → Language → Pseudo-English**, then reload if required). Start with MCP `guides.screens` for shell/sidebar controls and `guides.editors` for the Link Editor guide (`editors/links`); use `ui.elements` and `window.screen.snapshot()` for live selectors and snapshots.

| Screen | Reach it live |
|---|---|
| Explorer panel and file filters | On a file/folder page, use the page toolbar `page-nav-panel` to open the sidebar; set/open a folder through `app.pages.openFile(folder)` or use `page.panels.explorer.openSearch(folder)` for Search. Drive panel through `page.panels.explorer`, `page.panels.search`; inspect root, filters, empty and populated states. |
| Boards panel / board actions | From a page with Explorer, call `page.panels.explorer.openBoards()` or click the `explorer-boards` header action. Inspect both Boards and Tools tabs; use a disposable board fixture for menu and confirmation paths, then cancel destructive prompts. |
| Clipboard history | Enable clipboard history in Settings (`clipboard.enabled`) and open the Explorer Clipboard header action, or open the dedicated Clipboard page/control. Exercise empty, populated, disabled and listener-error states; use disposable clipboard content. |
| Link collection editor | Via MCP `script.execute`, open a `.link.json` page with `await app.pages.addEditorPage("link-view", "json", "US-1659 fixture", JSON.stringify({ links: [...] }))` or `await app.pages.openLinks([...], "US-1659 fixture")`; view List and each tile mode, search/filter, context menus, and pinned items. Close the fixture after inspection. |
| Add/Edit link dialog | In the Link Editor fixture, click **Add Link** or the row's **Edit** action; use a disposable entry and cancel or remove it afterward. Inspect target options, image preview, and placeholders. |
| Collections / tags / hostnames secondary panels | In the Link Editor, click the corresponding category, tag, or hostname toolbar/header controls to open `page.panels.items` IDs `link-category`, `link-tags`, or `link-hostnames`; inspect populated and empty roots. |
| Browser bookmarks panel | Open Browser, then its Bookmarks panel/control; use an existing or disposable bookmarks file. Inspect the link collection list, edit flow, and bookmark context menu. This UI reuses link-editor views under the browser editor, so verify it separately from a standalone `link-view` page. |

For each route, capture the relevant rendered root with `window.screen.snapshot()` or a renderer-side text/attribute snapshot. Under `en-XA`, no app-authored plain English may remain outside E5/data. Verify menu actions by IDs rather than labels, and confirm `page.panels.*.label`, API state, persisted values, and returned item payloads remain English/stable. Then run the US-1653 scoped lint, `npm run i18n:check`, typecheck and build. No test or harness is added.

## Concerns

- `src/renderer/scripting/ai-vision/page-panels.ts` returns panel `label` and copied Explorer state to agents. Keep the registry's English `label` separate from its localized UI `labelKey`; do not translate either state or API payloads.
- App-owned `MenuItem` definitions have optional `id`; existing local menu items use labels only. Adding stable IDs is part of the same extraction, with IDs unique per menu. Custom items from editor/plugin callbacks remain caller-owned.
- `link-editor` is also used by Browser Bookmarks. Verify the shared view with both standalone link data and the Browser panel context; preserve bookmark paths and origin data.
- File names, board-owned text, product/protocol names, format names, keyboard shortcuts, paths/URLs, clipboard contents, and exception causes can look like UI text in snapshots. Classify those by their source and consumer before changing them.
- `en-XA` expands labels and dialog text by about 35%; inspect the narrow side panel, view-mode menu, long link titles, form rows, and confirmation button rows for clipping.

## Acceptance Criteria

- `explorer` and `links` are registered typed catalog areas using only two-part keys; matching existing `common`, `shell`, `menus`, `dialogs`, and `api` messages are reused.
- All 116 lint findings and the additional manual-audit UI strings are extracted; scoped `vanilla-view/no-hardcoded-ui-strings` reports zero for both folders.
- Dynamic sentences are whole placeholder messages; count-bearing messages use CLDR objects. No localized English fragments are concatenated.
- All app-owned translated menu labels have stable per-menu IDs. Panel/editor IDs, API results, lookup values and stored link/board/clipboard data remain unchanged.
- English agent-facing panel labels and API data remain English; visible headers and controls are pseudo-localized under `en-XA`.
- Explorer, Boards/Tools, Search, Clipboard, Link Editor modes/forms/list/tile/pinned views, all three link panels, and Browser Bookmarks are inspected live under `en-XA`; no app-owned plain English or clipped controls remain.
- `npm run i18n:check`, typecheck and build pass after implementation; no tests or harnesses are added.

### Files needing no changes

| File / area | Reason |
|---|---|
| `doc/epics/EPIC-125.md`, `doc/active-work.md` | User explicitly links the task document and requested these files remain untouched. |
| `src/renderer/scripting/ai-vision/page-panels.ts` | It already exposes panel IDs, stable `data-name` selectors, English labels, and copied model state; preserve this English agent contract. Change only if implementation proves the registry contract itself needs a key accessor. |
| `src/renderer/editors/register-editors.ts`, `src/renderer/ui/secondary-views/secondary-view-registry.ts` | Existing definitions already pair English `label` with `labelKey`; reuse the existing E2 split. |
| `src/renderer/api/types/page-panels.d.ts`, `src/renderer/api/types/link-editor.d.ts`, `src/renderer/api/types/io.tree.d.ts` | Script-visible contracts and data types stay stable. |
| `src/renderer/editors/board/**` board-owned views and board-provided names | Phase 3 / E5 board-owned copy is out of scope. Translate only host UI strings in the scoped Explorer view. |
| Test directories, test/harness infrastructure, generic UIKit components | Scope excludes tests/harnesses; change UIKit only if live acceptance proves a reusable clipping defect and it is separately scoped. |

## Files Changed

| File / area | Planned change |
|---|---|
| `doc/tasks/US-1659-explorer-links-strings/README.md` | Investigation record, verified lint inventory, identity boundary, implementation plan and live routes. |
| `src/shared/i18n/en/explorer.ts`, `src/shared/i18n/en/links.ts`, `src/shared/i18n/en/index.ts` | Add and register Explorer and link-editor catalogs. |
| `src/renderer/editors/explorer/BoardsSecondaryView.ts`, `ClipboardSecondaryView.ts`, `ExplorerEditorModel.ts`, `ExplorerSecondaryView.ts`, `SearchSecondaryView.ts` | Extract app-owned Explorer, Boards, clipboard and search panel UI; preserve IDs/data and English errors. |
| `src/renderer/editors/link-editor/EditLinkDialog.ts`, `EditLinkDialogView.ts`, `index.ts`, `LinkBody.ts`, `LinkEditor.ts` | Extract link forms, actions, view modes, empty states, confirmations and notifications. |
| `src/renderer/editors/link-editor/LinkTooltipView.ts`, `LinksListView.ts`, `LinksTilesView.ts`, `PinnedLinksPanelView.ts`, `LinkTreeProvider.ts`, `panels/LinkCategoryPanel.ts`, `LinkCategorySecondaryView.ts`, `LinkHostnamesNavigationPanel.ts`, `LinkHostnamesSecondaryView.ts`, `LinkTagsSecondaryView.ts` | Extract shared list/tile/pinned views, fallbacks, tree actions and secondary panel UI; preserve data values. |
| `src/renderer/editors/explorer/*.css`, `src/renderer/editors/link-editor/**/*.css` | Only if the live pseudo-locale walk demonstrates scoped layout clipping. |
