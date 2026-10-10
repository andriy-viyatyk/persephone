# US-1663: Remaining editors and uikit defaults

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** In progress

## Progress

- [x] Audit lint findings, identity cases, English exceptions, and live routes.
- [x] Replace per-call-site uikit localization props with the shared uikit text table plan.
- [x] Extract the linted editor strings, helper-generated strings, and uikit defaults into catalogs; update call sites and stable menu/dialog identities.
- [x] Run scoped ESLint, `npm run lint`, `npm run typecheck`, and `npm run build-prod`.
- [ ] Check affected screens under `en-XA` in the running app.

## Implementation results

- Added 134 catalog keys: 81 to `editors`, 2 to `common`, and 51 across the new `notebook`, `logView`, and `uikit` areas. The uikit text table supplies English defaults for standalone consumers and is initialized once from the active locale in `src/renderer/i18n/startup.ts`.
- The 159 baseline scoped lint findings and audited helper/default strings now produce zero `vanilla-view/no-hardcoded-ui-strings` reports in scope. `npm run lint`, `npm run typecheck`, and `npm run build-prod` pass. Full lint retains 11 board-owned string warnings and one existing unused-variable warning in `src/renderer/components/file-search/FileSearchView.ts`; those are outside this task. `npm run i18n:check` was skipped at the user's direction.
- Twelve grouped identity/agent-facing cases are documented below. Menu IDs were added, `untitled` and product/protocol names preserve English identity, Log View caller labels retain `id === label`, and built-in dialog defaults keep their IDs while translating labels. The `en-XA` live screens below still need manual verification.

## Goal

Extract the remaining app-authored editor and uikit default copy into the English catalogs, keeping editor data, API values, file names, and agent-facing identities stable. Verify every affected editor and default-text component under generated `en-XA` and leave no lint reports in the scoped paths.

## Background

EPIC-125 decisions E1–E7 apply. The extraction convention is the current flat `<area>.<entry>` key shape, lazy `t()` lookup, `{name}` placeholders, and CLDR plural objects for counts. Errors thrown from renderer models stay English; translate only UI-authored framing around them. Existing catalog areas are registered through `src/shared/i18n/en/index.ts`.

The fresh audit used:

```powershell
npx eslint src -f json -o $env:TEMP/us1663-eslint.json
npx eslint src/renderer/editors/notebook src/renderer/editors/log-view src/renderer/editors/text src/renderer/editors/grid src/renderer/editors/video src/renderer/editors/image src/renderer/editors/markdown src/renderer/editors/html src/renderer/editors/mermaid src/renderer/editors/svg src/renderer/editors/monaco src/renderer/editors/base src/renderer/editors/category src/renderer/editors/settings src/renderer/uikit -f json -o $env:TEMP/us1663-scope-eslint.json
```

The scoped file reports **159** instances of `vanilla-view/no-hardcoded-ui-strings`: notebook 44, log-view 14, text 18, grid 13, video 13, image 11, markdown 10, base 10, html 7, mermaid 7, svg 4, monaco 2, and uikit 6. `category/` and `settings/` currently report zero. The full `src` scan has 267 reports outside the two board host files; residual reports in folders assigned to other EPIC-125 tasks are excluded from this task's 159-instance scope.

### Exact scoped lint inventory

Each entry below is the literal at the reported location, grouped by file. Repeated entries are repeated lint reports and need call-site review rather than a second catalog key when context is the same.

