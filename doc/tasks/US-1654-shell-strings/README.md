# US-1654: App shell, tabs, sidebar, editor display names

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implemented; live en-XA inspection pending

## Goal

Extract app-owned visible copy from the application shell, page tabs, sidebar, Folder View empty state, and built-in editor display names into typed English catalogs. Preserve stable editor, panel, tool, setting, tab, and board identities and keep agent/MCP-facing editor names English.

## Background

EPIC-125 decisions E1–E7 apply. US-1653 widened `vanilla-view/no-hardcoded-ui-strings` to the relevant UI fields and the literal `name` properties in `src/renderer/editors/register-editors.ts`. This investigation ran ESLint over `src/renderer/ui/` (excluding `ui/dialogs/`) plus `src/renderer/editors/register-editors.ts` and `src/renderer/editors/category/`. It found **132 reports in 17 files**. Source review found **19 additional UI message occurrences** outside lint, then helper/array review found **14 more**, for **165 investigated occurrences**. The first 19 are 3 helper-mediated strings in 2 `ui/secondary-views/` files; 6 mixed UI/agent switch-option messages in `src/renderer/editors/base/editor-switch-options.ts`; 7 computed `title` messages in `src/renderer/ui/app/MainPageView.ts`; 2 encryption titles in `src/renderer/ui/tabs/PageTabView.ts`; and 1 `Folder` page-title fallback in `src/renderer/editors/category/CategoryEditorModel.ts`. The additional 14 are 5 quick-settings choice labels, 5 recording-button labels, two board-update labels, the Open Tabs window-section label, and the Open Folder dialog title passed through a helper. The MCP connection tooltip uses a CLDR plural. There are no reported strings under `ui/tabs` except the two tab view files. Secondary view labels and editor switch options also appear in AI-vision surfaces, so their English agent values must remain available.

Use a new `src/shared/i18n/en/shell.ts` catalog for app shell, tab, sidebar, secondary-panel registration labels, and Folder View messages. Use `src/shared/i18n/en/editors.ts` for editor display-name keys, registered in `src/shared/i18n/en/index.ts`. Catalog keys remain flat `<area>.<entryName>` keys. Resolve `t()` while building or updating view props, not in module-level translated constants. Reuse `common.cancel`, `common.open`, and `common.remove` where their ordinary meanings fit; `common.open` and `common.remove` were added after confirming the repeated menu actions share their meanings. `common.ok`, `common.loading`, and `common.items` remain available but do not fit additional messages in this scope.

### Lint inventory

The command included all of `src/renderer/ui/` except dialogs, then the editor registration and category folders:

```powershell
$lintJson = Join-Path $env:TEMP 'us1654-eslint.json'
npx eslint src/renderer/ui/app src/renderer/ui/tabs src/renderer/ui/sidebar src/renderer/ui --ignore-pattern 'src/renderer/ui/dialogs/**' src/renderer/editors/register-editors.ts src/renderer/editors/category -f json -o $lintJson
```

Filtering that JSON for `vanilla-view/no-hardcoded-ui-strings` produced 132 reports. They are grouped below by file; each quoted item is a distinct reported literal. Dynamic values in templates remain placeholders/data as described in the implementation plan.

