# US-1600: `persephone-boards` catalog permissions and safe viewers

## Goal

Give every published catalog board an explicit least-privilege object-form permission set and a compatible `minBridgeVersion`. Make document-derived DOM in catalog viewers safe against EPIC-118 F7, then prepare all 11 board releases on `develop` for publication after the Persephone build enforcing grants is released.

## Background

The catalog source is `C:\projects\persephone-boards` on `develop`; `main` is published. Leave `_test/` alone. The catalog README/CLAUDE instructions make each `boards/<id>/board-manifest.json` version authoritative, require a terse entry under the next-version heading in every board's `WHATS-NEW.md`, and prohibit hand-editing `boards-manifest.json` or any `versions-manifest.json`.

Persephone's permission model is defined by `src/shared/board-manifest-utils.ts` and enforced by `src/main/board-bridge.ts`, the renderer board bridge, and `src/renderer/editors/board/BoardWebview.ts`. Its 11 keys are `execute`, `service`, `fileSystem`, `openExternal`, `appScripting`, `network`, `clipboardRead`, `camera`, `microphone`, `geolocation`, and `notifications`. Object-form manifests require `minBridgeVersion >= 1.30.0`. The boards guide maps service callbacks to bridge 1.22.0, `executeNode()` to `execute`, `persephone.call()` to `appScripting`, bridge remote `persephone.fetch()` to `network`, and file APIs/dialogs to `fileSystem`.

The hosted-document exception is specific to board pipes in `src/main/board-pipe-service.ts:103`. Simple editors call `P.readFile(getFilePath())`, and `boardRpcHandlers.readFile` in `src/main/board-bridge.ts:254-257` always authorizes that path through `resolveAuthorizedPath`; today that requires a `fileSystem` grant. Follow-up US-1610 (`doc/tasks/US-1610-hosted-document-read/`) changes this so a read of exactly the frame's hosted file is allowed without `fileSystem` and bumps `BOARD_BRIDGE_VERSION` to `1.32.0`. Excel, PDF, PE, PowerPoint, and Word therefore keep their existing `readFile(getFilePath())` code, declare `fileSystem:false`, and require `minBridgeVersion:"1.32.0"`. The other six boards stay at the 1.30.0 object-permission floor. This document depends on US-1610 landing before those five board releases can run safely.

Arbitrary-path `writeFile()` calls are not covered by the hosted-document read exception. Viewer AiVision export methods below will return content to the agent rather than write files. Clipboard writes and `persephone.notify()` in-board toasts are not permission flags. No board reads the clipboard or uses the browser `Notification` API.

The viewer boards also register board-owned AiVision models. In the inspected enforcement source, `BoardWebview.ts` routes `board:aiVision` through the `mainTrusted` gate (`BOARD_MESSAGE_GATES.aiVision`); the explicit `appScripting` permission check is on the bridge `call` path. The user-facing guide describes capabilities/agent tools under `appScripting`, so implementation should keep this distinction visible: do not grant `appScripting` to a board merely because it registers its own model, but if the model's reachable methods are changed to call Persephone app scripting/MCP, map those calls to `appScripting`.

## Board-by-board audit

Permissions are the target manifest values after the planned changes. Each object must spell all 11 keys; the common all-false object is used unless overrides are shown.

### word-viewer

- Inspected `boards/word-viewer/app.js`, `word-aivision.js`, `index.html`, `CLAUDE.md`, and `board-manifest.json`.
- Calls: `app.js:201` reads the `P.getFilePath()` hosted source with `P.readFile(currentPath, {encoding:"base64"})`; this is currently gated by `fileSystem`, and requires US-1610's exact-hosted-file exception. `word-aivision.js:445,779,788` writes extracted image/text/Markdown to caller-supplied absolute paths; these require `fileSystem:"full"` today. Replace those write methods with returned content per the export contract below. `P.notify()` is an in-board toast; no other privileged bridge calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.32.0`, because the simple editor's `P.readFile(getFilePath())` depends on US-1610.
- F7: `app.js` passes document bytes to `docx.renderAsync(blob, docEl, docEl, RENDER_OPTIONS)`, which inserts converted document HTML/styles/images in the live DOM. Vendor DOMPurify from the local source listed in the implementation plan. Render into a detached staging element, sanitize, then attach. Keep `<style>` elements and inline `style`; allow `data:`/`blob:` only for image sources, forbid script/iframe/object/embed/foreignObject and strip all event-handler attributes. No sanitizer is currently present. The `docEl.innerHTML = ""` clears are not document insertion sinks.
- Version/changelog: `1.1.0 → 1.1.1`; add a `## 1.1.1` note in `boards/word-viewer/WHATS-NEW.md` for object permissions, safe rendering, and returned export content.