| File | Reported UI literals |
|---|---|
| `src/renderer/editors/base/EditorStatusBarView.ts` | `Local file`; `HTTP`; `Mneme`; `script` |
| `src/renderer/editors/base/index.ts` | `untitled` (identity sentinel; see identity section) |
| `src/renderer/editors/base/PageToolbarView.ts` | `File Explorer` |
| `src/renderer/editors/base/TextChromeView.ts` | `Compare with Left Page`; `Run All Script`; `Show Resources`; `No resources found in this HTML.` |
| `src/renderer/editors/grid/components/ColumnsOptions.ts` | `Cancel`; `Apply`; `Edit Columns` |
| `src/renderer/editors/grid/components/CsvOptions.ts` | `\\t` (format token; preserve English/data); `First row is header` (twice); `Other:`; `Delimiter:` |
| `src/renderer/editors/grid/index.ts` | `Edit Columns`; `Csv Options`; `⚙-csv` (format token); `Search...`; `Clear Search` |
| `src/renderer/editors/html/HtmlBodyView.ts` | `HTML Preview` |
| `src/renderer/editors/html/HtmlEditor.ts` | `Image copied to clipboard` |
| `src/renderer/editors/html/index.ts` | `Copy image to clipboard`; `More image actions`; `Save as PNG`; `Open in Image View`; `Edit Image` |
| `src/renderer/editors/image/ImageEditor.ts` | `Failed to load image: {error}`; `Save Image`; `Failed to save image: {error}` |
| `src/renderer/editors/image/ImageToolbarView.ts` | `Save image…` (twice); `Open in Drawing Editor` (twice); `Copy Image to Clipboard (Ctrl+C)` (twice); `Save as .png`; `Save original` |
| `src/renderer/editors/log-view/index.ts` | `Clear log`; `Clear all log entries?` |
| `src/renderer/editors/log-view/items/GridOutputView.ts` | `Open in Grid editor` |
| `src/renderer/editors/log-view/items/MarkdownOutputView.ts` | `Open in Markdown editor` |
| `src/renderer/editors/log-view/items/McpRequestView.ts` | `ERROR`; `ms` (duration unit; preserve as a language-neutral unit) |
| `src/renderer/editors/log-view/items/MermaidOutputView.ts` | `Open in Mermaid editor`; `Copy image to clipboard` (twice); `Rendering...` |
| `src/renderer/editors/log-view/items/TextOutputView.ts` | `Open in Text editor` |
| `src/renderer/editors/log-view/LogBodyView.ts` | `No log entries`; `This log entry failed to render: {error}` |
| `src/renderer/editors/log-view/LogEntryContent.ts` | `[type] render error: {error}` (the entry type itself remains data) |
| `src/renderer/editors/markdown/CodeBlock.ts` | `Open in Editor`; `Copy` (twice); `Mermaid Diagram` |
| `src/renderer/editors/markdown/index.ts` | `Back` (title and button text) (twice) |
| `src/renderer/editors/markdown/MarkdownBlockView.ts` | `Open in New Tab`; `Copy Link` |
| `src/renderer/editors/markdown/MarkdownImage.ts` | `Open in new tab`; `Copy` |
| `src/renderer/editors/mermaid/index.ts` | `Open in Drawing Editor`; `Convert to Excalidraw (editable shapes)`; `Save as PNG`; `Copy Image to Clipboard (Ctrl+C)` |
| `src/renderer/editors/mermaid/MermaidBodyView.ts` | `Failed to copy Mermaid image: {error}` |
| `src/renderer/editors/mermaid/MermaidEditor.ts` | `Couldn't convert to editable shapes ({reason}) - opening as an image instead.`; `This diagram type can't be converted to editable shapes - opened as an image.` |
| `src/renderer/editors/monaco/MonacoBodyView.ts` | `Paste as Markdown / HTML`; `Toggle Word Wrap` |
| `src/renderer/editors/notebook/ExpandedNoteView.ts` | `note title...` (twice); `Collapse (Esc)` (twice); `Category`; `category...` (twice); `tag...` (twice); `Add a comment...`; `+ Add comment` |
| `src/renderer/editors/notebook/index.ts` | `Add Note` (title and button text); `Search...`; `Clear search` |
| `src/renderer/editors/notebook/NotebookBodyView.ts` | `This note failed to render: {error}`; `Notes`; `No notes yet`; `Click "Add Note" to create your first note`; `No notes match the current filter` |
| `src/renderer/editors/notebook/NotebookEditor.ts` | `Are you sure you want to delete "{noteTitle}"?`; `Delete Note`; `Move {count} note from "{fromCategory}" to "{newCategory}"?` / plural form `Move {count} notes from "{fromCategory}" to "{newCategory}"?`; `Move Category` |
| `src/renderer/editors/notebook/note-editor/NoteItemToolbarView.ts` | `Run Script`; `Run All Script` |
| `src/renderer/editors/notebook/NoteItemView.ts` | `note title...` (twice); `Expand`; `Delete`; `Category`; `category...` (twice); `tag...` (once); `Add a comment...`; `+ Add comment`; `Add tag` |
| `src/renderer/editors/notebook/panels/NotebookCategoriesSecondaryView.ts` | `Categories` (three reports) |
| `src/renderer/editors/notebook/panels/NotebookTagsSecondaryView.ts` | `Tags` (three reports) |
| `src/renderer/editors/svg/index.ts` | `Open in Drawing Editor`; `Save as PNG`; `Copy Image to Clipboard (Ctrl+C)` |
| `src/renderer/editors/svg/SvgBodyView.ts` | `Failed to copy SVG image: {error}` |
| `src/renderer/editors/text/ScriptPanel.ts` | `Failed to save script: {error}` (twice); `Save Script to Library`; `Script name:`; `Script "{scriptName}" already exists in "{folder}/". Overwrite?` |
| `src/renderer/editors/text/ScriptPanelView.ts` | `(unsaved script)`; `Run All Script`; `Save Script to Library`; `Open in New Tab`; `Close Script Editor` |
| `src/renderer/editors/text/TextEditorModel.ts` | `untitled` (identity sentinel); `Enter new file name:`; `Rename File` |
| `src/renderer/editors/text/TextFileActionsModel.ts` | `Do you want to save the changes you made to "{title}"?`; `Unsaved Changes` |
| `src/renderer/editors/text/TextFileEncryptionModel.ts` | `File is already encrypted`; `No password set for encryption` |
| `src/renderer/editors/text/TextFileIOModel.ts` | `A file or folder with that name already exists.` |
| `src/renderer/editors/video/AudioControls.ts` | `Next Track` |
| `src/renderer/editors/video/AudioVisualizer.ts` | `Bars`; `Circular`; `No effect` |
| `src/renderer/editors/video/VideoEditor.ts` | `Video Player`; `Save recording as`; `VLC Error` |
| `src/renderer/editors/video/VideoView.ts` | `Save as…`; `Discard`; `Enter a video URL above to start playing`; `Open in VLC`; `Enter video URL or paste cURL command... (Enter to play)`; `Recording action failed: {error}` |
| `src/renderer/uikit/Dialog/DialogContentView.ts` | `Close` (aria label) |
| `src/renderer/uikit/ImageViewport/ImageViewportView.ts` | `Reset Zoom` |
| `src/renderer/uikit/Menu/MenuView.ts` | `Search...` (default placeholder) |
| `src/renderer/uikit/Notification/NotificationView.ts` | `Close` (title) |
| `src/renderer/uikit/Spinner/SpinnerView.ts` | `Loading` (aria label) |
| `src/renderer/uikit/Tree/TreeItemView.ts` | `Loading` (aria label; the same view also has the unreported `Collapse` / `Expand` defaults) |

### Additional text found outside lint's checked positions

The source audit also covered helper arguments, conditional title strings, arrays rendered later, defaults, and dynamically composed text. These are part of the extraction even where ESLint did not report them:

- `src/renderer/editors/notebook/NotebookEditor.ts`: the category move prompt's `count !== 1` interpolation is one CLDR message with `{count}`, `{fromCategory}`, and `{newCategory}`; do not concatenate a singular/plural suffix.
- `src/renderer/editors/video/AudioControls.ts`: `Pause` / `Play`, `Unmute` / `Mute`, and `Shuffle: On` / `Shuffle: Off` are conditional `title` strings. Keep the media action state values (`playing`, `muted`, `shuffle`) as data.
- `src/renderer/editors/base/TextChromeView.ts`: `Run Selected Script (F5)` / `Run Script (F5)` are conditional titles; use one message with a `{shortcut}` placeholder and retain `F5` as the shortcut value.
- `src/renderer/editors/notebook/note-editor/NoteItemToolbarView.ts`: `Run Selected Script` / `Run Script` are conditional titles; add the two whole-message entries and let selection state choose the key, while the selected code remains user content.
- `src/renderer/editors/video/AudioVisualizer.ts`: the `EFFECTS` array stores stable `type` values (`bars`, `circular`, `none`) alongside visible labels. Translate only labels, retaining each `type` for selection and lookup.
- `src/renderer/editors/monaco/index.ts`: `Turn Word Wrap off` / `Turn Word Wrap on` are dynamic titles. The `on` / `off` editor option values stay data.
- `src/renderer/editors/mermaid/index.ts`: `Switch to Dark Theme` / `Switch to Light Theme` are conditional titles; `lightMode` and icon names are state/data.
- `src/renderer/editors/image/ImageView.ts`: the fallback `alt: "Image"` is app-owned accessibility text. A `fpBasename(filePath)` alt is a file name and remains untouched.
- `src/renderer/editors/log-view/items/TextOutputView.ts`: fallback title `"Text"` is app-owned; `entry.title` is caller-provided content.
- `src/renderer/editors/log-view/items/McpRequestView.ts`: `sectionTitle("Request")` / `sectionTitle("Response")` pass fixed visible labels through a helper, and `"(no params)"` / `"(no result)"` are fixed display fallbacks. Translate those four values. `entry.method`, request/response JSON and detail values remain MCP/log data; `ms` is a language-neutral duration unit.
- `src/renderer/editors/html/index.ts`, `src/renderer/editors/image/ImageToolbarView.ts`, and `src/renderer/editors/markdown/MarkdownBlockView.ts`: the positional `MenuItem` objects have visible labels but no `id`. Add unique kebab-case IDs within each menu before translating labels: `save-as-png`, `open-in-image-view`, `edit-image`; `save-as-png`, `save-original`; `open-in-new-tab`, `copy-link`. If a menu groups several editor sources, prefix IDs (`html-`, `image-`, `markdown-`) to avoid collisions in the rendered menu. `name: "markdown-back"` already gives the Back button a stable address; it is a button, not a menu item.
- `src/renderer/editors/text/ScriptPanelView.ts`: `(unsaved script)` is a display label paired with the stable `value: "__unsaved__"`; translate only the label and keep the value unchanged.
- `src/renderer/editors/base/EditorStatusBarView.ts`: `PROVIDER_META` is keyed by stable provider types (`file`, `http`, `mneme`). Translate the `Local file` presentation only; keep `HTTP` (protocol) and `Mneme` (product name) English. The appended archive name is presentation and can reuse the existing editor word if its meaning matches.
- `src/renderer/editors/base/TextChromeView.ts`: source/provider URLs, paths and resource names are data. The fixed `No resources found in this HTML.` notification is app-authored and should be one catalog message.
- `src/renderer/editors/log-view/logTypes.ts` and `src/renderer/editors/log-view/items/ButtonsPanel.ts`: script-supplied Log View dialog buttons currently use the same string as `id` and visible label; `LogViewEditor.resolveDialog()` persists/returns the selected `button`, and `buttonLabel` is a separate display field. Preserve custom caller strings unchanged. For built-in default buttons (`OK`, `Yes`, `No`), split the stable English ID from the translated visible label and keep result comparison on the ID. `ButtonsPanelView` currently keys its view map by label; key it by stable ID so translated labels cannot change identity or remount behavior.
- `src/renderer/editors/log-view/LogEntryContent.ts`: entry `type`, `id`, displayed payload/title, answered button ID/label, and generated log payload remain English/data. Translate only the fixed rendering-failure wrapper, not `errMessage(error)` or the entry payload.
- `src/renderer/editors/notebook/NotebookEditor.ts`: note IDs, categories, tags, note titles/comments/content, category/tag tree labels and language IDs are persisted user data. Translate the delete/move prompts and fixed empty-state/UI copy only.
- `src/renderer/editors/grid/components/CsvOptions.ts`: `,`, `;`, `\\t`, `\t`, header row/column names, and `⚙-csv` are delimiter/format values. Keep those values stable; translate only surrounding field labels.
- `src/renderer/editors/image/ImageEditor.ts`: file paths, basename/title, MIME type, source URL and export name are file/user data. Translate fixed error wrappers and actions; leave `errMessage(err)` English.
- `src/renderer/editors/settings/sections/SettingsSections.ts` and `BoardSettingsSection.ts`: the generic `emptyText` slots receive `t("settings.notLinked")` or `t("settings.boardSettingNotSet")`; Settings call-site grep found catalog-backed labels/messages and no unextracted app-owned helper text. Board declarations remain supplied data.
- `src/renderer/editors/category/**`: hidden-position grep found no `emptyText`, `emptyMessage`, aria label, helper-button text, or count plural literals; path/category labels are provider data.
- Grepping scoped helpers found no remaining local `createButton("…", "…", "Capitalized label", …)` calls; the scan did find and record direct `MenuItem` arrays, helper-rendered `Request` / `Response` labels, conditional titles, the `EFFECTS` and provider metadata maps, and the single count plural above.

