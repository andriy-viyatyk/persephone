# US-1460: `app.capabilities` and the handoff call sites

**Status:** Planned · **Epic:** [EPIC-105](../../epics/EPIC-105.md) · **Depends on:** reviewed
[US-1457](../US-1457-editor-handoff-inventory/README.md) and the service-registration mechanism
from US-1462

## Goal

Seed the thin built-in `app.capabilities` seam from the editor registration table and rewrite the
23 page-creating handoff sites in the US-1457 checklist to call `invoke()`, with no user-visible
change. Move Excalidraw document construction behind the drawing handler so the four outside
`drawExport` importers disappear, while leaving link-target and editor-identity work to the tasks
that own those seams.

This document is investigation and planning only. It changes no production source, adds no tests,
does not modify US-1457, `EPIC-105.md`, or `active-work.md`, and creates no commit.

## Background

### Binding decisions and source state

The binding constraints are [EPIC-105](../../epics/EPIC-105.md) D4, D5, D6, D8 and D9, the
reviewed [US-1457 inventory](../US-1457-editor-handoff-inventory/README.md), and
[platform-roadmap.md §3.1](../../platform-roadmap.md#31-capability-registry-intents) plus its
Phase D description. The source was checked on 2026-09-20.

- D4 makes this a built-in seed only. `invoke()` is a lookup and a call. This task does not add
  board registration, cross-module priority negotiation, request ids or cancellation, a request
  lifecycle, discovery, or a payload transport channel. Those are Phase D concerns.
- D5 requires the payload, not the Excalidraw target format, to cross the handoff. The caller sends
  an image or Mermaid source; the drawing handler owns Excalidraw JSON construction.
- D6 and D9 exclude file creation, editor identity, `ILinkData.target`, and guide pipeline
  resolution. The 23 rows below are exactly the in-scope rows from US-1457; no other literal-id
  rows may be rewritten.
- D8 requires app-observable manual verification. The acceptance criteria below are observations,
  not compilation claims.

`EditorRow` in `src/renderer/editors/register-editors.ts:129-139` currently has no capability
  field. The registration loop at `:216-225` copies each row into `editorRegistry.register()`;
  `src/renderer/index.ts:8` imports `./editors/register-editors`, so the table is evaluated during
  renderer module setup. `EditorDefinition` and `EditorRegistry` in
  `src/renderer/editors/base/editorRegistry.ts:55-105` currently carry editor metadata and
  `accepts`, but no capability metadata. The plan must add the row declaration to that existing
  registration path rather than create a second editor list.

The current working-tree state includes US-1462's descriptor mechanism. The exact integration
points are:

- `src/renderer/api/app-service-registry.ts:1-96` defines `AppServiceKey` from `keyof IApp` minus
  lifecycle members, declares `AppServiceDescriptor`, contains the 12 current service rows, and
  exhaustively checks that every `IApp` service key has a descriptor. `window` and `boardVars` use
  selectors; `downloads` has an initializer.
- `src/renderer/api/app.ts:21-41,96-163` defines runtime service properties from the descriptor
  keys, loads/records them in `_loadServices()`, and reports named failures. US-1460 must not edit
  this loop or add a special case for capabilities.
- `src/renderer/api/types/app.d.ts:26-70` still explicitly declares the public service members;
  it does not yet declare `capabilities`. Adding that one typed public member is what extends the
  descriptor key union; the descriptor table then requires the matching row.
- `src/renderer/scripting/api-wrapper/AppWrapper.ts:66-166` defines runtime getters from the
  descriptor keys and exposes `AppWrapperImplementation & AppServiceSurface`; its remaining
  compile-time assertion protects only fixed special members. It must not receive a hand-written
  `capabilities` getter.

Therefore US-1460 adds the `ICapabilities` type/member to `src/renderer/api/types/app.d.ts` and
one `capabilities` descriptor row to the existing `src/renderer/api/app-service-registry.ts`.
It does not reproduce the old three-place edit in `app.ts`, `app.d.ts`, and `AppWrapper.ts`, and it
does not create a parallel registration mechanism. If the concurrent US-1462 implementation is
rebased to a materially different descriptor shape before this task starts, recheck these four
files and adapt only to that landed table.

### Capability surface and resolution policy

The service should expose, at minimum:

```ts
app.capabilities.invoke(id, payload)
```

Use a typed `invoke()` result for the built-in contracts below, with generic/overloaded typing so
the `diagram.edit` caller can receive `DiagramEditResult` without an unsafe cast. Unknown ids and
malformed built-in payloads may reject through the existing error path; this task does not define
Phase D's typed rejection taxonomy.

Do not add public `list()` now. There are no board declarations, no discovery caller, and no
"open with" UI in Phase A; a list would expose an unstable built-in-only table and invite Phase D
semantics prematurely. Phase D can add `list()`/`handlers()` when it adds manifest registration,
discovery without activation, priorities, trust, and the request lifecycle described in
`platform-roadmap.md §3.1` and Phase D.

The `EditorRow.capabilities` column should be a declarative, typed list of capability declarations
served by that row. A declaration contains the open capability id and, for `content.view`, an open
representation name. The registration loop passes that metadata into the existing editor
definition/registry; the capability service seeds an in-memory lookup keyed by capability id plus
representation. The entry identifies the owning editor (`draw-view` for image and diagram) and
calls a handler owned by that editor's module, preferably through a lazy import so the draw chunk
remains lazy.

The registry must not silently replace an existing `(id, representation)` entry: a duplicate
built-in declaration reports and leaves the original intact. There is no cross-module priority
negotiation in this epic. A later Phase D registry may replace that single-handler rule with
multiple module candidates and priorities. A representation is an open declared contract, not a
disguised editor id.

`text.open` and `content.view` are intentionally separate capabilities. `content.view` means
“render this content for reading” and dispatches by declared representation. `text.open` means
“open this content as source text” and uses Monaco's text handler. The SVG pair proves the split:
`src/renderer/editors/draw/index.ts:277` exports SVG and deliberately opens `svg-view`, while
`src/renderer/editors/browser/webview-context-menu.ts:255` opens SVG source and deliberately opens
Monaco. They have the same broad representation but different caller intent; merging them would
recreate the exact error that caused the earlier blocker.

### Capability resolution proof and exact contracts

The current `editorRegistry.resolveForFile()`/`accepts` path is intentionally not used here. It
requires a file name, and its language/file matcher scores cannot distinguish the two SVG callers.
The capability registry itself routes `content.view` by the declared representation. This is the
thin D4 lookup: `(content.view, "markdown")` resolves to the `md-view` declaration,
`(content.view, "grid")` to `grid-json`, and so on. `representation` is not `language`: language
remains a separate pass-through hint for Monaco syntax and the grid's JSON content.

### The four exact capability contracts

These contracts are taken from US-1457 and are deliberately narrower than the Phase D bus:

| capability | caller payload | handler result/ownership |
|---|---|---|
| `text.open` | `{ content: string, language: string, title: string }` | The built-in Monaco text handler creates the same source-text page as today. The payload carries no editor id, pipe, `pageId`, group, or link metadata. |
| `content.view` | `{ representation: "svg" | "html" | "markdown" | "mermaid" | "grid" | "log", content: string, language: string, title: string }` | The capability table selects the handler declared for the representation and creates the same specialized viewing page as today. `representation` is not `language`; language remains a pass-through hint. |
| `image.edit` | `{ dataUrl: string, mimeType?: string, naturalWidth?: number, naturalHeight?: number, title: string }`; current callers use a data URL, with MIME/dimensions supplied when already known, while `addDrawPage()` supplies only its data URL and title. | The `draw-view` handler derives missing MIME/dimensions, builds the embedded-image Excalidraw JSON, caps dimensions exactly as today, creates the drawing page, and returns its page identity/result. The caller never receives or constructs Excalidraw JSON. |
| `diagram.edit` | `{ source: string, title: string }` containing the trimmed Mermaid source and suggested `.excalidraw` title. | Returns `DiagramEditResult = { status: "opened", pageId: string, imageOnly: boolean } | { status: "conversion-failed", message: string }`. Mermaid conversion failure is an outcome, not a throw. The caller retains both existing notifications and the raster-fallback decision. |

The final Phase A seed set is exactly `text.open`, `content.view`, `image.edit`, and
`diagram.edit`. `text.open` has one Monaco handler and no representation. `content.view` has
the six declared representations `svg`, `html`, `markdown`, `mermaid`, `grid`, and `log`;
`image.edit` and `diagram.edit` are both served by the draw-owned handler. If another editor
declares an already occupied `(id, representation)` key, registration reports the duplicate
and keeps the first deterministic built-in entry; it does not negotiate a winner.

The capability handler may reject a non-conversion page/open failure, preserving the current outer
error handling. Only Mermaid conversion failure changes from a thrown builder error to the typed
outcome required by US-1457.

The following table is the row-by-row proof required before implementation. “Resolved handler” and
“editor today” must match on every row; no row is rounded off. `—` means the capability id itself
expresses the source-text intent, so no content-view representation is applicable.

| file:line | capability id | representation | resolved handler | editor today |
|---|---|---|---|---|
| `src/renderer/api/pages/PagesLifecycleModel.ts:377` | `image.edit` | — | `draw-view` | `draw-view` |
| `src/renderer/editors/draw/index.ts:277` | `content.view` | `svg` | `svg-view` | `svg-view` |
| `src/renderer/editors/browser/webview-context-menu.ts:227` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/browser/webview-context-menu.ts:240` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/browser/webview-context-menu.ts:255` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:473` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:484` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/scripting/api-wrapper/Text.ts:62` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/scripting/api-wrapper/Mermaid.ts:38` | `content.view` | `mermaid` | `mermaid-view` | `mermaid-view` |
| `src/renderer/scripting/api-wrapper/Markdown.ts:38` | `content.view` | `markdown` | `md-view` | `md-view` |
| `src/renderer/scripting/api-wrapper/Grid.ts:45` | `content.view` | `grid` | `grid-json` | `grid-json` |
| `src/renderer/editors/svg/SvgEditor.ts:71` | `image.edit` | — | `draw-view` | `draw-view` |
| `src/renderer/editors/mermaid/MermaidEditor.ts:210` | `image.edit` | — | `draw-view` | `draw-view` |
| `src/renderer/editors/mermaid/MermaidEditor.ts:235` | `diagram.edit` | — | `draw-view` | `draw-view` |
| `src/renderer/editors/image/ImageEditor.ts:300` | `image.edit` | — | `draw-view` | `draw-view` |
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts:789` | `content.view` | `log` | `log-view` | `log-view` |
| `src/renderer/editors/markdown/CodeBlock.ts:234` | `content.view` | `mermaid` | `mermaid-view` | `mermaid-view` |
| `src/renderer/editors/log-view/items/TextOutputView.ts:136` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/log-view/items/MermaidOutputView.ts:123` | `content.view` | `mermaid` | `mermaid-view` | `mermaid-view` |
| `src/renderer/editors/rest-client/ResponseViewerView.ts:386` | `text.open` | — | `monaco` | `monaco` |
| `src/renderer/editors/log-view/items/MarkdownOutputView.ts:38` | `content.view` | `markdown` | `md-view` | `md-view` |
| `src/renderer/editors/log-view/items/GridOutputView.ts:114` | `content.view` | `grid` | `grid-json` | `grid-json` |
| `src/renderer/api/internal/clipboard-image.ts:92` | `content.view` | `html` | `html-view` | `html-view` |

### D5 draw boundary

`src/renderer/editors/draw/drawExport.ts:112-155` contains
`buildExcalidrawJsonFromDataUrl()` and `buildExcalidrawJsonWithImage()`; the latter performs
dimension capping, image-element creation, file embedding, and serialization. Lines `178-214`
contain `buildExcalidrawJsonFromMermaid()`, which returns `{ json, imageOnly }` and currently throws
only when Mermaid parsing fails.

The four outside page-creating importers that must disappear are:

1. `src/renderer/api/pages/PagesLifecycleModel.ts:374-377` — data URL builder in `addDrawPage()`;
2. `src/renderer/editors/svg/SvgEditor.ts:8,68-71` — image builder and dimensions;
3. `src/renderer/editors/mermaid/MermaidEditor.ts:12-15,207-210,224-235` — image builder,
   dimensions, and Mermaid conversion; and
4. `src/renderer/editors/image/ImageEditor.ts:18-22,295-300` — image builder and dimensions.

Move the capability adapters into `src/renderer/editors/draw/` (a new draw-owned capability
handler module is the clearest boundary) and have them import the three builders from
`drawExport.ts`. The four callers pass image/source payloads to `app.capabilities.invoke()` and
never import `drawExport` or construct Excalidraw JSON. The functions remain in the draw module;
they do not move into a shared renderer utility. `src/renderer/editors/register-editors.ts:167`
(`load: import("./draw")`) remains unchanged, as do
`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` and
`src/renderer/scripting/api-wrapper/PageWrapper.ts`; those are explicitly Phase F exceptions.
The exit check is specifically no outside import of `editors/draw/drawExport`, not no import of
the draw folder.

## Implementation Plan

### 1. Add the thin capability service after US-1462

- Add the typed capability service module selected by the implementation (the planned flat path is
  `src/renderer/api/capabilities.ts`) and its public declaration/types if the US-1462 descriptor
  surface needs a separate type file. Keep the registry in memory and local to the renderer.
- Extend `EditorRow` and the corresponding `EditorDefinition` registration data in
  `src/renderer/editors/register-editors.ts` and
  `src/renderer/editors/base/editorRegistry.ts`. Copy the row's capability declarations through
  the existing `for (const e of EDITORS)` loop; do not add a second editor table.
- Seed the lookup from the registered built-in definitions. Use one deterministic built-in handler
  per id, report duplicate declarations, and do not add priority, `list()`, handlers discovery,
  board registration, request lifecycle, or payload persistence.
- Add `ICapabilities` to `src/renderer/api/types/app.d.ts` and exactly one `capabilities` loader
  row to the existing `src/renderer/api/app-service-registry.ts`. Do not edit the descriptor-driven
  runtime loop in `src/renderer/api/app.ts` or hand-edit an `AppWrapper` getter; those surfaces are
  already generated from the descriptor keys.
- Register the four seed ids: `text.open` on Monaco, `content.view` on declared representation
  handlers (`svg`, `html`, `markdown`, `mermaid`, `grid`, `log`), and `image.edit`/`diagram.edit`
  on draw-owned adapters. The representation table below is the proof that every row resolves to
  its current editor.

Before → after service shape:

```ts
// Before: caller names an editor and the handler's file format.
pagesModel.addEditorPage("draw-view", "json", title, json);

// After: app.capabilities is the one built-in lookup/call seam.
await app.capabilities.invoke("image.edit", {
    dataUrl, mimeType, naturalWidth, naturalHeight, title,
});
```

### 2. Implement the draw-owned handlers and rewrite image/diagram rows

- In the draw-owned handler module, implement `image.edit` by retaining the exact
  `buildExcalidrawJsonFromDataUrl`/`buildExcalidrawJsonWithImage` behavior. If dimensions or MIME
  are supplied, use them as the current callers do; otherwise measure/derive them exactly as the
  current data-URL helper does. Call `pagesModel.addEditorPage("draw-view", "json", title, json)`
  inside the handler and return enough page identity for `addDrawPage()` to return its existing
  `Promise<PageModel>` result.
- Implement `diagram.edit` around `buildExcalidrawJsonFromMermaid(source)`. Catch conversion
  failure inside the handler and return `{ status: "conversion-failed", message }`; on success
  create the draw page and return `{ status: "opened", pageId, imageOnly }`.
- Rewrite `PagesLifecycleModel.addDrawPage()` at `:373-377` to invoke `image.edit`, preserve the
  `untitled.excalidraw` fallback, and preserve its public returned page/wrapper behavior.
- Rewrite `SvgEditor.openInDrawingEditor()` at `:64-75` to pass the SVG data URL, MIME, measured
  dimensions, and `<source title>.excalidraw` title; keep its current wrapped failure message.
- Rewrite the raster branch of `MermaidEditor.openInDrawingEditor()` at `:202-214` to pass the
  rendered SVG image and Mermaid-derived title; keep its current wrapped failure message.
- Rewrite `ImageEditor.openInDrawingEditor()` at `:275-301` to pass the current data URL, MIME,
  dimensions, and basename-derived title; keep current pipe/URL byte behavior.
- Rewrite `MermaidEditor.convertToExcalidraw()` at `:216-245` to invoke `diagram.edit`. Preserve
  empty-source behavior, the conversion-failure notification and raster fallback, the
  `imageOnly` notification, the title, and the page-open failure message.

Before → after diagram shape:

```ts
// Before
try {
    conversion = await buildExcalidrawJsonFromMermaid(source);
} catch (error) {
    ui.notify(`Couldn't convert to editable shapes (${errMessage(error)}) - opening as an image instead.`, "info");
    await this.openInDrawingEditor();
    return;
}
pagesModel.addEditorPage("draw-view", "json", title, conversion.json);
if (conversion.imageOnly) notifyImageOnly();