### aivision-explorer

- Inspected `boards/aivision-explorer/app.js`, `CLAUDE.md`, `index.html`, and `board-manifest.json`.
- Calls: `app.js:106-107` adapts `P.call(path, options)`; this accesses the Persephone object model, scripts, and agent tools, so requires `appScripting:true`. `navigator.clipboard.writeText()` at `app.js:576` is write-only and needs no flag. The custom notification mount is DOM, not OS notifications. No process, filesystem, bridge network, external-open, device, or clipboard-read call found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:true, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.30.0`, permission-object floor; no later API found.
- DOM: results are built as DOM nodes/text; no document-derived source is rendered. Keep as-is.
- Version/changelog: `1.0.5 → 1.0.6`; add a one-line `## 1.0.6` entry to `boards/aivision-explorer/WHATS-NEW.md`.

### drawio-viewer

- Inspected `boards/drawio-viewer/app.js`, `drawio-aivision.js`, `CLAUDE.md`, `index.html`, and `board-manifest.json`.
- Calls: `app.js:636-667` uses `P.saveFileDialog()` and `P.writeFile()` for user-initiated SVG/PNG export; dialog-picked destinations map to `fileSystem:"board"`. `drawio-aivision.js:797,805,816` writes agent exports to supplied arbitrary paths and requires `fileSystem:"full"` today; replace those methods with returned content per the export contract below. `getFilePath()` is only a cosmetic name; XML comes from content-host `P.host.getContent()/onContentChange()`. Clipboard image writes are write-only. No other privileged calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:"board", openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`. Keep the native save dialog and write path; the user-picked path is covered by `"board"`.
- Bridge minimum: `1.30.0`.
- F7: `renderPage()` currently sends untrusted XML through `viewerConfig()` to `GraphViewer.createViewerForElement()` (`app.js:389-401`), which creates an interactive mxGraph DOM. Do not sanitize after rendering: live content creates an execution window and sanitizing it can break pan/zoom/layers/links. Move GraphViewer into a nested `sandbox="allow-scripts"` iframe with no same-origin access or Persephone bridge; send XML by `postMessage` and return export SVG by `postMessage`. Verify the vendored classic scripts in `lib/viewer-static.min.js` load from `board://` inside the opaque-origin frame. If loading fails, record the specific `board://`/opaque-origin resource or script error and fall back to DOMPurify on detached staged static output; document that static output loses GraphViewer pan/zoom, layer controls, and clickable diagram links. No sanitizer is currently present. Page names use `textContent`.
- Version/changelog: `1.1.0 → 1.1.1`; add `## 1.1.1` to `boards/drawio-viewer/WHATS-NEW.md`. DOMPurify assets are conditional on using the static-output fallback.

### excel-viewer

- Inspected `boards/excel-viewer/app.js`, `xlsx-aivision.js`, `index.html`, and `board-manifest.json`.
- Calls: `app.js:276-299` obtains the current document path then `P.readFile(path, {encoding:"binary"})`; as a simple editor this is gated by `fileSystem` today and depends on US-1610's exact-hosted-file exception. `xlsx-aivision.js:812,827` writes agent-requested CSV/Markdown to supplied absolute paths, requiring `fileSystem:"full"` today. Replace those methods with returned strings per the export contract below. No other privileged bridge calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.32.0`, because the simple editor's `P.readFile(getFilePath())` depends on US-1610.
- F7: no board-owned HTML sink found. `app.js:renderSheet()` passes document-derived rows/columns to vendored `AVGridClass.create()`; board code supplies data, not HTML formatters. Preserve/confirm the grid's text-only default cell renderer; if any field is markup, use a text-only renderer. No DOMPurify is needed if that contract holds; no converted HTML/SVG insertion found in board code.
- Version/changelog: `1.2.1 → 1.2.2`; add `## 1.2.2` to `boards/excel-viewer/WHATS-NEW.md`.

