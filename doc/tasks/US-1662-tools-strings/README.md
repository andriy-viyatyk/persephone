# US-1662: MCP Inspector, Tools hub, Storybook

Epic: [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md)

## Goal

Extract app-owned UI copy in the MCP Inspector, full-page Tools & Editors hub, and Storybook chrome into the English `tools` catalog. Preserve MCP/server payloads, agent-facing identities, and story content as English data, and verify all three live screens under `en-XA`.

## Background

The scoped folders are `src/renderer/editors/mcp-inspector/`, `src/renderer/editors/tools-hub/`, and `src/renderer/editors/storybook/`. EPIC-125 decisions E1–E7 apply: the broadened `vanilla-view/no-hardcoded-ui-strings` rule is only one source of findings; text mixed with identity must retain an English identity; thrown errors and data remain English; repeated copy belongs in `common`; and every screen receives an `en-XA` live check. `*.story.ts` content is expressly exempt. `MCP` is a protocol name.

The exact lint command run for this investigation was:

```powershell
npx eslint src/renderer/editors/mcp-inspector/ src/renderer/editors/tools-hub/ src/renderer/editors/storybook/ -f json -o $reportPath
```

The JSON report was filtered to `vanilla-view/no-hardcoded-ui-strings`: **87 reports** across 16 source files — MCP Inspector 41, Tools hub 30, Storybook 16. Report file: `%TEMP%\us-1662-eslint.json`. The exhaustive file/line/column inventory is:

| File | Report locations (line:column) |
|---|---|
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts` | 204:12, 793:20 |
| `src/renderer/editors/mcp-inspector/McpInspectorView.ts` | 29:29, 30:30, 184:338, 185:282, 216:82, 217:90, 218:84, 231:396, 232:127, 232:197, 232:276, 232:355, 232:410, 239:790, 241:372, 247:491, 259:743, 259:1130, 268:253, 268:475, 268:768, 268:931 |
| `src/renderer/editors/mcp-inspector/PromptsPanel.ts` | 34:41, 264:57, 294:72 |
| `src/renderer/editors/mcp-inspector/ResourceContentView.ts` | 126:35, 132:31, 146:13 |
| `src/renderer/editors/mcp-inspector/ResourcesPanel.ts` | 39:41, 130:167 |
| `src/renderer/editors/mcp-inspector/ToolArgForm.ts` | 115:50, 239:30, 268:53 |
| `src/renderer/editors/mcp-inspector/ToolsPanel.ts` | 37:41, 113:46, 145:91, 146:94, 147:40, 159:128 |
| `src/renderer/editors/storybook/PropertyEditor.ts` | 65:88, 202:51, 225:23 |
| `src/renderer/editors/storybook/StorybookEditorModel.ts` | 27:16 |
| `src/renderer/editors/storybook/StorybookEditorView.ts` | 23:29, 24:32, 25:30, 65:31, 85:31, 140:27 |
| `src/renderer/editors/storybook/iconPresets.ts` | 5:30, 6:30, 7:30, 8:30, 9:30 |
| `src/renderer/editors/storybook/renderGridStory.ts` | 20:27 |
| `src/renderer/editors/tools-hub/SearchBoardsTab.ts` | 179:26, 190:20, 260:40, 266:40, 447:31, 453:24, 455:24, 459:24, 472:44, 481:46, 493:27, 500:31, 507:27 |
| `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` | 54:82, 57:88, 61:13, 94:26, 111:39, 131:48, 137:48, 155:68, 160:45, 167:94 |
| `src/renderer/editors/tools-hub/ToolsHubEditor.ts` | 17:12, 49:46 |
| `src/renderer/editors/tools-hub/ToolsHubView.ts` | 117:44, 118:43, 119:43, 120:42, 121:52 |

The reported literals are static UI labels, buttons, placeholders, headings, and empty states at those locations. The following source review names the additional missed copy and separates it from data. Line references are against the source at investigation time.

## Implementation Plan

- [x] Add `src/shared/i18n/en/tools.ts`, typed with `EnglishCatalogEntry`, and register/export `toolsCatalog` in `src/shared/i18n/en/index.ts`. The catalog contains 112 semantic entries. Import `t` or `untranslated` from `src/shared/i18n/t.ts` at the UI call site; resolve messages during view prop construction/rendering.
- [x] Convert the lint findings in the inventory above. Three source-review data cases initially reported by lint are deliberately wrapped in `untranslated()` and retained in English: MCP server version prefix plus value (`McpInspectorView.ts`), sample row/column coordinates (`renderGridStory.ts`), and catalog board version prefix plus value (`SearchBoardsTab.ts`).
- [x] Convert lint blind spots found by source review:
  - `mcp-inspector/McpInspectorView.ts`: transport and connection-state labels (`HTTP`/`Stdio` is protocol/transport terminology; retain the standard protocol name `HTTP`, translate “Stdio” only if treated as UI wording), saved-connection placeholder, command/args prompts, connection instructions and failure status, saved-connections heading, delete-connection title, server-info field headings, history empty state, request count, and history actions. Convert the interpolated request count to a CLDR message, not a singular suffix expression.
  - `mcp-inspector/ToolsPanel.ts`, `ResourcesPanel.ts`, and `PromptsPanel.ts`: translate the helper-rendered conditionals “No tools/resources/prompts available on this server.” and “Select a tool/resource/prompt from the sidebar.”, plus “Click ‘Call Tool’ to execute.” These `createTextElement()` expressions are easy to miss inside compressed/helper render paths. Also convert remaining helper-generated form labels, action labels, and explanatory UI messages in `ToolArgForm.ts` and `ResourceContentView.ts`. Preserve server-supplied schema labels/descriptions and tool/resource/prompt content as data.
  - `tools-hub/SiteExtensionsTab.ts`: `detail(label, value, ...)` and `badge(value)` render their arguments later, so translate the helper arguments and fallback/error text at the call site. Convert the folder prefix, reload notice, missing/trust state labels, action labels, host/problem/conflict/folder/trust labels, and delete/remove accessibility title. Interpolated sentences such as “Folder: {root}”, “Enable {id}”, and the conflict detail should each be one catalog message.
  - `tools-hub/SearchBoardsTab.ts`: convert status/action labels and whole empty-state sentences; interpolate query/version values as placeholders. Also localize the fixed `GROUP_LABELS` map (`File viewers`, `File editors`, `Tools & apps`) because its values are rendered later as section headings. Board names, versions, descriptions, file masks, size formatting, minimum-version values and server/catalog content remain data.
  - `tools-hub/ToolsHubView.ts` and `ToolsHubEditor.ts`: translate the five hub tab captions and page title. Keep tab values and validation enum tokens stable. The invalid-tab `throw new Error(...)` remains English under E3.
  - Storybook chrome in `storybook/StorybookEditorView.ts`, `PropertyEditor.ts`, and `iconPresets.ts`: convert chrome controls, labels, and empty states. Keep the product name `Storybook` English with `untranslated("Storybook")`. `iconPresets.ts` has stable `id` values (`none`, `folder`, `plus`, `save`, `settings`) separate from the displayed labels, so translate `label` only. Do not edit any `*.story.ts` file; story descriptions, labels, values, and demo content are exempt. `renderGridStory.ts` is a sample story renderer: keep coordinates and stats in English via `untranslated()` because this is demo output, not chrome.
- [x] Reuse `common.loading` for Loading… where shown. There are no Cancel/Open/Remove literals in these surfaces that match `common.cancel`, `common.open`, or `common.remove`; the specific “Remove extension” title has separate meaning. The history count uses its own CLDR message. Catalog source catalogs were checked before adding task-specific messages.
- [x] Use a CLDR category object with `{count}` for the history request count. Every translated full sentence is one catalog message with placeholders; no sentence fragments are concatenated.
- [x] Keep page state titles English for the scripting/API identity. `displayPageTitle()` localizes the MCP Inspector and Tools & Editors page tab captions. Storybook remains English as a product name; the MCP Inspector History Log View title remains English as durable log-facing text.
- [x] Keep thrown errors and technical data English per E3/E5. Use `untranslated()` for visible product/protocol/data text that the lint rule reports.
- [ ] Check the MCP Inspector, Tools hub, and Storybook live under `en-XA`; confirm app-owned copy pseudo-localizes and data/exempt story content remains intact. This requires a running UI and has not been performed in this implementation turn.

### Identity and agent-facing text

These are distinct source-verified identity/data cases. Do not use translated captions as keys or return values.

| Case | Evidence and handling |
|---|---|
| MCP tool name | `mcp-inspector/ToolsPanel.ts` uses `tool.name` as list-box `value`, selected state and keyed subtree identity; `McpInspectorEditorModel.ts` compares it with `selectedToolName` and sends it in the MCP `callTool` request. Keep the server name as English protocol data (`untranslated(tool.name)` only if lint ever sees the dynamic UI position); translate surrounding labels only. Tool titles, schemas, descriptions, argument names and results are server data. |
| MCP prompt name | `mcp-inspector/PromptsPanel.ts` keys rows and compares/selects by `prompt.name`; `McpInspectorEditorModel.ts` uses it in `getPrompt` requests and selection state. Keep it as English server data; translate the UI action and surrounding headings only. Prompt descriptions/messages/results are server data. |
| MCP resource and template identity | `mcp-inspector/ResourcesPanel.ts` keys and selects resources by `resource.uri` and templates by `uriTemplate`; the model reads using those protocol identifiers. Keep URIs/template patterns, names and returned resource content as server data. Translate surrounding labels/actions only. |
| Inspector panels and transports | `McpInspectorEditorModel.ts` stores panel identity as `McpPanelId` (`info`, `tools`, `resources`, `prompts`, `history`); `McpInspectorView.ts` binds each segment caption to its stable `value`. Transport option values are `http` and `stdio`; saved-connection selection uses `connection.id`. Preserve all values/IDs, translate captions. `HTTP` and `MCP` are protocol names. |
| Tools hub tabs | `tools-hub/ToolsHubView.ts` pairs captions with stable `HubTab` values (`builtin`, `boards`, `search`, `tools`, `site-extensions`). `ToolsHubEditor.ts` validates and exposes those values to the scripting facade. Keep values/errors returned to scripts in English; translate tab captions and the page title only. |
| Storybook selection | `storybook/ComponentBrowser.ts` uses `story.id` as list value, while story names and sections are rendered as labels; IDs are persisted selections/deep links (see `storybook/renderGridStory.ts` comment on `virtual-grid`). Preserve IDs and developer-owned story names/sections; story content is exempt. Translate only Storybook chrome labels. `iconPresets.ts` already separates stable preset IDs from captions; preserve IDs and translate captions. |
| Editor/page titles | `McpInspectorEditorModel.ts` initializes page state with `MCP Inspector`; `ToolsHubEditor.ts` defines `Tools & Editors`; `StorybookEditorModel.ts` initializes `Storybook`. A page's displayed title is also exposed through the scripting page facade, so keep an English title field for scripts and use a catalog key for the visible title where it is translatable. `MCP` remains unchanged; `Storybook` stays English as a product name. The one-time history Log View title is durable log-facing text and stays `MCP Inspector History` in English. |
| Tools hub extension and board data | `SiteExtensionsTab.ts` displays extension `entry.id`/`listing.name`, host lists and protocol status values; `SearchBoardsTab.ts` renders published board names, versions, descriptions, masks and catalog properties. These originate in manifests/catalog data and serve as names/identifiers; keep them as data. Translate app-owned labels, status prose, and actions around them. |
| History output | `McpInspectorEditorModel.ts` serializes request history to a Log View page as JSON. Request/response payloads and server messages are data and remain English; the inspector's history count/actions/empty-state UI are translatable. |

No context-menu item in these three folders was found with a translated `label`, so no new menu ID is currently required by D4. Existing buttons have stable `name` values where they are automation targets (for example `mcp-connect`, `mcp-call-tool`, `site-extensions-refresh`, `storybook-reset-props`); preserve those names. If implementation adds any menu item, assign its stable kebab-case `id` before translating the label.

### English text that remains English

- **E3:** all thrown `Error` messages in the scope stay English, including model guards and invalid/replaced-model errors in `McpInspectorEditorModel.ts`, `McpInspectorView.ts`, `ToolsHubEditor.ts`, `ToolsHubView.ts`, `PropertyEditor.ts`, `ComponentBrowser.ts`, and `LivePreview.ts`. Error causes received from servers remain English data; translate only app-owned UI wrappers/fallbacks.
- The invalid-tab `throw new Error(...)` in `ToolsHubEditor.ts:41` is an E3 error and stays English; the lint report at `ToolsHubEditor.ts:49` is the restored visible page title.
- **E5 protocol/data:** MCP tool/prompt/resource names, schemas, resource URIs, server descriptions/instructions/messages, tool results, request/response payloads, transport and connection IDs, paths/URLs/commands/arguments, board/site-extension names and catalog metadata, Storybook story data, numeric values, formatted bytes/versions, and log payloads remain English/data. Preserve the `MCP`, `HTTP`, and `JSON` protocol/format names and shortcuts. For visible fixed product/protocol/file names in a lint position use `untranslated("MCP Inspector")` or the corresponding exact literal; `untranslated("HTTP")` is appropriate where that token is a protocol label. Avoid `untranslated()` for translatable app-owned phrases.
- **Agent/API surface (D3):** scripting API, MCP handlers, AI-vision adapters, declaration/help text are outside the three UI folders and remain English. Do not change those paths in this task.
- **Board-owned content (E5):** any board-provided name, description, or text remains board-owned data.

### Live screen entry paths

- **MCP Inspector:** launch a dev build, then use `app.pages.showMcpInspectorPage()` in Script Execute, or open it from the `+` editor menu when pinned / the Tools & Editors sidebar panel. For a populated screen, call `app.pages.showMcpInspectorPage({ url: "http://host:port/mcp" })` against a local test MCP server; never put credentials in the URL. The inspector's MCP-capable agent path is `pages.showMcpInspectorPage()` as documented by `register-editors.ts`.
- **Tools hub:** use the sidebar Tools & Editors panel header's “Open in new tab” action, the `+` dropdown's “Show All…” action, or `app.pages.showToolsHubPage({ tab: "search" })`. Exercise Built-in, Registered boards, Search boards, Tools, and Site extensions tabs when available.
- **Storybook:** open Storybook from the Tools & Editors list (or `app.pages.showStorybookPage()` from Script Execute; `PagesModel` exposes this method). This checks the editor's toolbar, component browser, live preview, and property editor while leaving story sample content exempt.

All three should be checked after selecting **Settings → General → Language → Pseudo-English** (`en-XA`) in the dev build. The view strings must pseudo-localize while server/manifests/story data remains unchanged.

## Concerns

- The lint rule reports a compressed line as multiple findings and does not classify data versus UI. Each report location must be reviewed in context; several lines contain both static UI copy and dynamic server/user data.
- `SiteExtensionsTab.ts` routes strings through local `detail()` and `badge()` helpers and contains full sentence literals in call arguments/conditional expressions. Translate at the source call site, not inside generic helpers that may also render data.
- MCP server-provided error text is shown in the inspector. Per E3 it stays English; ensure only app-authored fallback and instruction text enters the catalog.
- `renderGridStory.ts` is not a `*.story.ts` file, but its `RenderGridDemoView` runs as sample content inside the Storybook live preview. Treat its cell coordinates and paint/pool statistics (“paints”, “appended”, “removed”, “pool hits”, “misses”, “last paint”) as story/demo output and keep the English rendering via `untranslated()` so the file has no lint report. It is not Storybook chrome.
- This investigation did not edit `doc/epics/EPIC-125.md` or `doc/active-work.md`, as requested. The user will link the task document.

## Acceptance Criteria

- [x] The scoped lint rule has zero reports after the extraction.
- [x] `src/shared/i18n/en/tools.ts` is registered and keys use the current flat `<area>.<entryName>` shape.
- [x] Repeated messages use existing `common` keys; count grammar uses CLDR objects and whole sentences use placeholders.
- [x] Displayed identities/data listed in **Identity and agent-facing text** remain English and independent from translated labels; all translated menu labels (if any are introduced) have stable IDs.
- [x] Errors and named E3/E5 English content remain English; no UI-position literal is left to lint unless deliberately wrapped with `untranslated()`.
- [ ] MCP Inspector, Tools hub, and Storybook chrome have been walked live under `en-XA`; app-owned copy pseudo-localizes and data/exempt story content remains intact. This requires a running UI and remains for the live check.
- [x] No story source (`*.story.ts`), MCP/API handlers, AI-vision, scripting help, epic file, or active-work dashboard is edited by this task.

## Verification

- `npx eslint src/renderer/editors/mcp-inspector/ src/renderer/editors/tools-hub/ src/renderer/editors/storybook/` — passed; zero reports in scope.
- `npm run lint` — passed with 0 errors and 171 repository-wide warnings. The scoped folders have zero `vanilla-view/no-hardcoded-ui-strings` reports.
- `npm run typecheck` — passed.
- `npm run build-prod` — passed.
- `npm run i18n:check` — skipped as requested; the user will run it.
- Live `en-XA` checks — not performed; still to open MCP Inspector, Tools hub and Storybook as listed above.

## Files Changed

| Path | Change |
|---|---|
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts` | Translate editor title/UI-owned static strings; retain thrown errors, IDs, protocol names, and log data. |
| `src/renderer/editors/mcp-inspector/McpInspectorView.ts` | Translate connection UI, headings, instructions, history empty/count/actions; preserve IDs, transport values and server text. |
| `src/renderer/editors/mcp-inspector/ToolsPanel.ts` | Translate tool panel chrome; preserve server tool names/schema/results. |
| `src/renderer/editors/mcp-inspector/ResourcesPanel.ts` | Translate resource panel chrome; preserve names and URI identities. |
| `src/renderer/editors/mcp-inspector/PromptsPanel.ts` | Translate prompt panel chrome; preserve names, descriptions and results. |
| `src/renderer/editors/mcp-inspector/ResourceContentView.ts` | Translate app-owned binary/empty content labels; preserve returned content. |
| `src/renderer/editors/mcp-inspector/ToolArgForm.ts` | Translate generated UI labels; preserve argument/schema data. |
| `src/renderer/editors/tools-hub/ToolsHubEditor.ts` | Translate the visible page title; retain the thrown validation error in English. |
| `src/renderer/editors/tools-hub/ToolsHubView.ts` | Translate hub tab captions; preserve tab values. |
| `src/renderer/editors/tools-hub/SearchBoardsTab.ts` | Translate search/results/actions; preserve catalog data. |
| `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` | Translate site-extension chrome, helper arguments and status prose; preserve extension data. |
| `src/renderer/editors/storybook/StorybookEditorModel.ts` | Keep the Storybook product title English with `untranslated()`; retain the English scripting title. |
| `src/renderer/editors/storybook/StorybookEditorView.ts` | Translate Storybook chrome. |
| `src/renderer/editors/storybook/PropertyEditor.ts` | Translate chrome controls and empty state; preserve story prop names/options. |
| `src/renderer/editors/storybook/iconPresets.ts` | Translate preset captions; retain preset IDs. |
| `src/renderer/editors/storybook/renderGridStory.ts` | Keep sample output in English with `untranslated()`; preserve generated coordinates/data. |
| `src/shared/i18n/en/tools.ts` | New `tools` English catalog. |
| `src/shared/i18n/en/index.ts` | Register/export `toolsCatalog` and include it in flat catalog types. |
| `src/renderer/ui/tabs/page-title.ts` | Localize page-tab presentation for MCP Inspector and Tools & Editors while retaining English state titles for scripting. |
| `doc/tasks/US-1662-tools-strings/README.md` | Mark implementation progress and record verification results/live check remaining. |