| File | Reports | Reported text |
|---|---:|---|
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` | 4 | `MCP` (protocol/product name; keep English); `Mneme` (product name; keep English); `Clipboard listener`; `Record…` |
| `src/renderer/ui/app/MainPageView.ts` | 7 | `Snip failed: {error}`; `Application scripts need to be reloaded. Click to reload.`; `Open quick settings`; `Reset Zoom`; `Could not prepare recording: {error}`; `Could not finish recording: {error}`; `Could not start recording: {error}` |
| `src/renderer/ui/app/NativeEditorErrorView.ts` | 1 | `Editor crashed` |
| `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` | 1 | `Pin to menu` |
| `src/renderer/ui/sidebar/FolderItemView.ts` | 1 | `Open folder in new tab` |
| `src/renderer/ui/sidebar/MenuBarView.ts` | 17 | `Open File (Ctrl+O)`; `New Window (Ctrl+Shift+N)`; `About`; `Settings`; `Add a folder to the sidebar`; `Add Folder` (two occurrences); `Select Script Library Folder`; `Clear Recent Files`; `Change Library Folder`; `Open in Explorer`; `Unlink Library`; `Open in New Tab`; `Remove Folder`; `Show in File Explorer`; `Open Terminal here`; `Select Folder to Add` |
| `src/renderer/ui/sidebar/OpenTabsListView.ts` | 3 | `no tabs` (two occurrences); `window-{windowIndex}` |
| `src/renderer/ui/sidebar/PinnedRailView.ts` | 2 | `Pinned`; `Unpin` |
| `src/renderer/ui/sidebar/RecentFileListView.ts` | 4 | `Open`; `Open in New Window`; `Show in File Explorer`; `Remove from Recent` |
| `src/renderer/ui/sidebar/ScriptLibraryPanelView.ts` | 2 | `Select Folder`; `Select an existing folder with scripts or create a new one to store your saved scripts and reusable modules` |
| `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` | 4 | `Built-in Editors`; `Boards`; `Tools`; `Open in new tab` |
| `src/renderer/ui/sidebar/TrustedBoardsListView.ts` | 8 | `Removed from trusted boards`; `Update to v{latestVersion}` (label and title); `Copy board path`; `Open board folder`; `Remove`; `Update`; `No trusted boards yet` |
| `src/renderer/ui/sidebar/TrustedToolsListView.ts` | 3 | `Removed from tools`; `Remove`; `No registered tools yet` |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | 21 | `Open Folder`; `Open Folder in Explorer`; `Open File`; `Open URL`; `Clipboard`; `Script (JS)`; `Script (TS)`; `Grid (JSON)`; `Grid (CSV)`; `Notebook`; `Links`; `Browser`; `Browser (Incognito)`; `Browser (Tor)`; `MCP Inspector`; `Mneme`; `Storybook`; `Video Player`; `Browser ({profile.name})`; `Enable`; `Disable` |
| `src/renderer/ui/tabs/PageTabView.ts` | 7 | `Empty`; `Close Page`; `Close Tab`; `Close Other Tabs`; `Close Tabs to the Right`; `Open in New Window`; `Duplicate Tab` |
| `src/renderer/ui/tabs/PageTabsView.ts` | 3 | `Add Page (Ctrl+N)` (two occurrences); `Show All…` |
| `src/renderer/editors/category/CategoryEditor.ts` | 1 | `Please select a category in the Navigation Panel.` |
| `src/renderer/editors/register-editors.ts` | 43 | 14 secondary-view registration labels (`Archive`, `Explorer`, `Search`, `Boards`, `Clipboard`, `Categories` twice, `Tags` twice, `Git`, `File History`, `Wiki`, `Board View`) and 29 editor names listed in [Identity and agent-facing text](#identity-and-agent-facing-text) |

### Source audit beyond lint

- The scanned view code also builds dynamic display text: `Browser ({profile.name})`, `Update to v{update.latestVersion}`, and the `window-{windowIndex}` label. Translate the app-authored sentence/label as one message and pass dynamic names/version/index as parameters where that value is genuinely part of UI copy. A window identifier used for selectors or automation remains a stable ID and must not be translated.
- `src/renderer/ui/sidebar/tools-editors-registry.ts` stores creatable items with stable `id` values and labels later rendered in the sidebar, pinned rail, and tab-bar add menu. Translate the UI label through a key while preserving `id`, editor ID, browser profile ID, and action. Browser profile names and board names are runtime data.
- `src/renderer/editors/register-editors.ts` registers secondary view IDs with display labels. IDs (`archive-tree`, `explorer`, `search`, `boards`, `clipboard`, `link-category`, `link-tags`, `link-hostnames`, `notebook-categories`, `notebook-tags`, `git-changes`, `git-diff-revisions`, `mneme-tree`, and prefix `board-secondary:`) back panel state and lookup. Translate only label presentation; retain IDs and the board declaration's own panel title.
- The source scan found one count-based plural construction: `MainPageView.updateIndicators()` uses `count !== 1` for the MCP connection tooltip. Convert it to a CLDR category object and pass `params.count`. No other app-authored `n === 1 ? … : …` plural construction was found; the Folder View `count === 0` branch selects a folder/category target, not displayed plural copy.
- `MainPageView.ts` error notifications are whole sentences with runtime errors. Translate the fixed wrapper as a single message with `{error}` using `errMessage(error)` as the value. Do not translate the caught error itself. The same applies to any UI-owned wrapper around an exception in the scoped files.
- No `+` concatenation of app-authored sentence fragments was found in the scoped UI copy. Keep any additional sentence discovered during implementation as one parameterized message.
- Additional strings lint did not report, recorded from sidebar host code:

  | File | Occurrences | Handling |
  |---|---:|---|
  | `src/renderer/ui/secondary-views/SideBarPanelHeaderView.ts` | 1 | Fallback tooltip `Show in main view`; localize as a whole message, resolved when the header updates. |
  | `src/renderer/ui/secondary-views/LazySecondaryViewView.ts` | 2 | `Unknown secondary view: "{panelId}"` and `Failed to load "{panelId}".` fallback (two call sites); localize the UI wrapper and preserve the panel ID / caught cause as data. |
  | `src/renderer/ui/app/MainPageView.ts` | 7 | `MCP is active, {count} active connection(s) — click to view request log` (CLDR `one`/`other`); `MCP server is running — click to view request log`; three Mneme status tooltips (`Mneme active — vector memory ready. Click to manage.`, `Mneme is running without an embedding model — semantic search unavailable (text/grep fallback only). Click to fix in Mneme settings.`, `Mneme is enabled but not running. Click to manage.`); and `Restore` / `Maximize`. All are computed `title` assignments missed by lint. |
  | `src/renderer/ui/tabs/PageTabView.ts` | 2 | `Encrypt File` / `Decrypt File` title selected by encryption state; missed because the title is assigned through a ternary. |
  | `src/renderer/editors/category/CategoryEditorModel.ts` | 1 | `Folder` fallback assigned as the page title when a category link has no basename. |

- Preserve values rendered from files, paths, URLs, profile names, board manifests, tool manifests, page titles, and user content as data.
- `src/renderer/editors/base/editor-switch-options.ts` is the shared source for the page toolbar and `src/renderer/scripting/ai-vision/page-editor-switches.ts`. The dynamic app-authored messages to extract are `Board: {name}`, `Board: {name} (Default)`, `{name} (Default)`, `Install an editor for this folder`, and `Install an editor for this file type…`; the editor-name messages are already enumerated in the identity section. Keep board names in `{name}`. The toolbar renders localized keys; AI-vision `options` keep English labels. The `+` glyph and non-breaking-space padding are layout tokens, not copy.
- `MainPageView.updateIndicators()` assigns a computed tooltip that ESLint does not report: active MCP uses `count !== 1` concatenation and an inactive-server sentence. Use an active CLDR message object with `{count}` plus a separate complete inactive message; do not concatenate fragments. `MCP` remains the product/protocol name per E5.
- `MainPageView.updateIndicators()` also has three Mneme status tooltips and a `Restore` / `Maximize` window-control title ternary; translate the full messages and keep the `Mneme` product name. `PageTabView` has an encryption-state title ternary (`Encrypt File` / `Decrypt File`); catalog both visible actions.
- `CategoryEditorModel` falls back to page title `Folder` when it cannot derive the title from a category link. `PageWrapper.title` exposes page title to scripts/MCP while `PageModel.title` supplies tab/header display. Keep the English model value and introduce a separate display key for this app-authored fallback.
- `HeaderQuickSettingsPopover` builds visible choices from helper calls and an array: `Snip Screen`, `Snip Persephone`, `Full window`, `Active page`, and `Main editor area`. `MainPageView.recordingButton()` receives `Start`, `Cancel`, `Pause`, `Resume`, and `Stop`; these do not appear as literals at the DOM assignment. Keep `Snip`, `Persephone`, and recording cause values unchanged as required by E5.
- `TrustedBoardsListView` uses `Update to v{version}` in both the board context menu and the update tag title. `OpenTabsListView` uses `window-{windowIndex}` as the stable section value and a separate `Window {window}` UI label. The `Open Folder in Explorer` title passed into `fs.showFolderDialog()` is UI copy and is translated at invocation time.

## Identity and agent-facing text

### Runtime fields and consumer audit

Registry data stores catalog keys, and its English runtime field is computed with `englishMessage(key)`. Never call `t()` at module scope: editor rows, secondary-view registrations, and static creatable-item records are module-level data. Resolve UI text with `t(key)` at the render/update call site. The English runtime field remains available wherever scripts, MCP, persistence, or matching logic expects it.

The following consumers were checked by searching the repository for `EditorDefinition.name`, `SecondaryViewDefinition.label`, and `CreatableItem.label`:

| Source value | Consumer | Handling |
|---|---|---|
| `EditorDefinition.name` | `src/renderer/api/editors.ts` (`toEditorInfo`) and `src/renderer/scripting/api-wrapper/PageWrapper.ts` (`page.editor`) | Keep English for scripts/MCP. |
| `EditorDefinition.name` | `src/renderer/editors/base/editor-switch-options.ts` (`getFileOpenEditorOptions`, `getEditorSwitchOptions`) | Carry `labelKey` alongside English `label`; UI resolves the key. |
| Editor switch option | `src/renderer/editors/base/PageToolbarView.ts` (`syncSegments`) | Render with `t(labelKey)` / `t(titleKey)`. |
| Editor switch option | `src/renderer/scripting/ai-vision/page-editor-switches.ts` (`options`) | Project only English `id`, `label`, and `title`; do not expose catalog keys. |
| Editor switch option | `src/renderer/content/open-with-editor.ts` | Render editor choice keys with `t()`; menu framing remains owned by US-1655. |
| Editor switch option | `src/renderer/editors/notebook/note-editor/NoteItemToolbarView.ts` | Render built-in editor choices with `t(nameKey)`; data/board labels remain English. |
| Secondary-view `label` | `src/renderer/scripting/ai-vision/page-panels.ts` (`panelLabel`, `page.panels.items`) | Keep English for the agent-facing panel snapshot. |
| Secondary-view `label` | `src/renderer/ui/secondary-views/SecondaryViewsView.ts`, `LazySecondaryViewView.ts` | Search confirmed these use the registry for membership, icon, and loading, not to render `label`; header text comes from model/board titles. Any future UI consumer must call `t(labelKey)`. |
| Creatable-item `label` | `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` (row labels and sorting) | Render `t(labelKey)` for app-owned items; board manifest names remain data. Section identity uses a stable ID, not a translated label. |
| Creatable-item `label` | `src/renderer/ui/sidebar/PinnedRailView.ts` (`.item-label`) | Resolve `t(labelKey)` for app-owned items; board/profile names remain data. |
| Creatable-item `label` | `src/renderer/ui/tabs/PageTabsView.ts` (tab `+` menu) | Resolve `t(labelKey)` for app-owned items; board/profile names remain data. |
| Creatable-item `label` | `src/renderer/ui/sidebar/tools-editors-registry.ts` (creation/error callbacks) | Keep an English runtime label via `englishMessage()` for diagnostics; UI reads `labelKey`. |

These cases need stable identity separate from translated presentation. The English field remains available to scripts/MCP; the UI resolves the associated catalog key. Added 111 `shell` keys, 26 `editors` keys, and 2 reusable `common` keys (139 new catalog keys total).

| File / value | Why it is identity or agent-facing | Handling |
|---|---|---|
| `src/renderer/editors/register-editors.ts` — all 29 `EditorRow.name` values: `Text Editor`, `Grid (JSON)`, `Grid (CSV)`, `Grid (JSONL)`, `Log View`, `Preview` (Markdown/SVG/HTML), `Mermaid`, `Links`, `Notebook`, `Env Vars`, `Browser`, `Image Viewer`, `Archive`, `Video Player`, `Settings`, `About`, `Tools & Editors`, `MCP Inspector`, `Mneme` (config and root), `Storybook`, `Folder View`, `Git Tree`, `Boards`, `Agent Tool`, `Board Info`, and `Git Diff` | `src/renderer/api/editors.ts` projects `EditorDefinition.name` into `app.editors.list/get/resolve`; `src/renderer/scripting/api-wrapper/PageWrapper.ts` uses it to name `page.editor`, which scripts and MCP inspect. The API declares editor `id` as the stable editor identity. | Add a `nameKey` per row (area `editors`), preserve `name` in English, keep `id` and guide path unchanged. UI editor switch options, Open with menu choices, and built-in editor rows use `t(nameKey)`. API projections, editor facades, agent/MCP lists, and MCP hints keep the English `name`. Do not localize `mcpHint`. |
| `src/renderer/editors/register-editors.ts`, `src/renderer/ui/secondary-views/secondary-view-registry.ts`, and `src/renderer/scripting/ai-vision/page-panels.ts` `panelLabel()` — 14 secondary view labels | Registry IDs resolve/persist panel state. `panelLabel()` returns the registry label in each `page.panels.items` record, which is agent-facing; board panels return their declaration title. | Replace each registry string literal with `labelKey` plus `label: englishMessage(labelKey)`; `page.panels.items` continues to receive English. The current UI does not render the registry label; any UI consumer must resolve `t(labelKey)` at render time. Keep IDs/prefixes unchanged. The `board-secondary:` fallback and board declaration titles stay English under E5. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` — creatable item `id` and label pairs; `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` section identity | `id` values are used by pin storage, item lookup, drag/drop, page creation, and the `+` menu. `BuiltinEditorsListView` derives section row keys from labels for the synthetic `section-{label}` view key. | Introduce catalog key/display-label metadata while preserving every item `id` and action. Replace label-derived section keys with stable section IDs (`editors`, `boards`, `tools`) before translating section labels. Keep dynamic profile names and board/tool names as data. |
| `src/renderer/editors/base/editor-switch-options.ts`, `src/renderer/editors/base/PageToolbarView.ts`, and `src/renderer/scripting/ai-vision/page-editor-switches.ts` | `getEditorSwitchOptions()` explicitly feeds both the visible toolbar and the agent-facing `page.editorSwitches.options`; option `id` selects the editor, while `label` is returned to agents. | Keep `label` English in the shared projection and add a catalog key alongside it. `PageToolbarView.syncSegments()` renders `t(labelKey)` / `t(titleKey)`; the AI-vision node continues returning English `label` and `title`. Preserve candidate IDs and switch behavior. |
| `src/renderer/editors/base/editor-switch-options.ts` and `src/renderer/content/open-with-editor.ts` | `getFileOpenEditorOptions()` creates visible Open with menu rows from editor names and board names. Each choice's `id` drives `openWithEditor(path, id)`. | Carry the editor catalog key with the stable `id`; translate the row label in `createOpenWithMenuItem()`. Keep board names as data, localizing only app-authored framing. |
| `src/renderer/ui/sidebar/OpenTabsListView.ts` — `window-{windowIndex}` section value and label | `value` identifies the window group; the same text had also been visible as the section label. | Preserve the `window-{index}` value and use a whole-message `Window {window}` only for visible presentation. Never use translated text as a map key or tab/window ID. |
| `src/renderer/editors/category/CategoryEditorModel.ts` — fallback title `Folder` | The model title is rendered in page/tab chrome and `PageWrapper.title` returns it to scripts/MCP. | Preserve the English title for the agent/API projection and use the catalog display key in tab chrome only when the category link has no category. Folder paths, link categories, and derived folder names remain data. |
| `src/renderer/ui/tabs/PageTabView.ts` — empty page title `Empty`; `src/renderer/api/pages/PageModel.ts` and `src/renderer/scripting/api-wrapper/PageWrapper.ts` empty-page title | The tab chrome shows `Empty`, while the page model/wrapper return the English fallback to scripts and MCP. | Keep `PageModel.title` and `PageWrapper.title` returning `Empty`; localize only `PageTabView`'s empty-title presentation using a stable no-editor state, never a translated-text comparison. |