### force-graph

- Inspected `boards/force-graph/app.js`, `graph-actions.js`, `graph-ui.js`, `graph-icons.js`, `graph-renderer.js`, `CLAUDE.md`, and `board-manifest.json`.
- Calls: host content/state/theme/AiVision display APIs are not privileged permissions. `navigator.clipboard.write()/writeText()` are write-only. No filesystem, process, service, bridge network, external-open, clipboard-read, device, notification, or MCP calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.30.0`; graph theme API is documented since 1.5.0; no later API found.
- DOM: graph data is rendered with SVG element/attribute APIs and text nodes; toolbar markup is fixed constants in `graph-icons.js:31`. No document-derived markup insertion found. Keep labels as text and attribute names fixed.
- Version/changelog: `1.0.0 → 1.0.1`; add `## 1.0.1` to `boards/force-graph/WHATS-NEW.md`.

### pdf-viewer

- Inspected `boards/pdf-viewer/app.js`, `pdf-aivision.js`, `index.html`, and `board-manifest.json`.
- Calls: `app.js:317` reads source bytes through `P.readFile(filePath, {encoding:"binary"})`; as a simple editor this is gated by `fileSystem` today and depends on US-1610's exact-hosted-file exception. `pdf-aivision.js:315,500` writes page images/text to supplied absolute paths and currently needs `fileSystem:"full"`; replace those methods with returned content per the export contract below. `P.notify()` is an in-board toast. No other privileged bridge calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}` after removing arbitrary-path writes.
- Bridge minimum: `1.32.0`, because the simple editor's `P.readFile(getFilePath())` depends on US-1610. The bundled PDF.js is version 5.4.530, past the CVE-2024-4367 fix.
- F7: the document is passed with `PDFViewerApplication.open({data:bytes})` (`app.js:321`) to nested `#viewer`. Prefer a sandboxed frame without bridge: set `sandbox="allow-scripts"` only (no `allow-same-origin`), replace direct `frameResult.win` access with bounded `postMessage`, and verify its ES modules and module worker can load from `board://` under the opaque-origin CORS rules. If that fails, retain the same-origin frame only as the documented fallback: pass `isEvalSupported:false` and `enableScripting:false`, verify no PDF-derived string reaches board-owned `innerHTML`, and record that the same-origin child can reach `parent.persephone` (residual risk). Independently replace `app.js:177` diagnostics `innerHTML` with DOM-built rows and `textContent`. No sanitizer is currently present.
- Version/changelog: `1.1.0 → 1.1.1`; add `## 1.1.1` to `boards/pdf-viewer/WHATS-NEW.md` for bridge minimum, sandbox/fallback, and returned exports.

### pe-viewer

- Inspected `boards/pe-viewer/app.js`, `pe-parser.js`, `CLAUDE.md`, and `board-manifest.json`.
- Calls: `app.js:459` reads the current hosted document with `P.readFile(currentPath, {encoding:"binary"})`; as a simple editor this is gated by `fileSystem` today and depends on US-1610's exact-hosted-file exception. `navigator.clipboard.writeText()` at `app.js:401` is write-only. No other privileged bridge calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.32.0`, because `P.readFile(getFilePath())` depends on US-1610.
- DOM: `app.js:31` has an `html` property in its element helper, but inspected PE values (names, paths, certificate fields, symbols) are text children; markup call sites are fixed board content/icons. Keep document strings out of the `html` prop. No sanitizer needed for current call sites.
- Version/changelog: `1.0.3 → 1.0.4`; add `## 1.0.4` to `boards/pe-viewer/WHATS-NEW.md`.

### powerpoint-viewer

