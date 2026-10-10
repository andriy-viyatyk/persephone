# US-1656: API layer, content pipeline and notifications outside editors

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** Implemented; live `en-XA` verification pending

## Goal

Move app-authored UI copy in the API layer, content pipeline, scripting host, and shared core helpers into the typed English catalog. Preserve the English API, data, error, and agent contracts described by EPIC-125 decisions E1–E7.

## Background

This task follows [EPIC-125](../../epics/EPIC-125.md) and the extraction pattern established in [US-1652](../US-1652-pilot-extraction/README.md). Use the flat `<area>.<entry>` keys, resolve `t()` when constructing/rendering UI, put counts in CLDR message objects, and keep each sentence in one message with placeholders.

The requested ESLint scan (2026-10-10) scanned 197 files in `src/renderer/api/`, `src/renderer/content/`, and `src/renderer/scripting/`, excluding `api/mcp/`, `api/types/`, `scripting/ai-vision/`, and `scripting/api-wrapper/`, plus the six eligible top-level `src/*.ts` files. It found **41 `vanilla-view/no-hardcoded-ui-strings` report occurrences** in 20 files. Of those, 38 are app-owned UI copy to localize; two well-known log titles and the `proc.execute` API handle label stay English under E2/E5. `src/renderer/core/`, `src/renderer/theme/`, and eligible top-level host files reported zero. The existing `src/renderer/content/open-with-editor.ts` and `open-with-default-app.ts` findings were already converted in US-1655 and no longer report.

### Lint inventory

| File | Reports | Reported source text |
|---|---:|---|
| `src/renderer/api/app.ts` | 5 | `Mneme failed to start: {error}` (2); `Clipboard tracker failed to start: {error}`; `Mneme started`; `Mneme: {error}` |
| `src/renderer/api/board-install.ts` | 2 | `Delete board`; `Delete board "{name}"? This permanently removes its folder and all its files.` |
| `src/renderer/api/board-updates.ts` | 4 | `This board is currently running. Stop it before {action}.`; `Board is open`; `Installed {name} v{version}.`; `Install failed: {error}` |
| `src/renderer/api/boards.ts` | 1 | `This version requires Persephone ≥ {version}.` |
| `src/renderer/api/capabilities.ts` | 1 | `Duplicate capability registration: "{name}". The first registration remains active.` |
| `src/renderer/api/internal/GlobalEventService.ts` | 1 | `Unhandled promise rejection: {reason}` |
| `src/renderer/api/internal/RendererEventsService.ts` | 1 | `New version {version} is available! Click to open About page.` |
| `src/renderer/api/internal/clipboard-image.ts` | 1 | `Pasted HTML` (localize the visible page title, while retaining an English title for page/API identity; see identity section) |
| `src/renderer/api/pages/PageNavigator.ts` | 3 | `File not found: {name}`; `Failed to open folder: {error}`; `Failed to open {name}: {error}` |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | 1 | `Open File` |
| `src/renderer/api/pages/well-known-pages.ts` | 2 | `MCP Log.log.jsonl`; `MCP Server Log.log.jsonl` (retained English page titles; see identity section) |
| `src/renderer/api/proc.ts` | 1 | `proc.execute` (API label/identifier; retained English) |
| `src/renderer/api/setup/library-intellisense.ts` | 3 | `library`; `Trigger` (2) |
| `src/renderer/api/site-extension-management.ts` | 2 | `Remove site extension`; `Remove site extension "{name}" and its folder?` |
| `src/renderer/api/tools/tool-scaffold.ts` | 1 | `Toolset created, but the template could not be copied: {error}` |
| `src/renderer/api/window-recording.ts` | 5 | `Could not start recording: {error}` (2); `Recording failed: {error}`; `Could not remove recording: {error}`; `Could not finish recording: {error}` |
| `src/renderer/content/builtin-schemes.ts` | 4 | `Open external link?`; `This popup has no trusted board origin. Open {url} outside Persephone?`; `Guide not found: {path}. Use the guide index to inspect available pages.`; `Failed to open guide {path}: {error}` |
| `src/renderer/content/parsers.ts` | 1 | `Invalid file path: {path}` |
| `src/renderer/scripting/AutoloadRunner.ts` | 1 | `Autoload script error: {message}` |
| `src/renderer/scripting/ScriptRunner.ts` | 1 | `Script Error` |
| **Total** | **41** | 38 localizable UI report occurrences; 3 identity/API strings remain English. Repeated use of one source message counts once per report. |