Other visible values in this scope are not identity: menu commands and tooltip copy are presentation, while shortcut spellings stay unchanged per E5. Keep file paths, URLs, document/tab titles, profile names, board-owned titles, tool names/descriptions, browser protocol names, and error causes as data or durable English. Stable selectors and element names (`data-name`, setting keys, editor IDs, panel IDs) remain unchanged.

## Implementation Plan

### 1. Register shell and editor catalogs

- Add `src/shared/i18n/en/shell.ts` and `src/shared/i18n/en/editors.ts`, using the `EnglishCatalogEntry` shape from `src/shared/i18n/en/common.ts`. Keep keys two-part and add translator notes for ambiguous short labels.
- Add both catalog exports to `src/shared/i18n/en/index.ts` and its merged `englishCatalog` typing.
- Reuse `common.cancel`, `common.open`, and `common.remove` where they fit; `common.open` and `common.remove` were added after confirming the repeated menu actions share their ordinary meanings. Check `common.ts` before adding repeated copy.
- Convert each lint inventory item and the helper-mediated labels found above. Resolve translations lazily while building props/rendering/updating views; do not cache translated values at module scope.
- Convert the four `MainPageView.ts` error wrappers to complete catalog sentences with `{error}` parameters. Preserve the runtime cause via `errMessage()` and keep thrown errors English per E3.