- Inspected `boards/powerpoint-viewer/app.js`, `pptx-aivision.js`, `index.html`, and `board-manifest.json`.
- Calls: `app.js:153` reads the source via `P.readFile(currentPath, {encoding:"base64"})`; as a simple editor this is gated by `fileSystem` today and depends on US-1610's exact-hosted-file exception. `pptx-aivision.js:394,936,946` writes extracted images/text/Markdown to arbitrary paths, requiring `fileSystem:"full"` today. Replace those methods with returned content per the export contract below. No other privileged calls found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}` after write removal.
- Bridge minimum: `1.32.0`, because the simple editor's `P.readFile(getFilePath())` depends on US-1610.
- F7: `app.js:125` clears `slidesEl` only; it passes untrusted deck bytes to `pptxPreview.preview()`, and vendored `lib/pptx-preview.min.js` creates slide DOM. Stage at measured dimensions, sanitize generated HTML/SVG with DOMPurify before attaching to visible slides, retain only the styles/attributes required for static display/navigation. No sanitizer found.
- Version/changelog: `1.1.0 → 1.1.1`; add `## 1.1.1` to `boards/powerpoint-viewer/WHATS-NEW.md`; vendor DOMPurify.

### sqlite-viewer

- Inspected `boards/sqlite-viewer/app.js`, `sqlite-aivision.js`, `scripts/db-server.mjs`, `CLAUDE.md`, and `board-manifest.json`.
- Calls: `app.js:423` opens the database with `P.openFileDialog()` and passes its selected path to `startServer(path)`; `app.js:134` passes that path as an argument to `P.executeNode("scripts/db-server.mjs", [path], ...)`, and the Node script opens the hosted `.sqlite`/database file itself. There is no bridge `P.readFile()` call, so `minBridgeVersion:1.30.0` remains sufficient. `executeNode()` requires `execute:true`; the user-picked dialog path requires `fileSystem:"board"`. `sqlite-aivision.js:826,845` writes CSV/Markdown to arbitrary paths and currently requires `fileSystem:"full"`; replace those methods with returned strings per the export contract below. No network, service, app scripting, external-open, clipboard-read, or device calls found.
- Target `permissions`: `{execute:true, service:false, fileSystem:"board", openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.30.0`; executeNode predates the floor.
- DOM: rows and metadata flow to text grid cells; no board-owned document-derived HTML/SVG insertion found. Keep cell values text-only. The chosen-file path is read by its permission-gated Node process.
- Version/changelog: `1.1.0 → 1.1.1`; add `## 1.1.1` to `boards/sqlite-viewer/WHATS-NEW.md`.

### todo

- Inspected `boards/todo/app.js`, `CLAUDE.md`, `index.html`, and `board-manifest.json`.
- Calls: document content uses `P.host.getContent()/onContentChange()/setContent()` and cross-frame selection uses `P.state.*`; these are host/document UI APIs, not privileged permissions. No process, file, dialog, call, network, clipboard, device, or OS notification API found.
- Target `permissions`: `{execute:false, service:false, fileSystem:false, openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.30.0`.
- DOM: `app.js:717`'s HTML helper is used for a numeric count template; item names/comments/tags are built as text nodes. Keep source strings out of HTML helper; no converted document HTML/SVG insertion.
- Version/changelog: `1.2.0 → 1.2.1`; add `## 1.2.1` to `boards/todo/WHATS-NEW.md`.

### torrent-viewer

- Inspected `boards/torrent-viewer/app.js`, `scripts/service.mjs`, `scripts/network.mjs`, `scripts/proxy-fetch.mjs`, `README.md`, `CLAUDE.md`, and `board-manifest.json`.
- Calls: `P.service.request/status/stop()` and service callbacks in `scripts/service.mjs` require `service:true`; the background Node worker performs peer/web-seed network activity and provider registration, which makes service the necessary full-access capability. `P.openFileDialog()` (`app.js:1081`), `P.saveFileDialog()` (`1127,1213`), and `P.writeFile()` (`1134,1224`) save to picked paths and map to `fileSystem:"board"`. `P.storage.get/set()` use board-local storage and have no separate permission flag; the service reads the network setting from that store. `P.providers.register()` is performed by the privileged service. `P.icons.forFiles()` is read-only (1.18.0). Native `fetch(resource.url)` reads service/provider resource URLs; no `persephone.fetch()` bridge call, so `network:false`. Clipboard writes only. No executeNode, appScripting, openExternal, clipboard-read, device, or notification calls found.
- Target `permissions`: `{execute:false, service:true, fileSystem:"board", openExternal:false, appScripting:false, network:false, clipboardRead:false, camera:false, microphone:false, geolocation:false, notifications:false}`.
- Bridge minimum: `1.30.0`; exceeds service callbacks (1.22) and file icons (1.18).
- DOM: `innerHTML` uses fixed row/icon templates and numeric progress/size strings; no document-derived HTML/SVG. Keep torrent names/tracker strings in text nodes. No sanitizer required by current call sites.
- Version/changelog: `1.9.2 → 1.9.3`; add `## 1.9.3` to `boards/torrent-viewer/WHATS-NEW.md`.