### Source audit beyond lint

The lint rule does not see strings passed positionally through helper functions or messages built in other modules. Include these app-owned UI sources in the extraction:

| File(s) | Missed UI copy and handling |
|---|---|
| `src/renderer/core/utils/guard.ts`; callers in `src/renderer/api/internal/RendererEventsService.ts`, `GlobalEventService.ts`, `KeyboardService.ts`, `internal/clipboard-image.ts`, and `pages/PagesLifecycleModel.ts` | `guard(label, fn)` turns its English label into the visible toast prefix `${label}: {error}`. Translate the whole wrapper with `{label}` and `{error}` or use semantic complete messages at each caller; do not translate caught error text. Call labels are `Failed to open image`, `link`, `file`, `URL`, `diff`, and `dropped files`; `Failed to show page`; `Failed to move page`; `Failed to open User Guide`, `pasted HTML`, and `{filename}`. Repeated URL/open/move labels share keys where context matches. |
| `src/renderer/api/terminal.ts` | `Failed to open terminal.` is an app-authored fallback passed to `errMessage` before a toast, so localize the fallback; keep any thrown/caught error cause English under E3. |
| `src/renderer/api/board-install.ts`, `board-updates.ts` | Extract the missed failure fallback `Failed to delete the board folder.`, `Installing {name} v{version}…`, and the busy/open-page wording. Replace the concatenated `{action}` sentence with complete updating/deleting messages; use a CLDR `page(s)` count for the page confirmation. |
| `src/renderer/api/internal/RendererEventsService.ts` | `New version {version} is available! Click to open About page.` is a complete toast sentence. Keep the `closeResult === "clicked"` behavior as a stable result value. |
| `src/renderer/api/setup/library-intellisense.ts` | Completion `label: "library"` and `detail: "Script library modules"` are visible UI strings; the inserted token `library/`, completion kind, sort text, and Monaco command id are behavior/data. `title: "Trigger"` is command UI text, but retain the stable `editor.action.triggerSuggest` id. |
| `src/renderer/content/builtin-schemes.ts` | Notifications missed by lint: `Invalid folder editor link: {href}`, `Invalid guide link: {href}. Expected persephone-guide://<corpus-path>[#anchor].`, `Invalid guide link: {url}. Expected persephone-guide://<corpus-path>[#anchor].`, `No REST Client board is registered. Enable it in Tools & Editors or install a replacement.`, and `Failed to open request in REST Client: {error}`. The link/URL/path values are placeholders; `REST Client` and Persephone remain product names. The board-log messages `"openExternal" is not enabled in board-manifest.json; opened in an internal Browser tab: {url}` and `Blocked external launch: {url}` remain English log payloads under E5. |
| `src/renderer/api/capability-feedback.ts`, `src/renderer/api/boards.ts` | `notifyEditCapabilityFailure()` accepts positional fallback copy and adds `: {error}`. The in-scope caller is `src/renderer/content/builtin-schemes.ts` (`Failed to open image for editing`); localize that fallback and the app-authored wrapper, keeping the cause English. The board minimum-version warning is already linted and uses a version placeholder. `src/renderer/editors/svg/index.ts`, `src/renderer/editors/mermaid/index.ts`, `src/renderer/editors/html/HtmlEditor.ts`, and `src/renderer/editors/image/ImageToolbarView.ts` also call the helper but are outside US-1656; their fallback labels remain until their editor-area task. |
| `src/renderer/api/tools/tool-scaffold.ts`, `src/renderer/content/registry.ts` | The linted toolset notification is one complete message. Registry notification: `Duplicate {kind} registration: "{name}". The first registration remains active.` `duplicateResult()` also returns `{kind} "{name}" is already owned by board "{owner}".` or `{kind} "{name}" is already registered by {origin}.`; those `reason` values are script/API results and stay English/data, not translated. Keep registration type/name/owner as data. |
| `src/renderer/content/providers/HttpProvider.ts` | Progress status text `Receiving data`, `Download complete`, `Download canceled`, and `Download failed` is produced by the built-in HTTP provider and shown in the content status UI. Preserve the English status value for the pipe/API consumer and supply a catalog-backed UI projection/English field (E2); do not translate provider-supplied status values in the generic pipeline. |
| `src/renderer/api/board-vars/BoardEnvStore.ts`, `src/renderer/api/board-vars/types.ts` | `Decrypt the board environment variables file to continue.` is supplied to the visible password dialog and should be translated. Keep `BoardVarsLoadResult.status` (`ok`, `not-configured`, `locked`, `error`) stable; its optional `message` is documented for logging, not the user, and remains English error data. |
| `src/renderer/api/internal/RendererEventsService.ts` | Board-supplied `data.message` passed to `ui.notify()` is board-owned text (E5), not catalog copy. |