### 2. Split identity from presentation

- In `src/renderer/editors/register-editors.ts`, extend the registration row with a typed `nameKey` for each of the 29 editor names. Set `name: englishMessage(nameKey)` so the API and agent field remains English without a hardcoded UI literal. Keep `id`, `guidePath`, `mcpHint`, module importer, match behavior, and capability metadata intact. Do not call `t()` while module-level rows are initialized.
- Add the key to `EditorDefinition` in `src/renderer/editors/base/editorRegistry.ts` and update UI consumers that render editor definitions or creatable-item `label` to resolve the matching catalog key. Keep `src/renderer/api/editors.ts` and `PageWrapper.ts` returning the English name to API/scripts/MCP. The UI should not call the agent projection for its display string.
- In `src/renderer/editors/base/editor-switch-options.ts`, carry `labelKey`/`titleKey` with shared editor-switch options. `PageToolbarView.syncSegments()` uses `t()` for visible options; `src/renderer/scripting/ai-vision/page-editor-switches.ts` projects only its existing `{id, label, title}` fields with English values, so the internal keys do not leak into the MCP surface. Use whole-message keys for board/default wrappers and install titles, preserving board names and option IDs. In `src/renderer/content/open-with-editor.ts`, resolve the key for each Open with menu row.
- Extend the sidebar creatable metadata with catalog keys while preserving stable IDs and callbacks. Make section row keys in `BuiltinEditorsListView.ts` use explicit stable keys, not translated labels.
- Replace each secondary-view registry label literal with its shell-key English value from `englishMessage()` and store `labelKey` beside it; keep that English field for `page.panels.items`. Resolve `t(labelKey)` at UI render consumers (the current secondary view UI does not render this field). Do not call `t()` while module-level registrations initialize. Preserve all IDs, prefix resolution, stored `secondaryView`, and board-defined panel title behavior.
- In `src/renderer/ui/secondary-views/SideBarPanelHeaderView.ts` and `LazySecondaryViewView.ts`, localize the helper tooltip and fixed failure wrappers with `{panelId}` where applicable. Keep caught failure text and thrown errors English.
- Preserve `tools-editors-registry.ts` IDs, pin-setting entries, board/profile data and selector names. Never derive identity from a translated label.

