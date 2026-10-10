# US-1658: Board host UI strings

**Epic:** [EPIC-125 — Extract every UI string, phase 2](../../epics/EPIC-125.md) · **Status:** Ready for live verification

## Goal

Extract Persephone-owned UI copy in `src/renderer/editors/board/`, `board-info/`, `env-vars/`, and `toolset/` into a typed `board` English catalog area. The shared permission-copy source serves both consent UI and agents: localize its UI presentation while retaining English agent exports through `englishMessage()`. Preserve board-provided copy, stable identities, script/MCP contracts, and verify each live screen under generated `en-XA`.

## Background

EPIC-125 decisions E1–E7 apply. The existing catalogs use flat `<area>.<entry>` keys, `t()` at render time, `{name}` placeholders, and CLDR objects for counts. Add `src/shared/i18n/en/board.ts` and register it in `src/shared/i18n/en/index.ts`. Reuse the existing `common`, `shell`, `menus`, `dialogs`, and `api` catalogs where their meanings match. The lint inventory below was run on 2026-10-10 with:

```powershell
npx eslint src/renderer/editors/board src/renderer/editors/board-info src/renderer/editors/env-vars src/renderer/editors/toolset -f json -o $env:TEMP/us1658-eslint.json
```

The baseline `vanilla-view/no-hardcoded-ui-strings` inventory reported **60 literal occurrences in 15 files** (file counts below); repeated occurrences count separately. After implementation the same rule reports zero occurrences across all 49 scope files. The baseline source positions and text were:

| File | Count | Reported strings / positions |
|---|---:|---|
| `src/renderer/editors/board/BoardEditorModel.ts` | 6 | 185 `Board`; 529 `Copy Board Path`; 536 `Open Board Folder`; 642 unsaved-changes sentence with `{this.title}`; 643 `Unsaved Changes`; 667 save-failure toast with `{this.releaseError}`. |
| `src/renderer/editors/board/BoardEditorView.ts` | 1 | 44 `Content unavailable`. |
| `src/renderer/editors/board/BoardNotFoundView.ts` | 2 | 27 `Board not found`; 29 missing-folder/manifest explanation. |
| `src/renderer/editors/board/board-permission-list.ts` | 2 | 42 and 62 `Full access`. These are the permission-list labels, separate from the English agent source described below. |
| `src/renderer/editors/board/board-scaffold.ts` | 1 | 66 `Board created, but the template could not be copied: {error}`. |
| `src/renderer/editors/board/BoardSecondaryView.ts` | 1 | 51 `View`. |
| `src/renderer/editors/board/BoardToolbar.ts` | 4 | 62 `File Explorer`; 71 `Board actions`; 186 `Reload board`; 187 `Open board log`. Its conditional update-available titles/labels are found by the manual scan below. |
| `src/renderer/editors/board/BoardWebview.ts` | 1 | 565 iframe title `board`; this is a host-provided accessible frame title, so extract as fixed UI copy. |
| `src/renderer/editors/board/UntrustedBoardView.ts` | 3 | 31 `This board is not trusted`; 33 trust warning; 43 `Trust board`. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | 7 | 144 `Install editor`; 489 minimum app version sentence; 529 `Remove board`; 531 confirmation with `{props.name}`; 600 `Install location`; 628 `Folder already exists`; 705 trusted-board/folder-claim warning toast. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | 9 | 209 `Browse…`; 271 `Download`; 291 `Cancel`; 303 `Retry`; 320 `Register board`; 326 `Delete download`; 426 `Review permission change`; 518 `Open board`; 550 `Retry`. |
| `src/renderer/editors/env-vars/EnvVarsBodyView.ts` | 10 | 64 encrypted-file notice; 82 `Unlock…`; 96 invalid JSON notice; 98 repair instruction; 178 `Delete namespace`; 249 `+ Add namespace`; 549 `+ Add profile`; 599 add/select-profile hint; 618 `Delete profile`; 705 no-namespaces empty state. |
| `src/renderer/editors/env-vars/EnvVarsEditor.ts` | 4 | 215 delete-profile confirmation with conditional variable count; 216 `Delete Profile`; 248 delete-namespace confirmation with conditional profile count; 249 `Delete Namespace`. |
| `src/renderer/editors/toolset/ToolsetEditorModel.ts` | 2 | 35 default title `Agent Tool`; 136 no-execution-log toast. |
| `src/renderer/editors/toolset/ToolsetEditorView.ts` | 7 | 78 `Refresh`; 97 `Open Folder`; 103 `Open Log`; 253 manifest-problems lead-in; 295 no-tools empty state; 323 `Tools ({tools.length})`; 359 `Command: {tool.command}`. |