## Implementation plan

Work in two independent batches on `C:\projects\persephone-boards` branch `develop`. Confine board edits to `boards/<id>/`. Never hand-edit catalog-generated `boards-manifest.json` or `versions-manifest.json`. For each board add the explicit permission object; use `minBridgeVersion:"1.32.0"` for simple editors Word, Excel, PDF, PE, and PowerPoint because they depend on US-1610, and `"1.30.0"` for the other six. Update version and add a matching terse top changelog heading. No publication or git operations are in scope.

### Shared AiVision export return contract

For every arbitrary-path AiVision export listed below, remove the path parameter and `P.writeFile()` call. Return text exports (including CSV, Markdown, and SVG) as strings to the agent caller. Return raster image exports as `{fileName, mimeType, base64}`; cap the combined base64 in one method result at 6 MiB and throw a clear `export-result-too-large` error before returning if one image or the aggregate exceeds that cap. The 6 MiB base64 cap leaves room for method/result metadata under Persephone's 8 MiB capability payload limit. Do not partially write files. Update the exposed method signature, summary, caution, and the top-level `HELP` string so agents are told that the content is returned and they can write it themselves if needed.

Apply this contract to `word-aivision.js` (`saveMarkdown`, `saveText`, `saveImage`, `saveImages`), `xlsx-aivision.js` (`saveCsv`, `saveMarkdown`), `pptx-aivision.js` (`saveMarkdown`, `saveText`, `saveImage`, `saveImages`), `pdf-aivision.js` (`saveText`, `savePageImage`, `savePageImages`), `drawio-aivision.js` (`savePageImage`, `savePageSvg`, `savePageImages`), and `sqlite-aivision.js` (`saveCsv`, `saveMarkdown`). Preserve source/range/page options, but remove destination path/directory arguments. Record this agent API behavior change in each affected board's `WHATS-NEW.md`. The agent caller can write returned text/base64 through its own authorized file workflow.

### Vendored DOMPurify source and policy

The catalog implementation must not fetch a dependency. Copy the locally available DOMPurify 3.4.12 distribution from `C:/projects/persephone/node_modules/dompurify/dist/purify.min.js` and `C:/projects/persephone/node_modules/dompurify/LICENSE` into each board that uses it at `boards/<id>/lib/dompurify/purify.min.js` and `boards/<id>/lib/dompurify/LICENSE`; include `boards/<id>/lib/dompurify/VERSION.txt` containing `3.4.12`. Use this for Word and PowerPoint; use it for DrawIO only if its sandboxed frame fails and the documented static-output fallback is selected. PDF uses the sandboxed PDF.js frame and does not vendor DOMPurify. `docx-preview` emits `<style>` elements and `data:`/`blob:` images; preserve those only under the scoped allow rules below. PowerPoint must likewise preserve its required inline presentation styles and embedded image sources.

For Word and PowerPoint, sanitize a detached staging tree before insertion. Permit `<style>` elements and inline `style` attributes required by the converters; permit `data:`/`blob:` URLs only on image `src` attributes (not as general link/resource protocols). Explicitly forbid `script`, `iframe`, `object`, `embed`, and SVG `foreignObject`; strip every attribute whose name starts with `on`, and reject unsafe `href`/`src` values. Preserve only the converter's required HTML/SVG elements and presentation attributes. Never attach the unsanitized staging tree to the live document.

### Batch A — document viewers needing safe rendering