### English text retained in a UI position

The following linted values stay English/data by E5. Mark the literal at its UI position so lint can still reach zero; do not put these values into translated model state:

| UI value | Planned treatment |
|---|---|
| `untitled` default-title sentinel | `untranslated("untitled")`; keep all exact equality checks and persisted values stable. |
| `HTTP`, `Mneme` provider badge names | `untranslated("HTTP")` for the protocol and `englishMessage("editors.mneme")` (or `untranslated("Mneme")` if the catalog key is not used at that site) for the product. |
| CSV display token `\\t` and `⚙-csv` format marker | `untranslated("\\t")` and `untranslated("⚙-csv")`; keep comma/semicolon/tab values unchanged. |
| Log duration suffix `{durationMs}ms` | ``untranslated(`${durationMs}ms`)``; the numeric duration and unit remain the existing neutral format. |
| Shortcuts embedded in copied-image/video labels (`Ctrl+C`, `F5`, `Esc`, `Enter`) | Put the shortcut in a `{shortcut}` / `{key}` placeholder and pass the exact English shortcut value; translate the surrounding instruction. |
| Filenames, path basenames, provider URLs, MCP methods, image MIME/format names, media values, board-provided slots | These are dynamic data rather than literal UI strings; keep them as supplied. Where a literal file/product name is used in a linted slot, wrap it with `untranslated(...)`. |

When a stable English identity itself is intentionally displayed and has a catalog message, render `englishMessage(key)` for that value. This applies only to the English identity field, never to the translated UI label. For Log View's older answered entries that have a built-in `button` ID but no `buttonLabel`, resolve a known built-in ID through its `englishMessage(key)` mapping; unknown/custom IDs keep their original caller label.

### English values and errors retained by E3/E5

- **Thrown errors (E3):** keep every `throw new Error(...)` in `src/renderer/editors/{base,category,grid,html,image,markdown,mermaid,monaco,notebook,svg,text,video}/**` English. Fixed identity/model errors include `Monaco not mounted`, `Monaco view received an invalid model.`, `Mermaid view received an invalid model.`, `Grid view received an invalid model.`, `Grid view received a different model instance.`, `Markdown view received an invalid model.`, `Markdown view received a different model instance.`, `Notebook view received an invalid model.`, `Notebook view received a different model instance.`, `NotebookEditor: pageModel accessed before adoptHost`, `HTML preview is not mounted`, `HTML preview has no visible area to capture`, `HTML view received an invalid model.`, `HTML view received a different model instance.`, `Image view received an invalid model.`, `Image view received a different model instance.`, `No image to export`, `Video view received an invalid model.`, `Video view model identity cannot change while the view is mounted.`, `This video is not an unsaved recording.`, `SVG view received an invalid model.`, `TextFileModel.fromDescriptor: unsupported kind "{kind}"`, `Category view received an invalid model.`, `Category tile view received list props.`, and `Editor "{kind}" is not embeddable (no BodyView slot)`. Registry/host/switch errors also remain English: `Unknown language "{language}". Read editors.languages for the valid ids.`, `No editor registered for id: {id}`, `Editor module "{id}" is not loaded yet (startup preload still running). Retry in a moment.`, `Folder switch unavailable: "{newEditorId}" is not offered for "{anchorFolder}".`, `Folder switch unavailable: editor "{newEditorId}" has no folder factory.`, `{Class} does not implement switchFrom`, `Host already extracted from {displayName} editor`, `{displayName} editor switchFrom: {editorId} has no CONTENT_HOST_TRAIT`, and `{displayName} editor switchFrom: extracted host is not a TextFileModel`. Action failures retained as thrown messages include `Mermaid preview cannot export PNG because rasterisation failed: {error}`, `Mermaid preview cannot open in Drawing Editor: {error}`, `Mermaid preview cannot convert to Excalidraw because the source is empty or unavailable.`, `Mermaid preview cannot open the Excalidraw page: {error}`, `Mermaid preview cannot copy an image: {error}`, `Mermaid preview cannot {action} because the source is empty or unavailable.`, `rendering returned no SVG`, `Mermaid preview cannot {action} because rendering failed: {error}`, `SVG preview cannot export PNG because rasterisation failed: {error}`, `SVG preview cannot open in Drawing Editor: {error}`, `SVG preview cannot copy an image: {error}`, `SVG preview cannot {action} because the source is empty or unavailable.`, `No editor registered for id: {newEditorId}`, `Folder View action unavailable: no provider host is attached.`, and `Folder View action unavailable: invalid category breadcrumb.` UI notifications/dialog wrappers may translate fixed framing, but thrown messages and `errMessage(error)` values remain English.
- **Data and formats (E5):** file paths/basenames, URLs, user titles/content/comments, notebook note/category/tag IDs and values, resource names, script names/paths, log entry payloads/IDs/types, MCP method/params/result/error, provider source URLs, and board-provided status-bar slot content stay as supplied. Keep CSV delimiter values `,`, `;`, tab/`\\t`, CSV/JSON/JSONL, MIME types, SVG/PNG, `on`/`off`, `ms`, and editor/language IDs stable.
- **Shortcuts and product/protocol names (E5):** keep `Ctrl+C`, `F5`, `Esc`, and `(Enter to play)` unchanged as shortcut values/placeholders. Keep Persephone, MCP, HTTP, Mneme, Monaco, VLC, Mermaid, SVG, PNG, cURL, and Excalidraw unchanged wherever they are product, protocol, format, command, or tool names. Board-owned labels/copy remain in phase 3; only host-owned chrome around board slots is extracted.

## Identity and agent-facing text

Keep these distinct from ordinary copy. Do not use translated labels for comparisons, IDs, stored values, script/MCP results, or agent lookup:

| File / value | Identity or agent use | Handling |
|---|---|---|
| `src/renderer/editors/base/index.ts`, `src/renderer/editors/text/TextEditorModel.ts`, `src/renderer/editors/base/TextHostEditorModel.ts`, `src/renderer/editors/text/TextFileIOModel.ts`, `src/renderer/editors/image/ImageEditor.ts`, `src/renderer/editors/monaco/MonacoEditor.ts` — `untitled` | Default title sentinel is checked with `=== "untitled"` when opening image files, selecting Monaco language, saving/renaming, and distinguishing a new in-memory page. The title also travels in editor/page state. | Preserve the sentinel exactly as English with `untranslated("untitled")` at the default UI/title assignments. Keep comparisons and persisted title behavior unchanged; do not put localized `t("…")` output into model state. |
| `src/renderer/editors/notebook/NotebookEditor.ts` — `untitled.note.json`; `src/renderer/editors/base/TextHostEditorModel.ts` — `untitled` / file-editor override names | Synthetic file names used as file/page identity and matched by extension/file logic. | Keep literal file names English and unchanged; use `untranslated("untitled.note.json")` if it occupies a linted UI position. |
| `src/renderer/editors/text/ScriptPanelView.ts` — `UNSAVED_ENTRY.value` | `"__unsaved__"` is the dropdown sentinel used by `ScriptDropdownEntry`; selected script identity is by `value`, not label. | Preserve the value; translate only `(unsaved script)` via a catalog key at display time. |
| `src/renderer/editors/text/ScriptPanel.ts` — `name = "script"` | Stable editor-state/storage slot name for the Script Panel, distinct from the footer's visible `script` label. | Keep the storage name unchanged; localize only the footer label in `EditorStatusBarView.ts`. |
| `src/renderer/editors/log-view/logTypes.ts`, `src/renderer/editors/log-view/items/ButtonsPanel.ts`, `src/renderer/editors/log-view/LogViewEditor.ts` — button `id` / `label` / `buttonLabel` | Script/MCP-supplied choices and `resolveDialog()` results expose the chosen button string; answered log entries preserve button and display label separately. Existing `normalizeLogDialogButtons()` derives `id` from `label`, and `ButtonsPanelView` currently maps views by label. | Keep custom script-provided buttons as `id === label`. For host-owned defaults only, use a stable English ID and translated label (`englishMessage(key)` when the ID itself is shown as English identity); return/store the ID and store the translated label only in `buttonLabel`. Key the UI view map by ID. |
| `src/renderer/editors/log-view/logTypes.ts` — entry `type`, `id`, `items`, `selected`, `button`; `src/renderer/editors/log-view/LogEntryContent.ts` | Log entries are persisted/agent-authored payloads; their discriminator, IDs, choices and text are returned by the scripting API and rendered by Log View. | Keep the complete caller payload and data fields untouched. The only new translations are host-owned controls, empty state, output action titles, MCP request/response section headers, fixed no-data fallback labels, and failure wrapper. |
| `src/renderer/editors/notebook/notebookTypes.ts`, `src/renderer/editors/notebook/NotebookEditor.ts`, `src/renderer/editors/notebook/category-tree.ts`, `src/renderer/editors/notebook/note-editor/NoteItemToolbarView.ts` | Note/category/tag IDs and values, content, persisted editor/language IDs and search/filter values are data and are exposed through the notebook editor facade. | Keep all data and facade values stable. Translate fixed control labels/placeholders and prompts only. Stable editor-switch IDs remain editor IDs. |
| `src/renderer/editors/video/AudioVisualizer.ts` — `EffectType` | `type` (`bars`, `circular`, `none`) drives selected effect and title lookup. | Translate `label` only; use `type` for state, persistence and comparison. |
| `src/renderer/editors/base/EditorStatusBarView.ts` — provider keys `file`, `http`, `mneme` | Keys are content-provider types used for map lookup; `HTTP` and `Mneme` themselves are protocol/product names. | Preserve keys; translate `Local file`, use `untranslated("HTTP")` and `untranslated("Mneme")` in displayed badge text. If the product/protocol is represented by an existing catalog key, render it with `englishMessage(key)`. |
| `src/renderer/editors/markdown/index.ts` — Back button `name: "markdown-back"` | Stable `data-name` used by UI automation/AI-vision. | Keep the name exactly; translate the button's `title` and `children`. |
| `src/renderer/editors/notebook/NoteItemToolbarView.ts`, `src/renderer/editors/monaco/MonacoBodyView.ts`, and other editor toolbars — existing `name` / `data-name` values | These are agent-facing selectors; AI-vision snapshots and editor guides address controls by their names/IDs. | Preserve all names, IDs and selectors. Translate only visual title/label text. |
| `src/renderer/editors/html/index.ts`, `src/renderer/editors/image/ImageToolbarView.ts`, `src/renderer/editors/markdown/MarkdownBlockView.ts` — menu entries | Menu actions are found by ID across locales per D4. | Add stable kebab-case IDs listed above before translating labels. Any additional converted menu label discovered during implementation gets an ID unique within its menu. |

The app-owned fixed title `"Text"` in `TextOutputView.ts` and fixed accessibility fallback `"Image"` in `ImageView.ts` are not identities; give them catalog messages. Filenames, page titles supplied by users, resource names, and script-provided log text remain caller data. No scoped label is read by `scripting/ai-vision/**` as a matching key: agents address these controls through existing `data-name`/IDs and editor IDs. Keep those selectors stable.

## Implementation Plan

### 1. Add and reuse catalog entries

