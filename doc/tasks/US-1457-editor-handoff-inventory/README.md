# US-1457: Editor-handoff inventory

## Goal

Produce the verified, literal checklist for US-1460: every executable call site in `src/` that
passes or assigns a concrete registered editor id, classified as a capability handoff, file-type
creation, editor identity, link-target pipeline seam, or pipeline-resolution seam. This task
changes documentation only; it does not implement the capability service or alter `src/`.

## Background

The required context is [the extension-seams table and Phase A](../../platform-roadmap.md) and
[EPIC-105](../../epics/EPIC-105.md), especially D4-D6. The roadmap's “at least nine” estimate is
an undercount. D6's distinction is applied literally here:

- A handoff opens content already in hand in an editor selected as a policy choice.
- File-type creation creates a document of a type, including the New File menu and specialized
  document builders whose editor is their own fixed format.
- Identity uses name an editor as itself: registration, restore/state construction, a specialized
  editor's own page routing, or a handler constructing its own editor page.
- Link-target rows put the editor id in `ILinkData.target` and send it through `openRawLink`; they
  are the pipeline's editor-selection seam, not page-creating capability invocations.
- Pipeline-resolution rows are the guide parser/resolver itself and are being migrated by
  US-1458, not rewritten as US-1460 handoffs.

The search covered the 31 ids in `EDITORS` in
[`src/renderer/editors/register-editors.ts`](../../../src/renderer/editors/register-editors.ts),
plus `addEditorPage`, `switchTo`, `switchMainEditor`, `openEditorPage`, `showEditorPage`,
`createEditor`, `openRawLink`/`createLinkData` targets, and bare executable editor-id
assignments. There are no literal `openEditorPage` or literal `switchMainEditor` handoff call
sites in `src/`; the `switchTo` hits are Git's unrelated branch switch API or dynamic editor
switch API calls. Non-call occurrences in editor registrations, state/type declarations, the
`EditLinkDialogView.ts:41-48` target-option value list, comments, and documentation examples were
verified but are not additional call sites. The target-option list feeds a later dynamic
`LinkEditor` open; it is an adjacent policy-chooser configuration, not a literal-id invocation.

### Verified result

| classification | count |
|---|---:|
| handoff — in scope | 23 |
| file-type creation — out of scope | 9 |
| identity — out of scope | 23 |
| out of scope — link target | 13 |
| out of scope — pipeline resolution (US-1458) | 2 |
| undecided | 0 |
| **total** | **70** |

The 15 rows that initially looked like handoffs but assign `ILinkData.target` or perform guide
pipeline resolution are deliberately removed from the US-1460 set; they retain their current
editor selection through the pipeline.

### Complete inventory

Each row is one verified literal-bearing call site or assignment. A repeated file with different
lines is intentionally a separate row. The notes column records the row-specific preservation
risk or out-of-scope reason for US-1460.