The text `drawing` in `src/renderer/content/builtin-schemes.ts` is a fallback page title; keep it English as page/document identity. `src/renderer/api/proc.ts`'s `proc.execute` is an API handle label, not user-facing copy. The generic script error body in `ScriptRunner.ts` is script output; only the dialog title is catalog UI.

## Identity and agent-facing text

These cases must be reviewed separately during implementation. Translate only the UI projection; preserve stable identifiers or an English value wherever the same field is compared, returned, persisted, or read by script/agent consumers.

1. **Notification/dialog result IDs — `src/renderer/api/internal/RendererEventsService.ts`, `src/renderer/api/board-install.ts`, `src/renderer/api/board-updates.ts`, and `src/renderer/content/builtin-schemes.ts`.** `"clicked"`, `DialogButton.delete`, `DialogButton.cancel`, `CLOSE_BOARD_AND_CONTINUE`, and `OPEN_EXTERNAL_LINK` drive branches after translated UI. Keep these exact constants/IDs English and compare against them, never the rendered label. Dialog button labels use the existing `dialogs` catalog entries.
2. **Page identity and persisted page titles — `src/renderer/api/pages/well-known-pages.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, and `src/renderer/api/pages/PageNavigator.ts`.** `mcp-ui-log` / `mcp-server-log` are stable page IDs; `MCP Log.log.jsonl` and `MCP Server Log.log.jsonl` are fixed log/document titles exposed through page APIs and log files. Keep them English. `Open File` is a transient native picker title and can use the `dialogs.openUrlFile` message while preserving the call behavior. File names and paths in navigation notifications remain data.
3. **Pasted HTML page title — `src/renderer/api/internal/clipboard-image.ts`, `src/renderer/ui/tabs/PageTabView.ts`, and `src/renderer/ui/sidebar/OpenTabsListView.ts`.** The caller passes `title: "Pasted HTML"` to `content.view`; `PagesLifecycleModel.addEditorPage()` stores it as the editor-state `title`, the persisted title stays English, and `PageModel.title` returns `mainEditorInstance.title` (also English, exposed as `IPage.title` to scripts/agents). The UI reads `EditorModel.state.title` in `PageTabView.selectEditorState()` for the tab and the main-editor state in `OpenTabsListView` for the list. Localize only those two displayed projections when `editor === "html-view"` and `title === "Pasted HTML"`; the API continues returning `page.title === "Pasted HTML"`, and persisted state stays English. Keep the `content.view` capability and `html` representation stable.
4. **Script and MCP contracts — `src/renderer/api/ui.ts`, `src/renderer/api/proc.ts`, and excluded `src/renderer/api/types/**`, `src/renderer/api/mcp/**`, `src/renderer/scripting/api-wrapper/**`, `src/renderer/scripting/ai-vision/**`.** `app.ui.notify/confirm/input/showProgress/notifyProgress` messages and button arrays are supplied by the calling script; they are API payload/data and stay as supplied. `proc.execute` is the stable API handle name. Type declarations, MCP tool metadata, API-wrapper help/errors, and ai-vision labels remain English per D3 and are excluded from conversion.
5. **Board and extension supplied text — `src/renderer/api/internal/RendererEventsService.ts`, `src/renderer/api/boards.ts`, `src/renderer/api/site-extensions.ts`, `src/renderer/api/site-extensions-agent.ts`, and `src/renderer/content/registry.ts`.** Board toast bodies, board manifest names/descriptions, extension descriptions/host names, and registration owner/type/name values may be visible or returned to scripts/MCP. Preserve those exact English/data fields; translate only host-authored surrounding UI wrappers. `Persephone`, `MCP`, `Git`, `Mneme`, `Tor`, and `REST Client` remain unchanged product/protocol names.
6. **HTTP status projection — `src/renderer/content/providers/HttpProvider.ts`, `src/renderer/components/pipe-status/PagePipeStatusModel.ts`, and `src/renderer/components/pipe-status/PipeStageListView.ts`.** `HttpProvider.status.text` is the provider source. `ContentPipe.summary` and `.stages` copy that same value to `IContentPipe.summary.text` and `IContentPipe.stages[*].status.text`, declared as `IPipeStageStatus.text` and returned by the page pipe API (`IPage.pipe`). The UI reads `pipe.summary.text` in `PagePipeStatusModel.refresh()` for the status label and `pipe.stages[*].status.text` through `PagePipeStatusModel.state.stages` in `PipeStageListView.render()` for each row. Keep both API-returned fields English (`Receiving data`, `Download complete`, `Download canceled`, `Download failed`); localize a UI-only projection keyed by `stage.type === "http"` and status state. Leave error `detail` and provider-supplied stage text untouched.
7. **Completion and source identity — `src/renderer/api/setup/library-intellisense.ts` and `src/renderer/content/builtin-schemes.ts`.** Keep the inserted module token `library/`, Monaco command ID `editor.action.triggerSuggest`, scheme identifiers (`persephone-guide`, `mneme`, `file`, HTTP schemes), target IDs (`browser`, `md-view`, capability IDs), and fallback page title `drawing` stable/English. Translate only visible completion presentation and user prompts.
8. **Errors and scripts — `src/renderer/api/**`, `src/renderer/content/**`, and `src/renderer/scripting/**`.** Thrown `Error` strings and caught causes remain English under E3 because scripts, logs and agents read them. Autoload and script execution output remains content supplied by the script; localize only the application-owned toast prefix and `Script Error` dialog title.

### Explicit English exceptions

- **E3:** Every thrown `Error`, `TypeError`, `CapabilityError`, `ProviderUnavailableError`, `MissingProviderError`, `ProviderOperationError`, and `UnresolvableLinkError` message in the scoped API/content/scripting/core sources remains English. This includes validation and operational messages in `src/renderer/api/board-install.ts`, `boards.ts`, `capabilities.ts`, `capability-bus.ts`, `certificate-view.ts`, `custom-theme-storage.ts`, `fs.ts`, `node-fetch.ts`, `proxy-tunnel.ts`, `pages/**`, `window.ts`, `window-screen.ts`, `window-recording.ts`, `site-extension-management.ts`, `site-extensions-agent.ts`, `content/registry.ts`, `ContentPipe.ts`, `rebuild-pipe.ts`, `providers/**`, `transformers/**`, `tree-providers/**`, `scripting/ScriptContext.ts`, `scripting/library-require.ts`, `core/state/model.ts`, and `core/utils/**`. Representative exact messages include `Board not installed: "{id}"`, `This board version requires Persephone ≥ {version}.`, `Malformed provider descriptor: expected an object with a string type.`, `HTTP {status}: {statusText}`, `The HTTP request was aborted.`, `Cannot write: pipe is read-only`, `Invalid data URL: missing comma separator`, and `No recording is active.`. Keep the exception/error detail interpolated into any localized UI wrapper as `{error}`.
- **E5 data and identifiers:** Keep paths, URLs, filenames, guide corpus paths, search/query text, versions, board/extension/provider names and descriptions, pipeline descriptors, HTTP status details, board-log payloads, and script output unchanged. Keep stable status/result/target/API values such as `clicked`, `delete`, `cancel`, `overwrite`, `move`, `copy`, `mcp-ui-log`, `mcp-server-log`, `proc.execute`, `library/`, `editor.action.triggerSuggest`, `browser`, `md-view`, `image.edit`, and `content.view` unchanged. The `unknown site extension option(s)` branch is thrown API validation text and stays English under E3.
- **E5 product/protocol names and board-owned text:** Retain `Persephone`, `MCP`, `Git`, `Mneme`, `Tor`, and `REST Client` exactly. Keep board-supplied `persephone.notify()` bodies and all board-owned labels/messages English. This task contains no keyboard shortcut labels to translate; any shortcut notation passed in data stays literal.

No translated menu item is introduced by this area, so D4 menu IDs are not implicated. `src/renderer/api/menu-bar.ts` built-in folder names were already handled in `src/renderer/ui/sidebar/MenuBarView.ts`; those names remain English script-facing data as requested.

## Implementation Plan

1. Add `src/shared/i18n/en/api.ts` with API-layer notifications, confirmations, scripting-host UI, and built-in content status messages; register `apiCatalog` in `src/shared/i18n/en/index.ts`. Use one semantic entry per source message. Reuse existing `common` and `dialogs` entries listed below, and check `shell`/`menus` before adding shared words.
2. Localize the 38 UI-copy occurrences in the files listed in **Lint inventory**. Preserve the two well-known log titles and `proc.execute` as English identity/API strings. Import `t` from `src/shared/i18n/t.ts` at the UI call site. Keep notifications and confirmations as complete messages with placeholders; replace action-word sentence concatenation with complete updating/deleting variants. Use a CLDR object with `count` for the open-page count.
3. Extract helper-hidden app-authored text from `src/renderer/core/utils/guard.ts` call sites and `src/renderer/content/builtin-schemes.ts`, `src/renderer/content/registry.ts`, `src/renderer/content/providers/HttpProvider.ts`, `src/renderer/api/capability-feedback.ts`, `src/renderer/api/terminal.ts`, `src/renderer/api/tools/tool-scaffold.ts`, and `src/renderer/api/board-vars/BoardEnvStore.ts`. Preserve the identity and data splits described above. Do not edit excluded agent/type folders.
4. For `HttpProvider`, keep the English status for pipe/API consumers and add a translated presentation value or equivalent host projection consumed by the status view; leave provider-supplied status details untouched. For any other dual-use field identified during implementation, split the English field from the localized view value.
5. Reuse `common.cancel`, `common.open`, and `common.loading` when the meaning and punctuation match. Reuse `dialogs.buttonDelete`, `buttonCancel`, `buttonOpen`, and `openUrlFile` for dialog button/title copy. Reuse existing `menus` or `shell` entries only when the semantic context is identical; do not duplicate generic labels in `api`.
6. Resolve `t()` lazily in notification callbacks, view props, and completion construction; do not create module-level translated constants. Keep API values, returned objects, page IDs, result IDs, paths, versions, and provider descriptors untouched.

Before:

```ts
ui.notify(`Installed ${name} v${version}.`, "success");
```

After:

```ts
ui.notify(t("api.boardInstalled", { name, version }), "success");
```

### Reuse from existing catalogs

| Existing key | Reuse for |
|---|---|
| `common.cancel` | Generic cancel button where the dialog currently uses the same label. |
| `common.open` | Generic Open action where it is semantically the same action. |
| `common.loading` | Generic loading status when punctuation/context match. |
| `dialogs.buttonDelete` | Delete confirmation action label (its result remains `DialogButton.delete`). |
| `dialogs.buttonCancel` | Cancel confirmation action label (its result remains `DialogButton.cancel`). |
| `dialogs.buttonOpen` / `dialogs.openUrlFile` | Open action or native file picker title where context matches. |
| `menus` / `shell` | Existing generic menu or shell labels only when identical in meaning; this task primarily adds contextual API notifications not duplicated in those areas. |

## Concerns

- `api.ui` accepts user/script text. Translating at that API boundary would change caller data and agent-visible content; only app-authored messages at internal call sites are localized.
- HTTP provider status text currently serves both a visible status row and a data/diagnostic contract. The implementation must keep the English contract available while translating the UI projection.
- Some errors appear in notifications, but E3 keeps thrown errors and causes in English. Catalog only the app-authored wrapper/fallback; pass the cause as `{error}`.
- The `src/renderer/content/open-with-*.ts` strings were converted in US-1655; retain those changes and do not duplicate their keys.

## Acceptance Criteria

- [x] All 38 localizable lint report occurrences are converted; the two well-known log titles and `proc.execute` stay English, and source-audit UI strings listed above are reviewed and handled.
- [x] `src/shared/i18n/en/api.ts` is registered in `src/shared/i18n/en/index.ts`; existing `common`, `dialogs`, `menus`, and `shell` keys are reused where semantically appropriate.
- [x] Count messages use CLDR categories; app-authored full sentences use one message with named placeholders.
- [x] English errors, API/script inputs and outputs, stable IDs, persisted page titles/descriptors, product names, and board-owned text retain their contracts.
- [ ] Live `en-XA` verification covers each API/content/scripting surface in the route table below and shows pseudo-text for app-authored UI copy.
- [x] Script/API flows preserve English errors and stable result IDs by keeping agent-facing/error fields outside localized UI projections.

### Implementation verification

- Scoped ESLint (`src/renderer/api/`, `src/renderer/content/`, `src/renderer/scripting/`, `src/renderer/core/`, eligible top-level `src/*.ts`; D3 exclusions applied): **3** `vanilla-view/no-hardcoded-ui-strings` reports remain, all deliberate identity/API strings listed above.
- `npm run lint`: passed (0 errors; repository warnings remain).
- `npm run typecheck`: passed.
- `npm run build-prod`: passed; build emitted existing ineffective dynamic import and chunk-size warnings.
- `npm run i18n:check` was not run per task instructions. Live `en-XA` walkthrough remains pending; see route table below.

## Live access for `en-XA` verification

| Surface | Route |
|---|---|
| API notification and confirmation surfaces | In a dev build set Settings → General → Language → Pseudo-English. From MCP `script.execute`, call `app.ui.notify(...)`, `app.ui.confirm(...)`, and `app.ui.input(...)` to confirm caller-supplied message data stays as entered. Exercise host-generated board install/update/delete prompts from Board Info → Install/Update/Delete or through the corresponding `app.boards` methods; click using dialog button IDs. |
| Page navigation and recording | Open a missing file/folder with `app.pages.openFile()` / `app.pages.openFolder()` through MCP `script.execute` to reach navigation toasts. Start/cancel/finish a screen recording from the Window/recording UI or its MCP window API; inspect all notifications. |
| Scripting host | Open Script Library and request completion after typing `library/`; verify suggestion presentation is pseudo-localized while insertion remains `library/`. Run a script that throws to show the translated `Script Error` dialog title, then trigger an autoload failure to inspect its host toast. |
| Content pipeline and schemes | Open an HTTP URL through `app.openRawLink()` to show HTTP receive/completion status. Open an unattributed popup from a board to reach the external-link confirmation. Open a valid/invalid `persephone-guide://` link and an HTTP request link to reach guide/REST Client messages. |
| Provider registration and capabilities | From a board or script attempt duplicate provider/capability registration to show host toasts; trigger a content capability failure via an unsupported editor/content representation. Use MCP-visible board/provider metadata to verify names and descriptions remain English/data. |
| Clipboard, terminal, and board variables | Paste HTML into a page to reach the `Pasted HTML` page/dialog surface. From an Explorer folder invoke Open Terminal. Open Board Environment Variables, lock the store, and trigger its decrypt-needed state. |
| Well-known log pages | Open MCP Log and MCP Server Log from Tools & Editors or via their existing API access; verify fixed English titles and IDs remain unchanged under `en-XA`. |

The task does not add translated menu rows; no menu-label click route applies. Use MCP object/page/editor IDs and dialog result IDs rather than visible text when driving these checks.

## Files with no planned changes

The following scoped paths were checked and have no planned edits because they are API/data plumbing or contain no app-authored display strings in this task: all files under `src/renderer/core/` (the scoped lint run had zero reports and the visible-copy audit found only `guard.ts`, handled above); all files under `src/renderer/theme/` (zero reports); the eligible top-level host files `src/board-console-mirror.ts`, `src/main.ts`, `src/preload-webview.ts`, `src/preload.ts`, `src/renderer.ts`, and `src/site-extension-runtime.ts` (zero reports); and excluded `src/renderer/api/mcp/**`, `src/renderer/api/types/**`, `src/renderer/scripting/ai-vision/**`, and `src/renderer/scripting/api-wrapper/**` (D3 agent-facing surfaces). Other API/content/scripting files with no lint finding are not targets unless they are named in the helper audit table; retain their data/provider behavior.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/i18n/en/api.ts`, `src/shared/i18n/en/index.ts` | Add and register 69 `api.*` catalog entries. |
| `src/renderer/api/**` (except `mcp/**` and `types/**`) | Localize host-authored UI copy and helper fallbacks; preserve English identity, error, and agent-facing contracts. |
| `src/renderer/content/**` (not already converted in US-1655), `src/renderer/scripting/**` (except `ai-vision/**` and `api-wrapper/**`), `src/renderer/core/utils/guard.ts` | Localize app-owned pipeline and scripting UI text; preserve script output, provider data, and English error details. |
| `src/renderer/components/pipe-status/http-status-text.ts`, `PagePipeStatusModel.ts`, `PipeStageListView.ts` | Project English HTTP status API fields into localized UI text without changing returned fields. |
| `src/renderer/ui/tabs/page-title.ts`, `PageTabView.ts`, `src/renderer/ui/sidebar/OpenTabsListView.ts` | Localize visible Pasted HTML titles while keeping the persisted/API title English. |
| `doc/tasks/US-1656-api-strings/README.md`, `doc/epics/EPIC-125.md`, `doc/active-work.md` | Record implementation, verification, links, and remaining live check. |