- Extend `src/shared/i18n/en/editors.ts` for shared editor chrome and the text, grid, image, video, HTML, Markdown, Mermaid, SVG, Monaco, and base-editor messages. Add entries for fixed editor actions, accessibility labels, defaults, empty states, notifications and error wrappers. Reuse existing `editors.saveImage`, `editors.failedToSaveImage`, `editors.saveImageAs`, and other semantically matching entries rather than adding duplicates.
- Add `common.apply` and `common.close` to `src/shared/i18n/en/common.ts` for the repeated generic button/aria labels `Apply` and `Close`; use those shared keys across grid, uikit, and editor call sites.
- Add `src/shared/i18n/en/notebook.ts` for notebook controls, empty states, prompts and secondary panel headings.
- Add `src/shared/i18n/en/logView.ts` for Log View controls, output action titles, empty/error wrappers, and fixed request/response fallbacks. Reuse `dialogs` for built-in dialog button labels.
- Add `src/shared/i18n/en/uikit.ts` for primitive defaults not already covered by `common` or `menus`.
- Register new catalog modules in `src/shared/i18n/en/index.ts`. Keep all keys flat and resolve `t()` at view/model presentation time, not module initialization.
- Reuse `common.cancel`, `common.open`, `common.remove`, and `common.loading`; reuse `menus.searchPlaceholder`, `menus.clearSearch`, `menus.copy`, and `menus.save` for equivalent editor controls; reuse existing `dialogs.buttonCancel`, `dialogs.buttonCopy`, and other dialog button entries when they match. `common` currently has no generic `apply`, `close`, `copy`, or `save`; add only the shared `common.apply` and `common.close` entries needed by this scope. Reuse `editors.saveImage`, `editors.failedToSaveImage`, `editors.saveImageAs`, `editors.preview`, and existing editor names where semantics match. Reuse `board.fileExplorer` for the same File Explorer action, `board.saveChangesTitle` / `board.saveChangesConfirmation` for the same unsaved-change dialog, and `shell.archive` for the archive provider label when the context matches. Reuse `shell` only when an existing key has the same meaning; do not use `shell` as a general editor catalog. Reuse `api` messages for an API-owned failure only when the whole message and placeholders match exactly. Add no duplicate `Cancel`, `Open`, `Remove`, `Loading`, `Search...`, `Copy`, `Save Image`, or `Save Image As` message when an existing key has the same context.

Before:

```ts
placeholder: "Search..."
```

After:

```ts
placeholder: t("menus.searchPlaceholder")
```

### 2. Convert editor UI and preserve editor contracts

- `src/renderer/editors/base/EditorStatusBarView.ts`: localize `Local file` and the fixed `script` toggle label. Keep provider map keys and provider names `HTTP` / `Mneme` stable as described above. Preserve source URL and archive/provider metadata.
- `src/renderer/editors/base/PageToolbarView.ts`, `src/renderer/editors/base/TextChromeView.ts`, and `src/renderer/editors/base/index.ts`: localize `File Explorer`, the Compare/Run/Resources tooltips and resource notification. Keep `untitled` as the English identity sentinel and mark only its UI-position use with `untranslated()`.
- `src/renderer/editors/text/ScriptPanel.ts`, `ScriptPanelView.ts`, `TextEditorModel.ts`, `TextFileActionsModel.ts`, `TextFileEncryptionModel.ts`, and `TextFileIOModel.ts`: localize fixed script library actions/prompts, notifications, and unsaved-change text. Preserve script path/value IDs, the `__unsaved__` selector, `untitled`, file names, encryption state and caller-provided script names. Whole prompt/confirmation sentences use placeholders.
- `src/renderer/editors/grid/components/ColumnsOptions.ts`, `src/renderer/editors/grid/components/CsvOptions.ts`, and `src/renderer/editors/grid/index.ts`: localize column controls, CSV option labels, search and clear actions. Keep delimiter characters, `\\t`, CSV/format IDs, column names and search values as data.
- `src/renderer/editors/image/ImageEditor.ts`, `ImageToolbarView.ts`, `ImageView.ts`: localize fixed action labels, image fallback alt text, notifications and whole failure wrappers. Keep file names, path-derived titles, MIME values, URL, export names, and shortcut `Ctrl+C` as values/placeholders. Reuse editor catalog image-save keys where applicable.
- `src/renderer/editors/html/HtmlBodyView.ts`, `HtmlEditor.ts`, and `index.ts`: localize preview accessibility title, copy notification and image action menu labels. Preserve image bytes, URL, file names and capture state. Add menu IDs as specified in the identity section.
- `src/renderer/editors/markdown/CodeBlock.ts`, `MarkdownBlockView.ts`, `MarkdownImage.ts`, and `index.ts`: localize code/image actions, diagram caption, Back title/text and context menu labels. Keep shortcut values and link/file data unchanged; add menu IDs before translating labels.
- `src/renderer/editors/mermaid/MermaidBodyView.ts`, `MermaidEditor.ts`, and `index.ts`: localize action labels, conditional theme titles and UI error wrappers. Translate the two fixed conversion outcome messages as single messages, using `{reason}` for `result.message` where included. Keep Mermaid source, renderer exception text and SVG/PNG data as data.
- `src/renderer/editors/svg/SvgBodyView.ts` and `index.ts`: localize action labels and fixed failure wrappers, preserving SVG source, file names and export values.
- `src/renderer/editors/monaco/MonacoBodyView.ts` and `index.ts`: localize paste/toggle labels and conditional Word Wrap titles. Preserve Monaco command IDs, `on` / `off`, clipboard data and editor state.
- `src/renderer/editors/video/AudioControls.ts`, `AudioVisualizer.ts`, `VideoEditor.ts`, and `VideoView.ts`: localize control titles, visualizer labels, dialog title, prompts, notifications and failure framing. Keep URLs, cURL payloads, recording paths, VLC exception text, media state and effect type values stable. Shortcuts inside labels remain English values/placeholders.
- `src/renderer/editors/category/**`: no lint report and no app-owned label was found that needs extraction. Folder names, path segments and category labels are data; do not translate them.

