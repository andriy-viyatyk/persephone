# US-1652: Pilot extraction — Settings page and all dialogs, verified under en-XA

**Epic:** [EPIC-124 — Localization foundation](../../epics/EPIC-124.md) · **Status:** In Progress

## Goal

Extract app-owned, user-visible copy from src/renderer/editors/settings/** and every dialog and popper in src/renderer/ui/dialogs/** into typed English catalogs, then verify Settings and every dialog under generated en-XA. Keep stable IDs, script results, agent-facing data, and caller-owned text unchanged.

## Progress

- [x] Slice A, step 1: register the Settings and Dialogs catalog areas.
- [x] Slice A, step 2: extract Settings UI messages and preserve the AI-vision English catalog shape.
- [x] Slice B, step 3: extract dialog defaults, built-in button labels and popup actions; preserve caller-owned copy and IDs/results.
- [x] Slice B validation: `npm run typecheck`, `npm run lint`, scoped dialog ESLint, and `npm run build-prod` completed. The scoped dialog ESLint reported zero warnings.
- [ ] Catalog validation: `npm run i18n:check` could not start because esbuild's child process was denied with `spawn EPERM`.
- [ ] Live Settings verification under en-XA (performed by the user outside the sandbox).
- [ ] Live dialog and popup verification under en-XA (performed by the user outside the sandbox).

## Background

US-1647 supplies t(key, params?), typed two-part <area>.<entryName> keys, { message, note? } catalog entries, CLDR plural objects, and createPseudoLocalePack(). src/shared/i18n/en/index.ts currently merges common and main; src/shared/i18n/t.ts resolves keys at call time. doc/standards/localization.md confirms that roadmap's deeper examples are illustrative: the current catalog and runtime accept only two-part keys. Keep that contract. Add reviewable src/shared/i18n/en/settings.ts and dialogs.ts areas and register them in en/index.ts. Name entries semantically by section/component and role, such as settings.browserProfilesAdd and dialogs.confirmationDeleteLabel. Use distinct entries when translation context differs.

Extending keys and MessageKey to three segments would require changing catalog merge/type derivation, key splitting/resolution, message packs/validation/pseudo generation and all consumers. That adds compatibility and checker cost without value for this screen-sized extraction. Recommend staying with the existing two-part scheme; consider deeper paths only as a separate core change if later catalogs demonstrate a real navigation need.

**Render lazily.** Call t() as a view is created or updated, not in a module-level localized data constant. Locale loading is asynchronous at startup; eager t() can freeze the English fallback before packs are installed. Store message keys/descriptors in constants and resolve them from getter functions when props are built. Preserve module constants only for IDs, values, enums, names that are data, and message keys.

**D3 and identity boundaries.** settings-catalog.ts is shared by SettingsView and src/renderer/scripting/ai-vision/namespaces/settings.ts. Its key, id, elementName, panelName, where, row names and option values are settings lookup/navigation identity and must remain stable English. Its label and purpose become AI-vision descriptions. Split presentation from identity before translating: UI uses t(key), while agent-facing output uses englishMessage(theSameKey). Do not use a translated label as a settings key/search name. The same-key rule in doc/standards/localization.md applies to any other shared copy.

Dialog button IDs in src/renderer/ui/dialogs/dialog-buttons.ts stay English and unchanged; localize only the displayed label of built-in defaults. ui.dialog.* results exposed from src/renderer/editors/log-view keep returning their existing button ID and are out of this screen extraction. app.ui.confirm() likewise returns its stable English ID; object results expose displayed text separately as buttonLabel. Script-supplied button labels and custom titles/messages remain exactly as supplied. Trust Board / Namespace Collision / Open URL / Create Board return booleans, discriminants, paths or IDs; these are API/data values, not labels.

## Implementation Plan

### 1. Add catalogs and register them

- Add src/shared/i18n/en/settings.ts and dialogs.ts using the existing EnglishCatalogEntry type from en/common.ts; add translator notes where short labels are ambiguous.
- Add both areas to src/shared/i18n/en/index.ts and its derived EnglishCatalog, MessageKey, and MessageParams. Keep every key exactly two-part.
- Ensure existing pack validation and generated en-XA automatically see the new keys through englishCatalog. Do not add a checked-in pseudo pack or test harness.
- Do not edit US-1651-owned doc/standards/localization.md, eslint.config.mjs, package scripts or rule files while its parallel implementation is active. Once it lands, follow its conventions.
- Dynamic sentences become one message with placeholders; do not concatenate sentence fragments. Use CLDR objects for MCP client counts, installed/trusted site-extension counts, and any other count-bearing UI discovered. Pass params.count. Keep technical values (.env.json, SOCKS5, pwsh, paths, IDs, host/port) as placeholders/data.

Before:

    const clients = count ? ` — ${count} client${count !== 1 ? "s" : ""} connected` : "";

After:

    const clients = count ? t("settings.mcpConnectedClients", { count }) : "";

### 2. Extract Settings UI while preserving identity and dynamic data

- src/renderer/editors/settings/settings-catalog.ts: keep groupId/id, elementName, panelName, where and row key stable. Replace UI groupTitle/title/description and row label/purpose with message keys or getter descriptors. The AI-vision consumer materializes English with englishMessage() using the same keys. Keep settings search keys and navigation names English.
- SettingsView.ts and SettingsEditor.ts: localize page heading/title, section group/tree labels, footer View Settings File and app-owned failure fallback. Keep SETTINGS_PAGE_ID, editor ID and data-name/data-type selectors unchanged. Board-provided setting labels/options are board-owned and remain as supplied.
- sections/SettingsSections.ts: localize descriptions, checkboxes, select-option labels, browse/create/open/unlink controls, statuses, and chooser/read/reset errors. Keep select value strings such as default-browser, internal-browser, pwsh, and unknown terminal commands stable. Replace module-level LINK_ITEMS / terminal display strings with getters or key/value descriptors resolved while building props.
- sections/ClipboardSection.ts and ClipboardSectionModel.ts: extract checkbox, history limit label/placeholder, validation and status; stored values and setting names remain unchanged.
- sections/BoardSettingsSection.ts: localize app-owned Reset and error wrappers. Board declaration labels, options and IDs stay board data; keep declaration.id in identity/errors.
- sections/BrowserProfilesSection.ts and BrowserProfilesSectionModel.ts: extract fixed buttons, icon titles, placeholders, permission-menu action/empty state, confirmations and errors. Preserve profile names, origin, permission/decision values, paths, colors, tags and IDs. Make clear/delete sentence one placeholder message.
- sections/DefaultBrowserSection.ts: extract action/status labels passed through appendButton; preserve OS registration state and product names as data.
- sections/FileSearchSection.ts: extract visible labels, help and errors; extension/glob values remain user data.
- sections/LanguageSection.ts: extract Automatic (system language), Applies after reload, and load/apply fallback messages. pack.name, pack.englishName, Pseudo-English, language codes, completeness numbers and option values are pack data. Keep value "en" unchanged.
- sections/McpSection.ts and McpSectionModel.ts: extract Copy/Copy URL/Copied, service descriptions, status, errors and client count with CLDR. Preserve endpoint URLs, port values, MCP/Mneme identifiers and service data.
- sections/ProfileNetworkLineView.ts: extract Direct, SOCKS5 proxy, HTTP proxy, host/port placeholders and errors. Keep option values and numeric widths unchanged.
- sections/SiteExtensionsSection.ts: extract buttons, empty/problem/status/error copy and installed/trusted count messages with CLDR. Preserve folder path, extension names, grants and URLs.
- sections/ThemeSection.ts: extract Create/Edit/Delete labels, confirmations, accessibility labels and notifications. Theme names, IDs, colors and editor-provided errors remain data. Dynamic aria-labels become one placeholder message.
- SettingsSections.ts also owns Script Library, VLC/video, terminal and Board Environment Variables blocks: extract Browse/Create/Open Environment Variables/Unlink, chooser titles/filter labels, empty text, clear labels and failures. Keep extensions, commands and paths data.
- sections/settings-native.ts is a generic DOM/style helper. Do not translate arbitrary text(value), which may be a setting value; callers pass localized copy where the value is app-owned.
- Audit SettingsView.ts SECTION_VIEW_FACTORIES, SettingsSections.ts LINK_ITEMS and terminal options, ProfileNetworkLineView.ts options, LanguageSection.ts options, and all section/model files for module-level localized strings. Use getters/render-time mapping. Selector tree navigation must continue to use section IDs, never translated visible labels.

### 3. Extract dialogs and poppers; retain caller-owned text and API contracts

Every app-authored title, sentence, label, placeholder, built-in status/validation/error, accessibility label and default menu action is a catalog message. Resolve t() at view render/update time. Audit models as well as views: file-picker titles and validation often live in models. For every DialogButton default, preserve id/comparison/result and localize only label.

| Files | Extraction and boundary |
|---|---|
| src/renderer/ui/dialogs/dialog-buttons.ts | Add a catalog key mapping/getter for built-in IDs. Preserve ID strings. Unknown/caller strings normalize to id === label and are never translated. |
| ConfirmationDialog.ts / ConfirmationDialogView.ts | Extract built-in title/default labels and app-owned message callers. Do not translate arbitrary message props. Result ID remains unchanged. |
| InputDialog.ts / InputDialogView.ts | Extract built-in title/default button/field labels and app-owned validation; prompt and caller-supplied buttons remain caller text. Keep button ID and buttonLabel separate. |
| TextDialog.ts / TextDialogView.ts | Extract app-owned controls/defaults only. Caller title/body/custom buttons remain caller text; preserve text/result IDs. |
| CommitDialog.ts / CommitDialogView.ts | Extract default title, Branch/Author labels, branch/name/email/commit placeholders, buttons and action display label. Commit, Commit & Push and Cancel IDs/actions remain fixed. |
| CreateBoardDialog.ts / CreateBoardDialogView.ts | Extract default title, folder/name labels, placeholders, Browse/Create/Cancel, chooser title and Will be created at: {path}. Preserve caller title, input data and returned absolute path. Migrate caller titles only if done without changing API behavior. |
| CreateBoardVarsStorageDialog.ts / CreateBoardVarsStorageDialogView.ts | Extract path label/placeholder, Path caption, Browse/Create/Cancel and file-picker title. Preserve path, filters and boolean result. |
| LibrarySetupDialog.ts / LibrarySetupDialogView.ts | Extract default title, folder label/placeholder, Browse, Copy example scripts, reassurance, Link/Linking/Cancel, chooser title and whole error sentence with error placeholder. Preserve caller title, folder and copyExamples behavior. |
| OpenUrlDialog.ts / OpenUrlDialogView.ts | Extract placeholder, Open File/Cancel/Open. Keep URL/file result discriminant and entered path data. |
| PasswordDialog.ts / PasswordDialogView.ts | Extract Password/Confirm Password, Encrypt/Decrypt, Cancel, title and fixed empty/mismatch validation. Runtime error/message values are caller/service data. |
| NamespaceCollisionDialog.ts / NamespaceCollisionDialogView.ts | Extract title, explanation with {namespace}/{root} and Cancel/Register Anyway. Preserve namespace/root data and boolean result. |
| RegisterToolsetDialog.ts / RegisterToolsetDialogView.ts | Extract title, fixed caution, Cancel/Register toolset and list framing. Toolset/tool names, root and descriptions are agent/caller data; preserve boolean result. |
| TrustBoardDialog.ts / TrustBoardDialogView.ts | Extract fixed view-owned controls such as Only trust boards… and Trust Board/button labels. board-permission-copy.ts stays the single English source for disclosures and D3 agent output. Paths, names, capabilities, permissions, legacy warnings and true/false/"accept"/"unregister" return values stay unchanged. |
| TorInfoDialog.ts / TorInfoDialogView.ts | Extract titles, loading/reconnecting messages, labels, unknown/verification statuses, Reconnect/Close and location sentence with placeholders. Proxy label, IP/org/location/geolocation source, verdict, note/error remain data. Inspect the fixed 130px nonshrinking label columns. |
| poppers/showPopupMenu.ts | Extract built-in Paste/Copy/Inspect labels only. Caller MenuItem.label, callbacks, clipboard text, identity and disabled/visibility state stay as given. |
| poppers/grid-context-menu.ts | Inspect labels and defaults. Keep upstream grid action IDs; count-bearing Insert N links labels use one parameterized/plural message only if owned here. Never derive identity from translated labels. |
| poppers/Poppers.ts, PoppersView.ts, types.ts | Lifecycle/positioning; inspect for literals, translate only an actual app-owned visible default. |
| Dialogs.ts, DialogsView.ts, dialog-view-registry.ts, index.ts | Infrastructure and symbol identity; no localized strings expected. |

Other parameterized whole-message candidates verified in source: SettingsSections.ts last-window explanation, Git detected/not-found and chooser failures; McpSection.ts client count; BrowserProfilesSectionModel.ts delete/clear confirmations; SiteExtensionsSection.ts counts and empty/errors; ThemeSection.ts dynamic names/notifications; CreateBoardDialogView.ts creation path; NamespaceCollisionDialogView.ts collision message; TorInfoDialogView.ts status/location; LibrarySetupDialog.ts failure wrapper. errMessage(error) is runtime data: localize only a fixed wrapper/fallback and interpolate the original error. Do not translate arbitrary exception text.

### 4. Check lazy lookup, pseudo layout and live MCP control

- Audit module-level localized values: SettingsView.ts SECTION_VIEW_FACTORIES; SettingsSections.ts LINK_ITEMS/terminal options; ProfileNetworkLineView.ts static options; LanguageSection.ts choices; showPopupMenu.ts default menu state; DialogButton mappings. Keep keys/descriptors at module scope and call t() in a getter, constructor, or update callback after locale initialization.
- Inspect Settings under en-XA at normal and narrow widths. Risks in src/renderer/editors/settings/settings.css: [data-part="content-pane"] is nonshrinking/overflow-hidden; [data-type="settings-field-label"] has min-width 42px and no shrink; [data-type="settings-link"] and [data-type="settings-path"] ellipsize single lines; theme previews are fixed at 80px and the theme create tile at 160px. Also inspect 56px port inputs and each section's inline panels.
- Dialog risks: CreateBoardDialogView.ts and CreateBoardVarsStorageDialogView.ts width 520; CommitDialogView.ts width 520; PasswordDialogView.ts max-width 500; LibrarySetupDialogView.ts max-width 600; NamespaceCollisionDialogView.ts and TrustBoardDialogView.ts max-width 640; RegisterToolsetDialogView.ts max-width 680; TorInfoDialogView.ts max-width 620 with repeated 130px label columns; ConfirmationDialogView.ts and InputDialogView.ts max-width 800; OpenUrlDialogView.ts max-width 800. src/renderer/uikit/Dialog/Dialog.css truncates title with nowrap/ellipsis; uikit/Button/Button.css uses text-wrap: nowrap. Check button rows, labels, field captions and long titles at +35% expansion. Fix the narrowest relevant layout while preserving usable minimum widths.
- Live acceptance is Claude-driven through Persephone MCP with generated en-XA active. Start with MCP call (no path), inspect guides.screens and guides.screens.settings, and relevant dialog/tool $help. Open Settings with script.execute calling await app.pages.showSettingsPage(); visit all sections including Language, Browser Profiles, Site Extensions, Themes, MCP/Mneme and file pickers.
- Exercise app.ui.confirm(message, {title, buttons}), app.ui.input(...), app.ui.password(...), and app.ui.textDialog(...) for shared API dialogs. Exercise built-in dialogs through real controls/flows: Commit from Git Changes; Create Board from Boards/Explorer; environment storage, language/profile/theme settings, Script Library, Open URL/file, Namespace Collision, Register Toolset, Trust Board/permission change, and Tor/Proxy Info from browser toolbar. There is no generic public openDialog(id). Use disposable fixtures and cancel before destructive/external effects.
- For each Settings/dialog root, execute a renderer snapshot that gathers nonempty text nodes and placeholder/title/aria-label attributes, button text and custom option text. Use [data-type="settings-view"] for Settings and visible .dialog-shell for dialogs. Report strings without pseudo brackets/accented characters; review dynamic paths, IDs, URLs, names, user/script text, errors and D3 English disclosures separately rather than treating all English data as extraction failures. Any remaining app-owned plain English is a failure. This remains a live script.execute procedure, not a committed test/harness.

MCP call pattern:

    path: "script.execute"
    args: ["await app.pages.showSettingsPage();"]

### 5. Split delivery into buildable parts

The source scope is roughly 8,000 lines. Deliver ordered slices that independently typecheck/build and leave the app usable: A) catalog registration plus Settings; B) dialog buttons, dialogs and poppers; C) pseudo-layout fixes and full live MCP acceptance. Land catalog registration first. Re-scan each scope after every slice. Do not add tests or a custom harness.

## Concerns

- settings-catalog.ts feeds both Settings UI and AI-vision settings search/snapshot. Pair UI t(key) and agent englishMessage(key) with one shared key; keep identity/search values stable.
- Dialog button labels may change, but IDs, comparisons and API results cannot. Never translate ui.dialog.* results, caller-supplied buttons, titles or messages.
- Snapshot English can be dynamic data: paths, URLs, language/board/tool names, setting values, permission IDs, errors and user text. Review these separately from app-authored UI.
- Several dialogs require real workflows instead of a generic open method; record and exercise each entry point. Use disposable fixtures for workflows with side effects.
- en-XA grows text about 35%; test plural and parameterized forms as well as labels. Preserve technical values and D3 disclosure text.
- US-1651 is in progress concurrently. Do not edit its standard, ESLint configuration/rule or checker scripts; apply its conventions after it lands.

## Acceptance Criteria

- Typed English messages are registered in en/settings.ts and en/dialogs.ts, use only two-part keys, and appear in generated en-XA.
- All app-authored visible strings in the scoped folders use t() at render time; no localized message is evaluated at module load.
- Settings identity, keys, selectors and values stay stable. UI presentation is translated; AI-vision uses englishMessage() with the same keys.
- Dialog IDs, comparisons, result values and public contracts remain stable. Built-in visible labels use catalog messages; caller/script-supplied text is untouched.
- Dynamic sentences use placeholders and counts use CLDR plural objects; user, technical and agent data remain separate.
- Every Settings section, dialog and popup is inspected live under en-XA. Snapshot review finds no app-owned English; layouts have no clipped controls/labels/buttons at normal and narrow sizes.
- MCP agents can open and use Settings and dialogs through existing APIs/real controls after labels change.
- No unit tests or harnesses are added. After US-1651 lands, scoped lint warnings are zero and npm run i18n:check accepts the catalogs and pseudo pack.

### Files needing no changes

| File / area | Why |
|---|---|
| src/renderer/scripting/api-wrapper/UiFacade.ts, src/renderer/editors/log-view/**, src/renderer/api/types/ui-log.d.ts | D3/script-facing content and ui.dialog.* result contracts remain English and unchanged. Only the settings AI-vision consumer may change to call englishMessage() for shared catalog keys. |
| src/renderer/editors/board/board-permission-copy.ts and its agent consumers | US-1648 preserves this shared English source; fixed Trust Board view labels can be extracted independently. |
| src/renderer/ui/dialogs/Dialogs.ts, DialogsView.ts, dialog-view-registry.ts, index.ts | Hosting, symbols and result lifecycle contain no owned UI copy. |
| src/renderer/api/ui.ts and src/renderer/api/types/ui.d.ts | Existing public return contracts are stable; no API changes are needed. app.ui.* are live verification entry points. |
| src/renderer/ui/dialogs/poppers/types.ts, Poppers.ts, PoppersView.ts | Popper lifecycle/positioning only; no owned labels found. |
| src/renderer/ui/dialogs/poppers/grid-context-menu.ts | Grid IDs/labels are owned by upstream grid actions; do not duplicate/change identity absent a proven local literal. |
| src/renderer/uikit/Dialog/Dialog.css and uikit/Button/Button.css | Inspect for layout acceptance; generic UI-kit behavior is outside catalog ownership. Change only for a demonstrated reusable component defect. |
| src/renderer/api/settings.ts comments, setting schema keys/storage | Durable JSON comments and setting names/values are data/documentation and remain stable English. |
| Test directories and test/harness infrastructure | Task excludes tests and harnesses; acceptance is live MCP plus existing US-1651 tooling. |
| US-1651-owned doc/standards/localization.md, eslint.config.mjs, package scripts and rule files | Concurrent task; do not edit those files. |

## Files Changed

| File / area | Planned change |
|---|---|
| src/shared/i18n/en/settings.ts and dialogs.ts | Add scoped English entries and translator notes. |
| src/shared/i18n/en/index.ts | Register settings/dialogs areas in typed merged catalog. |
| src/renderer/editors/settings/settings-catalog.ts, SettingsView.ts, SettingsEditor.ts | Translate UI presentation at render time while preserving identities; expose English agent-facing copy by shared keys. |
| src/renderer/editors/settings/sections/SettingsSections.ts, ClipboardSection.ts, ClipboardSectionModel.ts, BoardSettingsSection.ts | Extract settings controls, descriptions, statuses, errors and chooser labels; keep setting IDs/values and board-owned labels. |
| src/renderer/editors/settings/sections/BrowserProfilesSection.ts, BrowserProfilesSectionModel.ts, DefaultBrowserSection.ts, FileSearchSection.ts | Extract browser/profile/file-search UI and parameterized confirmations. |
| src/renderer/editors/settings/sections/LanguageSection.ts, McpSection.ts, McpSectionModel.ts, ProfileNetworkLineView.ts | Extract language/service/network UI and plural counts; preserve pack/service data. |
| src/renderer/editors/settings/sections/SiteExtensionsSection.ts, ThemeSection.ts, settings-native.ts | Extract app-owned extension/theme strings; keep native helper generic. |
| src/renderer/editors/settings/settings.css and scoped settings view layout if needed | Correct pseudo-locale clipping at identified selectors. |
| src/renderer/ui/dialogs/dialog-buttons.ts | Map stable built-in IDs to translated labels, leaving caller labels unchanged. |
| src/renderer/ui/dialogs/ConfirmationDialog.ts and View, InputDialog.ts and View, TextDialog.ts and View | Translate app-owned defaults while preserving IDs, result shapes and caller text. |
| src/renderer/ui/dialogs/CommitDialog.ts and View, CreateBoardDialog.ts and View, CreateBoardVarsStorageDialog.ts and View | Extract commit/create dialog UI. |
| src/renderer/ui/dialogs/LibrarySetupDialog.ts and View, OpenUrlDialog.ts and View, PasswordDialog.ts and View | Extract library/open/password UI while retaining input/result data. |
| src/renderer/ui/dialogs/NamespaceCollisionDialog.ts and View, RegisterToolsetDialog.ts and View, TrustBoardDialog.ts and View | Extract fixed/parameterized copy; preserve agent/board data and stable return values. |
| src/renderer/ui/dialogs/TorInfoDialog.ts and View | Extract status labels and messages; fix fixed-column clipping if needed. |
| src/renderer/ui/dialogs/poppers/showPopupMenu.ts and grid-context-menu.ts | Localize owned popup defaults only; preserve supplied labels and IDs. |
| Scoped co-located dialog CSS, if present | Fix clipping from longer pseudo-localized labels. |
| doc/standards/localization.md | Add pilot lessons only after US-1651 lands and if uncovered; do not edit during its parallel implementation. |
| doc/active-work.md | Add linked US-1652 under EPIC-124. |
| doc/epics/EPIC-124.md | Link US-1652 task-table row. |