Before, in `src/renderer/editors/register-editors.ts`:

```ts
{ id: "monaco", name: "Text Editor", ... }
```

After:

```ts
{ id: "monaco", nameKey: "editors.textEditor", name: englishMessage("editors.textEditor"), ... }
```

`EditorDefinition.name` remains the English API/agent value; `PageToolbarView.syncSegments()` uses the catalog key for visible text. In `src/renderer/editors/base/editor-switch-options.ts`, keep the English projection while carrying an internal key for the UI:

```ts
// Agent-facing record: { id, label: englishMessage(nameKey) }
// UI rendering in PageToolbarView.syncSegments(): t(option.labelKey)
```

### 3. Audit stable data, errors, and pseudo-locale layout

- In `src/renderer/ui/app/MainPageView.ts`, `HeaderQuickSettingsPopover.ts`, `NativeEditorErrorView.ts`, sidebar view files, tab view files, `tools-editors-registry.ts`, `src/renderer/editors/category/CategoryEditor.ts`, and `register-editors.ts`, distinguish app-authored UI copy from paths, user content, profile/board/tool names, technical values, shortcuts, and agent hints.
- Leave thrown error strings English (E3), including `Folder View action unavailable: invalid category breadcrumb.` in `src/renderer/editors/category/CategoryEditorModel.ts`, `Page is no longer attached.`, and `Editor switch to "{id}" did not complete. The release prompt may have been declined, or the page may have no file to rebuild over.` in `src/renderer/scripting/ai-vision/page-editor-switches.ts`, plus MCP diagnostics. Translate only user-facing wrappers authored by the UI. The caught cause displayed through `errMessage(error)` remains English data.
- Leave product/protocol names and shortcuts English per E5 (`Persephone`, `MCP`, `Git`, `Mneme`, `Snip`, `Ctrl+O`, `Ctrl+Shift+N`, `Ctrl+N`). Route standalone `MCP` and `Mneme` toggle labels through catalog keys with translator notes that the product names must remain exact in every pack. Board-owned titles/labels and manifest descriptions remain English and unmodified. Keep file paths, URLs, page titles, profile names, tool names, board names, and settings values as data. For labels that include a shortcut, localize the action and pass the shortcut as an unchanged `{shortcut}` value.
- Inspect the header/tab strip, menu bar, Tools & Editors rail, Recent Files/Open Tabs/Script Library views, Folder View empty state, quick settings, and editor selector under generated `en-XA`. Check tab widths, pinned rail, menu rows, popover controls, and longer error/empty-state copy at normal and narrow widths; record/fix any clipping in co-located UI CSS.
- Verify `en-XA` through the app live under MCP: call `script.execute` with UI actions, then snapshot visible text, button text, and placeholder/title/aria-label attributes for each applicable screen. Plain English is acceptable only for E5 data and preserved agent-facing fields.