### 3. Convert notebook and Log View surfaces with stable identity

- `src/renderer/editors/notebook/ExpandedNoteView.ts`, `NoteItemView.ts`, `NotebookBodyView.ts`, `NotebookEditor.ts`, `index.ts`, `note-editor/NoteItemToolbarView.ts`, `panels/NotebookCategoriesSecondaryView.ts`, and `panels/NotebookTagsSecondaryView.ts`: localize note controls, placeholders, headings, empty states, tag action, secondary panel titles, delete/move prompts and script actions. Preserve note/category/tag/content values and editor IDs. Implement the note move prompt as one CLDR object with `one` and `other`, passing `count`, `fromCategory`, and `newCategory`.
- `src/renderer/editors/log-view/index.ts`, `LogBodyView.ts`, `LogEntryContent.ts`, and `items/{GridOutputView,MarkdownOutputView,McpRequestView,MermaidOutputView,TextOutputView}.ts`: localize clear action/confirmation, empty state, built-in output action titles, fixed ERROR marker, loading state, and render-failure wrappers. Keep message/output contents, entry types/IDs, elapsed `ms`, and user/script-provided titles untouched.
- `src/renderer/editors/log-view/logTypes.ts`, `items/ButtonsPanel.ts`, and each default dialog view under `src/renderer/editors/log-view/items/`: give host-owned default button options stable IDs and translated labels. Keep arbitrary script-provided labels as their own stable ID and displayed text. Change the internal button-view map to use ID rather than localized label; preserve the existing `resolveDialog(id, button, buttonLabel)` contract and serialize the English ID separately from `buttonLabel`.

### 4. Provide uikit defaults through a shared text table

UIKit stays independent of the app catalog. Add `src/renderer/uikit/shared/uikit-text.ts` with a typed set of English defaults, `uikitText(name)`, and `setUikitText(overrides: Partial<...>)`. Components resolve defaults through `uikitText(...)` when they render. Standalone consumers continue to get English defaults; Persephone has one explicit initialization point instead of many optional props whose omission silently leaves English.

Include all component defaults, including `close`, `loading`, `collapse`, `expand`, `resetZoom`, `searchPlaceholder`, `noRows`, `noResults`, `noItems`, `progress`, `removeTag`, `moreActions`, `tagsInputPlaceholder`, `all`, and `selectAll`, plus any others found in audit. In `src/renderer/i18n/startup.ts`, after `setActiveLocale` / `setLocalePacks` and before views mount, call `setUikitText` once with catalog-backed values. The locale is fixed per window (EPIC-125 D5), so one-time initialization is correct. Reuse `common.close`, `common.loading`, and `menus.searchPlaceholder` when their meaning matches; put remaining shared primitive defaults in the `uikit` area. Explicit caller props such as `emptyMessage`, `ariaLabel`, and `placeholder` remain authoritative.

Add one short rule to `src/renderer/uikit/CLAUDE.md`: default user-visible text in a uikit component comes from `uikitText()`, never a literal. No uikit component imports the app catalog.

### 5. Verify en-XA live and lint

- For each screen below, set `Settings > General > Language > Pseudo-English (en-XA)` in the dev build, open the screen through the listed MCP path/UI route, and snapshot visible text plus `title`, `placeholder`, `aria-label`, button labels and menu items. Any plain English must be explained as E3/E5 data or corrected.
- Check layout under the approximately 35% longer pseudo copy: notebook note rows/toolbar and comment input; grid toolbars/options; image/HTML/Mermaid/SVG action menus; video controls and URL prompt; Log View output cards and interactive dialogs; and uikit Storybook examples for empty Select/ListBox/MultiListBox/Tree, spinner, notification, menu, tag, split button, progress and dialog close controls.
- Re-run scoped lint with JSON output and filter `vanilla-view/no-hardcoded-ui-strings`; target is zero reports in all paths listed above. Do not change the lint rule in this task.