1. **Word Viewer (`boards/word-viewer/`):** Vendor DOMPurify 3.4.12 from the specified local source. In `app.js`, render `docx.renderAsync()` into a detached/sized staging element, sanitize under the Word policy above, then insert into `#doc`. In `word-aivision.js`, implement the shared return contract. Set all flags false, bridge minimum 1.32.0 (US-1610 dependency), bump 1.1.0→1.1.1 and add the matching changelog line.
2. **Excel Viewer (`boards/excel-viewer/`):** Keep `AVGridClass.create()` document values on its text-only renderer; confirm the vendored default cell path writes values as text and add a board-owned text renderer if that is not guaranteed. In `xlsx-aivision.js`, implement the shared return contract. Set all flags false, bridge minimum 1.32.0 (US-1610 dependency), bump 1.2.1→1.2.2 and add changelog line.
3. **PowerPoint Viewer (`boards/powerpoint-viewer/`):** Vendor DOMPurify 3.4.12 from the specified local source. In `app.js`, render `pptxPreview.preview()` into measured detached staging DOM, sanitize under the PowerPoint policy above, and only then attach to `#slides`. In `pptx-aivision.js`, implement the shared return contract. Set all flags false, bridge minimum 1.32.0 (US-1610 dependency), bump 1.1.0→1.1.1 and add changelog line.
4. **PDF Viewer (`boards/pdf-viewer/`):** In `index.html`, set `#viewer` sandbox to `allow-scripts` only (no same-origin or bridge). In `app.js`, replace direct same-origin `frameResult.win.PDFViewerApplication` access with a narrow `postMessage` API; add `boards/pdf-viewer/pdfjs-board-bridge.js` and load it from `boards/pdf-viewer/lib/pdfjs/web/viewer.html` to accept only bounded open/render operations. Verify PDF.js 5.4.530 ES modules and its module worker load from `board://` within an opaque-origin sandbox under CORS. If they cannot, use the same-origin fallback with `isEvalSupported:false` and `enableScripting:false`, confirm board code never inserts PDF-derived strings with `innerHTML`, and document the residual parent bridge access risk. Replace diagnostics `innerHTML` with DOM-built rows/`textContent`. In `pdf-aivision.js`, implement the shared return contract. Set all flags false, bridge minimum 1.32.0 (US-1610 dependency), bump 1.1.0→1.1.1 and add changelog line.
5. **DrawIO Viewer (`boards/drawio-viewer/`):** In `app.js`/new `diagram-frame.html` and `diagram-frame.js`, host interactive GraphViewer in a nested `sandbox="allow-scripts"` iframe without same-origin or bridge. Send content XML and receive exported SVG by `postMessage`; keep native user-initiated `saveSvg()`/`savePng()` dialogs and writes, requiring `fileSystem:"board"`. Verify classic scripts load from `board://` in the opaque-origin frame. If they cannot, use DOMPurify 3.4.12 on staged static output and document loss of GraphViewer's layer controls/clickable links (and any pan/zoom behavior not preserved by the host wrapper). In `drawio-aivision.js`, implement the shared return contract. Set `fileSystem:"board"`, all other flags false, bridge minimum 1.30.0, bump 1.1.0→1.1.1 and add changelog line.

Batch A is complete only when document-derived output is either sanitized before live insertion, rendered text-only, or isolated in the bridge-free sandboxed frame; viewer agent helpers cannot write arbitrary paths, and manifests are explicit.

### Batch B — all other boards

1. **AiVision Explorer:** `boards/aivision-explorer/board-manifest.json`: `appScripting:true`, all else false; min bridge 1.30.0; version 1.0.6 and matching `WHATS-NEW.md` entry.
2. **Force Graph:** `boards/force-graph/board-manifest.json`: all false; min bridge 1.30.0; version 1.0.1 and matching changelog.
3. **PE Viewer:** `boards/pe-viewer/board-manifest.json`: all false; min bridge 1.32.0 because `P.readFile(getFilePath())` depends on US-1610; version 1.0.4 and matching changelog.
4. **SQLite Viewer:** `boards/sqlite-viewer/board-manifest.json`: `execute:true`, `fileSystem:"board"`, other nine false; min bridge 1.30.0. In `sqlite-aivision.js` implement the shared return contract for CSV/Markdown; version 1.1.1 and matching changelog.
5. **Todo:** `boards/todo/board-manifest.json`: all false; min bridge 1.30.0; version 1.2.1 and matching changelog.
6. **Torrent Viewer:** `boards/torrent-viewer/board-manifest.json`: `service:true`, `fileSystem:"board"`, other nine false; min bridge 1.30.0; version 1.9.3 and matching changelog.