### 4. Live entry points under en-XA

Start with MCP `path: "script.execute"` and the `guides.screens` guide tree; use the focused `guides.screens.header`, `guides.screens.menu-bar`, `guides.screens.sidebar`, and `guides.screens.tabs` guides for selectors and workflows. The UI guide and `assets/guides/tabs-and-navigation.md` document the live controls.

| Screen / surface | Live path |
|---|---|
| App shell, quick settings, page tabs | Already visible on startup. Open quick settings from the header snip/settings control; create a page with the tab-bar `+`; use the tab context menu for tab actions. MCP can create/open pages through `script.execute` (`app.pages.openFile(...)`) and inspect `app.pages` while the visible shell remains live. |
| Menu bar and app pages | Click `[data-name="persephone-menu"]`, then open About or Settings from the menu. MCP paths are `app.pages.showAboutPage()` and `app.pages.showSettingsPage()`; editor registration also carries the Settings MCP hint. |
| Sidebar: Open Tabs, Recent Files, Script Library, Tools & Editors | Click each menu-bar/sidebar entry. Use `app.window.openMenuBar()` to expose the sidebar when needed. Tools & Editors can open a full page through `app.pages.showToolsHubPage()`; the panel header's Open in new tab action reaches the hub. |
| Built-in editors and creatable item labels | Open Tools & Editors → Built-in Editors, then create/open each row; also open the tab bar `+` menu and Show All. MCP editor-list check: query `app.editors.list` and inspect `pages[i].editor.name`; these must remain English while the UI labels show pseudo-text. |
| Trusted boards/tools lists | Open Tools & Editors → Boards and Tools; use disposable local fixtures if needed. Board/tool names and manifest text are E5 data. |
| Folder View (`category-view`) | Open a local folder through the Explorer sidebar (or the Open Folder creatable item), then inspect its empty/category state. For the empty-state sentence, select a folder with no category selected. `app.pages`/`page.editor.id` should identify `category-view`; do not change editor identity. |
| Secondary panels | Open a folder in Explorer and expand its Explorer/Search/Boards/Clipboard panels; open a Git page for Git/History; open links/notebook pages for their category/tag panels; open a Mneme root for Wiki. Board secondary panels require a disposable board declaration and retain board-owned titles. |