Files investigated with no planned changes: all `*.story.ts` story definitions; `src/renderer/editors/mcp-inspector/McpConnectionManager.ts`, `McpConnectionStore.ts`, `ToolResultView.ts`, `index.ts`, `mcp-inspector.css`; `src/renderer/editors/tools-hub/index.ts`, `SiteExtensionsTab.css`; `src/renderer/editors/storybook/storyRegistry.ts`, `storyTypes.ts`, `story-props.ts`, `LivePreview.ts`, `index.ts`; scripting API wrappers/types, MCP handlers, AI-vision adapters, and the remaining catalogs except `common.ts` only if further inspection finds a truly shared missing message. `doc/epics/EPIC-125.md` and `doc/active-work.md` are intentionally not changed.

### Before → after patterns

These examples show the intended shape; implementation should apply the same rule at each inventoried call site.

```ts
// Before: the visible count is assembled from English fragments.
`${count} request${count !== 1 ? "s" : ""} recorded`

// After: one complete CLDR catalog message.
t("tools.historyRequests", { count })
```

```ts
// Before: a translated caption would also become the selected identity.
{ value: "tools", label: "Tools" }

// After: the value stays stable while only the caption is localized.
{ value: "tools", label: t("tools.hubTabTools") }
```

```ts
// Before: generic helper receives English UI strings positionally.
detail("Problem:", listing.reason, "error")

// After: translate the app-owned label at its call site; retain server reason data.
detail(t("tools.problem"), listing.reason, "error")
```