For both batches, check top changelog heading equals manifest version. Publication must wait until the permission-enforcing Persephone release; then use the repository's documented develop-to-main publishing workflow.

### Before → after manifest

~~~json
// Before: no enforced permission object
{ "version": "1.0.5", "minAppVersion": "5.0.3" }
~~~

~~~json
// After: AiVision Explorer target
{
  "version": "1.0.6",
  "minAppVersion": "5.0.3",
  "minBridgeVersion": "1.30.0",
  "permissions": {
    "execute": false, "service": false, "fileSystem": false,
    "openExternal": false, "appScripting": true, "network": false,
    "clipboardRead": false, "camera": false, "microphone": false,
    "geolocation": false, "notifications": false
  }
}
~~~

### Before → after document insertion

~~~js
// Before: converted DOCX markup becomes live before a sanitizer can inspect it.
await docx.renderAsync(blob, docEl, docEl, RENDER_OPTIONS);
~~~

~~~js
// After: render off-DOM, sanitize, then attach the approved static markup.
const staging = document.createElement("div");
await docx.renderAsync(blob, staging, staging, RENDER_OPTIONS);
docEl.replaceChildren(DOMPurify.sanitize(staging.innerHTML, { RETURN_DOM_FRAGMENT: true }));
~~~

The implementation must adapt this pattern to preserve docx-preview's generated style nodes and any required image URL policy; this is the intended security boundary, not copy-paste code.

### Files that need no changes

- Persephone permission enforcement sources `src/shared/board-manifest-utils.ts`, `src/shared/board-bridge-version.ts`, `src/main/board-bridge.ts`, and `src/renderer/editors/board/BoardWebview.ts`; earlier EPIC-119 tasks own those changes.
- Catalog-generated `C:\projects\persephone-boards\boards-manifest.json` and all `versions-manifest.json` files; publishing automation writes them.
- Unrelated third-party libraries and board code outside the renderer/output paths named above.
- Existing `minAppVersion` values; no new app API is required by this plan.

## Concerns

- Current viewer AiVision save helpers require `fileSystem:"full"` because they write arbitrary absolute paths. The plan removes/reworks those paths instead of granting full filesystem access to untrusted-document viewers.
- Excel passes workbook-derived values to vendored av-grid. Its text-only default must be confirmed; if not guaranteed, add a board-owned text renderer.
- Word and PowerPoint must render to detached staging DOM so unsanitized document output never becomes active. DrawIO's normal path isolates the interactive viewer in a sandboxed frame; only its documented static fallback sanitizes output and loses layer controls/clickable links.
- PDF.js currently relies on same-origin direct access and a module worker. Verify both load with the opaque-origin sandbox; if they do not, apply the documented same-origin fallback flags and state the residual `parent.persephone` access risk.
- This is a source audit/task plan, not implementation or runtime testing. Published ZIP contents remain unverified until generated by the publish workflow.

## Acceptance criteria

- All 11 boards have a call-to-flag audit, a complete 11-key target permission set, bridge minimum, next release version, and matching changelog plan.
- Every target manifest declares object permissions; Word, Excel, PDF, PE, and PowerPoint use `minBridgeVersion:"1.32.0"` for US-1610, while the other six use `"1.30.0"`.
- Viewers request no `network`, `execute`, or `appScripting`. The five simple viewers use `fileSystem:false` after US-1610 and returned exports; DrawIO uses `fileSystem:"board"` only for its native save dialogs and picked export files.
- Word, Excel, PowerPoint, PDF, and DrawIO injection paths have the specified sanitizer/text-only/sandbox work; remaining boards explicitly have no document-derived HTML/SVG sink or keep such values text-only.
- Neither generated catalog manifests nor `main` are modified/published by this task.

## Files Changed summary