| Screen / editor | Live route to check |
|---|---|
| Notebook | MCP `script.execute`: `app.pages.addEditorPage("notebook-view", "json", "Audit.note.json", JSON.stringify({ notes: [], state: {} }))`; this matches the required editor, language and suffix in `persephone://guides/pages`. Also open a `.note.json` fixture through File > Open. Add a note, category, tag and comment to expose populated states. |
| Log View | MCP `script.execute`: `app.pages.addEditorPage("log-view", "jsonl", "Output.log.jsonl", '{"type":"log.info","text":"audit"}')`, or use `pages.logView.push(entries)`; the Log View guide is `persephone://guides/log-view`. Also reach it from the app's MCP request log/status indicator. |
| Text Editor / Script Panel | MCP `script.execute`: `app.pages.addEmptyPage()` creates the blank Text Editor page; use the status-bar `script` control to open the Script Panel. Open a `.txt` fixture with `app.pages.openFile(path)` to exercise save/rename; exercise unsaved close and script-library flows. |
| Grid JSON / CSV / JSONL | MCP `script.execute`: `app.pages.addEditorPage("grid-json", "json", "Audit.grid.json", '[{"a":1}]')`; add CSV with `app.pages.addEditorPage("grid-csv", "csv", "Audit", "a,b\\n1,2")` and JSONL with `app.pages.addEditorPage("grid-jsonl", "jsonl", "Audit", '{"a":1}')`. These follow `persephone://guides/pages`. Open Edit Columns, CSV Options and search. |
| Video | Open a local video with MCP `script.execute` `await app.pages.openFile(path)`; for transport-neutral UI checks use the Video Player and its blank URL field. Exercise playback/audio controls and VLC action where configured. |
| Image | Open a local image with `await app.pages.openFile(path)` or use Open URL; exercise save, drawing editor and copy actions. |
| Markdown | MCP `script.execute`: `app.pages.addEditorPage("md-view", "markdown", "Audit.md", "[local](other.md)")` or open a `.md` file; exercise code/image context menus and follow an internal link to reveal Back. |
| HTML | MCP `script.execute`: `await app.pages.openFile(path)` for a valid `.html` fixture containing an embedded image; use its image to reveal image actions. |
| Mermaid | MCP `script.execute`: `app.pages.addEditorPage("mermaid-view", "mermaid", "Diagram", "graph TD; A-->B")`, or render a Mermaid block in Markdown/Log View; exercise theme, export, convert and copy actions. |
| SVG | Open a `.svg` file with `await app.pages.openFile(path)`; exercise drawing editor, PNG save and copy actions. |
| Monaco | MCP `script.execute`: `app.pages.addEditorPage("monaco", "plaintext", "Audit.txt", "hello")`, or open a code file then choose Monaco with the editor switcher. Open the context menu and toggle Word Wrap. Monaco's native find widget language belongs to US-1664. |
| Shared base chrome | Reuse each text-host/editor route above; inspect Compare, Run, Resources, provider badge, File Explorer, status bar, and `untitled` pages. |
| Category / Folder View | MCP `script.execute`: `await app.pages.openFile(folderPath)`; verify the folder editor and category/path names stay data. |
| Settings leftovers | MCP `script.execute`: `app.pages.showSettingsPage()`; inspect Settings tree/search only for any app-owned blind-spot text. The scoped lint report is currently zero; do not duplicate US-1652 strings. |
| UIKit defaults | Open Storybook from `Tools & Editors` and inspect the component stories that render the defaults above; visit the app screens listed here to verify startup initialized the shared text table for this locale. |

## Concerns

- Log View choices are both UI and script/MCP results. Translating a built-in default label without splitting ID and display label would change result identity; custom caller text must not be translated.
- `untitled` and synthetic names are used as state/file identity. Putting `t()` into persisted model state would break `=== "untitled"` checks. Use the English sentinel and only localize an independent display label if later needed.
- Menu IDs need a uniqueness check per actual menu, including if HTML image actions are composed into a shared popover. Automation must click by ID in every locale.
- UIKit text defaults are initialized once per window from the active locale through `uikitText`; standalone consumers retain English values. Preserve explicit caller-provided values and keep `src/shared/i18n` out of UIKit components.
- `en-XA` may make the notebook toolbar, grid options, video controls, and small menus overflow; record concrete live layout issues for US-1665 rather than silently shortening translations.
- Error messages in `errMessage(error)`, script/MCP payloads, file names, URLs, language IDs, editor IDs, media values and keyboard shortcuts remain English/data under E3/E5. Only app-authored wrappers are catalog messages.

## Acceptance Criteria

- The 159 scoped lint reports and uncovered app-owned literals/defaults are extracted or explicitly kept English by E3/E5, with zero `vanilla-view/no-hardcoded-ui-strings` reports across the task paths.
- Catalog keys remain flat, typed and lazily resolved. Common words reuse `common`, `menus`, `dialogs`, `editors`, `shell`, or `api` only where the existing meaning matches; count text uses CLDR, and sentence fragments are replaced by whole messages with placeholders.
- No uikit primitive imports the app catalog. All defaults resolve through `uikitText()` and retain English fallback values; Persephone initializes the table once from `t(...)`, and explicit custom props continue to override defaults.
- Log View preserves script/MCP button IDs, data values and custom labels; built-in visible button labels translate independently and `buttonLabel` remains distinct from returned `button` identity.
- All converted menu items have stable unique IDs. Editor IDs, `data-name`, note/category/tag values, persisted fields and default-title identity remain stable.
- Every listed editor and component-default surface has been checked live under `en-XA`; any plain English is documented as an E3/E5 value or removed from the UI.

## Files Changed Summary

| File(s) | Planned change |
|---|---|
| `src/shared/i18n/en/common.ts`, `editors.ts`, `notebook.ts`, `logView.ts`, `uikit.ts`, `index.ts` | Add/reuse typed messages and register the new family catalogs. |
| `src/renderer/editors/base/**`, `text/**`, `grid/**`, `video/**`, `image/**`, `markdown/**`, `html/**`, `mermaid/**`, `svg/**`, `monaco/**` | Localize editor-owned UI and dynamic whole messages; preserve IDs/data and correct menu identity. |
| `src/renderer/editors/notebook/**` | Localize note UI, empty states, prompts, secondary panels and CLDR move prompt. |
| `src/renderer/editors/log-view/**` | Localize host-owned Log View UI and split built-in button identity from translated display labels. |
| `src/renderer/uikit/shared/uikit-text.ts` and uikit default-text components | Add typed English defaults and resolve every default through `uikitText()` at render time; preserve explicit props. |
| `src/renderer/i18n/startup.ts` | Set the app's uikit text table once after the active locale is installed and before mounting views. |
| `src/renderer/uikit/CLAUDE.md` | Document the rule that component defaults use `uikitText()`. |
| `src/renderer/editors/category/**`, `src/renderer/editors/settings/**` | No changes expected: current scoped lint has zero reports; category/folder labels and remaining Settings values are data or owned by US-1652. |
| `src/board-context-menu.ts`, `src/board-shim.ts`, `src/shared/i18n/plurals.ts`, ESLint rule/configuration | No changes: board-owned copy is phase 3, plural behavior already exists, and lint-rule changes belong to US-1665. |