The manual scan finds additional app-owned strings the lint rule cannot see: helper/positional text, template literals, values assigned after construction, and concatenated sentences. Include these in the same extraction:

- `src/renderer/editors/board/BoardToolbar.ts`: conditional title `Board actions — update available`; conditional menu label `Board properties — update available` / `Board properties`.
- `src/renderer/editors/board/BoardEditorModel.ts`: the two page-tab menu labels above are `MenuItem` values; give them stable IDs before translation.
- `src/renderer/editors/board/BoardToolbar.ts`: host menu labels `Reload board`, `Open board log`, and `Board properties` need IDs (`reload-board`, `open-board-log`, `board-properties`). The board-contributed items retain their supplied `id`; when copied to `MenuItem`, preserve it with a board-control prefix to avoid collision with host IDs.
- `src/renderer/editors/board/BoardSecondaryView.ts`: fallback view title `View` when a board declaration has no title; translate this host fallback only. A declared view title is board-owned data.
- `src/renderer/editors/board/board-scaffold.ts`: whole success/failure toast, with `error` interpolated. Keep a single message.
- `src/renderer/editors/board-info/BoardInfoEditorView.ts`: helper calls `text("Install an editor for this folder/file")`, `text("Install location")`, `text("No installable editor is published for this folder/file type.")`, `text("Files:")`, `text("in")`, `text("Folder:")`, `text("Downloaded — not registered")`, review hint, `Installed`, `Trusted` / `Not trusted`, metadata row labels (`Description`, `Author`, `Repository`, `Location`, `File editor for`, `Folder editor`, `Not trusted — no permissions granted`, permission section headings/status, `Service: declared`, `Content providers`, `Capabilities`, `Registration warnings`, `Minimum bridge`, `Service`, `Bridge compatibility`, service status labels, `Versions`, loading/error/empty version history, and dynamic version-action labels/titles. These are `text()` helper and array/render-time strings, so the lint rule misses most of them.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts`: install/update error fallback messages and user-facing confirmations in `download`, `deleteDownload`, `uninstall`, `changeInstallDir`, and `register`; interpolate error/path/name/version data instead of concatenating sentences. UI wrappers are localizable; thrown errors stay English under E3.
- `src/renderer/editors/env-vars/EnvVarsBodyView.ts`: `validationWarning()` builds `duplicate variable name(s)` and a `Not saved — {reasons}. Fix to apply changes.` sentence. Use a CLDR plural message for the duplicate variable count and one message for the full unsaved explanation. Its profile segment options are user/persisted values, not app copy.
- `src/renderer/editors/toolset/ToolsetEditorView.ts`: assigned text for `Registered` / `Not registered`, `Author: {author}`, `Requires: {requirements}`, `Env: {names}`, and `Timeout: {timeout} ms`. Tool counts use a CLDR plural message; command/requirements/environment values remain placeholders/data.
- `src/renderer/editors/board/BoardStatusBarItems.ts` and `BoardToolbarControls.ts`: descriptions/purpose strings used by automation are generated from board-supplied labels/IDs. Keep those English/data-facing and preserve the stable `data-name` derived from each descriptor ID.

### Copy that stays English

- **E3 thrown errors:** keep every thrown error and rejected error message in these folders English because scripts, logs, and agents consume them. Verified examples include `BoardEditorModel.ts` page-state validation (`Board page-state keys must be…`, `Board page-state values must be strings`, size limit, `Board page state requires a board root`, invalid storage key), board/view availability and trust failures, save-handler/save failures, content-pipe/resource/provider failures, and permission-denied messages; `BoardWebview.ts` bridge/AiVision/frame/trust/content failures; `BoardTargetModel.ts` navigation/tab guards and unknown view; `board-fetch.ts` URL/init/header/body and network-permission validation; `board-pipe-handler.ts` stream/resource/IPC size failures; `board-scaffold.ts` existing-name collision; `BoardInfoEditorModel.ts` invalid install directory and model/host invariants; `BoardInfoEditorView.ts` invalid model; `EnvVarsEditor.ts` invalid JSON structure/value failures; `EnvVarsBodyView.ts` model mismatch; `open-env-vars.ts` missing configured file; and `ToolsetEditorModel.ts` missing root on restore. Translate a fixed UI wrapper around an error and interpolate `errMessage(error)` as data; do not translate the thrown cause.
- **E5 board/data copy:** board names; manifest/catalog names, descriptions, authors, repository links, editor names, settings labels/options, declared view titles, tool/control/status labels; `persephone.setStatusText()` content; board toast/notification payloads; paths, URLs, IDs, versions, command output, user-authored toolset metadata and env-var namespace/profile/key/value data stay unchanged. `Persephone`, `MCP`, `Git`, protocol strings (`board://`, `persephone-board://`, `persephone-toolset://`), JSON/manifest filenames, enum values, permission IDs and shortcut text also remain exact.

## Identity and agent-facing text

These displayed values also act as identity, persistence, or agent-facing output. Keep the identity/value separate from translated presentation (E2/D4), and do not make agents match localized labels. There are nine identity/data case groups in this table:

| Case and verified code path | Handling |
|---|---|
| Board toolbar controls in `src/renderer/editors/board/BoardToolbarControls.ts`: `descriptor.id` indexes the host `records` map, identifies `board-toolbar-control-${id}` via `data-name`, is used by updates/events, and is sent back to the board. `label`, `title`, placeholders, menu item labels, and select/segment option labels come from the board bridge (`src/renderer/editors/board/board-api.d.ts`, `src/renderer/editors/board/board-manifest.ts`). | Preserve descriptor/item/option `id` and values. All board-supplied displayed text stays as supplied under E5; do not localize it. Preserve the item ID when constructing the host menu item. |
| Board status-bar entries in `src/renderer/editors/board/BoardStatusBarItems.ts`: board-supplied `item.id` keys/reconciles rendered records, becomes `data-name="board-status-bar-item-${id}"`, and is emitted with actions. `item.text/title` are displayed and supplied by the board. | Preserve `id` and board text; automation identifies the control by its stable `data-name`, never text. |
| `persephone.setStatusText()` is received in `src/renderer/editors/board/BoardWebview.ts` and stored transiently by `BoardEditorModel.setStatusText()` for `BoardEditorView`. | This is arbitrary board-authored status content, is not persisted, and stays exactly as supplied (E5). |
| Board names, descriptions, author/repository, manifest `editorName`, declared secondary-view title, capabilities, provider declarations, service metadata, version/manifest values and published-catalog fields are rendered in `BoardInfoEditorView` and/or `BoardToolbar`. `BoardInfoEditorFacade` exposes model/catalog data to scripts. | Treat as board/catalog data (E5). Do not translate names/descriptions or derive an ID from them. Translate only fixed host framing labels. |
| Trust permission lines originate in `src/renderer/editors/board/board-permission-copy.ts`, are rendered by `board-permission-list.ts`, `BoardInfoEditorView.ts`, and `src/renderer/ui/dialogs/TrustBoardDialogView.ts`, and are read by `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, and `src/renderer/api/boards.ts`. | Move all shared messages to `board` catalog keys. Preserve existing exported agent strings with `englishMessage(key, params)`; give each line a stable semantic `kind`, `textKey`, optional `textParams`, and `detailKey`. UI renderers call `t()`. `LEGACY_BOARD_AGENT_DEPRECATION_NOTE` is the sole agent-only plain English constant. Keep all agent consumer contracts and outputs English. |
| Environment-variable namespace, profile name, variable name, and value are rendered/selected in `EnvVarsBodyView`; `EnvVarsEditor` reads/writes them as JSON and persists selected namespace/profile in editor state. `app.boardVars` methods expose namespace/key/value to scripts. | These are persisted keys/user data. Keep them unchanged and displayed verbatim; only fixed controls, validation framing, and confirmations use `t()`. Preserve selected IDs/values and dialog results. |
| Toolset root, `tools-manifest.json` name/description/author, tool names, commands, requirements, environment variable names and timeout values are displayed by `ToolsetEditorView` and exposed via the `toolset-view` scripting facade. | Treat manifest fields as user/agent data, not translatable UI. Translate only host labels such as `Author:`, `Command:`, `Requires:`, `Env:`, and `Timeout:` with placeholders. Preserve toolset root and editor ID `toolset-view`. |
| Board/editor/secondary-view IDs, page IDs, catalog IDs, paths, manifest IDs, provider/scheme/capability IDs, permission flags, enum/status discriminants, shortcut text, file names and protocol/product names are compared, serialized, persisted, returned through APIs, or used by automation. | Keep the underlying values stable English/data. In particular keep `board-view`, `board-info`, `env-vars-view`, `toolset-view`, `board-editor:<root>`, `persephone-board://`, `persephone-toolset://`, `board-secondary:<id>`, and all IDs/selectors unchanged. |
| Host-owned page-tab menu items in `BoardEditorModel.onGetMenuItems()` and the host recovery menu in `BoardToolbar.menuItems()` have translated labels but no ID today. | Add stable kebab-case IDs: `copy-board-path`, `open-board-folder`, `reload-board`, `open-board-log`, and `board-properties`. Keep each unique in its menu. Preserve callback behavior. |

## Implementation Plan

1. Add `src/shared/i18n/en/board.ts`, typed with `EnglishCatalogEntry`, and register `boardCatalog` in `src/shared/i18n/en/index.ts` (merged catalog and inferred key/parameter types). Use only flat `board.<entry>` keys. Resolve `t()` while props/rendered content is built; no module-level localized strings.
2. Extract Persephone-owned board-host strings in `src/renderer/editors/board/BoardEditorModel.ts`, `BoardEditorView.ts`, `BoardNotFoundView.ts`, `BoardSecondaryView.ts`, `BoardToolbar.ts`, `UntrustedBoardView.ts`, `board-permission-list.ts`, and `board-scaffold.ts`. Keep `BoardEditorModel`'s displayed board title/data stable; translate host fallback title `Board`, missing-content/not-found/untrusted states, confirmation wrapper, fixed toolbar controls, and app-authored toast. Use one message for the save sentence and error toast.
3. Add IDs to the converted menu items in `BoardEditorModel.onGetMenuItems()` and `BoardToolbar.menuItems()`. Preserve board item IDs in `BoardToolbarControls.boardMenuItems()` when producing `MenuItem`s; prefix board control item IDs so they cannot collide with host action IDs. The external board labels remain unmodified.
4. Extract host-owned install/properties copy in `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `BoardInfoEditorView.ts`: install/download/update states, fixed metadata framing, status labels, confirmations, fixed action labels, and errors. Keep board/catalog metadata and manifest text untouched. Parameterize whole sentences for board name, path, version, and error. Reuse existing `api.boardVersionRequiresApp` and `api.boardInstallFailed` where the exact meaning matches; leave board-specific UI-only messages in `board`.
5. Extract fixed controls, empty/error/locked states, validation, and confirmations in `src/renderer/editors/env-vars/EnvVarsBodyView.ts` and `EnvVarsEditor.ts`. For duplicate variable, deleted variable, and deleted profile counts use CLDR objects and `params.count`; make the full `Not saved` warning a single parameterized message. Keep profile/namespace/key names and secret values unchanged.
6. Extract toolset host chrome in `src/renderer/editors/toolset/ToolsetEditorModel.ts` and `ToolsetEditorView.ts`: default title, toolbar labels, registration status, empty/log/manifest messages, labeled tool fields, and tool count. Use a CLDR message for `Tools ({count})`. Keep all manifest fields and execution/log values as data.
7. Reuse catalog entries where context matches: this implementation uses `common.cancel`, `dialogs.createBoardBrowse`, `dialogs.createBoardFolderLabel`, `menus.retry`, `shell.openBoardFolder`, `shell.copyBoardPath`, `shell.installEditorForFolder`, `shell.update`, and `api.boardVersionRequiresApp`. Check `common` and neighboring areas before adding repeated actions. Keep board-specific status and confirmations in `board`.
8. Move every shared message from `src/renderer/editors/board/board-permission-copy.ts` into `board` catalog keys, including `BOARD_PERMISSION_INTRODUCTION`, `LEGACY_PERMISSION_EXPLANATION`, `legacyBoardDeprecationWarning`, `legacyBoardsDeprecationToast`, permission line text/detail, `FULL_ACCESS_DETAIL`, `PERMISSION_CHANGE_TITLE`, and `permissionChangeMessage`. Existing exported agent-facing values call `englishMessage(key, params)`; the UI gets `legacyBoardDeprecationWarningForUi` / `legacyBoardsDeprecationToastForUi` or calls `t()` directly. Update all UI consumers, including `src/renderer/ui/dialogs/TrustBoardDialogView.ts`. Board names are placeholders; the multi-board toast joins names with comma-space and does not localize a conjunction. Keep `LEGACY_BOARD_AGENT_DEPRECATION_NOTE` a plain English constant. Use `kind === "unrestricted"` rather than matching display text.
9. Review `src/renderer/editors/board/BoardStatusBarItems.ts`, `BoardToolbarControls.ts`, `board-permission-copy.ts`, `board-manifest.ts`, `BoardWebview.ts`, `src/renderer/editors/board-info/BoardScreenshotView.ts`, `src/renderer/editors/env-vars/open-env-vars.ts`, and editor `index.ts` files for additional helper/positional/accessibility strings. Keep only app-owned user-facing text in the catalog. Do not change `src/board-context-menu.ts` or `src/board-shim.ts` (phase 3).
10. Live-check each screen under generated `en-XA`: Board editor via MCP `app.boards.openBoard(root)` and board automation (`pages[i].editor`); Board Info via its `… > Board properties` toolbar action and MCP `app.boards.installPublished(id)` for install/update; Environment Variables via `app.boardVars.show(namespace)` or a board's `persephone.var.show()` bridge; Toolset via the Explorer `tools-manifest.json` “Open Toolset” action or the Tools panels' toolset entry. Inspect visible text and accessibility names, then exercise trust/install flows through `app.boards.registerBoard(root)` / `installPublished`. Verify MCP/scripts still use IDs and English agent output.

### Before → after examples

```ts
// Before: sentence fragments and English-only suffix plural
`Delete profile "${profile}"${keyCount > 0 ? ` and its ${keyCount} variable${keyCount !== 1 ? "s" : ""}` : ""}?`

// After: one localizable message, with count category and data placeholders
t("board.deleteProfileConfirmation", { profile, count: keyCount })
```

```ts
// Before: displayed text is also used as an identity check
if (line.text === "Unrestricted") { ... }

// After: compare a stable semantic identity; UI text comes from the catalog
if (line.kind === "unrestricted") { ... }
render(t(line.textKey, line.textParams))
```

### Files that need no changes

| File / area | Reason |
|---|---|
| `src/board-context-menu.ts`, `src/board-shim.ts` | Explicitly phase 3; these run in the board webview and are outside US-1658. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | US-1648 split; preserve the English shared permission text and agent-facing output, including their contracts. |
| `src/renderer/editors/board/board-api.d.ts`, `src/renderer/editors/board/board-manifest.ts` | Board bridge/manifest schemas define supplied data and IDs; no schema or board-owned string localization in this task. |
| `src/renderer/editors/env-vars/open-env-vars.ts`, `src/renderer/editors/board-info/open-board-info.ts`, editor `index.ts` files | Navigation/registration plumbing only; no host UI copy needs changing. |
| `src/renderer/editors/board/BoardStatusBarItems.ts`, `BoardToolbar.css`, `BoardStatusBarItems.css` | Board status text is supplied data and its existing `data-name` is ID-derived; styles contain no copy. Verify under `en-XA`, but do not translate these values. |
| `src/renderer/ui/dialogs/**` | General dialog framework is out of scope. `src/renderer/ui/dialogs/TrustBoardDialogView.ts` is an explicit exception because it renders the shared board trust/permission UI and must use translated board catalog messages. |
| Tests and harnesses | Not requested; EPIC-125 E7 uses existing lint/i18n/typecheck/build and live MCP verification, not a new harness. |
| `doc/epics/EPIC-125.md`, `doc/active-work.md` | The current run is not to edit these files; the user will link this task document. |

## Concerns

- Board-owned text can look like host UI in the rendered tree. Confirm provenance at `BoardToolbarControls`, `BoardStatusBarItems`, manifest, catalog, and toolset model boundaries before extracting; leave board/manifest/secret data untouched.
- Permission text is shared with ai-vision and a script facade. Keep English agent exports via `englishMessage()`, but translate the consent/permission UI with `textKey` and `textParams`; use stable semantic `kind` values for identity.
- Board Info includes both fixed host framing and catalog/manifest values in the same text helper. Keep placeholders and data separate, especially catalog names/descriptions, paths, versions, provider errors, service status and registration reasons.
- The environment-variable editor persists namespace/profile selection and JSON keys. Extract only fixed framing and validation; do not localize displayed persisted values.
- `src/renderer/editors/board/BoardStatusBarItems.ts` is outside the initial lint report's 15 files but in the requested folder. The task must retain its automation names while checking for further host-owned copy.

## Acceptance Criteria

- A typed `board` area is registered in the English catalog with flat keys, translator notes as needed, CLDR count forms, and whole messages for sentences.
- The 60 lint-visible occurrences plus all verified helper/template/assigned-text findings are handled; no app-owned visible strings remain in these four folders outside the catalog, except E3 errors and E5 data/board-owned copy.
- All menu labels changed by this task have stable unique IDs; board-provided control IDs/data-names and status-bar IDs remain stable.
- Board names, manifest/catalog descriptions, board settings labels, board toolbar/status text supplied by the board, shortcut strings, paths/URLs, product/protocol names, user data and persisted values remain as supplied.
- Permission-list rendering no longer treats visible text as an identity; all consent and permission UI is translated, while ai-vision, `BoardInfoEditorFacade.ts`, and MCP board descriptions continue to expose English permission copy. `LEGACY_BOARD_AGENT_DEPRECATION_NOTE` remains English.
- Trusting/registering a board, installing/updating a published board, opening/editing environment variables, and opening a toolset continue to work through MCP/UI flows.
- `npm run lint` has zero `vanilla-view/no-hardcoded-ui-strings` findings for the four folders; `npm run i18n:check`, typecheck and build pass; each reachable screen is inspected under `en-XA` with no plain English outside E3/E5.

## Files Changed

### Implementation checklist

- [x] Register the 154-key board catalog (including five CLDR plural messages) and extract board-host UI strings.
- [x] Add stable host menu IDs and preserve board-contributed IDs.
- [x] Translate board permission/consent UI while preserving English agent exports.
- [x] Localize Board Info, environment variables, and toolset copy; preserve data, errors, and board-owned text.
- [x] Run the scoped ESLint hardcoded-string audit: zero reports across 49 files.
- [x] Run `npm run lint`, `npm run typecheck`, and `npm run build-prod` (lint completed with zero errors; repo-wide existing warnings remain outside this scope).
- [ ] Live-check the listed screens under `en-XA` (requires app runtime).
- [ ] Run `npm run i18n:check` (user will run outside this sandbox).

| File / area | Planned change |
|---|---|
| `src/shared/i18n/en/board.ts`, `src/shared/i18n/en/index.ts` | Add and register typed board-host catalog messages. |
| `src/renderer/editors/board/BoardEditorModel.ts`, `BoardEditorView.ts`, `BoardNotFoundView.ts`, `BoardSecondaryView.ts`, `BoardToolbar.ts`, `UntrustedBoardView.ts`, `board-permission-list.ts`, `board-permission-copy.ts`, `board-scaffold.ts`, `legacy-board-deprecation-notice.ts` | Translate fixed host UI and trust/permission UI; add stable menu IDs and permission-line identity while retaining English agent exports. |
| `src/renderer/editors/board/BoardToolbarControls.ts` | Preserve board-supplied IDs and automation identity when forwarding menu items; translate no board-owned values. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `BoardInfoEditorView.ts` | Translate host install/properties/status/action framing, errors and confirmations; retain board/catalog values. |
| `src/renderer/editors/env-vars/EnvVarsBodyView.ts`, `EnvVarsEditor.ts` | Translate fixed control, empty, validation and confirmation copy; add count plurals. |
| `src/renderer/editors/toolset/ToolsetEditorModel.ts`, `ToolsetEditorView.ts` | Translate host chrome, status, field labels and plural tool count; retain manifest data. |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Translate consent, legacy-permission, and permission-change copy in the shared trust dialog. |
| `doc/tasks/US-1658-board-host-strings/README.md` | Investigation, verified lint inventory, identity boundaries, implementation plan and acceptance criteria. |