// After: conversion failure is typed; the caller still owns both user decisions.
const result = await app.capabilities.invoke("diagram.edit", { source, title });
if (result.status === "conversion-failed") {
    ui.notify(`Couldn't convert to editable shapes (${result.message}) - opening as an image instead.`, "info");
    await this.openInDrawingEditor();
    return;
}
if (result.imageOnly) notifyImageOnly();
```

### 3. Rewrite the `text.open` and `content.view` rows

Use the capability table, not `editorRegistry.resolveForFile()` or a new matcher. Each `text.open`
call sends `{ content, language, title }` to Monaco. Each `content.view` call sends
`{ representation, content, language, title }`; the declared representation selects the handler,
while language remains an independent syntax/content hint. Neither capability accepts `editorId`,
`target`, `pageId`, grouping, namespace, revision, or a hidden mode flag.

### 4. Mechanical call-site checklist

The following is one row per US-1457 in-scope site. “After shape” is the only permitted rewrite
shape; the preservation column is the manual verification checklist. All `addEditorPage()` rows
currently create a new page through `PagesLifecycleModel.addPage()` (`:335-345`, `:242-267`); the
rewrite must preserve that behavior. The clipboard row is the sole row with an explicit follow-up
focus operation.

| file:line | before shape | after shape | preserve exactly |
|---|---|---|---|
| `src/renderer/api/pages/PagesLifecycleModel.ts:374-377` | `buildExcalidrawJsonFromDataUrl(dataUrl)` → `addEditorPage("draw-view", "json", title ?? "untitled.excalidraw", json)` | `await invoke("image.edit", { dataUrl, title: title ?? "untitled.excalidraw" })` and resolve the returned page id back to the existing `Promise<PageModel>` | Public `pages.addDrawPage()` signature/result, title fallback, image bytes, new drawing page and focus behavior |
| `src/renderer/editors/draw/index.ts:277` | `exportAsSvgText(api)` → `addEditorPage("svg-view", "xml", getDefaultName("svg"), svgText)` | `invoke("content.view", { representation: "svg", content: svgText, language: "xml", title: getDefaultName("svg") })` | Generated SVG, `drawing.svg`/source-derived title, XML language, new page, no grouping |
| `src/renderer/editors/browser/webview-context-menu.ts:227` | Fetch page source → `addEditorPage("monaco", "html", "Source: " + (pageTitle || pageUrl), resp)` | `invoke("text.open", { content: resp, language: "html", title: "Source: " + (pageTitle || pageUrl) })` | Fetch timing/content, title derivation, HTML language, Monaco choice, new page |
| `src/renderer/editors/browser/webview-context-menu.ts:240` | Collect DOM → `addEditorPage("monaco", "html", "DOM: " + (pageTitle || pageUrl), html)` | `invoke("text.open", { content: html, language: "html", title: "DOM: " + (pageTitle || pageUrl) })` | DOM serialization, title derivation, HTML language, Monaco choice, new page |
| `src/renderer/editors/browser/webview-context-menu.ts:255` | `addEditorPage("monaco", "xml", "untitled.svg", svgSource)` | `invoke("text.open", { content: svgSource, language: "xml", title: "untitled.svg" })` | SVG source, fixed title, XML language, Monaco choice, new page |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:473` | Fetch page source → `addEditorPage("monaco", "html", "Source: " + (pageTitle || pageUrl), resp)` | Same `text.open` payload as the context-menu source row | Toolbar path, fetch/content, title, HTML language, Monaco choice, new page |
| `src/renderer/editors/browser/BrowserWebviewModel.ts:484` | Collect DOM → `addEditorPage("monaco", "html", "DOM: " + (pageTitle || pageUrl), html)` | Same `text.open` payload as the context-menu DOM row | Toolbar path, DOM/content, title, HTML language, Monaco choice, new page |
| `src/renderer/scripting/api-wrapper/Text.ts:62` | `addEditorPage("monaco", this._language || "plaintext", title, this._text)` | `void invoke("text.open", { content: this._text, language: this._language || "plaintext", title })` | `void` public wrapper behavior, selected-language fallback, title fallback `Text`, content, one new page |
| `src/renderer/scripting/api-wrapper/Mermaid.ts:38` | `addEditorPage("mermaid-view", "mermaid", title, this._text)` | `void invoke("content.view", { representation: "mermaid", content: this._text, language: "mermaid", title })` | Wrapper title fallback `Mermaid Diagram`, Mermaid language, source, new page and Mermaid editor |
| `src/renderer/scripting/api-wrapper/Markdown.ts:38` | `addEditorPage("md-view", "markdown", title, this._text)` | `void invoke("content.view", { representation: "markdown", content: this._text, language: "markdown", title })` | Wrapper title fallback `Markdown`, Markdown language, source, new page and preview editor |
| `src/renderer/scripting/api-wrapper/Grid.ts:45` | Pretty `JSON.stringify(this._data, null, 2)` → `addEditorPage("grid-json", "json", title, json)` | `void invoke("content.view", { representation: "grid", content: JSON.stringify(this._data, null, 2), language: "json", title })` | Pretty JSON, title fallback `Grid Data`, JSON language, new page and Grid editor |
| `src/renderer/editors/svg/SvgEditor.ts:68-71` | Data URL/dimensions → `buildExcalidrawJsonWithImage` → `addEditorPage("draw-view", "json", title, json)` | `await invoke("image.edit", { dataUrl, mimeType: "image/svg+xml", naturalWidth, naturalHeight, title })` | SVG MIME, natural dimensions, image payload, `<source title>.excalidraw`, new drawing page, error text |
| `src/renderer/editors/mermaid/MermaidEditor.ts:207-210` | Rendered SVG data URL/dimensions → image builder → `addEditorPage("draw-view", "json", title, json)` | `await invoke("image.edit", { dataUrl, mimeType: "image/svg+xml", naturalWidth, naturalHeight, title })` | Rendered image, Mermaid-derived title, SVG MIME/dimensions, new drawing page, error text |
| `src/renderer/editors/mermaid/MermaidEditor.ts:224-235` | `buildExcalidrawJsonFromMermaid(source)` → draw page; catch conversion and raster fallback | `invoke("diagram.edit", { source, title })`; branch on typed outcome, then invoke `image.edit` on conversion failure | Trimmed source, title, conversion notification, raster fallback, `imageOnly` notification, new draw page |
| `src/renderer/editors/image/ImageEditor.ts:295-300` | Data URL/dimensions → image builder → `addEditorPage("draw-view", "json", baseName + ".excalidraw", json)` | `await invoke("image.edit", { dataUrl, mimeType, naturalWidth, naturalHeight, title: baseName + ".excalidraw" })` | Pipe/URL bytes, MIME, dimensions, basename title, new drawing page, error behavior |
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts:789` | JSONL join → `addEditorPage("log-view", "jsonl", "MCP Inspector History", content)` | `await invoke("content.view", { representation: "log", content, language: "jsonl", title: "MCP Inspector History" })` | One-time new page, exact JSONL join, fixed title/language, Log View editor |
| `src/renderer/editors/markdown/CodeBlock.ts:234` | `addEditorPage("mermaid-view", "mermaid", "Mermaid Diagram", this.props.code)` | `void invoke("content.view", { representation: "mermaid", content: this.props.code, language: "mermaid", title: "Mermaid Diagram" })` | Raw fenced source, fixed title/language, new page and Mermaid editor |
| `src/renderer/editors/log-view/items/TextOutputView.ts:136` | `addEditorPage("monaco", entry.language || "plaintext", title, entry.text)` | `void invoke("text.open", { content: entry.text, language: entry.language || "plaintext", title })` | Entry language fallback, title fallback `Text`, text, new page and Monaco choice |
| `src/renderer/editors/log-view/items/MermaidOutputView.ts:123` | `addEditorPage("mermaid-view", "mermaid", title, entry.text)` | `void invoke("content.view", { representation: "mermaid", content: entry.text, language: "mermaid", title })` | Entry title fallback `Mermaid Diagram`, Mermaid source/language, new page and Mermaid editor |
| `src/renderer/editors/rest-client/ResponseViewerView.ts:386` | `app.pages.addEditorPage("monaco", derived.language, "Response", formattedBody)` | `void app.capabilities.invoke("text.open", { content: derived.formattedBody, language: derived.language, title: "Response" })` | Existing response guard, derived language/body, fixed title, Monaco choice, new page |
| `src/renderer/editors/log-view/items/MarkdownOutputView.ts:38` | `addEditorPage("md-view", "markdown", title, entry.text)` | `void invoke("content.view", { representation: "markdown", content: entry.text, language: "markdown", title })` | Title fallback `Markdown`, Markdown source/language, new page and preview editor |
| `src/renderer/editors/log-view/items/GridOutputView.ts:114` | Pretty JSON → `addEditorPage("grid-json", "json", title, json)` | `void invoke("content.view", { representation: "grid", content: JSON.stringify(entry.data, null, 2), language: "json", title })` | Pretty JSON, title fallback `Grid Data`, JSON language, new page and Grid editor |
| `src/renderer/api/internal/clipboard-image.ts:92-93` | `const page = addEditorPage("html-view", "html", "Pasted HTML", html); showPage(page.id)` | `const { pageId } = await invoke("content.view", { representation: "html", content: html, language: "html", title: "Pasted HTML" }); pagesModel.showPage(pageId)` | Pasted HTML, fixed title/language, explicit focus of the newly created page, no grouping |

The rows intentionally absent from this table are US-1457's 9 file-type creation rows, 23
identity rows, 13 link-target rows, and 2 guide pipeline-resolution rows. They must not be
changed by this task.

### 5. Recommended ordering

1. US-1462 has now landed the typed descriptor table. Before writing the registration step, reread
   `src/renderer/api/app.ts`, `src/renderer/api/types/app.d.ts`, and
   `src/renderer/scripting/api-wrapper/AppWrapper.ts` as they actually are. Add the public type in
   `src/renderer/api/types/*.d.ts` and one descriptor row; do not import the runtime registry from
   `app.d.ts`, and do not hand-edit `assets/editor-types/`, whose flat copy is generated from the
   sibling type files.
2. Add the draw-owned `image.edit` and `diagram.edit` adapters, move the three
   `buildExcalidrawJson*` call paths behind them, and rewrite the four image/diagram handoffs.
   This isolates D5 and removes the risky outside imports before the broader content rewrite.
3. Add the representation-keyed `text.open`/`content.view` registrations and rewrite their 18
   rows using the C3 proof table. The capability table, not `accepts`/`resolveForFile`, resolves
   the handler; do not replace a representation with an editor id.
4. Run the 23-row manual checklist, the draw-import grep boundary, and the relevant app/script
   flows. Verify title, language, content, editor, page creation/focus, grouping, and notifications
   row by row.

## Concerns

- **Intent split is load-bearing:** draw SVG export and browser SVG source have the same broad
  content shape but deliberately choose `svg-view` and Monaco. Keep them as `content.view` with
  `representation: "svg"` versus `text.open`; do not merge the ids or smuggle an editor id into a
  representation.
- **Representation names are public contract candidates:** the Phase A names are `svg`, `html`,
  `markdown`, `mermaid`, `grid`, and `log`. They are not language ids, filenames, or editor ids;
  Phase D boards may later claim the open names.
- **Async wrapper calls:** Text/Markdown/Mermaid/Grid and log item methods currently return
  `void` and call synchronous `addEditorPage`. The rewrite must keep their public return shape and
  make rejected async invokes observable through the established UI error path; changing them to
  returned Promises is a surface change and is not accepted without separate review.
- **`addDrawPage()` result:** `invoke()` naturally returns a page identity, while the current
  `PagesLifecycleModel.addDrawPage()` returns `Promise<PageModel>`. The handler/service integration
  must resolve the page id back to the same model before returning; returning only a raw id would
  change the script API.
- **Capability duplicate semantics:** Phase A has no board competition. Duplicate built-in ids must
  report rather than replace; priority negotiation and a public candidate list belong to Phase D.
- **D5 boundary:** exit criterion 5 is only about outside `drawExport` imports. Do not remove the
  `register-editors.ts` draw-module load or the `DrawEditorFacade`/`PageWrapper` imports; those are
  Phase F work.
- **No automated net:** the project does not use a unit-test harness for this epic. Manual app
  observations and the 23-row checklist are required by D8.

## Acceptance Criteria

These are observations made by using the app after implementation. The C3 table is the resolution
checklist: every resolved handler must match the current editor before the row is accepted.

- [ ] The real script path can call `app.capabilities.invoke()` for `image.edit` and opens the same
      drawing page as `pages.addDrawPage()`, with the same title fallback and returned page behavior.
- [ ] `PagesLifecycleModel.addDrawPage()` and the Image, SVG, and Mermaid “Open in Drawing Editor”
      actions each open the same `draw-view` page with the same image bytes, MIME, dimensions,
      title, and focus behavior; no outside `drawExport` import remains.
- [ ] Mermaid “Convert to Excalidraw” still shows the existing conversion-failure notification,
      opens the raster fallback, and still shows the `imageOnly` notification for non-editable
      diagram types; conversion failure is observed as a typed result rather than a thrown builder
      error.
- [ ] The browser context-menu source/DOM/SVG rows and BrowserWebviewModel source/DOM rows use
      `text.open` and each open a new Monaco page with the existing content, title, language, and
      no extra focus/grouping change.
- [ ] The draw SVG export row uses `content.view`/`svg` and opens `svg-view`; the C3 row matches
      the current generated title, XML content, new-page behavior, and editor.
- [ ] The Text wrapper uses `text.open`; Mermaid, Markdown, and Grid wrappers use
      `content.view` with `mermaid`, `markdown`, and `grid`; each preserves its title fallback,
      language, serialization, editor, new-page behavior, and `void` public shape.
- [ ] MCP Inspector History uses `content.view`/`log` and opens one `log-view` JSONL page with the
      exact joined content and fixed title.
- [ ] The Markdown Mermaid code-block and Log View Mermaid output actions use
      `content.view`/`mermaid` and preserve source, title, language, and new-page behavior.
- [ ] Log View text output and REST response use `text.open` and preserve language/title/body in
      new Monaco pages.
- [ ] Log View Markdown/Grid use `content.view`/`markdown` and `content.view`/`grid`, preserving
      fallback titles, content, languages, and specialized editors.
- [ ] Rich clipboard paste uses `content.view`/`html`, opens `html-view`, and explicitly focuses
      it; title, language, content, and grouping remain unchanged.
- [ ] A source audit finds no import of `src/renderer/editors/draw/drawExport` from outside
      `src/renderer/editors/draw/**`; the explicitly deferred registration and scripting-facade
      imports remain present and unchanged.
- [ ] No link-target, guide parser/resolver, file-type creation, identity, board-shim, or
      `ILinkData` behavior is changed, and no `list()`/board registration/priority negotiation is
      added in this task.

## Files that need no changes

- `doc/active-work.md`, `doc/epics/EPIC-105.md`, and
  `doc/tasks/US-1457-editor-handoff-inventory/README.md` — explicitly protected source documents.
- `src/renderer/ui/sidebar/tools-editors-registry.ts` — New File/file-type creation rows.
- `src/renderer/content/parsers.ts` and `src/renderer/content/resolvers.ts` — identity and guide
  pipeline rows owned by US-1458; do not touch their `ILinkData.target` behavior.
- `src/renderer/api/board-vars/admin-api.ts`, settings/env-vars link openers, tree context menus,
  browser network-link helpers, About guide links, Git diff link openers, and
  `src/board-context-menu.ts` — link-target rows owned by the pipeline/bridge work.
- `src/renderer/editors/rest-client/panels/RestRequestTreeView.ts` and
  `src/renderer/editors/rest-client/open-in-rest-client.ts` — editor identity/document creation.
- `src/renderer/editors/browser/BrowserBookmarks.ts`, `src/renderer/api/pages/well-known-pages.ts`,
  and Markdown self-navigation — identity/restore behavior.
- `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` and `PageWrapper.ts` — Phase F draw
  facade re-provisioning, not this D5 boundary.
- Any source test/configuration file — D7 rejects adopting a test framework or harness for this
  epic.

## Files Changed Summary

| file | planned implementation change | changed by this planning task |
|---|---|---|
| `src/renderer/api/capabilities.ts` (planned new) | Thin built-in lookup, typed `invoke()`, duplicate reporting, and the four payload/result contracts; no `list()` | No |
| `src/renderer/api/app-service-registry.ts` (US-1462-owned) | Add one `capabilities` descriptor row to the existing exhaustive table | No |
| `src/renderer/api/types/app.d.ts` | Add the public `capabilities: ICapabilities` member from a sibling `api/types/*.d.ts` file; do not import the runtime registry | No |
| `src/renderer/api/types/capabilities.d.ts` (planned new) | Script-facing `ICapabilities`, four capability ids, representation names, payloads, and results; generated flat copy supplies Monaco IntelliSense | No |
| `src/renderer/editors/register-editors.ts` | Add the typed `capabilities` row data for the built-in handlers | No |
| `src/renderer/editors/base/editorRegistry.ts` | Carry capability metadata through existing editor definitions and seed registration | No |
| `src/renderer/editors/draw/capability-handlers.ts` (planned new) | Own `image.edit`/`diagram.edit` adapters and the only outside callers of `drawExport` | No |
| `src/renderer/editors/draw/drawExport.ts` | Retain the three document builders in the draw module; no format logic moves outward | No |
| `src/renderer/api/app.ts`, `src/renderer/scripting/api-wrapper/AppWrapper.ts` | Descriptor-driven runtime loading/getters already cover new services; no hand-written change | No |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Invoke `image.edit` from `addDrawPage`; preserve its public page result | No |
| `src/renderer/editors/svg/SvgEditor.ts` | Invoke `image.edit` with SVG payload | No |
| `src/renderer/editors/mermaid/MermaidEditor.ts` | Invoke `image.edit` for raster open and `diagram.edit` for conversion | No |
| `src/renderer/editors/image/ImageEditor.ts` | Invoke `image.edit` with current image bytes/metadata | No |
| `src/renderer/editors/draw/index.ts`, browser source/DOM files, scripting wrappers, log/REST/MCP/clipboard call sites listed in the checklist | Invoke `text.open` or representation-keyed `content.view` with exact existing content/title/language | No |
| `doc/tasks/US-1460-app-capabilities/README.md` | Verified investigation, resolution-proof and mechanical rewrite tables, ordering, concerns, and app-observable acceptance criteria | Yes |
| `doc/active-work.md`, `doc/epics/EPIC-105.md`, US-1457, and all other unlisted files | Protected/no change | No |