| Path | Planned change |
|---|---|
| `doc/tasks/US-1600-boards-catalog-permissions/README.md` | Task plan and source-verified audit. |
| `doc/active-work.md` | Link US-1600 dashboard entry here. |
| `doc/epics/EPIC-119.md` | Link the US-1600 task-table row here. |
| `C:\projects\persephone-boards\boards\<id>\board-manifest.json` (11) | Explicit permissions, bridge minimum, next version. |
| `C:\projects\persephone-boards\boards\<id>\WHATS-NEW.md` (11) | Matching next-version entry. |
| `word-viewer/app.js`, `word-aivision.js` | Stage/sanitize DOCX output; return AI exports to the caller. |
| `excel-viewer/app.js`, `xlsx-aivision.js` | Keep text-only cells; return AI exports to the caller. |
| `powerpoint-viewer/app.js`, `pptx-aivision.js` | Stage/sanitize slide output; return AI exports to the caller. |
| `pdf-viewer/app.js`, `pdf-aivision.js`, `index.html`, `pdfjs-board-bridge.js`, `lib/pdfjs/web/viewer.html` | Sandbox PDF.js without a bridge (or documented fallback), use message API, build safe diagnostics, return exports. |
| `drawio-viewer/app.js`, `drawio-aivision.js`, `diagram-frame.html`, `diagram-frame.js` | Sandbox interactive GraphViewer; retain save dialogs; return agent exports. |
| `word-viewer/lib/dompurify/*`, `powerpoint-viewer/lib/dompurify/*` | Pinned local DOMPurify distribution, license, version metadata; drawio-viewer adds these only for static fallback. |
| Other board runtime files | No changes expected, except where named above. |

## Implementation results (2026-10-03)

Both batches were implemented on `develop` in `C:\projects\persephone-boards`. Nothing is
committed or pushed. Publishing waits for the Persephone release that ships EPIC-119.

- **Batch B (implemented as planned):**
  - `minBridgeVersion` is 1.30.0 for all six boards except pe-viewer, which needs 1.32.0.
  - aivision-explorer 1.0.6 gets `appScripting`.
  - force-graph 1.0.1, pe-viewer 1.0.4 and todo 1.2.1 get no permissions.
  - sqlite-viewer 1.1.1 gets `execute` and `fileSystem: "board"`.
  - torrent-viewer 1.9.3 gets `service` and `fileSystem: "board"`.
  - SQLite's `saveCsv(sql?)` and `saveMarkdown(sql?)` now return text and no longer take a path.
- **Batch A (word 1.1.1, excel 1.2.2, powerpoint 1.1.1, pdf 1.1.1, drawio 1.1.1):**
  - All five declare their permissions explicitly. AiVision exports return their content (images
    capped at 6 MiB), and no AiVision `P.writeFile` call remains.
  - **Word:** docx-preview builds DOM with DOM APIs, so it renders into a detached staging element.
    DOMPurify (`IN_PLACE`) then cleans it, plus a pass that strips `on*` attributes and unsafe
    `href`/`src` values, before the nodes move into `#doc`.
  - **PowerPoint:** the vendored `pptx-preview.umd.js` used to assign text runs with
    `l.innerHTML = text`. These are now sanitized with DOMPurify before assignment, and the staged
    output is sanitized as well.
  - **Excel:** cell values are rendered with `textContent`.
  - **PDF (fallback taken):** `board://` responses carry no `Access-Control-Allow-Origin`, so PDF.js
    ES modules and its worker cannot load in an opaque-origin sandbox. The frame stays same-origin,
    with `isEvalSupported: false` and `enableScripting: false`, and the diagnostics are built with
    DOM APIs. Residual risk: the same-origin child can reach `parent.persephone`.
  - **DrawIO (fallback taken):** the diagram XML and the generated SVG are sanitized with
    DOMPurify, and clickable diagram links are removed. Follow-up: classic `<script src>` loads do
    not need CORS, so a sandboxed-frame version that keeps interactivity is probably possible.
    Codex could not confirm it without a live test.
- **Not verified live:** the dev copies are not registered, and trusting them is the user's
  decision. Still to test:
  - Word and PowerPoint rendering;
  - PDF.js load and render;
  - DrawIO rendering and exports;
  - every AiVision export.