| file:line | what it does today | trigger (how a user reaches it) | classification | proposed capability id | notes |
|---|---|---|---|---|---|
| `src/renderer/api/pages/PagesLifecycleModel.ts:377` | `addDrawPage()` builds Excalidraw JSON from an image data URL and creates a `draw-view` page. | Script/API caller invokes `pages.addDrawPage`; HTML image-edit also reaches this helper. | handoff — in scope | `image.edit` | Preserve the supplied title or `untitled.excalidraw`; the handler must build the Excalidraw document. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:83` | Creates an empty JavaScript Monaco page named `untitled.js`. | Sidebar New File → Script (JS). | file-type creation — out of scope | — | Empty document creation, not opening existing content in a policy-selected editor. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:90` | Creates an empty TypeScript Monaco page named `untitled.ts`. | Sidebar New File → Script (TS). | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:97` | Creates an empty Excalidraw JSON page. | Sidebar New File → Drawing. | file-type creation — out of scope | — | Empty drawing creation, not image content handed to a drawing handler. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:104` | Creates an empty JSON Grid page. | Sidebar New File → Grid (JSON). | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:111` | Creates an empty CSV Grid page. | Sidebar New File → Grid (CSV). | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:118` | Creates an empty Notebook JSON page. | Sidebar New File → Notebook. | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:125` | Creates an empty Links JSON page. | Sidebar New File → Links. | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts:132` | Creates an empty REST collection JSON page. | Sidebar New File → Rest Client. | file-type creation — out of scope | — | Empty document creation, not a handoff. |
| `src/renderer/editors/draw/index.ts:277` | Exports the drawing as SVG text and opens it in `svg-view`. | Drawing toolbar → Export as SVG. | handoff — in scope | `content.view` | Preserve `getDefaultName("svg")` and XML language; this is a generated SVG, not an Excalidraw payload. |
| `src/renderer/editors/browser/webview-context-menu.ts:227` | Opens fetched page source in a new Monaco HTML page. | Browser webview context menu → View Source. | handoff — in scope | `content.view` | Preserve `Source: <page title or URL>` and HTML language; Monaco remains the accepts-based fallback. |
| `src/renderer/editors/browser/webview-context-menu.ts:240` | Opens the fetched DOM serialization in a new Monaco HTML page. | Browser webview context menu → View DOM. | handoff — in scope | `content.view` | Preserve `DOM: <page title or URL>` and HTML language; Monaco remains the accepts-based fallback. |
| `src/renderer/editors/browser/webview-context-menu.ts:255` | Opens an SVG source string in a new Monaco XML page. | Browser webview context menu → view an SVG resource/source. | handoff — in scope | `content.view` | Preserve the current fixed `untitled.svg` title and XML language; Monaco remains the accepts-based fallback. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:473` | Opens fetched page source in a new Monaco HTML page. | Browser page command/menu path handled by `BrowserWebviewModel`. | handoff — in scope | `content.view` | Duplicate implementation of the source action; preserve title derivation and HTML language; Monaco remains the fallback. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:484` | Opens the fetched DOM serialization in a new Monaco HTML page. | Browser page command/menu path handled by `BrowserWebviewModel`. | handoff — in scope | `content.view` | Duplicate implementation of the DOM action; preserve title derivation and HTML language; Monaco remains the fallback. |
| `src/renderer/scripting/api-wrapper/Text.ts:62` | Opens the wrapper's text in a new Monaco page with its selected language and title. | User/agent runs a script and calls the Text wrapper's `openInEditor()`. | handoff — in scope | `content.view` | Preserve `this._language || "plaintext"`, title fallback `Text`, and content exactly. |
| `src/renderer/scripting/api-wrapper/Mermaid.ts:38` | Opens Mermaid source in a new Mermaid page. | User/agent runs a script and calls the Mermaid wrapper's `openInEditor()`. | handoff — in scope | `content.view` | Preserve wrapper title fallback and Mermaid language. |
| `src/renderer/scripting/api-wrapper/Markdown.ts:38` | Opens Markdown source in a new Markdown preview page. | User/agent runs a script and calls the Markdown wrapper's `openInEditor()`. | handoff — in scope | `content.view` | Preserve wrapper title fallback and Markdown language. |
| `src/renderer/scripting/api-wrapper/Grid.ts:45` | Serializes wrapper data and opens it in a JSON Grid page. | User/agent runs a script and calls the Grid wrapper's `openInEditor()`. | handoff — in scope | `content.view` | Preserve pretty JSON serialization, title, and JSON language. |
| `src/renderer/editors/svg/SvgEditor.ts:71` | Converts the SVG source to a data URL, builds an Excalidraw JSON document, and creates a `draw-view` page. | SVG editor action → Open in Drawing Editor. | handoff — in scope | `image.edit` | Preserve title `<source title>.excalidraw`, SVG MIME, natural dimensions, and the image payload; construction moves behind draw. |
| `src/renderer/editors/mermaid/MermaidEditor.ts:210` | Rasterizes the Mermaid preview, builds an embedded-image Excalidraw document, and creates a `draw-view` page. | Mermaid editor action → Open in Drawing Editor. | handoff — in scope | `image.edit` | Preserve Mermaid-derived title and the rendered SVG image; do not pass Excalidraw JSON to the capability. |
| `src/renderer/editors/mermaid/MermaidEditor.ts:235` | Converts Mermaid source to editable Excalidraw elements and creates a `draw-view` page. | Mermaid editor action → Convert to Excalidraw. | handoff — in scope | `diagram.edit` | This is source-to-diagram conversion, not `image.edit`; preserve `imageOnly` notification behavior and title. |
| `src/renderer/editors/image/ImageEditor.ts:300` | Reads the image pipe/URL, makes a data URL, builds Excalidraw JSON, and creates a `draw-view` page. | Image editor action → Open in Drawing Editor. | handoff — in scope | `image.edit` | Preserve basename-derived `<base>.excalidraw`, MIME, dimensions, and current image bytes. |
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts:789` | Joins collected MCP request entries as JSONL and opens a new Log View page. | MCP Inspector → show/open history. | handoff — in scope | `content.view` | Preserve fixed title `MCP Inspector History`, JSONL language, and one-time new-page behavior. |
| `src/renderer/editors/markdown/CodeBlock.ts:234` | Opens a fenced Mermaid code block as a new Mermaid page. | Markdown preview code-block action for Mermaid. | handoff — in scope | `content.view` | Preserve fixed `Mermaid Diagram` title, Mermaid language, and raw block source. |
| `src/renderer/editors/log-view/items/TextOutputView.ts:136` | Opens a log text entry in a new Monaco page. | Log View item → Open in Editor. | handoff — in scope | `content.view` | Preserve entry language, title fallback `Text`, and text. |
| `src/renderer/editors/log-view/items/MermaidOutputView.ts:123` | Opens a log Mermaid entry in a new Mermaid page. | Log View Mermaid item → Open in Editor. | handoff — in scope | `content.view` | Preserve entry title fallback `Mermaid Diagram`, language, and source. |
| `src/renderer/editors/rest-client/ResponseViewerView.ts:386` | Opens the formatted REST response in a new Monaco page. | REST response viewer → Open in tab. | handoff — in scope | `content.view` | Preserve response-derived language, fixed `Response` title, and formatted body; Monaco remains the accepts-based fallback. |
| `src/renderer/editors/log-view/items/MarkdownOutputView.ts:38` | Opens a log Markdown entry in a new Markdown preview page. | Log View Markdown item → Open in Editor. | handoff — in scope | `content.view` | Preserve title fallback `Markdown`, Markdown language, and source. |
| `src/renderer/editors/rest-client/panels/RestRequestTreeView.ts:170` | Copies a collection into a new REST Client JSON page. | REST Client request tree → collection context menu → Open in New Editor. | identity — out of scope | — | The REST editor is creating another instance of its own document format; it is not handing content to a policy-selected handler. |
| `src/renderer/editors/rest-client/panels/RestRequestTreeView.ts:217` | Copies one request into a new REST Client JSON page. | REST Client request tree → request context menu → Open in New Editor. | identity — out of scope | — | The editor's own internal page creation path, not a cross-capability handoff. |
| `src/renderer/editors/log-view/items/GridOutputView.ts:114` | Serializes log grid data and opens a new JSON Grid page. | Log View grid item → Open in Grid. | handoff — in scope | `content.view` | Preserve pretty JSON, title fallback `Grid Data`, and JSON language. |
| `src/renderer/api/internal/clipboard-image.ts:92` | Opens rich clipboard HTML in a new HTML viewer page, then focuses it. | Global rich-HTML paste fallback when no focused editable/grid handler consumes paste. | handoff — in scope | `content.view` | Preserve `Pasted HTML`, HTML language, and explicit focus of the new page. |
| `src/renderer/editors/rest-client/open-in-rest-client.ts:50` | The REST URL resolver constructs a REST Client page with a generated request document. | Reached by an explicit `rest-client` target from a link/resource opener. | identity — out of scope | — | This is the built-in handler implementation; the handoff rows are its callers, and the handler must retain its request/title parsing. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:390` | Builds a populated Links JSON document, validates `link-view`, and installs the category secondary view. | Script/API caller invokes `pages.openLinks()`. | file-type creation — out of scope | — | A specialized API creates its own link-document format and sidebar state; it is not a target-policy handoff. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:846` | Shows or focuses the singleton About page. | User/agent opens About. | identity — out of scope | — | Dedicated About-page identity and singleton navigation. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:855` | Shows or focuses the singleton Settings page. | User/agent opens Settings. | identity — out of scope | — | Dedicated Settings-page identity and singleton navigation. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:859` | Shows or focuses the singleton Mneme configuration page. | User/agent opens Mneme configuration. | identity — out of scope | — | Dedicated Mneme configuration page identity. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:880` | Creates and shows the MCP Inspector editor model. | User/agent opens MCP Inspector. | identity — out of scope | — | Dedicated MCP Inspector page construction, not content handoff. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:897` | Shows or focuses the Storybook page. | User opens the Storybook/developer page. | identity — out of scope | — | Dedicated Storybook page identity. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:903` | Shows or focuses the Tools & Editors hub. | User/agent opens the Tools Hub. | identity — out of scope | — | Dedicated hub page identity. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:911` | Shows or focuses the video player page. | User/agent opens the video player entry point. | identity — out of scope | — | Dedicated player page identity; the media payload enters through file/link resolution. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:916` | Creates the Image Editor model and adds it as a page. | Image-view helper called by paste, browser resources, HTML preview, REST image response, snip, or link preview. | identity — out of scope | — | This is the built-in image editor's own construction; callers without a literal id are outside this literal-id inventory. |
| `src/renderer/content/parsers.ts:119` | Assigns `category-view` to a `tree-category://` navigation. | Explorer/category link is opened. | identity — out of scope | — | The URI scheme is a category-editor identity route, not a content handoff. |
| `src/renderer/content/parsers.ts:131` | Assigns `git-tree` to a `git-tree://` navigation. | Explorer `.git`/Git Tree navigation is opened. | identity — out of scope | — | The URI scheme identifies the Git Tree page itself. |
| `src/renderer/content/parsers.ts:144` | Assigns `mneme-root` to a `mneme-folder://` navigation. | Explorer Mneme-folder navigation is opened. | identity — out of scope | — | The URI scheme identifies the Mneme root editor itself. |
| `src/renderer/content/parsers.ts:174` | Assigns `board-view` to a `persephone-board://` navigation. | Board panel, Explorer, or board link is opened. | identity — out of scope | — | EPIC-105 D6 treats the board URI as a pure board identity, not a capability payload. |
| `src/renderer/content/parsers.ts:186` | Assigns `toolset-view` to a `persephone-toolset://` navigation. | Tools panel or Explorer toolset link is opened. | identity — out of scope | — | The toolset URI is a pure toolset identity route. |
| `src/renderer/content/parsers.ts:208` | Routes a `persephone-guide://` document to Markdown Preview. | User clicks a mounted guide link. | out of scope — pipeline resolution (US-1458) | — | This is the Layer 2 guide parser; US-1458 is migrating this exact resolution into the scheme registry, so US-1460 must not bypass the pipeline. |
| `src/renderer/content/resolvers.ts:218` | The guide resolver sets `md-view`, creates the guide pipe, and opens content. | Guide link reaches Layer 2 after parsing. | out of scope — pipeline resolution (US-1458) | — | This is the Layer 2 guide resolver; US-1458 is migrating this exact resolution into the scheme registry, so US-1460 must not bypass pipe construction or page reuse. |
| `src/renderer/content/resolvers.ts:240` | Chooses the file's matched editor or falls back to Monaco for a `mneme://` document. | User opens a Mneme document. | identity — out of scope | — | This is editor-resolution fallback inside the Mneme provider, not a user-selected content handoff. |
| `src/renderer/content/resolvers.ts:288` | Detects an explicit `rest-client` target before normal HTTP extension routing. | An HTTP/cURL link carries a REST-client target. | identity — out of scope | — | Explicit target dispatch inside the link pipeline, not a page-creating handoff; its policy seam remains with US-1458/Phase D. |
| `src/renderer/api/board-vars/admin-api.ts:71` | Opens the configured board-vars file with the Env Vars editor. | Board script/API calls the admin “show” operation without an explicit namespace. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/settings/sections/SettingsSections.ts:295` | Settings’ Open Environment Variables button opens the configured file as Env Vars. | Settings → Board environment variables → Open Environment Variables. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/settings/sections/SettingsSections.ts:319` | Rebinds the same Settings button after settings change and opens as Env Vars. | User changes the board-vars path, then clicks Open Environment Variables. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/env-vars/open-env-vars.ts:25` | Opens the configured board-vars file with `envNamespace` and `sourceId` metadata. | A board invokes `persephone.var.show()` / the environment-vars helper. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/content/tree-context-menus.ts:40` | Sends an HTTP or cURL link through the REST Client target. | Link context menu → Open in Rest Client. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/browser/network-log-links.ts:128` | Marks non-GET/HEAD network links for REST Client routing. | Browser → Show Resources/network log, then open a mutating request. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/about/AboutGuidePageView.ts:302` | Opens the current guide in a new Markdown Preview tab. | About guide → Open in tab. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/markdown/MarkdownEditor.ts:95` | Navigates the existing Markdown page back to a saved navigation entry with `md-view`. | Markdown preview back navigation. | identity — out of scope | — | The editor is restoring its own Markdown navigation state; `md-view` names the current editor identity. |
| `src/renderer/editors/markdown/MarkdownBodyView.ts:214` | Navigates the current Markdown page to a clicked Markdown link while retaining `md-view`. | User clicks a link inside Markdown Preview. | identity — out of scope | — | The editor's own internal navigation, including `pageId` and nav-back state, not a cross-editor handoff. |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts:523` | Opens a changed file in File Diff on the current page with staged/head revision metadata. | Git Tree Changes panel → click a changed file. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/renderer/editors/git-tree/CommitDiffPanel.ts:399` | Opens a changed file in File Diff with commit-parent and commit revision metadata. | Git Tree commit → click a changed file. | out of scope — link target | — | `target` is part of `ILinkData` sent through `openRawLink`; replacing it with a capability invoke would bypass Layers 2/3 and lose pipe construction, `pageId` reuse, and `sourceLink` persistence. This belongs to US-1458/Phase D. |
| `src/board-context-menu.ts:59` | Converts a board-frame image/blob/board URL to a readable URL and asks for Image Viewer in a new page. | Trusted board image context menu → Open Image in New Tab. | out of scope — link target | — | This is board-shim code in the board frame: `fire("openRawLink", [href, "image-view"])` crosses the bridge. Replacing it with a capability invoke is a bridge-contract change for Phase B, and would bypass the link pipeline. |
| `src/renderer/core/utils/html-resources.ts:57` | Adds an HTML `<img>` resource link with Image Viewer as fallback target. | Browser/resource panel → image resource link. | out of scope — link target | — | This only assigns `fallbackTarget: "image-view"` on an `ILinkData` record; it is not an invocation. The target belongs to the link pipeline seam (US-1458/Phase D), not US-1460. |
| `src/renderer/core/utils/html-resources.ts:62` | Adds the first `<picture srcset>` source with Image Viewer as fallback target. | Browser/resource panel → picture resource link. | out of scope — link target | — | This only assigns `fallbackTarget: "image-view"` on an `ILinkData` record; it is not an invocation. The target belongs to the link pipeline seam (US-1458/Phase D), not US-1460. |
| `src/renderer/core/utils/html-resources.ts:67` | Adds an image-input resource with Image Viewer as fallback target. | Browser/resource panel → image-input resource link. | out of scope — link target | — | This only assigns `fallbackTarget: "image-view"` on an `ILinkData` record; it is not an invocation. The target belongs to the link pipeline seam (US-1458/Phase D), not US-1460. |
| `src/renderer/editors/browser/BrowserBookmarks.ts:27` | Restores the bookmarks host with `link-view` as its embedded editor state. | Browser restores its bookmarks file. | identity — out of scope | — | State restoration for a Link editor hosted inside browser chrome, not a page handoff. |
| `src/renderer/api/pages/well-known-pages.ts:36` | Registers the MCP UI Log singleton as a `log-view` page definition. | MCP log infrastructure requests the well-known page. | identity — out of scope | — | Registry/page identity declaration, not content handoff. |
| `src/renderer/api/pages/well-known-pages.ts:44` | Registers the MCP server request-log singleton as a `log-view` page definition. | MCP request-log infrastructure requests the well-known page. | identity — out of scope | — | Registry/page identity declaration, not content handoff. |

## Proposed capability seed set

The minimal seed set that covers all 23 in-scope page-creating rows is three ids. The editor
column names the built-in handler that must be registered in `EditorRow`; rows with the same
capability are not allowed to fall back to a concrete editor-id payload.

| capability id | built-in handler | inventory rows |
|---|---|---|
| `image.edit` | `draw-view` | `PagesLifecycleModel.ts:377`, `ImageEditor.ts:300`, `SvgEditor.ts:71`, `MermaidEditor.ts:210` |
| `content.view` | Editor selected by content representation/`accepts`, with Monaco as the fallback | `draw/index.ts:277`, browser source/DOM/SVG rows at `webview-context-menu.ts:227,240,255` and `BrowserWebviewModel.ts:473,484`, `scripting/api-wrapper/{Grid,Markdown,Mermaid,Text}.ts`, `McpInspectorEditorModel.ts:789`, `CodeBlock.ts:234`, all four `log-view/items/*OutputView.ts`, `ResponseViewerView.ts:386`, `clipboard-image.ts:92` |
| `diagram.edit` | `draw-view` | `MermaidEditor.ts:235` |

`content.view` and the former `text.open` rows are one capability: both open content already in
hand and let editor resolution choose the handler. Browser and REST rows land on Monaco because
their HTML/XML/text language is accepted by Monaco, not because they justify another public id.
The shrink from the earlier eight ids to three is the expected result of applying D4 honestly, not
loss of coverage: link-target rows still reach their editor through the existing pipeline exactly
as they do today. Their `ILinkData` payloads remain a US-1458/Phase B/Phase D concern.

`content.view` is intentionally a representation capability, not a generic `invoke(...,
{ editorId })` escape hatch. Its payload carries `{ content, language, title }`; current pipeline
metadata remains with the pipeline until the later link-target work. `image.edit` and
`diagram.edit` are separate because their input contracts are different: an image is bytes/data,
while Mermaid conversion is source text.

## Payload shape and the draw boundary

### Capability payloads

| capability | caller passes | handler is responsible for building |
|---|---|---|
| `image.edit` | Image bytes or data URL, MIME type when known, natural dimensions when already measured, and the exact suggested page title. `PagesLifecycleModel.addDrawPage()` may start with only a data URL. | `draw-view` builds the Excalidraw JSON, embeds the image, caps dimensions, creates the drawing page, and preserves the title. The caller never imports or receives an Excalidraw document. |
| `content.view` | `{ content, language, title }`; the caller supplies the representation and exact title/language, while existing page-creation paths retain their own focus/new-page behavior. | Capability resolution selects the built-in editor by its `accepts`/representation rules, then builds that editor's page from the content. Monaco remains the fallback for the browser and REST text rows. |
| `diagram.edit` | `{ source, title }` containing Mermaid source and the suggested title. | `draw-view` converts source and builds its own Excalidraw document. It returns `DiagramEditResult = { status: "opened", pageId, imageOnly }` or `{ status: "conversion-failed", message }`; conversion failure is a typed outcome, not a throw. The caller retains the existing conversion-failure notification and raster `openInDrawingEditor()` fallback decision, and retains the existing `imageOnly` notification when the opened result has `imageOnly: true`. |

### Current Excalidraw construction and required move

[`src/renderer/editors/draw/drawExport.ts`](../../../src/renderer/editors/draw/drawExport.ts) currently
contains three relevant layers:

- `getImageDimensions()` measures a data URL.
- `buildExcalidrawJsonFromDataUrl()` measures the URL, extracts its MIME, and delegates.
- `buildExcalidrawJsonWithImage()` creates the image element, caps dimensions, embeds the file,
  and serializes the Excalidraw document.
- `buildExcalidrawJsonFromMermaid()` converts Mermaid source into an Excalidraw scene.

Verified callers of these functions are:

| function | callers outside `editors/draw/**` | current behavior |
|---|---|---|
| `buildExcalidrawJsonFromDataUrl` | `PagesLifecycleModel.addDrawPage():374-377` | Builds the document before `addEditorPage("draw-view", ...)`. |
| `buildExcalidrawJsonWithImage` | `ImageEditor.openInDrawingEditor():296-300`, `SvgEditor.openInDrawingEditor():69-71`, `MermaidEditor.openInDrawingEditor():208-210` | Each caller constructs the image data URL, measures it, builds the Excalidraw document, then creates the page. |
| `buildExcalidrawJsonFromMermaid` | `MermaidEditor.convertToExcalidraw():235` indirectly through `conversion` | Converts source into the document before creating the draw page. |

The US-1460 before/after shape is therefore:

```ts
// Before: caller knows the handler's file format.
const json = buildExcalidrawJsonWithImage(dataUrl, mime, width, height);
pagesModel.addEditorPage("draw-view", "json", title, json);

// After: caller sends the image; draw-view owns its document format.
await app.capabilities.invoke("image.edit", {
    dataUrl, mimeType: mime, naturalWidth: width, naturalHeight: height, title,
});
```

`PagesLifecycleModel.addDrawPage()` becomes the public image-edit caller and invokes the same
handler with its data URL/title. It is behind the published `pages.addDrawPage()` script/agent
API, so its signature and observable result must not change: callers still pass the same data URL
and optional title and receive the same `Promise<IPage>`/page-wrapper result. Only its internal
implementation becomes an `image.edit` invocation. `ImageEditor.openInDrawingEditor()`,
`SvgEditor.openInDrawingEditor()`, and the raster branch of
`MermaidEditor.openInDrawingEditor()` stop importing `drawExport`; they pass image payloads. The
Mermaid source conversion branch remains a separate `diagram.edit` invocation and keeps
`buildExcalidrawJsonFromMermaid()` behind the draw handler. No caller outside `editors/draw/**`
may import `drawExport` or construct Excalidraw document JSON after US-1460. Broader imports from
the draw folder remain documented Phase F work.

Concretely, `buildExcalidrawJsonFromDataUrl()`, `buildExcalidrawJsonWithImage()`, and
`buildExcalidrawJsonFromMermaid()` remain inside the draw handler/module. The four page-creating
callers pass image or Mermaid source payloads to that handler and no longer import those builders;
the scripting facade's drawExport imports are the explicitly deferred Phase F exception.

## Current importers of `src/renderer/editors/draw/**` from outside that folder

This is the complete verified list of current imports from outside `editors/draw/**`. For
US-1460, the narrowed exit boundary is specifically that no outside caller imports
`editors/draw/drawExport`: that is the Excalidraw document-construction seam required by D5.
The full list remains useful to Phase F, because registration and scripting-facade imports are
intentional work for the board's exposed `aiVision` model and are not US-1460 leaks.

| importer | current import/use | disposition |
|---|---|---|
| `src/renderer/editors/register-editors.ts:167` | Dynamic `import("./draw")` loads the built-in draw module. | Phase F — retain; this is the standard registration pattern used by the other editor rows, not a `drawExport` leak and nothing US-1460 must clear. |
| `src/renderer/api/pages/PagesLifecycleModel.ts:375` | Dynamic import of `drawExport` for `buildExcalidrawJsonFromDataUrl`. | US-1460 must clear: replace with `image.edit`; keep document construction inside the draw handler. |
| `src/renderer/editors/svg/SvgEditor.ts:8` | Imports `buildExcalidrawJsonWithImage` and `getImageDimensions`. | US-1460 must clear: pass image payload to `image.edit`; retain no `drawExport` import. |
| `src/renderer/editors/mermaid/MermaidEditor.ts:15` | Imports `buildExcalidrawJsonWithImage`, `buildExcalidrawJsonFromMermaid`, and `getImageDimensions`. | US-1460 must clear: pass raster payload to `image.edit` and Mermaid source to `diagram.edit`; retain no `drawExport` import. |
| `src/renderer/editors/image/ImageEditor.ts:19` | Imports `buildExcalidrawJsonWithImage` and `getImageDimensions`. | US-1460 must clear: pass image payload to `image.edit`; retain no `drawExport` import. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:2` | Type-imports `DrawEditor` from `editors/draw`. | Phase F — retain for now; the scripting facade is re-provided through the board's exposed `aiVision` model, not through a US-1460 registration/factory seam. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:71` | Dynamically imports `drawExport` for `addImage()` dimensions/capping and Excalidraw element conversion. | Phase F — retain for now; scripting-facade re-provisioning is Phase F work. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:102` | Dynamically imports `drawExport` for SVG export. | Phase F — retain for now; scripting-facade re-provisioning is Phase F work. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:111` | Dynamically imports `drawExport` for PNG export. | Phase F — retain for now; scripting-facade re-provisioning is Phase F work. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts:21` | Imports `DrawEditor` for the facade factory cast. | Phase F — retain for now; `PageWrapper` participates in the scripting facade re-provisioning and is not a US-1460 boundary action. |

The `src/renderer/editors/draw/**` self-imports in `draw/index.ts`, `DrawBodyView.ts`, and
`drawExport.ts` are intentionally not listed because they are inside the folder. The
`api/types/draw-editor.d.ts` import is not an importer of `editors/draw/**`; it is a public type
file under `api/types`.

## Implementation plan

This is the implementation checklist for US-1460, derived one-for-one from the in-scope rows.
No step in this task implements it.

1. Add the three capability declarations to the `EditorRow` capability column and register the
   built-in handlers with the exact payload contracts above. Keep handler priority and editor
   selection deterministic for `content.view` representations.
2. Rewrite the four `image.edit` call sites and `PagesLifecycleModel.addDrawPage()` to pass image
   data, MIME/dimensions/title metadata, never Excalidraw JSON. Rewrite Mermaid conversion to
   `diagram.edit` with source text. Preserve each title, language, page id, and notification.
3. Rewrite all `content.view` rows. Preserve every explicit language, title fallback, generated
   content string, new-page/focus behavior, and the handler resolution that currently chooses
   Monaco for HTML/XML/text.
4. Clear only the four outside `drawExport` importers listed above. Leave the standard draw
   registration import and the scripting facade/PageWrapper imports for Phase F; do not change
   link-target rows or guide parser/resolver rows in this phase.
5. Exercise the 23 in-scope page-creating rows individually, including both browser source
   implementations, both Mermaid draw paths, the published `addDrawPage()` API, and the content
   rows. Verify the same editor, page/new-page behavior, title, language, content, and focus.

### Files that need no changes for US-1460

The following inventory-only or identity/file-creation files should not be modified by the
handoff rewrite: `src/renderer/ui/sidebar/tools-editors-registry.ts`,
`src/renderer/editors/rest-client/panels/RestRequestTreeView.ts`,
`src/renderer/editors/rest-client/open-in-rest-client.ts`'s document-building logic,
`src/renderer/api/pages/well-known-pages.ts`, `src/renderer/editors/browser/BrowserBookmarks.ts`,
the identity branches in `src/renderer/content/parsers.ts` and
`src/renderer/content/resolvers.ts`, and the Markdown self-navigation methods in
`src/renderer/editors/markdown/MarkdownEditor.ts` and `MarkdownBodyView.ts`.

## Concerns

- `content.view` spans several representations and built-in handlers. Its payload must carry a
  representation/language contract, not a raw editor id, or this audit's seam is only renamed.
- The image-edit rows currently produce Excalidraw JSON in three callers, while
  `addDrawPage()` produces it in `PagesLifecycleModel`; this is the main D5 risk.
- US-1460 must remove the four outside `drawExport` imports used by page-creating handoff callers;
  the broader draw-folder importer list is intentionally not cleared: registration and scripting
  facade/PageWrapper work belongs to Phase F and the board's exposed `aiVision` model.
- The 13 `ILinkData.target` rows are not equivalent to `addEditorPage`: their pipeline constructs
  pipes, reuses pages through `pageId`, and persists `sourceLink`. Bypassing it would change
  behavior and is deferred to US-1458/Phase B/Phase D.
- The two guide rows are the pipeline's own parser/resolver and must remain with US-1458's scheme
  registry migration; they are not missing US-1460 coverage.
- Browser and HTML resource rows have multiple title and source derivation paths. “Same editor” is
  insufficient; the title, MIME/language, data-URL conversion, and new-page behavior must match.
- No row is marked undecided. If implementation discovers that `content.view` cannot preserve a
  representation without exposing an editor id, stop and revise the capability contract before
  editing call sites.

## Acceptance Criteria

- [ ] The inventory table above remains complete against the current `src/` source and reports 70
      literal-bearing sites: 23 handoff, 9 file-type creation, 23 identity,
      13 link-target, 2 pipeline-resolution (US-1458), and 0 undecided.
- [ ] Every in-scope row maps to exactly one proposed `noun.verb` capability and appears in the
      seed-set mapping.
- [ ] Every out-of-scope row has a row-specific reason explaining why it is not a handoff.
- [ ] The payload section states caller input and handler responsibility for every proposed
      capability and contains no Excalidraw payload for `image.edit`.
- [ ] The drawExport callers and all outside importers are listed; US-1460 clears the four
      outside `drawExport` importers, while the registration and scripting-facade entries remain
      explicitly documented as Phase F work.
- [ ] US-1460 preserves the exact page, title, language, content, focus, grouping, namespace, and
      revision behavior recorded in the row notes.
- [ ] This task changes no production source, adds no tests or harness, creates no
      `app.capabilities` implementation, and creates no commit.

## Files Changed

| file | change |
|---|---|
| `doc/tasks/US-1457-editor-handoff-inventory/README.md` | New verified editor-handoff inventory, capability seed/payload proposal, draw-boundary importer audit, and US-1460 checklist. |
| `doc/active-work.md` | Replace the unlinked US-1457 bullet under EPIC-105 Active with a link to this document. |
| `doc/epics/EPIC-105.md` | Link the US-1457 row in the Linked Tasks table to this document. |