Take `en-XA` snapshots for each screen reached above and verify no app-authored plain English remains in visible UI. Confirm the MCP editor list and `page.editor.name` stay English.

## Concerns

- `EditorDefinition.name` feeds user-visible UI and scripts/MCP. A global replacement of `name` with `t(...)` would silently alter API/facade output and violate E2.
- `BuiltinEditorsListView.ts` uses a rendered section label to build a row key; translating that label without changing the key source can destabilize the view. Introduce a fixed section key first.
- The `+` menu, pinned rail, sidebar, and Tools & Editors page share creatable labels. All must resolve the same catalog key while preserving their item IDs and pin persistence.
- Shortcut strings are included in UI labels but remain literal per E5. Keep the shortcut intact and localize only the surrounding words if the whole phrase is not a fixed shortcut label.
- Script Library folder paths, recent-file names, tab titles, board/tool names, profile names, version strings, and error causes can remain English because they are data. Review them separately from app-authored copy in snapshots.
- Secondary views have registry labels and board-provided titles. Translate host-owned labels, but keep board-provided declarations under E5.

## Acceptance Criteria

- `src/shared/i18n/en/shell.ts` and `editors.ts` are registered and all keys remain `<area>.<entryName>`.
- The scoped lint reports zero `vanilla-view/no-hardcoded-ui-strings` findings across the requested editor/UI scope.
- All 29 built-in editor names have UI catalog keys while `app.editors.list/get/resolve`, editor facade names, MCP hints, and agent-visible lists continue returning English names.
- Creatable item IDs, pin records, editor IDs, secondary-view IDs, tab/window IDs, selectors, return values, and persisted formats remain unchanged.
- Counts use CLDR plural objects where present; complete sentences use one message with placeholders. Errors, data, shortcuts, product/protocol names, and board-owned text follow E3/E5.
- The app shell, menu bar, tabs, sidebar panels, Tools & Editors surface, quick settings, and Folder View are inspected live under `en-XA`; no app-owned English remains and no translated labels clip at normal/narrow widths.
- `npm run i18n:check`, typecheck, build, and lint pass; MCP still controls and inspects pages by stable IDs. The user will run `npm run i18n:check`; local typecheck, build, and lint passed.

### Files needing no changes

| File / area | Why |
|---|---|
| `src/renderer/api/editors.ts`, `src/renderer/scripting/api-wrapper/PageWrapper.ts`, `src/renderer/scripting/ai-vision/page-panels.ts` | Keep their English API/facade projection intact; UI consumes catalog keys separately. |
| `src/renderer/api/types/editors.d.ts`, `src/renderer/api/types/page-editor-switches.d.ts` | Public editor IDs, English names, and the AI-vision switch-option record shape remain stable; no public API shape change is required. |
| `src/renderer/ui/sidebar/pinned-items.ts`, `src/renderer/ui/sidebar/pinned-drag-session.ts` | Persisted pin IDs and drag payloads are identity/data; only consumers' labels change. |
| `src/renderer/editors/category/FolderViewModeService.ts` | Folder-view mode behavior and paths are data; no localized UI strings were found there. `CategoryEditorModel.ts` needs the separate fallback display key described above. |
| `src/renderer/ui/dialogs/**` | Explicitly excluded from this task. |
| MCP guides, script API help, runtime logs, and app/MCP error text | Durable agent/developer surfaces remain English under D3/E3. |
| Tests and harness infrastructure | Acceptance uses existing lint/catalog/type/build checks and live MCP inspection; no test/harness additions are needed. |

## Acceptance / progress

- [x] Read project/task localization guidance and pilot extraction example.
- [x] Measure and record scoped lint findings and source-audit boundaries.
- [x] Extract catalogs and UI copy.
- [x] Verify scoped ESLint (0 `no-hardcoded-ui-strings` reports), full lint, typecheck, and production build. `npm run i18n:check` is deferred to the user as requested.
- [ ] Inspect all listed screens live under `en-XA`, including the English agent editor list.

## Files Changed and remaining review

| File / area | Result |
|---|---|
| `src/shared/i18n/en/shell.ts`, `editors.ts`, `common.ts`, `index.ts` | Added and registered 111 shell keys, 26 editor keys, and 2 common keys. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, `MainPageView.ts`, `NativeEditorErrorView.ts` | Localized quick settings, shell tooltips, error wrappers, and the crash-view heading; product names and error causes remain English data. |
| `src/renderer/ui/tabs/PageTabView.ts`, `PageTabsView.ts` | Localized tab titles, add-page controls, and context-menu labels without changing page IDs. |
| `src/renderer/ui/sidebar/BuiltinEditorsListView.ts`, `FolderItemView.ts`, `MenuBarView.ts`, `OpenTabsListView.ts`, `PinnedRailView.ts`, `RecentFileListView.ts`, `ScriptLibraryPanelView.ts`, `ToolsEditorsPanelView.ts`, `TrustedBoardsListView.ts`, `TrustedToolsListView.ts`, `tools-editors-registry.ts` | Localized menu bar, pinned rail, recent/open tabs, Script Library, Tools & Editors, trusted lists, and creatable labels; preserved stable item/section IDs. |
| `src/renderer/ui/secondary-views/SideBarPanelHeaderView.ts`, `LazySecondaryViewView.ts`; `src/renderer/editors/category/CategoryEditor.ts` | Localized the missed helper tooltip/failure wrappers and category empty-state message; caught causes and thrown errors remain English. |
| `src/renderer/ui/secondary-views/SideBarPanelHeaderView.ts`, `LazySecondaryViewView.ts` | Localize the helper tooltip and fixed UI error wrappers missed by lint; preserve panel IDs and causes. |
| `src/renderer/ui/secondary-views/secondary-view-registry.ts`, `src/renderer/editors/register-editors.ts`, `src/renderer/editors/base/editorRegistry.ts` | Added catalog keys and English runtime registry fields; preserved registry IDs. |
| `src/renderer/editors/base/editor-switch-options.ts`, `src/renderer/editors/base/PageToolbarView.ts`, `src/renderer/editors/notebook/note-editor/NoteItemToolbarView.ts`, `src/renderer/scripting/ai-vision/page-editor-switches.ts`, `src/renderer/content/open-with-editor.ts` | Split UI display keys from the English agent switch-option projection; kept public AI-vision option shape stable. Open with menu framing remains owned by US-1655. |
| `src/renderer/ui/app/MainPage.css`, `src/renderer/ui/tabs/PageTabs.css`, sidebar CSS | No CSS changes; pseudo-locale layout review remains pending with the live en-XA check. |
| `doc/tasks/US-1654-shell-strings/README.md` | Recorded consumer audit, implementation status, validation results, and live entry points. EPIC/dashboard task links were already present. |
